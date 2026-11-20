"""Upload-root resolution: the verifier must agree with the writer (defect D-2b).

The writer (``app/api/v1/documents.py``) stores ``storage_path`` relative to
``settings.upload_dir``, which ``app/config.py`` canonicalises against the **backend
root**. The verifier used to fall back to a bare ``Path(os.environ["UPLOAD_DIR"])``,
which is relative and therefore resolved against the *working directory*.

In the suite that never showed, because ``tests/conftest.py`` sets ``UPLOAD_DIR`` to an
absolute temp dir. On the live stack ``UPLOAD_DIR=./data/uploads`` is relative and the
API and the worker do not share a CWD, so the verifier reported ``file_present: false``
for a file the writer had just written.

``TestLiveConfigEndToEnd`` runs the real API in a subprocess with ``cwd=backend/`` and a
relative ``UPLOAD_DIR`` — the live layout, not the in-suite habit — and then re-verifies
the same document from a *different* working directory, which is the worker's view.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any

import pytest

from app.ai.qr_sign import DEFAULT_QR_SECRET

BACKEND_DIR = Path(__file__).resolve().parents[2]

#: A relative ``UPLOAD_DIR`` under the git-ignored ``uploads/`` tree, so the live-layout
#: test leaves nothing behind in ``git status``.
LIVE_RELATIVE_UPLOAD_DIR = "./data/uploads/pytest-live"
LIVE_ROOT = BACKEND_DIR / "data" / "uploads" / "pytest-live"


class _SettingsStub:
    """A stand-in for ``app.config.settings`` with a chosen ``upload_dir``."""

    def __init__(self, upload_dir: Path | None) -> None:
        if upload_dir is not None:
            self.upload_dir = upload_dir


# -- the invariant ---------------------------------------------------------
class TestRootAgreement:
    def test_verifier_root_equals_the_writer_root(self) -> None:
        """The whole defect in one assertion: one root, two readers."""
        from app.ai import doc_verify
        from app.config import settings

        assert doc_verify.upload_dir() == settings.upload_dir
        assert doc_verify.upload_dir().is_absolute()

    def test_verifier_root_ignores_the_working_directory(
        self, tmp_path: Path, monkeypatch: Any
    ) -> None:
        from app.ai import doc_verify

        before = doc_verify.upload_dir()
        monkeypatch.chdir(tmp_path)
        assert doc_verify.upload_dir() == before

    def test_tts_cache_lives_under_the_same_root(self) -> None:
        from app.ai import paths, provider

        assert provider._tts_cache_dir() == paths.upload_dir() / "tts_cache"

    def test_seed_stages_demo_docs_under_the_same_root(self) -> None:
        from app.ai import paths
        from app.mocks import seed

        assert seed.upload_dir() == paths.upload_dir()


# -- the rule, when settings are not the source ----------------------------
class TestRelativeConfiguration:
    def test_a_relative_settings_value_is_anchored_to_the_backend_root(
        self, monkeypatch: Any
    ) -> None:
        from app.ai import paths

        monkeypatch.setattr(
            "app.config.settings", _SettingsStub(Path("./data/uploads")), raising=False
        )
        assert paths.upload_dir() == (paths.BACKEND_DIR / "data/uploads").resolve()

    def test_a_relative_env_value_is_anchored_to_the_backend_root(
        self, monkeypatch: Any
    ) -> None:
        from app.ai import paths

        monkeypatch.setattr("app.config.settings", _SettingsStub(None), raising=False)
        monkeypatch.setenv("UPLOAD_DIR", "./data/uploads")
        assert paths.upload_dir() == (paths.BACKEND_DIR / "data/uploads").resolve()

    def test_the_fallback_matches_the_settings_default(self, monkeypatch: Any) -> None:
        from app.ai import paths

        monkeypatch.setattr("app.config.settings", _SettingsStub(None), raising=False)
        monkeypatch.delenv("UPLOAD_DIR", raising=False)
        assert paths.upload_dir() == (paths.BACKEND_DIR / "data/uploads").resolve()

    def test_an_absolute_value_is_left_alone(self, tmp_path: Path, monkeypatch: Any) -> None:
        from app.ai import paths

        monkeypatch.setattr("app.config.settings", _SettingsStub(tmp_path), raising=False)
        assert paths.upload_dir() == tmp_path


# -- the live layout, end to end -------------------------------------------
_LIVE_SCRIPT = r"""
import json
import os
import uuid

from fastapi.testclient import TestClient

from app.ai import doc_verify
from app.config import settings
from app.main import create_app


def _checks(payload):
    return {check["check"]: check for check in (payload.get("verify_checks") or [])}


