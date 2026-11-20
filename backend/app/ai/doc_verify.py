"""Document verification: four checks, honest verdicts (docs/07 §5).

The pipeline is deliberately ordered so that **image degradation can never be
mistaken for forgery**:

1. **Image quality** — Laplacian variance and minimum dimension. Fails to
   ``NEEDS_RETAKE`` with spoken Urdu/English guidance.
2. **Signed QR** — multi-scale ``cv2.QRCodeDetector`` then HMAC-SHA256 over the
   canonical payload. No QR at all → ``UNVERIFIABLE`` (never tamper). A QR that
   decodes but fails HMAC → ``TAMPER_SUSPECTED``.
3. **Printed-text OCR** — via :class:`AIProvider`. If the provider is
   unavailable the verdict is ``UNVERIFIABLE``; we never guess.
4. **Cross-check** — exact 13-digit CNIC match plus ``name_sim >= 0.80`` between
   the printed text and the signed QR. A legible mismatch is the only semantic
   route to ``TAMPER_SUSPECTED``.

``verify_document(db, document_id)`` is the frozen entry point the backend's
sync endpoint calls; it updates the ``documents`` row, writes the
``document.verified`` audit event and an ``AGENT_STEP`` case note, and returns a
JSON-serialisable DTO.
"""

from __future__ import annotations

import hashlib
import logging
import os
import re
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Sequence

from app.ai import guardrails, qr_sign
from app.ai.provider import OCRResult, get_provider, telemetry

logger = logging.getLogger("haqdaar.ai.doc_verify")

#: docs/07 §5.1 thresholds — frozen.
LAPLACIAN_THRESHOLD = 65.0
MIN_DIMENSION = 320
NAME_SIMILARITY_THRESHOLD = 0.80

VERIFIED = "VERIFIED"
NEEDS_RETAKE = "NEEDS_RETAKE"
TAMPER_SUSPECTED = "TAMPER_SUSPECTED"
UNVERIFIABLE = "UNVERIFIABLE"

SUPPORTED_DOC_TYPES = ("CNIC_FRONT", "SPOUSE_DEATH_CERTIFICATE", "OTHER")

RETAKE_REASON_EN = "Hold the phone steady in good light and take the photo again."
RETAKE_REASON_UR = "فون کو دونوں ہاتھوں سے سہارا دے کر اچھی روشنی میں دوبارہ تصویر لیں۔"

UNVERIFIABLE_REASON_EN = (
    "We could not read the security code on this document. Please upload a clearer photo."
)
UNVERIFIABLE_REASON_UR = (
    "ہم اس دستاویز کا سیکیورٹی کوڈ نہیں پڑھ سکے۔ براہ کرم زیادہ واضح تصویر اپ لوڈ کریں۔"
)


# --------------------------------------------------------------------------- #
# result types
# --------------------------------------------------------------------------- #
@dataclass
class CheckResult:
    check: str
    passed: bool
    value: Any
    threshold: Any
    detail: str

    def as_dict(self) -> dict[str, Any]:
        return {
            "check": self.check,
            "passed": self.passed,
            "value": self.value,
            "threshold": self.threshold,
            "detail": self.detail,
        }


@dataclass
class DocVerification:
    status: str
    confidence: float
    checks: list[CheckResult] = field(default_factory=list)
    extracted_fields: dict[str, Any] = field(default_factory=dict)
    retake_reason_en: str | None = None
    retake_reason_ur: str | None = None
    doc_type: str = "CNIC_FRONT"

    @property
    def verified(self) -> bool:
        return self.status == VERIFIED

    def as_dict(self) -> dict[str, Any]:
        return {
            "verify_status": self.status,
            "verify_confidence": round(self.confidence, 3),
            "verify_checks": [check.as_dict() for check in self.checks],
            "extracted_fields": self.extracted_fields,
            "retake_reason_en": self.retake_reason_en,
            "retake_reason_ur": self.retake_reason_ur,
            "doc_type": self.doc_type,
        }


