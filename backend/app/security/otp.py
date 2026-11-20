"""OTP challenges: SHA-256 + per-challenge salt, 5 min TTL, max 5 attempts.

docs/09 §1.1 — the plaintext code is never stored, never logged, and is delivered
to the citizen only through the simulated SMS inbox (``notifications`` rows).
"""

from __future__ import annotations

import hashlib
import hmac
import secrets
import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy.orm import Session

from app.config import settings
from app.models.enums import OtpPurpose
from app.models.identity import OtpChallenge
from app.security.errors import InvalidOtpError


def _now() -> datetime:
    return datetime.now(UTC)


def generate_otp_code() -> str:
    """Cryptographically random 6-digit code (``secrets.randbelow``)."""
    return f"{secrets.randbelow(1_000_000):06d}"


def hash_otp(code: str, salt: str) -> str:
    digest = hashlib.sha256(f"{salt}{code}".encode("utf-8")).hexdigest()
    return f"{salt}${digest}"


def verify_otp_hash(code: str, stored: str) -> bool:
    salt, _, _digest = stored.partition("$")
    if not salt:
        return False
    return hmac.compare_digest(hash_otp(code, salt), stored)


def create_challenge(
    db: Session, *, phone: str, purpose: OtpPurpose | str = OtpPurpose.LOGIN
) -> tuple[OtpChallenge, str]:
    """Create a challenge row and return ``(challenge, plaintext_code)``."""
    code = generate_otp_code()
    salt = secrets.token_hex(16)
    challenge = OtpChallenge(
        phone=phone,
        purpose=str(purpose),
        code_hash=hash_otp(code, salt),
        attempts=0,
        expires_at=_now() + timedelta(seconds=settings.otp_ttl_seconds),
    )
    db.add(challenge)
    db.flush()
    return challenge, code


def verify_challenge(db: Session, *, challenge_id: uuid.UUID, code: str) -> OtpChallenge:
    """Validate a code, consuming the challenge on success.

    Raises ``401 INVALID_OTP`` for wrong code, expired challenge, exhausted
    attempts or an already-consumed challenge.
    """
    challenge = db.get(OtpChallenge, challenge_id)
    if challenge is None:
        raise InvalidOtpError()

    if challenge.consumed_at is not None:
        raise InvalidOtpError(
            message_en="This code was already used. Please request a new one.",
            message_ur="یہ کوڈ پہلے استعمال ہو چکا ہے۔ براہ کرم نیا کوڈ منگوائیں۔",
        )

    if challenge.expires_at <= _now():
        raise InvalidOtpError(
            message_en="This code has expired. Please request a new one.",
            message_ur="اس کوڈ کی مدت ختم ہو گئی ہے۔ براہ کرم نیا کوڈ منگوائیں۔",
        )

    if challenge.attempts >= settings.otp_max_attempts:
        raise InvalidOtpError(
            message_en="Too many incorrect attempts. Please request a new code.",
            message_ur="بہت زیادہ غلط کوششیں۔ براہ کرم نیا کوڈ منگوائیں۔",
        )

    if not verify_otp_hash(code, challenge.code_hash):
        challenge.attempts += 1
        db.flush()
        raise InvalidOtpError(
            details={"attempts_remaining": max(0, settings.otp_max_attempts - challenge.attempts)}
        )

    challenge.consumed_at = _now()
    db.flush()
    return challenge


__all__ = [
    "create_challenge",
    "generate_otp_code",
    "hash_otp",
    "verify_challenge",
    "verify_otp_hash",
]
