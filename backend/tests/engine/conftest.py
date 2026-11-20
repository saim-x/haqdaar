"""Shared fixtures for the pure engine test suite.

No database, no HTTP, no AI. Everything here is in-memory and deterministic.
"""

from __future__ import annotations

import copy
import sys
from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest

BACKEND_ROOT = Path(__file__).resolve().parents[2]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.engine.anomalies import RiskFlag
from app.engine.confidence import (
    ConfidenceComponents,
    ConsentMethod,
    DocumentEvidence,
    DocumentStatus,
)
from app.engine.facts import (
    EnteredBy,
    Fact,
    FactBundle,
    FactSource,
    MissingReason,
    known_fact,
    unknown_fact,
)
from app.engine.rules_dsl import RuleSetSchema

#: Sahara Widow Support Grant v1, copied verbatim from docs/06-decision-engine.md §2.1.
SAHARA_V1: dict[str, Any] = {
    "schema_version": "1.0",
    "program_code": "SAHARA_WIDOW_GRANT",
    "policy": {
        "auto_approve_confidence_threshold": 0.90,
        "auto_approve_max_amount_pkr": 20000,
        "max_ask_more_rounds": 2,
        "cost_matrix": {
            "wrong_approval_cost": 100,
            "unnecessary_human_review_cost": 8,
            "ask_more_cost": 5,
            "missed_fraud_multiplier": 1.5,
        },
    },
    "eligibility_rules": [
        {
            "id": "R01_ALIVE",
            "fact": "applicant_is_alive",
            "op": "eq",
            "value": True,
            "on_fail": "HUMAN",
            "on_unknown": "HUMAN",
            "required_for_auto": True,
            "label_en": "Applicant must be alive in identity registry",
            "label_ur": "درخواست گزار کا شناختی ریکارڈ میں زندہ ہونا ضروری ہے",
            "pass_reason_en": "Identity record confirmed active.",
            "pass_reason_ur": "آپ کا شناختی ریکارڈ درست اور فعال پایا گیا۔",
            "fail_reason_en": "Identity record shows a conflict requiring officer review.",
            "fail_reason_ur": "شناختی ریکارڈ میں تضاد ہے جس کی جانچ افسر کرے گا۔",
            "ask_prompt_en": None,
            "ask_prompt_ur": None,
        },
        {
            "id": "R02_CNIC_VALID",
            "fact": "applicant_cnic_valid",
            "op": "eq",
            "value": True,
            "on_fail": "ASK",
            "on_unknown": "ASK",
            "required_for_auto": True,
            "label_en": "CNIC must not be expired",
            "label_ur": "شناختی کارڈ کی میعاد ختم نہیں ہونی چاہیے",
            "pass_reason_en": "Your CNIC is valid.",
            "pass_reason_ur": "آپ کا شناختی کارڈ قابلِ قبول ہے۔",
            "fail_reason_en": "Your CNIC appears expired.",
            "fail_reason_ur": "آپ کے شناختی کارڈ کی میعاد ختم ہو چکی ہے۔",
            "ask_prompt_en": "Please upload a renewed CNIC photo.",
            "ask_prompt_ur": "براہ کرم تجدید شدہ شناختی کارڈ کی تصویر اپ لوڈ کریں۔",
        },
        {
            "id": "R03_AGE_MIN",
            "fact": "applicant_age_years",
            "op": "gte",
            "value": 18,
            "on_fail": "HUMAN",
            "on_unknown": "ASK",
            "required_for_auto": True,
            "label_en": "Applicant must be at least 18 years old",
            "label_ur": "درخواست گزار کی عمر کم از کم 18 سال ہونی چاہیے",
            "pass_reason_en": "Age requirement met.",
            "pass_reason_ur": "عمر کی شرط پوری ہے۔",
            "fail_reason_en": "Recorded age is below 18.",
            "fail_reason_ur": "ریکارڈ کے مطابق عمر 18 سال سے کم ہے۔",
            "ask_prompt_en": "Please confirm your date of birth or upload your CNIC.",
            "ask_prompt_ur": "براہ کرم اپنی تاریخ پیدائش کی تصدیق کریں۔",
        },
        {
            "id": "R04_WIDOW_VERIFIED",
            "fact": "spouse_death_verified",
            "op": "eq",
            "value": True,
            "on_fail": "HUMAN",
            "on_unknown": "ASK",
            "required_for_auto": True,
            "label_en": (
                "Spouse death must be verified via civil registry or death certificate"
            ),
            "label_ur": "شوہر کی وفات کی تصدیق سول ریکارڈ یا وفات سرٹیفکیٹ سے ہونی چاہیے",
            "pass_reason_en": "Widow status verified.",
            "pass_reason_ur": "بیوہ ہونے کی تصدیق ہو گئی۔",
            "fail_reason_en": "Spouse death could not be confirmed automatically.",
            "fail_reason_ur": "شوہر کی وفات کی خودکار تصدیق نہیں ہو سکی۔",
            "ask_prompt_en": "Please upload your husband's death certificate photo.",
            "ask_prompt_ur": "براہ کرم شوہر کے وفات سرٹیفکیٹ کی واضح تصویر اپ لوڈ کریں۔",
        },
        {
            "id": "R05_INCOME_CAP",
            "fact": "monthly_income_pkr",
            "op": "lte",
            "value": 40000,
            "on_fail": "HUMAN",
            "on_unknown": "ASK",
            "required_for_auto": True,
            "label_en": "Monthly household income must be at most PKR 40,000",
            "label_ur": "گھریلو ماہانہ آمدنی 40,000 روپے یا اس سے کم ہونی چاہیے",
            "pass_reason_en": "Household income is within the PKR 40,000 limit.",
            "pass_reason_ur": "گھریلو آمدنی 40,000 روپے کی حد کے اندر ہے۔",
            "fail_reason_en": (
                "Recorded income exceeds the program limit; an officer will review."
            ),
            "fail_reason_ur": "ریکارڈ شدہ آمدنی حد سے زیادہ ہے؛ افسر جائزہ لے گا۔",
            "ask_prompt_en": "Please tell us your approximate monthly household income.",
            "ask_prompt_ur": "براہ کرم اپنی ماہانہ گھریلو آمدنی بتائیں۔",
        },
        {
            "id": "R06_NO_CONFLICTING_GRANT",
            "fact": "has_conflicting_active_grant",
            "op": "eq",
            "value": False,
            "on_fail": "HUMAN",
            "on_unknown": "HUMAN",
            "required_for_auto": True,
            "label_en": "Must not currently receive a conflicting relief grant",
            "label_ur": "کسی اور متضاد امدادی پروگرام سے رقم نہ مل رہی ہو",
            "pass_reason_en": "No conflicting active benefit found.",
            "pass_reason_ur": "کوئی اور متضاد امداد فعال نہیں پائی گئی۔",
            "fail_reason_en": (
                "Another active benefit record was found; an officer will verify."
            ),
            "fail_reason_ur": "ایک اور فعال امدادی ریکارڈ ملا ہے؛ افسر تصدیق کرے گا۔",
            "ask_prompt_en": None,
            "ask_prompt_ur": None,
        },
        {
            "id": "R07_DISTRICT_SINDH",
            "fact": "applicant_district",
            "op": "in",
            "value": [
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
            ],
            "on_fail": "HUMAN",
            "on_unknown": "ASK",
            "required_for_auto": True,
            "label_en": "Applicant must reside in an eligible Sindh district",
            "label_ur": "درخواست گزار کا تعلق سندھ کے اہل ضلع سے ہونا چاہیے",
            "pass_reason_en": "District is eligible for Sahara Grant.",
            "pass_reason_ur": "آپ کا ضلع سہارا گرانٹ کے لیے اہل ہے۔",
            "fail_reason_en": "District is outside the current pilot list; officer will check.",
            "fail_reason_ur": "یہ ضلع موجودہ فہرست میں شامل نہیں؛ افسر جانچ کرے گا۔",
            "ask_prompt_en": "Please select your district.",
            "ask_prompt_ur": "براہ کرم اپنا ضلع منتخب کریں۔",
        },
        {
            "id": "R08_CNIC_DOC",
            "fact": "cnic_doc_verified",
            "op": "eq",
            "value": True,
            "on_fail": "ASK",
            "on_unknown": "ASK",
            "required_for_auto": True,
            "label_en": "CNIC document must be verified",
            "label_ur": "شناختی کارڈ کی تصویر کی تصدیق ضروری ہے",
            "pass_reason_en": "CNIC document verified.",
            "pass_reason_ur": "شناختی کارڈ کی تصویر کی تصدیق ہو گئی۔",
            "fail_reason_en": "CNIC photo needs to be clearer or checked by an officer.",
            "fail_reason_ur": "شناختی کارڈ کی تصویر واضح نہیں یا مزید جانچ درکار ہے۔",
            "ask_prompt_en": "Please take a clear photo of the front of your CNIC.",
            "ask_prompt_ur": "براہ کرم شناختی کارڈ کے سامنے والے حصے کی واضح تصویر لیں۔",
        },
    ],
    "benefit_formula": {
        "base_amount_pkr": 12000,
        "per_child_bonus_pkr": 1000,
        "max_children_counted": 5,
        "hard_cap_pkr": 20000,
    },
}


