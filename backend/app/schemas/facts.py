"""Canonical fact keys and the tri-state fact object (docs/04 §5).

Unknown is a first-class value: a fact is either ``KNOWN`` with a value, or
``UNKNOWN`` with a ``missing_reason``. Nothing here ever substitutes a default
for missing data.
"""

from __future__ import annotations

from typing import Any

from app.models.enums import FactState

#: docs/04 §5 — the only fact keys the wizard, agent and rules engine may use.
CANONICAL_FACT_KEYS: tuple[str, ...] = (
    "applicant_cnic",
    "applicant_full_name",
    "applicant_dob",
    "applicant_age_years",
    "applicant_is_alive",
    "applicant_cnic_valid",
    "applicant_district",
    "marital_status_widow",
    "spouse_death_verified",
    "spouse_full_name",
    "spouse_cnic",
    "children_under_18",
    "household_size",
    "monthly_income_pkr",
    "poverty_score",
    "has_conflicting_active_grant",
    "payout_phone",
    "cnic_doc_verified",
    "death_cert_doc_verified",
    "citizen_has_active_dept_consent",
)

CANONICAL_FACT_KEY_SET = frozenset(CANONICAL_FACT_KEYS)

#: Facts a citizen may self-declare through the wizard.
SELF_DECLARABLE_FACT_KEYS = frozenset(
    {
        "applicant_cnic",
        "applicant_full_name",
        "applicant_dob",
        "applicant_district",
        "marital_status_widow",
        "spouse_full_name",
        "spouse_cnic",
        "children_under_18",
        "household_size",
        "monthly_income_pkr",
        "payout_phone",
    }
)

MISSING_REASONS = frozenset(
    {"USER_UNKNOWN", "NOT_ASKED", "SERVICE_UNAVAILABLE", "DOC_UNREADABLE", "NOT_APPLICABLE"}
)


def unknown_fact(*, entered_by: str = "CITIZEN", missing_reason: str = "NOT_ASKED") -> dict[str, Any]:
    return {
        "state": FactState.UNKNOWN.value,
        "value": None,
        "source": None,
        "source_confidence": 0.0,
        "entered_by": entered_by,
        "alternatives": [],
        "conflict": False,
        "missing_reason": missing_reason,
    }


def normalize_fact(raw: Any, *, entered_by: str = "CITIZEN") -> dict[str, Any]:
    """Coerce a wizard answer into the frozen fact-object shape.

    Accepts either a bare value (``28000``) or a partial fact object
    (``{"value": 28000, "confirmed": true}``). A missing/``null`` value stays
    ``UNKNOWN`` — never zero, never an empty string.
    """
    if isinstance(raw, dict):
        value = raw.get("value")
        state = raw.get("state")
        missing_reason = raw.get("missing_reason") or "USER_UNKNOWN"
        source = raw.get("source") or "SELF_DECLARED"
        confidence = raw.get("source_confidence")
        alternatives = raw.get("alternatives") or []
        conflict = bool(raw.get("conflict", False))
        fact_entered_by = raw.get("entered_by") or entered_by
    else:
        value = raw
        state = None
        missing_reason = "USER_UNKNOWN"
        source = "SELF_DECLARED"
        confidence = None
        alternatives = []
        conflict = False
        fact_entered_by = entered_by

    if state == FactState.UNKNOWN.value or value is None or value == "":
        fact = unknown_fact(entered_by=fact_entered_by, missing_reason=missing_reason)
        fact["alternatives"] = alternatives
        fact["conflict"] = conflict
        return fact

    return {
        "state": FactState.KNOWN.value,
        "value": value,
        "source": source,
        "source_confidence": float(confidence) if confidence is not None else 1.0,
        "entered_by": fact_entered_by,
        "alternatives": alternatives,
        "conflict": conflict,
        "missing_reason": None,
    }


def is_known(fact: Any) -> bool:
    return isinstance(fact, dict) and fact.get("state") == FactState.KNOWN.value


def fact_value(fact: Any) -> Any:
    return fact.get("value") if is_known(fact) else None


def missing_facts(answers: dict[str, Any], required: list[str] | tuple[str, ...]) -> list[str]:
    return [key for key in required if not is_known((answers or {}).get(key))]


__all__ = [
    "CANONICAL_FACT_KEYS",
    "CANONICAL_FACT_KEY_SET",
    "MISSING_REASONS",
    "SELF_DECLARABLE_FACT_KEYS",
    "fact_value",
    "is_known",
    "missing_facts",
    "normalize_fact",
    "unknown_fact",
]
