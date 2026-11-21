"""Interactive Urdu video guide - "Saima - Haqdaar Guide" (ADR-025).

Three modes, one face:

* ``conversational`` (default) - the vendor listens to the citizen's own Urdu
  over WebRTC and answers in its own voice. This is the only mode that gives a
  low-literacy citizen a real two-way conversation, and the only one that needs
  no Deepgram or OpenAI key of ours. The vendor is grounded by a system prompt
  built from the **live active rule version in PostgreSQL**, so a published rule
  change is quoted by Saima on her very next session.
* ``passthrough`` - the avatar is a **mouth, not a mind**: it lip-syncs the Urdu
  PCM this system already produced (the 73 pre-cached ``/audio/ur/*.mp3``
  prompts and the dynamic ``POST /voice/tts`` clips), decoded to 24 kHz mono in
  the browser. The vendor never receives a question, a case, a CNIC or a prompt.
* ``talk`` - the documented single-turn fallback.

Four rules shape this module:

1. **Zero credits outside a deliberate live demo.** ``AI_PROVIDER=fake`` returns a
   complete, deterministic session envelope with ``provider: "fake"``, so every
   test, CI run and Playwright spec exercises the whole client flow without
   opening a WebRTC connection. Inside pytest the simulator is forced even when
   ``.env`` asks for live, so a test run can never spend a streaming minute.
2. **A vendor outage is not a citizen error.** Any HTTP error, timeout or quota
   exhaustion returns a ``200`` degradation envelope pointing at the audio-only
   guide, and records the failure in ``ai_telemetry``. It never raises a 5xx.
3. **The key never leaves the process.** Only a short-lived session token is
   returned; the API key is never logged, never returned, and never placed in a
   ``VITE_*`` variable.
4. **Unknown is a first-class value.** If the active rule version cannot be read,
   the prompt carries no amounts or thresholds at all and Saima is told to point
   the citizen at the official rules screen. She never quotes a stale number.
"""

from __future__ import annotations

import logging
import os
import time
import uuid
from datetime import UTC, datetime
from typing import Any

import httpx

from app.config import settings
from app.security import audit

logger = logging.getLogger("haqdaar.ai.avatar")

#: The four citizen surfaces allowed to open a guide session (ADR-025).
SURFACES = frozenset({"ask", "case_status", "wizard", "scam_check"})

PERSONA_NAME_UR = "سائرہ — حقدار گائیڈ"
PERSONA_NAME_EN = "Saima — Haqdaar Guide"

#: Anam's passthrough stream is 24 kHz mono ``pcm_s16le``; the browser resamples
#: to exactly this rate so the vendor never has to guess.
SAMPLE_RATE = 24000

#: Stock avatars that read as a warm female guide, in preference order. The first
#: one the account actually has wins; otherwise the first returned avatar is used.
PREFERRED_AVATAR_NAMES = ("Cara", "Layla", "Mia", "Sophie", "Julia")

#: Anam's catalogue has no ``ur``-tagged voice (checked against all 1437 entries
#: in the public catalogue), so the resolver falls back to the closest spoken
#: relative - Hindi, which shares Urdu's Hindustani register - and then to a warm
#: female English voice. ``ANAM_VOICE_ID`` overrides all of it.
PREFERRED_VOICE_LANGUAGES = ("ur", "hi")
PREFERRED_VOICE_NAMES = (
    "Amanda - Warm Guide",
    "Michelle - Empathetic Voice",
    "Rachel - Polished Presence",
)

#: ``CUSTOMER_CLIENT_V1`` is Anam's "disable the LLM" sentinel; conversational
#: mode needs a real one, so it is never a candidate here.
DISABLED_LLM_ID = "CUSTOMER_CLIENT_V1"

FAKE_SESSION_TOKEN = "fake-anam-session-token"
FAKE_AVATAR_ID = "fake-saima-avatar"

DEGRADED_MESSAGE_UR = "ویڈیو گائیڈ اس وقت دستیاب نہیں، آڈیو گائیڈ فعال ہے۔"
DEGRADED_MESSAGE_EN = "Video guide is temporarily unavailable; audio guide is active."

#: The one sentence Saima must use when a question is outside her remit. It is
#: also the exact string the RAG layer returns on ``NOT_SURE``, so the citizen
#: hears the same honest abstention whether she asked by voice or by text.
ABSTENTION_UR = (
    "بہن، مجھے اس بارے میں صحیح معلومات نہیں ہیں اور میں غلط بات نہیں بتانا چاہتی۔ "
    "میں صرف حقدار اور سہارا گرانٹ کے بارے میں مدد کر سکتی ہوں۔"
)

#: Resolved once per process. Each is a cheap catalogue read, but it is still a
#: network call on a citizen's request path, so it happens once.
_RESOLVED_AVATAR_ID: str | None = None
_RESOLVED_VOICE_ID: str | None = None
_RESOLVED_LLM_ID: str | None = None