# --------------------------------------------------------------------------- #
# check 1 — image quality
# --------------------------------------------------------------------------- #
def _decode_image(image_bytes: bytes) -> Any:
    try:
        import cv2  # type: ignore
        import numpy as np  # type: ignore
    except Exception as exc:  # pragma: no cover - opencv is a hard dependency
        raise RuntimeError(f"opencv/numpy unavailable: {exc}") from exc

    buffer = np.frombuffer(image_bytes, dtype=np.uint8)
    return cv2.imdecode(buffer, cv2.IMREAD_COLOR)


def check_image_quality(image_bytes: bytes) -> tuple[CheckResult, Any]:
    """Laplacian variance + minimum dimension. Returns the decoded image too."""
    try:
        import cv2  # type: ignore
    except Exception:  # pragma: no cover
        return (
            CheckResult(
                "image_quality",
                False,
                {"laplacian_var": None, "width": None, "height": None},
                {"laplacian_var": LAPLACIAN_THRESHOLD, "min_dimension": MIN_DIMENSION},
                "opencv unavailable — cannot assess quality",
            ),
            None,
        )

    image = _decode_image(image_bytes)
    if image is None:
        return (
            CheckResult(
                "image_quality",
                False,
                {"laplacian_var": 0.0, "width": 0, "height": 0},
                {"laplacian_var": LAPLACIAN_THRESHOLD, "min_dimension": MIN_DIMENSION},
                "image could not be decoded",
            ),
            None,
        )

    height, width = image.shape[:2]
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    variance = float(cv2.Laplacian(gray, cv2.CV_64F).var())
    sharp_enough = variance >= LAPLACIAN_THRESHOLD
    big_enough = min(width, height) >= MIN_DIMENSION
    passed = sharp_enough and big_enough

    if not sharp_enough:
        detail = f"image is blurry (laplacian variance {variance:.1f} < {LAPLACIAN_THRESHOLD})"
    elif not big_enough:
        detail = f"image is too small ({width}x{height}, minimum side {MIN_DIMENSION}px)"
    else:
        detail = f"sharp and large enough ({variance:.1f}, {width}x{height})"

    return (
        CheckResult(
            "image_quality",
            passed,
            {"laplacian_var": round(variance, 2), "width": width, "height": height},
            {"laplacian_var": LAPLACIAN_THRESHOLD, "min_dimension": MIN_DIMENSION},
            detail,
        ),
        image,
    )


# --------------------------------------------------------------------------- #
# check 2 — signed QR
# --------------------------------------------------------------------------- #
def _qr_candidates(image: Any) -> list[Any]:
    """Decode at several scales — cheap phones produce small QR modules."""
    import cv2  # type: ignore

    detector = cv2.QRCodeDetector()
    payloads: list[Any] = []

    def attempt(candidate: Any) -> None:
        try:
            data, _, _ = detector.detectAndDecode(candidate)
        except Exception:  # pragma: no cover - opencv edge cases
            return
        if data:
            payloads.append(data)

    attempt(image)
    if payloads:
        return payloads

    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    attempt(gray)

    for scale in (0.5, 0.75, 1.5, 2.0, 3.0):
        if payloads:
            break
        resized = cv2.resize(
            gray, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC if scale > 1 else cv2.INTER_AREA
        )
        attempt(resized)

    if not payloads:
        # Last resort: adaptive threshold helps with glare and uneven lighting.
        try:
            thresh = cv2.adaptiveThreshold(
                gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 31, 5
            )
            attempt(thresh)
        except Exception:  # pragma: no cover
            pass

    return payloads


