"""OCEDA prototype backend. Run:  uvicorn app.main:app --host 0.0.0.0 --port 8000"""
import asyncio
import hashlib
import json
import logging
import re
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timedelta
from pathlib import Path
from PIL import Image

from starlette.applications import Starlette
from starlette.background import BackgroundTask
from starlette.concurrency import run_in_threadpool
from starlette.exceptions import HTTPException
from starlette.middleware import Middleware
from starlette.middleware.cors import CORSMiddleware
from starlette.responses import FileResponse, JSONResponse, StreamingResponse
from starlette.routing import Route

from . import ai, auth, config, db, mailer
from .events import bus

log = logging.getLogger("oceda")
CAPTURE_ID_RE = re.compile(r"^[A-Za-z0-9_-]{8,64}$")


# ───────────────────────── helpers ─────────────────────────
async def jbody(request) -> dict:
    try:
        data = await request.json()
    except Exception:
        raise HTTPException(400, "invalid JSON body")
    if not isinstance(data, dict):
        raise HTTPException(400, "JSON object expected")
    return data


def cap_json(r) -> dict:
    return {"id": r["id"], "exam_id": r["exam_id"], "index": r["idx"],
            "url": f"/api/captures/{r['id']}/image",
            "width": r["width"], "height": r["height"], "bytes": r["bytes"],
            "quality": {"sharpness": r["sharpness"], "brightness": r["brightness"], "score": r["score"]},
            "created_at": r["created_at"]}


def result_json(r) -> dict:
    r = dict(r)  # sqlite3.Row tidak punya .get()
    evidence = None
    if r.get("segmentation_evidence"):
        try:
            evidence = json.loads(r["segmentation_evidence"])
        except Exception:
            evidence = None

    return {"classification": r["label"], "confidence": r["confidence"],
            "probabilities": json.loads(r["probs"]),
            "capture_id": r["capture_id"],
            "original_url": f"/api/exams/{r['exam_id']}/cropped",
            "original_full_url": f"/api/captures/{r['capture_id']}/image",
            "heatmap_url": f"/api/exams/{r['exam_id']}/heatmap",
            "segmentation_overlay_url": f"/api/exams/{r['exam_id']}/segmentation/overlay" if r.get("segmentation_overlay_path") else None,
            "segmentation_mask_url": f"/api/exams/{r['exam_id']}/segmentation/mask" if r.get("segmentation_mask_path") else None,
            "segmentation_evidence": evidence,
            "segmentation_mock": bool(r.get("segmentation_mock")),
            "model": r["model"], "mock": bool(r["mock"]),
            "email": r["email_status"], "created_at": r["created_at"]}


def exam_json(c, e, detail=False) -> dict:
    res = c.execute("SELECT * FROM results WHERE exam_id=?", (e["id"],)).fetchone()
    caps = c.execute("SELECT * FROM captures WHERE exam_id=? ORDER BY idx", (e["id"],)).fetchall()
    out = {"id": e["id"], "status": e["status"], "created_at": e["created_at"],
           "patient": {"id": e["patient_id"], "name": e["patient_name"], "dob": e["dob"],
                       "ear": e["ear"], "notes": e["notes"]},
           "capture_count": len(caps), "selected_capture_id": e["selected_capture_id"],
           "result": result_json(res) if res else None}
    if detail:
        out["captures"] = [cap_json(r) for r in caps]
        # hint only - the doctor makes the final call via PUT /selection
        out["recommended_capture_id"] = max(caps, key=lambda r: r["score"] or 0)["id"] if caps else None
    return out


def get_exam(c, exam_id, user):
    e = c.execute("SELECT * FROM exams WHERE id=? AND user_id=?", (exam_id, user["id"])).fetchone()
    if not e:
        raise HTTPException(404, "examination not found")
    return e


def new_exam_id(c) -> str:
    prefix = "SES-" + datetime.now().strftime("%y%m%d")
    n = c.execute("SELECT COUNT(*) FROM exams WHERE id LIKE ?", (prefix + "-%",)).fetchone()[0]
    return f"{prefix}-{n + 1:03d}"


# ───────────────────────── auth ─────────────────────────
def _user_json(u):
    return {"id": u["id"], "email": u["email"], "name": u["name"]}


async def login(request):
    d = await jbody(request)
    res = await run_in_threadpool(auth.login, str(d.get("email", "")), str(d.get("password", "")))
    if not res:
        raise HTTPException(401, "invalid email or password")
    token, user = res
    return JSONResponse({"token": token, "user": _user_json(user)})


