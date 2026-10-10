"""Passwords (scrypt), opaque session tokens for the web app, static tokens for devices."""
import hmac
import hashlib
import secrets
from datetime import datetime, timedelta, timezone

from starlette.exceptions import HTTPException

from . import config, db


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    h = hashlib.scrypt(password.encode(), salt=salt, n=2**14, r=8, p=1)
    return f"scrypt${salt.hex()}${h.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        _, salt, h = stored.split("$")
        cand = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=2**14, r=8, p=1)
    except ValueError:
        return False
    return hmac.compare_digest(cand.hex(), h)


def create_user(email: str, password: str, name: str) -> int:
    with db.conn() as c:
        cur = c.execute(
            "INSERT INTO users(email,name,pw_hash,created_at) VALUES(?,?,?,?)",
            (email.lower().strip(), name.strip(), hash_password(password), db.now()))
        return cur.lastrowid


def create_device(user_id: int, name: str, token: str) -> int:
    with db.conn() as c:
        cur = c.execute("INSERT INTO devices(user_id,name,token_hash) VALUES(?,?,?)",
                        (user_id, name, db.sha(token)))
        return cur.lastrowid


def login(email: str, password: str):
    with db.conn() as c:
        u = c.execute("SELECT * FROM users WHERE email=?", (email.lower().strip(),)).fetchone()
        if not u or not verify_password(password, u["pw_hash"]):
            return None
        token = secrets.token_urlsafe(32)
        exp = (datetime.now(timezone.utc) + timedelta(hours=config.SESSION_HOURS)).isoformat(timespec="seconds")
        c.execute("INSERT INTO sessions VALUES(?,?,?)", (db.sha(token), u["id"], exp))
        return token, u


def logout(token: str):
    with db.conn() as c:
        c.execute("DELETE FROM sessions WHERE token_hash=?", (db.sha(token),))


def _bearer(request) -> str:
    h = request.headers.get("authorization", "")
    if h.lower().startswith("bearer "):
        return h[7:].strip()
    # <img src> and EventSource cannot send headers, so allow ?token= as well
    return request.query_params.get("token", "")


def bearer_token(request) -> str:
    return _bearer(request)


def current_user(request):
    token = _bearer(request)
    if token:
        with db.conn() as c:
            row = c.execute(
                "SELECT u.* , s.expires_at FROM sessions s JOIN users u ON u.id=s.user_id "
                "WHERE s.token_hash=?", (db.sha(token),)).fetchone()
        if row and row["expires_at"] > db.now():
            return row
    raise HTTPException(401, "not authenticated")


def current_device(request):
    token = request.headers.get("x-device-token", "")
    if token:
        with db.conn() as c:
            row = c.execute("SELECT * FROM devices WHERE token_hash=?", (db.sha(token),)).fetchone()
        if row:
            return row
    raise HTTPException(401, "invalid device token")


def seed_demo():
    """First run: create a demo doctor + a demo device so the system works immediately."""
    with db.conn() as c:
        if c.execute("SELECT 1 FROM users LIMIT 1").fetchone():
            return
    uid = create_user(config.DEMO_EMAIL, config.DEMO_PASSWORD, config.DEMO_NAME)
    create_device(uid, "OCEDA Pi Zero W", config.DEMO_DEVICE_TOKEN)
