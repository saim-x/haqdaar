"""Scam checker API (docs/05 §3.9) — Challenge 08.

``POST /api/v1/scam/check`` accepts JSON text, a screenshot, or a voice note and
returns an advisory verdict. ``POST /api/v1/scam/{check_id}/feedback`` records a
citizen's disagreement so the dashboard can report honest false-alarm numbers.

Nothing here blocks an account, deletes a message, or changes a case status.
"""

from __future__ import annotations

import logging
import uuid
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse

from app.ai import api_support, guardrails, scam_classifier
from app.ai.provider import get_provider, telemetry

logger = logging.getLogger("haqdaar.api.scam")

router = APIRouter(prefix="/scam", tags=["scam"])

MAX_TEXT_CHARS = 4_000
MAX_UPLOAD_BYTES = 8 * 1024 * 1024

ADVICE_EN = (
    "Haqdaar never asks for a fee, an OTP or your PIN. Verify any code in the app "
    "before you act, and never send money to a personal mobile number."
)
ADVICE_UR = (
    "حقدار کبھی فیس، او ٹی پی یا پن نہیں مانگتا۔ کچھ کرنے سے پہلے کوڈ ایپ میں تصدیق کریں، "
    "اور کسی ذاتی موبائل نمبر پر پیسے نہ بھیجیں۔"
)


def _db() -> Any:
    yield from api_support.get_db()


def _optional_user(request: Request) -> Any:
    return api_support.optional_user(request.headers.get("authorization"))


def _extract_text_from_image(image_bytes: bytes) -> tuple[str, str]:
    """OCR a screenshot. Returns ``(text, source)``."""
    provider = get_provider()
    try:
        result = provider.ocr_document(image_bytes, "SCREENSHOT")
    except Exception as exc:  # pragma: no cover - provider already falls back
        logger.warning("scam image OCR failed: %s", exc)
        return "", "IMAGE_UNREADABLE"

    if not result.available or (not result.fields and not result.raw_text):
        return "", "IMAGE_UNREADABLE"

    parts = [str(value) for value in (result.fields or {}).values() if value]
    if result.raw_text:
        parts.append(result.raw_text)
    extracted = " ".join(parts).strip()
    if not extracted:
        return "", "IMAGE_UNREADABLE"
    return extracted, "IMAGE"


def _extract_text_from_audio(audio_bytes: bytes, mime_type: str) -> tuple[str, str]:
    provider = get_provider()
    try:
        result = provider.transcribe_urdu(audio_bytes, mime_type)
    except Exception as exc:  # pragma: no cover
        logger.warning("scam audio STT failed: %s", exc)
        return "", "AUDIO_UNREADABLE"

    if not result.available or not result.transcript:
        return "", "AUDIO_UNREADABLE"
    return result.transcript.strip(), "AUDIO"


def _matched_official(db: Any, notification_id: Any) -> dict[str, Any] | None:
    if notification_id is None or db is None:
        return None
    try:
        row = api_support.select_row(db, "notifications", notification_id)
    except Exception:  # pragma: no cover
        return None
    if row is None:
        return None
    return {
        "notification_id": str(row.get("id")),
        "verification_code": row.get("verification_code"),
        "title_en": row.get("title_en"),
        "title_ur": row.get("title_ur"),
        "created_at": row.get("created_at").isoformat() if row.get("created_at") else None,
    }


def _persist(
    db: Any,
    *,
    user: Any,
    input_type: str,
    message_text: str,
    district: str | None,
    verdict: scam_classifier.ScamVerdict,
) -> Any:
    check_id = uuid.uuid4()
    row = {
        "id": check_id,
        "user_id": api_support.user_id(user),
        "input_type": input_type,
        "message_text": message_text[:MAX_TEXT_CHARS],
        "district": district,
        "verdict": verdict.verdict,
        "confidence": round(verdict.confidence, 3),
        "red_flags": [flag.as_dict() for flag in verdict.red_flags],
        "matched_notification_id": verdict.matched_notification_id,
        "explanation_ur": verdict.explanation_ur,
        "explanation_en": verdict.explanation_en,
        "user_disputed": False,
        "dispute_note": None,
        "created_at": datetime.now(UTC),
    }
    try:
        api_support.insert_row(db, "scam_checks", row)
        db.commit()
    except Exception as exc:  # pragma: no cover - never fail the citizen
        logger.warning("scam_checks insert failed: %s", exc)
        try:
            db.rollback()
        except Exception:
            pass
    return check_id


def _response(
    *,
    check_id: Any,
    verdict: scam_classifier.ScamVerdict,
    matched_official: dict[str, Any] | None,
    input_type: str,
) -> dict[str, Any]:
    return {
        "check_id": str(check_id),
        "verdict": verdict.verdict,
        "confidence": round(verdict.confidence, 3),
        "red_flags": [flag.as_dict() for flag in verdict.red_flags],
        "matched_official": matched_official,
        "explanation_ur": verdict.explanation_ur,
        "explanation_en": verdict.explanation_en,
        "advice_ur": ADVICE_UR,
        "advice_en": ADVICE_EN,
        "input_type": input_type,
        "stage": verdict.stage,
        "model_version": verdict.model_version,
    }


