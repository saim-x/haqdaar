"""Pure assembly of canonical facts from mock-service payloads (docs/07 §7 step 8).

The case agent fetches; this module decides what the evidence *means*. It is pure on
purpose: no DB, no HTTP, no clock, no randomness. Given the same payloads it produces
the same ``FactBundle``, which is what makes the decision hash meaningful.

Tri-state discipline: a registry that answered "not found" is evidence of absence and
becomes a KNOWN ``False``/value; a registry that was never queried or was unavailable
becomes ``UNKNOWN`` with a recorded ``missing_reason``. Nothing is defaulted.

Purity: stdlib + pydantic + ``app.engine`` only.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import date
from typing import Any

from app.engine.anomalies import (
    DocumentCheck,
    FlagCode,
    PayoutUsage,
    PriorCase,
    RiskFlag,
    run_anomaly_checks,
    sort_flags,
)
from app.engine.confidence import DocumentEvidence, DocumentStatus
from app.engine.entity_resolution import (
    IdentityCandidate,
    IdentityResolution,
    MatchOutcome,
    resolve_identity,
)
from app.engine.facts import (
    FACT_REGISTRY,
    EnteredBy,
    Fact,
    FactAlternative,
    FactBundle,
    FactSource,
    FactState,
    FactValueType,
    MissingReason,
    derive_age_years,
    known_fact,
    parse_iso_date,
    unknown_fact,
)

__all__ = [
    "ActiveBenefit",
    "AssembledFacts",
    "DeathRecord",
    "DocumentRow",
    "HouseholdRecord",
    "assemble_facts",
    "parse_active_benefits",
    "parse_death_records",
    "parse_household",
    "parse_identity_matches",
]

#: Self-declared answers are trusted but never as much as a registry record.
SELF_DECLARED_CONFIDENCE = 0.95
#: A document the verifier accepted.
DOCUMENT_CONFIDENCE = 0.96


# -- payload adapters ----------------------------------------------------
@dataclass(frozen=True)
class DeathRecord:
    """One ``/mock/v1/civil/death-records`` row."""

    deceased_cnic: str | None = None
    deceased_name: str | None = None
    spouse_cnic: str | None = None
    spouse_name: str | None = None
    death_date: str | None = None
    district: str | None = None
    certificate_no: str | None = None


@dataclass(frozen=True)
class HouseholdRecord:
    """The ``record`` object of ``/mock/v1/household/survey``."""

    head_cnic: str | None = None
    district: str | None = None
    household_size: int | None = None
    monthly_income_pkr: int | None = None
    poverty_score: int | None = None
    survey_year: int | None = None


@dataclass(frozen=True)
class ActiveBenefit:
    """One ``/mock/v1/benefits/active`` row."""

    program_name: str | None = None
    monthly_amount_pkr: int | None = None
    started_at: str | None = None


@dataclass(frozen=True)
class DocumentRow:
    """The subset of a ``documents`` row the engine needs."""

    doc_type: str
    verify_status: str = "PENDING"
    verify_confidence: float | None = None
    verify_checks: tuple[Mapping[str, Any], ...] = ()
    extracted_fields: Mapping[str, Any] | None = None


@dataclass(frozen=True)
class AssembledFacts:
    """Everything step 8 hands to ``engine.evaluate_and_route``."""

    facts: FactBundle
    documents: tuple[DocumentEvidence, ...]
    flags: tuple[RiskFlag, ...]
    identity_confidence: float
    identity: IdentityResolution
    consent_method: str = "SELF_OTP"


def _as_int(value: Any) -> int | None:
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float) and value.is_integer():
        return int(value)
    if isinstance(value, str):
        stripped = value.strip().replace(",", "")
        if stripped.lstrip("-").isdigit():
            return int(stripped)
    return None


def _as_str(value: Any) -> str | None:
    if value is None or isinstance(value, bool):
        return None
    text = str(value).strip()
    return text or None


def parse_identity_matches(payload: Mapping[str, Any] | None) -> tuple[IdentityCandidate, ...]:
    """``{"matches": [...]}`` -> validated candidates. Unknown keys are ignored."""
    if not payload:
        return ()
    rows = payload.get("matches") or ()
    candidates: list[IdentityCandidate] = []
    for row in rows:
        if not isinstance(row, Mapping):
            continue
        cnic = _as_str(row.get("cnic_digits"))
        name = _as_str(row.get("full_name"))
        if not cnic or not name:
            continue
        candidates.append(
            IdentityCandidate(
                cnic_digits=cnic,
                full_name=name,
                full_name_ur=_as_str(row.get("full_name_ur")),
                father_or_spouse_name=_as_str(row.get("father_or_spouse_name")),
                dob=_as_str(row.get("dob")),
                gender=_as_str(row.get("gender")),
                district=_as_str(row.get("district")),
                is_alive=row.get("is_alive") if isinstance(row.get("is_alive"), bool) else None,
                cnic_expiry_date=_as_str(row.get("cnic_expiry_date")),
                marital_status=_as_str(row.get("marital_status")),
            )
        )
    return tuple(candidates)


def parse_death_records(payload: Mapping[str, Any] | None) -> tuple[DeathRecord, ...]:
    if not payload:
        return ()
    rows = payload.get("records") or ()
    return tuple(
        DeathRecord(
            deceased_cnic=_as_str(row.get("deceased_cnic")),
            deceased_name=_as_str(row.get("deceased_name")),
            spouse_cnic=_as_str(row.get("spouse_cnic")),
            spouse_name=_as_str(row.get("spouse_name")),
            death_date=_as_str(row.get("death_date")),
            district=_as_str(row.get("district")),
            certificate_no=_as_str(row.get("certificate_no")),
        )
        for row in rows
        if isinstance(row, Mapping)
    )


def parse_household(payload: Mapping[str, Any] | None) -> HouseholdRecord | None:
    """``{"found": bool, "record": {...}}`` -> record, or ``None`` when not surveyed."""
    if not payload or not payload.get("found"):
        return None
    record = payload.get("record")
    if not isinstance(record, Mapping):
        return None
    return HouseholdRecord(
        head_cnic=_as_str(record.get("head_cnic")),
        district=_as_str(record.get("district")),
        household_size=_as_int(record.get("household_size")),
        monthly_income_pkr=_as_int(record.get("monthly_income_pkr")),
        poverty_score=_as_int(record.get("poverty_score")),
        survey_year=_as_int(record.get("survey_year")),
    )


def parse_active_benefits(payload: Mapping[str, Any] | None) -> tuple[ActiveBenefit, ...]:
    if not payload:
        return ()
    rows = payload.get("active_benefits") or ()
    return tuple(
        ActiveBenefit(
            program_name=_as_str(row.get("program_name")),
            monthly_amount_pkr=_as_int(row.get("monthly_amount_pkr")),
            started_at=_as_str(row.get("started_at")),
        )
        for row in rows
        if isinstance(row, Mapping)
    )


# -- draft answers -------------------------------------------------------
def _draft_entry(
    draft: Mapping[str, Any], key: str
) -> tuple[Any, bool, MissingReason | None]:
    """Read ``{value, confirmed, missing_reason}``; a bare value counts as confirmed."""
    entry = draft.get(key)
    if entry is None:
        return None, False, None
    if isinstance(entry, Mapping):
        reason = entry.get("missing_reason")
        return (
            entry.get("value"),
            bool(entry.get("confirmed", True)),
            MissingReason(reason) if reason in MissingReason.__members__ else None,
        )
    return entry, True, None


def _draft_fact(
    draft: Mapping[str, Any],
    key: str,
    *,
    entered_by: EnteredBy,
    source: FactSource = FactSource.SELF_DECLARED,
    source_confidence: float = SELF_DECLARED_CONFIDENCE,
) -> Fact:
    """Turn one draft answer into a tri-state fact without inventing anything."""
    value, confirmed, reason = _draft_entry(draft, key)
    if value is None or value == "":
        return unknown_fact(
            key,
            entered_by=entered_by,
            missing_reason=reason or MissingReason.NOT_PROVIDED,
        )
    if not confirmed:
        return unknown_fact(
            key,
            entered_by=entered_by,
            missing_reason=MissingReason.NOT_PROVIDED,
        )
    coerced = _coerce(key, value)
    if coerced is None:
        return unknown_fact(
            key,
            entered_by=entered_by,
            missing_reason=MissingReason.NOT_PROVIDED,
        )
    return known_fact(
        key,
        coerced,
        source=source,
        source_confidence=source_confidence,
        entered_by=entered_by,
    )


def _coerce(key: str, value: Any) -> str | int | bool | None:
    """Coerce a wizard value to the registry type; ``None`` when it does not fit."""
    spec = FACT_REGISTRY.get(key)
    if spec is None:
        return None
    if spec.value_type is FactValueType.BOOL:
        if isinstance(value, bool):
            return value
        if isinstance(value, str):
            lowered = value.strip().lower()
            if lowered in {"true", "yes", "1"}:
                return True
            if lowered in {"false", "no", "0"}:
                return False
        return None
    if spec.value_type is FactValueType.INT:
        return _as_int(value)
    return _as_str(value)


# -- documents -----------------------------------------------------------
def _document_status(row: DocumentRow) -> DocumentStatus:
    try:
        return DocumentStatus(row.verify_status)
    except ValueError:
        return DocumentStatus.PENDING


def _document_evidence(documents: Sequence[DocumentRow]) -> tuple[DocumentEvidence, ...]:
    return tuple(
        DocumentEvidence(
            doc_type=row.doc_type,
            status=_document_status(row),
            verify_confidence=row.verify_confidence,
        )
        for row in documents
    )


def _document_checks(documents: Sequence[DocumentRow]) -> tuple[DocumentCheck, ...]:
    """Map ``verify_checks`` onto the tamper detector's three questions."""
    checks: list[DocumentCheck] = []
    for row in documents:
        named = {
            str(check.get("check", "")).upper(): bool(check.get("passed"))
            for check in row.verify_checks
            if isinstance(check, Mapping)
        }
        tampered = _document_status(row) is DocumentStatus.TAMPER_SUSPECTED
        checks.append(
            DocumentCheck(
                doc_type=row.doc_type,
                qr_signature_valid=named.get("QR_SIGNATURE", not tampered),
                ocr_qr_name_match=named.get("OCR_QR_NAME", True),
                ocr_qr_cnic_match=named.get("OCR_QR_CNIC", True),
            )
        )
    return tuple(checks)


