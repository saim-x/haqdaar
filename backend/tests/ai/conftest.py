"""Shared fixtures for the AI suite.

Everything here runs with ``AI_PROVIDER=fake``: no network, no API key, no
nondeterminism. The fake provider is deterministic by construction, so a test
that passes once passes every time.
"""

from __future__ import annotations

import os
import sys
import types
from collections.abc import Iterator
from typing import Any

import pytest

os.environ.setdefault("AI_PROVIDER", "fake")


def pytest_configure(config: pytest.Config) -> None:
    config.addinivalue_line(
        "markers", "integration: needs the real Postgres on HOST_DB_PORT"
    )


def _install_db_stub() -> None:
    """Install a stand-in ``app.db`` only while A1's real module is absent."""
    try:  # pragma: no cover - the happy path once A1 lands
        import app.db

        return
    except Exception:
        pass

    from sqlalchemy.orm import declarative_base

    module = types.ModuleType("app.db")
    module.Base = declarative_base()  # type: ignore[attr-defined]
    module.SessionLocal = None  # type: ignore[attr-defined]
    module.engine = None  # type: ignore[attr-defined]
    module.get_db = lambda: None  # type: ignore[attr-defined]
    sys.modules["app.db"] = module

    import app

    app.db = module  # type: ignore[attr-defined]


_install_db_stub()


@pytest.fixture(autouse=True)
def _fake_provider(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    """Force fake mode and reset the provider singleton around every test."""
    monkeypatch.setenv("AI_PROVIDER", "fake")
    from app.ai import provider

    provider.reset_provider()
    yield
    provider.reset_provider()


@pytest.fixture(autouse=True)
def _specimen_secret(monkeypatch: pytest.MonkeyPatch) -> None:
    """Verify the committed specimens with the secret they were signed with.

    ``app/data/demo_docs`` and ``app/data/doc_eval_set`` are pre-signed artifacts:
    their HMAC is part of their content, so the secret is part of the fixture
    contract, not an ambient setting. The generator signs with
    ``qr_sign.DEFAULT_QR_SECRET`` — the same value the live stack uses — but the
    root ``tests/conftest.py`` overrides ``QR_HMAC_SECRET`` for its own QR tests.
    Left alone, that override makes every genuine specimen fail its signature and
    the verifier reports ``TAMPER_SUSPECTED`` for a perfectly good card.

    ``test_committed_specimens_verify_under_the_default_secret`` pins the other
    half of the contract: regenerating the artifacts with a different secret
    fails loudly instead of silently accusing citizens.
    """
    from app.ai import qr_sign

    monkeypatch.setenv("QR_HMAC_SECRET", qr_sign.DEFAULT_QR_SECRET)


class RecordingSession:
    """Minimal session that records executed statements instead of running them."""

    def __init__(self) -> None:
        self.executed: list[Any] = []
        self.commits = 0
        self.rollbacks = 0

    def execute(self, statement: Any, params: Any = None) -> Any:
        self.executed.append((statement, params))
        return _EmptyResult()

    def add(self, obj: Any) -> None:
        self.executed.append(("add", obj))

    def add_all(self, objs: Any) -> None:
        self.executed.append(("add_all", list(objs)))

    def flush(self) -> None:
        pass

    def commit(self) -> None:
        self.commits += 1

    def rollback(self) -> None:
        self.rollbacks += 1

    def close(self) -> None:
        pass

    def get(self, model: Any, key: Any) -> Any:
        return None

    def scalars(self, statement: Any) -> Any:
        return _EmptyResult()

    def delete(self, obj: Any) -> None:
        self.executed.append(("delete", obj))


class _EmptyResult:
    def all(self) -> list[Any]:
        return []

    def first(self) -> Any:
        return None

    def mappings(self) -> _EmptyResult:
        return self

    def scalars(self) -> _EmptyResult:
        return self

    def __iter__(self) -> Iterator[Any]:
        return iter(())


@pytest.fixture
def db() -> RecordingSession:
    """A session that records writes and returns empty reads."""
    return RecordingSession()


@pytest.fixture
def fake_provider() -> Any:
    from app.ai.provider import get_fake_provider

    return get_fake_provider()
