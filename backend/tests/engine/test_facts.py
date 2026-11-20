"""Canonical fact registry and tri-state bundle (docs/04 §5, docs/06 §2.3)."""

from __future__ import annotations

from datetime import date

import pytest
from app.engine.facts import (
    FACT_REGISTRY,
    EnteredBy,
    Fact,
    FactAlternative,
    FactBundle,
    FactSource,
    FactState,
    FactValueType,
    MissingReason,
    derive_age_years,
    is_valid_cnic,
    known_fact,
    parse_iso_date,
    unknown_fact,
)
from pydantic import ValidationError

#: docs/04-data-model.md §5, verbatim.
CANONICAL_KEYS = {
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
}


def test_registry_matches_frozen_contract_exactly() -> None:
    assert set(FACT_REGISTRY) == CANONICAL_KEYS
    assert len(FACT_REGISTRY) == 20


def test_registry_types_match_the_contract() -> None:
    assert FACT_REGISTRY["applicant_cnic"].value_type is FactValueType.STRING
    assert FACT_REGISTRY["applicant_age_years"].value_type is FactValueType.INT
    assert FACT_REGISTRY["applicant_is_alive"].value_type is FactValueType.BOOL
    assert FACT_REGISTRY["monthly_income_pkr"].value_type is FactValueType.INT


def test_only_consent_fact_is_not_tri_state() -> None:
    not_tri_state = {
        key for key, spec in FACT_REGISTRY.items() if not spec.tri_state_allowed
    }
    assert not_tri_state == {"citizen_has_active_dept_consent"}


def test_unknown_fact_cannot_carry_a_value() -> None:
    with pytest.raises(ValidationError):
        Fact(state=FactState.UNKNOWN, value=28000)


def test_known_fact_requires_a_value() -> None:
    with pytest.raises(ValidationError):
        Fact(state=FactState.KNOWN, value=None)


def test_unknown_fact_cannot_claim_a_source() -> None:
    with pytest.raises(ValidationError):
        Fact(state=FactState.UNKNOWN, source=FactSource.HOUSEHOLD_SURVEY)


def test_known_fact_cannot_carry_a_missing_reason() -> None:
    with pytest.raises(ValidationError):
        Fact(
            state=FactState.KNOWN,
            value=1,
            missing_reason=MissingReason.USER_UNKNOWN,
        )


def test_bundle_rejects_unknown_fact_key() -> None:
    with pytest.raises(ValidationError):
        FactBundle(facts={"monthly_salary_pkr": known_fact("monthly_income_pkr", 1, source=FactSource.SELF_DECLARED)})


def test_bundle_rejects_wrong_value_type() -> None:
    with pytest.raises(ValidationError):
        FactBundle(
            facts={
                "monthly_income_pkr": Fact(
                    state=FactState.KNOWN, value="28000"
                )
            }
        )


def test_bundle_rejects_bool_masquerading_as_int() -> None:
    with pytest.raises(ValidationError):
        FactBundle(
            facts={"children_under_18": Fact(state=FactState.KNOWN, value=True)}
        )


def test_bundle_rejects_unknown_for_non_tri_state_fact() -> None:
    with pytest.raises(ValidationError):
        FactBundle(
            facts={
                "citizen_has_active_dept_consent": unknown_fact(
                    "citizen_has_active_dept_consent"
                )
            }
        )


def test_known_fact_helper_rejects_wrong_type() -> None:
    with pytest.raises(TypeError):
        known_fact("monthly_income_pkr", "28000", source=FactSource.SELF_DECLARED)


def test_known_fact_helper_rejects_unknown_key() -> None:
    with pytest.raises(KeyError):
        known_fact("monthly_salary_pkr", 1, source=FactSource.SELF_DECLARED)


def test_value_never_substitutes_a_default(fatima_facts: FactBundle) -> None:
    bundle = fatima_facts.with_fact(
        "monthly_income_pkr",
        unknown_fact("monthly_income_pkr", missing_reason=MissingReason.USER_UNKNOWN),
    )
    assert bundle.value("monthly_income_pkr") is None
    assert bundle.is_known("monthly_income_pkr") is False
    assert "monthly_income_pkr" in bundle.unknown_keys()


def test_missing_fact_reads_as_none_not_zero(fatima_facts: FactBundle) -> None:
    assert fatima_facts.value("poverty_score") == 24
    assert fatima_facts.get("spouse_cnic") is not None
    assert fatima_facts.value("not_a_fact") is None


def test_snapshot_hash_is_deterministic_and_order_independent(
    fatima_facts: FactBundle,
) -> None:
    reordered = FactBundle(facts=dict(reversed(list(fatima_facts.facts.items()))))
    assert fatima_facts.snapshot_hash() == reordered.snapshot_hash()
    assert len(fatima_facts.snapshot_hash()) == 64


def test_snapshot_hash_changes_when_a_value_changes(fatima_facts: FactBundle) -> None:
    changed = fatima_facts.with_fact(
        "monthly_income_pkr",
        known_fact(
            "monthly_income_pkr", 29000, source=FactSource.HOUSEHOLD_SURVEY
        ),
    )
    assert changed.snapshot_hash() != fatima_facts.snapshot_hash()


def test_snapshot_round_trips(fatima_facts: FactBundle) -> None:
    rebuilt = FactBundle.from_snapshot(fatima_facts.to_snapshot())
    assert rebuilt.snapshot_hash() == fatima_facts.snapshot_hash()


def test_snapshot_shape_matches_docs_04_section_5(fatima_facts: FactBundle) -> None:
    snapshot = fatima_facts.to_snapshot()
    assert set(snapshot["monthly_income_pkr"]) == {
        "state",
        "value",
        "source",
        "source_confidence",
        "entered_by",
        "alternatives",
        "conflict",
        "missing_reason",
    }
    assert snapshot["monthly_income_pkr"]["state"] == "KNOWN"
    assert snapshot["monthly_income_pkr"]["source"] == "HOUSEHOLD_SURVEY"


def test_alternatives_are_preserved_for_conflicting_sources() -> None:
    fact = known_fact(
        "monthly_income_pkr",
        55000,
        source=FactSource.HOUSEHOLD_SURVEY,
        source_confidence=0.92,
        alternatives=(
            FactAlternative(
                value=25000,
                source=FactSource.SELF_DECLARED,
                entered_by=EnteredBy.HELPER,
            ),
        ),
        conflict=True,
    )
    bundle = FactBundle(facts={"monthly_income_pkr": fact})
    snapshot = bundle.to_snapshot()["monthly_income_pkr"]
    assert snapshot["conflict"] is True
    assert snapshot["alternatives"][0]["value"] == 25000
    assert snapshot["alternatives"][0]["entered_by"] == "HELPER"


def test_cnic_format_helper() -> None:
    assert is_valid_cnic("9990010000012") is True
    assert is_valid_cnic("999001000001") is False
    assert is_valid_cnic("999001000001X") is False
    assert is_valid_cnic(None) is False


def test_age_derivation() -> None:
    assert derive_age_years("1974-05-14", date(2026, 11, 20)) == 52
    assert derive_age_years("1974-12-14", date(2026, 11, 20)) == 51
    assert derive_age_years(None, date(2026, 11, 20)) is None
    assert derive_age_years("not-a-date", date(2026, 11, 20)) is None


def test_iso_date_parsing() -> None:
    assert parse_iso_date("1974-05-14") == date(1974, 5, 14)
    assert parse_iso_date("14/05/1974") is None
    assert parse_iso_date(None) is None
