"""Entity resolution: messy Pakistani names, never matching on name alone.

docs/06 §5.1 (normalisation pipeline) and §5.2 (record matching policy).
docs/08 Challenge 03 requires 25+ spelling/duplicate/conflict cases.
"""

from __future__ import annotations

import pytest
from app.engine.anomalies import FlagCode
from app.engine.entity_resolution import (
    IdentityCandidate,
    MatchOutcome,
    canonical_name,
    name_sim,
    normalize_unicode,
    phonetic_key,
    resolve_identity,
    transliterate_urdu,
)

FATIMA_CNIC = "9990010000012"


def _candidate(**overrides: object) -> IdentityCandidate:
    payload: dict[str, object] = {
        "cnic_digits": FATIMA_CNIC,
        "full_name": "Mst. Fatima Bibi",
        "full_name_ur": "مسماۃ فاطمہ بی بی",
        "dob": "1974-05-14",
        "district": "Thatta",
        "is_alive": True,
        "cnic_expiry_date": "2030-08-01",
        "marital_status": "WIDOWED",
    }
    payload.update(overrides)
    return IdentityCandidate.model_validate(payload)


# -- 1. normalisation ----------------------------------------------------
@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("Mst. Fatima Bibi", "fatima"),
        ("Fatima Bibi", "fatima"),
        ("FATIMA BIBI", "fatima"),
        ("  Fatima   Bibi  ", "fatima"),
        ("Fatima Bano", "fatima"),
        ("Begum Fatima", "fatima"),
        ("Smt. Fatima", "fatima"),
        ("Syed Ghulam Rasool", "ghulam rasul"),
        ("Haji Ghulam Rasool", "ghulam rasul"),
        ("M Fatima", "fatima"),
        ("Muhammad Akram", "muhamad akram"),
        ("Mohammad Akram", "muhamad akram"),
        ("Muhammed Akram", "muhamad akram"),
        ("Mohd Akram", "muhamad akram"),
        ("Md Akram", "muhamad akram"),
        ("Ayesha Bibi", "ayesha"),
        ("Aisha Bibi", "ayesha"),
        ("Aysha Bibi", "ayesha"),
        ("Hussain Ali", "husain ali"),
        ("Husain Ali", "husain ali"),
        ("Hossein Ali", "husain ali"),
        ("Ghulam Rasool", "ghulam rasul"),
        ("Ghulam Rasul", "ghulam rasul"),
        ("Abdul Rahman", "abdul rahman"),
        ("Abdal Rahman", "abdul rahman"),
        ("Fatimah Bibi", "fatima"),
        ("Fatma Bibi", "fatima"),
    ],
)
def test_canonical_name_pipeline(raw: str, expected: str) -> None:
    assert canonical_name(raw) == expected


def test_urdu_script_transliterates_to_roman() -> None:
    assert canonical_name("فاطمہ بی بی") == "fatima"
    assert canonical_name("مسماۃ فاطمہ بی بی") == "fatima"
    assert canonical_name("محمد اکرم") == "muhamad akram"
    assert canonical_name("عائشہ بی بی") == "ayesha"
    assert canonical_name("غلام رسول") == "ghulam rasul"


def test_urdu_and_roman_compare_directly() -> None:
    assert name_sim("فاطمہ بی بی", "Fatima Bibi") == 1.0
    assert name_sim("مسماۃ فاطمہ بی بی", "Mst. Fatima Bibi") == 1.0
    assert name_sim("محمد اکرم", "Mohammad Akram") == 1.0


def test_arabic_codepoint_variants_are_folded() -> None:
    # Arabic YEH (U+064A) and ARABIC KAF (U+0643) must fold to their Urdu forms.
    assert normalize_unicode("فاطمي") == normalize_unicode("فاطمی")
    assert normalize_unicode("كرم") == normalize_unicode("کرم")


def test_diacritics_and_tatweel_are_stripped() -> None:
    assert normalize_unicode("مُحَمَّد") == "محمد"
    assert normalize_unicode("محـــمد") == "محمد"


def test_honorific_stripping_keeps_a_copy_when_it_would_empty_the_name() -> None:
    assert canonical_name("Bibi") == "bibi"
    assert canonical_name("Mst.") == "mst"


def test_empty_and_none_names_score_zero() -> None:
    assert name_sim("", "Fatima") == 0.0
    assert name_sim(None, "Fatima") == 0.0
    assert name_sim("Fatima", None) == 0.0
    assert name_sim("", "") == 0.0


