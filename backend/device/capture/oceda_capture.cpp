/*
 * OCEDA otoscope capture program (Raspberry Pi Zero W + Arducam/IMX219 + ST7789 LCD + 4 LEDs + button).
 *
 *   - turns the 4 illumination LEDs on and shows a live 240x240 camera preview on the LCD
 *   - a press on the capture button (GPIO21 -> GND) saves the frame currently on the LCD as a JPEG
 *     into the spool directory ($OCEDA_SPOOL, default ~/oceda-spool):
 *         <id>.part  ->  (finished)  ->  <id>.jpg      (the rename is atomic)
 *     and prints one line:  "captured <id>.jpg"
 *   - it does NOT talk to the network. `pi_client.py --native` starts this program, watches the spool
 *     and uploads every finished .jpg to the OCEDA server (with retries while Wi-Fi is down).
 *
 * Build:  make            (needs libcamera-dev, libgpiod-dev >= 2.0, libjpeg-dev - see Makefile)
 *         make SWAP_RB=1  (if saved photos have red and blue swapped)
 * Run:    ./oceda_capture (by hand: preview + button, files land in the spool; Ctrl+C stops, LEDs go off)
 */
#include <cstdio>
#include <cstdlib>
#include <csignal>
#include <ctime>
#include <cerrno>
#include <random>
#include <string>
#include <sys/stat.h>
#include <jpeglib.h>

#include <libcamera/libcamera.h>

#include <gpiod.h>

#include <linux/spi/spidev.h>
#include <sys/ioctl.h>
#include <sys/mman.h>
#include <fcntl.h>
#include <unistd.h>

#include <algorithm>
#include <chrono>
#include <condition_variable>
#include <cstdint>
#include <cstring>
#include <iostream>
#include <memory>
#include <mutex>
#include <queue>
#include <vector>

using namespace libcamera;

/* =========================================================
 * LCD configuration
 * ========================================================= */

static constexpr int LCD_WIDTH  = 240;
static constexpr int LCD_HEIGHT = 240;

static constexpr int GPIO_DC  = 24;
static constexpr int GPIO_RST = 25;
static constexpr int GPIO_BUTTON = 21;

// OCEDA illumination LEDs
static constexpr int LED1 = 17;
static constexpr int LED2 = 27;
static constexpr int LED3 = 22;
static constexpr int LED4 = 23;

static gpiod_line_request *button_request = nullptr;

static constexpr const char *SPI_DEVICE = "/dev/spidev0.0";

/*
 * Where finished photos go. pi_client.py sets OCEDA_SPOOL for us; by hand it defaults to ~/oceda-spool,
 * the same default pi_client.py uses, so both always look at the same folder.
 */
static std::string spool_dir()
{
    if (const char *dir = std::getenv("OCEDA_SPOOL"); dir && *dir)
        return dir;

    const char *home = std::getenv("HOME");
    return std::string(home && *home ? home : "/tmp") + "/oceda-spool";
}

/* mkdir -p */
static bool make_dirs(const std::string &path)
{
    for (size_t i = 1; i <= path.size(); ++i) {
        if (i == path.size() || path[i] == '/') {
            std::string part = path.substr(0, i);

            if (mkdir(part.c_str(), 0755) < 0 && errno != EEXIST) {
                perror(("mkdir " + part).c_str());
                return false;
            }
        }
    }

    return true;
}

/* Set by SIGINT / SIGTERM so the main loop can stop cleanly and turn the LEDs off. */
static volatile std::sig_atomic_t g_stop = 0;

static void on_signal(int)
{
    g_stop = 1;
}



/*
 * Start conservatively.
 * Once everything works, try:
 *
 * 8 MHz
 * 16 MHz
 * 24 MHz
 *
 * one at a time.
 */
static constexpr uint32_t SPI_SPEED = 30'000'000;


/* =========================================================
 * Camera configuration
 * ========================================================= */

