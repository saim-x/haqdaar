"""Citizen self-service: my data, correction requests, notifications — docs/05 §3.4."""

from __future__ import annotations

import logging
import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models.ai import Notification
from app.models.cases import Case, Document
from app.models.consent import ConsentGrant, DataCorrectionRequest
from app.models.enums import (
    ConsentPurpose,
    CorrectionSourceType,
    CorrectionStatus,
    DataCategory,
    UserRole,
)
from app.models.identity import Citizen
from app.notify import notification_to_dict
from app.schemas.facts import CANONICAL_FACT_KEY_SET, SELF_DECLARABLE_FACT_KEYS
from app.schemas.serializers import document_to_dict, grant_to_dict
from app.security import audit
from app.security.consent import enforce_consent
from app.security.errors import NotFoundError, ValidationError
from app.security.masking import mask_cnic
from app.security.rbac import (
    ActorContext,
    get_act_for_citizen,
    require_roles,
    resolve_citizen_scope,
)

router = APIRouter(prefix="/me", tags=["me"])

logger = logging.getLogger(__name__)

DbSession = Annotated[Session, Depends(get_db)]
CitizenActor = Annotated[ActorContext, Depends(require_roles(UserRole.CITIZEN, UserRole.HELPER))]

#: Facts whose authoritative source is a government registry — a citizen cannot
#: overwrite them, only ask an officer to review.
REGISTRY_FACT_KEYS = frozenset(
    {
        "applicant_is_alive",
        "applicant_cnic_valid",
        "marital_status_widow",
        "spouse_death_verified",
        "household_size",
        "poverty_score",
        "has_conflicting_active_grant",
        "cnic_doc_verified",
        "death_cert_doc_verified",
        "citizen_has_active_dept_consent",
    }
)


def _audit_actor(actor: ActorContext) -> dict[str, Any]:
    return {
        "actor_type": actor.actor_type,
        "actor_id": actor.actor_id_str,
        "actor_role": actor.role_value,
    }


#: The household facts `/me/data` reports, each with the source docs/04 §5 names
#: as authoritative. `payout_phone` is self-declared; the other three come from
#: the household survey.
_HOUSEHOLD_FACT_KEYS: dict[str, str] = {
    "children_under_18": "SELF_DECLARED",
    "household_size": "HOUSEHOLD_SURVEY",
    "monthly_income_pkr": "HOUSEHOLD_SURVEY",
    "payout_phone": "SELF_DECLARED",
}


def _fact(value: Any, source: str) -> dict[str, Any]:
    """One provenance-tagged value in the docs/04 §5 tri-state shape.

    `UNKNOWN` is a real answer, not an absence: the citizen is told which field
    we do not hold and why, instead of the row disappearing or a zero standing
    in for a number nobody supplied. `NOT_PROVIDED` is the honest reason here —
    nothing failed, the value was simply never collected.
    """
    if value is None or value == "":
        return {
            "state": "UNKNOWN",
            "value": None,
            "source": None,
            "missing_reason": "NOT_PROVIDED",
        }
    return {"state": "KNOWN", "value": value, "source": source, "missing_reason": None}


def _scope(db: Session, actor: ActorContext, request: Request) -> uuid.UUID:
    act_for = get_act_for_citizen(request)
    return resolve_citizen_scope(db, actor, act_for)


def _consent_purpose(actor: ActorContext) -> ConsentPurpose:
    return (
        ConsentPurpose.HELPER_ASSISTANCE
        if actor.role_value == UserRole.HELPER.value
        else ConsentPurpose.BENEFIT_APPLICATION
    )


