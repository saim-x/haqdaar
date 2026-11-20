"""Anomaly and fraud flag catalogue (docs/06 §6, docs/13 §2.4)."""

from __future__ import annotations

from datetime import date

import pytest
from app.engine.anomalies import (
    FLAG_CATALOGUE,
    DocumentCheck,
    FlagCode,
    FlagSeverity,
    PayoutUsage,
    PriorCase,
    RiskFlag,
    detect_applicant_deceased,
    detect_cnic_gender_mismatch,
    detect_cnic_not_in_registry,
    detect_data_conflict_income,
    detect_duplicate_application,
    detect_helper_velocity,
    detect_identity_conflict,
    detect_identity_name_variant,
    detect_low_assurance_consent,
    detect_payout_account_shared,
    detect_payout_name_mismatch,
    detect_possible_duplicate_identity,
    detect_tamper_suspected,
    run_anomaly_checks,
    sort_flags,
)
from pydantic import ValidationError

TODAY = date(2026, 11, 20)


def _flag(code: FlagCode) -> RiskFlag:
    return RiskFlag(
        code=code,
        severity=FLAG_CATALOGUE[code],
        detail_en=code.value,
        detail_ur=code.value,
    )


# -- catalogue -----------------------------------------------------------
def test_catalogue_has_the_frozen_codes_and_severities() -> None:
    expected = {
        "TAMPER_SUSPECTED": "HIGH",
        "DUPLICATE_APPLICATION": "HIGH",
        "IDENTITY_CONFLICT": "HIGH",
        "POSSIBLE_DUPLICATE_IDENTITY": "HIGH",
        "APPLICANT_DECEASED": "HIGH",
        "PAYOUT_ACCOUNT_SHARED": "HIGH",
        "DATA_CONFLICT_INCOME": "MEDIUM",
        "PAYOUT_NAME_MISMATCH": "MEDIUM",
        "IDENTITY_NAME_VARIANT_CHECK": "MEDIUM",
        "HELPER_HIGH_VELOCITY": "MEDIUM",
        "LOW_ASSURANCE_CONSENT": "MEDIUM",
        "CNIC_GENDER_MISMATCH": "LOW",
        "CNIC_NOT_IN_REGISTRY": "HIGH",
    }
    assert {code.value: severity.value for code, severity in FLAG_CATALOGUE.items()} == expected


def test_severity_cannot_be_downgraded_by_a_caller() -> None:
    with pytest.raises(ValidationError):
        RiskFlag(
            code=FlagCode.TAMPER_SUSPECTED,
            severity=FlagSeverity.LOW,
            detail_en="x",
            detail_ur="x",
        )


def test_flag_json_shape() -> None:
    payload = _flag(FlagCode.DATA_CONFLICT_INCOME).to_json()
    assert set(payload) == {"code", "severity", "detail", "detail_ur", "evidence"}


def test_sort_flags_is_severity_then_code() -> None:
    flags = [
        _flag(FlagCode.CNIC_GENDER_MISMATCH),
        _flag(FlagCode.DATA_CONFLICT_INCOME),
        _flag(FlagCode.TAMPER_SUSPECTED),
        _flag(FlagCode.APPLICANT_DECEASED),
    ]
    ordered = [flag.code for flag in sort_flags(flags)]
    assert ordered == [
        FlagCode.APPLICANT_DECEASED,
        FlagCode.TAMPER_SUSPECTED,
        FlagCode.DATA_CONFLICT_INCOME,
        FlagCode.CNIC_GENDER_MISMATCH,
    ]


# -- tamper --------------------------------------------------------------
def _check(**overrides: object) -> DocumentCheck:
    payload: dict[str, object] = {
        "doc_type": "CNIC_FRONT",
        "qr_signature_valid": True,
        "ocr_qr_name_match": True,
        "ocr_qr_cnic_match": True,
    }
    payload.update(overrides)
    return DocumentCheck.model_validate(payload)


def test_clean_documents_raise_no_tamper_flag() -> None:
    assert detect_tamper_suspected([_check()]) is None


@pytest.mark.parametrize(
    "overrides",
    [
        {"qr_signature_valid": False},
        {"ocr_qr_name_match": False},
        {"ocr_qr_cnic_match": False},
    ],
)
def test_tamper_triggers_on_any_failed_check(overrides: dict[str, object]) -> None:
    flag = detect_tamper_suspected([_check(**overrides)])
    assert flag is not None
    assert flag.code is FlagCode.TAMPER_SUSPECTED
    assert flag.severity is FlagSeverity.HIGH


def test_tamper_checks_every_document() -> None:
    flag = detect_tamper_suspected(
        [_check(), _check(doc_type="SPOUSE_DEATH_CERTIFICATE", qr_signature_valid=False)]
    )
    assert flag is not None
    assert flag.evidence["doc_type"] == "SPOUSE_DEATH_CERTIFICATE"


