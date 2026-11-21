"""Helper mode — assisted onboarding and consent capture (docs/05 §3.5)."""

from __future__ import annotations

import re
import uuid
from datetime import UTC, datetime, timedelta
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import get_db
from app.models.cases import Case
from app.models.consent import ConsentEvent, ConsentGrant
from app.models.enums import (
    CaseStatus,
    ConsentPurpose,
    ConsentRecipientType,
    ConsentStatus,
    DataCategory,
    NotificationChannel,
    OtpPurpose,
    UserRole,
)
from app.models.identity import Citizen, Tenant
from app.notify import create_notification
from app.schemas.serializers import grant_to_dict
from app.security import audit
from app.security.errors import NotFoundError, ValidationError
from app.security.masking import mask_cnic
from app.security.otp import create_challenge, verify_challenge
from app.security.rbac import ActorContext, require_roles

router = APIRouter(prefix="/helper", tags=["helper"])

DbSession = Annotated[Session, Depends(get_db)]
HelperActor = Annotated[ActorContext, Depends(require_roles(UserRole.HELPER))]

#: RULE-1: every CNIC in this system is synthetic and starts with this prefix.
SYNTHETIC_CNIC_PREFIX = "99900"
HELPER_CATEGORIES = [
    DataCategory.IDENTITY.value,
    DataCategory.HOUSEHOLD.value,
    DataCategory.DOCUMENTS.value,
    DataCategory.CASE_HISTORY.value,
]
HELPER_PURPOSES = [ConsentPurpose.HELPER_ASSISTANCE.value]
DEFAULT_GRANT_DAYS = 365
OPEN_CASE_STATUSES = [
    status.value
    for status in CaseStatus
    if status
    not in {
        CaseStatus.PAID,
        CaseStatus.REJECTED,
        CaseStatus.WITHDRAWN,
        CaseStatus.CLOSED,
    }
]

_PHONE_RE = re.compile(r"^\+92\d{10}$")


def _now() -> datetime:
    return datetime.now(UTC)


def _audit_actor(actor: ActorContext) -> dict[str, Any]:
    return {
        "actor_type": actor.actor_type,
        "actor_id": actor.actor_id_str,
        "actor_role": actor.role_value,
    }


def _normalise_phone(raw: Any) -> str:
    digits = re.sub(r"\D", "", str(raw or ""))
    if digits.startswith("92") and len(digits) == 12:
        digits = digits[2:]
    if digits.startswith("0") and len(digits) == 11:
        digits = digits[1:]
    if len(digits) != 10:
        raise ValidationError(
            details={"fields": [{"field": "phone", "reason": "INVALID_PHONE"}]}
        )
    phone = f"+92{digits}"
    if not _PHONE_RE.match(phone):
        raise ValidationError(
            details={"fields": [{"field": "phone", "reason": "INVALID_PHONE"}]}
        )
    return phone


def _validate_cnic(raw: Any) -> str | None:
    if raw in (None, ""):
        return None
    digits = re.sub(r"\D", "", str(raw))
    if len(digits) != 13:
        raise ValidationError(
            details={"fields": [{"field": "cnic_digits", "reason": "MUST_BE_13_DIGITS"}]}
        )
    if not digits.startswith(SYNTHETIC_CNIC_PREFIX):
        raise ValidationError(
            message_en="This prototype only accepts synthetic CNICs (prefix 99900).",
            message_ur="یہ نمونہ صرف مصنوعی شناختی کارڈ قبول کرتا ہے (99900)۔",
            details={"fields": [{"field": "cnic_digits", "reason": "NOT_SYNTHETIC"}]},
        )
    return digits


def _helper_grant(
    db: Session, *, citizen_id: uuid.UUID, helper_user_id: uuid.UUID
) -> ConsentGrant | None:
    return db.execute(
        select(ConsentGrant)
        .where(
            ConsentGrant.citizen_id == citizen_id,
            ConsentGrant.recipient_type == ConsentRecipientType.HELPER.value,
            ConsentGrant.recipient_user_id == helper_user_id,
        )
        .order_by(ConsentGrant.granted_at.desc())
        .limit(1)
    ).scalar_one_or_none()


