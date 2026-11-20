"""Chaos-control acceptance tests (docs/10 §1.1, Challenge 02).

The judges will ask us to break a government service live. These tests pin what
happens when we do: the service answers 503 with a machine-readable error, the
envelope still says ``simulated``, and a ``DOWN`` service never half-executes a
mutation.
"""

from __future__ import annotations

import asyncio
import json
import random
from typing import Any

import pytest
from fastapi import APIRouter, FastAPI
from fastapi.testclient import TestClient

from app.mocks import chaos
from app.mocks.config import (
    DEFAULT_FAILURE_RATE,
    DEFAULT_LATENCY_MS,
    NORMAL_JITTER_MAX_MS,
    NORMAL_JITTER_MIN_MS,
)


# --------------------------------------------------------------------------- #
# path → service mapping
# --------------------------------------------------------------------------- #
class TestServiceMapping:
    @pytest.mark.parametrize(
        ("path", "service"),
        [
            ("/mock/v1/identity/lookup", "identity"),
            ("/mock/v1/civil/death-records", "civil"),
            ("/mock/v1/household/survey", "household"),
            ("/mock/v1/benefits/active", "benefits"),
            ("/mock/v1/payments/transfer", "payment"),
            ("/mock/v1/complaints", "complaint"),
            ("/mock/v1/sms/inbox/+923001234567", "sms"),
        ],
    )
    def test_every_mock_path_maps_to_its_service(self, path: str, service: str) -> None:
        assert chaos.service_for_path(path) == service

    def test_an_unmapped_path_returns_none(self) -> None:
        assert chaos.service_for_path("/api/v1/cases") is None


# --------------------------------------------------------------------------- #
# the decision itself
# --------------------------------------------------------------------------- #
class TestChaosState:
    def test_normal_never_fails(self) -> None:
        state = chaos.ChaosState(service="identity", mode="NORMAL", delay_ms=40, failure_rate=0.0)
        assert not state.should_fail

    def test_down_always_fails(self) -> None:
        state = chaos.ChaosState(service="identity", mode="DOWN", delay_ms=0, failure_rate=0.0)
        assert state.should_fail

    def test_flaky_fails_at_the_configured_rate(self) -> None:
        state = chaos.ChaosState(service="payment", mode="FLAKY", delay_ms=0, failure_rate=1.0)
        assert state.should_fail

        state = chaos.ChaosState(service="payment", mode="FLAKY", delay_ms=0, failure_rate=0.0)
        assert not state.should_fail

    def test_flaky_is_actually_random(self) -> None:
        state = chaos.ChaosState(service="payment", mode="FLAKY", delay_ms=0, failure_rate=0.5)
        random.seed(20261120)
        outcomes = [state.should_fail for _ in range(400)]
        rate = sum(outcomes) / len(outcomes)
        assert 0.40 <= rate <= 0.60, f"failure rate {rate:.2f} is not near 0.50"

    def test_slow_never_fails(self) -> None:
        state = chaos.ChaosState(service="identity", mode="SLOW", delay_ms=4000, failure_rate=0.0)
        assert not state.should_fail


