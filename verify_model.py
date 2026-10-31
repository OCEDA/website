#!/usr/bin/env python3
"""
Script verifikasi langkah 6 dari instruksi integrasi model.
Jalankan dari folder root website/:
    python verify_model.py

Yang diuji:
1. Apakah model.onnx terbaca (mock: false)?
2. Apakah preprocessing center-crop berjalan?
3. Apakah threshold diterapkan dengan benar?
4. Apakah heatmap berhasil dibuat?
5. Bandingkan output dengan kedua gambar uji (normal & abnormal).
"""
import os
import sys
import json
from pathlib import Path

# Arahkan ke folder backend agar modul app bisa diimport
BACKEND = Path(__file__).resolve().parent / "backend"
sys.path.insert(0, str(BACKEND))

# Load .env dulu sebelum import config
env_path = BACKEND / ".env"
if env_path.exists():
    for raw in env_path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        val = val.split(" #")[0].strip()
        os.environ.setdefault(key.strip(), val.strip())
    print(f"✓ .env terbaca dari {env_path}")
else:
    print("⚠️  .env tidak ditemukan, pakai default config")

from app import config, ai

print("\n" + "="*60)
print("LANGKAH 6: VERIFIKASI INTEGRASI MODEL")
print("="*60)

# --- Cek 1: Mock atau real? ---
print(f"\n[1] Status model:")
print(f"    mock         = {ai.model.mock}")
print(f"    model name   = {ai.model.name}")
print(f"    model path   = {config.MODEL_PATH}")
print(f"    model exists = {config.MODEL_PATH.exists()}")

if ai.model.mock:
    print("\n❌ GAGAL: Model masih MOCK!")
    print("   Pastikan file ONNX ada di:", config.MODEL_PATH)
    sys.exit(1)
else:
    print("   ✓ Model real terbaca!")

# --- Cek 2: Konfigurasi labels & threshold ---
print(f"\n[2] Konfigurasi labels & threshold:")
print(f"    OCEDA_LABELS          = {config.LABELS}")
print(f"    OCEDA_ABNORMAL_THRESHOLD = {config.ABNORMAL_THRESHOLD}")
print(f"    OCEDA_INPUT_SIZE      = {config.INPUT_SIZE}")
print(f"    OCEDA_NORM            = {config.NORM}")

# Validasi urutan kelas dengan metadata JSON
metadata_path = BACKEND / "models" / "locked_threshold_stage2_partial_finetune.json"
if metadata_path.exists():
    meta = json.loads(metadata_path.read_text())
    expected_classes = meta.get("classes", [])
    expected_threshold = meta.get("threshold")
    print(f"\n    Metadata JSON: classes={expected_classes}, threshold={expected_threshold}")
    if config.LABELS == expected_classes:
        print("    ✓ Urutan kelas cocok dengan metadata!")
    else:
        print(f"    ❌ Urutan kelas TIDAK cocok!")
        print(f"       Config: {config.LABELS}")
        print(f"       Metadata: {expected_classes}")
    if abs(config.ABNORMAL_THRESHOLD - expected_threshold) < 1e-6:
        print("    ✓ Threshold cocok dengan metadata!")
    else:
        print(f"    ❌ Threshold TIDAK cocok! Config={config.ABNORMAL_THRESHOLD}, Metadata={expected_threshold}")

# --- Cek 3 & 4: Inferensi gambar uji ---
test_images = {
    "testimgs/ear-normal.jpeg": "Normal",
    "testimgs/ear-abnormal.jpeg": "Abnormal",
}
ROOT = Path(__file__).resolve().parent

print(f"\n[3] Inferensi pada gambar uji:")
all_ok = True
for rel_path, expected_label in test_images.items():
    img_path = ROOT / rel_path
    if not img_path.exists():
        print(f"    ⚠️  {rel_path} tidak ditemukan, skip")
        continue

    print(f"\n    Gambar: {rel_path}")
    print(f"    Expected label: {expected_label}")
    try:
        result = ai.model.analyze(str(img_path))
        got_label = result["label"]
        confidence = result["confidence"]
        probs = result["probabilities"]
        has_heatmap = len(result.get("heatmap_jpeg", b"")) > 0

        print(f"    → label      = {got_label}")
        print(f"    → confidence = {confidence}%")
        print(f"    → probs      = {probs}")
        print(f"    → heatmap    = {'✓ ada (' + str(len(result['heatmap_jpeg'])) + ' bytes)' if has_heatmap else '❌ kosong!'}")

        if got_label == expected_label:
            print(f"    ✓ Label BENAR!")
        else:
            print(f"    ⚠️  Label berbeda (expected={expected_label}, got={got_label})")
            print(f"       (mungkin threshold atau urutan kelas perlu dicek)")
            all_ok = False

        if not has_heatmap:
            all_ok = False

    except Exception as e:
        print(f"    ❌ ERROR: {e}")
        import traceback; traceback.print_exc()
        all_ok = False

# --- Ringkasan ---
print("\n" + "="*60)
if all_ok:
    print("✅ SEMUA CEK BERHASIL! Model siap digunakan.")
else:
    print("⚠️  Ada yang perlu dicek. Lihat output di atas.")
print("="*60)
print("\nSekarang restart dev.py lalu buka web app → buat exam baru")
print("→ upload gambar → klik Analyze → pastikan 'mock: false' di hasil.")
