"""Server-side RBAC, tenant isolation and actor resolution (docs/09 §2–3).

Everything here is enforced on the server; UI visibility is cosmetic. Two rules
are absolute:

* ``tenant_id`` comes from the verified JWT / API key only — never from a request
  body or query parameter.
* A resource that belongs to another tenant or citizen returns ``404 NOT_FOUND``
  (never ``403``, which would leak existence) plus an ``auth.cross_scope_denied``
  audit event.

``ActorContext.role`` is a plain string so the department agent (``"AGENT"``,
docs/09 §4.1) can be represented without widening the frozen ``user_role`` enum.
"""

from __future__ import annotations

import hashlib
import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime

from fastapi import Depends, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models.enums import ActorType, ConsentRecipientType, ConsentStatus, UserRole
from app.models.identity import ApiKey, Citizen, ConsentGrant, User
from app.security import audit
from app.security.context import get_request_id, set_actor_context
from app.security.errors import (
    ConsentRevokedError,
    ForbiddenError,
    NotFoundError,
    UnauthorizedError,
)
from app.security.jwt import decode_access_token

ACT_FOR_HEADER = "X-Act-For-Citizen"
API_KEY_HEADER = "X-API-Key"

#: Roles that read citizen data through a DEPARTMENT consent grant.
DEPARTMENT_ACTOR_ROLES = frozenset({UserRole.OFFICER.value, "AGENT"})


@dataclass(frozen=True, slots=True)
class ActorContext:
    """The verified identity behind a request. Built only from a JWT or API key."""

    user_id: uuid.UUID | None
    role: UserRole | str
    tenant_id: uuid.UUID | None = None
    citizen_id: uuid.UUID | None = None
    label: str = ""
    actor_type: ActorType = ActorType.USER
    api_key_id: uuid.UUID | None = None
    request_id: str | None = None
    act_for_citizen_id: uuid.UUID | None = None
    scopes: tuple[str, ...] = field(default_factory=tuple)
    is_platform_admin: bool = False

    @property
    def role_value(self) -> str:
        """Normalised role string (``"CITIZEN"``, ``"OFFICER"``, ``"AGENT"``…)."""
        return str(self.role)

    @property
    def id(self) -> uuid.UUID | None:
        """Alias used by routers that treat the dependency result as the user."""
        return self.user_id if self.user_id is not None else self.api_key_id

    @property
    def effective_citizen_id(self) -> uuid.UUID | None:
        """The citizen whose data this request may touch (helper act-for wins)."""
        return self.act_for_citizen_id or self.citizen_id

    @property
    def actor_id_str(self) -> str | None:
        if self.api_key_id is not None:
            return str(self.api_key_id)
        return str(self.user_id) if self.user_id else None

    def with_act_for(self, citizen_id: uuid.UUID | None) -> ActorContext:
        return ActorContext(
            user_id=self.user_id,
            role=self.role,
            tenant_id=self.tenant_id,
            citizen_id=self.citizen_id,
            label=self.label,
            actor_type=self.actor_type,
            api_key_id=self.api_key_id,
            request_id=self.request_id,
            act_for_citizen_id=citizen_id,
            scopes=self.scopes,
            is_platform_admin=self.is_platform_admin,
        )


# --- Token / key extraction -------------------------------------------------


def _bearer_token(request: Request) -> str | None:
    header = request.headers.get("Authorization") or ""
    scheme, _, token = header.partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        return None
    return token.strip()


def _as_uuid(value: object) -> uuid.UUID | None:
    if value in (None, "", "null"):
        return None
    if isinstance(value, uuid.UUID):
        return value
    try:
        return uuid.UUID(str(value))
    except (ValueError, AttributeError):
        return None


def _actor_from_user(user: User, *, citizen_id: uuid.UUID | None) -> ActorContext:
    role = UserRole(user.role)
    return ActorContext(
        user_id=user.id,
        role=role,
        tenant_id=user.tenant_id,
        citizen_id=citizen_id,
        label=user.full_name,
        actor_type=ActorType.USER,
        request_id=get_request_id(),
        is_platform_admin=(role is UserRole.ADMIN and user.tenant_id is None),
    )