/*
 * Ask libcamera for a small preview.
 *
 * 320x320:
 *
 * +--------------------------------+
 * |     |                    |     |
 * |     |      240x240       |     |
 * |     |       crop         |     |
 * |     |                    |     |
 * +--------------------------------+
 *
 * We discard 40 pixels from each side.
 */
static constexpr unsigned CAM_WIDTH  = 320;
static constexpr unsigned CAM_HEIGHT = 320;


/* =========================================================
 * GPIO
 * ========================================================= */

static gpiod_chip *gpio_chip = nullptr;
static gpiod_line_request *gpio_request = nullptr;

/* Horizontal crop offset into the camera frame; set in main() from the validated stream size. */
static unsigned g_crop_x = (CAM_WIDTH - LCD_WIDTH) / 2;

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

    gpiod_line_settings_set_direction(
        settings,
        GPIOD_LINE_DIRECTION_OUTPUT
    );

    gpiod_line_settings_set_output_value(
        settings,
        GPIOD_LINE_VALUE_INACTIVE
    );

    unsigned int offsets[] = {
            GPIO_DC,
            GPIO_RST,
            LED1,
            LED2,
            LED3,
            LED4
    };

    if (gpiod_line_config_add_line_settings(
            line_config,
            offsets,
            6,
            settings) < 0) {

        std::cerr << "Cannot configure GPIO lines\n";
        return false;
    }

    gpiod_request_config_set_consumer(
        request_config,
        "otoscope-preview"
    );

    gpio_request = gpiod_chip_request_lines(
        gpio_chip,
        request_config,
        line_config
    );

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
    gpiod_line_settings *settings =
        gpiod_line_settings_new();

    gpiod_line_config *line_config =
        gpiod_line_config_new();

    gpiod_request_config *request_config =
        gpiod_request_config_new();

    if (!settings || !line_config || !request_config) {
        std::cerr << "Cannot allocate button config\n";
        return false;
    }

    // GPIO21 sebagai input
    gpiod_line_settings_set_direction(
        settings,
        GPIOD_LINE_DIRECTION_INPUT
    );

    // Internal pull-up: tombol menghubungkan GPIO21 ke GND
    if (gpiod_line_settings_set_bias(
            settings,
            GPIOD_LINE_BIAS_PULL_UP) < 0) {

        std::cerr << "Cannot set button pull-up\n";
        gpiod_line_settings_free(settings);
        gpiod_line_config_free(line_config);
        gpiod_request_config_free(request_config);
        return false;
    }

    unsigned int offset[] = {GPIO_BUTTON};

    if (gpiod_line_config_add_line_settings(
            line_config, offset, 1, settings) < 0) {

        std::cerr << "Cannot configure button GPIO\n";
        gpiod_line_settings_free(settings);
        gpiod_line_config_free(line_config);
        gpiod_request_config_free(request_config);
        return false;
    }

    gpiod_request_config_set_consumer(
        request_config,
        "otoscope-capture-button"
    );

    button_request = gpiod_chip_request_lines(
        gpio_chip,
        request_config,
        line_config
    );

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
        value
            ? GPIOD_LINE_VALUE_ACTIVE
            : GPIOD_LINE_VALUE_INACTIVE
    );
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

    /*
     * IMPORTANT:
     *
     * Keep whichever SPI mode made your lcdTest_WORKING.c
     * actually work.
     *
     * If your working file uses SPI_MODE_3, leave this as 3.
     */
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
    /*
     * Avoid oversized spidev writes.
     */
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

    /*
     * MADCTL
     *
     * Keep this identical to your working LCD test if your
     * working version uses another value.
     */
    lcd_command(0x36);
    lcd_data_byte(0x00);

    /*
     * RGB565
     */
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


static void lcd_set_window(
    uint16_t x0,
    uint16_t y0,
    uint16_t x1,
    uint16_t y1)
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
 * RGB888 -> RGB565
 * ========================================================= */

