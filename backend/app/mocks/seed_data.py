"""Static synthetic seed data and pure helpers for :mod:`app.mocks.seed`.

Kept separate from the orchestration so the rule sets, personas and fact-shape
helpers stay readable and independently testable. Everything here is synthetic:
CNICs use the reserved fictional prefix ``99900``.
"""

from __future__ import annotations

import hashlib
import json
import random
import uuid
from dataclasses import dataclass
from datetime import date
from typing import Any, Sequence

SEED_RNG_SEED = 20261120
DEMO_PASSWORD = "Demo@2026"
CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

_NAMESPACE = uuid.UUID("6f1c2a54-6a1e-4f4a-9d3f-1f0c9b7a2e11")

SINDH_DISTRICTS: tuple[str, ...] = (
    "Thatta",
    "Badin",
    "Hyderabad",
    "Karachi",
    "Tharparkar",
    "Umerkot",
    "Mirpurkhas",
    "Sukkur",
    "Larkana",
    "Dadu",
)


# --------------------------------------------------------------------------- #
# deterministic identifiers
# --------------------------------------------------------------------------- #
def uid(key: str) -> uuid.UUID:
    """Stable UUIDv5 so re-seeding is idempotent and cross-references are stable."""
    return uuid.uuid5(_NAMESPACE, f"haqdaar:{key}")


def cnic(n: int) -> str:
    """Synthetic CNIC in the reserved ``99900`` range (13 digits)."""
    return f"99900{10_000_000 + n:08d}"


def canonical_json(payload: Any) -> str:
    return json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def content_hash(rules: dict[str, Any]) -> str:
    return sha256_text(canonical_json(rules))


def verification_code(rng: random.Random) -> str:
    return "HQ-" + "".join(rng.choice(CROCKFORD) for _ in range(5))


def hash_password(password: str) -> str:
    """Hash a demo password with BE's helper when present, else Argon2id."""
    try:  # pragma: no cover - depends on A1 landing
        from app.security.passwords import hash_password as be_hash  # type: ignore

        return be_hash(password)
    except Exception:
        pass
    try:
        from argon2 import PasswordHasher

        return PasswordHasher().hash(password)
    except Exception:  # pragma: no cover
        return sha256_text(password)


# --------------------------------------------------------------------------- #
# tenants & personas (docs/10 §2)
# --------------------------------------------------------------------------- #
TENANTS: tuple[dict[str, Any], ...] = (
    {
        "code": "SPD",
        "name": "Social Protection Department (Mock)",
        "name_ur": "محکمہ سماجی تحفظ (نقلی)",
    },
    {
        "code": "ZWB",
        "name": "Zakat & Welfare Board (Mock)",
        "name_ur": "محکمہ زکوٰۃ و بہبود (نقلی)",
    },
)


@dataclass(frozen=True)
class PersonaSpec:
    key: str
    role: str
    tenant_code: str | None
    full_name: str
    email: str | None = None
    phone: str | None = None
    cnic: str | None = None
    district: str | None = None
    preferred_lang: str = "ur"


PERSONAS: tuple[PersonaSpec, ...] = (
    PersonaSpec("widow_fatima", "CITIZEN", None, "Fatima Bibi", phone="+923001000001", cnic=cnic(12), district="Thatta"),
    PersonaSpec("shopkeeper_rasool", "CITIZEN", None, "Rasool Bakhsh", phone="+923001000002", cnic=cnic(21), district="Hyderabad"),
    PersonaSpec("helper_ayesha", "HELPER", None, "Ayesha Khatoon", email="ayesha@helper.mock", phone="+923001000003", cnic=cnic(32), district="Thatta"),
    PersonaSpec("officer_sana", "OFFICER", "SPD", "Sana Qureshi", email="sana@spd.mock", preferred_lang="en"),
    PersonaSpec("officer_imran", "OFFICER", "SPD", "Imran Siddiqui", email="imran@spd.mock", preferred_lang="en"),
    PersonaSpec("admin_bilal", "ADMIN", "SPD", "Bilal Ahmed", email="bilal@spd.mock", preferred_lang="en"),
    PersonaSpec("admin_platform", "ADMIN", None, "Platform Administrator", email="platform@haqdaar.mock", preferred_lang="en"),
    PersonaSpec("auditor_nadia", "AUDITOR", None, "Nadia Farooq", email="nadia@audit.mock", preferred_lang="en"),
    PersonaSpec("officer_zakat", "OFFICER", "ZWB", "Tariq Mehmood", email="tariq@zwb.mock", preferred_lang="en"),
)

