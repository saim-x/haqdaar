"""Public partner REST API — ``X-API-Key`` + scopes (docs/05 §3.10)."""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models.ai import Notification
from app.models.cases import Case
from app.models.enums import CaseStatus
from app.models.programs import Program, RuleVersion
from app.security.errors import NotFoundError, ValidationError
from app.security.rbac import ApiKeyContext, require_scopes

router = APIRouter(prefix="/public", tags=["public"])

DbSession = Annotated[Session, Depends(get_db)]
RulesReader = Annotated[ApiKeyContext, Depends(require_scopes("rules:read"))]
CasesReader = Annotated[ApiKeyContext, Depends(require_scopes("cases:read"))]
ScamChecker = Annotated[ApiKeyContext, Depends(require_scopes("scam:check"))]

#: Milestones a partner may see. Deliberately coarse: no facts, no PII, no notes.
_MILESTONES: dict[str, dict[str, str]] = {
    CaseStatus.DRAFT.value: {"en": "Draft", "ur": "مسودہ"},
    CaseStatus.SUBMITTED.value: {"en": "Submitted", "ur": "جمع کرائی گئی"},
    CaseStatus.PROCESSING.value: {"en": "Under review", "ur": "جانچ جاری"},
    CaseStatus.WAITING_EXTERNAL.value: {"en": "Awaiting verification", "ur": "تصدیق کا انتظار"},
    CaseStatus.NEEDS_INFO.value: {"en": "Information requested", "ur": "معلومات درکار"},
    CaseStatus.HUMAN_REVIEW.value: {"en": "With an officer", "ur": "افسر کے پاس"},
    CaseStatus.IN_REVIEW.value: {"en": "Officer reviewing", "ur": "افسر جائزہ لے رہا ہے"},
    CaseStatus.PENDING_SECOND_APPROVAL.value: {"en": "Final approval", "ur": "حتمی منظوری"},
    CaseStatus.ON_HOLD_CONSENT.value: {"en": "Paused", "ur": "روکی گئی"},
    CaseStatus.APPROVED.value: {"en": "Approved", "ur": "منظور"},
    CaseStatus.PAYMENT_INITIATED.value: {"en": "Payment in progress", "ur": "ادائیگی جاری"},
    CaseStatus.PAID.value: {"en": "Paid", "ur": "ادا شدہ"},
    CaseStatus.PAYMENT_FAILED.value: {"en": "Payment issue", "ur": "ادائیگی میں مسئلہ"},
    CaseStatus.REJECTED.value: {"en": "Not approved", "ur": "منظور نہیں"},
    CaseStatus.WITHDRAWN.value: {"en": "Withdrawn", "ur": "واپس لی گئی"},
    CaseStatus.CLOSED.value: {"en": "Closed", "ur": "مکمل"},
}


@router.get("/programs", summary="Active programs and their published rule summary")
def public_programs(
    key: RulesReader,
    db: DbSession,
    limit: int = Query(default=20, ge=1, le=50),
) -> dict[str, Any]:
    programs = (
        db.execute(
            select(Program)
            .where(Program.tenant_id == key.tenant_id, Program.is_active.is_(True))
            .order_by(Program.code.asc())
            .limit(limit)
        )
        .scalars()
        .all()
    )

    items = []
    for program in programs:
        rule_version = (
            db.get(RuleVersion, program.active_rule_version_id)
            if program.active_rule_version_id
            else None
        )
        items.append(
            {
                "code": program.code,
                "name": program.name,
                "name_ur": program.name_ur,
                "description": program.description,
                "description_ur": program.description_ur,
                "required_documents": program.required_documents or [],
                "active_rule_version": {
                    "version_number": rule_version.version_number,
                    "content_hash": rule_version.content_hash,
                    "published_at": rule_version.published_at.isoformat()
                    if rule_version.published_at
                    else None,
                }
                if rule_version
                else None,
            }
        )

    return {"items": items, "total": len(items), "tenant_id": str(key.tenant_id)}


@router.get("/cases/{reference_code}/status", summary="Non-PII status of one application")
def public_case_status(
    reference_code: str,
    key: CasesReader,
    db: DbSession,
) -> dict[str, Any]:
    case = db.execute(
        select(Case)
        .where(Case.reference_code == reference_code, Case.tenant_id == key.tenant_id)
        .limit(1)
    ).scalar_one_or_none()
    if case is None:
        raise NotFoundError()

    milestone = _MILESTONES.get(case.status, {"en": case.status, "ur": case.status})
    return {
        "reference_code": case.reference_code,
        "case_type": case.case_type,
        "status": case.status,
        "milestone": milestone,
        "approved_amount_pkr": case.approved_amount_pkr,
        "submitted_at": case.submitted_at.isoformat() if case.submitted_at else None,
        "decided_at": case.decided_at.isoformat() if case.decided_at else None,
        "updated_at": case.updated_at.isoformat() if case.updated_at else None,
    }


@router.post("/scam/check", summary="Partner scam and official-message verification")
def public_scam_check(
    payload: dict[str, Any],
    key: ScamChecker,
    db: DbSession,
) -> dict[str, Any]:
    text = str(payload.get("text") or "").strip()
    if not text:
        raise ValidationError(
            details={"fields": [{"field": "text", "reason": "REQUIRED"}]}
        )
    if len(text) > 4000:
        raise ValidationError(
            details={"fields": [{"field": "text", "reason": "TOO_LONG"}]}
        )

    from app.ai import scam_classifier

    verdict = scam_classifier.classify(text, db=db)
    body = verdict.as_dict()
    body["advice_en"] = (
        "Haqdaar never asks for a fee, an OTP or your PIN. Verify any code in the "
        "app before you act."
    )
    body["advice_ur"] = (
        "حقدار کبھی فیس، او ٹی پی یا پن نہیں مانگتا۔ کچھ کرنے سے پہلے کوڈ ایپ میں تصدیق کریں۔"
    )
    body["simulated"] = True
    return body


@router.get("/verify-message/{verification_code}", summary="Verify an official Haqdaar code")
def public_verify_message(
    verification_code: str,
    key: ScamChecker,
    db: DbSession,
) -> dict[str, Any]:
    code = verification_code.strip().upper()
    notification = db.execute(
        select(Notification).where(Notification.verification_code == code).limit(1)
    ).scalar_one_or_none()

    if notification is None:
        return {
            "verification_code": code,
            "valid": False,
            "message_en": "This code does not match any official Haqdaar message.",
            "message_ur": "یہ کوڈ کسی سرکاری حقدار پیغام سے مطابقت نہیں رکھتا۔",
        }

    if notification.tenant_id is not None and notification.tenant_id != key.tenant_id:
        raise NotFoundError()

    return {
        "verification_code": code,
        "valid": True,
        "channel": notification.channel,
        "title_en": notification.title_en,
        "title_ur": notification.title_ur,
        "body_sha256": notification.body_sha256,
        "issued_at": notification.created_at.isoformat() if notification.created_at else None,
        "message_en": "This code belongs to a genuine Haqdaar notification.",
        "message_ur": "یہ کوڈ اصل حقدار اطلاع کا ہے۔",
    }


__all__ = ["router"]