#: Set only by the test suite's ``live`` fixture. Those tests also replace
#: ``avatar.httpx`` with a recorder, so flipping this lets the *code path* run
#: without any socket ever being opened.
_ALLOW_LIVE_IN_TESTS = False


# --------------------------------------------------------------------------- #
# mode helpers
# --------------------------------------------------------------------------- #
def _in_test_context() -> bool:
    """True inside pytest or an ``APP_ENV=test`` process.

    ``PYTEST_CURRENT_TEST`` is set by pytest for the duration of each test, which
    is exactly the window in which a stray ``.env`` must not be able to reach the
    vendor.
    """
    return bool(os.environ.get("PYTEST_CURRENT_TEST")) or settings.app_env == "test"


def set_test_live_override(enabled: bool) -> None:
    """Test seam: let the suite exercise the live code path with a shimmed client."""
    global _ALLOW_LIVE_IN_TESTS
    _ALLOW_LIVE_IN_TESTS = bool(enabled)


def _is_fake_mode() -> bool:
    """True when the deterministic simulator should serve the session.

    Order matters. A test context wins over everything, so CI is free no matter
    how ``.env`` is configured. Outside tests, a configured key is enough when
    either the AI layer is live or ``ANAM_ALLOW_LIVE_IN_FAKE_AI`` is on - that
    flag is what lets a developer see the real avatar while the rest of the AI
    layer stays deterministic.
    """
    if _in_test_context() and not _ALLOW_LIVE_IN_TESTS:
        return True
    if not _live_ready():
        return True
    try:
        from app.ai.provider import provider_mode

        if provider_mode() == "live":
            return False
    except Exception:  # pragma: no cover - provider import is always available
        return True
    return not settings.anam_allow_live_in_fake_ai


def _live_ready() -> bool:
    return bool(settings.anam_enabled and settings.anam_api_key.strip())


def _live_requested_without_key() -> bool:
    """True when the operator asked for live but there is no key to go live with.

    That is a misconfiguration, not a reason to silently simulate: the guide is
    withdrawn so the audio-only companion is the whole experience, rather than a
    citizen being shown a fake face while the operator believes it is real.
    """
    if _live_ready():
        return False
    try:
        from app.ai.provider import provider_mode

        return provider_mode() == "live"
    except Exception:  # pragma: no cover - provider import is always available
        return False


def _provider_name() -> str:
    """``"anam"`` only when a live session can actually be created."""
    if _is_fake_mode():
        return "fake"
    return "anam" if _live_ready() else "fake"


# --------------------------------------------------------------------------- #
# public configuration
# --------------------------------------------------------------------------- #
def get_avatar_config() -> dict[str, Any]:
    """The safe, key-free configuration the citizen client reads.

    ``enabled`` is the only field a caller needs to branch on: when it is false
    the guide is not offered at all and the audio-only companion is the whole
    experience. ``provider`` then says *how* an enabled guide runs - ``fake`` is
    the local simulator, ``anam`` is a real WebRTC stream. ``conversational``
    tells the stage whether to offer the microphone.
    """
    provider = _provider_name()
    return {
        "enabled": not _live_requested_without_key(),
        "provider": provider,
        "mode": settings.anam_mode,
        "conversational": settings.anam_mode == "conversational",
        "avatar_id": settings.anam_avatar_id or (FAKE_AVATAR_ID if provider == "fake" else ""),
        "sample_rate": SAMPLE_RATE,
        "max_session_seconds": int(settings.anam_max_session_seconds),
        "idle_timeout_seconds": int(settings.anam_idle_timeout_seconds),
        "persona_name_ur": PERSONA_NAME_UR,
        "persona_name_en": PERSONA_NAME_EN,
    }


# --------------------------------------------------------------------------- #
# avatar discovery
# --------------------------------------------------------------------------- #
def _avatar_list(payload: Any) -> list[dict[str, Any]]:
    """The catalogue entries from ``GET /v1/avatars``.

    The live API wraps them in ``{"data": [...]}``; older docs and the mock use a
    bare list or ``{"avatars": [...]}``. Accepting all three keeps the resolver
    working against the real service and against a fixture.
    """
    if isinstance(payload, list):
        return [entry for entry in payload if isinstance(entry, dict)]
    if isinstance(payload, dict):
        for key in ("data", "avatars", "items"):
            value = payload.get(key)
            if isinstance(value, list):
                return [entry for entry in value if isinstance(entry, dict)]
    return []


def _avatar_name(entry: dict[str, Any]) -> str:
    """``displayName`` on the live API, ``name`` on fixtures."""
    return str(entry.get("displayName") or entry.get("name") or "").strip()


def _pick_avatar(avatars: list[dict[str, Any]]) -> str:
    """Prefer a warm female stock avatar, else the first id the account has."""
    by_name = {
        _avatar_name(avatar).lower(): str(avatar.get("id") or "")
        for avatar in avatars
        if avatar.get("id")
    }
    for preferred in PREFERRED_AVATAR_NAMES:
        found = by_name.get(preferred.lower())
        if found:
            return found
    for avatar in avatars:
        if avatar.get("id"):
            return str(avatar["id"])
    return ""


