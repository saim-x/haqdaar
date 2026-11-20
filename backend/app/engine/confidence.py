"""Four-pillar weakest-link confidence model.

Source of truth: ``docs/06-decision-engine.md`` §3.1-§3.2.

Averaging hides a catastrophic single-point failure: identity 0.99, documents 0.98,
consent 1.00 and data consistency 0.40 averages to 0.84, which would auto-approve a
case whose income record contradicts itself. Weakest-link (``min``) exposes it.

Purity: stdlib + pydantic only.
"""

from __future__ import annotations

from collections.abc import Sequence
from enum import Enum

from app.engine.anomalies import FlagSeverity, RiskFlag
from pydantic import BaseModel, ConfigDict, Field

__all__ = [
    "ConfidenceComponents",
    "ConsentMethod",
    "DocumentEvidence",
    "DocumentStatus",
    "build_confidence",
    "consent_assurance_confidence",
    "data_consistency_confidence",
    "document_confidence",
    "identity_confidence_for_cnic_match",
    "identity_confidence_for_name_only",
    "overall_confidence",
    "weakest_pillar",
]

# -- identity bands (docs/06 §3.2) ---------------------------------------
IDENTITY_EXACT_MATCH = 0.98
IDENTITY_SPELLING_VARIANT = 0.93
IDENTITY_SOFT_MATCH = 0.75
IDENTITY_CONFLICT = 0.30
IDENTITY_PROVISIONAL_NAME_ONLY = 0.78
IDENTITY_AMBIGUOUS_OR_MISSING = 0.25

#: A DOB disagreement is not a new flag code (the catalogue is frozen), so it caps
#: identity at the soft-match band and lets the confidence threshold route to a human.
IDENTITY_DOB_MISMATCH_CAP = IDENTITY_SOFT_MATCH

#: docs/06 §3.2: verified documents "typically 0.92-0.98". Used only when a
#: VERIFIED document arrives without its own measured score.
DEFAULT_VERIFIED_DOCUMENT_CONFIDENCE = 0.92

#: No verified document evidence at all is treated as unverifiable, never as 1.0.
NO_DOCUMENT_EVIDENCE_CONFIDENCE = 0.55

PILLAR_ORDER = ("identity", "documents", "data_consistency", "consent_assurance")


class ConsentMethod(str, Enum):
    """How the citizen's consent was captured (docs/06 §3.2 pillar 4)."""

    SELF_OTP = "SELF_OTP"
    CITIZEN_OTP = "CITIZEN_OTP"
    VERBAL_WITNESSED = "VERBAL_WITNESSED"


class DocumentStatus(str, Enum):
    """Mirrors ``doc_verify_status`` (docs/04 §3.4)."""

    PENDING = "PENDING"
    VERIFIED = "VERIFIED"
    NEEDS_RETAKE = "NEEDS_RETAKE"
    UNVERIFIABLE = "UNVERIFIABLE"
    TAMPER_SUSPECTED = "TAMPER_SUSPECTED"


class DocumentEvidence(BaseModel):
    """One required document's verification outcome."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    doc_type: str
    status: DocumentStatus
    verify_confidence: float | None = Field(default=None, ge=0.0, le=1.0)


class ConfidenceComponents(BaseModel):
    """All four pillars plus the weakest-link overall score."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    identity: float = Field(ge=0.0, le=1.0)
    documents: float = Field(ge=0.0, le=1.0)
    data_consistency: float = Field(ge=0.0, le=1.0)
    consent_assurance: float = Field(ge=0.0, le=1.0)
    overall: float = Field(ge=0.0, le=1.0)

    def to_json(self) -> dict[str, float]:
        """Shape stored in ``decisions.confidence_components`` (docs/04 §4.3)."""
        return {
            "identity": self.identity,
            "documents": self.documents,
            "data_consistency": self.data_consistency,
            "consent_assurance": self.consent_assurance,
            "overall": self.overall,
        }

    def as_pillars(self) -> dict[str, float]:
        return {
            "identity": self.identity,
            "documents": self.documents,
            "data_consistency": self.data_consistency,
            "consent_assurance": self.consent_assurance,
        }


