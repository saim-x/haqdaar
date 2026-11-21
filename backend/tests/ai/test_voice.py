"""Voice wizard acceptance tests (docs/07 §6, docs/11 §3.2).

The wizard is used by women who may not read Urdu script. Every spoken answer
must be parsed into exactly one field, read back in both languages, and — when
the machine is not sure — handed back to the citizen instead of guessed.
"""

from __future__ import annotations

from typing import Any

import pytest

from app.ai import provider, urdu_nlp, voice


def _audio(transcript: str) -> bytes:
    """Fake-provider audio: the transcript rides inside the bytes."""
    return b"RIFF\x00\x00\x00\x00WAVE" + f"TRANSCRIPT:{transcript}".encode()


def _parse(db: Any, field_key: str, transcript: str) -> voice.VoiceParseResult:
    return voice.transcribe_and_parse(
        db,
        audio_bytes=_audio(transcript),
        mime_type="audio/wav",
        field_key=field_key,
        lang="ur",
    )


@pytest.mark.parametrize(("confidence", "needs_retry"), [(0.95, False), (0.40, True)])
def test_deepgram_wizard_parses_locally(
    monkeypatch: pytest.MonkeyPatch, confidence: float, needs_retry: bool
) -> None:
    import httpx

    live = provider.LiveOpenAIProvider()
    monkeypatch.setattr(provider.get_settings(), "deepgram_api_key", "test-key")
    monkeypatch.setattr(voice, "get_provider", lambda: live)

    def transcribe(url: str, **kwargs: Any) -> httpx.Response:
        assert url == "https://api.deepgram.com/v1/listen"
        assert kwargs["params"]["model"] == "nova-3"
        assert kwargs["params"]["language"] == "ur"
        assert kwargs["headers"]["Content-Type"] == "audio/webm"
        assert kwargs["content"] == b"sample audio"
        return httpx.Response(
            200,
            request=httpx.Request("POST", url),
            json={
                "metadata": {"duration": 2.0},
                "results": {"channels": [{"alternatives": [
                    {"transcript": "اٹھائیس ہزار روپے", "confidence": confidence},
                ]}]},
            },
        )

    def unexpected_openai_call() -> None:
        pytest.fail("The Deepgram wizard path must not use OpenAI")

    monkeypatch.setattr(provider.httpx, "post", transcribe)
    monkeypatch.setattr(live, "_openai", unexpected_openai_call)
    result = voice.transcribe_and_parse(
        None, audio_bytes=b"sample audio", mime_type="audio/webm", field_key="monthly_income_pkr"
    )
    assert result.parsed_value == 28_000
    assert result.needs_retry is needs_retry
    assert result.provider == "deepgram"


# --------------------------------------------------------------------------- #
# Urdu numerals — the core of the wizard
# --------------------------------------------------------------------------- #
class TestUrduNumerals:
    @pytest.mark.parametrize(
        ("spoken", "expected"),
        [
            ("اٹھائیس ہزار", 28_000),
            ("اٹھائیس ہزار روپے", 28_000),
            ("ataees hazaar", 28_000),
            ("پندرہ ہزار", 15_000),
            ("بیس ہزار پانچ سو", 20_500),
            ("تین ہزار", 3_000),
            ("دس ہزار", 10_000),
            ("پچاس ہزار", 50_000),
        ],
    )
    def test_spoken_amounts_parse_to_rupees(self, spoken: str, expected: int) -> None:
        parsed = urdu_nlp.parse_amount(spoken, minimum=0, maximum=1_000_000)
        assert parsed.value == expected, f"{spoken!r} -> {parsed.value}"

    @pytest.mark.parametrize("spoken", ["تین", "پانچ", "دو", "سات"])
    def test_small_counts_parse(self, spoken: str) -> None:
        parsed = urdu_nlp.parse_amount(spoken, minimum=0, maximum=30)
        assert parsed.value == urdu_nlp.parse_number(spoken)

    def test_digits_inside_urdu_text_are_normalised(self) -> None:
        assert urdu_nlp.normalize_digits("۲۸۰۰۰") == "28000"
        assert urdu_nlp.normalize_digits("٢٨٠٠٠") == "28000"

    def test_unknown_phrases_are_recognised(self) -> None:
        for phrase in ("نہیں معلوم", "نہیں پتہ", "مجھے نہیں معلوم", "pata nahi"):
            assert urdu_nlp.is_unknown(phrase), phrase

    def test_a_real_answer_is_not_mistaken_for_unknown(self) -> None:
        assert not urdu_nlp.is_unknown("اٹھائیس ہزار")


