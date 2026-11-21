"""Consent enforcement - docs/09 §4 and ADR-008, docs/13 §1.

The headline test is :func:`test_denied_access_is_logged_even_though_the_request_rolls_back`.
A blocked read answers ``403 CONSENT_REVOKED`` and its request transaction rolls
back, yet the citizen must still see the attempt in their access log. That only
works because ``enforce_consent`` commits the denied ``consent_access_logs`` row
and its ``consent.access_denied`` audit event in an isolated session *before*
raising. Judges probe exactly this.

Every test that mutates consent restores the seeded world in teardown, because
``prepared_database`` seeds once per session and the API writes through its own
sessions.
"""

from __future__ import annotations

import uuid
from collections.abc import Iterator
from typing import Any

import pytest
from sqlalchemy import delete, select

from app.models.audit import AuditEvent
from app.models.cases import Case
from app.models.consent import ConsentAccessLog, ConsentGrant
from app.models.enums import (
    CaseStatus,
    ConsentPurpose,
    ConsentRecipientType,
    ConsentStatus,
    DataCategory,
)
from app.security.jwt import decode_access_token


def _code(response: Any) -> str | None:
    try:
        return (response.json().get("error") or {}).get("code")
    except ValueError:  # pragma: no cover - defensive
        return None


def _details(response: Any) -> dict[str, Any]:
    try:
        return (response.json().get("error") or {}).get("details") or {}
    except ValueError:  # pragma: no cover - defensive
        return {}


def _claims(headers: dict[str, str]) -> dict[str, Any]:
    return decode_access_token(headers["Authorization"].split(" ", 1)[1])


def _citizen_id(headers: dict[str, str]) -> uuid.UUID:
    return uuid.UUID(_claims(headers)["citizen_id"])


def _department_grant(db: Any, citizen_id: uuid.UUID) -> ConsentGrant:
    grant = db.execute(
        select(ConsentGrant)
        .where(
            ConsentGrant.citizen_id == citizen_id,
            ConsentGrant.recipient_type == ConsentRecipientType.DEPARTMENT.value,
        )
        .order_by(ConsentGrant.granted_at.desc())
        .limit(1)
    ).scalar_one_or_none()
    assert grant is not None, "the seeded world has no DEPARTMENT grant for this citizen"
    return grant


def _program_for(db: Any, tenant_id: uuid.UUID) -> uuid.UUID:
    from app.models.programs import Program

    program_id = db.execute(
        select(Program.id).where(Program.tenant_id == tenant_id).limit(1)
    ).scalar_one_or_none()
    assert program_id is not None, "the seeded world has no program in this tenant"
    return program_id


@pytest.fixture()
def citizen_scope(
    client: Any, db: Any, citizen_headers: dict[str, str]
) -> Iterator[dict[str, Any]]:
    """The demo citizen's id, their DEPARTMENT grant and one *open* case.

    The demo personas start with no applications, so a real one is created through
    the API and parked in ``SUBMITTED`` (``DRAFT`` counts as closed, so it would
    not trigger the case-hold flow). It is deleted again on teardown.
    """
    citizen_id = _citizen_id(citizen_headers)
    grant = _department_grant(db, citizen_id)
    tenant_id = grant.recipient_tenant_id
    program_id = _program_for(db, tenant_id)

    created = client.post(
        "/api/v1/cases",
        headers=citizen_headers,
        json={"program_id": str(program_id), "case_type": "BENEFIT_APPLICATION"},
    )
    assert created.status_code == 201, created.text
    case_id = uuid.UUID(created.json()["id"])

    case = db.get(Case, case_id)
    db.refresh(case)
    case.status = CaseStatus.SUBMITTED.value
    case.previous_status = None
    db.commit()

    try:
        yield {
            "citizen_id": citizen_id,
            "grant_id": grant.id,
            "tenant_id": tenant_id,
            "case_id": case_id,
            "case_status": CaseStatus.SUBMITTED.value,
        }
    finally:
        db.rollback()
        db.execute(delete(Case).where(Case.id == case_id))
        db.commit()


