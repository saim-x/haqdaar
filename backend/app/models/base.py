"""Declarative base, shared column types and mixins (docs/04 §1 conventions)."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import DateTime, MetaData, text
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

# Deterministic constraint names keep Alembic diffs stable across agents.
NAMING_CONVENTION = {
    "ix": "ix_%(table_name)s_%(column_0_N_name)s",
    "uq": "uq_%(table_name)s_%(column_0_N_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=NAMING_CONVENTION)


def utcnow() -> datetime:
    """Timezone-aware UTC now. All TIMESTAMPTZ columns are written through this."""
    return datetime.now(UTC)


def new_uuid() -> uuid.UUID:
    """Application-side UUIDv4 so ids are known before flush (docs/04 §1)."""
    return uuid.uuid4()


#: TIMESTAMPTZ — every timestamp column in the schema uses this type.
TSTAMPTZ = DateTime(timezone=True)


class UUIDPrimaryKeyMixin:
    id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, default=new_uuid
    )


class CreatedAtMixin:
    # ``server_default`` keeps raw-SQL inserts (seed scripts, fixtures, psql)
    # working; the ORM still writes the Python-side ``utcnow``.
    created_at: Mapped[datetime] = mapped_column(
        TSTAMPTZ, nullable=False, default=utcnow, server_default=text("now()")
    )


class TimestampMixin(CreatedAtMixin):
    updated_at: Mapped[datetime] = mapped_column(
        TSTAMPTZ,
        nullable=False,
        default=utcnow,
        onupdate=utcnow,
        server_default=text("now()"),
    )
