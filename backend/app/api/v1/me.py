"""Citizen self-service: my data, correction requests, notifications — docs/05 §3.4."""

from __future__ import annotations

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
        "full_name": {"value": citizen.full_name, "source": "SELF_DECLARED"},
        "cnic_masked": {"value": mask_cnic(citizen.cnic_digits), "source": "IDENTITY_REGISTRY"},
        "phone_masked": {
            "value": (citizen.phone or "")[:4] + "****" + (citizen.phone or "")[-2:]
            if citizen.phone
            else None,
            "source": "SELF_DECLARED",
        },
        "district": {"value": citizen.district, "source": "SELF_DECLARED"},
        "dob": {"value": citizen.dob.isoformat() if citizen.dob else None, "source": "SELF_DECLARED"},
    }

    household = {
        key: {"value": value, "source": "HOUSEHOLD_SURVEY"}
        for key, value in (profile.get("household") or {}).items()
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


@router.post("/corrections", status_code=201, summary="Request a correction to stored data")
def request_correction(
    payload: dict[str, Any],
    request: Request,
    actor: CitizenActor,
    db: DbSession,
) -> dict[str, Any]:
    citizen_id = _scope(db, actor, request)

    field_key = str(payload.get("field_key") or "").strip()
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

    return {
        "id": str(correction.id),
        "field_key": correction.field_key,
        "source_type": correction.source_type,
        "requested_value": correction.requested_value,
        "status": correction.status,
        "applied": applied,
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
