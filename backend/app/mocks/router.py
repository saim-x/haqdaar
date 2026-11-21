"""Simulated DPI services - ``/mock/v1/*`` (docs/05 §3.11, docs/10 §1.2).

Mounted by ``app/main.py`` as ``app.include_router(router, prefix="/mock")``.
The case agent reaches these endpoints **only** over HTTP via ``MOCK_BASE_URL``;
nothing in ``app/api``, ``app/engine``, ``app/agent`` or ``app/ai`` imports this
module or the ``mock_*`` tables.

Every 2xx body carries ``simulated: true``, ``service`` and ``service_mode``
(injected by :class:`app.mocks.chaos.ChaosRoute`). Every row served here is
synthetic: CNICs start with the reserved fictional prefix ``99900``.
"""

from __future__ import annotations

import re
from collections.abc import Iterable
from datetime import UTC, date, datetime
from typing import Any

from fastapi import APIRouter, Body, Header, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.mocks.chaos import ChaosRoute
from app.mocks.models import (
    MockBenefit,
    MockCivilDeath,
    MockComplaint,
    MockHousehold,
    MockIdentity,
    MockPayment,
)
from app.mocks.payout_aliases import account_title_for, is_dormant_alias

router = APIRouter(route_class=ChaosRoute, tags=["mock"])

#: Deterministic Raast failure alias (docs/10 §1.2 E) - powers Journey J-9.
DETERMINISTIC_FAILURE_ALIAS = "+923009999999"

_HONORIFICS = {"mst", "musammat", "mr", "mrs", "ms", "smt", "haji", "syed", "s", "m"}
_PHONETIC = {
    "mohammad": "muhammad",
    "muhammed": "muhammad",
    "mohammed": "muhammad",
    "mohd": "muhammad",
    "md": "muhammad",
    "muhd": "muhammad",
    "rasul": "rasool",
    "fatimah": "fatima",
    "fatma": "fatima",
    "aisha": "ayesha",
    "aysha": "ayesha",
    "hussain": "husain",
    "hussein": "husain",
    "bano": "bibi",
}


# --------------------------------------------------------------------------- #
# helpers
# --------------------------------------------------------------------------- #
def _session() -> Session:
    from app.db import SessionLocal

    return SessionLocal()


def _digits(value: str | None) -> str:
    return re.sub(r"\D", "", value or "")


def _tokens(value: str) -> list[str]:
    raw = re.split(r"[^0-9A-Za-z\u0600-\u06FF]+", (value or "").lower())
    out: list[str] = []
    for token in raw:
        if not token or token in _HONORIFICS:
            continue
        out.append(_PHONETIC.get(token, token))
    return out


def _iso(value: Any) -> Any:
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    return value


def _identity_payload(row: MockIdentity) -> dict[str, Any]:
    return {
        "cnic_digits": row.cnic_digits,
        "full_name": row.full_name,
        "full_name_ur": row.full_name_ur,
        "father_or_spouse_name": row.father_or_spouse_name,
        "dob": _iso(row.dob),
        "gender": row.gender,
        "district": row.district,
        "is_alive": row.is_alive,
        "cnic_expiry_date": _iso(row.cnic_expiry_date),
        "marital_status": row.marital_status,
    }


def _notification_model() -> Any | None:
    """Resolve BE's ``Notification`` ORM class across plausible module layouts."""
    candidates = (
        ("app.models", "Notification"),
        ("app.models.notification", "Notification"),
        ("app.models.notifications", "Notification"),
    )
    for module_name, attr in candidates:
        try:
            module = __import__(module_name, fromlist=[attr])
        except Exception:
            continue
        model = getattr(module, attr, None)
        if model is not None:
            return model
    return None