#: Helper Ayesha's 7 additional linked families (Fatima is the 8th).
AYESHA_FAMILIES: tuple[tuple[str, str, str, str], ...] = (
    ("Sakina Bibi", cnic(201), "Thatta", "+923001000004"),
    ("Zainab Bibi", cnic(202), "Thatta", "+923001000005"),
    ("Mariam Bibi", cnic(203), "Thatta", "+923001000006"),
    ("Khadija Bibi", cnic(204), "Thatta", "+923001000007"),
    ("Amina Bibi", cnic(205), "Thatta", "+923001000008"),
    ("Haleema Bibi", cnic(206), "Thatta", "+923001000009"),
    ("Rukhsana Bibi", cnic(207), "Thatta", "+923001000010"),
)

#: The forged-name source: a card printed for Zainab Bibi but signed for Fatima.
FORGED_APPLICANT: tuple[str, str, str, str] = ("Zainab Bibi", cnic(208), "Thatta", "+923001000011")

#: The Muhammad / Mohammad Akram duplicate pair (no CNIC disambiguation).
AKRAM_PAIR: tuple[tuple[str, str, str], ...] = (
    ("Muhammad Akram", cnic(301), "Hyderabad"),
    ("Mohammad Akram", cnic(302), "Hyderabad"),
)

#: Three unrelated applicants sharing one payout alias (PAYOUT_ACCOUNT_SHARED).
SHARED_ALIAS_TRIO: tuple[tuple[str, str, str], ...] = (
    ("Nasreen Bibi", cnic(401), "Thatta"),
    ("Shabana Bibi", cnic(402), "Badin"),
    ("Farida Bibi", cnic(403), "Thatta"),
)

NAME_POOL: tuple[str, ...] = (
    "Sakina", "Zainab", "Mariam", "Khadija", "Amina", "Haleema", "Rukhsana", "Nasreen",
    "Shahida", "Razia", "Parveen", "Shabana", "Farida", "Naseem", "Suraiya", "Jamila",
    "Karima", "Latifa", "Mahjabeen", "Nusrat", "Qamar", "Rahima", "Saima", "Tahira",
    "Uzma", "Waziran", "Yasmin", "Zubaida", "Aqeela", "Bashiran",
)


# --------------------------------------------------------------------------- #
# rules (docs/06 §2.1 verbatim for Sahara; Guzara is pure configuration)
# --------------------------------------------------------------------------- #
def rule(
    rule_id: str,
    fact: str,
    op: str,
    value: Any,
    *,
    on_fail: str,
    on_unknown: str,
    label_en: str,
    label_ur: str,
    pass_en: str,
    pass_ur: str,
    fail_en: str,
    fail_ur: str,
    ask_en: str | None = None,
    ask_ur: str | None = None,
) -> dict[str, Any]:
    return {
        "id": rule_id,
        "fact": fact,
        "op": op,
        "value": value,
        "on_fail": on_fail,
        "on_unknown": on_unknown,
        "required_for_auto": True,
        "label_en": label_en,
        "label_ur": label_ur,
        "pass_reason_en": pass_en,
        "pass_reason_ur": pass_ur,
        "fail_reason_en": fail_en,
        "fail_reason_ur": fail_ur,
        "ask_prompt_en": ask_en,
        "ask_prompt_ur": ask_ur,
    }


_COST_MATRIX = {
    "wrong_approval_cost": 100,
    "unnecessary_human_review_cost": 8,
    "ask_more_cost": 5,
    "missed_fraud_multiplier": 1.5,
}

