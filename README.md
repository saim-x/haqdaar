# Haqdaar — backend platform

Multi-tenant, AI-assisted public benefit delivery with server-side consent
enforcement, a hash-chained audit trail and an anti-scam checker.

> **PROTOTYPE.** Every citizen, CNIC, phone number and document in this system is
> synthetic. CNICs always start with `99900` and every government service under
> `/mock/v1/*` is simulated. Nothing here is connected to a real registry.

## Stack

Python 3.12 · FastAPI · Pydantic v2 · **sync** SQLAlchemy 2.0 + `psycopg` v3 ·
Alembic · PostgreSQL 16 · a Postgres `SKIP LOCKED` job queue (no Redis, no Celery).

## Quick start

```bash
cp .env.example .env          # HOST_DB_PORT=5433, HOST_API_PORT=8010 by default
docker compose up --build     # db + api + worker
open http://127.0.0.1:8010/api/docs
curl http://127.0.0.1:8010/health
```

Just the database, for tests:

```bash
docker compose up -d db
```

## Local (no Docker for the app)

```bash
cd backend
python -m venv .venv && ./.venv/Scripts/pip install -e ".[dev]"
alembic upgrade head
uvicorn app.main:app --reload --port 8010
python -m app.jobs.worker          # in a second shell
```

## Gates

```bash
ruff check backend/app backend/tests
AI_PROVIDER=fake pytest backend/tests -q
```

`pytest` needs a reachable Postgres. The suite creates and migrates a dedicated
`haqdaar_test` database; point it at your dev instance with `TEST_DATABASE_URL`
(default `postgresql+psycopg://haqdaar:haqdaar@127.0.0.1:5433/haqdaar_test`).

## Layout

```
backend/app/
  main.py            app factory, middleware, error envelope, /health
  config.py          Pydantic Settings (docs/03 §5.3)
  db.py              sync engine, SessionLocal, Base
  models/            every app table (docs/04 §4.1-4.5)
  schemas/           request/response models, serialisers, canonical facts
  security/          jwt, otp, passwords, rbac, audit chain, consent, idempotency
  jobs/              queue, worker, handler registry, payment runner
  api/v1/            auth, programs, cases, documents, consent, me, helper,
                     officer, admin_*, auditor, public, analytics, transparency
  engine/            pure-Python rules engine (no I/O imports)
  agent/             case agent, fact assembly, mock client
  ai/                provider, doc verify, scam classifier, RAG, voice
  mocks/             simulated DPI services mounted at /mock
backend/alembic/     app_0001 (app tables) + dpi_mock_0001 (mock tables)
```

## Invariants the tests enforce

1. `app/engine/` imports no I/O library — it is pure Python.
2. `app/api/` and `app/agent/` never import `app.mocks.models` or query `mock_*`
   tables; they call `MOCK_BASE_URL` over HTTP.
3. `PROCESSING -> REJECTED` raises `409 INVALID_TRANSITION`. There is no
   `AUTO_REJECT` route action; only an officer can reject.
4. Canonical facts are tri-state. `UNKNOWN` is never replaced by a default.
5. `tenant_id` comes from the verified JWT. Foreign resources answer `404`.
6. Every citizen-data read calls `enforce_consent(...)`; a denied access is
   committed in an isolated session *before* the `403` is raised.
7. Every mutation writes an `audit_events` row in the same transaction, and the
   chain is verifiable end to end.
8. Mutating citizen/helper endpoints honour `Idempotency-Key`.

## Demo personas

`POST /api/v1/auth/demo-login` with `{"persona_key": "..."}` — available only
when `DEMO_MODE=true` (otherwise `404`):

`widow_fatima` · `shopkeeper_rasool` · `helper_ayesha` · `officer_sana` ·
`officer_imran` · `admin_bilal` · `admin_platform` · `auditor_nadia` ·
`officer_zakat`

## Transparency

`GET /api/v1/transparency` lists every subsystem as real or simulated. The
prototype banner is served on every UI route and `X-Prototype: true` is set on
every API response.
