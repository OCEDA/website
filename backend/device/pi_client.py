#!/usr/bin/env python3
"""OCEDA capture client for Raspberry Pi Zero W / Pi 3 (+ camera module, e.g. Arducam IMX219).

Press the hardware button (GPIO) -> grab a JPEG -> upload to the OCEDA server.
Pure standard library, Python 3.7+, so a stock Raspberry Pi OS works with nothing to pip install.
(gpiozero is used for the button if present; it ships with Raspberry Pi OS.)

  OCEDA_SERVER=http://192.168.1.50:8000 OCEDA_DEVICE_TOKEN=... python3 pi_client.py

  --keyboard   press Enter instead of a GPIO button (button is GPIO21 / physical pin 40, to GND)
  --simulate FILE_OR_DIR   upload existing JPEGs instead of using a camera (test without hardware)

  --native [BIN]   the C++ capture program (capture/oceda_capture.cpp) owns the camera, LCD preview, LEDs and
                   button; this script just runs it and uploads the JPEGs it drops in the spool

Busy flag: after a press, further presses are ignored (not queued) until that shot has been captured
AND sent, so a slow or offline link can't pile up frames. --allow-queue only blocks during the capture.
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
        if not args.once:
            time.sleep(args.sim_delay)                      # pretend the camera needs a moment
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


def run_native(stop: threading.Event, wake: threading.Event, binary: Path):
    """Keep the C++ capture program running. It writes <id>.part -> <id>.jpg into the spool itself;
    the uploader thread picks the finished files up. Restarts it (3s -> 30s backoff) if it exits."""
    delay = 3
    while not stop.is_set():
        started = time.time()
        try:
            proc = subprocess.Popen([str(binary)], env={**os.environ, "OCEDA_SPOOL": str(SPOOL)},
                                    stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1)
        except OSError as e:
            log(f"cannot start {binary}: {e} - build it with `make` in {binary.parent}")
            stop.wait(delay)
            delay = min(30, delay * 2)
            continue
        log("capture program started, pid", proc.pid)
        reader_done = threading.Event()

        def pump():
            for line in proc.stdout:
                line = line.rstrip()
                if line.startswith("FPS:"):
                    continue                                # one line every 2s is just noise
                log("[capture]", line)
                if line.startswith("captured "):
                    wake.set()                              # upload right away
            reader_done.set()
        threading.Thread(target=pump, daemon=True).start()
        while proc.poll() is None and not stop.is_set():
            stop.wait(0.5)
        if proc.poll() is None:
            proc.terminate()                                # SIGTERM: the program turns the LEDs off itself
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                proc.kill()
        reader_done.wait(1)
        if stop.is_set():
            break
        log(f"capture program exited ({proc.returncode}) - restarting in {delay}s")
        delay = 3 if time.time() - started > 60 else min(30, delay * 2)
        stop.wait(delay)


def heartbeat_loop(stop: threading.Event, args):
    res = "240x240" if args.native else f"{args.width}x{args.height}"
    while not stop.is_set():
        try:
            http("POST", "/api/device/heartbeat",
                 json.dumps({"firmware": "pi_client/1" + ("+native" if args.native else ""), "resolution": res}).encode(),
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
    ap.add_argument("--button-pin", type=int, default=int(os.getenv("OCEDA_BUTTON_PIN", 21)))  # BCM21 = physical pin 40, wire to GND
    ap.add_argument("--keyboard", action="store_true")
    ap.add_argument("--simulate", metavar="PATH")
    ap.add_argument("--native", nargs="?", const="", metavar="BIN",
                    help="run the C++ capture program (default: capture/oceda_capture next to this script, "
                         "or $OCEDA_CAPTURE_BIN) instead of using rpicam-still + gpiozero")
    ap.add_argument("--once", action="store_true", help="capture one frame immediately, flush, exit")
    ap.add_argument("--allow-queue", action="store_true",
                    help="only stay busy while capturing; accept the next press while the last shot uploads")
    ap.add_argument("--busy-timeout", type=int, default=int(os.getenv("OCEDA_BUSY_TIMEOUT", 90)),
                    help="max seconds the button stays locked waiting for an upload (frame stays queued after)")
    ap.add_argument("--sim-delay", type=float, default=1.5,
                    help="with --simulate: seconds the fake camera takes per shot (ignored with --once)")
    args = ap.parse_args()
    native_bin, args.native = args.native, args.native is not None
    if args.native and (args.simulate or args.keyboard or args.once):
        ap.error("--native can't be combined with --simulate / --keyboard / --once")

    SPOOL.mkdir(parents=True, exist_ok=True)
    stop, pressed, wake = threading.Event(), threading.Event(), threading.Event()
    busy = threading.Lock()   # held from an accepted press until its shot is captured (+ sent)

    def on_press():
        """Button or Enter. Atomic test-and-set, so a double press can never start two captures."""
        if busy.acquire(blocking=False):
            pressed.set()
        else:
            log("busy - press ignored")
    threading.Thread(target=flush_spool, args=(stop, wake), daemon=True).start()
    threading.Thread(target=heartbeat_loop, args=(stop, args), daemon=True).start()

    if args.native:
        binary = Path(native_bin or os.getenv("OCEDA_CAPTURE_BIN")
                      or Path(__file__).resolve().parent / "capture" / "oceda_capture")
        threading.Thread(target=run_native, args=(stop, wake, binary), daemon=True).start()
        log(f"native mode - {binary} owns camera + button. server={SERVER}")
        try:
            while True:
                time.sleep(3600)
        except KeyboardInterrupt:
            stop.set()
            time.sleep(1)                                   # let the supervisor stop the program (LEDs off)
            return

    button = None
    if not args.keyboard and not args.once:
        try:
            from gpiozero import Button
            button = Button(args.button_pin, pull_up=True, bounce_time=0.08)
            button.when_pressed = on_press
            log(f"ready - press the button (GPIO{args.button_pin}). server={SERVER}")
        except Exception as e:
            log("GPIO button unavailable (%s) - falling back to keyboard" % e)
            args.keyboard = True
    if args.keyboard:
        def reader():
            for _ in sys.stdin:
                on_press()
        threading.Thread(target=reader, daemon=True).start()
        log("ready - press Enter to capture. server=" + SERVER)
    if args.once:
        on_press()

    try:
        while True:
            pressed.wait()
            pressed.clear()
            try:
                cap_id = uuid.uuid4().hex
                tmp = SPOOL / (cap_id + ".part")
                final = None
                if capture_frame(args, tmp):
                    final = tmp.with_suffix(".jpg")
                    tmp.rename(final)                       # appears in spool only when complete
                    log("captured", final.name)
                    wake.set()                              # uploader thread sends it right away
                if args.once:
                    deadline = time.time() + 90
                    while list(SPOOL.glob("*.jpg")) and time.time() < deadline:
                        time.sleep(0.3)
                    break
                if final and not args.allow_queue:
                    # stay busy until this frame is sent (the uploader removes it, or renames it
                    # to .rejected), so presses can't stack up behind a slow or offline link
                    deadline = time.time() + args.busy_timeout
                    while final.exists() and time.time() < deadline:
                        time.sleep(0.2)
                    if final.exists():
                        log(f"still not sent after {args.busy_timeout}s - button re-enabled, frame stays queued")
            finally:
                busy.release()
            log("ready")
    except KeyboardInterrupt:
        pass
    finally:
        stop.set()


if __name__ == "__main__":
    main()
