"""Admin API keys - plaintext returned exactly once, revoke is immediate (docs/05 §3.7)."""

from __future__ import annotations

import hashlib
import secrets
import uuid
from datetime import UTC, datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models.enums import UserRole
from app.models.identity import ApiKey
from app.security import audit
from app.security.errors import NotFoundError, ValidationError
from app.security.rbac import ActorContext, require_roles

router = APIRouter(prefix="/admin", tags=["admin-keys"])

DbSession = Annotated[Session, Depends(get_db)]
AdminActor = Annotated[ActorContext, Depends(require_roles(UserRole.ADMIN))]

ALLOWED_SCOPES = frozenset({"cases:read", "scam:check", "rules:read"})


class ApiKeyCreateIn(BaseModel):
    name: str = Field(min_length=1, max_length=80, examples=["Partner portal"])
    scopes: list[str] = Field(default_factory=lambda: ["cases:read"], examples=[["cases:read"]])
    rate_limit_per_min: int = Field(default=60, ge=1, le=6000)


def _key_json(row: ApiKey) -> dict[str, Any]:
    return {
        "id": str(row.id),
        "name": row.name,
        "key_prefix": row.key_prefix,
        "scopes": row.scopes or [],
        "rate_limit_per_min": row.rate_limit_per_min,
        "is_active": row.is_active,
        "last_used_at": row.last_used_at.isoformat() if row.last_used_at else None,
        "created_at": row.created_at.isoformat() if row.created_at else None,
    }


def _require_tenant(actor: ActorContext) -> uuid.UUID:
    if actor.tenant_id is None:
        raise ValidationError(
            message_en="API keys are tenant-scoped; use a tenant admin account.",
            message_ur="API کلیدیں ادارے کے دائرے میں ہوتی ہیں۔",
        )
    return actor.tenant_id


@router.get("/api-keys", summary="List API key metadata (never the secret)")
def list_api_keys(actor: AdminActor, db: DbSession) -> dict[str, Any]:
    tenant_id = _require_tenant(actor)
    rows = (
        db.execute(
            select(ApiKey)
            .where(ApiKey.tenant_id == tenant_id)
            .order_by(ApiKey.created_at.desc())
        )
        .scalars()
        .all()
    )
    return {"items": [_key_json(row) for row in rows], "total": len(rows)}


@router.post(
    "/api-keys",
    status_code=status.HTTP_201_CREATED,
    summary="Create an API key - the plaintext key is returned once",
)
def create_api_key(payload: ApiKeyCreateIn, actor: AdminActor, db: DbSession) -> dict[str, Any]:
    tenant_id = _require_tenant(actor)

    unknown = [scope for scope in payload.scopes if scope not in ALLOWED_SCOPES]
    if unknown:
        raise ValidationError(
            message_en="Unknown scope requested.",
            message_ur="نامعلوم اجازت طلب کی گئی۔",
            details={"unknown_scopes": unknown, "allowed": sorted(ALLOWED_SCOPES)},
        )

    prefix = f"hq_live_{secrets.token_hex(4)}"
    secret = secrets.token_urlsafe(24)
    plaintext = f"{prefix}_{secret}"

    row = ApiKey(
        tenant_id=tenant_id,
        name=payload.name,
        key_prefix=prefix,
        key_hash=hashlib.sha256(plaintext.encode("utf-8")).hexdigest(),
        scopes=payload.scopes,
        rate_limit_per_min=payload.rate_limit_per_min,
        is_active=True,
        created_by_user_id=actor.user_id or uuid.UUID(int=0),
    )
    db.add(row)
    db.flush()

    audit.record(
        db,
        action="api_key.created",
        resource_type="api_key",
        resource_id=row.id,
        actor_type=actor.actor_type,
        actor_id=actor.actor_id_str,
        actor_role=actor.role_value,
        tenant_id=tenant_id,
        payload={"name": row.name, "scopes": row.scopes, "key_prefix": row.key_prefix},
    )
    db.commit()

    return {**_key_json(row), "api_key": plaintext, "notice": "Store this key now; it is shown once."}


@router.delete("/api-keys/{key_id}", summary="Revoke an API key (next call returns 401)")
def revoke_api_key(key_id: uuid.UUID, actor: AdminActor, db: DbSession) -> dict[str, Any]:
    tenant_id = _require_tenant(actor)
    row = db.get(ApiKey, key_id)
    if row is None or row.tenant_id != tenant_id:
        raise NotFoundError()

    row.is_active = False
    audit.record(
        db,
        action="api_key.revoked",
        resource_type="api_key",
        resource_id=row.id,
        actor_type=actor.actor_type,
        actor_id=actor.actor_id_str,
        actor_role=actor.role_value,
        tenant_id=tenant_id,
        payload={"name": row.name, "key_prefix": row.key_prefix, "revoked_at": datetime.now(UTC).isoformat()},
    )
    db.commit()
    return _key_json(row)


__all__ = ["ALLOWED_SCOPES", "router"]
