"""Auditor console — strict read-only (docs/05 §3.8)."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models.audit import AuditEvent
from app.models.cases import Case, CaseNote, Decision
from app.models.consent import ConsentAccessLog, ConsentEvent, ConsentGrant
from app.models.enums import ConsentPurpose, DataCategory, UserRole
from app.models.identity import Citizen
from app.schemas.serializers import decision_to_dict, grant_to_dict, note_to_dict
from app.security import audit
from app.security.consent import enforce_consent
from app.security.errors import NotFoundError
from app.security.masking import mask_cnic, mask_phone
from app.security.rbac import ActorContext, require_roles

router = APIRouter(prefix="/auditor", tags=["auditor"])

DbSession = Annotated[Session, Depends(get_db)]
AuditorActor = Annotated[ActorContext, Depends(require_roles(UserRole.AUDITOR))]


def _mask_facts_dict(raw: dict[str, Any] | None) -> dict[str, Any]:
    """Never expose raw 13-digit CNICs or full phone numbers in auditor trace payloads."""
    if not raw:
        return {}
    out: dict[str, Any] = {}
    for key, val in raw.items():
        if key in {"applicant_cnic", "spouse_cnic"} and val:
            out[key] = mask_cnic(str(val))
        elif key in {"payout_phone", "phone"} and val:
            out[key] = mask_phone(str(val))
        elif isinstance(val, dict) and "value" in val:
            copied = dict(val)
            if key in {"applicant_cnic", "spouse_cnic"} and copied.get("value"):
                copied["value"] = mask_cnic(str(copied["value"]))
            elif key in {"payout_phone", "phone"} and copied.get("value"):
                copied["value"] = mask_phone(str(copied["value"]))
            out[key] = copied
        else:
            out[key] = val
    return out


def _event_json(event: AuditEvent) -> dict[str, Any]:
    return {
        "seq": event.seq,
        "id": str(event.id),
        "tenant_id": str(event.tenant_id) if event.tenant_id else None,
        "actor_type": event.actor_type,
        "actor_id": event.actor_id,
        "actor_role": event.actor_role,
        "action": event.action,
        "resource_type": event.resource_type,
        "resource_id": event.resource_id,
        "request_id": event.request_id,
        "payload": event.payload_json or {},
        "prev_hash": event.prev_hash,
        "event_hash": event.event_hash,
        "created_at": event.created_at.isoformat() if event.created_at else None,
    }


@router.get("/events", summary="Filterable audit event stream")
def list_events(
    actor: AuditorActor,
    db: DbSession,
    case_id: uuid.UUID | None = Query(default=None),
    actor_type: str | None = Query(default=None),
    action: str | None = Query(default=None),
    tenant_id: uuid.UUID | None = Query(default=None),
    from_ts: datetime | None = Query(default=None, alias="from"),
    to_ts: datetime | None = Query(default=None, alias="to"),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> dict[str, Any]:
    query = select(AuditEvent)
    count_query = select(func.count()).select_from(AuditEvent)

    def _apply(stmt):
        if case_id is not None:
            stmt = stmt.where(
                or_(
                    AuditEvent.resource_id == str(case_id),
                    AuditEvent.payload_json["case_id"].astext == str(case_id),
                )
            )
        if actor_type:
            stmt = stmt.where(AuditEvent.actor_type == actor_type)
        if action:
            stmt = stmt.where(AuditEvent.action == action)
        if tenant_id is not None:
            stmt = stmt.where(AuditEvent.tenant_id == tenant_id)
        if from_ts is not None:
            stmt = stmt.where(AuditEvent.created_at >= from_ts)
        if to_ts is not None:
            stmt = stmt.where(AuditEvent.created_at <= to_ts)
        return stmt

    query = _apply(query)
    count_query = _apply(count_query)

    total = db.execute(count_query).scalar_one()
    rows = (
        db.execute(query.order_by(AuditEvent.seq.desc()).limit(limit).offset(offset))
        .scalars()
        .all()
    )
    return {
        "items": [_event_json(row) for row in rows],
        "total": total,
        "limit": limit,
        "offset": offset,
    }


@router.get("/cases/{case_id}/trace", summary="Complete decision trace for one case")
def case_trace(case_id: uuid.UUID, actor: AuditorActor, db: DbSession) -> dict[str, Any]:
    case = db.get(Case, case_id)
    if case is None:
        raise NotFoundError()

    # Statutory oversight bypasses the grant but is always logged (docs/09 §4.1).
    enforce_consent(
        db,
        citizen_id=case.citizen_id,
        actor=actor,
        category=DataCategory.CASE_HISTORY,
        purpose=ConsentPurpose.BENEFIT_APPLICATION,
        resource_ref=f"case:{case.id}",
    )

    citizen = db.get(Citizen, case.citizen_id)
    decisions = (
        db.execute(
            select(Decision)
            .where(Decision.case_id == case_id)
            .order_by(Decision.created_at.asc())
        )
        .scalars()
        .all()
    )
    notes = (
        db.execute(
            select(CaseNote)
            .where(CaseNote.case_id == case_id)
            .order_by(CaseNote.created_at.asc())
        )
        .scalars()
        .all()
    )
    events = (
        db.execute(
            select(AuditEvent)
            .where(
                or_(
                    AuditEvent.resource_id == str(case_id),
                    AuditEvent.payload_json["case_id"].astext == str(case_id),
                )
            )
            .order_by(AuditEvent.seq.asc())
        )
        .scalars()
        .all()
    )

    return {
        "case": {
            "id": str(case.id),
            "reference_code": case.reference_code,
            "status": case.status,
            "case_type": case.case_type,
            "tenant_id": str(case.tenant_id),
            "citizen": {
                "id": str(citizen.id) if citizen else None,
                "full_name": citizen.full_name if citizen else None,
                "cnic_masked": mask_cnic(citizen.cnic_digits) if citizen else None,
            },
            "facts": _mask_facts_dict(case.draft_answers),
            "flags": case.flags_json or [],
            "ai_case_note": case.ai_case_note,
            "citizen_explanation": case.citizen_explanation,
            "latest_confidence": float(case.latest_confidence)
            if case.latest_confidence is not None
            else None,
            "latest_route": case.latest_route,
            "latest_rule_version_id": str(case.latest_rule_version_id)
            if case.latest_rule_version_id
            else None,
        },
        "decisions": [
            {
                **decision_to_dict(decision),
                "rule_trace": decision.rule_trace_json or [],
                "input_snapshot": _mask_facts_dict(decision.input_snapshot_json),
            }
            for decision in decisions
        ],
        "agent_steps": [note_to_dict(note) for note in notes if note.note_type == "AGENT_STEP"],
        "notes": [note_to_dict(note) for note in notes],
        "events": [_event_json(event) for event in events],
    }


@router.get("/consents", summary="Consent grant history and access logs (allowed + denied)")
def consent_history(
    actor: AuditorActor,
    db: DbSession,
    citizen_id: uuid.UUID | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> dict[str, Any]:
    grant_query = select(ConsentGrant)
    log_query = select(ConsentAccessLog)
    event_query = select(ConsentEvent)
    if citizen_id is not None:
        grant_query = grant_query.where(ConsentGrant.citizen_id == citizen_id)
        log_query = log_query.where(ConsentAccessLog.citizen_id == citizen_id)
        event_query = event_query.where(ConsentEvent.citizen_id == citizen_id)

    grants = (
        db.execute(grant_query.order_by(ConsentGrant.granted_at.desc()).limit(limit).offset(offset))
        .scalars()
        .all()
    )
    logs = (
        db.execute(log_query.order_by(ConsentAccessLog.created_at.desc()).limit(limit).offset(offset))
        .scalars()
        .all()
    )
    events = (
        db.execute(event_query.order_by(ConsentEvent.created_at.desc()).limit(limit).offset(offset))
        .scalars()
        .all()
    )

    return {
        "grants": [grant_to_dict(grant) for grant in grants],
        "access_logs": [
            {
                "id": str(log.id),
                "citizen_id": str(log.citizen_id),
                "actor_role": log.actor_role,
                "actor_label": log.actor_label,
                "tenant_id": str(log.tenant_id) if log.tenant_id else None,
                "category": log.category,
                "purpose": log.purpose,
                "resource_ref": log.resource_ref,
                "allowed": log.allowed,
                "denial_reason": log.denial_reason,
                "created_at": log.created_at.isoformat() if log.created_at else None,
            }
            for log in logs
        ],
        "events": [
            {
                "id": str(event.id),
                "grant_id": str(event.grant_id),
                "citizen_id": str(event.citizen_id),
                "action": event.action,
                "actor_user_id": str(event.actor_user_id),
                "snapshot": event.snapshot_json,
                "created_at": event.created_at.isoformat() if event.created_at else None,
            }
            for event in events
        ],
    }


@router.get("/verify-chain", summary="Recompute the SHA-256 audit hash chain")
def verify_chain(actor: AuditorActor, db: DbSession) -> dict[str, Any]:
    return audit.verify_chain(db)


__all__ = ["router"]
