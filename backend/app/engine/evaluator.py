"""Tri-state (Kleene) rule evaluation and benefit computation.

Source of truth: ``docs/06-decision-engine.md`` §2.3 (tri-state), §2.4 (benefit
formula), §8 (the rule trace feeds the citizen explanation).

The single most important behaviour in this module: an ``UNKNOWN`` fact yields an
``UNKNOWN`` rule result. It is never coerced to ``0``, ``False``, or a default, so
``monthly_income_pkr = UNKNOWN`` can never evaluate as ``<= 40000``.

Purity: stdlib + pydantic only.
"""

from __future__ import annotations

from enum import Enum
from typing import Any

from app.engine.facts import Fact, FactBundle, FactSource, FactState
from app.engine.rules_dsl import (
    BenefitFormula,
    EligibilityRule,
    RuleAction,
    RuleOperator,
    RuleSetSchema,
)
from pydantic import BaseModel, ConfigDict

__all__ = [
    "BenefitComputation",
    "EvaluationResult",
    "RuleResult",
    "RuleTrace",
    "compute_benefit",
    "evaluate_rule",
    "evaluate_ruleset",
]


class RuleResult(str, Enum):
    PASS = "PASS"
    FAIL = "FAIL"
    UNKNOWN = "UNKNOWN"


def _normalize_scalar(value: Any) -> Any:
    """Case/whitespace-insensitive comparison for strings; everything else as-is.

    District names arrive as ``"Thatta"``, ``"thatta"`` or ``" thatta "`` from three
    different registries. Treating those as different values would fail eligible
    citizens for a formatting reason, so string equality is normalised. Ordering
    comparisons on ISO date strings stay correct because the format is fixed-width.
    """
    if isinstance(value, str):
        return value.strip().casefold()
    return value


def _compare(op: RuleOperator, actual: Any, expected: Any) -> bool:
    if op is RuleOperator.EQ:
        return _normalize_scalar(actual) == _normalize_scalar(expected)
    if op is RuleOperator.NEQ:
        return _normalize_scalar(actual) != _normalize_scalar(expected)
    if op is RuleOperator.IN:
        haystack = [_normalize_scalar(item) for item in expected]
        return _normalize_scalar(actual) in haystack
    if op is RuleOperator.NOT_IN:
        haystack = [_normalize_scalar(item) for item in expected]
        return _normalize_scalar(actual) not in haystack

    left, right = _normalize_scalar(actual), _normalize_scalar(expected)
    if op is RuleOperator.GT:
        return left > right
    if op is RuleOperator.GTE:
        return left >= right
    if op is RuleOperator.LT:
        return left < right
    if op is RuleOperator.LTE:
        return left <= right
    raise ValueError(f"unsupported operator: {op!r}")


class RuleTrace(BaseModel):
    """One rule's outcome with actual vs expected, for the auditor and the citizen."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    rule_id: str
    fact: str
    op: RuleOperator
    expected: Any
    actual: Any = None
    fact_state: FactState
    result: RuleResult
    on_fail: RuleAction
    on_unknown: RuleAction
    required_for_auto: bool
    label_en: str
    label_ur: str
    reason_en: str
    reason_ur: str
    ask_prompt_en: str | None = None
    ask_prompt_ur: str | None = None
    source: FactSource | None = None

    def to_json(self) -> dict[str, Any]:
        """Shape stored in ``decisions.rule_trace_json`` (docs/04 §4.3)."""
        return {
            "rule_id": self.rule_id,
            "fact": self.fact,
            "op": self.op.value,
            "result": self.result.value,
            "actual": self.actual,
            "expected": self.expected,
            "fact_state": self.fact_state.value,
            "source": self.source.value if self.source else None,
            "reason_en": self.reason_en,
            "reason_ur": self.reason_ur,
        }


def evaluate_rule(rule: EligibilityRule, fact: Fact | None) -> RuleTrace:
    """Evaluate one rule against one fact using tri-state logic."""
    if fact is None or fact.state is FactState.UNKNOWN:
        # Unknown is a first-class value: no default substitution, ever.
        reason_en = (
            rule.ask_prompt_en
            if rule.on_unknown is RuleAction.ASK and rule.ask_prompt_en
            else rule.fail_reason_en
        )
        reason_ur = (
            rule.ask_prompt_ur
            if rule.on_unknown is RuleAction.ASK and rule.ask_prompt_ur
            else rule.fail_reason_ur
        )
        return RuleTrace(
            rule_id=rule.id,
            fact=rule.fact,
            op=rule.op,
            expected=rule.value,
            actual=None,
            fact_state=FactState.UNKNOWN,
            result=RuleResult.UNKNOWN,
            on_fail=rule.on_fail,
            on_unknown=rule.on_unknown,
            required_for_auto=rule.required_for_auto,
            label_en=rule.label_en,
            label_ur=rule.label_ur,
            reason_en=reason_en,
            reason_ur=reason_ur,
            ask_prompt_en=rule.ask_prompt_en,
            ask_prompt_ur=rule.ask_prompt_ur,
            source=None,
        )

    passed = _compare(rule.op, fact.value, rule.value)
    return RuleTrace(
        rule_id=rule.id,
        fact=rule.fact,
        op=rule.op,
        expected=rule.value,
        actual=fact.value,
        fact_state=FactState.KNOWN,
        result=RuleResult.PASS if passed else RuleResult.FAIL,
        on_fail=rule.on_fail,
        on_unknown=rule.on_unknown,
        required_for_auto=rule.required_for_auto,
        label_en=rule.label_en,
        label_ur=rule.label_ur,
        reason_en=rule.pass_reason_en if passed else rule.fail_reason_en,
        reason_ur=rule.pass_reason_ur if passed else rule.fail_reason_ur,
        ask_prompt_en=rule.ask_prompt_en,
        ask_prompt_ur=rule.ask_prompt_ur,
        source=fact.source,
    )


class BenefitComputation(BaseModel):
    """Benefit amount, or a provisional preview when children count is unknown."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    amount_pkr: int
    provisional: bool
    children_counted: int | None
    base_amount_pkr: int
    per_child_bonus_pkr: int
    hard_cap_pkr: int
    note_en: str
    note_ur: str