def identity_confidence_for_cnic_match(
    name_similarity: float,
    *,
    dob_match: bool = True,
) -> float:
    """Case A bands: exact CNIC found in the registry (docs/06 §3.2 pillar 1)."""
    if name_similarity >= 0.85:
        score = IDENTITY_EXACT_MATCH
    elif name_similarity >= 0.70:
        score = IDENTITY_SPELLING_VARIANT
    elif name_similarity >= 0.55:
        score = IDENTITY_SOFT_MATCH
    else:
        score = IDENTITY_CONFLICT

    if not dob_match:
        score = min(score, IDENTITY_DOB_MISMATCH_CAP)
    return round(score, 3)


def identity_confidence_for_name_only(
    candidate_count: int,
    name_similarity: float,
    *,
    dob_match: bool,
) -> float:
    """Case B bands: no CNIC, fuzzy match only. Never reaches the 0.90 threshold."""
    if candidate_count == 0:
        return IDENTITY_AMBIGUOUS_OR_MISSING
    if candidate_count >= 2:
        return IDENTITY_AMBIGUOUS_OR_MISSING
    if name_similarity >= 0.88 and dob_match:
        return IDENTITY_PROVISIONAL_NAME_ONLY
    return IDENTITY_AMBIGUOUS_OR_MISSING


def document_confidence(documents: Sequence[DocumentEvidence]) -> float:
    """Worst required-document outcome wins (docs/06 §3.2 pillar 2)."""
    if not documents:
        return NO_DOCUMENT_EVIDENCE_CONFIDENCE

    statuses = {doc.status for doc in documents}
    if DocumentStatus.TAMPER_SUSPECTED in statuses:
        return 0.10
    if DocumentStatus.NEEDS_RETAKE in statuses:
        return 0.40
    if DocumentStatus.UNVERIFIABLE in statuses or DocumentStatus.PENDING in statuses:
        return 0.55

    scores = [
        doc.verify_confidence
        if doc.verify_confidence is not None
        else DEFAULT_VERIFIED_DOCUMENT_CONFIDENCE
        for doc in documents
    ]
    return round(min(scores), 3)


def data_consistency_confidence(flags: Sequence[RiskFlag]) -> float:
    """Starts at 0.98; LOW deducts 0.05; MEDIUM caps 0.72; HIGH caps 0.20."""
    low_count = sum(1 for flag in flags if flag.severity is FlagSeverity.LOW)
    has_medium = any(flag.severity is FlagSeverity.MEDIUM for flag in flags)
    has_high = any(flag.severity is FlagSeverity.HIGH for flag in flags)

    score = 0.98 - 0.05 * low_count
    if has_medium:
        score = min(score, 0.72)
    if has_high:
        score = min(score, 0.20)
    return round(max(0.0, score), 3)


def consent_assurance_confidence(method: ConsentMethod | str | None) -> float:
    """Citizen OTP is 1.00; verbal-only consent is 0.82 and always reviewed."""
    if method is None:
        # Unmeasured consent is not strong consent.
        return 0.82
    value = method.value if isinstance(method, ConsentMethod) else str(method)
    if value in {ConsentMethod.SELF_OTP.value, ConsentMethod.CITIZEN_OTP.value}:
        return 1.00
    return 0.82


def overall_confidence(
    identity: float,
    documents: float,
    data_consistency: float,
    consent_assurance: float,
) -> float:
    """Weakest link, rounded to 3 decimals (docs/06 §3.2)."""
    return round(min(identity, documents, data_consistency, consent_assurance), 3)


def weakest_pillar(components: ConfidenceComponents) -> str:
    """Name of the lowest pillar; ties resolve in :data:`PILLAR_ORDER`."""
    pillars = components.as_pillars()
    return min(PILLAR_ORDER, key=lambda name: (pillars[name], PILLAR_ORDER.index(name)))


def build_confidence(
    *,
    identity: float,
    documents: Sequence[DocumentEvidence] = (),
    flags: Sequence[RiskFlag] = (),
    consent_method: ConsentMethod | str | None = None,
) -> ConfidenceComponents:
    """Assemble all four pillars and the weakest-link overall score."""
    document_score = document_confidence(documents)
    consistency_score = data_consistency_confidence(flags)
    consent_score = consent_assurance_confidence(consent_method)
    return ConfidenceComponents(
        identity=round(identity, 3),
        documents=document_score,
        data_consistency=consistency_score,
        consent_assurance=consent_score,
        overall=overall_confidence(
            identity, document_score, consistency_score, consent_score
        ),
    )
