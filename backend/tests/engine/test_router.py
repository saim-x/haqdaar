"""Routing order, priority score and handoff note (docs/06 §4.1-§4.3)."""

from __future__ import annotations

import pytest
from app.engine.anomalies import FLAG_CATALOGUE, FlagCode, FlagSeverity, RiskFlag
from app.engine.confidence import ConfidenceComponents
from app.engine.evaluator import EvaluationResult, evaluate_ruleset
from app.engine.facts import FactBundle, FactSource, known_fact, unknown_fact
from app.engine.router import (
    ESCALATION_REASON_CODES,
    CaseOutcome,
    PriorityBand,
    RouteAction,
    compute_priority_score,
    is_known_reason_code,
    priority_band,
    route_case,
)
from app.engine.rules_dsl import Policy, RuleSetSchema


def _flag(code: FlagCode) -> RiskFlag:
    return RiskFlag(
        code=code,
        severity=FLAG_CATALOGUE[code],
        detail_en=code.value,
        detail_ur=code.value,
    )


def _confidence(overall: float = 0.95, consent: float = 1.0) -> ConfidenceComponents:
    return ConfidenceComponents(
        identity=0.98,
        documents=0.95,
        data_consistency=0.98,
        consent_assurance=consent,
        overall=overall,
    )


def _policy(sahara_v1: RuleSetSchema) -> Policy:
    return sahara_v1.policy


# -- the enum ------------------------------------------------------------
def test_auto_reject_does_not_exist() -> None:
    """docs/13 §2.1 — the single most important negative assertion."""
    assert "AUTO_REJECT" not in RouteAction.__members__


def test_route_action_has_exactly_four_members() -> None:
    assert {action.value for action in RouteAction} == {
        "AUTO_APPROVE",
        "ASK_MORE",
        "HUMAN_REVIEW",
        "WAIT_EXTERNAL",
    }
    assert len(RouteAction) == 4


def test_outcomes_match_case_status_values() -> None:
    assert {outcome.value for outcome in CaseOutcome} == {
        "APPROVED",
        "NEEDS_INFO",
        "HUMAN_REVIEW",
        "WAITING_EXTERNAL",
    }


# -- step 8: the happy path ---------------------------------------------
def test_clean_case_auto_approves(
    sahara_v1: RuleSetSchema, fatima_facts: FactBundle
) -> None:
    evaluation = evaluate_ruleset(sahara_v1, fatima_facts)
    decision = route_case(
        evaluation, _confidence(), (), evaluation.benefit.amount_pkr, _policy(sahara_v1)
    )
    assert decision.action is RouteAction.AUTO_APPROVE
    assert decision.outcome is CaseOutcome.APPROVED
    assert decision.reasons == ()
    assert decision.priority_score == 0
    assert decision.priority_band is PriorityBand.NORMAL
    assert decision.handoff is None


# -- step 1: external outage --------------------------------------------
def test_external_outage_never_guesses(
    sahara_v1: RuleSetSchema, fatima_facts: FactBundle
) -> None:
    evaluation = evaluate_ruleset(sahara_v1, fatima_facts)
    decision = route_case(
        evaluation,
        _confidence(),
        (),
        evaluation.benefit.amount_pkr,
        _policy(sahara_v1),
        external_unavailable=True,
    )
    assert decision.action is RouteAction.WAIT_EXTERNAL
    assert decision.outcome is CaseOutcome.WAITING_EXTERNAL
    assert decision.reasons == ("EXTERNAL_SERVICE_UNAVAILABLE",)


def test_external_outage_beats_every_other_signal(
    sahara_v1: RuleSetSchema, fatima_facts: FactBundle
) -> None:
    evaluation = evaluate_ruleset(sahara_v1, fatima_facts)
    decision = route_case(
        evaluation,
        _confidence(0.10),
        (_flag(FlagCode.TAMPER_SUSPECTED),),
        evaluation.benefit.amount_pkr,
        _policy(sahara_v1),
        external_unavailable=True,
    )
    assert decision.action is RouteAction.WAIT_EXTERNAL