SAHARA_RULES_V1: dict[str, Any] = {
    "schema_version": "1.0",
    "program_code": "SAHARA_WIDOW_GRANT",
    "policy": {
        "auto_approve_confidence_threshold": 0.90,
        "auto_approve_max_amount_pkr": 20000,
        "max_ask_more_rounds": 2,
        "cost_matrix": dict(_COST_MATRIX),
    },
    "eligibility_rules": [
        rule(
            "R01_ALIVE", "applicant_is_alive", "eq", True, on_fail="HUMAN", on_unknown="HUMAN",
            label_en="Applicant must be alive in identity registry",
            label_ur="درخواست گزار کا شناختی ریکارڈ میں زندہ ہونا ضروری ہے",
            pass_en="Identity record confirmed active.",
            pass_ur="آپ کا شناختی ریکارڈ درست اور فعال پایا گیا۔",
            fail_en="Identity record shows a conflict requiring officer review.",
            fail_ur="شناختی ریکارڈ میں تضاد ہے جس کی جانچ افسر کرے گا۔",
        ),
        rule(
            "R02_CNIC_VALID", "applicant_cnic_valid", "eq", True, on_fail="ASK", on_unknown="ASK",
            label_en="CNIC must not be expired",
            label_ur="شناختی کارڈ کی میعاد ختم نہیں ہونی چاہیے",
            pass_en="Your CNIC is valid.",
            pass_ur="آپ کا شناختی کارڈ قابلِ قبول ہے۔",
            fail_en="Your CNIC appears expired.",
            fail_ur="آپ کے شناختی کارڈ کی میعاد ختم ہو چکی ہے۔",
            ask_en="Please upload a renewed CNIC photo.",
            ask_ur="براہ کرم تجدید شدہ شناختی کارڈ کی تصویر اپ لوڈ کریں۔",
        ),
        rule(
            "R03_AGE_MIN", "applicant_age_years", "gte", 18, on_fail="HUMAN", on_unknown="ASK",
            label_en="Applicant must be at least 18 years old",
            label_ur="درخواست گزار کی عمر کم از کم 18 سال ہونی چاہیے",
            pass_en="Age requirement met.",
            pass_ur="عمر کی شرط پوری ہے۔",
            fail_en="Recorded age is below 18.",
            fail_ur="ریکارڈ کے مطابق عمر 18 سال سے کم ہے۔",
            ask_en="Please confirm your date of birth or upload your CNIC.",
            ask_ur="براہ کرم اپنی تاریخ پیدائش کی تصدیق کریں۔",
        ),
        rule(
            "R04_WIDOW_VERIFIED", "spouse_death_verified", "eq", True, on_fail="HUMAN", on_unknown="ASK",
            label_en="Spouse death must be verified via civil registry or death certificate",
            label_ur="شوہر کی وفات کی تصدیق سول ریکارڈ یا وفات سرٹیفکیٹ سے ہونی چاہیے",
            pass_en="Widow status verified.",
            pass_ur="بیوہ ہونے کی تصدیق ہو گئی۔",
            fail_en="Spouse death could not be confirmed automatically.",
            fail_ur="شوہر کی وفات کی خودکار تصدیق نہیں ہو سکی۔",
            ask_en="Please upload your husband's death certificate photo.",
            ask_ur="براہ کرم شوہر کے وفات سرٹیفکیٹ کی واضح تصویر اپ لوڈ کریں۔",
        ),
        rule(
            "R05_INCOME_CAP", "monthly_income_pkr", "lte", 40000, on_fail="HUMAN", on_unknown="ASK",
            label_en="Monthly household income must be at most PKR 40,000",
            label_ur="گھریلو ماہانہ آمدنی 40,000 روپے یا اس سے کم ہونی چاہیے",
            pass_en="Household income is within the PKR 40,000 limit.",
            pass_ur="گھریلو آمدنی 40,000 روپے کی حد کے اندر ہے۔",
            fail_en="Recorded income exceeds the program limit; an officer will review.",
            fail_ur="ریکارڈ شدہ آمدنی حد سے زیادہ ہے؛ افسر جائزہ لے گا۔",
            ask_en="Please tell us your approximate monthly household income.",
            ask_ur="براہ کرم اپنی ماہانہ گھریلو آمدنی بتائیں۔",
        ),
        rule(
            "R06_NO_CONFLICTING_GRANT", "has_conflicting_active_grant", "eq", False, on_fail="HUMAN", on_unknown="HUMAN",
            label_en="Must not currently receive a conflicting relief grant",
            label_ur="کسی اور متضاد امدادی پروگرام سے رقم نہ مل رہی ہو",
            pass_en="No conflicting active benefit found.",
            pass_ur="کوئی اور متضاد امداد فعال نہیں پائی گئی۔",
            fail_en="Another active benefit record was found; an officer will verify.",
            fail_ur="ایک اور فعال امدادی ریکارڈ ملا ہے؛ افسر تصدیق کرے گا۔",
        ),
        rule(
            "R07_DISTRICT_SINDH", "applicant_district", "in", list(SINDH_DISTRICTS), on_fail="HUMAN", on_unknown="ASK",
            label_en="Applicant must reside in an eligible Sindh district",
            label_ur="درخواست گزار کا تعلق سندھ کے اہل ضلع سے ہونا چاہیے",
            pass_en="District is eligible for Sahara Grant.",
            pass_ur="آپ کا ضلع سہارا گرانٹ کے لیے اہل ہے۔",
            fail_en="District is outside the current pilot list; officer will check.",
            fail_ur="یہ ضلع موجودہ فہرست میں شامل نہیں؛ افسر جانچ کرے گا۔",
            ask_en="Please select your district.",
            ask_ur="براہ کرم اپنا ضلع منتخب کریں۔",
        ),
        rule(
            "R08_CNIC_DOC", "cnic_doc_verified", "eq", True, on_fail="ASK", on_unknown="ASK",
            label_en="CNIC document must be verified",
            label_ur="شناختی کارڈ کی تصویر کی تصدیق ضروری ہے",
            pass_en="CNIC document verified.",
            pass_ur="شناختی کارڈ کی تصویر کی تصدیق ہو گئی۔",
            fail_en="CNIC photo needs to be clearer or checked by an officer.",
            fail_ur="شناختی کارڈ کی تصویر واضح نہیں یا مزید جانچ درکار ہے۔",
            ask_en="Please take a clear photo of the front of your CNIC.",
            ask_ur="براہ کرم شناختی کارڈ کے سامنے والے حصے کی واضح تصویر لیں۔",
        ),
    ],
    "benefit_formula": {
        "base_amount_pkr": 12000,
        "per_child_bonus_pkr": 1000,
        "max_children_counted": 5,
        "hard_cap_pkr": 20000,
    },
}

