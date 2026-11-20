"""Urdu NLP acceptance tests (docs/07 §6).

Every function here sits between a citizen speaking Urdu and a fact the decision
engine will act on. The rule under test throughout: a value is either parsed
correctly or reported as unknown — never defaulted, never guessed.
"""

from __future__ import annotations

import pytest

from app.ai import urdu_nlp


# --------------------------------------------------------------------------- #
# normalisation
# --------------------------------------------------------------------------- #
class TestNormalisation:
    @pytest.mark.parametrize(
        ("raw", "expected"),
        [
            ("۲۸۰۰۰", "28000"),
            ("٢٨٠٠٠", "28000"),
            ("۲۸۰۰۰ روپے", "28000 روپے"),
            ("12345", "12345"),
        ],
    )
    def test_digits_are_normalised_to_ascii(self, raw: str, expected: str) -> None:
        assert urdu_nlp.normalize_digits(raw) == expected

    def test_urdu_letter_variants_are_unified(self) -> None:
        # ي vs ی and ك vs ک are the same letter to a citizen, different code points.
        assert urdu_nlp.normalize_text("يك") == urdu_nlp.normalize_text("یک")

    def test_normalisation_is_idempotent(self) -> None:
        once = urdu_nlp.normalize_text("۲۸ ہزار روپے")
        assert urdu_nlp.normalize_text(once) == once

    def test_empty_input_is_safe(self) -> None:
        assert urdu_nlp.normalize_text("") == ""
        assert urdu_nlp.normalize_digits("") == ""


# --------------------------------------------------------------------------- #
# numbers
# --------------------------------------------------------------------------- #
class TestNumbers:
    @pytest.mark.parametrize(
        ("spoken", "expected"),
        [
            ("ایک", 1),
            ("دو", 2),
            ("دس", 10),
            ("بیس", 20),
            ("پچاس", 50),
            ("سو", 100),
            ("دو سو", 200),
            ("ہزار", 1_000),
            ("دس ہزار", 10_000),
            ("اٹھائیس ہزار", 28_000),
            ("پندرہ ہزار", 15_000),
            ("ایک لاکھ", 100_000),
            ("انیس سو اسی", 1_980),
        ],
    )
    def test_urdu_number_words(self, spoken: str, expected: int) -> None:
        assert urdu_nlp.parse_number(spoken) == expected

    @pytest.mark.parametrize(
        ("spoken", "expected"),
        [
            ("ataees hazaar", 28_000),
            ("pandrah hazaar", 15_000),
            ("bees hazaar", 20_000),
            ("paanch sau", 500),
        ],
    )
    def test_roman_urdu_number_words(self, spoken: str, expected: int) -> None:
        assert urdu_nlp.parse_number(spoken) == expected

    def test_digits_beat_words(self) -> None:
        assert urdu_nlp.parse_number("28000") == 28_000

    def test_nonsense_is_none_not_zero(self) -> None:
        assert urdu_nlp.parse_number("کچھ بھی نہیں") is None
        assert urdu_nlp.parse_number("") is None

    def test_amount_respects_bounds(self) -> None:
        assert urdu_nlp.parse_amount("پچاس ہزار", minimum=0, maximum=30_000).value is None
        assert urdu_nlp.parse_amount("پچاس ہزار", minimum=0, maximum=60_000).value == 50_000

    def test_amount_reports_unknown_separately_from_failure(self) -> None:
        unknown = urdu_nlp.parse_amount("نہیں معلوم")
        assert unknown.unknown is True
        assert unknown.value is None

        failed = urdu_nlp.parse_amount("کچھ بھی نہیں")
        assert failed.unknown is False
        assert failed.value is None

    def test_number_words_round_trip(self) -> None:
        for value in (1, 7, 15, 28, 50, 100, 1_000, 28_000):
            words = urdu_nlp.urdu_number_words(value)
            assert words, value
            assert urdu_nlp.parse_number(words) == value, f"{value} -> {words}"


# --------------------------------------------------------------------------- #
# unknown
# --------------------------------------------------------------------------- #
class TestUnknown:
    @pytest.mark.parametrize(
        "phrase",
        [
            "نہیں معلوم",
            "نہیں پتہ",
            "مجھے نہیں معلوم",
            "پتہ نہیں",
            "pata nahi",
            "nahi pata",
            "don't know",
            "unknown",
        ],
    )
    def test_unknown_phrases_are_recognised(self, phrase: str) -> None:
        assert urdu_nlp.is_unknown(phrase), phrase

    @pytest.mark.parametrize("phrase", ["اٹھائیس ہزار", "تین", "لاڑکانہ", "فاطمہ بی بی"])
    def test_real_answers_are_not_unknown(self, phrase: str) -> None:
        assert not urdu_nlp.is_unknown(phrase), phrase


