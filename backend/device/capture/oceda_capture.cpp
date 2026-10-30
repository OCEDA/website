/*
 * OCEDA otoscope capture program (Raspberry Pi + libcamera + ST7789 LCD).
 *
 *   - 4 illumination LEDs on while running
 *   - live preview (center 240x240 crop of a 320x320 stream) on the ST7789 over SPI
 *   - capture button on GPIO21 (to GND): saves the 240x240 crop as JPEG
 *
 * Saved JPEGs go to the spool directory that pi_client.py uploads from
 * ($OCEDA_SPOOL, default ~/oceda-spool). Each file is written as <id>.part and
 * renamed to <id>.jpg when complete, so the uploader never sees a half-written frame.
 *
 * Normally started by `pi_client.py --native`; it also runs standalone.
 *
 * Build: see Makefile in this directory.
 */
#include <cerrno>
#include <csignal>
#include <cstdio>
#include <cstdlib>
#include <ctime>
#include <jpeglib.h>

#include <libcamera/libcamera.h>

#include <gpiod.h>

#include <fcntl.h>
#include <linux/spi/spidev.h>
#include <sys/ioctl.h>
#include <sys/mman.h>
#include <sys/stat.h>
#include <unistd.h>

#include <algorithm>
#include <atomic>
#include <chrono>
#include <condition_variable>
#include <cstdint>
#include <cstring>
#include <iostream>
#include <memory>
#include <mutex>
#include <queue>
#include <string>
#include <vector>

using namespace libcamera;

/* =========================================================
 * Configuration
 * ========================================================= */

static constexpr int LCD_WIDTH  = 240;
static constexpr int LCD_HEIGHT = 240;

static constexpr int GPIO_DC     = 24;
static constexpr int GPIO_RST    = 25;
static constexpr int GPIO_BUTTON = 21;

// OCEDA illumination LEDs
static constexpr int LED1 = 17;
static constexpr int LED2 = 27;
static constexpr int LED3 = 22;
static constexpr int LED4 = 23;

static constexpr const char *SPI_DEVICE = "/dev/spidev0.0";

/*
 * Start conservatively if the display shows garbage: try 8, 16, 24 MHz.
 */
static constexpr uint32_t SPI_SPEED = 30'000'000;

/*
 * libcamera RGB888 is stored B,G,R in memory. The LCD path below treats byte 0 as
 * red (kept exactly as in the working preview). If saved JPEGs come out with red and
 * blue swapped, build with -DOCEDA_JPEG_SWAP_RB=1.
 */
#ifndef OCEDA_JPEG_SWAP_RB
#define OCEDA_JPEG_SWAP_RB 0
#endif

/*
 * 320x320 stream, 240x240 center crop (40 px dropped from each side).
 */
static constexpr unsigned CAM_WIDTH  = 320;
static constexpr unsigned CAM_HEIGHT = 320;

static std::string g_spool_dir;
static std::atomic<bool> g_quit{false};

static void on_signal(int) { g_quit = true; }

/* =========================================================
 * GPIO
 * ========================================================= */

static gpiod_chip *gpio_chip = nullptr;
static gpiod_line_request *gpio_request = nullptr;
static gpiod_line_request *button_request = nullptr;

static bool gpio_init()
{
    gpio_chip = gpiod_chip_open("/dev/gpiochip0");

    if (!gpio_chip) {
        std::cerr << "Cannot open /dev/gpiochip0\n";
        return false;
    }

    gpiod_line_settings *settings = gpiod_line_settings_new();
    gpiod_line_config *line_config = gpiod_line_config_new();
    gpiod_request_config *request_config = gpiod_request_config_new();

    if (!settings || !line_config || !request_config) {
        std::cerr << "Cannot allocate GPIO config\n";
        return false;
    }

    gpiod_line_settings_set_direction(settings, GPIOD_LINE_DIRECTION_OUTPUT);
    gpiod_line_settings_set_output_value(settings, GPIOD_LINE_VALUE_INACTIVE);

    unsigned int offsets[] = { GPIO_DC, GPIO_RST, LED1, LED2, LED3, LED4 };

    if (gpiod_line_config_add_line_settings(line_config, offsets, 6, settings) < 0) {
        std::cerr << "Cannot configure GPIO lines\n";
        return false;
    }

    gpiod_request_config_set_consumer(request_config, "otoscope-preview");

    gpio_request = gpiod_chip_request_lines(gpio_chip, request_config, line_config);

    gpiod_line_settings_free(settings);
    gpiod_line_config_free(line_config);
    gpiod_request_config_free(request_config);

    if (!gpio_request) {
        std::cerr << "Cannot request GPIO lines\n";
        return false;
    }

    return true;
}

