"""Cost-aware routing, officer priority scoring and the AI case handoff note.

Source of truth: ``docs/06-decision-engine.md`` §4.1 (routing order), §4.2 (priority
score), §4.3 (handoff note).

The routing order is a frozen contract and is implemented top-to-bottom exactly as
specified. There is no ``AUTO_REJECT``: the enum has four members and a case can only
leave the engine as ``AUTO_APPROVE``, ``ASK_MORE``, ``HUMAN_REVIEW`` or
``WAIT_EXTERNAL``. Only an officer can reject.

Purity: stdlib + pydantic only.
"""

from __future__ import annotations

from collections.abc import Sequence
from enum import Enum
from typing import Any

from pydantic import BaseModel, ConfigDict

from app.engine.anomalies import FlagSeverity, RiskFlag
from app.engine.confidence import ConfidenceComponents, weakest_pillar
from app.engine.evaluator import EvaluationResult, RuleResult
from app.engine.facts import FactBundle
from app.engine.rules_dsl import Policy

__all__ = [
    "ESCALATION_REASON_CODES",
    "CaseHandoffNote",
    "CaseOutcome",
    "PriorityBand",
    "RouteAction",
    "RouteDecision",
    "build_handoff_note",
    "compute_priority_score",
    "is_known_reason_code",
    "priority_band",
    "route_case",
]


class RouteAction(str, Enum):
    """docs/04 §3.4 ``route_action``. Four members. No AUTO_REJECT, by design."""

    AUTO_APPROVE = "AUTO_APPROVE"
    ASK_MORE = "ASK_MORE"
    HUMAN_REVIEW = "HUMAN_REVIEW"
    WAIT_EXTERNAL = "WAIT_EXTERNAL"


class CaseOutcome(str, Enum):
    """Resulting ``case_status`` (docs/04 §3.3)."""

    APPROVED = "APPROVED"
    NEEDS_INFO = "NEEDS_INFO"
    HUMAN_REVIEW = "HUMAN_REVIEW"
    WAITING_EXTERNAL = "WAITING_EXTERNAL"


class PriorityBand(str, Enum):
    URGENT = "URGENT"
    HIGH = "HIGH"
    NORMAL = "NORMAL"
    LOW = "LOW"


#: Static escalation codes. Rule-scoped codes are ``RULE_FAIL_<id>``, ``ASK_<id>``,
#: ``MISSING_<id>`` and ``UNKNOWN_<id>`` (docs/06 §4.1).
ESCALATION_REASON_CODES: frozenset[str] = frozenset(
    {
        "EXTERNAL_SERVICE_UNAVAILABLE",
        "AMOUNT_EXCEEDS_AUTO_CAP",
        "LOW_CONFIDENCE",
        "LOW_ASSURANCE_CONSENT",
        "MAX_ASK_ROUNDS_EXCEEDED",
        "TAMPER_SUSPECTED",
        "DUPLICATE_APPLICATION",
        "IDENTITY_CONFLICT",
        "POSSIBLE_DUPLICATE_IDENTITY",
        "APPLICANT_DECEASED",
        "PAYOUT_ACCOUNT_SHARED",
        "DATA_CONFLICT_INCOME",
        "PAYOUT_NAME_MISMATCH",
        "IDENTITY_NAME_VARIANT_CHECK",
        "HELPER_HIGH_VELOCITY",
        "CNIC_GENDER_MISMATCH",
    }
)

_RULE_SCOPED_PREFIXES = ("RULE_FAIL_", "ASK_", "MISSING_", "UNKNOWN_")


def is_known_reason_code(code: str) -> bool:
    """True when ``code`` is an enumerated escalation reason (Challenge 02)."""
    if code in ESCALATION_REASON_CODES:
        return True
    return any(
        code.startswith(prefix) and len(code) > len(prefix)
        for prefix in _RULE_SCOPED_PREFIXES
    )


class CaseHandoffNote(BaseModel):
    """``cases.ai_case_note`` — what the officer sees first (docs/06 §4.3)."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    verified: tuple[str, ...] = ()
    uncertain: tuple[str, ...] = ()
    suggested_checks: tuple[str, ...] = ()
    summary_en: str = ""
    summary_ur: str = ""

    def to_json(self) -> dict[str, Any]:
        return {
            "verified": list(self.verified),
            "uncertain": list(self.uncertain),
            "suggested_checks": list(self.suggested_checks),
            "summary_en": self.summary_en,
            "summary_ur": self.summary_ur,
        }


class RouteDecision(BaseModel):
    """The engine's routing verdict for one case."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    action: RouteAction
    outcome: CaseOutcome
    reasons: tuple[str, ...] = ()
    priority_score: int = 0
    priority_band: PriorityBand = PriorityBand.NORMAL
    handoff: CaseHandoffNote | None = None

    def to_json(self) -> dict[str, Any]:
        return {
            "route_action": self.action.value,
            "outcome_status": self.outcome.value,
            "escalation_reasons": list(self.reasons),
            "priority_score": self.priority_score,
            "priority_band": self.priority_band.value,
        }


