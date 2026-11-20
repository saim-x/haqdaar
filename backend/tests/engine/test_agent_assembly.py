"""Pure fact assembly from mock payloads (docs/07 §7 step 8).

No DB, no HTTP: the case agent fetches, ``assemble_facts`` decides what the evidence
means. These tests pin the tri-state discipline — a registry that answered "not found"
is a KNOWN negative, a registry that was never asked is UNKNOWN.
"""

from __future__ import annotations

from datetime import date

import pytest
from app.agent.assemble import (
    ActiveBenefit,
    DeathRecord,
    DocumentRow,
    HouseholdRecord,
    assemble_facts,
    parse_active_benefits,
    parse_death_records,
    parse_household,
    parse_identity_matches,
)
from app.engine.anomalies import FlagCode
from app.engine.entity_resolution import IdentityCandidate, MatchOutcome
from app.engine.facts import FactState, MissingReason

TODAY = date(2026, 11, 20)

FATIMA_DRAFT = {
    "applicant_cnic": {"value": "9990010000012", "confirmed": True},
    "applicant_full_name": {"value": "Fatima Bibi", "confirmed": True},
    "applicant_dob": {"value": "1974-05-14", "confirmed": True},
    "applicant_district": {"value": "Thatta", "confirmed": True},
    "children_under_18": {"value": 3, "confirmed": True},
    "household_size": {"value": 4, "confirmed": True},
    "monthly_income_pkr": {"value": 28000, "confirmed": True},
    "payout_phone": {"value": "+923001000001", "confirmed": True},
}

FATIMA_CANDIDATE = IdentityCandidate(
    cnic_digits="9990010000012",
    full_name="Mst. Fatima Bibi",
    full_name_ur="مسماۃ فاطمہ بی بی",
    father_or_spouse_name="Ghulam Rasool",
    dob="1974-05-14",
    gender="F",
    district="Thatta",
    is_alive=True,
    cnic_expiry_date="2030-08-01",
    marital_status="WIDOWED",
)

FATIMA_HOUSEHOLD = HouseholdRecord(
    head_cnic="9990010000012",
    district="Thatta",
    household_size=4,
    monthly_income_pkr=28000,
    poverty_score=24,
    survey_year=2025,
)

FATIMA_DOCUMENTS = (
    DocumentRow("CNIC_FRONT", "VERIFIED", 0.96),
    DocumentRow("SPOUSE_DEATH_CERTIFICATE", "VERIFIED", 0.95),
)

FATIMA_DEATH = (
    DeathRecord(
        deceased_cnic="9990010000021",
        deceased_name="Ghulam Rasool",
        spouse_cnic="9990010000012",
        spouse_name="Fatima Bibi",
        death_date="2021-03-02",
        district="Thatta",
        certificate_no="DC-2021-000412",
    ),
)


def _assemble(**overrides):
    kwargs = {
        "draft_answers": FATIMA_DRAFT,
        "identity_matches": (FATIMA_CANDIDATE,),
        "death_records": FATIMA_DEATH,
        "household": FATIMA_HOUSEHOLD,
        "documents": FATIMA_DOCUMENTS,
        "program_code": "SAHARA_WIDOW_GRANT",
        "today": TODAY,
    }
    kwargs.update(overrides)
    return assemble_facts(**kwargs)


def _fact(assembled, key):
    return assembled.facts.facts[key]


# -- golden path ---------------------------------------------------------
def test_golden_path_resolves_identity_at_098() -> None:
    assembled = _assemble()
    assert assembled.identity.outcome is MatchOutcome.MATCH
    assert assembled.identity.confidence == 0.98
    assert assembled.identity_confidence == 0.98


def test_golden_path_has_no_flags() -> None:
    assert _assemble().flags == ()


def test_golden_path_facts_are_all_known() -> None:
    assembled = _assemble()
    unknown = [
        key
        for key, fact in assembled.facts.facts.items()
        if fact.state is FactState.UNKNOWN
    ]
    assert unknown == []


def test_registry_name_wins_over_the_declared_spelling() -> None:
    fact = _fact(_assemble(), "applicant_full_name")
    assert fact.value == "Mst. Fatima Bibi"
    assert fact.source.value == "IDENTITY_REGISTRY"


def test_age_is_derived_from_the_registry_dob() -> None:
    fact = _fact(_assemble(), "applicant_age_years")
    assert fact.value == 52  # 1974-05-14 -> 2026-11-20
    assert fact.source.value == "DERIVED"


def test_survey_income_wins_over_the_declared_income() -> None:
    fact = _fact(_assemble(), "monthly_income_pkr")
    assert fact.value == 28000
    assert fact.source.value == "HOUSEHOLD_SURVEY"


def test_assembly_is_deterministic() -> None:
    first = _assemble()
    second = _assemble()
    assert first.facts.snapshot_hash() == second.facts.snapshot_hash()
    assert [flag.code for flag in first.flags] == [flag.code for flag in second.flags]