@router.get("/data", summary="Everything Haqdaar stores about this citizen, with provenance")
def my_data(request: Request, actor: CitizenActor, db: DbSession) -> dict[str, Any]:
    citizen_id = _scope(db, actor, request)

    enforce_consent(
        db,
        citizen_id=citizen_id,
        actor=actor,
        category=DataCategory.IDENTITY,
        purpose=_consent_purpose(actor),
        resource_ref=f"citizen:{citizen_id}:profile",
    )

    citizen = db.get(Citizen, citizen_id)
    if citizen is None:
        raise NotFoundError()

    profile = citizen.profile_data or {}
    identity = {
        "full_name": _fact(citizen.full_name, "SELF_DECLARED"),
        "cnic_masked": _fact(mask_cnic(citizen.cnic_digits), "IDENTITY_REGISTRY"),
        "phone_masked": _fact(
            (citizen.phone or "")[:4] + "****" + (citizen.phone or "")[-2:]
            if citizen.phone
            else None,
            "SELF_DECLARED",
        ),
        "district": _fact(citizen.district, "SELF_DECLARED"),
        "dob": _fact(citizen.dob.isoformat() if citizen.dob else None, "SELF_DECLARED"),
    }

    # `profile_data` is flat — the canonical fact keys sit directly on it, not
    # under a `household` sub-object. Reading the nested key silently returned
    # `{}` for every citizen, which is the one thing this endpoint must never do:
    # an empty household reads as "we hold nothing", not "we hold nothing *yet*".
    #
    # Every canonical key is emitted, present or not. A key that is absent comes
    # back as `UNKNOWN` with a reason, so the citizen sees "we do not know this"
    # rather than the row quietly disappearing — docs/04 §5, and the same
    # tri-state the decision engine consumes.
    household = {
        key: _fact(profile.get(key), source) for key, source in _HOUSEHOLD_FACT_KEYS.items()
    }

    cases = (
        db.execute(
            select(Case).where(Case.citizen_id == citizen_id).order_by(Case.created_at.desc())
        )
        .scalars()
        .all()
    )
    case_history = [
        {
            "id": str(case.id),
            "reference_code": case.reference_code,
            "status": case.status,
            "case_type": case.case_type,
            "created_at": case.created_at.isoformat() if case.created_at else None,
        }
        for case in cases
    ]

    documents = (
        db.execute(
            select(Document)
            .where(Document.citizen_id == citizen_id)
            .order_by(Document.created_at.desc())
        )
        .scalars()
        .all()
    )

    grants = (
        db.execute(
            select(ConsentGrant)
            .where(ConsentGrant.citizen_id == citizen_id)
            .order_by(ConsentGrant.granted_at.desc())
        )
        .scalars()
        .all()
    )

    corrections = (
        db.execute(
            select(DataCorrectionRequest)
            .where(DataCorrectionRequest.citizen_id == citizen_id)
            .order_by(DataCorrectionRequest.created_at.desc())
        )
        .scalars()
        .all()
    )

    db.commit()
    return {
        "citizen_id": str(citizen_id),
        "identity": identity,
        "household": household,
        "case_history": case_history,
        "documents": [document_to_dict(doc, include_checks=False) for doc in documents],
        "consents": [grant_to_dict(grant) for grant in grants],
        "corrections": [
            {
                "id": str(row.id),
                "field_key": row.field_key,
                "source_type": row.source_type,
                "requested_value": row.requested_value,
                "status": row.status,
                "message_en": (
                    "Applied to your profile."
                    if row.status in {CorrectionStatus.APPLIED.value, CorrectionStatus.APPROVED.value}
                    else "Waiting for officer review."
                    if row.status == CorrectionStatus.PENDING_OFFICER.value
                    else "Reviewed by an officer."
                ),
                "message_ur": (
                    "آپ کے پروفائل پر لاگو ہو گئی۔"
                    if row.status in {CorrectionStatus.APPLIED.value, CorrectionStatus.APPROVED.value}
                    else "افسر کے جائزے کا انتظار ہے۔"
                    if row.status == CorrectionStatus.PENDING_OFFICER.value
                    else "افسر نے جائزہ مکمل کر لیا۔"
                ),
                "created_at": row.created_at.isoformat() if row.created_at else None,
            }
            for row in corrections
        ],
        "provenance_note_en": (
            "Each value shows where it came from. Registry values are verified by a "
            "government system; self-declared values are what you told us."
        ),
        "provenance_note_ur": (
            "ہر معلومات کے ساتھ اس کا ذریعہ درج ہے۔ سرکاری معلومات حکومتی نظام سے تصدیق شدہ ہیں۔"
        ),
    }


#: AC-12.1 — a corrected self-declared fact can change the outcome of a case that is
#: still being worked, so those two statuses are re-evaluated immediately.
_REEVALUATION_TRIGGER_STATUSES = ("NEEDS_INFO", "IN_REVIEW")


