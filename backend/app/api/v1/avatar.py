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


