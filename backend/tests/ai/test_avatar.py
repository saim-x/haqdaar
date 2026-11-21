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


# --------------------------------------------------------------------------- #
# graceful degradation
# --------------------------------------------------------------------------- #
class TestDegradation:
    @pytest.mark.parametrize(
        ("status", "reason"),
        [
            (402, "QUOTA_EXHAUSTED"),
            (429, "RATE_LIMITED"),
            (401, "AUTH_FAILED"),
            (502, "PROVIDER_ERROR"),
            (500, "PROVIDER_ERROR"),
        ],
    )
    def test_http_errors_degrade_to_audio_only(
        self, live: None, recorder: _Recorder, status: int, reason: str
    ) -> None:
        recorder.post_response = _Response(status, {"error": "nope"})
        session = avatar.create_avatar_session(None, _Actor(), surface="ask")
        assert session["available"] is False
        assert session["fallback"] == "AUDIO_ONLY"
        assert session["reason"] == reason
        assert session["message_ur"] == avatar.DEGRADED_MESSAGE_UR
        assert session["message_en"] == avatar.DEGRADED_MESSAGE_EN

    def test_timeout_degrades(self, live: None, recorder: _Recorder) -> None:
        recorder.post_exc = httpx.TimeoutException("slow")
        session = avatar.create_avatar_session(None, _Actor(), surface="ask")
        assert session["available"] is False
        assert session["reason"] == "TIMEOUT"

    def test_transport_error_degrades(self, live: None, recorder: _Recorder) -> None:
        recorder.post_exc = httpx.ConnectError("down")
        session = avatar.create_avatar_session(None, _Actor(), surface="ask")
        assert session["available"] is False
        assert session["fallback"] == "AUDIO_ONLY"

    def test_missing_token_degrades(self, live: None, recorder: _Recorder) -> None:
        recorder.post_response = _Response(200, {"unexpected": True})
        session = avatar.create_avatar_session(None, _Actor(), surface="ask")
        assert session["available"] is False
        assert session["reason"] == "NO_TOKEN"

    def test_failure_is_recorded_in_telemetry(self, live: None, recorder: _Recorder, real_db: Any) -> None:
        from sqlalchemy import select

        from app.models.ai import AiTelemetry

        recorder.post_response = _Response(402, {"error": "quota"})
        avatar.create_avatar_session(real_db, _Actor(), surface="ask")
        real_db.commit()

        telemetry = real_db.execute(
            select(AiTelemetry)
            .where(AiTelemetry.task_type == "AVATAR_SESSION")
            .order_by(AiTelemetry.created_at.desc())
            .limit(1)
        ).scalar_one()
        assert telemetry.succeeded is False
        assert telemetry.error_code == "QUOTA_EXHAUSTED"

    def test_degraded_envelope_is_bilingual(self, live: None, recorder: _Recorder) -> None:
        recorder.post_response = _Response(502, {})
        session = avatar.create_avatar_session(None, _Actor(), surface="ask")
        assert any("؀" <= ch <= "ۿ" for ch in session["message_ur"])
        assert session["message_en"].strip()


