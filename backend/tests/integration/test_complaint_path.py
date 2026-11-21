"""F-09 - the "money not received" complaint path (docs/02 AC-09.3, docs/05 §3.2).

A complaint is only useful if three things happen: the case is linked to the
application it is about, the payment check is queued exactly once, and somebody
who can act on it is told. This suite pins all three, plus the two guards that
stop a complaint being filed against a case that has not been approved.
"""

from __future__ import annotations

import uuid
from typing import Any

import pytest
from sqlalchemy import select

CITIZEN_PHONE = "+923001000001"


def _fatima(db: Any) -> tuple[Any, Any]:
    from app.models.identity import Citizen, User

    citizen = db.execute(select(Citizen).where(Citizen.phone == CITIZEN_PHONE)).scalar_one()
    user = db.execute(select(User).where(User.phone == CITIZEN_PHONE)).scalar_one()
    return citizen, user


@pytest.fixture()
def paid_case(db: Any) -> Any:
    """A PAID application for Fatima, deleted afterwards."""
    from app.models.cases import Case
    from app.models.identity import Tenant
    from app.models.programs import Program

    citizen, user = _fatima(db)
    program = db.execute(
        select(Program).where(Program.code == "SAHARA_WIDOW_GRANT")
    ).scalar_one()
    tenant = db.execute(select(Tenant).where(Tenant.code == "SPD")).scalar_one()

    case = Case(
        reference_code=f"HQ-P{uuid.uuid4().hex[:10].upper()}",
        tenant_id=tenant.id,
        program_id=program.id,
        citizen_id=citizen.id,
        submitted_by_user_id=user.id,
        status="PAID",
        approved_amount_pkr=15000,
    )
    db.add(case)
    db.commit()

    yield case

    # Notifications and complaint cases both point at this row, so clear children first.
    from app.models.ai import Notification

    children = list(
        db.execute(select(Case).where(Case.parent_case_id == case.id)).scalars()
    )
    for child in children:
        for notification in db.execute(
            select(Notification).where(Notification.case_id == child.id)
        ).scalars():
            db.delete(notification)
        db.flush()
        db.delete(child)
    db.flush()
    row = db.get(Case, case.id)
    if row is not None:
        db.delete(row)
    db.commit()


def test_complaint_is_linked_to_the_application(
    client: Any, citizen_headers: dict[str, str], paid_case: Any
) -> None:
    response = client.post(
        f"/api/v1/cases/{paid_case.id}/complaint",
        headers=citizen_headers,
        json={"reason": "MONEY_NOT_RECEIVED"},
    )
    assert response.status_code == 201, response.text

    body = response.json()
    assert body["case_type"] == "COMPLAINT"
    assert body["parent_case_id"] == str(paid_case.id)
    assert body["reference_code"] != paid_case.reference_code


def test_complaint_enqueues_exactly_one_payment_check(
    client: Any, citizen_headers: dict[str, str], paid_case: Any, db: Any
) -> None:
    from app.models.jobs import Job

    response = client.post(
        f"/api/v1/cases/{paid_case.id}/complaint",
        headers=citizen_headers,
        json={"reason": "MONEY_NOT_RECEIVED"},
    )
    assert response.status_code == 201, response.text
    complaint_id = response.json()["id"]

    jobs = (
        db.execute(
            select(Job).where(
                Job.job_type == "CHECK_COMPLAINT",
                Job.dedup_key == f"CHECK_COMPLAINT:{complaint_id}",
            )
        )
        .scalars()
        .all()
    )
    assert len(jobs) == 1, f"expected one CHECK_COMPLAINT job, got {len(jobs)}"
    assert jobs[0].payload_json["case_id"] == complaint_id
    assert jobs[0].payload_json["parent_case_id"] == str(paid_case.id)


