"""Voice API (docs/05 §3.9) - spoken wizard answers and dynamic Urdu speech.

``POST /voice/transcribe-parse`` takes one recorded answer, transcribes it, parses
exactly one wizard field and returns the mandatory readback sentence. The
frontend may only save a spoken value after the citizen confirms that readback.

``POST /voice/tts`` streams a cached Urdu clip for a dynamic sentence (an
explanation, a rejection reason). Static wizard prompts never come through here -
they are pre-rendered into ``frontend/public/audio/ur/`` by ``app.ai.tts_pregen``.

Both endpoints are advisory: a failure returns a structured error and the UI
falls back to the keypad and on-screen text. Nothing here mutates a case.
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse, Response

from app.ai import api_support, voice
from app.models.enums import UserRole
from app.security.rbac import require_any_authenticated, require_roles

logger = logging.getLogger("haqdaar.api.voice")

router = APIRouter(prefix="/voice", tags=["voice"])

MAX_AUDIO_BYTES = 8 * 1024 * 1024
MAX_TTS_CHARS = 600

_ALLOWED_AUDIO_PREFIXES = (
    "audio/",
    "application/octet-stream",
    "video/webm",
    "video/ogg",
)


def _db() -> Any:
    yield from api_support.get_db()


def _normalise_lang(value: str | None) -> str:
    lang = (value or "ur").strip().lower()
    return lang if lang in {"ur", "en"} else "ur"


def _sniff_mime(upload: UploadFile, payload: bytes) -> str:
    declared = (upload.content_type or "").split(";")[0].strip().lower()
    if declared.startswith(_ALLOWED_AUDIO_PREFIXES):
        return declared
    if payload[:4] == b"RIFF":
        return "audio/wav"
    if payload[:4] == b"OggS":
        return "audio/ogg"
    if payload[:3] == b"ID3" or payload[:2] in {b"\xff\xfb", b"\xff\xf3"}:
        return "audio/mpeg"
    if payload[:4] == b"\x1a\x45\xdf\xa3":
        return "audio/webm"
    return declared or "audio/wav"


@router.post("/transcribe-parse")
async def transcribe_parse(
    request: Request,
    audio: UploadFile = File(...),
    field_key: str = Form(...),
    lang: str = Form("ur"),
    db: Any = Depends(_db),
    user: Any = Depends(require_roles(UserRole.CITIZEN, UserRole.HELPER)),
) -> JSONResponse:
    """Transcribe one spoken answer and parse a single wizard field from it."""
    key = (field_key or "").strip()
    if key not in voice.FIELD_SCHEMAS:
        raise HTTPException(
            status_code=422,
            detail={
                "error": "UNSUPPORTED_FIELD_KEY",
                "field_key": key,
                "allowed": list(voice.FIELD_KEYS),
            },
        )

    payload = await audio.read()
    if not payload:
        raise HTTPException(
            status_code=422, detail={"error": "EMPTY_AUDIO", "field_key": key}
        )
    if len(payload) > MAX_AUDIO_BYTES:
        raise HTTPException(
            status_code=413,
            detail={"error": "AUDIO_TOO_LARGE", "max_bytes": MAX_AUDIO_BYTES},
        )

    mime_type = _sniff_mime(audio, payload)
    language = _normalise_lang(lang)

    try:
        result = await run_in_threadpool(
            voice.transcribe_and_parse,
            db,
            audio_bytes=payload,
            mime_type=mime_type,
            field_key=key,
            lang=language,
            tenant_id=api_support.user_tenant(user),
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=422, detail={"error": "UNSUPPORTED_FIELD_KEY", "message": str(exc)}
        ) from exc
    except Exception as exc:  # pragma: no cover - provider already degrades
        logger.warning("transcribe-parse failed for %s: %s", key, exc)
        return JSONResponse(
            status_code=200,
            content={
                "field_key": key,
                "transcript": "",
                "parsed_value": None,
                "confidence": 0.0,
                "missing_reason": "STT_UNAVAILABLE",
                "readback_ur": "ہم آپ کی آواز نہیں سن سکے۔ براہ کرم کی پیڈ استعمال کریں۔",
                "readback_en": "We could not process the audio. Please use the keypad.",
                "needs_retry": True,
                "provider": "unavailable",
                "model": "unavailable",
            },
        )

    body = result.as_dict()
    body["lang"] = language
    body["mime_type"] = mime_type
    return JSONResponse(status_code=200, content=body)


@router.post("/tts")
async def text_to_speech(
    request: Request,
    db: Any = Depends(_db),
    user: Any = Depends(require_any_authenticated),
) -> Response:
    """Stream a cached Urdu clip for a dynamic sentence."""
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=422, detail={"error": "INVALID_JSON"})

    if not isinstance(payload, dict):
        raise HTTPException(status_code=422, detail={"error": "INVALID_JSON"})

    text = str(payload.get("text") or "").strip()
    if not text:
        raise HTTPException(status_code=422, detail={"error": "TEXT_REQUIRED"})
    if len(text) > MAX_TTS_CHARS:
        raise HTTPException(
            status_code=422,
            detail={"error": "TEXT_TOO_LONG", "max_chars": MAX_TTS_CHARS},
        )

    language = _normalise_lang(payload.get("lang"))

    try:
        audio_bytes, mime_type = await run_in_threadpool(
            voice.synthesize,
            db, text, lang=language, tenant_id=api_support.user_tenant(user)
        )
    except Exception as exc:  # pragma: no cover - provider already degrades
        logger.warning("tts failed: %s", exc)
        raise HTTPException(
            status_code=503,
            detail={"error": "TTS_UNAVAILABLE", "fallback": "SHOW_TEXT"},
        ) from exc

    if not audio_bytes:
        raise HTTPException(
            status_code=503,
            detail={"error": "TTS_UNAVAILABLE", "fallback": "SHOW_TEXT"},
        )

    return Response(
        content=audio_bytes,
        media_type=mime_type,
        headers={
            "Cache-Control": "public, max-age=86400",
            "X-Audio-Cache-Key": voice.cache_key(text),
            "X-Audio-Lang": language,
        },
    )


__all__ = ["router"]