# -- duplicate application ----------------------------------------------
def _prior(**overrides: object) -> PriorCase:
    payload: dict[str, object] = {
        "case_id": "HQ-2026-000100",
        "cnic_digits": "9990010000012",
        "program_code": "SAHARA_WIDOW_GRANT",
        "status": "HUMAN_REVIEW",
        "created_at": date(2026, 11, 1),
    }
    payload.update(overrides)
    return PriorCase.model_validate(payload)


def test_duplicate_application_within_90_days() -> None:
    flag = detect_duplicate_application(
        "9990010000012", [_prior()], "SAHARA_WIDOW_GRANT", TODAY
    )
    assert flag is not None
    assert flag.code is FlagCode.DUPLICATE_APPLICATION


@pytest.mark.parametrize("status", ["WITHDRAWN", "REJECTED"])
def test_withdrawn_or_rejected_cases_do_not_count(status: str) -> None:
    assert (
        detect_duplicate_application(
            "9990010000012", [_prior(status=status)], "SAHARA_WIDOW_GRANT", TODAY
        )
        is None
    )


def test_old_cases_do_not_count() -> None:
    assert (
        detect_duplicate_application(
            "9990010000012",
            [_prior(created_at=date(2026, 1, 1))],
            "SAHARA_WIDOW_GRANT",
            TODAY,
        )
        is None
    )


def test_other_programs_do_not_count() -> None:
    assert (
        detect_duplicate_application(
            "9990010000012", [_prior()], "GUZARA_ALLOWANCE", TODAY
        )
        is None
    )


def test_other_cnics_do_not_count() -> None:
    assert (
        detect_duplicate_application(
            "9990010000099", [_prior()], "SAHARA_WIDOW_GRANT", TODAY
        )
        is None
    )


# -- identity ------------------------------------------------------------
def test_identity_conflict_below_055() -> None:
    flag = detect_identity_conflict(0.54)
    assert flag is not None and flag.code is FlagCode.IDENTITY_CONFLICT


def test_identity_conflict_at_055_is_not_raised() -> None:
    assert detect_identity_conflict(0.55) is None


def test_possible_duplicate_identity_needs_two_candidates() -> None:
    assert detect_possible_duplicate_identity(1) is None
    flag = detect_possible_duplicate_identity(2)
    assert flag is not None
    assert flag.code is FlagCode.POSSIBLE_DUPLICATE_IDENTITY


def test_applicant_deceased_only_on_explicit_false() -> None:
    assert detect_applicant_deceased(True) is None
    assert detect_applicant_deceased(None) is None
    flag = detect_applicant_deceased(False)
    assert flag is not None
    assert flag.code is FlagCode.APPLICANT_DECEASED


def test_cnic_not_in_registry() -> None:
    assert detect_cnic_not_in_registry(None) is None
    flag = detect_cnic_not_in_registry("9990010000099")
    assert flag is not None
    assert flag.code is FlagCode.CNIC_NOT_IN_REGISTRY
    assert flag.evidence["cnic_last4"] == "0099"


def test_identity_name_variant_band() -> None:
    assert detect_identity_name_variant(0.54) is None
    assert detect_identity_name_variant(0.55) is not None
    assert detect_identity_name_variant(0.69) is not None
    assert detect_identity_name_variant(0.70) is None


# -- payout --------------------------------------------------------------
def test_shared_payout_alias_across_two_citizens() -> None:
    usages = [
        PayoutUsage(citizen_id="c1", alias="+923001000001", alias_kind="PAYOUT"),
        PayoutUsage(citizen_id="c2", alias="+923001000001", alias_kind="PAYOUT"),
    ]
    flag = detect_payout_account_shared("+923001000001", usages)
    assert flag is not None
    assert flag.code is FlagCode.PAYOUT_ACCOUNT_SHARED
    assert flag.evidence["other_citizen_count"] == 2


def test_single_payout_alias_is_fine() -> None:
    usages = [
        PayoutUsage(citizen_id="c1", alias="+923001000001", alias_kind="PAYOUT"),
    ]
    assert detect_payout_account_shared("+923001000001", usages) is None


def test_helper_contact_phone_shared_by_ten_citizens_is_not_a_flag() -> None:
    """docs/13 §2.4: a helper's shared contact number is normal, not fraud."""
    usages = [
        PayoutUsage(citizen_id=f"c{index}", alias="+923009999999", alias_kind="CONTACT")
        for index in range(10)
    ]
    assert detect_payout_account_shared("+923009999999", usages) is None


def test_shared_payout_alias_across_three_citizens_is_a_flag() -> None:
    usages = [
        PayoutUsage(citizen_id=f"c{index}", alias="+923001000001", alias_kind="PAYOUT")
        for index in range(3)
    ]
    flag = detect_payout_account_shared("+923001000001", usages)
    assert flag is not None
    assert flag.evidence["other_citizen_count"] == 3


