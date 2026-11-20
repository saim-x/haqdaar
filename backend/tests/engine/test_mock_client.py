"""Mock-service HTTP client: the docs/07 §7 retry policy, without a network."""

from __future__ import annotations

import httpx
import pytest
from app.agent.mock_client import (
    DEFAULT_TIMEOUT_SECONDS,
    RETRY_DELAYS_SECONDS,
    ExternalServiceUnavailable,
    MockClient,
)


class _Recorder:
    """Counts calls and records the sleeps the client asked for."""

    def __init__(self, responses: list[httpx.Response | Exception]) -> None:
        self.responses = responses
        self.calls = 0
        self.sleeps: list[float] = []

    def handler(self, request: httpx.Request) -> httpx.Response:
        index = min(self.calls, len(self.responses) - 1)
        self.calls += 1
        outcome = self.responses[index]
        if isinstance(outcome, Exception):
            raise outcome
        return outcome

    def sleep(self, seconds: float) -> None:
        self.sleeps.append(seconds)


def _client(recorder: _Recorder) -> MockClient:
    return MockClient(
        "http://mock.test",
        transport=httpx.MockTransport(recorder.handler),
        sleep=recorder.sleep,
    )


def test_retry_policy_is_two_fast_retries() -> None:
    assert RETRY_DELAYS_SECONDS == (0.5, 1.5)
    assert DEFAULT_TIMEOUT_SECONDS == 5.0


def test_successful_get_returns_the_payload() -> None:
    recorder = _Recorder([httpx.Response(200, json={"simulated": True, "matches": []})])
    payload = _client(recorder).get("identity", "/mock/v1/identity/lookup")
    assert payload == {"simulated": True, "matches": []}
    assert recorder.calls == 1
    assert recorder.sleeps == []


def test_transient_500_is_retried_then_succeeds() -> None:
    recorder = _Recorder(
        [
            httpx.Response(503, json={"error": "MOCK_SERVICE_DOWN"}),
            httpx.Response(503, json={"error": "MOCK_SERVICE_DOWN"}),
            httpx.Response(200, json={"found": True}),
        ]
    )
    payload = _client(recorder).get("household", "/mock/v1/household/survey")
    assert payload == {"found": True}
    assert recorder.calls == 3
    assert recorder.sleeps == [0.5, 1.5]


def test_persistent_500_raises_after_three_attempts() -> None:
    recorder = _Recorder([httpx.Response(503, json={"error": "MOCK_SERVICE_DOWN"})])
    with pytest.raises(ExternalServiceUnavailable) as excinfo:
        _client(recorder).get("benefits", "/mock/v1/benefits/active")
    assert excinfo.value.service == "benefits"
    assert excinfo.value.attempts == 3
    assert recorder.calls == 3
    assert recorder.sleeps == [0.5, 1.5]


def test_client_error_is_not_retried() -> None:
    recorder = _Recorder([httpx.Response(404, json={"error": "NOT_FOUND"})])
    with pytest.raises(ExternalServiceUnavailable) as excinfo:
        _client(recorder).get("civil", "/mock/v1/civil/death-records")
    assert excinfo.value.attempts == 1
    assert recorder.calls == 1
    assert recorder.sleeps == []


def test_timeout_is_retried_then_raises() -> None:
    recorder = _Recorder([httpx.ReadTimeout("slow")])
    with pytest.raises(ExternalServiceUnavailable) as excinfo:
        _client(recorder).get("identity", "/mock/v1/identity/lookup")
    assert excinfo.value.attempts == 3
    assert "ReadTimeout" in excinfo.value.detail
    assert recorder.calls == 3


def test_timeout_then_success() -> None:
    recorder = _Recorder(
        [httpx.ConnectError("refused"), httpx.Response(200, json={"ok": True})]
    )
    assert _client(recorder).get("identity", "/mock/v1/identity/lookup") == {"ok": True}
    assert recorder.sleeps == [0.5]


def test_post_sends_the_idempotency_header() -> None:
    seen: dict[str, str] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["key"] = request.headers.get("Idempotency-Key", "")
        seen["body"] = request.content.decode()
        return httpx.Response(200, json={"status": "COMPLETED"})

    client = MockClient("http://mock.test", transport=httpx.MockTransport(handler))
    payload = client.post(
        "payment",
        "/mock/v1/payments/transfer",
        json={"amount_pkr": 15000},
        headers={"Idempotency-Key": "pay-1"},
    )
    assert payload == {"status": "COMPLETED"}
    assert seen["key"] == "pay-1"
    assert "15000" in seen["body"]


def test_non_object_json_is_wrapped() -> None:
    recorder = _Recorder([httpx.Response(200, json=[1, 2, 3])])
    assert _client(recorder).get("identity", "/mock/v1/identity/lookup") == {
        "data": [1, 2, 3]
    }


def test_trailing_slash_in_base_url_is_normalised() -> None:
    recorder = _Recorder([httpx.Response(200, json={"ok": True})])
    client = MockClient(
        "http://mock.test/",
        transport=httpx.MockTransport(recorder.handler),
        sleep=recorder.sleep,
    )
    assert client.get("identity", "/mock/v1/identity/lookup") == {"ok": True}


def test_client_is_a_context_manager() -> None:
    recorder = _Recorder([httpx.Response(200, json={"ok": True})])
    with _client(recorder) as client:
        assert client.get("identity", "/mock/v1/identity/lookup") == {"ok": True}