def _require_family(db: Session, citizen_id: uuid.UUID, helper_user_id: uuid.UUID) -> Citizen:
    """A helper may only touch citizens they serve or just onboarded (else 404)."""
    citizen = db.get(Citizen, citizen_id)
    if citizen is None:
        raise NotFoundError()
    if (
        _helper_grant(db, citizen_id=citizen_id, helper_user_id=helper_user_id) is None
        and citizen.created_by_user_id != helper_user_id
    ):
        raise NotFoundError()
    return citizen


def _active_case_count(db: Session, citizen_id: uuid.UUID) -> int:
    return int(
        db.execute(
            select(func.count())
            .select_from(Case)
            .where(Case.citizen_id == citizen_id, Case.status.in_(OPEN_CASE_STATUSES))
        ).scalar_one()
    )


@router.get("/families", summary="Citizens this helper is authorised to assist")
def list_families(actor: HelperActor, db: DbSession) -> dict[str, Any]:
    grants = (
        db.execute(
            select(ConsentGrant)
            .where(
                ConsentGrant.recipient_type == ConsentRecipientType.HELPER.value,
                ConsentGrant.recipient_user_id == actor.user_id,
            )
            .order_by(ConsentGrant.granted_at.desc())
        )
        .scalars()
        .all()
    )

    seen: set[uuid.UUID] = set()
    items: list[dict[str, Any]] = []
    for grant in grants:
        if grant.citizen_id in seen:
            continue
        seen.add(grant.citizen_id)
        citizen = db.get(Citizen, grant.citizen_id)
        if citizen is None:
            continue
        active = grant.status == ConsentStatus.ACTIVE.value and (
            grant.expires_at is None or grant.expires_at > _now()
        )
        items.append(
            {
                "citizen_id": str(citizen.id),
                "full_name": citizen.full_name,
                "avatar_color": citizen.avatar_color,
                "cnic_masked": mask_cnic(citizen.cnic_digits),
                "district": citizen.district,
                "active_case_count": _active_case_count(db, citizen.id),
                "consent_status": "ACTIVE" if active else "LOCKED",
                "consent_expires_at": grant.expires_at.isoformat()
                if grant.expires_at
                else None,
                "grant_id": str(grant.id),
            }
        )

    return {"items": items, "total": len(items)}