# -- identity absent -----------------------------------------------------
def test_no_identity_match_leaves_registry_facts_unknown() -> None:
    assembled = _assemble(identity_matches=())
    for key in (
        "applicant_is_alive",
        "applicant_cnic_valid",
        "marital_status_widow",
    ):
        assert _fact(assembled, key).state is FactState.UNKNOWN
    assert _fact(assembled, "applicant_full_name").source.value == "SELF_DECLARED"


def test_no_identity_match_raises_cnic_not_in_registry() -> None:
    assembled = _assemble(identity_matches=())
    assert FlagCode.CNIC_NOT_IN_REGISTRY in {flag.code for flag in assembled.flags}


def test_expired_cnic_is_a_known_false() -> None:
    expired = FATIMA_CANDIDATE.model_copy(update={"cnic_expiry_date": "2024-01-01"})
    fact = _fact(_assemble(identity_matches=(expired,)), "applicant_cnic_valid")
    assert fact.state is FactState.KNOWN
    assert fact.value is False


def test_missing_expiry_date_is_unknown_not_valid() -> None:
    no_expiry = FATIMA_CANDIDATE.model_copy(update={"cnic_expiry_date": None})
    fact = _fact(_assemble(identity_matches=(no_expiry,)), "applicant_cnic_valid")
    assert fact.state is FactState.UNKNOWN


def test_two_candidates_without_cnic_are_never_silently_resolved() -> None:
    draft = dict(FATIMA_DRAFT)
    draft.pop("applicant_cnic")
    twin = FATIMA_CANDIDATE.model_copy(
        update={"cnic_digits": "9990010000099", "full_name": "Fatima Bibi"}
    )
    assembled = _assemble(
        draft_answers=draft, identity_matches=(FATIMA_CANDIDATE, twin)
    )
    assert assembled.identity.outcome is MatchOutcome.AMBIGUOUS
    assert assembled.identity.matched is None
    assert FlagCode.POSSIBLE_DUPLICATE_IDENTITY in {
        flag.code for flag in assembled.flags
    }


# -- household -----------------------------------------------------------
def test_household_not_found_falls_back_to_the_declared_income() -> None:
    assembled = _assemble(household=None)
    income = _fact(assembled, "monthly_income_pkr")
    assert income.value == 28000
    assert income.source.value == "SELF_DECLARED"
    assert _fact(assembled, "poverty_score").state is FactState.UNKNOWN


def test_household_without_income_falls_back_to_the_declared_income() -> None:
    partial = HouseholdRecord(household_size=4, monthly_income_pkr=None)
    income = _fact(_assemble(household=partial), "monthly_income_pkr")
    assert income.value == 28000
    assert income.source.value == "SELF_DECLARED"


def test_income_conflict_raises_the_flag() -> None:
    survey = HouseholdRecord(household_size=4, monthly_income_pkr=54000, poverty_score=24)
    assembled = _assemble(household=survey)
    assert FlagCode.DATA_CONFLICT_INCOME in {flag.code for flag in assembled.flags}


# -- benefits ------------------------------------------------------------
def test_empty_benefits_registry_is_a_known_false() -> None:
    fact = _fact(_assemble(active_benefits=()), "has_conflicting_active_grant")
    assert fact.state is FactState.KNOWN
    assert fact.value is False


def test_another_program_is_a_conflict() -> None:
    other = ActiveBenefit(program_name="GUZARA_ALLOWANCE", monthly_amount_pkr=8000)
    fact = _fact(_assemble(active_benefits=(other,)), "has_conflicting_active_grant")
    assert fact.value is True


def test_the_same_program_is_not_a_conflict() -> None:
    same = ActiveBenefit(program_name="Sahara Widow Grant", monthly_amount_pkr=15000)
    fact = _fact(_assemble(active_benefits=(same,)), "has_conflicting_active_grant")
    assert fact.value is False


def test_unqueried_benefits_registry_is_unknown() -> None:
    fact = _fact(
        _assemble(benefits_registry_queried=False), "has_conflicting_active_grant"
    )
    assert fact.state is FactState.UNKNOWN
    assert fact.missing_reason is MissingReason.SERVICE_UNAVAILABLE


# -- civil registry ------------------------------------------------------
def test_no_death_record_and_no_certificate_is_a_known_false() -> None:
    fact = _fact(
        _assemble(death_records=(), documents=(DocumentRow("CNIC_FRONT", "VERIFIED"),)),
        "spouse_death_verified",
    )
    assert fact.state is FactState.KNOWN
    assert fact.value is False


def test_verified_death_certificate_proves_widowhood() -> None:
    fact = _fact(_assemble(death_records=()), "spouse_death_verified")
    assert fact.value is True
    assert fact.source.value == "DOCUMENT_VERIFIER"


