# OCEDA

<p align="center">
  <b>AI-Assisted Otoscopy for Accessible Ear Examination</b>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white" alt="React" />
  <img src="https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Vite-8-646CFF?logo=vite&logoColor=white" alt="Vite" />
  <img src="https://img.shields.io/badge/Tailwind%20CSS-v4-06B6D4?logo=tailwindcss&logoColor=white" alt="Tailwind CSS" />
  <img src="https://img.shields.io/badge/Starlette-SQLite-009688?logo=python&logoColor=white" alt="Starlette + SQLite" />
  <img src="https://img.shields.io/badge/ONNX%20Runtime-AI-005CED?logo=onnx&logoColor=white" alt="ONNX Runtime" />
</p>

**OCEDA** helps non-specialist healthcare workers perform preliminary ear examinations. A portable otoscope built
around a Raspberry Pi captures ear images, a web app guides the examination, and an AI model classifies the selected
image and highlights the region that drove its decision.

- **Examination dashboard** - start sessions, see recent exams and live device status (connection, battery, resolution).
- **Patient information** - record patient details before a capture session.
- **Live capture** - frames pressed on the device appear in the browser immediately; each is scored for sharpness and
  exposure so the best frame is suggested (the clinician always makes the final pick).
- **AI result** - classification, confidence and a heatmap, also emailed (original + heatmap) after analysis.
- **Light/dark mode**, **English/Indonesian** UI, responsive layout.

## How it works

```
Raspberry Pi ──HTTP POST (JPEG)──▶ backend ──SSE push──▶ web app
 (button → camera)                    │  ├─ SQLite (users, exams, captures, results)
                                      │  ├─ data/captures, data/heatmaps
                                      │  ├─ ONNX model (ResNet / YOLO)  or MOCK
                                      │  └─ email (SMTP, or data/outbox/*.eml)
```

Clinician flow: **Login → Dashboard → Patient info → Capture → Select frame → AI analysis → Result + email.**

## Quick start

**Requirements:** Python 3.10+, Node.js 20.19+ or 22.12+ (required by Vite), npm.

```bash
python dev.py          # use `python3 dev.py` on macOS/Linux, `py dev.py` on Windows if needed
```

The first run creates `backend/.venv`, installs the Python and npm dependencies, then starts both servers. Later runs
start immediately. **Ctrl+C stops everything.**

| What | Where |
|---|---|
| Web app | http://localhost:5173 |
| Backend health check | http://localhost:8000/api/health |

Log in with the demo account **`dr.sari@oceda.local`** / **`oceda123`**, click **Start New Examination**, and fill in
the patient form.