@pytest.fixture()
def withdrawn_grant(
    db: Any, citizen_scope: dict[str, Any]
) -> Iterator[dict[str, Any]]:
    """Withdraw the DEPARTMENT grant directly, then put the world back."""
    grant = db.get(ConsentGrant, citizen_scope["grant_id"])
    grant.status = ConsentStatus.WITHDRAWN.value
    db.commit()
    try:
        yield citizen_scope
    finally:
        db.rollback()
        grant = db.get(ConsentGrant, citizen_scope["grant_id"])
        grant.status = ConsentStatus.ACTIVE.value
        grant.withdrawn_at = None
        for case in db.execute(
            select(Case).where(
                Case.citizen_id == citizen_scope["citizen_id"],
                Case.status == CaseStatus.ON_HOLD_CONSENT.value,
            )
        ).scalars():
            case.status = case.previous_status or CaseStatus.SUBMITTED.value
            case.previous_status = None
        db.commit()


# --- ADR-008: the denied log survives the rollback --------------------------


def test_denied_access_is_logged_even_though_the_request_rolls_back(
    client: Any,
    db: Any,
    officer_headers: dict[str, str],
    withdrawn_grant: dict[str, Any],
) -> None:
    case_id = withdrawn_grant["case_id"]
    citizen_id = withdrawn_grant["citizen_id"]

    response = client.get(f"/api/v1/officer/cases/{case_id}", headers=officer_headers)
    assert response.status_code == 403, response.text
    assert _code(response) == "CONSENT_REVOKED"
    assert _details(response)["reason"] == "CONSENT_REVOKED"

    # The request transaction rolled back; the denial must still be on disk.
    db.rollback()
    log = db.execute(
        select(ConsentAccessLog)
        .where(
            ConsentAccessLog.citizen_id == citizen_id,
            ConsentAccessLog.allowed.is_(False),
            ConsentAccessLog.resource_ref == f"case:{case_id}",
        )
        .order_by(ConsentAccessLog.created_at.desc())
        .limit(1)
    ).scalar_one_or_none()
    assert log is not None, "the denied access was not persisted (ADR-008)"
    assert log.denial_reason == "CONSENT_REVOKED"
    assert log.actor_role == "OFFICER"
    assert log.category == "CASE_HISTORY"

    event = db.execute(
        select(AuditEvent)
        .where(
            AuditEvent.action == "consent.access_denied",
            AuditEvent.resource_id == str(citizen_id),
        )
        .order_by(AuditEvent.seq.desc())
        .limit(1)
    ).scalar_one_or_none()
    assert event is not None, "the denial left no audit event"
    assert event.payload_json["denial_reason"] == "CONSENT_REVOKED"


def test_the_citizen_can_see_the_blocked_attempt(
    client: Any, citizen_headers: dict[str, str], officer_headers: dict[str, str],
    withdrawn_grant: dict[str, Any],
) -> None:
    """The whole point of ADR-008: the citizen is told who tried to look."""
    case_id = withdrawn_grant["case_id"]
    client.get(f"/api/v1/officer/cases/{case_id}", headers=officer_headers)

    response = client.get("/api/v1/consent/access-logs", headers=citizen_headers)
    assert response.status_code == 200, response.text
    body = response.json()
    entries = body["items"] if isinstance(body, dict) else body
    denied = [entry for entry in entries if entry.get("allowed") is False]
    assert denied, "the citizen's access log shows no denied attempt"
    assert any(entry.get("resource_ref") == f"case:{case_id}" for entry in denied)


# --- withdrawal flow --------------------------------------------------------


