# 03 - System Architecture & Technical Foundation

> **Status:** FROZEN v1.0. Source of truth for technology selection, runtime topology, module boundaries, deployment, and error handling.
> **Audience:** All coding agents (A1–A7) and Integration Lead.

---

## 1. Architectural Thesis

Haqdaar is a **modular monolith with a transactional Postgres worker and a split-bundle React PWA**.

This architecture is intentionally chosen for a 48-hour, multi-agent hackathon where **reliability, server-side security enforcement, auditability, and integration velocity** decide the winner:

1. **Single authoritative backend (`backend/`)**: One FastAPI service owns authentication, RBAC, tenant isolation, consent enforcement, audit hashing, and API contracts. No microservice network hops or distributed transaction failures.
2. **Pure decision kernel (`backend/app/engine/`)**: Zero database, network, or LLM dependencies. Takes structured facts + a versioned rule JSON and returns a deterministic decision trace. This makes the rule engine, Digital Twin, and threshold sweep trivially testable and 100 % reproducible.
3. **LLM proposes, policy disposes**: All AI models sit behind a strict `AIProvider` interface (`live` or `fake` mode) and can only *extract*, *classify*, *retrieve*, or *phrase*. They never write `APPROVED` or `REJECTED` directly.
4. **Simulated DPI services behind real HTTP boundaries (`backend/app/mocks/`)**: Mounted under `/mock/*` and called by the case agent exclusively over `httpx` to `MOCK_BASE_URL` (never imported directly by case logic), ensuring clean API separation and authentic latency/failure chaos testing.
5. **Single-origin deployment**: In production, one reverse proxy (or FastAPI static mount) serves both the Vite PWA (`/`) and the API (`/api/*`, `/mock/*`). Zero CORS/SameSite issues, clean PWA Service Worker scope, and minimal deployment surface.

---

## 2. Technology Stack & Justification

