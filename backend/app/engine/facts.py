"""Canonical fact registry and tri-state fact bundle.

Source of truth: ``docs/04-data-model.md`` §5 (Canonical Fact Keys) and
``docs/06-decision-engine.md`` §2.3 (tri-state evaluation).

Invariants enforced here:
* Every fact key evaluated by the rules engine exists in :data:`FACT_REGISTRY`.
* A fact is either ``KNOWN`` (with a typed value) or ``UNKNOWN`` (with ``None``).
  ``UNKNOWN`` never carries a value and is never coerced to a default.
* The snapshot serialisation is canonical, so identical bundles always hash
  identically (audit proof, docs/04 §4.3 ``input_snapshot_hash``).

Purity: stdlib + pydantic only. No DB, HTTP, or AI imports.
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Iterator
from datetime import date
from enum import Enum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, model_validator

__all__ = [
    "FACT_REGISTRY",
    "EnteredBy",
    "Fact",
    "FactAlternative",
    "FactBundle",
    "FactSource",
    "FactSpec",
    "FactState",
    "FactValueType",
    "MissingReason",
    "derive_age_years",
    "is_valid_cnic",
    "known_fact",
    "parse_iso_date",
    "unknown_fact",
]


class FactState(str, Enum):
    """Tri-state membership. There is no third "maybe" value: unknown is unknown."""

    KNOWN = "KNOWN"
    UNKNOWN = "UNKNOWN"


class FactValueType(str, Enum):
    STRING = "string"
    INT = "int"
    BOOL = "bool"


class FactSource(str, Enum):
    """Provenance values used by docs/04 §5 "Primary Sources"."""

    DOCUMENT_QR = "DOCUMENT_QR"
    SELF_DECLARED = "SELF_DECLARED"
    IDENTITY_REGISTRY = "IDENTITY_REGISTRY"
    CIVIL_REGISTRY = "CIVIL_REGISTRY"
    HOUSEHOLD_SURVEY = "HOUSEHOLD_SURVEY"
    BENEFITS_REGISTRY = "BENEFITS_REGISTRY"
    DOCUMENT_VERIFIER = "DOCUMENT_VERIFIER"
    CONSENT_ENGINE = "CONSENT_ENGINE"
    DERIVED = "DERIVED"


class EnteredBy(str, Enum):
    CITIZEN = "CITIZEN"
    HELPER = "HELPER"
    OFFICER = "OFFICER"
    SYSTEM = "SYSTEM"


class MissingReason(str, Enum):
    """Why a fact is ``UNKNOWN``. Recorded, never guessed around."""

    USER_UNKNOWN = "USER_UNKNOWN"
    NOT_PROVIDED = "NOT_PROVIDED"
    NOT_APPLICABLE = "NOT_APPLICABLE"
    SERVICE_UNAVAILABLE = "SERVICE_UNAVAILABLE"
    DOCUMENT_MISSING = "DOCUMENT_MISSING"


class FactSpec(BaseModel):
    """Registry entry for one canonical fact key."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    key: str
    value_type: FactValueType
    tri_state_allowed: bool
    sources: tuple[FactSource, ...]
    description_en: str


def _spec(
    key: str,
    value_type: FactValueType,
    sources: tuple[FactSource, ...],
    description_en: str,
    *,
    tri_state_allowed: bool = True,
) -> FactSpec:
    return FactSpec(
        key=key,
        value_type=value_type,
        tri_state_allowed=tri_state_allowed,
        sources=sources,
        description_en=description_en,
    )


