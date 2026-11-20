"""Anomaly and fraud flag catalogue.

Source of truth: ``docs/06-decision-engine.md`` §6 (the complete flag table) and
``docs/13-testing-and-quality.md`` §2 assertion 4 (helper contact phone vs payout
alias).

Every detector is a pure function over already-fetched evidence. Nothing here
queries a database or an HTTP service: the case agent gathers evidence, this module
judges it. Severity is fixed per code in :data:`FLAG_CATALOGUE` so a caller can
never quietly downgrade a HIGH flag.

Purity: stdlib + pydantic only.
"""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from datetime import date
from enum import Enum
from typing import Any

from pydantic import BaseModel, ConfigDict, model_validator

__all__ = [
    "FLAG_CATALOGUE",
    "DocumentCheck",
    "FlagCode",
    "FlagSeverity",
    "PayoutUsage",
    "PriorCase",
    "RiskFlag",
    "detect_applicant_deceased",
    "detect_cnic_gender_mismatch",
    "detect_cnic_not_in_registry",
    "detect_data_conflict_income",
    "detect_duplicate_application",
    "detect_helper_velocity",
    "detect_identity_conflict",
    "detect_identity_name_variant",
    "detect_low_assurance_consent",
    "detect_payout_account_shared",
    "detect_payout_name_mismatch",
    "detect_possible_duplicate_identity",
    "detect_tamper_suspected",
    "run_anomaly_checks",
    "sort_flags",
]


class FlagSeverity(str, Enum):
    HIGH = "HIGH"
    MEDIUM = "MEDIUM"
    LOW = "LOW"


class FlagCode(str, Enum):
    """docs/06 §6 catalogue plus the §5.2 ``CNIC_NOT_IN_REGISTRY`` match outcome."""

    TAMPER_SUSPECTED = "TAMPER_SUSPECTED"
    DUPLICATE_APPLICATION = "DUPLICATE_APPLICATION"
    IDENTITY_CONFLICT = "IDENTITY_CONFLICT"
    POSSIBLE_DUPLICATE_IDENTITY = "POSSIBLE_DUPLICATE_IDENTITY"
    APPLICANT_DECEASED = "APPLICANT_DECEASED"
    PAYOUT_ACCOUNT_SHARED = "PAYOUT_ACCOUNT_SHARED"
    DATA_CONFLICT_INCOME = "DATA_CONFLICT_INCOME"
    PAYOUT_NAME_MISMATCH = "PAYOUT_NAME_MISMATCH"
    IDENTITY_NAME_VARIANT_CHECK = "IDENTITY_NAME_VARIANT_CHECK"
    HELPER_HIGH_VELOCITY = "HELPER_HIGH_VELOCITY"
    LOW_ASSURANCE_CONSENT = "LOW_ASSURANCE_CONSENT"
    CNIC_GENDER_MISMATCH = "CNIC_GENDER_MISMATCH"
    # docs/06 §5.2 Case A "Not found -> NO MATCH (0.25, flags CNIC_NOT_IN_REGISTRY
    # HIGH)". The §6 table omits it; §5.2 names both the code and its severity.
    CNIC_NOT_IN_REGISTRY = "CNIC_NOT_IN_REGISTRY"


#: Severity is a property of the code, not of the caller.
FLAG_CATALOGUE: dict[FlagCode, FlagSeverity] = {
    FlagCode.TAMPER_SUSPECTED: FlagSeverity.HIGH,
    FlagCode.DUPLICATE_APPLICATION: FlagSeverity.HIGH,
    FlagCode.IDENTITY_CONFLICT: FlagSeverity.HIGH,
    FlagCode.POSSIBLE_DUPLICATE_IDENTITY: FlagSeverity.HIGH,
    FlagCode.APPLICANT_DECEASED: FlagSeverity.HIGH,
    FlagCode.PAYOUT_ACCOUNT_SHARED: FlagSeverity.HIGH,
    FlagCode.DATA_CONFLICT_INCOME: FlagSeverity.MEDIUM,
    FlagCode.PAYOUT_NAME_MISMATCH: FlagSeverity.MEDIUM,
    FlagCode.IDENTITY_NAME_VARIANT_CHECK: FlagSeverity.MEDIUM,
    FlagCode.HELPER_HIGH_VELOCITY: FlagSeverity.MEDIUM,
    FlagCode.LOW_ASSURANCE_CONSENT: FlagSeverity.MEDIUM,
    FlagCode.CNIC_GENDER_MISMATCH: FlagSeverity.LOW,
    FlagCode.CNIC_NOT_IN_REGISTRY: FlagSeverity.HIGH,
}