# --------------------------------------------------------------------------- #
# config loading
# --------------------------------------------------------------------------- #
class TestConfigLoading:
    def test_a_missing_database_degrades_to_normal(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr("app.db.SessionLocal", None, raising=False)
        state = chaos._load_state("identity")
        assert state.mode == "NORMAL"
        assert state.delay_ms == 0

    def test_normal_mode_jitters_between_30_and_80_ms(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(chaos, "get_service_config", None, raising=False)
        monkeypatch.setattr(
            "app.mocks.config.get_service_config",
            lambda db, service: {"mode": "NORMAL", "latency_ms": 0, "failure_rate": 0.0},
        )
        monkeypatch.setattr("app.db.SessionLocal", _FakeSessionFactory(), raising=False)

        delays = {chaos._load_state("identity").delay_ms for _ in range(60)}
        assert delays <= set(range(NORMAL_JITTER_MIN_MS, NORMAL_JITTER_MAX_MS + 1))
        assert len(delays) > 1, "NORMAL must jitter, not return a constant"

    def test_slow_mode_uses_the_configured_latency(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(
            "app.mocks.config.get_service_config",
            lambda db, service: {"mode": "SLOW", "latency_ms": 4000, "failure_rate": 0.0},
        )
        monkeypatch.setattr("app.db.SessionLocal", _FakeSessionFactory(), raising=False)
        assert chaos._load_state("identity").delay_ms == 4000

    def test_down_mode_does_not_sleep(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(
            "app.mocks.config.get_service_config",
            lambda db, service: {"mode": "DOWN", "latency_ms": 4000, "failure_rate": 0.0},
        )
        monkeypatch.setattr("app.db.SessionLocal", _FakeSessionFactory(), raising=False)
        assert chaos._load_state("identity").delay_ms == 0

    def test_defaults_are_the_documented_ones(self) -> None:
        assert DEFAULT_LATENCY_MS == 4000
        assert DEFAULT_FAILURE_RATE == 0.50
        assert (NORMAL_JITTER_MIN_MS, NORMAL_JITTER_MAX_MS) == (30, 80)


class _FakeSessionFactory:
    def __call__(self) -> Any:
        return _FakeSession()


class _FakeSession:
    def close(self) -> None:
        pass


# --------------------------------------------------------------------------- #
# the envelope
# --------------------------------------------------------------------------- #
class TestEnvelope:
    def test_a_json_2xx_body_gains_the_envelope(self) -> None:
        from fastapi.responses import JSONResponse

        response = JSONResponse(content={"matches": []}, status_code=200)
        wrapped = chaos._inject_envelope(response, "identity", "NORMAL")
        payload = json.loads(wrapped.body)
        assert payload["simulated"] is True
        assert payload["service"] == "identity"
        assert payload["service_mode"] == "NORMAL"

    def test_an_existing_simulated_flag_is_not_overwritten(self) -> None:
        from fastapi.responses import JSONResponse

        response = JSONResponse(content={"simulated": True, "matches": []}, status_code=200)
        payload = json.loads(chaos._inject_envelope(response, "identity", "SLOW").body)
        assert payload["simulated"] is True
        assert payload["service_mode"] == "SLOW"

    def test_an_error_response_is_left_alone(self) -> None:
        from fastapi.responses import JSONResponse

        response = JSONResponse(content={"detail": "nope"}, status_code=404)
        assert chaos._inject_envelope(response, "identity", "NORMAL") is response

    def test_a_non_json_body_is_left_alone(self) -> None:
        from fastapi.responses import Response

        response = Response(content=b"not json", media_type="text/plain")
        assert chaos._inject_envelope(response, "identity", "NORMAL") is response

    def test_a_json_list_body_is_left_alone(self) -> None:
        from fastapi.responses import JSONResponse

        response = JSONResponse(content=[1, 2, 3], status_code=200)
        assert chaos._inject_envelope(response, "identity", "NORMAL") is response

    def test_the_down_body_names_the_error(self) -> None:
        down = chaos._down_body("identity", "DOWN")
        assert down["error"] == "MOCK_SERVICE_DOWN"
        assert down["simulated"] is True
        assert down["service_mode"] == "DOWN"

        flaky = chaos._down_body("payment", "FLAKY")
        assert flaky["error"] == "MOCK_SERVICE_UNAVAILABLE"


# --------------------------------------------------------------------------- #
# end to end through a real FastAPI app
# --------------------------------------------------------------------------- #
def _app_with_mode(monkeypatch: pytest.MonkeyPatch, mode: str, **overrides: Any) -> FastAPI:
    config = {"mode": mode, "latency_ms": 0, "failure_rate": 0.0, **overrides}
    monkeypatch.setattr("app.mocks.config.get_service_config", lambda db, service: config)
    monkeypatch.setattr("app.db.SessionLocal", _FakeSessionFactory(), raising=False)

    app = FastAPI()
    router = APIRouter(route_class=chaos.ChaosRoute)

    @router.get("/mock/v1/identity/lookup")
    def lookup() -> dict[str, Any]:
        return {"matches": [{"full_name": "Fatima Bibi"}]}

    @router.post("/mock/v1/payments/transfer")
    def transfer() -> dict[str, Any]:
        return {"status": "COMPLETED", "reference": "RAAST-0001"}

    app.include_router(router)
    return app


class TestEndToEnd:
    def test_normal_returns_the_envelope(self, monkeypatch: pytest.MonkeyPatch) -> None:
        client = TestClient(_app_with_mode(monkeypatch, "NORMAL"))
        response = client.get("/mock/v1/identity/lookup")
        assert response.status_code == 200
        payload = response.json()
        assert payload["simulated"] is True
        assert payload["service"] == "identity"
        assert payload["service_mode"] == "NORMAL"
        assert payload["matches"][0]["full_name"] == "Fatima Bibi"

    def test_down_returns_503_with_the_error_code(self, monkeypatch: pytest.MonkeyPatch) -> None:
        client = TestClient(_app_with_mode(monkeypatch, "DOWN"))
        response = client.get("/mock/v1/identity/lookup")
        assert response.status_code == 503
        payload = response.json()
        assert payload["error"] == "MOCK_SERVICE_DOWN"
        assert payload["simulated"] is True
        assert response.headers["retry-after"] == "2"

    def test_down_never_runs_the_endpoint(self, monkeypatch: pytest.MonkeyPatch) -> None:
        calls: list[str] = []
        monkeypatch.setattr("app.mocks.config.get_service_config", lambda db, service: {"mode": "DOWN"})
        monkeypatch.setattr("app.db.SessionLocal", _FakeSessionFactory(), raising=False)

        app = FastAPI()
        router = APIRouter(route_class=chaos.ChaosRoute)

        @router.post("/mock/v1/payments/transfer")
        def transfer() -> dict[str, Any]:
            calls.append("executed")
            return {"status": "COMPLETED"}

        app.include_router(router)
        response = TestClient(app).post("/mock/v1/payments/transfer")

        assert response.status_code == 503
        assert calls == [], "a DOWN service must never half-execute a mutation"

    def test_flaky_at_full_rate_always_fails(self, monkeypatch: pytest.MonkeyPatch) -> None:
        client = TestClient(_app_with_mode(monkeypatch, "FLAKY", failure_rate=1.0))
        for _ in range(5):
            assert client.get("/mock/v1/identity/lookup").status_code == 503

    def test_flaky_at_zero_rate_never_fails(self, monkeypatch: pytest.MonkeyPatch) -> None:
        client = TestClient(_app_with_mode(monkeypatch, "FLAKY", failure_rate=0.0))
        for _ in range(5):
            assert client.get("/mock/v1/identity/lookup").status_code == 200

    def test_slow_mode_actually_delays(self, monkeypatch: pytest.MonkeyPatch) -> None:
        import time

        client = TestClient(_app_with_mode(monkeypatch, "SLOW", latency_ms=120))
        started = time.perf_counter()
        response = client.get("/mock/v1/identity/lookup")
        elapsed_ms = (time.perf_counter() - started) * 1000
        assert response.status_code == 200
        assert elapsed_ms >= 100, f"SLOW mode returned in {elapsed_ms:.0f} ms"

    def test_the_mode_is_reported_on_every_response(self, monkeypatch: pytest.MonkeyPatch) -> None:
        for mode in ("NORMAL", "SLOW", "FLAKY"):
            client = TestClient(_app_with_mode(monkeypatch, mode, failure_rate=0.0))
            payload = client.get("/mock/v1/identity/lookup").json()
            assert payload["service_mode"] == mode


# --------------------------------------------------------------------------- #
# the ASGI middleware variant
# --------------------------------------------------------------------------- #
class TestMiddleware:
    def test_it_passes_non_mock_paths_through(self) -> None:
        seen: list[str] = []

        async def app(scope: dict, receive: Any, send: Any) -> None:
            seen.append(scope["path"])

        middleware = chaos.MockChaosMiddleware(app)
        asyncio.run(middleware({"type": "http", "path": "/api/v1/cases"}, None, None))
        assert seen == ["/api/v1/cases"]

    def test_it_short_circuits_a_down_service(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr("app.mocks.config.get_service_config", lambda db, service: {"mode": "DOWN"})
        monkeypatch.setattr("app.db.SessionLocal", _FakeSessionFactory(), raising=False)

        sent: list[dict[str, Any]] = []

        async def app(scope: dict, receive: Any, send: Any) -> None:
            sent.append({"type": "endpoint_ran"})

        async def send(message: dict[str, Any]) -> None:
            sent.append(message)

        middleware = chaos.MockChaosMiddleware(app)
        asyncio.run(middleware({"type": "http", "path": "/mock/v1/identity/lookup"}, None, send))

        assert sent[0]["type"] == "http.response.start"
        assert sent[0]["status"] == 503
        assert not any(item.get("type") == "endpoint_ran" for item in sent)