# --------------------------------------------------------------------------- #
# A. Identity registry (NADRA-like, simulated)
# --------------------------------------------------------------------------- #
@router.get("/v1/identity/lookup")
def identity_lookup(
    cnic: str | None = Query(default=None, description="13 digits, dashes tolerated"),
    name: str | None = Query(default=None, description="Free-text name for broad search"),
    district: str | None = Query(default=None),
    dob: str | None = Query(default=None, description="ISO date, optional narrow filter"),
) -> dict[str, Any]:
    """Exact CNIC lookup, or a deliberately broad name+district search.

    The broad search returns **every** plausible candidate so that
    ``engine/entity_resolution`` can flag ``POSSIBLE_DUPLICATE_IDENTITY`` instead
    of the mock silently picking a winner (Challenge 03).
    """
    db = _session()
    try:
        if cnic:
            digits = _digits(cnic)
            if len(digits) != 13:
                raise HTTPException(
                    status_code=400,
                    detail={"simulated": True, "error": "INVALID_CNIC", "detail": "cnic must be 13 digits"},
                )
            row = db.get(MockIdentity, digits)
            return {"simulated": True, "matches": [_identity_payload(row)] if row else []}

        if not name:
            raise HTTPException(
                status_code=400,
                detail={"simulated": True, "error": "MISSING_QUERY", "detail": "provide cnic or name"},
            )

        query_tokens = set(_tokens(name))
        stmt = select(MockIdentity)
        if district:
            stmt = stmt.where(func.lower(MockIdentity.district) == district.strip().lower())
        rows = db.scalars(stmt).all()

        scored: list[tuple[int, MockIdentity]] = []
        for row in rows:
            haystack = " ".join(
                [row.full_name, *(str(v) for v in (row.variants_json or []))]
            )
            row_tokens = set(_tokens(haystack))
            overlap = len(query_tokens & row_tokens)
            if overlap == 0:
                continue
            if dob and _iso(row.dob) != dob:
                continue
            scored.append((overlap, row))

        scored.sort(key=lambda item: (-item[0], item[1].full_name))
        return {"simulated": True, "matches": [_identity_payload(row) for _, row in scored[:20]]}
    finally:
        db.close()


# --------------------------------------------------------------------------- #
# B. Civil death registry (simulated)
# --------------------------------------------------------------------------- #
@router.get("/v1/civil/death-records")
def civil_death_records(
    spouse_cnic: str | None = Query(default=None),
    deceased_cnic: str | None = Query(default=None),
    deceased_name: str | None = Query(default=None),
    district: str | None = Query(default=None),
) -> dict[str, Any]:
    db = _session()
    try:
        stmt = select(MockCivilDeath)
        if spouse_cnic:
            stmt = stmt.where(MockCivilDeath.spouse_cnic == _digits(spouse_cnic))
        elif deceased_cnic:
            stmt = stmt.where(MockCivilDeath.deceased_cnic == _digits(deceased_cnic))
        elif deceased_name:
            query_tokens = set(_tokens(deceased_name))
            stmt = stmt.where(
                func.lower(MockCivilDeath.deceased_name).contains(
                    (deceased_name or "").strip().lower()
                )
            )
            if district:
                stmt = stmt.where(func.lower(MockCivilDeath.district) == district.strip().lower())
            rows = db.scalars(stmt).all()
            # Fall back to token overlap so "Ghulam Rasool" still finds "Ghulam Rasool Shah".
            if not rows and query_tokens:
                rows = [
                    row
                    for row in db.scalars(select(MockCivilDeath)).all()
                    if query_tokens & set(_tokens(row.deceased_name))
                    and (not district or row.district.lower() == district.strip().lower())
                ]
            return {"simulated": True, "records": [_death_payload(row) for row in rows]}
        else:
            raise HTTPException(
                status_code=400,
                detail={
                    "simulated": True,
                    "error": "MISSING_QUERY",
                    "detail": "provide spouse_cnic, deceased_cnic or deceased_name",
                },
            )

        rows = db.scalars(stmt).all()
        return {"simulated": True, "records": [_death_payload(row) for row in rows]}
    finally:
        db.close()


def _death_payload(row: MockCivilDeath) -> dict[str, Any]:
    return {
        "deceased_cnic": row.deceased_cnic,
        "deceased_name": row.deceased_name,
        "spouse_cnic": row.spouse_cnic,
        "spouse_name": row.spouse_name,
        "death_date": _iso(row.death_date),
        "district": row.district,
        "certificate_no": row.certificate_no,
    }


