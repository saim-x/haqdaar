"""Consent grants, withdrawal and access logs — docs/05 §3.4, docs/09 §4."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models.consent import ConsentAccessLog, ConsentEvent, ConsentGrant
from app.models.enums import (
    ConsentPurpose,
    ConsentRecipientType,
    ConsentStatus,
    DataCategory,
    UserRole,
)
from app.models.identity import Citizen, Tenant, User
from app.schemas.serializers import grant_to_dict
from app.security import audit
from app.security.consent import hold_open_cases, open_cases_for_tenant, restore_held_cases
from app.security.errors import (
    ForbiddenError,
    InvalidTransitionError,
    NotFoundError,
    ValidationError,
)
from app.security.otp import verify_challenge
from app.security.rbac import (
    ActorContext,
    get_act_for_citizen,
    require_roles,
    resolve_citizen_scope,
)

router = APIRouter(prefix="/consent", tags=["consent"])

DbSession = Annotated[Session, Depends(get_db)]
CitizenActor = Annotated[ActorContext, Depends(require_roles(UserRole.CITIZEN, UserRole.HELPER))]
CitizenOnly = Annotated[ActorContext, Depends(require_roles(UserRole.CITIZEN))]
LogReader = Annotated[ActorContext, Depends(require_roles(UserRole.CITIZEN, UserRole.AUDITOR))]

ASSURANCE_LEVELS = frozenset({"SELF_OTP", "CITIZEN_OTP", "VERBAL_WITNESSED"})
DEFAULT_GRANT_DAYS = 365


def _now() -> datetime:
    return datetime.now(UTC)


def _audit_actor(actor: ActorContext) -> dict[str, Any]:
    return {
        "actor_type": actor.actor_type,
        "actor_id": actor.actor_id_str,
        "actor_role": actor.role_value,
    }


def _enum_values(enum_cls: Any) -> set[str]:
    return {str(item.value) for item in enum_cls}


def _validate_list(
    raw: Any, *, field: str, allowed: set[str], required: bool = True
) -> list[str]:
    if raw is None:
        if required:
            raise ValidationError(
                details={"fields": [{"field": field, "reason": "REQUIRED"}]}
            )
        return []
    if not isinstance(raw, list) or not raw:
        raise ValidationError(
            details={"fields": [{"field": field, "reason": "MUST_BE_NON_EMPTY_LIST"}]}
        )
    values = [str(item) for item in raw]
    invalid = sorted(set(values) - allowed)
    if invalid:
        raise ValidationError(
            details={"fields": [{"field": field, "reason": f"INVALID_VALUE:{item}"} for item in invalid]}
        )
    return sorted(set(values))


def _load_grant(db: Session, grant_id: uuid.UUID) -> ConsentGrant:
    grant = db.get(ConsentGrant, grant_id)
    if grant is None:
        raise NotFoundError()
    return grant


def _record_event(
    db: Session, grant: ConsentGrant, *, action: str, actor: ActorContext
) -> ConsentEvent:
    event = ConsentEvent(
        grant_id=grant.id,
        citizen_id=grant.citizen_id,
        action=action,
        actor_user_id=actor.user_id,
        snapshot_json=grant_to_dict(grant),
    )
    db.add(event)
    db.flush()
    return event


@router.get("/grants", summary="List consent grants for the current citizen")
def list_grants(
    request: Request,
    actor: CitizenActor,
    db: DbSession,
    status: str | None = Query(default=None),
) -> dict[str, Any]:
    act_for = get_act_for_citizen(request)
    citizen_id = resolve_citizen_scope(db, actor, act_for)

    query = select(ConsentGrant).where(ConsentGrant.citizen_id == citizen_id)
    if status:
        query = query.where(ConsentGrant.status == status)
    grants = (
        db.execute(query.order_by(ConsentGrant.granted_at.desc())).scalars().all()
    )

    items = []
    for grant in grants:
        payload = grant_to_dict(grant)
        if grant.recipient_tenant_id:
            tenant = db.get(Tenant, grant.recipient_tenant_id)
            payload["recipient_tenant"] = (
                {"code": tenant.code, "name": tenant.name, "name_ur": tenant.name_ur}
                if tenant
                else None
            )
        if grant.recipient_user_id:
            recipient = db.get(User, grant.recipient_user_id)
            payload["recipient_user"] = (
                {"id": str(recipient.id), "full_name": recipient.full_name}
                if recipient
                else None
            )
        items.append(payload)

    return {"items": items, "total": len(items)}


@router.post("/grants", status_code=201, summary="Grant consent to a department or helper")
def create_grant(
    payload: dict[str, Any],
    request: Request,
    actor: CitizenActor,
    db: DbSession,
) -> dict[str, Any]:
    act_for = get_act_for_citizen(request)
    citizen_id = resolve_citizen_scope(db, actor, act_for)

    recipient_type = str(payload.get("recipient_type") or "").upper()
    if recipient_type not in _enum_values(ConsentRecipientType):
        raise ValidationError(
            details={"fields": [{"field": "recipient_type", "reason": "INVALID_VALUE"}]}
        )

    categories = _validate_list(
        payload.get("categories"),
        field="categories",
        allowed=_enum_values(DataCategory),
    )
    purposes = _validate_list(
        payload.get("purposes"),
        field="purposes",
        allowed=_enum_values(ConsentPurpose),
    )

    assurance_level = str(payload.get("assurance_level") or "SELF_OTP").upper()
    if assurance_level not in ASSURANCE_LEVELS:
        raise ValidationError(
            details={"fields": [{"field": "assurance_level", "reason": "INVALID_VALUE"}]}
        )

    recipient_tenant_id: uuid.UUID | None = None
    recipient_user_id: uuid.UUID | None = None

    if recipient_type == ConsentRecipientType.DEPARTMENT.value:
        raw_tenant = payload.get("recipient_tenant_id")
        if not raw_tenant:
            raise ValidationError(
                details={"fields": [{"field": "recipient_tenant_id", "reason": "REQUIRED"}]}
            )
        try:
            recipient_tenant_id = uuid.UUID(str(raw_tenant))
        except ValueError as exc:
            raise ValidationError(
                details={"fields": [{"field": "recipient_tenant_id", "reason": "INVALID_UUID"}]}
            ) from exc
        if db.get(Tenant, recipient_tenant_id) is None:
            raise NotFoundError()
    else:
        raw_user = payload.get("recipient_user_id")
        if not raw_user:
            raise ValidationError(
                details={"fields": [{"field": "recipient_user_id", "reason": "REQUIRED"}]}
            )
        try:
            recipient_user_id = uuid.UUID(str(raw_user))
        except ValueError as exc:
            raise ValidationError(
                details={"fields": [{"field": "recipient_user_id", "reason": "INVALID_UUID"}]}
            ) from exc
        recipient = db.get(User, recipient_user_id)
        if recipient is None or recipient.role != UserRole.HELPER.value:
            raise NotFoundError()

    # A helper may only capture consent for a citizen they already serve, and only
    # with proof: an OTP the citizen read out, or a witnessed verbal attestation.
    if actor.role_value == UserRole.HELPER.value:
        if assurance_level == "SELF_OTP":
            raise ForbiddenError(
                message_en="A helper must capture the citizen's OTP or a witnessed verbal consent.",
                message_ur="مددگار کو شہری کا او ٹی پی یا زبانی رضامندی درج کرنی ہوگی۔",
            )
        if recipient_type == ConsentRecipientType.HELPER.value and recipient_user_id != actor.user_id:
            raise ForbiddenError()

    if assurance_level == "CITIZEN_OTP":
        challenge_id = payload.get("otp_challenge_id")
        code = payload.get("otp_code")
        if not challenge_id or not code:
            raise ValidationError(
                details={
                    "fields": [
                        {"field": "otp_challenge_id", "reason": "REQUIRED"},
                        {"field": "otp_code", "reason": "REQUIRED"},
                    ]
                }
            )
        try:
            challenge_uuid = uuid.UUID(str(challenge_id))
        except ValueError as exc:
            raise ValidationError(
                details={"fields": [{"field": "otp_challenge_id", "reason": "INVALID_UUID"}]}
            ) from exc
        verify_challenge(db, challenge_id=challenge_uuid, code=str(code))

    if assurance_level == "VERBAL_WITNESSED" and not payload.get("verbal_audio_id"):
        raise ValidationError(
            details={"fields": [{"field": "verbal_audio_id", "reason": "REQUIRED"}]}
        )

    expires_in_days = int(payload.get("expires_in_days") or DEFAULT_GRANT_DAYS)
    grant = ConsentGrant(
        citizen_id=citizen_id,
        recipient_type=recipient_type,
        recipient_tenant_id=recipient_tenant_id,
        recipient_user_id=recipient_user_id,
        categories=categories,
        purposes=purposes,
        status=ConsentStatus.ACTIVE.value,
        assurance_level=assurance_level,
        verbal_audio_path=payload.get("verbal_audio_id"),
        granted_at=_now(),
        expires_at=_now() + timedelta(days=max(1, min(expires_in_days, 3650))),
    )
    db.add(grant)
    db.flush()

    _record_event(db, grant, action="GRANTED", actor=actor)
    audit.record(
        db,
        action="consent.granted",
        resource_type="consent_grant",
        resource_id=grant.id,
        tenant_id=grant.recipient_tenant_id,
        payload={
            "grant_id": str(grant.id),
            "citizen_id": str(citizen_id),
            "recipient_type": recipient_type,
            "categories": categories,
            "purposes": purposes,
            "assurance_level": assurance_level,
        },
        **_audit_actor(actor),
    )

    restored: list[str] = []
    if recipient_type == ConsentRecipientType.DEPARTMENT.value and recipient_tenant_id is not None:
        restored = [
            str(case.id)
            for case in restore_held_cases(
                db, citizen_id=citizen_id, tenant_id=recipient_tenant_id, actor=actor
            )
        ]

    db.commit()
    body = grant_to_dict(grant)
    body["resumed_case_ids"] = restored
    return body


@router.patch("/grants/{grant_id}", summary="Modify the categories or purposes of a grant")
def update_grant(
    grant_id: uuid.UUID,
    payload: dict[str, Any],
    request: Request,
    actor: CitizenOnly,
    db: DbSession,
) -> dict[str, Any]:
    grant = _load_grant(db, grant_id)
    act_for = get_act_for_citizen(request)
    citizen_id = resolve_citizen_scope(db, actor, act_for)
    if grant.citizen_id != citizen_id:
        raise NotFoundError()

    if grant.status != ConsentStatus.ACTIVE.value:
        raise InvalidTransitionError(
            message_en="Only an active grant can be modified.",
            message_ur="صرف فعال رضامندی میں تبدیلی ہو سکتی ہے۔",
            details={"status": grant.status},
        )

    changed: dict[str, Any] = {}
    if "categories" in payload:
        grant.categories = _validate_list(
            payload.get("categories"),
            field="categories",
            allowed=_enum_values(DataCategory),
        )
        changed["categories"] = grant.categories
    if "purposes" in payload:
        grant.purposes = _validate_list(
            payload.get("purposes"),
            field="purposes",
            allowed=_enum_values(ConsentPurpose),
        )
        changed["purposes"] = grant.purposes
    if "expires_in_days" in payload and payload["expires_in_days"] is not None:
        days = max(1, min(int(payload["expires_in_days"]), 3650))
        grant.expires_at = _now() + timedelta(days=days)
        changed["expires_at"] = grant.expires_at.isoformat()

    if not changed:
        raise ValidationError(
            details={"fields": [{"field": "categories", "reason": "NOTHING_TO_UPDATE"}]}
        )

    db.flush()
    _record_event(db, grant, action="MODIFIED", actor=actor)
    audit.record(
        db,
        action="consent.modified",
        resource_type="consent_grant",
        resource_id=grant.id,
        tenant_id=grant.recipient_tenant_id,
        payload={"grant_id": str(grant.id), "citizen_id": str(citizen_id), "changes": changed},
        **_audit_actor(actor),
    )
    db.commit()
    return grant_to_dict(grant)


@router.post("/grants/{grant_id}/withdraw", summary="Withdraw a grant immediately")
def withdraw_grant(
    grant_id: uuid.UUID,
    payload: dict[str, Any],
    request: Request,
    actor: CitizenOnly,
    db: DbSession,
) -> dict[str, Any]:
    grant = _load_grant(db, grant_id)
    act_for = get_act_for_citizen(request)
    citizen_id = resolve_citizen_scope(db, actor, act_for)
    if grant.citizen_id != citizen_id:
        raise NotFoundError()

    if grant.status == ConsentStatus.WITHDRAWN.value:
        return {**grant_to_dict(grant), "held_case_ids": []}

    confirm_case_hold = bool(payload.get("confirm_case_hold"))

    held: list[str] = []
    if grant.recipient_type == ConsentRecipientType.DEPARTMENT.value and grant.recipient_tenant_id:
        open_cases = open_cases_for_tenant(
            db, citizen_id=citizen_id, tenant_id=grant.recipient_tenant_id
        )
        if open_cases and not confirm_case_hold:
            raise InvalidTransitionError(
                message_en=(
                    "Withdrawing this consent will pause your open applications. "
                    "Confirm to continue."
                ),
                message_ur=(
                    "یہ رضامندی واپس لینے سے آپ کی جاری درخواستیں روک دی جائیں گی۔ "
                    "جاری رکھنے کی تصدیق کریں۔"
                ),
                details={
                    "reason": "CONFIRM_CASE_HOLD_REQUIRED",
                    "open_cases": len(open_cases),
                    "case_ids": [str(case.id) for case in open_cases],
                },
            )
        held = [
            str(case.id)
            for case in hold_open_cases(
                db, citizen_id=citizen_id, tenant_id=grant.recipient_tenant_id, actor=actor
            )
        ]

    grant.status = ConsentStatus.WITHDRAWN.value
    grant.withdrawn_at = _now()
    db.flush()

    _record_event(db, grant, action="WITHDRAWN", actor=actor)
    audit.record(
        db,
        action="consent.withdrawn",
        resource_type="consent_grant",
        resource_id=grant.id,
        tenant_id=grant.recipient_tenant_id,
        payload={
            "grant_id": str(grant.id),
            "citizen_id": str(citizen_id),
            "recipient_type": grant.recipient_type,
            "held_case_ids": held,
        },
        **_audit_actor(actor),
    )
    db.commit()
    return {**grant_to_dict(grant), "held_case_ids": held}


@router.get("/access-logs", summary="Allowed and denied data accesses on this citizen")
def list_access_logs(
    request: Request,
    actor: LogReader,
    db: DbSession,
    citizen_id: uuid.UUID | None = Query(default=None),
    allowed: bool | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> dict[str, Any]:
    if actor.role_value == UserRole.AUDITOR.value:
        scope_citizen = citizen_id
    else:
        act_for = get_act_for_citizen(request)
        scope_citizen = resolve_citizen_scope(db, actor, act_for)

    query = select(ConsentAccessLog)
    count_query = select(func.count()).select_from(ConsentAccessLog)
    if scope_citizen is not None:
        query = query.where(ConsentAccessLog.citizen_id == scope_citizen)
        count_query = count_query.where(ConsentAccessLog.citizen_id == scope_citizen)
    if allowed is not None:
        query = query.where(ConsentAccessLog.allowed.is_(allowed))
        count_query = count_query.where(ConsentAccessLog.allowed.is_(allowed))

    total = db.execute(count_query).scalar_one()
    rows = (
        db.execute(
            query.order_by(ConsentAccessLog.created_at.desc()).limit(limit).offset(offset)
        )
        .scalars()
        .all()
    )

    items = []
    for log in rows:
        citizen = db.get(Citizen, log.citizen_id)
        items.append(
            {
                "id": str(log.id),
                "citizen_id": str(log.citizen_id),
                "citizen_name": citizen.full_name if citizen else None,
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
        )

    return {"items": items, "total": total, "limit": limit, "offset": offset}


__all__ = ["router"]