#: docs/04-data-model.md §5 - the complete canonical fact contract (20 keys).
FACT_REGISTRY: dict[str, FactSpec] = {
    spec.key: spec
    for spec in (
        _spec(
            "applicant_cnic",
            FactValueType.STRING,
            (FactSource.DOCUMENT_QR, FactSource.SELF_DECLARED),
            "Applicant CNIC, 13 digits.",
        ),
        _spec(
            "applicant_full_name",
            FactValueType.STRING,
            (
                FactSource.IDENTITY_REGISTRY,
                FactSource.DOCUMENT_QR,
                FactSource.SELF_DECLARED,
            ),
            "Applicant full name as declared or registered.",
        ),
        _spec(
            "applicant_dob",
            FactValueType.STRING,
            (
                FactSource.IDENTITY_REGISTRY,
                FactSource.DOCUMENT_QR,
                FactSource.SELF_DECLARED,
            ),
            "Applicant date of birth, ISO YYYY-MM-DD.",
        ),
        _spec(
            "applicant_age_years",
            FactValueType.INT,
            (FactSource.DERIVED,),
            "Applicant age in whole years, derived from applicant_dob.",
        ),
        _spec(
            "applicant_is_alive",
            FactValueType.BOOL,
            (FactSource.IDENTITY_REGISTRY,),
            "Identity registry liveness flag.",
        ),
        _spec(
            "applicant_cnic_valid",
            FactValueType.BOOL,
            (FactSource.IDENTITY_REGISTRY,),
            "CNIC expiry date is today or later.",
        ),
        _spec(
            "applicant_district",
            FactValueType.STRING,
            (
                FactSource.SELF_DECLARED,
                FactSource.IDENTITY_REGISTRY,
                FactSource.HOUSEHOLD_SURVEY,
            ),
            "Applicant district of residence.",
        ),
        _spec(
            "marital_status_widow",
            FactValueType.BOOL,
            (
                FactSource.CIVIL_REGISTRY,
                FactSource.DOCUMENT_QR,
                FactSource.IDENTITY_REGISTRY,
            ),
            "Applicant is recorded as widowed.",
        ),
        _spec(
            "spouse_death_verified",
            FactValueType.BOOL,
            (FactSource.CIVIL_REGISTRY, FactSource.DOCUMENT_QR),
            "Spouse death confirmed by civil registry or death certificate.",
        ),
        _spec(
            "spouse_full_name",
            FactValueType.STRING,
            (FactSource.SELF_DECLARED, FactSource.CIVIL_REGISTRY),
            "Deceased spouse full name.",
        ),
        _spec(
            "spouse_cnic",
            FactValueType.STRING,
            (FactSource.SELF_DECLARED, FactSource.CIVIL_REGISTRY),
            "Deceased spouse CNIC, 13 digits.",
        ),
        _spec(
            "children_under_18",
            FactValueType.INT,
            (FactSource.SELF_DECLARED, FactSource.HOUSEHOLD_SURVEY),
            "Number of living children under 18 in the household.",
        ),
        _spec(
            "household_size",
            FactValueType.INT,
            (FactSource.HOUSEHOLD_SURVEY, FactSource.SELF_DECLARED),
            "Total household members.",
        ),
        _spec(
            "monthly_income_pkr",
            FactValueType.INT,
            (FactSource.HOUSEHOLD_SURVEY, FactSource.SELF_DECLARED),
            "Monthly household income in PKR.",
        ),
        _spec(
            "poverty_score",
            FactValueType.INT,
            (FactSource.HOUSEHOLD_SURVEY,),
            "Household survey poverty score, 0-100.",
        ),
        _spec(
            "has_conflicting_active_grant",
            FactValueType.BOOL,
            (FactSource.BENEFITS_REGISTRY,),
            "Another active relief grant exists for this household.",
        ),
        _spec(
            "payout_phone",
            FactValueType.STRING,
            (FactSource.SELF_DECLARED,),
            "Raast payout mobile alias.",
        ),
        _spec(
            "cnic_doc_verified",
            FactValueType.BOOL,
            (FactSource.DOCUMENT_VERIFIER,),
            "CNIC document passed verification.",
        ),
        _spec(
            "death_cert_doc_verified",
            FactValueType.BOOL,
            (FactSource.DOCUMENT_VERIFIER,),
            "Spouse death certificate passed verification.",
        ),
        _spec(
            "citizen_has_active_dept_consent",
            FactValueType.BOOL,
            (FactSource.CONSENT_ENGINE,),
            "Active department consent exists for this case.",
            tri_state_allowed=False,
        ),
    )
}