static bool button_init()
{
    gpiod_line_settings *settings = gpiod_line_settings_new();
    gpiod_line_config *line_config = gpiod_line_config_new();
    gpiod_request_config *request_config = gpiod_request_config_new();

    if (!settings || !line_config || !request_config) {
        std::cerr << "Cannot allocate button config\n";
        return false;
    }

    gpiod_line_settings_set_direction(settings, GPIOD_LINE_DIRECTION_INPUT);

    // Internal pull-up: the button connects GPIO21 to GND
    if (gpiod_line_settings_set_bias(settings, GPIOD_LINE_BIAS_PULL_UP) < 0) {
        std::cerr << "Cannot set button pull-up\n";
        gpiod_line_settings_free(settings);
        gpiod_line_config_free(line_config);
        gpiod_request_config_free(request_config);
        return false;
    }

    unsigned int offset[] = { GPIO_BUTTON };

    if (gpiod_line_config_add_line_settings(line_config, offset, 1, settings) < 0) {
        std::cerr << "Cannot configure button GPIO\n";
        gpiod_line_settings_free(settings);
        gpiod_line_config_free(line_config);
        gpiod_request_config_free(request_config);
        return false;
    }

    gpiod_request_config_set_consumer(request_config, "otoscope-capture-button");

    button_request = gpiod_chip_request_lines(gpio_chip, request_config, line_config);

    gpiod_line_settings_free(settings);
    gpiod_line_config_free(line_config);
    gpiod_request_config_free(request_config);

    if (!button_request) {
        std::cerr << "Cannot request GPIO21\n";
        return false;
    }

    std::cout << "Capture button initialized on GPIO21\n";
    return true;
}

static void gpio_set(int gpio, bool value)
{
    gpiod_line_request_set_value(
        gpio_request,
        gpio,
        value ? GPIOD_LINE_VALUE_ACTIVE : GPIOD_LINE_VALUE_INACTIVE);
}

static void leds_set_all(bool on)
{
    gpio_set(LED1, on);
    gpio_set(LED2, on);
    gpio_set(LED3, on);
    gpio_set(LED4, on);
}

/* =========================================================
 * SPI
 * ========================================================= */

static int spi_fd = -1;

static bool spi_init()
{
    spi_fd = open(SPI_DEVICE, O_WRONLY);

    if (spi_fd < 0) {
        perror("open spidev");
        return false;
    }

    uint8_t mode = SPI_MODE_3;
    uint8_t bits = 8;
    uint32_t speed = SPI_SPEED;

    if (ioctl(spi_fd, SPI_IOC_WR_MODE, &mode) < 0) {
        perror("SPI mode");
        return false;
    }

    if (ioctl(spi_fd, SPI_IOC_WR_BITS_PER_WORD, &bits) < 0) {
        perror("SPI bits");
        return false;
    }

    if (ioctl(spi_fd, SPI_IOC_WR_MAX_SPEED_HZ, &speed) < 0) {
        perror("SPI speed");
        return false;
    }

    return true;
}

static bool spi_send(const uint8_t *data, size_t length)
{
    // Avoid oversized spidev writes.
    constexpr size_t CHUNK = 4096;

    while (length > 0) {
        size_t amount = std::min(length, CHUNK);

        ssize_t written = write(spi_fd, data, amount);

        if (written <= 0) {
            perror("SPI write");
            return false;
        }

        data += written;
        length -= written;
    }

    return true;
}

/* =========================================================
 * ST7789
 * ========================================================= */

static void lcd_command(uint8_t command)
{
    gpio_set(GPIO_DC, false);
    spi_send(&command, 1);
}

static void lcd_data(const uint8_t *data, size_t length)
{
    gpio_set(GPIO_DC, true);
    spi_send(data, length);
}

static void lcd_data_byte(uint8_t value)
{
    lcd_data(&value, 1);
}

static void lcd_reset()
{
    gpio_set(GPIO_RST, true);
    usleep(100000);

    gpio_set(GPIO_RST, false);
    usleep(100000);

    gpio_set(GPIO_RST, true);
    usleep(200000);
}