| Layer | Selected Technology | Version | Rationale (48h & Judging Lens) | Rejected Alternative |
|---|---|---|---|---|
| **Backend API** | **Python + FastAPI + Pydantic v2** | Py 3.12, FastAPI 0.115+ | Auto-generates OpenAPI/Swagger (CORE-4), strict schema validation (Structured Outputs), native ecosystem for OpenCV, scikit-learn, RapidFuzz, OpenAI SDK. | Node/Express (weak ML/CV libs); Django (heavier async/OpenAPI story). |
| **ORM & Migrations** | **SQLAlchemy 2.0 (sync) + `psycopg[binary]` v3 + Alembic** | SA 2.0, Alembic 1.13+ | Sync SQLAlchemy in FastAPI `def` routes (threadpool) eliminates `MissingGreenlet`/async session bugs across 7 agents and works cleanly with CPU-bound OpenCV/scikit-learn and Alembic. | Async SQLAlchemy + asyncpg (high agent bug rate under time pressure). |
| **Database** | **PostgreSQL 16** | PG 16 | Required by brief ("Postgres or Supabase"). Gives `JSONB`, `FOR UPDATE SKIP LOCKED` job queue, `tsvector` full-text search, and strict foreign keys/constraints. | SQLite (fails brief requirement); MongoDB (weak relational/audit integrity). |
| **Background Jobs** | **Postgres-backed job table (`jobs`) + Python worker** | Custom ~180 LOC | Transactional enqueue in the same DB commit as case submit; zero Redis dependency; admin Jobs UI reads the same table directly. | Celery + Redis (extra infra service, serialization/broker failure modes). |
| **Frontend & PWA** | **React 18 + Vite + TypeScript + Tailwind CSS + `vite-plugin-pwa`** | React 18, Vite 5, TS 5 | Route-based code splitting keeps Citizen PWA ≤ 150 KB gzipped; Workbox service worker handles true offline app-shell caching without SSR hydration failures. | Next.js App Router (larger client runtime, fragile offline-first caching). |
| **Offline Storage & State** | **Dexie.js (IndexedDB) + TanStack Query v5 + React Router v6** | Dexie 4, TQ 5 | Structured local drafts + persistent offline mutation outbox with `Idempotency-Key` replay; ETag-friendly polling. | localStorage (5 MB cap, no blobs/photos, synchronous blocking). |
| **AI - LLM / Voice / Embeddings** | **OpenAI-compatible `AIProvider` (`gpt-4o-mini` + `text-embedding-3-small` by default; the live demo runs Mistral `mistral-small-latest` + `mistral-embed` through the same SDK) + Deepgram Nova-3 STT + Deepgram Flux TTS for pre-cached Urdu MP3s + Gemini for Sindhi playback + `edge-tts` for dynamic speech** | SDK v1.50+ | One SDK and one call site for any OpenAI-compatible gateway, so the vendor is a config value (`OPENAI_BASE_URL`), not a code change. Strict JSON-schema outputs, Urdu transcription, and pre-generated static Urdu prompts that work offline. | Self-hosted LLMs (GPU/deployment overhead); ElevenLabs (expensive, rate-limited). |
| **AI - Scam Classifier** | **scikit-learn (`TfidfVectorizer` + `CalibratedClassifierCV`) + Rule Engine** | sklearn 1.5+ | < 5 ms local inference, genuinely calibrated probabilities, reproducible confusion matrix & false-positive rate on held-out test set. | LLM-only scam classifier (uncalibrated scores, high latency, brittle eval). |
| **AI - Computer Vision** | **OpenCV (`opencv-python-headless`) + Pillow + `qrcode` + HMAC-SHA256** | OpenCV 4.10+ | Built-in `QRCodeDetector` + Laplacian blur detection without native `libzbar` OS library issues; signed QR enables verifiable forgery detection; vision LLM/fixture OCR compares printed vs QR text. | Tesseract system binary (flaky Docker/Windows setup, noisy on Urdu/angled photos). |
| **AI - RAG** | **Hybrid Postgres `tsvector` + NumPy cosine similarity over stored `FLOAT8[]` embeddings** | Built-in | Works on any standard PostgreSQL 16 (Neon/Supabase/Docker) without requiring `pgvector` extension; fast (< 15 ms for < 5,000 chunks). | Chroma/Pinecone (extra vector DB service to host and sync). |
| **Entity Resolution** | **RapidFuzz + Custom Urdu/Roman-Urdu Canonicalizer** | RapidFuzz 3.x | C++-accelerated Jaro-Winkler & token-set ratios; deterministic, explainable per-field match breakdown. | Embedding similarity (opaque, hallucinates matches on short names). |
| **Deployment** | **Docker Compose (local/fallback) + Render (cloud) + Neon (managed Postgres)** | Docker v2 | One Render Docker web service built from the same multi-stage Dockerfile, with `RUN_EMBEDDED_WORKER=true` keeping the SKIP LOCKED queue alive without a second service; Neon supplies managed PostgreSQL 16. Local Docker Compose guarantees demo immunity to venue Wi-Fi outages. | Railway (planned, not used); Kubernetes (massive overkill). |

---

## 3. High-Level System Architecture

```mermaid
flowchart TB
    subgraph Clients["Client Layer (Single Origin)"]
        PWA["Citizen & Helper PWA\n(/c/*, /h/*, /scam-check)\n≤150KB gzip, Offline Outbox + IndexedDB"]
        StaffUI["Staff Consoles\n(/staff/*, /admin/*, /auditor/*)\nLazy-loaded Chunks"]
        ExtAPI["External API Consumers\n(Swagger / X-API-Key)"]
    end

    subgraph Backend["FastAPI Application (api service)"]
        Auth["Auth / JWT / OTP / API-Key"]
        Guards["Server-Side Guards\nRBAC + Tenant + Consent Enforcement"]
        Routers["REST Routers (/api/v1/*)"]
        Engine["Pure Decision Engine\n(Rules DSL, Confidence, Entity Res, Twin)"]
        AI["AI Service Layer\n(AIProvider: live | fake)\nVoice, CV, Scam, RAG, Guardrails"]
        Audit["Hash-Chained Audit Writer"]
        Mocks["Simulated DPI Services (/mock/*)\nIdentity, Civil, Household, Benefits,\nPayment, Complaint, SMS Inbox + Chaos"]
    end

    subgraph Worker["Background Worker (worker service)"]
        Poller["Postgres SKIP LOCKED Job Runner\nPROCESS_CASE, INITIATE_PAYMENT,\nVERIFY_DOCUMENT, REINDEX_RAG,\nRETRY_EXTERNAL"]
    end

    subgraph Storage["Data Layer"]
        PG[("PostgreSQL 16\nApp Tables, Rules, Decisions,\nConsent, Audit Chain, Jobs,\nRAG Chunks + Embeddings")]
        FS[("File Storage\nLocal Volume /data/uploads\n(Compressed Images, Audio)")]
    end

    PWA -->|HTTPS + Idempotency-Key| Auth
    StaffUI -->|HTTPS| Auth
    ExtAPI -->|X-API-Key| Auth
    Auth --> Guards --> Routers
    Routers --> Engine
    Routers --> AI
    Routers --> Audit
    Routers --> PG
    Routers --> FS

    Worker --> PG
    Worker --> Engine
    Worker --> AI
    Worker --> Audit
    Worker -->|HTTP via httpx to MOCK_BASE_URL| Mocks
    Mocks --> PG
```