@pytest.fixture()
def sahara_v1_json() -> dict[str, Any]:
    """A fresh deep copy of the frozen Sahara v1 document."""
    return copy.deepcopy(SAHARA_V1)


@pytest.fixture()
def sahara_v1(sahara_v1_json: dict[str, Any]) -> RuleSetSchema:
    return RuleSetSchema.model_validate(sahara_v1_json)


def _fatima_fact_map() -> dict[str, Fact]:
    return {
        "applicant_cnic": known_fact(
            "applicant_cnic",
            "9990010000012",
            source=FactSource.SELF_DECLARED,
            source_confidence=0.99,
            entered_by=EnteredBy.CITIZEN,
        ),
        "applicant_full_name": known_fact(
            "applicant_full_name",
            "Fatima Bibi",
            source=FactSource.SELF_DECLARED,
            source_confidence=0.95,
            entered_by=EnteredBy.CITIZEN,
        ),
        "applicant_dob": known_fact(
            "applicant_dob",
            "1974-05-14",
            source=FactSource.IDENTITY_REGISTRY,
            source_confidence=0.98,
        ),
        "applicant_age_years": known_fact(
            "applicant_age_years",
            51,
            source=FactSource.DERIVED,
            source_confidence=0.98,
        ),
        "applicant_is_alive": known_fact(
            "applicant_is_alive",
            True,
            source=FactSource.IDENTITY_REGISTRY,
            source_confidence=0.99,
        ),
        "applicant_cnic_valid": known_fact(
            "applicant_cnic_valid",
            True,
            source=FactSource.IDENTITY_REGISTRY,
            source_confidence=0.99,
        ),
        "applicant_district": known_fact(
            "applicant_district",
            "Thatta",
            source=FactSource.SELF_DECLARED,
            source_confidence=0.95,
            entered_by=EnteredBy.CITIZEN,
        ),
        "marital_status_widow": known_fact(
            "marital_status_widow",
            True,
            source=FactSource.CIVIL_REGISTRY,
            source_confidence=0.97,
        ),
        "spouse_death_verified": known_fact(
            "spouse_death_verified",
            True,
            source=FactSource.CIVIL_REGISTRY,
            source_confidence=0.97,
        ),
        "spouse_full_name": known_fact(
            "spouse_full_name",
            "Ghulam Rasool",
            source=FactSource.CIVIL_REGISTRY,
            source_confidence=0.95,
        ),
        "spouse_cnic": known_fact(
            "spouse_cnic",
            "9990010000021",
            source=FactSource.CIVIL_REGISTRY,
            source_confidence=0.95,
        ),
        "children_under_18": known_fact(
            "children_under_18",
            3,
            source=FactSource.SELF_DECLARED,
            source_confidence=0.95,
            entered_by=EnteredBy.CITIZEN,
        ),
        "household_size": known_fact(
            "household_size",
            4,
            source=FactSource.HOUSEHOLD_SURVEY,
            source_confidence=0.92,
        ),
        "monthly_income_pkr": known_fact(
            "monthly_income_pkr",
            28000,
            source=FactSource.HOUSEHOLD_SURVEY,
            source_confidence=0.92,
        ),
        "poverty_score": known_fact(
            "poverty_score",
            24,
            source=FactSource.HOUSEHOLD_SURVEY,
            source_confidence=0.92,
        ),
        "has_conflicting_active_grant": known_fact(
            "has_conflicting_active_grant",
            False,
            source=FactSource.BENEFITS_REGISTRY,
            source_confidence=0.95,
        ),
        "payout_phone": known_fact(
            "payout_phone",
            "+923001000001",
            source=FactSource.SELF_DECLARED,
            source_confidence=0.95,
            entered_by=EnteredBy.CITIZEN,
        ),
        "cnic_doc_verified": known_fact(
            "cnic_doc_verified",
            True,
            source=FactSource.DOCUMENT_VERIFIER,
            source_confidence=0.96,
        ),
        "death_cert_doc_verified": known_fact(
            "death_cert_doc_verified",
            True,
            source=FactSource.DOCUMENT_VERIFIER,
            source_confidence=0.95,
        ),
        "citizen_has_active_dept_consent": known_fact(
            "citizen_has_active_dept_consent",
            True,
            source=FactSource.CONSENT_ENGINE,
            source_confidence=1.0,
        ),
    }


