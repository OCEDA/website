"""Image quality scoring, model preprocessing, ONNX inference and heatmap rendering.

Model contract (export your trained model to ONNX):
  resnet : input  float32 [1,3,S,S]  (RGB, NCHW, ImageNet-normalised unless OCEDA_NORM=none)
           output[0] logits/probs [1,C]; optional output[1] = CAM [1,(1|C),h,w] (used as heatmap)
  yolo   : input  float32 [1,3,S,S]  (RGB, letterboxed, /255)   - Ultralytics YOLOv8 detect export
           output[0] [1, 4+C, N]     -> detections become the heatmap
           (a YOLOv8-*cls* model behaves like "resnet" with OCEDA_NORM=none)
If there is no model file the module runs in MOCK mode so the whole pipeline can be demoed.
"""
from __future__ import annotations

import hashlib
import io
import logging
import threading

import cv2
import numpy as np
from PIL import Image, ImageOps

from . import config

log = logging.getLogger("oceda.ai")

IMAGENET_MEAN = np.array([0.485, 0.456, 0.406], np.float32).reshape(1, 3, 1, 1)
IMAGENET_STD = np.array([0.229, 0.224, 0.225], np.float32).reshape(1, 3, 1, 1)

# Segmentasi UNet ResNet-34 constants
SEG_CLASS_NAMES = ["background", "liang", "malleus", "membran timpani", "serumen", "sekret"]
SEG_COLOR_MAP = np.array(
    [[0, 0, 0], [255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 0], [255, 0, 255]],
    dtype=np.uint8,
)
SEG_MEAN = np.array([0.485, 0.456, 0.406], dtype=np.float32)
SEG_STD = np.array([0.229, 0.224, 0.225], dtype=np.float32)


# ───────────────────────── image helpers ─────────────────────────
def open_image(src) -> Image.Image:
    img = Image.open(io.BytesIO(src) if isinstance(src, (bytes, bytearray)) else src)
    return ImageOps.exif_transpose(img).convert("RGB")


def image_quality(img: Image.Image) -> dict:
    """Cheap 'is this a usable frame?' hint shown next to each capture. The doctor still picks manually.
    sharpness = variance of the Laplacian (focus), brightness = mean gray (exposure)."""
    w = 640
    small = img.convert("L").resize((w, max(1, round(img.height * w / img.width))), Image.BOX)
    g = np.asarray(small, np.float32)
    lap = -4 * g[1:-1, 1:-1] + g[:-2, 1:-1] + g[2:, 1:-1] + g[1:-1, :-2] + g[1:-1, 2:]
    sharp, bright = float(lap.var()), float(g.mean())
    focus = min(1.0, sharp / 200.0)
    exposure = 1.0 - min(1.0, abs(bright - 120.0) / 120.0)
    return {"sharpness": round(sharp, 1), "brightness": round(bright, 1),
            "score": round(100 * (0.7 * focus + 0.3 * exposure), 1)}


def inspect_jpeg(data: bytes) -> dict:
    """Validate an uploaded frame and compute its metadata. Raises ValueError if unusable."""
    if data[:2] != b"\xff\xd8":
        raise ValueError("not a JPEG")
    try:
        img = open_image(data)
    except Exception as e:  # truncated / corrupt
        raise ValueError(f"cannot decode image: {e}")
    return {"width": img.width, "height": img.height, **image_quality(img)}


# ───────────────────────── preprocessing ─────────────────────────

def center_crop_square(img: Image.Image) -> Image.Image:
    """Ambil crop persegi dari tengah gambar (1:1 square crop)."""
    w, h = img.size
    side = min(w, h)
    left = (w - side) // 2
    top = (h - side) // 2
    return img.crop((left, top, left + side, top + side))


def classifier_preprocessed_image(img: Image.Image, size: int = None) -> Image.Image:
    """Citra hasil preprocessing untuk klasifikasi AI:
    Center crop bujursangkar 1:1 lalu resize ke ukuran input model (default: config.INPUT_SIZE = 224).
    """
    if size is None:
        size = config.INPUT_SIZE
    return center_crop_square(img).resize((size, size), Image.BILINEAR)