def _reevaluate_after_correction(
    db: Session, citizen_id: uuid.UUID, field_key: str
) -> list[dict[str, Any]]:
    """Re-run the pipeline for this citizen's open cases (AC-12.1).

    Called only after the correction itself is committed: the citizen's intent must
    survive even if a simulated registry is down and the re-evaluation parks the case
    in ``WAITING_EXTERNAL``. A case that cannot be re-evaluated is reported, never
    raised — a correction must not fail because a downstream service is unhappy.
    """
    from app.agent.case_agent import ReevaluationNotAllowed, reevaluate_case

    open_cases = list(
        db.execute(
            select(Case)
            .where(
                Case.citizen_id == citizen_id,
                Case.status.in_(_REEVALUATION_TRIGGER_STATUSES),
            )
            .order_by(Case.created_at.desc())
        ).scalars()
    )

    results: list[dict[str, Any]] = []
    for case in open_cases:
        try:
            outcome = reevaluate_case(
                db,
                case.id,
                officer_user_id=None,
                reason=f"citizen correction: {field_key}",
            )
        except ReevaluationNotAllowed as exc:
            db.rollback()
            results.append(
                {
                    "case_id": str(case.id),
                    "reference_code": case.reference_code,
                    "reevaluated": False,
                    "reason": str(exc),
                }
            )
        except Exception as exc:  # noqa: BLE001 - a correction must never 500 here
            db.rollback()
            logger.warning(
                "re-evaluation after correction failed for case %s: %s",
                case.reference_code,
                type(exc).__name__,
            )
            results.append(
                {
                    "case_id": str(case.id),
                    "reference_code": case.reference_code,
                    "reevaluated": False,
                    "reason": "REEVALUATION_FAILED",
                }
            )
        else:
            results.append(
                {
                    "case_id": str(case.id),
                    "reference_code": case.reference_code,
                    "reevaluated": True,
                    "status": outcome.get("status") if isinstance(outcome, dict) else None,
                }
            )
    return results


_FIELD_KEY_ALIASES: dict[str, str] = {
    "full_name": "applicant_full_name",
    "cnic_masked": "applicant_cnic",
    "cnic": "applicant_cnic",
    "phone_masked": "payout_phone",
    "phone": "payout_phone",
    "district": "applicant_district",
    "dob": "applicant_dob",
}


