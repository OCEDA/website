# Build on the Pi:
#   sudo apt install -y g++ make pkg-config libcamera-dev libgpiod-dev libjpeg-dev
#   make
# If saved JPEGs show red and blue swapped:  make clean && make SWAP_RB=1
CXX      ?= g++
CXXFLAGS ?= -O2 -Wall -Wextra -std=c++17
SWAP_RB  ?= 0
PKGS      = libcamera libgpiod

oceda_capture: oceda_capture.cpp
	$(CXX) $(CXXFLAGS) -DOCEDA_JPEG_SWAP_RB=$(SWAP_RB) $< -o $@ \
		$$(pkg-config --cflags --libs $(PKGS)) -ljpeg -lpthread

clean:
	rm -f oceda_capture

.PHONY: clean
