"""Citizen & helper case lifecycle — docs/05 §3.2, state machine docs/04 §3.3."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query, Request, Response
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db import get_db
from app.jobs.queue import enqueue_job
from app.models.case_state import assert_transition
from app.models.cases import CASE_REF_SEQ, Case, CaseNote, Decision, Document, Payment
from app.models.consent import ConsentGrant
from app.models.enums import (
    CaseStatus,
    CaseType,
    ConsentPurpose,
    ConsentRecipientType,
    ConsentStatus,
    DataCategory,
    JobType,
    NotificationChannel,
    UserRole,
)
from app.models.identity import Citizen
from app.models.programs import Program
from app.schemas.facts import (
    CANONICAL_FACT_KEY_SET,
    SELF_DECLARABLE_FACT_KEYS,
    missing_facts,
    normalize_fact,
)
from app.schemas.serializers import case_to_dict, decision_evidence, status_label
from app.security import audit
from app.security.consent import enforce_consent
from app.security.errors import NotFoundError, ValidationError
from app.security.http import etag_matches, not_modified, weak_etag
from app.security.idempotency import get_idempotency_key, remember, replay
from app.security.rbac import (
    ActorContext,
    assert_tenant_scope,
    get_act_for_citizen,
    require_roles,
    resolve_citizen_scope,
)

router = APIRouter(prefix="/cases", tags=["cases"])

DbSession = Annotated[Session, Depends(get_db)]
CitizenActor = Annotated[
    ActorContext, Depends(require_roles(UserRole.CITIZEN, UserRole.HELPER))
]
CaseReader = Annotated[
    ActorContext,
    Depends(require_roles(UserRole.CITIZEN, UserRole.HELPER, UserRole.OFFICER, UserRole.AUDITOR)),
]

#: Fallback when a program ships no ``wizard_schema.required_facts``.
DEFAULT_REQUIRED_FACTS: tuple[str, ...] = ("applicant_cnic", "applicant_full_name")

#: Statuses a citizen may still edit or withdraw.
EDITABLE_STATUSES = frozenset(
    {CaseStatus.DRAFT.value, CaseStatus.NEEDS_INFO.value, CaseStatus.ON_HOLD_CONSENT.value}
)

COMPLAINABLE_STATUSES = frozenset(
    {
        CaseStatus.APPROVED.value,
        CaseStatus.PAYMENT_INITIATED.value,
        CaseStatus.PAID.value,
        CaseStatus.PAYMENT_FAILED.value,
    }
)

_TIMELINE_LABELS: dict[str, tuple[str, str]] = {
    "case.created": ("Application started", "درخواست شروع کی گئی"),
    "case.submitted": ("Application submitted", "درخواست جمع کرائی گئی"),
    "case.withdrawn": ("Application withdrawn", "درخواست واپس لی گئی"),
    "case.complaint_filed": ("Complaint filed", "شکایت درج کی گئی"),
    "decision.recorded": ("Automated check completed", "خودکار جانچ مکمل ہوئی"),
    "officer.decision": ("Officer decision recorded", "افسر کا فیصلہ درج ہوا"),
    "payment.initiated": ("Payment sent", "رقم بھیجی گئی"),
    "payment.completed": ("Payment received", "رقم موصول ہوئی"),
    "payment.failed": ("Payment failed", "ادائیگی ناکام"),
    "consent.access_denied": ("Access blocked (consent)", "رسائی روک دی گئی (رضامندی)"),
}

_STATUS_TIMELINE_LABELS: dict[str, tuple[str, str]] = {
    CaseStatus.SUBMITTED.value: ("Submitted for checking", "جانچ کے لیے جمع"),
    CaseStatus.PROCESSING.value: ("Checking your application", "درخواست کی جانچ"),
    CaseStatus.WAITING_EXTERNAL.value: ("Waiting for a government system", "سرکاری نظام کا انتظار"),
    CaseStatus.NEEDS_INFO.value: ("More information needed", "مزید معلومات درکار"),
    CaseStatus.HUMAN_REVIEW.value: ("Sent to an officer", "افسر کو بھیجا گیا"),
    CaseStatus.IN_REVIEW.value: ("Officer is reviewing", "افسر جائزہ لے رہا ہے"),
    CaseStatus.PENDING_SECOND_APPROVAL.value: ("Final approval in progress", "حتمی منظوری جاری"),
    CaseStatus.APPROVED.value: ("Approved", "منظور"),
    CaseStatus.PAYMENT_INITIATED.value: ("Sending payment", "رقم بھیجی جا رہی ہے"),
    CaseStatus.PAID.value: ("Payment completed", "ادائیگی مکمل"),
    CaseStatus.PAYMENT_FAILED.value: ("Payment issue", "ادائیگی میں مسئلہ"),
    CaseStatus.REJECTED.value: ("Not approved", "منظور نہیں ہوئی"),
    CaseStatus.WITHDRAWN.value: ("Withdrawn", "واپس لی گئی"),
    CaseStatus.CLOSED.value: ("Completed", "مکمل"),
    CaseStatus.ON_HOLD_CONSENT.value: ("Paused — consent withdrawn", "رضامندی واپس لی گئی"),
}


# --- helpers ----------------------------------------------------------------


def _now() -> datetime:
    return datetime.now(UTC)


def _next_reference_code(db: Session) -> str:
    """Draw a reference code that no case is using yet.

    The demo seeder inserts historical cases with explicit codes
    (``HQ-YYYY-000101`` …) and a database migrated before the sequence start was
    fixed still begins at 1, so a freshly drawn number can land inside the seeded
    range. Keep drawing until the code is free; ``uq_cases_reference_code`` is the
    backstop.
    """
    year = _now().year
    for _ in range(1000):
        number = int(db.execute(select(CASE_REF_SEQ.next_value())).scalar_one())
        code = f"HQ-{year}-{number:06d}"
        taken = db.execute(
            select(Case.id).where(Case.reference_code == code).limit(1)
        ).scalar_one_or_none()
        if taken is None:
            return code
    raise ValidationError(
        message_en="Could not allocate a case reference. Please try again.",
        message_ur="درخواست کا حوالہ نمبر مختص نہیں ہو سکا۔ براہ کرم دوبارہ کوشش کریں۔",
    )


def _load_case(db: Session, case_id: uuid.UUID) -> Case:
    case = db.get(Case, case_id)
    if case is None:
        raise NotFoundError()
    return case


def _authorise_case_read(
    db: Session, case: Case, actor: ActorContext, *, act_for: uuid.UUID | None
) -> None:
    role = actor.role_value
    if role in {UserRole.CITIZEN.value, UserRole.HELPER.value}:
        citizen_id = resolve_citizen_scope(db, actor, act_for)
        if case.citizen_id != citizen_id:
            raise NotFoundError()
        enforce_consent(
            db,
            citizen_id=case.citizen_id,
            actor=actor,
            category=DataCategory.CASE_HISTORY,
            purpose=ConsentPurpose.HELPER_ASSISTANCE
            if role == UserRole.HELPER.value
            else ConsentPurpose.BENEFIT_APPLICATION,
            resource_ref=f"case:{case.id}",
        )
        return

    assert_tenant_scope(
        db, actor, case.tenant_id, resource_type="case", resource_id=case.id
    )
    enforce_consent(
        db,
        citizen_id=case.citizen_id,
        actor=actor,
        category=DataCategory.CASE_HISTORY,
        purpose=ConsentPurpose.BENEFIT_APPLICATION,
        resource_ref=f"case:{case.id}",
    )


def _authorise_case_write(
    db: Session, case: Case, actor: ActorContext, *, act_for: uuid.UUID | None
) -> None:
    citizen_id = resolve_citizen_scope(db, actor, act_for)
    if case.citizen_id != citizen_id:
        raise NotFoundError()
    enforce_consent(
        db,
        citizen_id=case.citizen_id,
        actor=actor,
        category=DataCategory.CASE_HISTORY,
        purpose=ConsentPurpose.HELPER_ASSISTANCE
        if actor.role_value == UserRole.HELPER.value
        else ConsentPurpose.BENEFIT_APPLICATION,
        resource_ref=f"case:{case.id}",
    )


def _timeline(db: Session, case: Case, *, include_internal: bool) -> list[dict[str, Any]]:
    from app.models.audit import AuditEvent

    events = (
        db.execute(
            select(AuditEvent)
            .where(
                AuditEvent.resource_type == "case",
                AuditEvent.resource_id == str(case.id),
            )
            .order_by(AuditEvent.seq.asc())
        )
        .scalars()
        .all()
    )

    entries: list[dict[str, Any]] = []
    for event in events:
        payload = event.payload_json or {}
        label = _TIMELINE_LABELS.get(event.action)
        if event.action == "case.status_changed":
            label = _STATUS_TIMELINE_LABELS.get(str(payload.get("to")))
        if label is None:
            if not include_internal:
                continue
            label = (event.action.replace(".", " ").title(), event.action)
        entries.append(
            {
                "at": event.created_at.isoformat() if event.created_at else None,
                "action": event.action,
                "label_en": label[0],
                "label_ur": label[1],
            }
        )

    if not entries:
        entries.append(
            {
                "at": case.created_at.isoformat() if case.created_at else None,
                "action": "case.created",
                "label_en": "Application started",
                "label_ur": "درخواست شروع کی گئی",
            }
        )
    return entries


def _case_documents(db: Session, case_id: uuid.UUID) -> list[Document]:
    return list(
        db.execute(
            select(Document)
            .where(Document.case_id == case_id)
            .order_by(Document.created_at.asc(), Document.id.asc())
        )
        .scalars()
        .all()
    )


def _case_payment(db: Session, case_id: uuid.UUID) -> Payment | None:
    return db.execute(
        select(Payment).where(Payment.case_id == case_id).limit(1)
    ).scalar_one_or_none()


def _case_notes(db: Session, case_id: uuid.UUID, *, include_internal: bool) -> list[CaseNote]:
    query = select(CaseNote).where(CaseNote.case_id == case_id)
    if not include_internal:
        query = query.where(CaseNote.is_visible_to_citizen.is_(True))
    return list(db.execute(query.order_by(CaseNote.created_at.asc())).scalars().all())


def _program_for(db: Session, program_id: uuid.UUID) -> Program:
    program = db.get(Program, program_id)
    if program is None or not program.is_active:
        raise NotFoundError()
    return program


def _wizard_steps(program: Program) -> list[dict[str, Any]]:
    """The program's wizard steps.

    ``wizard_schema`` is a JSONB list of step objects (docs/04 §4.3); older rows
    may carry a dict with a ``required_facts`` key instead, so both are accepted.
    """
    schema = program.wizard_schema
    if isinstance(schema, list):
        return [step for step in schema if isinstance(step, dict)]
    return []


def _first_wizard_step(program: Program) -> str:
    for step in _wizard_steps(program):
        name = step.get("step")
        if name:
            return str(name)[:40]
    return "identity"


def _required_facts(program: Program) -> list[str]:
    schema = program.wizard_schema
    if isinstance(schema, dict):
        declared = schema.get("required_facts")
        if isinstance(declared, list) and declared:
            return [str(key) for key in declared if str(key) in CANONICAL_FACT_KEY_SET]

    # A step's ``fact_key`` is required when the step is required and the citizen
    # may not answer UNKNOWN (``allow_unknown`` steps stay optional, because
    # ``missing_facts`` treats UNKNOWN as unanswered).
    facts: list[str] = []
    for step in _wizard_steps(program):
        key = step.get("fact_key")
        if not key or not step.get("required") or step.get("allow_unknown"):
            continue
        if str(key) in CANONICAL_FACT_KEY_SET and str(key) not in facts:
            facts.append(str(key))
    return facts or list(DEFAULT_REQUIRED_FACTS)


def _required_documents(program: Program) -> list[str]:
    return [str(doc) for doc in (program.required_documents or [])]


def _active_department_grant(
    db: Session, citizen_id: uuid.UUID, tenant_id: uuid.UUID
) -> ConsentGrant | None:
    return db.execute(
        select(ConsentGrant)
        .where(
            ConsentGrant.citizen_id == citizen_id,
            ConsentGrant.recipient_type == ConsentRecipientType.DEPARTMENT.value,
            ConsentGrant.recipient_tenant_id == tenant_id,
            ConsentGrant.status == ConsentStatus.ACTIVE.value,
        )
        .order_by(ConsentGrant.granted_at.desc())
        .limit(1)
    ).scalar_one_or_none()


def _case_payload(
    db: Session, case: Case, actor: ActorContext, *, include_internal: bool
) -> dict[str, Any]:
    return case_to_dict(
        case,
        program=db.get(Program, case.program_id),
        documents=_case_documents(db, case.id),
        payment=_case_payment(db, case.id),
        notes=_case_notes(db, case.id, include_internal=include_internal),
        timeline=_timeline(db, case, include_internal=include_internal),
        include_internal=include_internal,
    )


def _audit_actor(actor: ActorContext) -> dict[str, Any]:
    return {
        "actor_type": actor.actor_type,
        "actor_id": actor.actor_id_str,
        "actor_role": actor.role_value,
    }


# --- endpoints --------------------------------------------------------------


@router.post("", status_code=201, summary="Create a DRAFT case")
def create_case(
    payload: dict[str, Any],
    request: Request,
    response: Response,
    actor: CitizenActor,
    db: DbSession,
) -> dict[str, Any]:
    program_id = payload.get("program_id")
    if not program_id:
        raise ValidationError(details={"fields": [{"field": "program_id", "reason": "REQUIRED"}]})
    try:
        program_uuid = uuid.UUID(str(program_id))
    except ValueError as exc:
        raise ValidationError(
            details={"fields": [{"field": "program_id", "reason": "INVALID_UUID"}]}
        ) from exc

    case_type = str(payload.get("case_type") or CaseType.BENEFIT_APPLICATION.value)
    if case_type not in {item.value for item in CaseType}:
        raise ValidationError(
            details={"fields": [{"field": "case_type", "reason": "INVALID_VALUE"}]}
        )

    act_for = get_act_for_citizen(request)
    citizen_id = resolve_citizen_scope(db, actor, act_for)

    idem_key = get_idempotency_key(request)
    cached = replay(
        db,
        key=idem_key,
        user_id=actor.user_id,
        method="POST",
        path="/api/v1/cases",
        payload=payload,
    )
    if cached is not None:
        response.status_code = cached.status_code
        return cached.body

    program = _program_for(db, program_uuid)

    enforce_consent(
        db,
        citizen_id=citizen_id,
        actor=actor,
        category=DataCategory.CASE_HISTORY,
        purpose=ConsentPurpose.HELPER_ASSISTANCE
        if actor.role_value == UserRole.HELPER.value
        else ConsentPurpose.BENEFIT_APPLICATION,
        resource_ref=f"program:{program.id}",
    )

    case = Case(
        reference_code=_next_reference_code(db),
        tenant_id=program.tenant_id,
        program_id=program.id,
        citizen_id=citizen_id,
        submitted_by_user_id=actor.user_id,
        submitted_via_helper=actor.role_value == UserRole.HELPER.value,
        case_type=case_type,
        status=CaseStatus.DRAFT.value,
        wizard_step=_first_wizard_step(program),
        draft_answers={},
        flags_json=[],
    )
    db.add(case)
    db.flush()

    audit.record(
        db,
        action="case.created",
        resource_type="case",
        resource_id=case.id,
        tenant_id=case.tenant_id,
        payload={
            "case_id": str(case.id),
            "reference_code": case.reference_code,
            "program_id": str(program.id),
            "case_type": case_type,
            "via_helper": case.submitted_via_helper,
        },
        **_audit_actor(actor),
    )

    body = _case_payload(db, case, actor, include_internal=False)
    remember(
        db,
        key=idem_key,
        user_id=actor.user_id,
        method="POST",
        path="/api/v1/cases",
        payload=payload,
        status_code=201,
        body=body,
    )
    db.commit()
    response.status_code = 201
    return body


@router.get("", summary="List the current citizen's cases")
def list_cases(
    request: Request,
    response: Response,
    actor: CitizenActor,
    db: DbSession,
    status: str | None = Query(default=None),
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
) -> dict[str, Any]:
    act_for = get_act_for_citizen(request)
    citizen_id = resolve_citizen_scope(db, actor, act_for)

    enforce_consent(
        db,
        citizen_id=citizen_id,
        actor=actor,
        category=DataCategory.CASE_HISTORY,
        purpose=ConsentPurpose.HELPER_ASSISTANCE
        if actor.role_value == UserRole.HELPER.value
        else ConsentPurpose.BENEFIT_APPLICATION,
        resource_ref=f"citizen:{citizen_id}:cases",
    )

    query = select(Case).where(Case.citizen_id == citizen_id)
    count_query = select(func.count()).select_from(Case).where(Case.citizen_id == citizen_id)
    if status:
        query = query.where(Case.status == status)
        count_query = count_query.where(Case.status == status)

    total = db.execute(count_query).scalar_one()
    rows = (
        db.execute(query.order_by(Case.created_at.desc()).limit(limit).offset(offset))
        .scalars()
        .all()
    )

    items = []
    for case in rows:
        program = db.get(Program, case.program_id)
        items.append(
            {
                "id": str(case.id),
                "reference_code": case.reference_code,
                "case_type": case.case_type,
                "status": case.status,
                "status_label": status_label(case.status),
                "program": {
                    "code": program.code,
                    "name": program.name,
                    "name_ur": program.name_ur,
                }
                if program
                else None,
                "approved_amount_pkr": case.approved_amount_pkr,
                "created_at": case.created_at.isoformat() if case.created_at else None,
                "submitted_at": case.submitted_at.isoformat() if case.submitted_at else None,
            }
        )

    body = {"items": items, "total": total, "limit": limit, "offset": offset}
    etag = weak_etag(body)
    if etag_matches(request, etag):
        return not_modified(etag)
    response.headers["ETag"] = etag
    return body


@router.get("/{case_id}", summary="Full case view, tailored to the caller's role")
def get_case(
    case_id: uuid.UUID,
    request: Request,
    response: Response,
    actor: CaseReader,
    db: DbSession,
) -> dict[str, Any]:
    case = _load_case(db, case_id)
    act_for = get_act_for_citizen(request)
    _authorise_case_read(db, case, actor, act_for=act_for)

    include_internal = actor.role_value in {
        UserRole.OFFICER.value,
        UserRole.AUDITOR.value,
        UserRole.ADMIN.value,
    }
    body = _case_payload(db, case, actor, include_internal=include_internal)

    if include_internal:
        citizen = db.get(Citizen, case.citizen_id)
        body["citizen"] = {
            "id": str(citizen.id) if citizen else None,
            "full_name": citizen.full_name if citizen else None,
            "district": citizen.district if citizen else None,
        }
        latest_decision = db.execute(
            select(Decision)
            .where(Decision.case_id == case.id)
            .order_by(Decision.created_at.desc())
            .limit(1)
        ).scalar_one_or_none()
        if latest_decision is not None:
            body["latest_decision"] = {
                "id": str(latest_decision.id),
                "route_action": latest_decision.route_action,
                "confidence_overall": float(latest_decision.confidence_overall),
                "rule_version_id": str(latest_decision.rule_version_id),
                "rule_content_hash": latest_decision.rule_content_hash,
                "input_snapshot_hash": latest_decision.input_snapshot_hash,
                "created_at": latest_decision.created_at.isoformat()
                if latest_decision.created_at
                else None,
            }
        body.update(decision_evidence(latest_decision))
    db.commit()

    etag = weak_etag(body)
    if etag_matches(request, etag):
        return not_modified(etag)
    response.headers["ETag"] = etag
    return body


@router.patch("/{case_id}/draft", summary="Save wizard step and answers")
def patch_draft(
    case_id: uuid.UUID,
    payload: dict[str, Any],
    request: Request,
    response: Response,
    actor: CitizenActor,
    db: DbSession,
) -> dict[str, Any]:
    case = _load_case(db, case_id)
    act_for = get_act_for_citizen(request)
    _authorise_case_write(db, case, actor, act_for=act_for)

    if case.status not in EDITABLE_STATUSES:
        raise ValidationError(
            message_en="This application can no longer be edited.",
            message_ur="اس درخواست میں اب تبدیلی نہیں ہو سکتی۔",
            details={"status": case.status},
        )

    idem_key = get_idempotency_key(request)
    path = f"/api/v1/cases/{case_id}/draft"
    cached = replay(
        db, key=idem_key, user_id=actor.user_id, method="PATCH", path=path, payload=payload
    )
    if cached is not None:
        response.status_code = cached.status_code
        return cached.body

    answers = payload.get("answers") or {}
    if not isinstance(answers, dict):
        raise ValidationError(
            details={"fields": [{"field": "answers", "reason": "MUST_BE_OBJECT"}]}
        )

    unknown_keys = sorted(set(answers) - CANONICAL_FACT_KEY_SET)
    if unknown_keys:
        raise ValidationError(
            message_en="Unknown fact keys in answers.",
            message_ur="جوابات میں نامعلوم فیلڈز ہیں۔",
            details={"fields": [{"field": key, "reason": "UNKNOWN_FACT_KEY"} for key in unknown_keys]},
        )

    not_self_declarable = sorted(set(answers) - SELF_DECLARABLE_FACT_KEYS)
    if not_self_declarable:
        raise ValidationError(
            message_en="These facts are derived by the system, not entered by citizens.",
            message_ur="یہ معلومات نظام خود حاصل کرتا ہے۔",
            details={
                "fields": [
                    {"field": key, "reason": "NOT_SELF_DECLARABLE"} for key in not_self_declarable
                ]
            },
        )

    entered_by = "HELPER" if actor.role_value == UserRole.HELPER.value else "CITIZEN"
    merged = dict(case.draft_answers or {})
    for key, raw in answers.items():
        merged[key] = normalize_fact(raw, entered_by=entered_by)
    case.draft_answers = merged

    wizard_step = payload.get("wizard_step")
    if wizard_step is not None:
        case.wizard_step = str(wizard_step)[:40]

    audit.record(
        db,
        action="case.draft_saved",
        resource_type="case",
        resource_id=case.id,
        tenant_id=case.tenant_id,
        payload={
            "case_id": str(case.id),
            "wizard_step": case.wizard_step,
            "fact_keys": sorted(answers),
        },
        **_audit_actor(actor),
    )

    body = _case_payload(db, case, actor, include_internal=False)
    remember(
        db,
        key=idem_key,
        user_id=actor.user_id,
        method="PATCH",
        path=path,
        payload=payload,
        status_code=200,
        body=body,
    )
    db.commit()
    return body


@router.post("/{case_id}/submit", summary="Submit a draft for automated processing")
def submit_case(
    case_id: uuid.UUID,
    request: Request,
    response: Response,
    actor: CitizenActor,
    db: DbSession,
) -> dict[str, Any]:
    case = _load_case(db, case_id)
    act_for = get_act_for_citizen(request)
    _authorise_case_write(db, case, actor, act_for=act_for)

    idem_key = get_idempotency_key(request)
    path = f"/api/v1/cases/{case_id}/submit"
    cached = replay(
        db, key=idem_key, user_id=actor.user_id, method="POST", path=path, payload={}
    )
    if cached is not None:
        response.status_code = cached.status_code
        return cached.body

    assert_transition(case.status, CaseStatus.SUBMITTED, actor_role=actor.role_value)

    program = _program_for(db, case.program_id)
    answers = case.draft_answers or {}

    missing = missing_facts(answers, _required_facts(program))
    if missing:
        raise ValidationError(
            message_en="Some required details are still missing.",
            message_ur="کچھ ضروری معلومات ابھی باقی ہیں۔",
            details={
                "fields": [{"field": key, "reason": "MISSING"} for key in missing],
                "missing_facts": missing,
            },
        )

    required_docs = _required_documents(program)
    latest_documents = {doc.doc_type: doc for doc in _case_documents(db, case.id)}
    missing_docs = [doc for doc in required_docs if doc not in latest_documents]
    if missing_docs:
        raise ValidationError(
            message_en="Some required documents are missing.",
            message_ur="کچھ ضروری دستاویزات موجود نہیں ہیں۔",
            details={"missing_documents": missing_docs},
        )

    unverified = [
        doc_type for doc_type in required_docs
        if latest_documents[doc_type].verify_status == "NEEDS_RETAKE"
    ]
    if unverified:
        raise ValidationError(
            message_en="Some documents need to be photographed again.",
            message_ur="کچھ دستاویزات دوبارہ تصویر کرنی ہیں۔",
            details={"retake_documents": unverified},
        )

    previous = case.status
    case.status = CaseStatus.SUBMITTED.value
    case.submitted_at = _now()
    case.wizard_step = "review"
    case.citizen_explanation = None

    audit.record(
        db,
        action="case.submitted",
        resource_type="case",
        resource_id=case.id,
        tenant_id=case.tenant_id,
        payload={
            "case_id": str(case.id),
            "from": previous,
            "to": case.status,
            "fact_keys": sorted(answers),
            "document_types": sorted(latest_documents),
        },
        **_audit_actor(actor),
    )

    enqueue_job(
        db,
        JobType.PROCESS_CASE.value,
        {"case_id": str(case.id), "tenant_id": str(case.tenant_id)},
        dedup_key=f"PROCESS_CASE:{case.id}",
    )

    body = _case_payload(db, case, actor, include_internal=False)
    remember(
        db,
        key=idem_key,
        user_id=actor.user_id,
        method="POST",
        path=path,
        payload={},
        status_code=200,
        body=body,
    )
    db.commit()
    return body


@router.post("/{case_id}/withdraw", summary="Withdraw a draft or open case")
def withdraw_case(
    case_id: uuid.UUID,
    request: Request,
    response: Response,
    actor: CitizenActor,
    db: DbSession,
) -> dict[str, Any]:
    case = _load_case(db, case_id)
    act_for = get_act_for_citizen(request)
    _authorise_case_write(db, case, actor, act_for=act_for)

    idem_key = get_idempotency_key(request)
    path = f"/api/v1/cases/{case_id}/withdraw"
    cached = replay(
        db, key=idem_key, user_id=actor.user_id, method="POST", path=path, payload={}
    )
    if cached is not None:
        response.status_code = cached.status_code
        return cached.body

    assert_transition(
        case.status,
        CaseStatus.WITHDRAWN,
        previous_status=case.previous_status,
        actor_role=actor.role_value,
    )

    previous = case.status
    case.status = CaseStatus.WITHDRAWN.value
    case.previous_status = None

    audit.record(
        db,
        action="case.withdrawn",
        resource_type="case",
        resource_id=case.id,
        tenant_id=case.tenant_id,
        payload={"case_id": str(case.id), "from": previous, "to": case.status},
        **_audit_actor(actor),
    )

    body = _case_payload(db, case, actor, include_internal=False)
    remember(
        db,
        key=idem_key,
        user_id=actor.user_id,
        method="POST",
        path=path,
        payload={},
        status_code=200,
        body=body,
    )
    db.commit()
    return body


def _notify_complaint(
    db: Session, *, complaint: Case, parent: Case, reason: str
) -> None:
    """Tell the citizen it landed, and put it in front of the tenant's officers.

    AC-09.3 stops at "files a mock complaint if FAILED", but a complaint nobody sees
    is not a complaint. The citizen gets an in-app row plus a simulated SMS carrying
    an ``HQ-XXXXX`` code (so the message itself can be verified by the scam checker),
    and every active officer in the tenant gets an in-app row pointing at the case.
    """
    from app.models.identity import User
    from app.notify import create_notification

    create_notification(
        db,
        channel=NotificationChannel.IN_APP,
        title_en="Complaint received",
        title_ur="شکایت موصول ہوئی",
        body_en=(
            f"We received your complaint about application {parent.reference_code}. "
            "We are checking the payment and will update you here."
        ),
        body_ur=(
            f"آپ کی درخواست {parent.reference_code} کے بارے میں شکایت موصول ہو گئی۔ "
            "ہم ادائیگی کی جانچ کر رہے ہیں اور آپ کو یہیں اطلاع دیں گے۔"
        ),
        citizen_id=complaint.citizen_id,
        case_id=complaint.id,
        tenant_id=complaint.tenant_id,
    )

    citizen = db.get(Citizen, complaint.citizen_id)
    if citizen is not None and citizen.phone:
        create_notification(
            db,
            channel=NotificationChannel.SMS_SIMULATED,
            title_en="Haqdaar complaint",
            title_ur="حقدار شکایت",
            body_en=(
                f"Complaint {complaint.reference_code} received for application "
                f"{parent.reference_code}. Reason: {reason}. We will check the payment."
            ),
            body_ur=(
                f"درخواست {parent.reference_code} کے لیے شکایت "
                f"{complaint.reference_code} موصول ہوئی۔ ہم ادائیگی کی جانچ کریں گے۔"
            ),
            phone=citizen.phone,
            citizen_id=complaint.citizen_id,
            case_id=complaint.id,
            tenant_id=complaint.tenant_id,
        )

    officers = (
        db.execute(
            select(User).where(
                User.tenant_id == complaint.tenant_id,
                User.role == UserRole.OFFICER.value,
                User.is_active.is_(True),
            )
        )
        .scalars()
        .all()
    )
    for officer in officers:
        create_notification(
            db,
            channel=NotificationChannel.IN_APP,
            title_en="New payment complaint",
            title_ur="نئی ادائیگی شکایت",
            body_en=(
                f"{complaint.reference_code} — money not received on "
                f"{parent.reference_code} ({reason}). The payment check is queued."
            ),
            body_ur=(
                f"{complaint.reference_code} — {parent.reference_code} کی رقم موصول نہیں ہوئی۔ "
                "ادائیگی کی جانچ قطار میں ہے۔"
            ),
            user_id=officer.id,
            case_id=complaint.id,
            tenant_id=complaint.tenant_id,
            with_verification_code=False,
        )


@router.post("/{case_id}/complaint", status_code=201, summary="File a payment complaint")
def file_complaint(
    case_id: uuid.UUID,
    payload: dict[str, Any],
    request: Request,
    response: Response,
    actor: CitizenActor,
    db: DbSession,
) -> dict[str, Any]:
    parent = _load_case(db, case_id)
    act_for = get_act_for_citizen(request)
    _authorise_case_write(db, parent, actor, act_for=act_for)

    if parent.status not in COMPLAINABLE_STATUSES:
        raise ValidationError(
            message_en="A complaint can only be filed for an approved or paid case.",
            message_ur="شکایت صرف منظور شدہ یا ادا شدہ درخواست پر درج ہو سکتی ہے۔",
            details={"status": parent.status},
        )

    idem_key = get_idempotency_key(request)
    path = f"/api/v1/cases/{case_id}/complaint"
    cached = replay(
        db, key=idem_key, user_id=actor.user_id, method="POST", path=path, payload=payload
    )
    if cached is not None:
        response.status_code = cached.status_code
        return cached.body

    enforce_consent(
        db,
        citizen_id=parent.citizen_id,
        actor=actor,
        category=DataCategory.PAYMENT,
        purpose=ConsentPurpose.COMPLAINT_RESOLUTION,
        resource_ref=f"case:{parent.id}",
    )

    reason = str(payload.get("reason") or "MONEY_NOT_RECEIVED")[:120]
    complaint = Case(
        reference_code=_next_reference_code(db),
        tenant_id=parent.tenant_id,
        program_id=parent.program_id,
        citizen_id=parent.citizen_id,
        submitted_by_user_id=actor.user_id,
        submitted_via_helper=actor.role_value == UserRole.HELPER.value,
        case_type=CaseType.COMPLAINT.value,
        parent_case_id=parent.id,
        status=CaseStatus.SUBMITTED.value,
        submitted_at=_now(),
        wizard_step="review",
        draft_answers={
            "complaint_reason": normalize_fact(reason, entered_by="CITIZEN"),
            "parent_reference_code": normalize_fact(
                parent.reference_code, entered_by="SYSTEM"
            ),
        },
        flags_json=[],
    )
    db.add(complaint)
    db.flush()

    audit.record(
        db,
        action="case.complaint_filed",
        resource_type="case",
        resource_id=complaint.id,
        tenant_id=complaint.tenant_id,
        payload={
            "case_id": str(complaint.id),
            "parent_case_id": str(parent.id),
            "reason": reason,
        },
        **_audit_actor(actor),
    )

    enqueue_job(
        db,
        JobType.CHECK_COMPLAINT.value,
        {
            "case_id": str(complaint.id),
            "parent_case_id": str(parent.id),
            "tenant_id": str(complaint.tenant_id),
        },
        dedup_key=f"CHECK_COMPLAINT:{complaint.id}",
    )

    _notify_complaint(db, complaint=complaint, parent=parent, reason=reason)

    body = _case_payload(db, complaint, actor, include_internal=False)
    remember(
        db,
        key=idem_key,
        user_id=actor.user_id,
        method="POST",
        path=path,
        payload=payload,
        status_code=201,
        body=body,
    )
    db.commit()
    response.status_code = 201
    return body


__all__ = ["router"]
