"""Sindhi field normalization and Gemini speech synthesis."""

from __future__ import annotations

import base64
import re
import time
from functools import lru_cache
from typing import Any

import httpx

from app.ai.provider import ProviderError, _emit, provider_mode
from app.config import get_settings

_NUMBER_FIELDS = {
    "applicant_cnic",
    "spouse_cnic",
    "payout_phone",
    "monthly_income_pkr",
    "applicant_dob",
    "children_under_18",
    "household_size",
}
_WORDS = {
    "صفر": "صفر",
    "هڪ": "ایک",
    "ٻه": "دو",
    "ٽي": "تین",
    "چار": "چار",
    "پنج": "پانچ",
    "ڇهه": "چھ",
    "ڇھ": "چھ",
    "ست": "سات",
    "اٺ": "آٹھ",
    "نو": "نو",
    "ڏهه": "دس",
    "يارهن": "گیارہ",
    "ٻارهن": "بارہ",
    "تيرهن": "تیرہ",
    "چوڏهن": "چودہ",
    "پندرهن": "پندرہ",
    "سورهن": "سولہ",
    "سترهن": "سترہ",
    "ارڙهن": "اٹھارہ",
    "اوڻيهه": "انیس",
    "ويهه": "بیس",
    "ٽيهه": "تیس",
    "چاليهه": "چالیس",
    "پنجاهه": "پچاس",
    "سٺ": "ساٹھ",
    "ستر": "ستر",
    "اسي": "اسی",
    "نوي": "نوے",
    "پنجاسي": "پچاسی",
    "سو": "سو",
    "هزار": "ہزار",
    "لک": "لاکھ",
    "رپيا": "روپے",
    "جنوري": "January",
    "فيبروري": "February",
    "مارچ": "March",
    "اپريل": "April",
    "مئي": "May",
    "جون": "June",
    "جولاءِ": "July",
    "آگسٽ": "August",
    "سيپٽمبر": "September",
    "آڪٽوبر": "October",
    "نومبر": "November",
    "ڊسمبر": "December",
}
_CLOUD_MODEL = "gemini-3.1-flash-tts-preview"
_GEMINI_MODEL = "gemini-3.8-flash-tts"
RETRY = "مهرباني ڪري وري ڳالهايو يا مٿي جواب ڏيو."


def normalize_field(field: str, transcript: str) -> str:
    if transcript.strip(" .،؟۔") in {"خبر ناهي", "مون کي خبر ناهي", "مونکي خبر ناهي"}:
        return "معلوم نہیں"
    if field not in _NUMBER_FIELDS:
        return transcript
    return re.sub(r"[^\W\d_]+", lambda match: _WORDS.get(match[0], match[0]), transcript)


def readback(field: str, value: Any) -> str:
    if value is None:
        return "توهان جواب نه ڏنو. ڇا پوءِ جواب ڏيندا؟"
    spoken = str(value)
    if field in {"applicant_cnic", "spouse_cnic", "payout_phone"}:
        spoken = " ".join(character for character in spoken if character.isdigit())
    elif field == "applicant_dob":
        if spoken.count("-") != 2:
            return RETRY
        year, month, day = spoken.split("-")
        spoken = f"{day}، {month}، {year}"
    elif field == "monthly_income_pkr":
        spoken = f"{spoken} رپيا"
    return f"توهان چيو {spoken}۔ ڇا اهو صحيح آهي؟"


@lru_cache(maxsize=64)
def synthesize(text: str) -> bytes:
    settings = get_settings()
    key = settings.gemini_api_key.strip()
    live_gemini_allowed = key and settings.gemini_allow_live_in_fake_ai and not settings.is_test
    if provider_mode() != "live" and not live_gemini_allowed:
        raise ProviderError("Sindhi speech synthesis requires live mode", retryable=False)
    if key:
        return _synthesize_gemini(text, key)

    token = settings.google_tts_access_token.strip()
    project = settings.google_cloud_project.strip()
    if not token or not project:
        raise ProviderError("Sindhi speech synthesis is not configured", retryable=False)
    started = time.perf_counter()
    try:
        response = httpx.post(
            "https://texttospeech.googleapis.com/v1/text:synthesize",
            headers={"Authorization": f"Bearer {token}", "x-goog-user-project": project},
            json={
                "input": {"text": text, "prompt": "Speak clearly and slowly in Sindhi."},
                "voice": {"languageCode": "sd-IN", "name": "Kore", "modelName": _CLOUD_MODEL},
                "audioConfig": {"audioEncoding": "MP3"},
            },
            timeout=15,
        )
        response.raise_for_status()
        audio = base64.b64decode(response.json()["audioContent"], validate=True)
        if not audio:
            raise ValueError("Empty audio")
    except (httpx.HTTPError, KeyError, TypeError, ValueError):
        _emit(
            task_type="VOICE_TTS",
            provider="google",
            model_name=_CLOUD_MODEL,
            latency_ms=int((time.perf_counter() - started) * 1000),
            succeeded=False,
        )
        raise ProviderError("Sindhi speech synthesis failed") from None
    _emit(
        task_type="VOICE_TTS",
        provider="google",
        model_name=_CLOUD_MODEL,
        latency_ms=int((time.perf_counter() - started) * 1000),
        succeeded=True,
    )
    return audio


def _synthesize_gemini(text: str, api_key: str) -> bytes:
    started = time.perf_counter()
    try:
        response = httpx.post(
            "https://generativelanguage.googleapis.com/v1beta/interactions",
            headers={"x-goog-api-key": api_key},
            json={
                "model": _GEMINI_MODEL,
                "store": False,
                "input": [{"type": "user_input", "content": [{
                    "type": "text",
                    "text": text,
                    "annotations": [{
                        "type": "speech_metadata",
                        "style": "Read clearly and slowly in Pakistani Sindhi.",
                    }],
                }]}],
                "response_format": {"type": "audio", "mime_type": "audio/wav"},
                "generation_config": {"speech_config": [{"voice": "Kore"}]},
            },
            timeout=25,
        )
        response.raise_for_status()
        encoded = next(
            part["data"]
            for step in reversed(response.json()["steps"])
            if step["type"] == "model_output"
            for part in reversed(step["content"])
            if part["type"] == "audio"
        )
        audio = base64.b64decode(encoded, validate=True)
        if len(audio) <= 44 or audio[:4] != b"RIFF" or audio[8:12] != b"WAVE":
            raise ValueError("Invalid WAV audio")
    except (httpx.HTTPError, KeyError, StopIteration, TypeError, ValueError) as exc:
        code = (
            f"HTTP_{exc.response.status_code}"
            if isinstance(exc, httpx.HTTPStatusError)
            else "INVALID_AUDIO"
        )
        _emit(
            task_type="VOICE_TTS",
            provider="gemini",
            model_name=_GEMINI_MODEL,
            latency_ms=int((time.perf_counter() - started) * 1000),
            succeeded=False,
            error_code=code,
        )
        raise ProviderError(f"Sindhi Gemini speech synthesis failed ({code})", code=code) from None
    _emit(
        task_type="VOICE_TTS",
        provider="gemini",
        model_name=_GEMINI_MODEL,
        latency_ms=int((time.perf_counter() - started) * 1000),
        succeeded=True,
    )
    return audio
