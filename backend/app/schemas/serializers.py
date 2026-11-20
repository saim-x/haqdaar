"""Response serialisers shared by the routers.

Citizen-facing payloads never include internal risk flags, officer notes or raw
identifiers; officer/auditor payloads include the full evidence trail. CNICs are
always masked in list views (docs/03 §6.1).
"""

from __future__ import annotations

from typing import Any

from app.models.cases import Case, CaseNote, Decision, Document, Payment
from app.models.consent import ConsentGrant
from app.models.enums import CaseStatus
from app.models.identity import Citizen, Tenant
from app.models.programs import Program
from app.security.masking import mask_cnic, mask_phone

#: Citizen-facing status copy (docs/04 §3.3).
STATUS_LABELS: dict[str, tuple[str, str]] = {
    "DRAFT": ("Draft saved", "درخواست محفوظ ہے"),
    "SUBMITTED": ("Checking your application", "جانچ جاری ہے"),
    "PROCESSING": ("Checking your application", "جانچ جاری ہے"),
    "WAITING_EXTERNAL": ("Waiting for government system", "سرکاری نظام کا انتظار ہے"),
    "NEEDS_INFO": ("Please provide more info", "مزید معلومات درکار ہیں"),
    "HUMAN_REVIEW": ("Officer will check", "افسر جانچ کرے گا"),
    "IN_REVIEW": ("Officer is reviewing", "افسر جائزہ لے رہا ہے"),
    "PENDING_SECOND_APPROVAL": ("Final check in progress", "حتمی منظوری جاری ہے"),
    "ON_HOLD_CONSENT": ("Paused — consent withdrawn", "رضامندی واپس لی گئی"),
    "APPROVED": ("Approved! Sending payment", "منظور! رقم بھیجی جا رہی ہے"),
    "PAYMENT_INITIATED": ("Sending payment", "رقم بھیجی جا رہی ہے"),
    "PAID": ("Money sent", "رقم موصول ہو گئی"),
    "PAYMENT_FAILED": ("Payment issue — officer notified", "ادائیگی میں مسئلہ"),
    "REJECTED": ("Not approved (see reasons)", "منظور نہیں ہوئی"),
    "WITHDRAWN": ("Withdrawn", "واپس لے لی گئی"),
    "CLOSED": ("Completed", "مکمل"),
}

#: Timeline labels for audited case actions.
ACTION_LABELS: dict[str, tuple[str, str]] = {
    "case.created": ("Application started", "درخواست شروع کی گئی"),
    "case.submitted": ("Application submitted", "درخواست جمع کرائی گئی"),
    "case.status_changed": ("Status updated", "حالت تبدیل ہوئی"),
    "case.withdrawn": ("Application withdrawn", "درخواست واپس لی گئی"),
    "decision.recorded": ("Decision recorded", "فیصلہ درج کیا گیا"),
    "officer.decided": ("Officer decided", "افسر نے فیصلہ کیا"),
    "officer.second_approved": ("Second officer approved", "دوسرے افسر نے منظوری دی"),
    "document.uploaded": ("Document uploaded", "دستاویز اپ لوڈ کی گئی"),
    "document.verified": ("Document checked", "دستاویز کی جانچ ہوئی"),
    "payment.initiated": ("Payment started", "ادائیگی شروع کی گئی"),
    "payment.completed": ("Payment sent", "رقم بھیج دی گئی"),
    "payment.failed": ("Payment failed", "ادائیگی ناکام رہی"),
    "consent.withdrawn": ("Consent withdrawn", "رضامندی واپس لی گئی"),
    "consent.granted": ("Consent granted", "رضامندی دی گئی"),
}


def status_label(status: str) -> dict[str, str]:
    en, ur = STATUS_LABELS.get(status, (status.replace("_", " ").title(), status))
    return {"label_en": en, "label_ur": ur}


def program_brief(program: Program | None) -> dict[str, Any] | None:
    if program is None:
        return None
    return {"code": program.code, "name": program.name, "name_ur": program.name_ur}


