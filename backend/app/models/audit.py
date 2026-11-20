"""Hash-chained audit log — docs/04 §4.4 / docs/09 §5.

``seq`` is a real PostgreSQL sequence (BIGSERIAL semantics) so chain order is
global and monotonic even with concurrent writers serialized by the advisory lock.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import BigInteger, Sequence, String, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TSTAMPTZ, UUIDPrimaryKeyMixin

AUDIT_SEQ = Sequence("audit_events_seq_seq")


class AuditEvent(Base, UUIDPrimaryKeyMixin):
    """APPEND-ONLY. Never UPDATE or DELETE from application code."""

    __tablename__ = "audit_events"

    seq: Mapped[int] = mapped_column(
        BigInteger,
        AUDIT_SEQ,
        server_default=text("nextval('audit_events_seq_seq')"),
        nullable=False,
        unique=True,
        index=True,
    )
    tenant_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), nullable=True, index=True
    )
    actor_type: Mapped[str] = mapped_column(String(16), nullable=False)
    actor_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    actor_role: Mapped[str | None] = mapped_column(String(20), nullable=True)
    action: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    resource_type: Mapped[str] = mapped_column(String(32), nullable=False)
    resource_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    request_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    payload_json: Mapped[dict] = mapped_column(
        JSONB, nullable=False, default=dict, server_default=text("'{}'::jsonb")
    )
    prev_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    event_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(TSTAMPTZ, nullable=False)


__all__ = ["AUDIT_SEQ", "AuditEvent"]
