"""Cost-of-being-wrong threshold sweep (Challenge 01, docs/06 §3.3, docs/07 §8)."""

from __future__ import annotations

import copy
import json

import pytest
from app.engine.confidence import ConfidenceComponents
from app.engine.eval_sweep import (
    DEFAULT_THRESHOLDS,
    LabelledCase,
    SweepPoint,
    dashboard_payload,
    find_knee,
    load_labelled_cases,
    sweep,
)
from app.engine.facts import FactBundle, FactState
from app.engine.rules_dsl import RuleSetSchema

#: 18 cases. Every case passes every rule, so the route depends only on confidence.
#: ``truly_eligible`` is ground truth the engine cannot see — that is the whole point.
ELIGIBLE_CONFIDENCES = (0.99, 0.97, 0.95, 0.93, 0.91, 0.90, 0.88, 0.85, 0.80, 0.75, 0.70, 0.60)
INELIGIBLE_CONFIDENCES = (0.89, 0.86, 0.82, 0.78, 0.72, 0.65)


def _confidence(value: float) -> ConfidenceComponents:
    return ConfidenceComponents(
        identity=value,
        documents=value,
        data_consistency=value,
        consent_assurance=value,
        overall=value,
    )


def _labelled(
    case_id: str, facts: FactBundle, confidence: float, *, eligible: bool
) -> LabelledCase:
    return LabelledCase(
        case_id=case_id,
        facts=facts,
        truly_eligible=eligible,
        confidence=_confidence(confidence),
    )


@pytest.fixture()
def labelled_cases(fatima_facts: FactBundle) -> list[LabelledCase]:
    cases = [
        _labelled(f"E{index}", fatima_facts, value, eligible=True)
        for index, value in enumerate(ELIGIBLE_CONFIDENCES)
    ]
    cases += [
        _labelled(f"I{index}", fatima_facts, value, eligible=False)
        for index, value in enumerate(INELIGIBLE_CONFIDENCES)
    ]
    return cases


def test_default_grid_matches_the_spec() -> None:
    assert DEFAULT_THRESHOLDS == (0.50, 0.55, 0.60, 0.65, 0.70, 0.75, 0.80, 0.85, 0.90, 0.95)


def test_sweep_emits_one_point_per_threshold(
    labelled_cases: list[LabelledCase], sahara_v1: RuleSetSchema
) -> None:
    result = sweep(labelled_cases, sahara_v1)
    assert len(result.points) == len(DEFAULT_THRESHOLDS)
    assert result.sample_size == 18
    assert [point.threshold for point in result.points] == list(DEFAULT_THRESHOLDS)


def test_sweep_finds_the_090_knee(
    labelled_cases: list[LabelledCase], sahara_v1: RuleSetSchema
) -> None:
    result = sweep(labelled_cases, sahara_v1)
    assert result.knee_threshold == 0.90
    costs = {point.threshold: point.expected_cost for point in result.points}
    assert costs[0.90] == 96.0
    assert costs[0.95] == 120.0
    assert costs[0.50] == 600.0
    assert min(costs.values()) == costs[0.90]
    assert sum(1 for cost in costs.values() if cost == costs[0.90]) == 1


def test_knee_point_metrics(
    labelled_cases: list[LabelledCase], sahara_v1: RuleSetSchema
) -> None:
    point = sweep(labelled_cases, sahara_v1).point_at(0.90)
    assert point is not None
    assert point.auto_approved_count == 6
    assert point.false_approval_count == 0
    assert point.human_review_count == 12
    assert point.ask_more_count == 0
    assert point.auto_approve_rate == pytest.approx(6 / 18, abs=1e-4)
    assert point.false_approval_rate == 0.0
    assert point.human_review_rate == pytest.approx(12 / 18, abs=1e-4)
    assert point.expected_total_cost == point.expected_cost


def test_low_threshold_buys_wrong_approvals(
    labelled_cases: list[LabelledCase], sahara_v1: RuleSetSchema
) -> None:
    point = sweep(labelled_cases, sahara_v1).point_at(0.50)
    assert point is not None
    assert point.auto_approved_count == 18
    assert point.false_approval_count == 6
    assert point.false_approval_rate == pytest.approx(6 / 18, abs=1e-4)
    assert point.human_review_count == 0
    assert point.expected_cost == 600.0


def test_raising_the_threshold_trades_recall_for_safety(
    labelled_cases: list[LabelledCase], sahara_v1: RuleSetSchema
) -> None:
    result = sweep(labelled_cases, sahara_v1)
    auto_rates = [point.auto_approve_rate for point in result.points]
    assert auto_rates == sorted(auto_rates, reverse=True)
    assert result.point_at(0.95).false_approval_count == 0  # type: ignore[union-attr]


def test_active_threshold_defaults_to_the_ruleset_policy(
    labelled_cases: list[LabelledCase], sahara_v1: RuleSetSchema
) -> None:
    assert sweep(labelled_cases, sahara_v1).active_threshold == 0.90


def test_active_threshold_can_be_overridden(
    labelled_cases: list[LabelledCase], sahara_v1: RuleSetSchema
) -> None:
    result = sweep(labelled_cases, sahara_v1, active_threshold=0.95)
    assert result.active_threshold == 0.95
    assert result.knee_threshold == 0.90