def preprocess_classifier(img: Image.Image, size: int, norm: str) -> np.ndarray:
    """Preprocessing MobileNetV2: RGB, center crop square, resize,
    konversi ke [0,1], normalisasi ImageNet, lalu NCHW.
    """
    img = classifier_preprocessed_image(img, size)
    a = np.asarray(img, dtype=np.float32) / 255.0

    # HWC -> NCHW, dengan dimensi batch.
    x = a.transpose(2, 0, 1)[None]

    if norm == "imagenet":
        x = (x - IMAGENET_MEAN) / IMAGENET_STD

    return np.ascontiguousarray(x, dtype=np.float32)


def preprocess_segmentation(img_rgb: np.ndarray, size: int = 256):
    """Preprocessing UNet ResNet-34:
    LongestMaxSize(256) -> PadIfNeeded(256, nilai 0) -> Normalize ImageNet.
    """
    h0, w0 = img_rgb.shape[:2]
    scale = size / max(h0, w0)
    new_w, new_h = max(1, round(w0 * scale)), max(1, round(h0 * scale))
    resized = cv2.resize(img_rgb, (new_w, new_h), interpolation=cv2.INTER_LINEAR)

    top, left = (size - new_h) // 2, (size - new_w) // 2
    canvas = np.zeros((size, size, 3), dtype=np.uint8)
    canvas[top:top + new_h, left:left + new_w] = resized

    x = (canvas.astype(np.float32) / 255.0 - SEG_MEAN) / SEG_STD
    x = np.ascontiguousarray(x.transpose(2, 0, 1)[None], dtype=np.float32)
    return x, (top, left, new_h, new_w)


def postprocess_segmentation(logits: np.ndarray, crop, orig_hw):
    """Crop padding -> softmax -> argmax -> hitung evidence -> resize mask ke ukuran crop asli."""
    top, left, h, w = crop
    logits = logits[0, :, top:top + h, left:left + w]

    e = np.exp(logits - logits.max(axis=0, keepdims=True))
    probs = e / e.sum(axis=0, keepdims=True)
    pred = probs.argmax(axis=0).astype(np.uint8)

    total = pred.size
    evidence = {}
    for c, name in enumerate(SEG_CLASS_NAMES):
        if c == 0:
            continue
        m = pred == c
        area = int(m.sum())
        evidence[name] = {
            "name": name,
            "visible": area > 0,
            "area_ratio": round(float(area / total) * 100, 2),
            "confidence": round(float(probs[c][m].mean()) * 100, 1) if area else 0.0,
            "color": SEG_COLOR_MAP[c].tolist(),
        }

    h0, w0 = orig_hw
    mask = cv2.resize(pred, (w0, h0), interpolation=cv2.INTER_NEAREST)
    return mask, evidence


def render_segmentation_overlay(img_rgb: np.ndarray, mask: np.ndarray) -> tuple[bytes, bytes]:
    """Menghasilkan JPEG overlay (60% foto asli + 40% warna segmen) dan PNG mask warna murni."""
    color_mask = SEG_COLOR_MAP[mask]
    overlay = img_rgb.copy()
    fg = mask > 0
    overlay[fg] = (0.6 * img_rgb[fg] + 0.4 * color_mask[fg]).astype(np.uint8)

    buf_overlay = io.BytesIO()
    Image.fromarray(overlay).save(buf_overlay, "JPEG", quality=92)
    buf_mask = io.BytesIO()
    Image.fromarray(color_mask).save(buf_mask, "PNG")
    return buf_overlay.getvalue(), buf_mask.getvalue()


