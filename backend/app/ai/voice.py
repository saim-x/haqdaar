"""Voice pipeline: speech-to-text plus field-scoped structured parsing (docs/07 §2).

The citizen speaks one answer per wizard step. We transcribe it, parse exactly
that one field against a strict schema, and return a **readback** sentence the
frontend must speak before it may save ``confirmed: true``. Anything below
``0.70`` confidence - or a schema failure - sets ``needs_retry`` so the UI falls
back to the keypad.

Urdu numerals are normalised locally (``اٹھائیس ہزار`` → ``28000``) and
``نہیں معلوم`` maps to ``missing_reason: "USER_UNKNOWN"``, never to a default.
"""

from __future__ import annotations

import hashlib
import logging
from dataclasses import dataclass, field
from typing import Any

from app.ai import guardrails, sindhi, urdu_nlp
from app.ai.provider import ParsedFieldResult, _emit, get_provider, telemetry

logger = logging.getLogger("haqdaar.ai.voice")

#: Below this the UI must not accept the value without a keypad fallback.
CONFIDENCE_THRESHOLD = 0.70

#: Field keys the wizard can speak (docs/11 §3.2).
FIELD_KEYS: tuple[str, ...] = (
    "applicant_full_name",
    "applicant_cnic",
    "applicant_dob",
    "spouse_full_name",
    "spouse_cnic",
    "applicant_district",
    "children_under_18",
    "household_size",
    "monthly_income_pkr",
    "payout_phone",
)

#: Strict per-field JSON schemas handed to the live model.
FIELD_SCHEMAS: dict[str, dict[str, Any]] = {
    "applicant_full_name": {
        "type": "object",
        "additionalProperties": False,
        "required": ["value", "confidence", "missing_reason"],
        "properties": {
            "value": {"type": ["string", "null"]},
            "confidence": {"type": "number"},
            "missing_reason": {"type": ["string", "null"]},
        },
    },
    "spouse_full_name": {
        "type": "object",
        "additionalProperties": False,
        "required": ["value", "confidence", "missing_reason"],
        "properties": {
            "value": {"type": ["string", "null"]},
            "confidence": {"type": "number"},
            "missing_reason": {"type": ["string", "null"]},
        },
    },
    "applicant_cnic": {
        "type": "object",
        "additionalProperties": False,
        "required": ["value", "confidence", "missing_reason"],
        "properties": {
            "value": {"type": ["string", "null"], "pattern": "^[0-9]{13}$"},
            "confidence": {"type": "number"},
            "missing_reason": {"type": ["string", "null"]},
        },
    },
    "spouse_cnic": {
        "type": "object",
        "additionalProperties": False,
        "required": ["value", "confidence", "missing_reason"],
        "properties": {
            "value": {"type": ["string", "null"], "pattern": "^[0-9]{13}$"},
            "confidence": {"type": "number"},
            "missing_reason": {"type": ["string", "null"]},
        },
    },
    "applicant_dob": {
        "type": "object",
        "additionalProperties": False,
        "required": ["value", "confidence", "missing_reason"],
        "properties": {
            "value": {"type": ["string", "null"], "pattern": "^[0-9]{4}-[0-9]{2}-[0-9]{2}$"},
            "confidence": {"type": "number"},
            "missing_reason": {"type": ["string", "null"]},
        },
    },
    "applicant_district": {
        "type": "object",
        "additionalProperties": False,
        "required": ["value", "confidence", "missing_reason"],
        "properties": {
            "value": {"type": ["string", "null"], "enum": [*urdu_nlp.SINDH_DISTRICTS, None]},
            "confidence": {"type": "number"},
            "missing_reason": {"type": ["string", "null"]},
        },
    },
    "children_under_18": {
        "type": "object",
        "additionalProperties": False,
        "required": ["value", "confidence", "missing_reason"],
        "properties": {
            "value": {"type": ["integer", "null"], "minimum": 0, "maximum": 30},
            "confidence": {"type": "number"},
            "missing_reason": {"type": ["string", "null"]},
        },
    },
    "household_size": {
        "type": "object",
        "additionalProperties": False,
        "required": ["value", "confidence", "missing_reason"],
        "properties": {
            "value": {"type": ["integer", "null"], "minimum": 1, "maximum": 40},
            "confidence": {"type": "number"},
            "missing_reason": {"type": ["string", "null"]},
        },
    },
    "monthly_income_pkr": {
        "type": "object",
        "additionalProperties": False,
        "required": ["value", "confidence", "missing_reason"],
        "properties": {
            "value": {"type": ["integer", "null"], "minimum": 0, "maximum": 1000000},
            "confidence": {"type": "number"},
            "missing_reason": {"type": ["string", "null"]},
        },
    },
    "payout_phone": {
        "type": "object",
        "additionalProperties": False,
        "required": ["value", "confidence", "missing_reason"],
        "properties": {
            "value": {"type": ["string", "null"], "pattern": "^\\+92[0-9]{10}$"},
            "confidence": {"type": "number"},
            "missing_reason": {"type": ["string", "null"]},
        },
    },
}

