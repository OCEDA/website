"""SQLite helpers + schema. One short-lived connection per call keeps threading trivial."""
import hashlib
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone

from . import config

SCHEMA = """
CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
  pw_hash TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(
  token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id),
  expires_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS devices(
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id),
  name TEXT NOT NULL, token_hash TEXT UNIQUE NOT NULL,
  last_seen TEXT, battery INTEGER, resolution TEXT, firmware TEXT);
CREATE TABLE IF NOT EXISTS exams(
  id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id),
  patient_id TEXT NOT NULL, patient_name TEXT NOT NULL, dob TEXT, ear TEXT NOT NULL,
  notes TEXT, status TEXT NOT NULL DEFAULT 'open',      -- open | analyzed
  selected_capture_id TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS captures(
  id TEXT PRIMARY KEY, exam_id TEXT NOT NULL REFERENCES exams(id), idx INTEGER NOT NULL,
  path TEXT NOT NULL, width INTEGER, height INTEGER, bytes INTEGER,
  sharpness REAL, brightness REAL, score REAL, device_id INTEGER, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS results(
  exam_id TEXT PRIMARY KEY REFERENCES exams(id), capture_id TEXT NOT NULL,
  label TEXT NOT NULL, confidence REAL NOT NULL, probs TEXT NOT NULL,
  heatmap_path TEXT NOT NULL, model TEXT NOT NULL, mock INTEGER NOT NULL,
  email_status TEXT, created_at TEXT NOT NULL,
  segmentation_overlay_path TEXT, segmentation_mask_path TEXT, segmentation_evidence TEXT,
  segmentation_mock INTEGER);
"""


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def sha(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()


@contextmanager
def conn():
    c = sqlite3.connect(config.DB_PATH, timeout=10)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA foreign_keys=ON")
    c.execute("PRAGMA journal_mode=WAL")
    try:
        yield c
        c.commit()
    except Exception:
        c.rollback()
        raise
    finally:
        c.close()


def init():
    config.ensure_dirs()
    with conn() as c:
        c.executescript(SCHEMA)
        # Migrations if new columns don't exist yet
        cols = [r[1] for r in c.execute("PRAGMA table_info(results)").fetchall()]
        if "segmentation_overlay_path" not in cols:
            c.execute("ALTER TABLE results ADD COLUMN segmentation_overlay_path TEXT")
        if "segmentation_mask_path" not in cols:
            c.execute("ALTER TABLE results ADD COLUMN segmentation_mask_path TEXT")
        if "segmentation_evidence" not in cols:
            c.execute("ALTER TABLE results ADD COLUMN segmentation_evidence TEXT")
        if "segmentation_mock" not in cols:
            c.execute("ALTER TABLE results ADD COLUMN segmentation_mock INTEGER")