def check_qr(image: Any) -> tuple[CheckResult, dict[str, Any] | None]:
    """Decode the QR and verify its HMAC. Returns the payload when valid."""
    if image is None:
        return (
            CheckResult(
                "qr_signature",
                False,
                "no_image",
                "valid_hmac",
                "no decodable image — QR not checked",
            ),
            None,
        )

    payloads = _qr_candidates(image)
    if not payloads:
        return (
            CheckResult(
                "qr_signature",
                False,
                "no_qr",
                "valid_hmac",
                "no QR code found — cannot verify authenticity (not treated as tampering)",
            ),
            None,
        )

    for raw in payloads:
        parsed = qr_sign.parse_payload(raw)
        if parsed is None:
            continue
        if qr_sign.verify_payload(parsed):
            return (
                CheckResult(
                    "qr_signature",
                    True,
                    "valid",
                    "valid_hmac",
                    f"signed QR verified for issuer {parsed.get('issuer')}",
                ),
                parsed,
            )
        return (
            CheckResult(
                "qr_signature",
                False,
                "invalid_hmac",
                "valid_hmac",
                "QR decoded but its signature does not match — the payload was altered",
            ),
            None,
        )

    return (
        CheckResult(
            "qr_signature",
            False,
            "unparseable_qr",
            "valid_hmac",
            "a QR code was found but it is not a Haqdaar specimen payload",
        ),
        None,
    )


# --------------------------------------------------------------------------- #
# check 3 — OCR
# --------------------------------------------------------------------------- #
def check_ocr(image_bytes: bytes, doc_type: str) -> tuple[CheckResult, OCRResult]:
    provider = get_provider()
    try:
        result = provider.ocr_document(image_bytes, doc_type)
    except Exception as exc:  # pragma: no cover - provider already falls back
        logger.warning("OCR provider failed: %s", exc)
        result = OCRResult(fields={}, confidence=0.0, available=False)

    if not result.available or not result.fields:
        return (
            CheckResult(
                "ocr_extraction",
                False,
                "unavailable",
                "fields_extracted",
                "printed text could not be read — verdict degrades to UNVERIFIABLE",
            ),
            result,
        )

    return (
        CheckResult(
            "ocr_extraction",
            True,
            {"fields": sorted(result.fields), "confidence": round(result.confidence, 3)},
            "fields_extracted",
            f"read {len(result.fields)} field(s) from the printed card",
        ),
        result,
    )


# --------------------------------------------------------------------------- #
# check 4 — cross-check
# --------------------------------------------------------------------------- #
#: Honorifics that carry no identity signal and must not inflate a match.
_HONORIFICS = {
    "mst",
    "mst.",
    "mrs",
    "mrs.",
    "mr",
    "mr.",
    "ms",
    "ms.",
    "miss",
    "syed",
    "syeda",
    "sayed",
    "shaikh",
    "sheikh",
    "haji",
    "hajji",
    "molvi",
    "maulvi",
    "sahib",
    "sahiba",
    "بی بی",
    "بیگم",
    "میاں",
    "سید",
    "سیدہ",
}


def _normalize_name(value: str) -> str:
    text = re.sub(r"[^\w\u0600-\u06ff\s]", " ", (value or "").lower())
    words = [word for word in text.split() if word and word not in _HONORIFICS]
    return " ".join(words)


def _ratio(a: str, b: str) -> float:
    if not a or not b:
        return 0.0
    try:
        from rapidfuzz.fuzz import ratio

        return round(ratio(a, b) / 100.0, 4)
    except Exception:  # pragma: no cover
        import difflib

        return round(difflib.SequenceMatcher(None, a, b).ratio(), 4)


def name_similarity(a: str, b: str) -> float:
    """Normalised name similarity for the printed-vs-signed cross-check.

    Uses ``app.engine.entity_resolution.name_sim`` when EN has landed, then
    guards it with the given-name comparison. The guard matters because the demo
    cast shares a surname (``Bibi``): ``"Zainab Bibi"`` vs ``"Sakina Bibi"``
    scores 0.82 on the full string, which would let a Photoshopped given name
    through. Taking the minimum of the full-string and given-name scores keeps
    the docs/07 §5.1 ``>= 0.80`` threshold honest.
    """
    left = _normalize_name(a)
    right = _normalize_name(b)
    if not left or not right:
        return 0.0

    full = _ratio(left, right)
    try:  # pragma: no cover - depends on EN landing
        from app.engine.entity_resolution import name_sim  # type: ignore

        full = max(full, float(name_sim(a, b)))
    except Exception:
        pass

    left_given = left.split()[0]
    right_given = right.split()[0]
    given = _ratio(left_given, right_given)
    return round(min(full, given), 4)