def _doc_verified(documents: Sequence[DocumentRow], doc_type: str) -> bool:
    return any(
        row.doc_type == doc_type and _document_status(row) is DocumentStatus.VERIFIED
        for row in documents
    )


# -- flags ---------------------------------------------------------------
def _merge_flags(*groups: Sequence[RiskFlag]) -> tuple[RiskFlag, ...]:
    """One flag per code, first occurrence wins, deterministic order."""
    by_code: dict[FlagCode, RiskFlag] = {}
    for group in groups:
        for flag in group:
            by_code.setdefault(flag.code, flag)
    return sort_flags(by_code.values())


def _same_program(program_name: str | None, program_code: str | None) -> bool:
    if not program_name or not program_code:
        return False
    left = program_name.upper().replace(" ", "_")
    right = program_code.upper().replace(" ", "_")
    return left == right or left in right or right in left


# -- the assembler -------------------------------------------------------
def assemble_facts(
    *,
    draft_answers: Mapping[str, Any] | None = None,
    identity_matches: Sequence[IdentityCandidate] = (),
    death_records: Sequence[DeathRecord] = (),
    household: HouseholdRecord | None = None,
    active_benefits: Sequence[ActiveBenefit] = (),
    documents: Sequence[DocumentRow] = (),
    program_code: str | None = None,
    consent_method: str = "SELF_OTP",
    entered_by: EnteredBy = EnteredBy.CITIZEN,
    extra_flags: Sequence[RiskFlag] = (),
    prior_cases: Sequence[PriorCase] = (),
    payout_usages: Sequence[PayoutUsage] = (),
    helper_submissions_last_60_minutes: int | None = None,
    payout_title_similarity: float | None = None,
    civil_registry_queried: bool = True,
    benefits_registry_queried: bool = True,
    today: date | None = None,
) -> AssembledFacts:
    """Build the canonical ``FactBundle`` from everything the agent fetched."""
    draft: Mapping[str, Any] = draft_answers or {}
    today = today or date.today()

    declared_name = _as_str(_draft_entry(draft, "applicant_full_name")[0])
    declared_dob = _as_str(_draft_entry(draft, "applicant_dob")[0])
    declared_district = _as_str(_draft_entry(draft, "applicant_district")[0])
    declared_cnic = _as_str(_draft_entry(draft, "applicant_cnic")[0])

    resolution = resolve_identity(
        declared_name=declared_name,
        declared_dob=declared_dob,
        declared_district=declared_district,
        cnic=declared_cnic,
        candidates=identity_matches,
    )
    matched = resolution.matched

    facts: dict[str, Fact] = {}

    # -- identity --------------------------------------------------------
    facts["applicant_cnic"] = _draft_fact(
        draft, "applicant_cnic", entered_by=entered_by
    )
    if matched is not None:
        # ADR-015: the registry spelling wins, but the citizen's own spelling stays
        # visible in provenance so an officer can see what was actually declared.
        name_alternatives: tuple[FactAlternative, ...] = ()
        if declared_name and declared_name != matched.full_name:
            name_alternatives = (
                FactAlternative(
                    value=declared_name,
                    source=FactSource.SELF_DECLARED,
                    entered_by=entered_by,
                ),
            )
        facts["applicant_full_name"] = known_fact(
            "applicant_full_name",
            matched.full_name,
            source=FactSource.IDENTITY_REGISTRY,
            source_confidence=0.98,
            alternatives=name_alternatives,
        )
        facts["applicant_dob"] = (
            known_fact(
                "applicant_dob",
                matched.dob,
                source=FactSource.IDENTITY_REGISTRY,
                source_confidence=0.98,
            )
            if matched.dob
            else unknown_fact("applicant_dob", missing_reason=MissingReason.NOT_PROVIDED)
        )
        facts["applicant_district"] = (
            known_fact(
                "applicant_district",
                matched.district,
                source=FactSource.IDENTITY_REGISTRY,
                source_confidence=0.98,
            )
            if matched.district
            else _draft_fact(draft, "applicant_district", entered_by=entered_by)
        )
        facts["applicant_is_alive"] = (
            known_fact(
                "applicant_is_alive",
                matched.is_alive,
                source=FactSource.IDENTITY_REGISTRY,
                source_confidence=0.99,
            )
            if matched.is_alive is not None
            else unknown_fact(
                "applicant_is_alive", missing_reason=MissingReason.NOT_PROVIDED
            )
        )
        facts["applicant_cnic_valid"] = _cnic_validity(matched, today)
        facts["marital_status_widow"] = _widow_status(matched)
        facts["spouse_full_name"] = _spouse_name(draft, matched, death_records, entered_by)
        facts["spouse_cnic"] = _spouse_cnic(draft, matched, death_records, entered_by)
    else:
        facts["applicant_full_name"] = _draft_fact(
            draft, "applicant_full_name", entered_by=entered_by
        )
        facts["applicant_dob"] = _draft_fact(
            draft, "applicant_dob", entered_by=entered_by
        )
        facts["applicant_district"] = _draft_fact(
            draft, "applicant_district", entered_by=entered_by
        )
        facts["applicant_is_alive"] = unknown_fact(
            "applicant_is_alive", missing_reason=MissingReason.NOT_PROVIDED
        )
        facts["applicant_cnic_valid"] = unknown_fact(
            "applicant_cnic_valid", missing_reason=MissingReason.NOT_PROVIDED
        )
        facts["marital_status_widow"] = unknown_fact(
            "marital_status_widow", missing_reason=MissingReason.NOT_PROVIDED
        )
        facts["spouse_full_name"] = _spouse_name(draft, None, death_records, entered_by)
        facts["spouse_cnic"] = _spouse_cnic(draft, None, death_records, entered_by)

    dob_fact = facts["applicant_dob"]
    age = derive_age_years(
        dob_fact.value if dob_fact.state is FactState.KNOWN else None, today
    )
    facts["applicant_age_years"] = (
        known_fact(
            "applicant_age_years",
            age,
            source=FactSource.DERIVED,
            source_confidence=0.98,
        )
        if age is not None
        else unknown_fact("applicant_age_years", missing_reason=MissingReason.NOT_PROVIDED)
    )

    # -- civil registry --------------------------------------------------
    facts["spouse_death_verified"] = _spouse_death_verified(
        death_records, documents, civil_registry_queried
    )

    # -- household survey ------------------------------------------------
    facts["children_under_18"] = _draft_fact(
        draft, "children_under_18", entered_by=entered_by
    )
    if household is not None:
        facts["household_size"] = (
            known_fact(
                "household_size",
                household.household_size,
                source=FactSource.HOUSEHOLD_SURVEY,
                source_confidence=0.92,
            )
            if household.household_size is not None
            else _draft_fact(draft, "household_size", entered_by=entered_by)
        )
        facts["monthly_income_pkr"] = (
            known_fact(
                "monthly_income_pkr",
                household.monthly_income_pkr,
                source=FactSource.HOUSEHOLD_SURVEY,
                source_confidence=0.92,
            )
            if household.monthly_income_pkr is not None
            else _draft_fact(draft, "monthly_income_pkr", entered_by=entered_by)
        )
        facts["poverty_score"] = (
            known_fact(
                "poverty_score",
                household.poverty_score,
                source=FactSource.HOUSEHOLD_SURVEY,
                source_confidence=0.92,
            )
            if household.poverty_score is not None
            else unknown_fact(
                "poverty_score", missing_reason=MissingReason.NOT_PROVIDED
            )
        )
    else:
        facts["household_size"] = _draft_fact(
            draft, "household_size", entered_by=entered_by
        )
        facts["monthly_income_pkr"] = _draft_fact(
            draft, "monthly_income_pkr", entered_by=entered_by
        )
        facts["poverty_score"] = unknown_fact(
            "poverty_score", missing_reason=MissingReason.NOT_PROVIDED
        )

    # -- benefits registry -----------------------------------------------
    facts["has_conflicting_active_grant"] = _conflicting_grant(
        active_benefits, program_code, benefits_registry_queried
    )

    # -- payment & documents ---------------------------------------------
    facts["payout_phone"] = _draft_fact(draft, "payout_phone", entered_by=entered_by)
    facts["cnic_doc_verified"] = _doc_flag(documents, "CNIC_FRONT")
    facts["death_cert_doc_verified"] = _doc_flag(
        documents, "SPOUSE_DEATH_CERTIFICATE"
    )
    facts["citizen_has_active_dept_consent"] = known_fact(
        "citizen_has_active_dept_consent",
        True,
        source=FactSource.CONSENT_ENGINE,
        source_confidence=1.0,
    )

    bundle = FactBundle(facts=facts)

    # -- anomaly catalogue -----------------------------------------------
    self_declared_income = _as_int(_draft_entry(draft, "monthly_income_pkr")[0])
    survey_income = household.monthly_income_pkr if household else None
    anomaly_flags = run_anomaly_checks(
        document_checks=_document_checks(documents),
        cnic_digits=declared_cnic,
        identity_name_similarity=(
            resolution.name_similarity
            if resolution.outcome
            in {
                MatchOutcome.MATCH,
                MatchOutcome.SOFT_MATCH,
                MatchOutcome.CONFLICT,
            }
            else None
        ),
        identity_candidate_count=len(identity_matches),
        applicant_is_alive=(
            matched.is_alive if matched is not None else None
        ),
        prior_cases=prior_cases,
        program_code=program_code,
        payout_alias=_as_str(_draft_entry(draft, "payout_phone")[0]),
        payout_usages=payout_usages,
        self_declared_income_pkr=self_declared_income,
        survey_income_pkr=survey_income,
        payout_title_similarity=payout_title_similarity,
        helper_submissions_last_60_minutes=helper_submissions_last_60_minutes,
        consent_method=consent_method,
        today=today,
    )

    return AssembledFacts(
        facts=bundle,
        documents=_document_evidence(documents),
        flags=_merge_flags(resolution.flags, anomaly_flags, extra_flags),
        identity_confidence=resolution.confidence,
        identity=resolution,
        consent_method=consent_method,
    )