def tenant_brief(tenant: Tenant | None) -> dict[str, Any] | None:
    if tenant is None:
        return None
    return {"code": tenant.code, "name": tenant.name, "name_ur": tenant.name_ur}


def citizen_brief(citizen: Citizen | None) -> dict[str, Any] | None:
    if citizen is None:
        return None
    return {
        "id": str(citizen.id),
        "full_name": citizen.full_name,
        "cnic_masked": mask_cnic(citizen.cnic_digits),
        "phone_masked": mask_phone(citizen.phone),
        "district": citizen.district,
        "avatar_color": citizen.avatar_color,
    }


def document_to_dict(document: Document, *, include_checks: bool = True) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "id": str(document.id),
        "doc_type": document.doc_type,
        "verify_status": document.verify_status,
        "verify_confidence": float(document.verify_confidence)
        if document.verify_confidence is not None
        else None,
        "mime_type": document.mime_type,
        "size_bytes": document.size_bytes,
        "created_at": document.created_at.isoformat() if document.created_at else None,
        "retake_reason_en": document.retake_reason_en,
        "retake_reason_ur": document.retake_reason_ur,
    }
    if include_checks:
        payload["verify_checks"] = document.verify_checks or []
        payload["extracted_fields"] = document.extracted_fields or {}
    return payload


def payment_to_dict(payment: Payment | None) -> dict[str, Any] | None:
    if payment is None:
        return None
    return {
        "status": payment.status,
        "amount_pkr": payment.amount_pkr,
        "external_ref": payment.external_ref,
        "failure_reason": payment.failure_reason,
    }


def note_to_dict(note: CaseNote) -> dict[str, Any]:
    return {
        "id": str(note.id),
        "note_type": note.note_type,
        "body": note.body,
        "metadata": note.metadata_json or {},
        "is_visible_to_citizen": note.is_visible_to_citizen,
        "created_at": note.created_at.isoformat() if note.created_at else None,
    }


def decision_to_dict(decision: Decision) -> dict[str, Any]:
    return {
        "id": str(decision.id),
        "decision_source": decision.decision_source,
        "rule_version_id": str(decision.rule_version_id),
        "rule_content_hash": decision.rule_content_hash,
        "input_snapshot_hash": decision.input_snapshot_hash,
        "confidence_components": decision.confidence_components,
        "confidence_overall": float(decision.confidence_overall),
        "route_action": decision.route_action,
        "outcome_status": decision.outcome_status,
        "escalation_reasons": decision.escalation_reasons or [],
        "model_versions": decision.model_versions or {},
        "citizen_explanation": decision.citizen_explanation,
        "computed_amount_pkr": decision.computed_amount_pkr,
        "officer_reason_codes": decision.officer_reason_codes,
        "officer_note": decision.officer_note,
        "is_override": decision.is_override,
        "created_at": decision.created_at.isoformat() if decision.created_at else None,
    }


