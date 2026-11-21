"""Policy Q&A API (docs/05 §3.9) - grounded answers with honest abstention.

``POST /api/v1/rag/ask`` answers only from the indexed policy corpus. When the
best retrieved chunk scores below the abstention threshold the endpoint returns
``status: "NOT_SURE"`` and **never calls the model** - a wrong answer about a
benefit is worse than admitting uncertainty.

The endpoint is read-only: it cannot change a case, a payment, or a consent.
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse

from app.ai import api_support, guardrails, rag
from app.ai.provider import get_provider, telemetry
from app.security.rbac import require_any_authenticated

logger = logging.getLogger("haqdaar.api.rag")

router = APIRouter(prefix="/rag", tags=["rag"])

MAX_QUESTION_CHARS = 500


def _db() -> Any:
    yield from api_support.get_db()


def _parse_uuid(value: Any) -> Any:
    if value in (None, "", "null"):
        return None
    import uuid

    try:
        return uuid.UUID(str(value))
    except (ValueError, AttributeError, TypeError):
        raise HTTPException(
            status_code=422,
            detail={"error": "INVALID_PROGRAM_ID", "program_id": str(value)},
        )


@router.post("/ask")
async def ask(
    request: Request,
    db: Any = Depends(_db),
    user: Any = Depends(require_any_authenticated),
) -> JSONResponse:
    """Answer a policy question from the indexed corpus, or abstain."""
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=422, detail={"error": "INVALID_JSON"})

    if not isinstance(payload, dict):
        raise HTTPException(status_code=422, detail={"error": "INVALID_JSON"})

    question = str(payload.get("question") or "").strip()
    if not question:
        raise HTTPException(status_code=422, detail={"error": "QUESTION_REQUIRED"})
    if len(question) > MAX_QUESTION_CHARS:
        raise HTTPException(
            status_code=422,
            detail={"error": "QUESTION_TOO_LONG", "max_chars": MAX_QUESTION_CHARS},
        )

    lang = "en" if str(payload.get("lang") or "ur").lower().startswith("en") else "ur"
    program_id = _parse_uuid(payload.get("program_id"))
    # Additive and off by default (ADR-025): only the video guide asks for a
    # spoken reframing, and it must never change the grounded answer.
    conversational = payload.get("conversational") is True

    try:
        answer = await run_in_threadpool(
            rag.ask,
            db,
            question,
            program_id=program_id,
            lang=lang,
            tenant_id=api_support.user_tenant(user),
        )
    except Exception as exc:  # pragma: no cover - retrieval already degrades
        logger.warning("rag ask failed: %s", exc)
        return JSONResponse(
            status_code=200,
            content={
                "status": "NOT_SURE",
                "answer": rag.NOT_SURE_UR if lang == "ur" else rag.NOT_SURE_EN,
                "citations": [],
                "top_score": 0.0,
                "lang": lang,
                "provider": "unavailable",
                "model": "unavailable",
                "guardrail_triggered": False,
                "retrieved": 0,
            },
        )

    return JSONResponse(status_code=200, content=answer.as_dict())


@router.post("/transcribe")
async def transcribe_question(
    audio: UploadFile = File(...),
    db: Any = Depends(_db),
    user: Any = Depends(require_any_authenticated),
) -> JSONResponse:
    """Transcribe a spoken policy question so low-literacy citizens can speak on /c/ask."""
    payload = await audio.read()
    if not payload:
        raise HTTPException(status_code=422, detail={"error": "EMPTY_AUDIO"})
    if len(payload) > 8 * 1024 * 1024:
        raise HTTPException(status_code=413, detail={"error": "AUDIO_TOO_LARGE"})

    mime_type = (audio.content_type or "audio/webm").split(";")[0].strip().lower()

    def _run() -> dict[str, Any]:
        provider = get_provider()
        with telemetry(db, tenant_id=api_support.user_tenant(user), resource_type="rag_voice"):
            stt = provider.transcribe_urdu(payload, mime_type)
        transcript = guardrails.sanitize(db, stt.transcript or "", resource_type="rag_voice").strip()
        return {
            "transcript": transcript,
            "confidence": round(float(stt.confidence or 0.0), 3),
            "available": bool(transcript),
            "provider": stt.provider,
            "model": stt.model,
        }

    try:
        body = await run_in_threadpool(_run)
    except Exception as exc:  # pragma: no cover
        logger.warning("rag transcribe failed: %s", exc)
        body = {"transcript": "", "confidence": 0.0, "available": False, "provider": "unavailable", "model": "unavailable"}
    return JSONResponse(status_code=200, content=body)


__all__ = ["router"]
