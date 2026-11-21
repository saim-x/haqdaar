"""Digital Twin: pure historical replay of a candidate rule set.

Source of truth: ``docs/06-decision-engine.md`` §7.

Given the baseline rules, a candidate rule set and a list of historical decisions,
replay every case in memory and report what would change. Zero side effects: no case
is touched, no payment is created, no notification is sent, and the inputs are never
mutated. Same inputs always produce the same output.

Purity: stdlib + pydantic only.
"""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from typing import Any

from pydantic import BaseModel, ConfigDict, ValidationError

from app.engine.anomalies import RiskFlag
from app.engine.confidence import ConfidenceComponents
from app.engine.evaluator import EvaluationResult, evaluate_ruleset
from app.engine.facts import FactBundle
from app.engine.router import CaseOutcome, RouteDecision, route_case
from app.engine.rules_dsl import RuleSetSchema

__all__ = [
    "TwinCase",
    "TwinFlip",
    "TwinResult",
    "replay",
]

_OUTCOME_KEYS = (
    CaseOutcome.APPROVED.value,
    CaseOutcome.NEEDS_INFO.value,
    CaseOutcome.HUMAN_REVIEW.value,
)


class TwinCase(BaseModel):
    """One historical decision, reduced to what replay needs."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    case_id: str
    reference_code: str = ""
    facts: FactBundle
    flags: tuple[RiskFlag, ...] = ()
    confidence: ConfidenceComponents
    ask_more_rounds: int = 0
    hours_waiting: float = 0.0
    #: Flag codes found on the stored row that are not in the catalogue. A replay
    #: must survive historical rows written before a code was renamed or removed;
    #: dropping them silently would hide the data problem, so they are reported.
    ignored_flag_codes: tuple[str, ...] = ()

    @classmethod
    def from_decision_row(cls, row: dict[str, Any]) -> TwinCase:
        """Adapt a ``decisions`` row (docs/04 §4.3) into a replay input."""
        flags: list[RiskFlag] = []
        ignored: list[str] = []
        for raw in row.get("flags_json") or ():
            try:
                flags.append(RiskFlag.model_validate(raw))
            except ValidationError:
                ignored.append(str(raw.get("code") if isinstance(raw, dict) else raw))
        return cls(
            case_id=str(row["case_id"]),
            reference_code=str(row.get("reference_code") or ""),
            facts=FactBundle.from_snapshot(row["input_snapshot_json"]),
            flags=tuple(flags),
            confidence=ConfidenceComponents.model_validate(row["confidence_components"]),
            ask_more_rounds=int(row.get("ask_more_rounds") or 0),
            hours_waiting=float(row.get("hours_waiting") or 0.0),
            ignored_flag_codes=tuple(ignored),
        )


class TwinFlip(BaseModel):
    """One case whose route or amount would change under the candidate rules."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    case_id: str
    reference_code: str
    before_route: str
    after_route: str
    before_amount: int
    after_amount: int
    primary_reason: str

    def to_json(self) -> dict[str, Any]:
        return {
            "case_id": self.case_id,
            "reference_code": self.reference_code,
            "before_route": self.before_route,
            "after_route": self.after_route,
            "before_amount": self.before_amount,
            "after_amount": self.after_amount,
            "primary_reason": self.primary_reason,
        }