def get_current_actor(request: Request, db: Session = Depends(get_db)) -> ActorContext:
    """Resolve the caller from the Bearer JWT. Raises ``401 UNAUTHORIZED``."""
    token = _bearer_token(request)
    if token is None:
        raise UnauthorizedError()

    claims = decode_access_token(token)
    user_id = _as_uuid(claims.get("sub"))
    if user_id is None:
        raise UnauthorizedError()

    user = db.get(User, user_id)
    if user is None or not user.is_active:
        raise UnauthorizedError()

    citizen_id = _as_uuid(claims.get("citizen_id"))
    if citizen_id is None and UserRole(user.role) is UserRole.CITIZEN:
        citizen_id = db.execute(
            select(Citizen.id).where(Citizen.user_id == user.id)
        ).scalar_one_or_none()

    actor = _actor_from_user(user, citizen_id=citizen_id)
    set_actor_context(actor.actor_id_str, str(actor.tenant_id) if actor.tenant_id else None)
    return actor


def get_optional_actor(request: Request, db: Session = Depends(get_db)) -> ActorContext | None:
    """For endpoints that are public but richer when authenticated."""
    if _bearer_token(request) is None:
        return None
    try:
        return get_current_actor(request, db)
    except UnauthorizedError:
        return None


def require_roles(*roles: UserRole | str):
    """Dependency factory: allow only the listed roles, else ``403 FORBIDDEN``."""
    allowed = frozenset(str(role) for role in roles)

    def _guard(actor: ActorContext = Depends(get_current_actor)) -> ActorContext:
        if actor.role_value not in allowed:
            raise ForbiddenError(
                details={"required_roles": sorted(allowed), "role": actor.role_value}
            )
        return actor

    _guard.rbac_guard = True  # marker used by tests/test_invariants.py
    _guard.allowed_roles = allowed
    return _guard


def require_any_authenticated(actor: ActorContext = Depends(get_current_actor)) -> ActorContext:
    return actor


require_any_authenticated.rbac_guard = True  # type: ignore[attr-defined]


# --- Tenant isolation -------------------------------------------------------


def assert_tenant_scope(
    db: Session,
    actor: ActorContext,
    resource_tenant_id: uuid.UUID | None,
    *,
    resource_type: str,
    resource_id: str | uuid.UUID | None = None,
) -> None:
    """404 (never 403) when a resource lives outside the actor's tenant."""
    if actor.is_platform_admin or actor.role_value == UserRole.AUDITOR.value:
        return
    if resource_tenant_id is None or actor.tenant_id is None:
        _deny_cross_scope(db, actor, resource_type, resource_id)
    if resource_tenant_id != actor.tenant_id:
        _deny_cross_scope(db, actor, resource_type, resource_id)


def _deny_cross_scope(
    db: Session,
    actor: ActorContext,
    resource_type: str,
    resource_id: str | uuid.UUID | None,
) -> None:
    """Persist the denial in an isolated session so the 404 rollback cannot erase it."""
    audit.record_isolated(
        action="auth.cross_scope_denied",
        resource_type=resource_type,
        resource_id=resource_id,
        actor_type=actor.actor_type,
        actor_id=actor.actor_id_str,
        actor_role=actor.role_value,
        tenant_id=actor.tenant_id,
        payload={"role": actor.role_value, "actor_tenant_id": str(actor.tenant_id or "")},
    )
    raise NotFoundError()


# --- Helper act-for-citizen -------------------------------------------------


def get_act_for_citizen(request: Request) -> uuid.UUID | None:
    raw = request.headers.get(ACT_FOR_HEADER)
    if not raw:
        return None
    parsed = _as_uuid(raw)
    if parsed is None:
        raise NotFoundError()
    return parsed


def resolve_citizen_scope(
    db: Session,
    actor: ActorContext,
    act_for_citizen_id: uuid.UUID | None,
) -> uuid.UUID:
    """Return the citizen id this request may act on, enforcing helper grants.

    * CITIZEN: always their own id (``X-Act-For-Citizen`` is ignored).
    * HELPER: requires an active ``HELPER`` grant; unknown citizen -> 404,
      withdrawn/expired grant -> 403 CONSENT_REVOKED (logged).
    """
    if actor.role_value == UserRole.CITIZEN.value:
        if actor.citizen_id is None:
            raise NotFoundError()
        return actor.citizen_id

    if actor.role_value != UserRole.HELPER.value:
        raise ForbiddenError()

    if act_for_citizen_id is None:
        raise ForbiddenError(
            message_en="Select a family member first (X-Act-For-Citizen header).",
            message_ur="پہلے فیملی ممبر منتخب کریں۔",
        )

    citizen = db.get(Citizen, act_for_citizen_id)
    if citizen is None:
        raise NotFoundError()

    grant = db.execute(
        select(ConsentGrant)
        .where(
            ConsentGrant.citizen_id == act_for_citizen_id,
            ConsentGrant.recipient_type == ConsentRecipientType.HELPER.value,
            ConsentGrant.recipient_user_id == actor.user_id,
        )
        .order_by(ConsentGrant.granted_at.desc())
        .limit(1)
    ).scalar_one_or_none()

    if grant is None:
        # Never reveal whether the citizen exists to a helper without a grant.
        raise NotFoundError()

    if grant.status != ConsentStatus.ACTIVE.value:
        _deny_helper_grant(actor, act_for_citizen_id, "CONSENT_REVOKED")

    if grant.expires_at is not None and grant.expires_at < datetime.now(UTC):
        _deny_helper_grant(actor, act_for_citizen_id, "CONSENT_EXPIRED")

    return act_for_citizen_id


