"""F-12 - my data and corrections (docs/02 AC-12.1, docs/05 §3.4).

Two behaviours matter here and both are easy to get subtly wrong:

* a **self-declared** field is applied immediately (the citizen is the authority on
  their own income), while a **registry-sourced** field can only be queued for an
  officer - we cannot edit a government registry;
* applying a self-declared correction must re-evaluate any case still being worked
  (AC-12.1), because the corrected fact can flip the outcome. A decided case must
  not be touched, and a queued registry correction must not re-evaluate anything
  until an officer accepts it.
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


def _make_case(db: Any, *, status: str) -> Any:
    """A case for Fatima in ``status``, committed so the API's session can see it."""
    from app.models.cases import Case
    from app.models.identity import Tenant
    from app.models.programs import Program

    citizen, user = _fatima(db)
    program = db.execute(
        select(Program).where(Program.code == "SAHARA_WIDOW_GRANT")
    ).scalar_one()
    tenant = db.execute(select(Tenant).where(Tenant.code == "SPD")).scalar_one()

    case = Case(
        reference_code=f"HQ-T{uuid.uuid4().hex[:10].upper()}",
        tenant_id=tenant.id,
        program_id=program.id,
        citizen_id=citizen.id,
        submitted_by_user_id=user.id,
        status=status,
    )
    db.add(case)
    db.commit()
    return case


@pytest.fixture()
def case_factory(db: Any) -> Any:
    """Create cases for Fatima and delete them again, whatever the test does."""
    from app.models.cases import Case

    created: list[uuid.UUID] = []

    def make(status: str) -> Any:
        case = _make_case(db, status=status)
        created.append(case.id)
        return case

    yield make

    for case_id in created:
        row = db.get(Case, case_id)
        if row is not None:
            db.delete(row)
    db.commit()


@pytest.fixture()
def reevaluation_calls(monkeypatch: pytest.MonkeyPatch) -> list[dict[str, Any]]:
    """Record re-evaluation requests instead of running the whole pipeline."""
    import app.agent.case_agent as case_agent

    calls: list[dict[str, Any]] = []

    def fake_reevaluate(db: Any, case_id: Any, *, officer_user_id: Any, reason: Any = None, **_: Any) -> dict[str, Any]:
        calls.append(
            {"case_id": case_id, "officer_user_id": officer_user_id, "reason": reason}
        )
        return {"case_id": str(case_id), "status": "NEEDS_INFO"}

    monkeypatch.setattr(case_agent, "reevaluate_case", fake_reevaluate)
    return calls


# --- the grouped self-data view --------------------------------------------


def test_my_data_groups_every_category_with_provenance(
    client: Any, citizen_headers: dict[str, str]
) -> None:
    response = client.get("/api/v1/me/data", headers=citizen_headers)
    assert response.status_code == 200, response.text

    body = response.json()
    for group in ("identity", "household", "case_history", "documents", "consents", "corrections"):
        assert group in body, f"{group} missing from /me/data"

    # Every identity value carries a source badge, and the CNIC is never raw.
    for key, entry in body["identity"].items():
        assert "source" in entry, f"{key} has no provenance badge"
    masked = body["identity"]["cnic_masked"]["value"]
    assert masked and "9990010000012" not in str(masked)
    assert "*" in str(masked)


def test_my_data_reports_the_household_facts_it_actually_holds(
    client: Any, citizen_headers: dict[str, str]
) -> None:
    """Regression: `/me/data` read `profile_data["household"]`, a nested key the
    seed never writes, so every citizen's household came back `{}`.

    An empty household is not a neutral answer - it reads as "we hold nothing
    about you", which is the opposite of the truth for a seeded citizen. The
    old test only asserted the group *existed*, which an empty dict satisfies.
    """
    response = client.get("/api/v1/me/data", headers=citizen_headers)
    assert response.status_code == 200, response.text

    household = response.json()["household"]
    assert household, "household is empty - the flat profile_data keys are not being read"

    # widow_fatima is seeded with all four canonical household facts.
    for key in ("children_under_18", "household_size", "monthly_income_pkr", "payout_phone"):
        assert key in household, f"{key} missing from household"

    assert household["household_size"]["state"] == "KNOWN"
    assert household["household_size"]["value"] == 4
    assert household["monthly_income_pkr"]["value"] == 28000
    assert household["household_size"]["source"] == "HOUSEHOLD_SURVEY"
    assert household["payout_phone"]["source"] == "SELF_DECLARED"


def test_my_data_states_unknown_rather_than_omitting_it(
    client: Any, persona_headers: Any
) -> None:
    """docs/04 §5 - `UNKNOWN` is a first-class value, and it says why.

    A fact the citizen never supplied must come back as `UNKNOWN` with a
    `missing_reason`, not as a zero, an empty string, or a missing row.

    `shopkeeper_rasool` is seeded with no household facts at all, so he is the
    case that actually exercises the branch - asserting over a citizen who has
    every value would pass without ever reaching an `UNKNOWN`.
    """
    response = client.get("/api/v1/me/data", headers=persona_headers("shopkeeper_rasool"))
    assert response.status_code == 200, response.text
    body = response.json()

    household = body["household"]
    assert household, "household is empty - the flat profile_data keys are not being read"

    unknown = {key: entry for key, entry in household.items() if entry["state"] == "UNKNOWN"}
    assert unknown, "a citizen with no household facts reported none as UNKNOWN"

    for key, entry in household.items():
        assert entry["state"] in {"KNOWN", "UNKNOWN"}, f"{key} has no tri-state"
        if entry["state"] == "KNOWN":
            assert entry["value"] is not None, f"{key} is KNOWN but has no value"
            assert entry["missing_reason"] is None, f"{key} is KNOWN but carries a reason"
        else:
            assert entry["value"] is None, f"{key} is UNKNOWN but carries a value"
            assert entry["source"] is None, f"{key} is UNKNOWN but claims a source"
            assert entry["missing_reason"], f"{key} is UNKNOWN but does not say why"