GUZARA_RULES_V1: dict[str, Any] = {
    "schema_version": "1.0",
    "program_code": "GUZARA_ALLOWANCE",
    "policy": {
        "auto_approve_confidence_threshold": 0.90,
        "auto_approve_max_amount_pkr": 20000,
        "max_ask_more_rounds": 2,
        "cost_matrix": dict(_COST_MATRIX),
    },
    "eligibility_rules": [
        rule(
            "R01_ALIVE", "applicant_is_alive", "eq", True, on_fail="HUMAN", on_unknown="HUMAN",
            label_en="Applicant must be alive in identity registry",
            label_ur="درخواست گزار کا شناختی ریکارڈ میں زندہ ہونا ضروری ہے",
            pass_en="Identity record confirmed active.",
            pass_ur="آپ کا شناختی ریکارڈ درست اور فعال پایا گیا۔",
            fail_en="Identity record shows a conflict requiring officer review.",
            fail_ur="شناختی ریکارڈ میں تضاد ہے جس کی جانچ افسر کرے گا۔",
        ),
        rule(
            "R02_CNIC_VALID", "applicant_cnic_valid", "eq", True, on_fail="ASK", on_unknown="ASK",
            label_en="CNIC must not be expired",
            label_ur="شناختی کارڈ کی میعاد ختم نہیں ہونی چاہیے",
            pass_en="Your CNIC is valid.",
            pass_ur="آپ کا شناختی کارڈ قابلِ قبول ہے۔",
            fail_en="Your CNIC appears expired.",
            fail_ur="آپ کے شناختی کارڈ کی میعاد ختم ہو چکی ہے۔",
            ask_en="Please upload a renewed CNIC photo.",
            ask_ur="براہ کرم تجدید شدہ شناختی کارڈ کی تصویر اپ لوڈ کریں۔",
        ),
        rule(
            "R03_AGE_MIN", "applicant_age_years", "gte", 18, on_fail="HUMAN", on_unknown="ASK",
            label_en="Applicant must be at least 18 years old",
            label_ur="درخواست گزار کی عمر کم از کم 18 سال ہونی چاہیے",
            pass_en="Age requirement met.",
            pass_ur="عمر کی شرط پوری ہے۔",
            fail_en="Recorded age is below 18.",
            fail_ur="ریکارڈ کے مطابق عمر 18 سال سے کم ہے۔",
            ask_en="Please confirm your date of birth.",
            ask_ur="براہ کرم اپنی تاریخ پیدائش کی تصدیق کریں۔",
        ),
        rule(
            "R04_POVERTY_SCORE", "poverty_score", "lte", 30, on_fail="HUMAN", on_unknown="ASK",
            label_en="Household poverty score must be 30 or below",
            label_ur="گھریلو غربت اسکور 30 یا اس سے کم ہونا چاہیے",
            pass_en="Poverty score is within the Guzara Allowance limit.",
            pass_ur="غربت اسکور گزرا الاؤنس کی حد کے اندر ہے۔",
            fail_en="Poverty score is above the program limit; an officer will review.",
            fail_ur="غربت اسکور حد سے زیادہ ہے؛ افسر جائزہ لے گا۔",
            ask_en="Please allow us to check your household survey record.",
            ask_ur="براہ کرم ہمیں اپنے گھریلو سروے ریکارڈ کی جانچ کی اجازت دیں۔",
        ),
        rule(
            "R05_INCOME_CAP", "monthly_income_pkr", "lte", 30000, on_fail="HUMAN", on_unknown="ASK",
            label_en="Monthly household income must be at most PKR 30,000",
            label_ur="گھریلو ماہانہ آمدنی 30,000 روپے یا اس سے کم ہونی چاہیے",
            pass_en="Household income is within the PKR 30,000 limit.",
            pass_ur="گھریلو آمدنی 30,000 روپے کی حد کے اندر ہے۔",
            fail_en="Recorded income exceeds the program limit; an officer will review.",
            fail_ur="ریکارڈ شدہ آمدنی حد سے زیادہ ہے؛ افسر جائزہ لے گا۔",
            ask_en="Please tell us your approximate monthly household income.",
            ask_ur="براہ کرم اپنی ماہانہ گھریلو آمدنی بتائیں۔",
        ),
        rule(
            "R06_NO_CONFLICTING_GRANT", "has_conflicting_active_grant", "eq", False, on_fail="HUMAN", on_unknown="HUMAN",
            label_en="Must not currently receive a conflicting relief grant",
            label_ur="کسی اور متضاد امدادی پروگرام سے رقم نہ مل رہی ہو",
            pass_en="No conflicting active benefit found.",
            pass_ur="کوئی اور متضاد امداد فعال نہیں پائی گئی۔",
            fail_en="Another active benefit record was found; an officer will verify.",
            fail_ur="ایک اور فعال امدادی ریکارڈ ملا ہے؛ افسر تصدیق کرے گا۔",
        ),
        rule(
            "R07_DISTRICT_SINDH", "applicant_district", "in", list(SINDH_DISTRICTS), on_fail="HUMAN", on_unknown="ASK",
            label_en="Applicant must reside in an eligible Sindh district",
            label_ur="درخواست گزار کا تعلق سندھ کے اہل ضلع سے ہونا چاہیے",
            pass_en="District is eligible for Guzara Allowance.",
            pass_ur="آپ کا ضلع گزرا الاؤنس کے لیے اہل ہے۔",
            fail_en="District is outside the current pilot list; officer will check.",
            fail_ur="یہ ضلع موجودہ فہرست میں شامل نہیں؛ افسر جانچ کرے گا۔",
            ask_en="Please select your district.",
            ask_ur="براہ کرم اپنا ضلع منتخب کریں۔",
        ),
        rule(
            "R08_CNIC_DOC", "cnic_doc_verified", "eq", True, on_fail="ASK", on_unknown="ASK",
            label_en="CNIC document must be verified",
            label_ur="شناختی کارڈ کی تصویر کی تصدیق ضروری ہے",
            pass_en="CNIC document verified.",
            pass_ur="شناختی کارڈ کی تصویر کی تصدیق ہو گئی۔",
            fail_en="CNIC photo needs to be clearer or checked by an officer.",
            fail_ur="شناختی کارڈ کی تصویر واضح نہیں یا مزید جانچ درکار ہے۔",
            ask_en="Please take a clear photo of the front of your CNIC.",
            ask_ur="براہ کرم شناختی کارڈ کے سامنے والے حصے کی واضح تصویر لیں۔",
        ),
    ],
    "benefit_formula": {
        "base_amount_pkr": 8000,
        "per_child_bonus_pkr": 500,
        "max_children_counted": 5,
        "hard_cap_pkr": 12000,
    },
}


