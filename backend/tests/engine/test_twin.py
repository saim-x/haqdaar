"""Digital Twin replay: pure, side-effect free, deterministic (docs/06 §7)."""

from __future__ import annotations

import copy

import pytest
from app.engine.confidence import ConfidenceComponents
from app.engine.facts import FactBundle, FactSource, known_fact
from app.engine.rules_dsl import RuleSetSchema
from app.engine.twin import TwinCase, TwinResult, replay, replay_from_rows


def _confidence(overall: float = 0.95) -> ConfidenceComponents:
    return ConfidenceComponents(
        identity=0.98,
        documents=0.95,
        data_consistency=0.98,
        consent_assurance=1.0,
        overall=overall,
    )


def _case(
    case_id: str,
    facts: FactBundle,
    *,
    reference_code: str = "",
    confidence: float = 0.95,
) -> TwinCase:
    return TwinCase(
        case_id=case_id,
        reference_code=reference_code or f"HQ-2026-{case_id}",
        facts=facts,
        confidence=_confidence(confidence),
    )


def _with_income(fatima_facts: FactBundle, income: int) -> FactBundle:
    return fatima_facts.with_fact(
        "monthly_income_pkr",
        known_fact("monthly_income_pkr", income, source=FactSource.HOUSEHOLD_SURVEY),
    )


@pytest.fixture()
def three_cases(fatima_facts: FactBundle) -> list[TwinCase]:
    return [
        _case("1", _with_income(fatima_facts, 28000)),
        _case("2", _with_income(fatima_facts, 38000)),
        _case("3", _with_income(fatima_facts, 42000)),
    ]


def test_replay_reports_the_sample_size(
    sahara_v1: RuleSetSchema, three_cases: list[TwinCase]
) -> None:
    result = replay(sahara_v1, sahara_v1, three_cases)
    assert result.sample_size == 3


def test_identical_rules_flip_nothing(
    sahara_v1: RuleSetSchema, three_cases: list[TwinCase]
) -> None:
    result = replay(sahara_v1, sahara_v1, three_cases)
    assert result.flipped_count == 0
    assert result.budget_delta_pkr == 0
    assert result.before_counts == result.after_counts


def test_income_cap_drop_flips_the_right_case(
    sahara_v1: RuleSetSchema, three_cases: list[TwinCase]
) -> None:
    candidate = sahara_v1.model_copy(
        update={
            "eligibility_rules": [
                rule.model_copy(update={"value": 35000})
                if rule.id == "R05_INCOME_CAP"
                else rule
                for rule in sahara_v1.eligibility_rules
            ]
        }
    )
    result = replay(sahara_v1, candidate, three_cases)

    assert result.before_counts["APPROVED"] == 2
    assert result.after_counts["APPROVED"] == 1
    assert result.flipped_count == 1
    flip = result.flipped_cases[0]
    assert flip.case_id == "2"
    assert flip.before_route == "AUTO_APPROVE"
    assert flip.after_route == "HUMAN_REVIEW"
    assert flip.primary_reason == "RULE_R05_INCOME_CAP_PASS_TO_FAIL"
    assert result.budget_delta_pkr == -15000


def test_threshold_change_flips_on_confidence(
    sahara_v1: RuleSetSchema, fatima_facts: FactBundle
) -> None:
    cases = [_case("1", fatima_facts, confidence=0.95)]
    candidate = sahara_v1.with_threshold(0.97)
    result = replay(sahara_v1, candidate, cases)
    assert result.flipped_count == 1
    assert result.flipped_cases[0].primary_reason == "THRESHOLD_CHANGED"


def test_benefit_formula_change_moves_the_budget(
    sahara_v1: RuleSetSchema, fatima_facts: FactBundle
) -> None:
    cases = [_case("1", fatima_facts)]
    candidate = sahara_v1.model_copy(
        update={
            "benefit_formula": sahara_v1.benefit_formula.model_copy(
                update={"base_amount_pkr": 10000}
            )
        }
    )
    result = replay(sahara_v1, candidate, cases)
    assert result.flipped_count == 0  # still approved, just a smaller amount
    assert result.budget_delta_pkr == -2000


def test_transition_matrix_counts_every_case(
    sahara_v1: RuleSetSchema, three_cases: list[TwinCase]
) -> None:
    result = replay(sahara_v1, sahara_v1, three_cases)
    assert sum(result.transition_matrix.values()) == 3
    assert result.transition_matrix["APPROVED->APPROVED"] == 2
    assert result.transition_matrix["HUMAN_REVIEW->HUMAN_REVIEW"] == 1


def test_sample_size_caps_the_replay(
    sahara_v1: RuleSetSchema, three_cases: list[TwinCase]
) -> None:
    result = replay(sahara_v1, sahara_v1, three_cases, sample_size=2)
    assert result.sample_size == 2
    assert sum(result.transition_matrix.values()) == 2