---

## 4. Repository Layout & Strict Module Ownership

Every agent owns specific directories. Cross-boundary changes require Integration Lead approval (see [14-agent-playbooks.md](14-agent-playbooks.md)).

```text
haqdaar/
├── AGENTS.md                        # Root instructions for all AI coding agents
├── README.md                        # Competition submission README (real vs simulated)
├── docker-compose.yml               # Local dev & venue demo fallback (db, api, worker, web)
├── .env.example                     # All environment variables documented
├── docs/                            # This frozen planning suite (00–17)
│
├── backend/
│   ├── pyproject.toml               # Python 3.12 dependencies & pytest/ruff config
│   ├── alembic.ini                  # Alembic configuration
│   ├── alembic/versions/            # Ordered DB migrations (owned by A1)
│   ├── app/
│   │   ├── main.py                  # FastAPI app factory, middleware, error handlers, static mount (A1)
│   │   ├── config.py                # Pydantic Settings (A1)
│   │   ├── db.py                    # SQLAlchemy engine, SessionLocal, Base (A1)
│   │   ├── models/                  # SQLAlchemy ORM models matching 04-data-model.md (A1)
│   │   ├── schemas/                 # Pydantic request/response DTOs matching 05-api-contracts.md (A1)
│   │   ├── security/                # JWT, password hash, OTP, RBAC, Tenant, Consent guard, Audit (A1)
│   │   ├── api/v1/                  # REST routers: auth, cases, consent, helper, officer, admin, auditor, public, eval, rag, scam, voice, docs (A1, A2, A4)
│   │   ├── jobs/                    # Job queue enqueue/claim/retry + worker entrypoint (A1)
│   │   ├── engine/                  # PURE Python: rules_dsl, evaluator, confidence, router, entity_resolution, anomalies, explainer, twin, eval_sweep (A2)
│   │   ├── agent/                   # Case-processing deterministic agent orchestrator calling mock HTTP APIs (A2)
│   │   ├── ai/                      # AIProvider (live|fake), voice, doc_verify, scam_classifier, rag, guardrails, telemetry (A4)
│   │   ├── mocks/                   # Simulated DPI FastAPI router (/mock/*), chaos middleware, synthetic generator, seed script, doc QR generator (A3)
│   │   └── data/                    # Synthetic policy docs (Markdown), scam dataset JSONL, eval case fixtures, pre-generated Urdu audio prompts (A3, A4)
│   └── tests/                       # Unit, integration, security/RBAC, consent, engine, chaos, AI eval tests (A7 + owners)
│
└── frontend/
    ├── package.json                 # React 18, Vite 5, TS 5, Tailwind, Dexie, TanStack Query, vite-plugin-pwa
    ├── vite.config.ts               # Manual chunks (citizen vs staff), PWA Workbox config
    ├── public/
    │   ├── audio/ur/                # Pre-generated static Urdu prompt MP3s (zero-latency offline audio)
    │   └── icons/                   # PWA icons & low-literacy SVG pictograms
    └── src/
        ├── main.tsx                 # Router + QueryClient + PrototypeBanner + OfflineSyncProvider
        ├── shared/                  # Typed API client, auth store, Dexie DB, offline outbox, i18n (ur/en), shared UI primitives (A5/A6 shared contract)
        ├── citizen/                 # Citizen home, icon/audio wizard, consent center, my-data, scam checker, policy Q&A, status timeline (A5)
        ├── helper/                  # Helper family list, safe switcher, OTP/verbal consent capture (A5)
        ├── staff/                   # Officer queue & review, Admin (rules, twin, users, keys, mocks, jobs), Auditor console, Eval & Analytics dashboards, Transparency, Device Simulator (A6)
        └── e2e/                     # Playwright critical-path specs (A7)
```