def _value_matches_type(value: Any, value_type: FactValueType) -> bool:
    """Strict type check. ``bool`` is never accepted as ``int`` (and vice versa)."""
    if value_type is FactValueType.STRING:
        return isinstance(value, str)
    if value_type is FactValueType.INT:
        return isinstance(value, int) and not isinstance(value, bool)
    if value_type is FactValueType.BOOL:
        return isinstance(value, bool)
    return False


class FactAlternative(BaseModel):
    """A competing value from a lower-precedence source (docs/04 §5 example)."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    value: str | int | bool | None = None
    source: FactSource | None = None
    entered_by: EnteredBy = EnteredBy.SYSTEM


class Fact(BaseModel):
    """One canonical fact with full provenance (docs/04 §5 "Fact Object Shape")."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    state: FactState
    value: str | int | bool | None = None
    source: FactSource | None = None
    source_confidence: float = Field(default=0.0, ge=0.0, le=1.0)
    entered_by: EnteredBy = EnteredBy.SYSTEM
    alternatives: tuple[FactAlternative, ...] = ()
    conflict: bool = False
    missing_reason: MissingReason | None = None

    @model_validator(mode="after")
    def _state_matches_value(self) -> Fact:
        if self.state is FactState.UNKNOWN:
            if self.value is not None:
                raise ValueError(
                    "UNKNOWN fact must not carry a value; unknown is never coerced"
                )
            if self.source is not None:
                raise ValueError("UNKNOWN fact must not claim a source")
        else:
            if self.value is None:
                raise ValueError("KNOWN fact requires a value")
            if self.missing_reason is not None:
                raise ValueError("KNOWN fact must not carry a missing_reason")
        return self

    @property
    def is_known(self) -> bool:
        return self.state is FactState.KNOWN


def known_fact(
    key: str,
    value: str | int | bool,
    *,
    source: FactSource,
    source_confidence: float = 1.0,
    entered_by: EnteredBy = EnteredBy.SYSTEM,
    alternatives: tuple[FactAlternative, ...] = (),
    conflict: bool = False,
) -> Fact:
    """Build a ``KNOWN`` fact. Type is validated against the registry."""
    spec = FACT_REGISTRY.get(key)
    if spec is None:
        raise KeyError(f"unknown canonical fact key: {key!r}")
    if not _value_matches_type(value, spec.value_type):
        raise TypeError(
            f"fact {key!r} expects {spec.value_type.value}, got {type(value).__name__}"
        )
    return Fact(
        state=FactState.KNOWN,
        value=value,
        source=source,
        source_confidence=source_confidence,
        entered_by=entered_by,
        alternatives=alternatives,
        conflict=conflict,
    )


def unknown_fact(
    key: str,
    *,
    entered_by: EnteredBy = EnteredBy.SYSTEM,
    missing_reason: MissingReason = MissingReason.NOT_PROVIDED,
    alternatives: tuple[FactAlternative, ...] = (),
    conflict: bool = False,
) -> Fact:
    """Build an ``UNKNOWN`` fact. No value, no source, no default."""
    if key not in FACT_REGISTRY:
        raise KeyError(f"unknown canonical fact key: {key!r}")
    return Fact(
        state=FactState.UNKNOWN,
        value=None,
        source=None,
        source_confidence=0.0,
        entered_by=entered_by,
        alternatives=alternatives,
        conflict=conflict,
        missing_reason=missing_reason,
    )


