"""Deterministic bilingual citizen explanations (Challenge 05).

Source of truth: ``docs/06-decision-engine.md`` §8.

The explanation is built from the rule trace and the route action only. It works
with the LLM completely down, which is the point: a citizen must always be able to
read why. An optional live-LLM polish happens outside this module and must fall back
to these templates on any guardrail failure.

Dignity rule: a ``HUMAN_REVIEW`` explanation is neutral and never accuses anyone of
forgery or fraud, even when ``TAMPER_SUSPECTED`` is flagged internally for the
officer. This module never reads flag codes for citizen-facing text, so the
accusation cannot leak by construction.

Purity: stdlib + pydantic only.
"""

from __future__ import annotations

from typing import Any

from app.engine.evaluator import EvaluationResult, RuleResult
from app.engine.router import CaseOutcome, RouteDecision
from pydantic import BaseModel, ConfigDict

__all__ = [
    "ACCUSATORY_TERMS",
    "CitizenExplanation",
    "build_explanation",
    "contains_accusatory_language",
]

#: Terms that must never reach a citizen. Used by the guardrail test.
ACCUSATORY_TERMS: tuple[str, ...] = (
    "fraud",
    "fraudulent",
    "forgery",
    "forged",
    "fake",
    "tamper",
    "tampered",
    "cheat",
    "cheating",
    "liar",
    "lying",
    "criminal",
    "scam",
    "investigation",
    "fraudster",
    "جعل",
    "جعلسازی",
    "فراڈ",
    "فراڈی",
    "جعلی",
    "دھوکہ",
    "دھوکہ باز",
    "جھوٹ",
    "مجرم",
    "تحقیقات",
)

_MAX_REASONS = 3