_FIELD_LABELS: dict[str, tuple[str, str]] = {
    "applicant_full_name": ("your full name", "اپنا پورا نام"),
    "spouse_full_name": ("your husband's name", "اپنے شوہر کا نام"),
    "applicant_cnic": ("your CNIC number", "اپنا شناختی کارڈ نمبر"),
    "spouse_cnic": ("your husband's CNIC number", "اپنے شوہر کا شناختی کارڈ نمبر"),
    "applicant_dob": ("your date of birth", "اپنی تاریخ پیدائش"),
    "applicant_district": ("your district", "اپنا ضلع"),
    "children_under_18": ("the number of children under 18", "اپنے اٹھارہ سال سے کم بچوں کی تعداد"),
    "household_size": ("the number of people in your household", "اپنے گھر میں افراد کی تعداد"),
    "monthly_income_pkr": ("your monthly household income", "اپنی ماہانہ گھریلو آمدنی"),
    "payout_phone": ("your payout mobile number", "اپنا ادائیگی کا موبائل نمبر"),
}

_ENGLISH_MONTH_NAMES = {
    1: "January",
    2: "February",
    3: "March",
    4: "April",
    5: "May",
    6: "June",
    7: "July",
    8: "August",
    9: "September",
    10: "October",
    11: "November",
    12: "December",
}

_URDU_MONTH_NAMES = {
    1: "جنوری",
    2: "فروری",
    3: "مارچ",
    4: "اپریل",
    5: "مئی",
    6: "جون",
    7: "جولائی",
    8: "اگست",
    9: "ستمبر",
    10: "اکتوبر",
    11: "نومبر",
    12: "دسمبر",
}


@dataclass
class VoiceParseResult:
    field_key: str
    transcript: str
    parsed_value: Any = None
    confidence: float = 0.0
    missing_reason: str | None = None
    readback_ur: str = ""
    readback_en: str = ""
    needs_retry: bool = False
    provider: str = "fake"
    model: str = "fake-parse"
    extra: dict[str, Any] = field(default_factory=dict)

    def as_dict(self) -> dict[str, Any]:
        return {
            "field_key": self.field_key,
            "transcript": self.transcript,
            "parsed_value": self.parsed_value,
            "confidence": round(self.confidence, 3),
            "missing_reason": self.missing_reason,
            "readback_ur": self.readback_ur,
            "readback_en": self.readback_en,
            "needs_retry": self.needs_retry,
            "provider": self.provider,
            "model": self.model,
        }


