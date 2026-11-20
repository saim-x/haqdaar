"""Shared pytest fixtures for the whole backend suite.

Every agent's tests run on this file, so it is deliberately boring:

* one dedicated ``haqdaar_test`` database, created and migrated once per session;
* ``AI_PROVIDER=fake`` so no test ever reaches OpenAI;
* a seeded demo world (9 personas, programs, rules, historical cases);
* ``client`` for API tests and ``persona_headers`` for authenticated calls.

The environment is configured **before** any ``app.*`` import so that
``app.config.settings`` and ``app.db.engine`` bind to the test database.
"""

from __future__ import annotations

import importlib
import os
import uuid
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import httpx
import pytest

BACKEND_DIR = Path(__file__).resolve().parents[1]

TEST_DATABASE_URL = os.getenv(
    "TEST_DATABASE_URL",
    "postgresql+psycopg://haqdaar:haqdaar@127.0.0.1:5433/haqdaar_test",
)

# --- environment must be set before the app package is imported --------------
os.environ["DATABASE_URL"] = TEST_DATABASE_URL
os.environ.setdefault("AI_PROVIDER", "fake")
os.environ.setdefault("DEMO_MODE", "true")
os.environ.setdefault("RATE_LIMIT_ENABLED", "false")
os.environ.setdefault("APP_ENV", "test")
os.environ.setdefault("RUN_EMBEDDED_WORKER", "false")
os.environ.setdefault("JWT_SECRET", "test-secret-not-a-real-key")
# The committed specimen cards under app/data/doc_eval_set and app/data/demo_docs
# are static artifacts whose QR payloads were signed with the dev default. Using a
# different secret here makes every genuine card fail its HMAC check and come back
# TAMPER_SUSPECTED, which is a false accusation, not a test failure worth having.
os.environ.setdefault("QR_HMAC_SECRET", "dev-qr-secret-change-me")
os.environ.setdefault("UPLOAD_DIR", str(BACKEND_DIR / ".pytest-uploads"))

PERSONA_KEYS: tuple[str, ...] = (
    "widow_fatima",
    "shopkeeper_rasool",
    "helper_ayesha",
    "officer_sana",
    "officer_imran",
    "admin_bilal",
    "admin_platform",
    "auditor_nadia",
    "officer_zakat",
)


# --- database bootstrap -----------------------------------------------------


def _split_url(url: str) -> tuple[str, str]:
    """Return ``(admin_url, database_name)`` for a SQLAlchemy psycopg URL."""
    base, _, database = url.rpartition("/")
    return f"{base}/postgres", database


def _ensure_database() -> None:
    import psycopg

    admin_url, database = _split_url(TEST_DATABASE_URL)
    dsn = admin_url.replace("postgresql+psycopg://", "postgresql://")
    with psycopg.connect(dsn, autocommit=True) as connection:
        exists = connection.execute(
            "SELECT 1 FROM pg_database WHERE datname = %s", (database,)
        ).fetchone()
        if exists is None:
            connection.execute(f'CREATE DATABASE "{database}"')


def _known_revision(script: Any, revision: str) -> bool:
    try:
        script.get_revision(revision)
    except Exception:  # noqa: BLE001 - alembic raises ResolutionError for orphans
        return False
    return True


def _ancestors(script: Any, revision: str) -> set[str]:
    """Every revision ``revision`` descends from, following ``down_revision``."""
    seen: set[str] = set()
    pending = [revision]
    while pending:
        node = script.get_revision(pending.pop())
        down = node.down_revision
        if down is None:
            continue
        for parent in (down,) if isinstance(down, str) else tuple(down):
            if parent not in seen:
                seen.add(parent)
                pending.append(parent)
    return seen


def _revisions_to_drop(recorded: list[str], script: Any) -> list[str]:
    """Which recorded revisions to delete so ``upgrade heads`` can walk forward.

    A single row is a *position*, not a conflict: ``upgrade heads`` walks forward
    from it and applies only what is missing. Deleting it instead reset the
    database to base, so the next upgrade replayed every migration against tables
    that already existed — the DuplicateTable storms on stale-but-migrated test
    databases.

    Only genuine multi-row states need collapsing, and then the fix is to keep the
    most advanced row and drop its ancestors (before the Integration Lead joined
    the two chains at S1, ``app_0001`` and ``dpi_mock_0001`` were separate heads
    and a database could record both; keeping the ancestor makes ``upgrade heads``
    fail with "Requested revision dpi_mock_0001 overlaps with other requested
    revisions app_0001").
    """
    known = [revision for revision in recorded if _known_revision(script, revision)]
    unknown = [revision for revision in recorded if revision not in known]
    if not known:
        # Nothing recognisable to preserve; let alembic fail loudly.
        return []
    if len(known) == 1:
        # A stale-but-migrated database: keep the position, drop only noise.
        return unknown

    ancestry = {revision: _ancestors(script, revision) for revision in known}
    keep = [
        revision
        for revision in known
        if all(other in ancestry[revision] for other in known if other != revision)
    ]
    if not keep:
        # Genuinely divergent heads: alembic upgrades each one, so leave them.
        return unknown
    return unknown + [revision for revision in known if revision not in keep]


