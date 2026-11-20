"""Four-pillar weakest-link confidence (docs/06 §3.1-§3.2)."""

from __future__ import annotations

import pytest
from app.engine.anomalies import FLAG_CATALOGUE, FlagCode, RiskFlag
from app.engine.confidence import (
    ConfidenceComponents,
    ConsentMethod,
    DocumentEvidence,
    DocumentStatus,
    build_confidence,
    consent_assurance_confidence,
    data_consistency_confidence,
    document_confidence,
    identity_confidence_for_cnic_match,
    identity_confidence_for_name_only,
    overall_confidence,
    weakest_pillar,
)


def _flag(code: FlagCode) -> RiskFlag:
    return RiskFlag(
        code=code,
        severity=FLAG_CATALOGUE[code],
        detail_en=code.value,
        detail_ur=code.value,
    )


# -- identity bands ------------------------------------------------------
@pytest.mark.parametrize(
    ("similarity", "expected"),
    [
        (1.00, 0.98),
        (0.85, 0.98),
        (0.84, 0.93),
        (0.70, 0.93),
        (0.69, 0.75),
        (0.55, 0.75),
        (0.54, 0.30),
        (0.00, 0.30),
    ],
)
def test_cnic_match_bands(similarity: float, expected: float) -> None:
    assert identity_confidence_for_cnic_match(similarity) == expected


def test_dob_mismatch_caps_identity_at_the_soft_band() -> None:
    assert identity_confidence_for_cnic_match(1.0, dob_match=False) == 0.75
    assert identity_confidence_for_cnic_match(0.60, dob_match=False) == 0.75
    assert identity_confidence_for_cnic_match(0.40, dob_match=False) == 0.30


def test_name_only_never_reaches_the_auto_threshold() -> None:
    assert identity_confidence_for_name_only(1, 0.99, dob_match=True) == 0.78
    assert identity_confidence_for_name_only(1, 0.99, dob_match=True) < 0.90


@pytest.mark.parametrize(
    ("count", "similarity", "dob_match", "expected"),
    [
        (0, 0.0, False, 0.25),
        (2, 0.99, True, 0.25),
        (3, 0.99, True, 0.25),
        (1, 0.88, True, 0.78),
        (1, 0.87, True, 0.25),
        (1, 0.99, False, 0.25),
    ],
)
def test_name_only_bands(
    count: int, similarity: float, dob_match: bool, expected: float
) -> None:
    assert (
        identity_confidence_for_name_only(count, similarity, dob_match=dob_match)
        == expected
    )


# -- documents -----------------------------------------------------------
def test_all_documents_verified_uses_the_minimum() -> None:
    docs = (
        DocumentEvidence(
            doc_type="CNIC_FRONT", status=DocumentStatus.VERIFIED, verify_confidence=0.97
        ),
        DocumentEvidence(
            doc_type="SPOUSE_DEATH_CERTIFICATE",
            status=DocumentStatus.VERIFIED,
            verify_confidence=0.93,
        ),
    )
    assert document_confidence(docs) == 0.93


def test_verified_document_without_a_score_uses_the_documented_floor() -> None:
    docs = (
        DocumentEvidence(doc_type="CNIC_FRONT", status=DocumentStatus.VERIFIED),
    )
    assert document_confidence(docs) == 0.92


@pytest.mark.parametrize(
    ("status", "expected"),
    [
        (DocumentStatus.TAMPER_SUSPECTED, 0.10),
        (DocumentStatus.NEEDS_RETAKE, 0.40),
        (DocumentStatus.UNVERIFIABLE, 0.55),
        (DocumentStatus.PENDING, 0.55),
    ],
)
def test_worst_document_status_wins(status: DocumentStatus, expected: float) -> None:
    docs = (
        DocumentEvidence(
            doc_type="CNIC_FRONT", status=DocumentStatus.VERIFIED, verify_confidence=0.99
        ),
        DocumentEvidence(doc_type="SPOUSE_DEATH_CERTIFICATE", status=status),
    )
    assert document_confidence(docs) == expected


def test_tamper_beats_needs_retake() -> None:
    docs = (
        DocumentEvidence(doc_type="A", status=DocumentStatus.NEEDS_RETAKE),
        DocumentEvidence(doc_type="B", status=DocumentStatus.TAMPER_SUSPECTED),
    )
    assert document_confidence(docs) == 0.10


def test_no_documents_is_not_full_confidence() -> None:
    assert document_confidence(()) == 0.55


# -- data consistency ----------------------------------------------------
def test_no_flags_starts_at_098() -> None:
    assert data_consistency_confidence(()) == 0.98


