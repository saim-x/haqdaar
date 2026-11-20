"""Admin user management — docs/05 §3.7."""

from __future__ import annotations

import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models.enums import UserRole
from app.models.identity import Tenant, User
from app.schemas.auth import normalize_phone
from app.security import audit
from app.security.errors import NotFoundError, ValidationError
from app.security.masking import mask_phone
from app.security.passwords import hash_password
from app.security.rbac import ActorContext, require_roles

router = APIRouter(prefix="/admin", tags=["admin-users"])

DbSession = Annotated[Session, Depends(get_db)]
AdminActor = Annotated[ActorContext, Depends(require_roles(UserRole.ADMIN))]

STAFF_ROLES = frozenset(
    {UserRole.HELPER.value, UserRole.OFFICER.value, UserRole.ADMIN.value, UserRole.AUDITOR.value}
)


class UserCreateIn(BaseModel):
    role: str = Field(examples=["OFFICER"])
    full_name: str = Field(min_length=1, max_length=120)
    email: EmailStr | None = None
    phone: str | None = None
    password: str | None = Field(default=None, min_length=8)
    preferred_lang: str = Field(default="ur", pattern="^(ur|en)$")


class UserPatchIn(BaseModel):
    full_name: str | None = Field(default=None, min_length=1, max_length=120)
    role: str | None = None
    is_active: bool | None = None
    preferred_lang: str | None = Field(default=None, pattern="^(ur|en)$")


def _user_json(user: User) -> dict[str, Any]:
    return {
        "id": str(user.id),
        "role": user.role,
        "tenant_id": str(user.tenant_id) if user.tenant_id else None,
        "full_name": user.full_name,
        "email": user.email,
        "phone_masked": mask_phone(user.phone),
        "preferred_lang": user.preferred_lang,
        "is_active": user.is_active,
        "created_at": user.created_at.isoformat() if user.created_at else None,
    }


def _scope_tenant(actor: ActorContext) -> uuid.UUID | None:
    """Platform admins manage every tenant; tenant admins only their own."""
    return None if actor.is_platform_admin else actor.tenant_id


@router.get("/users", summary="List staff/helper accounts")
def list_users(
    actor: AdminActor,
    db: DbSession,
    role: str | None = Query(default=None),
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
) -> dict[str, Any]:
    query = select(User)
    count_query = select(func.count()).select_from(User)

    tenant_id = _scope_tenant(actor)
    if tenant_id is not None:
        query = query.where(User.tenant_id == tenant_id)
        count_query = count_query.where(User.tenant_id == tenant_id)
    if role:
        query = query.where(User.role == role)
        count_query = count_query.where(User.role == role)

    total = db.execute(count_query).scalar_one()
    rows = (
        db.execute(query.order_by(User.created_at.desc()).limit(limit).offset(offset))
        .scalars()
        .all()
    )
    return {"items": [_user_json(row) for row in rows], "total": total, "limit": limit, "offset": offset}


@router.post("/users", status_code=status.HTTP_201_CREATED, summary="Create a staff/helper account")
def create_user(payload: UserCreateIn, actor: AdminActor, db: DbSession) -> dict[str, Any]:
    if payload.role not in STAFF_ROLES:
        raise ValidationError(
            message_en="Only staff and helper accounts can be created here.",
            message_ur="یہاں صرف عملے اور مددگار کے اکاؤنٹ بنائے جا سکتے ہیں۔",
            details={"allowed_roles": sorted(STAFF_ROLES)},
        )
    if not payload.email and not payload.phone:
        raise ValidationError(details={"fields": ["email or phone is required"]})

    tenant_id = _scope_tenant(actor)
    if payload.role == UserRole.AUDITOR.value:
        tenant_id = None  # auditors are platform-scoped and read-only

    phone = normalize_phone(payload.phone) if payload.phone else None
    if payload.email and db.execute(select(User.id).where(User.email == str(payload.email))).first():
        raise ValidationError(details={"fields": ["email already exists"]})
    if phone and db.execute(select(User.id).where(User.phone == phone)).first():
        raise ValidationError(details={"fields": ["phone already exists"]})

    user = User(
        tenant_id=tenant_id,
        role=payload.role,
        email=str(payload.email) if payload.email else None,
        phone=phone,
        password_hash=hash_password(payload.password) if payload.password else None,
        full_name=payload.full_name,
        preferred_lang=payload.preferred_lang,
        is_active=True,
    )
    db.add(user)
    db.flush()

    audit.record(
        db,
        action="user.created",
        resource_type="user",
        resource_id=user.id,
        actor_type=actor.actor_type,
        actor_id=actor.actor_id_str,
        actor_role=actor.role_value,
        tenant_id=tenant_id,
        payload={"role": user.role, "email": user.email},
    )
    db.commit()
    return _user_json(user)


@router.patch("/users/{user_id}", summary="Update role, name or activation")
def patch_user(
    user_id: uuid.UUID, payload: UserPatchIn, actor: AdminActor, db: DbSession
) -> dict[str, Any]:
    user = db.get(User, user_id)
    if user is None:
        raise NotFoundError()

    tenant_id = _scope_tenant(actor)
    if tenant_id is not None and user.tenant_id != tenant_id:
        raise NotFoundError()

    changes: dict[str, Any] = {}
    if payload.full_name is not None:
        user.full_name = payload.full_name
        changes["full_name"] = payload.full_name
    if payload.role is not None:
        if payload.role not in STAFF_ROLES:
            raise ValidationError(details={"allowed_roles": sorted(STAFF_ROLES)})
        user.role = payload.role
        changes["role"] = payload.role
    if payload.is_active is not None:
        user.is_active = payload.is_active
        changes["is_active"] = payload.is_active
    if payload.preferred_lang is not None:
        user.preferred_lang = payload.preferred_lang
        changes["preferred_lang"] = payload.preferred_lang

    audit.record(
        db,
        action="user.updated",
        resource_type="user",
        resource_id=user.id,
        actor_type=actor.actor_type,
        actor_id=actor.actor_id_str,
        actor_role=actor.role_value,
        tenant_id=user.tenant_id,
        payload={"changes": changes},
    )
    db.commit()
    return _user_json(user)


@router.get("/tenants", summary="List tenants (platform admin)")
def list_tenants(actor: AdminActor, db: DbSession) -> dict[str, Any]:
    rows = db.execute(select(Tenant).order_by(Tenant.code.asc())).scalars().all()
    return {
        "items": [
            {"id": str(row.id), "code": row.code, "name": row.name, "name_ur": row.name_ur}
            for row in rows
        ],
        "total": len(rows),
    }


__all__ = ["STAFF_ROLES", "router"]