def test_complaint_notifies_the_citizen_and_every_officer(
    client: Any, citizen_headers: dict[str, str], paid_case: Any, db: Any
) -> None:
    from app.models.ai import Notification
    from app.models.identity import User

    response = client.post(
        f"/api/v1/cases/{paid_case.id}/complaint",
        headers=citizen_headers,
        json={"reason": "MONEY_NOT_RECEIVED"},
    )
    assert response.status_code == 201, response.text
    complaint_id = uuid.UUID(response.json()["id"])

    rows = (
        db.execute(select(Notification).where(Notification.case_id == complaint_id))
        .scalars()
        .all()
    )

    citizen_rows = [row for row in rows if row.citizen_id is not None]
    assert {row.channel for row in citizen_rows} == {"IN_APP", "SMS_SIMULATED"}

    # The simulated SMS carries a verifiable HQ code, so the scam checker can confirm it.
    sms = next(row for row in citizen_rows if row.channel == "SMS_SIMULATED")
    assert sms.verification_code.startswith("HQ-")
    assert sms.body_sha256
    assert sms.phone == CITIZEN_PHONE

    officers = (
        db.execute(
            select(User).where(
                User.tenant_id == paid_case.tenant_id,
                User.role == "OFFICER",
                User.is_active.is_(True),
            )
        )
        .scalars()
        .all()
    )
    officer_rows = [row for row in rows if row.user_id is not None]
    assert {row.user_id for row in officer_rows} == {officer.id for officer in officers}
    assert all(row.channel == "IN_APP" for row in officer_rows)


def test_open_complaint_appears_in_the_officer_queue(
    client: Any,
    citizen_headers: dict[str, str],
    officer_headers: dict[str, str],
    paid_case: Any,
) -> None:
    response = client.post(
        f"/api/v1/cases/{paid_case.id}/complaint",
        headers=citizen_headers,
        json={"reason": "MONEY_NOT_RECEIVED"},
    )
    assert response.status_code == 201, response.text
    complaint_id = response.json()["id"]

    queue = client.get("/api/v1/officer/queue", headers=officer_headers, params={"limit": 100})
    assert queue.status_code == 200, queue.text
    ids = {item["id"] for item in queue.json()["items"]}
    assert complaint_id in ids, "an open complaint must be visible to an officer"


def test_complaint_is_rejected_for_a_case_that_was_never_approved(
    client: Any, citizen_headers: dict[str, str], db: Any
) -> None:
    from app.models.cases import Case
    from app.models.identity import Tenant
    from app.models.programs import Program

    citizen, user = _fatima(db)
    program = db.execute(
        select(Program).where(Program.code == "SAHARA_WIDOW_GRANT")
    ).scalar_one()
    tenant = db.execute(select(Tenant).where(Tenant.code == "SPD")).scalar_one()

    draft = Case(
        reference_code=f"HQ-D{uuid.uuid4().hex[:10].upper()}",
        tenant_id=tenant.id,
        program_id=program.id,
        citizen_id=citizen.id,
        submitted_by_user_id=user.id,
        status="HUMAN_REVIEW",
    )
    db.add(draft)
    db.commit()

    try:
        response = client.post(
            f"/api/v1/cases/{draft.id}/complaint",
            headers=citizen_headers,
            json={"reason": "MONEY_NOT_RECEIVED"},
        )
        assert response.status_code == 400, response.text
        assert response.json()["error"]["code"] == "VALIDATION_ERROR"
    finally:
        row = db.get(Case, draft.id)
        if row is not None:
            db.delete(row)
        db.commit()


def test_complaint_replay_returns_the_same_case(
    client: Any, citizen_headers: dict[str, str], paid_case: Any
) -> None:
    """Idempotency-Key: a retried complaint must not file a second case."""
    key = f"complaint-{uuid.uuid4().hex[:12]}"
    headers = {**citizen_headers, "Idempotency-Key": key}

    first = client.post(
        f"/api/v1/cases/{paid_case.id}/complaint",
        headers=headers,
        json={"reason": "MONEY_NOT_RECEIVED"},
    )
    assert first.status_code == 201, first.text

    second = client.post(
        f"/api/v1/cases/{paid_case.id}/complaint",
        headers=headers,
        json={"reason": "MONEY_NOT_RECEIVED"},
    )
    assert second.status_code == 201, second.text
    assert second.json()["id"] == first.json()["id"]
