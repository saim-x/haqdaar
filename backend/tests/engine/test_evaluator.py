"""Tri-state Kleene evaluation and the benefit formula (docs/06 §2.3-§2.4)."""

from __future__ import annotations

import pytest
from app.engine.evaluator import (
    RuleResult,
    compute_benefit,
    evaluate_rule,
    evaluate_ruleset,
)
from app.engine.facts import (
    EnteredBy,
    Fact,
    FactBundle,
    FactSource,
    FactState,
    MissingReason,
    known_fact,
    unknown_fact,
)
from app.engine.rules_dsl import (
    EligibilityRule,
    RuleAction,
    RuleOperator,
    RuleSetSchema,
)


def _rule(**overrides: object) -> EligibilityRule:
    payload = {
        "id": "R_TEST",
        "fact": "monthly_income_pkr",
        "op": "lte",
        "value": 40000,
        "on_fail": "HUMAN",
        "on_unknown": "ASK",
        "required_for_auto": True,
        "label_en": "Income cap",
        "label_ur": "آمدنی کی حد",
        "pass_reason_en": "Within limit.",
        "pass_reason_ur": "حد کے اندر۔",
        "fail_reason_en": "Above limit.",
        "fail_reason_ur": "حد سے زیادہ۔",
        "ask_prompt_en": "What is your income?",
        "ask_prompt_ur": "آپ کی آمدنی کتنی ہے؟",
    }
    payload.update(overrides)
    return EligibilityRule.model_validate(payload)


def _bundle(key: str, value: object) -> FactBundle:
    if value is None:
        return FactBundle(facts={key: unknown_fact(key)})
    return FactBundle(facts={key: known_fact(key, value, source=FactSource.SELF_DECLARED)})  # type: ignore[arg-type]


# -- tri-state -----------------------------------------------------------
def test_unknown_income_is_never_evaluated_as_lte() -> None:
    """docs/13 §2.2: UNKNOWN must not become PASS or FAIL."""
    trace = evaluate_rule(_rule(), unknown_fact("monthly_income_pkr"))
    assert trace.result is RuleResult.UNKNOWN
    assert trace.actual is None
    assert trace.fact_state is FactState.UNKNOWN


def test_missing_fact_is_unknown_not_a_default() -> None:
    trace = evaluate_rule(_rule(), None)
    assert trace.result is RuleResult.UNKNOWN


def test_unknown_income_never_passes_the_cap() -> None:
    bundle = FactBundle(
        facts={
            "monthly_income_pkr": unknown_fact(
                "monthly_income_pkr", missing_reason=MissingReason.USER_UNKNOWN
            )
        }
    )
    ruleset = RuleSetSchema.model_validate(
        {
            "program_code": "T",
            "policy": {
                "auto_approve_confidence_threshold": 0.9,
                "auto_approve_max_amount_pkr": 20000,
            },
            "eligibility_rules": [_rule().model_dump(mode="json")],
            "benefit_formula": {
                "base_amount_pkr": 12000,
                "per_child_bonus_pkr": 1000,
                "max_children_counted": 5,
                "hard_cap_pkr": 20000,
            },
        }
    )
    result = evaluate_ruleset(ruleset, bundle)
    assert result.rules[0].result is RuleResult.UNKNOWN
    assert result.all_pass is False
    assert result.has_unknown is True


def test_unknown_uses_the_ask_prompt_as_its_reason() -> None:
    trace = evaluate_rule(_rule(), unknown_fact("monthly_income_pkr"))
    assert trace.reason_en == "What is your income?"
    assert trace.reason_ur == "آپ کی آمدنی کتنی ہے؟"


def test_unknown_with_human_action_uses_the_fail_reason() -> None:
    trace = evaluate_rule(
        _rule(on_unknown="HUMAN"), unknown_fact("monthly_income_pkr")
    )
    assert trace.result is RuleResult.UNKNOWN
    assert trace.reason_en == "Above limit."