async def register(request):
    if not config.OPEN_SIGNUP:
        raise HTTPException(403, "signup disabled")
    d = await jbody(request)
    email, pw, name = str(d.get("email", "")).strip(), str(d.get("password", "")), str(d.get("name", "")).strip()
    if not re.match(r"^\S+@\S+\.\S+$", email) or len(pw) < 6 or not name:
        raise HTTPException(422, "need a valid email, a name and a password of 6+ characters")
    try:
        await run_in_threadpool(auth.create_user, email, pw, name)
    except Exception:
        raise HTTPException(409, "email already registered")
    token, user = await run_in_threadpool(auth.login, email, pw)
    return JSONResponse({"token": token, "user": _user_json(user)}, status_code=201)


async def me(request):
    return JSONResponse(_user_json(auth.current_user(request)))


async def logout(request):
    auth.current_user(request)
    auth.logout(auth.bearer_token(request))
    return JSONResponse({"ok": True})


# ───────────────────────── examinations (web app) ─────────────────────────
async def create_exam(request):
    user = auth.current_user(request)
    d = await jbody(request)
    p = d.get("patient", d)
    name, ear = str(p.get("name", "")).strip(), p.get("ear")
    if not name or ear not in ("Left", "Right"):
        raise HTTPException(422, "patient.name and patient.ear ('Left'|'Right') are required")
    with db.conn() as c:
        eid = new_exam_id(c)
        c.execute("INSERT INTO exams(id,user_id,patient_id,patient_name,dob,ear,notes,created_at) "
                  "VALUES(?,?,?,?,?,?,?,?)",
                  (eid, user["id"], str(p.get("id") or eid), name, p.get("dob"), ear,
                   p.get("notes") or "", db.now()))
        return JSONResponse(exam_json(c, get_exam(c, eid, user), detail=True), status_code=201)


async def list_exams(request):
    user = auth.current_user(request)
    with db.conn() as c:
        rows = c.execute("SELECT * FROM exams WHERE user_id=? ORDER BY created_at DESC, rowid DESC LIMIT 50",
                         (user["id"],)).fetchall()
        return JSONResponse([exam_json(c, e) for e in rows])


async def read_exam(request):
    user = auth.current_user(request)
    with db.conn() as c:
        return JSONResponse(exam_json(c, get_exam(c, request.path_params["exam_id"], user), detail=True))


async def select_capture(request):
    """Doctor manually picks the best-looking frame."""
    user = auth.current_user(request)
    eid = request.path_params["exam_id"]
    cid = (await jbody(request)).get("capture_id")
    with db.conn() as c:
        get_exam(c, eid, user)
        if not c.execute("SELECT 1 FROM captures WHERE id=? AND exam_id=?", (cid, eid)).fetchone():
            raise HTTPException(422, "capture does not belong to this examination")
        c.execute("UPDATE exams SET selected_capture_id=? WHERE id=?", (cid, eid))
    bus.publish(eid, "selected", {"capture_id": cid})
    return JSONResponse({"selected_capture_id": cid})


