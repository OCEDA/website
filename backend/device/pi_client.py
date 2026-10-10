#!/usr/bin/env python3
"""OCEDA capture client for Raspberry Pi Zero W / Pi 3 (+ camera module, e.g. Arducam IMX219).

Press the hardware button (GPIO) -> grab a JPEG -> upload to the OCEDA server.
Pure standard library, Python 3.7+, so a stock Raspberry Pi OS works with nothing to pip install.
(gpiozero is used for the button if present; it ships with Raspberry Pi OS.)

  OCEDA_SERVER=http://192.168.1.50:8000 OCEDA_DEVICE_TOKEN=... python3 pi_client.py

  --keyboard   press Enter instead of a GPIO button
  --simulate FILE_OR_DIR   upload existing JPEGs instead of using a camera (test without hardware)
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path

SERVER = os.getenv("OCEDA_SERVER", "http://localhost:8000").rstrip("/")
TOKEN = os.getenv("OCEDA_DEVICE_TOKEN", "oceda-dev-device-token")
SPOOL = Path(os.getenv("OCEDA_SPOOL", str(Path.home() / "oceda-spool")))
log = lambda *a: print(time.strftime("%H:%M:%S"), *a, flush=True)


# ───────────────────────── camera ─────────────────────────
def camera_command(out: Path, w: int, h: int, quality: int, warmup_ms: int):
    """Pick whichever camera app this OS image has:
       Bookworm: rpicam-still   Bullseye: libcamera-still   Buster / legacy stack: raspistill"""
    for exe in ("rpicam-still", "libcamera-still"):
        if shutil.which(exe):
            return [exe, "-n", "-t", str(warmup_ms), "--width", str(w), "--height", str(h),
                    "-q", str(quality), "-o", str(out)]
    if shutil.which("raspistill"):
        return ["raspistill", "-n", "-t", str(warmup_ms), "-w", str(w), "-h", str(h),
                "-q", str(quality), "-o", str(out)]
    return None


def capture_frame(args, out: Path) -> bool:
    if args.simulate:
        src = sorted(Path(args.simulate).glob("*.jp*g")) if Path(args.simulate).is_dir() else [Path(args.simulate)]
        if not src:
            log("no jpeg found in", args.simulate)
            return False
        capture_frame.n = getattr(capture_frame, "n", -1) + 1
        shutil.copy(src[capture_frame.n % len(src)], out)
        return True
    cmd = camera_command(out, args.width, args.height, args.quality, args.warmup_ms)
    if not cmd:
        log("no camera app found (rpicam-still / libcamera-still / raspistill). Is the camera enabled?")
        return False
    try:
        subprocess.run(cmd, check=True, timeout=30, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    except subprocess.CalledProcessError as e:
        log("camera failed:", e.stderr.decode(errors="replace")[-300:])
        return False
    except subprocess.TimeoutExpired:
        log("camera timed out")
        return False
    return out.exists() and out.stat().st_size > 0


# ───────────────────────── upload (with offline spool) ─────────────────────────
def http(method, path, body=None, headers=None, timeout=60):
    req = urllib.request.Request(SERVER + path, data=body, method=method,
                                 headers={"X-Device-Token": TOKEN, **(headers or {})})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.status, r.read()


def upload(path: Path) -> str:
    """Returns 'ok' | 'retry' (network/server trouble, keep file) | 'drop' (server rejected it)."""
    data = path.read_bytes()
    try:
        status, _ = http("POST", "/api/device/captures", data, {
            "Content-Type": "image/jpeg",
            "X-Capture-Id": path.stem,                      # same id on every retry => no duplicates
            "X-Checksum": hashlib.sha256(data).hexdigest()})
        log("uploaded", path.name, f"({len(data) // 1024} KB) -> HTTP {status}")
        return "ok"
    except urllib.error.HTTPError as e:
        msg = e.read().decode(errors="replace")[:200]
        if e.code in (408, 429) or e.code >= 500:
            log("server busy/error", e.code, "- will retry")
            return "retry"
        log(f"rejected ({e.code}): {msg}")
        return "drop"                                       # 409 no exam, 401 bad token, 422 bad image ...
    except (urllib.error.URLError, OSError) as e:
        log("network error:", getattr(e, "reason", e), "- will retry")
        return "retry"


def flush_spool(stop: threading.Event, wake: threading.Event):
    """The ONLY uploader. Sends spooled frames oldest-first; on network trouble it backs off
    (3s -> 60s) and keeps the files, so images survive Wi-Fi drops."""
    delay = 3
    while not stop.is_set():
        wake.clear()
        failed = False
        for p in sorted(SPOOL.glob("*.jpg"), key=lambda f: f.stat().st_mtime):
            r = upload(p)
            if r == "retry":
                failed = True
                break
            try:
                p.unlink() if r == "ok" else p.rename(p.with_suffix(".rejected"))
            except OSError:
                pass
        delay = min(60, delay * 2) if failed else 3
        wake.wait(delay if failed else 30)


def heartbeat_loop(stop: threading.Event, args):
    while not stop.is_set():
        try:
            http("POST", "/api/device/heartbeat",
                 json.dumps({"firmware": "pi_client/1", "resolution": f"{args.width}x{args.height}"}).encode(),
                 {"Content-Type": "application/json"}, timeout=10)
        except Exception:
            pass
        stop.wait(10)


# ───────────────────────── main ─────────────────────────
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--width", type=int, default=int(os.getenv("OCEDA_WIDTH", 3280)))    # IMX219 full res
    ap.add_argument("--height", type=int, default=int(os.getenv("OCEDA_HEIGHT", 2464)))  # (use 1640x1232 on slow Wi-Fi)
    ap.add_argument("--quality", type=int, default=int(os.getenv("OCEDA_JPEG_Q", 90)))
    ap.add_argument("--warmup-ms", type=int, default=int(os.getenv("OCEDA_WARMUP_MS", 800)))
    ap.add_argument("--button-pin", type=int, default=int(os.getenv("OCEDA_BUTTON_PIN", 17)))  # BCM, wire to GND
    ap.add_argument("--keyboard", action="store_true")
    ap.add_argument("--simulate", metavar="PATH")
    ap.add_argument("--once", action="store_true", help="capture one frame immediately, flush, exit")
    args = ap.parse_args()

    SPOOL.mkdir(parents=True, exist_ok=True)
    stop, pressed, wake = threading.Event(), threading.Event(), threading.Event()
    threading.Thread(target=flush_spool, args=(stop, wake), daemon=True).start()
    threading.Thread(target=heartbeat_loop, args=(stop, args), daemon=True).start()

    button = None
    if not args.keyboard and not args.once:
        try:
            from gpiozero import Button
            button = Button(args.button_pin, pull_up=True, bounce_time=0.08)
            button.when_pressed = pressed.set
            log(f"ready - press the button (GPIO{args.button_pin}). server={SERVER}")
        except Exception as e:
            log("GPIO button unavailable (%s) - falling back to keyboard" % e)
            args.keyboard = True
    if args.keyboard:
        def reader():
            for _ in sys.stdin:
                pressed.set()
        threading.Thread(target=reader, daemon=True).start()
        log("ready - press Enter to capture. server=" + SERVER)
    if args.once:
        pressed.set()

    try:
        while True:
            pressed.wait()
            pressed.clear()                                 # presses during a capture are ignored (debounce)
            cap_id = uuid.uuid4().hex
            tmp = SPOOL / (cap_id + ".part")
            if capture_frame(args, tmp):
                final = tmp.with_suffix(".jpg")
                tmp.rename(final)                           # appears in spool only when complete
                log("captured", final.name)
                wake.set()                                  # uploader thread sends it right away
            if args.once:
                deadline = time.time() + 90
                while list(SPOOL.glob("*.jpg")) and time.time() < deadline:
                    time.sleep(0.3)
                break
    except KeyboardInterrupt:
        pass
    finally:
        stop.set()


if __name__ == "__main__":
    main()
