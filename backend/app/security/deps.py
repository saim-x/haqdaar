"""Public dependency surface for routers (imported by every agent's endpoints).

``app.security.deps`` is the stable import path other agents code against; the
implementation lives in :mod:`app.security.rbac` and :mod:`app.security.consent`.
"""

from __future__ import annotations

from app.security.consent import enforce_consent
from app.security.errors import (
    ApiError,
    ConsentRevokedError,
    ForbiddenError,
    InvalidTransitionError,
    NotFoundError,
    UnauthorizedError,
    ValidationError,
)
from app.security.rbac import (
    ACT_FOR_HEADER,
    API_KEY_HEADER,
    ActorContext,
    ApiKeyContext,
    actor_label_for,
    assert_tenant_scope,
    get_act_for_citizen,
    get_api_key_context,
    get_current_actor,
    get_current_user,
    get_current_user_optional,
    get_optional_actor,
    require_any_authenticated,
    require_roles,
    require_scopes,
    resolve_citizen_scope,
)

__all__ = [
    "ACT_FOR_HEADER",
    "API_KEY_HEADER",
    "ActorContext",
    "ApiError",
    "ApiKeyContext",
    "ConsentRevokedError",
    "ForbiddenError",
    "InvalidTransitionError",
    "NotFoundError",
    "UnauthorizedError",
    "ValidationError",
    "actor_label_for",
    "assert_tenant_scope",
    "enforce_consent",
    "get_act_for_citizen",
    "get_api_key_context",
    "get_current_actor",
    "get_current_user",
    "get_current_user_optional",
    "get_optional_actor",
    "require_any_authenticated",
    "require_roles",
    "require_scopes",
    "resolve_citizen_scope",
]
