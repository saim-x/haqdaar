"""JWT access tokens + opaque rotating refresh tokens (docs/09 §1.2).

Access token: HS256, 15 min, claims ``{sub, role, tenant_id, citizen_id, iat, exp, jti}``.
Refresh token: 256-bit opaque secret, stored only as SHA-256, rotated on every use,
and reuse of a revoked token revokes every token for that user.
"""

from __future__ import annotations

import hashlib
import secrets
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import jwt
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.config import settings
from app.models.enums import UserRole
from app.models.identity import RefreshToken, User
from app.security.errors import UnauthorizedError

ALGORITHM = "HS256"
REFRESH_TOKEN_BYTES = 32  # 256 bits


def _now() -> datetime:
    return datetime.now(UTC)


def create_access_token(
    *,
    user_id: uuid.UUID | str,
    role: UserRole | str,
    tenant_id: uuid.UUID | str | None = None,
    citizen_id: uuid.UUID | str | None = None,
    expires_in: timedelta | None = None,
) -> str:
    issued_at = _now()
    expires_at = issued_at + (expires_in or timedelta(minutes=settings.access_token_ttl_minutes))
    claims: dict[str, Any] = {
        "sub": str(user_id),
        "role": str(role),
        "tenant_id": str(tenant_id) if tenant_id else None,
        "citizen_id": str(citizen_id) if citizen_id else None,
        "iat": int(issued_at.timestamp()),
        "exp": int(expires_at.timestamp()),
        "jti": uuid.uuid4().hex,
    }
    return jwt.encode(claims, settings.jwt_secret, algorithm=ALGORITHM)


def decode_access_token(token: str) -> dict[str, Any]:
    try:
        claims = jwt.decode(
            token,
            settings.jwt_secret,
            algorithms=[ALGORITHM],
            options={"require": ["sub", "role", "exp", "iat"]},
        )
    except jwt.ExpiredSignatureError as exc:
        raise UnauthorizedError(
            message_en="Your session has expired. Please sign in again.",
            message_ur="آپ کا سیشن ختم ہو گیا ہے۔ براہ کرم دوبارہ سائن ان کریں۔",
        ) from exc
    except jwt.InvalidTokenError as exc:
        raise UnauthorizedError() from exc
    return claims


# --- Refresh tokens ---------------------------------------------------------


def hash_refresh_token(plaintext: str) -> str:
    return hashlib.sha256(plaintext.encode("utf-8")).hexdigest()


def _refresh_ttl_for(role: UserRole | str) -> timedelta:
    if UserRole(role) is UserRole.CITIZEN:
        return timedelta(days=settings.refresh_token_ttl_days_citizen)
    return timedelta(hours=settings.refresh_token_ttl_hours_staff)


def issue_refresh_token(db: Session, user: User) -> str:
    """Create a new refresh token row and return the plaintext (shown once)."""
    plaintext = secrets.token_urlsafe(REFRESH_TOKEN_BYTES)
    db.add(
        RefreshToken(
            user_id=user.id,
            token_hash=hash_refresh_token(plaintext),
            expires_at=_now() + _refresh_ttl_for(user.role),
        )
    )
    db.flush()
    return plaintext


def revoke_all_for_user(db: Session, user_id: uuid.UUID) -> int:
    result = db.execute(
        update(RefreshToken)
        .where(RefreshToken.user_id == user_id, RefreshToken.revoked_at.is_(None))
        .values(revoked_at=_now())
    )
    return result.rowcount or 0


def rotate_refresh_token(db: Session, plaintext: str) -> tuple[User, str]:
    """Consume a refresh token and issue a fresh one.

    Reuse of an already-revoked token is treated as theft: every token for that
    user is revoked and the caller gets ``401 UNAUTHORIZED``.
    """
    token_hash = hash_refresh_token(plaintext)
    row = db.execute(
        select(RefreshToken).where(RefreshToken.token_hash == token_hash)
    ).scalar_one_or_none()

    if row is None:
        raise UnauthorizedError()

    if row.revoked_at is not None:
        revoke_all_for_user(db, row.user_id)
        db.commit()
        raise UnauthorizedError(
            message_en="This session was already used. All sessions have been signed out.",
            message_ur="یہ سیشن پہلے استعمال ہو چکا ہے۔ تمام سیشن بند کر دیے گئے ہیں۔",
        )

    if row.expires_at <= _now():
        row.revoked_at = _now()
        db.flush()
        raise UnauthorizedError(
            message_en="Your session has expired. Please sign in again.",
            message_ur="آپ کا سیشن ختم ہو گیا ہے۔ براہ کرم دوبارہ سائن ان کریں۔",
        )

    user = db.get(User, row.user_id)
    if user is None or not user.is_active:
        raise UnauthorizedError()

    row.revoked_at = _now()
    new_plaintext = issue_refresh_token(db, user)
    return user, new_plaintext


def revoke_refresh_token(db: Session, plaintext: str) -> bool:
    token_hash = hash_refresh_token(plaintext)
    row = db.execute(
        select(RefreshToken).where(RefreshToken.token_hash == token_hash)
    ).scalar_one_or_none()
    if row is None or row.revoked_at is not None:
        return False
    row.revoked_at = _now()
    return True


__all__ = [
    "ALGORITHM",
    "create_access_token",
    "decode_access_token",
    "hash_refresh_token",
    "issue_refresh_token",
    "revoke_all_for_user",
    "revoke_refresh_token",
    "rotate_refresh_token",
]