def test_each_low_flag_deducts_five_points() -> None:
    assert data_consistency_confidence([_flag(FlagCode.CNIC_GENDER_MISMATCH)]) == 0.93
    assert (
        data_consistency_confidence(
            [_flag(FlagCode.CNIC_GENDER_MISMATCH), _flag(FlagCode.CNIC_GENDER_MISMATCH)]
        )
        == 0.88
    )


def test_medium_flag_caps_at_072() -> None:
    assert data_consistency_confidence([_flag(FlagCode.DATA_CONFLICT_INCOME)]) == 0.72


def test_high_flag_caps_at_020() -> None:
    assert data_consistency_confidence([_flag(FlagCode.TAMPER_SUSPECTED)]) == 0.20


def test_high_flag_dominates_medium_and_low() -> None:
    flags = [
        _flag(FlagCode.CNIC_GENDER_MISMATCH),
        _flag(FlagCode.DATA_CONFLICT_INCOME),
        _flag(FlagCode.PAYOUT_ACCOUNT_SHARED),
    ]
    assert data_consistency_confidence(flags) == 0.20


def test_low_deductions_never_go_negative() -> None:
    flags = [_flag(FlagCode.CNIC_GENDER_MISMATCH) for _ in range(40)]
    assert data_consistency_confidence(flags) == 0.0


# -- consent -------------------------------------------------------------
@pytest.mark.parametrize(
    ("method", "expected"),
    [
        (ConsentMethod.SELF_OTP, 1.00),
        (ConsentMethod.CITIZEN_OTP, 1.00),
        (ConsentMethod.VERBAL_WITNESSED, 0.82),
        ("SELF_OTP", 1.00),
        ("VERBAL_WITNESSED", 0.82),
        (None, 0.82),
    ],
)
def test_consent_assurance(method: object, expected: float) -> None:
    assert consent_assurance_confidence(method) == expected  # type: ignore[arg-type]


def test_verbal_consent_always_lands_below_the_threshold() -> None:
    assert consent_assurance_confidence(ConsentMethod.VERBAL_WITNESSED) < 0.90


# -- weakest link --------------------------------------------------------
def test_weakest_link_dominates_a_strong_pillar() -> None:
    """A 0.99 pillar cannot rescue a 0.40 pillar: min, never mean."""
    overall = overall_confidence(0.99, 0.98, 0.40, 1.00)
    assert overall == 0.40
    assert overall < 0.84  # the misleading arithmetic mean


def test_overall_is_rounded_to_three_decimals() -> None:
    assert overall_confidence(0.987654, 0.9, 0.9, 0.9) == 0.9
    assert overall_confidence(0.123456, 0.9, 0.9, 0.9) == 0.123


def test_weakest_pillar_names_the_lowest() -> None:
    components = ConfidenceComponents(
        identity=0.98,
        documents=0.95,
        data_consistency=0.72,
        consent_assurance=1.0,
        overall=0.72,
    )
    assert weakest_pillar(components) == "data_consistency"


def test_weakest_pillar_tie_breaks_in_fixed_order() -> None:
    components = ConfidenceComponents(
        identity=0.5,
        documents=0.5,
        data_consistency=0.5,
        consent_assurance=0.5,
        overall=0.5,
    )
    assert weakest_pillar(components) == "identity"


def test_build_confidence_composes_all_four_pillars(
    fatima_documents: tuple[DocumentEvidence, ...],
) -> None:
    components = build_confidence(
        identity=0.98,
        documents=fatima_documents,
        flags=(),
        consent_method=ConsentMethod.SELF_OTP,
    )
    assert components.identity == 0.98
    assert components.documents == 0.95
    assert components.data_consistency == 0.98
    assert components.consent_assurance == 1.0
    assert components.overall == 0.95


def test_build_confidence_verbal_consent_caps_overall(
    fatima_documents: tuple[DocumentEvidence, ...],
) -> None:
    components = build_confidence(
        identity=0.98,
        documents=fatima_documents,
        flags=(),
        consent_method=ConsentMethod.VERBAL_WITNESSED,
    )
    assert components.overall == 0.82
    assert components.overall < 0.90


def test_components_json_shape_matches_decisions_column(
    fatima_confidence: ConfidenceComponents,
) -> None:
    payload = fatima_confidence.to_json()
    assert set(payload) == {
        "identity",
        "documents",
        "data_consistency",
        "consent_assurance",
        "overall",
    }
    assert payload["overall"] == 0.95


def test_components_reject_out_of_range_values() -> None:
    with pytest.raises(ValueError):
        ConfidenceComponents(
            identity=1.5,
            documents=0.9,
            data_consistency=0.9,
            consent_assurance=1.0,
            overall=0.9,
        )
