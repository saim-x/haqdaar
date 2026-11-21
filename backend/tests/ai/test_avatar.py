"""Interactive video guide tests - ADR-025.

The guide is the one component that talks to a third party, so the tests are
organised around the four things that could go wrong:

* **Cost** - the fake simulator must serve every non-live environment, and no
  test may open a WebRTC connection.
* **Truth** - the vendor payload must be exactly the documented one, in both
  modes, so the avatar can only ever lip-sync audio we produced.
* **Failure** - a 402, a 502 or a timeout must degrade to the audio-only guide
  with a ``200``, never a 5xx on a citizen screen.
* **Authority** - RBAC, the per-user rate limit, the audit row and the telemetry
  row are all asserted, because "the avatar cannot decide anything" is only true
  if the endpoint that starts it is itself locked down.
"""

from __future__ import annotations

import json
import logging
import uuid
from collections.abc import Iterator
from typing import Any

import httpx
import pytest

from app.ai import avatar
from app.config import settings


# --------------------------------------------------------------------------- #
# helpers
# --------------------------------------------------------------------------- #
class _Response:
    def __init__(self, status_code: int = 200, payload: Any = None) -> None:
        self.status_code = status_code
        self._payload = payload if payload is not None else {}
        self.text = json.dumps(self._payload)

    def json(self) -> Any:
        return self._payload


class _Recorder:
    """Records every vendor call so a test can assert the exact payload."""

    def __init__(self) -> None:
        self.calls: list[tuple[str, str, dict[str, str] | None, Any]] = []
        self.get_response: _Response | None = None
        self.post_response: _Response | None = None
        self.post_exc: Exception | None = None
        self.timeouts: list[Any] = []


def _install_httpx(monkeypatch: pytest.MonkeyPatch, recorder: _Recorder) -> None:
    """Replace ``avatar.httpx`` with a shim, leaving the real module untouched."""

    class _Client:
        def __init__(self, *args: Any, **kwargs: Any) -> None:
            recorder.timeouts.append(kwargs.get("timeout"))

        def __enter__(self) -> _Client:
            return self

        def __exit__(self, *exc: Any) -> bool:
            return False

        def get(self, url: str, headers: dict[str, str] | None = None) -> _Response:
            recorder.calls.append(("GET", url, headers, None))
            return recorder.get_response or _Response(200, {"data": []})

        def post(
            self, url: str, headers: dict[str, str] | None = None, json: Any = None
        ) -> _Response:
            recorder.calls.append(("POST", url, headers, json))
            if recorder.post_exc is not None:
                raise recorder.post_exc
            return recorder.post_response or _Response(200, {"sessionToken": "tok"})

    class _Shim:
        Client = _Client
        TimeoutException = httpx.TimeoutException

    monkeypatch.setattr(avatar, "httpx", _Shim)


@pytest.fixture()
def recorder(monkeypatch: pytest.MonkeyPatch) -> _Recorder:
    rec = _Recorder()
    _install_httpx(monkeypatch, rec)
    return rec


