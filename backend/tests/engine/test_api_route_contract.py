"""Route-surface contract for the two API modules Agent EN owns.

``app/api/v1/admin_rules.py`` and ``app/api/v1/eval.py`` cannot be imported until BE's
``app.db`` / ``app.models`` / ``app.security.*`` / ``app.jobs.queue`` / ``app.notify``
land at S1. This module stubs exactly those imports so the *surface* — path, method,
status code, role dependency — is locked against docs/05 §3.7 and §3.9 today, and keeps
being checked after the merge.

The stubs are installed with ``monkeypatch.setitem`` so they are removed again at
teardown and cannot leak into another test.
"""

from __future__ import annotations

import sys
import types
from collections.abc import Iterator
from typing import Any, get_type_hints

import pytest
from app.engine.eval_sweep import LabelledCase
from app.engine.router import RouteAction

#: docs/05 §3.7 — the six rule-editor endpoints, verbatim.
EXPECTED_ADMIN_ROUTES = {
    ("GET", "/admin/programs/{program_id}/rules", 200),
    ("POST", "/admin/programs/{program_id}/rules", 201),
    ("PUT", "/admin/rules/{rule_version_id}", 200),
    ("POST", "/admin/rules/{rule_version_id}/validate", 200),
    ("POST", "/admin/rules/{rule_version_id}/simulate", 200),
    ("POST", "/admin/rules/{rule_version_id}/publish", 200),
}

#: docs/05 §3.9 — the evaluation dashboard.
EXPECTED_EVAL_ROUTES = {("GET", "/eval/dashboard", 200)}

_MODEL_NAMES = (
    "AiTelemetry",
    "Case",
    "CaseNote",
    "Decision",
    "Program",
    "RuleVersion",
    "SimulationRun",
)

_COLUMN_NAMES = (
    "active_rule_version_id",
    "case_id",
    "created_at",
    "decision_source",
    "estimated_cost_usd",
    "id",
    "is_active",
    "is_override",
    "metadata_json",
    "note_type",
    "program_id",
    "route_action",
    "succeeded",
    "tenant_id",
    "version_number",
)


def _stub(name: str, **attrs: Any) -> types.ModuleType:
    module = types.ModuleType(name)
    for key, value in attrs.items():
        setattr(module, key, value)
    return module


def _stub_models() -> types.ModuleType:
    """Model classes whose column attributes are plain strings (usable in filters)."""
    module = types.ModuleType("app.models")
    for name in _MODEL_NAMES:
        cls = type(name, (), {"__module__": "app.models"})
        for column in _COLUMN_NAMES:
            setattr(cls, column, column)
        setattr(module, name, cls)
    return module


def _stub_require_roles(*roles: str) -> Any:
    def dependency() -> None:  # pragma: no cover - never executed
        raise RuntimeError("stub dependency")

    dependency.roles = roles  # type: ignore[attr-defined]
    return dependency


@pytest.fixture
def api_modules(monkeypatch: pytest.MonkeyPatch) -> Iterator[tuple[Any, Any]]:
    """Import both API modules against stubbed BE helpers."""
    stubs = {
        "app.db": _stub("app.db", get_db=lambda: None),
        "app.models": _stub_models(),
        "app.security.deps": _stub(
            "app.security.deps",
            require_roles=_stub_require_roles,
            get_current_user=lambda: None,
        ),
        "app.security.audit": _stub("app.security.audit", record=lambda *a, **k: None),
        "app.security.consent": _stub(
            "app.security.consent",
            ActorContext=type("ActorContext", (), {}),
            ConsentRevokedError=type("ConsentRevokedError", (Exception,), {}),
            enforce_consent=lambda *a, **k: None,
        ),
        "app.jobs.queue": _stub("app.jobs.queue", enqueue_job=lambda *a, **k: None),
        "app.notify": _stub("app.notify", create_notification=lambda *a, **k: None),
    }
    for name, module in stubs.items():
        monkeypatch.setitem(sys.modules, name, module)
    for name in ("app.api.v1.admin_rules", "app.api.v1.eval"):
        monkeypatch.delitem(sys.modules, name, raising=False)

    from app.api.v1 import admin_rules
    from app.api.v1 import eval as eval_module

    yield admin_rules, eval_module


def _surface(router: Any) -> set[tuple[str, str, int]]:
    return {
        (method, route.path, route.status_code or 200)
        for route in router.routes
        for method in route.methods - {"HEAD", "OPTIONS"}
    }


