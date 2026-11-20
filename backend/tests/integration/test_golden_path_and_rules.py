"""Golden path & live rule change — the C2 drill (docs/13 §1, docs/12 C2).

Three bodies, in the order the demo runs them:

1. **Golden path.** Fatima submits with the card spelling ``"Fatima Bibi"`` while the
   registry holds ``"Mst. Fatima Bibi"``; the soft match resolves, the engine
   auto-approves PKR 15,000, the payment completes exactly once, and an ``HQ-`` code
   SMS lands in her simulated inbox. Re-running the pipeline changes nothing (AC-05.3).
2. **Income cap drop.** Admin clones v1, drops the income cap 40,000 → 35,000, previews
   the impact with the Digital Twin, publishes, and a *new* case evaluates under v2
   while Fatima's earlier decision still carries v1 and its content hash.
3. **Twin round-trip.** The replay's ``before_counts`` equal the live route distribution
   of the decisions it replayed, two runs are byte-identical, and nothing but
   ``simulation_runs`` is written.

Everything that depends on a teammate's surface is isolated in the ``S1 ADAPTERS``
section below, so the merge is a mechanical fix in one place — the same discipline as
``app/agent/deps.py``. The module skips (with the reason) until the S1 stack lands.
"""

from __future__ import annotations

import importlib
import socket
import sys
import threading
import time
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import httpx
import pytest

#: Make ``app`` importable however pytest was invoked (mirrors tests/engine/conftest.py).
BACKEND_ROOT = Path(__file__).resolve().parents[2]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

# -- S1 gate -------------------------------------------------------------
#: Modules this file needs. Until they all import, the whole module skips.
_REQUIRED_MODULES = (
    "app.main",
    "app.db",
    "app.models",
    "app.config",
    "app.security.deps",
    "app.jobs.queue",
    "app.notify",
    "app.agent.case_agent",
)


def _unavailable_modules() -> list[str]:
    problems: list[str] = []
    for name in _REQUIRED_MODULES:
        try:
            importlib.import_module(name)
        except Exception as exc:  # noqa: BLE001 - any import failure means "not merged"
            problems.append(f"{name} ({type(exc).__name__}: {exc})")
    return problems


_UNAVAILABLE = _unavailable_modules()

pytestmark = pytest.mark.skipif(
    bool(_UNAVAILABLE),
    reason="S1 stack not merged yet — " + "; ".join(_UNAVAILABLE),
)

#: docs/10 §2 — the golden-path persona.
FATIMA_CNIC = "9990010000012"
FATIMA_PHONE = "+923001000001"
FATIMA_CARD_NAME = "Fatima Bibi"
FATIMA_REGISTRY_NAME = "Mst. Fatima Bibi"
FATIMA_CHILDREN = 3
FATIMA_INCOME_PKR = 28_000
#: Seeded household survey: Thatta, 4 members, PKR 28,000/month.
FATIMA_HOUSEHOLD_SIZE = 4
FATIMA_DOB = "1974-05-14"

#: Sahara v1: base 12,000 + 1,000/child, cap 20,000 → 3 children = 15,000.
EXPECTED_AMOUNT_PKR = 15_000

PROGRAM_CODE = "SAHARA_WIDOW_GRANT"
INCOME_RULE_ID = "R05_INCOME_CAP"
INCOME_CAP_V1 = 40_000
INCOME_CAP_V2 = 35_000

#: The secret the committed ``app/data/demo_docs`` pack was signed with (see the
#: ``specimen_qr_secret`` fixture for why this module pins it).
SPECIMEN_QR_SECRET = "dev-qr-secret-change-me"  # noqa: S105 - public dev default, not a secret


# =======================================================================
# S1 ADAPTERS — every teammate-surface assumption lives here
# =======================================================================
def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def _wait_until_up(base_url: str, *, timeout: float = 30.0) -> None:
    deadline = time.monotonic() + timeout
    last: str = "no attempt"
    while time.monotonic() < deadline:
        try:
            response = httpx.get(f"{base_url}/api/v1/transparency", timeout=2.0)
        except httpx.HTTPError as exc:
            last = f"{type(exc).__name__}: {exc}"
        else:
            if response.status_code < 500:
                return
            last = f"HTTP {response.status_code}"
        time.sleep(0.2)
    pytest.fail(f"app did not come up at {base_url} within {timeout}s ({last})")