def test_sweep_does_not_mutate_the_ruleset(
    labelled_cases: list[LabelledCase], sahara_v1: RuleSetSchema
) -> None:
    before = copy.deepcopy(sahara_v1.model_dump())
    sweep(labelled_cases, sahara_v1)
    assert sahara_v1.model_dump() == before
    assert sahara_v1.policy.auto_approve_confidence_threshold == 0.90


def test_sweep_is_deterministic(
    labelled_cases: list[LabelledCase], sahara_v1: RuleSetSchema
) -> None:
    first = sweep(labelled_cases, sahara_v1)
    second = sweep(labelled_cases, sahara_v1)
    assert first.model_dump() == second.model_dump()


def test_custom_threshold_grid(
    labelled_cases: list[LabelledCase], sahara_v1: RuleSetSchema
) -> None:
    result = sweep(labelled_cases, sahara_v1, thresholds=(0.90,))
    assert len(result.points) == 1
    assert result.knee_threshold == 0.90


def test_empty_dataset_is_safe(sahara_v1: RuleSetSchema) -> None:
    result = sweep([], sahara_v1)
    assert result.sample_size == 0
    assert all(point.expected_cost == 0.0 for point in result.points)
    assert all(point.auto_approve_rate == 0.0 for point in result.points)


def test_find_knee_prefers_the_conservative_threshold_on_a_tie() -> None:
    points = [
        SweepPoint(
            threshold=0.80,
            auto_approved_count=1,
            false_approval_count=0,
            human_review_count=0,
            ask_more_count=0,
            auto_approve_rate=1.0,
            false_approval_rate=0.0,
            human_review_rate=0.0,
            expected_cost=50.0,
        ),
        SweepPoint(
            threshold=0.90,
            auto_approved_count=1,
            false_approval_count=0,
            human_review_count=0,
            ask_more_count=0,
            auto_approve_rate=1.0,
            false_approval_rate=0.0,
            human_review_rate=0.0,
            expected_cost=50.0,
        ),
    ]
    assert find_knee(points) == 0.90


def test_find_knee_on_empty_input() -> None:
    assert find_knee([]) == 0.0


def test_dashboard_payload_shape(
    labelled_cases: list[LabelledCase], sahara_v1: RuleSetSchema
) -> None:
    payload = dashboard_payload(sweep(labelled_cases, sahara_v1))
    assert set(payload) == {
        "decision_router_sweep",
        "active_threshold",
        "knee_threshold",
        "sample_size",
    }
    assert payload["active_threshold"] == 0.90
    assert payload["knee_threshold"] == 0.90
    assert payload["sample_size"] == 18
    assert len(payload["decision_router_sweep"]) == 10
    for point in payload["decision_router_sweep"]:
        assert set(point) == {
            "threshold",
            "auto_approve_rate",
            "false_approval_rate",
            "human_review_rate",
            "expected_cost",
        }
    json.dumps(payload)  # must be JSON-serialisable for the API


def test_labelled_case_from_record_with_plain_values() -> None:
    case = LabelledCase.from_record(
        {
            "case_id": "eval-001",
            "truly_eligible": True,
            "facts": {"monthly_income_pkr": 28000, "applicant_district": "Thatta"},
            "identity_confidence": 0.98,
        }
    )
    assert case.case_id == "eval-001"
    assert case.truly_eligible is True
    assert case.facts.facts["monthly_income_pkr"].state is FactState.KNOWN
    assert case.facts.facts["monthly_income_pkr"].value == 28000
    assert 0.0 <= case.confidence.overall <= 1.0


def test_labelled_case_from_record_ignores_unknown_fact_keys() -> None:
    case = LabelledCase.from_record(
        {
            "case_id": "eval-002",
            "truly_eligible": False,
            "facts": {"not_a_real_fact": 1, "applicant_district": "Thatta"},
            "identity_confidence": 0.5,
        }
    )
    assert "not_a_real_fact" not in case.facts.facts
    assert "applicant_district" in case.facts.facts


def test_labelled_case_from_record_accepts_full_fact_objects(
    fatima_facts: FactBundle,
) -> None:
    record = {
        "case_id": "eval-003",
        "truly_eligible": True,
        "facts": {
            key: fact.model_dump() for key, fact in fatima_facts.facts.items()
        },
        "confidence_components": _confidence(0.95).model_dump(),
    }
    case = LabelledCase.from_record(record)
    assert case.facts.snapshot_hash() == fatima_facts.snapshot_hash()
    assert case.confidence.overall == 0.95


def test_load_labelled_cases_reads_jsonl(
    tmp_path, fatima_facts: FactBundle, sahara_v1: RuleSetSchema
) -> None:
    path = tmp_path / "eval_cases.jsonl"
    records = [
        {
            "case_id": f"eval-{index}",
            "truly_eligible": index % 2 == 0,
            "facts": {"monthly_income_pkr": 28000, "applicant_district": "Thatta"},
            "confidence_components": _confidence(0.95).model_dump(),
        }
        for index in range(3)
    ]
    path.write_text(
        "\n".join(json.dumps(record) for record in records) + "\n\n", encoding="utf-8"
    )

    cases = load_labelled_cases(path)
    assert len(cases) == 3
    assert [case.case_id for case in cases] == ["eval-0", "eval-1", "eval-2"]
    assert sweep(cases, sahara_v1).sample_size == 3
