"""End-to-end pure pipeline: facts + rules + flags -> decision (docs/06 §4)."""

from __future__ import annotations

import json

import pytest
from app.engine.anomalies import FLAG_CATALOGUE, FlagCode, RiskFlag
from app.engine.confidence import ConsentMethod, DocumentEvidence
from app.engine.facts import FactBundle, FactSource, known_fact, unknown_fact
from app.engine.pipeline import ENGINE_VERSION, EngineResult, evaluate_and_route
from app.engine.router import CaseOutcome, RouteAction
from app.engine.rules_dsl import RuleSetSchema
from pydantic import ValidationError


def _flag(code: FlagCode) -> RiskFlag:
    return RiskFlag(
        code=code,
        severity=FLAG_CATALOGUE[code],
        detail_en=f"{code.value} detected",
        detail_ur=f"{code.value} پایا گیا",
    )


def _golden(
    fatima_facts: FactBundle,
    sahara_v1: RuleSetSchema,
    documents: tuple[DocumentEvidence, ...],
    *,
    identity_confidence: float = 0.98,
    **overrides: object,
) -> EngineResult:
    return evaluate_and_route(
        fatima_facts,
        sahara_v1,
        identity_confidence=identity_confidence,
        documents=documents,
        **overrides,  # type: ignore[arg-type]
    )


def test_golden_path_auto_approves_fatima(
    fatima_facts: FactBundle,
    sahara_v1: RuleSetSchema,
    fatima_documents: tuple[DocumentEvidence, ...],
) -> None:
    result = _golden(fatima_facts, sahara_v1, fatima_documents)

    assert result.route.action is RouteAction.AUTO_APPROVE
    assert result.route.outcome is CaseOutcome.APPROVED
    assert result.amount_pkr == 15000
    assert result.amount_provisional is False
    assert result.confidence.overall == 0.95
    assert result.route.priority_band.value == "NORMAL"


def test_golden_path_explanation_is_bilingual_and_mentions_the_amount(
    fatima_facts: FactBundle,
    sahara_v1: RuleSetSchema,
    fatima_documents: tuple[DocumentEvidence, ...],
) -> None:
    explanation = _golden(fatima_facts, sahara_v1, fatima_documents).explanation
    assert "15,000" in explanation.headline_en
    assert "15,000" in explanation.headline_ur
    assert explanation.reasons_en
    assert explanation.reasons_ur
    assert len(explanation.reasons_en) <= 3
    assert explanation.next_step_en
    assert explanation.next_step_ur


def test_pipeline_is_byte_identical_on_repeat(
    fatima_facts: FactBundle,
    sahara_v1: RuleSetSchema,
    fatima_documents: tuple[DocumentEvidence, ...],
) -> None:
    first = _golden(fatima_facts, sahara_v1, fatima_documents)
    second = _golden(fatima_facts, sahara_v1, fatima_documents)
    assert first.model_dump() == second.model_dump()
    assert first.input_snapshot_hash == second.input_snapshot_hash
    assert json.dumps(first.to_decision_payload(), sort_keys=True) == json.dumps(
        second.to_decision_payload(), sort_keys=True
    )


def test_snapshot_hash_tracks_the_facts(
    fatima_facts: FactBundle,
    sahara_v1: RuleSetSchema,
    fatima_documents: tuple[DocumentEvidence, ...],
) -> None:
    baseline = _golden(fatima_facts, sahara_v1, fatima_documents)
    changed = fatima_facts.with_fact(
        "monthly_income_pkr",
        known_fact("monthly_income_pkr", 29000, source=FactSource.HOUSEHOLD_SURVEY),
    )
    assert _golden(changed, sahara_v1, fatima_documents).input_snapshot_hash != (
        baseline.input_snapshot_hash
    )


def test_rule_hash_is_the_ruleset_hash(
    fatima_facts: FactBundle,
    sahara_v1: RuleSetSchema,
    fatima_documents: tuple[DocumentEvidence, ...],
) -> None:
    result = _golden(fatima_facts, sahara_v1, fatima_documents)
    assert result.rule_content_hash == sahara_v1.content_hash()
    assert result.rule_version_number is None


