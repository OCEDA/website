# OCEDA backend (prototype)

Starlette + SQLite + ONNX Runtime. No Docker, no external services. ~1,100 lines including the Pi client and tests.

```
Raspberry Pi ──HTTP POST (JPEG)──▶ backend ──SSE push──▶ web app
 (button → camera)                    │  ├─ SQLite (users, exams, captures, results)
                                      │  ├─ data/captures, data/heatmaps
                                      │  ├─ ONNX model (ResNet / YOLO)  or MOCK
                                      │  └─ email (SMTP or data/outbox/*.eml)
```

## Run

```bash
cd backend
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8000      # 0.0.0.0 so the Pi can reach it
python tests/smoke_test.py                           # optional: full end-to-end check
```

First start seeds a demo doctor `dr.sari@oceda.local` / `oceda123` and a demo device token
`oceda-dev-device-token`. **Change both** (`.env.example`, or `python -m app.manage ...`).
Until you add `models/model.onnx` the AI is a **mock** - every result carries `"mock": true`
and the email says so, so fake output can't be mistaken for a real reading.

## Your flow → endpoints

| Flow step | Endpoint |
|---|---|
| Login | `POST /api/auth/login` `{email,password}` → `{token,user}` (also `/register`, `/me`, `/logout`) |
| Dashboard | `GET /api/exams` (recent sessions + result), `GET /api/device/status` (header chips) |
| Start exam / patient info | `POST /api/exams` `{patient:{id,name,dob,ear,notes}}` → `{id:"SES-261010-001",...}` |
| Press capture → transmitted → backend receives | Pi: `POST /api/device/captures` (below) |
| Web app receives image / "Captures ready" | `GET /api/exams/{id}/events` (SSE: `snapshot`,`capture`,`selected`,`analyzing`,`result`) |
| Browse / select capture | `GET /api/exams/{id}` (captures + quality hint), `PUT /api/exams/{id}/selection` `{capture_id}` |
| Analyze this capture | `POST /api/exams/{id}/analyze` → `{classification,confidence,heatmap_url,...}` |
| Display result / email | result JSON; email (original + heatmap) is sent right after the response |

Auth: `Authorization: Bearer <token>`. `<img>` and `EventSource` can't send headers, so those
GET routes also accept `?token=<token>`. Errors are `{"error": "..."}`.

## Raspberry Pi → server protocol

Plain HTTP POST of the raw JPEG. Chosen because the Zero W is a single-core ARMv6 on 2.4 GHz Wi-Fi:
no websocket/MQTT stack needed, works with stdlib Python on every Pi OS, and retries are trivial.
Real-time is only needed server→browser, which SSE covers.

```
POST /api/device/captures
X-Device-Token: <secret>             required
X-Capture-Id:   <uuid>               client-generated; resending the same id is a no-op (safe retries)
X-Checksum:     <sha256 of body>     optional; 422 on mismatch
Content-Type:   image/jpeg           body = the JPEG bytes
→ 201 {"duplicate":false,"capture":{id,index,width,height,quality,url}}
  200 duplicate | 401 bad token | 409 no open exam | 413 >15MB | 422 not a decodable JPEG
```

The frame is attached to the doctor's **most recent open examination** (so the doctor must press
"Start exam" first). `device/pi_client.py` spools every shot to disk, uploads from one background
thread with 3→60 s backoff, drops only on 4xx rejections, and sends a heartbeat every 10 s.

**On the Pi** (Zero W or 3):
```bash
scp device/pi_client.py pi@raspberrypi.local:~/oceda/
OCEDA_SERVER=http://<server-lan-ip>:8000 OCEDA_DEVICE_TOKEN=... python3 ~/oceda/pi_client.py
```
- Camera app is auto-detected: `rpicam-still` (Bookworm) → `libcamera-still` (Bullseye) → `raspistill` (legacy).
- Button: GPIO17 (physical pin 11) to GND; `--button-pin` to change; `--keyboard` = press Enter instead.
- Default 3280×2464 (IMX219 full-res, ~2-4 MB). On weak Wi-Fi: `OCEDA_WIDTH=1640 OCEDA_HEIGHT=1232`.
- Autostart: `device/oceda-device.service`.
- No inference on the Pi - the Zero W is too weak and can't run onnxruntime; it only captures and ships.

## "Pick the best frame" (dynamic exam data)

Each upload is decoded and scored: Laplacian-variance sharpness + exposure → `quality.score` 0-100,
and `recommended_capture_id` is the top score. It's **only a hint** to sort/badge thumbnails; the
doctor's `PUT .../selection` is what counts. The score is a cheap heuristic - tune
`ai.image_quality()` against real otoscope frames (specular glare and wax can fool it).

## AI inference

`app/ai.py` is the one file to edit. Export your model to ONNX and put it at `models/model.onnx`:

| | ResNet (classifier) | YOLO (YOLOv8 detect export) |
|---|---|---|
| env | `OCEDA_MODEL_KIND=resnet` | `OCEDA_MODEL_KIND=yolo` |
| preprocess | RGB, resize (squash) to 224², /255, ImageNet mean/std, NCHW float32 | RGB, letterbox to 640² (pad 114), /255, NCHW float32 |
| output used | `[1,C]` logits or probs (softmax applied if needed; 1 output = sigmoid) | `[1,4+C,N]` → conf filter + NMS |
| heatmap | 2nd ONNX output as CAM if present, else occlusion sensitivity (7×7, any model) | detection boxes as soft blobs |
| label | argmax of `OCEDA_LABELS` | class of best box; no box ⇒ `LABELS[0]` ("Normal") |

Match what you trained with: `OCEDA_INPUT_SIZE`, `OCEDA_NORM` (`none` for plain /255), `OCEDA_LABELS` order.
If you trained with center-crop instead of squash, change `preprocess_classifier`.
For a nicer heatmap, export Grad-CAM/CAM as a second ONNX output (`[1,1,h,w]` or `[1,C,h,w]`).

`python tools/make_dummy_onnx.py models/model.onnx` writes a meaningless 2-class model, useful for
checking the plumbing before the real one exists.

## Hooking up the frontend

The frontend talks to this backend through `frontend/src/api.ts` (same-origin `/api`, proxied by Vite to
`http://localhost:8000`; override with `VITE_API_URL` / `VITE_PROXY_TARGET`).

```bash
# terminal 1
cd backend && uvicorn app.main:app --host 0.0.0.0 --port 8000
# terminal 2
cd frontend && npm install && npm run dev        # http://localhost:5173
# terminal 3 (no hardware yet): pretend to be the Pi - press Enter to "capture"
python3 backend/device/pi_client.py --keyboard --simulate some.jpg      # OCEDA_SERVER defaults to :8000
```
Log in with the demo account, **Start New Examination**, then trigger captures from the Pi - they appear
live on the Capture screen. The Pi must talk to the backend directly (port 8000), not through Vite.

## Known limits (prototype)

- Hardware path (camera/GPIO) is untested here - it was exercised only with `--simulate`.
  Everything else is covered by `tests/smoke_test.py`. The onnxruntime path was checked with the dummy model only; the YOLO decoder is unit-tested on synthetic tensors, not a real YOLO export.
- Plain HTTP and a static device token: fine on a clinic LAN for a demo; put TLS in front before real use.
- Patient names are in the result email and stored unencrypted. Real patient data needs proper consent/compliance work.
- SSE bus is in-memory: run a single worker.
- Sessions live 12 h; no rate limiting, no password reset.
