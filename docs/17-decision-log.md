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

## ADR-011: Pinned Cross-Agent Helper Import Paths
- **Context:** The four-agent consolidation (BE/EN/DPI/FE) exchanges functions between owners; docs `14` names the functions but not module locations, which would desync parallel agents.
- **Decision (Integration Lead pins):** `app/notify.py::create_notification(...)` (BE); `app/jobs/handlers.py` maps job types to lazily-imported handlers: `PROCESS_CASE → app.agent.case_agent.run_case_agent(db, case_id, *, correlation_id=None)`, `CHECK_COMPLAINT → app.agent.case_agent.check_complaint_agent(db, case_id)`, `VERIFY_DOCUMENT → app.ai.doc_verify.verify_document(db, document_id)`, `REINDEX_RAG → app.ai.rag.reindex_program_rules(db, program_id)`; `app.ai.benchmarks.py::scam_metrics()/doc_metrics()` (DPI, consumed by `/eval/dashboard`); `app.engine.entity_resolution.py::name_sim(a, b)` (EN, consumed by doc_verify cross-check at threshold 0.80).
- **Rationale:** Zero-ambiguity integration; mismatches surface at the merge gate, not at runtime.

## ADR-012: OTP Delivery via `notifications` Row (Simulated SMS)
- **Context:** Doc `09` requires OTPs to be delivered to the simulated SMS inbox, but `notifications.verification_code` is UNIQUE and formatted `HQ-XXXXX` for official codes — it cannot safely hold arbitrary 6-digit OTPs (uniqueness collisions).
- **Decision:** `POST /auth/otp/request` additionally inserts a `notifications` row (`channel='SMS_SIMULATED'`, citizen `phone`, the 6-digit code inside `body_ur`/`body_en`); the `verification_code` column carries a unique generated `HQ-` code (not displayed as the OTP). `GET /mock/v1/sms/inbox/{phone}` reads these rows.
- **Rationale:** Keeps schema exactly per doc `04` while powering the Device Simulator; OTP plaintext never appears in logs.

## ADR-013: Single Whitelisted Import for Mock Chaos Administration
- **Context:** Invariant 4 forbids `app/api/` importing `app/mocks/models.py` or querying `mock_*` tables, yet doc `14` assigns `/api/v1/admin_mocks.py` (chaos controls + demo reset) to the mock owner.
- **Decision:** Mock service configuration is exposed only through functions in `app/mocks/config.py`; `tests/test_invariants.py` whitelists exactly one import pair: `app/api/v1/admin_mocks.py → app.mocks.config` (no `models`/`db`/session imports anywhere in `app/api/`). All case-flow modules remain strictly HTTP-only over `MOCK_BASE_URL`.
- **Rationale:** Preserves the automatable simulation boundary for the case pipeline while allowing platform-admin chaos control without HTTP gymnastics.

## ADR-014: Alembic Migration Ownership Split
- **Context:** BE owns models/migrations; DPI owns the `mock_*` ORM models — parallel migration chains would conflict.
- **Decision:** `backend/alembic/versions/` is BE-owned except exactly one mock-tables migration owned by DPI, whose `down_revision` is rebased onto BE's tip at merge time (coordinated by the Integration Lead).
- **Rationale:** Parallel work with a single linear migration history and zero chain conflicts.

## ADR-015: Mandatory Children-Count Rule (R09_CHILDREN_KNOWN) — Grant Never Auto-Approved with Provisional Amount
- **Context:** Agent EN's M0 review (Fri 20 Nov, ~21:50 PKT) exposed a spec gap: Sahara v1's 8 rules never reference `children_under_18`, so a case with UNKNOWN children could clear every rule and AUTO_APPROVE paying the provisional base PKR 12,000 — finalizing a payment on an amount known to be incomplete, contrary to the "no silent guessing" principle (SP-3). (Docs/06 §2.4 correctly withheld the child bonus, but no routing constraint prevented payment.)
- **Decision (Integration Lead, approved):** Add rule `R09_CHILDREN_KNOWN` (`fact: children_under_18`, `op: gte`, `value: 0`, `on_fail: HUMAN`, `on_unknown: ASK`, `required_for_auto: true`) to docs/06 §2.1 Sahara v1; DPI mirrors an equivalent children-known rule in the Guzara Allowance v1 seed. Any rule referencing a fact forces tri-state exposure: UNKNOWN children now routes ASK_MORE → (after 2 rounds) HUMAN_REVIEW — never AUTO_APPROVE. Provisional amounts remain visible to officers/AI notes only. Data-only fix using existing DSL semantics; zero engine or routing-order changes.
- Also recorded from the EN review: (a) docs/04 §5 has 20 fact keys, not 19 — the agent briefs said 19; the 20th (`citizen_has_active_dept_consent`) is non-tri-state; (b) `CNIC_NOT_IN_REGISTRY` (named in docs/06 §5.2) is a 13th HIGH anomaly code missing from the §6 table — implemented as HIGH; (c) canonicalization maps `"Mst. Fatima Bibi"` vs `"Fatima Bibi"` to similarity 1.0 (→ identity 0.98 band), not 0.93 as the §3.2 example implied — accepted: variant spelling is logged transparently in provenance, Fatima's golden path still auto-approves, and the 0.70–0.84 band is exercised by non-canonical pairs (e.g., "Zainab Bibi" vs "Zubaida Bibi" ≈ 0.77); (d) identity resolution of the Fatima canonicalization quantity is surfaced in the rule trace so officers/auditors see the raw→canonical mapping.

## ADR-016: Agent Consent-Gate Scope, Cross-Tenant Fraud Queries, and `rule.draft_updated` Audit Action
- **Context:** Agent EN's Phase-2 case-agent implementation requested Integration Lead confirmation of two readings that go beyond the letter of the docs, plus registration of one new audit action.
- **Decision (confirmed):**
  1. Case-agent step 1 (`verify_consent`) gates DEPARTMENT consent for exactly `IDENTITY`, `HOUSEHOLD`, `DOCUMENTS` (docs/07 §7 step 1 verbatim). Benefits-registry and shared-payout-alias lookups are cross-program/cross-citizen **fraud checks** under purpose `BENEFIT_APPLICATION` — not disclosures of the applicant's record to a third party — and surface only as risk flags. Selective category revocation conservatively halts the whole case (`ON_HOLD_CONSENT`), since step 1 blocks the pipeline.
  2. The shared-payout-alias anomaly query is deliberately **not tenant-scoped**: docs/06 §6's "distinct citizens" is a platform-wide fraud check (fraud rings span departments); tenant isolation still governs all tenant business-data reads, and the anomaly output discloses no other-tenant PII to officers — flag only.
  3. `rule.draft_updated` is added to the docs/09 §5.3 action set — that list is mandatory, not exhaustive; same-style additions are permitted.
- **Rationale:** Reading (1) is the verbatim spec; (2) honours the anti-fraud intent of E-7/docs/06 §6 while preserving PII minimisation and the anti-IDOR tenant rule; (3) is additive audit bookkeeping.

---

## Change Control Protocol (During Hackathon)
1. Minor bug fixes within a single agent's owned files need no ADR.
2. Any change to a DB column (`04`), API contract (`05`), canonical fact key (`04 §5`), or routing threshold (`06`) MUST be proposed to the Integration Lead, updated in the relevant doc, and logged as `ADR-011+` here before merging.