# -- route surface -------------------------------------------------------
def test_admin_rule_routes_match_docs_05_3_7(api_modules: tuple[Any, Any]) -> None:
    admin_rules, _ = api_modules
    assert admin_rules.router.prefix == "/admin"
    assert _surface(admin_rules.router) == EXPECTED_ADMIN_ROUTES


def test_eval_dashboard_route_matches_docs_05_3_9(api_modules: tuple[Any, Any]) -> None:
    _, eval_module = api_modules
    assert eval_module.router.prefix == ""
    assert _surface(eval_module.router) == EXPECTED_EVAL_ROUTES


def test_rule_editor_is_admin_only_and_listing_allows_auditor(
    api_modules: tuple[Any, Any],
) -> None:
    """docs/05 §3.7: every mutation is ADMIN; the list is ADMIN + AUDITOR."""
    admin_rules, _ = api_modules
    by_name = {route.name: route for route in admin_rules.router.routes}
    assert by_name["list_rule_versions"].dependant is not None
    # The role dependency is the last parameter of each endpoint.
    for name, expected in (
        ("list_rule_versions", ("ADMIN", "AUDITOR")),
        ("create_rule_draft", ("ADMIN",)),
        ("update_rule_draft", ("ADMIN",)),
        ("validate_rule_version", ("ADMIN",)),
        ("simulate_rule_version", ("ADMIN",)),
        ("publish_rule_version", ("ADMIN",)),
    ):
        route = by_name[name]
        call = route.dependant.call
        assert call is not None
        roles = _roles_of(call)
        assert roles == expected, f"{name} roles {roles} != {expected}"


def _roles_of(endpoint: Any) -> tuple[str, ...]:
    """Read the roles baked into the endpoint's ``require_roles`` dependency."""
    hints = get_type_hints(endpoint, include_extras=True)
    for annotation in hints.values():
        for item in getattr(annotation, "__metadata__", ()):
            roles = getattr(getattr(item, "dependency", None), "roles", None)
            if roles is not None:
                return tuple(roles)
    raise AssertionError(f"no role dependency on {endpoint.__name__}")


# -- pure helpers inside the API modules ---------------------------------
def test_percentile_uses_nearest_rank(api_modules: tuple[Any, Any]) -> None:
    _, eval_module = api_modules
    assert eval_module._percentile([], 0.5) == 0
    assert eval_module._percentile([7], 0.95) == 7
    assert eval_module._percentile([10, 20, 30, 40, 50], 0.50) == 30
    assert eval_module._percentile([10, 20, 30, 40, 50], 0.95) == 50
    assert eval_module._percentile([5, 1, 3], 0.0) == 1


def test_missing_dataset_degrades_instead_of_raising(
    api_modules: tuple[Any, Any], tmp_path: Any
) -> None:
    _, eval_module = api_modules
    cases, note = eval_module._load_cases(tmp_path / "absent.jsonl")
    assert cases == []
    assert note is not None and "not found" in note


def test_malformed_dataset_degrades_instead_of_raising(
    api_modules: tuple[Any, Any], tmp_path: Any
) -> None:
    _, eval_module = api_modules
    broken = tmp_path / "broken.jsonl"
    broken.write_text("{not json}\n", encoding="utf-8")
    cases, note = eval_module._load_cases(broken)
    assert cases == []
    assert note is not None and "unreadable" in note


def test_dataset_loader_reads_labelled_cases(
    api_modules: tuple[Any, Any], tmp_path: Any
) -> None:
    _, eval_module = api_modules
    path = tmp_path / "cases.jsonl"
    path.write_text(
        '{"case_id": "c1", "truly_eligible": true, "identity_confidence": 0.95}\n'
        "\n"
        '{"case_id": "c2", "truly_eligible": false, "identity_confidence": 0.60}\n',
        encoding="utf-8",
    )
    cases, note = eval_module._load_cases(path)
    assert note is None
    assert [case.case_id for case in cases] == ["c1", "c2"]
    assert all(isinstance(case, LabelledCase) for case in cases)


def test_benchmarks_absent_is_reported_not_faked(api_modules: tuple[Any, Any]) -> None:
    """docs/07 §8: a missing DPI module must not invent numbers."""
    _, eval_module = api_modules
    scam, documents, available = eval_module._benchmarks()
    assert (scam, documents, available) == ({}, {}, False)


# -- invariants that must survive the takeover ---------------------------
def test_route_action_still_has_no_auto_reject(api_modules: tuple[Any, Any]) -> None:
    assert "AUTO_REJECT" not in RouteAction.__members__
    assert len(RouteAction) == 4