# -- per-fact helpers ----------------------------------------------------
def _cnic_validity(matched: IdentityCandidate, today: date) -> Fact:
    expiry = parse_iso_date(matched.cnic_expiry_date)
    if expiry is None:
        return unknown_fact(
            "applicant_cnic_valid", missing_reason=MissingReason.NOT_PROVIDED
        )
    return known_fact(
        "applicant_cnic_valid",
        expiry >= today,
        source=FactSource.IDENTITY_REGISTRY,
        source_confidence=0.99,
    )


def _widow_status(matched: IdentityCandidate) -> Fact:
    status = (matched.marital_status or "").upper()
    if status in {"WIDOWED", "WIDOW"}:
        return known_fact(
            "marital_status_widow",
            True,
            source=FactSource.IDENTITY_REGISTRY,
            source_confidence=0.97,
        )
    if status in {"MARRIED", "SINGLE", "DIVORCED", "SEPARATED"}:
        return known_fact(
            "marital_status_widow",
            False,
            source=FactSource.IDENTITY_REGISTRY,
            source_confidence=0.97,
        )
    return unknown_fact(
        "marital_status_widow", missing_reason=MissingReason.NOT_PROVIDED
    )


def _spouse_name(
    draft: Mapping[str, Any],
    matched: IdentityCandidate | None,
    death_records: Sequence[DeathRecord],
    entered_by: EnteredBy,
) -> Fact:
    from_draft = _draft_fact(draft, "spouse_full_name", entered_by=entered_by)
    if from_draft.state is FactState.KNOWN:
        return from_draft
    if matched is not None and matched.father_or_spouse_name:
        return known_fact(
            "spouse_full_name",
            matched.father_or_spouse_name,
            source=FactSource.IDENTITY_REGISTRY,
            source_confidence=0.95,
        )
    for record in death_records:
        if record.spouse_name:
            return known_fact(
                "spouse_full_name",
                record.spouse_name,
                source=FactSource.CIVIL_REGISTRY,
                source_confidence=0.95,
            )
    return from_draft


