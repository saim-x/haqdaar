"""Notifications, scam checks, RAG store & AI telemetry - docs/04 §4.5."""

from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import (
    Boolean,
    Computed,
    Float,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    text,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, TSVECTOR
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, CreatedAtMixin, TSTAMPTZ, UUIDPrimaryKeyMixin


class Notification(Base, UUIDPrimaryKeyMixin, CreatedAtMixin):
    __tablename__ = "notifications"

    tenant_id: Mapped[uuid.UUID | None] = mapped_column(PGUUID(as_uuid=True), nullable=True)
    citizen_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("citizens.id"), nullable=True, index=True
    )
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id"), nullable=True, index=True
    )
    phone: Mapped[str | None] = mapped_column(String(20), nullable=True, index=True)
    channel: Mapped[str] = mapped_column(String(16), nullable=False)
    title_ur: Mapped[str] = mapped_column(String(160), nullable=False)
    title_en: Mapped[str] = mapped_column(String(160), nullable=False)
    body_ur: Mapped[str] = mapped_column(Text, nullable=False)
    body_en: Mapped[str] = mapped_column(Text, nullable=False)
    verification_code: Mapped[str] = mapped_column(String(16), nullable=False, unique=True)
    body_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    case_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("cases.id"), nullable=True, index=True
    )
    read_at: Mapped[datetime | None] = mapped_column(TSTAMPTZ, nullable=True)


class ScamCheck(Base, UUIDPrimaryKeyMixin, CreatedAtMixin):
    __tablename__ = "scam_checks"

    user_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id"), nullable=True, index=True
    )
    input_type: Mapped[str] = mapped_column(String(16), nullable=False)
    message_text: Mapped[str] = mapped_column(Text, nullable=False)
    district: Mapped[str | None] = mapped_column(String(64), nullable=True)
    verdict: Mapped[str] = mapped_column(String(24), nullable=False)
    confidence: Mapped[Decimal] = mapped_column(Numeric(4, 3), nullable=False)
    red_flags: Mapped[list] = mapped_column(
        JSONB, nullable=False, default=list, server_default=text("'[]'::jsonb")
    )
    matched_notification_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("notifications.id"), nullable=True
    )
    explanation_ur: Mapped[str] = mapped_column(Text, nullable=False)
    explanation_en: Mapped[str] = mapped_column(Text, nullable=False)
    user_disputed: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=text("false")
    )
    dispute_note: Mapped[str | None] = mapped_column(Text, nullable=True)


class RagDocument(Base, UUIDPrimaryKeyMixin, CreatedAtMixin):
    __tablename__ = "rag_documents"

    tenant_id: Mapped[uuid.UUID | None] = mapped_column(PGUUID(as_uuid=True), nullable=True)
    program_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("programs.id"), nullable=True
    )
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    version: Mapped[str] = mapped_column(String(32), nullable=False)
    source_type: Mapped[str] = mapped_column(String(24), nullable=False)
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default=text("true")
    )


class RagChunk(Base, UUIDPrimaryKeyMixin, CreatedAtMixin):
    __tablename__ = "rag_chunks"
    __table_args__ = (Index("ix_rag_chunks_tsv", "tsv", postgresql_using="gin"),)

    document_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("rag_documents.id"), nullable=False, index=True
    )
    section_heading: Mapped[str | None] = mapped_column(String(200), nullable=True)
    chunk_index: Mapped[int] = mapped_column(Integer, nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    # Generated column: hybrid keyword search without any extension (ADR-006).
    tsv: Mapped[str | None] = mapped_column(
        TSVECTOR, Computed("to_tsvector('simple', content)", persisted=True), nullable=True
    )
    embedding: Mapped[list[float] | None] = mapped_column(
        ARRAY(Float), nullable=True
    )


class AiTelemetry(Base, UUIDPrimaryKeyMixin, CreatedAtMixin):
    __tablename__ = "ai_telemetry"

    tenant_id: Mapped[uuid.UUID | None] = mapped_column(PGUUID(as_uuid=True), nullable=True)
    task_type: Mapped[str] = mapped_column(String(32), nullable=False)
    provider: Mapped[str] = mapped_column(String(16), nullable=False)
    model_name: Mapped[str] = mapped_column(String(64), nullable=False)
    prompt_version: Mapped[str] = mapped_column(String(24), nullable=False)
    latency_ms: Mapped[int] = mapped_column(Integer, nullable=False)
    input_tokens: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default=text("0")
    )
    output_tokens: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default=text("0")
    )
    estimated_cost_usd: Mapped[Decimal] = mapped_column(
        Numeric(10, 6), nullable=False, default=0, server_default=text("0")
    )
    succeeded: Mapped[bool] = mapped_column(Boolean, nullable=False)
    error_code: Mapped[str | None] = mapped_column(String(48), nullable=True)
    case_id: Mapped[uuid.UUID | None] = mapped_column(PGUUID(as_uuid=True), nullable=True)


__all__ = ["AiTelemetry", "Notification", "RagChunk", "RagDocument", "ScamCheck"]