# -- step 2: HIGH flags --------------------------------------------------
def test_high_flag_forces_human_review(
    sahara_v1: RuleSetSchema, fatima_facts: FactBundle
) -> None:
    evaluation = evaluate_ruleset(sahara_v1, fatima_facts)
    decision = route_case(
        evaluation,
        _confidence(),
        (_flag(FlagCode.TAMPER_SUSPECTED),),
        evaluation.benefit.amount_pkr,
        _policy(sahara_v1),
    )
    assert decision.action is RouteAction.HUMAN_REVIEW
    assert decision.reasons == ("TAMPER_SUSPECTED",)


def test_high_flag_beats_a_rule_failure(
    sahara_v1: RuleSetSchema, fatima_facts: FactBundle
) -> None:
    bundle = fatima_facts.with_fact(
        "monthly_income_pkr",
        known_fact("monthly_income_pkr", 55000, source=FactSource.HOUSEHOLD_SURVEY),
    )
    evaluation = evaluate_ruleset(sahara_v1, bundle)
    decision = route_case(
        evaluation,
        _confidence(),
        (_flag(FlagCode.DUPLICATE_APPLICATION),),
        evaluation.benefit.amount_pkr,
        _policy(sahara_v1),
    )
    assert decision.reasons == ("DUPLICATE_APPLICATION",)


def test_medium_flag_alone_does_not_force_human_review(
    sahara_v1: RuleSetSchema, fatima_facts: FactBundle
) -> None:
    evaluation = evaluate_ruleset(sahara_v1, fatima_facts)
    decision = route_case(
        evaluation,
        _confidence(),
        (_flag(FlagCode.CNIC_GENDER_MISMATCH),),
        evaluation.benefit.amount_pkr,
        _policy(sahara_v1),
    )
    assert decision.action is RouteAction.AUTO_APPROVE


# -- step 3: rule FAIL with HUMAN ---------------------------------------
def test_human_rule_failure_never_auto_rejects(
    sahara_v1: RuleSetSchema, fatima_facts: FactBundle
) -> None:
    bundle = fatima_facts.with_fact(
        "monthly_income_pkr",
        known_fact("monthly_income_pkr", 55000, source=FactSource.HOUSEHOLD_SURVEY),
    )
    evaluation = evaluate_ruleset(sahara_v1, bundle)
    decision = route_case(
        evaluation, _confidence(), (), evaluation.benefit.amount_pkr, _policy(sahara_v1)
    )
    assert decision.action is RouteAction.HUMAN_REVIEW
    assert decision.outcome is CaseOutcome.HUMAN_REVIEW
    assert decision.reasons == ("RULE_FAIL_R05_INCOME_CAP",)


def test_rule_failure_beats_an_ask_item(
    sahara_v1: RuleSetSchema, fatima_facts: FactBundle
) -> None:
    bundle = fatima_facts.with_fact(
        "monthly_income_pkr",
        known_fact("monthly_income_pkr", 55000, source=FactSource.HOUSEHOLD_SURVEY),
    ).with_fact("applicant_district", unknown_fact("applicant_district"))
    evaluation = evaluate_ruleset(sahara_v1, bundle)
    decision = route_case(
        evaluation, _confidence(), (), evaluation.benefit.amount_pkr, _policy(sahara_v1)
    )
    assert decision.reasons == ("RULE_FAIL_R05_INCOME_CAP",)


# -- step 4: ASK_MORE ----------------------------------------------------
def test_unknown_askable_fact_asks_more(
    sahara_v1: RuleSetSchema, fatima_facts: FactBundle
) -> None:
    bundle = fatima_facts.with_fact("applicant_district", unknown_fact("applicant_district"))
    evaluation = evaluate_ruleset(sahara_v1, bundle)
    decision = route_case(
        evaluation, _confidence(), (), evaluation.benefit.amount_pkr, _policy(sahara_v1)
    )
    assert decision.action is RouteAction.ASK_MORE
    assert decision.outcome is CaseOutcome.NEEDS_INFO
    assert decision.reasons == ("ASK_R07_DISTRICT_SINDH",)


def test_ask_more_is_capped_at_two_rounds(
    sahara_v1: RuleSetSchema, fatima_facts: FactBundle
) -> None:
    bundle = fatima_facts.with_fact("applicant_district", unknown_fact("applicant_district"))
    evaluation = evaluate_ruleset(sahara_v1, bundle)
    decision = route_case(
        evaluation,
        _confidence(),
        (),
        evaluation.benefit.amount_pkr,
        _policy(sahara_v1),
        ask_more_rounds=2,
    )
    assert decision.action is RouteAction.HUMAN_REVIEW
    assert decision.reasons[0] == "MAX_ASK_ROUNDS_EXCEEDED"
    assert "MISSING_R07_DISTRICT_SINDH" in decision.reasons