static void lcd_init()
{
    lcd_reset();

    /* Software reset */
    lcd_command(0x01);
    usleep(150000);

    /* Sleep out */
    lcd_command(0x11);
    usleep(150000);

    /* MADCTL */
    lcd_command(0x36);
    lcd_data_byte(0x00);

    /* RGB565 */
    lcd_command(0x3A);
    lcd_data_byte(0x55);

    usleep(10000);

    /* Inversion ON */
    lcd_command(0x21);

    /* Normal display mode */
    lcd_command(0x13);

    usleep(10000);

    /* Display ON */
    lcd_command(0x29);

    usleep(100000);
}

static void lcd_set_window(uint16_t x0, uint16_t y0, uint16_t x1, uint16_t y1)
{
    uint8_t data[4];

    /* Column address */
    lcd_command(0x2A);
    data[0] = x0 >> 8;
    data[1] = x0 & 0xFF;
    data[2] = x1 >> 8;
    data[3] = x1 & 0xFF;
    lcd_data(data, 4);

    /* Row address */
    lcd_command(0x2B);
    data[0] = y0 >> 8;
    data[1] = y0 & 0xFF;
    data[2] = y1 >> 8;
    data[3] = y1 & 0xFF;
    lcd_data(data, 4);

    /* Memory write */
    lcd_command(0x2C);
}

/* =========================================================
 * RGB888 -> RGB565 (center crop)
 * ========================================================= */

static std::vector<uint8_t> lcd_frame(LCD_WIDTH * LCD_HEIGHT * 2);

static void convert_rgb888_to_rgb565(const uint8_t *source, unsigned source_stride)
{
    constexpr unsigned crop_x = (CAM_WIDTH - LCD_WIDTH) / 2;

    uint8_t *dst = lcd_frame.data();

    for (unsigned y = 0; y < LCD_HEIGHT; ++y) {
        const uint8_t *src = source + y * source_stride + crop_x * 3;

        for (unsigned x = 0; x < LCD_WIDTH; ++x) {
            uint8_t r = src[0];
            uint8_t g = src[1];
            uint8_t b = src[2];

            uint16_t rgb565 =
                ((r & 0xF8) << 8) |
                ((g & 0xFC) << 3) |
                (b >> 3);

            /* ST7789 expects high byte first. */
            *dst++ = rgb565 >> 8;
            *dst++ = rgb565 & 0xFF;

            src += 3;
        }
    }
}

/* =========================================================
 * JPEG capture -> spool directory
 * ========================================================= */

static bool mkdir_p(const std::string &path)
{
    std::string cur;
    for (size_t i = 0; i <= path.size(); ++i) {
        if (i == path.size() || path[i] == '/') {
            if (!cur.empty() && mkdir(cur.c_str(), 0755) < 0 && errno != EEXIST)
                return false;
        }
        if (i < path.size())
            cur += path[i];
    }
    return true;
}

static bool save_jpeg(const uint8_t *source, unsigned source_stride)
{
    constexpr unsigned crop_x = (CAM_WIDTH - LCD_WIDTH) / 2;

    /*
     * Capture id doubles as the upload id (X-Capture-Id): oto_YYYYmmdd_HHMMSS_mmm.
     * Milliseconds keep two quick presses from overwriting each other.
     */
    timespec ts{};
    clock_gettime(CLOCK_REALTIME, &ts);
    std::tm local_time{};
    localtime_r(&ts.tv_sec, &local_time);

    char stamp[64];
    std::strftime(stamp, sizeof(stamp), "oto_%Y%m%d_%H%M%S", &local_time);

    char id[96];
    std::snprintf(id, sizeof(id), "%s_%03ld", stamp, ts.tv_nsec / 1000000L);

    const std::string part  = g_spool_dir + "/" + id + ".part";
    const std::string final = g_spool_dir + "/" + id + ".jpg";

    FILE *file = std::fopen(part.c_str(), "wb");

    if (!file) {
        perror("Cannot create JPEG file");
        return false;
    }

    jpeg_compress_struct cinfo{};
    jpeg_error_mgr jerr{};

    cinfo.err = jpeg_std_error(&jerr);
    jpeg_create_compress(&cinfo);
    jpeg_stdio_dest(&cinfo, file);

    cinfo.image_width = LCD_WIDTH;
    cinfo.image_height = LCD_HEIGHT;
    cinfo.input_components = 3;
    cinfo.in_color_space = JCS_RGB;

    jpeg_set_defaults(&cinfo);
    jpeg_set_quality(&cinfo, 90, TRUE);
    jpeg_start_compress(&cinfo, TRUE);

#if OCEDA_JPEG_SWAP_RB
    std::vector<uint8_t> swapped(LCD_WIDTH * 3);
#endif

    while (cinfo.next_scanline < cinfo.image_height) {
        const uint8_t *row =
            source + cinfo.next_scanline * source_stride + crop_x * 3;

#if OCEDA_JPEG_SWAP_RB
        for (int x = 0; x < LCD_WIDTH; ++x) {
            swapped[x * 3 + 0] = row[x * 3 + 2];
            swapped[x * 3 + 1] = row[x * 3 + 1];
            swapped[x * 3 + 2] = row[x * 3 + 0];
        }
        row = swapped.data();
#endif

        JSAMPROW row_pointer = const_cast<JSAMPROW>(row);
        jpeg_write_scanlines(&cinfo, &row_pointer, 1);
    }

    jpeg_finish_compress(&cinfo);
    jpeg_destroy_compress(&cinfo);

    if (std::fclose(file) != 0) {
        perror("Cannot finish JPEG file");
        unlink(part.c_str());
        return false;
    }

    // Appears in the spool only when complete; pi_client.py picks it up from here.
    if (std::rename(part.c_str(), final.c_str()) < 0) {
        perror("Cannot publish JPEG file");
        unlink(part.c_str());
        return false;
    }

    std::cout << "captured " << id << ".jpg" << std::endl;
    return true;
}