---

## 5. Runtime Components & Service Topology

### 5.1 Processes
1. **`api` (FastAPI + Uvicorn)**: Serves `/api/v1/*`, `/api/docs`, `/api/openapi.json`, `/mock/*`, `/health`, and (in production) static frontend build assets from `/app/static`.
2. **`worker` (`python -m app.jobs.worker`)**: Polls `jobs` table every 500 ms using `SELECT ... FOR UPDATE SKIP LOCKED`, executes at most 4 concurrent jobs in a threadpool, updates status/retries, and writes structured JSON logs.
3. **`db` (PostgreSQL 16)**: Single relational database storing application state, mock registry state (in `mock_*` tables), RAG chunks, jobs, and hash-chained audit logs.

> **Why keep `mock_*` tables in the same Postgres instance?** Zero extra DB to manage, transactional demo reset (`POST /api/v1/admin/demo/reset` resets both app and mock state cleanly in < 2 s), while logical isolation is strictly enforced: **application code in `app/api/`, `app/engine/`, and `app/agent/` is forbidden from importing `app/mocks/models.py` or querying `mock_*` tables directly.** All access must go through `httpx` to `MOCK_BASE_URL`.

### 5.2 File Storage
- Uploads (compressed CNIC/death certificate JPEGs, witnessed verbal consent audio, scam screenshots) are written to `UPLOAD_DIR` (`/data/uploads`, a persistent Docker volume locally and a Render disk in the cloud) with UUID filenames (never user-supplied filenames).
- File download endpoint (`GET /api/v1/documents/{id}/file`) enforces RBAC, tenant isolation, and **active citizen consent** before streaming bytes. No unauthenticated static URL for uploaded PII documents.

### 5.3 Configuration & Environment Variables

| Variable | Default (Dev) | Production / Demo | Purpose |
|---|---|---|---|
| `DATABASE_URL` | `postgresql+psycopg://haqdaar:haqdaar@localhost:5432/haqdaar` | Neon PG URL (`postgresql://` is rewritten to `postgresql+psycopg://` by `scripts/start.sh`) | Primary DB connection |
| `JWT_SECRET` | `dev-secret-change-me` | 64-char random hex | HS256 JWT signing |
| `QR_HMAC_SECRET` | `dev-qr-secret-change-me` | 64-char random hex | Signs mock document QR codes |
| `MOCK_BASE_URL` | `http://127.0.0.1:8000/mock` | `http://api:8000/mock` | HTTP boundary for simulated DPI |
| `AI_PROVIDER` | `fake` | `live` (fallback `fake`) | Switches OpenAI live calls vs deterministic fixtures |
| `OPENAI_API_KEY` | `""` | Secret key | Required when `AI_PROVIDER=live` |
| `DEEPGRAM_API_KEY` | `""` | Secret key in root `.env` | Required only when generating static Urdu MP3s |
| `OPENAI_CHAT_MODEL` | `gpt-4o-mini` | `gpt-4o-mini` | Extraction, RAG, phrasing |
| `OPENAI_EMBED_MODEL` | `text-embedding-3-small` | `text-embedding-3-small` | RAG embeddings |
| `OPENAI_STT_MODEL` | `whisper-1` | `whisper-1` | Urdu speech-to-text |
| `DEMO_MODE` | `true` | `true` (hackathon) / `false` (prod test) | Enables `/auth/demo-login` and `/admin/demo/reset` |
| `UPLOAD_DIR` | `./data/uploads` | `/data/uploads` | Persistent volume for uploads |
| `RATE_LIMIT_ENABLED` | `true` | `true` | Toggle in unit tests if needed |
| `LOG_LEVEL` | `INFO` | `INFO` | Structured JSON logging |

