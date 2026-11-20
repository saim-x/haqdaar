"""Rules DSL schema and validator (docs/06 §2.1-§2.2)."""

from __future__ import annotations

import copy
from typing import Any

import pytest
from app.engine.rules_dsl import (
    BenefitFormula,
    CostMatrix,
    Policy,
    RuleAction,
    RuleOperator,
    RuleSetSchema,
    validate_rules_json,
)
from pydantic import ValidationError


def _codes(report_errors: tuple[dict[str, str], ...]) -> set[str]:
    return {error["code"] for error in report_errors}


def test_sahara_v1_validates(sahara_v1: RuleSetSchema) -> None:
    assert sahara_v1.program_code == "SAHARA_WIDOW_GRANT"
    assert len(sahara_v1.eligibility_rules) == 9
    assert sahara_v1.policy.auto_approve_confidence_threshold == 0.90
    assert sahara_v1.policy.cost_matrix.wrong_approval_cost == 100


def test_operator_set_is_exactly_the_frozen_eight() -> None:
    assert {op.value for op in RuleOperator} == {
        "eq",
        "neq",
        "gt",
        "gte",
        "lt",
        "lte",
        "in",
        "not_in",
    }


def test_rule_actions_are_only_human_or_ask() -> None:
    assert {action.value for action in RuleAction} == {"HUMAN", "ASK"}


@pytest.mark.parametrize("threshold", [0.50, 0.90, 0.99])
def test_threshold_accepts_the_closed_range(
    sahara_v1_json: dict[str, Any], threshold: float
) -> None:
    sahara_v1_json["policy"]["auto_approve_confidence_threshold"] = threshold
    assert (
        RuleSetSchema.model_validate(sahara_v1_json).policy.auto_approve_confidence_threshold
        == threshold
    )


@pytest.mark.parametrize("threshold", [0.49, 0.30, 1.0, 1.5])
def test_threshold_outside_range_is_rejected(
    sahara_v1_json: dict[str, Any], threshold: float
) -> None:
    sahara_v1_json["policy"]["auto_approve_confidence_threshold"] = threshold
    report = validate_rules_json(sahara_v1_json)
    assert report.valid is False
    assert "THRESHOLD_OUT_OF_RANGE" in _codes(report.errors)


def test_unknown_fact_key_is_rejected(sahara_v1_json: dict[str, Any]) -> None:
    sahara_v1_json["eligibility_rules"][0]["fact"] = "monthly_salary_pkr"
    report = validate_rules_json(sahara_v1_json)
    assert report.valid is False
    assert "FACT_UNKNOWN" in _codes(report.errors)
    assert "monthly_salary_pkr" in report.errors[0]["message_en"]


def test_unknown_operator_is_rejected(sahara_v1_json: dict[str, Any]) -> None:
    sahara_v1_json["eligibility_rules"][0]["op"] = "contains"
    report = validate_rules_json(sahara_v1_json)
    assert report.valid is False
    assert "SCHEMA_INVALID" in _codes(report.errors)


def test_value_type_must_match_the_fact(sahara_v1_json: dict[str, Any]) -> None:
    sahara_v1_json["eligibility_rules"][4]["value"] = "40000"
    report = validate_rules_json(sahara_v1_json)
    assert report.valid is False
    assert "VALUE_TYPE_MISMATCH" in _codes(report.errors)


def test_membership_operator_requires_a_list(sahara_v1_json: dict[str, Any]) -> None:
    sahara_v1_json["eligibility_rules"][6]["value"] = "Thatta"
    report = validate_rules_json(sahara_v1_json)
    assert report.valid is False
    assert "VALUE_TYPE_MISMATCH" in _codes(report.errors)


def test_membership_list_items_must_match_the_fact_type(
    sahara_v1_json: dict[str, Any],
) -> None:
    sahara_v1_json["eligibility_rules"][6]["value"] = ["Thatta", 7]
    report = validate_rules_json(sahara_v1_json)
    assert report.valid is False
    assert "VALUE_TYPE_MISMATCH" in _codes(report.errors)


def test_ordering_operator_rejects_bool_fact(sahara_v1_json: dict[str, Any]) -> None:
    sahara_v1_json["eligibility_rules"][0]["op"] = "gt"
    report = validate_rules_json(sahara_v1_json)
    assert report.valid is False
    assert "OP_INVALID" in _codes(report.errors)


@pytest.mark.parametrize(
    "field",
    [
        "label_en",
        "label_ur",
        "pass_reason_en",
        "pass_reason_ur",
        "fail_reason_en",
        "fail_reason_ur",
    ],
)
def test_bilingual_strings_are_mandatory(
    sahara_v1_json: dict[str, Any], field: str
) -> None:
    sahara_v1_json["eligibility_rules"][0][field] = "   "
    report = validate_rules_json(sahara_v1_json)
    assert report.valid is False
    assert "BILINGUAL_EMPTY" in _codes(report.errors)


