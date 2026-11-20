"""D-1 regression: the job dispatcher must speak each handler's pinned signature.

The worker forwards a stored payload to ``run_handler``, which used to splat it
straight into the handler. Job payloads carry queue bookkeeping the handler has no
business knowing about — ``tenant_id`` (derivable from the case row),
``parent_case_id``, ``rule_version_id`` — so every ``PROCESS_CASE`` job died with
``TypeError: run_case_agent() got an unexpected keyword argument 'tenant_id'``.
The worker turned that into ``FAILED_RETRY``, so every case sat in ``SUBMITTED``
forever and the queue quietly filled with poison jobs.

Nothing caught it because the golden-path drill calls ``run_case_agent`` directly
and never crosses the dispatcher. These tests cross it:

* the normalizer keeps exactly the accepted keys, per job type;
* every payload shape actually enqueued in ``app/`` normalizes to arguments the
  real handler accepts (checked against ``inspect.signature``, so a future
  signature change fails here rather than in the queue);
* a submitted case driven end-to-end through ``run_handler`` leaves ``SUBMITTED``.
"""

from __future__ import annotations

import importlib
import inspect
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import httpx
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

#: ``(job_type, payload)`` exactly as the enqueue sites build them. Each entry names
#: the call site it mirrors so a drift in either direction is easy to trace.
ENQUEUED_PAYLOADS: tuple[tuple[str, dict[str, Any]], ...] = (
    # app/api/v1/cases.py:752
    ("PROCESS_CASE", {"case_id": "c", "tenant_id": "t"}),
    # app/security/consent.py:354
    ("PROCESS_CASE", {"case_id": "c"}),
    # app/api/v1/cases.py:992
    ("CHECK_COMPLAINT", {"case_id": "c", "parent_case_id": "p", "tenant_id": "t"}),
    # app/api/v1/documents.py:273
    ("VERIFY_DOCUMENT", {"document_id": "d", "case_id": "c", "tenant_id": "t"}),
    # app/api/v1/admin_rules.py:479
    ("REINDEX_RAG", {"program_id": "p", "rule_version_id": "r"}),
    # app/api/v1/officer.py:540
    ("INITIATE_PAYMENT", {"case_id": "c", "decision_id": "d", "tenant_id": "t"}),
    # app/agent/case_agent.py:537
    ("INITIATE_PAYMENT", {"case_id": "c", "decision_id": "d", "amount_pkr": 15_000}),
)


@pytest.fixture()
def handlers() -> Any:
    return importlib.import_module("app.jobs.handlers")


# -- the normalizer ------------------------------------------------------
def test_normalize_payload_keeps_only_the_accepted_keys(handlers: Any) -> None:
    assert handlers.normalize_payload(
        "PROCESS_CASE", {"case_id": "c", "tenant_id": "t", "correlation_id": "x"}
    ) == {"case_id": "c", "correlation_id": "x"}
    assert handlers.normalize_payload(
        "CHECK_COMPLAINT", {"case_id": "c", "parent_case_id": "p", "tenant_id": "t"}
    ) == {"case_id": "c"}
    assert handlers.normalize_payload(
        "VERIFY_DOCUMENT", {"document_id": "d", "case_id": "c", "tenant_id": "t"}
    ) == {"document_id": "d"}
    assert handlers.normalize_payload(
        "REINDEX_RAG", {"program_id": "p", "rule_version_id": "r"}
    ) == {"program_id": "p"}
    assert handlers.normalize_payload(
        "INITIATE_PAYMENT", {"case_id": "c", "decision_id": "d", "tenant_id": "t"}
    ) == {"case_id": "c", "decision_id": "d"}


def test_normalize_payload_tolerates_an_empty_payload(handlers: Any) -> None:
    assert handlers.normalize_payload("PROCESS_CASE", None) == {}
    assert handlers.normalize_payload("PROCESS_CASE", {}) == {}


def test_normalize_payload_leaves_unknown_job_types_alone(handlers: Any) -> None:
    """A future handler must not be silently starved of its arguments."""
    payload = {"anything": 1, "else": 2}
    assert handlers.normalize_payload("NOT_A_JOB_TYPE", payload) == payload


def test_client_is_never_forwarded_from_a_payload(handlers: Any) -> None:
    """``client`` is a test-only injection point; a JSONB payload could only hold a dict."""
    assert "client" not in handlers.HANDLER_PAYLOAD_KEYS["PROCESS_CASE"]
    assert handlers.normalize_payload(
        "PROCESS_CASE", {"case_id": "c", "client": {"not": "a client"}}
    ) == {"case_id": "c"}


# -- the contract that actually broke ------------------------------------
@pytest.mark.parametrize(("job_type", "payload"), ENQUEUED_PAYLOADS)
def test_every_enqueued_payload_matches_its_handler_signature(
    handlers: Any, job_type: str, payload: dict[str, Any]
) -> None:
    """Normalizing must yield arguments the real handler accepts — no more, no less."""
    handler = handlers.resolve_handler(job_type)
    accepted = {
        name
        for name, parameter in inspect.signature(handler).parameters.items()
        if parameter.kind
        in (inspect.Parameter.POSITIONAL_OR_KEYWORD, inspect.Parameter.KEYWORD_ONLY)
    }
    normalized = handlers.normalize_payload(job_type, payload)

    unexpected = set(normalized) - accepted
    assert not unexpected, (
        f"{job_type} would call {handler.__module__}.{handler.__name__} with "
        f"unexpected keyword(s) {sorted(unexpected)} — the worker would mark the job "
        f"FAILED_RETRY with a TypeError"
    )
    # The handler's first positional parameter is the session, which the dispatcher
    # supplies itself; everything else it needs must survive normalization.
    required = {
        name
        for name, parameter in inspect.signature(handler).parameters.items()
        if parameter.default is inspect.Parameter.empty
        and parameter.kind
        in (inspect.Parameter.POSITIONAL_OR_KEYWORD, inspect.Parameter.KEYWORD_ONLY)
    } - {"db"}
    assert required <= set(normalized), (
        f"{job_type} drops required argument(s) {sorted(required - set(normalized))}"
    )