---

## 6. Cross-Cutting Concerns

### 6.1 Structured Logging & Request Correlation
- Every HTTP request gets an `X-Request-ID` (propagated if provided, else UUIDv4) stored in `contextvars` and echoed in response headers and every log line + audit event.
- Log format: single-line JSON `{ts, level, request_id, actor_id, tenant_id, event, path, status, duration_ms}`.
- **PII Redaction Rule:** CNIC numbers, raw phone numbers, passwords, OTPs, and JWTs MUST NEVER be logged in plain text. Helper `mask_cnic("42101-1234567-2")` → `"42101-****567-2"` is mandatory for all logs and UI list views.

### 6.2 Error Handling & Global Exception Mapping
Every unhandled or domain exception is converted by FastAPI exception handlers into the uniform error envelope defined in [05-api-contracts.md §2](05-api-contracts.md). Stack traces are logged server-side and never returned to clients.

### 6.3 Rate Limiting
In-memory sliding-window limiter (keyed by IP, phone, user_id, or api_key_id; resets cleanly on restart - sufficient for single-instance hackathon deployment):
- `POST /api/v1/auth/otp/request`: 3 / 10 min per phone + 10 / 10 min per IP.
- `POST /api/v1/auth/login`: 10 / 10 min per IP.
- `POST /api/v1/scam/check` (anonymous): 20 / min per IP.
- `POST /api/v1/voice/*` & `POST /api/v1/rag/ask`: 30 / min per user.
- Public API (`/api/v1/public/*`): configurable `rate_limit_per_min` per API key (default 60 / min).
- Returns `429 RATE_LIMITED` with `Retry-After` header.

### 6.4 Health, Metrics & Monitoring
- `GET /health`: Checks DB `SELECT 1`, worker heartbeat (`worker_heartbeats` updated every 10 s; warns if > 30 s stale), and upload directory writability. Returns `200 OK` or `503 DEGRADED`.
- `GET /api/v1/metrics/summary` (Admin/Auditor): Request error rate, p50/p95 pipeline latency, job queue depths (`PENDING`, `RUNNING`, `DEAD`), LLM call count / estimated USD cost / failure count, mock service health status.

### 6.5 Deployment Blueprint
1. **Cloud (Primary Demo):** one Render Docker web service (`render.yaml`) plus a Neon managed PostgreSQL 16 database.
   - `haqdaar` (Render, `runtime: docker`): the same multi-stage Dockerfile used locally (Stage 1 builds `frontend/` with Vite; Stage 2 installs the Python backend and copies `frontend/dist` to `/app/static`). `scripts/start.sh` runs `alembic upgrade head`, seeds the mock registries, and binds Uvicorn to `$PORT`.
   - `RUN_EMBEDDED_WORKER=true` runs the SKIP LOCKED job worker inside the API process, so the single-container plan keeps the queue alive without a second service. `docker-compose.yml` still runs `worker` as its own service for local parity.
   - Neon supplies `DATABASE_URL`; `scripts/start.sh` rewrites the `postgresql://` scheme to `postgresql+psycopg://`. Uploads land on the Render disk at `/data/uploads`.
   - `JWT_SECRET` and `QR_HMAC_SECRET` are generated by the blueprint (`generateValue: true`) and never committed.
2. **Local Venue Fallback (Mandatory):** `docker compose up --build` on a team laptop running the exact same image, pre-warmed and tested Sunday night, ready to present locally if FAST-NUCES Karachi Wi-Fi drops.

---

## 7. Architectural Invariants (Automated Checks)

1. `app/engine/` has zero imports from `sqlalchemy`, `fastapi`, `httpx`, `openai`, or `app.mocks`.
2. `app/api/` and `app/agent/` have zero imports from `app.mocks.models` or `app.mocks.db`.
3. Every route under `/api/v1/` (except `/auth/*`, `/scam/check`, `/health`, `/transparency`) declares an explicit RBAC dependency.
4. Every read of citizen PII data calls `enforce_consent(...)` and writes an `access_log` entry (allow or deny).
5. Every state mutation on cases, rules, consents, payments, and users writes an `audit_events` row in the same DB transaction.
