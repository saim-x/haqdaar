"""Notifications with verifiable ``HQ-XXXXX`` codes (docs/04 §4.5, docs/09 §6).

Every official message carries a unique Crockford-Base32 code and a
``body_sha256`` over the canonical SMS text, so the scam checker can prove that a
message is genuine *and* that its text was not altered (``RF_CODE_MISMATCH``).
"""

from __future__ import annotations

import hashlib
import secrets
import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.ai import Notification
from app.models.enums import NotificationChannel

#: Crockford Base32 - no I, L, O, U, so codes are unambiguous when read aloud.
CROCKFORD_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
CODE_LENGTH = 5
CODE_PREFIX = "HQ-"
MAX_CODE_ATTEMPTS = 12


def generate_verification_code() -> str:
    """``HQ-`` + 5 Crockford Base32 characters (e.g. ``HQ-7K3P9``)."""
    body = "".join(secrets.choice(CROCKFORD_ALPHABET) for _ in range(CODE_LENGTH))
    return f"{CODE_PREFIX}{body}"


def canonical_body(*, title_en: str, body_en: str, title_ur: str, body_ur: str) -> str:
    """Canonical text hashed into ``body_sha256`` (stable across languages)."""
    return "\n".join([title_en.strip(), body_en.strip(), title_ur.strip(), body_ur.strip()])


def body_sha256(*, title_en: str, body_en: str, title_ur: str, body_ur: str) -> str:
    material = canonical_body(title_en=title_en, body_en=body_en, title_ur=title_ur, body_ur=body_ur)
    return hashlib.sha256(material.encode("utf-8")).hexdigest()


def _unique_code(db: Session) -> str:
    for _ in range(MAX_CODE_ATTEMPTS):
        code = generate_verification_code()
        exists = db.execute(
            select(Notification.id).where(Notification.verification_code == code).limit(1)
        ).scalar_one_or_none()
        if exists is None:
            return code
    raise RuntimeError("could not allocate a unique verification code")


def create_notification(
    db: Session,
    *,
    channel: NotificationChannel | str,
    title_en: str,
    title_ur: str,
    body_en: str,
    body_ur: str,
    phone: str | None = None,
    citizen_id: uuid.UUID | None = None,
    user_id: uuid.UUID | None = None,
    case_id: uuid.UUID | None = None,
    tenant_id: uuid.UUID | None = None,
    with_verification_code: bool = True,
) -> Notification:
    """Create one notification row (in-app or simulated SMS) with a unique code.

    ``with_verification_code=False`` still allocates a unique ``HQ-XXXXX`` value
    because the column is ``UNIQUE NOT NULL``; the code is simply not advertised
    in the body text.
    """
    code = _unique_code(db)
    digest = body_sha256(title_en=title_en, body_en=body_en, title_ur=title_ur, body_ur=body_ur)

    notification = Notification(
        tenant_id=tenant_id,
        citizen_id=citizen_id,
        user_id=user_id,
        phone=phone,
        channel=str(channel),
        title_ur=title_ur,
        title_en=title_en,
        body_ur=body_ur,
        body_en=body_en,
        verification_code=code,
        body_sha256=digest,
        case_id=case_id,
    )
    db.add(notification)
    try:
        db.flush()
    except IntegrityError:
        # Extremely unlikely code collision: retry once with a fresh code.
        db.rollback()
        notification.verification_code = _unique_code(db)
        db.add(notification)
        db.flush()
    return notification


def notification_to_dict(notification: Notification) -> dict[str, Any]:
    return {
        "id": str(notification.id),
        "channel": notification.channel,
        "title_en": notification.title_en,
        "title_ur": notification.title_ur,
        "body_en": notification.body_en,
        "body_ur": notification.body_ur,
        "verification_code": notification.verification_code,
        "body_sha256": notification.body_sha256,
        "case_id": str(notification.case_id) if notification.case_id else None,
        "read_at": notification.read_at.isoformat() if notification.read_at else None,
        "created_at": notification.created_at.isoformat() if notification.created_at else None,
    }


__all__ = [
    "CROCKFORD_ALPHABET",
    "body_sha256",
    "canonical_body",
    "create_notification",
    "generate_verification_code",
    "notification_to_dict",
]
