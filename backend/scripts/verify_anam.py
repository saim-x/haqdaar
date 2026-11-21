#!/usr/bin/env python
"""Pre-flight check for the live Anam.ai video guide (ADR-025).

Proves four things without spending a single streaming minute:

1. ``ANAM_API_KEY`` is present and authenticates.
2. ``GET /v1/avatars`` returns a catalogue, and which avatar the backend would
   pick for Saima.
3. ``GET /v1/voices`` and ``GET /v1/llms`` return catalogues, and which voice and
   model the backend would pick - the two ids ``conversational`` mode needs.
4. ``POST /v1/auth/session-token`` issues a short-lived token with the exact
   ``personaConfig`` the app sends for the selected mode.

Token issuance is a REST call, not a WebRTC connection, so it is **not billed**
against the free tier's 30 minutes. Nothing here opens a stream.

Usage::

    python backend/scripts/verify_anam.py
    python backend/scripts/verify_anam.py --mode conversational
    python backend/scripts/verify_anam.py --mode passthrough

Exit codes: ``0`` all checks passed, ``1`` a check failed, ``2`` not configured.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

import httpx  # noqa: E402

from app.ai import avatar  # noqa: E402
from app.config import settings  # noqa: E402

OK = "PASS"
BAD = "FAIL"
MODES = ("conversational", "passthrough", "talk")


def mask(secret: str, *, keep: int = 4) -> str:
    """Show enough to recognise a value, never enough to use it."""
    value = (secret or "").strip()
    if not value:
        return "(empty)"
    if len(value) <= keep * 2:
        return "*" * len(value)
    return f"{value[:keep]}…{value[-keep:]} ({len(value)} chars)"


def _headers() -> dict[str, str]:
    return {
        "Authorization": f"Bearer {settings.anam_api_key.strip()}",
        "Content-Type": "application/json",
    }


def _get_catalogue(client: httpx.Client, path: str) -> tuple[bool, list[dict[str, Any]]]:
    url = f"{settings.anam_base_url.rstrip('/')}{path}"
    try:
        response = client.get(url, headers=_headers())
    except Exception as exc:  # noqa: BLE001 - report, do not traceback
        print(f"  {BAD} transport error: {type(exc).__name__}")
        return False, []
    print(f"  HTTP {response.status_code}")
    if response.status_code != 200:
        print(f"  {BAD} body: {response.text[:300]}")
        return False, []
    entries = avatar._catalogue(response.json())  # noqa: SLF001
    if not entries:
        print(f"  {BAD} no entries in the response")
        return False, []
    return True, entries


def check_avatars(client: httpx.Client) -> tuple[bool, list[dict[str, Any]]]:
    print(f"\n[1/4] GET {settings.anam_base_url.rstrip('/')}/v1/avatars")
    ok, avatars = _get_catalogue(client, "/v1/avatars")
    if not ok:
        return False, []
    print(f"  {OK} {len(avatars)} avatar(s) available")
    for entry in avatars[:5]:
        print(
            f"      - {avatar._avatar_name(entry) or '(unnamed)':<16} "  # noqa: SLF001
            f"id={entry.get('id')} "
            f"{(entry.get('avatarType') or entry.get('type') or '')}"
        )
    if len(avatars) > 5:
        print(f"      … {len(avatars) - 5} more")
    print(f"  Saima would use: {avatar._pick_avatar(avatars) or '(none)'}")  # noqa: SLF001
    return True, avatars


def check_voices(client: httpx.Client) -> tuple[bool, str]:
    print(f"\n[2/4] GET {settings.anam_base_url.rstrip('/')}/v1/voices")
    ok, voices = _get_catalogue(client, "/v1/voices")
    if not ok:
        return False, ""
    languages = sorted({lang for voice in voices for lang in avatar._voice_languages(voice)})  # noqa: SLF001
    print(f"  {OK} {len(voices)} voice(s) available; languages: {', '.join(languages) or '(none)'}")
    for voice in voices[:5]:
        print(
            f"      - {str(voice.get('displayName') or '(unnamed)'):<28} "
            f"id={voice.get('id')} "
            f"{str(voice.get('gender') or ''):<6} "
            f"langs={','.join(avatar._voice_languages(voice)) or '-'}"  # noqa: SLF001
        )
    if len(voices) > 5:
        print(f"      … {len(voices) - 5} more")
    chosen = avatar._pick_voice(voices)  # noqa: SLF001
    urdu = [v for v in voices if "ur" in avatar._voice_languages(v)]  # noqa: SLF001
    if not urdu:
        print("  NOTE no `ur`-tagged voice in this catalogue; the resolver falls back to")
        print("       `hi` (same spoken language as Urdu), then a warm female voice.")
    print(f"  Saima would use: {chosen or '(none)'}")
    return True, chosen


def check_llms(client: httpx.Client) -> tuple[bool, str]:
    print(f"\n[3/4] GET {settings.anam_base_url.rstrip('/')}/v1/llms")
    ok, llms = _get_catalogue(client, "/v1/llms")
    if not ok:
        return False, ""
    print(f"  {OK} {len(llms)} model(s) available")
    for llm in llms[:5]:
        tags = llm.get("displayTags") or []
        print(
            f"      - {str(llm.get('displayName') or '(unnamed)'):<28} "
            f"id={llm.get('id')} "
            f"model={llm.get('modelName') or '-'} "
            f"tags={','.join(tags) if isinstance(tags, list) else '-'}"
        )
    if len(llms) > 5:
        print(f"      … {len(llms) - 5} more")
    chosen = avatar._pick_llm(llms)  # noqa: SLF001
    print(f"  Saima would use: {chosen or '(none)'}")
    return True, chosen


def check_session_token(
    client: httpx.Client,
    avatar_id: str,
    *,
    voice_id: str,
    llm_id: str,
) -> bool:
    url = f"{settings.anam_base_url.rstrip('/')}/v1/auth/session-token"
    system_prompt = ""
    if settings.anam_mode == "conversational":
        # No database here: the prompt is built without live rule facts, which is
        # exactly the honest fallback the app uses when the rule read fails.
        system_prompt = avatar.build_saima_system_prompt(None, "ask", "ur")
    persona = avatar._persona_config(  # noqa: SLF001
        avatar_id,
        voice_id=voice_id,
        llm_id=llm_id,
        system_prompt=system_prompt,
        lang="ur",
    )
    printable = dict(persona)
    if "systemPrompt" in printable:
        printable["systemPrompt"] = f"<{len(str(persona['systemPrompt']))} chars>"
    print(f"\n[4/4] POST {url}")
    print(f"  mode={settings.anam_mode}")
    print(f"  personaConfig={json.dumps(printable, ensure_ascii=False)}")
    try:
        response = client.post(url, headers=_headers(), json={"personaConfig": persona})
    except Exception as exc:  # noqa: BLE001
        print(f"  {BAD} transport error: {type(exc).__name__}")
        return False

    print(f"  HTTP {response.status_code}")
    if response.status_code != 200:
        print(f"  {BAD} body: {response.text[:600]}")
        return False

    payload = response.json()
    token = ""
    if isinstance(payload, dict):
        token = str(payload.get("sessionToken") or payload.get("session_token") or "")
    if not token:
        print(f"  {BAD} no session token in the response")
        return False

    print(f"  {OK} session token issued: {mask(token)}")
    print("  (token issuance only - 0.0 WebRTC streaming minutes consumed)")
    return True


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Verify live Anam.ai credentials (0 streaming minutes)."
    )
    parser.add_argument(
        "--mode",
        choices=MODES,
        default=None,
        help="Override ANAM_MODE for this check only.",
    )
    args = parser.parse_args()

    print("Haqdaar - Anam.ai pre-flight (ADR-025)")
    print(f"  base_url   : {settings.anam_base_url}")
    print(f"  enabled    : {settings.anam_enabled}")
    print(f"  mode       : {args.mode or settings.anam_mode}")
    print(f"  api_key    : {mask(settings.anam_api_key)}")
    print(f"  avatar_id  : {settings.anam_avatar_id or '(auto-resolve)'}")
    print(f"  voice_id   : {settings.anam_voice_id or '(auto-resolve)'}")
    print(f"  llm_id     : {settings.anam_llm_id or '(auto-resolve)'}")

    if args.mode:
        settings.anam_mode = args.mode  # type: ignore[assignment]

    if not settings.anam_api_key.strip():
        print(f"\n{BAD} ANAM_API_KEY is empty. Paste it into the git-ignored root .env.")
        return 2
    if not settings.anam_enabled:
        print(f"\n{BAD} ANAM_ENABLED is false. Set ANAM_ENABLED=true in the root .env.")
        return 2

    with httpx.Client(timeout=15.0) as client:
        ok, avatars = check_avatars(client)
        if not ok:
            print("\nRESULT: FAIL - the API key or the base URL is wrong.")
            return 1
        avatar_id = settings.anam_avatar_id.strip() or avatar._pick_avatar(avatars)  # noqa: SLF001
        if not avatar_id:
            print("\nRESULT: FAIL - no usable avatar id.")
            return 1

        voice_id = settings.anam_voice_id.strip()
        llm_id = settings.anam_llm_id.strip()
        if settings.anam_mode == "conversational":
            voices_ok, discovered_voice = check_voices(client)
            if not voices_ok:
                print("\nRESULT: FAIL - the voice catalogue is unavailable.")
                return 1
            voice_id = voice_id or discovered_voice
            llms_ok, discovered_llm = check_llms(client)
            if not llms_ok:
                print("\nRESULT: FAIL - the model catalogue is unavailable.")
                return 1
            llm_id = llm_id or discovered_llm
        else:
            print("\n[2/4] GET /v1/voices  - skipped (only conversational mode needs a voice)")
            print("[3/4] GET /v1/llms    - skipped (only conversational mode needs a model)")

        if not check_session_token(client, avatar_id, voice_id=voice_id, llm_id=llm_id):
            print("\nRESULT: FAIL - token issuance failed.")
            return 1

    print("\nRESULT: PASS - live credentials work; 0.0 streaming minutes consumed.")
    print(f"Selected avatar={avatar_id}")
    if settings.anam_mode == "conversational":
        print(f"Selected voice ={voice_id or '(vendor default)'}")
        print(f"Selected llm   ={llm_id or '(vendor default)'}")
    print("Next: open the app, tap the guide, and speak Urdu to Saima.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
