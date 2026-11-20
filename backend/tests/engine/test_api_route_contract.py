"""Route-surface contract for the two API modules Agent EN owns.

``app/api/v1/admin_rules.py`` and ``app/api/v1/eval.py`` cannot be imported until BE's
``app.db`` / ``app.models`` / ``app.security.*`` / ``app.jobs.queue`` / ``app.notify``
land at S1. :mod:`be_stubs` supplies stand-ins so the *surface* — path, method, status
code, role dependency — is locked against docs/05 §3.7 and §3.9 today, and keeps being
checked after the merge.
"""

from __future__ import annotations

from collections.abc import Iterator
from typing import Any, get_type_hints

import be_stubs
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


@pytest.fixture
def api_modules(monkeypatch: pytest.MonkeyPatch) -> Iterator[tuple[Any, Any]]:
    """Import both API modules against stubbed BE helpers."""
    be_stubs.install(monkeypatch)
    from app.api.v1 import admin_rules
    from app.api.v1 import eval as eval_module

    yield admin_rules, eval_module


def _surface(router: Any) -> set[tuple[str, str, int]]:
    return {
        (method, route.path, route.status_code or 200)
        for route in router.routes
        for method in route.methods - {"HEAD", "OPTIONS"}
    }


def _roles_of(endpoint: Any) -> tuple[str, ...]:
    """Read the roles baked into the endpoint's ``require_roles`` dependency."""
    hints = get_type_hints(endpoint, include_extras=True)
    for annotation in hints.values():
        for item in getattr(annotation, "__metadata__", ()):
            roles = getattr(getattr(item, "dependency", None), "roles", None)
            if roles is not None:
                return tuple(roles)
    raise AssertionError(f"no role dependency on {endpoint.__name__}")


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
    for name, expected in (
        ("list_rule_versions", ("ADMIN", "AUDITOR")),
        ("create_rule_draft", ("ADMIN",)),
        ("update_rule_draft", ("ADMIN",)),
        ("validate_rule_version", ("ADMIN",)),
        ("simulate_rule_version", ("ADMIN",)),
        ("publish_rule_version", ("ADMIN",)),
    ):
        roles = _roles_of(by_name[name].dependant.call)
        assert roles == expected, f"{name} roles {roles} != {expected}"


def test_eval_dashboard_is_readable_by_admin_auditor_officer(
    api_modules: tuple[Any, Any],
) -> None:
    _, eval_module = api_modules
    route = next(iter(eval_module.router.routes))
    assert _roles_of(route.dependant.call) == ("ADMIN", "AUDITOR", "OFFICER")


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


def test_benchmarks_present_returns_real_metrics(api_modules: tuple[Any, Any]) -> None:
    """docs/07 §8: DPI's measured numbers flow through with ``available=True``."""
    _, eval_module = api_modules
    scam, documents, available = eval_module._benchmarks()

    assert available is True
    assert set(scam) == {
        "test_size",
        "precision",
        "recall",
        "f1",
        "false_positive_rate",
        "hard_negative_fpr",
        "confusion_matrix",
        "live_checks_count",
        "user_disputed_count",
    }
    assert set(documents) == {
        "test_size",
        "genuine_verified_rate",
        "tampered_caught_rate",
        "false_tamper_rate",
        "blurry_retake_rate",
    }

    # Real measurements, not placeholders.
    assert scam["test_size"] > 0
    assert documents["test_size"] > 0
    for key in ("precision", "recall", "f1", "false_positive_rate", "hard_negative_fpr"):
        assert 0.0 <= scam[key] <= 1.0, key
    for key in (
        "genuine_verified_rate",
        "tampered_caught_rate",
        "false_tamper_rate",
        "blurry_retake_rate",
    ):
        assert 0.0 <= documents[key] <= 1.0, key
    assert len(scam["confusion_matrix"]) == 2
    assert all(len(row) == 2 for row in scam["confusion_matrix"])


def test_benchmarks_absent_is_reported_not_faked(
    api_modules: tuple[Any, Any], monkeypatch: pytest.MonkeyPatch
) -> None:
    """docs/07 §8: a missing DPI module must not invent numbers.

    The seam is ``_import_benchmarks`` — patching ``sys.modules`` for a module that now
    exists would not block the import the endpoint actually performs.
    """

    def _unavailable() -> Any:
        raise ImportError("app.ai.benchmarks not merged")

    _, eval_module = api_modules
    monkeypatch.setattr(eval_module, "_import_benchmarks", _unavailable)
    assert eval_module._benchmarks() == ({}, {}, False)


def test_doc_metrics_are_cached_between_requests(
    api_modules: tuple[Any, Any], monkeypatch: pytest.MonkeyPatch
) -> None:
    """``doc_metrics()`` re-verifies 30 images (~2 s); the dashboard must not pay per load."""
    _, eval_module = api_modules
    calls: list[int] = []

    class _FakeBenchmarks:
        @staticmethod
        def doc_metrics() -> dict[str, Any]:
            calls.append(1)
            return {
                "test_size": 30,
                "genuine_verified_rate": 1.0,
                "tampered_caught_rate": 1.0,
                "false_tamper_rate": 0.0,
                "blurry_retake_rate": 1.0,
            }

    monkeypatch.setattr(eval_module, "_doc_metrics_cache", None)
    first = eval_module._doc_metrics(_FakeBenchmarks)
    second = eval_module._doc_metrics(_FakeBenchmarks)
    assert first == second
    assert len(calls) == 1, "the second call must come from the cache"

    # A returned dict is a copy: mutating it must not poison the cache.
    first["test_size"] = 0
    assert eval_module._doc_metrics(_FakeBenchmarks)["test_size"] == 30


def test_doc_metrics_cache_expires(
    api_modules: tuple[Any, Any], monkeypatch: pytest.MonkeyPatch
) -> None:
    _, eval_module = api_modules
    calls: list[int] = []

    class _FakeBenchmarks:
        @staticmethod
        def doc_metrics() -> dict[str, Any]:
            calls.append(1)
            return {"test_size": len(calls)}

    monkeypatch.setattr(eval_module, "_doc_metrics_cache", None)
    monkeypatch.setattr(eval_module, "DOC_METRICS_TTL_SECONDS", 0.0)
    eval_module._doc_metrics(_FakeBenchmarks)
    eval_module._doc_metrics(_FakeBenchmarks)
    assert len(calls) == 2, "a zero TTL must re-measure every time"


# -- invariants that must survive the takeover ---------------------------
def test_route_action_still_has_no_auto_reject(api_modules: tuple[Any, Any]) -> None:
    assert "AUTO_REJECT" not in RouteAction.__members__
    assert len(RouteAction) == 4
