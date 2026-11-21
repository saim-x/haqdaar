"""Authentication endpoints - docs/05 §3.1.

OTP delivery goes through the simulated SMS inbox: the 6-digit code is written into
the notification body (the Device Simulator reads those rows) while the
``verification_code`` column always holds a generated ``HQ-XXXXX`` code, never the
OTP itself.
"""

from __future__ import annotations

import logging
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.db import get_db
from app.models.enums import ActorType, OtpPurpose, UserRole
from app.models.identity import Citizen, Tenant, User
from app.notify import create_notification
from app.schemas.auth import (
    CitizenOut,
    DemoLoginIn,
    LoginIn,
    LogoutIn,
    MeOut,
    OtpRequestIn,
    OtpRequestOut,
    OtpVerifyIn,
    RefreshIn,
    RefreshOut,
    TenantOut,
    TokenOut,
    UserOut,
)
from app.schemas.common import OkResponse
from app.security import audit
from app.security.context import log_event
from app.security.errors import NotFoundError, UnauthorizedError
from app.security.jwt import (
    create_access_token,
    issue_refresh_token,
    revoke_refresh_token,
    rotate_refresh_token,
)
from app.security.masking import mask_cnic, mask_phone
from app.security.otp import create_challenge, verify_challenge
from app.security.passwords import verify_password
from app.security.ratelimit import check_login_limit, check_otp_request_limits
from app.security.rbac import ActorContext, get_current_actor

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["auth"])

DbSession = Annotated[Session, Depends(get_db)]
CurrentActor = Annotated[ActorContext, Depends(get_current_actor)]

#: Demo personas (docs/10 §2). Email/phone first, role+tenant as a fallback so a
#: re-seeded database with different addresses still logs every persona in.
DEMO_PERSONAS: dict[str, dict[str, Any]] = {
    "widow_fatima": {"phone": "+923001000001", "role": "CITIZEN"},
    "shopkeeper_rasool": {"phone": "+923001000002", "role": "CITIZEN"},
    "helper_ayesha": {"email": "ayesha@helper.mock", "role": "HELPER"},
    "officer_sana": {"email": "sana@spd.mock", "role": "OFFICER", "tenant_code": "SPD"},
    "officer_imran": {"email": "imran@spd.mock", "role": "OFFICER", "tenant_code": "SPD"},
    "admin_bilal": {"email": "bilal@spd.mock", "role": "ADMIN", "tenant_code": "SPD"},
    "admin_platform": {"email": "platform@haqdaar.mock", "role": "ADMIN", "platform": True},
    "auditor_nadia": {"email": "nadia@audit.mock", "role": "AUDITOR", "platform": True},
    "officer_zakat": {"email": "tariq@zwb.mock", "role": "OFFICER", "tenant_code": "ZWB"},
}


# --- helpers ----------------------------------------------------------------


def _user_out(user: User) -> UserOut:
    return UserOut(
        id=user.id,
        role=user.role,
        tenant_id=user.tenant_id,
        full_name=user.full_name,
        email=user.email,
        phone=mask_phone(user.phone),
        preferred_lang=user.preferred_lang,
        is_active=user.is_active,
    )


def _citizen_out(citizen: Citizen | None) -> CitizenOut | None:
    if citizen is None:
        return None
    return CitizenOut(
        id=citizen.id,
        full_name=citizen.full_name,
        cnic_masked=mask_cnic(citizen.cnic_digits),
        phone_masked=mask_phone(citizen.phone),
        district=citizen.district,
        avatar_color=citizen.avatar_color,
    )


def _citizen_for_user(db: Session, user: User) -> Citizen | None:
    return db.execute(select(Citizen).where(Citizen.user_id == user.id)).scalar_one_or_none()


