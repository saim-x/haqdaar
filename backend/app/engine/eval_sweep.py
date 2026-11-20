"""Cost-of-being-wrong threshold sweep (Challenge 01).

Source of truth: ``docs/06-decision-engine.md`` §3.3 (the sweep and its four
metrics) and ``docs/07-ai-components.md`` §8 (the dashboard payload shape).

The sweep answers the judge's question with numbers: at which confidence threshold
does the expected cost of wrong approvals plus unnecessary human reviews reach its
minimum? The default Sahara v1 threshold of 0.90 is justified by this curve, not by
taste.

Purity: stdlib + pydantic only. The labelled dataset is read by the caller.
"""

from __future__ import annotations

import json
from collections.abc import Iterable, Sequence
from pathlib import Path
from typing import Any

from pydantic import BaseModel, ConfigDict

from app.engine.anomalies import FLAG_CATALOGUE, FlagCode, RiskFlag
from app.engine.confidence import (
    IDENTITY_AMBIGUOUS_OR_MISSING,
    ConfidenceComponents,
    DocumentEvidence,
    DocumentStatus,
    build_confidence,
    identity_confidence_for_cnic_match,
)
from app.engine.evaluator import evaluate_ruleset
from app.engine.facts import (
    FACT_REGISTRY,
    Fact,
    FactBundle,
    FactSource,
    FactState,
    known_fact,
)
from app.engine.router import RouteAction, route_case
from app.engine.rules_dsl import CostMatrix, RuleSetSchema

__all__ = [
    "DEFAULT_THRESHOLDS",
    "LabelledCase",
    "SweepPoint",
    "SweepResult",
    "dashboard_payload",
    "find_knee",
    "load_labelled_cases",
    "sweep",
]

#: docs/06 §3.3: tau in [0.50, 0.55, ..., 0.95].
DEFAULT_THRESHOLDS: tuple[float, ...] = tuple(
    round(0.50 + 0.05 * step, 2) for step in range(10)
)