static std::vector<uint8_t> lcd_frame(
    LCD_WIDTH * LCD_HEIGHT * 2
);


static void convert_rgb888_to_rgb565(
    const uint8_t *source,
    unsigned source_stride)
{
    /*
     * Camera = 320x240
     * LCD    = 240x240
     *
     * Center crop:
     *
     * (320 - 240) / 2 = 40 pixels.
     */

    const unsigned crop_x = g_crop_x;

    uint8_t *dst = lcd_frame.data();

    for (unsigned y = 0; y < LCD_HEIGHT; ++y) {

        const uint8_t *src =
            source +
            y * source_stride +
            crop_x * 3;

        for (unsigned x = 0; x < LCD_WIDTH; ++x) {

            /*
             * RGB888:
             *
             * RRRRRRRR GGGGGGGG BBBBBBBB
             *
             * ->
             *
             * RGB565:
             *
             * RRRRRGGG GGGBBBBB
             */

            uint8_t r = src[0];
            uint8_t g = src[1];
            uint8_t b = src[2];

            uint16_t rgb565 =
                ((r & 0xF8) << 8) |
                ((g & 0xFC) << 3) |
                (b >> 3);

            /*
             * ST7789 expects high byte first.
             */
            *dst++ = rgb565 >> 8;
            *dst++ = rgb565 & 0xFF;

            src += 3;
        }
    }
}


/*
 * Unique capture id. It becomes the filename AND the X-Capture-Id the server de-duplicates on
 * (letters, digits, _ and -, 8..64 chars), so it must never repeat: the Pi Zero W has no battery
 * clock and can boot with a wrong date, so a timestamp alone is not safe - add random bits.
 *   oto_20261031_142501_9f3a07c2
 */
static std::string make_capture_id()
{
    char stamp[32];
    std::time_t now = std::time(nullptr);
    std::tm local_time{};

    localtime_r(&now, &local_time);
    std::strftime(stamp, sizeof(stamp), "%Y%m%d_%H%M%S", &local_time);

    static std::random_device rd;
    char suffix[16];
    std::snprintf(suffix, sizeof(suffix), "%08x", static_cast<unsigned>(rd()));

    return std::string("oto_") + stamp + "_" + suffix;
}


/*
 * Save the 240x240 centre crop of the current camera frame into the spool.
 * Written as <id>.part and renamed to <id>.jpg when complete, so the uploader can never pick up
 * a half-written file.
 */
