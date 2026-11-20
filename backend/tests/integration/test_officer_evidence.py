"""docs/05 §3.2: an officer reviewing a case gets the full facts and the rule trace.

Both live on the append-only ``decisions`` row — ``input_snapshot_json`` holds the
tri-state canonical facts the engine actually saw, ``rule_trace_json`` the per-rule
outcome. The officer endpoints returned neither, so an officer could see a
confidence number and a route action but not the evidence behind them: an override
would have been unauditable.

Nothing is recomputed here. The officer sees exactly what the engine decided on.
"""

from __future__ import annotations

import importlib
from pathlib import Path
from typing import Any

import pytest

BACKEND_ROOT = Path(__file__).resolve().parents[2]

FATIMA_CNIC = "9990010000012"
FATIMA_PHONE = "+923001000001"
FATIMA_CARD_NAME = "Fatima Bibi"
FATIMA_DOB = "1974-05-14"
FATIMA_CHILDREN = 3
FATIMA_HOUSEHOLD_SIZE = 4
FATIMA_INCOME_PKR = 28_000
PROGRAM_CODE = "SAHARA_WIDOW_GRANT"
TENANT_CODE = "SPD"


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _demo_login(client: Any, persona_key: str) -> str:
    response = client.post("/api/v1/auth/demo-login", json={"persona_key": persona_key})
    assert response.status_code == 200, response.text
    return str(response.json()["access_token"])


def _grant_department_consent(client: Any, token: str, tenant_id: Any) -> None:
    grants = client.get("/api/v1/consent/grants", headers=_auth(token))
    assert grants.status_code == 200, grants.text
    payload = grants.json()
    items = payload.get("grants", []) if isinstance(payload, dict) else payload
    for grant in items:
        if (
            grant.get("recipient_type") == "DEPARTMENT"
            and grant.get("status") == "ACTIVE"
            and str(grant.get("recipient_tenant_id")) == str(tenant_id)
        ):
            return
    created = client.post(
        "/api/v1/consent/grants",
        headers=_auth(token),
        json={
            "recipient_type": "DEPARTMENT",
            "recipient_tenant_id": str(tenant_id),
            "categories": ["IDENTITY", "HOUSEHOLD", "DOCUMENTS", "CASE_HISTORY"],
            "purposes": ["BENEFIT_APPLICATION"],
            "assurance_level": "SELF_OTP",
        },
    )
    assert created.status_code in (200, 201), created.text


def _upload(client: Any, token: str, case_id: str, doc_type: str, filename: str) -> None:
    path = BACKEND_ROOT / "app" / "data" / "demo_docs" / filename
    assert path.exists(), f"demo document missing: {path}"
    with path.open("rb") as handle:
        response = client.post(
            "/api/v1/documents",
            headers=_auth(token),
            files={"file": (filename, handle, "image/jpeg")},
            data={"doc_type": doc_type, "case_id": case_id},
        )
    assert response.status_code in (200, 201), response.text


def _submit_application(client: Any, token: str, program_id: str, tenant_id: Any) -> str:
    _grant_department_consent(client, token, tenant_id)

    created = client.post(
        "/api/v1/cases",
        headers=_auth(token),
        json={"program_id": program_id, "case_type": "BENEFIT_APPLICATION"},
    )
    assert created.status_code in (200, 201), created.text
    case_id = str(created.json()["id"])

    answers = {
        "applicant_cnic": {"value": FATIMA_CNIC, "confirmed": True},
        "applicant_full_name": {"value": FATIMA_CARD_NAME, "confirmed": True},
        "applicant_dob": {"value": FATIMA_DOB, "confirmed": True},
        "applicant_district": {"value": "Thatta", "confirmed": True},
        "spouse_full_name": {"value": "Ghulam Rasool", "confirmed": True},
        "children_under_18": {"value": FATIMA_CHILDREN, "confirmed": True},
        "household_size": {"value": FATIMA_HOUSEHOLD_SIZE, "confirmed": True},
        "monthly_income_pkr": {"value": FATIMA_INCOME_PKR, "confirmed": True},
        "payout_phone": {"value": FATIMA_PHONE, "confirmed": True},
    }
    saved = client.patch(
        f"/api/v1/cases/{case_id}/draft",
        headers=_auth(token),
        json={"wizard_step": "review", "answers": answers},
    )
    assert saved.status_code == 200, saved.text

    _upload(client, token, case_id, "CNIC_FRONT", "fatima_cnic_genuine.jpg")
    _upload(
        client, token, case_id, "SPOUSE_DEATH_CERTIFICATE", "ghulam_rasool_death_cert_genuine.jpg"
    )

    submitted = client.post(f"/api/v1/cases/{case_id}/submit", headers=_auth(token))
    assert submitted.status_code == 200, submitted.text
    return case_id


