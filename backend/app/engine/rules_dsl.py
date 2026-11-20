"""Versioned Rules DSL (``rule_versions.rules_json``).

Source of truth: ``docs/06-decision-engine.md`` §2.1 (schema), §2.2 (operators and
validator duties), §2.4 (benefit formula).

The DSL is the only place eligibility thresholds live. There is no program-specific
Python: Sahara and Guzara are both just JSON documents validated here.

Purity: stdlib + pydantic only.
"""

from __future__ import annotations

import copy
import hashlib
import json
from enum import Enum
from typing import Any

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    PrivateAttr,
    ValidationError,
    model_validator,
)

from app.engine.facts import FACT_REGISTRY, FactValueType

__all__ = [
    "BenefitFormula",
    "CostMatrix",
    "EligibilityRule",
    "Policy",
    "RuleAction",
    "RuleOperator",
    "RuleSetSchema",
    "RuleValidationReport",
    "validate_rules_json",
]

SCHEMA_VERSION = "1.0"

#: Urdu messages for machine-readable validation codes (details.errors).
_ERROR_MESSAGES_UR: dict[str, str] = {
    "FACT_UNKNOWN": "قاعدے میں دیا گیا فیصلہ کن عنصر موجود نہیں ہے۔",
    "OP_INVALID": "قاعدے کا موازنہ کرنے کا طریقہ درست نہیں ہے۔",
    "VALUE_TYPE_MISMATCH": "قاعدے میں دی گئی قدر کی قسم درست نہیں ہے۔",
    "BILINGUAL_EMPTY": "اردو اور انگریزی وضاحت لازمی ہے۔",
    "ASK_PROMPT_MISSING": "مزید معلومات مانگنے کے لیے سوال لازمی ہے۔",
    "THRESHOLD_OUT_OF_RANGE": "اعتماد کی حد 0.50 سے 0.99 کے درمیان ہونی چاہیے۔",
    "DUPLICATE_RULE_ID": "قاعدے کا شناختی نمبر دہرایا گیا ہے۔",
    "BENEFIT_FORMULA_INVALID": "رقم کا فارمولا درست نہیں ہے۔",
    "SCHEMA_INVALID": "قواعد کی ساخت درست نہیں ہے۔",
}


def _err(code: str, message: str) -> ValueError:
    """Validation errors carry a stable machine code as a message prefix."""
    return ValueError(f"{code}: {message}")


class RuleOperator(str, Enum):
    """docs/06 §2.2 — the complete operator set. Nothing else is accepted."""

    EQ = "eq"
    NEQ = "neq"
    GT = "gt"
    GTE = "gte"
    LT = "lt"
    LTE = "lte"
    IN = "in"
    NOT_IN = "not_in"


class RuleAction(str, Enum):
    """What to do when a rule fails or is unknown. There is no REJECT."""

    HUMAN = "HUMAN"
    ASK = "ASK"


_ORDERING_OPS = frozenset(
    {RuleOperator.GT, RuleOperator.GTE, RuleOperator.LT, RuleOperator.LTE}
)
_MEMBERSHIP_OPS = frozenset({RuleOperator.IN, RuleOperator.NOT_IN})


def _matches_fact_type(value: Any, value_type: FactValueType) -> bool:
    if value_type is FactValueType.STRING:
        return isinstance(value, str)
    if value_type is FactValueType.INT:
        return isinstance(value, int) and not isinstance(value, bool)
    if value_type is FactValueType.BOOL:
        return isinstance(value, bool)
    return False


def _require_text(value: str | None, field_name: str) -> str:
    if value is None or not value.strip():
        raise _err("BILINGUAL_EMPTY", f"{field_name} must be a non-empty string")
    return value


