"""Identity, tenants & auth tables - docs/04 §4.1."""

from __future__ import annotations

import uuid
from datetime import date, datetime

from sqlalchemy import Boolean, Date, ForeignKey, Integer, String, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, CreatedAtMixin, TSTAMPTZ, TimestampMixin, UUIDPrimaryKeyMixin


class Tenant(Base, UUIDPrimaryKeyMixin, CreatedAtMixin):
    __tablename__ = "tenants"

    code: Mapped[str] = mapped_column(String(32), nullable=False, unique=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    name_ur: Mapped[str] = mapped_column(String(120), nullable=False)
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default=text("true")
    )


class User(Base, UUIDPrimaryKeyMixin, CreatedAtMixin):
    __tablename__ = "users"

    tenant_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("tenants.id"), nullable=True
    )
    role: Mapped[str] = mapped_column(String(20), nullable=False)
    email: Mapped[str | None] = mapped_column(String(160), nullable=True, unique=True)
    phone: Mapped[str | None] = mapped_column(String(20), nullable=True, unique=True)
    password_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)
    full_name: Mapped[str] = mapped_column(String(120), nullable=False)
    preferred_lang: Mapped[str] = mapped_column(
        String(8), nullable=False, default="ur", server_default=text("'ur'")
    )
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default=text("true")
    )


class OtpChallenge(Base, UUIDPrimaryKeyMixin, CreatedAtMixin):
    __tablename__ = "otp_challenges"

    phone: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    purpose: Mapped[str] = mapped_column(String(32), nullable=False)
    code_hash: Mapped[str] = mapped_column(String(128), nullable=False)
    attempts: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default=text("0")
    )
    expires_at: Mapped[datetime] = mapped_column(TSTAMPTZ, nullable=False)
    consumed_at: Mapped[datetime | None] = mapped_column(TSTAMPTZ, nullable=True)


class RefreshToken(Base, UUIDPrimaryKeyMixin, CreatedAtMixin):
    __tablename__ = "refresh_tokens"

    user_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True
    )
    token_hash: Mapped[str] = mapped_column(String(128), nullable=False, unique=True)
    expires_at: Mapped[datetime] = mapped_column(TSTAMPTZ, nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(TSTAMPTZ, nullable=True)


class Citizen(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "citizens"

    user_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id"), nullable=True, unique=True
    )
    full_name: Mapped[str] = mapped_column(String(120), nullable=False)
    cnic_digits: Mapped[str | None] = mapped_column(String(13), nullable=True, index=True)
    phone: Mapped[str | None] = mapped_column(String(20), nullable=True, index=True)
    district: Mapped[str | None] = mapped_column(String(64), nullable=True)
    dob: Mapped[date | None] = mapped_column(Date, nullable=True)
    avatar_color: Mapped[str] = mapped_column(
        String(16), nullable=False, default="#0E6A60", server_default=text("'#0E6A60'")
    )
    profile_data: Mapped[dict] = mapped_column(
        JSONB, nullable=False, default=dict, server_default=text("'{}'::jsonb")
    )
    created_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )


class ApiKey(Base, UUIDPrimaryKeyMixin, CreatedAtMixin):
    __tablename__ = "api_keys"

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(80), nullable=False)
    key_prefix: Mapped[str] = mapped_column(String(16), nullable=False, index=True)
    key_hash: Mapped[str] = mapped_column(String(128), nullable=False, unique=True)
    scopes: Mapped[list] = mapped_column(
        JSONB, nullable=False, default=list, server_default=text("'[]'::jsonb")
    )
    rate_limit_per_min: Mapped[int] = mapped_column(
        Integer, nullable=False, default=60, server_default=text("60")
    )
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default=text("true")
    )
    last_used_at: Mapped[datetime | None] = mapped_column(TSTAMPTZ, nullable=True)
    created_by_user_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )


__all__ = [
    "ApiKey",
    "Citizen",
    "OtpChallenge",
    "RefreshToken",
    "Tenant",
    "User",
]