class FactBundle(BaseModel):
    """The complete tri-state fact set handed to the rules engine."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    facts: dict[str, Fact] = Field(default_factory=dict)

    @model_validator(mode="after")
    def _validate_against_registry(self) -> FactBundle:
        for key, fact in self.facts.items():
            spec = FACT_REGISTRY.get(key)
            if spec is None:
                raise ValueError(f"fact key {key!r} is not in the canonical registry")
            if fact.state is FactState.KNOWN:
                if not _value_matches_type(fact.value, spec.value_type):
                    raise ValueError(
                        f"fact {key!r} expects {spec.value_type.value}, "
                        f"got {type(fact.value).__name__}"
                    )
            elif not spec.tri_state_allowed:
                raise ValueError(f"fact {key!r} must always be KNOWN")
        return self

    # -- read access -----------------------------------------------------
    def __contains__(self, key: object) -> bool:
        return key in self.facts

    def __len__(self) -> int:
        return len(self.facts)

    def __iter__(self) -> Iterator[str]:  # type: ignore[override]
        return iter(self.facts)

    def get(self, key: str) -> Fact | None:
        return self.facts.get(key)

    def require(self, key: str) -> Fact:
        fact = self.facts.get(key)
        if fact is None:
            raise KeyError(f"fact {key!r} is absent from the bundle")
        return fact

    def is_known(self, key: str) -> bool:
        fact = self.facts.get(key)
        return fact is not None and fact.state is FactState.KNOWN

    def value(self, key: str) -> Any:
        """Return the value of a ``KNOWN`` fact, else ``None``. Never a default."""
        fact = self.facts.get(key)
        if fact is None or fact.state is FactState.UNKNOWN:
            return None
        return fact.value

    def known_keys(self) -> tuple[str, ...]:
        return tuple(sorted(k for k, f in self.facts.items() if f.is_known))

    def unknown_keys(self) -> tuple[str, ...]:
        return tuple(sorted(k for k, f in self.facts.items() if not f.is_known))

    # -- immutable updates ----------------------------------------------
    def with_fact(self, key: str, fact: Fact) -> FactBundle:
        merged = dict(self.facts)
        merged[key] = fact
        return FactBundle(facts=merged)

    def merge(self, other: FactBundle) -> FactBundle:
        merged = dict(self.facts)
        merged.update(other.facts)
        return FactBundle(facts=merged)

    # -- canonical serialisation (audit proof) --------------------------
    def to_snapshot(self) -> dict[str, dict[str, Any]]:
        return {
            key: {
                "state": fact.state.value,
                "value": fact.value,
                "source": fact.source.value if fact.source else None,
                "source_confidence": fact.source_confidence,
                "entered_by": fact.entered_by.value,
                "alternatives": [
                    {
                        "value": alt.value,
                        "source": alt.source.value if alt.source else None,
                        "entered_by": alt.entered_by.value,
                    }
                    for alt in fact.alternatives
                ],
                "conflict": fact.conflict,
                "missing_reason": (
                    fact.missing_reason.value if fact.missing_reason else None
                ),
            }
            for key, fact in sorted(self.facts.items())
        }

    def snapshot_json(self) -> str:
        """Canonical JSON: sorted keys, no whitespace, UTF-8 preserved."""
        return json.dumps(
            self.to_snapshot(),
            sort_keys=True,
            separators=(",", ":"),
            ensure_ascii=False,
        )

    def snapshot_hash(self) -> str:
        return hashlib.sha256(self.snapshot_json().encode("utf-8")).hexdigest()

    @classmethod
    def from_snapshot(cls, snapshot: dict[str, Any]) -> FactBundle:
        """Rebuild a bundle from a stored ``input_snapshot_json`` payload."""
        return cls(facts={key: Fact.model_validate(payload) for key, payload in snapshot.items()})


def is_valid_cnic(value: str | None) -> bool:
    """13 ASCII digits. Format only - registry existence is a separate check."""
    if not isinstance(value, str) or len(value) != 13:
        return False
    return value.isascii() and value.isdigit()


def parse_iso_date(value: str | None) -> date | None:
    """Parse ``YYYY-MM-DD``; return ``None`` for anything unparseable."""
    if not isinstance(value, str) or len(value) != 10:
        return None
    try:
        return date.fromisoformat(value)
    except ValueError:
        return None


def derive_age_years(dob_iso: str | None, today: date) -> int | None:
    """Whole years between ``dob_iso`` and ``today``; ``None`` when unknown."""
    dob = parse_iso_date(dob_iso)
    if dob is None or dob > today:
        return None
    years = today.year - dob.year
    if (today.month, today.day) < (dob.month, dob.day):
        years -= 1
    return years
