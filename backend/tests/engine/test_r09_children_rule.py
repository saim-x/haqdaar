"""ADR-015: R09_CHILDREN_KNOWN — no auto-approval on a provisional amount.

The rule is data, not code: ``children_under_18`` is now referenced by an eligibility
rule, so tri-state exposure forces UNKNOWN children to ASK_MORE and then HUMAN_REVIEW.
A provisional amount stays visible to officers and the AI note, never to the citizen as
a final figure.
"""

from __future__ import annotations

import pytest
from app.engine.evaluator import evaluate_ruleset
from app.engine.facts import FactBundle, FactSource, known_fact, unknown_fact
from app.engine.pipeline import evaluate_and_route
from app.engine.router import CaseOutcome, RouteAction
from app.engine.rules_dsl import RuleSetSchema

RULE_ID = "R09_CHILDREN_KNOWN"


def _with_children(fatima_facts: FactBundle, children: int) -> FactBundle:
    return fatima_facts.with_fact(
        "children_under_18",
        known_fact(
            "children_under_18",
            children,
            source=FactSource.SELF_DECLARED,
            source_confidence=0.95,
        ),
    )


def _unknown_children(fatima_facts: FactBundle) -> FactBundle:
    return fatima_facts.with_fact(
        "children_under_18", unknown_fact("children_under_18")
    )


# -- the rule itself -----------------------------------------------------
def test_rule_is_present_and_shaped_per_adr_015(sahara_v1: RuleSetSchema) -> None:
    rule = next(r for r in sahara_v1.eligibility_rules if r.id == RULE_ID)
    assert rule.fact == "children_under_18"
    assert rule.op.value == "gte"
    assert rule.value == 0
    assert rule.on_fail.value == "HUMAN"
    assert rule.on_unknown.value == "ASK"
    assert rule.required_for_auto is True
    for text in (
        rule.label_en,
        rule.label_ur,
        rule.pass_reason_en,
        rule.pass_reason_ur,
        rule.fail_reason_en,
        rule.fail_reason_ur,
        rule.ask_prompt_en,
        rule.ask_prompt_ur,
    ):
        assert text and text.strip()


def test_rule_is_the_last_rule_in_sahara_v1(sahara_v1: RuleSetSchema) -> None:
    assert sahara_v1.eligibility_rules[-1].id == RULE_ID


# -- UNKNOWN children ----------------------------------------------------
def test_unknown_children_routes_ask_more_on_round_one(
    fatima_facts: FactBundle,
    sahara_v1: RuleSetSchema,
    fatima_documents,
) -> None:
    result = evaluate_and_route(
        _unknown_children(fatima_facts), sahara_v1, identity_confidence=0.98,
        documents=fatima_documents,
    )
    assert result.route.action is RouteAction.ASK_MORE
    assert result.route.outcome is CaseOutcome.NEEDS_INFO
    assert f"ASK_{RULE_ID}" in result.route.reasons
    assert (
        "Please tell us how many children under 18 you have."
        in result.explanation.reasons_en
    )


def test_unknown_children_after_max_rounds_routes_human_review(
    fatima_facts: FactBundle,
    sahara_v1: RuleSetSchema,
    fatima_documents,
) -> None:
    result = evaluate_and_route(
        _unknown_children(fatima_facts),
        sahara_v1,
        identity_confidence=0.98,
        documents=fatima_documents,
        ask_more_rounds=sahara_v1.policy.max_ask_more_rounds,
    )
    assert result.route.action is RouteAction.HUMAN_REVIEW
    assert result.route.outcome is CaseOutcome.HUMAN_REVIEW
    assert "MAX_ASK_ROUNDS_EXCEEDED" in result.route.reasons
    assert f"MISSING_{RULE_ID}" in result.route.reasons


@pytest.mark.parametrize("rounds", [0, 1, 2, 3, 5])
@pytest.mark.parametrize("identity", [0.60, 0.90, 0.99])
def test_unknown_children_never_auto_approves(
    fatima_facts: FactBundle,
    sahara_v1: RuleSetSchema,
    rounds: int,
    identity: float,
    fatima_documents,
) -> None:
    result = evaluate_and_route(
        _unknown_children(fatima_facts),
        sahara_v1,
        identity_confidence=identity,
        documents=fatima_documents,
        ask_more_rounds=rounds,
    )
    assert result.route.action is not RouteAction.AUTO_APPROVE
    assert result.route.outcome is not CaseOutcome.APPROVED


