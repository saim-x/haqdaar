"""RBAC on the AI endpoints (docs/05 §3.9).

These three routes were serving anonymous callers through an optional-auth shim,
which BE recorded in ``tests/test_invariants.py::AUTH_GAP_ALLOWLIST``. They now
depend on the real ``app.security.rbac`` guards:

* ``POST /rag/ask`` and ``POST /voice/tts`` - any authenticated caller;
* ``POST /voice/transcribe-parse`` - ``CITIZEN`` or ``HELPER`` only.

The tests assert the *gate*, not the feature: an authorised caller may still get
a 4xx for a malformed body, but never 401/403.
"""

from __future__ import annotations

from typing import Any

import pytest

RAG_ASK = "/api/v1/rag/ask"
VOICE_TTS = "/api/v1/voice/tts"
VOICE_TRANSCRIBE = "/api/v1/voice/transcribe-parse"

#: A tiny, obviously-not-audio payload. The gate must reject before parsing it.
FAKE_AUDIO = ("answer.webm", b"\x1a\x45\xdf\xa3not-really-audio", "audio/webm")


def _transcribe(client: Any, headers: dict[str, str] | None = None) -> Any:
    return client.post(
        VOICE_TRANSCRIBE,
        files={"audio": FAKE_AUDIO},
        data={"field_key": "monthly_income_pkr", "lang": "ur"},
        headers=headers or {},
    )


class TestAnonymousIsRejected:
    @pytest.mark.parametrize(
        ("method", "path", "body"),
        [
            ("post", RAG_ASK, {"question": "Sahara grant kitna milta hai?"}),
            ("post", VOICE_TTS, {"text": "آپ کی درخواست منظور ہو گئی۔"}),
        ],
    )
    def test_ai_routes_require_a_token(
        self, client: Any, method: str, path: str, body: dict[str, Any]
    ) -> None:
        response = getattr(client, method)(path, json=body)
        assert response.status_code == 401, response.text

    def test_transcribe_parse_requires_a_token(self, client: Any) -> None:
        response = _transcribe(client)
        assert response.status_code == 401, response.text


class TestRoleGates:
    def test_transcribe_parse_rejects_an_officer(
        self, client: Any, persona_headers: Any
    ) -> None:
        """docs/05 §3.9 scopes spoken answers to CITIZEN and HELPER."""
        response = _transcribe(client, persona_headers("officer_sana"))
        assert response.status_code == 403, response.text

    def test_transcribe_parse_admits_a_citizen(
        self, client: Any, citizen_headers: dict[str, str]
    ) -> None:
        response = _transcribe(client, citizen_headers)
        assert response.status_code not in {401, 403}, response.text

    def test_transcribe_parse_admits_a_helper(
        self, client: Any, helper_headers: dict[str, str]
    ) -> None:
        response = _transcribe(client, helper_headers)
        assert response.status_code not in {401, 403}, response.text


class TestAnyAuthenticatedRoutes:
    def test_rag_ask_admits_a_citizen(
        self, client: Any, citizen_headers: dict[str, str]
    ) -> None:
        response = client.post(
            RAG_ASK,
            json={"question": "Sahara grant kitna milta hai?"},
            headers=citizen_headers,
        )
        assert response.status_code not in {401, 403}, response.text

    def test_rag_ask_admits_an_officer(
        self, client: Any, persona_headers: Any
    ) -> None:
        response = client.post(
            RAG_ASK,
            json={"question": "What documents does the Sahara grant need?"},
            headers=persona_headers("officer_sana"),
        )
        assert response.status_code not in {401, 403}, response.text

    def test_tts_admits_a_citizen(
        self, client: Any, citizen_headers: dict[str, str]
    ) -> None:
        response = client.post(
            VOICE_TTS,
            json={"text": "آپ کی درخواست منظور ہو گئی۔"},
            headers=citizen_headers,
        )
        assert response.status_code not in {401, 403}, response.text


class TestGuardsAreDeclared:
    """The route surface must carry the guards, not just behave correctly.

    BE's invariant test introspects dependencies for ``rbac_guard``; asserting it
    here keeps the contract visible from the owning module too.
    """

    def test_every_ai_route_declares_an_rbac_guard(self) -> None:
        from app.api.v1 import rag, voice

        for module in (rag, voice):
            for route in module.router.routes:
                guards = [
                    dep.call
                    for dep in route.dependant.dependencies
                    if getattr(dep.call, "rbac_guard", False)
                ]
                assert guards, f"{route.path} has no RBAC guard"

    def test_transcribe_parse_is_scoped_to_citizen_and_helper(self) -> None:
        from app.api.v1 import voice

        route = next(r for r in voice.router.routes if r.path.endswith("/transcribe-parse"))
        guard = next(
            dep.call
            for dep in route.dependant.dependencies
            if getattr(dep.call, "rbac_guard", False)
        )
        assert set(guard.roles) == {"CITIZEN", "HELPER"}
