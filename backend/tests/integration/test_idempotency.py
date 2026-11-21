"""Idempotent offline mutations - docs/05 §1, docs/13 §1.

A citizen on a flaky connection retries; the server must not create two
applications. Same ``Idempotency-Key`` + same body replays the exact cached
status and body. Same key + different body is ``409 IDEMPOTENCY_CONFLICT``.
"""

from __future__ import annotations

import uuid
from typing import Any

import pytest
from sqlalchemy import delete, func, select

from app.models.cases import Case
from app.models.jobs import IdempotencyKey
from app.models.programs import Program


def _code(response: Any) -> str | None:
    try:
        return (response.json().get("error") or {}).get("code")
    except ValueError:  # pragma: no cover - defensive
        return None


@pytest.fixture()
def program_id(db: Any) -> uuid.UUID:
    value = db.execute(select(Program.id).limit(1)).scalar_one_or_none()
    assert value is not None, "the seeded world has no program"
    return value


@pytest.fixture()
def cleanup_cases(db: Any):
    """Delete the cases a test created, so the seeded world stays stable."""
    created: list[uuid.UUID] = []
    yield created
    db.rollback()
    if created:
        db.execute(delete(Case).where(Case.id.in_(created)))
        db.commit()


def _create_case(
    client: Any, headers: dict[str, str], program_id: uuid.UUID, key: str | None
) -> Any:
    request_headers = dict(headers)
    if key is not None:
        request_headers["Idempotency-Key"] = key
    return client.post(
        "/api/v1/cases",
        headers=request_headers,
        json={"program_id": str(program_id), "case_type": "BENEFIT_APPLICATION"},
    )


def test_replaying_the_same_key_returns_the_same_case(
    client: Any, db: Any, citizen_headers: dict[str, str], program_id: uuid.UUID,
    cleanup_cases: list[uuid.UUID], unique_key: str,
) -> None:
    first = _create_case(client, citizen_headers, program_id, unique_key)
    assert first.status_code == 201, first.text
    cleanup_cases.append(uuid.UUID(first.json()["id"]))

    for attempt in range(2, 5):
        replay = _create_case(client, citizen_headers, program_id, unique_key)
        assert replay.status_code == 201, f"replay {attempt}: {replay.text}"
        assert replay.json() == first.json(), f"replay {attempt} returned a different body"

    db.rollback()
    count = db.execute(
        select(func.count()).select_from(Case).where(Case.id == cleanup_cases[0])
    ).scalar_one()
    assert count == 1


def test_replays_do_not_create_extra_rows(
    client: Any, db: Any, citizen_headers: dict[str, str], program_id: uuid.UUID,
    cleanup_cases: list[uuid.UUID], unique_key: str,
) -> None:
    before = db.execute(select(func.count()).select_from(Case)).scalar_one()

    first = _create_case(client, citizen_headers, program_id, unique_key)
    assert first.status_code == 201, first.text
    cleanup_cases.append(uuid.UUID(first.json()["id"]))
    for _ in range(3):
        _create_case(client, citizen_headers, program_id, unique_key)

    db.rollback()
    after = db.execute(select(func.count()).select_from(Case)).scalar_one()
    assert after == before + 1, f"{after - before} cases created instead of 1"


def test_same_key_with_a_different_body_is_a_conflict(
    client: Any, db: Any, citizen_headers: dict[str, str], program_id: uuid.UUID,
    cleanup_cases: list[uuid.UUID], unique_key: str,
) -> None:
    first = _create_case(client, citizen_headers, program_id, unique_key)
    assert first.status_code == 201, first.text
    cleanup_cases.append(uuid.UUID(first.json()["id"]))

    conflicting = client.post(
        "/api/v1/cases",
        headers={**citizen_headers, "Idempotency-Key": unique_key},
        json={"program_id": str(program_id), "case_type": "COMPLAINT"},
    )
    assert conflicting.status_code == 409, conflicting.text
    assert _code(conflicting) == "IDEMPOTENCY_CONFLICT"


def test_a_different_key_creates_a_second_case(
    client: Any, db: Any, citizen_headers: dict[str, str], program_id: uuid.UUID,
    cleanup_cases: list[uuid.UUID],
) -> None:
    first = _create_case(client, citizen_headers, program_id, f"idem-{uuid.uuid4().hex}")
    second = _create_case(client, citizen_headers, program_id, f"idem-{uuid.uuid4().hex}")
    assert first.status_code == 201, first.text
    assert second.status_code == 201, second.text
    cleanup_cases.extend([uuid.UUID(first.json()["id"]), uuid.UUID(second.json()["id"])])
    assert first.json()["id"] != second.json()["id"]


def test_no_key_means_no_caching(
    client: Any, db: Any, citizen_headers: dict[str, str], program_id: uuid.UUID,
    cleanup_cases: list[uuid.UUID],
) -> None:
    first = _create_case(client, citizen_headers, program_id, None)
    second = _create_case(client, citizen_headers, program_id, None)
    assert first.status_code == 201, first.text
    assert second.status_code == 201, second.text
    cleanup_cases.extend([uuid.UUID(first.json()["id"]), uuid.UUID(second.json()["id"])])
    assert first.json()["id"] != second.json()["id"]


def test_a_rolled_back_mutation_leaves_no_cached_response(
    client: Any, db: Any, citizen_headers: dict[str, str], unique_key: str,
) -> None:
    """A rejected request must not poison the key for a later valid one."""
    rejected = client.post(
        "/api/v1/cases",
        headers={**citizen_headers, "Idempotency-Key": unique_key},
        json={"case_type": "BENEFIT_APPLICATION"},
    )
    assert rejected.status_code == 400, rejected.text

    db.rollback()
    cached = db.execute(
        select(IdempotencyKey).where(IdempotencyKey.key == unique_key)
    ).scalar_one_or_none()
    assert cached is None, "a failed request cached a response"


def test_draft_patch_is_idempotent(
    client: Any, db: Any, citizen_headers: dict[str, str], program_id: uuid.UUID,
    cleanup_cases: list[uuid.UUID], unique_key: str,
) -> None:
    created = _create_case(client, citizen_headers, program_id, None)
    assert created.status_code == 201, created.text
    case_id = created.json()["id"]
    cleanup_cases.append(uuid.UUID(case_id))

    body = {
        "wizard_step": "identity",
        "answers": {"applicant_full_name": {"value": "Fatima Bibi", "confirmed": True}},
    }
    headers = {**citizen_headers, "Idempotency-Key": unique_key}
    first = client.patch(f"/api/v1/cases/{case_id}/draft", headers=headers, json=body)
    assert first.status_code == 200, first.text

    second = client.patch(f"/api/v1/cases/{case_id}/draft", headers=headers, json=body)
    assert second.status_code == 200, second.text
    assert second.json() == first.json()

    conflict = client.patch(
        f"/api/v1/cases/{case_id}/draft",
        headers=headers,
        json={**body, "wizard_step": "household"},
    )
    assert conflict.status_code == 409, conflict.text
    assert _code(conflict) == "IDEMPOTENCY_CONFLICT"
