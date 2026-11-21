"""D-2a regression: the document writer and the verifier must agree on one directory.

``POST /documents`` stored under ``settings.upload_dir`` (``backend/data/uploads``)
while ``app/ai/doc_verify.py`` resolved its own root with
``getattr(settings, "UPLOAD_DIR", None)``. ``Settings`` only ever had the lowercase
field, so that lookup returned ``None`` and the verifier fell back to
``backend/app/uploads``. Every uploaded document therefore came back
``verify_checks[0].file_present == false`` - the verifier was reading an empty
directory, and the pipeline treated genuine cards as unreadable.

The fix is one attribute and one helper: ``Settings.UPLOAD_DIR`` (uppercase alias,
same pattern as ``MOCK_BASE_URL``) and ``app.config.upload_root()``. These tests
pin the agreement so the two halves cannot drift apart again.
"""

from __future__ import annotations

import importlib
from pathlib import Path
from typing import Any

import pytest

BACKEND_ROOT = Path(__file__).resolve().parents[2]
FATIMA_CNIC = "9990010000012"


def test_writer_and_verifier_resolve_the_same_directory() -> None:
    """The whole bug in one assertion."""
    config = importlib.import_module("app.config")
    doc_verify = importlib.import_module("app.ai.doc_verify")

    assert config.upload_root() == doc_verify.upload_dir()


def test_upload_root_is_absolute_and_anchored_at_the_backend_root() -> None:
    config = importlib.import_module("app.config")

    root = config.upload_root()
    assert root.is_absolute()
    assert root.is_dir()
    assert root == config.settings.upload_dir

    # A relative UPLOAD_DIR - the documented default - resolves against the backend
    # root, not against whatever directory the process happened to start in.
    fresh = config.Settings(upload_dir=Path("./data/uploads"))
    assert fresh.upload_dir == config.BACKEND_DIR / "data" / "uploads"


def test_upload_root_ignores_the_process_working_directory(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A relative ``UPLOAD_DIR`` must not follow the CWD into a different tree."""
    config = importlib.import_module("app.config")
    doc_verify = importlib.import_module("app.ai.doc_verify")

    before = config.upload_root()
    monkeypatch.chdir(tmp_path)
    assert config.upload_root() == before
    assert doc_verify.upload_dir() == before


def test_uppercase_alias_tracks_the_lowercase_field(monkeypatch: pytest.MonkeyPatch) -> None:
    """Teammates read ``settings.UPLOAD_DIR``; it must not be a frozen copy."""
    config = importlib.import_module("app.config")
    doc_verify = importlib.import_module("app.ai.doc_verify")

    original = config.settings.upload_dir
    try:
        config.settings.upload_dir = original / "alias-probe"
        assert config.settings.UPLOAD_DIR == original / "alias-probe"
        assert doc_verify.upload_dir() == original / "alias-probe"
    finally:
        config.settings.upload_dir = original


def test_uploaded_document_lands_where_the_verifier_looks(client: Any, db: Any) -> None:
    """End to end: upload a specimen card, then resolve it the way the verifier does."""
    models = importlib.import_module("app.models")
    doc_verify = importlib.import_module("app.ai.doc_verify")

    login = client.post("/api/v1/auth/demo-login", json={"persona_key": "widow_fatima"})
    assert login.status_code == 200, login.text
    headers = {"Authorization": f"Bearer {login.json()['access_token']}"}

    specimen = BACKEND_ROOT / "app" / "data" / "demo_docs" / "fatima_cnic_genuine.jpg"
    assert specimen.exists(), f"demo document missing: {specimen}"
    with specimen.open("rb") as handle:
        response = client.post(
            "/api/v1/documents",
            headers=headers,
            files={"file": (specimen.name, handle, "image/jpeg")},
            data={"doc_type": "CNIC_FRONT"},
        )
    assert response.status_code == 201, response.text

    document = db.get(models.Document, response.json()["id"])
    assert document is not None

    # Canonical, relative, forward-slashed - portable across containers.
    assert not Path(document.storage_path).is_absolute()
    assert "\\" not in document.storage_path

    resolved = doc_verify._resolve_path(document.storage_path)
    assert resolved.is_file(), (
        f"the verifier resolves {document.storage_path!r} to {resolved}, which does not "
        f"exist - the writer and the verifier disagree on UPLOAD_DIR"
    )
    assert resolved.read_bytes() == specimen.read_bytes()

    # And the verifier's own first check now sees the file.
    checks = document.verify_checks or []
    if checks:
        assert checks[0].get("file_present") is not False, checks[0]
