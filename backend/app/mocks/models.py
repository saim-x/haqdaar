"""SQLAlchemy models for the simulated DPI services (``mock_*`` tables).

Contract: docs/04-data-model.md §4.6. These tables live in the same PostgreSQL
database as the application tables so that ``POST /api/v1/admin/demo/reset`` can
reset both worlds atomically, but they are logically isolated: only
``app/mocks/**`` may import this module or query these tables. Application code
(``app/api``, ``app/engine``, ``app/agent``, ``app/ai``) reaches the simulated
world exclusively over HTTP via ``MOCK_BASE_URL``.

Every row here is 100% synthetic. CNICs use the reserved fictional prefix
``99900`` which does not map to any real NADRA geographic division.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime, timezone

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    Float,
    Integer,
    String,
    Text,
    Uuid,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class MockIdentity(Base):
    """NADRA-like identity registry (simulated)."""

    __tablename__ = "mock_identities"

    cnic_digits: Mapped[str] = mapped_column(String(13), primary_key=True)
    full_name: Mapped[str] = mapped_column(String(120), nullable=False)
    full_name_ur: Mapped[str] = mapped_column(String(160), nullable=False)
    father_or_spouse_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    dob: Mapped[date | None] = mapped_column(Date, nullable=True)
    gender: Mapped[str] = mapped_column(String(1), nullable=False, default="F")
    district: Mapped[str] = mapped_column(String(64), nullable=False)
    is_alive: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    cnic_expiry_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    marital_status: Mapped[str | None] = mapped_column(String(24), nullable=True)
    # Alternate spellings observed in the wild ("Mohammad"/"Muhammad", Urdu script,
    # honorific variants). Used by the broad name+district search so the ambiguity
    # demos (Challenge 03) return multiple candidates instead of silently picking one.
    variants_json: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)


class MockCivilDeath(Base):
    """Civil death registry (simulated)."""

    __tablename__ = "mock_civil_deaths"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    deceased_cnic: Mapped[str | None] = mapped_column(String(13), nullable=True, index=True)
    deceased_name: Mapped[str] = mapped_column(String(120), nullable=False)
    spouse_cnic: Mapped[str | None] = mapped_column(String(13), nullable=True, index=True)
    spouse_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    death_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    district: Mapped[str] = mapped_column(String(64), nullable=False)
    certificate_no: Mapped[str] = mapped_column(String(40), nullable=False, unique=True)


class MockHousehold(Base):
    """BISP/NSER-like household socio-economic survey (simulated)."""

    __tablename__ = "mock_households"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    head_cnic: Mapped[str] = mapped_column(String(13), nullable=False, index=True)
    member_cnics: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    district: Mapped[str] = mapped_column(String(64), nullable=False)
    household_size: Mapped[int] = mapped_column(Integer, nullable=False)
    monthly_income_pkr: Mapped[int] = mapped_column(Integer, nullable=False)
    poverty_score: Mapped[int] = mapped_column(Integer, nullable=False)
    survey_year: Mapped[int] = mapped_column(Integer, nullable=False)


class MockBenefit(Base):
    """Cross-program benefits registry (simulated)."""

    __tablename__ = "mock_benefits"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    cnic_digits: Mapped[str] = mapped_column(String(13), nullable=False, index=True)
    program_name: Mapped[str] = mapped_column(String(120), nullable=False)
    monthly_amount_pkr: Mapped[int] = mapped_column(Integer, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    started_at: Mapped[date | None] = mapped_column(Date, nullable=True)


class MockPayment(Base):
    """Raast-like instant payment service (simulated).

    ``idempotency_key`` is the primary key: replaying the same key returns the
    exact prior result, which is what makes the ``INITIATE_PAYMENT`` job safe to
    retry under chaos (docs/10 §1.2 E).
    """

    __tablename__ = "mock_payments"

    idempotency_key: Mapped[str] = mapped_column(String(128), primary_key=True)
    payment_ref: Mapped[str] = mapped_column(String(40), nullable=False, unique=True)
    payout_alias: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    account_title: Mapped[str | None] = mapped_column(String(120), nullable=True)
    amount_pkr: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False)
    failure_reason: Mapped[str | None] = mapped_column(String(120), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow)


class MockComplaint(Base):
    """Public complaint registry (simulated)."""

    __tablename__ = "mock_complaints"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    external_ref: Mapped[str] = mapped_column(String(40), nullable=False, unique=True)
    payment_ref: Mapped[str | None] = mapped_column(String(40), nullable=True, index=True)
    citizen_cnic: Mapped[str | None] = mapped_column(String(13), nullable=True)
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String(24), nullable=False, default="REGISTERED")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow)


class MockServiceConfig(Base):
    """Chaos control state for one simulated service (docs/10 §1.1)."""

    __tablename__ = "mock_service_configs"

    service_name: Mapped[str] = mapped_column(String(32), primary_key=True)
    mode: Mapped[str] = mapped_column(String(16), nullable=False, default="NORMAL")
    latency_ms: Mapped[int] = mapped_column(Integer, nullable=False, default=4000)
    failure_rate: Mapped[float] = mapped_column(Float, nullable=False, default=0.50)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utcnow, onupdate=_utcnow
    )


#: Canonical service names accepted by ``mock_service_configs`` (docs/04 §4.6).
SERVICE_NAMES: tuple[str, ...] = (
    "identity",
    "civil",
    "household",
    "benefits",
    "payment",
    "complaint",
    "sms",
)

#: Chaos modes accepted by ``mock_service_configs.mode``.
CHAOS_MODES: tuple[str, ...] = ("NORMAL", "SLOW", "FLAKY", "DOWN")

__all__ = [
    "CHAOS_MODES",
    "SERVICE_NAMES",
    "MockBenefit",
    "MockCivilDeath",
    "MockComplaint",
    "MockHousehold",
    "MockIdentity",
    "MockPayment",
    "MockServiceConfig",
]