class EligibilityRule(BaseModel):
    """One eligibility rule with bilingual labels, reasons and ask prompts."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    id: str
    fact: str
    op: RuleOperator
    value: Any
    on_fail: RuleAction
    on_unknown: RuleAction
    required_for_auto: bool = True
    label_en: str
    label_ur: str
    pass_reason_en: str
    pass_reason_ur: str
    fail_reason_en: str
    fail_reason_ur: str
    ask_prompt_en: str | None = None
    ask_prompt_ur: str | None = None

    @model_validator(mode="after")
    def _validate_rule(self) -> EligibilityRule:
        if not self.id.strip():
            raise _err("SCHEMA_INVALID", "rule id must be non-empty")

        spec = FACT_REGISTRY.get(self.fact)
        if spec is None:
            raise _err(
                "FACT_UNKNOWN",
                f"rule {self.id!r} references fact {self.fact!r} which is not in the "
                "canonical fact registry (docs/04 §5)",
            )

        if self.op in _MEMBERSHIP_OPS:
            if not isinstance(self.value, list) or not self.value:
                raise _err(
                    "VALUE_TYPE_MISMATCH",
                    f"rule {self.id!r} op {self.op.value!r} requires a non-empty list",
                )
            for item in self.value:
                if not _matches_fact_type(item, spec.value_type):
                    raise _err(
                        "VALUE_TYPE_MISMATCH",
                        f"rule {self.id!r} list item {item!r} is not "
                        f"{spec.value_type.value}",
                    )
        else:
            if not _matches_fact_type(self.value, spec.value_type):
                raise _err(
                    "VALUE_TYPE_MISMATCH",
                    f"rule {self.id!r} value {self.value!r} is not "
                    f"{spec.value_type.value} (fact {self.fact!r})",
                )
            if self.op in _ORDERING_OPS and spec.value_type is FactValueType.BOOL:
                raise _err(
                    "OP_INVALID",
                    f"rule {self.id!r} cannot order-compare a bool fact",
                )

        for field_name in (
            "label_en",
            "label_ur",
            "pass_reason_en",
            "pass_reason_ur",
            "fail_reason_en",
            "fail_reason_ur",
        ):
            _require_text(getattr(self, field_name), f"rule {self.id!r} {field_name}")

        if self.on_fail is RuleAction.ASK or self.on_unknown is RuleAction.ASK:
            for field_name in ("ask_prompt_en", "ask_prompt_ur"):
                value = getattr(self, field_name)
                if value is None or not value.strip():
                    raise _err(
                        "ASK_PROMPT_MISSING",
                        f"rule {self.id!r} {field_name} is required when the rule asks "
                        "the citizen for more information",
                    )

        return self


class CostMatrix(BaseModel):
    """docs/06 §3.3 — the numbers behind "a wrong approval is worse than a slow one"."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    wrong_approval_cost: float = Field(default=100.0, ge=0.0)
    unnecessary_human_review_cost: float = Field(default=8.0, ge=0.0)
    ask_more_cost: float = Field(default=5.0, ge=0.0)
    missed_fraud_multiplier: float = Field(default=1.5, ge=0.0)


class Policy(BaseModel):
    """Routing policy knobs. Every threshold is data, never code."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    auto_approve_confidence_threshold: float = Field(ge=0.50, le=0.99)
    auto_approve_max_amount_pkr: int = Field(ge=0)
    max_ask_more_rounds: int = Field(default=2, ge=0, le=10)
    cost_matrix: CostMatrix = Field(default_factory=CostMatrix)

    @model_validator(mode="after")
    def _threshold_in_range(self) -> Policy:
        if not 0.50 <= self.auto_approve_confidence_threshold <= 0.99:
            raise _err(
                "THRESHOLD_OUT_OF_RANGE",
                "auto_approve_confidence_threshold must be within [0.50, 0.99]",
            )
        return self


class BenefitFormula(BaseModel):
    """docs/06 §2.4 — amount = min(cap, base + min(children, max_counted) * bonus)."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    base_amount_pkr: int = Field(ge=0)
    per_child_bonus_pkr: int = Field(ge=0)
    max_children_counted: int = Field(ge=0)
    hard_cap_pkr: int = Field(ge=0)

    @model_validator(mode="after")
    def _cap_covers_base(self) -> BenefitFormula:
        if self.hard_cap_pkr < self.base_amount_pkr:
            raise _err(
                "BENEFIT_FORMULA_INVALID",
                "hard_cap_pkr must be greater than or equal to base_amount_pkr",
            )
        return self


