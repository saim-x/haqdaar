"""mock_* tables for the simulated DPI rails (docs/04 §4.6).

These seven tables hold the synthetic government world: identity records, civil
death records, household surveys, active benefits, payment attempts, complaints
and the chaos-control state. Every row is fictional — CNICs start with ``99900``.

**Revision chain.** ``down_revision`` is set to ``None`` because this branch was
cut before the application schema migration existed. At first merge the
Integration Lead repoints it at the latest application revision; nothing else in
this file changes.

Revision ID: dpi_mock_0001
Revises: None
Create Date: 2026-11-20
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "dpi_mock_0001"
down_revision = "app_0001"
branch_labels = None
depends_on = None

SERVICE_NAMES = ("identity", "civil", "household", "benefits", "payment", "complaint", "sms")


def upgrade() -> None:
    op.create_table(
        "mock_identities",
        sa.Column("cnic_digits", sa.String(length=13), primary_key=True),
        sa.Column("full_name", sa.String(length=120), nullable=False),
        sa.Column("full_name_ur", sa.String(length=160), nullable=False),
        sa.Column("father_or_spouse_name", sa.String(length=120), nullable=True),
        sa.Column("dob", sa.Date(), nullable=True),
        sa.Column("gender", sa.String(length=1), nullable=False, server_default="F"),
        sa.Column("district", sa.String(length=64), nullable=False),
        sa.Column("is_alive", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("cnic_expiry_date", sa.Date(), nullable=True),
        sa.Column("marital_status", sa.String(length=24), nullable=True),
        sa.Column(
            "variants_json",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
    )
    op.create_index("ix_mock_identities_district", "mock_identities", ["district"])
    op.create_index("ix_mock_identities_full_name", "mock_identities", ["full_name"])

    op.create_table(
        "mock_civil_deaths",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("deceased_cnic", sa.String(length=13), nullable=True),
        sa.Column("deceased_name", sa.String(length=120), nullable=False),
        sa.Column("spouse_cnic", sa.String(length=13), nullable=True),
        sa.Column("spouse_name", sa.String(length=120), nullable=True),
        sa.Column("death_date", sa.Date(), nullable=True),
        sa.Column("district", sa.String(length=64), nullable=False),
        sa.Column("certificate_no", sa.String(length=40), nullable=False, unique=True),
    )
    op.create_index("ix_mock_civil_deaths_deceased_cnic", "mock_civil_deaths", ["deceased_cnic"])
    op.create_index("ix_mock_civil_deaths_spouse_cnic", "mock_civil_deaths", ["spouse_cnic"])

    op.create_table(
        "mock_households",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("head_cnic", sa.String(length=13), nullable=False),
        sa.Column(
            "member_cnics",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        sa.Column("district", sa.String(length=64), nullable=False),
        sa.Column("household_size", sa.Integer(), nullable=False),
        sa.Column("monthly_income_pkr", sa.Integer(), nullable=False),
        sa.Column("poverty_score", sa.Integer(), nullable=False),
        sa.Column("survey_year", sa.Integer(), nullable=False),
    )
    op.create_index("ix_mock_households_head_cnic", "mock_households", ["head_cnic"])

    op.create_table(
        "mock_benefits",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("cnic_digits", sa.String(length=13), nullable=False),
        sa.Column("program_name", sa.String(length=120), nullable=False),
        sa.Column("monthly_amount_pkr", sa.Integer(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("started_at", sa.Date(), nullable=True),
    )
    op.create_index("ix_mock_benefits_cnic_digits", "mock_benefits", ["cnic_digits"])

    op.create_table(
        "mock_payments",
        sa.Column("idempotency_key", sa.String(length=128), primary_key=True),
        sa.Column("payment_ref", sa.String(length=40), nullable=False, unique=True),
        sa.Column("payout_alias", sa.String(length=32), nullable=False),
        sa.Column("account_title", sa.String(length=120), nullable=True),
        sa.Column("amount_pkr", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("failure_reason", sa.String(length=120), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index("ix_mock_payments_payout_alias", "mock_payments", ["payout_alias"])

    op.create_table(
        "mock_complaints",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("external_ref", sa.String(length=40), nullable=False, unique=True),
        sa.Column("payment_ref", sa.String(length=40), nullable=True),
        sa.Column("citizen_cnic", sa.String(length=13), nullable=True),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("status", sa.String(length=24), nullable=False, server_default="REGISTERED"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index("ix_mock_complaints_payment_ref", "mock_complaints", ["payment_ref"])

    op.create_table(
        "mock_service_configs",
        sa.Column("service_name", sa.String(length=32), primary_key=True),
        sa.Column("mode", sa.String(length=16), nullable=False, server_default="NORMAL"),
        sa.Column("latency_ms", sa.Integer(), nullable=False, server_default="4000"),
        sa.Column("failure_rate", sa.Float(), nullable=False, server_default="0.5"),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )

    # Every simulated service starts in NORMAL so a fresh database behaves.
    op.bulk_insert(
        sa.table(
            "mock_service_configs",
            sa.column("service_name", sa.String),
            sa.column("mode", sa.String),
            sa.column("latency_ms", sa.Integer),
            sa.column("failure_rate", sa.Float),
        ),
        [
            {"service_name": name, "mode": "NORMAL", "latency_ms": 4000, "failure_rate": 0.5}
            for name in SERVICE_NAMES
        ],
    )


def downgrade() -> None:
    op.drop_table("mock_service_configs")
    op.drop_index("ix_mock_complaints_payment_ref", table_name="mock_complaints")
    op.drop_table("mock_complaints")
    op.drop_index("ix_mock_payments_payout_alias", table_name="mock_payments")
    op.drop_table("mock_payments")
    op.drop_index("ix_mock_benefits_cnic_digits", table_name="mock_benefits")
    op.drop_table("mock_benefits")
    op.drop_index("ix_mock_households_head_cnic", table_name="mock_households")
    op.drop_table("mock_households")
    op.drop_index("ix_mock_civil_deaths_spouse_cnic", table_name="mock_civil_deaths")
    op.drop_index("ix_mock_civil_deaths_deceased_cnic", table_name="mock_civil_deaths")
    op.drop_table("mock_civil_deaths")
    op.drop_index("ix_mock_identities_full_name", table_name="mock_identities")
    op.drop_index("ix_mock_identities_district", table_name="mock_identities")
    op.drop_table("mock_identities")