def test_phonetic_key_folds_z_to_s() -> None:
    assert phonetic_key("Zainab") == phonetic_key("Sainab")


# -- 2. similarity bands -------------------------------------------------
@pytest.mark.parametrize(
    ("left", "right", "low", "high"),
    [
        ("Mst. Fatima Bibi", "Fatima Bibi", 0.85, 1.01),
        ("Muhammad Akram", "Mohammad Akram", 0.85, 1.01),
        ("Ayesha Bibi", "Aisha Bibi", 0.85, 1.01),
        ("Hussain Ali", "Husain Ali", 0.85, 1.01),
        ("Ghulam Rasool", "Ghulam Rasul", 0.85, 1.01),
        ("Zainab Bibi", "Zubaida Bibi", 0.70, 0.85),
        ("Fatima Bibi", "Zainab Bibi", 0.55, 0.70),
        ("Fatima Bibi", "Muhammad Akram", 0.0, 0.55),
    ],
)
def test_similarity_lands_in_the_expected_band(
    left: str, right: str, low: float, high: float
) -> None:
    similarity = name_sim(left, right)
    assert low <= similarity < high, f"{left!r} vs {right!r} -> {similarity}"


def test_similarity_is_symmetric() -> None:
    assert name_sim("Fatima Bibi", "Zainab Bibi") == name_sim("Zainab Bibi", "Fatima Bibi")


def test_identical_names_score_one() -> None:
    assert name_sim("Fatima Bibi", "Fatima Bibi") == 1.0


# -- 2b. given-name guard (ADR-017) --------------------------------------
def test_given_name_guard_blocks_a_shared_surname() -> None:
    """A shared surname must not carry a different given name over the 0.80 threshold."""
    assert name_sim("Zainab Khan", "Sakina Khan") < 0.80
    assert name_sim("Zainab Ali", "Sakina Ali") < 0.80
    assert name_sim("Fatima Malik", "Zainab Malik") < 0.70


def test_given_name_guard_keeps_the_golden_path_at_one() -> None:
    """The registry's honorific variant must still be a perfect match."""
    assert name_sim("Mst. Fatima Bibi", "Fatima Bibi") == 1.0
    assert name_sim("Fatima Bibi", "Fatima Bibi") == 1.0
    assert name_sim("فاطمہ بی بی", "Fatima Bibi") == 1.0


def test_given_name_guard_keeps_the_bibi_population_below_threshold() -> None:
    """Honorific stripping already handles the demo cast's shared ``Bibi``."""
    assert name_sim("Zainab Bibi", "Sakina Bibi") < 0.80


@pytest.mark.parametrize(
    ("left", "right"),
    [
        ("Mst. Fatima Bibi", "Fatima Bibi"),
        ("Muhammad Akram", "Mohammad Akram"),
        ("Ayesha Bibi", "Aisha Bibi"),
        ("Hussain Ali", "Husain Ali"),
        ("Ghulam Rasool", "Ghulam Rasul"),
        ("Zainab Bibi", "Zubaida Bibi"),
        ("Fatima Bibi", "Zainab Bibi"),
        ("Fatima Bibi", "Muhammad Akram"),
        ("Zainab Khan", "Sakina Khan"),
        ("Fatima Malik", "Zainab Malik"),
        ("Abdul Rahman", "Abdur Rehman"),
        ("Nasreen Bibi", "Nasreen Akhtar"),
    ],
)
def test_given_name_guard_never_raises_a_score(left: str, right: str) -> None:
    """Conservative direction: the guard can only add human review, never approvals."""
    from rapidfuzz import fuzz
    from rapidfuzz.distance import JaroWinkler

    canonical_left = canonical_name(left)
    canonical_right = canonical_name(right)
    unguarded = max(
        JaroWinkler.similarity(canonical_left, canonical_right),
        fuzz.token_set_ratio(canonical_left, canonical_right) / 100.0,
    )
    assert name_sim(left, right) <= round(unguarded, 4)


def test_given_name_guard_is_symmetric() -> None:
    assert name_sim("Zainab Khan", "Sakina Khan") == name_sim("Sakina Khan", "Zainab Khan")


