"""Stub BE modules so Agent EN's Phase-2 code can be imported before the S1 merge.

``app/agent/case_agent.py`` and ``app/api/v1/{admin_rules,eval}.py`` import
``app.models``, ``app.db``, ``app.security.*``, ``app.jobs.queue`` and ``app.notify``.
None of those exist on ``feat/engine`` yet, so the tests install minimal stand-ins with
``monkeypatch.setitem`` - they are removed again at teardown and cannot leak.

This is a test scaffold, not a substitute for the real modules: it exists so the frozen
*interfaces* (function signatures, the nine step names, the route surface) are locked
today and keep being checked after the merge.
"""

from __future__ import annotations

import sys
import types
from typing import Any

import pytest

#: Every model class the Phase-2 modules reference.
MODEL_NAMES = (
    "AiTelemetry",
    "Case",
    "CaseNote",
    "Citizen",
    "ConsentGrant",
    "Decision",
    "Document",
    "Payment",
    "Program",
    "RuleVersion",
    "SimulationRun",
)

#: Column attributes used in ``select(...).where(...)`` / ``order_by(...)``.
COLUMN_NAMES = (
    "active_rule_version_id",
    "case_id",
    "citizen_id",
    "created_at",
    "decision_source",
    "estimated_cost_usd",
    "id",
    "is_active",
    "is_override",
    "metadata_json",
    "note_type",
    "payout_alias",
    "phone",
    "program_id",
    "route_action",
    "status",
    "succeeded",
    "tenant_id",
    "version_number",
)


def _module(name: str, **attrs: Any) -> types.ModuleType:
    module = types.ModuleType(name)
    for key, value in attrs.items():
        setattr(module, key, value)
    return module


def _models() -> types.ModuleType:
    """Model classes whose column attributes are plain strings (usable in filters)."""
    module = types.ModuleType("app.models")
    for name in MODEL_NAMES:
        cls = type(name, (), {"__module__": "app.models"})
        for column in COLUMN_NAMES:
            setattr(cls, column, column)
        setattr(module, name, cls)
    return module


def _require_roles(*roles: str) -> Any:
    def dependency() -> None:  # pragma: no cover - never executed
        raise RuntimeError("stub dependency")

    dependency.roles = roles  # type: ignore[attr-defined]
    return dependency


def install(monkeypatch: pytest.MonkeyPatch) -> None:
    """Install stand-ins for every BE module the Phase-2 code imports."""
    stubs = {
        "app.db": _module("app.db", get_db=lambda: None),
        "app.models": _models(),
        "app.security.deps": _module(
            "app.security.deps",
            require_roles=_require_roles,
            get_current_user=lambda: None,
        ),
        "app.security.audit": _module(
            "app.security.audit", record=lambda *a, **k: None
        ),
        "app.security.consent": _module(
            "app.security.consent",
            ActorContext=type("ActorContext", (), {}),
            ConsentRevokedError=type("ConsentRevokedError", (Exception,), {}),
            enforce_consent=lambda *a, **k: None,
        ),
        "app.jobs.queue": _module("app.jobs.queue", enqueue_job=lambda *a, **k: None),
        "app.notify": _module("app.notify", create_notification=lambda *a, **k: None),
    }
    for name, module in stubs.items():
        monkeypatch.setitem(sys.modules, name, module)
    for name in (
        "app.agent.deps",
        "app.agent.case_agent",
        "app.api.v1.admin_rules",
        "app.api.v1.eval",
    ):
        monkeypatch.delitem(sys.modules, name, raising=False)
