"""Filesystem roots, resolved exactly the way the writer resolves them.

Source of truth: ``app/config.py``'s ``Settings._resolve_path`` validator, which
canonicalises a relative ``UPLOAD_DIR`` against the **backend root**, not against the
process working directory.

The document writer (``app/api/v1/documents.py``) stores ``storage_path`` relative to
that root. The verifier must resolve the same root, or it reports ``file_present:
false`` for a file the writer just wrote. That is exactly what happened on the live
stack (defect D-2b): ``UPLOAD_DIR=./data/uploads`` is relative, the API and the worker
do not share a working directory, and the verifier's fallback returned a bare
``Path("./data/uploads")`` that only happened to be right when the CWD was
``backend/``.

This module is the read side of that contract. It does not edit BE's files: it
consumes ``settings.upload_dir`` (already canonical) and, when settings are
unavailable, reproduces the validator's rule verbatim.
"""

from __future__ import annotations

import os
from pathlib import Path

__all__ = [
    "BACKEND_DIR",
    "DEFAULT_UPLOAD_DIR",
    "backend_root",
    "resolve_configured_path",
    "upload_dir",
]

#: ``backend/`` - the same anchor ``app.config.BACKEND_DIR`` uses.
BACKEND_DIR = Path(__file__).resolve().parents[2]

#: ``Settings.upload_dir`` default (``app/config.py``).
DEFAULT_UPLOAD_DIR = Path("./data/uploads")


def backend_root() -> Path:
    """The backend package root; the anchor for every relative configured path."""
    return BACKEND_DIR


def resolve_configured_path(value: str | Path) -> Path:
    """Mirror ``Settings._resolve_path``: relative values hang off the backend root."""
    path = Path(value)
    return path if path.is_absolute() else (BACKEND_DIR / path).resolve()


def upload_dir() -> Path:
    """The upload root - always absolute, always independent of the working directory.

    Prefers ``settings.upload_dir`` because BE's validator has already canonicalised
    it; falls back to the same rule applied to ``UPLOAD_DIR`` so a process that cannot
    import settings (a bare worker, a script) still lands in the same place.
    """
    try:  # pragma: no cover - the happy path once app.config is importable
        from app.config import settings  # type: ignore

        value = getattr(settings, "upload_dir", None)
        if value:
            return resolve_configured_path(value)
    except Exception:  # pragma: no cover - settings unavailable
        pass
    return resolve_configured_path(os.environ.get("UPLOAD_DIR") or DEFAULT_UPLOAD_DIR)