def _deny_helper_grant(
    actor: ActorContext, citizen_id: uuid.UUID, reason: str
) -> None:
    from app.security.consent import log_denied_access  # local import avoids a cycle

    log_denied_access(
        citizen_id=citizen_id,
        actor=actor,
        category="CASE_HISTORY",
        purpose="HELPER_ASSISTANCE",
        resource_ref=f"citizen:{citizen_id}",
        denial_reason=reason,
    )
    raise ConsentRevokedError(details={"reason": reason})


# --- Public API key auth ----------------------------------------------------


@dataclass(frozen=True, slots=True)
class ApiKeyContext:
    api_key_id: uuid.UUID
    tenant_id: uuid.UUID
    scopes: tuple[str, ...]
    rate_limit_per_min: int
    name: str

    @property
    def id(self) -> uuid.UUID:
        return self.api_key_id


def get_api_key_context(request: Request, db: Session = Depends(get_db)) -> ApiKeyContext:
    """Validate ``X-API-Key``. Revoked or unknown keys get ``401 UNAUTHORIZED``."""
    raw = request.headers.get(API_KEY_HEADER)
    if not raw:
        raise UnauthorizedError(
            message_en="An API key is required for this endpoint.",
            message_ur="اس اینڈ پوائنٹ کے لیے API کلید درکار ہے۔",
        )

    key_hash = hashlib.sha256(raw.encode("utf-8")).hexdigest()
    row = db.execute(select(ApiKey).where(ApiKey.key_hash == key_hash)).scalar_one_or_none()
    if row is None or not row.is_active:
        raise UnauthorizedError(
            message_en="This API key is invalid or has been revoked.",
            message_ur="یہ API کلید غلط ہے یا منسوخ کر دی گئی ہے۔",
        )

    row.last_used_at = datetime.now(UTC)
    db.flush()

    return ApiKeyContext(
        api_key_id=row.id,
        tenant_id=row.tenant_id,
        scopes=tuple(row.scopes or ()),
        rate_limit_per_min=row.rate_limit_per_min,
        name=row.name,
    )


def require_scopes(*required: str):
    """Dependency factory: API key must carry every listed scope."""

    def _guard(ctx: ApiKeyContext = Depends(get_api_key_context)) -> ApiKeyContext:
        missing = [scope for scope in required if scope not in ctx.scopes]
        if missing:
            raise ForbiddenError(
                message_en="This API key does not have the required scope.",
                message_ur="اس API کلید کے پاس مطلوبہ اجازت نہیں ہے۔",
                details={"missing_scopes": missing},
            )
        return ctx

    _guard.rbac_guard = True  # marker used by tests/test_invariants.py
    _guard.required_scopes = tuple(required)
    return _guard


def actor_label_for(actor: ActorContext) -> str:
    """Human label used in ``consent_access_logs`` (never a raw phone number)."""
    role = actor.role_value
    if role == UserRole.HELPER.value:
        return f"Helper {actor.label}".strip()
    if role == UserRole.OFFICER.value:
        return f"Officer {actor.label}".strip()
    if role == UserRole.AUDITOR.value:
        return "Auditor (oversight)"
    if role == UserRole.ADMIN.value:
        return f"Admin {actor.label}".strip()
    if role == "AGENT":
        return f"Department agent ({actor.label})".strip()
    return actor.label or "Citizen"


__all__ = [
    "ACT_FOR_HEADER",
    "API_KEY_HEADER",
    "DEPARTMENT_ACTOR_ROLES",
    "ActorContext",
    "ApiKeyContext",
    "actor_label_for",
    "assert_tenant_scope",
    "get_act_for_citizen",
    "get_api_key_context",
    "get_current_actor",
    "get_optional_actor",
    "require_any_authenticated",
    "require_roles",
    "require_scopes",
    "resolve_citizen_scope",
]