def wizard_schema(program_code: str) -> list[dict[str, Any]]:
    """14-step icon+audio wizard definition consumed by the citizen PWA (docs/11 §3.2)."""
    return [
        {"step": "consent", "type": "CONSENT", "audio_key": "consent_intro", "required": True},
        {"step": "applicant_full_name", "type": "TEXT", "fact_key": "applicant_full_name", "audio_key": "ask_full_name", "voice": True, "required": True},
        {"step": "applicant_cnic", "type": "CNIC", "fact_key": "applicant_cnic", "audio_key": "ask_cnic", "voice": True, "required": True},
        {"step": "applicant_dob", "type": "DATE", "fact_key": "applicant_dob", "audio_key": "ask_dob", "voice": True, "required": True},
        {"step": "spouse_full_name", "type": "TEXT", "fact_key": "spouse_full_name", "audio_key": "ask_spouse_name", "voice": True, "required": True},
        {"step": "spouse_cnic", "type": "CNIC", "fact_key": "spouse_cnic", "audio_key": "ask_spouse_cnic", "voice": True, "required": False, "allow_unknown": True},
        {"step": "applicant_district", "type": "DISTRICT", "fact_key": "applicant_district", "audio_key": "ask_district", "voice": True, "required": True, "options": list(SINDH_DISTRICTS)},
        {"step": "children_under_18", "type": "COUNTER", "fact_key": "children_under_18", "audio_key": "ask_children", "voice": True, "required": True, "min": 0, "max": 15},
        {"step": "household_size", "type": "COUNTER", "fact_key": "household_size", "audio_key": "ask_household_size", "voice": True, "required": True, "min": 1, "max": 30},
        {"step": "monthly_income_pkr", "type": "MONEY", "fact_key": "monthly_income_pkr", "audio_key": "ask_income", "voice": True, "required": True, "bands": [20000, 30000, 40000]},
        {"step": "payout_phone", "type": "PHONE", "fact_key": "payout_phone", "audio_key": "ask_payout_phone", "voice": True, "required": True},
        {"step": "doc_cnic_front", "type": "DOCUMENT", "doc_type": "CNIC_FRONT", "audio_key": "doc_cnic", "required": True},
        {"step": "doc_death_certificate", "type": "DOCUMENT", "doc_type": "SPOUSE_DEATH_CERTIFICATE", "audio_key": "doc_death_cert", "required": program_code == "SAHARA_WIDOW_GRANT", "allow_skip": True},
        {"step": "review_submit", "type": "REVIEW", "audio_key": "review_submit", "required": True},
    ]