class CitizenExplanation(BaseModel):
    """``cases.citizen_explanation`` — what the citizen reads and hears."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    headline_ur: str
    headline_en: str
    reasons_ur: tuple[str, ...] = ()
    reasons_en: tuple[str, ...] = ()
    next_step_ur: str
    next_step_en: str

    def to_json(self) -> dict[str, Any]:
        return {
            "headline_ur": self.headline_ur,
            "headline_en": self.headline_en,
            "reasons_ur": list(self.reasons_ur),
            "reasons_en": list(self.reasons_en),
            "next_step_ur": self.next_step_ur,
            "next_step_en": self.next_step_en,
        }

    def all_text(self) -> str:
        return " ".join(
            (
                self.headline_ur,
                self.headline_en,
                *self.reasons_ur,
                *self.reasons_en,
                self.next_step_ur,
                self.next_step_en,
            )
        )


def contains_accusatory_language(explanation: CitizenExplanation) -> bool:
    """Guardrail used by tests and by the optional LLM polish step."""
    haystack = explanation.all_text().casefold()
    return any(term.casefold() in haystack for term in ACCUSATORY_TERMS)


def _approved(
    eval_result: EvaluationResult, amount_pkr: int, provisional: bool
) -> CitizenExplanation:
    if provisional:
        headline_en = (
            f"Approved — an estimated PKR {amount_pkr:,} will be sent to your account."
        )
        headline_ur = (
            f"منظوری — تخمیناً {amount_pkr:,} روپے آپ کے اکاؤنٹ میں بھیجے جائیں گے۔"
        )
    else:
        headline_en = f"Approved — PKR {amount_pkr:,} will be sent to your account."
        headline_ur = f"منظوری — {amount_pkr:,} روپے آپ کے اکاؤنٹ میں بھیجے جائیں گے۔"

    passing = [trace for trace in eval_result.rules if trace.result is RuleResult.PASS]
    reasons_en = tuple(trace.reason_en for trace in passing[:_MAX_REASONS])
    reasons_ur = tuple(trace.reason_ur for trace in passing[:_MAX_REASONS])

    return CitizenExplanation(
        headline_ur=headline_ur,
        headline_en=headline_en,
        reasons_ur=reasons_ur,
        reasons_en=reasons_en,
        next_step_ur=(
            "رقم 24 گھنٹوں میں آپ کے راست اکاؤنٹ میں پہنچ جائے گی۔ "
            "آپ کو HQ- سے شروع ہونے والا کوڈ موصول ہوگا۔"
        ),
        next_step_en=(
            "The money will reach your Raast account within 24 hours. "
            "You will receive an SMS with a code starting with HQ-."
        ),
    )


def _needs_info(eval_result: EvaluationResult) -> CitizenExplanation:
    items = eval_result.ask_items
    reasons_en = tuple(
        (trace.ask_prompt_en or trace.label_en) for trace in items[:_MAX_REASONS]
    )
    reasons_ur = tuple(
        (trace.ask_prompt_ur or trace.label_ur) for trace in items[:_MAX_REASONS]
    )
    if not reasons_en:
        reasons_en = ("We need one more detail to finish your application.",)
        reasons_ur = ("درخواست مکمل کرنے کے لیے ایک اور تفصیل درکار ہے۔",)

    return CitizenExplanation(
        headline_ur="درخواست مکمل کرنے کے لیے ایک اور چیز درکار ہے۔",
        headline_en="We need one more thing to finish your application.",
        reasons_ur=reasons_ur,
        reasons_en=reasons_en,
        next_step_ur="ایپ کھولیں، اوپر دی گئی چیز فراہم کریں اور دوبارہ جمع کروائیں۔",
        next_step_en="Open the app, provide the item above, and submit again.",
    )


def _human_review(eval_result: EvaluationResult) -> CitizenExplanation:
    # Only neutral policy statements from failed rules. Flag codes are never read
    # here, so TAMPER_SUSPECTED and friends cannot leak into citizen-facing text.
    # A FAIL trace's reason_* is the rule's fail_reason_*.
    neutral = [
        trace.reason_en
        for trace in eval_result.rules
        if trace.result is RuleResult.FAIL
    ]
    neutral_ur = [
        trace.reason_ur
        for trace in eval_result.rules
        if trace.result is RuleResult.FAIL
    ]
    reasons_en = tuple(neutral[:_MAX_REASONS]) or (
        "Some details need a person to check them.",
    )
    reasons_ur = tuple(neutral_ur[:_MAX_REASONS]) or (
        "کچھ تفصیلات کی جانچ ایک شخص کو کرنی ہے۔",
    )

    return CitizenExplanation(
        headline_ur=(
            "ایک افسر آپ کی درخواست کا جائزہ لیں گے — عام طور پر 2 دن میں۔ "
            "آپ کو کچھ کرنے کی ضرورت نہیں۔"
        ),
        headline_en=(
            "An officer will review your application — usually within 2 days. "
            "You do not need to do anything."
        ),
        reasons_ur=reasons_ur,
        reasons_en=reasons_en,
        next_step_ur=(
            "آپ کو کچھ کرنے کی ضرورت نہیں۔ اگر مزید معلومات درکار ہوں گی تو ہم آپ کو کال کریں گے۔"
        ),
        next_step_en=(
            "You do not need to do anything. If we need more information, we will call you."
        ),
    )


def _waiting_external() -> CitizenExplanation:
    return CitizenExplanation(
        headline_ur=(
            "ایک سرکاری تصدیقی نظام عارضی طور پر سست ہے۔ "
            "ہم نے سب کچھ محفوظ کر لیا ہے اور خود بخود جاری رکھیں گے۔"
        ),
        headline_en=(
            "A government verification system is temporarily slow. "
            "We saved everything and will continue automatically."
        ),
        reasons_ur=(),
        reasons_en=(),
        next_step_ur="کوئی کارروائی درکار نہیں۔ نظام کے جواب دیتے ہی ہم جاری رکھیں گے۔",
        next_step_en="No action needed. We will continue as soon as the system responds.",
    )


def build_explanation(
    route: RouteDecision,
    eval_result: EvaluationResult,
    amount_pkr: int,
    *,
    provisional: bool = False,
) -> CitizenExplanation:
    """Build the citizen-facing explanation for a routed case."""
    if route.outcome is CaseOutcome.APPROVED:
        return _approved(eval_result, amount_pkr, provisional)
    if route.outcome is CaseOutcome.NEEDS_INFO:
        return _needs_info(eval_result)
    if route.outcome is CaseOutcome.WAITING_EXTERNAL:
        return _waiting_external()
    return _human_review(eval_result)