def test_ask_prompt_is_mandatory_when_the_rule_asks(
    sahara_v1_json: dict[str, Any],
) -> None:
    sahara_v1_json["eligibility_rules"][1]["ask_prompt_en"] = None
    report = validate_rules_json(sahara_v1_json)
    assert report.valid is False
    assert "ASK_PROMPT_MISSING" in _codes(report.errors)


def test_ask_prompt_is_optional_when_the_rule_never_asks(
    sahara_v1_json: dict[str, Any],
) -> None:
    rule = sahara_v1_json["eligibility_rules"][0]
    assert rule["on_fail"] == "HUMAN" and rule["on_unknown"] == "HUMAN"
    assert rule["ask_prompt_en"] is None
    assert validate_rules_json(sahara_v1_json).valid is True


def test_duplicate_rule_ids_are_rejected(sahara_v1_json: dict[str, Any]) -> None:
    sahara_v1_json["eligibility_rules"][1]["id"] = "R01_ALIVE"
    report = validate_rules_json(sahara_v1_json)
    assert report.valid is False
    assert "DUPLICATE_RULE_ID" in _codes(report.errors)


def test_empty_rule_list_is_rejected(sahara_v1_json: dict[str, Any]) -> None:
    sahara_v1_json["eligibility_rules"] = []
    assert validate_rules_json(sahara_v1_json).valid is False


def test_benefit_cap_below_base_is_rejected(sahara_v1_json: dict[str, Any]) -> None:
    sahara_v1_json["benefit_formula"]["hard_cap_pkr"] = 5000
    report = validate_rules_json(sahara_v1_json)
    assert report.valid is False
    assert "BENEFIT_FORMULA_INVALID" in _codes(report.errors)


def test_validation_errors_carry_bilingual_messages(
    sahara_v1_json: dict[str, Any],
) -> None:
    sahara_v1_json["eligibility_rules"][0]["fact"] = "nope"
    report = validate_rules_json(sahara_v1_json)
    error = report.errors[0]
    assert set(error) == {"path", "code", "message_en", "message_ur"}
    assert error["message_ur"].strip()
    assert error["path"].startswith("eligibility_rules.0")


def test_content_hash_is_stable_and_sensitive(sahara_v1: RuleSetSchema) -> None:
    same = RuleSetSchema.model_validate(sahara_v1.model_dump(mode="json"))
    assert same.content_hash() == sahara_v1.content_hash()
    assert len(sahara_v1.content_hash()) == 64

    changed = sahara_v1.with_threshold(0.85)
    assert changed.content_hash() != sahara_v1.content_hash()


def test_with_threshold_changes_only_the_threshold(sahara_v1: RuleSetSchema) -> None:
    changed = sahara_v1.with_threshold(0.75)
    assert changed.policy.auto_approve_confidence_threshold == 0.75
    assert changed.policy.auto_approve_max_amount_pkr == 20000
    assert changed.eligibility_rules == sahara_v1.eligibility_rules
    assert changed.benefit_formula == sahara_v1.benefit_formula


def test_ruleset_is_immutable(sahara_v1: RuleSetSchema) -> None:
    with pytest.raises(ValidationError):
        sahara_v1.program_code = "OTHER"  # type: ignore[misc]


def test_rule_by_id(sahara_v1: RuleSetSchema) -> None:
    assert sahara_v1.rule_by_id("R05_INCOME_CAP") is not None
    assert sahara_v1.rule_by_id("R99_MISSING") is None


def test_policy_defaults_match_the_cost_matrix_contract() -> None:
    policy = Policy(auto_approve_confidence_threshold=0.9, auto_approve_max_amount_pkr=20000)
    assert policy.max_ask_more_rounds == 2
    assert policy.cost_matrix == CostMatrix(
        wrong_approval_cost=100,
        unnecessary_human_review_cost=8,
        ask_more_cost=5,
        missed_fraud_multiplier=1.5,
    )


def test_benefit_formula_rejects_negative_amounts() -> None:
    with pytest.raises(ValidationError):
        BenefitFormula(
            base_amount_pkr=-1,
            per_child_bonus_pkr=1000,
            max_children_counted=5,
            hard_cap_pkr=20000,
        )


def test_validator_does_not_mutate_its_input(sahara_v1_json: dict[str, Any]) -> None:
    before = copy.deepcopy(sahara_v1_json)
    validate_rules_json(sahara_v1_json)
    assert sahara_v1_json == before