@router.post("/families", status_code=201, summary="Onboard a citizen and start consent capture")
def create_family(
    payload: dict[str, Any],
    actor: HelperActor,
    db: DbSession,
) -> dict[str, Any]:
    full_name = str(payload.get("full_name") or "").strip()
    if not full_name:
        raise ValidationError(
            details={"fields": [{"field": "full_name", "reason": "REQUIRED"}]}
        )

    phone = _normalise_phone(payload.get("phone"))
    cnic_digits = _validate_cnic(payload.get("cnic_digits"))
    district = (str(payload.get("district"))[:64] if payload.get("district") else None)

    existing = db.execute(
        select(Citizen).where(Citizen.phone == phone).limit(1)
    ).scalar_one_or_none()
    if existing is not None:
        raise ValidationError(
            message_en="A profile with this phone number already exists.",
            message_ur="اس فون نمبر سے پروفائل پہلے موجود ہے۔",
            details={"fields": [{"field": "phone", "reason": "ALREADY_EXISTS"}]},
        )

    citizen = Citizen(
        full_name=full_name[:120],
        cnic_digits=cnic_digits,
        phone=phone,
        district=district,
        profile_data={},
        created_by_user_id=actor.user_id,
    )
    db.add(citizen)
    db.flush()

    audit.record(
        db,
        action="citizen.onboarded_by_helper",
        resource_type="citizen",
        resource_id=citizen.id,
        payload={
            "citizen_id": str(citizen.id),
            "helper_user_id": str(actor.user_id),
            "has_cnic": cnic_digits is not None,
        },
        **_audit_actor(actor),
    )

    method = str(payload.get("consent_method") or "OTP").upper()
    challenge_payload: dict[str, Any] | None = None

    if method == "OTP":
        challenge, code = create_challenge(
            db, phone=phone, purpose=OtpPurpose.HELPER_CONSENT
        )
        create_notification(
            db,
            channel=NotificationChannel.SMS_SIMULATED,
            title_en="Haqdaar consent code",
            title_ur="حقدار رضامندی کوڈ",
            body_en=(
                f"Your helper is asking for permission to manage your Haqdaar "
                f"applications. Your code is {code}. It expires in 5 minutes."
            ),
            body_ur=(
                f"آپ کا مددگار آپ کی حقدار درخواستیں سنبھالنے کی اجازت مانگ رہا ہے۔ "
                f"آپ کا کوڈ {code} ہے۔ یہ 5 منٹ میں ختم ہو جائے گا۔"
            ),
            phone=phone,
            citizen_id=citizen.id,
            user_id=actor.user_id,
        )
        challenge_payload = {
            "challenge_id": str(challenge.id),
            "expires_in_sec": get_settings().otp_ttl_seconds,
        }
    elif method == "VERBAL_WITNESSED":
        if not payload.get("verbal_audio_id"):
            raise ValidationError(
                details={"fields": [{"field": "verbal_audio_id", "reason": "REQUIRED"}]}
            )
        _create_helper_grant(
            db,
            citizen=citizen,
            actor=actor,
            assurance_level="VERBAL_WITNESSED",
            verbal_audio_path=str(payload.get("verbal_audio_id"))[:255],
        )
    else:
        raise ValidationError(
            details={"fields": [{"field": "consent_method", "reason": "INVALID_VALUE"}]}
        )

    db.commit()
    return {
        "citizen": {
            "id": str(citizen.id),
            "full_name": citizen.full_name,
            "phone_masked": phone[:4] + "****" + phone[-2:],
            "cnic_masked": mask_cnic(citizen.cnic_digits),
            "district": citizen.district,
            "avatar_color": citizen.avatar_color,
        },
        "consent_method": method,
        "consent_challenge": challenge_payload,
        "next_step_en": (
            "Ask the citizen to read the code from their phone, then verify it."
            if method == "OTP"
            else "Consent recorded with a witnessed verbal attestation."
        ),
        "next_step_ur": (
            "شہری سے کوڈ پڑھنے کو کہیں، پھر تصدیق کریں۔"
            if method == "OTP"
            else "زبانی رضامندی ریکارڈ کر لی گئی ہے۔"
        ),
    }


def _create_helper_grant(
    db: Session,
    *,
    citizen: Citizen,
    actor: ActorContext,
    assurance_level: str,
    verbal_audio_path: str | None = None,
) -> ConsentGrant:
    grant = ConsentGrant(
        citizen_id=citizen.id,
        recipient_type=ConsentRecipientType.HELPER.value,
        recipient_user_id=actor.user_id,
        categories=list(HELPER_CATEGORIES),
        purposes=list(HELPER_PURPOSES),
        status=ConsentStatus.ACTIVE.value,
        assurance_level=assurance_level,
        verbal_audio_path=verbal_audio_path,
        granted_at=_now(),
        expires_at=_now() + timedelta(days=DEFAULT_GRANT_DAYS),
    )
    db.add(grant)
    db.flush()

    db.add(
        ConsentEvent(
            grant_id=grant.id,
            citizen_id=citizen.id,
            action="GRANTED",
            actor_user_id=actor.user_id,
            snapshot_json=grant_to_dict(grant),
        )
    )
    db.flush()

    audit.record(
        db,
        action="consent.granted",
        resource_type="consent_grant",
        resource_id=grant.id,
        payload={
            "grant_id": str(grant.id),
            "citizen_id": str(citizen.id),
            "recipient_type": ConsentRecipientType.HELPER.value,
            "assurance_level": assurance_level,
            "captured_by_helper": True,
        },
        **_audit_actor(actor),
    )
    return grant