client = TestClient(create_app(), raise_server_exceptions=False)
login = client.post("/api/v1/auth/demo-login", json={"persona_key": "widow_fatima"})
if login.status_code != 200:
    raise SystemExit(f"demo-login failed: {login.status_code} {login.text}")
headers = {"Authorization": "Bearer " + login.json()["access_token"]}

payload = open("app/data/demo_docs/fatima_cnic_genuine.jpg", "rb").read()
response = client.post(
    "/api/v1/documents",
    files={"file": ("card.jpg", payload, "image/jpeg")},
    data={"doc_type": "CNIC_FRONT"},
    headers=headers,
)
body = response.json()
checks = _checks(body)
print(
    "RESULT_UPLOAD "
    + json.dumps(
        {
            "cwd": os.getcwd(),
            "status": response.status_code,
            "verify_status": body.get("verify_status"),
            "file_present": checks.get("file_present", {}).get("passed"),
            "file_present_value": checks.get("file_present", {}).get("value"),
            "verifier_root": str(doc_verify.upload_dir()),
            "writer_root": str(settings.upload_dir),
            "body_keys": sorted(body),
        }
    )
)

# Phase 2: the worker's view. Same UPLOAD_DIR, different working directory.
os.chdir("..")
from app.db import SessionLocal  # noqa: E402

db = SessionLocal()
try:
    outcome = doc_verify.verify_document(db, uuid.UUID(body["id"]))
    db.commit()
finally:
    db.close()

worker_checks = _checks(outcome)
print(
    "RESULT_WORKER "
    + json.dumps(
        {
            "cwd": os.getcwd(),
            "verify_status": outcome.get("verify_status"),
            "file_present": worker_checks.get("file_present", {}).get("passed"),
            "file_present_value": worker_checks.get("file_present", {}).get("value"),
            "verifier_root": str(doc_verify.upload_dir()),
            "writer_root": str(settings.upload_dir),
        }
    )
)
"""


def _parse(stdout: str, tag: str) -> dict[str, Any]:
    line = next(
        (candidate for candidate in stdout.splitlines() if candidate.startswith(tag + " ")),
        None,
    )
    assert line is not None, stdout[-4000:]
    return json.loads(line[len(tag) + 1 :])


@pytest.fixture(scope="module")
def live_run(prepared_database: str) -> dict[str, Any]:
    """Run the real API once with the live layout and return both phases."""
    shutil.rmtree(LIVE_ROOT, ignore_errors=True)
    env = dict(os.environ)
    env["UPLOAD_DIR"] = LIVE_RELATIVE_UPLOAD_DIR
    env["PYTHONPATH"] = "."
    env["AI_PROVIDER"] = "fake"
    # The committed specimens are signed with this secret; the subprocess must agree.
    env["QR_HMAC_SECRET"] = DEFAULT_QR_SECRET
    try:
        completed = subprocess.run(  # noqa: S603 - fixed argv, no shell
            [sys.executable, "-c", _LIVE_SCRIPT],
            cwd=BACKEND_DIR,
            env=env,
            capture_output=True,
            text=True,
            timeout=240,
        )
    finally:
        shutil.rmtree(LIVE_ROOT, ignore_errors=True)

    assert completed.returncode == 0, completed.stderr[-4000:]
    return {
        "upload": _parse(completed.stdout, "RESULT_UPLOAD"),
        "worker": _parse(completed.stdout, "RESULT_WORKER"),
    }


class TestLiveConfigEndToEnd:
    """The repro the Lead asked for: ``cwd=backend/``, relative ``UPLOAD_DIR``."""

    def test_a_relative_upload_dir_still_reports_file_present(
        self, live_run: dict[str, Any]
    ) -> None:
        result = live_run["upload"]
        assert result["status"] == 201, result
        assert result["file_present"] is True, result
        assert result["file_present_value"] == "present", result
        assert result["verify_status"] == "VERIFIED", result
        # The two readers must agree on the root, not merely on the verdict.
        assert result["verifier_root"] == result["writer_root"], result
        assert Path(result["verifier_root"]).is_absolute(), result

    def test_the_worker_resolves_the_same_root_from_a_different_cwd(
        self, live_run: dict[str, Any]
    ) -> None:
        """The API and the worker do not share a CWD; the root must not care."""
        result = live_run["worker"]
        assert Path(result["cwd"]) != BACKEND_DIR, result
        assert result["file_present"] is True, result
        assert result["file_present_value"] == "present", result
        assert result["verify_status"] == "VERIFIED", result
        assert result["verifier_root"] == result["writer_root"], result