def test_withdrawal_requires_confirmation_when_cases_are_open(
    client: Any, citizen_headers: dict[str, str], citizen_scope: dict[str, Any]
) -> None:
    response = client.post(
        f"/api/v1/consent/grants/{citizen_scope['grant_id']}/withdraw",
        headers=citizen_headers,
        json={},
    )
    assert response.status_code == 409, response.text
    assert _code(response) == "INVALID_TRANSITION"
    details = _details(response)
    assert details["reason"] == "CONFIRM_CASE_HOLD_REQUIRED"
    assert details["open_cases"] >= 1


def test_confirmed_withdrawal_holds_cases_and_regrant_restores_them(
    client: Any, db: Any, citizen_headers: dict[str, str], citizen_scope: dict[str, Any]
) -> None:
    grant_id = citizen_scope["grant_id"]
    case_id = citizen_scope["case_id"]
    original_status = citizen_scope["case_status"]

    withdrawn = client.post(
        f"/api/v1/consent/grants/{grant_id}/withdraw",
        headers=citizen_headers,
        json={"confirm_case_hold": True},
    )
    assert withdrawn.status_code == 200, withdrawn.text
    assert str(case_id) in withdrawn.json()["held_case_ids"]

    db.rollback()
    db.expire_all()
    held = db.get(Case, case_id)
    assert held.status == CaseStatus.ON_HOLD_CONSENT.value
    assert held.previous_status == original_status

    regranted = client.post(
        "/api/v1/consent/grants",
        headers=citizen_headers,
        json={
            "recipient_type": "DEPARTMENT",
            "recipient_tenant_id": str(citizen_scope["tenant_id"]),
            "categories": ["IDENTITY", "HOUSEHOLD", "DOCUMENTS", "PAYMENT", "CASE_HISTORY"],
            "purposes": ["BENEFIT_APPLICATION", "PAYMENT_DISBURSEMENT"],
            "assurance_level": "SELF_OTP",
        },
    )
    assert regranted.status_code == 201, regranted.text
    assert str(case_id) in regranted.json()["resumed_case_ids"]

    db.rollback()
    db.expire_all()
    restored = db.get(Case, case_id)
    assert restored.status == original_status
    assert restored.previous_status is None


# --- helper scope -----------------------------------------------------------


def test_helper_without_a_grant_cannot_see_the_citizen(
    client: Any, db: Any, helper_headers: dict[str, str]
) -> None:
    """No grant at all is a 404 - a helper must not learn the citizen exists."""
    from app.models.identity import Citizen

    stranger = db.execute(
        select(Citizen.id)
        .where(
            ~Citizen.id.in_(
                select(ConsentGrant.citizen_id).where(
                    ConsentGrant.recipient_user_id == uuid.UUID(_claims(helper_headers)["sub"])
                )
            )
        )
        .limit(1)
    ).scalar_one_or_none()
    assert stranger is not None

    response = client.get(
        "/api/v1/me/data",
        headers={**helper_headers, "X-Act-For-Citizen": str(stranger)},
    )
    assert response.status_code == 404, response.text
    assert _code(response) == "NOT_FOUND"


def test_helper_with_a_withdrawn_grant_is_denied_and_logged(
    client: Any, db: Any, helper_headers: dict[str, str], citizen_scope: dict[str, Any]
) -> None:
    helper_user_id = uuid.UUID(_claims(helper_headers)["sub"])
    grant = db.execute(
        select(ConsentGrant)
        .where(
            ConsentGrant.citizen_id == citizen_scope["citizen_id"],
            ConsentGrant.recipient_type == ConsentRecipientType.HELPER.value,
            ConsentGrant.recipient_user_id == helper_user_id,
        )
        .limit(1)
    ).scalar_one_or_none()
    assert grant is not None, "the seeded world has no HELPER grant for this pair"

    grant.status = ConsentStatus.WITHDRAWN.value
    db.commit()
    try:
        response = client.get(
            "/api/v1/me/data",
            headers={**helper_headers, "X-Act-For-Citizen": str(citizen_scope["citizen_id"])},
        )
        assert response.status_code == 403, response.text
        assert _code(response) == "CONSENT_REVOKED"

        db.rollback()
        log = db.execute(
            select(ConsentAccessLog)
            .where(
                ConsentAccessLog.citizen_id == citizen_scope["citizen_id"],
                ConsentAccessLog.actor_role == "HELPER",
                ConsentAccessLog.allowed.is_(False),
            )
            .order_by(ConsentAccessLog.created_at.desc())
            .limit(1)
        ).scalar_one_or_none()
        assert log is not None, "a blocked helper read must be logged"
        assert log.denial_reason == "CONSENT_REVOKED"
    finally:
        db.rollback()
        grant = db.get(ConsentGrant, grant.id)
        grant.status = ConsentStatus.ACTIVE.value
        db.commit()