def test_first_ask_round_is_still_an_ask(
    sahara_v1: RuleSetSchema, fatima_facts: FactBundle
) -> None:
    bundle = fatima_facts.with_fact("applicant_district", unknown_fact("applicant_district"))
    evaluation = evaluate_ruleset(sahara_v1, bundle)
    decision = route_case(
        evaluation,
        _confidence(),
        (),
        evaluation.benefit.amount_pkr,
        _policy(sahara_v1),
        ask_more_rounds=1,
    )
    assert decision.action is RouteAction.ASK_MORE


def test_failed_askable_rule_also_asks(
    sahara_v1: RuleSetSchema, fatima_facts: FactBundle
) -> None:
    bundle = fatima_facts.with_fact(
        "cnic_doc_verified",
        known_fact("cnic_doc_verified", False, source=FactSource.DOCUMENT_VERIFIER),
    )
    evaluation = evaluate_ruleset(sahara_v1, bundle)
    decision = route_case(
        evaluation, _confidence(), (), evaluation.benefit.amount_pkr, _policy(sahara_v1)
    )
    assert decision.action is RouteAction.ASK_MORE
    assert decision.reasons == ("ASK_R08_CNIC_DOC",)


def test_ask_beats_unknown_human(
    sahara_v1: RuleSetSchema, fatima_facts: FactBundle
) -> None:
    bundle = fatima_facts.with_fact(
        "applicant_district", unknown_fact("applicant_district")
    ).with_fact(
        "has_conflicting_active_grant", unknown_fact("has_conflicting_active_grant")
    )
    evaluation = evaluate_ruleset(sahara_v1, bundle)
    decision = route_case(
        evaluation, _confidence(), (), evaluation.benefit.amount_pkr, _policy(sahara_v1)
    )
    assert decision.action is RouteAction.ASK_MORE


# -- step 5: UNKNOWN with HUMAN -----------------------------------------
def test_unknown_human_fact_goes_to_human(
    sahara_v1: RuleSetSchema, fatima_facts: FactBundle
) -> None:
    bundle = fatima_facts.with_fact(
        "has_conflicting_active_grant", unknown_fact("has_conflicting_active_grant")
    )
    evaluation = evaluate_ruleset(sahara_v1, bundle)
    decision = route_case(
        evaluation, _confidence(), (), evaluation.benefit.amount_pkr, _policy(sahara_v1)
    )
    assert decision.action is RouteAction.HUMAN_REVIEW
    assert decision.reasons == ("UNKNOWN_R06_NO_CONFLICTING_GRANT",)


def test_unknown_human_beats_the_amount_cap(
    sahara_v1: RuleSetSchema, fatima_facts: FactBundle
) -> None:
    bundle = fatima_facts.with_fact(
        "has_conflicting_active_grant", unknown_fact("has_conflicting_active_grant")
    )
    evaluation = evaluate_ruleset(sahara_v1, bundle)
    decision = route_case(
        evaluation, _confidence(), (), 99999, _policy(sahara_v1)
    )
    assert decision.reasons == ("UNKNOWN_R06_NO_CONFLICTING_GRANT",)


# -- step 6: amount cap --------------------------------------------------
def test_amount_above_cap_goes_to_human(
    sahara_v1: RuleSetSchema, fatima_facts: FactBundle
) -> None:
    evaluation = evaluate_ruleset(sahara_v1, fatima_facts)
    decision = route_case(
        evaluation, _confidence(), (), 20001, _policy(sahara_v1)
    )
    assert decision.action is RouteAction.HUMAN_REVIEW
    assert decision.reasons == ("AMOUNT_EXCEEDS_AUTO_CAP",)


def test_amount_exactly_at_cap_is_allowed(
    sahara_v1: RuleSetSchema, fatima_facts: FactBundle
) -> None:
    evaluation = evaluate_ruleset(sahara_v1, fatima_facts)
    decision = route_case(
        evaluation, _confidence(), (), 20000, _policy(sahara_v1)
    )
    assert decision.action is RouteAction.AUTO_APPROVE