def _issue_tokens(db: Session, user: User, citizen: Citizen | None) -> TokenOut:
    access = create_access_token(
        user_id=user.id,
        role=user.role,
        tenant_id=user.tenant_id,
        citizen_id=citizen.id if citizen else None,
    )
    refresh = issue_refresh_token(db, user)
    return TokenOut(
        access_token=access,
        refresh_token=refresh,
        expires_in=settings.access_token_ttl_minutes * 60,
        user=_user_out(user),
        citizen_id=citizen.id if citizen else None,
    )


def _audit_login(
    db: Session,
    *,
    action: str,
    user: User,
    request: Request,
    extra: dict[str, Any] | None = None,
) -> None:
    audit.record(
        db,
        action=action,
        resource_type="user",
        resource_id=user.id,
        actor_type=ActorType.USER,
        actor_id=user.id,
        actor_role=user.role,
        tenant_id=user.tenant_id,
        payload={"role": user.role, "ip": request.client.host if request.client else None, **(extra or {})},
    )


def _client_ip(request: Request) -> str | None:
    return request.client.host if request.client else None


# --- OTP flow ---------------------------------------------------------------


@router.post(
    "/otp/request",
    response_model=OtpRequestOut,
    status_code=status.HTTP_201_CREATED,
    summary="Send a 6-digit OTP to the simulated SMS inbox",
)
def request_otp(
    payload: OtpRequestIn, request: Request, db: DbSession
) -> OtpRequestOut:
    check_otp_request_limits(payload.phone, _client_ip(request))

    challenge, code = create_challenge(
        db, phone=payload.phone, purpose=OtpPurpose(payload.purpose)
    )

    create_notification(
        db,
        channel="SMS_SIMULATED",
        phone=payload.phone,
        title_en="Your Haqdaar login code",
        title_ur="حقدار لاگ ان کوڈ",
        body_en=f"Your Haqdaar code is {code}. It expires in 5 minutes. Never share it.",
        body_ur=f"آپ کا حقدار کوڈ {code} ہے۔ یہ 5 منٹ میں ختم ہو جائے گا۔ کسی کو نہ بتائیں۔",
    )
    db.commit()

    log_event(
        logger,
        "auth.otp_requested",
        phone=mask_phone(payload.phone),
        purpose=payload.purpose,
    )
    return OtpRequestOut(
        challenge_id=challenge.id,
        expires_in_sec=settings.otp_ttl_seconds,
        simulated_sms_hint="Check the Device Simulator inbox for the code.",
    )


@router.post("/otp/verify", response_model=TokenOut, summary="Verify an OTP and issue tokens")
def verify_otp(payload: OtpVerifyIn, request: Request, db: DbSession) -> TokenOut:
    challenge = verify_challenge(db, challenge_id=payload.challenge_id, code=payload.code)

    user = db.execute(select(User).where(User.phone == challenge.phone)).scalar_one_or_none()
    if user is None:
        user = User(
            role=UserRole.CITIZEN.value,
            phone=challenge.phone,
            full_name="Citizen",
            preferred_lang="ur",
        )
        db.add(user)
        db.flush()

    if not user.is_active:
        raise UnauthorizedError()

    citizen = _citizen_for_user(db, user)
    if citizen is None and UserRole(user.role) is UserRole.CITIZEN:
        citizen = Citizen(
            user_id=user.id,
            full_name=user.full_name,
            phone=challenge.phone,
            profile_data={"onboarded": False},
        )
        db.add(citizen)
        db.flush()

    tokens = _issue_tokens(db, user, citizen)
    _audit_login(db, action="auth.login", user=user, request=request, extra={"method": "OTP"})
    db.commit()
    return tokens


# --- password flow ----------------------------------------------------------


@router.post("/login", response_model=TokenOut, summary="Staff/helper email + password login")
def login(payload: LoginIn, request: Request, db: DbSession) -> TokenOut:
    check_login_limit(_client_ip(request))

    user = db.execute(select(User).where(User.email == str(payload.email))).scalar_one_or_none()
    if user is None or not user.is_active or not verify_password(payload.password, user.password_hash):
        raise UnauthorizedError(
            message_en="Email or password is incorrect.",
            message_ur="ای میل یا پاس ورڈ غلط ہے۔",
        )

    citizen = _citizen_for_user(db, user)
    tokens = _issue_tokens(db, user, citizen)
    _audit_login(db, action="auth.login", user=user, request=request, extra={"method": "PASSWORD"})
    db.commit()
    return tokens