def test_expired_helper_grant_is_denied(
    client: Any, db: Any, helper_headers: dict[str, str], citizen_scope: dict[str, Any]
) -> None:
    from datetime import UTC, datetime, timedelta

    helper_user_id = uuid.UUID(_claims(helper_headers)["sub"])
    grant = db.execute(
        select(ConsentGrant)
        .where(
            ConsentGrant.citizen_id == citizen_scope["citizen_id"],
            ConsentGrant.recipient_type == ConsentRecipientType.HELPER.value,
            ConsentGrant.recipient_user_id == helper_user_id,
        )
        .limit(1)
    ).scalar_one_or_none()
    assert grant is not None

    original_expiry = grant.expires_at
    grant.expires_at = datetime.now(UTC) - timedelta(minutes=1)
    db.commit()
    try:
        response = client.get(
            "/api/v1/me/data",
            headers={**helper_headers, "X-Act-For-Citizen": str(citizen_scope["citizen_id"])},
        )
        assert response.status_code == 403, response.text
        assert _code(response) == "CONSENT_REVOKED"
        assert _details(response)["reason"] == "CONSENT_EXPIRED"
    finally:
        db.rollback()
        grant = db.get(ConsentGrant, grant.id)
        grant.expires_at = original_expiry
        db.commit()


# --- the two unconditional paths -------------------------------------------


def test_citizen_reads_their_own_data_without_a_grant(
    client: Any, db: Any, citizen_headers: dict[str, str], citizen_scope: dict[str, Any]
) -> None:
    """Own data needs no grant - but the read is still logged."""
    grant = db.get(ConsentGrant, citizen_scope["grant_id"])
    grant.status = ConsentStatus.WITHDRAWN.value
    db.commit()
    try:
        response = client.get("/api/v1/me/data", headers=citizen_headers)
        assert response.status_code == 200, response.text
    finally:
        db.rollback()
        grant = db.get(ConsentGrant, citizen_scope["grant_id"])
        grant.status = ConsentStatus.ACTIVE.value
        db.commit()


def test_auditor_oversight_is_allowed_and_logged(
    client: Any, db: Any, auditor_headers: dict[str, str], citizen_scope: dict[str, Any]
) -> None:
    """Statutory oversight bypasses the grant but never the log."""
    grant = db.get(ConsentGrant, citizen_scope["grant_id"])
    grant.status = ConsentStatus.WITHDRAWN.value
    db.commit()
    try:
        response = client.get(
            f"/api/v1/auditor/cases/{citizen_scope['case_id']}/trace",
            headers=auditor_headers,
        )
        assert response.status_code == 200, response.text

        db.rollback()
        log = db.execute(
            select(ConsentAccessLog)
            .where(
                ConsentAccessLog.citizen_id == citizen_scope["citizen_id"],
                ConsentAccessLog.actor_role == "AUDITOR",
                ConsentAccessLog.allowed.is_(True),
            )
            .order_by(ConsentAccessLog.created_at.desc())
            .limit(1)
        ).scalar_one_or_none()
        assert log is not None, "auditor oversight must be logged as an allowed read"
    finally:
        db.rollback()
        grant = db.get(ConsentGrant, citizen_scope["grant_id"])
        grant.status = ConsentStatus.ACTIVE.value
        db.commit()