> **Before real use:** change the demo password and device token (see [Configuration](#configuration)). The demo
> account is only created on the very first start, so set your values *before* that, or delete `backend/data/` to
> re-seed, or use `python -m app.manage` (below).

### No hardware yet? Pretend to be the Pi

In a second terminal, simulate the device with the sample JPEGs in `testimgs/` (press Enter to "capture"):

```bash
python backend/device/pi_client.py --keyboard --simulate testimgs
```

Shots show up live on the Capture screen. The fake camera takes 1.5 s per shot (`--sim-delay`); press Enter several times quickly to see the busy flag ignore all but the first. A frame is attached to the doctor's **most recent open exam**, so start an
exam in the web app first. (`testimgs/` holds generic placeholder photos, not ears - fine for testing the plumbing.)

### Running the two halves by hand

`dev.py` is only a convenience. Equivalent manual steps, in two terminals:

```bash
# terminal 1 - backend
cd backend
python -m venv .venv && source .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8000 --timeout-graceful-shutdown 3   # 0.0.0.0: the Pi must reach it

# terminal 2 - frontend
cd frontend
npm install
npm run dev
```

### Images look broken after "Download ZIP"?

The frontend images are stored with **Git LFS**, and GitHub's ZIP download only contains tiny pointer files. Clone
instead: `git lfs install && git clone <repo-url>` (or run `git lfs pull` in an existing clone).

## Repository layout

```
.
├── dev.py                 one-command local launcher (backend + frontend)
├── backend/
│   ├── app/               Starlette app: main.py (routes), ai.py (model), auth, db, mailer, config, manage
│   ├── device/            pi_client.py (runs on the Pi) + oceda-device.service (systemd)
│   │   └── capture/       oceda_capture.cpp - the real device program (camera, LCD preview, LEDs, button) + Makefile
│   ├── models/            put model.onnx here (git-ignored)
│   ├── tests/             smoke_test.py - end-to-end check
│   ├── tools/             make_dummy_onnx.py - fake model for plumbing tests
│   ├── .env.example       copy to .env
│   └── requirements.txt
├── frontend/
│   ├── public/            static images
│   └── src/
│       ├── screens/       Landing, Login, Dashboard, PatientInfo, Capture, AIResult, Settings
│       ├── api.ts         the only place that talks to the backend
│       ├── i18n.tsx       English / Indonesian strings
│       └── imports/       design assets and DESIGN.md (design system + UX spec)
└── testimgs/              sample JPEGs for --simulate
```

## Configuration

The backend reads settings from environment variables. To set them, copy `backend/.env.example` to `backend/.env` and
edit it - the file is **loaded automatically** (no `source`/`export`). Real environment variables override the file.

| Variable | Default | Purpose |
|---|---|---|
| `OCEDA_DEMO_EMAIL` / `OCEDA_DEMO_PASSWORD` / `OCEDA_DEMO_NAME` | `dr.sari@oceda.local` / `oceda123` / `Dr. Dewi Sari` | Demo doctor, seeded on first start only |
| `OCEDA_DEVICE_TOKEN` | `oceda-dev-device-token` | Shared secret the Pi sends; must match on both sides |
| `OCEDA_OPEN_SIGNUP` | `1` | `0` disables `POST /api/auth/register` |
| `OCEDA_SESSION_HOURS` | `12` | Login session lifetime |
| `OCEDA_CORS_ORIGINS` | `http://localhost:5173,http://127.0.0.1:5173` | Only matters if the frontend calls the backend directly |
| `OCEDA_DATA_DIR` | `backend/data` | SQLite DB, captures, heatmaps, email outbox |
| `OCEDA_MAX_UPLOAD_MB` | `15` | Per-image upload limit |
| `OCEDA_MODEL`, `OCEDA_MODEL_KIND`, `OCEDA_LABELS`, ... | see [AI inference](#ai-inference) | Model setup |
| `OCEDA_SMTP_HOST`, `_PORT`, `_USER`, `_PASSWORD`, `_FROM` | empty host | Empty host writes `.eml` files to `data/outbox/` instead of sending |

Frontend (optional, set when starting `npm run dev` or in `frontend/.env.local`): `VITE_API_URL` to call a backend
directly instead of through the Vite proxy (the backend's CORS must then allow your origin), and `VITE_PROXY_TARGET`
to point the dev proxy somewhere other than `http://127.0.0.1:8000`.

Admin CLI (run from `backend/` with the venv active):

```bash
python -m app.manage create-user dr.x@clinic.org 's3cret!' "Dr. X"
python -m app.manage create-device dr.x@clinic.org "Pi Zero W #2"     # prints the device token once
```

## API

Auth is `Authorization: Bearer <token>`. `<img>` and `EventSource` can't send headers, so those GET routes also accept
`?token=<token>`. Errors are `{"error": "..."}`. The frontend's client is `frontend/src/api.ts`.

| Flow step | Endpoint |
|---|---|
| Login | `POST /api/auth/login` `{email,password}` → `{token,user}` (also `/register`, `/me`, `/logout`) |
| Dashboard | `GET /api/exams` (recent sessions + result), `GET /api/device/status` (header chips) |
| Start exam / patient info | `POST /api/exams` `{patient:{id,name,dob,ear,notes}}` → `{id:"SES-261010-001",...}` |
| Capture transmitted | Pi: `POST /api/device/captures` (see below) |
| "Captures ready" in the browser | `GET /api/exams/{id}/events` (SSE: `snapshot`, `capture`, `selected`, `analyzing`, `result`) |
| Browse / select a capture | `GET /api/exams/{id}` (captures + quality hint), `PUT /api/exams/{id}/selection` `{capture_id}` |
| Analyze the selected capture | `POST /api/exams/{id}/analyze` → `{classification,confidence,heatmap_url,...}` |
| Result + email | result JSON; the email (original + heatmap) is sent right after the response |

## Raspberry Pi

### Protocol

Plain HTTP POST of the raw JPEG - chosen because the Pi Zero W is a single-core ARMv6 on 2.4 GHz Wi-Fi: no
websocket/MQTT stack, stdlib Python on every Pi OS, trivial retries. Real-time is only needed server→browser, which
SSE covers.

```
POST /api/device/captures
X-Device-Token: <secret>             required
X-Capture-Id:   <uuid>               client-generated; resending the same id is a no-op (safe retries)
X-Checksum:     <sha256 of body>     optional; 422 on mismatch
Content-Type:   image/jpeg           body = the JPEG bytes (real JPEG only - WebP/PNG are rejected)
→ 201 {"duplicate":false,"capture":{id,index,width,height,quality,url}}
  200 duplicate | 401 bad token | 409 no open exam | 413 >15MB | 422 not a decodable JPEG
```

`pi_client.py` spools every shot to disk, uploads from one background thread with 3→60 s backoff, drops a shot only on
4xx rejections, and sends a heartbeat every 10 s.

### Setup (Pi Zero W or 3)

```bash
scp backend/device/pi_client.py pi@raspberrypi.local:~/oceda/
# on the Pi (nothing to pip install - standard library only):
OCEDA_SERVER=http://<server-lan-ip>:8000 OCEDA_DEVICE_TOKEN=... python3 ~/oceda/pi_client.py
```

`dev.py` prints the right `OCEDA_SERVER` address for your machine when it starts. The Pi must reach the backend
directly (port 8000), not through Vite.

- Camera app is auto-detected: `rpicam-still` (Bookworm) → `libcamera-still` (Bullseye) → `raspistill` (legacy).
- Button: **GPIO21 (physical pin 40)** to GND (pin 39 is the ground right next to it); `--button-pin` or `OCEDA_BUTTON_PIN` changes it; `--keyboard` = press Enter instead.
- Busy flag: after a press, further presses are ignored (logged as `busy - press ignored`, never queued) until that shot has been captured **and** sent, so a slow or offline link can't pile up frames. If the upload hasn't finished after `--busy-timeout` seconds (default 90) the button unlocks and the frame stays safely queued on disk. `--allow-queue` only locks the button during the capture itself.
- Default 3280×2464 (IMX219 full-res, ~2-4 MB). On weak Wi-Fi: `OCEDA_WIDTH=1640 OCEDA_HEIGHT=1232`.
- Autostart on boot: edit and install `backend/device/oceda-device.service`.
- No inference on the Pi - the Zero W is too weak and can't run onnxruntime; it only captures and ships.

### Real device: C++ capture program (`--native`)

The actual otoscope hardware is driven by `backend/device/capture/oceda_capture.cpp`: libcamera 320×320 preview
(center 240×240 crop) on the ST7789 LCD, the 4 illumination LEDs, and the capture button on GPIO21. A button press
saves the 240×240 crop as JPEG (quality 90) into the spool (`$OCEDA_SPOOL`, default `~/oceda-spool`) as `.part`, then
renames it to `.jpg`. `pi_client.py --native` starts that program, restarts it if it dies, and uploads whatever lands
in the spool with the same retry/backoff logic as before.

```bash
# from your computer: copy the whole device folder (pi_client.py + capture/), not just pi_client.py
scp -r backend/device pi@raspberrypi.local:~/oceda

# on the Pi
sudo apt install -y g++ make pkg-config libcamera-dev libgpiod-dev libjpeg-dev
make -C ~/oceda/capture
OCEDA_SERVER=http://<server-lan-ip>:8000 OCEDA_DEVICE_TOKEN=... python3 ~/oceda/pi_client.py --native
```

**libgpiod 2.x is required** (the program uses the v2 line-request API). Stock Raspberry Pi OS *Bookworm* ships
libgpiod 1.6.x and will not build it; *Trixie* ships 2.x (Bookworm needs `bookworm-backports` enabled). `make` checks
this first and tells you which version it found. Check with `pkg-config --modversion libgpiod`.

- The C++ program owns the camera, GPIO21, SPI and LEDs, so don't run it together with the `rpicam-still` / `gpiozero`
  path; `--native` replaces it. `--simulate`, `--keyboard` and `--once` still work for testing without hardware.
- Binary location: `--native /path/to/oceda_capture`, or `OCEDA_CAPTURE_BIN`, or `capture/oceda_capture` next to the script.
- Frames are 240×240 (what the LCD shows), so uploads are small (~20 KB); there is no busy lock in this mode.
- If saved images have red and blue swapped, rebuild with `make clean && make SWAP_RB=1` (libcamera's `RGB888` is
  B,G,R in memory; the LCD path was kept exactly as in the working preview).
- Run `./oceda_capture` by hand to see the preview and button without any upload (photos still land in the spool;
  `pi_client.py --native` would upload them later). Ctrl+C stops it and turns the LEDs off.
- Each photo is named `oto_<date>_<time>_<random>.jpg`. The random part matters: the Pi Zero W has no battery clock,
  and the server treats a repeated `X-Capture-Id` as a duplicate and silently drops the second image.
- The old standalone build wrote to a hard-coded `/home/<user>/oceda-capture/captures/`. That folder is no longer
  used; the spool (`$OCEDA_SPOOL`) is the only place photos go.

### Frame quality hint

Each upload is scored (Laplacian-variance sharpness + exposure → `quality.score` 0-100) and
`recommended_capture_id` is the top score. It only sorts/badges thumbnails; the doctor's `PUT .../selection` is what
counts. It's a cheap heuristic - tune `ai.image_quality()` against real otoscope frames (glare and wax can fool it).

## AI inference

`backend/app/ai.py` is the one file to edit. Export your model to ONNX and put it at `backend/models/model.onnx`.
**Until then the AI is a mock**: every result carries `"mock": true`, the UI shows a banner and the email says so, so
fake output can't be mistaken for a real reading.

| | ResNet (classifier) | YOLO (YOLOv8 detect export) |
|---|---|---|
| env | `OCEDA_MODEL_KIND=resnet` | `OCEDA_MODEL_KIND=yolo` |
| preprocess | RGB, resize (squash) to 224², /255, ImageNet mean/std, NCHW float32 | RGB, letterbox to 640² (pad 114), /255, NCHW float32 |
| output used | `[1,C]` logits or probs (softmax if needed; 1 output = sigmoid) | `[1,4+C,N]` → conf filter + NMS |
| heatmap | 2nd ONNX output as CAM if present, else occlusion sensitivity (7×7, any model) | detection boxes as soft blobs |
| label | argmax of `OCEDA_LABELS` | class of best box; no box ⇒ first label ("Normal") |

Match what you trained with: `OCEDA_INPUT_SIZE`, `OCEDA_NORM` (`none` for plain /255), and the `OCEDA_LABELS` order.
If you trained with center-crop instead of squash, change `preprocess_classifier`. For a nicer heatmap, export
Grad-CAM/CAM as a second ONNX output (`[1,1,h,w]` or `[1,C,h,w]`).

To check the plumbing before the real model exists: `python backend/tools/make_dummy_onnx.py backend/models/model.onnx`
writes a meaningless 2-class model ("redder image ⇒ Abnormal"). Delete it afterwards, or you'll get dummy results
that are *not* flagged as mock.

## Frontend

React 19 + TypeScript + Vite 8 + Tailwind CSS v4 + Lucide icons. Run from `frontend/`:

| Command | |
|---|---|
| `npm run dev` | dev server on :5173 (proxies `/api` to the backend) |
| `npm run build` | production build to `frontend/dist/` |
| `npm run preview` | serve the production build locally |
| `npm run format` | format with oxfmt |

Screens: Landing, Login, Dashboard, Patient Information, Capture, AI Result, Settings (language and appearance). The
design system and UX specification live in `frontend/src/imports/DESIGN.md`.

## Testing

```bash
# with backend/.venv active
python backend/tests/smoke_test.py
```

Starts the real server on a temporary database, drives it like the web app, and uses `pi_client.py --simulate` as the
Pi. It covers auth, uploads and retries, SSE, selection, analysis, email, and per-user isolation.

## Status

- [x] Frontend: all screens, light/dark mode, English/Indonesian, responsive layout
- [x] Backend API, auth, SQLite storage
- [x] Real-time capture delivery (device → backend → browser over SSE)
- [x] Frame quality scoring and best-frame hint
- [x] AI inference pipeline (ResNet / YOLO via ONNX) with mock fallback
- [x] Result email with heatmap
- [ ] Real trained model in `backend/models/` (currently mock unless you add one)
- [ ] `--native` path verified on physical hardware. The C++ program is compile-checked against libcamera and the
      libgpiod 2.x headers, and its real `save_jpeg()` (crop, JPEG, atomic spool write, unique ids) was run through
      `pi_client.py --native` and the backend end to end. Camera, LCD, LEDs and button have not been exercised on the
      device itself since this was integrated.

### Known limits (prototype)

- The onnxruntime path was checked with the dummy model only; the YOLO decoder is unit-tested on synthetic tensors,
  not on a real YOLO export.
- Plain HTTP and a static device token: fine on a clinic LAN for a demo; put TLS in front before real use.
- `OCEDA_OPEN_SIGNUP` defaults to on, so anyone who can reach the server can create an account. Turn it off outside
  demos.
- Patient names are stored unencrypted and appear in the result email. Real patient data needs proper consent and
  compliance work.
- The SSE bus is in-memory, so run a single worker. Sessions live 12 h; there is no rate limiting or password reset.

## Team

OCEDA Capstone Project

| Member | Role |
| --- | --- |
| Laura Fawzia Sambowo | UI/UX, Frontend, Backend Integration |
| Aqila Ananti | Hardware (Raspberry Pi Zero W, LCD, LED), Wiring, Device Building |
| Arsinta Kirana Nisa | AI Model Training & Implementation, Backend |
| Belva Nayla Soendaroeputri | 3D Design, Wiring, Design, Component Measurements |
| Sang Kala Sansvatama | Hardware (Raspberry Pi), Backend, AI Model |

<p align="center">
  <b>Made with 💙 by the OCEDA Team</b>
</p>