def _session_factory() -> Any:
    """``app.db``'s session factory, under whichever name BE chose."""
    db_module = importlib.import_module("app.db")
    for name in ("SessionLocal", "session_factory", "Session"):
        factory = getattr(db_module, name, None)
        if callable(factory):
            return factory
    pytest.fail("app.db exposes no session factory (looked for SessionLocal, "
                "session_factory, Session)")


def _drain_jobs(db: Any, *, rounds: int = 20) -> None:
    """Run every due job synchronously, through BE's public queue + handler API.

    ``app.jobs.worker.Worker.run_once`` dispatches onto a thread pool, which makes the
    payment leg racy in a test. Claiming and executing in the calling thread uses the
    same ``claim_job`` / ``run_handler`` / ``mark_completed`` path the worker uses, so
    the drill still exercises the real handler and the real ``SKIP LOCKED`` claim.
    """
    queue = importlib.import_module("app.jobs.queue")
    handlers = importlib.import_module("app.jobs.handlers")

    for _ in range(rounds):
        job = queue.claim_job(db)
        if job is None:
            return
        try:
            result = handlers.run_handler(db, job.job_type, job.payload_json or {})
        except Exception as exc:  # noqa: BLE001 - mirror the worker's failure path
            queue.mark_failed(db, job, f"{type(exc).__name__}: {exc}")
        else:
            queue.mark_completed(db, job, result=result if isinstance(result, dict) else None)
    pytest.fail(f"job queue did not drain within {rounds} rounds")


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _demo_login(api: httpx.Client, persona_key: str) -> str:
    response = api.post("/api/v1/auth/demo-login", json={"persona_key": persona_key})
    assert response.status_code == 200, response.text
    return str(response.json()["access_token"])