# -- 3. Case A: CNIC given ----------------------------------------------
def test_case_a_exact_match_is_098() -> None:
    resolution = resolve_identity(
        declared_name="Fatima Bibi",
        declared_dob="1974-05-14",
        cnic=FATIMA_CNIC,
        candidates=[_candidate()],
    )
    assert resolution.outcome is MatchOutcome.MATCH
    assert resolution.confidence == 0.98
    assert resolution.flags == ()
    assert resolution.matched is not None


def test_case_a_honorific_variant_is_a_match_not_a_conflict() -> None:
    """The registry stores "Mst. Fatima Bibi"; the card says "Fatima Bibi"."""
    resolution = resolve_identity(
        declared_name="Fatima Bibi",
        declared_dob="1974-05-14",
        cnic=FATIMA_CNIC,
        candidates=[_candidate()],
    )
    assert resolution.outcome is MatchOutcome.MATCH
    assert resolution.confidence >= 0.93
    assert resolution.raw_variant is True
    assert FlagCode.IDENTITY_CONFLICT not in {flag.code for flag in resolution.flags}


def test_case_a_spelling_variant_band_is_093() -> None:
    resolution = resolve_identity(
        declared_name="Zubaida Bibi",
        cnic=FATIMA_CNIC,
        candidates=[_candidate(full_name="Zainab Bibi")],
    )
    assert 0.70 <= resolution.name_similarity < 0.85
    assert resolution.outcome is MatchOutcome.MATCH
    assert resolution.confidence == 0.93
    assert resolution.spelling_variant is True


def test_case_a_soft_match_band_is_075_with_a_medium_flag() -> None:
    resolution = resolve_identity(
        declared_name="Fatima Bibi",
        cnic=FATIMA_CNIC,
        candidates=[_candidate(full_name="Zainab Bibi")],
    )
    assert 0.55 <= resolution.name_similarity < 0.70
    assert resolution.outcome is MatchOutcome.SOFT_MATCH
    assert resolution.confidence == 0.75
    assert [flag.code for flag in resolution.flags] == [
        FlagCode.IDENTITY_NAME_VARIANT_CHECK
    ]


def test_case_a_conflict_band_is_030_with_a_high_flag() -> None:
    resolution = resolve_identity(
        declared_name="Fatima Bibi",
        cnic=FATIMA_CNIC,
        candidates=[_candidate(full_name="Muhammad Akram")],
    )
    assert resolution.name_similarity < 0.55
    assert resolution.outcome is MatchOutcome.CONFLICT
    assert resolution.confidence == 0.30
    assert [flag.code for flag in resolution.flags] == [FlagCode.IDENTITY_CONFLICT]
    assert resolution.matched is None or resolution.matched.full_name == "Muhammad Akram"


def test_case_a_conflict_never_merges_the_record() -> None:
    resolution = resolve_identity(
        declared_name="Fatima Bibi",
        cnic=FATIMA_CNIC,
        candidates=[_candidate(full_name="Muhammad Akram")],
    )
    assert resolution.outcome is not MatchOutcome.MATCH
    assert resolution.is_confirmed is False


def test_case_a_cnic_not_in_registry() -> None:
    resolution = resolve_identity(
        declared_name="Fatima Bibi",
        cnic="9990010000099",
        candidates=[_candidate()],
    )
    assert resolution.outcome is MatchOutcome.NO_MATCH
    assert resolution.confidence == 0.25
    assert [flag.code for flag in resolution.flags] == [FlagCode.CNIC_NOT_IN_REGISTRY]


def test_case_a_dob_mismatch_caps_identity() -> None:
    resolution = resolve_identity(
        declared_name="Fatima Bibi",
        declared_dob="1990-01-01",
        cnic=FATIMA_CNIC,
        candidates=[_candidate()],
    )
    assert resolution.confidence == 0.75
    assert "Date of birth" in resolution.detail_en


def test_case_a_missing_dob_is_not_a_mismatch() -> None:
    resolution = resolve_identity(
        declared_name="Fatima Bibi",
        cnic=FATIMA_CNIC,
        candidates=[_candidate()],
    )
    assert resolution.confidence == 0.98


def test_case_a_ignores_candidates_with_other_cnics() -> None:
    resolution = resolve_identity(
        declared_name="Fatima Bibi",
        cnic=FATIMA_CNIC,
        candidates=[
            _candidate(cnic_digits="9990010000011", full_name="Someone Else"),
            _candidate(),
        ],
    )
    assert resolution.outcome is MatchOutcome.MATCH
    assert resolution.matched is not None
    assert resolution.matched.cnic_digits == FATIMA_CNIC