async def exam_events(request):
    """Server-Sent Events: snapshot first, then 'capture' / 'selected' / 'analyzing' / 'result' / 'error'."""
    user = auth.current_user(request)
    eid = request.path_params["exam_id"]
    with db.conn() as c:
        snapshot = exam_json(c, get_exam(c, eid, user), detail=True)

    async def stream():
        q = bus.subscribe(eid)       # subscribe before yielding the snapshot: no gap, no lost frame
        try:
            yield "retry: 3000\n\n"
            yield f"event: snapshot\ndata: {json.dumps(snapshot)}\n\n"
            while True:
                try:
                    event, data = await asyncio.wait_for(q.get(), timeout=15)
                except asyncio.TimeoutError:
                    yield ": ping\n\n"
                    continue
                yield f"event: {event}\ndata: {json.dumps(data)}\n\n"
        finally:
            bus.unsubscribe(eid, q)

    return StreamingResponse(stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


async def capture_image(request):
    user = auth.current_user(request)
    with db.conn() as c:
        r = c.execute("SELECT c.path FROM captures c JOIN exams e ON e.id=c.exam_id "
                      "WHERE c.id=? AND e.user_id=?", (request.path_params["capture_id"], user["id"])).fetchone()
    if not r:
        raise HTTPException(404, "capture not found")
    return FileResponse(r["path"], media_type="image/jpeg", headers={"Cache-Control": "private, max-age=3600"})


async def heatmap_image(request):
    user = auth.current_user(request)
    with db.conn() as c:
        e = get_exam(c, request.path_params["exam_id"], user)
        r = c.execute("SELECT heatmap_path FROM results WHERE exam_id=?", (e["id"],)).fetchone()
    if not r:
        raise HTTPException(404, "no result yet")
    return FileResponse(r["heatmap_path"], media_type="image/jpeg", headers={"Cache-Control": "no-cache"})


async def cropped_image(request):
    user = auth.current_user(request)
    with db.conn() as c:
        e = get_exam(c, request.path_params["exam_id"], user)
        r = c.execute("SELECT capture_id FROM results WHERE exam_id=?", (e["id"],)).fetchone()
    if not r:
        raise HTTPException(404, "no result yet")
    cpath = config.HEATMAP_DIR / f"{e['id']}_crop.jpg"
    if cpath.exists():
        return FileResponse(cpath, media_type="image/jpeg", headers={"Cache-Control": "no-cache"})
    # On-demand fallback: generate cropped image if missing
    with db.conn() as c:
        cap = c.execute("SELECT path FROM captures WHERE id=?", (r["capture_id"],)).fetchone()
    if cap and Path(cap["path"]).exists():
        try:
            img = ai.open_image(cap["path"])
            crop_img = ai.classifier_preprocessed_image(img)
            cpath.parent.mkdir(parents=True, exist_ok=True)
            crop_img.save(str(cpath), "JPEG", quality=95)
            return FileResponse(cpath, media_type="image/jpeg", headers={"Cache-Control": "no-cache"})
        except Exception as ex:
            log.warning("failed to crop capture: %s", ex)
            return FileResponse(cap["path"], media_type="image/jpeg")
    raise HTTPException(404, "image not found")


async def segmentation_overlay_image(request):
    user = auth.current_user(request)
    with db.conn() as c:
        e = get_exam(c, request.path_params["exam_id"], user)
        r = c.execute("SELECT segmentation_overlay_path FROM results WHERE exam_id=?", (e["id"],)).fetchone()
    if not r or not r["segmentation_overlay_path"] or not Path(r["segmentation_overlay_path"]).exists():
        raise HTTPException(404, "no segmentation overlay yet")
    return FileResponse(r["segmentation_overlay_path"], media_type="image/jpeg", headers={"Cache-Control": "no-cache"})


async def segmentation_mask_image(request):
    user = auth.current_user(request)
    with db.conn() as c:
        e = get_exam(c, request.path_params["exam_id"], user)
        r = c.execute("SELECT segmentation_mask_path FROM results WHERE exam_id=?", (e["id"],)).fetchone()
    if not r or not r["segmentation_mask_path"] or not Path(r["segmentation_mask_path"]).exists():
        raise HTTPException(404, "no segmentation mask yet")
    return FileResponse(r["segmentation_mask_path"], media_type="image/png", headers={"Cache-Control": "no-cache"})


# ───────────────────────── AI analysis ─────────────────────────
def _email_task(exam_id: str, to: str):
    with db.conn() as c:
        e = c.execute("SELECT * FROM exams WHERE id=?", (exam_id,)).fetchone()
        r = c.execute("SELECT * FROM results WHERE exam_id=?", (exam_id,)).fetchone()
        cap = c.execute("SELECT path FROM captures WHERE id=?", (r["capture_id"],)).fetchone()
    cpath = config.HEATMAP_DIR / f"{exam_id}_crop.jpg"
    orig_path = cpath if cpath.exists() else Path(cap["path"])
    seg_path = Path(r["segmentation_overlay_path"]) if r["segmentation_overlay_path"] else None
    if seg_path is not None and not seg_path.exists():
        seg_path = None
    try:
        status = mailer.send_result(
            to, dict(e), {"label": r["label"], "confidence": r["confidence"], "mock": bool(r["mock"])},
            orig_path, Path(r["heatmap_path"]), seg_path)
    except Exception as ex:  # never let email problems break the result
        log.exception("email failed")
        status = f"failed: {ex}"
    with db.conn() as c:
        c.execute("UPDATE results SET email_status=? WHERE exam_id=?", (status, exam_id))


async def analyze(request):
    user = auth.current_user(request)
    eid = request.path_params["exam_id"]
    body = {}
    if await request.body():
        body = await jbody(request)
    with db.conn() as c:
        e = get_exam(c, eid, user)
        cid = body.get("capture_id") or e["selected_capture_id"]
        cap = c.execute("SELECT * FROM captures WHERE id=? AND exam_id=?", (cid, eid)).fetchone() if cid else None
    if not cap:
        raise HTTPException(409, "select a capture first (PUT /api/exams/{id}/selection)")

    bus.publish(eid, "analyzing", {"capture_id": cap["id"]})
    try:
        res = await run_in_threadpool(ai.model.analyze, cap["path"])
    except Exception as ex:
        log.exception("inference failed")
        bus.publish(eid, "error", {"message": "analysis failed"})
        raise HTTPException(500, f"analysis failed: {ex}")

    hpath = config.HEATMAP_DIR / f"{eid}.jpg"
    hpath.write_bytes(res.pop("heatmap_jpeg"))
    cpath = config.HEATMAP_DIR / f"{eid}_crop.jpg"
    crop_bytes = res.pop("cropped_jpeg", None)
    if crop_bytes:
        cpath.write_bytes(crop_bytes)

    seg_overlay_bytes = res.pop("segmentation_overlay_jpeg", None)
    seg_mask_bytes = res.pop("segmentation_mask_png", None)
    seg_evidence = res.pop("segmentation_evidence", None)
    seg_mock = res.pop("segmentation_mock", False)

    seg_overlay_path = None
    seg_mask_path = None
    if seg_overlay_bytes:
        p_overlay = config.SEGMENTATION_DIR / f"{eid}_overlay.jpg"
        p_overlay.write_bytes(seg_overlay_bytes)
        seg_overlay_path = str(p_overlay)
    if seg_mask_bytes:
        p_mask = config.SEGMENTATION_DIR / f"{eid}_mask.png"
        p_mask.write_bytes(seg_mask_bytes)
        seg_mask_path = str(p_mask)

    with db.conn() as c:
        c.execute("INSERT OR REPLACE INTO results(exam_id,capture_id,label,confidence,probs,heatmap_path,"
                  "model,mock,email_status,created_at,segmentation_overlay_path,segmentation_mask_path,segmentation_evidence,"
                  "segmentation_mock) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                  (eid, cap["id"], res["label"], res["confidence"], json.dumps(res["probabilities"]),
                   str(hpath), res["model"], int(res["mock"]), "pending", db.now(),
                   seg_overlay_path, seg_mask_path, json.dumps(seg_evidence) if seg_evidence else None,
                   int(bool(seg_mock))))
        c.execute("UPDATE exams SET status='analyzed', selected_capture_id=? WHERE id=?", (cap["id"], eid))
        out = result_json(c.execute("SELECT * FROM results WHERE exam_id=?", (eid,)).fetchone())
    bus.publish(eid, "result", out)
    # email goes out after the response, so the UI shows the result immediately
    return JSONResponse(out, background=BackgroundTask(_email_task, eid, user["email"]))