# -- operators -----------------------------------------------------------
@pytest.mark.parametrize(
    ("op", "value", "actual", "expected"),
    [
        ("eq", 28000, 28000, RuleResult.PASS),
        ("eq", 28000, 29000, RuleResult.FAIL),
        ("neq", 28000, 29000, RuleResult.PASS),
        ("neq", 28000, 28000, RuleResult.FAIL),
        ("gt", 20000, 28000, RuleResult.PASS),
        ("gt", 28000, 28000, RuleResult.FAIL),
        ("gte", 28000, 28000, RuleResult.PASS),
        ("lt", 30000, 28000, RuleResult.PASS),
        ("lt", 28000, 28000, RuleResult.FAIL),
        ("lte", 28000, 28000, RuleResult.PASS),
        ("lte", 27000, 28000, RuleResult.FAIL),
        ("in", [20000, 28000], 28000, RuleResult.PASS),
        ("in", [20000, 30000], 28000, RuleResult.FAIL),
        ("not_in", [20000, 30000], 28000, RuleResult.PASS),
        ("not_in", [20000, 28000], 28000, RuleResult.FAIL),
    ],
)
def test_every_operator(op: str, value: object, actual: int, expected: RuleResult) -> None:
    trace = evaluate_rule(
        _rule(op=op, value=value),
        known_fact("monthly_income_pkr", actual, source=FactSource.SELF_DECLARED),
    )
    assert trace.result is expected


def test_string_membership_is_case_and_space_insensitive() -> None:
    rule = _rule(
        fact="applicant_district",
        op="in",
        value=["Thatta", "Badin"],
        on_fail="HUMAN",
        on_unknown="ASK",
    )
    for spelling in ("Thatta", "thatta", "  THATTA  "):
        trace = evaluate_rule(
            rule,
            known_fact("applicant_district", spelling, source=FactSource.SELF_DECLARED),
        )
        assert trace.result is RuleResult.PASS, spelling


def test_string_equality_is_case_insensitive() -> None:
    rule = _rule(fact="applicant_district", op="eq", value="Thatta")
    trace = evaluate_rule(
        rule, known_fact("applicant_district", "thatta", source=FactSource.SELF_DECLARED)
    )
    assert trace.result is RuleResult.PASS


def test_iso_date_ordering_works_lexicographically() -> None:
    rule = _rule(fact="applicant_dob", op="gte", value="1950-01-01")
    trace = evaluate_rule(
        rule,
        known_fact("applicant_dob", "1974-05-14", source=FactSource.IDENTITY_REGISTRY),
    )
    assert trace.result is RuleResult.PASS


# -- trace shape ---------------------------------------------------------
def test_trace_records_actual_expected_and_source(sahara_v1: RuleSetSchema) -> None:
    bundle = FactBundle(
        facts={
            "monthly_income_pkr": known_fact(
                "monthly_income_pkr", 55000, source=FactSource.HOUSEHOLD_SURVEY
            )
        }
    )
    result = evaluate_ruleset(sahara_v1, bundle)
    trace = next(t for t in result.rules if t.rule_id == "R05_INCOME_CAP")
    assert trace.result is RuleResult.FAIL
    assert trace.actual == 55000
    assert trace.expected == 40000
    assert trace.source is FactSource.HOUSEHOLD_SURVEY
    assert trace.reason_en.startswith("Recorded income exceeds")


def test_trace_json_shape_matches_decisions_column(sahara_v1: RuleSetSchema) -> None:
    result = evaluate_ruleset(sahara_v1, FactBundle(facts={}))
    payload = result.trace_json()
    assert len(payload) == 9
    assert set(payload[0]) == {
        "rule_id",
        "fact",
        "op",
        "result",
        "actual",
        "expected",
        "fact_state",
        "source",
        "reason_en",
        "reason_ur",
    }


def test_partitions_are_disjoint_and_complete(sahara_v1: RuleSetSchema) -> None:
    bundle = FactBundle(
        facts={
            "applicant_is_alive": known_fact(
                "applicant_is_alive", True, source=FactSource.IDENTITY_REGISTRY
            ),
            "monthly_income_pkr": known_fact(
                "monthly_income_pkr", 55000, source=FactSource.HOUSEHOLD_SURVEY
            ),
        }
    )
    result = evaluate_ruleset(sahara_v1, bundle)
    assert len(result.passed) + len(result.failed) + len(result.unknown) == 9
    assert [t.rule_id for t in result.human_fails] == ["R05_INCOME_CAP"]
    assert {t.rule_id for t in result.ask_items} == {
        "R02_CNIC_VALID",
        "R03_AGE_MIN",
        "R04_WIDOW_VERIFIED",
        "R07_DISTRICT_SINDH",
        "R08_CNIC_DOC",
        "R09_CHILDREN_KNOWN",
    }
    assert {t.rule_id for t in result.human_unknowns} == {"R06_NO_CONFLICTING_GRANT"}


