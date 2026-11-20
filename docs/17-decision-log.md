# 17 — Architectural Decision Records (ADR Log) & Change Control

> **Status:** FROZEN v1.0. Any deviation from Docs `01–16` during development MUST be appended here by the Integration Lead before merging code.

---

## ADR-001: Central Use Case — Cash-Relief Grant (Sahara Widow Support Grant)
- **Context:** Brief asks for one deep public task uniting the widow, shopkeeper, and helper personas.
- **Decision:** Build end-to-end widow benefit application → verification → decision → payment → anti-scam verification, with a second config-driven program (`Guzara Allowance`) proving multi-tenancy.
- **Rationale:** Directly exercises monetary cost-of-being-wrong, forged documents, messy registries, fake "relief payment" SMS, consent, and shared-phone helper workflows in one coherent narrative.

## ADR-002: LLM Proposes, Deterministic Policy Disposes
- **Context:** Temptation in AI hackathons to let an LLM decide eligibility and output a self-reported confidence score.
- **Decision:** Keep `app/engine/` 100 % pure Python with zero LLM calls; use LLMs/ML only for extraction, voice, OCR, scam scoring, and grounded RAG. Never implement `AUTO_REJECT`.
- **Rationale:** Guarantees deterministic replay (Digital Twin), verifiable rule hashes for auditors, calibrated threshold sweeps, immunity to prompt injection in decisions, and resilience if OpenAI fails during the live demo.

## ADR-003: Synchronous SQLAlchemy 2.0 + `psycopg` v3 (Over Async)
- **Context:** FastAPI supports both `async def` and sync `def` routes.
- **Decision:** Use synchronous SQLAlchemy 2.0 + `psycopg[binary]` in FastAPI `def` endpoints (executed in AnyIO threadpool).
- **Rationale:** Eliminates `MissingGreenlet` / detached-session / event-loop bugs across 7 parallel agents and integrates cleanly with Alembic, pytest, OpenCV, and scikit-learn.

## ADR-004: PostgreSQL `SKIP LOCKED` Job Queue (Over Celery + Redis)
- **Context:** Case processing, payments, RAG re-indexing, and mock-outage retries require background jobs.
- **Decision:** Store jobs in a PostgreSQL `jobs` table claimed via `SELECT ... FOR UPDATE SKIP LOCKED` by `app/jobs/worker.py` (with optional `RUN_EMBEDDED_WORKER=true` for simple single-container deploy).
- **Rationale:** Transactional enqueue in the same commit as case submit (zero lost jobs), zero Redis dependency to deploy or debug, and native Admin Jobs UI directly over the table.

## ADR-005: React 18 + Vite PWA With Route-Split Bundles (Over Next.js)
- **Context:** Challenge 07 requires true offline support and tiny pages for weak connections, while Staff Consoles need rich dashboards.
- **Decision:** Single Vite React TypeScript app with `vite-plugin-pwa` (Workbox) and `React.lazy` route splitting isolating `/staff/*`, `/admin/*`, `/auditor/*` from the ≤ 150 KB gzipped Citizen/Helper PWA bundle.
- **Rationale:** Clean offline app-shell caching without Next.js SSR/RSC hydration failures; smaller citizen JS footprint; single-origin static serving from FastAPI eliminates CORS/SameSite friction.

## ADR-006: Hybrid Postgres `tsvector` + NumPy Cosine RAG (Over `pgvector`/Chroma)
- **Context:** Need grounded RAG over ~5–15 policy documents (~150–400 chunks) without deployment fragility.
- **Decision:** Store embeddings in standard PostgreSQL `DOUBLE PRECISION[]` alongside `TSVECTOR` and compute hybrid ranking in Python/NumPy (< 15 ms).
- **Rationale:** Works out-of-the-box on every managed Postgres (Railway/Supabase/Docker) with zero custom extensions or external vector DB services.

## ADR-007: Signed-QR + OpenCV + OCR Document Verification (Over Tesseract-Only)
- **Context:** Document forgery detection (Challenge 08) must catch edited names without falsely accusing genuine WhatsApp-compressed photos.
- **Decision:** Use OpenCV Laplacian blur (`NEEDS_RETAKE`), `cv2.QRCodeDetector` + `HMAC-SHA256` signature check, and printed-text OCR cross-check against QR payload (`TAMPER_SUSPECTED`). Missing QR or low quality degrades to `UNVERIFIABLE` / `NEEDS_RETAKE`.
- **Rationale:** Avoids flaky OS binary installs (`tesseract`/`libzbar`), achieves `0 %` false-tamper rate on compressed genuine cards, and demonstrates cryptographic + AI defense-in-depth.

## ADR-008: Isolated DB Session for Denied Consent Access Logging
- **Context:** Raising HTTP `403 CONSENT_REVOKED` inside a FastAPI request normally triggers a SQLAlchemy transaction rollback, which would erase the `consent_access_logs` entry.
- **Decision:** `enforce_consent()` persists denied access rows and `consent.access_denied` audit events using a separate short-lived `SessionLocal()` commit before raising `ConsentRevokedError`.
- **Rationale:** Guarantees citizens and auditors immediately see blocked access attempts (Challenge 06).

## ADR-009: `AI_PROVIDER=live|fake` Dual Mode & Pre-Generated Static Urdu Prompts
- **Context:** Live demos can suffer OpenAI rate limits, latency spikes, or venue Wi-Fi issues; CI tests must be fast and free.
- **Decision:** Pre-generate ~45 static Urdu MP3 prompts (`ur-PK-UzmaNeural`) cached in the PWA; route all dynamic AI calls through `AIProvider` with automatic fallback to `FakeDeterministicProvider` and deterministic rule-template explanations.
- **Rationale:** Zero-latency offline audio for citizens, < 45 s deterministic CI tests, and an unbreakable live demo.

## ADR-010: Single Database With Strict Import Boundary for Mock DPI Services
- **Context:** Brief requires clean APIs for mock identity/payment/data services and a fast demo reset.
- **Decision:** Store `mock_*` tables in the same PostgreSQL instance for atomic `< 5 s` demo reset, but enforce via `test_invariants.py` that `app/api/`, `app/engine/`, and `app/agent/` NEVER import `app/mocks/` and call `/mock/v1/*` strictly over HTTP (`httpx`).
- **Rationale:** Full architectural separation + authentic HTTP chaos testing without managing a second database.

---

## Change Control Protocol (During Hackathon)
1. Minor bug fixes within a single agent's owned files need no ADR.
2. Any change to a DB column (`04`), API contract (`05`), canonical fact key (`04 §5`), or routing threshold (`06`) MUST be proposed to the Integration Lead, updated in the relevant doc, and logged as `ADR-011+` here before merging.
