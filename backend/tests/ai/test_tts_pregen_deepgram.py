"""Deepgram build-time audio generation, without network calls or a real key."""

from __future__ import annotations

import json
from types import SimpleNamespace

import httpx
import pytest

from app.ai import tts_pregen


def test_deepgram_batch_request_returns_mp3() -> None:
    def respond(request: httpx.Request) -> httpx.Response:
        assert request.method == "POST"
        assert str(request.url) == (
            "https://api.deepgram.com/v2/speak?model=flux-ambreen-ur&encoding=mp3"
        )
        assert request.headers["Authorization"] == "Token test-key"
        assert json.loads(request.content) == {"text": "سلام"}
        return httpx.Response(200, headers={"content-type": "audio/mpeg"}, content=b"ID3mock-audio")

    with httpx.Client(transport=httpx.MockTransport(respond)) as client:
        assert tts_pregen._render("سلام", tts_pregen.VOICE, "test-key", client) == b"ID3mock-audio"


def test_deepgram_rejects_non_audio_response() -> None:
    with httpx.Client(
        transport=httpx.MockTransport(
            lambda _: httpx.Response(200, headers={"content-type": "application/json"}, json={})
        )
    ) as client:
        with pytest.raises(ValueError, match="invalid MP3"):
            tts_pregen._render("سلام", tts_pregen.VOICE, "test-key", client)


def test_missing_key_does_not_overwrite_manifest(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        tts_pregen, "get_settings", lambda: SimpleNamespace(deepgram_api_key="")
    )
    with pytest.raises(ValueError, match="DEEPGRAM_API_KEY"):
        tts_pregen.generate(output_dir=tmp_path)
    assert not (tmp_path / "manifest.json").exists()


def test_manifest_marks_existing_audio_ready(tmp_path) -> None:
    first_key = next(iter(tts_pregen.PROMPTS))
    (tmp_path / f"{first_key}.mp3").write_bytes(b"ID3mock-audio")
    files = tts_pregen.build_manifest(tmp_path)["_meta"]["files"]
    assert files[first_key]["status"] == "ready"
    assert any(entry["status"] == "pending" for key, entry in files.items() if key != first_key)