def preprocess_yolo(img: Image.Image, size: int):
    """YOLO letterbox: keep aspect ratio, pad with gray 114. Returns tensor + (scale, padx, pady)."""
    s = min(size / img.width, size / img.height)
    nw, nh = round(img.width * s), round(img.height * s)
    canvas = Image.new("RGB", (size, size), (114, 114, 114))
    px, py = (size - nw) // 2, (size - nh) // 2
    canvas.paste(img.resize((nw, nh), Image.BILINEAR), (px, py))
    x = (np.asarray(canvas, np.float32) / 255.0).transpose(2, 0, 1)[None]
    return np.ascontiguousarray(x), (s, px, py)


# ───────────────────────── postprocessing ─────────────────────────
def to_probs(logits: np.ndarray) -> np.ndarray:
    v = logits.reshape(-1).astype(np.float64)
    if v.size == 1:                                   # single sigmoid output
        p = 1 / (1 + np.exp(-v[0]))
        return np.array([1 - p, p])
    if v.min() >= 0 and abs(v.sum() - 1) < 1e-3:      # already softmaxed
        return v
    e = np.exp(v - v.max())
    return e / e.sum()


def classifier_decision_index(probs: np.ndarray) -> int:
    """Terapkan threshold P(Abnormal) dari eksperimen Stage 2."""
    labels = config.LABELS

    if "Abnormal" not in labels or "Normal" not in labels:
        raise ValueError(
            "OCEDA_LABELS harus memuat kelas Normal dan Abnormal."
        )

    idx_abnormal = labels.index("Abnormal")
    idx_normal = labels.index("Normal")

    if len(probs) != len(labels):
        raise ValueError(
            f"Jumlah probabilitas ({len(probs)}) tidak cocok "
            f"dengan jumlah label ({len(labels)})."
        )

    if probs[idx_abnormal] >= config.ABNORMAL_THRESHOLD:
        return idx_abnormal

    return idx_normal



def yolo_rows(out: np.ndarray, nc: int) -> np.ndarray:
    """Raw YOLOv8 output [1, 4+nc, N] (or already [1, N, 4+nc]) -> [N, 4+nc]."""
    p = out[0]
    if p.shape[0] == 4 + nc:
        return p.T
    if p.shape[1] == 4 + nc:
        return p
    raise ValueError(f"YOLO output {out.shape} does not match 4+{nc} (check OCEDA_LABELS)")


def decode_yolo(out: np.ndarray, nc: int, conf_thr: float, iou_thr: float):
    """YOLOv8 raw output -> [(x1,y1,x2,y2,conf,cls)] in letterboxed pixels, after NMS."""
    p = yolo_rows(out, nc)
    scores = p[:, 4:]
    cls, conf = scores.argmax(1), scores.max(1)
    keep = conf >= conf_thr
    p, cls, conf = p[keep], cls[keep], conf[keep]
    if len(p) == 0:
        return []
    boxes = np.stack([p[:, 0] - p[:, 2] / 2, p[:, 1] - p[:, 3] / 2,
                      p[:, 0] + p[:, 2] / 2, p[:, 1] + p[:, 3] / 2], 1)
    order, picked = conf.argsort()[::-1], []
    while len(order):
        i = order[0]
        picked.append(i)
        rest = order[1:]
        xx1 = np.maximum(boxes[i, 0], boxes[rest, 0]); yy1 = np.maximum(boxes[i, 1], boxes[rest, 1])
        xx2 = np.minimum(boxes[i, 2], boxes[rest, 2]); yy2 = np.minimum(boxes[i, 3], boxes[rest, 3])
        inter = np.clip(xx2 - xx1, 0, None) * np.clip(yy2 - yy1, 0, None)
        area = lambda b: (b[..., 2] - b[..., 0]) * (b[..., 3] - b[..., 1])
        iou = inter / (area(boxes[i]) + area(boxes[rest]) - inter + 1e-9)
        order = rest[iou < iou_thr]
    return [(*boxes[i], float(conf[i]), int(cls[i])) for i in picked]