# ───────────────────────── Raspberry Pi device ─────────────────────────
async def _read_body(request, limit: int) -> bytes:
    if int(request.headers.get("content-length") or 0) > limit:
        raise HTTPException(413, "image too large")
    buf = bytearray()
    async for chunk in request.stream():
        buf += chunk
        if len(buf) > limit:
            raise HTTPException(413, "image too large")
    return bytes(buf)


async def device_upload(request):
    """POST raw image/jpeg. Headers: X-Device-Token (required), X-Capture-Id (client uuid, makes retries
    idempotent), X-Checksum (sha256 hex of body, optional). Attaches the frame to the doctor's open exam."""
    dev = auth.current_device(request)
    cid = request.headers.get("x-capture-id") or uuid.uuid4().hex
    if not CAPTURE_ID_RE.match(cid):
        raise HTTPException(400, "bad X-Capture-Id")

    with db.conn() as c:
        dup = c.execute("SELECT * FROM captures WHERE id=?", (cid,)).fetchone()
        if dup:                                           # retry of a frame we already stored
            return JSONResponse({"duplicate": True, "capture": cap_json(dup)})
        exam = c.execute("SELECT id FROM exams WHERE user_id=? AND status='open' "
                         "ORDER BY created_at DESC, rowid DESC LIMIT 1", (dev["user_id"],)).fetchone()
    if not exam:
        raise HTTPException(409, "no active examination - start one in the web app first")

    data = await _read_body(request, config.MAX_UPLOAD_MB * 1024 * 1024)
    want = request.headers.get("x-checksum")
    if want and hashlib.sha256(data).hexdigest() != want.lower():
        raise HTTPException(422, "checksum mismatch - resend")
    try:
        info = await run_in_threadpool(ai.inspect_jpeg, data)
    except ValueError as ex:
        raise HTTPException(422, str(ex))

    eid = exam["id"]
    path = config.CAPTURE_DIR / eid / f"{cid}.jpg"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    with db.conn() as c:
        idx = c.execute("SELECT COUNT(*) FROM captures WHERE exam_id=?", (eid,)).fetchone()[0] + 1
        c.execute("INSERT INTO captures(id,exam_id,idx,path,width,height,bytes,sharpness,brightness,score,"
                  "device_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
                  (cid, eid, idx, str(path), info["width"], info["height"], len(data),
                   info["sharpness"], info["brightness"], info["score"], dev["id"], db.now()))
        c.execute("UPDATE devices SET last_seen=?, resolution=? WHERE id=?",
                  (db.now(), f"{info['width']}x{info['height']}", dev["id"]))
        cap = cap_json(c.execute("SELECT * FROM captures WHERE id=?", (cid,)).fetchone())
    bus.publish(eid, "capture", cap)
    return JSONResponse({"duplicate": False, "capture": cap}, status_code=201)