def _digits(value: Any) -> str:
    return "".join(ch for ch in str(value or "") if ch.isdigit())


def check_cross_reference(
    ocr: OCRResult, qr_payload: dict[str, Any] | None
) -> CheckResult:
    """Printed text must agree with the signed QR."""
    if qr_payload is None:
        return CheckResult(
            "ocr_vs_qr",
            False,
            "no_signed_qr",
            {"cnic_match": True, "name_similarity": NAME_SIMILARITY_THRESHOLD},
            "no signed QR to compare against",
        )

    printed_cnic = _digits(ocr.fields.get("cnic"))
    signed_cnic = _digits(qr_payload.get("cnic"))
    cnic_match = bool(printed_cnic) and printed_cnic == signed_cnic

    printed_name = str(ocr.fields.get("full_name") or "").strip()
    signed_name = str(qr_payload.get("full_name") or "").strip()
    similarity = name_similarity(printed_name, signed_name) if printed_name and signed_name else 0.0
    name_match = similarity >= NAME_SIMILARITY_THRESHOLD

    passed = cnic_match and name_match
    if passed:
        detail = "printed text matches the signed QR payload"
    elif not cnic_match:
        detail = (
            f"printed CNIC {printed_cnic or '(unreadable)'} does not match the signed "
            f"CNIC {signed_cnic or '(missing)'}"
        )
    else:
        detail = (
            f"printed name '{printed_name}' does not match the signed name "
            f"'{signed_name}' (similarity {similarity:.2f} < {NAME_SIMILARITY_THRESHOLD})"
        )

    return CheckResult(
        "ocr_vs_qr",
        passed,
        {"cnic_match": cnic_match, "name_similarity": round(similarity, 3)},
        {"cnic_match": True, "name_similarity": NAME_SIMILARITY_THRESHOLD},
        detail,
    )


# --------------------------------------------------------------------------- #
# the pipeline
# --------------------------------------------------------------------------- #
def verify_image(image_bytes: bytes, doc_type: str = "CNIC_FRONT") -> DocVerification:
    """Run all four checks on raw bytes. Pure: no DB, no side effects."""
    checks: list[CheckResult] = []

    quality, image = check_image_quality(image_bytes)
    checks.append(quality)
    if not quality.passed:
        return DocVerification(
            status=NEEDS_RETAKE,
            confidence=0.0,
            checks=checks,
            retake_reason_en=RETAKE_REASON_EN,
            retake_reason_ur=RETAKE_REASON_UR,
            doc_type=doc_type,
        )

    qr_check, qr_payload = check_qr(image)
    checks.append(qr_check)
    if qr_check.value == "no_qr" or qr_check.value == "unparseable_qr":
        return DocVerification(
            status=UNVERIFIABLE,
            confidence=0.0,
            checks=checks,
            extracted_fields={"qr_payload": None},
            retake_reason_en=UNVERIFIABLE_REASON_EN,
            retake_reason_ur=UNVERIFIABLE_REASON_UR,
            doc_type=doc_type,
        )
    if not qr_check.passed:
        return DocVerification(
            status=TAMPER_SUSPECTED,
            confidence=0.10,
            checks=checks,
            extracted_fields={"qr_payload": None},
            doc_type=doc_type,
        )

    ocr_check, ocr = check_ocr(image_bytes, doc_type)
    checks.append(ocr_check)
    if not ocr_check.passed:
        return DocVerification(
            status=UNVERIFIABLE,
            confidence=0.0,
            checks=checks,
            extracted_fields={"qr_payload": qr_payload},
            retake_reason_en=UNVERIFIABLE_REASON_EN,
            retake_reason_ur=UNVERIFIABLE_REASON_UR,
            doc_type=doc_type,
        )

    cross = check_cross_reference(ocr, qr_payload)
    checks.append(cross)

    extracted = {
        "cnic": _digits(ocr.fields.get("cnic")) or None,
        "full_name": ocr.fields.get("full_name"),
        "dob": ocr.fields.get("dob"),
        "qr_payload": qr_payload,
        "ocr_fields": dict(ocr.fields),
    }

    if not cross.passed:
        return DocVerification(
            status=TAMPER_SUSPECTED,
            confidence=0.10,
            checks=checks,
            extracted_fields=extracted,
            doc_type=doc_type,
        )

    confidence = round(min(0.97, 0.55 + 0.25 * ocr.confidence + 0.20), 3)
    return DocVerification(
        status=VERIFIED,
        confidence=confidence,
        checks=checks,
        extracted_fields=extracted,
        doc_type=doc_type,
    )