def test_rule_version_number_is_carried_through(
    fatima_facts: FactBundle,
    sahara_v1: RuleSetSchema,
    fatima_documents: tuple[DocumentEvidence, ...],
) -> None:
    result = _golden(
        fatima_facts, sahara_v1, fatima_documents, rule_version_number=2
    )
    assert result.rule_version_number == 2


def test_rule_trace_property_mirrors_the_evaluation(
    fatima_facts: FactBundle,
    sahara_v1: RuleSetSchema,
    fatima_documents: tuple[DocumentEvidence, ...],
) -> None:
    result = _golden(fatima_facts, sahara_v1, fatima_documents)
    assert result.rule_trace == result.evaluation.rules
    assert len(result.rule_trace) == len(sahara_v1.eligibility_rules)


def test_decision_payload_has_the_decisions_columns(
    fatima_facts: FactBundle,
    sahara_v1: RuleSetSchema,
    fatima_documents: tuple[DocumentEvidence, ...],
) -> None:
    payload = _golden(fatima_facts, sahara_v1, fatima_documents).to_decision_payload()
    assert set(payload) == {
        "rule_content_hash",
        "input_snapshot_json",
        "input_snapshot_hash",
        "rule_trace_json",
        "confidence_components",
        "confidence_overall",
        "route_action",
        "outcome_status",
        "escalation_reasons",
        "model_versions",
        "citizen_explanation",
        "computed_amount_pkr",
    }
    assert payload["route_action"] == "AUTO_APPROVE"
    assert payload["outcome_status"] == "APPROVED"
    assert payload["computed_amount_pkr"] == 15000
    assert payload["confidence_overall"] == 0.95
    assert isinstance(payload["escalation_reasons"], list)
    json.dumps(payload)


def test_model_versions_are_recorded(
    fatima_facts: FactBundle,
    sahara_v1: RuleSetSchema,
    fatima_documents: tuple[DocumentEvidence, ...],
) -> None:
    versions = _golden(fatima_facts, sahara_v1, fatima_documents).model_versions
    assert versions["engine"] == ENGINE_VERSION
    assert versions["rules_schema"] == sahara_v1.schema_version
    assert "explainer" in versions


def test_external_outage_waits_instead_of_deciding(
    fatima_facts: FactBundle,
    sahara_v1: RuleSetSchema,
    fatima_documents: tuple[DocumentEvidence, ...],
) -> None:
    result = _golden(
        fatima_facts, sahara_v1, fatima_documents, external_unavailable=True
    )
    assert result.route.action is RouteAction.WAIT_EXTERNAL
    assert result.route.outcome is CaseOutcome.WAITING_EXTERNAL
    assert "EXTERNAL_SERVICE_UNAVAILABLE" in result.route.reasons


def test_unknown_income_never_auto_approves(
    make_facts,
    unknown_income,
    sahara_v1: RuleSetSchema,
    fatima_documents: tuple[DocumentEvidence, ...],
) -> None:
    facts = make_facts(monthly_income_pkr=unknown_income)
    result = _golden(facts, sahara_v1, fatima_documents)
    assert result.route.action is RouteAction.ASK_MORE
    assert result.route.outcome is CaseOutcome.NEEDS_INFO
    assert result.route.action is not RouteAction.AUTO_APPROVE
    assert "income" in " ".join(result.explanation.reasons_en).lower()
    assert result.explanation.next_step_en
    assert result.explanation.next_step_ur


def test_unknown_income_is_not_coerced_to_zero(
    make_facts, unknown_income, sahara_v1: RuleSetSchema
) -> None:
    facts = make_facts(monthly_income_pkr=unknown_income)
    trace = next(
        item for item in evaluate_and_route(
            facts, sahara_v1, identity_confidence=0.98
        ).rule_trace
        if item.rule_id == "R05_INCOME_CAP"
    )
    assert trace.result.value == "UNKNOWN"
    assert trace.actual is None