# -- 4. Case B: no CNIC --------------------------------------------------
def test_case_b_no_candidates_is_unknown() -> None:
    resolution = resolve_identity(declared_name="Fatima Bibi", candidates=[])
    assert resolution.outcome is MatchOutcome.UNKNOWN
    assert resolution.confidence == 0.25
    assert resolution.flags == ()


def test_case_b_single_strong_candidate_is_provisional_only() -> None:
    resolution = resolve_identity(
        declared_name="Fatima Bibi",
        declared_dob="1974-05-14",
        declared_district="Thatta",
        candidates=[_candidate()],
    )
    assert resolution.outcome is MatchOutcome.PROVISIONAL_MATCH
    assert resolution.confidence == 0.78
    assert resolution.confidence < 0.90


def test_case_b_single_candidate_with_wrong_dob_is_unknown() -> None:
    resolution = resolve_identity(
        declared_name="Fatima Bibi",
        declared_dob="1995-01-01",
        candidates=[_candidate()],
    )
    assert resolution.outcome is MatchOutcome.UNKNOWN
    assert resolution.confidence == 0.25


def test_case_b_single_candidate_without_dob_is_unknown() -> None:
    resolution = resolve_identity(
        declared_name="Fatima Bibi",
        candidates=[_candidate()],
    )
    assert resolution.outcome is MatchOutcome.UNKNOWN


def test_case_b_two_akrams_is_ambiguous_never_top_one() -> None:
    """docs/10 §2 case HQ-2026-000103: two Akram records, no CNIC."""
    resolution = resolve_identity(
        declared_name="Muhammad Akram",
        declared_dob="1980-01-01",
        declared_district="Thatta",
        candidates=[
            _candidate(
                cnic_digits="9990010000011",
                full_name="Muhammad Akram",
                dob="1980-01-01",
            ),
            _candidate(
                cnic_digits="9990010000012",
                full_name="Mohammad Akram",
                dob="1981-01-01",
            ),
        ],
    )
    assert resolution.outcome is MatchOutcome.AMBIGUOUS
    assert resolution.confidence == 0.25
    assert resolution.matched is None
    assert [flag.code for flag in resolution.flags] == [
        FlagCode.POSSIBLE_DUPLICATE_IDENTITY
    ]


def test_case_b_three_candidates_is_ambiguous() -> None:
    resolution = resolve_identity(
        declared_name="Fatima Bibi",
        declared_dob="1974-05-14",
        candidates=[_candidate(), _candidate(), _candidate()],
    )
    assert resolution.outcome is MatchOutcome.AMBIGUOUS


def test_name_only_never_produces_a_confirmed_match() -> None:
    for candidates in ([], [_candidate()], [_candidate(), _candidate()]):
        resolution = resolve_identity(
            declared_name="Fatima Bibi",
            declared_dob="1974-05-14",
            candidates=candidates,
        )
        assert resolution.outcome is not MatchOutcome.MATCH
        assert resolution.confidence < 0.90


def test_invalid_cnic_falls_back_to_name_matching() -> None:
    resolution = resolve_identity(
        declared_name="Fatima Bibi",
        declared_dob="1974-05-14",
        cnic="12345",
        candidates=[_candidate()],
    )
    assert resolution.method == "NAME_DISTRICT"
    assert resolution.outcome is MatchOutcome.PROVISIONAL_MATCH


def test_resolution_is_deterministic() -> None:
    first = resolve_identity(
        declared_name="Fatima Bibi", cnic=FATIMA_CNIC, candidates=[_candidate()]
    )
    second = resolve_identity(
        declared_name="Fatima Bibi", cnic=FATIMA_CNIC, candidates=[_candidate()]
    )
    assert first.model_dump() == second.model_dump()


def test_candidate_tolerates_extra_mock_fields() -> None:
    candidate = IdentityCandidate.model_validate(
        {
            "cnic_digits": FATIMA_CNIC,
            "full_name": "Mst. Fatima Bibi",
            "simulated": True,
            "service": "identity",
        }
    )
    assert candidate.cnic_digits == FATIMA_CNIC


def test_transliteration_is_idempotent_on_roman_text() -> None:
    assert transliterate_urdu("Fatima Bibi") == "Fatima Bibi"
