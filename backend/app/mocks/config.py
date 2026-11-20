"""Chaos-control configuration for the simulated DPI services.

This module is the **only** ``app.mocks`` surface that ``app/api/v1/admin_mocks.py``
is allowed to import (pinned by the Integration Lead and enforced by
``tests/test_invariants.py``). It therefore exposes plain dicts and never leaks
ORM objects, sessions, or ``app.mocks.models`` types to the API layer.

Contract: docs/10 §1.1 (modes, defaults) and docs/04 §4.6 (``mock_service_configs``).
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.mocks.models import CHAOS_MODES, SERVICE_NAMES, MockServiceConfig

#: Default latency applied by ``SLOW`` / ``FLAKY`` (docs/10 §1.1).
DEFAULT_LATENCY_MS = 4000
#: Default failure probability applied by ``FLAKY`` (docs/10 §1.1).
DEFAULT_FAILURE_RATE = 0.50
#: ``NORMAL`` mode jitter window in milliseconds (docs/10 §1.1: 30–80 ms).
NORMAL_JITTER_MIN_MS = 30
NORMAL_JITTER_MAX_MS = 80


class MockConfigError(ValueError):
    """Raised for an unknown service name or an invalid chaos payload."""

    def __init__(self, message: str, *, field: str | None = None) -> None:
        super().__init__(message)
        self.field = field


def _serialize(cfg: MockServiceConfig) -> dict[str, Any]:
    return {
        "service_name": cfg.service_name,
        "mode": cfg.mode,
        "latency_ms": cfg.latency_ms,
        "failure_rate": cfg.failure_rate,
        "updated_at": cfg.updated_at.isoformat() if cfg.updated_at else None,
    }


def ensure_defaults(db: Session) -> None:
    """Insert a ``NORMAL`` row for every simulated service that lacks one."""
    existing = set(db.scalars(select(MockServiceConfig.service_name)).all())
    for name in SERVICE_NAMES:
        if name not in existing:
            db.add(
                MockServiceConfig(
                    service_name=name,
                    mode="NORMAL",
                    latency_ms=DEFAULT_LATENCY_MS,
                    failure_rate=DEFAULT_FAILURE_RATE,
                )
            )
    db.flush()


def list_service_configs(db: Session) -> list[dict[str, Any]]:
    """Return every service config, ordered by canonical service name."""
    ensure_defaults(db)
    rows = db.scalars(select(MockServiceConfig)).all()
    by_name = {row.service_name: row for row in rows}
    return [_serialize(by_name[name]) for name in SERVICE_NAMES if name in by_name]


def get_service_config(db: Session, service_name: str) -> dict[str, Any]:
    """Return one service config, creating the default row if absent."""
    if service_name not in SERVICE_NAMES:
        raise MockConfigError(f"Unknown mock service '{service_name}'", field="service_name")
    ensure_defaults(db)
    cfg = db.get(MockServiceConfig, service_name)
    assert cfg is not None  # guaranteed by ensure_defaults
    return _serialize(cfg)


def _validate_mode(mode: Any) -> str:
    if not isinstance(mode, str) or mode.upper() not in CHAOS_MODES:
        raise MockConfigError(
            f"mode must be one of {', '.join(CHAOS_MODES)}", field="mode"
        )
    return mode.upper()


def _validate_latency(latency_ms: Any) -> int:
    if isinstance(latency_ms, bool) or not isinstance(latency_ms, int):
        raise MockConfigError("latency_ms must be an integer", field="latency_ms")
    if not 0 <= latency_ms <= 30_000:
        raise MockConfigError("latency_ms must be between 0 and 30000", field="latency_ms")
    return latency_ms


def _validate_failure_rate(failure_rate: Any) -> float:
    if isinstance(failure_rate, bool) or not isinstance(failure_rate, (int, float)):
        raise MockConfigError("failure_rate must be a number", field="failure_rate")
    value = float(failure_rate)
    if not 0.0 <= value <= 1.0:
        raise MockConfigError("failure_rate must be between 0.0 and 1.0", field="failure_rate")
    return value


def update_service_config(db: Session, service_name: str, payload: dict[str, Any]) -> dict[str, Any]:
    """Apply a partial chaos update and return the new serialized config."""
    if service_name not in SERVICE_NAMES:
        raise MockConfigError(f"Unknown mock service '{service_name}'", field="service_name")
    ensure_defaults(db)
    cfg = db.get(MockServiceConfig, service_name)
    assert cfg is not None

    if "mode" in payload and payload["mode"] is not None:
        cfg.mode = _validate_mode(payload["mode"])
    if "latency_ms" in payload and payload["latency_ms"] is not None:
        cfg.latency_ms = _validate_latency(payload["latency_ms"])
    if "failure_rate" in payload and payload["failure_rate"] is not None:
        cfg.failure_rate = _validate_failure_rate(payload["failure_rate"])

    db.flush()
    db.refresh(cfg)
    return _serialize(cfg)


def reset_service_configs(db: Session) -> list[dict[str, Any]]:
    """Return every simulated service to ``NORMAL`` (used by demo reset)."""
    ensure_defaults(db)
    for cfg in db.scalars(select(MockServiceConfig)).all():
        cfg.mode = "NORMAL"
        cfg.latency_ms = DEFAULT_LATENCY_MS
        cfg.failure_rate = DEFAULT_FAILURE_RATE
    db.flush()
    return list_service_configs(db)


def demo_reset(db: Session) -> dict[str, Any]:
    """Reset application + mock state and re-seed the synthetic demo world.

    Delegates to :mod:`app.mocks.seed` so the API layer never touches ORM models
    or sessions directly. Returns a small summary for the admin UI.
    """
    from app.mocks import seed as seed_module

    return seed_module.reset_and_seed(db)


__all__ = [
    "DEFAULT_FAILURE_RATE",
    "DEFAULT_LATENCY_MS",
    "NORMAL_JITTER_MAX_MS",
    "NORMAL_JITTER_MIN_MS",
    "MockConfigError",
    "demo_reset",
    "ensure_defaults",
    "get_service_config",
    "list_service_configs",
    "reset_service_configs",
    "update_service_config",
]
