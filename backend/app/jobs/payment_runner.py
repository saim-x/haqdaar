"""``INITIATE_PAYMENT`` job handler - simulated Raast transfer (docs/10 §1.2 E).

Idempotency is structural: ``payments.id`` is the ``Idempotency-Key`` sent to the
mock payment service and ``payments.case_id`` is UNIQUE, so a retried job can only
ever produce one transfer for one case.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.models.case_state import assert_transition
from app.models.cases import Case, Payment
from app.models.enums import CaseStatus, PaymentStatus
from app.models.identity import Citizen
from app.notify import create_notification
from app.security import audit
from app.security.errors import ServiceUnavailableError

PAYMENT_TIMEOUT_SECONDS = 8.0


def _now() -> datetime:
    return datetime.now(UTC)


def _payout_alias(case: Case, citizen: Citizen | None) -> str:
    answers = case.draft_answers or {}
    entry = answers.get("payout_phone")
    if isinstance(entry, dict):
        value = entry.get("value")
        if value:
            return str(value)
    elif entry:
        return str(entry)
    return (citizen.phone if citizen else None) or ""


def _get_or_create_payment(
    db: Session, case: Case, citizen: Citizen | None, amount_pkr: int | None
) -> Payment:
    payment = db.execute(
        select(Payment).where(Payment.case_id == case.id)
    ).scalar_one_or_none()
    if payment is not None:
        return payment

    amount = amount_pkr or case.approved_amount_pkr or 0
    payment = Payment(
        tenant_id=case.tenant_id,
        case_id=case.id,
        citizen_id=case.citizen_id,
        amount_pkr=int(amount),
        payout_alias=_payout_alias(case, citizen)[:32],
        status=PaymentStatus.CREATED.value,
        attempt_count=0,
    )
    db.add(payment)
    db.flush()
    return payment


def _transfer(payment: Payment, case: Case) -> dict[str, Any]:
    url = f"{settings.mock_api_root}/mock/v1/payments/transfer"
    body = {
        "payout_alias": payment.payout_alias,
        "amount_pkr": payment.amount_pkr,
        "reference_code": case.reference_code,
    }
    try:
        response = httpx.post(
            url,
            json=body,
            headers={"Idempotency-Key": str(payment.id)},
            timeout=PAYMENT_TIMEOUT_SECONDS,
        )
    except httpx.HTTPError as exc:
        raise ServiceUnavailableError(
            message_en="The payment service is temporarily unavailable. We will retry.",
            message_ur="ادائیگی کی سروس عارضی طور پر دستیاب نہیں۔ ہم دوبارہ کوشش کریں گے۔",
            details={"service": "payment"},
        ) from exc

    if response.status_code >= 500:
        raise ServiceUnavailableError(
            message_en="The payment service is temporarily unavailable. We will retry.",
            message_ur="ادائیگی کی سروس عارضی طور پر دستیاب نہیں۔ ہم دوبارہ کوشش کریں گے۔",
            details={"service": "payment", "status": response.status_code},
        )
    if response.status_code >= 400:
        raise RuntimeError(f"payment service rejected the transfer: HTTP {response.status_code}")

    payload = response.json()
    return payload if isinstance(payload, dict) else {"data": payload}


def run_payment(
    db: Session,
    case_id: str | uuid.UUID,
    decision_id: str | uuid.UUID | None = None,
    amount_pkr: int | None = None,
) -> dict[str, Any]:
    """Execute (or replay) the single payment for ``case_id``."""
    case = db.get(Case, uuid.UUID(str(case_id)))
    if case is None:
        raise LookupError(f"case {case_id} not found")

    citizen = db.get(Citizen, case.citizen_id)
    payment = _get_or_create_payment(db, case, citizen, amount_pkr)

    if payment.status == PaymentStatus.COMPLETED.value:
        return {"payment_id": str(payment.id), "status": payment.status, "replayed": True}

    if case.status == CaseStatus.APPROVED.value:
        assert_transition(case.status, CaseStatus.PAYMENT_INITIATED)
        case.status = CaseStatus.PAYMENT_INITIATED.value
    elif case.status not in (
        CaseStatus.PAYMENT_INITIATED.value,
        CaseStatus.PAYMENT_FAILED.value,
    ):
        raise RuntimeError(
            f"case {case.reference_code} is {case.status}; payment requires APPROVED"
        )

    payment.status = PaymentStatus.INITIATED.value
    payment.attempt_count = int(payment.attempt_count or 0) + 1
    audit.record(
        db,
        action="payment.initiated",
        resource_type="payment",
        resource_id=payment.id,
        actor_type="SYSTEM",
        tenant_id=case.tenant_id,
        payload={
            "case_id": str(case.id),
            "amount_pkr": payment.amount_pkr,
            "attempt": payment.attempt_count,
            "decision_id": str(decision_id) if decision_id else None,
        },
    )
    db.commit()

    result = _transfer(payment, case)
    status = str(result.get("status", "")).upper()

    if status == PaymentStatus.COMPLETED.value or result.get("payment_ref"):
        payment.status = PaymentStatus.COMPLETED.value
        payment.external_ref = str(result.get("payment_ref") or "")[:64] or None
        payment.failure_reason = None
        assert_transition(case.status, CaseStatus.PAID)
        case.status = CaseStatus.PAID.value
        case.decided_at = case.decided_at or _now()
        audit.record(
            db,
            action="payment.completed",
            resource_type="payment",
            resource_id=payment.id,
            actor_type="SYSTEM",
            tenant_id=case.tenant_id,
            payload={
                "case_id": str(case.id),
                "amount_pkr": payment.amount_pkr,
                "external_ref": payment.external_ref,
            },
        )
        if citizen is not None:
            create_notification(
                db,
                channel="SMS_SIMULATED" if citizen.phone else "IN_APP",
                phone=citizen.phone,
                citizen_id=citizen.id,
                user_id=citizen.user_id,
                case_id=case.id,
                tenant_id=case.tenant_id,
                title_en="Payment sent",
                title_ur="رقم بھیج دی گئی",
                body_en=(
                    f"PKR {payment.amount_pkr:,} has been sent for case {case.reference_code}. "
                    "Check the code below to confirm this message is genuine."
                ),
                body_ur=(
                    f"کیس {case.reference_code} کے لیے {payment.amount_pkr:,} روپے بھیج دیے گئے ہیں۔ "
                    "اس پیغام کے اصلی ہونے کی تصدیق کے لیے نیچے دیا گیا کوڈ دیکھیں۔"
                ),
            )
    else:
        payment.status = PaymentStatus.FAILED.value
        payment.failure_reason = str(result.get("failure_reason") or "PAYMENT_FAILED")[:120]
        assert_transition(case.status, CaseStatus.PAYMENT_FAILED)
        case.status = CaseStatus.PAYMENT_FAILED.value
        audit.record(
            db,
            action="payment.failed",
            resource_type="payment",
            resource_id=payment.id,
            actor_type="SYSTEM",
            tenant_id=case.tenant_id,
            payload={
                "case_id": str(case.id),
                "failure_reason": payment.failure_reason,
                "attempt": payment.attempt_count,
            },
        )
        if citizen is not None:
            create_notification(
                db,
                channel="SMS_SIMULATED" if citizen.phone else "IN_APP",
                phone=citizen.phone,
                citizen_id=citizen.id,
                user_id=citizen.user_id,
                case_id=case.id,
                tenant_id=case.tenant_id,
                title_en="Payment issue - officer notified",
                title_ur="ادائیگی میں مسئلہ - افسر کو اطلاع دے دی گئی",
                body_en=(
                    f"We could not send the payment for case {case.reference_code}. "
                    "An officer will contact you. You do not need to do anything."
                ),
                body_ur=(
                    f"کیس {case.reference_code} کی رقم نہیں بھیجی جا سکی۔ "
                    "افسر آپ سے رابطہ کریں گے۔ آپ کو کچھ کرنے کی ضرورت نہیں۔"
                ),
            )

    db.commit()
    return {
        "payment_id": str(payment.id),
        "status": payment.status,
        "external_ref": payment.external_ref,
        "case_status": case.status,
    }


__all__ = ["run_payment"]
