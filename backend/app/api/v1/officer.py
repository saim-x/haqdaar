"""Officer queue, decisions, four-eyes approval and corrections — docs/05 §3.6."""

from __future__ import annotations

import hashlib
import json
import uuid
from datetime import UTC, datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query
from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session

from app.db import get_db
from app.jobs.queue import enqueue_job
from app.models.case_state import assert_transition
from app.models.cases import Case, CaseNote, Decision
from app.models.consent import DataCorrectionRequest
from app.models.enums import (
    CaseStatus,
    CaseType,
    ConsentPurpose,
    CorrectionStatus,
    DataCategory,
    DecisionSource,
    JobType,
    NoteType,
    PriorityBand,
    UserRole,
)
from app.models.identity import Citizen, User
from app.models.programs import Program, RuleVersion
from app.schemas.serializers import case_card, case_to_dict, document_to_dict
from app.security import audit
from app.security.consent import enforce_consent
from app.security.errors import (
    InvalidTransitionError,
    NotFoundError,
    SameOfficerError,
    ValidationError,
)
from app.security.rbac import ActorContext, assert_tenant_scope, require_roles

router = APIRouter(prefix="/officer", tags=["officer"])

DbSession = Annotated[Session, Depends(get_db)]
OfficerActor = Annotated[ActorContext, Depends(require_roles(UserRole.OFFICER))]

DECISION_ACTIONS = frozenset({"APPROVE", "REJECT", "REQUEST_INFO", "ESCALATE"})
FOUR_EYES_BANDS = frozenset({PriorityBand.HIGH.value, PriorityBand.URGENT.value})
QUEUE_SORTS = frozenset({"priority", "confidence_asc", "oldest"})
QUEUE_STATUSES = frozenset(
    {
        CaseStatus.HUMAN_REVIEW.value,
        CaseStatus.IN_REVIEW.value,
        CaseStatus.PENDING_SECOND_APPROVAL.value,
        CaseStatus.NEEDS_INFO.value,
        CaseStatus.WAITING_EXTERNAL.value,
    }
)


def _now() -> datetime:
    return datetime.now(UTC)


def _audit_actor(actor: ActorContext) -> dict[str, Any]:
    return {
        "actor_type": actor.actor_type,
        "actor_id": actor.actor_id_str,
        "actor_role": actor.role_value,
    }


def _load_case(db: Session, case_id: uuid.UUID, actor: ActorContext) -> Case:
    case = db.get(Case, case_id)
    if case is None:
        raise NotFoundError()
    assert_tenant_scope(db, actor, case.tenant_id, resource_type="case", resource_id=case.id)
    return case


def _officer_consent(
    db: Session,
    *,
    citizen_id: uuid.UUID,
    actor: ActorContext,
    category: DataCategory,
    resource_ref: str,
) -> None:
    enforce_consent(
        db,
        citizen_id=citizen_id,
        actor=actor,
        category=category,
        purpose=ConsentPurpose.BENEFIT_APPLICATION,
        resource_ref=resource_ref,
    )


def _case_consent(db: Session, case: Case, actor: ActorContext, *, category: DataCategory) -> None:
    _officer_consent(
        db,
        citizen_id=case.citizen_id,
        actor=actor,
        category=category,
        resource_ref=f"case:{case.id}",
    )


def _rule_version_for(db: Session, case: Case) -> RuleVersion:
    """The rule version an officer decision is recorded against."""
    if case.latest_rule_version_id is not None:
        rule_version = db.get(RuleVersion, case.latest_rule_version_id)
        if rule_version is not None:
            return rule_version
    program = db.get(Program, case.program_id)
    if program is not None and program.active_rule_version_id is not None:
        rule_version = db.get(RuleVersion, program.active_rule_version_id)
        if rule_version is not None:
            return rule_version
    raise ValidationError(
        message_en="This case has no rule version to record a decision against.",
        message_ur="اس درخواست کے لیے کوئی قاعدہ ورژن موجود نہیں۔",
        details={"case_id": str(case.id)},
    )


def _snapshot_hash(payload: dict[str, Any]) -> str:
    material = json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(material.encode("utf-8")).hexdigest()