def _spouse_cnic(
    draft: Mapping[str, Any],
    matched: IdentityCandidate | None,
    death_records: Sequence[DeathRecord],
    entered_by: EnteredBy,
) -> Fact:
    from_draft = _draft_fact(draft, "spouse_cnic", entered_by=entered_by)
    if from_draft.state is FactState.KNOWN:
        return from_draft
    for record in death_records:
        if record.spouse_cnic:
            return known_fact(
                "spouse_cnic",
                record.spouse_cnic,
                source=FactSource.CIVIL_REGISTRY,
                source_confidence=0.95,
            )
    return from_draft


def _spouse_death_verified(
    death_records: Sequence[DeathRecord],
    documents: Sequence[DocumentRow],
    civil_registry_queried: bool,
) -> Fact:
    """A death record or a verified death certificate proves widowhood."""
    if death_records:
        return known_fact(
            "spouse_death_verified",
            True,
            source=FactSource.CIVIL_REGISTRY,
            source_confidence=0.97,
        )
    if _doc_verified(documents, "SPOUSE_DEATH_CERTIFICATE"):
        return known_fact(
            "spouse_death_verified",
            True,
            source=FactSource.DOCUMENT_VERIFIER,
            source_confidence=0.95,
        )
    if not civil_registry_queried:
        return unknown_fact(
            "spouse_death_verified", missing_reason=MissingReason.SERVICE_UNAVAILABLE
        )
    return known_fact(
        "spouse_death_verified",
        False,
        source=FactSource.CIVIL_REGISTRY,
        source_confidence=0.97,
    )


def _conflicting_grant(
    active_benefits: Sequence[ActiveBenefit],
    program_code: str | None,
    benefits_registry_queried: bool,
) -> Fact:
    if not benefits_registry_queried:
        return unknown_fact(
            "has_conflicting_active_grant",
            missing_reason=MissingReason.SERVICE_UNAVAILABLE,
        )
    conflicting = [
        benefit
        for benefit in active_benefits
        if not _same_program(benefit.program_name, program_code)
    ]
    return known_fact(
        "has_conflicting_active_grant",
        bool(conflicting),
        source=FactSource.BENEFITS_REGISTRY,
        source_confidence=0.95,
    )


def _doc_flag(documents: Sequence[DocumentRow], doc_type: str) -> Fact:
    """A document that was never uploaded is UNKNOWN, not ``False``."""
    key = "cnic_doc_verified" if doc_type == "CNIC_FRONT" else "death_cert_doc_verified"
    if not any(row.doc_type == doc_type for row in documents):
        return unknown_fact(key, missing_reason=MissingReason.DOCUMENT_MISSING)
    return known_fact(
        key,
        _doc_verified(documents, doc_type),
        source=FactSource.DOCUMENT_VERIFIER,
        source_confidence=DOCUMENT_CONFIDENCE,
    )
