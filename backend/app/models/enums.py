"""Frozen enum vocabularies (docs/04 §3).

Columns are stored as VARCHAR with the exact literals below — no PostgreSQL enum
types are created, so adding a value never needs a migration. Every value here is
copied verbatim from docs/04 §3 and must not be extended without a contract change.
"""

from __future__ import annotations

from enum import StrEnum


class UserRole(StrEnum):
    CITIZEN = "CITIZEN"
    HELPER = "HELPER"
    OFFICER = "OFFICER"
    ADMIN = "ADMIN"
    AUDITOR = "AUDITOR"


class CaseType(StrEnum):
    BENEFIT_APPLICATION = "BENEFIT_APPLICATION"
    COMPLAINT = "COMPLAINT"


class CaseStatus(StrEnum):
    DRAFT = "DRAFT"
    SUBMITTED = "SUBMITTED"
    PROCESSING = "PROCESSING"
    WAITING_EXTERNAL = "WAITING_EXTERNAL"
    NEEDS_INFO = "NEEDS_INFO"
    HUMAN_REVIEW = "HUMAN_REVIEW"
    IN_REVIEW = "IN_REVIEW"
    PENDING_SECOND_APPROVAL = "PENDING_SECOND_APPROVAL"
    ON_HOLD_CONSENT = "ON_HOLD_CONSENT"
    APPROVED = "APPROVED"
    PAYMENT_INITIATED = "PAYMENT_INITIATED"
    PAID = "PAID"
    PAYMENT_FAILED = "PAYMENT_FAILED"
    REJECTED = "REJECTED"
    WITHDRAWN = "WITHDRAWN"
    CLOSED = "CLOSED"


class RouteAction(StrEnum):
    """Router outcomes. There is deliberately no AUTO_REJECT member (ADR-002)."""

    AUTO_APPROVE = "AUTO_APPROVE"
    ASK_MORE = "ASK_MORE"
    HUMAN_REVIEW = "HUMAN_REVIEW"
    WAIT_EXTERNAL = "WAIT_EXTERNAL"


class DocumentType(StrEnum):
    CNIC_FRONT = "CNIC_FRONT"
    SPOUSE_DEATH_CERTIFICATE = "SPOUSE_DEATH_CERTIFICATE"
    OTHER = "OTHER"


class DocVerifyStatus(StrEnum):
    PENDING = "PENDING"
    VERIFIED = "VERIFIED"
    NEEDS_RETAKE = "NEEDS_RETAKE"
    UNVERIFIABLE = "UNVERIFIABLE"
    TAMPER_SUSPECTED = "TAMPER_SUSPECTED"


class ConsentRecipientType(StrEnum):
    DEPARTMENT = "DEPARTMENT"
    HELPER = "HELPER"


class ConsentStatus(StrEnum):
    ACTIVE = "ACTIVE"
    WITHDRAWN = "WITHDRAWN"
    EXPIRED = "EXPIRED"


class DataCategory(StrEnum):
    IDENTITY = "IDENTITY"
    HOUSEHOLD = "HOUSEHOLD"
    DOCUMENTS = "DOCUMENTS"
    PAYMENT = "PAYMENT"
    CASE_HISTORY = "CASE_HISTORY"


class ConsentPurpose(StrEnum):
    BENEFIT_APPLICATION = "BENEFIT_APPLICATION"
    PAYMENT_DISBURSEMENT = "PAYMENT_DISBURSEMENT"
    HELPER_ASSISTANCE = "HELPER_ASSISTANCE"
    COMPLAINT_RESOLUTION = "COMPLAINT_RESOLUTION"


class ConsentAction(StrEnum):
    GRANTED = "GRANTED"
    MODIFIED = "MODIFIED"
    WITHDRAWN = "WITHDRAWN"
    EXPIRED = "EXPIRED"


class AssuranceLevel(StrEnum):
    SELF_OTP = "SELF_OTP"
    CITIZEN_OTP = "CITIZEN_OTP"
    VERBAL_WITNESSED = "VERBAL_WITNESSED"


class ScamVerdict(StrEnum):
    VERIFIED_OFFICIAL = "VERIFIED_OFFICIAL"
    LIKELY_SAFE = "LIKELY_SAFE"
    CANNOT_TELL = "CANNOT_TELL"
    LIKELY_SCAM = "LIKELY_SCAM"


class JobStatus(StrEnum):
    PENDING = "PENDING"
    RUNNING = "RUNNING"
    COMPLETED = "COMPLETED"
    FAILED_RETRY = "FAILED_RETRY"
    DEAD = "DEAD"


class JobType(StrEnum):
    PROCESS_CASE = "PROCESS_CASE"
    INITIATE_PAYMENT = "INITIATE_PAYMENT"
    VERIFY_DOCUMENT = "VERIFY_DOCUMENT"
    REINDEX_RAG = "REINDEX_RAG"
    CHECK_COMPLAINT = "CHECK_COMPLAINT"


class PriorityBand(StrEnum):
    URGENT = "URGENT"
    HIGH = "HIGH"
    NORMAL = "NORMAL"
    LOW = "LOW"


class DecisionSource(StrEnum):
    AI_ENGINE = "AI_ENGINE"
    OFFICER = "OFFICER"
    SECOND_OFFICER = "SECOND_OFFICER"


class NoteType(StrEnum):
    AGENT_STEP = "AGENT_STEP"
    AI_HANDOFF = "AI_HANDOFF"
    OFFICER_NOTE = "OFFICER_NOTE"
    CITIZEN_REPLY = "CITIZEN_REPLY"


class PaymentStatus(StrEnum):
    CREATED = "CREATED"
    INITIATED = "INITIATED"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"


class CorrectionStatus(StrEnum):
    APPLIED = "APPLIED"
    PENDING_OFFICER = "PENDING_OFFICER"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"


class CorrectionSourceType(StrEnum):
    SELF_DECLARED = "SELF_DECLARED"
    REGISTRY = "REGISTRY"


class NotificationChannel(StrEnum):
    IN_APP = "IN_APP"
    SMS_SIMULATED = "SMS_SIMULATED"


class RuleVersionStatus(StrEnum):
    DRAFT = "DRAFT"
    PUBLISHED = "PUBLISHED"
    ARCHIVED = "ARCHIVED"


class ActorType(StrEnum):
    USER = "USER"
    AI = "AI"
    AGENT = "AGENT"
    SYSTEM = "SYSTEM"
    API_KEY = "API_KEY"


class OtpPurpose(StrEnum):
    LOGIN = "LOGIN"
    HELPER_CONSENT = "HELPER_CONSENT"


class FactState(StrEnum):
    """Tri-state canonical facts (docs/04 §5). UNKNOWN is a first-class value."""

    KNOWN = "KNOWN"
    UNKNOWN = "UNKNOWN"


class RagSourceType(StrEnum):
    POLICY_MD = "POLICY_MD"
    AUTO_RULE_SUMMARY = "AUTO_RULE_SUMMARY"


class AiTaskType(StrEnum):
    VOICE_STT = "VOICE_STT"
    VOICE_PARSE = "VOICE_PARSE"
    DOC_OCR = "DOC_OCR"
    SCAM_EXPLAIN = "SCAM_EXPLAIN"
    RAG_ASK = "RAG_ASK"
    EXPLAIN_POLISH = "EXPLAIN_POLISH"
