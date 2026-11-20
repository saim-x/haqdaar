"""Deterministic bilingual citizen explanations (docs/06 §8, Challenge 05)."""

from __future__ import annotations

import re

import pytest
from app.engine.anomalies import FLAG_CATALOGUE, FlagCode, RiskFlag
from app.engine.confidence import ConfidenceComponents
from app.engine.evaluator import evaluate_ruleset
from app.engine.explainer import (
    ACCUSATORY_TERMS,
    CitizenExplanation,
    build_explanation,
    contains_accusatory_language,
)
from app.engine.facts import FactBundle, FactSource, known_fact, unknown_fact
from app.engine.router import route_case
from app.engine.rules_dsl import RuleSetSchema

URDU_RE = re.compile(r"[\u0600-\u06ff]")


def _confidence(overall: float = 0.95, consent: float = 1.0) -> ConfidenceComponents:
    return ConfidenceComponents(
        identity=0.98,
        documents=0.95,
        data_consistency=0.98,
        consent_assurance=consent,
        overall=overall,
    )


def _flag(code: FlagCode) -> RiskFlag:
    return RiskFlag(
        code=code,
        severity=FLAG_CATALOGUE[code],
        detail_en=code.value,
        detail_ur=code.value,
    )


def _explain(
    sahara_v1: RuleSetSchema,
    facts: FactBundle,
    *,
    flags: tuple[RiskFlag, ...] = (),
    confidence: ConfidenceComponents | None = None,
    ask_more_rounds: int = 0,
    external_unavailable: bool = False,
) -> CitizenExplanation:
    evaluation = evaluate_ruleset(sahara_v1, facts)
    decision = route_case(
        evaluation,
        confidence or _confidence(),
        flags,
        evaluation.benefit.amount_pkr,
        sahara_v1.policy,
        ask_more_rounds,
        external_unavailable,
        facts=facts,
    )
    return build_explanation(
        decision,
        evaluation,
        evaluation.benefit.amount_pkr,
        provisional=evaluation.benefit.provisional,
    )


# -- approved ------------------------------------------------------------
def test_approved_headline_carries_the_amount(
    sahara_v1: RuleSetSchema, fatima_facts: FactBundle
) -> None:
    explanation = _explain(sahara_v1, fatima_facts)
    assert "15,000" in explanation.headline_en
    assert "15,000" in explanation.headline_ur
    assert "Approved" in explanation.headline_en


def test_approved_lists_at_most_three_reasons(
    sahara_v1: RuleSetSchema, fatima_facts: FactBundle
) -> None:
    explanation = _explain(sahara_v1, fatima_facts)
    assert 1 <= len(explanation.reasons_en) <= 3
    assert len(explanation.reasons_ur) == len(explanation.reasons_en)


def test_approved_next_step_mentions_the_sms_code(
    sahara_v1: RuleSetSchema, fatima_facts: FactBundle
) -> None:
    explanation = _explain(sahara_v1, fatima_facts)
    assert "HQ-" in explanation.next_step_en
    assert "24" in explanation.next_step_en


def test_provisional_amount_is_labelled_estimated(
    sahara_v1: RuleSetSchema, fatima_facts: FactBundle
) -> None:
    bundle = fatima_facts.with_fact(
        "children_under_18", unknown_fact("children_under_18")
    )
    explanation = _explain(sahara_v1, bundle)
    assert "estimated" in explanation.headline_en.lower()
    assert "12,000" in explanation.headline_en


# -- needs info ----------------------------------------------------------
def test_needs_info_uses_the_exact_ask_prompts(
    sahara_v1: RuleSetSchema, fatima_facts: FactBundle
) -> None:
    bundle = fatima_facts.with_fact("applicant_district", unknown_fact("applicant_district"))
    explanation = _explain(sahara_v1, bundle)
    assert "Please select your district." in explanation.reasons_en
    assert "براہ کرم اپنا ضلع منتخب کریں۔" in explanation.reasons_ur
    assert "one more thing" in explanation.headline_en


def test_needs_info_lists_multiple_prompts(
    sahara_v1: RuleSetSchema, fatima_facts: FactBundle
) -> None:
    bundle = fatima_facts.with_fact(
        "applicant_district", unknown_fact("applicant_district")
    ).with_fact("applicant_age_years", unknown_fact("applicant_age_years"))
    explanation = _explain(sahara_v1, bundle)
    assert len(explanation.reasons_en) == 2


# -- human review --------------------------------------------------------
def test_human_review_is_neutral_and_reassuring(
    sahara_v1: RuleSetSchema, fatima_facts: FactBundle
) -> None:
    bundle = fatima_facts.with_fact(
        "monthly_income_pkr",
        known_fact("monthly_income_pkr", 55000, source=FactSource.HOUSEHOLD_SURVEY),
    )
    explanation = _explain(sahara_v1, bundle)
    assert "officer will review" in explanation.headline_en
    assert "2 days" in explanation.headline_en
    assert "do not need to do anything" in explanation.headline_en.lower()