class RuleSetSchema(BaseModel):
    """A complete, validated ``rules_json`` document."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    schema_version: str = SCHEMA_VERSION
    program_code: str
    policy: Policy
    eligibility_rules: list[EligibilityRule] = Field(min_length=1)
    benefit_formula: BenefitFormula

    #: The exact JSON document this schema was validated from. ``content_hash`` must
    #: cover what is stored in ``rule_versions.rules_json`` (docs/04 §4.2), not the
    #: normalised model dump — the two differ whenever the document carries an int
    #: where the model holds a float, and a hash that disagrees with the stored row
    #: breaks the audit proof on every decision.
    _raw_payload: dict[str, Any] | None = PrivateAttr(default=None)

    @model_validator(mode="wrap")
    @classmethod
    def _capture_raw_payload(cls, data: Any, handler: Any) -> RuleSetSchema:
        instance = handler(data)
        if isinstance(data, dict):
            object.__setattr__(instance, "_raw_payload", copy.deepcopy(data))
        return instance

    @model_validator(mode="after")
    def _unique_rule_ids(self) -> RuleSetSchema:
        if not self.program_code.strip():
            raise _err("SCHEMA_INVALID", "program_code must be non-empty")
        seen: set[str] = set()
        for rule in self.eligibility_rules:
            if rule.id in seen:
                raise _err("DUPLICATE_RULE_ID", f"duplicate rule id {rule.id!r}")
            seen.add(rule.id)
        return self

    # -- helpers ---------------------------------------------------------
    def rule_by_id(self, rule_id: str) -> EligibilityRule | None:
        for rule in self.eligibility_rules:
            if rule.id == rule_id:
                return rule
        return None

    def canonical_json(self) -> str:
        payload = self._raw_payload
        if payload is None:
            payload = self.model_dump(mode="json")
        return json.dumps(
            payload,
            sort_keys=True,
            separators=(",", ":"),
            ensure_ascii=False,
        )

    def content_hash(self) -> str:
        """SHA-256 of canonical sorted JSON (docs/04 §4.2 ``content_hash``)."""
        return hashlib.sha256(self.canonical_json().encode("utf-8")).hexdigest()

    def with_threshold(self, threshold: float) -> RuleSetSchema:
        """Pure copy with a different confidence threshold (Digital Twin / sweep)."""
        policy = self.policy.model_copy(
            update={"auto_approve_confidence_threshold": threshold}
        )
        variant = self.model_copy(update={"policy": policy})
        if self._raw_payload is not None:
            raw = copy.deepcopy(self._raw_payload)
            raw.setdefault("policy", {})["auto_approve_confidence_threshold"] = threshold
            object.__setattr__(variant, "_raw_payload", raw)
        return variant


class RuleValidationReport(BaseModel):
    """Result of validating a candidate ``rules_json`` payload."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    valid: bool
    errors: tuple[dict[str, str], ...] = ()
    ruleset: RuleSetSchema | None = None
    content_hash: str | None = None


def _map_pydantic_error(error: dict[str, Any]) -> dict[str, str]:
    loc = ".".join(str(part) for part in error.get("loc", ()))
    raw = str(error.get("msg", "invalid value"))
    # Pydantic prefixes validator messages with "Value error, ".
    raw = raw.removeprefix("Value error, ")
    code = "SCHEMA_INVALID"
    message = raw
    if ": " in raw:
        prefix, _, rest = raw.partition(": ")
        if prefix in _ERROR_MESSAGES_UR:
            code, message = prefix, rest
    if code == "SCHEMA_INVALID" and loc.endswith("auto_approve_confidence_threshold"):
        code = "THRESHOLD_OUT_OF_RANGE"
        message = "auto_approve_confidence_threshold must be within [0.50, 0.99]"
    return {
        "path": loc,
        "code": code,
        "message_en": message,
        "message_ur": _ERROR_MESSAGES_UR.get(code, _ERROR_MESSAGES_UR["SCHEMA_INVALID"]),
    }


def validate_rules_json(payload: Any) -> RuleValidationReport:
    """Validate a raw ``rules_json`` payload without raising.

    Used by ``POST /admin/rules/{id}/validate`` and by publish, which must return
    ``422 RULE_VALIDATION_FAILED`` with ``details.errors`` (docs/05 §2).
    """
    try:
        ruleset = RuleSetSchema.model_validate(payload)
    except ValidationError as exc:
        errors = tuple(_map_pydantic_error(err) for err in exc.errors())
        return RuleValidationReport(valid=False, errors=errors)
    return RuleValidationReport(
        valid=True,
        errors=(),
        ruleset=ruleset,
        content_hash=ruleset.content_hash(),
    )