def compute_benefit(formula: BenefitFormula, facts: FactBundle) -> BenefitComputation:
    """docs/06 §2.4. Children ``UNKNOWN`` -> base amount marked provisional.

    The provisional amount is shown to officers as a preview. It is never used to
    auto-approve, because the confidence pillar for data consistency and the rule
    trace both carry the unknown forward.
    """
    children_fact = facts.get("children_under_18")
    if children_fact is None or children_fact.state is FactState.UNKNOWN:
        return BenefitComputation(
            amount_pkr=formula.base_amount_pkr,
            provisional=True,
            children_counted=None,
            base_amount_pkr=formula.base_amount_pkr,
            per_child_bonus_pkr=formula.per_child_bonus_pkr,
            hard_cap_pkr=formula.hard_cap_pkr,
            note_en=(
                "Provisional amount: the number of children under 18 is not confirmed, "
                "so only the base amount is shown."
            ),
            note_ur=(
                "عارضی رقم: 18 سال سے کم بچوں کی تعداد کی تصدیق نہیں ہوئی، "
                "اس لیے صرف بنیادی رقم دکھائی گئی ہے۔"
            ),
        )

    raw_children = int(children_fact.value)  # type: ignore[arg-type]
    counted = min(max(0, raw_children), formula.max_children_counted)
    amount = min(
        formula.hard_cap_pkr,
        formula.base_amount_pkr + counted * formula.per_child_bonus_pkr,
    )
    return BenefitComputation(
        amount_pkr=amount,
        provisional=False,
        children_counted=counted,
        base_amount_pkr=formula.base_amount_pkr,
        per_child_bonus_pkr=formula.per_child_bonus_pkr,
        hard_cap_pkr=formula.hard_cap_pkr,
        note_en="",
        note_ur="",
    )


class EvaluationResult(BaseModel):
    """Full rule trace plus the computed benefit for one case."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    rules: tuple[RuleTrace, ...]
    benefit: BenefitComputation

    # -- partitions used by the router (docs/06 §4.1) --------------------
    @property
    def passed(self) -> tuple[RuleTrace, ...]:
        return tuple(r for r in self.rules if r.result is RuleResult.PASS)

    @property
    def failed(self) -> tuple[RuleTrace, ...]:
        return tuple(r for r in self.rules if r.result is RuleResult.FAIL)

    @property
    def unknown(self) -> tuple[RuleTrace, ...]:
        return tuple(r for r in self.rules if r.result is RuleResult.UNKNOWN)

    @property
    def human_fails(self) -> tuple[RuleTrace, ...]:
        return tuple(
            r
            for r in self.rules
            if r.result is RuleResult.FAIL and r.on_fail is RuleAction.HUMAN
        )

    @property
    def ask_items(self) -> tuple[RuleTrace, ...]:
        return tuple(
            r
            for r in self.rules
            if (r.result is RuleResult.UNKNOWN and r.on_unknown is RuleAction.ASK)
            or (r.result is RuleResult.FAIL and r.on_fail is RuleAction.ASK)
        )

    @property
    def human_unknowns(self) -> tuple[RuleTrace, ...]:
        return tuple(
            r
            for r in self.rules
            if r.result is RuleResult.UNKNOWN and r.on_unknown is RuleAction.HUMAN
        )

    @property
    def all_pass(self) -> bool:
        return all(r.result is RuleResult.PASS for r in self.rules)

    @property
    def has_unknown(self) -> bool:
        return any(r.result is RuleResult.UNKNOWN for r in self.rules)

    @property
    def has_fail(self) -> bool:
        return any(r.result is RuleResult.FAIL for r in self.rules)

    def trace_json(self) -> list[dict[str, Any]]:
        return [rule.to_json() for rule in self.rules]


def evaluate_ruleset(ruleset: RuleSetSchema, facts: FactBundle) -> EvaluationResult:
    """Evaluate every rule in declaration order and compute the benefit amount."""
    traces = tuple(
        evaluate_rule(rule, facts.get(rule.fact)) for rule in ruleset.eligibility_rules
    )
    return EvaluationResult(
        rules=traces,
        benefit=compute_benefit(ruleset.benefit_formula, facts),
    )
