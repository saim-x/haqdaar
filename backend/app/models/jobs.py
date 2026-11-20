"""Job queue, idempotency cache & worker heartbeats — docs/04 §4.5."""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Integer, String, Text, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TSTAMPTZ, TimestampMixin, UUIDPrimaryKeyMixin, utcnow


class Job(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "jobs"

    job_type: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    dedup_key: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)
    payload_json: Mapped[dict] = mapped_column(
        JSONB, nullable=False, default=dict, server_default=text("'{}'::jsonb")
    )
    status: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    attempts: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default=text("0")
    )
    max_attempts: Mapped[int] = mapped_column(
        Integer, nullable=False, default=5, server_default=text("5")
    )
    run_after: Mapped[datetime] = mapped_column(TSTAMPTZ, nullable=False)
    locked_at: Mapped[datetime | None] = mapped_column(TSTAMPTZ, nullable=True)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)


class IdempotencyKey(Base):
    __tablename__ = "idempotency_keys"

    key: Mapped[str] = mapped_column(String(128), primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True)
    method: Mapped[str] = mapped_column(String(8), nullable=False)
    path: Mapped[str] = mapped_column(String(255), nullable=False)
    request_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    response_status: Mapped[int] = mapped_column(Integer, nullable=False)
    response_body: Mapped[dict] = mapped_column(JSONB, nullable=False)
    created_at: Mapped[datetime] = mapped_column(TSTAMPTZ, nullable=False, default=utcnow)


class WorkerHeartbeat(Base):
    __tablename__ = "worker_heartbeats"

    worker_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    last_seen_at: Mapped[datetime] = mapped_column(TSTAMPTZ, nullable=False)
    active_jobs: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default=text("0")
    )


__all__ = ["IdempotencyKey", "Job", "WorkerHeartbeat"]