def test_high_flag_forces_human_review(
    fatima_facts: FactBundle,
    sahara_v1: RuleSetSchema,
    fatima_documents: tuple[DocumentEvidence, ...],
) -> None:
    result = _golden(
        fatima_facts,
        sahara_v1,
        fatima_documents,
        flags=(_flag(FlagCode.TAMPER_SUSPECTED),),
    )
    assert result.route.action is RouteAction.HUMAN_REVIEW
    assert result.route.outcome is CaseOutcome.HUMAN_REVIEW
    assert "TAMPER_SUSPECTED" in result.route.reasons


def test_human_review_explanation_never_accuses(
    fatima_facts: FactBundle,
    sahara_v1: RuleSetSchema,
    fatima_documents: tuple[DocumentEvidence, ...],
) -> None:
    result = _golden(
        fatima_facts,
        sahara_v1,
        fatima_documents,
        flags=(_flag(FlagCode.TAMPER_SUSPECTED),),
    )
    text = result.explanation.all_text().lower()
    for accusatory in ("fraud", "forg", "fake", "cheat", "lie", "جعل", "دھوکہ"):
        assert accusatory not in text


def test_low_confidence_asks_before_approving(
    fatima_facts: FactBundle,
    sahara_v1: RuleSetSchema,
    fatima_documents: tuple[DocumentEvidence, ...],
) -> None:
    result = _golden(fatima_facts, sahara_v1, fatima_documents, identity_confidence=0.60)
    assert result.route.action is not RouteAction.AUTO_APPROVE
    assert result.confidence.overall < 0.90


def test_provisional_amount_is_never_guessed_into_the_decision(
    make_facts, sahara_v1: RuleSetSchema, fatima_documents: tuple[DocumentEvidence, ...]
) -> None:
    """children_under_18 UNKNOWN: base amount only, flagged provisional for officers."""
    facts = make_facts(
        children_under_18=unknown_fact("children_under_18")
    )
    result = _golden(facts, sahara_v1, fatima_documents)
    assert result.amount_pkr == 12000  # base only: no invented child bonus
    assert result.amount_provisional is True
    assert result.evaluation.benefit.provisional is True


def test_ask_more_rounds_are_carried(
    make_facts,
    unknown_income,
    sahara_v1: RuleSetSchema,
    fatima_documents: tuple[DocumentEvidence, ...],
) -> None:
    facts = make_facts(monthly_income_pkr=unknown_income)
    result = _golden(facts, sahara_v1, fatima_documents, ask_more_rounds=2)
    assert result.route.action is RouteAction.HUMAN_REVIEW
    assert "MAX_ASK_ROUNDS_EXCEEDED" in result.route.reasons


def test_consent_method_affects_the_consent_pillar(
    fatima_facts: FactBundle,
    sahara_v1: RuleSetSchema,
    fatima_documents: tuple[DocumentEvidence, ...],
) -> None:
    strong = _golden(fatima_facts, sahara_v1, fatima_documents)
    weak = _golden(
        fatima_facts,
        sahara_v1,
        fatima_documents,
        consent_method=ConsentMethod.VERBAL_WITNESSED,
    )
    assert weak.confidence.consent_assurance <= strong.confidence.consent_assurance


def test_identity_confidence_is_required(
    fatima_facts: FactBundle, sahara_v1: RuleSetSchema
) -> None:
    with pytest.raises(TypeError):
        evaluate_and_route(fatima_facts, sahara_v1)  # type: ignore[call-arg]


def test_engine_result_is_frozen(
    fatima_facts: FactBundle,
    sahara_v1: RuleSetSchema,
    fatima_documents: tuple[DocumentEvidence, ...],
) -> None:
    result = _golden(fatima_facts, sahara_v1, fatima_documents)
    with pytest.raises(ValidationError):
        result.amount_pkr = 1  # type: ignore[misc]