# --------------------------------------------------------------------------- #
# per-field parsing through the full pipeline
# --------------------------------------------------------------------------- #
class TestFieldParsing:
    def test_income_is_parsed_from_speech(self, db: Any) -> None:
        result = _parse(db, "monthly_income_pkr", "اٹھائیس ہزار روپے")
        assert result.parsed_value == 28_000
        assert result.confidence >= voice.CONFIDENCE_THRESHOLD
        assert not result.needs_retry

    def test_children_count_is_parsed(self, db: Any) -> None:
        result = _parse(db, "children_under_18", "تین")
        assert result.parsed_value == 3
        assert not result.needs_retry

    def test_cnic_is_parsed_and_formatted(self, db: Any) -> None:
        result = _parse(db, "applicant_cnic", "99900 1000001 2")
        assert result.parsed_value == "9990010000012"
        assert "99900-1000001-2" in result.readback_ur

    def test_district_is_parsed(self, db: Any) -> None:
        result = _parse(db, "applicant_district", "لاڑکانہ")
        assert result.parsed_value == "Larkana"

    def test_date_of_birth_is_parsed(self, db: Any) -> None:
        result = _parse(db, "applicant_dob", "پندرہ مارچ انیس سو اسی")
        assert result.parsed_value == "1980-03-15"

    def test_payout_phone_is_normalised_to_e164(self, db: Any) -> None:
        result = _parse(db, "payout_phone", "0300 1234567")
        assert result.parsed_value == "+923001234567"

    def test_name_is_parsed(self, db: Any) -> None:
        result = _parse(db, "applicant_full_name", "فاطمہ بی بی")
        assert result.parsed_value
        assert "فاطمہ" in result.parsed_value

    def test_unsupported_field_key_is_rejected(self, db: Any) -> None:
        with pytest.raises(ValueError):
            _parse(db, "not_a_field", "کچھ بھی")


# --------------------------------------------------------------------------- #
# unknown beats guess
# --------------------------------------------------------------------------- #
class TestUnknownBeatsGuess:
    def test_user_unknown_maps_to_null_not_zero(self, db: Any) -> None:
        result = _parse(db, "monthly_income_pkr", "نہیں معلوم")
        assert result.parsed_value is None, "an unknown income must never become 0"
        assert result.missing_reason == "USER_UNKNOWN"
        assert not result.needs_retry, "the citizen answered; we must not nag her"

    def test_unknown_children_maps_to_null(self, db: Any) -> None:
        result = _parse(db, "children_under_18", "نہیں پتہ")
        assert result.parsed_value is None
        assert result.missing_reason == "USER_UNKNOWN"

    def test_unparseable_answer_asks_again(self, db: Any) -> None:
        result = _parse(db, "monthly_income_pkr", "کچھ کچھ ہوتا ہے نا")
        assert result.parsed_value is None
        assert result.needs_retry, "an unparseable answer must be retried, never defaulted"

    def test_silence_asks_again(self, db: Any) -> None:
        result = voice.transcribe_and_parse(
            db, audio_bytes=b"RIFF\x00\x00\x00\x00WAVE", mime_type="audio/wav", field_key="monthly_income_pkr"
        )
        assert result.parsed_value is None
        assert result.missing_reason == "NO_SPEECH"
        assert result.needs_retry
        assert result.readback_ur and result.readback_en

    def test_low_confidence_asks_again(self, db: Any, monkeypatch: pytest.MonkeyPatch) -> None:
        from app.ai import provider as provider_module

        fake = provider_module.get_fake_provider()
        original = fake.parse_structured_field

        def wobbly(transcript: str, field_key: str, schema: Any = None) -> Any:
            parsed = original(transcript, field_key, schema)
            parsed.confidence = 0.42
            return parsed

        monkeypatch.setattr(fake, "parse_structured_field", wobbly)
        result = _parse(db, "monthly_income_pkr", "اٹھائیس ہزار")
        assert result.confidence < voice.CONFIDENCE_THRESHOLD
        assert result.needs_retry


