"""Emails the original image + heatmap to the doctor's registered address."""
import smtplib
from email.message import EmailMessage

from . import config


def send_result(to: str, exam: dict, result: dict, original_path, heatmap_path, seg_overlay_path=None) -> str:
    msg = EmailMessage()
    msg["From"] = config.SMTP_FROM
    msg["To"] = to
    msg["Subject"] = f"OCEDA result {exam['id']} - {result['label']} ({result['confidence']:.1f}%)"
    mock_note = "\n*** MOCK MODEL - no real AI model loaded, do not use clinically ***\n" if result["mock"] else ""
    msg.set_content(
        f"Examination {exam['id']}\n"
        f"Patient: {exam['patient_name']} ({exam['patient_id']}), {exam['ear']} ear\n"
        f"AI classification: {result['label']}  |  confidence {result['confidence']:.1f}%\n"
        f"{mock_note}\n"
        "Attached: original capture, AI heatmap and anatomical segmentation overlay.\n"
        "This is an AI-assisted screening aid, not a diagnosis.\n")
    for p, name in ((original_path, f"{exam['id']}-original.jpg"), (heatmap_path, f"{exam['id']}-heatmap.jpg")):
        msg.add_attachment(p.read_bytes(), maintype="image", subtype="jpeg", filename=name)
    if seg_overlay_path is not None:
        msg.add_attachment(seg_overlay_path.read_bytes(), maintype="image", subtype="jpeg",
                           filename=f"{exam['id']}-segmentation.jpg")

    if not config.SMTP_HOST:
        out = config.OUTBOX_DIR / f"{exam['id']}.eml"
        out.write_bytes(bytes(msg))
        return f"saved to outbox ({out.name})"
    with smtplib.SMTP(config.SMTP_HOST, config.SMTP_PORT, timeout=20) as s:
        if config.SMTP_STARTTLS:
            s.starttls()
        if config.SMTP_USER:
            s.login(config.SMTP_USER, config.SMTP_PASSWORD)
        s.send_message(msg)
    return "sent"