# --------------------------------------------------------------------------- #
# readback
# --------------------------------------------------------------------------- #
def _format_value(field_key: str, value: Any) -> tuple[str, str]:
    """Return ``(urdu_rendering, english_rendering)`` for the readback sentence."""
    if value is None:
        return "", ""

    if field_key in {"monthly_income_pkr"}:
        amount = int(value)
        return (
            f"{urdu_nlp.urdu_number_words(amount)} ({urdu_nlp.format_pkr(amount)}) روپے",
            f"PKR {urdu_nlp.format_pkr(amount)}",
        )

    if field_key in {"children_under_18", "household_size"}:
        count = int(value)
        return (
            f"{urdu_nlp.urdu_number_words(count)} ({count})",
            f"{count}",
        )

    if field_key in {"applicant_cnic", "spouse_cnic"}:
        digits = "".join(ch for ch in str(value) if ch.isdigit())
        formatted = urdu_nlp.format_cnic(digits)
        return (formatted, formatted)

    if field_key == "applicant_dob":
        try:
            year, month, day = (int(part) for part in str(value).split("-"))
        except Exception:
            return (str(value), str(value))
        english_month = _ENGLISH_MONTH_NAMES.get(month, str(month))
        return (
            f"{day} {_URDU_MONTH_NAMES.get(month, '')} {year}",
            f"{day} {english_month} {year}",
        )

    if field_key == "payout_phone":
        digits = "".join(ch for ch in str(value) if ch.isdigit())
        if digits.startswith("92") and len(digits) == 12:
            digits = "0" + digits[2:]
        pretty = f"{digits[:4]}-{digits[4:]}" if len(digits) == 11 else digits
        return (pretty, pretty)

    return (str(value), str(value))


def readback(field_key: str, value: Any, *, lang: str = "ur") -> tuple[str, str]:
    """Build the mandatory confirmation sentence in both languages."""
    label_en, label_ur = _FIELD_LABELS.get(field_key, ("this value", "یہ معلومات"))
    value_ur, value_en = _format_value(field_key, value)
    if lang == "sd":
        spoken = sindhi.readback(field_key, value)
        return spoken, readback(field_key, value)[1]

    if value is None:
        return (
            f"آپ نے {label_ur} کے بارے میں نہیں بتایا۔ کیا آپ بعد میں بتانا چاہیں گی؟",
            f"You did not tell us {label_en}. Would you like to answer later?",
        )

    return (
        f"آپ نے {label_ur} {value_ur} بتائی۔ کیا یہ درست ہے؟",
        f"You said {label_en} is {value_en}. Is that correct?",
    )


