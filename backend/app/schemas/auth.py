"""Auth request/response DTOs (docs/05 §3.1)."""

from __future__ import annotations

import uuid
from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

PHONE_PATTERN = r"^\+92[0-9]{10}$"


def normalize_phone(value: str) -> str:
    """Normalise to ``+92XXXXXXXXXX``; accepts ``0300...``, ``+92 300 ...``, ``92300...``."""
    digits = "".join(ch for ch in str(value) if ch.isdigit())
    if digits.startswith("92") and len(digits) == 12:
        return f"+{digits}"
    if digits.startswith("0") and len(digits) == 11:
        return f"+92{digits[1:]}"
    if len(digits) == 10 and digits.startswith("3"):
        return f"+92{digits}"
    return f"+{digits}" if digits else ""


class OtpRequestIn(BaseModel):
    phone: str = Field(examples=["+923001000001"])
    purpose: Literal["LOGIN", "HELPER_CONSENT"] = "LOGIN"

    @field_validator("phone")
    @classmethod
    def _normalise(cls, value: str) -> str:
        phone = normalize_phone(value)
        if len(phone) != 13 or not phone.startswith("+92"):
            raise ValueError("phone must be a Pakistani mobile number")
        return phone


class OtpRequestOut(BaseModel):
    challenge_id: uuid.UUID
    expires_in_sec: int
    simulated_sms_hint: str = "Check the Device Simulator inbox for the code."


class OtpVerifyIn(BaseModel):
    challenge_id: uuid.UUID
    code: str = Field(min_length=4, max_length=8, examples=["123456"])


class LoginIn(BaseModel):
    email: EmailStr = Field(examples=["sana@spd.mock"])
    password: str = Field(min_length=1, examples=["Demo@2026"])


class DemoLoginIn(BaseModel):
    persona_key: Literal[
        "widow_fatima",
        "shopkeeper_rasool",
        "helper_ayesha",
        "officer_sana",
        "officer_imran",
        "admin_bilal",
        "admin_platform",
        "auditor_nadia",
        "officer_zakat",
    ] = Field(examples=["widow_fatima"])


class RefreshIn(BaseModel):
    refresh_token: str


class LogoutIn(BaseModel):
    refresh_token: str


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    role: str
    tenant_id: uuid.UUID | None = None
    full_name: str
    email: str | None = None
    phone: str | None = None
    preferred_lang: str = "ur"
    is_active: bool = True


class CitizenOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    full_name: str
    cnic_masked: str | None = None
    phone_masked: str | None = None
    district: str | None = None
    avatar_color: str = "#0F766E"


class TenantOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    code: str
    name: str
    name_ur: str


class TokenOut(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"  # noqa: S105 - OAuth token type, not a secret
    expires_in: int
    user: UserOut
    citizen_id: uuid.UUID | None = None


class RefreshOut(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"  # noqa: S105 - OAuth token type, not a secret
    expires_in: int


class MeOut(BaseModel):
    user: UserOut
    citizen: CitizenOut | None = None
    tenant: TenantOut | None = None


__all__ = [
    "CitizenOut",
    "DemoLoginIn",
    "LoginIn",
    "LogoutIn",
    "MeOut",
    "OtpRequestIn",
    "OtpRequestOut",
    "OtpVerifyIn",
    "RefreshIn",
    "RefreshOut",
    "TenantOut",
    "TokenOut",
    "UserOut",
    "normalize_phone",
]
