"""Interactive Urdu video guide API - "Saima - Haqdaar Guide" (ADR-025).

Two endpoints, both deliberately small:

* ``GET /avatar/config`` tells the client whether a guide is available, how it
  will run (``fake`` simulator or a live ``anam`` stream), and the session caps.
  It carries no key and no citizen data, so it is safe for any authenticated
  caller.
* ``POST /avatar/session`` mints a short-lived vendor token for one of the four
  citizen surfaces. It is rate-limited per user because a session is a WebRTC
  connection, not a request.

Neither endpoint can change a case, a payment or a consent. The guide explains;
the engine decides.
"""

from __future__ import annotations

import logging
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from app.ai import avatar
from app.db import get_db
from app.models.enums import UserRole
from app.security.ratelimit import check_avatar_limit
from app.security.rbac import ActorContext, require_any_authenticated, require_roles

logger = logging.getLogger("haqdaar.api.avatar")

router = APIRouter(prefix="/avatar", tags=["avatar"])

DbSession = Annotated[Session, Depends(get_db)]
AnyActor = Annotated[ActorContext, Depends(require_any_authenticated)]
CitizenActor = Annotated[ActorContext, Depends(require_roles(UserRole.CITIZEN, UserRole.HELPER))]


@router.get("/config", summary="Guide availability and session caps (no secrets)")
def avatar_config(user: AnyActor) -> dict[str, Any]:
    """Public-for-authenticated configuration; never exposes the API key."""
    return avatar.get_avatar_config()


@router.post("/session", summary="Mint a short-lived guide session token")
async def avatar_session(
    request: Request,
    db: DbSession,
    user: CitizenActor,
) -> JSONResponse:
    """Create one guide session, or degrade gracefully to the audio-only guide.

    A vendor failure is a ``200`` with ``available: false`` - a citizen screen
    must never show a 5xx because a third party is down.
    """
    try:
        payload = await request.json()
    except Exception:  # noqa: BLE001 - an empty body is a valid request
        payload = {}
    body = payload if isinstance(payload, dict) else {}

    surface = str(body.get("surface") or "ask").strip().lower()
    if surface not in avatar.SURFACES:
        raise HTTPException(
            status_code=422,
            detail={
                "error": "UNSUPPORTED_SURFACE",
                "surface": surface,
                "allowed": sorted(avatar.SURFACES),
            },
        )

    lang = "en" if str(body.get("lang") or "ur").lower().startswith("en") else "ur"

    actor_id = user.user_id or user.api_key_id
    if actor_id is not None:
        check_avatar_limit(str(actor_id))

    try:
        result = avatar.create_avatar_session(db, user, surface=surface, lang=lang)
    except ValueError as exc:  # pragma: no cover - surface already validated
        raise HTTPException(
            status_code=422, detail={"error": "UNSUPPORTED_SURFACE", "message": str(exc)}
        ) from exc

    db.commit()
    return JSONResponse(status_code=200, content=result)


__all__ = ["router"]