# --------------------------------------------------------------------------- #
# pipeline
# --------------------------------------------------------------------------- #
def transcribe_and_parse(
    db: Any,
    *,
    audio_bytes: bytes,
    mime_type: str = "audio/wav",
    field_key: str,
    lang: str = "ur",
    tenant_id: Any = None,
    case_id: Any = None,
) -> VoiceParseResult:
    """Transcribe one spoken answer and parse exactly one field from it."""
    if field_key not in FIELD_SCHEMAS:
        raise ValueError(f"unsupported field_key '{field_key}'")

    provider = get_provider()
    with telemetry(
        db,
        tenant_id=tenant_id,
        case_id=case_id,
        resource_type="voice",
        resource_id=field_key,
    ):
        stt = (
            provider.transcribe_urdu(audio_bytes, mime_type, language="sd")
            if lang == "sd" else provider.transcribe_urdu(audio_bytes, mime_type)
        )
        transcript = guardrails.sanitize(db, stt.transcript or "", resource_type="voice", resource_id=field_key)

        if not transcript.strip():
            return VoiceParseResult(
                field_key=field_key,
                transcript="",
                parsed_value=None,
                confidence=0.0,
                missing_reason="NO_SPEECH",
                readback_ur=sindhi.RETRY if lang == "sd" else "ہم آپ کی آواز نہیں سن سکے۔ براہ کرم دوبارہ بولیں یا کی پیڈ استعمال کریں۔",
                readback_en="We could not hear you. Please speak again or use the keypad.",
                needs_retry=True,
                provider=stt.provider,
                model=stt.model,
            )

        normalized = sindhi.normalize_field(field_key, transcript) if lang == "sd" else transcript
        local = _local_parse(field_key, normalized)
        if stt.provider == "deepgram":
            if (
                local.value is None
                and not local.is_unknown
                and field_key not in {"applicant_cnic", "spouse_cnic", "applicant_dob", "payout_phone"}
            ):
                # Fall back to LLM structured extraction when deterministic Urdu NLP cannot parse.
                try:
                    parsed = provider.parse_structured_field(
                        transcript, field_key, FIELD_SCHEMAS[field_key]
                    )
                except Exception:  # noqa: BLE001
                    parsed = local
            else:
                parsed = local
                parsed.provider = stt.provider
                parsed.model = stt.model
                parsed.confidence = min(parsed.confidence, stt.confidence)
                _emit(
                    task_type="VOICE_PARSE",
                    provider="local",
                    model_name="deterministic",
                    latency_ms=0,
                    succeeded=parsed.value is not None or parsed.is_unknown,
                    error_code=None
                    if parsed.value is not None or parsed.is_unknown
                    else "PARSE_FAILED",
                )
        else:
            parsed = provider.parse_structured_field(transcript, field_key, FIELD_SCHEMAS[field_key])

    value = parsed.value
    confidence = float(parsed.confidence or 0.0)
    missing_reason = parsed.missing_reason

    # Local post-check: the deterministic parser must agree with the model.
    if local.value is not None and value is not None and str(local.value) != str(value):
        confidence = min(confidence, 0.55)
    if value is None and local.value is not None and missing_reason is None:
        value = local.value
        confidence = max(confidence, local.confidence)

    if missing_reason == "USER_UNKNOWN":
        value = None
        confidence = max(confidence, 0.90)

    readback_ur, readback_en = readback(field_key, value, lang=lang)
    needs_retry = value is None and missing_reason != "USER_UNKNOWN"
    if confidence < CONFIDENCE_THRESHOLD and missing_reason != "USER_UNKNOWN":
        needs_retry = True
    if lang == "sd" and needs_retry:
        readback_ur = sindhi.RETRY

    return VoiceParseResult(
        field_key=field_key,
        transcript=transcript,
        parsed_value=value,
        confidence=round(confidence, 3),
        missing_reason=missing_reason,
        readback_ur=readback_ur,
        readback_en=readback_en,
        needs_retry=needs_retry,
        provider=parsed.provider,
        model=parsed.model,
    )


def _local_parse(field_key: str, transcript: str) -> ParsedFieldResult:
    from app.ai.provider import (
        _parse_field,  # local import keeps the public surface small
    )

    return _parse_field(field_key, urdu_nlp.normalize_text(transcript))


# --------------------------------------------------------------------------- #
# TTS
# --------------------------------------------------------------------------- #
def synthesize(db: Any, text: str, *, lang: str = "ur", tenant_id: Any = None) -> tuple[bytes, str]:
    """Return ``(audio_bytes, mime_type)`` for a dynamic sentence, cached."""
    safe_text = guardrails.redact_for_llm(text or "").strip()
    if not safe_text:
        raise ValueError("text is empty")

    provider = get_provider()
    with telemetry(db, tenant_id=tenant_id, resource_type="voice_tts", resource_id=None):
        audio = (
            sindhi.synthesize(safe_text) if lang == "sd"
            else provider.synthesize_urdu_tts(safe_text)
        )

    mime = "audio/wav" if audio[:4] == b"RIFF" else "audio/mpeg"
    return audio, mime


def cache_key(text: str, voice: str = "flux-ambreen-ur") -> str:
    return hashlib.sha256(f"{voice}:{text}".encode()).hexdigest()


__all__ = [
    "CONFIDENCE_THRESHOLD",
    "FIELD_KEYS",
    "FIELD_SCHEMAS",
    "VoiceParseResult",
    "cache_key",
    "readback",
    "synthesize",
    "transcribe_and_parse",
]