class TwinResult(BaseModel):
    """``simulation_runs.summary_json`` - the Digital Twin preview."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    sample_size: int
    before_counts: dict[str, int]
    after_counts: dict[str, int]
    transition_matrix: dict[str, int]
    flipped_count: int
    flipped_cases: tuple[TwinFlip, ...] = ()
    budget_delta_pkr: int
    baseline_content_hash: str
    candidate_content_hash: str

    def to_json(self) -> dict[str, Any]:
        return {
            "sample_size": self.sample_size,
            "before_counts": dict(self.before_counts),
            "after_counts": dict(self.after_counts),
            "transition_matrix": dict(self.transition_matrix),
            "flipped_count": self.flipped_count,
            "flipped_cases": [flip.to_json() for flip in self.flipped_cases],
            "budget_delta_pkr": self.budget_delta_pkr,
            "baseline_content_hash": self.baseline_content_hash,
            "candidate_content_hash": self.candidate_content_hash,
        }


def _primary_reason(
    before_eval: EvaluationResult,
    after_eval: EvaluationResult,
    before_route: RouteDecision,
    after_route: RouteDecision,
    baseline: RuleSetSchema,
    candidate: RuleSetSchema,
) -> str:
    """Why did this case flip? Most specific cause first, fully deterministic."""
    before_by_id = {trace.rule_id: trace for trace in before_eval.rules}
    for trace in after_eval.rules:
        previous = before_by_id.get(trace.rule_id)
        if previous is None:
            return f"RULE_{trace.rule_id}_ADDED"
        if previous.result is not trace.result:
            return (
                f"RULE_{trace.rule_id}_{previous.result.value}_TO_{trace.result.value}"
            )
    for rule_id in before_by_id:
        if rule_id not in {trace.rule_id for trace in after_eval.rules}:
            return f"RULE_{rule_id}_REMOVED"

    if before_eval.benefit.amount_pkr != after_eval.benefit.amount_pkr:
        return "BENEFIT_FORMULA_CHANGED"

    if (
        baseline.policy.auto_approve_confidence_threshold
        != candidate.policy.auto_approve_confidence_threshold
    ):
        return "THRESHOLD_CHANGED"

    if (
        baseline.policy.auto_approve_max_amount_pkr
        != candidate.policy.auto_approve_max_amount_pkr
    ):
        return "AMOUNT_CAP_CHANGED"

    if before_route.action is not after_route.action:
        return "ROUTE_CHANGED"
    return "AMOUNT_CHANGED"


def _empty_counts() -> dict[str, int]:
    return {key: 0 for key in _OUTCOME_KEYS}


def replay(
    baseline_rules: RuleSetSchema,
    candidate_rules: RuleSetSchema,
    cases: Sequence[TwinCase] | Iterable[TwinCase],
    *,
    sample_size: int = 200,
) -> TwinResult:
    """Replay historical cases against the candidate rules. Pure and side-effect free."""
    selected = list(cases)[: max(0, sample_size)]

    before_counts = _empty_counts()
    after_counts = _empty_counts()
    transition_matrix: dict[str, int] = {}
    flips: list[TwinFlip] = []
    before_approved_total = 0
    after_approved_total = 0

    for case in selected:
        before_eval = evaluate_ruleset(baseline_rules, case.facts)
        after_eval = evaluate_ruleset(candidate_rules, case.facts)

        before_route = route_case(
            before_eval,
            case.confidence,
            case.flags,
            before_eval.benefit.amount_pkr,
            baseline_rules.policy,
            case.ask_more_rounds,
            False,
            facts=case.facts,
            hours_waiting=case.hours_waiting,
        )
        after_route = route_case(
            after_eval,
            case.confidence,
            case.flags,
            after_eval.benefit.amount_pkr,
            candidate_rules.policy,
            case.ask_more_rounds,
            False,
            facts=case.facts,
            hours_waiting=case.hours_waiting,
        )

        before_key = before_route.outcome.value
        after_key = after_route.outcome.value
        before_counts[before_key] = before_counts.get(before_key, 0) + 1
        after_counts[after_key] = after_counts.get(after_key, 0) + 1

        transition = f"{before_key}->{after_key}"
        transition_matrix[transition] = transition_matrix.get(transition, 0) + 1

        if before_route.outcome is CaseOutcome.APPROVED:
            before_approved_total += before_eval.benefit.amount_pkr
        if after_route.outcome is CaseOutcome.APPROVED:
            after_approved_total += after_eval.benefit.amount_pkr

        if before_route.action is not after_route.action:
            flips.append(
                TwinFlip(
                    case_id=case.case_id,
                    reference_code=case.reference_code,
                    before_route=before_route.action.value,
                    after_route=after_route.action.value,
                    before_amount=before_eval.benefit.amount_pkr,
                    after_amount=after_eval.benefit.amount_pkr,
                    primary_reason=_primary_reason(
                        before_eval,
                        after_eval,
                        before_route,
                        after_route,
                        baseline_rules,
                        candidate_rules,
                    ),
                )
            )

    return TwinResult(
        sample_size=len(selected),
        before_counts=before_counts,
        after_counts=after_counts,
        transition_matrix=dict(sorted(transition_matrix.items())),
        flipped_count=len(flips),
        flipped_cases=tuple(flips),
        budget_delta_pkr=after_approved_total - before_approved_total,
        baseline_content_hash=baseline_rules.content_hash(),
        candidate_content_hash=candidate_rules.content_hash(),
    )


def replay_from_rows(
    baseline_rules: RuleSetSchema,
    candidate_rules: RuleSetSchema,
    rows: Sequence[dict[str, Any]],
    *,
    sample_size: int = 200,
) -> TwinResult:
    """Convenience wrapper for ``decisions`` rows straight out of the database."""
    return replay(
        baseline_rules,
        candidate_rules,
        [TwinCase.from_decision_row(row) for row in rows],
        sample_size=sample_size,
    )