def test_unknown_children_trace_is_unknown_not_zero(
    fatima_facts: FactBundle,
    sahara_v1: RuleSetSchema,
    fatima_documents,
) -> None:
    trace = next(
        item
        for item in evaluate_ruleset(sahara_v1, _unknown_children(fatima_facts)).rules
        if item.rule_id == RULE_ID
    )
    assert trace.result.value == "UNKNOWN"
    assert trace.actual is None


# -- KNOWN children ------------------------------------------------------
@pytest.mark.parametrize(
    ("children", "amount"),
    [(0, 12000), (1, 13000), (3, 15000), (5, 17000), (7, 17000)],
)
def test_known_children_pass_and_amount_is_computed(
    fatima_facts: FactBundle,
    sahara_v1: RuleSetSchema,
    fatima_documents,
    children: int,
    amount: int,
) -> None:
    facts = _with_children(fatima_facts, children)
    evaluation = evaluate_ruleset(sahara_v1, facts)
    trace = next(item for item in evaluation.rules if item.rule_id == RULE_ID)
    assert trace.result.value == "PASS"
    assert evaluation.benefit.amount_pkr == amount
    assert evaluation.benefit.provisional is False

    result = evaluate_and_route(
        facts, sahara_v1, identity_confidence=0.98, documents=fatima_documents
    )
    assert result.route.action is RouteAction.AUTO_APPROVE
    assert result.amount_pkr == amount
    assert result.amount_provisional is False


def test_zero_children_is_known_and_pays_the_base(
    fatima_facts: FactBundle,
    sahara_v1: RuleSetSchema,
    fatima_documents,
) -> None:
    result = evaluate_and_route(
        _with_children(fatima_facts, 0), sahara_v1, identity_confidence=0.98,
        documents=fatima_documents,
    )
    assert result.route.action is RouteAction.AUTO_APPROVE
    assert result.amount_pkr == 12000


def test_negative_children_fails_to_human_review(
    fatima_facts: FactBundle,
    sahara_v1: RuleSetSchema,
    fatima_documents,
) -> None:
    result = evaluate_and_route(
        _with_children(fatima_facts, -1), sahara_v1, identity_confidence=0.98,
        documents=fatima_documents,
    )
    assert result.route.action is RouteAction.HUMAN_REVIEW
    assert f"RULE_FAIL_{RULE_ID}" in result.route.reasons


# -- provisional amounts stay officer-side -------------------------------
def test_provisional_amount_is_visible_to_officers_only(
    fatima_facts: FactBundle,
    sahara_v1: RuleSetSchema,
    fatima_documents,
) -> None:
    result = evaluate_and_route(
        _unknown_children(fatima_facts),
        sahara_v1,
        identity_confidence=0.98,
        documents=fatima_documents,
        ask_more_rounds=sahara_v1.policy.max_ask_more_rounds,
    )
    # Officer / AI-note context: the provisional figure is available and labelled.
    assert result.amount_pkr == 12000
    assert result.amount_provisional is True
    assert result.evaluation.benefit.provisional is True
    assert result.route.handoff is not None
    assert any(RULE_ID in item for item in result.route.handoff.uncertain)
    assert any(
        "children under 18" in item
        for item in result.route.handoff.suggested_checks
    )

    # Citizen context: no amount is quoted at all.
    assert "12,000" not in result.explanation.headline_en
    assert "12,000" not in result.explanation.headline_ur
    assert "12,000" not in " ".join(result.explanation.reasons_en)
    assert "12,000" not in " ".join(result.explanation.reasons_ur)


def test_decision_payload_keeps_the_provisional_flag_for_the_officer(
    fatima_facts: FactBundle,
    sahara_v1: RuleSetSchema,
    fatima_documents,
) -> None:
    result = evaluate_and_route(
        _unknown_children(fatima_facts), sahara_v1, identity_confidence=0.98,
        documents=fatima_documents,
    )
    payload = result.to_decision_payload()
    assert payload["computed_amount_pkr"] == 12000
    assert payload["route_action"] == "ASK_MORE"
    assert payload["outcome_status"] == "NEEDS_INFO"