# -- benefit formula -----------------------------------------------------
def test_fatima_gets_15000(sahara_v1: RuleSetSchema, fatima_facts: FactBundle) -> None:
    benefit = compute_benefit(sahara_v1.benefit_formula, fatima_facts)
    assert benefit.amount_pkr == 15000
    assert benefit.provisional is False
    assert benefit.children_counted == 3


def test_children_unknown_is_provisional_base_amount(
    sahara_v1: RuleSetSchema, fatima_facts: FactBundle
) -> None:
    bundle = fatima_facts.with_fact(
        "children_under_18", unknown_fact("children_under_18")
    )
    benefit = compute_benefit(sahara_v1.benefit_formula, bundle)
    assert benefit.amount_pkr == 12000
    assert benefit.provisional is True
    assert benefit.children_counted is None
    assert "Provisional" in benefit.note_en


def test_children_are_capped_at_max_counted(
    sahara_v1: RuleSetSchema, fatima_facts: FactBundle
) -> None:
    bundle = fatima_facts.with_fact(
        "children_under_18",
        known_fact("children_under_18", 9, source=FactSource.SELF_DECLARED),
    )
    benefit = compute_benefit(sahara_v1.benefit_formula, bundle)
    assert benefit.children_counted == 5
    assert benefit.amount_pkr == 17000


def test_hard_cap_wins(sahara_v1: RuleSetSchema, fatima_facts: FactBundle) -> None:
    bundle = fatima_facts.with_fact(
        "children_under_18",
        known_fact("children_under_18", 5, source=FactSource.SELF_DECLARED),
    )
    benefit = compute_benefit(sahara_v1.benefit_formula, bundle)
    assert benefit.amount_pkr == 17000
    assert benefit.amount_pkr <= sahara_v1.benefit_formula.hard_cap_pkr


def test_negative_children_never_reduce_the_base(
    sahara_v1: RuleSetSchema, fatima_facts: FactBundle
) -> None:
    bundle = fatima_facts.with_fact(
        "children_under_18",
        known_fact("children_under_18", -3, source=FactSource.SELF_DECLARED),
    )
    benefit = compute_benefit(sahara_v1.benefit_formula, bundle)
    assert benefit.amount_pkr == 12000
    assert benefit.children_counted == 0


def test_zero_children_is_not_provisional(
    sahara_v1: RuleSetSchema, fatima_facts: FactBundle
) -> None:
    bundle = fatima_facts.with_fact(
        "children_under_18",
        known_fact("children_under_18", 0, source=FactSource.SELF_DECLARED),
    )
    benefit = compute_benefit(sahara_v1.benefit_formula, bundle)
    assert benefit.amount_pkr == 12000
    assert benefit.provisional is False


def test_evaluation_is_deterministic(
    sahara_v1: RuleSetSchema, fatima_facts: FactBundle
) -> None:
    first = evaluate_ruleset(sahara_v1, fatima_facts)
    second = evaluate_ruleset(sahara_v1, fatima_facts)
    assert first.model_dump() == second.model_dump()
    assert first.trace_json() == second.trace_json()


def test_rule_actions_are_preserved_on_the_trace(sahara_v1: RuleSetSchema) -> None:
    result = evaluate_ruleset(sahara_v1, FactBundle(facts={}))
    trace = next(t for t in result.rules if t.rule_id == "R01_ALIVE")
    assert trace.on_fail is RuleAction.HUMAN
    assert trace.on_unknown is RuleAction.HUMAN
    assert trace.op is RuleOperator.EQ


def test_fact_entered_by_is_not_lost(fatima_facts: FactBundle) -> None:
    fact: Fact = fatima_facts.require("monthly_income_pkr")
    assert fact.entered_by is EnteredBy.SYSTEM
    assert fatima_facts.require("applicant_district").entered_by is EnteredBy.CITIZEN