def _record_officer_decision(
    db: Session,
    *,
    case: Case,
    actor: ActorContext,
    action: str,
    outcome_status: str,
    reason_codes: list[str],
    note: str | None,
    override_amount_pkr: int | None,
    second_approval: bool,
) -> Decision:
    rule_version = _rule_version_for(db, case)
    snapshot = {
        "case_id": str(case.id),
        "facts": case.draft_answers or {},
        "flags": case.flags_json or [],
        "officer_action": action,
        "reason_codes": reason_codes,
        "override_amount_pkr": override_amount_pkr,
    }
    explanation = {
        "headline_en": _OUTCOME_HEADLINES.get(outcome_status, ("Decision recorded", ""))[0],
        "headline_ur": _OUTCOME_HEADLINES.get(outcome_status, ("", "فیصلہ درج ہو گیا"))[1],
        "reasons_en": [note] if note else [],
        "reasons_ur": [],
        "next_step_en": "You will receive a notification with the details.",
        "next_step_ur": "آپ کو تفصیلات کے ساتھ اطلاع مل جائے گی۔",
    }

    decision = Decision(
        tenant_id=case.tenant_id,
        case_id=case.id,
        decision_source=(
            DecisionSource.SECOND_OFFICER.value if second_approval else DecisionSource.OFFICER.value
        ),
        actor_user_id=actor.user_id,
        rule_version_id=rule_version.id,
        rule_content_hash=rule_version.content_hash,
        input_snapshot_json=snapshot,
        input_snapshot_hash=_snapshot_hash(snapshot),
        rule_trace_json=[
            {
                "step": "OFFICER_DECISION",
                "action": action,
                "reason_codes": reason_codes,
                "officer_user_id": str(actor.user_id),
            }
        ],
        confidence_components={
            "identity": 1.0,
            "documents": 1.0,
            "data_consistency": 1.0,
            "consent_assurance": 1.0,
            "overall": 1.0,
        },
        confidence_overall=1.0,
        route_action="HUMAN_REVIEW",
        outcome_status=outcome_status,
        escalation_reasons=[],
        model_versions={"decision": "officer-v1"},
        citizen_explanation=explanation,
        computed_amount_pkr=override_amount_pkr,
        officer_reason_codes=reason_codes,
        officer_note=note,
        is_override=True,
    )
    db.add(decision)
    db.flush()
    return decision


_OUTCOME_HEADLINES: dict[str, tuple[str, str]] = {
    CaseStatus.APPROVED.value: (
        "Your application is approved.",
        "آپ کی درخواست منظور ہو گئی ہے۔",
    ),
    CaseStatus.REJECTED.value: (
        "Your application was not approved. See the reasons below.",
        "آپ کی درخواست منظور نہیں ہوئی۔ وجوہات نیچے دیکھیں۔",
    ),
    CaseStatus.NEEDS_INFO.value: (
        "We need a little more information from you.",
        "ہمیں آپ سے کچھ مزید معلومات درکار ہیں۔",
    ),
    CaseStatus.HUMAN_REVIEW.value: (
        "Your case was escalated to a senior officer.",
        "آپ کا کیس سینئر افسر کو بھیج دیا گیا ہے۔",
    ),
    CaseStatus.PENDING_SECOND_APPROVAL.value: (
        "Your application passed the first check and awaits final approval.",
        "آپ کی درخواست پہلی جانچ سے گزر گئی اور حتمی منظوری کا انتظار ہے۔",
    ),
}


# --- queue ------------------------------------------------------------------