def test_amount_cap_beats_low_confidence(
    sahara_v1: RuleSetSchema, fatima_facts: FactBundle
) -> None:
    evaluation = evaluate_ruleset(sahara_v1, fatima_facts)
    decision = route_case(
        evaluation, _confidence(0.40), (), 25000, _policy(sahara_v1)
    )
    assert decision.reasons == ("AMOUNT_EXCEEDS_AUTO_CAP",)


# -- step 7: confidence --------------------------------------------------
def test_low_confidence_goes_to_human(
    sahara_v1: RuleSetSchema, fatima_facts: FactBundle
) -> None:
    evaluation = evaluate_ruleset(sahara_v1, fatima_facts)
    decision = route_case(
        evaluation, _confidence(0.89), (), evaluation.benefit.amount_pkr, _policy(sahara_v1)
    )
    assert decision.action is RouteAction.HUMAN_REVIEW
    assert decision.reasons == ("LOW_CONFIDENCE",)


def test_confidence_exactly_at_threshold_auto_approves(
    sahara_v1: RuleSetSchema, fatima_facts: FactBundle
) -> None:
    evaluation = evaluate_ruleset(sahara_v1, fatima_facts)
    decision = route_case(
        evaluation, _confidence(0.90), (), evaluation.benefit.amount_pkr, _policy(sahara_v1)
    )
    assert decision.action is RouteAction.AUTO_APPROVE


def test_verbal_consent_adds_the_low_assurance_reason(
    sahara_v1: RuleSetSchema, fatima_facts: FactBundle
) -> None:
    evaluation = evaluate_ruleset(sahara_v1, fatima_facts)
    decision = route_case(
        evaluation,
        _confidence(0.82, consent=0.82),
        (),
        evaluation.benefit.amount_pkr,
        _policy(sahara_v1),
    )
    assert decision.action is RouteAction.HUMAN_REVIEW
    assert decision.reasons == ("LOW_CONFIDENCE", "LOW_ASSURANCE_CONSENT")


def test_medium_flag_codes_are_appended_to_low_confidence(
    sahara_v1: RuleSetSchema, fatima_facts: FactBundle
) -> None:
    evaluation = evaluate_ruleset(sahara_v1, fatima_facts)
    decision = route_case(
        evaluation,
        _confidence(0.70),
        (_flag(FlagCode.DATA_CONFLICT_INCOME),),
        evaluation.benefit.amount_pkr,
        _policy(sahara_v1),
    )
    assert decision.reasons == ("LOW_CONFIDENCE", "DATA_CONFLICT_INCOME")


# -- reason codes --------------------------------------------------------
def test_every_emitted_reason_is_enumerated(
    sahara_v1: RuleSetSchema, fatima_facts: FactBundle
) -> None:
    bundle = fatima_facts.with_fact(
        "applicant_district", unknown_fact("applicant_district")
    )
    evaluation = evaluate_ruleset(sahara_v1, bundle)
    decision = route_case(
        evaluation, _confidence(), (), evaluation.benefit.amount_pkr, _policy(sahara_v1)
    )
    for reason in decision.reasons:
        assert is_known_reason_code(reason), reason


def test_reason_code_recogniser() -> None:
    assert is_known_reason_code("LOW_CONFIDENCE")
    assert is_known_reason_code("RULE_FAIL_R05_INCOME_CAP")
    assert is_known_reason_code("ASK_R07_DISTRICT_SINDH")
    assert is_known_reason_code("MISSING_R07_DISTRICT_SINDH")
    assert is_known_reason_code("UNKNOWN_R06_NO_CONFLICTING_GRANT")
    assert not is_known_reason_code("SOMETHING_MADE_UP")
    assert not is_known_reason_code("ASK_")


def test_static_reason_codes_are_all_uppercase() -> None:
    for code in ESCALATION_REASON_CODES:
        assert code == code.upper()


# -- priority score ------------------------------------------------------
def test_priority_base_is_thirty() -> None:
    assert compute_priority_score((), None) == 30


def test_priority_vulnerability_boosts(fatima_facts: FactBundle) -> None:
    assert compute_priority_score((), fatima_facts) == 45  # 3 children -> +15
    poor = fatima_facts.with_fact(
        "monthly_income_pkr",
        known_fact("monthly_income_pkr", 18000, source=FactSource.HOUSEHOLD_SURVEY),
    )
    assert compute_priority_score((), poor) == 55  # +15 children, +10 income


