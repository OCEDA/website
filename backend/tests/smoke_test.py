"""End-to-end smoke test (no pytest needed):  python tests/smoke_test.py
Starts the real server on a temp DB, drives it like the web app, and uses device/pi_client.py
in --simulate mode as the Raspberry Pi."""
import hashlib
import json
import os
import socket
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
tmp = Path(tempfile.mkdtemp(prefix="oceda-test-"))
os.environ.update(OCEDA_DATA_DIR=str(tmp / "data"), OCEDA_MODEL=str(tmp / "no-model.onnx"))
sys.path.insert(0, str(ROOT))

import numpy as np                      # noqa: E402
import requests                         # noqa: E402
import uvicorn                          # noqa: E402
from PIL import Image, ImageFilter      # noqa: E402

from app import ai                      # noqa: E402
from app.main import app                # noqa: E402

ok_count = 0


def check(cond, msg):
    global ok_count
    if not cond:
        raise AssertionError(msg)
    ok_count += 1
    print("  ok  ", msg)


# ── unit checks: preprocessing / postprocessing ──
def test_units():
    print("units")
    img = Image.new("RGB", (400, 300), (255, 0, 0))
    x = ai.preprocess_classifier(img, 224, "imagenet")
    check(x.shape == (1, 3, 224, 224) and x.dtype == np.float32, "resnet tensor is float32 [1,3,224,224]")
    check(abs(x[0, 0, 0, 0] - (1 - 0.485) / 0.229) < 1e-4, "resnet ImageNet normalisation (R channel)")
    check(abs(x[0, 1, 0, 0] - (0 - 0.456) / 0.224) < 1e-4, "resnet ImageNet normalisation (G channel)")
    y, (s, px, py) = ai.preprocess_yolo(img, 640)
    check(y.shape == (1, 3, 640, 640) and abs(s - 1.6) < 1e-6 and (px, py) == (0, 80), "yolo letterbox 400x300 -> scale 1.6, pad (0,80)")
    check(abs(y[0, 0, 0, 0] - 114 / 255) < 1e-6 and y[0, 0, 320, 320] == 1.0, "yolo pad colour 114 + content /255")
    p = ai.to_probs(np.array([[2.0, 0.0]]))
    check(abs(p.sum() - 1) < 1e-9 and p[0] > p[1], "softmax on logits")
    check(abs(ai.to_probs(np.array([0.0]))[1] - 0.5) < 1e-9, "single sigmoid output -> 2 probs")
    # fake YOLOv8 output [1, 4+2, N]: two overlapping boxes (NMS keeps 1) + one low-confidence box
    out = np.zeros((1, 6, 3), np.float32)
    out[0, :, 0] = [320, 320, 100, 100, 0.1, 0.9]
    out[0, :, 1] = [322, 322, 100, 100, 0.1, 0.8]
    out[0, :, 2] = [50, 50, 20, 20, 0.1, 0.05]
    dets = ai.decode_yolo(out, 2, 0.25, 0.45)
    check(len(dets) == 1 and dets[0][5] == 1 and abs(dets[0][4] - 0.9) < 1e-6, "yolo decode: NMS + conf filter + class id")
    heat = ai.boxes_to_heat(dets, (1.0, 0, 0), 640, 640)
    check(heat.max() > 0.8 and heat[0, 0] < 0.01, "yolo boxes -> heat peaks at box centre")


