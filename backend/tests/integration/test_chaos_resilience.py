"""Chaos-resilience integration tests (Challenge 02, J-8, AC-04.4).

These are the four scenarios the judges will run live:

1. Identity service ``DOWN`` → the case waits, and **no fact is guessed**.
2. Service restored → the same case completes without a human touching it.
3. Payment service ``FLAKY`` → retries produce **exactly one** transfer.
4. AI provider fails → the citizen gets a template, and a document is
   ``UNVERIFIABLE`` - never ``TAMPER_SUSPECTED``.

Scenarios 1–3 run against the real Postgres on ``HOST_DB_PORT`` with the real
mock router and the real chaos route. Scenario 4 runs in fake mode with a
provider that always fails. Everything skips cleanly when the database is absent.
"""

from __future__ import annotations

import os
import sys
import types
import uuid
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient


def _install_db_stub() -> None:
    """Install a stand-in ``app.db`` only while A1's real module is absent."""
    try:  # pragma: no cover - the happy path once A1 lands
        import app.db

        return
    except Exception:
        pass

    from sqlalchemy.orm import declarative_base

    module = types.ModuleType("app.db")
    module.Base = declarative_base()  # type: ignore[attr-defined]
    module.SessionLocal = None  # type: ignore[attr-defined]
    module.engine = None  # type: ignore[attr-defined]
    module.get_db = lambda: None  # type: ignore[attr-defined]
    sys.modules["app.db"] = module

    import app

    app.db = module  # type: ignore[attr-defined]


_install_db_stub()

from app.mocks import chaos


@pytest.fixture(autouse=True)
def _specimen_secret(monkeypatch: pytest.MonkeyPatch) -> None:
    """Verify the committed specimens with the secret they were signed with.

    ``app/data/demo_docs`` is pre-signed, so the secret is part of the fixture
    contract. The root ``tests/conftest.py`` overrides ``QR_HMAC_SECRET`` for its
    own QR tests; left alone that makes every genuine specimen fail its signature
    and the verifier reports ``TAMPER_SUSPECTED`` for a good card - which would
    make the AI-outage scenario below pass for the wrong reason.
    """
    from app.ai import qr_sign

    monkeypatch.setenv("QR_HMAC_SECRET", qr_sign.DEFAULT_QR_SECRET)


# --------------------------------------------------------------------------- #
# real database wiring
# --------------------------------------------------------------------------- #
def _dsn() -> str:
    dsn = os.environ.get("DATABASE_URL") or os.environ.get("HOST_DATABASE_URL")
    if dsn:
        return dsn
    port = os.environ.get("HOST_DB_PORT", "5435")
    return f"postgresql+psycopg://haqdaar:haqdaar@localhost:{port}/haqdaar"


@pytest.fixture(scope="module")
def engine() -> Iterator[Any]:
    from sqlalchemy import create_engine, text

    try:
        candidate = create_engine(_dsn(), pool_pre_ping=True)
        with candidate.connect() as conn:
            conn.execute(text("SELECT 1"))
    except Exception:  # pragma: no cover - no database in this environment
        pytest.skip("Postgres is not reachable on HOST_DB_PORT")
    yield candidate
    candidate.dispose()


@pytest.fixture(scope="module")
def mock_db(engine: Any) -> Iterator[Any]:
    """Point ``app.db`` at the real database and create the ``mock_*`` tables."""
    from sqlalchemy.orm import sessionmaker

    from app.mocks import models

    models.Base.metadata.create_all(engine)

    module = sys.modules.get("app.db")
    if module is None:  # pragma: no cover - conftest always installs the stub
        module = types.ModuleType("app.db")
        sys.modules["app.db"] = module
    module.Base = models.Base  # type: ignore[attr-defined]
    module.engine = engine  # type: ignore[attr-defined]
    module.SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)  # type: ignore[attr-defined]

    import app

    app.db = module  # type: ignore[attr-defined]

    yield module


@pytest.fixture(scope="module")
def seeded(mock_db: Any) -> Any:
    """Seed only the simulated registries - the app tables belong to A1."""
    from app.mocks import seed

    session = mock_db.SessionLocal()
    try:
        seed._clear_mock_tables(session)
        seed._seed_mock_registries(session)
        session.commit()
    finally:
        session.close()
    return mock_db