# --------------------------------------------------------------------------- #
# C. Household socio-economic survey (BISP/NSER-like, simulated)
# --------------------------------------------------------------------------- #
@router.get("/v1/household/survey")
def household_survey(cnic: str = Query(...)) -> dict[str, Any]:
    db = _session()
    try:
        digits = _digits(cnic)
        row = db.scalars(
            select(MockHousehold).where(MockHousehold.head_cnic == digits)
        ).first()
        if row is None:
            # A widow may be recorded as a household member rather than the head.
            row = db.scalars(
                select(MockHousehold).where(MockHousehold.member_cnics.contains([digits]))
            ).first()
        if row is None:
            return {"simulated": True, "found": False, "record": None}
        return {
            "simulated": True,
            "found": True,
            "record": {
                "head_cnic": row.head_cnic,
                "district": row.district,
                "household_size": row.household_size,
                "monthly_income_pkr": row.monthly_income_pkr,
                "poverty_score": row.poverty_score,
                "survey_year": row.survey_year,
            },
        }
    finally:
        db.close()


# --------------------------------------------------------------------------- #
# D. Benefits registry (cross-program check, simulated)
# --------------------------------------------------------------------------- #
@router.get("/v1/benefits/active")
def benefits_active(cnic: str = Query(...)) -> dict[str, Any]:
    db = _session()
    try:
        digits = _digits(cnic)
        rows = db.scalars(
            select(MockBenefit).where(
                MockBenefit.cnic_digits == digits, MockBenefit.is_active.is_(True)
            )
        ).all()
        return {
            "simulated": True,
            "active_benefits": [
                {
                    "program_name": row.program_name,
                    "monthly_amount_pkr": row.monthly_amount_pkr,
                    "started_at": _iso(row.started_at),
                }
                for row in rows
            ],
        }
    finally:
        db.close()


# --------------------------------------------------------------------------- #
# E. Instant payment service (Raast-like, simulated)
# --------------------------------------------------------------------------- #
class TransferRequest(BaseModel):
    payout_alias: str = Field(min_length=4, max_length=32)
    amount_pkr: int = Field(gt=0, le=1_000_000)
    reference_code: str = Field(min_length=3, max_length=40)


class ComplaintRequest(BaseModel):
    payment_ref: str | None = Field(default=None, max_length=40)
    citizen_cnic: str | None = Field(default=None, max_length=20)
    reason: str = Field(min_length=3, max_length=2000)


def _payment_payload(row: MockPayment, *, replay: bool) -> dict[str, Any]:
    return {
        "simulated": True,
        "payment_ref": row.payment_ref,
        "status": row.status,
        "amount_pkr": row.amount_pkr,
        "payout_alias": row.payout_alias,
        "account_title": row.account_title,
        "failure_reason": row.failure_reason,
        "created_at": _iso(row.created_at),
        "idempotent_replay": replay,
    }


@router.get("/v1/payments/account-title")
def payment_account_title(alias: str = Query(...)) -> dict[str, Any]:
    """Payout account title lookup used by the ``PAYOUT_NAME_MISMATCH`` check."""
    title = account_title_for(alias)
    return {
        "simulated": True,
        "alias": alias,
        "account_title": title,
        "found": title is not None,
        "dormant": is_dormant_alias(alias),
    }


@router.post("/v1/payments/transfer", status_code=201)
def payment_transfer(
    payload: TransferRequest = Body(...),
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
) -> dict[str, Any]:
    """Idempotent Raast-like transfer.

    Replaying an ``Idempotency-Key`` returns the **exact** prior result, so a
    ``FLAKY`` payment service can be retried without ever double-paying.
    """
    if not idempotency_key:
        raise HTTPException(
            status_code=400,
            detail={
                "simulated": True,
                "error": "MISSING_IDEMPOTENCY_KEY",
                "detail": "Idempotency-Key header is required",
            },
        )

    db = _session()
    try:
        existing = db.get(MockPayment, idempotency_key)
        if existing is not None:
            return _payment_payload(existing, replay=True)

        alias = payload.payout_alias.strip()
        title = account_title_for(alias)
        if is_dormant_alias(alias):
            status, failure_reason = "FAILED", "ACCOUNT_DORMANT"
        else:
            status, failure_reason = "COMPLETED", None

        count = db.scalar(select(func.count()).select_from(MockPayment)) or 0
        payment_ref = f"RAAST-{99000 + int(count) + 1}"
        row = MockPayment(
            idempotency_key=idempotency_key,
            payment_ref=payment_ref,
            payout_alias=alias,
            account_title=title,
            amount_pkr=payload.amount_pkr,
            status=status,
            failure_reason=failure_reason,
            created_at=datetime.now(UTC),
        )
        db.add(row)
        db.commit()
        db.refresh(row)
        return _payment_payload(row, replay=False)
    finally:
        db.close()