class LabelledCase(BaseModel):
    """One labelled evaluation case with ground truth independent of the rules."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    case_id: str
    facts: FactBundle
    truly_eligible: bool
    flags: tuple[RiskFlag, ...] = ()
    confidence: ConfidenceComponents
    ask_more_rounds: int = 0
    hours_waiting: float = 0.0

    @classmethod
    def from_record(cls, record: dict[str, Any]) -> LabelledCase:
        """Tolerant adapter for ``backend/app/data/eval_cases.jsonl`` (A3-owned).

        Accepts facts either as full fact objects or as plain values, and confidence
        either as a full component block or as the raw evidence needed to build one.
        """
        raw_facts = record.get("facts") or {}
        facts: dict[str, Fact] = {}
        for key, payload in raw_facts.items():
            if key not in FACT_REGISTRY:
                continue
            if isinstance(payload, dict) and "state" in payload:
                facts[key] = Fact.model_validate(payload)
            elif payload is not None:
                facts[key] = known_fact(
                    key,
                    payload,
                    source=FactSource.SELF_DECLARED,
                    source_confidence=0.9,
                )
        bundle = FactBundle(facts=facts)

        flags = tuple(
            RiskFlag.model_validate(flag) if isinstance(flag, dict) else _flag_from_code(flag)
            for flag in record.get("flags") or ()
        )

        if "confidence_components" in record:
            confidence = ConfidenceComponents.model_validate(
                record["confidence_components"]
            )
        else:
            confidence = build_confidence(
                identity=_identity_confidence(record, bundle),
                documents=_document_evidence(record, bundle),
                flags=flags,
                consent_method=record.get("consent_method"),
                consent_assurance=_consent_assurance(record),
            )

        return cls(
            case_id=str(record.get("case_id") or record.get("id") or "unknown"),
            facts=bundle,
            truly_eligible=bool(record["truly_eligible"]),
            flags=flags,
            confidence=confidence,
            ask_more_rounds=int(record.get("ask_more_rounds") or 0),
            hours_waiting=float(record.get("hours_waiting") or 0.0),
        )


#: Which fact carries each required document's verification outcome.
_DOCUMENT_FACTS: tuple[tuple[str, str], ...] = (
    ("cnic_doc_verified", "CNIC_FRONT"),
    ("death_cert_doc_verified", "SPOUSE_DEATH_CERTIFICATE"),
)


def _identity_confidence(record: dict[str, Any], bundle: FactBundle) -> float:
    """docs/06 §3.2 pillar 1, from whatever evidence the record actually carries.

    An explicit ``identity_confidence`` wins. Otherwise the band is derived from the
    registry name similarity the generator stores on ``applicant_full_name`` — the
    same input :func:`identity_confidence_for_cnic_match` takes in production. A
    record with no registry hit is ``IDENTITY_AMBIGUOUS_OR_MISSING``, never a guess.
    """
    explicit = record.get("identity_confidence")
    if explicit is not None:
        return float(explicit)
    if record.get("registry_not_found"):
        return IDENTITY_AMBIGUOUS_OR_MISSING

    name_fact = bundle.facts.get("applicant_full_name")
    if name_fact is None or name_fact.state is not FactState.KNOWN:
        return IDENTITY_AMBIGUOUS_OR_MISSING

    dob_fact = bundle.facts.get("applicant_dob")
    dob_match = dob_fact is not None and dob_fact.state is FactState.KNOWN
    return identity_confidence_for_cnic_match(
        float(name_fact.source_confidence), dob_match=dob_match
    )


def _document_evidence(
    record: dict[str, Any], bundle: FactBundle
) -> tuple[DocumentEvidence, ...]:
    """docs/06 §3.2 pillar 2, from an explicit list or the ``*_doc_verified`` facts."""
    explicit = record.get("documents")
    if explicit:
        return tuple(DocumentEvidence.model_validate(doc) for doc in explicit)

    evidence: list[DocumentEvidence] = []
    for fact_key, doc_type in _DOCUMENT_FACTS:
        fact = bundle.facts.get(fact_key)
        if fact is None or fact.state is not FactState.KNOWN:
            continue
        if fact.value is True:
            evidence.append(
                DocumentEvidence(
                    doc_type=doc_type,
                    status=DocumentStatus.VERIFIED,
                    verify_confidence=fact.source_confidence or None,
                )
            )
        else:
            evidence.append(
                DocumentEvidence(doc_type=doc_type, status=DocumentStatus.NEEDS_RETAKE)
            )
    return tuple(evidence)


def _consent_assurance(record: dict[str, Any]) -> float | None:
    """The consent pillar when the record states it as a score rather than a method."""
    explicit = record.get("consent_assurance")
    return float(explicit) if explicit is not None else None


def _flag_from_code(code: str) -> RiskFlag:
    flag_code = FlagCode(code)
    return RiskFlag(
        code=flag_code,
        severity=FLAG_CATALOGUE[flag_code],
        detail_en=code,
        detail_ur=code,
    )


class SweepPoint(BaseModel):
    """One threshold on the cost curve."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    threshold: float
    auto_approved_count: int
    false_approval_count: int
    human_review_count: int
    ask_more_count: int
    auto_approve_rate: float
    false_approval_rate: float
    human_review_rate: float
    expected_cost: float

    @property
    def expected_total_cost(self) -> float:
        """docs/06 §3.3 name for the same number."""
        return self.expected_cost

    def to_json(self) -> dict[str, Any]:
        """docs/07 §8 ``decision_router_sweep`` element."""
        return {
            "threshold": self.threshold,
            "auto_approve_rate": self.auto_approve_rate,
            "false_approval_rate": self.false_approval_rate,
            "human_review_rate": self.human_review_rate,
            "expected_cost": self.expected_cost,
        }


