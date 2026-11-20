"""Shared plumbing for the AI routers (``app/api/v1/{voice,scam,rag,admin_mocks}.py``).

The backend owns authentication, the DB session dependency and the audit writer.
Those modules land in A1's sprint, so every import here is defensive: when the
real dependency exists it is used verbatim; when it does not, a minimal
stand-in keeps the routers importable and the test suite green. Nothing in this
module makes an authorisation decision on its own — it only forwards to A1's
implementation the moment it appears.
"""

from __future__ import annotations

import logging
from collections.abc import Callable, Iterator, Sequence
from typing import Any

logger = logging.getLogger("haqdaar.ai.api_support")


# --------------------------------------------------------------------------- #
# database session
# --------------------------------------------------------------------------- #
def get_db() -> Iterator[Any]:
    """Yield a session, preferring A1's ``app.db.get_db``."""
    try:  # pragma: no cover - depends on A1 landing
        from app.db import get_db as backend_get_db  # type: ignore

        yield from backend_get_db()
        return
    except ImportError:
        pass

    from app.db import SessionLocal  # type: ignore

    if SessionLocal is None:  # pragma: no cover - test stub
        raise RuntimeError("no database session factory is configured")
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


# --------------------------------------------------------------------------- #
# authentication
# --------------------------------------------------------------------------- #
class AnonymousUser:
    """Stand-in principal used only when A1's auth layer is absent."""

    id = None
    role = "ANONYMOUS"
    tenant_id = None
    email = None
    full_name = "Anonymous"
    preferred_lang = "ur"

    def __repr__(self) -> str:  # pragma: no cover
        return "<AnonymousUser>"


ANONYMOUS = AnonymousUser()


def _backend_deps() -> Any:
    for module_name in ("app.security.deps", "app.api.deps", "app.deps"):
        try:
            module = __import__(module_name, fromlist=["*"])
        except Exception:
            continue
        return module
    return None


def optional_user(authorization: str | None = None) -> Any:
    """Resolve the caller when a token is present; otherwise anonymous."""
    deps = _backend_deps()
    if deps is None:
        return ANONYMOUS
    for name in ("get_current_user_optional", "optional_user", "get_optional_user"):
        resolver = getattr(deps, name, None)
        if resolver is None:
            continue
        try:
            return resolver(authorization) if authorization else resolver()
        except TypeError:
            try:
                return resolver()
            except Exception:
                return ANONYMOUS
        except Exception:
            return ANONYMOUS
    return ANONYMOUS


def require_roles(*roles: str) -> Callable[..., Any]:
    """Return A1's role dependency when available, else a permissive stub."""
    deps = _backend_deps()
    if deps is not None:
        for name in ("require_roles", "roles_required", "RoleChecker"):
            factory = getattr(deps, name, None)
            if factory is None:
                continue
            try:
                return factory(*roles)
            except Exception:
                continue

    def _stub() -> Any:  # pragma: no cover - replaced once A1 lands
        return ANONYMOUS

    return _stub


def current_user_dependency() -> Callable[..., Any]:
    deps = _backend_deps()
    if deps is not None:
        for name in ("get_current_user", "current_user"):
            resolver = getattr(deps, name, None)
            if resolver is not None:
                return resolver

    def _stub() -> Any:  # pragma: no cover
        return ANONYMOUS

    return _stub


def user_id(user: Any) -> Any:
    return getattr(user, "id", None)


def user_role(user: Any) -> str:
    return str(getattr(user, "role", "ANONYMOUS") or "ANONYMOUS")


def user_tenant(user: Any) -> Any:
    return getattr(user, "tenant_id", None)


# --------------------------------------------------------------------------- #
# audit
# --------------------------------------------------------------------------- #
def record_audit(
    db: Any,
    *,
    action: str,
    resource_type: str,
    resource_id: str | None = None,
    tenant_id: Any = None,
    actor_type: str = "USER",
    actor_id: Any = None,
    actor_role: str | None = None,
    payload: dict[str, Any] | None = None,
) -> None:
    """Write an audit event through A1's hash-chained writer when present."""
    if db is None:
        return
    try:  # pragma: no cover - depends on A1 landing
        from app.security import audit as audit_module  # type: ignore

        audit_module.record(
            db,
            tenant_id=tenant_id,
            actor_type=actor_type,
            actor_id=str(actor_id) if actor_id is not None else None,
            actor_role=actor_role,
            action=action,
            resource_type=resource_type,
            resource_id=resource_id,
            payload_json=payload or {},
        )
        return
    except Exception as exc:
        logger.debug("audit write skipped for %s: %s", action, exc)


# --------------------------------------------------------------------------- #
# misc
# --------------------------------------------------------------------------- #
def table(name: str) -> Any:
    """Look up an application table by name (never a ``mock_*`` table)."""
    from app.db import Base  # type: ignore

    found = Base.metadata.tables.get(name)
    if found is None:
        raise RuntimeError(f"table '{name}' is missing from the application metadata")
    return found


def insert_row(db: Any, name: str, row: dict[str, Any]) -> dict[str, Any]:
    """Insert a row, dropping keys the real schema does not have."""
    target = table(name)
    allowed = {column.name for column in target.columns}
    payload = {key: value for key, value in row.items() if key in allowed}
    db.execute(target.insert(), [payload])
    return payload


def update_row(db: Any, name: str, row_id: Any, values: dict[str, Any]) -> None:
    target = table(name)
    allowed = {column.name for column in target.columns}
    payload = {key: value for key, value in values.items() if key in allowed}
    if not payload:
        return
    db.execute(target.update().where(target.c.id == row_id).values(**payload))


def select_row(db: Any, name: str, row_id: Any) -> Any:
    target = table(name)
    return db.execute(target.select().where(target.c.id == row_id)).mappings().first()


def env_flag(name: str, default: bool = False) -> bool:
    import os

    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def demo_mode_enabled() -> bool:
    return env_flag("DEMO_MODE", default=True)


def allowed_roles(*roles: str) -> Sequence[str]:
    return tuple(roles)


__all__ = [
    "ANONYMOUS",
    "AnonymousUser",
    "allowed_roles",
    "current_user_dependency",
    "demo_mode_enabled",
    "env_flag",
    "get_db",
    "insert_row",
    "optional_user",
    "record_audit",
    "require_roles",
    "select_row",
    "table",
    "update_row",
    "user_id",
    "user_role",
    "user_tenant",
]