# -- priority score (docs/06 §4.2) ---------------------------------------
def priority_band(score: int) -> PriorityBand:
    if score >= 80:
        return PriorityBand.URGENT
    if score >= 60:
        return PriorityBand.HIGH
    if score >= 35:
        return PriorityBand.NORMAL
    return PriorityBand.LOW


def compute_priority_score(
    flags: Sequence[RiskFlag],
    facts: FactBundle | None = None,
    hours_waiting: float = 0.0,
) -> int:
    """0-100 officer queue priority. Unknown facts never earn a vulnerability boost."""
    score = 30

    if facts is not None:
        children = facts.value("children_under_18")
        if isinstance(children, int) and not isinstance(children, bool) and children >= 3:
            score += 15
        income = facts.value("monthly_income_pkr")
        if isinstance(income, int) and not isinstance(income, bool) and income <= 20000:
            score += 10

    if any(flag.severity is FlagSeverity.HIGH for flag in flags):
        score += 35
    if any(flag.severity is FlagSeverity.MEDIUM for flag in flags):
        score += 15

    score += min(20, max(0, int(hours_waiting)) * 2)
    return max(0, min(100, score))


# -- handoff note (docs/06 §4.3) -----------------------------------------
_STATIC_CHECKS: dict[str, str] = {
    "TAMPER_SUSPECTED": (
        "Compare the printed name on the CNIC image against the signed QR payload; "
        "call the applicant if needed."
    ),
    "DUPLICATE_APPLICATION": (
        "Open the earlier case on the same CNIC and confirm whether this is a repeat "
        "submission or a genuine second application."
    ),
    "IDENTITY_CONFLICT": (
        "Compare the registry name with the CNIC image and ask the applicant to "
        "confirm their full name."
    ),
    "POSSIBLE_DUPLICATE_IDENTITY": (
        "Ask for the CNIC number to disambiguate between the matching registry records."
    ),
    "APPLICANT_DECEASED": (
        "Verify the death record against the civil registry before any action."
    ),
    "PAYOUT_ACCOUNT_SHARED": (
        "Confirm the payout account belongs to the applicant and not to a helper or "
        "relative."
    ),
    "DATA_CONFLICT_INCOME": (
        "Compare the self-declared income with the household survey record and ask for "
        "supporting proof."
    ),
    "PAYOUT_NAME_MISMATCH": (
        "Confirm the Raast account title matches the applicant's registered name."
    ),
    "IDENTITY_NAME_VARIANT_CHECK": (
        "Confirm the spelling variant on the CNIC matches the registry record."
    ),
    "HELPER_HIGH_VELOCITY": (
        "Review the helper's recent submissions for unusual volume."
    ),
    "LOW_ASSURANCE_CONSENT": (
        "Call the applicant to confirm consent was given freely."
    ),
    "CNIC_GENDER_MISMATCH": (
        "Confirm the applicant's gender against the CNIC record."
    ),
    "LOW_CONFIDENCE": (
        "Review the weakest evidence pillar and confirm the underlying document."
    ),
    "AMOUNT_EXCEEDS_AUTO_CAP": (
        "Confirm the household composition before approving the amount."
    ),
    "MAX_ASK_ROUNDS_EXCEEDED": (
        "Contact the applicant directly; two information requests went unanswered."
    ),
    "EXTERNAL_SERVICE_UNAVAILABLE": (
        "Retry once the government system is available."
    ),
}


def _suggested_checks(
    reasons: Sequence[str], eval_result: EvaluationResult
) -> tuple[str, ...]:
    checks: list[str] = []
    for reason in reasons:
        if reason in _STATIC_CHECKS:
            checks.append(_STATIC_CHECKS[reason])
            continue
        rule_id = None
        for prefix in _RULE_SCOPED_PREFIXES:
            if reason.startswith(prefix):
                rule_id = reason[len(prefix) :]
                break
        if rule_id is None:
            continue
        trace = next((r for r in eval_result.rules if r.rule_id == rule_id), None)
        if trace is None:
            continue
        if reason.startswith(("ASK_", "MISSING_")):
            prompt = trace.ask_prompt_en or trace.label_en
            checks.append(f"Ask the applicant for: {prompt}")
        elif reason.startswith("UNKNOWN_"):
            checks.append(f"Obtain the missing fact for rule {rule_id}: {trace.label_en}")
        else:
            checks.append(f"Review rule {rule_id} with the applicant: {trace.label_en}")
    # De-duplicate while preserving order.
    seen: set[str] = set()
    ordered: list[str] = []
    for check in checks:
        if check not in seen:
            seen.add(check)
            ordered.append(check)
    return tuple(ordered)