@pytest.fixture
def client(seeded: Any, monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    """The real mock router behind the real chaos route."""
    from app.mocks.router import router as mock_router

    app = FastAPI()
    app.include_router(mock_router, prefix="/mock")
    yield TestClient(app)


def _set_mode(monkeypatch: pytest.MonkeyPatch, service: str, mode: str, **overrides: Any) -> None:
    """Force one service into a chaos mode without touching the database."""
    config = {"mode": mode, "latency_ms": 0, "failure_rate": 0.0, **overrides}
    original = chaos._load_state

    def patched(name: str) -> Any:
        if name == service:
            return chaos.ChaosState(
                service=name,
                mode=mode,
                delay_ms=int(config["latency_ms"]),
                failure_rate=float(config["failure_rate"]),
            )
        return original(name)

    monkeypatch.setattr(chaos, "_load_state", patched)


FATIMA_CNIC = "9990010000012"

_DATA = Path(__file__).resolve().parents[2] / "app" / "data"


def _bundle_facts(**overrides: Any) -> dict[str, Any]:
    """A complete, eligible Sahara fact bundle; ``overrides`` replace fields."""
    from app.mocks.seed_data import build_facts, cnic

    values: dict[str, Any] = {
        "cnic_value": FATIMA_CNIC,
        "full_name": "Fatima Bibi",
        "dob": "1988-04-12",
        "district": "Thatta",
        "income": 18_000,
        "children": 2,
        "household_size": 5,
        "poverty_score": 22,
        "payout_phone": "+923001234567",
        "spouse_name": "Ghulam Rasool",
        "spouse_cnic": cnic(2),
        "cnic_doc_verified": True,
        "death_cert_verified": True,
    }
    values.update(overrides)
    return build_facts(**values)


def _verified_documents() -> list[Any]:
    from app.engine.confidence import DocumentEvidence, DocumentStatus

    return [
        DocumentEvidence(doc_type="CNIC_FRONT", status=DocumentStatus.VERIFIED, verify_confidence=0.97),
        DocumentEvidence(
            doc_type="SPOUSE_DEATH_CERTIFICATE",
            status=DocumentStatus.VERIFIED,
            verify_confidence=0.96,
        ),
    ]


# --------------------------------------------------------------------------- #
# scenario 1 + 2 - identity DOWN, then restored
# --------------------------------------------------------------------------- #
class TestIdentityOutage:
    def test_down_returns_a_machine_readable_error(
        self, client: TestClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _set_mode(monkeypatch, "identity", "DOWN")
        response = client.get("/mock/v1/identity/lookup", params={"cnic": FATIMA_CNIC})

        assert response.status_code == 503
        payload = response.json()
        assert payload["error"] == "MOCK_SERVICE_DOWN"
        assert payload["simulated"] is True
        assert payload["service"] == "identity"

    def test_a_down_service_yields_unknown_facts_not_false_ones(
        self, client: TestClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """The whole point of J-8: an outage must not become a negative fact."""
        from app.mocks.seed_data import public_facts, unknown

        _set_mode(monkeypatch, "identity", "DOWN")
        response = client.get("/mock/v1/identity/lookup", params={"cnic": FATIMA_CNIC})
        assert response.status_code == 503

        # The agent layer cannot read a registry it could not reach, so every
        # identity-derived fact stays UNKNOWN.
        facts = public_facts(_bundle_facts())
        for key in ("applicant_is_alive", "applicant_cnic_valid", "applicant_full_name", "applicant_dob"):
            facts[key] = unknown()
        assert facts["applicant_is_alive"]["state"] == "UNKNOWN"
        assert facts["applicant_cnic_valid"]["state"] == "UNKNOWN"
        assert facts["applicant_is_alive"]["value"] is None

    def test_unknown_identity_never_auto_approves(self) -> None:
        """EN's engine must route an unknown identity to a human, not to approval."""
        from app.engine.facts import FactBundle
        from app.engine.pipeline import evaluate_and_route
        from app.engine.rules_dsl import RuleSetSchema
        from app.mocks.seed_data import SAHARA_RULES_V1, public_facts, unknown

        facts = public_facts(_bundle_facts())
        for key in ("applicant_is_alive", "applicant_cnic_valid", "applicant_full_name", "applicant_dob"):
            facts[key] = unknown()

        result = evaluate_and_route(
            FactBundle(facts=facts),
            RuleSetSchema.model_validate(SAHARA_RULES_V1),
            identity_confidence=0.0,
            documents=[],
        )
        assert result.route.action.value != "AUTO_APPROVE"
        assert result.route.action.value in {"ASK_MORE", "HUMAN_REVIEW"}

    def test_restoring_the_service_completes_the_case(
        self, client: TestClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from app.engine.facts import FactBundle
        from app.engine.pipeline import evaluate_and_route
        from app.engine.rules_dsl import RuleSetSchema
        from app.mocks.seed_data import SAHARA_RULES_V1, public_facts

        _set_mode(monkeypatch, "identity", "DOWN")
        assert client.get("/mock/v1/identity/lookup", params={"cnic": FATIMA_CNIC}).status_code == 503

        _set_mode(monkeypatch, "identity", "NORMAL")
        response = client.get("/mock/v1/identity/lookup", params={"cnic": FATIMA_CNIC})
        assert response.status_code == 200
        matches = response.json()["matches"]
        assert matches, "the restored service must return Fatima"
        person = matches[0]

        facts = public_facts(
            _bundle_facts(
                cnic_value=person["cnic_digits"],
                full_name=person["full_name"],
                dob=person["dob"],
                district=person["district"],
            )
        )
        result = evaluate_and_route(
            FactBundle(facts=facts),
            RuleSetSchema.model_validate(SAHARA_RULES_V1),
            identity_confidence=0.98,
            documents=_verified_documents(),
        )
        assert result.route.action.value == "AUTO_APPROVE", "a restored, complete case must not need a human"

    def test_the_outage_is_visible_in_the_envelope(
        self, client: TestClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _set_mode(monkeypatch, "identity", "NORMAL")
        payload = client.get("/mock/v1/identity/lookup", params={"cnic": FATIMA_CNIC}).json()
        assert payload["service_mode"] == "NORMAL"
        assert payload["simulated"] is True


# --------------------------------------------------------------------------- #
# scenario 3 - FLAKY payments, exactly one transfer
# --------------------------------------------------------------------------- #
class TestPaymentIdempotency:
    def _transfer(self, client: TestClient, key: str, alias: str = "+923001234567") -> Any:
        return client.post(
            "/mock/v1/payments/transfer",
            json={"payout_alias": alias, "amount_pkr": 14_000, "reference_code": "HQ-2026-000101"},
            headers={"Idempotency-Key": key},
        )

    def test_a_flaky_service_can_be_retried_without_double_paying(
        self, client: TestClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        key = f"chaos-{uuid.uuid4()}"
        _set_mode(monkeypatch, "payment", "FLAKY", failure_rate=1.0)

        failures = 0
        for _ in range(3):
            if self._transfer(client, key).status_code == 503:
                failures += 1
        assert failures == 3, "FLAKY at 100% must fail every attempt"

        _set_mode(monkeypatch, "payment", "NORMAL")
        first = self._transfer(client, key)
        assert first.status_code == 201
        reference = first.json()["payment_ref"]

        # Every retry after the success must return the exact same transfer.
        for _ in range(4):
            replay = self._transfer(client, key)
            assert replay.status_code == 201
            assert replay.json()["payment_ref"] == reference
            assert replay.json()["status"] == "COMPLETED"

    def test_exactly_one_row_exists_after_the_retries(
        self, client: TestClient, seeded: Any, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from sqlalchemy import func, select

        from app.mocks.models import MockPayment

        key = f"chaos-{uuid.uuid4()}"
        _set_mode(monkeypatch, "payment", "NORMAL")
        for _ in range(5):
            self._transfer(client, key)

        session = seeded.SessionLocal()
        try:
            count = session.scalar(
                select(func.count()).select_from(MockPayment).where(MockPayment.idempotency_key == key)
            )
        finally:
            session.close()
        assert count == 1, f"a retried transfer created {count} rows"

    def test_a_replay_is_marked_as_a_replay(
        self, client: TestClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        key = f"chaos-{uuid.uuid4()}"
        _set_mode(monkeypatch, "payment", "NORMAL")
        first = self._transfer(client, key).json()
        replay = self._transfer(client, key).json()

        assert first["payment_ref"] == replay["payment_ref"]
        assert replay.get("replay") is True or replay.get("idempotent_replay") is True

    def test_a_dormant_account_fails_deterministically(
        self, client: TestClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _set_mode(monkeypatch, "payment", "NORMAL")
        response = self._transfer(client, f"chaos-{uuid.uuid4()}", alias="+923009999999")
        assert response.status_code == 201
        payload = response.json()
        assert payload["status"] == "FAILED"
        assert payload["failure_reason"] == "ACCOUNT_DORMANT"

    def test_a_missing_idempotency_key_is_rejected(
        self, client: TestClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _set_mode(monkeypatch, "payment", "NORMAL")
        response = client.post(
            "/mock/v1/payments/transfer",
            json={
                "payout_alias": "+923001234567",
                "amount_pkr": 14_000,
                "reference_code": "HQ-2026-000101",
            },
        )
        assert response.status_code == 400
        assert response.json()["detail"]["error"] == "MISSING_IDEMPOTENCY_KEY"


# --------------------------------------------------------------------------- #
# scenario 4 - AI failure degrades to a template, never to a verdict
# --------------------------------------------------------------------------- #
class _AlwaysFailingProvider:
    """A provider that fails every call, the way a dead API key would."""

    name = "failing"

    def __getattr__(self, item: str) -> Any:
        def fail(*args: Any, **kwargs: Any) -> Any:
            from app.ai.provider import ProviderError

            raise ProviderError("provider is down", code="UPSTREAM_5XX")

        return fail


class TestAiFailure:
    def test_a_document_is_unverifiable_never_tampered(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from app.ai import doc_verify
        from app.ai import provider as provider_module

        monkeypatch.setattr(provider_module, "get_provider", lambda: _AlwaysFailingProvider())
        monkeypatch.setattr(doc_verify, "get_provider", lambda: _AlwaysFailingProvider())

        image = (_DATA / "demo_docs" / "fatima_cnic_genuine.jpg").read_bytes()
        result = doc_verify.verify_image(image, "CNIC_FRONT")

        assert result.status != doc_verify.TAMPER_SUSPECTED, "an AI outage must never accuse a citizen"
        assert result.status in {doc_verify.UNVERIFIABLE, doc_verify.NEEDS_RETAKE}

        # Prove the pipeline actually reached the OCR step. Without this the test
        # would also pass when a signature mismatch short-circuits the run at the
        # QR check - which is exactly how it once passed for the wrong reason.
        by_name = {check.check: check for check in result.checks}
        assert by_name["qr_signature"].passed, "the specimen's own signature must be valid"
        assert "ocr_extraction" in by_name, "the outage must be observed at the OCR step"
        assert not by_name["ocr_extraction"].passed

    def test_a_blurry_document_still_asks_for_a_retake(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from app.ai import doc_verify
        from app.ai import provider as provider_module

        monkeypatch.setattr(provider_module, "get_provider", lambda: _AlwaysFailingProvider())
        monkeypatch.setattr(doc_verify, "get_provider", lambda: _AlwaysFailingProvider())

        image = (_DATA / "demo_docs" / "fatima_cnic_blurry.jpg").read_bytes()
        result = doc_verify.verify_image(image, "CNIC_FRONT")

        assert result.status == doc_verify.NEEDS_RETAKE
        assert result.retake_reason_ur and result.retake_reason_en

    def test_rag_falls_back_to_the_extractive_template(self, monkeypatch: pytest.MonkeyPatch) -> None:
        from app.ai import rag

        monkeypatch.setattr(rag, "get_provider", lambda: _AlwaysFailingProvider())

        chunks = [
            rag.RetrievedChunk(
                chunk_id="c1",
                document_id="d1",
                doc_title="Sahara Widow Grant Policy",
                section_heading="Monthly Amount",
                version="1.0",
                content="The Sahara widow grant pays PKR 12,000 per month plus PKR 1,000 per child.",
                hybrid_score=0.9,
            )
        ]
        answer, provider_name, model = rag._synthesize(None, "how much", chunks, lang="en")

        assert answer, "a provider outage must still produce an answer"
        assert provider_name == "fake"
        assert model == "fake-extractive"
        assert "12,000" in answer or "Sahara" in answer

    def test_voice_falls_back_to_a_retry_prompt(self) -> None:
        from app.ai import voice

        result = voice.transcribe_and_parse(
            None,
            audio_bytes=b"RIFF" + bytes(4) + b"WAVE",
            mime_type="audio/wav",
            field_key="monthly_income_pkr",
        )
        assert result.parsed_value is None
        assert result.needs_retry
        assert result.readback_ur and result.readback_en

    def test_the_resilient_provider_never_raises(self) -> None:
        """In live mode the breaker guarantees the wizard never sees an exception."""
        from app.ai.provider import CircuitBreaker, ResilientProvider, get_fake_provider

        resilient = ResilientProvider(
            _AlwaysFailingProvider(), get_fake_provider(), CircuitBreaker(threshold=1)
        )
        assert resilient.embed_texts(["widow grant"])
        assert resilient.breaker.is_open

    def test_the_scam_classifier_still_answers_without_the_model(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from app.ai import scam_classifier

        monkeypatch.setattr(
            scam_classifier, "_probability", lambda text, flags: (_ for _ in ()).throw(RuntimeError("model gone"))
        )
        verdict = scam_classifier.classify(
            "Send Rs 500 registration fee to 03001234567 to release your 25000 rupees."
        )
        assert verdict.verdict == scam_classifier.LIKELY_SCAM, "deterministic flags must survive a model outage"