@router.post("/corrections", status_code=201, summary="Request a correction to stored data")
def request_correction(
    payload: dict[str, Any],
    request: Request,
    actor: CitizenActor,
    db: DbSession,
) -> dict[str, Any]:
    citizen_id = _scope(db, actor, request)

    raw_field_key = str(payload.get("field_key") or "").strip()
    field_key = _FIELD_KEY_ALIASES.get(raw_field_key, raw_field_key)
    if field_key not in CANONICAL_FACT_KEY_SET:
        raise ValidationError(
            details={"fields": [{"field": "field_key", "reason": "UNKNOWN_FACT_KEY"}]}
        )

    requested_value = payload.get("requested_value")
    if requested_value is None or requested_value == "":
        raise ValidationError(
            details={"fields": [{"field": "requested_value", "reason": "REQUIRED"}]}
        )

    enforce_consent(
        db,
        citizen_id=citizen_id,
        actor=actor,
        category=DataCategory.IDENTITY,
        purpose=_consent_purpose(actor),
        resource_ref=f"citizen:{citizen_id}:correction",
    )

    source_type = (
        CorrectionSourceType.REGISTRY.value
        if field_key in REGISTRY_FACT_KEYS
        else CorrectionSourceType.SELF_DECLARED.value
    )
    status = (
        CorrectionStatus.PENDING_OFFICER.value
        if source_type == CorrectionSourceType.REGISTRY.value
        else CorrectionStatus.APPLIED.value
    )

    citizen = db.get(Citizen, citizen_id)
    if citizen is None:
        raise NotFoundError()

    old_value: dict[str, Any] | None = None
    if field_key == "applicant_full_name":
        old_value = {"value": citizen.full_name}
    elif field_key == "applicant_district":
        old_value = {"value": citizen.district}
    elif field_key == "payout_phone":
        old_value = {"value": (citizen.profile_data or {}).get("payout_phone")}

    correction = DataCorrectionRequest(
        citizen_id=citizen_id,
        tenant_id=None,
        field_key=field_key,
        source_type=source_type,
        old_value=old_value,
        requested_value={"value": requested_value},
        reason=(str(payload.get("reason"))[:500] if payload.get("reason") else None),
        status=status,
    )
    db.add(correction)
    db.flush()

    applied = False
    if status == CorrectionStatus.APPLIED.value and field_key in SELF_DECLARABLE_FACT_KEYS:
        if field_key == "applicant_full_name":
            citizen.full_name = str(requested_value)[:120]
            applied = True
        elif field_key == "applicant_district":
            citizen.district = str(requested_value)[:64]
            applied = True
        elif field_key == "payout_phone":
            profile = dict(citizen.profile_data or {})
            profile["payout_phone"] = str(requested_value)[:20]
            citizen.profile_data = profile
            applied = True
        else:
            profile = dict(citizen.profile_data or {})
            declared = dict(profile.get("self_declared") or {})
            declared[field_key] = {
                "state": "KNOWN",
                "value": requested_value,
                "source": "SELF_DECLARED",
                "source_confidence": 1.0,
                "entered_by": "CITIZEN",
                "alternatives": [],
                "conflict": False,
                "missing_reason": None,
            }
            profile["self_declared"] = declared
            # Mirror onto top-level profile_data so GET /me/data immediately reflects the update.
            profile[field_key] = requested_value
            citizen.profile_data = profile
            applied = True

    audit.record(
        db,
        action="correction.requested",
        resource_type="data_correction_request",
        resource_id=correction.id,
        payload={
            "correction_id": str(correction.id),
            "citizen_id": str(citizen_id),
            "field_key": field_key,
            "source_type": source_type,
            "status": status,
            "applied": applied,
        },
        **_audit_actor(actor),
    )
    db.commit()

    # AC-12.1: a corrected self-declared fact can flip a case that is still open.
    # Registry-sourced corrections change nothing yet — an officer has to accept them
    # first — so only an applied correction re-evaluates.
    reevaluated = (
        _reevaluate_after_correction(db, citizen_id, field_key) if applied else []
    )

    return {
        "id": str(correction.id),
        "field_key": correction.field_key,
        "source_type": correction.source_type,
        "requested_value": correction.requested_value,
        "status": correction.status,
        "applied": applied,
        "reevaluated_cases": reevaluated,
        "message_en": (
            "Your correction was applied immediately."
            if applied
            else "Your correction was sent to an officer for review."
        ),
        "message_ur": (
            "آپ کی درستی فوراً لاگو کر دی گئی ہے۔"
            if applied
            else "آپ کی درستی افسر کے جائزے کے لیے بھیج دی گئی ہے۔"
        ),
        "created_at": correction.created_at.isoformat() if correction.created_at else None,
    }


@router.get("/notifications", summary="In-app notifications with verification codes")
def my_notifications(
    request: Request,
    actor: CitizenActor,
    db: DbSession,
    unread_only: bool = Query(default=False),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> dict[str, Any]:
    citizen_id = _scope(db, actor, request)

    enforce_consent(
        db,
        citizen_id=citizen_id,
        actor=actor,
        category=DataCategory.CASE_HISTORY,
        purpose=_consent_purpose(actor),
        resource_ref=f"citizen:{citizen_id}:notifications",
    )

    query = select(Notification).where(
        Notification.citizen_id == citizen_id,
        Notification.channel == "IN_APP",
    )
    count_query = select(func.count()).select_from(Notification).where(
        Notification.citizen_id == citizen_id,
        Notification.channel == "IN_APP",
    )
    if unread_only:
        query = query.where(Notification.read_at.is_(None))
        count_query = count_query.where(Notification.read_at.is_(None))

    total = db.execute(count_query).scalar_one()
    rows = (
        db.execute(
            query.order_by(Notification.created_at.desc()).limit(limit).offset(offset)
        )
        .scalars()
        .all()
    )
    db.commit()
    return {
        "items": [notification_to_dict(row) for row in rows],
        "total": total,
        "limit": limit,
        "offset": offset,
    }


__all__ = ["router"]
