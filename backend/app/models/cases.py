"""Cases, facts, documents, decisions, notes & payments - docs/04 §4.3."""

from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import (
    Boolean,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    Sequence,
    String,
    Text,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, CreatedAtMixin, TSTAMPTZ, TimestampMixin, UUIDPrimaryKeyMixin

#: Human-readable case references (``HQ-2026-000142``). A sequence keeps them
#: gap-free under concurrency without inventing a column.
CASE_REF_SEQ = Sequence("case_reference_seq", start=1000)


class Case(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "cases"
    __table_args__ = (
        Index(
            "ix_cases_tenant_status_priority_created",
            "tenant_id",
            "status",
            text("priority_score DESC"),
            text("created_at ASC"),
        ),
        Index("ix_cases_tenant_confidence", "tenant_id", text("latest_confidence ASC")),
        Index("ix_cases_citizen_created", "citizen_id", text("created_at DESC")),
    )

    reference_code: Mapped[str] = mapped_column(String(20), nullable=False, unique=True)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False
    )
    program_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("programs.id"), nullable=False
    )
    citizen_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("citizens.id"), nullable=False
    )
    submitted_by_user_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    submitted_via_helper: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=text("false")
    )
    case_type: Mapped[str] = mapped_column(
        String(24),
        nullable=False,
        default="BENEFIT_APPLICATION",
        server_default=text("'BENEFIT_APPLICATION'"),
    )
    parent_case_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("cases.id"), nullable=True
    )
    status: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    previous_status: Mapped[str | None] = mapped_column(String(32), nullable=True)
    assigned_officer_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )
    first_approver_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )
    priority_score: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default=text("0")
    )
    priority_band: Mapped[str] = mapped_column(
        String(10), nullable=False, default="NORMAL", server_default=text("'NORMAL'")
    )
    latest_confidence: Mapped[Decimal | None] = mapped_column(Numeric(4, 3), nullable=True)
    latest_route: Mapped[str | None] = mapped_column(String(20), nullable=True)
    latest_rule_version_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("rule_versions.id"), nullable=True
    )
    approved_amount_pkr: Mapped[int | None] = mapped_column(Integer, nullable=True)
    ask_more_rounds: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default=text("0")
    )
    wizard_step: Mapped[str | None] = mapped_column(String(40), nullable=True)
    draft_answers: Mapped[dict] = mapped_column(
        JSONB, nullable=False, default=dict, server_default=text("'{}'::jsonb")
    )
    flags_json: Mapped[list] = mapped_column(
        JSONB, nullable=False, default=list, server_default=text("'[]'::jsonb")
    )
    ai_case_note: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    citizen_explanation: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    submitted_at: Mapped[datetime | None] = mapped_column(TSTAMPTZ, nullable=True)
    decided_at: Mapped[datetime | None] = mapped_column(TSTAMPTZ, nullable=True)


class Document(Base, UUIDPrimaryKeyMixin, CreatedAtMixin):
    __tablename__ = "documents"

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True
    )
    citizen_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("citizens.id"), nullable=False, index=True
    )
    case_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("cases.id"), nullable=True, index=True
    )
    doc_type: Mapped[str] = mapped_column(String(32), nullable=False)
    storage_path: Mapped[str] = mapped_column(String(255), nullable=False)
    mime_type: Mapped[str] = mapped_column(String(64), nullable=False)
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    sha256_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    verify_status: Mapped[str] = mapped_column(
        String(24), nullable=False, default="PENDING", server_default=text("'PENDING'")
    )
    verify_confidence: Mapped[Decimal | None] = mapped_column(Numeric(4, 3), nullable=True)
    extracted_fields: Mapped[dict] = mapped_column(
        JSONB, nullable=False, default=dict, server_default=text("'{}'::jsonb")
    )
    verify_checks: Mapped[list] = mapped_column(
        JSONB, nullable=False, default=list, server_default=text("'[]'::jsonb")
    )
    retake_reason_ur: Mapped[str | None] = mapped_column(Text, nullable=True)
    retake_reason_en: Mapped[str | None] = mapped_column(Text, nullable=True)
    uploaded_by_user_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )


class Decision(Base, UUIDPrimaryKeyMixin, CreatedAtMixin):
    """APPEND-ONLY: never updated or deleted by application code."""

    __tablename__ = "decisions"

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True
    )
    case_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("cases.id"), nullable=False, index=True
    )
    decision_source: Mapped[str] = mapped_column(String(16), nullable=False)
    actor_user_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )
    rule_version_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("rule_versions.id"), nullable=False
    )
    rule_content_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    input_snapshot_json: Mapped[dict] = mapped_column(JSONB, nullable=False)
    input_snapshot_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    rule_trace_json: Mapped[list] = mapped_column(JSONB, nullable=False)
    confidence_components: Mapped[dict] = mapped_column(JSONB, nullable=False)
    confidence_overall: Mapped[Decimal] = mapped_column(Numeric(4, 3), nullable=False)
    route_action: Mapped[str] = mapped_column(String(20), nullable=False)
    outcome_status: Mapped[str] = mapped_column(String(32), nullable=False)
    escalation_reasons: Mapped[list] = mapped_column(
        JSONB, nullable=False, default=list, server_default=text("'[]'::jsonb")
    )
    model_versions: Mapped[dict] = mapped_column(
        JSONB, nullable=False, default=dict, server_default=text("'{}'::jsonb")
    )
    citizen_explanation: Mapped[dict] = mapped_column(JSONB, nullable=False)
    computed_amount_pkr: Mapped[int | None] = mapped_column(Integer, nullable=True)
    officer_reason_codes: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    officer_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_override: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=text("false")
    )


class CaseNote(Base, UUIDPrimaryKeyMixin, CreatedAtMixin):
    __tablename__ = "case_notes"

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True
    )
    case_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("cases.id"), nullable=False, index=True
    )
    author_user_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )
    note_type: Mapped[str] = mapped_column(String(24), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    metadata_json: Mapped[dict] = mapped_column(
        JSONB, nullable=False, default=dict, server_default=text("'{}'::jsonb")
    )
    is_visible_to_citizen: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=text("false")
    )


class Payment(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "payments"

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True
    )
    # UNIQUE guarantees at most one payment per case (docs/04 §4.3).
    case_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("cases.id"), nullable=False, unique=True
    )
    citizen_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("citizens.id"), nullable=False
    )
    amount_pkr: Mapped[int] = mapped_column(Integer, nullable=False)
    payout_alias: Mapped[str] = mapped_column(String(32), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False)
    external_ref: Mapped[str | None] = mapped_column(String(64), nullable=True)
    failure_reason: Mapped[str | None] = mapped_column(String(120), nullable=True)
    attempt_count: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default=text("0")
    )


__all__ = ["Case", "CaseNote", "Decision", "Document", "Payment"]
