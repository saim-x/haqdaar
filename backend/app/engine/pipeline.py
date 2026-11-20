"""The single pure entry point: facts + rules + flags -> decision.

``evaluate_and_route`` is what the case agent calls in step 8
(``assemble_facts_and_decide``). It composes the evaluator, the confidence model, the
router and the explainer, and returns everything the ``decisions`` row needs.

Determinism: no clock, no randomness, no I/O. Identical inputs produce byte-identical
output, which is what makes the audit hash meaningful.

Purity: stdlib + pydantic only.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

from app.engine.anomalies import RiskFlag
from app.engine.confidence import (
    ConfidenceComponents,
    ConsentMethod,
    DocumentEvidence,
    build_confidence,
)
from app.engine.evaluator import EvaluationResult, RuleTrace, evaluate_ruleset
from app.engine.explainer import CitizenExplanation, build_explanation
from app.engine.facts import FactBundle
from app.engine.router import RouteDecision, route_case
from app.engine.rules_dsl import RuleSetSchema
from pydantic import BaseModel, ConfigDict

__all__ = ["ENGINE_VERSION", "EngineResult", "evaluate_and_route"]

ENGINE_VERSION = "1.0.0"


class EngineResult(BaseModel):
    """Everything one decision needs, ready to be persisted append-only."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    rule_content_hash: str
    rule_version_number: int | None = None
    facts_snapshot: dict[str, dict[str, Any]]
    input_snapshot_hash: str
    evaluation: EvaluationResult
    confidence: ConfidenceComponents
    route: RouteDecision
    amount_pkr: int
    amount_provisional: bool
    explanation: CitizenExplanation
    model_versions: dict[str, str]

    @property
    def rule_trace(self) -> tuple[RuleTrace, ...]:
        return self.evaluation.rules

    def to_decision_payload(self) -> dict[str, Any]:
        """Column-ready payload for the append-only ``decisions`` row."""
        return {
            "rule_content_hash": self.rule_content_hash,
            "input_snapshot_json": self.facts_snapshot,
            "input_snapshot_hash": self.input_snapshot_hash,
            "rule_trace_json": self.evaluation.trace_json(),
            "confidence_components": self.confidence.to_json(),
            "confidence_overall": self.confidence.overall,
            "route_action": self.route.action.value,
            "outcome_status": self.route.outcome.value,
            "escalation_reasons": list(self.route.reasons),
            "model_versions": dict(self.model_versions),
            "citizen_explanation": self.explanation.to_json(),
            "computed_amount_pkr": self.amount_pkr,
        }


def evaluate_and_route(
    facts: FactBundle,
    ruleset: RuleSetSchema,
    *,
    identity_confidence: float,
    flags: Sequence[RiskFlag] = (),
    documents: Sequence[DocumentEvidence] = (),
    consent_method: ConsentMethod | str | None = ConsentMethod.SELF_OTP,
    ask_more_rounds: int = 0,
    external_unavailable: bool = False,
    hours_waiting: float = 0.0,
    rule_version_number: int | None = None,
) -> EngineResult:
    """Evaluate eligibility, compute confidence, route, and explain.

    ``identity_confidence`` is required and has no default: the engine will not guess
    how sure it is about who the applicant is. The case agent supplies it from
    :func:`app.engine.entity_resolution.resolve_identity`.
    """
    evaluation = evaluate_ruleset(ruleset, facts)
    confidence = build_confidence(
        identity=identity_confidence,
        documents=documents,
        flags=flags,
        consent_method=consent_method,
    )
    amount = evaluation.benefit.amount_pkr
    route = route_case(
        evaluation,
        confidence,
        flags,
        amount,
        ruleset.policy,
        ask_more_rounds,
        external_unavailable,
        facts=facts,
        hours_waiting=hours_waiting,
    )
    explanation = build_explanation(
        route,
        evaluation,
        amount,
        provisional=evaluation.benefit.provisional,
    )

    return EngineResult(
        rule_content_hash=ruleset.content_hash(),
        rule_version_number=rule_version_number,
        facts_snapshot=facts.to_snapshot(),
        input_snapshot_hash=facts.snapshot_hash(),
        evaluation=evaluation,
        confidence=confidence,
        route=route,
        amount_pkr=amount,
        amount_provisional=evaluation.benefit.provisional,
        explanation=explanation,
        model_versions={
            "engine": ENGINE_VERSION,
            "rules_schema": ruleset.schema_version,
            "explainer": "template-1.0.0",
        },
    )