def test_replay_is_pure_and_does_not_mutate_inputs(
    sahara_v1: RuleSetSchema, three_cases: list[TwinCase]
) -> None:
    baseline_before = copy.deepcopy(sahara_v1.model_dump())
    cases_before = [copy.deepcopy(case.model_dump()) for case in three_cases]

    replay(sahara_v1, sahara_v1.with_threshold(0.95), three_cases)

    assert sahara_v1.model_dump() == baseline_before
    assert [case.model_dump() for case in three_cases] == cases_before


def test_replay_is_deterministic(
    sahara_v1: RuleSetSchema, three_cases: list[TwinCase]
) -> None:
    candidate = sahara_v1.with_threshold(0.95)
    first = replay(sahara_v1, candidate, three_cases)
    second = replay(sahara_v1, candidate, three_cases)
    assert first.model_dump() == second.model_dump()
    assert first.to_json() == second.to_json()


def test_replay_has_no_side_effect_surface() -> None:
    """The module exposes no writer: replay cannot touch cases, payments or SMS."""
    import app.engine.twin as twin_module

    public = {name for name in dir(twin_module) if not name.startswith("_")}
    for forbidden in ("commit", "save", "send", "notify", "enqueue", "db"):
        assert forbidden not in public


def test_result_carries_both_rule_hashes(
    sahara_v1: RuleSetSchema, three_cases: list[TwinCase]
) -> None:
    candidate = sahara_v1.with_threshold(0.95)
    result = replay(sahara_v1, candidate, three_cases)
    assert result.baseline_content_hash == sahara_v1.content_hash()
    assert result.candidate_content_hash == candidate.content_hash()
    assert result.baseline_content_hash != result.candidate_content_hash


def test_result_json_shape(
    sahara_v1: RuleSetSchema, three_cases: list[TwinCase]
) -> None:
    payload = replay(sahara_v1, sahara_v1, three_cases).to_json()
    assert set(payload) == {
        "sample_size",
        "before_counts",
        "after_counts",
        "transition_matrix",
        "flipped_count",
        "flipped_cases",
        "budget_delta_pkr",
        "baseline_content_hash",
        "candidate_content_hash",
    }
    assert set(payload["before_counts"]) == {"APPROVED", "NEEDS_INFO", "HUMAN_REVIEW"}


def test_flip_json_shape(sahara_v1: RuleSetSchema, three_cases: list[TwinCase]) -> None:
    candidate = sahara_v1.with_threshold(0.99)
    result = replay(sahara_v1, candidate, three_cases)
    assert result.flipped_cases
    payload = result.flipped_cases[0].to_json()
    assert set(payload) == {
        "case_id",
        "reference_code",
        "before_route",
        "after_route",
        "before_amount",
        "after_amount",
        "primary_reason",
    }


def test_from_decision_row_round_trip(
    sahara_v1: RuleSetSchema, fatima_facts: FactBundle
) -> None:
    row = {
        "case_id": "case-1",
        "reference_code": "HQ-2026-000142",
        "input_snapshot_json": fatima_facts.to_snapshot(),
        "flags_json": [],
        "confidence_components": _confidence().to_json(),
        "ask_more_rounds": 0,
    }
    case = TwinCase.from_decision_row(row)
    assert case.case_id == "case-1"
    assert case.facts.snapshot_hash() == fatima_facts.snapshot_hash()
    assert case.confidence.overall == 0.95


def test_replay_from_rows(
    sahara_v1: RuleSetSchema, fatima_facts: FactBundle
) -> None:
    rows = [
        {
            "case_id": f"case-{index}",
            "reference_code": f"HQ-2026-00014{index}",
            "input_snapshot_json": _with_income(fatima_facts, income).to_snapshot(),
            "flags_json": [],
            "confidence_components": _confidence().to_json(),
            "ask_more_rounds": 0,
        }
        for index, income in enumerate((28000, 38000))
    ]
    candidate = sahara_v1.model_copy(
        update={
            "eligibility_rules": [
                rule.model_copy(update={"value": 35000})
                if rule.id == "R05_INCOME_CAP"
                else rule
                for rule in sahara_v1.eligibility_rules
            ]
        }
    )
    result = replay_from_rows(sahara_v1, candidate, rows)
    assert isinstance(result, TwinResult)
    assert result.flipped_count == 1


def test_empty_sample_is_safe(sahara_v1: RuleSetSchema) -> None:
    result = replay(sahara_v1, sahara_v1, [])
    assert result.sample_size == 0
    assert result.flipped_count == 0
    assert result.budget_delta_pkr == 0
    assert result.before_counts == {"APPROVED": 0, "NEEDS_INFO": 0, "HUMAN_REVIEW": 0}