@router.get("/queue", summary="Officer work queue with server-side sorting")
def officer_queue(
    actor: OfficerActor,
    db: DbSession,
    sort: str = Query(default="priority"),
    status: str | None = Query(default=None),
    flag: str | None = Query(default=None),
    assigned: str = Query(default="all"),
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
) -> dict[str, Any]:
    if sort not in QUEUE_SORTS:
        raise ValidationError(
            details={"fields": [{"field": "sort", "reason": "INVALID_VALUE"}]}
        )
    if assigned not in {"me", "unassigned", "all"}:
        raise ValidationError(
            details={"fields": [{"field": "assigned", "reason": "INVALID_VALUE"}]}
        )

    query = select(Case).where(Case.tenant_id == actor.tenant_id)
    count_query = select(func.count()).select_from(Case).where(Case.tenant_id == actor.tenant_id)

    if status:
        if status not in {item.value for item in CaseStatus}:
            raise ValidationError(
                details={"fields": [{"field": "status", "reason": "INVALID_VALUE"}]}
            )
        query = query.where(Case.status == status)
        count_query = count_query.where(Case.status == status)
    else:
        # Applications wait in the review statuses. A complaint is a short-lived case
        # that the CHECK_COMPLAINT job usually closes on its own, but while it is open
        # an officer should be able to see it — that is the whole point of filing one.
        query = query.where(
            or_(
                Case.status.in_(sorted(QUEUE_STATUSES)),
                and_(
                    Case.case_type == CaseType.COMPLAINT.value,
                    Case.status != CaseStatus.CLOSED.value,
                ),
            )
        )
        count_query = count_query.where(
            or_(
                Case.status.in_(sorted(QUEUE_STATUSES)),
                and_(
                    Case.case_type == CaseType.COMPLAINT.value,
                    Case.status != CaseStatus.CLOSED.value,
                ),
            )
        )

    if assigned == "me":
        query = query.where(Case.assigned_officer_id == actor.user_id)
        count_query = count_query.where(Case.assigned_officer_id == actor.user_id)
    elif assigned == "unassigned":
        query = query.where(Case.assigned_officer_id.is_(None))
        count_query = count_query.where(Case.assigned_officer_id.is_(None))

    if flag:
        query = query.where(Case.flags_json.contains([{"code": flag}]))
        count_query = count_query.where(Case.flags_json.contains([{"code": flag}]))

    if sort == "priority":
        query = query.order_by(Case.priority_score.desc(), Case.created_at.asc())
    elif sort == "confidence_asc":
        query = query.order_by(Case.latest_confidence.asc().nulls_first(), Case.created_at.asc())
    else:
        query = query.order_by(Case.created_at.asc())

    total = db.execute(count_query).scalar_one()
    rows = db.execute(query.limit(limit).offset(offset)).scalars().all()

    items = []
    for case in rows:
        citizen = db.get(Citizen, case.citizen_id)
        program = db.get(Program, case.program_id)
        card = case_card(case, citizen=citizen, program=program)
        card["rule_stale"] = _rule_is_stale(db, case, program)
        items.append(card)

    return {"items": items, "total": total, "limit": limit, "offset": offset, "sort": sort}


def _rule_is_stale(db: Session, case: Case, program: Program | None) -> bool:
    if program is None or program.active_rule_version_id is None:
        return False
    return case.latest_rule_version_id != program.active_rule_version_id


@router.get("/cases/{case_id}", summary="Full case file for an officer")
def officer_case(case_id: uuid.UUID, actor: OfficerActor, db: DbSession) -> dict[str, Any]:
    case = _load_case(db, case_id, actor)
    _case_consent(db, case, actor, category=DataCategory.CASE_HISTORY)

    from app.models.cases import Document, Payment

    documents = (
        db.execute(select(Document).where(Document.case_id == case.id)).scalars().all()
    )
    payment = db.execute(
        select(Payment).where(Payment.case_id == case.id).limit(1)
    ).scalar_one_or_none()
    notes = (
        db.execute(
            select(CaseNote)
            .where(CaseNote.case_id == case.id)
            .order_by(CaseNote.created_at.asc())
        )
        .scalars()
        .all()
    )
    citizen = db.get(Citizen, case.citizen_id)
    program = db.get(Program, case.program_id)

    body = case_to_dict(
        case,
        program=program,
        documents=documents,
        payment=payment,
        notes=notes,
        include_internal=True,
    )
    body["citizen"] = {
        "id": str(citizen.id) if citizen else None,
        "full_name": citizen.full_name if citizen else None,
        "district": citizen.district if citizen else None,
        "cnic_masked": case_card(case, citizen=citizen, program=program)["cnic_masked"],
    }
    body["documents"] = [document_to_dict(doc) for doc in documents]
    body["rule_stale"] = _rule_is_stale(db, case, program)
    db.commit()
    return body


# --- actions ----------------------------------------------------------------


@router.post("/cases/{case_id}/assign", summary="Assign a case to the current officer")
def assign_case(case_id: uuid.UUID, actor: OfficerActor, db: DbSession) -> dict[str, Any]:
    case = _load_case(db, case_id, actor)
    _case_consent(db, case, actor, category=DataCategory.CASE_HISTORY)

    if case.status == CaseStatus.IN_REVIEW.value and case.assigned_officer_id == actor.user_id:
        return {"case_id": str(case.id), "status": case.status, "assigned_officer_id": str(actor.user_id)}

    assert_transition(case.status, CaseStatus.IN_REVIEW, actor_role=actor.role_value)

    previous = case.status
    case.status = CaseStatus.IN_REVIEW.value
    case.assigned_officer_id = actor.user_id

    audit.record(
        db,
        action="officer.assigned",
        resource_type="case",
        resource_id=case.id,
        tenant_id=case.tenant_id,
        payload={
            "case_id": str(case.id),
            "from": previous,
            "to": case.status,
            "officer_user_id": str(actor.user_id),
        },
        **_audit_actor(actor),
    )
    db.commit()
    return {
        "case_id": str(case.id),
        "status": case.status,
        "assigned_officer_id": str(actor.user_id),
    }