def _ensure_department_consent(api: httpx.Client, token: str, tenant_id: Any) -> None:
    """Idempotent precondition: Fatima must have granted the department her data."""
    grants = api.get("/api/v1/consent/grants", headers=_auth(token))
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
    created = api.post(
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


def _upload_demo_document(
    api: httpx.Client, token: str, case_id: str, doc_type: str, filename: str
) -> None:
    """Upload one of A3's generated specimen cards (docs/10 §3)."""
    path = BACKEND_ROOT / "app" / "data" / "demo_docs" / filename
    if not path.exists():
        pytest.fail(f"demo document missing: {path} (A3 generates it in app/mocks/doc_generator.py)")
    with path.open("rb") as handle:
        response = api.post(
            "/api/v1/documents",
            headers=_auth(token),
            files={"file": (filename, handle, "image/jpeg")},
            data={"doc_type": doc_type, "case_id": case_id},
        )
    assert response.status_code in (200, 201), response.text


def _submit_fatima_application(
    api: httpx.Client, token: str, program_id: str, tenant_id: Any
) -> str:
    """Create → fill → upload → submit. Returns the case id."""
    _ensure_department_consent(api, token, tenant_id)

    created = api.post(
        "/api/v1/cases",
        headers=_auth(token),
        json={"program_id": program_id, "case_type": "BENEFIT_APPLICATION"},
    )
    assert created.status_code in (200, 201), created.text
    case_id = str(created.json()["id"])

    answers = {
        "applicant_cnic": {"value": FATIMA_CNIC, "confirmed": True},
        # The card spelling, deliberately not the registry spelling.
        "applicant_full_name": {"value": FATIMA_CARD_NAME, "confirmed": True},
        "applicant_dob": {"value": FATIMA_DOB, "confirmed": True},
        "applicant_district": {"value": "Thatta", "confirmed": True},
        "spouse_full_name": {"value": "Ghulam Rasool", "confirmed": True},
        "children_under_18": {"value": FATIMA_CHILDREN, "confirmed": True},
        "household_size": {"value": FATIMA_HOUSEHOLD_SIZE, "confirmed": True},
        "monthly_income_pkr": {"value": FATIMA_INCOME_PKR, "confirmed": True},
        "payout_phone": {"value": FATIMA_PHONE, "confirmed": True},
    }
    saved = api.patch(
        f"/api/v1/cases/{case_id}/draft",
        headers=_auth(token),
        json={"wizard_step": "review", "answers": answers},
    )
    assert saved.status_code == 200, saved.text

    _upload_demo_document(api, token, case_id, "CNIC_FRONT", "fatima_cnic_genuine.jpg")
    _upload_demo_document(
        api, token, case_id, "SPOUSE_DEATH_CERTIFICATE", "ghulam_rasool_death_cert_genuine.jpg"
    )

    submitted = api.post(f"/api/v1/cases/{case_id}/submit", headers=_auth(token))
    assert submitted.status_code == 200, submitted.text
    return case_id


# =======================================================================
# fixtures
# =======================================================================
@pytest.fixture(scope="session")
def live_server() -> Iterator[str]:
    """Run the real app — API and ``/mock/v1`` — on a free port for the session."""
    uvicorn = pytest.importorskip("uvicorn")
    main = importlib.import_module("app.main")

    port = _free_port()
    server = uvicorn.Server(
        uvicorn.Config(main.app, host="127.0.0.1", port=port, log_level="warning")
    )
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    base_url = f"http://127.0.0.1:{port}"
    try:
        _wait_until_up(base_url)
        yield base_url
    finally:
        server.should_exit = True
        thread.join(timeout=15)


@pytest.fixture(scope="session")
def mock_base_url(live_server: str) -> str:
    """Point the case agent's HTTP client at the live app (the mock router is mounted there)."""
    settings = importlib.import_module("app.config").settings
    settings.MOCK_BASE_URL = live_server
    return live_server


@pytest.fixture(scope="session", autouse=True)
def specimen_qr_secret() -> Iterator[None]:
    """Verify the committed specimen pack with the secret it was signed with.

    ``app/data/demo_docs/*.jpg`` are checked-in binaries signed with the dev default
    ``QR_HMAC_SECRET``. ``tests/conftest.py`` overrides that variable for the test
    environment, so every genuine card would verify as ``invalid_hmac`` and the
    pipeline would (correctly) raise ``TAMPER_SUSPECTED``. Restore the signing secret
    for the duration of this module so the drill exercises the real verifier against
    the real fixtures. Reported to the Lead: the durable fix belongs in the shared
    conftest or in seed-time regeneration, not here.
    """
    import os

    previous = os.environ.get("QR_HMAC_SECRET")
    os.environ["QR_HMAC_SECRET"] = SPECIMEN_QR_SECRET
    try:
        yield
    finally:
        if previous is None:
            os.environ.pop("QR_HMAC_SECRET", None)
        else:
            os.environ["QR_HMAC_SECRET"] = previous


@pytest.fixture(scope="session")
def api(live_server: str, mock_base_url: str) -> Iterator[httpx.Client]:
    assert mock_base_url == live_server  # the mock router is mounted on the same app
    with httpx.Client(base_url=live_server, timeout=30.0) as client:
        yield client


@pytest.fixture
def db() -> Iterator[Any]:
    session = _session_factory()()
    try:
        yield session
    finally:
        session.rollback()
        session.close()


@pytest.fixture(scope="session")
def seeded(mock_base_url: str) -> dict[str, Any]:
    """The demo seed must already be loaded — docker compose runs it on boot."""
    from sqlalchemy import select

    assert mock_base_url  # the seed fixture must run after the mock base URL is set
    models = importlib.import_module("app.models")
    session = _session_factory()()
    try:
        program = (
            session.execute(
                select(models.Program).where(models.Program.code == PROGRAM_CODE)
            )
            .scalars()
            .first()
        )
        if program is None:
            pytest.fail(
                f"program {PROGRAM_CODE} not seeded; run "
                "`python -m app.mocks.seed --if-empty` against this database"
            )
        version = session.get(models.RuleVersion, program.active_rule_version_id)
        if version is None:
            pytest.fail(f"program {PROGRAM_CODE} has no active rule version")
        citizen = (
            session.execute(
                select(models.Citizen).where(models.Citizen.cnic_digits == FATIMA_CNIC)
            )
            .scalars()
            .first()
        )
        if citizen is None:
            pytest.fail(f"citizen {FATIMA_CNIC} not seeded")
        return {
            "program_id": str(program.id),
            "tenant_id": program.tenant_id,
            "rule_version_id": version.id,
            "rule_version_number": version.version_number,
            "rule_content_hash": version.content_hash,
            "citizen_id": citizen.id,
        }
    finally:
        session.close()


# =======================================================================
# 1. golden path
# =======================================================================
def test_fatima_golden_path_auto_approves_and_pays_exactly_once(
    api: httpx.Client, db: Any, seeded: dict[str, Any]
) -> None:
    from sqlalchemy import func, select

    models = importlib.import_module("app.models")
    case_agent = importlib.import_module("app.agent.case_agent")

    token = _demo_login(api, "widow_fatima")
    case_id = _submit_fatima_application(
        api, token, seeded["program_id"], seeded["tenant_id"]
    )

    # PROCESS_CASE handler — exactly what the worker calls.
    decision = case_agent.run_case_agent(db, case_id)
    assert decision is not None, "the pipeline recorded no decision"

    case = db.get(models.Case, case_id)
    assert case.status == "APPROVED"
    assert case.latest_route == "AUTO_APPROVE"
    assert case.approved_amount_pkr == EXPECTED_AMOUNT_PKR
    assert case.latest_rule_version_id == seeded["rule_version_id"]

    assert decision.route_action == "AUTO_APPROVE"
    assert decision.outcome_status == "APPROVED"
    assert decision.computed_amount_pkr == EXPECTED_AMOUNT_PKR
    assert decision.rule_version_id == seeded["rule_version_id"]
    assert decision.rule_content_hash == seeded["rule_content_hash"]
    assert float(decision.confidence_overall) >= 0.90

    # The spelling variant resolved to the registry record, and the raw card spelling
    # is still visible in provenance (ADR-015: keep the raw -> canonical mapping).
    snapshot = decision.input_snapshot_json
    assert snapshot["applicant_full_name"]["value"] == FATIMA_REGISTRY_NAME
    assert snapshot["applicant_full_name"]["source"] == "IDENTITY_REGISTRY"
    recorded = [
        alternative.get("value")
        for alternative in snapshot["applicant_full_name"].get("alternatives") or ()
    ]
    assert FATIMA_CARD_NAME in recorded, (
        "the self-declared card spelling must stay visible in provenance"
    )

    # Payment: exactly one, completed, for the approved amount.
    _drain_jobs(db)
    db.expire_all()
    payments = (
        db.execute(select(models.Payment).where(models.Payment.case_id == case_id))
        .scalars()
        .all()
    )
    assert len(payments) == 1, f"expected exactly one payment, got {len(payments)}"
    assert payments[0].status == "COMPLETED"
    assert payments[0].amount_pkr == EXPECTED_AMOUNT_PKR

    # AC-05.3: re-running the pipeline for the same case and facts writes nothing new.
    decisions_before = db.execute(
        select(func.count()).select_from(models.Decision).where(
            models.Decision.case_id == case_id
        )
    ).scalar_one()
    case_agent.run_case_agent(db, case_id)
    _drain_jobs(db)
    db.expire_all()
    decisions_after = db.execute(
        select(func.count()).select_from(models.Decision).where(
            models.Decision.case_id == case_id
        )
    ).scalar_one()
    payments_after = db.execute(
        select(func.count()).select_from(models.Payment).where(
            models.Payment.case_id == case_id
        )
    ).scalar_one()
    assert decisions_after == decisions_before == 1
    assert payments_after == 1

    # The citizen got an SMS carrying a verifiable HQ code.
    inbox = api.get(f"/mock/v1/sms/inbox/{FATIMA_PHONE}")
    assert inbox.status_code == 200, inbox.text
    payload = inbox.json()
    messages = payload.get("messages", []) if isinstance(payload, dict) else payload
    assert messages, f"simulated inbox for {FATIMA_PHONE} is empty"
    assert any(
        "HQ-" in str(message.get("verification_code") or "")
        or "HQ-" in str(message.get("body") or "")
        or "HQ-" in str(message.get("body_en") or "")
        for message in messages
    ), f"no HQ- verification code in the simulated inbox: {messages}"


# =======================================================================
# 2. income cap drop
# =======================================================================
def test_income_cap_drop_flips_the_right_case(
    api: httpx.Client, db: Any, seeded: dict[str, Any]
) -> None:
    models = importlib.import_module("app.models")
    case_agent = importlib.import_module("app.agent.case_agent")

    # A decision made under v1, before the rule changes. Self-contained: this test
    # does not depend on the golden-path test having run first.
    token = _demo_login(api, "widow_fatima")
    earlier_case_id = _submit_fatima_application(
        api, token, seeded["program_id"], seeded["tenant_id"]
    )
    earlier = case_agent.run_case_agent(db, earlier_case_id)
    assert earlier is not None
    assert earlier.rule_version_id == seeded["rule_version_id"]
    assert earlier.rule_content_hash == seeded["rule_content_hash"]

    admin = _demo_login(api, "admin_bilal")
    program_id = seeded["program_id"]

    # Clone the active version into a draft.
    draft = api.post(
        f"/api/v1/admin/programs/{program_id}/rules",
        headers=_auth(admin),
        json={"change_note": "income cap 40,000 -> 35,000"},
    )
    assert draft.status_code == 201, draft.text
    draft_id = draft.json()["id"]
    rules = draft.json()["rules_json"]

    income_rule = next(rule for rule in rules["eligibility_rules"] if rule["id"] == INCOME_RULE_ID)
    assert income_rule["value"] == INCOME_CAP_V1
    income_rule["value"] = INCOME_CAP_V2

    updated = api.put(
        f"/api/v1/admin/rules/{draft_id}",
        headers=_auth(admin),
        json={"rules_json": rules},
    )
    assert updated.status_code == 200, updated.text

    # Preview with the Digital Twin before publishing.
    cases_before = _case_state(db, models)
    decisions_before = _decision_count(db, models)

    simulation = api.post(
        f"/api/v1/admin/rules/{draft_id}/simulate",
        headers=_auth(admin),
        json={"sample_size": 200},
    )
    assert simulation.status_code == 200, simulation.text
    summary = simulation.json()
    assert summary["sample_size"] >= 1
    assert summary["flipped_count"] >= 1, "an income cap drop must flip at least one case"

    # A cap drop can only remove approvals, never add them.
    for flip in summary["flipped_cases"]:
        assert flip["before_route"] == "AUTO_APPROVE", flip
        assert flip["after_route"] != "AUTO_APPROVE", flip
        assert flip["after_amount"] <= flip["before_amount"], flip
    assert summary["budget_delta_pkr"] <= 0

    # Zero side effects on live data.
    db.expire_all()
    assert _case_state(db, models) == cases_before
    assert _decision_count(db, models) == decisions_before

    # Publish: the pointer moves atomically, no restart.
    published = api.post(
        f"/api/v1/admin/rules/{draft_id}/publish",
        headers=_auth(admin),
        json={"change_note": "income cap 40,000 -> 35,000"},
    )
    assert published.status_code == 200, published.text
    assert published.json()["active_rule_version_id"] == draft_id
    assert published.json()["reindex_enqueued"] is True

    db.expire_all()
    program = db.get(models.Program, seeded["program_id"])
    assert str(program.active_rule_version_id) == draft_id

    # A NEW case now evaluates under v2 ...
    later_case_id = _submit_fatima_application(
        api, token, seeded["program_id"], seeded["tenant_id"]
    )
    later = case_agent.run_case_agent(db, later_case_id)
    assert later is not None
    assert str(later.rule_version_id) == draft_id
    assert later.rule_content_hash != seeded["rule_content_hash"]

    # ... while the earlier decision still shows v1 and its hash, untouched.
    db.expire_all()
    stored = db.get(models.Decision, earlier.id)
    assert stored is not None
    assert stored.rule_version_id == seeded["rule_version_id"]
    assert stored.rule_content_hash == seeded["rule_content_hash"]
    assert stored.route_action == earlier.route_action


def _case_state(db: Any, models: Any) -> dict[str, tuple[str, str | None]]:
    """Snapshot of every case's status and route, for zero-side-effect assertions.

    Ends the read transaction before returning: an open snapshot in this session
    blocks the API's own connection and deadlocks the drill.
    """
    from sqlalchemy import select

    try:
        rows = db.execute(select(models.Case)).scalars().all()
        return {str(row.id): (row.status, row.latest_route) for row in rows}
    finally:
        db.rollback()


def _decision_count(db: Any, models: Any) -> int:
    """How many decisions exist, read in a transaction that is released immediately."""
    from sqlalchemy import func, select

    try:
        return int(db.execute(select(func.count()).select_from(models.Decision)).scalar_one())
    finally:
        db.rollback()


# =======================================================================
# 3. twin round-trip over decision rows
# =======================================================================
def test_twin_round_trip_over_decision_rows(
    api: httpx.Client, db: Any, seeded: dict[str, Any]
) -> None:
    from sqlalchemy import func, select

    models = importlib.import_module("app.models")

    admin = _demo_login(api, "admin_bilal")
    program_id = seeded["program_id"]

    draft = api.post(
        f"/api/v1/admin/programs/{program_id}/rules",
        headers=_auth(admin),
        json={"change_note": "twin round-trip"},
    )
    assert draft.status_code == 201, draft.text
    draft_id = draft.json()["id"]

    # The live outcome distribution the replay must reproduce. ``before_counts`` is
    # keyed by CaseOutcome (APPROVED / NEEDS_INFO / HUMAN_REVIEW), not by route action.
    live_counts: dict[str, int] = {}
    for outcome, count in db.execute(
        select(models.Decision.outcome_status, func.count())
        .where(models.Decision.tenant_id == seeded["tenant_id"])
        .group_by(models.Decision.outcome_status)
    ).all():
        live_counts[str(outcome)] = int(count)

    runs_before = db.execute(
        select(func.count()).select_from(models.SimulationRun)
    ).scalar_one()
    cases_before = _case_state(db, models)
    decisions_before = _decision_count(db, models)

    first = api.post(
        f"/api/v1/admin/rules/{draft_id}/simulate",
        headers=_auth(admin),
        json={"sample_size": 200},
    )
    assert first.status_code == 200, first.text
    second = api.post(
        f"/api/v1/admin/rules/{draft_id}/simulate",
        headers=_auth(admin),
        json={"sample_size": 200},
    )
    assert second.status_code == 200, second.text

    # Determinism: identical inputs, identical summary.
    assert first.json()["before_counts"] == second.json()["before_counts"]
    assert first.json()["after_counts"] == second.json()["after_counts"]
    assert first.json()["flipped_cases"] == second.json()["flipped_cases"]
    assert first.json()["budget_delta_pkr"] == second.json()["budget_delta_pkr"]

    # The replay read the real decision rows: every sampled case is counted once, on
    # both sides, and only the three documented outcomes appear.
    #
    # ``before_counts`` is *not* compared to the stored ``outcome_status`` column:
    # docs/06 §7 defines both sides as in-memory re-evaluations (baseline rules vs
    # candidate rules), while the seeded historical rows carry hand-authored
    # outcomes. Comparing them would assert that the seed was produced by this
    # engine, which it was not.
    summary = first.json()
    assert summary["sample_size"] <= 200
    assert summary["sample_size"] >= 1
    assert set(summary["before_counts"]) <= {"APPROVED", "NEEDS_INFO", "HUMAN_REVIEW"}
    assert set(summary["after_counts"]) <= {"APPROVED", "NEEDS_INFO", "HUMAN_REVIEW"}
    assert sum(summary["before_counts"].values()) == summary["sample_size"]
    assert sum(summary["after_counts"].values()) == summary["sample_size"]
    assert live_counts, "the seeded world must contain decisions to replay"

    # Zero side effects: only simulation_runs grew.
    db.expire_all()
    assert _case_state(db, models) == cases_before
    assert _decision_count(db, models) == decisions_before
    assert (
        db.execute(select(func.count()).select_from(models.SimulationRun)).scalar_one()
        == runs_before + 2
    )