def test_human_review_never_accuses_even_with_tamper_flag(
    sahara_v1: RuleSetSchema, fatima_facts: FactBundle
) -> None:
    """docs/13 §2.6: neutral citizen text while the officer sees the evidence."""
    explanation = _explain(
        sahara_v1, fatima_facts, flags=(_flag(FlagCode.TAMPER_SUSPECTED),)
    )
    assert contains_accusatory_language(explanation) is False
    for term in ACCUSATORY_TERMS:
        assert term.casefold() not in explanation.all_text().casefold()


def test_human_review_never_mentions_the_flag_code(
    sahara_v1: RuleSetSchema, fatima_facts: FactBundle
) -> None:
    explanation = _explain(
        sahara_v1,
        fatima_facts,
        flags=(_flag(FlagCode.PAYOUT_ACCOUNT_SHARED), _flag(FlagCode.IDENTITY_CONFLICT)),
    )
    text = explanation.all_text()
    assert "PAYOUT_ACCOUNT_SHARED" not in text
    assert "IDENTITY_CONFLICT" not in text


def test_human_review_reasons_are_policy_statements(
    sahara_v1: RuleSetSchema, fatima_facts: FactBundle
) -> None:
    bundle = fatima_facts.with_fact(
        "monthly_income_pkr",
        known_fact("monthly_income_pkr", 55000, source=FactSource.HOUSEHOLD_SURVEY),
    )
    explanation = _explain(sahara_v1, bundle)
    assert any("income" in reason.lower() for reason in explanation.reasons_en)


def test_human_review_without_a_failed_rule_still_says_something(
    sahara_v1: RuleSetSchema, fatima_facts: FactBundle
) -> None:
    explanation = _explain(
        sahara_v1, fatima_facts, confidence=_confidence(0.70)
    )
    assert explanation.reasons_en
    assert explanation.reasons_ur


# -- waiting external ----------------------------------------------------
def test_waiting_external_is_reassuring(
    sahara_v1: RuleSetSchema, fatima_facts: FactBundle
) -> None:
    explanation = _explain(sahara_v1, fatima_facts, external_unavailable=True)
    assert "temporarily slow" in explanation.headline_en
    assert "saved everything" in explanation.headline_en
    assert "No action needed" in explanation.next_step_en
    assert explanation.reasons_en == ()


# -- bilingual and shape -------------------------------------------------
@pytest.mark.parametrize("scenario", ["approved", "needs_info", "human", "waiting"])
def test_every_scenario_is_fully_bilingual(
    sahara_v1: RuleSetSchema, fatima_facts: FactBundle, scenario: str
) -> None:
    if scenario == "approved":
        explanation = _explain(sahara_v1, fatima_facts)
    elif scenario == "needs_info":
        explanation = _explain(
            sahara_v1,
            fatima_facts.with_fact("applicant_district", unknown_fact("applicant_district")),
        )
    elif scenario == "human":
        explanation = _explain(sahara_v1, fatima_facts, confidence=_confidence(0.70))
    else:
        explanation = _explain(sahara_v1, fatima_facts, external_unavailable=True)

    assert URDU_RE.search(explanation.headline_ur)
    assert URDU_RE.search(explanation.next_step_ur)
    assert explanation.headline_en.strip()
    assert explanation.next_step_en.strip()
    for reason in explanation.reasons_ur:
        assert URDU_RE.search(reason)


def test_explanation_json_shape_matches_cases_column(
    sahara_v1: RuleSetSchema, fatima_facts: FactBundle
) -> None:
    payload = _explain(sahara_v1, fatima_facts).to_json()
    assert set(payload) == {
        "headline_ur",
        "headline_en",
        "reasons_ur",
        "reasons_en",
        "next_step_ur",
        "next_step_en",
    }
    assert isinstance(payload["reasons_en"], list)


def test_explanation_is_deterministic(
    sahara_v1: RuleSetSchema, fatima_facts: FactBundle
) -> None:
    first = _explain(sahara_v1, fatima_facts)
    second = _explain(sahara_v1, fatima_facts)
    assert first.model_dump() == second.model_dump()


def test_accusatory_guard_detects_a_leak() -> None:
    leaky = CitizenExplanation(
        headline_ur="جعل",
        headline_en="This looks like forgery.",
        reasons_ur=(),
        reasons_en=(),
        next_step_ur="کچھ نہیں",
        next_step_en="Nothing",
    )
    assert contains_accusatory_language(leaky) is True