def test_the_registry_covers_every_job_type(handlers: Any) -> None:
    enums = importlib.import_module("app.models.enums")
    assert set(handlers.HANDLER_REGISTRY) == {member.value for member in enums.JobType}
    assert set(handlers.HANDLER_PAYLOAD_KEYS) == set(handlers.HANDLER_REGISTRY)


def test_run_handler_normalizes_before_calling(
    handlers: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    """``run_handler`` is the seam the worker uses — it must filter, not splat."""
    seen: dict[str, Any] = {}

    def pinned(db: Any, case_id: str, *, correlation_id: str | None = None) -> str:
        seen.update({"db": db, "case_id": case_id, "correlation_id": correlation_id})
        return "ok"

    monkeypatch.setattr(handlers, "resolve_handler", lambda _job_type: pinned)
    result = handlers.run_handler(
        "sentinel-db", "PROCESS_CASE", {"case_id": "c", "tenant_id": "t"}
    )

    assert result == "ok"
    assert seen == {"db": "sentinel-db", "case_id": "c", "correlation_id": None}


# -- end to end through the dispatcher -----------------------------------
class _InProcessTransport(httpx.BaseTransport):
    """Route the agent's outbound mock calls back into the in-process ASGI app.

    ``MockClient`` speaks HTTP to ``MOCK_BASE_URL``; in a test the same routes are
    already mounted on the app under ``/mock``. Delegating to the ``TestClient``
    keeps the drill on the real client, the real retry policy and the real mock
    handlers without binding a port.
    """

    def __init__(self, test_client: Any) -> None:
        self._client = test_client

    def handle_request(self, request: httpx.Request) -> httpx.Response:
        response = self._client.request(
            request.method,
            request.url.path,
            params=request.url.params,
            headers=request.headers,
            content=request.read(),
        )
        return httpx.Response(
            response.status_code,
            headers=response.headers,
            content=response.content,
            request=request,
        )


@pytest.fixture()
def in_process_mocks(monkeypatch: pytest.MonkeyPatch, client: Any) -> Iterator[None]:
    """Point the case agent's ``MockClient`` at the in-process app."""
    case_agent = importlib.import_module("app.agent.case_agent")
    mock_client_module = importlib.import_module("app.agent.mock_client")
    transport = _InProcessTransport(client)

    def factory(base_url: str, **kwargs: Any) -> Any:
        kwargs.pop("transport", None)
        kwargs.pop("sleep", None)
        return mock_client_module.MockClient(
            base_url, transport=transport, sleep=lambda _seconds: None
        )

    monkeypatch.setattr(case_agent, "MockClient", factory)
    yield


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _demo_login(client: Any, persona_key: str) -> str:
    response = client.post("/api/v1/auth/demo-login", json={"persona_key": persona_key})
    assert response.status_code == 200, response.text
    return str(response.json()["access_token"])


def _ensure_department_consent(client: Any, token: str, tenant_id: Any) -> None:
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
            "categories": ["IDENTITY", "HOUSEHOLD", "DOCUMENTS"],
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
    _ensure_department_consent(client, token, tenant_id)

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


def test_process_case_job_leaves_submitted_through_the_dispatcher(
    client: Any, db: Any, seeded_ids: dict[str, Any], in_process_mocks: None
) -> None:
    """The exact path the worker takes: claim → ``run_handler`` → ``mark_completed``."""
    models = importlib.import_module("app.models")
    queue = importlib.import_module("app.jobs.queue")
    handlers = importlib.import_module("app.jobs.handlers")

    program_id = str(seeded_ids["programs"][PROGRAM_CODE])
    tenant_id = seeded_ids["tenants"][TENANT_CODE]

    token = _demo_login(client, "widow_fatima")
    case_id = _submit_application(client, token, program_id, tenant_id)

    case = db.get(models.Case, case_id)
    assert case is not None
    assert case.status == "SUBMITTED", "submit must leave the case queued for the agent"

    job = queue.claim_job(db)
    assert job is not None, "submit enqueued no job"
    assert job.job_type == "PROCESS_CASE"
    # The payload that used to poison the queue: queue bookkeeping the handler rejects.
    assert "tenant_id" in (job.payload_json or {}), (
        "this regression only bites when the payload carries tenant_id"
    )

    result = handlers.run_handler(db, job.job_type, dict(job.payload_json or {}))
    queue.mark_completed(db, job, result=result if isinstance(result, dict) else None)
    db.commit()

    db.refresh(case)
    assert case.status != "SUBMITTED", (
        "the case never left SUBMITTED — the dispatcher did not reach the case agent"
    )
    assert case.status in {"APPROVED", "HUMAN_REVIEW", "NEEDS_INFO", "WAITING_EXTERNAL"}
    assert case.latest_route is not None