def _normalise_version_table(config: Any) -> None:
    """Collapse a stale multi-row ``alembic_version`` without losing the position."""
    from alembic.script import ScriptDirectory
    from sqlalchemy import text

    from app.db import engine

    script = ScriptDirectory.from_config(config)
    with engine.connect() as connection:
        exists = connection.execute(
            text("SELECT to_regclass('public.alembic_version') IS NOT NULL")
        ).scalar()
        if not exists:
            return
        recorded = list(
            connection.execute(text("SELECT version_num FROM alembic_version")).scalars().all()
        )
        stale = _revisions_to_drop(recorded, script)
        if not stale:
            return
        connection.execute(
            text("DELETE FROM alembic_version WHERE version_num = ANY(:stale)"),
            {"stale": stale},
        )
        connection.commit()


def _is_duplicate_object(exc: BaseException) -> bool:
    """True when a migration failed because the object it creates already exists.

    That is the signature of a stale-but-migrated database: the schema is at head
    but ``alembic_version`` is behind, so the replay collides. PostgreSQL reports
    ``duplicate_table`` (42P07) and ``duplicate_object`` (42710).
    """
    seen: set[int] = set()
    current: BaseException | None = exc
    while current is not None and id(current) not in seen:
        seen.add(id(current))
        if getattr(current, "sqlstate", None) in {"42P07", "42710"}:
            return True
        if type(current).__name__ in {"DuplicateTable", "DuplicateObject"}:
            return True
        current = current.__cause__ or current.__context__
    return False