_SEVERITY_ORDER = {FlagSeverity.HIGH: 0, FlagSeverity.MEDIUM: 1, FlagSeverity.LOW: 2}


class RiskFlag(BaseModel):
    """One active risk flag, stored in ``cases.flags_json``.

    Serialised shape (agreed with DPI, ADR-018): ``code``, ``severity``, ``detail_en``,
    ``detail_ur``, ``evidence``. ``to_json()`` and the model's field names are the same
    by construction, so a stored flag round-trips through ``model_validate``.
    """

    model_config = ConfigDict(frozen=True, extra="forbid")

    code: FlagCode
    severity: FlagSeverity
    detail_en: str
    detail_ur: str
    evidence: dict[str, Any] = {}

    @model_validator(mode="before")
    @classmethod
    def _accept_legacy_detail(cls, data: Any) -> Any:
        """Read older flag shapes without failing an entire Digital Twin replay.

        We always *write* ``detail_en``/``detail_ur``. Rows seeded before that
        agreement carry either a single ``detail`` string or no detail at all; a
        missing explanation is a data-quality gap, not a reason to 500 the replay.
        The last resort is the flag code itself, which still identifies the flag.
        """
        if not isinstance(data, dict):
            return data
        normalised = dict(data)
        legacy = normalised.pop("detail", None)
        if legacy is not None:
            normalised.setdefault("detail_en", legacy)
            normalised.setdefault("detail_ur", legacy)
        if "detail_en" not in normalised:
            code = normalised.get("code")
            fallback = code.value if isinstance(code, FlagCode) else str(code or "")
            normalised["detail_en"] = fallback
            normalised.setdefault("detail_ur", fallback)
        if "detail_ur" not in normalised:
            normalised["detail_ur"] = normalised["detail_en"]
        return normalised

    @model_validator(mode="after")
    def _severity_matches_catalogue(self) -> RiskFlag:
        expected = FLAG_CATALOGUE[self.code]
        if self.severity is not expected:
            raise ValueError(
                f"flag {self.code.value} is {expected.value} by catalogue, "
                f"not {self.severity.value}"
            )
        return self

    def to_json(self) -> dict[str, Any]:
        return {
            "code": self.code.value,
            "severity": self.severity.value,
            "detail_en": self.detail_en,
            "detail_ur": self.detail_ur,
            "evidence": self.evidence,
        }


def _flag(
    code: FlagCode,
    detail_en: str,
    detail_ur: str,
    evidence: dict[str, Any] | None = None,
) -> RiskFlag:
    return RiskFlag(
        code=code,
        severity=FLAG_CATALOGUE[code],
        detail_en=detail_en,
        detail_ur=detail_ur,
        evidence=evidence or {},
    )


def sort_flags(flags: Iterable[RiskFlag]) -> tuple[RiskFlag, ...]:
    """Deterministic order: severity first, then code. Byte-identical output."""
    return tuple(
        sorted(flags, key=lambda f: (_SEVERITY_ORDER[f.severity], f.code.value))
    )


# -- evidence inputs -----------------------------------------------------
class DocumentCheck(BaseModel):
    """Per-document verification outcome needed for the tamper check."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    doc_type: str
    qr_signature_valid: bool
    ocr_qr_name_match: bool
    ocr_qr_cnic_match: bool


class PriorCase(BaseModel):
    """A previously submitted case, for the duplicate-application check."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    case_id: str
    cnic_digits: str
    program_code: str
    status: str
    created_at: date


class PayoutUsage(BaseModel):
    """One use of a phone alias, tagged by what the alias is used *for*.

    ``CONTACT`` is the helper's shared contact number: forty families may share it
    and that is normal. ``PAYOUT`` is a Raast payout alias: sharing it across
    unrelated citizens is the fraud signal (docs/06 §6, docs/13 §2.4).
    """

    model_config = ConfigDict(frozen=True, extra="forbid")

    citizen_id: str
    alias: str
    alias_kind: str  # "PAYOUT" | "CONTACT"

    @model_validator(mode="after")
    def _kind_valid(self) -> PayoutUsage:
        if self.alias_kind not in {"PAYOUT", "CONTACT"}:
            raise ValueError("alias_kind must be PAYOUT or CONTACT")
        return self