@router.post(
    "/families/{citizen_id}/consent-otp",
    summary="Send a simulated consent OTP to the citizen's phone",
)
def send_consent_otp(
    citizen_id: uuid.UUID,
    actor: HelperActor,
    db: DbSession,
) -> dict[str, Any]:
    citizen = _require_family(db, citizen_id, actor.user_id)
    if not citizen.phone:
        raise ValidationError(
            details={"fields": [{"field": "phone", "reason": "MISSING"}]}
        )

    challenge, code = create_challenge(
        db, phone=citizen.phone, purpose=OtpPurpose.HELPER_CONSENT
    )
    create_notification(
        db,
        channel=NotificationChannel.SMS_SIMULATED,
        title_en="Haqdaar consent code",
        title_ur="حقدار رضامندی کوڈ",
        body_en=(
            f"Your helper is asking for permission to manage your Haqdaar "
            f"applications. Your code is {code}. It expires in 5 minutes."
        ),
        body_ur=(
            f"آپ کا مددگار آپ کی حقدار درخواستیں سنبھالنے کی اجازت مانگ رہا ہے۔ "
            f"آپ کا کوڈ {code} ہے۔ یہ 5 منٹ میں ختم ہو جائے گا۔"
        ),
        phone=citizen.phone,
        citizen_id=citizen.id,
        user_id=actor.user_id,
    )

    audit.record(
        db,
        action="consent.otp_sent",
        resource_type="citizen",
        resource_id=citizen.id,
        payload={"citizen_id": str(citizen.id), "challenge_id": str(challenge.id)},
        **_audit_actor(actor),
    )
    db.commit()
    return {
        "challenge_id": str(challenge.id),
        "expires_in_sec": get_settings().otp_ttl_seconds,
        "simulated_sms_hint": "Check Device Simulator inbox",
    }


@router.post(
    "/families/{citizen_id}/consent-verify",
    summary="Verify the consent OTP and activate the helper grant",
)
def verify_consent(
    citizen_id: uuid.UUID,
    payload: dict[str, Any],
    actor: HelperActor,
    db: DbSession,
) -> dict[str, Any]:
    citizen = _require_family(db, citizen_id, actor.user_id)

    assurance_level = str(payload.get("assurance_level") or "CITIZEN_OTP").upper()
    if assurance_level == "VERBAL_WITNESSED":
        if not payload.get("verbal_audio_id"):
            raise ValidationError(
                details={"fields": [{"field": "verbal_audio_id", "reason": "REQUIRED"}]}
            )
        grant = _create_helper_grant(
            db,
            citizen=citizen,
            actor=actor,
            assurance_level="VERBAL_WITNESSED",
            verbal_audio_path=str(payload.get("verbal_audio_id"))[:255],
        )
    else:
        challenge_id = payload.get("challenge_id")
        code = payload.get("code")
        if not challenge_id or not code:
            raise ValidationError(
                details={
                    "fields": [
                        {"field": "challenge_id", "reason": "REQUIRED"},
                        {"field": "code", "reason": "REQUIRED"},
                    ]
                }
            )
        try:
            challenge_uuid = uuid.UUID(str(challenge_id))
        except ValueError as exc:
            raise ValidationError(
                details={"fields": [{"field": "challenge_id", "reason": "INVALID_UUID"}]}
            ) from exc
        verify_challenge(
            db,
            challenge_id=challenge_uuid,
            code=str(code),
            expected_phone=citizen.phone,
            expected_purpose=OtpPurpose.HELPER_CONSENT,
        )
        grant = _create_helper_grant(
            db, citizen=citizen, actor=actor, assurance_level="CITIZEN_OTP"
        )

    db.commit()
    return {
        "grant": grant_to_dict(grant),
        "citizen": {
            "id": str(citizen.id),
            "full_name": citizen.full_name,
            "cnic_masked": mask_cnic(citizen.cnic_digits),
        },
    }


@router.get("/tenants", summary="Active departments a helper can route consent to")
def list_tenants(actor: HelperActor, db: DbSession, limit: int = Query(default=20, ge=1, le=50)):
    rows = (
        db.execute(
            select(Tenant)
            .where(Tenant.is_active.is_(True))
            .order_by(Tenant.code.asc())
            .limit(limit)
        )
        .scalars()
        .all()
    )
    return {
        "items": [
            {"id": str(tenant.id), "code": tenant.code, "name": tenant.name, "name_ur": tenant.name_ur}
            for tenant in rows
        ]
    }


__all__ = ["router"]
