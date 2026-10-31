"""All settings come from environment variables (see .env.example).

If backend/.env exists it is loaded automatically, so there is nothing to `source` or `export`.
Real environment variables always win over the file.
"""
import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent


def _load_dotenv(path: Path) -> None:
    """Tiny .env reader (KEY=value, # comments, optional quotes) so we need no extra dependency."""
    if not path.is_file():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        if line.startswith("export "):
            line = line[len("export "):].lstrip()
        key, _, val = line.partition("=")
        key, val = key.strip(), val.strip()
        if len(val) >= 2 and val[0] == val[-1] and val[0] in "\"'":
            val = val[1:-1]
        else:
            val = val.split(" #")[0].strip()  # trailing inline comment
        if key and val:  # blank value -> keep the built-in default
            os.environ.setdefault(key, val)


_load_dotenv(BASE_DIR / ".env")


def _env(name, default):
    return os.getenv(name, default)


def _path(name, default: Path) -> Path:
    """Path setting; a relative value is taken relative to backend/, not to the shell's cwd."""
    p = Path(_env(name, str(default)))
    return p if p.is_absolute() else BASE_DIR / p


DATA_DIR = _path("OCEDA_DATA_DIR", BASE_DIR / "data")
DB_PATH = DATA_DIR / "oceda.db"
CAPTURE_DIR = DATA_DIR / "captures"
HEATMAP_DIR = DATA_DIR / "heatmaps"
OUTBOX_DIR = DATA_DIR / "outbox"  # .eml files land here when SMTP is not configured

# --- auth / seeding (prototype defaults - change them) ---
DEMO_EMAIL = _env("OCEDA_DEMO_EMAIL", "dr.sari@oceda.local")
DEMO_PASSWORD = _env("OCEDA_DEMO_PASSWORD", "oceda123")
DEMO_NAME = _env("OCEDA_DEMO_NAME", "Dr. Dewi Sari")
DEMO_DEVICE_TOKEN = _env("OCEDA_DEVICE_TOKEN", "oceda-dev-device-token")
OPEN_SIGNUP = _env("OCEDA_OPEN_SIGNUP", "1") == "1"
SESSION_HOURS = int(_env("OCEDA_SESSION_HOURS", "12"))
CORS_ORIGINS = [o.strip() for o in _env(
    "OCEDA_CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",") if o.strip()]

# --- device uploads ---
MAX_UPLOAD_MB = int(_env("OCEDA_MAX_UPLOAD_MB", "15"))
DEVICE_ONLINE_SECONDS = int(_env("OCEDA_DEVICE_ONLINE_SECONDS", "30"))

# --- AI ---
# No model file -> MOCK mode (random-but-deterministic output, clearly flagged "mock": true).
MODEL_PATH = _path("OCEDA_MODEL", BASE_DIR / "models" / "model.onnx")
MODEL_KIND = _env("OCEDA_MODEL_KIND", "resnet")          # resnet | yolo
LABELS = [s.strip() for s in _env("OCEDA_LABELS", "Normal,Abnormal").split(",")]
INPUT_SIZE = int(_env("OCEDA_INPUT_SIZE", "640" if MODEL_KIND == "yolo" else "224"))
NORM = _env("OCEDA_NORM", "none" if MODEL_KIND == "yolo" else "imagenet")  # imagenet | none
HEATMAP_MODE = _env("OCEDA_HEATMAP", "auto")             # auto | cam | occlusion
YOLO_CONF = float(_env("OCEDA_YOLO_CONF", "0.25"))
YOLO_IOU = float(_env("OCEDA_YOLO_IOU", "0.45"))

# --- email (leave SMTP_HOST empty to write .eml files to data/outbox instead) ---
SMTP_HOST = _env("OCEDA_SMTP_HOST", "")
SMTP_PORT = int(_env("OCEDA_SMTP_PORT", "587"))
SMTP_USER = _env("OCEDA_SMTP_USER", "")
SMTP_PASSWORD = _env("OCEDA_SMTP_PASSWORD", "")
SMTP_STARTTLS = _env("OCEDA_SMTP_STARTTLS", "1") == "1"
SMTP_FROM = _env("OCEDA_SMTP_FROM", "OCEDA <no-reply@oceda.local>")


def ensure_dirs():
    for d in (DATA_DIR, CAPTURE_DIR, HEATMAP_DIR, OUTBOX_DIR):
        d.mkdir(parents=True, exist_ok=True)
