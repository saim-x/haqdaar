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

import os
import uuid
from collections.abc import Iterator
from pathlib import Path
from typing import Any

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
os.environ.setdefault("QR_HMAC_SECRET", "test-qr-secret-not-a-real-key")
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


def _migrate() -> None:
    from alembic import command
    from alembic.config import Config

    config = Config(str(BACKEND_DIR / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    config.set_main_option("sqlalchemy.url", TEST_DATABASE_URL)
    os.environ["ALEMBIC_DATABASE_URL"] = TEST_DATABASE_URL
    command.upgrade(config, "heads")


@pytest.fixture(scope="session")
def database_url() -> str:
    return TEST_DATABASE_URL


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
