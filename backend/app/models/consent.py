"""Consent, data corrections & access logs — docs/04 §4.4."""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Boolean, ForeignKey, String, Text, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, CreatedAtMixin, TSTAMPTZ, TimestampMixin, UUIDPrimaryKeyMixin


class ConsentGrant(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "consent_grants"

    citizen_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("citizens.id"), nullable=False, index=True
    )
    recipient_type: Mapped[str] = mapped_column(String(16), nullable=False)
    recipient_tenant_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("tenants.id"), nullable=True, index=True
    )
    recipient_user_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id"), nullable=True, index=True
    )
    categories: Mapped[list] = mapped_column(
        JSONB, nullable=False, default=list, server_default=text("'[]'::jsonb")
    )
    purposes: Mapped[list] = mapped_column(
        JSONB, nullable=False, default=list, server_default=text("'[]'::jsonb")
    )
    status: Mapped[str] = mapped_column(String(16), nullable=False)
    assurance_level: Mapped[str] = mapped_column(String(20), nullable=False)
    verbal_audio_path: Mapped[str | None] = mapped_column(String(255), nullable=True)
    granted_at: Mapped[datetime] = mapped_column(TSTAMPTZ, nullable=False)
    expires_at: Mapped[datetime | None] = mapped_column(TSTAMPTZ, nullable=True)
    withdrawn_at: Mapped[datetime | None] = mapped_column(TSTAMPTZ, nullable=True)


class ConsentEvent(Base, UUIDPrimaryKeyMixin, CreatedAtMixin):
    """APPEND-ONLY consent history."""

    __tablename__ = "consent_events"

    grant_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("consent_grants.id"), nullable=False, index=True
    )
    citizen_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("citizens.id"), nullable=False, index=True
    )
    action: Mapped[str] = mapped_column(String(20), nullable=False)
    actor_user_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    snapshot_json: Mapped[dict] = mapped_column(JSONB, nullable=False)


class ConsentAccessLog(Base, UUIDPrimaryKeyMixin, CreatedAtMixin):
    """APPEND-ONLY access log shown to the citizen — allowed *and* denied rows."""

    __tablename__ = "consent_access_logs"

    citizen_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("citizens.id"), nullable=False, index=True
    )
    #: NULL for ``AGENT``/``SYSTEM`` actors, which have no user row (ADR-019). The
    #: ``actor_role`` + ``actor_label`` pair still says who read the data.
    actor_user_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )
    actor_role: Mapped[str] = mapped_column(String(20), nullable=False)
    actor_label: Mapped[str] = mapped_column(String(120), nullable=False)
    tenant_id: Mapped[uuid.UUID | None] = mapped_column(PGUUID(as_uuid=True), nullable=True)
    category: Mapped[str] = mapped_column(String(24), nullable=False)
    purpose: Mapped[str] = mapped_column(String(32), nullable=False)
    resource_ref: Mapped[str] = mapped_column(String(80), nullable=False)
    allowed: Mapped[bool] = mapped_column(Boolean, nullable=False)
    denial_reason: Mapped[str | None] = mapped_column(String(64), nullable=True)


class DataCorrectionRequest(Base, UUIDPrimaryKeyMixin, CreatedAtMixin):
    __tablename__ = "data_correction_requests"

    citizen_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("citizens.id"), nullable=False, index=True
    )
    tenant_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("tenants.id"), nullable=True, index=True
    )
    field_key: Mapped[str] = mapped_column(String(48), nullable=False)
    source_type: Mapped[str] = mapped_column(String(16), nullable=False)
    old_value: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    requested_value: Mapped[dict] = mapped_column(JSONB, nullable=False)
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False)
    reviewed_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )


__all__ = [
    "ConsentAccessLog",
    "ConsentEvent",
    "ConsentGrant",
    "DataCorrectionRequest",
]