# --------------------------------------------------------------------------- #
# fact helpers (docs/04 §5 shape)
# --------------------------------------------------------------------------- #
def fact(
    value: Any,
    source: str,
    confidence: float,
    *,
    entered_by: str = "SYSTEM",
    alternatives: Sequence[dict[str, Any]] | None = None,
    conflict: bool = False,
) -> dict[str, Any]:
    return {
        "state": "KNOWN",
        "value": value,
        "source": source,
        "source_confidence": round(float(confidence), 3),
        "entered_by": entered_by,
        "alternatives": list(alternatives or []),
        "conflict": conflict,
        "missing_reason": None,
    }


def unknown(*, entered_by: str = "CITIZEN", reason: str = "USER_UNKNOWN") -> dict[str, Any]:
    return {
        "state": "UNKNOWN",
        "value": None,
        "source": None,
        "source_confidence": 0.0,
        "entered_by": entered_by,
        "alternatives": [],
        "conflict": False,
        "missing_reason": reason,
    }


def age_from_dob(dob: str) -> int:
    born = date.fromisoformat(dob)
    today = date(2026, 11, 21)
    return today.year - born.year - ((today.month, today.day) < (born.month, born.day))


def build_facts(
    *,
    cnic_value: str | None,
    full_name: str,
    dob: str,
    district: str,
    income: int,
    children: int,
    household_size: int,
    poverty_score: int,
    payout_phone: str,
    spouse_name: str,
    spouse_cnic: str | None,
    self_declared_income: int | None = None,
    income_conflict: bool = False,
    cnic_doc_verified: bool = True,
    death_cert_verified: bool = True,
    consent_assurance: str = "SELF_OTP",
    is_alive: bool = True,
    cnic_valid: bool = True,
    conflicting_grant: bool = False,
) -> dict[str, Any]:
    alternatives: list[dict[str, Any]] = []
    if self_declared_income is not None and self_declared_income != income:
        alternatives.append(
            {"value": self_declared_income, "source": "SELF_DECLARED", "entered_by": "CITIZEN"}
        )
    facts: dict[str, Any] = {
        "applicant_cnic": fact(cnic_value, "DOCUMENT_QR", 0.97) if cnic_value else unknown(),
        "applicant_full_name": fact(full_name, "IDENTITY_REGISTRY", 0.93),
        "applicant_dob": fact(dob, "IDENTITY_REGISTRY", 0.95),
        "applicant_age_years": fact(age_from_dob(dob), "IDENTITY_REGISTRY", 0.95),
        "applicant_is_alive": fact(is_alive, "IDENTITY_REGISTRY", 0.99),
        "applicant_cnic_valid": fact(cnic_valid, "IDENTITY_REGISTRY", 0.98),
        "applicant_district": fact(district, "SELF_DECLARED", 0.95, entered_by="CITIZEN"),
        "marital_status_widow": fact(True, "CIVIL_REGISTRY", 0.96),
        "spouse_death_verified": fact(death_cert_verified, "CIVIL_REGISTRY", 0.96),
        "spouse_full_name": fact(spouse_name, "SELF_DECLARED", 0.9, entered_by="CITIZEN"),
        "spouse_cnic": fact(spouse_cnic, "CIVIL_REGISTRY", 0.95) if spouse_cnic else unknown(),
        "children_under_18": fact(children, "SELF_DECLARED", 0.93, entered_by="CITIZEN"),
        "household_size": fact(household_size, "HOUSEHOLD_SURVEY", 0.92),
        "monthly_income_pkr": fact(
            income, "HOUSEHOLD_SURVEY", 0.92, alternatives=alternatives, conflict=income_conflict
        ),
        "poverty_score": fact(poverty_score, "HOUSEHOLD_SURVEY", 0.9),
        "has_conflicting_active_grant": fact(conflicting_grant, "BENEFITS_REGISTRY", 0.95),
        "payout_phone": fact(payout_phone, "SELF_DECLARED", 0.95, entered_by="CITIZEN"),
        "cnic_doc_verified": fact(cnic_doc_verified, "DOCUMENT_VERIFIER", 0.94),
        "death_cert_doc_verified": fact(death_cert_verified, "DOCUMENT_VERIFIER", 0.93),
        "citizen_has_active_dept_consent": fact(True, "CONSENT_ENGINE", 1.0),
    }
    facts["_consent_assurance"] = consent_assurance
    return facts


