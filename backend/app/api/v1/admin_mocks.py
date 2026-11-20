"""Platform admin controls for the simulated world (docs/05 §3.7).

Two endpoints, both Platform-ADMIN only:

``GET/PATCH /api/v1/admin/mocks``
    Read and change each mock service's chaos mode (``NORMAL``/``SLOW``/``FLAKY``/
    ``DOWN``), latency and failure rate. This is how the judges watch the system
    survive a government rail going down.

``POST /api/v1/admin/demo/reset``
    Wipe application + mock state and re-seed the synthetic demo world in under
    five seconds. Gated on ``DEMO_MODE`` so it can never run in a real deployment.

**Boundary note.** This is the one sanctioned place where ``app/api`` may reach
into ``app.mocks``, and it imports *only* ``app.mocks.config`` — never the mock
ORM models, never a mock session, never a ``mock_*`` table. The invariants test
pins that.
"""

from __future__ import annotations

import logging
import time
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse

from app.ai import api_support
from app.mocks import config as mock_config

logger = logging.getLogger("haqdaar.api.admin_mocks")

router = APIRouter(prefix="/admin", tags=["admin"])

ADMIN_ROLES = ("ADMIN", "PLATFORM_ADMIN")


def _db() -> Any:
    yield from api_support.get_db()


def _admin(request: Request) -> Any:
    """Resolve the caller and require a platform administrator."""
    user = api_support.optional_user(request.headers.get("authorization"))
    role = api_support.user_role(user)
    if role not in ADMIN_ROLES:
        raise HTTPException(
            status_code=403,
            detail={"error": "FORBIDDEN", "required_roles": list(ADMIN_ROLES)},
        )
    return user


def _audit(db: Any, user: Any, action: str, payload: dict[str, Any]) -> None:
    api_support.record_audit(
        db,
        tenant_id=api_support.user_tenant(user),
        actor_type="USER",
        actor_id=api_support.user_id(user),
        actor_role=api_support.user_role(user),
        action=action,
        resource_type="mock_service_config",
        resource_id=None,
        payload=payload,
    )


@router.get("/mocks")
def list_mocks(
    request: Request,
    db: Any = Depends(_db),
    user: Any = Depends(_admin),
) -> JSONResponse:
    """Every mock service with its current chaos mode."""
    try:
        mock_config.ensure_defaults(db)
        services = mock_config.list_service_configs(db)
    except Exception as exc:  # pragma: no cover - depends on A1 landing
        logger.warning("cannot list mock configs: %s", exc)
        raise HTTPException(
            status_code=503,
            detail={"error": "MOCK_CONFIG_UNAVAILABLE", "message": str(exc)},
        ) from exc

    return JSONResponse(
        status_code=200,
        content={
            "simulated": True,
            "service_mode": "ADMIN",
            "services": services,
            "count": len(services),
        },
    )


@router.patch("/mocks")
async def update_mocks(
    request: Request,
    db: Any = Depends(_db),
    user: Any = Depends(_admin),
) -> JSONResponse:
    """Change one or more mock services' chaos settings.

    Accepts either a single object (``{"service": "identity", "mode": "DOWN"}``)
    or a batch (``{"services": [{"service": "identity", "mode": "DOWN"}, ...]}``).
    """
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=422, detail={"error": "INVALID_JSON"})

    if not isinstance(payload, dict):
        raise HTTPException(status_code=422, detail={"error": "INVALID_JSON"})

    if isinstance(payload.get("services"), list):
        updates = [item for item in payload["services"] if isinstance(item, dict)]
    else:
        updates = [payload]

    if not updates:
        raise HTTPException(status_code=422, detail={"error": "NO_UPDATES"})

    try:
        mock_config.ensure_defaults(db)
    except Exception as exc:  # pragma: no cover
        raise HTTPException(
            status_code=503,
            detail={"error": "MOCK_CONFIG_UNAVAILABLE", "message": str(exc)},
        ) from exc

    applied: list[dict[str, Any]] = []
    for update in updates:
        service = update.get("service") or update.get("service_name")
        if not service:
            raise HTTPException(
                status_code=422,
                detail={"error": "SERVICE_REQUIRED", "update": update},
            )
        changes = {
            key: update[key]
            for key in ("mode", "latency_ms", "failure_rate", "notes")
            if key in update
        }
        if not changes:
            raise HTTPException(
                status_code=422,
                detail={"error": "NO_CHANGES", "service": service},
            )
        try:
            applied.append(mock_config.update_service_config(db, str(service), changes))
        except mock_config.MockConfigError as exc:
            raise HTTPException(
                status_code=422,
                detail={"error": "INVALID_MOCK_CONFIG", "service": service, "message": str(exc)},
            ) from exc

    _audit(
        db,
        user,
        "admin.mock_config_updated",
        {"updates": [{k: v for k, v in item.items() if k != "notes"} for item in applied]},
    )
    db.commit()

    return JSONResponse(
        status_code=200,
        content={
            "simulated": True,
            "service_mode": "ADMIN",
            "updated": applied,
            "count": len(applied),
        },
    )


@router.post("/demo/reset")
def demo_reset(
    request: Request,
    db: Any = Depends(_db),
    user: Any = Depends(_admin),
) -> JSONResponse:
    """Reset application + mock state and re-seed the demo world."""
    if not api_support.demo_mode_enabled():
        raise HTTPException(
            status_code=403,
            detail={"error": "DEMO_MODE_DISABLED", "hint": "set DEMO_MODE=true"},
        )

    started = time.perf_counter()
    try:
        summary = mock_config.demo_reset(db)
    except Exception as exc:  # pragma: no cover - depends on A1 landing
        logger.exception("demo reset failed")
        raise HTTPException(
            status_code=500,
            detail={"error": "DEMO_RESET_FAILED", "message": str(exc)},
        ) from exc

    elapsed_ms = int((time.perf_counter() - started) * 1000)

    _audit(
        db,
        user,
        "admin.demo_reset",
        {"elapsed_ms": elapsed_ms, "summary": _redact_summary(summary)},
    )
    db.commit()

    return JSONResponse(
        status_code=200,
        content={
            "simulated": True,
            "service_mode": "ADMIN",
            "reset": True,
            "elapsed_ms": elapsed_ms,
            "summary": _redact_summary(summary),
        },
    )


def _redact_summary(summary: Any) -> Any:
    """Keep the reset summary small and free of anything sensitive."""
    if not isinstance(summary, dict):
        return summary
    keep = {
        "tenants",
        "users",
        "citizens",
        "programs",
        "historical_cases",
        "showcase_cases",
        "demo_documents",
        "elapsed_ms",
        "rag",
    }
    return {key: value for key, value in summary.items() if key in keep}


def mock_service_statuses(db: Any) -> list[dict[str, Any]]:
    """Current chaos mode of every simulated DPI service, for the public honesty page.

    ``/transparency`` needs the same seven rows the admin console shows, but it is a
    public route and must not reach into ``app.mocks`` itself. Keeping the read here
    means ``app.mocks`` is imported by exactly one API module — the sanctioned seam —
    and the invariants test keeps enforcing that.

    Returns plain dicts (``service_name``/``mode``/``latency_ms``/``failure_rate``/
    ``updated_at``); never leaks ORM objects. A failure degrades to an empty list
    rather than breaking the honesty page.
    """
    try:
        mock_config.ensure_defaults(db)
        return mock_config.list_service_configs(db)
    except Exception:  # noqa: BLE001 - the disclosure page must still render
        logger.warning("cannot read mock service statuses", exc_info=True)
        return []


__all__ = ["mock_service_statuses", "router"]