# --------------------------------------------------------------------------- #
# DB wiring
# --------------------------------------------------------------------------- #
def _metadata() -> Any:
    from app.db import Base  # type: ignore

    return Base.metadata


def _table(name: str) -> Any:
    table = _metadata().tables.get(name)
    if table is None:
        raise RuntimeError(f"table '{name}' is missing from the application metadata")
    return table


def upload_dir() -> Path:
    try:  # pragma: no cover - depends on A1 landing
        from app.config import settings  # type: ignore

        value = getattr(settings, "UPLOAD_DIR", None)
        if value:
            return Path(str(value))
    except Exception:
        pass
    return Path(os.environ.get("UPLOAD_DIR", str(Path(__file__).resolve().parent.parent / "uploads")))


def _resolve_path(storage_path: str) -> Path:
    candidate = Path(storage_path)
    if candidate.is_absolute() and candidate.exists():
        return candidate
    return upload_dir() / storage_path


def _record_audit(db: Any, *, tenant_id: Any, document_id: Any, payload: dict[str, Any]) -> None:
    try:  # pragma: no cover - depends on A1 landing
        from app.security import audit as audit_module  # type: ignore

        audit_module.record(
            db,
            tenant_id=tenant_id,
            actor_type="AI",
            actor_id="doc_verify",
            actor_role="AI",
            action="document.verified",
            resource_type="document",
            resource_id=str(document_id),
            payload_json=payload,
        )
    except Exception as exc:  # pragma: no cover
        logger.warning("document.verified audit skipped: %s", exc)


def _write_case_note(
    db: Any,
    *,
    tenant_id: Any,
    case_id: Any,
    document_id: Any,
    verification: DocVerification,
) -> None:
    if case_id is None:
        return
    try:
        table = _table("case_notes")
    except Exception:  # pragma: no cover
        return

    body_en = (
        f"Document {document_id} verified as {verification.status} "
        f"(confidence {verification.confidence:.2f})."
    )
    row = {
        "id": uuid.uuid4(),
        "tenant_id": tenant_id,
        "case_id": case_id,
        "author_user_id": None,
        "note_type": "AGENT_STEP",
        "body": body_en,
        "metadata_json": {
            "step": "verify_document",
            "document_id": str(document_id),
            "verify_status": verification.status,
            "verify_confidence": verification.confidence,
            "checks": [check.as_dict() for check in verification.checks],
        },
        "is_visible_to_citizen": False,
        "created_at": datetime.now(timezone.utc),
    }
    try:
        allowed = {column.name for column in table.columns}
        db.execute(table.insert(), [{k: v for k, v in row.items() if k in allowed}])
    except Exception as exc:  # pragma: no cover
        logger.warning("AGENT_STEP case note skipped: %s", exc)