def boxes_to_heat(dets, meta, img_w: int, img_h: int) -> np.ndarray:
    """Soft gaussian blob per detection, in original-image coordinates (coarse grid, ~160px long side)."""
    s, px, py = meta
    k = 160 / max(img_w, img_h)
    gw, gh = max(2, round(img_w * k)), max(2, round(img_h * k))
    yy, xx = np.mgrid[0:gh, 0:gw].astype(np.float32)
    heat = np.zeros((gh, gw), np.float32)
    for x1, y1, x2, y2, conf, _ in dets:
        x1, x2 = (x1 - px) / s * k, (x2 - px) / s * k
        y1, y2 = (y1 - py) / s * k, (y2 - py) / s * k
        cx, cy = (x1 + x2) / 2, (y1 + y2) / 2
        sx, sy = max(1.0, (x2 - x1) / 3), max(1.0, (y2 - y1) / 3)
        heat = np.maximum(heat, conf * np.exp(-(((xx - cx) / sx) ** 2 + ((yy - cy) / sy) ** 2) / 2))
    return heat


def occlusion_heatmap(predict, x: np.ndarray, k: int, grid: int = 8) -> np.ndarray:
    """Model-agnostic heatmap: blank out each grid cell inside the circular endoscopic aperture
    and see how much P(class k) drops. Cells in the black corners/margin are ignored.
    """
    base = predict(x)[k]
    H, W = x.shape[2:]
    ys, xs = np.linspace(0, H, grid + 1, dtype=int), np.linspace(0, W, grid + 1, dtype=int)
    fill = x.mean(axis=(2, 3), keepdims=True)
    heat = np.zeros((grid, grid), np.float32)
    c = (grid - 1) / 2.0
    max_r = c * 0.95

    for i in range(grid):
        for j in range(grid):
            # Skip cells located in the outer black border
            if np.sqrt((i - c) ** 2 + (j - c) ** 2) > max_r:
                continue
            xo = x.copy()
            xo[:, :, ys[i]:ys[i + 1], xs[j]:xs[j + 1]] = fill
            heat[i, j] = max(0.0, base - predict(xo)[k])
    return heat


# ───────────────────────── heatmap rendering ─────────────────────────
def _jet(v: np.ndarray) -> np.ndarray:
    r = np.clip(1.5 - np.abs(4 * v - 3), 0, 1)
    g = np.clip(1.5 - np.abs(4 * v - 2), 0, 1)
    b = np.clip(1.5 - np.abs(4 * v - 1), 0, 1)
    return np.stack([r, g, b], -1) * 255


def render_overlay(img: Image.Image, heat: np.ndarray, max_w: int = 1024) -> bytes:
    if img.width > max_w:
        img = img.resize((max_w, round(img.height * max_w / img.width)), Image.LANCZOS)
    h = heat.astype(np.float32)
    h = (h - h.min()) / (h.max() - h.min() + 1e-8)
    h = np.asarray(Image.fromarray(h, mode="F").resize(img.size, Image.BICUBIC), np.float32)
    h = np.clip(h, 0, 1)
    base = np.asarray(img, np.float32)

    # Circular aperture & brightness mask: keep outer black camera bezel clean
    w, h_img = img.size
    Y, X = np.ogrid[:h_img, :w]
    dist = np.sqrt((X - w / 2) ** 2 + (Y - h_img / 2) ** 2)
    aperture_mask = np.clip((min(w, h_img) * 0.485 - dist) / max(1.0, min(w, h_img) * 0.02), 0, 1)
    brightness_mask = np.clip((base.max(axis=-1) - 20) / 25.0, 0, 1)
    valid_mask = (aperture_mask * brightness_mask)[..., None]

    alpha = (0.55 * np.clip(h * 1.4, 0, 1))[..., None] * valid_mask
    out = base * (1 - alpha) + _jet(h) * alpha
    buf = io.BytesIO()
    Image.fromarray(out.clip(0, 255).astype(np.uint8)).save(buf, "JPEG", quality=88)
    return buf.getvalue()