@pytest.fixture()
def fatima_facts() -> FactBundle:
    """The clean golden-path bundle: every canonical fact KNOWN and passing."""
    return FactBundle(facts=_fatima_fact_map())


@pytest.fixture()
def make_facts() -> Callable[..., FactBundle]:
    """Build a Fatima bundle with specific facts replaced."""

    def _make(**overrides: Fact) -> FactBundle:
        facts = _fatima_fact_map()
        facts.update(overrides)
        return FactBundle(facts=facts)

    return _make


@pytest.fixture()
def fatima_documents() -> tuple[DocumentEvidence, ...]:
    return (
        DocumentEvidence(
            doc_type="CNIC_FRONT",
            status=DocumentStatus.VERIFIED,
            verify_confidence=0.96,
        ),
        DocumentEvidence(
            doc_type="SPOUSE_DEATH_CERTIFICATE",
            status=DocumentStatus.VERIFIED,
            verify_confidence=0.95,
        ),
    )


@pytest.fixture()
def fatima_confidence(fatima_documents: tuple[DocumentEvidence, ...]) -> ConfidenceComponents:
    return ConfidenceComponents(
        identity=0.98,
        documents=0.95,
        data_consistency=0.98,
        consent_assurance=1.0,
        overall=0.95,
    )


@pytest.fixture()
def unknown_income() -> Fact:
    return unknown_fact(
        "monthly_income_pkr",
        entered_by=EnteredBy.CITIZEN,
        missing_reason=MissingReason.USER_UNKNOWN,
    )


@pytest.fixture()
def no_flags() -> tuple[RiskFlag, ...]:
    return ()


@pytest.fixture()
def consent_otp() -> ConsentMethod:
    return ConsentMethod.SELF_OTP