@router.post("/cases/{case_id}/decide", summary="Record an officer decision (four-eyes enforced)")
def decide_case(
    case_id: uuid.UUID,
    payload: dict[str, Any],
    actor: OfficerActor,
    db: DbSession,
) -> dict[str, Any]:
    case = _load_case(db, case_id, actor)
    _case_consent(db, case, actor, category=DataCategory.CASE_HISTORY)

    action = str(payload.get("action") or "").upper()
    if action not in DECISION_ACTIONS:
        raise ValidationError(
            details={"fields": [{"field": "action", "reason": "INVALID_VALUE"}]}
        )

    reason_codes = [str(code)[:48] for code in (payload.get("reason_codes") or [])]
    note = str(payload["note"])[:2000] if payload.get("note") else None
    requested_fields = [str(field)[:48] for field in (payload.get("requested_fields") or [])]
    override_amount = payload.get("override_amount_pkr")
    override_amount_pkr = int(override_amount) if override_amount is not None else None

    if action == "REJECT" and not reason_codes:
        raise ValidationError(
            message_en="A rejection needs at least one reason code.",
            message_ur="مسترد کرنے کے لیے کم از کم ایک وجہ درکار ہے۔",
            details={"fields": [{"field": "reason_codes", "reason": "REQUIRED"}]},
        )
    if action == "REQUEST_INFO" and not requested_fields:
        raise ValidationError(
            details={"fields": [{"field": "requested_fields", "reason": "REQUIRED"}]}
        )

    if case.status not in {
        CaseStatus.IN_REVIEW.value,
        CaseStatus.PENDING_SECOND_APPROVAL.value,
    }:
        raise InvalidTransitionError(
            message_en="Assign this case to yourself before deciding it.",
            message_ur="فیصلہ کرنے سے پہلے کیس اپنے نام تفویض کریں۔",
            details={"status": case.status},
        )

    previous = case.status
    second_approval = False
    target: CaseStatus

    if action == "APPROVE":
        if case.status == CaseStatus.PENDING_SECOND_APPROVAL.value:
            if case.first_approver_id == actor.user_id:
                raise SameOfficerError(
                    details={"case_id": str(case.id), "officer_user_id": str(actor.user_id)}
                )
            second_approval = True
            target = CaseStatus.APPROVED
        elif case.priority_band in FOUR_EYES_BANDS:
            target = CaseStatus.PENDING_SECOND_APPROVAL
        else:
            target = CaseStatus.APPROVED
    elif action == "REJECT":
        target = CaseStatus.REJECTED
    elif action == "REQUEST_INFO":
        target = CaseStatus.NEEDS_INFO
    else:
        target = CaseStatus.HUMAN_REVIEW

    assert_transition(previous, target, actor_role=actor.role_value)

    case.status = target.value
    if target is CaseStatus.APPROVED:
        case.decided_at = _now()
        if override_amount_pkr is not None:
            case.approved_amount_pkr = override_amount_pkr
    elif target is CaseStatus.REJECTED:
        case.decided_at = _now()
    elif target is CaseStatus.PENDING_SECOND_APPROVAL:
        case.first_approver_id = actor.user_id
    elif target is CaseStatus.NEEDS_INFO:
        case.ask_more_rounds = (case.ask_more_rounds or 0) + 1
    elif target is CaseStatus.HUMAN_REVIEW:
        case.assigned_officer_id = None

    decision = _record_officer_decision(
        db,
        case=case,
        actor=actor,
        action=action,
        outcome_status=target.value,
        reason_codes=reason_codes,
        note=note,
        override_amount_pkr=override_amount_pkr,
        second_approval=second_approval,
    )

    if note or requested_fields:
        db.add(
            CaseNote(
                tenant_id=case.tenant_id,
                case_id=case.id,
                author_user_id=actor.user_id,
                note_type=NoteType.OFFICER_NOTE.value,
                body=note or f"Requested: {', '.join(requested_fields)}",
                metadata_json={"reason_codes": reason_codes, "requested_fields": requested_fields},
                is_visible_to_citizen=action in {"REQUEST_INFO", "REJECT"},
            )
        )
        db.flush()

    audit.record(
        db,
        action="officer.decision",
        resource_type="case",
        resource_id=case.id,
        tenant_id=case.tenant_id,
        payload={
            "case_id": str(case.id),
            "decision_id": str(decision.id),
            "from": previous,
            "to": target.value,
            "action": action,
            "reason_codes": reason_codes,
            "second_approval": second_approval,
        },
        **_audit_actor(actor),
    )

    if target is CaseStatus.APPROVED:
        enqueue_job(
            db,
            JobType.INITIATE_PAYMENT.value,
            {
                "case_id": str(case.id),
                "decision_id": str(decision.id),
                "tenant_id": str(case.tenant_id),
            },
            dedup_key=f"INITIATE_PAYMENT:{case.id}",
        )

    db.commit()
    return {
        "case_id": str(case.id),
        "status": case.status,
        "decision_id": str(decision.id),
        "second_approval": second_approval,
        "requires_second_approval": target is CaseStatus.PENDING_SECOND_APPROVAL,
        "status_label": {
            "en": _OUTCOME_HEADLINES.get(case.status, ("Decision recorded", ""))[0],
            "ur": _OUTCOME_HEADLINES.get(case.status, ("", "فیصلہ درج ہو گیا"))[1],
        },
    }