# ───────────────────────── model wrapper ─────────────────────────
class Model:
    def __init__(self):
        self._sess = None
        self._seg_sess = None
        self._lock = threading.Lock()

    @property
    def mock(self) -> bool:
        return not config.MODEL_PATH.exists()

    @property
    def seg_mock(self) -> bool:
        return not config.SEG_MODEL_PATH.exists()

    @property
    def name(self) -> str:
        return "mock" if self.mock else f"{config.MODEL_KIND}:{config.MODEL_PATH.name}"

    def _session(self):
        with self._lock:
            if self._sess is None:
                import onnxruntime as ort
                self._sess = ort.InferenceSession(str(config.MODEL_PATH), providers=["CPUExecutionProvider"])
                log.info("loaded %s (inputs=%s)", config.MODEL_PATH, [i.name for i in self._sess.get_inputs()])
        return self._sess

    def _seg_session(self):
        with self._lock:
            if self._seg_sess is None and config.SEG_MODEL_PATH.exists():
                import onnxruntime as ort
                self._seg_sess = ort.InferenceSession(str(config.SEG_MODEL_PATH), providers=["CPUExecutionProvider"])
                log.info("loaded segmentation %s", config.SEG_MODEL_PATH)
        return self._seg_sess

    # -- real inference --
    def _predict_classifier(self, img):
        sess = self._session()
        inp = sess.get_inputs()[0].name
        x = preprocess_classifier(img, config.INPUT_SIZE, config.NORM)
        outs = sess.run(None, {inp: x})
        probs = to_probs(outs[0])
        k = classifier_decision_index(probs)
        mode = config.HEATMAP_MODE
        if mode in ("auto", "cam") and len(outs) > 1:
            cam = np.squeeze(outs[1]).astype(np.float32)
            if cam.ndim == 3:
                cam = cam[k] if cam.shape[0] == len(probs) else cam.mean(0)
            heat = cam
        else:
            heat = occlusion_heatmap(lambda t: to_probs(sess.run(None, {inp: t})[0]), x, k)
        return probs, heat

    def _predict_segmentation(self, img: Image.Image):
        # Gambar PENUH (bukan center crop): saat training dipakai LongestMaxSize + PadIfNeeded.
        img_rgb = np.asarray(img)
        if self.seg_mock:
            # Deterministic simulated segmentation mask & evidence
            h, w = img_rgb.shape[:2]
            mask = np.zeros((h, w), dtype=np.uint8)
            Y, X = np.ogrid[:h, :w]
            dist = np.sqrt((X - w / 2) ** 2 + (Y - h / 2) ** 2)
            mask[dist < min(w, h) * 0.35] = 3  # membran timpani
            mask[(dist < min(w, h) * 0.18) & (np.abs(X - w / 2) < min(w, h) * 0.04)] = 2  # malleus
            evidence = {
                "liang": {"name": "liang", "visible": False, "area_ratio": 0.0, "confidence": 0.0, "color": [255, 0, 0]},
                "malleus": {"name": "malleus", "visible": True, "area_ratio": 2.1, "confidence": 88.5, "color": [0, 255, 0]},
                "membran timpani": {"name": "membran timpani", "visible": True, "area_ratio": 36.4, "confidence": 94.2, "color": [0, 0, 255]},
                "serumen": {"name": "serumen", "visible": False, "area_ratio": 0.0, "confidence": 0.0, "color": [255, 255, 0]},
                "sekret": {"name": "sekret", "visible": False, "area_ratio": 0.0, "confidence": 0.0, "color": [255, 0, 255]},
            }
            overlay_bytes, mask_bytes = render_segmentation_overlay(img_rgb, mask)
            return overlay_bytes, mask_bytes, evidence

        sess = self._seg_session()
        inp = sess.get_inputs()[0].name
        x, crop_meta = preprocess_segmentation(img_rgb, config.SEG_INPUT_SIZE)
        logits = sess.run(None, {inp: x})[0]
        mask, evidence = postprocess_segmentation(logits, crop_meta, img_rgb.shape[:2])
        overlay_bytes, mask_bytes = render_segmentation_overlay(img_rgb, mask)
        return overlay_bytes, mask_bytes, evidence

    def _predict_yolo(self, img):
        sess = self._session()
        inp = sess.get_inputs()[0].name
        x, meta = preprocess_yolo(img, config.INPUT_SIZE)
        out = sess.run(None, {inp: x})[0]
        n = len(config.LABELS)
        dets = decode_yolo(out, n, config.YOLO_CONF, config.YOLO_IOU)
        probs = np.zeros(n)
        if dets:                      # a detection => that class, confidence = best box score
            top = dets[0]
            probs[min(top[5], n - 1)] = top[4]
            probs = probs + (1 - top[4]) / max(1, n - 1) * (probs == 0)
        else:                         # nothing found => first label (Normal) with leftover confidence
            best = float(yolo_rows(out, n)[:, 4:].max())
            probs[0] = 1 - best
            probs[1:] = best / max(1, n - 1)
        return probs, boxes_to_heat(dets, meta, img.width, img.height)

    # -- mock --
    def _predict_mock(self, img):
        seed = int.from_bytes(hashlib.sha1(img.resize((32, 32)).tobytes()).digest()[:8], "big")
        rng = np.random.default_rng(seed)
        n = len(config.LABELS)
        k, conf = int(rng.integers(n)), rng.uniform(0.80, 0.95)
        probs = np.full(n, (1 - conf) / max(1, n - 1)); probs[k] = conf
        gh, gw = 48, 64
        cx, cy = rng.uniform(0.3, 0.7) * gw, rng.uniform(0.3, 0.7) * gh
        yy, xx = np.mgrid[0:gh, 0:gw]
        heat = np.exp(-(((xx - cx) / 10) ** 2 + ((yy - cy) / 8) ** 2) / 2) + 0.05 * rng.random((gh, gw))
        return probs, heat.astype(np.float32)

    def analyze(self, path) -> dict:
        img = open_image(path)

        # Preprocessing 1: Klasifikasi (224x224)
        if self.mock:
            probs, heat = self._predict_mock(img)
            prep_cls = classifier_preprocessed_image(img)
        elif config.MODEL_KIND == "yolo":
            probs, heat = self._predict_yolo(img)
            prep_cls = img
        else:
            probs, heat = self._predict_classifier(img)
            prep_cls = classifier_preprocessed_image(img)

        labels = config.LABELS
        if not self.mock and config.MODEL_KIND != "yolo":
            k = classifier_decision_index(probs)
        else:
            k = int(np.argmax(probs))

        buf = io.BytesIO()
        prep_cls.save(buf, "JPEG", quality=95)

        # Preprocessing 2: Segmentasi Anatomi (256x256, gambar penuh).
        # Kegagalan segmentasi tidak boleh menggagalkan klasifikasi.
        seg_overlay_bytes = seg_mask_bytes = seg_evidence = None
        try:
            seg_overlay_bytes, seg_mask_bytes, seg_evidence = self._predict_segmentation(img)
        except Exception:
            log.exception("segmentation failed; classification result is still returned")

        return {
            "label": labels[k] if k < len(labels) else str(k),
            "confidence": round(float(probs[k]) * 100, 1),
            "probabilities": {labels[i] if i < len(labels) else str(i): round(float(p) * 100, 1)
                              for i, p in enumerate(probs)},
            "model": self.name, "mock": self.mock,
            "cropped_jpeg": buf.getvalue(),
            "heatmap_jpeg": render_overlay(prep_cls, heat),
            "segmentation_overlay_jpeg": seg_overlay_bytes,
            "segmentation_mask_png": seg_mask_bytes,
            "segmentation_evidence": seg_evidence,
            "segmentation_mock": self.seg_mock,
        }


model = Model()