# --------------------------------------------------------------------------- #
# avatar discovery
# --------------------------------------------------------------------------- #
class TestAvatarDiscovery:
    def test_prefers_a_named_stock_avatar(
        self, live: None, recorder: _Recorder, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(settings, "anam_avatar_id", "")
        recorder.get_response = _Response(
            200,
            {
                "data": [
                    {"id": "id-simon", "displayName": "Simon"},
                    {"id": "id-mia", "displayName": "Mia"},
                    {"id": "id-layla", "displayName": "Layla"},
                ]
            },
        )
        # Preference order is Cara, Layla, Mia, Sophie, Julia - Layla outranks Mia.
        assert avatar.resolve_avatar_id() == "id-layla"

    def test_prefers_the_first_available_name_in_the_list(
        self, live: None, recorder: _Recorder, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(settings, "anam_avatar_id", "")
        recorder.get_response = _Response(
            200,
            {
                "data": [
                    {"id": "id-simon", "displayName": "Simon"},
                    {"id": "id-mia", "displayName": "Mia"},
                ]
            },
        )
        assert avatar.resolve_avatar_id() == "id-mia"

    def test_falls_back_to_the_first_avatar(
        self, live: None, recorder: _Recorder, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(settings, "anam_avatar_id", "")
        recorder.get_response = _Response(
            200, {"data": [{"id": "id-first", "displayName": "Someone"}]}
        )
        assert avatar.resolve_avatar_id() == "id-first"

    def test_discovery_is_cached(
        self, live: None, recorder: _Recorder, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(settings, "anam_avatar_id", "")
        recorder.get_response = _Response(
            200, {"data": [{"id": "id-mia", "displayName": "Mia"}]}
        )
        avatar.resolve_avatar_id()
        avatar.resolve_avatar_id()
        assert len([call for call in recorder.calls if call[0] == "GET"]) == 1

    def test_discovery_failure_degrades(
        self, live: None, recorder: _Recorder, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(settings, "anam_avatar_id", "")
        recorder.get_response = _Response(500, {})
        assert avatar.resolve_avatar_id() == ""
        session = avatar.create_avatar_session(None, _Actor(), surface="ask")
        assert session["available"] is False
        assert session["reason"] == "NO_AVATAR"

    def test_configured_avatar_skips_discovery(
        self, live: None, recorder: _Recorder
    ) -> None:
        assert avatar.resolve_avatar_id() == "avatar-test-123"
        assert recorder.calls == []


# --------------------------------------------------------------------------- #
# secrets
# --------------------------------------------------------------------------- #
class TestSecrets:
    def test_api_key_never_reaches_a_log_record(
        self, live: None, recorder: _Recorder, caplog: pytest.LogCaptureFixture
    ) -> None:
        caplog.set_level(logging.DEBUG)
        recorder.post_response = _Response(502, {})
        avatar.create_avatar_session(None, _Actor(), surface="ask")
        recorder.post_exc = httpx.ConnectError("down")
        avatar.create_avatar_session(None, _Actor(), surface="ask")
        assert "test-anam-key-not-real" not in caplog.text

    def test_session_token_never_reaches_a_log_record(
        self, live: None, recorder: _Recorder, caplog: pytest.LogCaptureFixture
    ) -> None:
        caplog.set_level(logging.DEBUG)
        recorder.post_response = _Response(200, {"sessionToken": "tok-should-stay-secret"})
        avatar.create_avatar_session(None, _Actor(), surface="ask")
        assert "tok-should-stay-secret" not in caplog.text


# --------------------------------------------------------------------------- #
# HTTP surface - RBAC, rate limit, envelope
# --------------------------------------------------------------------------- #
class TestApi:
    def test_config_requires_authentication(self, client: Any) -> None:
        response = client.get("/api/v1/avatar/config")
        assert response.status_code == 401

    def test_session_requires_authentication(self, client: Any) -> None:
        response = client.post("/api/v1/avatar/session", json={"surface": "ask"})
        assert response.status_code == 401

    def test_citizen_can_read_the_config(
        self, client: Any, citizen_headers: dict[str, str]
    ) -> None:
        response = client.get("/api/v1/avatar/config", headers=citizen_headers)
        assert response.status_code == 200
        body = response.json()
        assert body["provider"] == "fake"
        assert body["enabled"] is True
        assert "api_key" not in body

    def test_helper_can_read_the_config(
        self, client: Any, helper_headers: dict[str, str]
    ) -> None:
        response = client.get("/api/v1/avatar/config", headers=helper_headers)
        assert response.status_code == 200

    @pytest.mark.parametrize("persona", ["officer_sana", "admin_bilal", "auditor_nadia"])
    def test_staff_roles_cannot_open_a_guide_session(
        self, client: Any, persona_headers: Any, persona: str
    ) -> None:
        headers = persona_headers(persona)
        response = client.post(
            "/api/v1/avatar/session", json={"surface": "ask"}, headers=headers
        )
        assert response.status_code == 403, response.text

    @pytest.mark.parametrize("persona", ["widow_fatima", "helper_ayesha"])
    def test_citizen_and_helper_can_open_a_guide_session(
        self, client: Any, persona_headers: Any, persona: str
    ) -> None:
        headers = persona_headers(persona)
        response = client.post(
            "/api/v1/avatar/session", json={"surface": "ask"}, headers=headers
        )
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["available"] is True
        assert body["provider"] == "fake"
        assert body["simulated"] is True

    def test_unknown_surface_is_a_422(
        self, client: Any, citizen_headers: dict[str, str]
    ) -> None:
        response = client.post(
            "/api/v1/avatar/session",
            json={"surface": "officer_queue"},
            headers=citizen_headers,
        )
        assert response.status_code == 422
        assert response.json()["error"]["code"] == "UNSUPPORTED_SURFACE"

    def test_eleventh_session_in_ten_minutes_is_rate_limited(
        self, client: Any, citizen_headers: dict[str, str], monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from app.security import ratelimit

        monkeypatch.setattr(settings, "rate_limit_enabled", True)
        ratelimit.limiter.reset()
        try:
            statuses = [
                client.post(
                    "/api/v1/avatar/session",
                    json={"surface": "ask"},
                    headers=citizen_headers,
                ).status_code
                for _ in range(11)
            ]
        finally:
            ratelimit.limiter.reset()
        assert statuses[:10] == [200] * 10
        assert statuses[10] == 429

    def test_session_response_never_contains_the_api_key(
        self, client: Any, citizen_headers: dict[str, str]
    ) -> None:
        response = client.post(
            "/api/v1/avatar/session", json={"surface": "ask"}, headers=citizen_headers
        )
        assert settings.anam_api_key not in response.text


# --------------------------------------------------------------------------- #
# conversational mode - true two-way Urdu, grounded by the live rule version
# --------------------------------------------------------------------------- #
class TestConversationalMode:
    """The mode that gives a low-literacy citizen a real conversation.

    Two things must hold at once: the vendor must receive enough to hold a
    conversation (a model, a voice, a prompt), and it must receive nothing that
    could let it invent a decision or leak a citizen. The prompt is the whole
    contract, so most of these tests are about the prompt.
    """

    def test_persona_carries_llm_voice_and_prompt(
        self, live: None, recorder: _Recorder, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(settings, "anam_mode", "conversational")
        monkeypatch.setattr(settings, "anam_voice_id", "voice-test-1")
        monkeypatch.setattr(settings, "anam_llm_id", "llm-test-1")
        recorder.post_response = _Response(200, {"sessionToken": "conv-token"})

        session = avatar.create_avatar_session(None, _Actor(), surface="ask")

        assert session["available"] is True
        assert session["mode"] == "conversational"
        assert session["conversational"] is True

        _method, _url, _headers, body = recorder.calls[-1]
        persona = body["personaConfig"]
        assert persona["avatarId"] == "avatar-test-123"
        assert persona["llmId"] == "llm-test-1"
        assert persona["voiceId"] == "voice-test-1"
        assert persona["languageCode"] == "ur"
        assert persona["name"] == "Saima — Haqdaar Guide"
        assert persona["maxSessionLengthSeconds"] == settings.anam_max_session_seconds
        assert persona["skipGreeting"] is True
        assert "systemPrompt" in persona
        # Conversational mode is the one place the vendor gets text, so it must
        # never also be handed the passthrough switch.
        assert "enableAudioPassthrough" not in persona

    def test_persona_never_uses_the_disable_llm_sentinel(
        self, live: None, recorder: _Recorder, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(settings, "anam_mode", "conversational")
        monkeypatch.setattr(settings, "anam_llm_id", "llm-test-1")
        recorder.post_response = _Response(200, {"sessionToken": "conv-token"})
        avatar.create_avatar_session(None, _Actor(), surface="ask")
        _method, _url, _headers, body = recorder.calls[-1]
        assert body["personaConfig"]["llmId"] == "llm-test-1"
        assert body["personaConfig"]["llmId"] != avatar.DISABLED_LLM_ID

    def test_blank_ids_are_omitted_so_the_vendor_uses_its_defaults(
        self, live: None, recorder: _Recorder, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(settings, "anam_mode", "conversational")
        recorder.post_response = _Response(200, {"sessionToken": "conv-token"})
        avatar.create_avatar_session(None, _Actor(), surface="ask")
        _method, _url, _headers, body = recorder.calls[-1]
        persona = body["personaConfig"]
        assert "llmId" not in persona
        assert "voiceId" not in persona
        assert persona["avatarId"] == "avatar-test-123"

    def test_english_surface_switches_the_language_code(
        self, live: None, recorder: _Recorder, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(settings, "anam_mode", "conversational")
        recorder.post_response = _Response(200, {"sessionToken": "conv-token"})
        avatar.create_avatar_session(None, _Actor(), surface="ask", lang="en")
        _method, _url, _headers, body = recorder.calls[-1]
        assert body["personaConfig"]["languageCode"] == "en"
        assert "English" in body["personaConfig"]["systemPrompt"]

    def test_prompt_quotes_the_live_rule_version(self, real_db: Any) -> None:
        prompt = avatar.build_saima_system_prompt(real_db, "ask", "ur")
        # The seeded Sahara grant: 40,000 income cap, 12,000 base, 1,000/child.
        assert "40,000" in prompt
        assert "12,000" in prompt
        assert "1,000" in prompt
        assert "20,000" in prompt
        assert "Thatta" in prompt

    def test_prompt_follows_a_published_rule_change(self, real_db: Any) -> None:
        """A published v2 must reach Saima's very next sentence."""
        from sqlalchemy import select

        from app.models.programs import Program, RuleVersion

        program = real_db.execute(
            select(Program).where(Program.code == avatar.PROGRAM_CODE)
        ).scalar_one()
        original_id = program.active_rule_version_id
        original = real_db.execute(
            select(RuleVersion).where(RuleVersion.id == original_id)
        ).scalar_one()
        original_rules = original.rules_json

        changed = json.loads(json.dumps(original_rules))
        for rule in changed["eligibility_rules"]:
            if rule.get("fact") == "monthly_income_pkr":
                rule["value"] = 35000
        changed["benefit_formula"]["per_child_bonus_pkr"] = 1500

        candidate = RuleVersion(
            tenant_id=program.tenant_id,
            program_id=program.id,
            version_number=9999,
            status="PUBLISHED",
            rules_json=changed,
            content_hash="0" * 64,
            change_note="test-only candidate",
            created_by_user_id=original.created_by_user_id,
        )
        real_db.add(candidate)
        real_db.flush()
        program.active_rule_version_id = candidate.id
        real_db.flush()
        try:
            prompt = avatar.build_saima_system_prompt(real_db, "ask", "ur")
            assert "35,000" in prompt
            assert "1,500" in prompt
            assert "40,000" not in prompt
        finally:
            real_db.rollback()

    def test_prompt_carries_no_citizen_data(self, real_db: Any) -> None:
        import re

        prompt = avatar.build_saima_system_prompt(real_db, "case_status", "ur")
        assert not re.search(r"\d{5}-\d{7}-\d", prompt)
        assert "99900" not in prompt
        assert not re.search(r"03\d{2}[- ]?\d{7}", prompt)
        # No case, decision or amount belonging to a person.
        assert "APPROVED" not in prompt
        assert "REJECTED" not in prompt

    def test_prompt_states_the_three_hard_rules(self, real_db: Any) -> None:
        prompt = avatar.build_saima_system_prompt(real_db, "ask", "ur")
        assert "NEVER tell a user she is approved" in prompt
        assert "NEVER ask for CNIC digits" in prompt
        assert avatar.ABSTENTION_UR in prompt
        assert "NEVER auto-rejects" in prompt

    def test_prompt_names_the_surface(self, real_db: Any) -> None:
        for surface, hint in (
            ("ask", "policy question screen"),
            ("case_status", "case status screen"),
            ("wizard", "application wizard"),
            ("scam_check", "scam-check screen"),
        ):
            prompt = avatar.build_saima_system_prompt(real_db, surface, "ur")
            assert hint in prompt

    def test_prompt_omits_every_number_when_rules_are_unreadable(self) -> None:
        """Unknown is a first-class value: no rules means no quoted amounts."""
        prompt = avatar.build_saima_system_prompt(None, "ask", "ur")
        assert "could not be read" in prompt
        assert "Do NOT quote any amount" in prompt
        assert "40,000" not in prompt
        assert "12,000" not in prompt

    def test_prompt_stays_inside_the_spoken_budget(self, real_db: Any) -> None:
        prompt = avatar.build_saima_system_prompt(real_db, "ask", "ur")
        assert 1200 <= len(prompt) <= 2600

    def test_prompt_survives_a_broken_session(self) -> None:
        class _Broken:
            def execute(self, *_args: Any, **_kwargs: Any) -> Any:
                raise RuntimeError("database is on fire")

        prompt = avatar.build_saima_system_prompt(_Broken(), "ask", "ur")
        assert "could not be read" in prompt


class TestVoiceAndLlmDiscovery:
    """The two ids conversational mode needs, resolved once and cached."""

    def test_voice_prefers_urdu(self) -> None:
        voices = [
            {"id": "en-1", "displayName": "Amanda - Warm Guide", "languages": ["en"]},
            {"id": "ur-1", "displayName": "Urdu Voice", "languages": ["ur"]},
        ]
        assert avatar._pick_voice(voices) == "ur-1"

    def test_voice_falls_back_to_hindi(self) -> None:
        """Hindi and Urdu are the same spoken language, so it beats English."""
        voices = [
            {"id": "en-1", "displayName": "Amanda - Warm Guide", "languages": ["en"]},
            {"id": "hi-1", "displayName": "Hindi Voice", "languages": ["hi"]},
        ]
        assert avatar._pick_voice(voices) == "hi-1"

    def test_voice_falls_back_to_a_warm_female_name(self) -> None:
        voices = [
            {"id": "m-1", "displayName": "Archie", "gender": "MALE", "languages": ["en"]},
            {"id": "f-1", "displayName": "Amanda - Warm Guide", "gender": "FEMALE"},
        ]
        assert avatar._pick_voice(voices) == "f-1"

    def test_voice_falls_back_to_any_female_then_any(self) -> None:
        assert avatar._pick_voice([{"id": "x", "gender": "FEMALE"}]) == "x"
        assert avatar._pick_voice([{"id": "y", "gender": "MALE"}]) == "y"
        assert avatar._pick_voice([]) == ""

    def test_llm_skips_the_disable_sentinel(self) -> None:
        llms = [
            {"id": avatar.DISABLED_LLM_ID, "displayTags": ["persona-default"]},
            {"id": "real-llm", "displayTags": ["recommended"]},
        ]
        assert avatar._pick_llm(llms) == "real-llm"

    def test_llm_prefers_the_persona_default_tag(self) -> None:
        llms = [
            {"id": "a", "isDefault": True},
            {"id": "b", "displayTags": ["persona-default"]},
        ]
        assert avatar._pick_llm(llms) == "b"

    def test_llm_falls_back_to_is_default_then_first(self) -> None:
        assert avatar._pick_llm([{"id": "a"}, {"id": "b", "isDefault": True}]) == "b"
        assert avatar._pick_llm([{"id": "a"}, {"id": "b"}]) == "a"
        assert avatar._pick_llm([]) == ""

    def test_voice_is_discovered_once_and_cached(
        self, live: None, recorder: _Recorder
    ) -> None:
        recorder.get_response = _Response(
            200, {"data": [{"id": "voice-1", "languages": ["ur"]}]}
        )
        assert avatar.resolve_voice_id() == "voice-1"
        assert avatar.resolve_voice_id() == "voice-1"
        assert len([call for call in recorder.calls if call[1].endswith("/v1/voices")]) == 1

    def test_llm_is_discovered_once_and_cached(
        self, live: None, recorder: _Recorder
    ) -> None:
        recorder.get_response = _Response(
            200, {"data": [{"id": "llm-1", "displayTags": ["persona-default"]}]}
        )
        assert avatar.resolve_llm_id() == "llm-1"
        assert avatar.resolve_llm_id() == "llm-1"
        assert len([call for call in recorder.calls if call[1].endswith("/v1/llms")]) == 1

    def test_configured_ids_win_over_discovery(
        self, live: None, recorder: _Recorder, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(settings, "anam_voice_id", "pinned-voice")
        monkeypatch.setattr(settings, "anam_llm_id", "pinned-llm")
        assert avatar.resolve_voice_id() == "pinned-voice"
        assert avatar.resolve_llm_id() == "pinned-llm"
        assert recorder.calls == []

    def test_discovery_failure_degrades_to_blank(
        self, live: None, recorder: _Recorder
    ) -> None:
        recorder.get_response = _Response(500, {})
        assert avatar.resolve_voice_id() == ""
        assert avatar.resolve_llm_id() == ""

    def test_discovery_transport_error_degrades_to_blank(
        self, live: None, recorder: _Recorder, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        def _boom(*_args: Any, **_kwargs: Any) -> Any:
            raise httpx.ConnectError("no route to host")

        monkeypatch.setattr(avatar.httpx, "Client", _boom)
        assert avatar.resolve_voice_id() == ""