def test_payout_usage_rejects_unknown_alias_kind() -> None:
    with pytest.raises(ValidationError):
        PayoutUsage(citizen_id="c1", alias="+92300", alias_kind="SOMETHING")


def test_payout_name_mismatch_below_065() -> None:
    assert detect_payout_name_mismatch(0.64) is not None
    assert detect_payout_name_mismatch(0.65) is None


# -- income conflict -----------------------------------------------------
def test_income_conflict_requires_both_thresholds() -> None:
    flag = detect_data_conflict_income(25000, 55000)
    assert flag is not None
    assert flag.code is FlagCode.DATA_CONFLICT_INCOME


def test_small_absolute_difference_is_not_a_conflict() -> None:
    assert detect_data_conflict_income(25000, 26000) is None


def test_small_relative_difference_is_not_a_conflict() -> None:
    assert detect_data_conflict_income(38000, 40000) is None


def test_income_conflict_needs_both_values() -> None:
    assert detect_data_conflict_income(None, 55000) is None
    assert detect_data_conflict_income(25000, None) is None


def test_income_conflict_is_symmetric() -> None:
    assert detect_data_conflict_income(55000, 25000) is not None


# -- helper velocity and consent ----------------------------------------
def test_helper_velocity_threshold() -> None:
    assert detect_helper_velocity(10) is None
    flag = detect_helper_velocity(11)
    assert flag is not None
    assert flag.code is FlagCode.HELPER_HIGH_VELOCITY


def test_low_assurance_consent_only_for_verbal() -> None:
    assert detect_low_assurance_consent("SELF_OTP") is None
    assert detect_low_assurance_consent("CITIZEN_OTP") is None
    flag = detect_low_assurance_consent("VERBAL_WITNESSED")
    assert flag is not None
    assert flag.code is FlagCode.LOW_ASSURANCE_CONSENT


# -- gender convention ---------------------------------------------------
def test_cnic_gender_mismatch_on_odd_last_digit() -> None:
    assert detect_cnic_gender_mismatch("9990010000012") is None
    flag = detect_cnic_gender_mismatch("9990010000011")
    assert flag is not None
    assert flag.code is FlagCode.CNIC_GENDER_MISMATCH


def test_cnic_gender_mismatch_ignores_malformed_input() -> None:
    assert detect_cnic_gender_mismatch(None) is None
    assert detect_cnic_gender_mismatch("123") is None
    assert detect_cnic_gender_mismatch("999001000001X") is None


# -- aggregator ----------------------------------------------------------
def test_run_anomaly_checks_with_no_evidence_raises_nothing() -> None:
    assert run_anomaly_checks() == ()


def test_run_anomaly_checks_orders_deterministically() -> None:
    flags = run_anomaly_checks(
        document_checks=[_check(qr_signature_valid=False)],
        cnic_digits="9990010000011",
        identity_name_similarity=0.60,
        identity_candidate_count=2,
        applicant_is_alive=False,
        self_declared_income_pkr=25000,
        survey_income_pkr=55000,
        helper_submissions_last_60_minutes=12,
        consent_method="VERBAL_WITNESSED",
    )
    codes = [flag.code for flag in flags]
    assert codes == [
        FlagCode.APPLICANT_DECEASED,
        FlagCode.POSSIBLE_DUPLICATE_IDENTITY,
        FlagCode.TAMPER_SUSPECTED,
        FlagCode.DATA_CONFLICT_INCOME,
        FlagCode.HELPER_HIGH_VELOCITY,
        FlagCode.IDENTITY_NAME_VARIANT_CHECK,
        FlagCode.LOW_ASSURANCE_CONSENT,
        FlagCode.CNIC_GENDER_MISMATCH,
    ]
    assert codes == [flag.code for flag in run_anomaly_checks(
        document_checks=[_check(qr_signature_valid=False)],
        cnic_digits="9990010000011",
        identity_name_similarity=0.60,
        identity_candidate_count=2,
        applicant_is_alive=False,
        self_declared_income_pkr=25000,
        survey_income_pkr=55000,
        helper_submissions_last_60_minutes=12,
        consent_method="VERBAL_WITNESSED",
    )]


def test_run_anomaly_checks_skips_duplicate_check_without_a_date() -> None:
    flags = run_anomaly_checks(
        cnic_digits="9990010000012",
        prior_cases=[_prior()],
        program_code="SAHARA_WIDOW_GRANT",
    )
    assert FlagCode.DUPLICATE_APPLICATION not in {flag.code for flag in flags}


def test_run_anomaly_checks_detects_duplicate_with_a_date() -> None:
    flags = run_anomaly_checks(
        cnic_digits="9990010000012",
        prior_cases=[_prior()],
        program_code="SAHARA_WIDOW_GRANT",
        today=TODAY,
    )
    assert FlagCode.DUPLICATE_APPLICATION in {flag.code for flag in flags}