class SweepResult(BaseModel):
    """The whole curve plus the active and minimum-cost thresholds."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    points: tuple[SweepPoint, ...]
    active_threshold: float
    knee_threshold: float
    sample_size: int
    cost_matrix: CostMatrix

    def point_at(self, threshold: float) -> SweepPoint | None:
        for point in self.points:
            if abs(point.threshold - threshold) < 1e-9:
                return point
        return None

    def to_json(self) -> dict[str, Any]:
        return {
            "decision_router_sweep": [point.to_json() for point in self.points],
            "active_threshold": self.active_threshold,
            "knee_threshold": self.knee_threshold,
            "sample_size": self.sample_size,
        }


def _rate(numerator: int, denominator: int) -> float:
    if denominator == 0:
        return 0.0
    return round(numerator / denominator, 4)


def sweep(
    cases: Sequence[LabelledCase] | Iterable[LabelledCase],
    ruleset: RuleSetSchema,
    *,
    thresholds: Sequence[float] | None = None,
    active_threshold: float | None = None,
) -> SweepResult:
    """Sweep the confidence threshold and compute the four cost metrics."""
    selected = list(cases)
    grid = tuple(thresholds) if thresholds is not None else DEFAULT_THRESHOLDS
    cost_matrix = ruleset.policy.cost_matrix
    active = (
        active_threshold
        if active_threshold is not None
        else ruleset.policy.auto_approve_confidence_threshold
    )

    points: list[SweepPoint] = []
    for threshold in grid:
        candidate_rules = ruleset.with_threshold(threshold)
        auto_approved = 0
        false_approvals = 0
        human_reviews = 0
        ask_mores = 0

        for case in selected:
            evaluation = evaluate_ruleset(candidate_rules, case.facts)
            decision = route_case(
                evaluation,
                case.confidence,
                case.flags,
                evaluation.benefit.amount_pkr,
                candidate_rules.policy,
                case.ask_more_rounds,
                False,
                facts=case.facts,
                hours_waiting=case.hours_waiting,
            )
            if decision.action is RouteAction.AUTO_APPROVE:
                auto_approved += 1
                if not case.truly_eligible:
                    false_approvals += 1
            elif decision.action is RouteAction.HUMAN_REVIEW:
                human_reviews += 1
            elif decision.action is RouteAction.ASK_MORE:
                ask_mores += 1

        expected_cost = (
            false_approvals * cost_matrix.wrong_approval_cost
            + human_reviews * cost_matrix.unnecessary_human_review_cost
            + ask_mores * cost_matrix.ask_more_cost
        )
        points.append(
            SweepPoint(
                threshold=round(threshold, 2),
                auto_approved_count=auto_approved,
                false_approval_count=false_approvals,
                human_review_count=human_reviews,
                ask_more_count=ask_mores,
                auto_approve_rate=_rate(auto_approved, len(selected)),
                false_approval_rate=_rate(false_approvals, auto_approved),
                human_review_rate=_rate(human_reviews, len(selected)),
                expected_cost=round(expected_cost, 2),
            )
        )

    return SweepResult(
        points=tuple(points),
        active_threshold=round(active, 2),
        knee_threshold=find_knee(points),
        sample_size=len(selected),
        cost_matrix=cost_matrix,
    )


def find_knee(points: Sequence[SweepPoint]) -> float:
    """Lowest expected cost; ties resolve to the most conservative threshold."""
    if not points:
        return 0.0
    best = min(points, key=lambda point: (point.expected_cost, -point.threshold))
    return best.threshold


def dashboard_payload(result: SweepResult) -> dict[str, Any]:
    """``decision_router_sweep`` block of ``GET /api/v1/eval/dashboard``."""
    return result.to_json()


def load_labelled_cases(path: str | Path) -> list[LabelledCase]:
    """Read a JSONL labelled case file (``backend/app/data/eval_cases.jsonl``)."""
    cases: list[LabelledCase] = []
    with Path(path).open("r", encoding="utf-8") as handle:
        for line in handle:
            stripped = line.strip()
            if not stripped:
                continue
            cases.append(LabelledCase.from_record(json.loads(stripped)))
    return cases