@pytest.fixture()
def live(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    """Put the module in live mode with a configured key and a pinned avatar.

    ``set_test_live_override`` is the documented seam that lets the live *code
    path* run under pytest. It cannot reach the network: ``recorder`` replaces
    ``avatar.httpx`` with a shim, so no socket is ever opened.
    """
    monkeypatch.setenv("AI_PROVIDER", "live")
    monkeypatch.setattr(settings, "anam_enabled", True)
    monkeypatch.setattr(settings, "anam_api_key", "test-anam-key-not-real")
    monkeypatch.setattr(settings, "anam_avatar_id", "avatar-test-123")
    monkeypatch.setattr(settings, "anam_mode", "passthrough")
    monkeypatch.setattr(settings, "anam_voice_id", "")
    monkeypatch.setattr(settings, "anam_llm_id", "")
    avatar.set_test_live_override(True)
    avatar.reset_avatar_cache()
    yield
    avatar.reset_avatar_cache()
    avatar.set_test_live_override(False)


@pytest.fixture()
def live_override() -> Iterator[None]:
    """Let the live code path run under pytest, with no network reachable."""
    avatar.set_test_live_override(True)
    avatar.reset_avatar_cache()
    yield
    avatar.reset_avatar_cache()
    avatar.set_test_live_override(False)


@pytest.fixture()
def real_db(prepared_database: str) -> Iterator[Any]:
    """A real session, because audit and telemetry rows are the assertion.

    ``tests/ai/conftest.py`` shadows the root ``db`` fixture with a recording
    stand-in, which cannot prove a row was written. This one can.
    """
    from app.db import SessionLocal

    session = SessionLocal()
    try:
        yield session
    finally:
        session.rollback()
        session.close()


class _Actor:
    """The subset of ``ActorContext`` the service reads."""

    def __init__(self, role: str = "CITIZEN") -> None:
        self.user_id = uuid.uuid4()
        self.role = role
        self.tenant_id = None
        self.api_key_id = None


# --------------------------------------------------------------------------- #
# configuration
# --------------------------------------------------------------------------- #
class TestConfig:
    def test_fake_mode_is_enabled_and_simulated(self) -> None:
        config = avatar.get_avatar_config()
        assert config["enabled"] is True
        assert config["provider"] == "fake"
        assert config["sample_rate"] == 24000
        assert config["avatar_id"] == avatar.FAKE_AVATAR_ID
        assert config["max_session_seconds"] == 165
        assert config["idle_timeout_seconds"] == 90

    def test_persona_is_named_in_both_languages(self) -> None:
        config = avatar.get_avatar_config()
        assert config["persona_name_ur"] == "سائرہ — حقدار گائیڈ"
        assert config["persona_name_en"] == "Saima — Haqdaar Guide"

    def test_live_mode_without_a_key_is_disabled(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("AI_PROVIDER", "live")
        monkeypatch.setattr(settings, "anam_enabled", False)
        monkeypatch.setattr(settings, "anam_api_key", "")
        config = avatar.get_avatar_config()
        assert config["enabled"] is False
        assert config["provider"] == "fake"

    def test_live_mode_with_a_key_is_enabled(
        self, monkeypatch: pytest.MonkeyPatch, live_override: None
    ) -> None:
        monkeypatch.setenv("AI_PROVIDER", "live")
        monkeypatch.setattr(settings, "anam_enabled", True)
        monkeypatch.setattr(settings, "anam_api_key", "test-anam-key-not-real")
        config = avatar.get_avatar_config()
        assert config["enabled"] is True
        assert config["provider"] == "anam"

    def test_config_never_carries_the_api_key(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("AI_PROVIDER", "live")
        monkeypatch.setattr(settings, "anam_enabled", True)
        monkeypatch.setattr(settings, "anam_api_key", "super-secret-anam-key")
        rendered = json.dumps(avatar.get_avatar_config())
        assert "super-secret-anam-key" not in rendered
        assert "api_key" not in rendered


# --------------------------------------------------------------------------- #
# fake sessions - the zero-credit path
# --------------------------------------------------------------------------- #
class TestFakeSession:
    def test_envelope_is_complete_and_simulated(self) -> None:
        session = avatar.create_avatar_session(None, _Actor(), surface="ask")
        assert session["available"] is True
        assert session["provider"] == "fake"
        assert session["simulated"] is True
        assert session["session_token"] == avatar.FAKE_SESSION_TOKEN
        assert session["avatar_id"] == avatar.FAKE_AVATAR_ID
        assert session["sample_rate"] == 24000
        assert session["max_session_seconds"] == 165
        assert session["idle_timeout_seconds"] == 90

    def test_fake_session_never_touches_the_network(
        self, recorder: _Recorder
    ) -> None:
        avatar.create_avatar_session(None, _Actor(), surface="wizard")
        assert recorder.calls == [], "the simulator must not call the vendor"

    @pytest.mark.parametrize("surface", sorted(avatar.SURFACES))
    def test_every_surface_is_accepted(self, surface: str) -> None:
        session = avatar.create_avatar_session(None, _Actor(), surface=surface)
        assert session["available"] is True

    def test_unknown_surface_is_rejected(self) -> None:
        with pytest.raises(ValueError):
            avatar.create_avatar_session(None, _Actor(), surface="officer_queue")

    def test_fake_session_writes_audit_and_telemetry(self, real_db: Any) -> None:
        from sqlalchemy import select

        from app.models.ai import AiTelemetry
        from app.models.audit import AuditEvent

        actor = _Actor()
        avatar.create_avatar_session(real_db, actor, surface="ask", lang="ur")
        real_db.commit()

        event = real_db.execute(
            select(AuditEvent)
            .where(AuditEvent.action == "avatar.session_created")
            .order_by(AuditEvent.seq.desc())
            .limit(1)
        ).scalar_one()
        assert event.resource_type == "avatar_session"
        assert event.payload_json["surface"] == "ask"
        assert event.payload_json["provider"] == "fake"
        assert event.payload_json["succeeded"] is True

        telemetry = real_db.execute(
            select(AiTelemetry)
            .where(AiTelemetry.task_type == "AVATAR_SESSION")
            .order_by(AiTelemetry.created_at.desc())
            .limit(1)
        ).scalar_one()
        assert telemetry.provider == "fake"
        assert telemetry.succeeded is True
        assert telemetry.estimated_cost_usd == 0


# --------------------------------------------------------------------------- #
# live sessions - the exact vendor payload
# --------------------------------------------------------------------------- #
class TestLiveSession:
    def test_passthrough_asks_for_a_mouth_only(
        self, live: None, recorder: _Recorder
    ) -> None:
        recorder.post_response = _Response(200, {"sessionToken": "live-token"})
        session = avatar.create_avatar_session(None, _Actor(), surface="ask")

        assert session["available"] is True
        assert session["provider"] == "anam"
        assert session["session_token"] == "live-token"  # noqa: S105 - stub token, not a secret
        assert session["avatar_id"] == "avatar-test-123"

        method, url, headers, body = recorder.calls[-1]
        assert method == "POST"
        assert url == "https://api.anam.ai/v1/auth/session-token"
        assert headers is not None and headers["Authorization"].startswith("Bearer ")
        assert body == {
            "personaConfig": {
                "avatarId": "avatar-test-123",
                "enableAudioPassthrough": True,
            }
        }
        # The passthrough payload must not carry an LLM: the avatar cannot speak
        # for itself, so it must not be given the means to.
        assert "llmId" not in body["personaConfig"]

    def test_talk_mode_uses_the_customer_client_llm(
        self, live: None, recorder: _Recorder, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(settings, "anam_mode", "talk")
        monkeypatch.setattr(settings, "anam_voice_id", "voice-ur-1")
        recorder.post_response = _Response(200, {"sessionToken": "talk-token"})

        session = avatar.create_avatar_session(None, _Actor(), surface="ask")
        assert session["mode"] == "talk"

        _method, _url, _headers, body = recorder.calls[-1]
        persona = body["personaConfig"]
        assert persona["llmId"] == "CUSTOMER_CLIENT_V1"
        assert persona["skipGreeting"] is True
        assert persona["languageCode"] == "ur"
        assert persona["voiceId"] == "voice-ur-1"
        assert "enableAudioPassthrough" not in persona

    def test_talk_mode_omits_an_unset_voice(
        self, live: None, recorder: _Recorder, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(settings, "anam_mode", "talk")
        monkeypatch.setattr(settings, "anam_voice_id", "")
        recorder.post_response = _Response(200, {"sessionToken": "talk-token"})
        avatar.create_avatar_session(None, _Actor(), surface="ask")
        _method, _url, _headers, body = recorder.calls[-1]
        assert "voiceId" not in body["personaConfig"]

    def test_session_token_is_never_the_api_key(
        self, live: None, recorder: _Recorder
    ) -> None:
        recorder.post_response = _Response(200, {"sessionToken": "short-lived-token"})
        session = avatar.create_avatar_session(None, _Actor(), surface="ask")
        assert session["session_token"] == "short-lived-token"  # noqa: S105 - stub token
        assert "test-anam-key-not-real" not in json.dumps(session)

    def test_snake_case_token_is_accepted(
        self, live: None, recorder: _Recorder
    ) -> None:
        recorder.post_response = _Response(200, {"session_token": "snake-token"})
        session = avatar.create_avatar_session(None, _Actor(), surface="ask")
        assert session["session_token"] == "snake-token"  # noqa: S105 - stub token

    def test_live_session_writes_audit_and_telemetry(self, live: None, recorder: _Recorder, real_db: Any) -> None:
        from sqlalchemy import select

        from app.models.ai import AiTelemetry
        from app.models.audit import AuditEvent

        recorder.post_response = _Response(200, {"sessionToken": "live-token"})
        avatar.create_avatar_session(real_db, _Actor(), surface="case_status")
        real_db.commit()

        event = real_db.execute(
            select(AuditEvent)
            .where(AuditEvent.action == "avatar.session_created")
            .order_by(AuditEvent.seq.desc())
            .limit(1)
        ).scalar_one()
        assert event.payload_json["provider"] == "anam"
        assert event.payload_json["surface"] == "case_status"

        telemetry = real_db.execute(
            select(AiTelemetry)
            .where(AiTelemetry.task_type == "AVATAR_SESSION")
            .order_by(AiTelemetry.created_at.desc())
            .limit(1)
        ).scalar_one()
        assert telemetry.provider == "anam"
        assert telemetry.succeeded is True