# -- detectors -----------------------------------------------------------
def detect_tamper_suspected(
    checks: Sequence[DocumentCheck],
) -> RiskFlag | None:
    """QR signature invalid OR OCR-vs-QR name/CNIC mismatch."""
    for check in checks:
        if not check.qr_signature_valid:
            return _flag(
                FlagCode.TAMPER_SUSPECTED,
                f"Signed QR on {check.doc_type} did not verify.",
                f"{check.doc_type} پر دستخط شدہ کیو آر تصدیق نہیں ہو سکی۔",
                {"doc_type": check.doc_type, "failed": "QR_SIGNATURE"},
            )
        if not check.ocr_qr_name_match:
            return _flag(
                FlagCode.TAMPER_SUSPECTED,
                f"Printed name on {check.doc_type} does not match the signed QR payload.",
                f"{check.doc_type} پر لکھا نام دستخط شدہ کیو آر سے مطابقت نہیں رکھتا۔",
                {"doc_type": check.doc_type, "failed": "OCR_QR_NAME"},
            )
        if not check.ocr_qr_cnic_match:
            return _flag(
                FlagCode.TAMPER_SUSPECTED,
                f"Printed CNIC on {check.doc_type} does not match the signed QR payload.",
                f"{check.doc_type} پر لکھا شناختی نمبر دستخط شدہ کیو آر سے مطابقت نہیں رکھتا۔",
                {"doc_type": check.doc_type, "failed": "OCR_QR_CNIC"},
            )
    return None


def detect_duplicate_application(
    cnic_digits: str,
    prior_cases: Sequence[PriorCase],
    program_code: str,
    today: date,
    *,
    window_days: int = 90,
) -> RiskFlag | None:
    """Another live case on the same CNIC in the same program within 90 days."""
    for prior in prior_cases:
        if prior.cnic_digits != cnic_digits:
            continue
        if prior.program_code != program_code:
            continue
        if prior.status in {"WITHDRAWN", "REJECTED"}:
            continue
        age_days = (today - prior.created_at).days
        if 0 <= age_days <= window_days:
            return _flag(
                FlagCode.DUPLICATE_APPLICATION,
                f"Case {prior.case_id} on the same CNIC is still open "
                f"({age_days} days old).",
                f"اسی شناختی نمبر پر کیس {prior.case_id} ابھی زیرِ کار ہے "
                f"({age_days} دن پرانا)۔",
                {"prior_case_id": prior.case_id, "age_days": age_days},
            )
    return None


def detect_identity_conflict(name_similarity: float) -> RiskFlag | None:
    """CNIC exists in the registry but the name is a different person (< 0.55)."""
    if name_similarity < 0.55:
        return _flag(
            FlagCode.IDENTITY_CONFLICT,
            f"Registry name similarity {name_similarity:.2f} is below the 0.55 floor.",
            f"رجسٹری میں نام کی مماثلت {name_similarity:.2f} ہے جو 0.55 سے کم ہے۔",
            {"name_similarity": round(name_similarity, 4)},
        )
    return None


def detect_possible_duplicate_identity(candidate_count: int) -> RiskFlag | None:
    """Two or more registry records match without CNIC disambiguation."""
    if candidate_count >= 2:
        return _flag(
            FlagCode.POSSIBLE_DUPLICATE_IDENTITY,
            f"{candidate_count} registry records match the declared name and district.",
            f"نام اور ضلع سے {candidate_count} ریکارڈ مطابقت رکھتے ہیں۔",
            {"candidate_count": candidate_count},
        )
    return None


def detect_applicant_deceased(is_alive: bool | None) -> RiskFlag | None:
    """Identity registry reports ``is_alive == false``. ``None`` is not a flag."""
    if is_alive is False:
        return _flag(
            FlagCode.APPLICANT_DECEASED,
            "Identity registry reports the applicant as deceased.",
            "شناختی رجسٹری کے مطابق درخواست گزار حیات نہیں ہیں۔",
            {"is_alive": False},
        )
    return None