@router.get("/v1/payments/{payment_ref}")
def payment_status(payment_ref: str) -> dict[str, Any]:
    db = _session()
    try:
        row = db.scalars(
            select(MockPayment).where(MockPayment.payment_ref == payment_ref)
        ).first()
        if row is None:
            raise HTTPException(
                status_code=404,
                detail={"simulated": True, "error": "PAYMENT_NOT_FOUND", "payment_ref": payment_ref},
            )
        return _payment_payload(row, replay=False)
    finally:
        db.close()


# --------------------------------------------------------------------------- #
# F. Public complaint registry (simulated)
# --------------------------------------------------------------------------- #
@router.post("/v1/complaints", status_code=201)
def register_complaint(payload: ComplaintRequest = Body(...)) -> dict[str, Any]:
    db = _session()
    try:
        count = db.scalar(select(func.count()).select_from(MockComplaint)) or 0
        external_ref = f"CMP-2026-{400 + int(count) + 1:05d}"
        row = MockComplaint(
            external_ref=external_ref,
            payment_ref=payload.payment_ref,
            citizen_cnic=_digits(payload.citizen_cnic) or None,
            reason=payload.reason,
            status="REGISTERED",
            created_at=datetime.now(UTC),
        )
        db.add(row)
        db.commit()
        return {
            "simulated": True,
            "complaint_ref": external_ref,
            "status": "REGISTERED",
            "payment_ref": payload.payment_ref,
        }
    finally:
        db.close()


# --------------------------------------------------------------------------- #
# G. Simulated SMS inbox (powers the Device Simulator panel)
# --------------------------------------------------------------------------- #
@router.get("/v1/sms/inbox/{phone}")
def sms_inbox(phone: str) -> dict[str, Any]:
    """Newest-first simulated SMS inbox for ``phone``.

    Reads the ``notifications`` rows BE writes (channel ``SMS_SIMULATED``) and
    the OTP SMS bodies it stores there - OTP codes arrive inside the body text,
    never from ``otp_challenges.code_hash``.
    """
    model = _notification_model()
    if model is None:  # pragma: no cover - only before A1's models land
        return {"simulated": True, "phone": phone, "messages": [], "note": "notifications model unavailable"}

    db = _session()
    try:
        rows = db.scalars(
            select(model)
            .where(model.phone == phone)
            .order_by(model.created_at.desc())
            .limit(50)
        ).all()
        messages: list[dict[str, Any]] = []
        for row in rows:
            body = f"{getattr(row, 'title_en', '')} {getattr(row, 'body_en', '')}".lower()
            messages.append(
                {
                    "id": str(getattr(row, "id", "")),
                    "kind": "OTP" if ("otp" in body or "رمز" in body) else "NOTIFICATION",
                    "channel": getattr(row, "channel", None),
                    "title_ur": getattr(row, "title_ur", None),
                    "title_en": getattr(row, "title_en", None),
                    "body_ur": getattr(row, "body_ur", None),
                    "body_en": getattr(row, "body_en", None),
                    "verification_code": getattr(row, "verification_code", None),
                    "case_id": str(row.case_id) if getattr(row, "case_id", None) else None,
                    "created_at": _iso(getattr(row, "created_at", None)),
                    "read_at": _iso(getattr(row, "read_at", None)),
                }
            )
        return {"simulated": True, "phone": phone, "messages": messages}
    finally:
        db.close()


def _iter_services() -> Iterable[str]:
    return ("identity", "civil", "household", "benefits", "payment", "complaint", "sms")


__all__ = ["DETERMINISTIC_FAILURE_ALIAS", "router"]
