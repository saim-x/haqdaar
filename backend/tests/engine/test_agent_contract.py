"""Frozen-interface contract for the case agent (docs/07 §7, docs/14 A2).

``app/agent/case_agent.py`` cannot be imported until BE's modules land at S1, so
:mod:`be_stubs` supplies stand-ins. What is checked here is exactly what other agents
call and what the docs pin:

* the three exported entry points and their keyword-only signatures,
* the nine pipeline steps, in order, with the documented names,
* the outcome → case-status map, which must contain no ``REJECTED`` (never auto-reject),
* the officer re-evaluation guard.
"""

from __future__ import annotations

import ast
import inspect
from collections.abc import Iterator
from typing import Any

import be_stubs
import pytest

#: docs/07 §7 — the nine steps, in order.
EXPECTED_STEPS = (
    "verify_consent",
    "fetch_identity",
    "fetch_civil_death",
    "fetch_household",
    "fetch_benefits",
    "check_documents",
    "run_anomaly_checks",
    "assemble_facts_and_decide",
    "commit_and_dispatch",
)


@pytest.fixture
def agent(monkeypatch: pytest.MonkeyPatch) -> Iterator[Any]:
    be_stubs.install(monkeypatch)
    from app.agent import case_agent

    yield case_agent


# -- exported entry points ----------------------------------------------
def test_run_case_agent_signature_is_pinned(agent: Any) -> None:
    """``run_case_agent(db, case_id, *, correlation_id=None)`` — called by the worker."""
    signature = inspect.signature(agent.run_case_agent)
    parameters = list(signature.parameters.values())
    assert [p.name for p in parameters[:2]] == ["db", "case_id"]
    assert parameters[0].kind is inspect.Parameter.POSITIONAL_OR_KEYWORD
    assert parameters[1].kind is inspect.Parameter.POSITIONAL_OR_KEYWORD
    keyword_only = {p.name: p for p in parameters[2:]}
    assert "correlation_id" in keyword_only
    assert keyword_only["correlation_id"].kind is inspect.Parameter.KEYWORD_ONLY
    assert keyword_only["correlation_id"].default is None


def test_check_complaint_agent_signature_is_pinned(agent: Any) -> None:
    signature = inspect.signature(agent.check_complaint_agent)
    assert [p.name for p in list(signature.parameters.values())[:2]] == [
        "db",
        "case_id",
    ]


def test_reevaluate_case_requires_an_officer(agent: Any) -> None:
    signature = inspect.signature(agent.reevaluate_case)
    parameters = signature.parameters
    assert list(parameters)[:2] == ["db", "case_id"]
    assert parameters["officer_user_id"].kind is inspect.Parameter.KEYWORD_ONLY
    assert parameters["officer_user_id"].default is inspect.Parameter.empty


def test_public_surface_is_exactly_what_other_agents_call(agent: Any) -> None:
    assert set(agent.__all__) == {
        "ExternalServiceUnavailable",
        "MockClient",
        "ReevaluationNotAllowed",
        "check_complaint_agent",
        "reevaluate_case",
        "run_case_agent",
    }


# -- the nine steps ------------------------------------------------------
def test_pipeline_has_the_nine_documented_steps_in_order(agent: Any) -> None:
    assert tuple(name for name, _ in agent._STEPS) == EXPECTED_STEPS
    assert all(callable(step) for _, step in agent._STEPS)


# -- never auto-reject ---------------------------------------------------
def test_outcome_map_never_produces_rejected(agent: Any) -> None:
    """Only an OFFICER can reject (AGENTS.md invariant 2)."""
    assert "REJECTED" not in agent._OUTCOME_TO_STATUS.values()
    assert set(agent._OUTCOME_TO_STATUS) == {
        "APPROVED",
        "NEEDS_INFO",
        "HUMAN_REVIEW",
        "WAITING_EXTERNAL",
    }


# -- officer re-evaluation guard ----------------------------------------
def test_reevaluation_is_refused_while_consent_is_on_hold(agent: Any) -> None:
    assert "ON_HOLD_CONSENT" not in agent._REEVALUABLE_STATUSES
    assert "CLOSED" not in agent._REEVALUABLE_STATUSES
    assert "WITHDRAWN" not in agent._REEVALUABLE_STATUSES


def test_reevaluation_is_allowed_from_every_decided_state(agent: Any) -> None:
    for status in ("HUMAN_REVIEW", "IN_REVIEW", "NEEDS_INFO", "APPROVED", "REJECTED"):
        assert status in agent._REEVALUABLE_STATUSES


def test_reevaluation_refusal_maps_to_invalid_transition(agent: Any) -> None:
    assert agent.ReevaluationNotAllowed.code == "INVALID_TRANSITION"
    assert issubclass(agent.ReevaluationNotAllowed, RuntimeError)


# -- purity boundary -----------------------------------------------------
def test_case_agent_never_imports_the_mock_package(agent: Any) -> None:
    """AGENTS.md invariant 4: DPI services are reachable over HTTP only."""
    for module in (agent, agent.deps):
        assert "app.mocks" not in _imported_modules(module), module.__name__


def _imported_modules(module: Any) -> set[str]:
    """Every module named by an ``import`` / ``from ... import`` in the file."""
    tree = ast.parse(inspect.getsource(module))
    names: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            names.update(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module:
            names.add(node.module)
    return names