def detect_payout_account_shared(
    payout_alias: str,
    usages: Sequence[PayoutUsage],
) -> RiskFlag | None:
    """Same *payout* alias on >= 2 other distinct citizens' cases.

    Shared helper *contact* phones are excluded by construction: only
    ``alias_kind == "PAYOUT"`` rows are counted.
    """
    citizens = {
        usage.citizen_id
        for usage in usages
        if usage.alias_kind == "PAYOUT" and usage.alias == payout_alias
    }
    if len(citizens) >= 2:
        return _flag(
            FlagCode.PAYOUT_ACCOUNT_SHARED,
            f"Payout alias is also used by {len(citizens)} other citizens.",
            f"یہ ادائیگی نمبر {len(citizens)} دیگر شہریوں کے لیے بھی استعمال ہو رہا ہے۔",
            {"other_citizen_count": len(citizens)},
        )
    return None


def detect_data_conflict_income(
    self_declared_pkr: int | None,
    survey_pkr: int | None,
    *,
    relative_threshold: float = 0.30,
    absolute_threshold_pkr: int = 5000,
) -> RiskFlag | None:
    """Self-declared vs survey income differ by > 30 % *and* > PKR 5,000."""
    if self_declared_pkr is None or survey_pkr is None:
        return None
    difference = abs(self_declared_pkr - survey_pkr)
    denominator = max(abs(self_declared_pkr), abs(survey_pkr), 1)
    relative = difference / denominator
    if relative > relative_threshold and difference > absolute_threshold_pkr:
        return _flag(
            FlagCode.DATA_CONFLICT_INCOME,
            f"Self-declared PKR {self_declared_pkr:,} vs survey PKR {survey_pkr:,} "
            f"({relative:.0%} apart).",
            f"خود بتائی گئی آمدنی {self_declared_pkr:,} روپے اور سروے کی آمدنی "
            f"{survey_pkr:,} روپے میں {relative:.0%} فرق ہے۔",
            {
                "self_declared_pkr": self_declared_pkr,
                "survey_pkr": survey_pkr,
                "relative_difference": round(relative, 4),
            },
        )
    return None


def detect_payout_name_mismatch(
    account_title_similarity: float,
) -> RiskFlag | None:
    """Raast account title similarity to the applicant name < 0.65."""
    if account_title_similarity < 0.65:
        return _flag(
            FlagCode.PAYOUT_NAME_MISMATCH,
            f"Payout account title similarity {account_title_similarity:.2f} is below 0.65.",
            f"ادائیگی اکاؤنٹ کے نام کی مماثلت {account_title_similarity:.2f} ہے جو 0.65 سے کم ہے۔",
            {"account_title_similarity": round(account_title_similarity, 4)},
        )
    return None


def detect_identity_name_variant(name_similarity: float) -> RiskFlag | None:
    """CNIC matches but the name similarity sits in the 0.55-0.69 band."""
    if 0.55 <= name_similarity < 0.70:
        return _flag(
            FlagCode.IDENTITY_NAME_VARIANT_CHECK,
            f"Name similarity {name_similarity:.2f} is a spelling variant, not a match.",
            f"نام کی مماثلت {name_similarity:.2f} ہے؛ ہجے مختلف ہیں، تصدیق ضروری ہے۔",
            {"name_similarity": round(name_similarity, 4)},
        )
    return None


def detect_helper_velocity(submissions_last_60_minutes: int) -> RiskFlag | None:
    """Helper submitted more than 10 applications in the last 60 minutes."""
    if submissions_last_60_minutes > 10:
        return _flag(
            FlagCode.HELPER_HIGH_VELOCITY,
            f"Helper submitted {submissions_last_60_minutes} applications in 60 minutes.",
            f"معاون نے 60 منٹ میں {submissions_last_60_minutes} درخواستیں جمع کروائیں۔",
            {"submissions_last_60_minutes": submissions_last_60_minutes},
        )
    return None


def detect_low_assurance_consent(consent_method: str) -> RiskFlag | None:
    """Helper verbal consent instead of the citizen's own OTP."""
    if consent_method == "VERBAL_WITNESSED":
        return _flag(
            FlagCode.LOW_ASSURANCE_CONSENT,
            "Consent was witnessed verbally, not confirmed by the citizen's own OTP.",
            "رضامندی زبانی طور پر لی گئی، شہری کے اپنے او ٹی پی سے تصدیق نہیں ہوئی۔",
            {"consent_method": consent_method},
        )
    return None