def verify_document(db: Any, document_id: Any) -> dict[str, Any]:
    """Frozen entry point: verify one stored document and persist the outcome.

    Returns a JSON-serialisable DTO the backend's sync endpoint can hand straight
    to the client.
    """
    documents = _table("documents")
    row = db.execute(
        documents.select().where(documents.c.id == document_id)
    ).mappings().first()
    if row is None:
        raise LookupError(f"document {document_id} not found")

    storage_path = row["storage_path"]
    doc_type = row.get("doc_type") or "CNIC_FRONT"
    path = _resolve_path(storage_path)

    if not path.exists():
        verification = DocVerification(
            status=UNVERIFIABLE,
            confidence=0.0,
            checks=[
                CheckResult(
                    "file_present",
                    False,
                    str(path),
                    "exists",
                    "the stored file is missing — cannot verify",
                )
            ],
            retake_reason_en=UNVERIFIABLE_REASON_EN,
            retake_reason_ur=UNVERIFIABLE_REASON_UR,
            doc_type=doc_type,
        )
        image_bytes = b""
    else:
        image_bytes = path.read_bytes()
        with telemetry(
            db,
            tenant_id=row.get("tenant_id"),
            case_id=row.get("case_id"),
            resource_type="document",
            resource_id=str(document_id),
        ):
            verification = verify_image(image_bytes, doc_type)

    now = datetime.now(timezone.utc)
    update: dict[str, Any] = {
        "verify_status": verification.status,
        "verify_confidence": round(verification.confidence, 3),
        "extracted_fields": verification.extracted_fields,
        "verify_checks": [check.as_dict() for check in verification.checks],
        "retake_reason_ur": verification.retake_reason_ur,
        "retake_reason_en": verification.retake_reason_en,
    }
    allowed = {column.name for column in documents.columns}
    db.execute(
        documents.update()
        .where(documents.c.id == document_id)
        .values({k: v for k, v in update.items() if k in allowed})
    )

    _record_audit(
        db,
        tenant_id=row.get("tenant_id"),
        document_id=document_id,
        payload={
            "verify_status": verification.status,
            "verify_confidence": verification.confidence,
            "sha256": hashlib.sha256(image_bytes).hexdigest() if image_bytes else None,
            "checks": [check.check for check in verification.checks],
            "doc_type": doc_type,
        },
    )
    _write_case_note(
        db,
        tenant_id=row.get("tenant_id"),
        case_id=row.get("case_id"),
        document_id=document_id,
        verification=verification,
    )

    return {
        "document_id": str(document_id),
        "doc_type": doc_type,
        "verify_status": verification.status,
        "verify_confidence": round(verification.confidence, 3),
        "verify_checks": [check.as_dict() for check in verification.checks],
        "extracted_fields": verification.extracted_fields,
        "retake_reason_en": verification.retake_reason_en,
        "retake_reason_ur": verification.retake_reason_ur,
        "verified_at": now.isoformat(),
    }


def verify_many(image_bytes_list: Sequence[bytes], doc_type: str = "CNIC_FRONT") -> list[DocVerification]:
    """Convenience for benchmarks and tests."""
    return [verify_image(payload, doc_type) for payload in image_bytes_list]


__all__ = [
    "CheckResult",
    "DocVerification",
    "LAPLACIAN_THRESHOLD",
    "MIN_DIMENSION",
    "NAME_SIMILARITY_THRESHOLD",
    "NEEDS_RETAKE",
    "RETAKE_REASON_EN",
    "RETAKE_REASON_UR",
    "SUPPORTED_DOC_TYPES",
    "TAMPER_SUSPECTED",
    "UNVERIFIABLE",
    "VERIFIED",
    "check_cross_reference",
    "check_image_quality",
    "check_ocr",
    "check_qr",
    "name_similarity",
    "upload_dir",
    "verify_document",
    "verify_image",
    "verify_many",
]