def test_priority_unknown_facts_earn_no_boost(fatima_facts: FactBundle) -> None:
    bundle = fatima_facts.with_fact(
        "children_under_18", unknown_fact("children_under_18")
    ).with_fact("monthly_income_pkr", unknown_fact("monthly_income_pkr"))
    assert compute_priority_score((), bundle) == 30


def test_priority_risk_boosts() -> None:
    assert compute_priority_score((_flag(FlagCode.TAMPER_SUSPECTED),), None) == 65
    assert compute_priority_score((_flag(FlagCode.DATA_CONFLICT_INCOME),), None) == 45
    assert (
        compute_priority_score(
            (_flag(FlagCode.TAMPER_SUSPECTED), _flag(FlagCode.DATA_CONFLICT_INCOME)), None
        )
        == 80
    )


def test_priority_aging_is_two_per_hour_capped_at_twenty() -> None:
    assert compute_priority_score((), None, 1.0) == 32
    assert compute_priority_score((), None, 5.0) == 40
    assert compute_priority_score((), None, 10.0) == 50
    assert compute_priority_score((), None, 10.9) == 50
    assert compute_priority_score((), None, 50.0) == 50


def test_priority_is_capped_at_one_hundred(fatima_facts: FactBundle) -> None:
    poor = fatima_facts.with_fact(
        "monthly_income_pkr",
        known_fact("monthly_income_pkr", 15000, source=FactSource.HOUSEHOLD_SURVEY),
    )
    score = compute_priority_score(
        (_flag(FlagCode.TAMPER_SUSPECTED), _flag(FlagCode.DATA_CONFLICT_INCOME)),
        poor,
        100.0,
    )
    assert score == 100


@pytest.mark.parametrize(
    ("score", "band"),
    [
        (100, PriorityBand.URGENT),
        (80, PriorityBand.URGENT),
        (79, PriorityBand.HIGH),
        (60, PriorityBand.HIGH),
        (59, PriorityBand.NORMAL),
        (35, PriorityBand.NORMAL),
        (34, PriorityBand.LOW),
        (0, PriorityBand.LOW),
    ],
)
def test_priority_band_boundaries(score: int, band: PriorityBand) -> None:
    assert priority_band(score) is band


def test_human_review_carries_priority_and_band(
    sahara_v1: RuleSetSchema, fatima_facts: FactBundle
) -> None:
    evaluation = evaluate_ruleset(sahara_v1, fatima_facts)
    decision = route_case(
        evaluation,
        _confidence(),
        (_flag(FlagCode.TAMPER_SUSPECTED),),
        evaluation.benefit.amount_pkr,
        _policy(sahara_v1),
        facts=fatima_facts,
    )
    assert decision.priority_score == 80
    assert decision.priority_band is PriorityBand.URGENT


def test_non_human_routes_do_not_carry_queue_priority(
    sahara_v1: RuleSetSchema, fatima_facts: FactBundle
) -> None:
    evaluation = evaluate_ruleset(sahara_v1, fatima_facts)
    decision = route_case(
        evaluation, _confidence(), (), evaluation.benefit.amount_pkr, _policy(sahara_v1)
    )
    assert decision.priority_score == 0
    assert decision.priority_band is PriorityBand.NORMAL


# -- handoff note --------------------------------------------------------
def test_handoff_note_has_all_three_sections(
    sahara_v1: RuleSetSchema, fatima_facts: FactBundle
) -> None:
    bundle = fatima_facts.with_fact(
        "monthly_income_pkr",
        known_fact("monthly_income_pkr", 55000, source=FactSource.HOUSEHOLD_SURVEY),
    )
    evaluation = evaluate_ruleset(sahara_v1, bundle)
    decision = route_case(
        evaluation, _confidence(), (), evaluation.benefit.amount_pkr, _policy(sahara_v1)
    )
    note = decision.handoff
    assert note is not None
    assert note.verified
    assert note.uncertain
    assert note.suggested_checks
    assert note.summary_en
    assert note.summary_ur