# --------------------------------------------------------------------------- #
# readback — the citizen must hear her own answer
# --------------------------------------------------------------------------- #
class TestReadback:
    def test_income_readback_speaks_the_number_in_words(self) -> None:
        readback_ur, readback_en = voice.readback("monthly_income_pkr", 28_000)
        assert "اٹھائیس ہزار" in readback_ur
        assert "28,000" in readback_en
        assert "درست" in readback_ur
        assert "correct" in readback_en

    def test_children_readback(self) -> None:
        readback_ur, readback_en = voice.readback("children_under_18", 3)
        assert "تین" in readback_ur
        assert "3" in readback_en

    def test_cnic_readback_is_dashed(self) -> None:
        readback_ur, _ = voice.readback("applicant_cnic", "9990010000012")
        assert "99900-1000001-2" in readback_ur

    def test_date_readback_uses_month_names(self) -> None:
        readback_ur, readback_en = voice.readback("applicant_dob", "1980-03-15")
        assert "مارچ" in readback_ur
        assert "March" in readback_en

    def test_phone_readback_is_human_readable(self) -> None:
        _, readback_en = voice.readback("payout_phone", "+923001234567")
        assert "0300-1234567" in readback_en

    def test_null_readback_offers_to_continue_later(self) -> None:
        readback_ur, readback_en = voice.readback("monthly_income_pkr", None)
        assert "بعد میں" in readback_ur
        assert "later" in readback_en

    def test_every_field_key_has_a_readback(self) -> None:
        for field_key in voice.FIELD_KEYS:
            readback_ur, readback_en = voice.readback(field_key, None)
            assert readback_ur and readback_en, field_key


# --------------------------------------------------------------------------- #
# schemas and TTS
# --------------------------------------------------------------------------- #
class TestSchemas:
    def test_every_field_key_has_a_strict_schema(self) -> None:
        assert set(voice.FIELD_SCHEMAS) == set(voice.FIELD_KEYS)
        for field_key, schema in voice.FIELD_SCHEMAS.items():
            assert schema["additionalProperties"] is False, field_key
            assert set(schema["required"]) == {"value", "confidence", "missing_reason"}, field_key
            assert "null" in schema["properties"]["value"]["type"], field_key

    def test_cnic_schema_requires_exactly_thirteen_digits(self) -> None:
        import re

        pattern = voice.FIELD_SCHEMAS["applicant_cnic"]["properties"]["value"]["pattern"]
        assert re.match(pattern, "9990010000012")
        assert not re.match(pattern, "999001000001")
        assert not re.match(pattern, "99900-1000001-2")

    def test_district_schema_is_closed_over_sindh(self) -> None:
        allowed = voice.FIELD_SCHEMAS["applicant_district"]["properties"]["value"]["enum"]
        assert "Larkana" in allowed
        assert "Lahore" not in allowed


class TestTts:
    def test_synthesize_returns_audio_and_mime(self, db: Any) -> None:
        audio, mime = voice.synthesize(db, "آپ کی درخواست منظور ہو گئی ہے۔")
        assert audio
        assert mime in {"audio/wav", "audio/mpeg"}

    def test_synthesize_redacts_a_cnic_before_speaking(self, db: Any) -> None:
        audio, _ = voice.synthesize(db, "آپ کا شناختی کارڈ 9990010000012 ہے")
        assert audio
        assert b"9990010000012" not in audio

    def test_empty_text_is_rejected(self, db: Any) -> None:
        with pytest.raises(ValueError):
            voice.synthesize(db, "   ")

    def test_cache_key_is_stable_and_voice_scoped(self) -> None:
        assert voice.cache_key("سلام") == voice.cache_key("سلام")
        assert voice.cache_key("سلام") != voice.cache_key("سلام", voice="ur-PK-AsadNeural")


# --------------------------------------------------------------------------- #
# the static prompt manifest the frontend degrades against
# --------------------------------------------------------------------------- #
class TestPromptManifest:
    def test_manifest_covers_the_wizard_and_status_headlines(self) -> None:
        import json
        from pathlib import Path

        manifest_path = (
            Path(__file__).resolve().parents[3] / "frontend" / "public" / "audio" / "ur" / "manifest.json"
        )
        if not manifest_path.exists():  # pragma: no cover - frontend not merged yet
            pytest.skip("frontend tree not present in this worktree")

        # ADR-018: a flat {key: text} map with producer data under _meta.
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        meta = manifest["_meta"]
        texts = {key: value for key, value in manifest.items() if key != "_meta"}
        files = meta["files"]

        for required in (
            "wizard_consent",
            "wizard_applicant_full_name",
            "wizard_monthly_income_pkr",
            "wizard_submitted",
            "submit_confirm",
        ):
            assert required in texts, f"missing wizard prompt {required}"
        for status in ("status_approved", "status_needs_info", "status_human_review", "status_waiting_external"):
            assert status in texts, f"missing status headline {status}"

        assert set(texts) == set(files), "every prompt needs a file entry"
        assert meta["count"] == len(texts)
        for key, text in texts.items():
            assert text.strip(), key
            assert files[key]["file"] == f"{key}.mp3", key