# --- corrections ------------------------------------------------------------


def test_self_declared_correction_is_applied_immediately(
    client: Any, citizen_headers: dict[str, str]
) -> None:
    response = client.post(
        "/api/v1/me/corrections",
        headers=citizen_headers,
        json={"field_key": "monthly_income_pkr", "requested_value": 25000, "reason": "survey was wrong"},
    )
    assert response.status_code == 201, response.text

    body = response.json()
    assert body["applied"] is True
    assert body["status"] == "APPLIED"
    assert body["source_type"] == "SELF_DECLARED"


def test_registry_sourced_correction_is_queued_for_an_officer(
    client: Any, citizen_headers: dict[str, str]
) -> None:
    response = client.post(
        "/api/v1/me/corrections",
        headers=citizen_headers,
        json={"field_key": "household_size", "requested_value": 5, "reason": "two children missed"},
    )
    assert response.status_code == 201, response.text

    body = response.json()
    assert body["applied"] is False
    assert body["status"] == "PENDING_OFFICER"
    assert body["source_type"] == "REGISTRY"


def test_unknown_fact_key_is_rejected(
    client: Any, citizen_headers: dict[str, str]
) -> None:
    response = client.post(
        "/api/v1/me/corrections",
        headers=citizen_headers,
        json={"field_key": "consent_method", "requested_value": "x"},
    )
    assert response.status_code == 400, response.text
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"


# --- AC-12.1: re-evaluation ------------------------------------------------


def test_correction_reevaluates_a_case_in_needs_info(
    client: Any,
    citizen_headers: dict[str, str],
    case_factory: Any,
    reevaluation_calls: list[dict[str, Any]],
) -> None:
    case = case_factory("NEEDS_INFO")

    response = client.post(
        "/api/v1/me/corrections",
        headers=citizen_headers,
        json={"field_key": "monthly_income_pkr", "requested_value": 18000},
    )
    assert response.status_code == 201, response.text

    assert len(reevaluation_calls) == 1, reevaluation_calls
    call = reevaluation_calls[0]
    assert call["case_id"] == case.id
    # A citizen triggered this, so there is no officer to attribute it to.
    assert call["officer_user_id"] is None
    assert "monthly_income_pkr" in (call["reason"] or "")

    reported = response.json()["reevaluated_cases"]
    assert [row["reference_code"] for row in reported] == [case.reference_code]
    assert reported[0]["reevaluated"] is True


def test_correction_reevaluates_a_case_in_in_review(
    client: Any,
    citizen_headers: dict[str, str],
    case_factory: Any,
    reevaluation_calls: list[dict[str, Any]],
) -> None:
    case = case_factory("IN_REVIEW")

    response = client.post(
        "/api/v1/me/corrections",
        headers=citizen_headers,
        json={"field_key": "children_under_18", "requested_value": 3},
    )
    assert response.status_code == 201, response.text
    assert [call["case_id"] for call in reevaluation_calls] == [case.id]


def test_correction_does_not_reevaluate_a_decided_case(
    client: Any,
    citizen_headers: dict[str, str],
    case_factory: Any,
    reevaluation_calls: list[dict[str, Any]],
) -> None:
    case_factory("APPROVED")

    response = client.post(
        "/api/v1/me/corrections",
        headers=citizen_headers,
        json={"field_key": "monthly_income_pkr", "requested_value": 30000},
    )
    assert response.status_code == 201, response.text
    assert reevaluation_calls == []
    assert response.json()["reevaluated_cases"] == []


def test_queued_registry_correction_does_not_reevaluate(
    client: Any,
    citizen_headers: dict[str, str],
    case_factory: Any,
    reevaluation_calls: list[dict[str, Any]],
) -> None:
    """Nothing has changed yet, so re-running the pipeline would be noise."""
    case_factory("NEEDS_INFO")

    response = client.post(
        "/api/v1/me/corrections",
        headers=citizen_headers,
        json={"field_key": "household_size", "requested_value": 6},
    )
    assert response.status_code == 201, response.text
    assert reevaluation_calls == []


def test_a_failing_reevaluation_never_fails_the_correction(
    client: Any,
    citizen_headers: dict[str, str],
    case_factory: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The citizen's correction is the intent; re-evaluation is a consequence."""
    import app.agent.case_agent as case_agent

    case = case_factory("NEEDS_INFO")

    def explode(*_: Any, **__: Any) -> Any:
        raise RuntimeError("mock registry is down")

    monkeypatch.setattr(case_agent, "reevaluate_case", explode)

    response = client.post(
        "/api/v1/me/corrections",
        headers=citizen_headers,
        json={"field_key": "monthly_income_pkr", "requested_value": 21000},
    )
    assert response.status_code == 201, response.text

    body = response.json()
    assert body["applied"] is True
    assert body["reevaluated_cases"] == [
        {
            "case_id": str(case.id),
            "reference_code": case.reference_code,
            "reevaluated": False,
            "reason": "REEVALUATION_FAILED",
        }
    ]