def test_handoff_note_lists_verified_rules_with_sources(
    sahara_v1: RuleSetSchema, fatima_facts: FactBundle
) -> None:
    evaluation = evaluate_ruleset(sahara_v1, fatima_facts)
    decision = route_case(
        evaluation,
        _confidence(),
        (_flag(FlagCode.TAMPER_SUSPECTED),),
        evaluation.benefit.amount_pkr,
        _policy(sahara_v1),
    )
    note = decision.handoff
    assert note is not None
    assert any("R01_ALIVE" in item for item in note.verified)
    assert any("IDENTITY_REGISTRY" in item for item in note.verified)


def test_handoff_note_names_the_weakest_pillar(
    sahara_v1: RuleSetSchema, fatima_facts: FactBundle
) -> None:
    evaluation = evaluate_ruleset(sahara_v1, fatima_facts)
    decision = route_case(
        evaluation,
        _confidence(0.72),
        (_flag(FlagCode.DATA_CONFLICT_INCOME),),
        evaluation.benefit.amount_pkr,
        _policy(sahara_v1),
    )
    note = decision.handoff
    assert note is not None
    assert any(item.startswith("WEAKEST_PILLAR_") for item in note.uncertain)


def test_handoff_note_suggests_a_concrete_check_for_tamper(
    sahara_v1: RuleSetSchema, fatima_facts: FactBundle
) -> None:
    evaluation = evaluate_ruleset(sahara_v1, fatima_facts)
    decision = route_case(
        evaluation,
        _confidence(),
        (_flag(FlagCode.TAMPER_SUSPECTED),),
        evaluation.benefit.amount_pkr,
        _policy(sahara_v1),
    )
    note = decision.handoff
    assert note is not None
    assert any("signed QR" in check for check in note.suggested_checks)


def test_handoff_note_suggests_asking_for_a_missing_fact(
    sahara_v1: RuleSetSchema, fatima_facts: FactBundle
) -> None:
    bundle = fatima_facts.with_fact("applicant_district", unknown_fact("applicant_district"))
    evaluation = evaluate_ruleset(sahara_v1, bundle)
    decision = route_case(
        evaluation,
        _confidence(),
        (),
        evaluation.benefit.amount_pkr,
        _policy(sahara_v1),
        ask_more_rounds=2,
    )
    note = decision.handoff
    assert note is not None
    assert any("district" in check.lower() for check in note.suggested_checks)


def test_handoff_note_json_shape(sahara_v1: RuleSetSchema, fatima_facts: FactBundle) -> None:
    evaluation = evaluate_ruleset(sahara_v1, fatima_facts)
    decision = route_case(
        evaluation,
        _confidence(),
        (_flag(FlagCode.TAMPER_SUSPECTED),),
        evaluation.benefit.amount_pkr,
        _policy(sahara_v1),
    )
    assert decision.handoff is not None
    payload = decision.handoff.to_json()
    assert set(payload) == {
        "verified",
        "uncertain",
        "suggested_checks",
        "summary_en",
        "summary_ur",
    }


def test_route_decision_json_shape(
    sahara_v1: RuleSetSchema, fatima_facts: FactBundle
) -> None:
    evaluation = evaluate_ruleset(sahara_v1, fatima_facts)
    decision = route_case(
        evaluation, _confidence(), (), evaluation.benefit.amount_pkr, _policy(sahara_v1)
    )
    payload = decision.to_json()
    assert payload["route_action"] == "AUTO_APPROVE"
    assert payload["outcome_status"] == "APPROVED"
    assert payload["escalation_reasons"] == []


def test_high_severity_flag_enum_is_used_consistently() -> None:
    assert FLAG_CATALOGUE[FlagCode.TAMPER_SUSPECTED] is FlagSeverity.HIGH
    assert FLAG_CATALOGUE[FlagCode.CNIC_GENDER_MISMATCH] is FlagSeverity.LOW


def test_evaluation_result_is_reusable_across_routes(
    sahara_v1: RuleSetSchema, fatima_facts: FactBundle
) -> None:
    evaluation: EvaluationResult = evaluate_ruleset(sahara_v1, fatima_facts)
    first = route_case(
        evaluation, _confidence(), (), evaluation.benefit.amount_pkr, _policy(sahara_v1)
    )
    second = route_case(
        evaluation, _confidence(), (), evaluation.benefit.amount_pkr, _policy(sahara_v1)
    )
    assert first.model_dump() == second.model_dump()