# --------------------------------------------------------------------------- #
# CNIC
# --------------------------------------------------------------------------- #
class TestCnic:
    @pytest.mark.parametrize(
        "spoken",
        [
            "9990010000012",
            "99900-1000001-2",
            "99900 1000001 2",
            "۹۹۹۰۰۱۰۰۰۰۰۱۲",
            "میرا شناختی کارڈ 99900-1000001-2 ہے",
        ],
    )
    def test_cnic_parses_from_any_common_form(self, spoken: str) -> None:
        assert urdu_nlp.parse_cnic(spoken) == "9990010000012"

    def test_cnic_rejects_the_wrong_length(self) -> None:
        assert urdu_nlp.parse_cnic("999001000001") is None
        assert urdu_nlp.parse_cnic("99900100000123") is None

    def test_cnic_rejects_nonsense(self) -> None:
        assert urdu_nlp.parse_cnic("نہیں معلوم") is None
        assert urdu_nlp.parse_cnic("") is None

    def test_format_is_dashed(self) -> None:
        assert urdu_nlp.format_cnic("9990010000012") == "99900-1000001-2"

    def test_format_leaves_a_short_value_alone(self) -> None:
        assert urdu_nlp.format_cnic("123") == "123"


# --------------------------------------------------------------------------- #
# dates
# --------------------------------------------------------------------------- #
class TestDates:
    @pytest.mark.parametrize(
        ("spoken", "expected"),
        [
            ("1980-03-15", "1980-03-15"),
            ("15/03/1980", "1980-03-15"),
            ("15-03-1980", "1980-03-15"),
            ("15 مارچ 1980", "1980-03-15"),
            ("15 March 1980", "1980-03-15"),
            ("پندرہ مارچ 1980", "1980-03-15"),
            ("پندرہ مارچ انیس سو اسی", "1980-03-15"),
            ("15 مارچ انیس سو اسی", "1980-03-15"),
            ("یکم جنوری 1990", "1990-01-01"),
            ("دوم اپریل 2001", "2001-04-02"),
        ],
    )
    def test_dates_parse(self, spoken: str, expected: str) -> None:
        assert urdu_nlp.parse_date(spoken) == expected

    def test_the_year_is_never_read_as_the_day(self) -> None:
        # Regression: "پندرہ مارچ 1980" once returned 1980-03-19 because the day
        # regex grabbed the first two digits of the year.
        assert urdu_nlp.parse_date("پندرہ مارچ 1980") == "1980-03-15"

    @pytest.mark.parametrize(
        "incomplete",
        ["مارچ 1980", "پندرہ مارچ", "انیس سو اسی", "نہیں معلوم", "", "کچھ بھی"],
    )
    def test_incomplete_dates_are_none_not_guessed(self, incomplete: str) -> None:
        assert urdu_nlp.parse_date(incomplete) is None

    def test_an_impossible_date_is_none(self) -> None:
        assert urdu_nlp.parse_date("31 فروری 1990") is None


# --------------------------------------------------------------------------- #
# districts
# --------------------------------------------------------------------------- #
class TestDistricts:
    @pytest.mark.parametrize(
        ("spoken", "expected"),
        [
            ("Larkana", "Larkana"),
            ("لاڑکانہ", "Larkana"),
            ("larkana", "Larkana"),
            ("Shikarpur", "Shikarpur"),
            ("Jacobabad", "Jacobabad"),
            ("Sukkur", "Sukkur"),
        ],
    )
    def test_sindh_districts_parse(self, spoken: str, expected: str) -> None:
        assert urdu_nlp.parse_district(spoken) == expected

    def test_a_district_outside_sindh_is_none(self) -> None:
        assert urdu_nlp.parse_district("Lahore") is None

    def test_nonsense_is_none(self) -> None:
        assert urdu_nlp.parse_district("نہیں معلوم") is None

    def test_the_district_list_is_closed_and_non_empty(self) -> None:
        assert len(urdu_nlp.SINDH_DISTRICTS) >= 10
        assert all(name.strip() for name in urdu_nlp.SINDH_DISTRICTS)


# --------------------------------------------------------------------------- #
# names
# --------------------------------------------------------------------------- #
class TestNames:
    @pytest.mark.parametrize(
        "spoken",
        ["فاطمہ بی بی", "Fatima Bibi", "fatima bibi", "میرا نام فاطمہ بی بی ہے"],
    )
    def test_names_parse(self, spoken: str) -> None:
        parsed = urdu_nlp.parse_name(spoken)
        assert parsed
        assert "فاطمہ" in parsed or "fatima" in parsed.lower()

    def test_unknown_is_none(self) -> None:
        assert urdu_nlp.parse_name("نہیں معلوم") is None

    def test_title_case_is_applied_to_latin_names(self) -> None:
        assert urdu_nlp.title_case_name("fatima bibi") == "Fatima Bibi"


# --------------------------------------------------------------------------- #
# formatting
# --------------------------------------------------------------------------- #
class TestFormatting:
    def test_pkr_uses_thousands_separators(self) -> None:
        assert urdu_nlp.format_pkr(28_000) == "28,000"
        assert urdu_nlp.format_pkr(1_200_000) == "1,200,000"

    def test_first_match_respects_the_threshold(self) -> None:
        options = ["Larkana", "Shikarpur"]
        assert urdu_nlp.first_match("larkana", options) == "Larkana"
        assert urdu_nlp.first_match("zzzzzz", options) is None

    def test_tokens_are_stable(self) -> None:
        assert urdu_nlp.tokens("widow grant") == urdu_nlp.tokens("widow grant")