def test_unqueried_civil_registry_is_unknown() -> None:
    fact = _fact(
        _assemble(
            death_records=(),
            documents=(DocumentRow("CNIC_FRONT", "VERIFIED"),),
            civil_registry_queried=False,
        ),
        "spouse_death_verified",
    )
    assert fact.state is FactState.UNKNOWN
    assert fact.missing_reason is MissingReason.SERVICE_UNAVAILABLE


# -- documents -----------------------------------------------------------
def test_missing_cnic_document_is_unknown_not_false() -> None:
    fact = _fact(_assemble(documents=()), "cnic_doc_verified")
    assert fact.state is FactState.UNKNOWN
    assert fact.missing_reason is MissingReason.DOCUMENT_MISSING


def test_tampered_document_raises_tamper_suspected() -> None:
    tampered = DocumentRow("CNIC_FRONT", "TAMPER_SUSPECTED", 0.40)
    assembled = _assemble(documents=(tampered,))
    assert FlagCode.TAMPER_SUSPECTED in {flag.code for flag in assembled.flags}


def test_explicit_qr_check_overrides_the_status_default() -> None:
    row = DocumentRow(
        "CNIC_FRONT",
        "VERIFIED",
        0.96,
        verify_checks=({"check": "QR_SIGNATURE", "passed": False},),
    )
    assembled = _assemble(documents=(row,))
    assert FlagCode.TAMPER_SUSPECTED in {flag.code for flag in assembled.flags}


# -- draft answers -------------------------------------------------------
def test_unconfirmed_answer_is_unknown() -> None:
    draft = dict(FATIMA_DRAFT)
    draft["children_under_18"] = {"value": 3, "confirmed": False}
    fact = _fact(_assemble(draft_answers=draft), "children_under_18")
    assert fact.state is FactState.UNKNOWN


def test_missing_answer_is_unknown_with_a_reason() -> None:
    draft = dict(FATIMA_DRAFT)
    draft.pop("children_under_18")
    fact = _fact(_assemble(draft_answers=draft), "children_under_18")
    assert fact.state is FactState.UNKNOWN
    assert fact.missing_reason is MissingReason.NOT_PROVIDED


def test_string_numbers_are_coerced_to_the_registry_type() -> None:
    draft = dict(FATIMA_DRAFT)
    draft["children_under_18"] = {"value": "3", "confirmed": True}
    fact = _fact(_assemble(draft_answers=draft), "children_under_18")
    assert fact.value == 3
    assert isinstance(fact.value, int)


def test_unparseable_number_is_unknown_not_zero() -> None:
    draft = dict(FATIMA_DRAFT)
    draft["children_under_18"] = {"value": "many", "confirmed": True}
    fact = _fact(_assemble(draft_answers=draft), "children_under_18")
    assert fact.state is FactState.UNKNOWN


def test_bare_draft_value_counts_as_confirmed() -> None:
    draft = dict(FATIMA_DRAFT)
    draft["children_under_18"] = 3
    fact = _fact(_assemble(draft_answers=draft), "children_under_18")
    assert fact.value == 3


# -- payload adapters ----------------------------------------------------
def test_parse_identity_matches_skips_incomplete_rows() -> None:
    payload = {
        "simulated": True,
        "matches": [
            {"cnic_digits": "9990010000012", "full_name": "Mst. Fatima Bibi"},
            {"cnic_digits": "9990010000013"},
            {"full_name": "No CNIC"},
            "not a dict",
        ],
    }
    candidates = parse_identity_matches(payload)
    assert len(candidates) == 1
    assert candidates[0].full_name == "Mst. Fatima Bibi"


def test_parse_identity_matches_handles_none() -> None:
    assert parse_identity_matches(None) == ()


def test_parse_household_requires_found() -> None:
    assert parse_household({"found": False, "record": {"monthly_income_pkr": 1}}) is None
    assert parse_household(None) is None
    record = parse_household(
        {"found": True, "record": {"monthly_income_pkr": "28000", "household_size": 4}}
    )
    assert record is not None
    assert record.monthly_income_pkr == 28000
    assert record.household_size == 4


def test_parse_active_benefits_and_death_records() -> None:
    benefits = parse_active_benefits(
        {"active_benefits": [{"program_name": "Guzara", "monthly_amount_pkr": 8000}]}
    )
    assert benefits[0].program_name == "Guzara"
    assert benefits[0].monthly_amount_pkr == 8000

    deaths = parse_death_records(
        {"records": [{"spouse_cnic": "9990010000012", "death_date": "2021-03-02"}]}
    )
    assert deaths[0].spouse_cnic == "9990010000012"


@pytest.mark.parametrize("payload", [None, {}, {"matches": []}])
def test_empty_identity_payloads_are_safe(payload) -> None:
    assert parse_identity_matches(payload) == ()