@router.post("/cases/{case_id}/reevaluate", summary="Re-run the pipeline against current rules")
def reevaluate(
    case_id: uuid.UUID,
    payload: dict[str, Any],
    actor: OfficerActor,
    db: DbSession,
) -> dict[str, Any]:
    case = _load_case(db, case_id, actor)
    _case_consent(db, case, actor, category=DataCategory.CASE_HISTORY)

    from app.agent.case_agent import ReevaluationNotAllowed, reevaluate_case

    try:
        result = reevaluate_case(
            db,
            case.id,
            officer_user_id=actor.user_id,
            reason=(str(payload.get("reason"))[:500] if payload.get("reason") else None),
        )
    except ReevaluationNotAllowed as exc:
        db.rollback()
        raise InvalidTransitionError(
            message_en=str(exc) or "This case cannot be re-evaluated right now.",
            message_ur="اس درخواست کا دوبارہ جائزہ ابھی نہیں لیا جا سکتا۔",
            details={"case_id": str(case.id)},
        ) from exc

    db.commit()
    return result if isinstance(result, dict) else {"case_id": str(case.id), "result": result}


@router.post("/cases/{case_id}/notes", status_code=201, summary="Add an internal or citizen-visible note")
def add_note(
    case_id: uuid.UUID,
    payload: dict[str, Any],
    actor: OfficerActor,
    db: DbSession,
) -> dict[str, Any]:
    case = _load_case(db, case_id, actor)
    _case_consent(db, case, actor, category=DataCategory.CASE_HISTORY)

    body = str(payload.get("body") or "").strip()
    if not body:
        raise ValidationError(details={"fields": [{"field": "body", "reason": "REQUIRED"}]})

    note = CaseNote(
        tenant_id=case.tenant_id,
        case_id=case.id,
        author_user_id=actor.user_id,
        note_type=NoteType.OFFICER_NOTE.value,
        body=body[:4000],
        metadata_json={},
        is_visible_to_citizen=bool(payload.get("visible_to_citizen")),
    )
    db.add(note)
    db.flush()

    audit.record(
        db,
        action="officer.note_added",
        resource_type="case",
        resource_id=case.id,
        tenant_id=case.tenant_id,
        payload={
            "case_id": str(case.id),
            "note_id": str(note.id),
            "visible_to_citizen": note.is_visible_to_citizen,
        },
        **_audit_actor(actor),
    )
    db.commit()
    return {
        "id": str(note.id),
        "case_id": str(case.id),
        "body": note.body,
        "visible_to_citizen": note.is_visible_to_citizen,
        "created_at": note.created_at.isoformat() if note.created_at else None,
    }


# --- corrections ------------------------------------------------------------


