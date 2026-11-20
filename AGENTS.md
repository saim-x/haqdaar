# AGENTS.md — Haqdaar Engineering Charter (Coder's Cup 2026)

> **STOP AND READ BEFORE WRITING A SINGLE LINE OF CODE.**
> The complete, frozen architectural blueprint lives in [`docs/00-index.md`](docs/00-index.md). Find your assigned agent playbook (A1–A7) in [`docs/14-agent-playbooks.md`](docs/14-agent-playbooks.md).

---

## 1. Non-Negotiable Competition Rules (Disqualification Hazards)
1. **ZERO REAL PERSONAL DATA.** All citizens, CNICs (must start with fictional prefix `99900`), phones, and documents are 100 % synthetic. All generated card images MUST be watermarked `MOCK SPECIMEN`.
2. **MOCK ALL EXTERNAL DPI SERVICES.** Identity, Civil Registry, Household Survey, Benefits, Raast Payments, Complaints, and SMS live under `/mock/v1/*`, tag every response `"simulated": true`, and are called strictly over HTTP (`MOCK_BASE_URL`).
3. **LABEL AS PROTOTYPE.** Persistent prototype banner on every UI route + `/transparency` Real vs Simulated page.
4. **ORIGINAL CODE ONLY.** Everything built inside the hackathon window (Fri 20 Nov 18:00 – Sun 22 Nov 18:00 PKT).

---

## 2. Frozen Tech Stack (Do Not Substitute)
- **Backend:** Python 3.12 · FastAPI · Pydantic v2 · **Sync** SQLAlchemy 2.0 + `psycopg[binary]` v3 · Alembic · PostgreSQL 16 · Postgres `SKIP LOCKED` job queue (no Redis/Celery).
- **Frontend:** React 18 · Vite 5 · TypeScript 5 · Tailwind CSS · `vite-plugin-pwa` (Workbox) · TanStack Query v5 · Dexie.js (IndexedDB) · Route-split chunks (Citizen/Helper PWA bundle **≤ 150 KB gzipped**).
- **AI & ML:** Strict `AIProvider` (`AI_PROVIDER=live|fake`) · OpenAI `gpt-4o-mini` / `whisper-1` / `text-embedding-3-small` · `edge-tts` + pre-cached Urdu MP3s · OpenCV (`opencv-python-headless`) + HMAC-signed QR · `scikit-learn` TF-IDF+LR calibrated scam model · RapidFuzz entity resolution · Hybrid Postgres `tsvector` + NumPy cosine RAG (no `pgvector` dependency).

---

## 3. Architectural Invariants (Enforced by Automated Tests)
1. **LLM proposes, policy disposes.** `backend/app/engine/` MUST remain 100 % pure Python (zero imports from `sqlalchemy`, `fastapi`, `httpx`, `openai`, `app.mocks`).
2. **NEVER AUTO-REJECT.** There is NO `AUTO_REJECT` route action. Transition `PROCESSING -> REJECTED` MUST raise `409 INVALID_TRANSITION`. Only an `OFFICER` can reject.
3. **Unknown is a first-class value.** Canonical facts ([`docs/04-data-model.md §5`](docs/04-data-model.md)) are tri-state (`KNOWN` / `UNKNOWN`). Never substitute default values for missing fields.
4. **Strict Mock HTTP Boundary.** `app/api/`, `app/engine/`, and `app/agent/` MUST NEVER import `app/mocks/models.py` or query `mock_*` tables directly. Always call `MOCK_BASE_URL` via `httpx`.
5. **Server-Side Authority Only.** Every endpoint enforces JWT RBAC, derives `tenant_id` exclusively from the token (returns `404` for foreign tenant/citizen IDs — never `403` existence leaks), and calls `enforce_consent(...)` on every citizen-data read.
6. **Persist Denied Consent Attempts.** `enforce_consent()` MUST commit denied `consent_access_logs` + `audit_events` rows in an isolated DB session BEFORE raising `403 CONSENT_REVOKED`, so request rollbacks never erase the blocked-access log.
7. **Hash-Chained Audit Everything.** Every state mutation and AI/agent step calls `audit.record(db, ...)` inside the same transaction. Never log raw 13-digit CNICs, OTPs, passwords, or JWTs.
8. **Idempotent Offline Mutations.** Citizen/Helper write endpoints honour `Idempotency-Key` (replays return cached response; payload mismatch returns `409 IDEMPOTENCY_CONFLICT`).

---

## 4. Contract & Ownership Discipline
- **Do not invent** table columns, canonical fact keys, error codes, or API routes outside [`docs/04-data-model.md`](docs/04-data-model.md) and [`docs/05-api-contracts.md`](docs/05-api-contracts.md).
- **Do not edit files outside your Owned Paths** in [`docs/14-agent-playbooks.md`](docs/14-agent-playbooks.md).
- If a contract change is genuinely required, stop and notify the Integration Lead to update `04`/`05` and append an ADR to [`docs/17-decision-log.md`](docs/17-decision-log.md).
- Before merging any branch to `main`, verify:
  - `ruff check backend/app backend/tests`
  - `AI_PROVIDER=fake pytest backend/tests/engine backend/tests/test_invariants.py -q`
  - `npm --prefix frontend run typecheck`