async def device_heartbeat(request):
    dev = auth.current_device(request)
    d = await jbody(request) if await request.body() else {}
    battery = d.get("battery")
    with db.conn() as c:
        c.execute("UPDATE devices SET last_seen=?, battery=?, resolution=COALESCE(?,resolution), firmware=? WHERE id=?",
                  (db.now(), battery if isinstance(battery, int) else None, d.get("resolution"),
                   d.get("firmware"), dev["id"]))
    return JSONResponse({"ok": True})


async def device_status(request):
    """For the header chips: connected / battery / resolution."""
    user = auth.current_user(request)
    with db.conn() as c:
        d = c.execute("SELECT * FROM devices WHERE user_id=? ORDER BY last_seen DESC LIMIT 1", (user["id"],)).fetchone()
    if not d:
        return JSONResponse({"registered": False, "connected": False})
    seen = d["last_seen"]
    online = bool(seen) and datetime.fromisoformat(seen) > datetime.fromisoformat(db.now()) - timedelta(
        seconds=config.DEVICE_ONLINE_SECONDS)
    return JSONResponse({"registered": True, "connected": online, "name": d["name"], "last_seen": seen,
                         "battery": d["battery"], "resolution": d["resolution"], "firmware": d["firmware"]})


async def health(request):
    return JSONResponse({"ok": True, "model": ai.model.name, "mock": ai.model.mock,
                         "segmentation_model": config.SEG_MODEL_PATH.name, "segmentation_mock": ai.model.seg_mock})


# ───────────────────────── app ─────────────────────────
async def http_error(request, exc):
    return JSONResponse({"error": exc.detail}, status_code=exc.status_code)


@asynccontextmanager
async def lifespan(app):
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(message)s")
    db.init()
    auth.seed_demo()
    log.info("model: %s", ai.model.name)
    if ai.model.mock:
        log.warning("no model at %s -> MOCK AI (results are fake)", config.MODEL_PATH)
    if ai.model.seg_mock:
        log.warning("no segmentation model at %s -> MOCK segmentation (results are fake)", config.SEG_MODEL_PATH)
    yield


routes = [
    Route("/api/health", health),
    Route("/api/auth/login", login, methods=["POST"]),
    Route("/api/auth/register", register, methods=["POST"]),
    Route("/api/auth/me", me),
    Route("/api/auth/logout", logout, methods=["POST"]),
    Route("/api/exams", create_exam, methods=["POST"]),
    Route("/api/exams", list_exams, methods=["GET"]),
    Route("/api/exams/{exam_id}", read_exam),
    Route("/api/exams/{exam_id}/events", exam_events),
    Route("/api/exams/{exam_id}/selection", select_capture, methods=["PUT"]),
    Route("/api/exams/{exam_id}/analyze", analyze, methods=["POST"]),
    Route("/api/exams/{exam_id}/heatmap", heatmap_image),
    Route("/api/exams/{exam_id}/cropped", cropped_image),
    Route("/api/exams/{exam_id}/segmentation/overlay", segmentation_overlay_image),
    Route("/api/exams/{exam_id}/segmentation/mask", segmentation_mask_image),
    Route("/api/captures/{capture_id}/image", capture_image),
    Route("/api/device/captures", device_upload, methods=["POST"]),
    Route("/api/device/heartbeat", device_heartbeat, methods=["POST"]),
    Route("/api/device/status", device_status),
]

app = Starlette(
    routes=routes, lifespan=lifespan,
    exception_handlers={HTTPException: http_error},
    middleware=[Middleware(CORSMiddleware, allow_origins=config.CORS_ORIGINS,
                           allow_methods=["*"], allow_headers=["*"])],
)