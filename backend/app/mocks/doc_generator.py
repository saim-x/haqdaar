"""Synthetic specimen document generator (docs/10 §3).

Produces watermarked mock CNIC / death-certificate cards with HMAC-signed QR
codes, plus the labelled 30-image benchmark used to report honest document
verification metrics.

Outputs
-------
``backend/app/data/demo_docs/``      7 ready-to-upload demo files + manifest
``backend/app/data/doc_eval_set/``   30 labelled benchmark images + manifest

Every image carries the visible watermark ``MOCK SPECIMEN - NOT AN OFFICIAL
DOCUMENT``. Every CNIC starts with the reserved fictional prefix ``99900``.
No real agency name or logo is used anywhere ("NADRA-like, simulated").

Run::

    python -m app.mocks.doc_generator            # generate what is missing
    python -m app.mocks.doc_generator --force    # regenerate everything
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

from app.ai.qr_sign import (
    ISSUER_CNIC,
    ISSUER_DEATH,
    build_payload,
    payload_to_json,
)

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
DEMO_DOCS_DIR = DATA_DIR / "demo_docs"
DOC_EVAL_DIR = DATA_DIR / "doc_eval_set"

WATERMARK_TEXT = "MOCK SPECIMEN - NOT AN OFFICIAL DOCUMENT"
WATERMARK_TEXT_UR = "نقلی نمونہ - یہ سرکاری دستاویز نہیں ہے"

#: Fixed RNG seed so the benchmark is byte-stable across machines.
GENERATOR_SEED = 20261120

_FONT_CANDIDATES = (
    "C:/Windows/Fonts/arial.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/System/Library/Fonts/Supplemental/Arial.ttf",
)
_FONT_BOLD_CANDIDATES = (
    "C:/Windows/Fonts/arialbd.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
)
_URDU_FONT_CANDIDATES = (
    "C:/Windows/Fonts/Nirmala.ttc",
    "/usr/share/fonts/truetype/noto/NotoNaskhArabic-Regular.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
)


# --------------------------------------------------------------------------- #
# fonts & primitives
# --------------------------------------------------------------------------- #
def _load_font(candidates: Iterable[str], size: int) -> ImageFont.FreeTypeFont:
    for path in candidates:
        try:
            return ImageFont.truetype(path, size=size)
        except OSError:
            continue
    return ImageFont.load_default(size=size)


def _font(size: int, *, bold: bool = False, urdu: bool = False) -> ImageFont.FreeTypeFont:
    if urdu:
        return _load_font(_URDU_FONT_CANDIDATES, size)
    return _load_font(_FONT_BOLD_CANDIDATES if bold else _FONT_CANDIDATES, size)


def _format_cnic(cnic: str) -> str:
    digits = "".join(ch for ch in cnic if ch.isdigit())
    if len(digits) != 13:
        return cnic
    return f"{digits[:5]}-{digits[5:12]}-{digits[12]}"


def _draw_watermark(img: Image.Image) -> None:
    """Tile the specimen watermark diagonally across the whole card."""
    overlay = Image.new("RGBA", img.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    font = _font(26, bold=True)
    text = WATERMARK_TEXT
    step_x, step_y = 520, 150
    for y in range(-40, img.height + step_y, step_y):
        for x in range(-120, img.width + step_x, step_x):
            draw.text((x, y), text, font=font, fill=(180, 20, 20, 46))
    rotated = overlay.rotate(18, resample=Image.BICUBIC, expand=False)
    if img.mode == "RGBA":
        img.alpha_composite(rotated)
    else:
        img.paste(Image.alpha_composite(img.convert("RGBA"), rotated).convert("RGB"), (0, 0))


def _banner(draw: ImageDraw.ImageDraw, width: int, *, height: int = 54) -> None:
    draw.rectangle([0, 0, width, height], fill=(153, 27, 27))
    text = WATERMARK_TEXT
    font = _font(24, bold=True)
    bbox = draw.textbbox((0, 0), text, font=font)
    draw.text(
        ((width - (bbox[2] - bbox[0])) / 2, (height - (bbox[3] - bbox[1])) / 2 - 2),
        text,
        font=font,
        fill=(255, 255, 255),
    )


def _qr_image(payload: dict[str, Any], *, box_size: int = 5) -> Image.Image:
    import qrcode

    qr = qrcode.QRCode(
        version=None,
        error_correction=qrcode.constants.ERROR_CORRECT_M,
        box_size=box_size,
        border=4,
    )
    qr.add_data(payload_to_json(payload))
    qr.make(fit=True)
    return qr.make_image(fill_color="black", back_color="white").convert("RGB")


def _laplacian_var(img: Image.Image) -> float:
    import cv2

    gray = np.array(img.convert("L"), dtype=np.uint8)
    return float(cv2.Laplacian(gray, cv2.CV_64F).var())


# --------------------------------------------------------------------------- #
# card renderers
# --------------------------------------------------------------------------- #
@dataclass
class SpecimenFields:
    """Printed fields for one specimen card."""

    cnic: str
    full_name: str
    full_name_ur: str = ""
    father_or_spouse_name: str = ""
    dob: str = ""
    district: str = "Thatta"
    expiry: str = "2030-08-01"
    marital_status: str = "WIDOWED"
    certificate_no: str = ""
    death_date: str = ""
    spouse_cnic: str = ""
    spouse_name: str = ""


def render_cnic_card(
    fields: SpecimenFields,
    *,
    printed_name: str | None = None,
    qr_payload: dict[str, Any] | None = None,
    include_qr: bool = True,
    size: tuple[int, int] = (1200, 760),
) -> Image.Image:
    """Render a mock CNIC front. ``printed_name`` overrides the printed name only."""
    width, height = size
    img = Image.new("RGBA", size, (232, 245, 233, 255))
    draw = ImageDraw.Draw(img)

    # soft vertical gradient
    for y in range(height):
        shade = int(232 - (y / height) * 26)
        draw.line([(0, y), (width, y)], fill=(shade, 245, shade + 2, 255))

    _banner(draw, width)
    draw.rectangle([0, 54, width, 132], fill=(27, 94, 32))
    draw.text((28, 66), "ISLAMIC REPUBLIC OF PAKISTAN (SIMULATED)", font=_font(30, bold=True), fill="white")
    draw.text((28, 102), "Mock Identity Registry - specimen card, not an official document", font=_font(18), fill=(200, 230, 201))
    draw.text((width - 330, 70), "اسلامی جمہوریہ پاکستان (نقلی)", font=_font(26, urdu=True), fill="white")

    # photo placeholder
    draw.rectangle([36, 168, 276, 468], fill=(207, 216, 220), outline=(96, 125, 139), width=3)
    draw.ellipse([116, 226, 196, 306], fill=(120, 144, 156))
    draw.polygon([(76, 452), (156, 330), (236, 452)], fill=(120, 144, 156))
    draw.text((60, 480), "PHOTO (MOCK)", font=_font(18, bold=True), fill=(69, 90, 100))

    name = printed_name or fields.full_name
    rows = [
        ("Name / نام", name),
        ("CNIC / شناختی کارڈ نمبر", _format_cnic(fields.cnic)),
        ("Date of Birth", fields.dob),
        ("Father / Spouse", fields.father_or_spouse_name),
        ("District", fields.district),
        ("Marital Status", fields.marital_status),
        ("Valid Until", fields.expiry),
    ]
    y = 176
    for label, value in rows:
        draw.text((312, y), label, font=_font(19), fill=(69, 90, 100))
        draw.text((312, y + 24), str(value), font=_font(27, bold=True), fill=(20, 40, 30))
        y += 68

    if fields.full_name_ur:
        draw.text((width - 470, 176), fields.full_name_ur, font=_font(30, urdu=True), fill=(20, 40, 30))

    if include_qr and qr_payload is not None:
        qr_img = _qr_image(qr_payload)
        qr_img = qr_img.resize((300, 300), Image.NEAREST)
        img.paste(qr_img, (width - 336, height - 336))
        draw.rectangle([width - 340, height - 340, width - 32, height - 32], outline=(27, 94, 32), width=3)
        draw.text((width - 336, height - 30), "Scan to verify (mock signature)", font=_font(15), fill=(69, 90, 100))

    draw.text((36, height - 40), WATERMARK_TEXT_UR, font=_font(20, urdu=True), fill=(153, 27, 27))
    _draw_watermark(img)
    return img.convert("RGB")


def render_death_certificate(
    fields: SpecimenFields,
    *,
    qr_payload: dict[str, Any] | None = None,
    include_qr: bool = True,
    size: tuple[int, int] = (900, 1200),
) -> Image.Image:
    """Render a mock certificate of death."""
    width, height = size
    img = Image.new("RGBA", size, (250, 250, 245, 255))
    draw = ImageDraw.Draw(img)
    draw.rectangle([24, 24, width - 24, height - 24], outline=(27, 94, 32), width=4)
    _banner(draw, width)

    draw.text((60, 96), "GOVERNMENT OF SINDH (SIMULATED)", font=_font(28, bold=True), fill=(27, 94, 32))
    draw.text((60, 132), "Union Council Thatta - Mock Civil Registration Office", font=_font(18), fill=(69, 90, 100))
    draw.text((60, 176), "CERTIFICATE OF DEATH", font=_font(38, bold=True), fill=(20, 40, 30))
    draw.text((60, 226), "وفات کا سرٹیفکیٹ (نقلی)", font=_font(30, urdu=True), fill=(20, 40, 30))
    draw.line([(60, 276), (width - 60, 276)], fill=(27, 94, 32), width=2)

    rows = [
        ("Certificate No.", fields.certificate_no),
        ("Name of Deceased", fields.full_name),
        ("CNIC of Deceased", _format_cnic(fields.cnic) if fields.cnic else "-"),
        ("Date of Death", fields.death_date),
        ("Name of Spouse", fields.spouse_name),
        ("CNIC of Spouse", _format_cnic(fields.spouse_cnic) if fields.spouse_cnic else "-"),
        ("District", fields.district),
        ("Registered On", fields.dob),
    ]
    y = 306
    for label, value in rows:
        draw.text((60, y), label, font=_font(19), fill=(69, 90, 100))
        draw.text((60, y + 26), str(value or "-"), font=_font(26, bold=True), fill=(20, 40, 30))
        y += 78

    if include_qr and qr_payload is not None:
        qr_img = _qr_image(qr_payload).resize((280, 280), Image.NEAREST)
        img.paste(qr_img, (width - 330, height - 400))
        draw.rectangle([width - 334, height - 404, width - 46, height - 116], outline=(27, 94, 32), width=3)
        draw.text((width - 330, height - 110), "Scan to verify (mock signature)", font=_font(15), fill=(69, 90, 100))

    draw.text((60, height - 96), "Registrar (Mock) - specimen only", font=_font(18), fill=(69, 90, 100))
    draw.text((60, height - 60), WATERMARK_TEXT_UR, font=_font(20, urdu=True), fill=(153, 27, 27))
    _draw_watermark(img)
    return img.convert("RGB")


def render_scam_screenshot(*, size: tuple[int, int] = (720, 1180)) -> Image.Image:
    """Render a mock SMS/WhatsApp screenshot of a fake Rs 25,000 relief scam."""
    width, height = size
    img = Image.new("RGB", size, (236, 229, 221))
    draw = ImageDraw.Draw(img)
    draw.rectangle([0, 0, width, 96], fill=(7, 94, 84))
    draw.text((24, 26), "SMS - 0300 9999999", font=_font(26, bold=True), fill="white")
    draw.text((24, 62), "SIMULATED MESSAGE (MOCK SPECIMEN)", font=_font(16), fill=(209, 250, 229))

    bubble = [
        "MUHTARAM!",
        "Sarkari Relief Program se aap ko Rs 25,000",
        "milne wale hain. Aaj aakhri din hai!",
        "",
        "Registration fee sirf Rs 500 EasyPaisa",
        "number 0300-9999999 par bhejen.",
        "",
        "Apna CNIC number aur OTP code bhi",
        "share karen taake account block na ho.",
        "",
        "Fori rabta: 0300-9999999",
        "http://bit.ly/relief-25000",
    ]
    y = 140
    draw.rounded_rectangle([24, y - 16, width - 24, y + 34 * len(bubble) + 24], radius=18, fill=(255, 255, 255))
    for line in bubble:
        draw.text((44, y), line, font=_font(22), fill=(30, 30, 30))
        y += 34
    draw.text((24, height - 120), "MOCK SPECIMEN - NOT AN OFFICIAL DOCUMENT", font=_font(18, bold=True), fill=(153, 27, 27))
    draw.text((24, height - 88), "Synthetic scam sample for the Haqdaar prototype", font=_font(16), fill=(90, 90, 90))
    _draw_watermark(img)
    return img


# --------------------------------------------------------------------------- #
# degradations
# --------------------------------------------------------------------------- #
def degrade_whatsapp(img: Image.Image, *, seed: int = GENERATOR_SEED) -> Image.Image:
    """Rotate 3°, JPEG q45 round-trip and mild sensor noise (genuine, not forged)."""
    rotated = img.rotate(3, resample=Image.BICUBIC, expand=True, fillcolor=(255, 255, 255))
    buffer = io.BytesIO()
    rotated.save(buffer, format="JPEG", quality=45, optimize=False)
    buffer.seek(0)
    recompressed = Image.open(buffer).convert("RGB")

    rng = np.random.default_rng(seed)
    array = np.asarray(recompressed, dtype=np.float32)
    noise = rng.normal(0.0, 5.0, array.shape)
    noisy = np.clip(array + noise, 0, 255).astype(np.uint8)
    return Image.fromarray(noisy, mode="RGB")


def degrade_blur(img: Image.Image, *, radius: float = 6.0) -> Image.Image:
    """Gaussian blur strong enough to fail the Laplacian sharpness gate."""
    return img.filter(ImageFilter.GaussianBlur(radius=radius))


def obscure_qr(img: Image.Image) -> Image.Image:
    """Paint over the QR area so no code can be decoded (UNVERIFIABLE, not tamper)."""
    out = img.copy()
    draw = ImageDraw.Draw(out)
    width, height = out.size
    draw.rectangle([width - 350, height - 350, width - 20, height - 20], fill=(58, 58, 58))
    draw.text((width - 330, height - 200), "QR unreadable", font=_font(22, bold=True), fill=(200, 200, 200))
    return out


# --------------------------------------------------------------------------- #
# fixtures
# --------------------------------------------------------------------------- #
FATIMA = SpecimenFields(
    cnic="9990010000012",
    full_name="Fatima Bibi",
    full_name_ur="فاطمہ بی بی",
    father_or_spouse_name="Ghulam Rasool",
    dob="1974-05-14",
    district="Thatta",
    expiry="2030-08-01",
    marital_status="WIDOWED",
)

GHULAM_RASOOL = SpecimenFields(
    cnic="9990010000104",
    full_name="Ghulam Rasool",
    full_name_ur="غلام رسول",
    father_or_spouse_name="Allah Ditta",
    dob="1968-02-03",
    district="Thatta",
    marital_status="MARRIED",
    certificate_no="THT-DTH-2025-004417",
    death_date="2025-03-11",
    spouse_cnic="9990010000012",
    spouse_name="Fatima Bibi",
)


def _fatima_qr() -> dict[str, Any]:
    return build_payload(
        doc_type="CNIC_FRONT",
        cnic=FATIMA.cnic,
        full_name=FATIMA.full_name,
        dob=FATIMA.dob,
        issuer=ISSUER_CNIC,
    )


def _death_qr() -> dict[str, Any]:
    return build_payload(
        doc_type="SPOUSE_DEATH_CERTIFICATE",
        cnic=GHULAM_RASOOL.cnic,
        full_name=GHULAM_RASOOL.full_name,
        dob=GHULAM_RASOOL.dob,
        issuer=ISSUER_DEATH,
    )


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _save(img: Image.Image, path: Path, *, quality: int = 92) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path, format="JPEG", quality=quality, optimize=True)


def _printed_fields(fields: SpecimenFields, *, printed_name: str | None = None) -> dict[str, Any]:
    return {
        "cnic": fields.cnic,
        "full_name": printed_name or fields.full_name,
        "dob": fields.dob,
    }


# --------------------------------------------------------------------------- #
# demo pack
# --------------------------------------------------------------------------- #
def generate_demo_docs(*, force: bool = False) -> dict[str, Any]:
    """Generate the 7-file demo upload pack + ``manifest.json``."""
    DEMO_DOCS_DIR.mkdir(parents=True, exist_ok=True)
    manifest_path = DEMO_DOCS_DIR / "manifest.json"
    if manifest_path.exists() and not force:
        return json.loads(manifest_path.read_text(encoding="utf-8"))

    entries: list[dict[str, Any]] = []

    def record(
        filename: str,
        *,
        label: str,
        expected_verdict: str,
        doc_type: str,
        printed: dict[str, Any] | None,
        qr_payload: dict[str, Any] | None,
        notes: str,
        raw_text: str | None = None,
    ) -> None:
        path = DEMO_DOCS_DIR / filename
        entries.append(
            {
                "file": filename,
                "label": label,
                "doc_type": doc_type,
                "expected_verdict": expected_verdict,
                "sha256": _sha256(path),
                "printed_fields": printed,
                "qr_payload": qr_payload,
                "raw_text": raw_text,
                "notes": notes,
            }
        )

    genuine = render_cnic_card(FATIMA, qr_payload=_fatima_qr())
    _save(genuine, DEMO_DOCS_DIR / "fatima_cnic_genuine.jpg")
    record(
        "fatima_cnic_genuine.jpg",
        label="GENUINE_CLEAN",
        expected_verdict="VERIFIED",
        doc_type="CNIC_FRONT",
        printed=_printed_fields(FATIMA),
        qr_payload=_fatima_qr(),
        notes="Clean specimen card; signed QR matches printed text.",
    )

    compressed = degrade_whatsapp(genuine)
    _save(compressed, DEMO_DOCS_DIR / "fatima_cnic_whatsapp_compressed.jpg", quality=45)
    record(
        "fatima_cnic_whatsapp_compressed.jpg",
        label="GENUINE_COMPRESSED",
        expected_verdict="VERIFIED",
        doc_type="CNIC_FRONT",
        printed=_printed_fields(FATIMA),
        qr_payload=_fatima_qr(),
        notes="Rotated 3°, JPEG q45, mild noise - must stay VERIFIED (0% false tamper).",
    )

    blurry = degrade_blur(genuine)
    _save(blurry, DEMO_DOCS_DIR / "fatima_cnic_blurry.jpg")
    record(
        "fatima_cnic_blurry.jpg",
        label="BLURRY",
        expected_verdict="NEEDS_RETAKE",
        doc_type="CNIC_FRONT",
        printed=_printed_fields(FATIMA),
        qr_payload=_fatima_qr(),
        notes=f"Gaussian blur; Laplacian variance {_laplacian_var(blurry):.1f} (< 65.0).",
    )

    forged = render_cnic_card(FATIMA, printed_name="Zainab Bibi", qr_payload=_fatima_qr())
    _save(forged, DEMO_DOCS_DIR / "fatima_cnic_forged_name.jpg")
    record(
        "fatima_cnic_forged_name.jpg",
        label="FORGED",
        expected_verdict="TAMPER_SUSPECTED",
        doc_type="CNIC_FRONT",
        printed=_printed_fields(FATIMA, printed_name="Zainab Bibi"),
        qr_payload=_fatima_qr(),
        notes="Valid signed QR for Fatima Bibi, printed name altered to Zainab Bibi.",
    )

    no_qr = obscure_qr(genuine)
    _save(no_qr, DEMO_DOCS_DIR / "fatima_cnic_no_qr.jpg")
    record(
        "fatima_cnic_no_qr.jpg",
        label="NO_QR",
        expected_verdict="UNVERIFIABLE",
        doc_type="CNIC_FRONT",
        printed=_printed_fields(FATIMA),
        qr_payload=None,
        notes="QR obscured - UNVERIFIABLE, never TAMPER_SUSPECTED.",
    )

    death = render_death_certificate(GHULAM_RASOOL, qr_payload=_death_qr())
    _save(death, DEMO_DOCS_DIR / "ghulam_rasool_death_cert_genuine.jpg")
    record(
        "ghulam_rasool_death_cert_genuine.jpg",
        label="GENUINE_CLEAN",
        expected_verdict="VERIFIED",
        doc_type="SPOUSE_DEATH_CERTIFICATE",
        printed={
            "cnic": GHULAM_RASOOL.cnic,
            "full_name": GHULAM_RASOOL.full_name,
            "dob": GHULAM_RASOOL.dob,
        },
        qr_payload=_death_qr(),
        notes="Genuine mock death certificate for Ghulam Rasool.",
    )

    scam = render_scam_screenshot()
    _save(scam, DEMO_DOCS_DIR / "scam_sms_screenshot.jpg")
    record(
        "scam_sms_screenshot.jpg",
        label="SCAM_SCREENSHOT",
        expected_verdict="LIKELY_SCAM",
        doc_type="OTHER",
        printed=None,
        qr_payload=None,
        notes="Fake Rs 25,000 relief SMS asking for a Rs 500 fee, CNIC and OTP.",
        raw_text=(
            "MUHTARAM! Sarkari Relief Program se aap ko Rs 25,000 milne wale hain. "
            "Aaj aakhri din hai! Registration fee sirf Rs 500 EasyPaisa number "
            "0300-9999999 par bhejen. Apna CNIC number aur OTP code bhi share karen "
            "taake account block na ho. Fori rabta: 0300-9999999 http://bit.ly/relief-25000"
        ),
    )

    manifest = {
        "generated_at": datetime.now(UTC).isoformat(),
        "watermark": WATERMARK_TEXT,
        "generator_seed": GENERATOR_SEED,
        "count": len(entries),
        "files": entries,
    }
    manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")
    return manifest


# --------------------------------------------------------------------------- #
# labelled benchmark
# --------------------------------------------------------------------------- #
_EVAL_PEOPLE: tuple[tuple[str, str, str, str], ...] = (
    ("9990010000012", "Fatima Bibi", "1974-05-14", "Thatta"),
    ("9990010000043", "Sakina Bibi", "1980-09-02", "Badin"),
    ("9990010000051", "Zainab Bibi", "1971-12-19", "Thatta"),
    ("9990010000068", "Mariam Bibi", "1985-04-27", "Hyderabad"),
    ("9990010000076", "Khadija Bibi", "1978-07-08", "Sukkur"),
    ("9990010000084", "Amina Bibi", "1969-01-30", "Dadu"),
    ("9990010000092", "Haleema Bibi", "1983-11-11", "Badin"),
    ("9990010000109", "Rukhsana Bibi", "1976-06-05", "Thatta"),
    ("9990010000117", "Nasreen Bibi", "1988-03-22", "Umerkot"),
    ("9990010000125", "Shahida Bibi", "1973-10-14", "Mirpurkhas"),
    ("9990010000133", "Razia Bibi", "1981-08-09", "Larkana"),
    ("9990010000141", "Parveen Bibi", "1979-05-25", "Tharparkar"),
)


def _eval_specimen(index: int) -> tuple[SpecimenFields, dict[str, Any]]:
    cnic, name, dob, district = _EVAL_PEOPLE[index % len(_EVAL_PEOPLE)]
    fields = SpecimenFields(
        cnic=cnic,
        full_name=name,
        full_name_ur="",
        father_or_spouse_name="Muhammad Ismail",
        dob=dob,
        district=district,
        expiry="2031-01-01",
        marital_status="WIDOWED",
    )
    payload = build_payload(
        doc_type="CNIC_FRONT", cnic=cnic, full_name=name, dob=dob, issuer=ISSUER_CNIC
    )
    return fields, payload


def generate_doc_eval_set(*, force: bool = False) -> dict[str, Any]:
    """Generate the 30-image labelled benchmark + ``manifest.json``.

    Composition (docs/07 §5.2): 12 ``GENUINE_CLEAN``, 8 ``GENUINE_COMPRESSED``,
    5 ``BLURRY``, 5 ``FORGED``.
    """
    DOC_EVAL_DIR.mkdir(parents=True, exist_ok=True)
    manifest_path = DOC_EVAL_DIR / "manifest.json"
    if manifest_path.exists() and not force:
        return json.loads(manifest_path.read_text(encoding="utf-8"))

    entries: list[dict[str, Any]] = []
    counter = 0

    def emit(
        img: Image.Image,
        *,
        label: str,
        expected_verdict: str,
        fields: SpecimenFields,
        printed_name: str | None,
        qr_payload: dict[str, Any] | None,
        notes: str,
        quality: int = 92,
    ) -> None:
        nonlocal counter
        counter += 1
        filename = f"eval_{counter:03d}_{label.lower()}.jpg"
        path = DOC_EVAL_DIR / filename
        _save(img, path, quality=quality)
        entries.append(
            {
                "file": filename,
                "label": label,
                "doc_type": "CNIC_FRONT",
                "expected_verdict": expected_verdict,
                "sha256": _sha256(path),
                "printed_fields": {
                    "cnic": fields.cnic,
                    "full_name": printed_name or fields.full_name,
                    "dob": fields.dob,
                },
                "qr_payload": qr_payload,
                "laplacian_var": round(_laplacian_var(img), 2),
                "notes": notes,
            }
        )

    # 12 GENUINE_CLEAN
    for i in range(12):
        fields, payload = _eval_specimen(i)
        img = render_cnic_card(fields, qr_payload=payload)
        emit(
            img,
            label="GENUINE_CLEAN",
            expected_verdict="VERIFIED",
            fields=fields,
            printed_name=None,
            qr_payload=payload,
            notes="Sharp specimen card, signed QR matches printed text.",
        )

    # 8 GENUINE_COMPRESSED (WhatsApp-style degradation, still genuine)
    for i in range(8):
        fields, payload = _eval_specimen(i + 12)
        img = render_cnic_card(fields, qr_payload=payload)
        degraded = degrade_whatsapp(img, seed=GENERATOR_SEED + i)
        emit(
            degraded,
            label="GENUINE_COMPRESSED",
            expected_verdict="VERIFIED",
            fields=fields,
            printed_name=None,
            qr_payload=payload,
            notes="Rotated 3°, JPEG q45, noise - genuine photo of a genuine card.",
            quality=45,
        )

    # 5 BLURRY
    for i in range(5):
        fields, payload = _eval_specimen(i + 20)
        img = render_cnic_card(fields, qr_payload=payload)
        blurred = degrade_blur(img, radius=6.0 + 0.4 * i)
        emit(
            blurred,
            label="BLURRY",
            expected_verdict="NEEDS_RETAKE",
            fields=fields,
            printed_name=None,
            qr_payload=payload,
            notes="Out-of-focus capture - retake guidance, never a tamper verdict.",
        )

    # 5 FORGED: 3 name-forged with a valid signature, 2 with a broken signature
    for i in range(3):
        fields, payload = _eval_specimen(i + 25)
        fake_name = ["Zainab Bibi", "Sakina Bibi", "Nasreen Bibi"][i]
        img = render_cnic_card(fields, printed_name=fake_name, qr_payload=payload)
        emit(
            img,
            label="FORGED",
            expected_verdict="TAMPER_SUSPECTED",
            fields=fields,
            printed_name=fake_name,
            qr_payload=payload,
            notes=f"Printed name '{fake_name}' edited over a valid signed QR for '{fields.full_name}'.",
        )

    for i in range(2):
        fields, payload = _eval_specimen(i + 28)
        broken = dict(payload)
        broken["sig"] = ("0" * 8) + payload["sig"][8:]
        img = render_cnic_card(fields, qr_payload=broken)
        emit(
            img,
            label="FORGED",
            expected_verdict="TAMPER_SUSPECTED",
            fields=fields,
            printed_name=None,
            qr_payload=broken,
            notes="QR payload carries an invalid HMAC signature.",
        )

    entries.sort(key=lambda item: item["file"])

    manifest = {
        "generated_at": datetime.now(UTC).isoformat(),
        "watermark": WATERMARK_TEXT,
        "generator_seed": GENERATOR_SEED,
        "count": len(entries),
        "label_counts": {
            label: sum(1 for e in entries if e["label"] == label)
            for label in ("GENUINE_CLEAN", "GENUINE_COMPRESSED", "BLURRY", "FORGED")
        },
        "images": entries,
    }
    manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")
    return manifest


def generate_all(*, force: bool = False) -> dict[str, Any]:
    """Generate both the demo pack and the labelled benchmark."""
    demo = generate_demo_docs(force=force)
    bench = generate_doc_eval_set(force=force)
    return {"demo_docs": demo["count"], "doc_eval_set": bench["count"]}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Generate synthetic specimen documents.")
    parser.add_argument("--force", action="store_true", help="regenerate existing files")
    args = parser.parse_args(argv)
    summary = generate_all(force=args.force)
    print(json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