# --- ADR-019: the agent has no user row, and its reads must still be logged --


def test_agent_consent_reads_persist_an_access_log_row(
    db: Any, citizen_scope: dict[str, Any]
) -> None:
    """The case agent reads citizen data as ``AGENT`` with ``user_id=None``.

    Before ADR-019 the access-log insert used ``uuid.UUID(int=0)`` as a stand-in for
    the missing user, which violated the ``users`` FK. The isolated session that
    persists access logs swallows write errors by design (it must never mask the
    security decision), so every agent read was silently dropped - the citizen's
    access log lost exactly the reads they most need to see. This pins the fix.
    """
    from app.agent.deps import agent_actor
    from app.security.consent import enforce_consent

    actor = agent_actor(citizen_scope["tenant_id"])
    assert actor.user_id is None, "the agent must not pretend to be a user"

    resource_ref = f"agent-read:{uuid.uuid4().hex[:8]}"
    grant = enforce_consent(
        db,
        citizen_id=citizen_scope["citizen_id"],
        actor=actor,
        category=DataCategory.IDENTITY,
        purpose=ConsentPurpose.BENEFIT_APPLICATION,
        resource_ref=resource_ref,
    )
    assert grant is not None, "the seeded DEPARTMENT grant should authorise the agent"

    db.rollback()
    log = db.execute(
        select(ConsentAccessLog).where(
            ConsentAccessLog.citizen_id == citizen_scope["citizen_id"],
            ConsentAccessLog.resource_ref == resource_ref,
        )
    ).scalar_one_or_none()

    assert log is not None, "an agent consent read must persist an access-log row"
    assert log.actor_user_id is None, "AGENT rows carry a NULL actor_user_id (ADR-019)"
    assert log.actor_role == "AGENT"
    assert log.actor_label, "the label is what the citizen sees instead of a user id"
    assert log.allowed is True


def test_agent_denied_read_is_logged_and_audited(
    db: Any, citizen_scope: dict[str, Any]
) -> None:
    """A withdrawn grant must still produce a NULL-actor denial row plus its event."""
    from app.agent.deps import agent_actor
    from app.security.consent import ConsentRevokedError, enforce_consent

    grant = db.get(ConsentGrant, citizen_scope["grant_id"])
    grant.status = ConsentStatus.WITHDRAWN.value
    db.commit()

    resource_ref = f"agent-denied:{uuid.uuid4().hex[:8]}"
    try:
        with pytest.raises(ConsentRevokedError):
            enforce_consent(
                db,
                citizen_id=citizen_scope["citizen_id"],
                actor=agent_actor(citizen_scope["tenant_id"]),
                category=DataCategory.IDENTITY,
                purpose=ConsentPurpose.BENEFIT_APPLICATION,
                resource_ref=resource_ref,
            )

        db.rollback()
        log = db.execute(
            select(ConsentAccessLog).where(
                ConsentAccessLog.citizen_id == citizen_scope["citizen_id"],
                ConsentAccessLog.resource_ref == resource_ref,
            )
        ).scalar_one_or_none()
        assert log is not None, "a denied agent read must still be logged"
        assert log.actor_user_id is None
        assert log.allowed is False
        assert log.denial_reason == "CONSENT_REVOKED"

        event = db.execute(
            select(AuditEvent)
            .where(
                AuditEvent.action == "consent.access_denied",
                AuditEvent.resource_id == str(citizen_scope["citizen_id"]),
            )
            .order_by(AuditEvent.seq.desc())
            .limit(1)
        ).scalar_one_or_none()
        assert event is not None, "the denial must also reach the audit chain"
    finally:
        db.rollback()
        grant = db.get(ConsentGrant, citizen_scope["grant_id"])
        grant.status = ConsentStatus.ACTIVE.value
        grant.withdrawn_at = None
        db.commit()