def _migrate() -> None:
    from alembic import command
    from alembic.config import Config

    config = Config(str(BACKEND_DIR / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    config.set_main_option("sqlalchemy.url", TEST_DATABASE_URL)
    os.environ["ALEMBIC_DATABASE_URL"] = TEST_DATABASE_URL
    _normalise_version_table(config)
    try:
        command.upgrade(config, "heads")
    except Exception as exc:
        if not _is_duplicate_object(exc):
            raise
        # The schema is already built but the version marker was behind, so the
        # replay collided with objects that exist. Move the marker forward instead
        # of dropping the database; the second upgrade is then a no-op.
        command.stamp(config, "heads")
        command.upgrade(config, "heads")


@pytest.fixture(scope="session")
def database_url() -> str:
    return TEST_DATABASE_URL


def _clear_rag_tables(db: Any) -> None:
    """Drop RAG rows before the seed's reset.

    ``app/mocks/seed.py::_RESET_ORDER`` deletes ``programs`` (index 15) before
    ``rag_documents`` (index 24), but ``rag_documents.program_id`` references
    ``programs``. As soon as any test has indexed a program the reset dies with a
    ForeignKeyViolation, so the suite only ever ran once against a given database.
    ``seed_all(with_rag=False)`` never repopulates these tables, so clearing them
    here is safe and keeps the suite re-runnable.

    Reported to the Lead: the durable fix is the order in ``_RESET_ORDER``
    (``app/mocks/seed.py`` is DPI-owned).
    """
    from sqlalchemy import delete

    from app.models.ai import RagChunk, RagDocument

    db.execute(delete(RagChunk))
    db.execute(delete(RagDocument))
    db.flush()


@pytest.fixture(scope="session", autouse=True)
def prepared_database(database_url: str) -> Iterator[str]:
    """Create, migrate and seed ``haqdaar_test`` exactly once per session.

    Autouse: teammate suites reach for ``app.db.SessionLocal`` directly, so the
    database has to exist before any test body runs, not only when ``client`` is
    requested.
    """
    _ensure_database()
    _migrate()

    from app.db import SessionLocal
    from app.mocks.seed import seed_all

    db = SessionLocal()
    try:
        _clear_rag_tables(db)
        seed_all(db, reset=True, with_rag=False)
        db.commit()
    finally:
        db.close()
    yield database_url


@pytest.fixture(scope="session")
def app(prepared_database: str) -> Any:
    from app.main import create_app

    return create_app()


@pytest.fixture()
def client(app: Any) -> Iterator[Any]:
    from fastapi.testclient import TestClient

    with TestClient(app, raise_server_exceptions=False) as test_client:
        yield test_client


@pytest.fixture()
def db(prepared_database: str) -> Iterator[Any]:
    """A session for direct database assertions; rolled back on exit."""
    from app.db import SessionLocal

    session = SessionLocal()
    try:
        yield session
    finally:
        session.rollback()
        session.close()


# --- authentication helpers -------------------------------------------------


def _login(client: Any, persona_key: str) -> dict[str, Any]:
    response = client.post("/api/v1/auth/demo-login", json={"persona_key": persona_key})
    assert response.status_code == 200, f"demo-login failed for {persona_key}: {response.text}"
    return response.json()


@pytest.fixture()
def persona_login(client: Any) -> Any:
    """``persona_login("officer_sana")`` -> the full demo-login payload."""

    def _login_persona(persona_key: str) -> dict[str, Any]:
        return _login(client, persona_key)

    return _login_persona


@pytest.fixture()
def persona_headers(client: Any) -> Any:
    """``persona_headers("officer_sana")`` -> ``{"Authorization": "Bearer ..."}``."""

    def _headers(persona_key: str) -> dict[str, str]:
        payload = _login(client, persona_key)
        return {"Authorization": f"Bearer {payload['access_token']}"}

    return _headers


@pytest.fixture()
def citizen_headers(persona_headers: Any) -> dict[str, str]:
    return persona_headers("widow_fatima")


@pytest.fixture()
def helper_headers(persona_headers: Any) -> dict[str, str]:
    return persona_headers("helper_ayesha")


@pytest.fixture()
def officer_headers(persona_headers: Any) -> dict[str, str]:
    return persona_headers("officer_sana")


@pytest.fixture()
def second_officer_headers(persona_headers: Any) -> dict[str, str]:
    return persona_headers("officer_imran")


@pytest.fixture()
def admin_headers(persona_headers: Any) -> dict[str, str]:
    return persona_headers("admin_bilal")


@pytest.fixture()
def platform_admin_headers(persona_headers: Any) -> dict[str, str]:
    return persona_headers("admin_platform")


@pytest.fixture()
def auditor_headers(persona_headers: Any) -> dict[str, str]:
    return persona_headers("auditor_nadia")


@pytest.fixture()
def other_tenant_officer_headers(persona_headers: Any) -> dict[str, str]:
    """An officer in a different tenant — used for the 404-not-403 assertions."""
    return persona_headers("officer_zakat")


# --- convenience lookups ----------------------------------------------------


@pytest.fixture()
def seeded_ids(prepared_database: str) -> dict[str, Any]:
    """Ids of the demo world, looked up by natural key."""
    from sqlalchemy import select

    from app.db import SessionLocal
    from app.models.cases import Case
    from app.models.identity import Citizen, Tenant, User
    from app.models.programs import Program

    db = SessionLocal()
    try:
        tenants = {
            tenant.code: tenant.id for tenant in db.execute(select(Tenant)).scalars().all()
        }
        users = {
            user.email: user.id
            for user in db.execute(select(User)).scalars().all()
            if user.email
        }
        citizens = {
            citizen.full_name: citizen.id
            for citizen in db.execute(select(Citizen)).scalars().all()
        }
        programs = {
            program.code: program.id
            for program in db.execute(select(Program)).scalars().all()
        }
        cases = {
            case.reference_code: case.id
            for case in db.execute(select(Case)).scalars().all()
        }
        return {
            "tenants": tenants,
            "users": users,
            "citizens": citizens,
            "programs": programs,
            "cases": cases,
        }
    finally:
        db.close()


@pytest.fixture()
def unique_key() -> str:
    return f"test-{uuid.uuid4().hex[:16]}"


# --- simulated DPI services, in process -------------------------------------


class InProcessMockTransport(httpx.BaseTransport):
    """Route the agent's outbound mock calls back into the in-process ASGI app.

    ``app/agent/mock_client.py`` speaks HTTP to ``MOCK_BASE_URL``; in a test the same
    routes are already mounted on the app under ``/mock``. Delegating to the
    ``TestClient`` keeps a drill on the real client, the real retry policy and the
    real mock handlers without binding a port.
    """

    def __init__(self, test_client: Any) -> None:
        self._client = test_client

    def handle_request(self, request: httpx.Request) -> httpx.Response:
        response = self._client.request(
            request.method,
            request.url.path,
            params=request.url.params,
            headers=request.headers,
            content=request.read(),
        )
        return httpx.Response(
            response.status_code,
            headers=response.headers,
            content=response.content,
            request=request,
        )


@pytest.fixture()
def in_process_mocks(monkeypatch: pytest.MonkeyPatch, client: Any) -> Iterator[None]:
    """Point the case agent's ``MockClient`` at the in-process app.

    Use this whenever a test drives the pipeline through the API rather than through
    a live uvicorn server (see ``tests/integration/test_golden_path_and_rules.py``
    for the live-server variant).
    """
    case_agent = importlib.import_module("app.agent.case_agent")
    mock_client_module = importlib.import_module("app.agent.mock_client")
    transport = InProcessMockTransport(client)

    def factory(base_url: str, **kwargs: Any) -> Any:
        kwargs.pop("transport", None)
        kwargs.pop("sleep", None)
        return mock_client_module.MockClient(
            base_url, transport=transport, sleep=lambda _seconds: None
        )

    monkeypatch.setattr(case_agent, "MockClient", factory)
    yield
