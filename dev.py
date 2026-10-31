#!/usr/bin/env python3
"""Run the whole OCEDA stack for local development with one command:

    python dev.py

First run it creates backend/.venv, installs the Python and npm dependencies, then starts
  - backend  (uvicorn, port 8000, reachable from your LAN so the Raspberry Pi can upload)
  - frontend (Vite,    port 5173, proxies /api to the backend)
Ctrl+C stops both. Only needs Python 3.10+ and Node.js; nothing else to install by hand.
"""
import os
import shutil
import signal
import socket
import subprocess
import sys
import threading
import time
import venv
from pathlib import Path

ROOT = Path(__file__).resolve().parent
BACKEND = ROOT / "backend"
FRONTEND = ROOT / "frontend"
VENV = BACKEND / ".venv"
STAMP = VENV / ".requirements-installed"
IS_WIN = os.name == "nt"
COLORS = {"backend": "\033[36m", "frontend": "\033[35m"}


def venv_python() -> Path:
    return VENV / ("Scripts/python.exe" if IS_WIN else "bin/python")


def run(cmd, cwd):
    print("$", " ".join(map(str, cmd)), flush=True)
    subprocess.run(cmd, cwd=cwd, check=True)


def ensure_backend():
    if not venv_python().exists():
        print("Creating backend/.venv ...", flush=True)
        venv.create(VENV, with_pip=True)
    req = BACKEND / "requirements.txt"
    if not STAMP.exists() or STAMP.stat().st_mtime < req.stat().st_mtime:
        run([venv_python(), "-m", "pip", "install", "-r", req], BACKEND)
        STAMP.touch()


def ensure_frontend():
    npm = shutil.which("npm")
    if not npm:
        sys.exit("npm not found - install Node.js 20.19+ or 22.12+ from https://nodejs.org")
    if not (FRONTEND / "node_modules").exists():
        run([npm, "install"], FRONTEND)
    return npm


def lan_ip() -> str:
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:  # UDP "connect" sends nothing; it just asks the OS which interface it would use
        s.connect(("10.255.255.255", 1))
        return s.getsockname()[0]
    except OSError:
        return "<this-machine-ip>"
    finally:
        s.close()


def spawn(name, cmd, cwd):
    kw = {} if IS_WIN else {"start_new_session": True}  # own process group so we can kill the whole tree
    env = {**os.environ, "PYTHONUNBUFFERED": "1", "FORCE_COLOR": "1"}
    p = subprocess.Popen(cmd, cwd=cwd, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                         text=True, bufsize=1, **kw)

    def pump():
        tag = f"{COLORS[name]}[{name:<8}]\033[0m"
        for line in p.stdout:
            print(f"{tag} {line.rstrip()}", flush=True)

    threading.Thread(target=pump, daemon=True).start()
    return p


def _signal_group(p, sig):
    try:
        os.killpg(p.pid, sig)
    except (ProcessLookupError, PermissionError):
        pass


def stop_all(procs):
    """Stop every server and everything it spawned. Signals all at once so they shut down in
    parallel; anything still alive after 8 s (or on a second Ctrl+C) is force-killed."""
    print("\nStopping ... (Ctrl+C again to force)", flush=True)
    for p in procs:
        if IS_WIN:
            if p.poll() is None:
                p.terminate()
        else:
            _signal_group(p, signal.SIGTERM)  # also reaches children of an already-exited server
    try:
        deadline = time.monotonic() + 8
        for p in procs:
            p.wait(timeout=max(0.1, deadline - time.monotonic()))
    except (subprocess.TimeoutExpired, KeyboardInterrupt):
        for p in procs:
            if IS_WIN:
                p.kill()
            else:
                _signal_group(p, signal.SIGKILL)
        for p in procs:
            p.wait()


def main():
    ensure_backend()
    npm = ensure_frontend()
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))  # `kill` / closed terminal also stops the servers
    procs = {
        "backend": spawn("backend", [venv_python(), "-m", "uvicorn", "app.main:app",
                                     "--host", "0.0.0.0", "--port", "8000",
                                     "--reload",
                                     # open SSE streams would otherwise stall Ctrl+C
                                     "--timeout-graceful-shutdown", "3"], BACKEND),
        "frontend": spawn("frontend", [npm, "run", "dev"], FRONTEND),
    }
    print(f"\n  App:     http://localhost:5173\n  Backend: http://localhost:8000/api/health"
          f"\n  Pi uses: OCEDA_SERVER=http://{lan_ip()}:8000\n  Ctrl+C to stop.\n", flush=True)
    code = 0
    try:
        while True:
            for name, p in procs.items():
                if p.poll() is not None:
                    print(f"\n{name} exited with code {p.returncode}; shutting down.", flush=True)
                    code = p.returncode or 1
                    raise SystemExit(code)
            threading.Event().wait(0.5)
    except (KeyboardInterrupt, SystemExit):
        pass
    finally:
        stop_all(list(procs.values()))
    return code


if __name__ == "__main__":
    sys.exit(main())