@router.get("/corrections", summary="Pending registry correction requests")
def list_corrections(
    actor: OfficerActor,
    db: DbSession,
    status: str = Query(default=CorrectionStatus.PENDING_OFFICER.value),
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
) -> dict[str, Any]:
    query = select(DataCorrectionRequest).where(DataCorrectionRequest.status == status)
    count_query = (
        select(func.count())
        .select_from(DataCorrectionRequest)
        .where(DataCorrectionRequest.status == status)
    )
    if actor.tenant_id is not None:
        query = query.where(
            (DataCorrectionRequest.tenant_id == actor.tenant_id)
            | (DataCorrectionRequest.tenant_id.is_(None))
        )
        count_query = count_query.where(
            (DataCorrectionRequest.tenant_id == actor.tenant_id)
            | (DataCorrectionRequest.tenant_id.is_(None))
        )

    total = db.execute(count_query).scalar_one()
    rows = (
        db.execute(
            query.order_by(DataCorrectionRequest.created_at.asc()).limit(limit).offset(offset)
        )
        .scalars()
        .all()
    )

    items = []
    for row in rows:
        citizen = db.get(Citizen, row.citizen_id)
        items.append(
            {
                "id": str(row.id),
                "citizen_id": str(row.citizen_id),
                "citizen_name": citizen.full_name if citizen else None,
                "field_key": row.field_key,
                "source_type": row.source_type,
                "old_value": row.old_value,
                "requested_value": row.requested_value,
                "reason": row.reason,
                "status": row.status,
                "created_at": row.created_at.isoformat() if row.created_at else None,
            }
        )
    return {"items": items, "total": total, "limit": limit, "offset": offset}


@router.post("/corrections/{correction_id}/resolve", summary="Approve or reject a correction")
def resolve_correction(
    correction_id: uuid.UUID,
    payload: dict[str, Any],
    actor: OfficerActor,
    db: DbSession,
) -> dict[str, Any]:
    correction = db.get(DataCorrectionRequest, correction_id)
    if correction is None:
        raise NotFoundError()

    decision = str(payload.get("decision") or "").upper()
    if decision not in {"APPROVE", "REJECT"}:
        raise ValidationError(
            details={"fields": [{"field": "decision", "reason": "INVALID_VALUE"}]}
        )

    if correction.status != CorrectionStatus.PENDING_OFFICER.value:
        raise InvalidTransitionError(
            message_en="This correction request was already resolved.",
            message_ur="یہ درستی کی درخواست پہلے حل ہو چکی ہے۔",
            details={"status": correction.status},
        )

    citizen = db.get(Citizen, correction.citizen_id)
    if citizen is None:
        raise NotFoundError()

    _officer_consent(
        db,
        citizen_id=citizen.id,
        actor=actor,
        category=DataCategory.IDENTITY,
        resource_ref=f"correction:{correction.id}",
    )

    correction.status = (
        CorrectionStatus.APPROVED.value
        if decision == "APPROVE"
        else CorrectionStatus.REJECTED.value
    )
    correction.reviewed_by_user_id = actor.user_id
    correction.tenant_id = actor.tenant_id

    applied = False
    if decision == "APPROVE":
        value = (correction.requested_value or {}).get("value")
        if correction.field_key == "applicant_full_name" and value:
            citizen.full_name = str(value)[:120]
            applied = True
        elif correction.field_key == "applicant_district" and value:
            citizen.district = str(value)[:64]
            applied = True
        elif value is not None:
            profile = dict(citizen.profile_data or {})
            registry = dict(profile.get("registry_overrides") or {})
            registry[correction.field_key] = value
            profile["registry_overrides"] = registry
            citizen.profile_data = profile
            applied = True

    db.flush()
    audit.record(
        db,
        action="correction.resolved",
        resource_type="data_correction_request",
        resource_id=correction.id,
        tenant_id=actor.tenant_id,
        payload={
            "correction_id": str(correction.id),
            "citizen_id": str(citizen.id),
            "field_key": correction.field_key,
            "decision": decision,
            "applied": applied,
            "note": (str(payload.get("note"))[:500] if payload.get("note") else None),
        },
        **_audit_actor(actor),
    )
    db.commit()
    return {
        "id": str(correction.id),
        "status": correction.status,
        "applied": applied,
        "reviewed_by_user_id": str(actor.user_id),
    }


@router.get("/officers", summary="Officers in this tenant (for escalation)")
def list_officers(actor: OfficerActor, db: DbSession) -> dict[str, Any]:
    rows = (
        db.execute(
            select(User)
            .where(
                User.tenant_id == actor.tenant_id,
                User.role == UserRole.OFFICER.value,
                User.is_active.is_(True),
            )
            .order_by(User.full_name.asc())
        )
        .scalars()
        .all()
    )
    return {
        "items": [
            {"id": str(user.id), "full_name": user.full_name, "email": user.email}
            for user in rows
        ]
    }


__all__ = ["router"]