def detect_cnic_gender_mismatch(cnic_digits: str | None) -> RiskFlag | None:
    """Last CNIC digit odd (male convention) on a widow program."""
    if not cnic_digits or len(cnic_digits) != 13 or not cnic_digits.isdigit():
        return None
    if int(cnic_digits[-1]) % 2 == 1:
        return _flag(
            FlagCode.CNIC_GENDER_MISMATCH,
            "CNIC check digit follows the male convention on a widow program.",
            "شناختی کارڈ کا آخری ہندسہ مردانہ روایت کے مطابق ہے جبکہ یہ بیوہ پروگرام ہے۔",
            {"last_digit": int(cnic_digits[-1])},
        )
    return None


def detect_cnic_not_in_registry(cnic_digits: str | None) -> RiskFlag | None:
    """CNIC supplied but absent from the identity registry (docs/06 §5.2 Case A)."""
    if not cnic_digits:
        return None
    return _flag(
        FlagCode.CNIC_NOT_IN_REGISTRY,
        "The supplied CNIC is not present in the identity registry.",
        "دیا گیا شناختی نمبر شناختی رجسٹری میں موجود نہیں ہے۔",
        {"cnic_last4": cnic_digits[-4:]},
    )


def run_anomaly_checks(
    *,
    document_checks: Sequence[DocumentCheck] = (),
    cnic_digits: str | None = None,
    prior_cases: Sequence[PriorCase] = (),
    program_code: str | None = None,
    today: date | None = None,
    identity_name_similarity: float | None = None,
    identity_candidate_count: int | None = None,
    applicant_is_alive: bool | None = None,
    payout_alias: str | None = None,
    payout_usages: Sequence[PayoutUsage] = (),
    self_declared_income_pkr: int | None = None,
    survey_income_pkr: int | None = None,
    payout_title_similarity: float | None = None,
    helper_submissions_last_60_minutes: int | None = None,
    consent_method: str | None = None,
) -> tuple[RiskFlag, ...]:
    """Run the whole catalogue once and return flags in deterministic order.

    Every input is optional and ``None`` means "not measured", which never raises a
    flag. Absence of evidence is not evidence of fraud.
    """
    flags: list[RiskFlag] = []

    tamper = detect_tamper_suspected(document_checks)
    if tamper:
        flags.append(tamper)

    if cnic_digits and program_code and today is not None:
        duplicate = detect_duplicate_application(
            cnic_digits, prior_cases, program_code, today
        )
        if duplicate:
            flags.append(duplicate)

    if identity_name_similarity is not None:
        conflict = detect_identity_conflict(identity_name_similarity)
        if conflict:
            flags.append(conflict)
        variant = detect_identity_name_variant(identity_name_similarity)
        if variant:
            flags.append(variant)

    if identity_candidate_count is not None:
        duplicate_identity = detect_possible_duplicate_identity(identity_candidate_count)
        if duplicate_identity:
            flags.append(duplicate_identity)

    deceased = detect_applicant_deceased(applicant_is_alive)
    if deceased:
        flags.append(deceased)

    if payout_alias:
        shared = detect_payout_account_shared(payout_alias, payout_usages)
        if shared:
            flags.append(shared)

    income_conflict = detect_data_conflict_income(
        self_declared_income_pkr, survey_income_pkr
    )
    if income_conflict:
        flags.append(income_conflict)

    if payout_title_similarity is not None:
        title_mismatch = detect_payout_name_mismatch(payout_title_similarity)
        if title_mismatch:
            flags.append(title_mismatch)

    if helper_submissions_last_60_minutes is not None:
        velocity = detect_helper_velocity(helper_submissions_last_60_minutes)
        if velocity:
            flags.append(velocity)

    if consent_method is not None:
        low_assurance = detect_low_assurance_consent(consent_method)
        if low_assurance:
            flags.append(low_assurance)

    gender = detect_cnic_gender_mismatch(cnic_digits)
    if gender:
        flags.append(gender)

    return sort_flags(flags)
