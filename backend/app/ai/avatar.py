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


