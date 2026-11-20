"""Tamper-evident audit hash chain — docs/09 §5, implemented exactly.

Formula (frozen):

    canonical_payload = json.dumps(redacted_payload, sort_keys=True,
                                   separators=(",", ":"), ensure_ascii=False)
    material = f"{prev_hash}|{seq}|{created_at.isoformat()}|{action}|"
               f"{resource_type}|{resource_id or ''}|{canonical_payload}"
    event_hash = sha256(material.encode("utf-8")).hexdigest()

``seq`` is drawn from the PostgreSQL sequence *before* the insert so the hash can
cover it. Writers serialize on ``pg_advisory_xact_lock(99887766)`` inside the same
transaction as the mutation they describe, so a rolled-back mutation also rolls
back its audit row (no orphan events) while the chain tip stays consistent.
"""

from __future__ import annotations

import hashlib
import json
import logging
import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.config import settings
from app.models.audit import AuditEvent
from app.models.base import utcnow
from app.models.enums import ActorType
from app.security.context import get_request_id
from app.security.masking import redact_payload

logger = logging.getLogger(__name__)

GENESIS = "GENESIS"
AUDIT_SEQ_NAME = "audit_events_seq_seq"


def canonical_payload(payload: dict[str, Any] | None) -> str:
    return json.dumps(
        redact_payload(payload or {}),
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
        default=str,
    )


def compute_event_hash(
    *,
    prev_hash: str,
    seq: int,
    created_at: datetime,
    action: str,
    resource_type: str,
    resource_id: str | None,
    payload: dict[str, Any] | None,
) -> str:
    material = (
        f"{prev_hash}|{seq}|{created_at.astimezone(UTC).isoformat()}|{action}|"
        f"{resource_type}|{resource_id or ''}|{canonical_payload(payload)}"
    )
    return hashlib.sha256(material.encode("utf-8")).hexdigest()


def _chain_tip(db: Session) -> str:
    tip = db.execute(
        select(AuditEvent.event_hash).order_by(AuditEvent.seq.desc()).limit(1)
    ).scalar_one_or_none()
    return tip or GENESIS


def record(
    db: Session,
    *,
    action: str,
    resource_type: str,
    resource_id: str | uuid.UUID | None = None,
    actor_type: ActorType | str = ActorType.SYSTEM,
    actor_id: str | uuid.UUID | None = None,
    actor_role: str | None = None,
    tenant_id: uuid.UUID | str | None = None,
    request_id: str | None = None,
    payload: dict[str, Any] | None = None,
    actor_user_id: str | uuid.UUID | None = None,
) -> AuditEvent:
    """Append one hash-chained audit event inside the caller's transaction.

    ``actor_user_id`` is accepted as an alias for ``actor_id`` (the case agent and
    rule editor call it that way); it also implies ``actor_type=USER``.
    """
    if actor_id is None and actor_user_id is not None:
        actor_id = actor_user_id
        if actor_type == ActorType.SYSTEM:
            actor_type = ActorType.USER

    # Serialize chain-tip reads for the duration of this transaction.
    db.execute(
        text("SELECT pg_advisory_xact_lock(:lock_key)"),
        {"lock_key": settings.audit_chain_lock_key},
    )

    prev_hash = _chain_tip(db)
    # The sequence is the normal source, but seeded rows carry explicit ``seq``
    # values, so the next number must also clear the current maximum. Under the
    # advisory lock above this is exact, and ``MAX(seq)`` is an index-only scan.
    seq = int(
        db.execute(
            text(
                "SELECT GREATEST(nextval(:seq_name), "
                "COALESCE((SELECT MAX(seq) FROM audit_events), 0) + 1)"
            ),
            {"seq_name": AUDIT_SEQ_NAME},
        ).scalar_one()
    )
    created_at = utcnow()

    event = AuditEvent(
        seq=seq,
        tenant_id=_as_uuid(tenant_id),
        actor_type=str(actor_type),
        actor_id=str(actor_id) if actor_id is not None else None,
        actor_role=actor_role,
        action=action,
        resource_type=resource_type,
        resource_id=str(resource_id) if resource_id is not None else None,
        request_id=request_id or get_request_id(),
        payload_json=redact_payload(payload or {}),
        prev_hash=prev_hash,
        event_hash=compute_event_hash(
            prev_hash=prev_hash,
            seq=seq,
            created_at=created_at,
            action=action,
            resource_type=resource_type,
            resource_id=str(resource_id) if resource_id is not None else None,
            payload=payload,
        ),
        created_at=created_at,
    )
    db.add(event)
    db.flush()
    return event


def record_isolated(**kwargs: Any) -> AuditEvent | None:
    """Write one audit event in its own short-lived session and commit immediately.

    Used for denials that must survive the caller's rollback (ADR-008): a ``403``
    or ``404`` response must never erase the evidence that access was blocked.
    """
    from app.db import SessionLocal  # local import keeps module import order simple

    db = SessionLocal()
    try:
        event = record(db, **kwargs)
        db.commit()
        return event
    except Exception:  # noqa: BLE001 - a failed audit write must not mask the denial
        db.rollback()
        logger.exception("audit.record_isolated failed")
        return None
    finally:
        db.close()


def verify_chain(db: Session) -> dict[str, Any]:
    """Recompute the whole chain; report the exact ``first_broken_seq``."""
    rows = db.execute(select(AuditEvent).order_by(AuditEvent.seq.asc())).scalars().all()

    expected_prev = GENESIS
    checked = 0
    first_broken_seq: int | None = None

    for row in rows:
        checked += 1
        recomputed = compute_event_hash(
            prev_hash=row.prev_hash,
            seq=row.seq,
            created_at=row.created_at,
            action=row.action,
            resource_type=row.resource_type,
            resource_id=row.resource_id,
            payload=row.payload_json,
        )
        if row.prev_hash != expected_prev or recomputed != row.event_hash:
            first_broken_seq = row.seq
            break
        expected_prev = row.event_hash

    return {
        "valid": first_broken_seq is None,
        "checked_count": checked,
        "first_broken_seq": first_broken_seq,
        "verified_at": utcnow().isoformat(),
    }


def _as_uuid(value: uuid.UUID | str | None) -> uuid.UUID | None:
    if value is None or isinstance(value, uuid.UUID):
        return value
    try:
        return uuid.UUID(str(value))
    except (ValueError, AttributeError):
        return None


__all__ = [
    "AUDIT_SEQ_NAME",
    "GENESIS",
    "canonical_payload",
    "compute_event_hash",
    "record",
    "record_isolated",
    "verify_chain",
]