def _drain(db: Any, *, rounds: int = 50) -> None:
    """Run every due job synchronously, through the same path the worker uses."""
    queue = importlib.import_module("app.jobs.queue")
    handlers = importlib.import_module("app.jobs.handlers")

    for _ in range(rounds):
        job = queue.claim_job(db)
        if job is None:
            return
        payload = dict(job.payload_json or {})
        try:
            result = handlers.run_handler(db, job.job_type, payload)
        except Exception as exc:  # noqa: BLE001 - mirror the worker's failure path
            queue.mark_failed(db, job, f"{type(exc).__name__}: {exc}")
        else:
            queue.mark_completed(db, job, result=result if isinstance(result, dict) else None)


@pytest.fixture()
def decided_case(
    client: Any, db: Any, seeded_ids: dict[str, Any], in_process_mocks: None
) -> str:
    """Fatima's application, run through the real pipeline so a decision exists."""
    queue = importlib.import_module("app.jobs.queue")
    handlers = importlib.import_module("app.jobs.handlers")

    # Other modules leave payment jobs behind; clear them so the claim below is ours.
    _drain(db)

    token = _demo_login(client, "widow_fatima")
    case_id = _submit_application(
        client, token, str(seeded_ids["programs"][PROGRAM_CODE]), seeded_ids["tenants"][TENANT_CODE]
    )

    job = queue.claim_job(db)
    assert job is not None, "submit enqueued no job"
    assert job.job_type == "PROCESS_CASE", job.job_type
    assert str((job.payload_json or {}).get("case_id")) == case_id
    result = handlers.run_handler(db, job.job_type, dict(job.payload_json or {}))
    queue.mark_completed(db, job, result=result if isinstance(result, dict) else None)
    db.commit()

    # Let the payment leg finish so the case reaches its terminal demo state.
    _drain(db)
    return case_id


def test_officer_case_file_carries_facts_and_rule_trace(
    client: Any, db: Any, officer_headers: dict[str, str], decided_case: str
) -> None:
    models = importlib.import_module("app.models")

    response = client.get(f"/api/v1/officer/cases/{decided_case}", headers=officer_headers)
    assert response.status_code == 200, response.text
    body = response.json()

    assert "facts" in body, "docs/05 §3.2: the officer gets the full facts"
    assert "rule_trace" in body, "docs/05 §3.2: the officer gets the rule trace"
    assert body["facts"], "the facts snapshot must not be empty for a decided case"
    assert body["rule_trace"], "the rule trace must not be empty for a decided case"

    # The facts are the tri-state canonical facts, not a flattened summary.
    assert body["facts"]["applicant_cnic"]["value"] == FATIMA_CNIC
    assert body["facts"]["applicant_cnic"]["state"] == "KNOWN"

    # Every trace entry names the rule, the fact it read and its outcome.
    for entry in body["rule_trace"]:
        assert {"rule_id", "fact", "op", "result", "fact_state"} <= set(entry)

    # And they are byte-identical to what the engine persisted — nothing recomputed.
    decision = db.get(models.Decision, body["latest_decision_id"])
    assert decision is not None
    assert body["facts"] == decision.input_snapshot_json
    assert body["rule_trace"] == decision.rule_trace_json


def test_citizen_case_view_does_not_leak_the_evidence_trail(
    client: Any, citizen_headers: dict[str, str], decided_case: str
) -> None:
    """The same fields are officer/auditor-only; a citizen must not see the trace."""
    response = client.get(f"/api/v1/cases/{decided_case}", headers=citizen_headers)
    assert response.status_code == 200, response.text
    body = response.json()

    assert "rule_trace" not in body
    assert "facts" not in body
    assert "latest_decision" not in body


def test_officer_case_view_of_the_same_case_does_carry_them(
    client: Any, officer_headers: dict[str, str], decided_case: str
) -> None:
    """``GET /cases/{id}`` is role-tailored: the officer branch gets the evidence."""
    response = client.get(f"/api/v1/cases/{decided_case}", headers=officer_headers)
    assert response.status_code == 200, response.text
    body = response.json()

    assert body["facts"]
    assert body["rule_trace"]
    assert body["latest_decision"]["route_action"] in {
        "AUTO_APPROVE",
        "HUMAN_REVIEW",
        "ASK_MORE_INFO",
        "WAIT_EXTERNAL",
    }