@router.post("/check")
async def check_message(
    request: Request,
    db: Any = Depends(_db),
    user: Any = Depends(_optional_user),
) -> JSONResponse:
    """Classify a message supplied as JSON text, a screenshot, or a voice note."""
    content_type = (request.headers.get("content-type") or "").lower()
    district: str | None = None
    input_type = "TEXT"
    text = ""

    if "multipart/form-data" in content_type:
        form = await request.form()
        district = (form.get("district") or None) if isinstance(form.get("district"), str) else None
        image = form.get("image")
        audio = form.get("audio")
        if image is not None and hasattr(image, "read"):
            payload = await image.read()
            if len(payload) > MAX_UPLOAD_BYTES:
                raise HTTPException(status_code=413, detail="IMAGE_TOO_LARGE")
            text, input_type = _extract_text_from_image(payload)
        elif audio is not None and hasattr(audio, "read"):
            payload = await audio.read()
            if len(payload) > MAX_UPLOAD_BYTES:
                raise HTTPException(status_code=413, detail="AUDIO_TOO_LARGE")
            text, input_type = _extract_text_from_audio(
                payload, getattr(audio, "content_type", None) or "audio/wav"
            )
        else:
            raw_text = form.get("text")
            text = raw_text if isinstance(raw_text, str) else ""
    else:
        try:
            body = await request.json()
        except Exception:
            raise HTTPException(status_code=400, detail="INVALID_BODY")
        if not isinstance(body, dict):
            raise HTTPException(status_code=400, detail="INVALID_BODY")
        text = str(body.get("text") or "")
        district = body.get("district") or None

    if input_type in {"IMAGE_UNREADABLE", "AUDIO_UNREADABLE"}:
        verdict = scam_classifier.ScamVerdict(
            verdict=scam_classifier.CANNOT_TELL,
            confidence=0.0,
            explanation_en=(
                "We could not read this message. Please type the text or upload a clearer "
                "screenshot."
            ),
            explanation_ur=(
                "ہم یہ پیغام پڑھ نہیں سکے۔ براہ کرم متن لکھیں یا زیادہ واضح اسکرین شاٹ اپ لوڈ کریں۔"
            ),
            stage="UNREADABLE",
        )
        check_id = _persist(
            db,
            user=user,
            input_type="IMAGE" if input_type == "IMAGE_UNREADABLE" else "AUDIO",
            message_text="",
            district=district,
            verdict=verdict,
        )
        return JSONResponse(_response(check_id=check_id, verdict=verdict, matched_official=None, input_type=input_type))

    text = guardrails.redact_for_llm(text)[:MAX_TEXT_CHARS]
    if not text.strip():
        raise HTTPException(status_code=422, detail="EMPTY_MESSAGE")

    with telemetry(
        db,
        tenant_id=api_support.user_tenant(user),
        resource_type="scam_check",
        resource_id=None,
    ):
        verdict = scam_classifier.classify(text, db=db)

    check_id = _persist(
        db,
        user=user,
        input_type=input_type,
        message_text=text,
        district=district,
        verdict=verdict,
    )
    api_support.record_audit(
        db,
        action="scam.checked",
        resource_type="scam_check",
        resource_id=str(check_id),
        tenant_id=api_support.user_tenant(user),
        actor_id=api_support.user_id(user),
        actor_role=api_support.user_role(user),
        payload={
            "verdict": verdict.verdict,
            "confidence": verdict.confidence,
            "flags": [flag.code for flag in verdict.red_flags],
            "input_type": input_type,
        },
    )
    try:
        db.commit()
    except Exception:  # pragma: no cover
        pass

    return JSONResponse(
        _response(
            check_id=check_id,
            verdict=verdict,
            matched_official=_matched_official(db, verdict.matched_notification_id),
            input_type=input_type,
        )
    )


@router.post("/{check_id}/feedback")
async def submit_feedback(
    check_id: str,
    request: Request,
    db: Any = Depends(_db),
    user: Any = Depends(_optional_user),
) -> JSONResponse:
    """Record a citizen's disagreement — the honest false-alarm counter."""
    try:
        parsed_id = uuid.UUID(check_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="CHECK_NOT_FOUND")

    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="INVALID_BODY")
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="INVALID_BODY")

    disputed = bool(body.get("disputed", True))
    note = body.get("note")
    note_text = str(note)[:500] if note else None

    row = api_support.select_row(db, "scam_checks", parsed_id)
    if row is None:
        raise HTTPException(status_code=404, detail="CHECK_NOT_FOUND")

    api_support.update_row(
        db,
        "scam_checks",
        parsed_id,
        {"user_disputed": disputed, "dispute_note": note_text},
    )
    api_support.record_audit(
        db,
        action="scam.feedback",
        resource_type="scam_check",
        resource_id=str(parsed_id),
        tenant_id=api_support.user_tenant(user),
        actor_id=api_support.user_id(user),
        actor_role=api_support.user_role(user),
        payload={"disputed": disputed, "note": note_text},
    )
    try:
        db.commit()
    except Exception:  # pragma: no cover
        pass

    return JSONResponse(
        {
            "check_id": str(parsed_id),
            "disputed": disputed,
            "note": note_text,
            "message": "Thank you — your feedback helps us measure false alarms.",
        }
    )


__all__ = ["router"]
