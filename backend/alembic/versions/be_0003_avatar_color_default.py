"""``citizens.avatar_color`` default follows the new brand accent.

The column default was ``#0F766E`` (Tailwind ``teal-700``). The UI accent moved to
``#0E6A60`` when the palette was retuned, so every citizen row created without an
explicit colour would have carried a teal that no longer appears anywhere in the
design system - a seeded avatar that is subtly the wrong green next to every
button on the screen.

The seed always passes ``avatar_color`` explicitly, so this changes no existing
row; it only stops the default from drifting away from the tokens. Existing rows
are left alone on purpose: an avatar colour is per-citizen identity, and
rewriting it would be a cosmetic migration of user-visible data.

Revision ID: be_0003
Revises: be_0002
Create Date: 2026-11-21 11:05:00.000000
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "be_0003"
down_revision = "be_0002"
branch_labels = None
depends_on = None

TABLE = "citizens"
COLUMN = "avatar_color"
NEW_DEFAULT = sa.text("'#0E6A60'")
OLD_DEFAULT = sa.text("'#0F766E'")


def upgrade() -> None:
    op.alter_column(TABLE, COLUMN, server_default=NEW_DEFAULT)


def downgrade() -> None:
    op.alter_column(TABLE, COLUMN, server_default=OLD_DEFAULT)


__all__ = ["revision", "down_revision", "upgrade", "downgrade"]
