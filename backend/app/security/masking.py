"""PII masking helpers — mandatory for every log line, audit payload and list view.

Rule 7 of the charter: raw 13-digit CNICs, phone numbers, OTPs, passwords and JWTs
must never be logged. These helpers are the only sanctioned way to render them.
"""

from __future__ import annotations

import re
from typing import Any

_CNIC_DASHED = re.compile(r"\b(\d{5})-(\d{7})-(\d)\b")
_CNIC_DIGITS = re.compile(r"\b(\d{5})(\d{4})(\d{4})\b")
_PHONE = re.compile(r"(\+92\d{2})\d{5,6}(\d{3})\b")
_JWT = re.compile(r"\beyJ[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}\b")
_BEARER = re.compile(r"(?i)\bbearer\s+[A-Za-z0-9._\-]{8,}")

#: Keys whose values are always replaced wholesale, whatever they contain.
SECRET_KEYS = frozenset(
    {
        "password",
        "password_hash",
        "otp",
        "otp_code",
        "code",
        "code_hash",
        "token",
        "access_token",
        "refresh_token",
        "token_hash",
        "jwt",
        "authorization",
        "api_key",
        "key_hash",
        "secret",
        "jwt_secret",
        "qr_hmac_secret",
        "cnic",
        "cnic_digits",
        "phone",
        "payout_alias",
        "payout_phone",
    }
)

REDACTED = "[REDACTED]"


def mask_cnic(value: str | None) -> str | None:
    """``42101-1234567-2`` -> ``42101-****567-2``; ``9990010000012`` -> ``99900****0012``."""
    if not value:
        return value
    text = str(value)
    if _CNIC_DASHED.search(text):
        return _CNIC_DASHED.sub(lambda m: f"{m.group(1)}-****{m.group(2)[-3:]}-{m.group(3)}", text)
    if _CNIC_DIGITS.search(text):
        return _CNIC_DIGITS.sub(lambda m: f"{m.group(1)}****{m.group(3)}", text)
    if len(text) > 6:
        return f"{text[:3]}****{text[-2:]}"
    return "****"


def mask_phone(value: str | None) -> str | None:
    """``+923001000001`` -> ``+9230*****001``."""
    if not value:
        return value
    text = str(value)
    if _PHONE.search(text):
        return _PHONE.sub(lambda m: f"{m.group(1)}*****{m.group(2)}", text)
    if len(text) > 8:
        return f"{text[:5]}*****{text[-3:]}"
    return "****"


def mask_email(value: str | None) -> str | None:
    if not value or "@" not in str(value):
        return value
    local, _, domain = str(value).partition("@")
    keep = local[:2] if len(local) > 2 else local[:1]
    return f"{keep}***@{domain}"


def mask_name(value: str | None) -> str | None:
    """Keep the first token, initialise the rest: ``Fatima Bibi`` -> ``Fatima B.``."""
    if not value:
        return value
    parts = str(value).split()
    if len(parts) <= 1:
        return str(value)
    return " ".join([parts[0], *[f"{p[0]}." for p in parts[1:]]])


def scrub_text(text: str) -> str:
    """Remove CNIC / phone / JWT patterns from a free-text string."""
    if not text:
        return text
    out = _JWT.sub("[REDACTED_JWT]", text)
    out = _BEARER.sub("Bearer [REDACTED]", out)
    out = _CNIC_DASHED.sub(lambda m: f"{m.group(1)}-****{m.group(2)[-3:]}-{m.group(3)}", out)
    out = _CNIC_DIGITS.sub(lambda m: f"{m.group(1)}****{m.group(3)}", out)
    out = _PHONE.sub(lambda m: f"{m.group(1)}*****{m.group(2)}", out)
    return out


def redact_payload(value: Any, *, _depth: int = 0) -> Any:
    """Deep-redact a JSON-able payload before it reaches logs or ``audit_events``."""
    if _depth > 8:
        return REDACTED
    if isinstance(value, dict):
        return {
            str(k): (
                REDACTED
                if str(k).lower() in SECRET_KEYS and value[k] not in (None, "", [], {})
                else redact_payload(v, _depth=_depth + 1)
            )
            for k, v in value.items()
        }
    if isinstance(value, (list, tuple, set)):
        return [redact_payload(item, _depth=_depth + 1) for item in value]
    if isinstance(value, str):
        return scrub_text(value)
    return value


__all__ = [
    "REDACTED",
    "SECRET_KEYS",
    "mask_cnic",
    "mask_email",
    "mask_name",
    "mask_phone",
    "redact_payload",
    "scrub_text",
]
