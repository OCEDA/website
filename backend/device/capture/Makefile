# OCEDA capture program - build on the Raspberry Pi:
#
#   sudo apt install -y g++ make pkg-config libcamera-dev libgpiod-dev libjpeg-dev
#   make                # normal build
#   make SWAP_RB=1      # saved photos have red/blue swapped? rebuild with this (LCD preview is unaffected)
#   make clean
#
# Needs libgpiod >= 2.0 (the program uses the v2 line-request API).

CXX      ?= g++
CXXFLAGS ?= -O2 -Wall -Wextra
CXXFLAGS += -std=c++17
ifeq ($(SWAP_RB),1)
CXXFLAGS += -DSWAP_RB
endif

TARGET := oceda_capture
PKGS   := libcamera libgpiod

all: $(TARGET)

# Rebuild when the flags change (e.g. make -> make SWAP_RB=1), not only when the source changes.
.flags: FORCE
	@echo '$(CXX) $(CXXFLAGS)' | cmp -s - $@ || echo '$(CXX) $(CXXFLAGS)' > $@

.deps-ok:
	@pkg-config --exists libcamera || { \
	  echo "error: libcamera not found - install it with: sudo apt install libcamera-dev"; exit 1; }
	@pkg-config --exists libgpiod || { \
	  echo "error: libgpiod not found - install it with: sudo apt install libgpiod-dev"; exit 1; }
	@pkg-config --atleast-version=2.0 libgpiod || { \
	  echo "error: libgpiod $$(pkg-config --modversion libgpiod) is installed, but this program needs 2.x."; \
	  echo "       Stock Raspberry Pi OS Bookworm ships 1.6.x; Trixie ships 2.x (or enable bookworm-backports)."; \
	  exit 1; }
	@touch $@

$(TARGET): oceda_capture.cpp .flags .deps-ok
	$(CXX) $(CXXFLAGS) $< -o $@ $$(pkg-config --cflags --libs $(PKGS)) -ljpeg -lpthread $(LDFLAGS)

clean:
	rm -f $(TARGET) .flags .deps-ok

.PHONY: all clean FORCE
FORCE:
