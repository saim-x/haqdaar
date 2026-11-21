"""ADR-019 - ``consent_access_logs.actor_user_id`` becomes nullable.

The case agent reads citizen data as ``actor_type=AGENT`` with no user row. The old
code wrote ``actor.user_id or uuid.UUID(int=0)``, which violated
``fk_consent_access_logs_actor_user_id_users``; because the isolated session that
persists access logs swallows write errors (it must never mask the security
decision), every one of those rows was silently dropped. That destroyed the
Challenge-06 evidence trail for agent reads - invariant 5 says every citizen-data
read is logged.

``AGENT``/``SYSTEM`` rows now carry ``actor_user_id = NULL`` with ``actor_role`` and
a descriptive ``actor_label``, mirroring ``audit_events.actor_id`` semantics.

Revision ID: be_0002
Revises: dpi_mock_0001
Create Date: 2026-11-21 00:20:00.000000
"""

from __future__ import annotations

from alembic import op
from sqlalchemy.dialects import postgresql

revision = "be_0002"
down_revision = "dpi_mock_0001"
branch_labels = None
depends_on = None

TABLE = "consent_access_logs"
COLUMN = "actor_user_id"
FK_NAME = "fk_consent_access_logs_actor_user_id_users"


def upgrade() -> None:
    op.alter_column(
        TABLE,
        COLUMN,
        existing_type=postgresql.UUID(as_uuid=True),
        nullable=True,
    )


def downgrade() -> None:
    # Rows written by AGENT/SYSTEM actors have no user to point at, so they cannot
    # survive a NOT NULL constraint. Delete them rather than inventing a user id.
    op.execute("DELETE FROM consent_access_logs WHERE actor_user_id IS NULL")
    op.alter_column(
        TABLE,
        COLUMN,
        existing_type=postgresql.UUID(as_uuid=True),
        nullable=False,
    )


__all__ = ["revision", "down_revision", "upgrade", "downgrade"]