def public_facts(facts: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in facts.items() if not key.startswith("_")}


def rule_trace(rules: dict[str, Any], facts: dict[str, Any]) -> list[dict[str, Any]]:
    """Evaluate the rule set against facts to produce a deterministic trace."""
    trace: list[dict[str, Any]] = []
    for spec in rules["eligibility_rules"]:
        current = facts.get(spec["fact"], unknown())
        if current["state"] == "UNKNOWN":
            result = "UNKNOWN"
            actual: Any = None
        else:
            actual = current["value"]
            expected = spec["value"]
            op = spec["op"]
            if op == "eq":
                result = "PASS" if actual == expected else "FAIL"
            elif op == "neq":
                result = "PASS" if actual != expected else "FAIL"
            elif op == "gte":
                result = "PASS" if actual >= expected else "FAIL"
            elif op == "lte":
                result = "PASS" if actual <= expected else "FAIL"
            elif op == "gt":
                result = "PASS" if actual > expected else "FAIL"
            elif op == "lt":
                result = "PASS" if actual < expected else "FAIL"
            elif op == "in":
                result = "PASS" if actual in expected else "FAIL"
            elif op == "not_in":
                result = "PASS" if actual not in expected else "FAIL"
            else:  # pragma: no cover - DSL validator rejects unknown ops
                result = "UNKNOWN"
        trace.append(
            {
                "rule_id": spec["id"],
                "result": result,
                "actual": actual,
                "expected": spec["value"],
                "reason_ur": spec["pass_reason_ur"] if result == "PASS" else spec["fail_reason_ur"],
                "reason_en": spec["pass_reason_en"] if result == "PASS" else spec["fail_reason_en"],
            }
        )
    return trace