# ── image fixtures ──
def make_jpegs(d: Path):
    rng = np.random.default_rng(1)
    base = Image.fromarray((rng.random((60, 80, 3)) * 255).astype(np.uint8)).resize((1280, 960), Image.NEAREST)
    base = base.filter(ImageFilter.GaussianBlur(1.2))                      # sharp-ish texture
    sharp = base
    blurry = base.filter(ImageFilter.GaussianBlur(14))
    dark = Image.eval(base, lambda v: v // 8)
    for name, im in (("1_blurry", blurry), ("2_dark", dark), ("3_sharp", sharp)):
        im.save(d / f"{name}.jpg", quality=90)


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def main():
    test_units()
    imgs = tmp / "imgs"; imgs.mkdir(); make_jpegs(imgs)
    port = free_port()
    base = f"http://127.0.0.1:{port}"
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning"))
    threading.Thread(target=server.run, daemon=True).start()
    for _ in range(100):
        try:
            requests.get(base + "/api/health", timeout=1); break
        except Exception:
            time.sleep(0.1)

    print("auth")
    r = requests.post(base + "/api/auth/login", json={"email": "dr.sari@oceda.local", "password": "nope"})
    check(r.status_code == 401, "wrong password -> 401")
    check(requests.get(base + "/api/exams").status_code == 401, "no token -> 401")
    r = requests.post(base + "/api/auth/login", json={"email": "dr.sari@oceda.local", "password": "oceda123"})
    check(r.status_code == 200 and r.json()["token"], "demo login works")
    H = {"Authorization": "Bearer " + r.json()["token"]}
    tok = r.json()["token"]
    check(requests.get(base + "/api/auth/me", headers=H).json()["name"] == "Dr. Dewi Sari", "/me returns the user")
    r = requests.post(base + "/api/auth/register", json={"email": "b@x.org", "password": "secret1", "name": "B"})
    check(r.status_code == 201, "register works")
    H2 = {"Authorization": "Bearer " + r.json()["token"]}

    print("device -> server")
    DEV = {"X-Device-Token": "oceda-dev-device-token"}
    jpg = (imgs / "3_sharp.jpg").read_bytes()
    check(requests.post(base + "/api/device/captures", data=jpg, headers={"X-Device-Token": "bad"}).status_code == 401, "bad device token -> 401")
    r = requests.post(base + "/api/device/captures", data=jpg, headers=DEV)
    check(r.status_code == 409, "upload with no open examination -> 409")

    r = requests.post(base + "/api/exams", headers=H, json={"patient": {"id": "PT-0001", "name": "Budi", "dob": "1990-01-01", "ear": "Left", "notes": ""}})
    check(r.status_code == 201 and r.json()["id"].startswith("SES-"), "create examination")
    eid = r.json()["id"]
    check(requests.post(base + "/api/exams", headers=H, json={"patient": {"name": "", "ear": "Up"}}).status_code == 422, "validation: bad patient -> 422")

    events = []
    def sse():
        with requests.get(f"{base}/api/exams/{eid}/events?token={tok}", stream=True, timeout=60) as resp:
            ev = None
            for line in resp.iter_lines(decode_unicode=True):
                if line.startswith("event:"): ev = line[6:].strip()
                elif line.startswith("data:"): events.append((ev, json.loads(line[5:])))
    threading.Thread(target=sse, daemon=True).start()
    time.sleep(0.5)

    env = {**os.environ, "OCEDA_SERVER": base, "OCEDA_SPOOL": str(tmp / "spool")}
    for f in sorted(imgs.glob("*.jpg")):   # three button presses on the "Pi" (blurry, dark, sharp)
        p = subprocess.run([sys.executable, str(ROOT / "device" / "pi_client.py"), "--simulate", str(f), "--once"],
                           env=env, capture_output=True, text=True, timeout=60)
        check("uploaded" in p.stdout, "pi_client captured + uploaded: " + p.stdout.strip().splitlines()[-1][9:60])
    time.sleep(0.5)
    names = [e for e, _ in events]
    check(names[0] == "snapshot" and names.count("capture") == 3, f"web app got live SSE events {names}")

    print("dynamic examination data")
    d = requests.get(f"{base}/api/exams/{eid}", headers=H).json()
    caps = d["captures"]
    check([c["index"] for c in caps] == [1, 2, 3] and caps[0]["width"] == 1280, "3 captures stored with index + resolution")
    by = {c["index"]: c["quality"]["score"] for c in caps}
    check(by[3] > by[1] and by[3] > by[2], f"quality hint ranks sharp frame highest {by}")
    check(d["recommended_capture_id"] == caps[2]["id"], "recommended_capture_id = sharpest (hint only)")
    img = requests.get(base + caps[0]["url"] + "?token=" + tok)
    check(img.status_code == 200 and img.content[:2] == b"\xff\xd8", "capture image served (token via query for <img>)")
    check(requests.get(base + caps[0]["url"], headers=H2).status_code == 404, "other user cannot see the image")
    check(requests.get(f"{base}/api/exams/{eid}", headers=H2).status_code == 404, "other user cannot see the exam")
    check(requests.post(f"{base}/api/exams/{eid}/analyze", headers=H).status_code == 409, "analyze before selecting -> 409")
    r = requests.put(f"{base}/api/exams/{eid}/selection", headers=H, json={"capture_id": caps[1]["id"]})
    check(r.status_code == 200, "doctor selects capture 2")
    r = requests.put(f"{base}/api/exams/{eid}/selection", headers=H, json={"capture_id": caps[2]["id"]})
    check(r.json()["selected_capture_id"] == caps[2]["id"], "doctor changes mind -> capture 3")
    check(requests.put(f"{base}/api/exams/{eid}/selection", headers=H, json={"capture_id": "nope"}).status_code == 422, "foreign capture id rejected")

    print("idempotency / integrity")
    r = requests.post(base + "/api/device/captures", data=jpg, headers={**DEV, "X-Capture-Id": caps[0]["id"]})
    check(r.json()["duplicate"] is True and len(requests.get(f"{base}/api/exams/{eid}", headers=H).json()["captures"]) == 3, "retry with same X-Capture-Id is a no-op")
    r = requests.post(base + "/api/device/captures", data=jpg, headers={**DEV, "X-Checksum": "0" * 64})
    check(r.status_code == 422, "checksum mismatch -> 422")
    r = requests.post(base + "/api/device/captures", data=b"hello not a jpeg", headers=DEV)
    check(r.status_code == 422, "non-JPEG -> 422")
    r = requests.post(base + "/api/device/captures", data=jpg[:3000], headers=DEV)
    check(r.status_code == 422, "truncated JPEG -> 422")

    print("AI + email")
    r = requests.post(f"{base}/api/exams/{eid}/analyze", headers=H)
    res = r.json()
    check(r.status_code == 200 and res["classification"] in ("Normal", "Abnormal") and 0 < res["confidence"] <= 100, f"analyze -> {res['classification']} {res['confidence']}%")
    check(res["mock"] is True, "result is flagged mock (no model file)")
    r = requests.get(base + res["heatmap_url"] + "?token=" + tok)
    check(r.status_code == 200 and r.content[:2] == b"\xff\xd8", "heatmap JPEG served")
    (tmp / "heatmap.jpg").write_bytes(r.content)
    time.sleep(1.0)
    eml = tmp / "data" / "outbox" / f"{eid}.eml"
    check(eml.exists() and b"heatmap.jpg" in eml.read_bytes() and b"original.jpg" in eml.read_bytes(), "email with original + heatmap written to outbox")
    check(requests.get(f"{base}/api/exams/{eid}", headers=H).json()["result"]["email"].startswith("saved"), "email status recorded")
    check("result" in [e for e, _ in events], "SSE pushed the result")
    r = requests.post(base + "/api/device/captures", data=jpg, headers=DEV)
    check(r.status_code == 409, "finished exam no longer accepts frames")

    print("device status")
    requests.post(base + "/api/device/heartbeat", headers=DEV, json={"battery": 78})
    s = requests.get(base + "/api/device/status", headers=H).json()
    check(s["connected"] and s["battery"] == 78, f"device status {s['name']} connected, battery 78")
    lst = requests.get(base + "/api/exams", headers=H).json()
    check(lst[0]["id"] == eid and lst[0]["result"]["classification"] == res["classification"], "dashboard list shows the result")

    print(f"\nALL {ok_count} CHECKS PASSED  (artifacts in {tmp})")


if __name__ == "__main__":
    main()