def build_handoff_note(
    eval_result: EvaluationResult,
    confidence: ConfidenceComponents,
    flags: Sequence[RiskFlag],
    reasons: Sequence[str],
    facts: FactBundle | None = None,
) -> CaseHandoffNote:
    """Structured handoff: what was verified, what is uncertain, what to check."""
    verified = tuple(
        f"{trace.rule_id}: {trace.label_en}"
        + (f" (source: {trace.source.value})" if trace.source else "")
        for trace in eval_result.passed
    )

    uncertain: list[str] = list(reasons)
    if facts is not None:
        for key in facts.known_keys():
            fact = facts.require(key)
            if fact.conflict:
                uncertain.append(f"CONFLICTING_FACT_{key}")
    pillar = weakest_pillar(confidence)
    pillar_score = confidence.as_pillars()[pillar]
    uncertain.append(f"WEAKEST_PILLAR_{pillar.upper()}_{pillar_score:.3f}")

    high_codes = [flag.code.value for flag in flags if flag.severity is FlagSeverity.HIGH]
    summary_en = (
        f"Escalated for human review with {len(reasons)} reason(s). "
        f"Weakest evidence pillar: {pillar} at {pillar_score:.3f}."
    )
    if high_codes:
        summary_en += f" High-severity flags: {', '.join(high_codes)}."
    summary_ur = (
        f"کیس انسانی جائزے کے لیے بھیجا گیا ہے ({len(reasons)} وجوہات)۔ "
        f"کمزور ترین ثبوت: {pillar} ({pillar_score:.3f})۔"
    )

    return CaseHandoffNote(
        verified=verified,
        uncertain=tuple(uncertain),
        suggested_checks=_suggested_checks(reasons, eval_result),
        summary_en=summary_en,
        summary_ur=summary_ur,
    )


# -- routing (docs/06 §4.1) ----------------------------------------------
def route_case(
    eval_result: EvaluationResult,
    confidence: ConfidenceComponents,
    flags: Sequence[RiskFlag],
    amount_pkr: int,
    policy: Policy,
    ask_more_rounds: int = 0,
    external_unavailable: bool = False,
    *,
    facts: FactBundle | None = None,
    hours_waiting: float = 0.0,
) -> RouteDecision:
    """Deterministic routing, evaluated top-to-bottom in the frozen order."""

    def _human(reasons: Sequence[str]) -> RouteDecision:
        score = compute_priority_score(flags, facts, hours_waiting)
        return RouteDecision(
            action=RouteAction.HUMAN_REVIEW,
            outcome=CaseOutcome.HUMAN_REVIEW,
            reasons=tuple(reasons),
            priority_score=score,
            priority_band=priority_band(score),
            handoff=build_handoff_note(eval_result, confidence, flags, reasons, facts),
        )

    # 1. External dependency down -> never guess.
    if external_unavailable:
        return RouteDecision(
            action=RouteAction.WAIT_EXTERNAL,
            outcome=CaseOutcome.WAITING_EXTERNAL,
            reasons=("EXTERNAL_SERVICE_UNAVAILABLE",),
        )

    # 2. Any HIGH severity flag -> mandatory human review.
    high_flags = [flag for flag in flags if flag.severity is FlagSeverity.HIGH]
    if high_flags:
        return _human([flag.code.value for flag in high_flags])

    # 3. Any rule FAIL with on_fail == HUMAN -> human review, never auto-reject.
    human_fails = eval_result.human_fails
    if human_fails:
        return _human([f"RULE_FAIL_{trace.rule_id}" for trace in human_fails])

    # 4. Any rule UNKNOWN/FAIL with on_* == ASK -> ask more, capped at 2 rounds.
    ask_items = eval_result.ask_items
    if ask_items:
        if ask_more_rounds >= policy.max_ask_more_rounds:
            return _human(
                ["MAX_ASK_ROUNDS_EXCEEDED"]
                + [f"MISSING_{trace.rule_id}" for trace in ask_items]
            )
        return RouteDecision(
            action=RouteAction.ASK_MORE,
            outcome=CaseOutcome.NEEDS_INFO,
            reasons=tuple(f"ASK_{trace.rule_id}" for trace in ask_items),
        )

    # 5. Any rule UNKNOWN with on_unknown == HUMAN -> human review.
    human_unknowns = eval_result.human_unknowns
    if human_unknowns:
        return _human([f"UNKNOWN_{trace.rule_id}" for trace in human_unknowns])

    # 6. Payout exceeds the auto-approve cap -> human review.
    if amount_pkr > policy.auto_approve_max_amount_pkr:
        return _human(["AMOUNT_EXCEEDS_AUTO_CAP"])

    # 7. Confidence below threshold -> human review ("I am not sure").
    if confidence.overall < policy.auto_approve_confidence_threshold:
        reasons = ["LOW_CONFIDENCE"]
        if confidence.consent_assurance < policy.auto_approve_confidence_threshold:
            reasons.append("LOW_ASSURANCE_CONSENT")
        reasons.extend(
            flag.code.value for flag in flags if flag.severity is FlagSeverity.MEDIUM
        )
        return _human(reasons)

    # 8. All checks pass, zero HIGH flags, confidence >= threshold.
    return RouteDecision(
        action=RouteAction.AUTO_APPROVE,
        outcome=CaseOutcome.APPROVED,
        reasons=(),
    )


def all_rules_pass(eval_result: EvaluationResult) -> bool:
    """Convenience predicate used by tests and the case agent's assertions."""
    return all(trace.result is RuleResult.PASS for trace in eval_result.rules)