def amount_for(formula: dict[str, Any], children: int) -> int:
    counted = min(max(0, children), int(formula["max_children_counted"]))
    return min(
        int(formula["hard_cap_pkr"]),
        int(formula["base_amount_pkr"]) + counted * int(formula["per_child_bonus_pkr"]),
    )


def confidence(
    *, identity: float, documents: float, data_consistency: float, consent: float
) -> dict[str, float]:
    return {
        "identity": round(identity, 3),
        "documents": round(documents, 3),
        "data_consistency": round(data_consistency, 3),
        "consent_assurance": round(consent, 3),
        "overall": round(min(identity, documents, data_consistency, consent), 3),
    }


def explanation(
    *,
    outcome: str,
    amount: int | None,
    reasons_en: Sequence[str],
    reasons_ur: Sequence[str],
    next_en: str,
    next_ur: str,
) -> dict[str, Any]:
    headlines = {
        "APPROVED": (
            f"Your application is approved. PKR {amount:,} is being sent." if amount else "Your application is approved.",
            f"آپ کی درخواست منظور ہو گئی ہے۔ {amount:,} روپے بھیجے جا رہے ہیں۔" if amount else "آپ کی درخواست منظور ہو گئی ہے۔",
        ),
        "HUMAN_REVIEW": (
            "An officer will review your application — usually within 2 days. You do not need to do anything.",
            "ایک افسر آپ کی درخواست کا جائزہ لے گا — عام طور پر 2 دن میں۔ آپ کو کچھ کرنے کی ضرورت نہیں۔",
        ),
        "NEEDS_INFO": (
            "We need one more thing to finish checking your application.",
            "آپ کی درخواست کی جانچ مکمل کرنے کے لیے ایک اور چیز درکار ہے۔",
        ),
        "WAITING_EXTERNAL": (
            "A government verification system is temporarily slow. We saved everything and will continue automatically.",
            "ایک سرکاری تصدیقی نظام عارضی طور پر سست ہے۔ ہم نے سب کچھ محفوظ کر لیا ہے اور خودکار طور پر جاری رکھیں گے۔",
        ),
    }
    headline_en, headline_ur = headlines.get(outcome, headlines["HUMAN_REVIEW"])
    return {
        "headline_ur": headline_ur,
        "headline_en": headline_en,
        "reasons_ur": list(reasons_ur)[:3],
        "reasons_en": list(reasons_en)[:3],
        "next_step_ur": next_ur,
        "next_step_en": next_en,
    }


__all__ = [
    "AKRAM_PAIR",
    "AYESHA_FAMILIES",
    "CROCKFORD",
    "DEMO_PASSWORD",
    "FORGED_APPLICANT",
    "GUZARA_RULES_V1",
    "NAME_POOL",
    "PERSONAS",
    "PersonaSpec",
    "SAHARA_RULES_V1",
    "SEED_RNG_SEED",
    "SHARED_ALIAS_TRIO",
    "SINDH_DISTRICTS",
    "TENANTS",
    "age_from_dob",
    "amount_for",
    "build_facts",
    "canonical_json",
    "cnic",
    "confidence",
    "content_hash",
    "explanation",
    "fact",
    "hash_password",
    "public_facts",
    "rule",
    "rule_trace",
    "sha256_text",
    "uid",
    "unknown",
    "verification_code",
    "wizard_schema",
]