def case_to_dict(
    case: Case,
    *,
    program: Program | None = None,
    documents: list[Document] | None = None,
    payment: Payment | None = None,
    notes: list[CaseNote] | None = None,
    timeline: list[dict[str, Any]] | None = None,
    include_internal: bool = False,
) -> dict[str, Any]:
    """Role-tailored case view (docs/05 §3.2)."""
    payload: dict[str, Any] = {
        "id": str(case.id),
        "reference_code": case.reference_code,
        "case_type": case.case_type,
        "status": case.status,
        "status_label": status_label(case.status),
        "program": program_brief(program),
        "approved_amount_pkr": case.approved_amount_pkr,
        "wizard_step": case.wizard_step,
        "draft_answers": case.draft_answers or {},
        "documents": [document_to_dict(doc, include_checks=include_internal) for doc in documents or []],
        "citizen_explanation": case.citizen_explanation,
        "payment": payment_to_dict(payment),
        "timeline": timeline or [],
        "submitted_at": case.submitted_at.isoformat() if case.submitted_at else None,
        "created_at": case.created_at.isoformat() if case.created_at else None,
        "updated_at": case.updated_at.isoformat() if case.updated_at else None,
        "parent_case_id": str(case.parent_case_id) if case.parent_case_id else None,
    }
    if include_internal:
        payload.update(
            {
                "tenant_id": str(case.tenant_id),
                "citizen_id": str(case.citizen_id),
                "submitted_by_user_id": str(case.submitted_by_user_id),
                "submitted_via_helper": case.submitted_via_helper,
                "assigned_officer_id": str(case.assigned_officer_id)
                if case.assigned_officer_id
                else None,
                "first_approver_id": str(case.first_approver_id) if case.first_approver_id else None,
                "priority_score": case.priority_score,
                "priority_band": case.priority_band,
                "latest_confidence": float(case.latest_confidence)
                if case.latest_confidence is not None
                else None,
                "latest_route": case.latest_route,
                "latest_rule_version_id": str(case.latest_rule_version_id)
                if case.latest_rule_version_id
                else None,
                "ask_more_rounds": case.ask_more_rounds,
                "flags": case.flags_json or [],
                "ai_case_note": case.ai_case_note,
                "previous_status": case.previous_status,
                "decided_at": case.decided_at.isoformat() if case.decided_at else None,
                "notes": [note_to_dict(note) for note in notes or []],
            }
        )
    return payload


def case_card(case: Case, *, citizen: Citizen | None, program: Program | None) -> dict[str, Any]:
    """Officer queue card: masked CNIC, priority band, confidence, reason codes."""
    flags = case.flags_json or []
    return {
        "id": str(case.id),
        "reference_code": case.reference_code,
        "status": case.status,
        "status_label": status_label(case.status),
        "program": program_brief(program),
        "citizen_name": citizen.full_name if citizen else None,
        "cnic_masked": mask_cnic(citizen.cnic_digits) if citizen else None,
        "district": citizen.district if citizen else None,
        "priority_score": case.priority_score,
        "priority_band": case.priority_band,
        "latest_confidence": float(case.latest_confidence)
        if case.latest_confidence is not None
        else None,
        "latest_route": case.latest_route,
        "reason_codes": [flag.get("code") for flag in flags if isinstance(flag, dict)],
        "assigned_officer_id": str(case.assigned_officer_id) if case.assigned_officer_id else None,
        "submitted_at": case.submitted_at.isoformat() if case.submitted_at else None,
        "created_at": case.created_at.isoformat() if case.created_at else None,
        "rule_stale": False,
    }


def grant_to_dict(grant: ConsentGrant) -> dict[str, Any]:
    return {
        "id": str(grant.id),
        "citizen_id": str(grant.citizen_id),
        "recipient_type": grant.recipient_type,
        "recipient_tenant_id": str(grant.recipient_tenant_id)
        if grant.recipient_tenant_id
        else None,
        "recipient_user_id": str(grant.recipient_user_id) if grant.recipient_user_id else None,
        "categories": grant.categories or [],
        "purposes": grant.purposes or [],
        "status": grant.status,
        "assurance_level": grant.assurance_level,
        "granted_at": grant.granted_at.isoformat() if grant.granted_at else None,
        "expires_at": grant.expires_at.isoformat() if grant.expires_at else None,
        "withdrawn_at": grant.withdrawn_at.isoformat() if grant.withdrawn_at else None,
    }


def is_open_status(status: str) -> bool:
    return status not in {
        CaseStatus.DRAFT.value,
        CaseStatus.PAID.value,
        CaseStatus.REJECTED.value,
        CaseStatus.WITHDRAWN.value,
        CaseStatus.CLOSED.value,
    }


__all__ = [
    "ACTION_LABELS",
    "STATUS_LABELS",
    "case_card",
    "case_to_dict",
    "citizen_brief",
    "decision_to_dict",
    "document_to_dict",
    "grant_to_dict",
    "is_open_status",
    "note_to_dict",
    "payment_to_dict",
    "program_brief",
    "status_label",
    "tenant_brief",
]