/* =========================================================
 * Request queue
 * ========================================================= */

static std::mutex request_mutex;
static std::condition_variable request_cv;
static std::queue<Request *> completed_requests;

static void request_complete(Request *request)
{
    if (request->status() == Request::RequestCancelled)
        return;

    {
        std::lock_guard<std::mutex> lock(request_mutex);
        completed_requests.push(request);
    }

    request_cv.notify_one();
}

/* =========================================================
 * Main
 * ========================================================= */

int main()
{
    std::signal(SIGINT, on_signal);
    std::signal(SIGTERM, on_signal);

    if (const char *spool = std::getenv("OCEDA_SPOOL"); spool && *spool) {
        g_spool_dir = spool;
    } else {
        const char *home = std::getenv("HOME");
        g_spool_dir = std::string(home ? home : ".") + "/oceda-spool";
    }

    if (!mkdir_p(g_spool_dir)) {
        std::cerr << "Cannot create spool directory " << g_spool_dir << "\n";
        return 1;
    }

    std::cout << "Spool directory: " << g_spool_dir << "\n";

    std::cout << "GPIO init...\n";

    if (!gpio_init())
        return 1;

    std::cout << "Button init...\n";

    if (!button_init())
        return 1;

    std::cout << "SPI init...\n";

    if (!spi_init())
        return 1;

    std::cout << "LCD init...\n";

    lcd_init();

    std::cout << "LED init...\n";
    leds_set_all(true);

    std::cout << "All 4 LEDs ON\n";

    std::cout << "Camera manager...\n";

    CameraManager camera_manager;

    if (camera_manager.start()) {
        std::cerr << "CameraManager failed\n";
        leds_set_all(false);
        return 1;
    }

    if (camera_manager.cameras().empty()) {
        std::cerr << "No camera detected\n";
        leds_set_all(false);
        return 1;
    }

    std::shared_ptr<Camera> camera = camera_manager.cameras()[0];

    if (camera->acquire()) {
        std::cerr << "Cannot acquire camera\n";
        leds_set_all(false);
        return 1;
    }

    std::unique_ptr<CameraConfiguration> config =
        camera->generateConfiguration({ StreamRole::Viewfinder });

    StreamConfiguration &stream_config = config->at(0);

    stream_config.size.width  = CAM_WIDTH;
    stream_config.size.height = CAM_HEIGHT;
    stream_config.pixelFormat = formats::RGB888;

    CameraConfiguration::Status status = config->validate();

    if (status == CameraConfiguration::Invalid) {
        std::cerr << "Invalid camera configuration\n";
        leds_set_all(false);
        return 1;
    }

    std::cout << "Camera format: " << stream_config.toString() << "\n";

    if (stream_config.size.width != CAM_WIDTH || stream_config.size.height != CAM_HEIGHT) {
        std::cerr << "Camera adjusted the size away from "
                  << CAM_WIDTH << "x" << CAM_HEIGHT << " - the crop assumes exactly that\n";
        leds_set_all(false);
        return 1;
    }

    if (camera->configure(config.get())) {
        std::cerr << "Camera configuration failed\n";
        leds_set_all(false);
        return 1;
    }

    Stream *stream = stream_config.stream();

    FrameBufferAllocator allocator(camera);

    if (allocator.allocate(stream) < 0) {
        std::cerr << "Buffer allocation failed\n";
        leds_set_all(false);
        return 1;
    }

    const std::vector<std::unique_ptr<FrameBuffer>> &buffers = allocator.buffers(stream);

    /* Map buffers into our address space. */
    struct BufferMapping {
        FrameBuffer *buffer;
        void *memory;
        size_t length;
    };

    std::vector<BufferMapping> mappings;

    for (const auto &buffer : buffers) {
        const FrameBuffer::Plane &plane = buffer->planes()[0];

        int fd = plane.fd.get();
        size_t length = plane.length;

        void *memory = mmap(nullptr, length, PROT_READ, MAP_SHARED, fd, plane.offset);

        if (memory == MAP_FAILED) {
            perror("mmap");
            leds_set_all(false);
            return 1;
        }

        mappings.push_back({ buffer.get(), memory, length });
    }

    /* Create requests. */
    std::vector<std::unique_ptr<Request>> requests;

    for (const auto &buffer : buffers) {
        std::unique_ptr<Request> request = camera->createRequest();

        if (!request) {
            std::cerr << "Cannot create request\n";
            leds_set_all(false);
            return 1;
        }

        if (request->addBuffer(stream, buffer.get()) < 0) {
            std::cerr << "Cannot attach buffer\n";
            leds_set_all(false);
            return 1;
        }

        requests.push_back(std::move(request));
    }

    camera->requestCompleted.connect(request_complete);

    std::cout << "Starting camera...\n";

    if (camera->start()) {
        std::cerr << "Camera start failed\n";
        leds_set_all(false);
        return 1;
    }

    for (auto &request : requests)
        camera->queueRequest(request.get());

    std::cout << "\nLIVE PREVIEW RUNNING\n"
              << "Ctrl+C to stop.\n\n" << std::flush;

    unsigned frame_count = 0;
    auto fps_start = std::chrono::steady_clock::now();
    bool button_was_pressed = false;

    while (!g_quit) {
        Request *request;

        {
            std::unique_lock<std::mutex> lock(request_mutex);

            // Wake up regularly so Ctrl+C / SIGTERM can stop us cleanly.
            if (!request_cv.wait_for(lock, std::chrono::milliseconds(200),
                                     [] { return !completed_requests.empty(); }))
                continue;

            request = completed_requests.front();
            completed_requests.pop();
        }

        const Request::BufferMap &buffer_map = request->buffers();
        FrameBuffer *buffer = buffer_map.at(stream);

        /* Find our mmap corresponding to this buffer. */
        uint8_t *image = nullptr;

        for (const auto &mapping : mappings) {
            if (mapping.buffer == buffer) {
                image = static_cast<uint8_t *>(mapping.memory);
                break;
            }
        }

        if (!image) {
            std::cerr << "Buffer mapping missing\n";
            break;
        }

        /* Convert center crop to RGB565 and push the frame to the LCD. */
        convert_rgb888_to_rgb565(image, stream_config.stride);

        lcd_set_window(0, 0, LCD_WIDTH - 1, LCD_HEIGHT - 1);

        gpio_set(GPIO_DC, true);
        spi_send(lcd_frame.data(), lcd_frame.size());

        ++frame_count;

        /* Physical capture button (GPIO21, active low). */
        int button_value = gpiod_line_request_get_value(button_request, GPIO_BUTTON);

        if (button_value == GPIOD_LINE_VALUE_ERROR) {
            std::cerr << "Failed to read GPIO21\n";
        } else {
            bool button_pressed = (button_value == GPIOD_LINE_VALUE_INACTIVE);

            // Capture only once for each press
            if (button_pressed && !button_was_pressed) {
                usleep(30000); // debounce 30 ms

                int confirm_value = gpiod_line_request_get_value(button_request, GPIO_BUTTON);

                if (confirm_value == GPIOD_LINE_VALUE_INACTIVE)
                    save_jpeg(image, stream_config.stride);
            }

            button_was_pressed = button_pressed;
        }

        /* Print FPS every ~2 seconds. */
        auto now = std::chrono::steady_clock::now();
        double seconds = std::chrono::duration<double>(now - fps_start).count();

        if (seconds >= 2.0) {
            std::cout << "FPS: " << frame_count / seconds << std::endl;
            frame_count = 0;
            fps_start = now;
        }

        /* Re-use this request. */
        request->reuse(Request::ReuseBuffers);
        camera->queueRequest(request);
    }

    camera->stop();
    camera->release();
    camera_manager.stop();

    leds_set_all(false);
    std::cout << "All 4 LEDs OFF\n";

    return 0;
}