def resolve_avatar_id() -> str:
    """The configured avatar id, or a stock one discovered once and cached.

    A blank ``ANAM_AVATAR_ID`` is the documented default, so this is the normal
    path rather than an error path. Discovery failure returns ``""`` and the
    caller degrades to the audio-only guide.
    """
    global _RESOLVED_AVATAR_ID

    configured = settings.anam_avatar_id.strip()
    if configured:
        return configured
    if _RESOLVED_AVATAR_ID:
        return _RESOLVED_AVATAR_ID
    if _is_fake_mode() or not _live_ready():
        return FAKE_AVATAR_ID

    url = f"{settings.anam_base_url.rstrip('/')}/v1/avatars"
    try:
        with httpx.Client(timeout=6.0) as client:
            response = client.get(
                url, headers={"Authorization": f"Bearer {settings.anam_api_key.strip()}"}
            )
        if response.status_code != 200:
            logger.warning("avatar discovery failed: status=%s", response.status_code)
            return ""
        avatars = _avatar_list(response.json())
        if not avatars:
            return ""
        _RESOLVED_AVATAR_ID = _pick_avatar(avatars)
        return _RESOLVED_AVATAR_ID
    except Exception as exc:  # noqa: BLE001 - discovery is best effort
        logger.warning("avatar discovery failed: %s", type(exc).__name__)
        return ""


# --------------------------------------------------------------------------- #
# voice + llm discovery
# --------------------------------------------------------------------------- #
def _catalogue(payload: Any) -> list[dict[str, Any]]:
    """The entries from a ``GET /v1/{avatars,voices,llms}`` response.

    The live API wraps them in ``{"data": [...]}``; older docs and fixtures use a
    bare list or a named key. Accepting all three keeps the resolvers working
    against the real service and against a fixture.
    """
    return _avatar_list(payload)


def _voice_languages(entry: dict[str, Any]) -> list[str]:
    raw = entry.get("languages")
    if not isinstance(raw, list):
        return []
    return [str(item).strip().lower() for item in raw if str(item).strip()]


def _pick_voice(voices: list[dict[str, Any]]) -> str:
    """Prefer a voice that can actually pronounce Urdu, then a warm female one.

    Anam's catalogue carries no ``ur`` voice today, so the Hindi fallback is the
    one that matters in practice: Hindi and Urdu are the same spoken language, so
    a Hindi voice reading Urdu is far closer than an English one.
    """
    usable = [voice for voice in voices if voice.get("id")]
    for language in PREFERRED_VOICE_LANGUAGES:
        for voice in usable:
            if language in _voice_languages(voice):
                return str(voice["id"])
    by_name = {
        str(voice.get("displayName") or "").strip().lower(): str(voice["id"]) for voice in usable
    }
    for preferred in PREFERRED_VOICE_NAMES:
        found = by_name.get(preferred.lower())
        if found:
            return found
    for voice in usable:
        if str(voice.get("gender") or "").upper() == "FEMALE":
            return str(voice["id"])
    return str(usable[0]["id"]) if usable else ""


def _pick_llm(llms: list[dict[str, Any]]) -> str:
    """Prefer Anam's own persona-default model, never the "disable LLM" sentinel."""
    usable = [
        llm
        for llm in llms
        if llm.get("id") and str(llm.get("id")) != DISABLED_LLM_ID
    ]
    for llm in usable:
        tags = llm.get("displayTags") or []
        if isinstance(tags, list) and "persona-default" in tags:
            return str(llm["id"])
    for llm in usable:
        if llm.get("isDefault") is True:
            return str(llm["id"])
    return str(usable[0]["id"]) if usable else ""


def _discover(path: str, picker: Any) -> str:
    """One cached catalogue read. Failure returns ``""`` and the caller degrades."""
    url = f"{settings.anam_base_url.rstrip('/')}{path}"
    try:
        with httpx.Client(timeout=6.0) as client:
            response = client.get(
                url, headers={"Authorization": f"Bearer {settings.anam_api_key.strip()}"}
            )
        if response.status_code != 200:
            logger.warning("%s discovery failed: status=%s", path, response.status_code)
            return ""
        return str(picker(_catalogue(response.json())) or "")
    except Exception as exc:  # noqa: BLE001 - discovery is best effort
        logger.warning("%s discovery failed: %s", path, type(exc).__name__)
        return ""


def resolve_voice_id() -> str:
    """The configured voice, or the best one the account has, cached once."""
    global _RESOLVED_VOICE_ID

    configured = settings.anam_voice_id.strip()
    if configured:
        return configured
    if _RESOLVED_VOICE_ID:
        return _RESOLVED_VOICE_ID
    if _is_fake_mode() or not _live_ready():
        return ""
    _RESOLVED_VOICE_ID = _discover("/v1/voices", _pick_voice)
    return _RESOLVED_VOICE_ID