@router.post(
    "/demo-login",
    response_model=TokenOut,
    summary="Issue real JWTs for the seeded demo personas (DEMO_MODE only)",
)
def demo_login(payload: DemoLoginIn, request: Request, db: DbSession) -> TokenOut:
    if not settings.demo_mode:
        # Hidden entirely outside demo mode (docs/09 §1.1).
        raise NotFoundError()

    user = _resolve_persona(db, payload.persona_key)
    if user is None or not user.is_active:
        raise NotFoundError(
            message_en="This demo persona is not seeded in this database.",
            message_ur="یہ ڈیمو پرسونا اس ڈیٹا بیس میں موجود نہیں۔",
            details={"persona_key": payload.persona_key},
        )

    citizen = _citizen_for_user(db, user)
    tokens = _issue_tokens(db, user, citizen)
    _audit_login(
        db,
        action="auth.demo_login",
        user=user,
        request=request,
        extra={"persona_key": payload.persona_key},
    )
    db.commit()
    return tokens


def _resolve_persona(db: Session, persona_key: str) -> User | None:
    spec = DEMO_PERSONAS[persona_key]

    if spec.get("phone"):
        user = db.execute(select(User).where(User.phone == spec["phone"])).scalar_one_or_none()
        if user is not None:
            return user
    if spec.get("email"):
        user = db.execute(select(User).where(User.email == spec["email"])).scalar_one_or_none()
        if user is not None:
            return user

    # Fallback: role + tenant (or platform scope) so a re-seed with different
    # addresses still resolves every persona.
    query = select(User).where(User.role == spec["role"], User.is_active.is_(True))
    if spec.get("platform"):
        query = query.where(User.tenant_id.is_(None))
    elif spec.get("tenant_code"):
        tenant = db.execute(
            select(Tenant).where(Tenant.code == spec["tenant_code"])
        ).scalar_one_or_none()
        if tenant is None:
            return None
        query = query.where(User.tenant_id == tenant.id)
    return db.execute(query.order_by(User.created_at.asc())).scalars().first()


# --- session lifecycle ------------------------------------------------------


@router.post("/refresh", response_model=RefreshOut, summary="Rotate a refresh token")
def refresh(payload: RefreshIn, db: DbSession) -> RefreshOut:
    user, new_refresh = rotate_refresh_token(db, payload.refresh_token)
    citizen = _citizen_for_user(db, user)
    access = create_access_token(
        user_id=user.id,
        role=user.role,
        tenant_id=user.tenant_id,
        citizen_id=citizen.id if citizen else None,
    )
    db.commit()
    return RefreshOut(
        access_token=access,
        refresh_token=new_refresh,
        expires_in=settings.access_token_ttl_minutes * 60,
    )


@router.post("/logout", response_model=OkResponse, summary="Revoke a refresh token")
def logout(payload: LogoutIn, db: DbSession) -> OkResponse:
    revoke_refresh_token(db, payload.refresh_token)
    db.commit()
    return OkResponse()


@router.get("/me", response_model=MeOut, summary="Current user, citizen and tenant")
def me(actor: CurrentActor, db: DbSession) -> MeOut:
    user = db.get(User, actor.user_id) if actor.user_id else None
    if user is None:
        raise UnauthorizedError()

    citizen = _citizen_for_user(db, user)
    tenant = db.get(Tenant, user.tenant_id) if user.tenant_id else None
    return MeOut(
        user=_user_out(user),
        citizen=_citizen_out(citizen),
        tenant=TenantOut.model_validate(tenant) if tenant else None,
    )


__all__ = ["DEMO_PERSONAS", "router"]