static bool save_jpeg(
    const uint8_t *source,
    unsigned source_stride)
{
    const std::string dir = spool_dir();
    const std::string id = make_capture_id();
    const std::string part_path = dir + "/" + id + ".part";
    const std::string final_path = dir + "/" + id + ".jpg";

    FILE *file = std::fopen(part_path.c_str(), "wb");

    if (!file) {
        perror(("Cannot create " + part_path).c_str());
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

    std::vector<uint8_t> row(LCD_WIDTH * 3);

    while (cinfo.next_scanline < cinfo.image_height) {
        const uint8_t *src =
            source
            + cinfo.next_scanline * source_stride
            + g_crop_x * 3;

        std::memcpy(row.data(), src, row.size());

#ifdef SWAP_RB
        /*
         * libcamera's RGB888 is B,G,R in memory but libjpeg wants R,G,B. The LCD path above is left
         * exactly as in the working preview; only the saved photo is corrected (make SWAP_RB=1).
         */
        for (size_t i = 0; i < row.size(); i += 3)
            std::swap(row[i], row[i + 2]);
#endif

        JSAMPROW row_pointer = row.data();

        jpeg_write_scanlines(
            &cinfo,
            &row_pointer,
            1
        );
    }

    jpeg_finish_compress(&cinfo);
    jpeg_destroy_compress(&cinfo);

    bool ok = (std::fflush(file) == 0);
    ok = (std::fclose(file) == 0) && ok;

    if (!ok || std::rename(part_path.c_str(), final_path.c_str()) < 0) {
        perror(("Cannot finish " + final_path).c_str());
        std::remove(part_path.c_str());
        return false;
    }

    /* pi_client.py looks for lines starting with "captured " and uploads right away. */
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

/* Turns the LEDs off on EVERY way out of main() (error returns, Ctrl+C, SIGTERM from pi_client). */
struct LedGuard {
    ~LedGuard()
    {
        if (gpio_request) {
            leds_set_all(false);
            std::cout << "All 4 LEDs OFF" << std::endl;
        }
    }
};


int main()
{
    /*
     * stdout is a pipe when pi_client.py runs us, and pipes are block-buffered by default - without this
     * the "captured ..." line would sit in a buffer instead of triggering the upload.
     */
    std::cout << std::unitbuf;

    std::signal(SIGINT, on_signal);
    std::signal(SIGTERM, on_signal);

    const std::string spool = spool_dir();

    if (!make_dirs(spool))
        return 1;

    std::cout << "Spool: " << spool << "\n";

    std::cout << "GPIO init...\n";

    if (!gpio_init())
        return 1;

    LedGuard led_guard;

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
        return 1;
    }


    if (camera_manager.cameras().empty()) {
        std::cerr << "No camera detected\n";
        return 1;
    }


    std::shared_ptr<Camera> camera =
        camera_manager.cameras()[0];


    if (camera->acquire()) {
        std::cerr << "Cannot acquire camera\n";
        return 1;
    }


    std::unique_ptr<CameraConfiguration> config =
        camera->generateConfiguration(
            { StreamRole::Viewfinder }
        );


    StreamConfiguration &stream_config =
        config->at(0);

    stream_config.size.width  = CAM_WIDTH;
    stream_config.size.height = CAM_HEIGHT;

    /*
     * Ask libcamera for RGB888.
     *
     * This keeps our first implementation easy to understand.
     */
    stream_config.pixelFormat =
        formats::RGB888;


    CameraConfiguration::Status status =
        config->validate();


    if (status == CameraConfiguration::Invalid) {
        std::cerr << "Invalid camera configuration\n";
        return 1;
    }


    std::cout
        << "Camera format: "
        << stream_config.toString()
        << "\n";

    if (stream_config.size.width < LCD_WIDTH ||
        stream_config.size.height < LCD_HEIGHT) {

        std::cerr << "Camera stream is smaller than the LCD\n";
        return 1;
    }

    g_crop_x = (stream_config.size.width - LCD_WIDTH) / 2;


    if (camera->configure(config.get())) {
        std::cerr << "Camera configuration failed\n";
        return 1;
    }


    Stream *stream = stream_config.stream();


    FrameBufferAllocator allocator(camera);

    if (allocator.allocate(stream) < 0) {
        std::cerr << "Buffer allocation failed\n";
        return 1;
    }


    const std::vector<std::unique_ptr<FrameBuffer>> &buffers =
        allocator.buffers(stream);


    /*
     * Map buffers into our address space.
     */
    struct BufferMapping {
        FrameBuffer *buffer;
        void *memory;
        size_t length;
    };


    std::vector<BufferMapping> mappings;


    for (const auto &buffer : buffers) {

        const FrameBuffer::Plane &plane =
            buffer->planes()[0];

        int fd = plane.fd.get();

        size_t length = plane.length;

        void *memory = mmap(
            nullptr,
            length,
            PROT_READ,
            MAP_SHARED,
            fd,
            plane.offset
        );


        if (memory == MAP_FAILED) {
            perror("mmap");
            return 1;
        }


        mappings.push_back({
            buffer.get(),
            memory,
            length
        });
    }


    /*
     * Create requests.
     */
    std::vector<std::unique_ptr<Request>> requests;


    for (const auto &buffer : buffers) {

        std::unique_ptr<Request> request =
            camera->createRequest();


        if (!request) {
            std::cerr << "Cannot create request\n";
            return 1;
        }


        if (request->addBuffer(
                stream,
                buffer.get()) < 0) {

            std::cerr << "Cannot attach buffer\n";
            return 1;
        }


        requests.push_back(
            std::move(request)
        );
    }


    camera->requestCompleted.connect(
        request_complete
    );


    std::cout << "Starting camera...\n";


    if (camera->start()) {
        std::cerr << "Camera start failed\n";
        return 1;
    }


    for (auto &request : requests)
        camera->queueRequest(request.get());


    std::cout
        << "\nLIVE PREVIEW RUNNING\n"
        << "Ctrl+C to stop.\n\n";


    unsigned frame_count = 0;

    auto fps_start =
        std::chrono::steady_clock::now();


    while (!g_stop) {

        Request *request;


        {
            std::unique_lock<std::mutex> lock(
                request_mutex
            );


            /* wake up every 200 ms so Ctrl+C / SIGTERM is noticed even if no frame arrives */
            if (!request_cv.wait_for(
                    lock,
                    std::chrono::milliseconds(200),
                    [] {
                        return !completed_requests.empty();
                    })) {

                continue;
            }


            request =
                completed_requests.front();

            completed_requests.pop();
        }


        const Request::BufferMap &buffer_map =
            request->buffers();


        FrameBuffer *buffer =
            buffer_map.at(stream);


        /*
         * Find our mmap corresponding to this buffer.
         */
        uint8_t *image = nullptr;


        for (const auto &mapping : mappings) {

            if (mapping.buffer == buffer) {
                image =
                    static_cast<uint8_t *>(
                        mapping.memory
                    );

                break;
            }
        }


        if (!image) {
            std::cerr << "Buffer mapping missing\n";
            break;
        }


        /*
         * Convert center crop to RGB565.
         */
        convert_rgb888_to_rgb565(
            image,
            stream_config.stride
        );


        /*
         * Push complete frame to LCD.
         */
        lcd_set_window(
            0,
            0,
            LCD_WIDTH - 1,
            LCD_HEIGHT - 1
        );


        gpio_set(GPIO_DC, true);

        spi_send(
            lcd_frame.data(),
            lcd_frame.size()
        );


        // Check physical capture button (GPIO21)
        int button_value =
            gpiod_line_request_get_value(
                button_request,
                GPIO_BUTTON
            );

        static bool button_was_pressed = false;

        if (button_value == GPIOD_LINE_VALUE_ERROR) {
            std::cerr << "Failed to read GPIO21\n";
        } else {
            bool button_pressed =
                (button_value == GPIOD_LINE_VALUE_INACTIVE);

            // Capture only once for each press
            if (button_pressed && !button_was_pressed) {
                usleep(30000); // debounce 30 ms

                int confirm_value =
                    gpiod_line_request_get_value(
                        button_request,
                        GPIO_BUTTON
                    );

                if (confirm_value == GPIOD_LINE_VALUE_INACTIVE) {
                    save_jpeg(image, stream_config.stride);
                }
            }

            button_was_pressed = button_pressed;
        }

        ++frame_count;


        /*
         * Print FPS every ~2 seconds.
         */
        auto now =
            std::chrono::steady_clock::now();


        double seconds =
            std::chrono::duration<double>(
                now - fps_start
            ).count();


        if (seconds >= 2.0) {

            double fps =
                frame_count / seconds;


            std::cout
                << "FPS: "
                << fps
                << "\n";


            frame_count = 0;
            fps_start = now;
        }


        /*
         * Re-use this request.
         */
        request->reuse(
            Request::ReuseBuffers
        );


        camera->queueRequest(request);
    }


    std::cout << "Stopping...\n";

    camera->stop();
    camera->release();
    camera_manager.stop();

    /* LedGuard turns the LEDs off as main() returns */
    return 0;
}