# 14 - Coding Agent Playbooks (A1–A7 + Integration Lead)

> **Status:** FROZEN v1.0. Hand each coding agent its exact section below plus `AGENTS.md` and the specific docs listed under **Required Reading**.
> **Golden Rule:** Never modify files outside your **Owned Paths**. Never invent undocumented schemas, error codes, or endpoints.

---

## Agent A1 - Core Backend Platform, Security, Consent, Audit & Jobs

- **Required Reading:** `03-system-architecture.md`, `04-data-model.md`, `05-api-contracts.md`, `09-security-consent-audit.md`.
- **Owned Paths:** `backend/pyproject.toml`, `backend/alembic.ini`, `backend/alembic/`, `backend/app/main.py`, `backend/app/config.py`, `backend/app/db.py`, `backend/app/models/`, `backend/app/schemas/`, `backend/app/security/`, `backend/app/jobs/`, `backend/app/api/v1/{auth,programs,cases,documents,consent,me,helper,officer,admin_users,admin_keys,admin_jobs,auditor,public,analytics,transparency}.py`.
- **Forbidden Paths:** `app/engine/`, `app/agent/`, `app/ai/`, `app/mocks/`, `frontend/`.
- **Deliverables (in order):**
  1. Project config, SQLAlchemy 2.0 sync `db.py`, complete ORM models (`04`), initial Alembic migration.
  2. Auth (OTP via simulated SMS, password Argon2id/bcrypt, JWT + rotating refresh, `/auth/demo-login` gated by `DEMO_MODE=true`), RBAC & Tenant FastAPI dependencies (`404` for cross-tenant).
  3. Tamper-evident `security/audit.py` (PostgreSQL advisory lock + SHA-256 chain) & `GET /auditor/verify-chain`.
  4. `security/consent.py` single enforcement point (`enforce_consent` with isolated-session commit for denied `consent_access_logs`!) + all `/consent/*`, `/me/*`, `/helper/*` routes.
  5. Idempotency middleware/helper (`Idempotency-Key` + `409 IDEMPOTENCY_CONFLICT`), ETag helper, sliding-window rate limiter, uniform error handlers (`05 §2`), JSON logger with CNIC/token redaction.
  6. Cases CRUD, strict state machine validator (blocking `PROCESSING -> REJECTED`), Documents upload/download (consent-gated), Postgres `SKIP LOCKED` worker (`app/jobs/worker.py`) + embedded-worker startup option (`RUN_EMBEDDED_WORKER=true`), Notifications with `HQ-XXXXX` verification codes + `body_sha256`.
  7. Officer endpoints (queue sorting, assign, decide, four-eyes `PENDING_SECOND_APPROVAL` + `403 SAME_OFFICER`, corrections), Auditor read-only endpoints, Public API (`/api/v1/public/*`) with `X-API-Key` + Swagger examples, Tenant Analytics, `/health`.
- **Integration Contracts:** Exposes `enqueue_job(db, job_type, payload, dedup_key)`, `audit.record(db, ...)`, `enforce_consent(...)`, and `create_notification(db, ...)` for A2/A4. Calls A2's `run_case_agent(db, case_id)` from `PROCESS_CASE` job and A4's `verify_document(...)` from `POST /documents`.
- **Done Criteria:** All security/RBAC/consent/audit/idempotency tests pass; `/api/docs` renders clean OpenAPI spec.

---

## Agent A2 - Pure Decision Engine, Case Agent, Rules & Digital Twin

- **Required Reading:** `04-data-model.md`, `05-api-contracts.md` (§3.6, §3.7, §3.9), `06-decision-engine.md`, `08-responsible-ai-challenges.md`.
- **Owned Paths:** `backend/app/engine/`, `backend/app/agent/`, `backend/app/api/v1/{admin_rules,eval}.py`, `backend/tests/engine/`.
- **Forbidden Paths:** `app/models/`, `app/mocks/`, `app/ai/`, `frontend/`.
- **Deliverables (in order):**
  1. Pure `app/engine/` package (ZERO DB/HTTP/AI imports): `facts.py` (canonical fact registry `04 §5`), `rules_dsl.py` (Pydantic validator), `evaluator.py` (tri-state Kleene logic), `entity_resolution.py` (Urdu/Roman-Urdu canonicalizer + RapidFuzz + strict no-guess matching), `anomalies.py`, `confidence.py` (4-pillar weakest-link), `router.py` (cost-aware routing, zero `AUTO_REJECT`, priority score, AI handoff note), `explainer.py` (Urdu + English templates), `twin.py` (pure historical replay), `eval_sweep.py` (cost-matrix threshold sweep).
  2. Unit test suite `backend/tests/engine/` covering 100 % of rules, 25+ messy Pakistani name/duplicate/conflict cases, cost sweep, and twin purity.
  3. `app/agent/case_agent.py`: deterministic 9-step agent calling `MOCK_BASE_URL` strictly via `httpx` (with 2 fast retries + `ExternalServiceUnavailable` handling), logging each `AGENT_STEP`, committing `decisions` + notifications + `INITIATE_PAYMENT` job. Plus `check_complaint_agent` for `CHECK_COMPLAINT` job.
  4. Rule Editor endpoints (`/admin/programs/{id}/rules`, `/admin/rules/{id}`, validate, simulate Digital Twin, publish + trigger `REINDEX_RAG`), Officer re-evaluate hook, and `/eval/dashboard` endpoint (merging `eval_sweep` + A4's scam/doc benchmark metrics + live ops SQL queries).
- **Done Criteria:** `pytest backend/tests/engine` passes 100 %; architectural invariant confirms zero forbidden imports in `app/engine/` and zero `app/mocks` imports in `app/agent/`.

---

## Agent A3 - Simulated DPI Services, Chaos Controls & Synthetic Datasets

- **Required Reading:** `04-data-model.md` (§4.6), `05-api-contracts.md` (§3.11), `10-mock-services-and-seed-data.md`.
- **Owned Paths:** `backend/app/mocks/`, `backend/app/api/v1/admin_mocks.py`, `backend/app/data/demo_docs/`, `backend/app/data/doc_eval_set/`, `backend/app/data/eval_cases.jsonl`.
- **Forbidden Paths:** `app/engine/`, `app/security/`, `app/ai/`, `frontend/`.
- **Deliverables (in order):**
  1. `app/mocks/router.py` implementing all 7 simulated DPI APIs (`/mock/v1/identity/lookup`, `/civil/death-records`, `/household/survey`, `/benefits/active`, `/payments/transfer`, `/payments/{ref}`, `/payments/account-title`, `/complaints`, `/sms/inbox/{phone}`) with `"simulated": true` and chaos middleware reading `mock_service_configs`.
  2. Platform Admin endpoints: `GET/PATCH /api/v1/admin/mocks` and `POST /api/v1/admin/demo/reset` (gated by `DEMO_MODE=true`).
  3. `app/mocks/doc_generator.py`: generates watermarked (`MOCK SPECIMEN`) CNIC & Death Certificate cards with `HMAC-SHA256` signed QR codes - produces both the 7 demo upload files (`data/demo_docs/`) and the 30-image labelled benchmark (`data/doc_eval_set/` incl. WhatsApp-compressed, blurry, forged-name, missing-QR).
  4. `app/mocks/seed.py`: idempotent deterministic seeder creating 2 tenants (`SPD`, `ZWB`), 2 config-driven programs (`SAHARA_WIDOW_GRANT`, `GUZARA_ALLOWANCE`), all 9 demo personas, Helper Ayesha's 8 families with grants, mock registry records (with realistic spelling drift, duplicates, deceased records, dormant payment alias), 60 historical decided cases for Digital Twin, and the 6 showcase queue cases (`HQ-2026-000101..106`).
  5. `backend/app/data/eval_cases.jsonl`: 120 labelled synthetic cases with independent noise injection for A2's `eval_sweep.py`.
- **Done Criteria:** `seed.py --reset` runs in < 5 s; zero real personal data (all CNICs start with `99900`); all mock endpoints return `"simulated": true` and respond properly to `NORMAL`/`SLOW`/`FLAKY`/`DOWN`.

---

## Agent A4 - AI Services (Provider, Voice, CV Doc Verify, Scam, RAG, Guardrails)

- **Required Reading:** `05-api-contracts.md` (§3.3, §3.9), `07-ai-components.md`, `08-responsible-ai-challenges.md`.
- **Owned Paths:** `backend/app/ai/`, `backend/app/api/v1/{voice,scam,rag}.py`, `backend/app/data/policy_docs/`, `backend/app/data/scam_dataset.jsonl`, `frontend/public/audio/ur/`, `backend/tests/ai/`.
- **Forbidden Paths:** `app/engine/`, `app/models/`, `app/mocks/`, `frontend/src/`.
- **Deliverables (in order):**
  1. `app/ai/provider.py` (`AIProvider` protocol, `LiveOpenAIProvider`, `FakeDeterministicProvider`, automatic circuit-breaker fallback + `ai_telemetry` + `audit.record` logging).
  2. `app/ai/guardrails.py` (XML prompt-injection wrapping, injection detection/logging, CNIC regex redaction, RAG personal-claim filter).
  3. `app/ai/doc_verify.py`: OpenCV Laplacian blur (`NEEDS_RETAKE`), `cv2.QRCodeDetector` + `HMAC-SHA256` signature check (`UNVERIFIABLE` vs `TAMPER_SUSPECTED`), OCR cross-check using `entity_resolution.name_sim`, benchmark evaluator over A3's `doc_eval_set/` (target: `0 %` false tamper on WhatsApp-compressed genuine docs).
  4. `app/data/scam_dataset.jsonl` (240 labelled Urdu/Roman-Urdu/English messages incl. 35 hard negatives) + `app/ai/scam_classifier.py` (4-stage pipeline: official `HQ-XXXXX` & `body_sha256` check → red-flag rules → calibrated scikit-learn TF-IDF+LR → `CANNOT_TELL` band) + `/scam/check` & `/scam/{id}/feedback` + benchmark metrics helper.
  5. `app/ai/voice.py` (`/voice/transcribe-parse` field-scoped structured Pydantic parser with Urdu numerals & mandatory readback + `/voice/tts` cached `edge-tts`) + pre-generate 73 static Urdu wizard/status MP3 prompts with Deepgram Flux TTS in `frontend/public/audio/ur/`.
  6. `app/data/policy_docs/` (4 bilingual Markdown policy docs) + `app/ai/rag.py` (heading chunker, hybrid `tsvector` + NumPy cosine similarity, abstention `NOT_SURE` below threshold, `reindex_program_rules()` handler for `REINDEX_RAG` job) + `/rag/ask`.
- **Done Criteria:** All tests in `backend/tests/ai/` pass in `fake` mode; live smoke test passes with `AI_PROVIDER=live`; benchmark metrics feed A2's `/eval/dashboard`.

---

## Agent A5 - Citizen & Helper PWA Frontend + Offline Engine

- **Required Reading:** `02-product-spec.md`, `05-api-contracts.md`, `11-ux-accessibility-offline.md` (§1–§5).
- **Owned Paths:** `frontend/package.json`, `frontend/vite.config.ts`, `frontend/index.html`, `frontend/src/main.tsx`, `frontend/src/shared/`, `frontend/src/citizen/`, `frontend/src/helper/`, `frontend/public/icons/`.
- **Forbidden Paths:** `backend/`, `frontend/src/staff/`.
- **Deliverables (in order):**
  1. Vite + React 18 + TS + Tailwind + `vite-plugin-pwa` (Workbox precache of citizen shell + `/audio/ur/*.mp3`) + manual chunk split isolating `/staff/*`, `/admin/*`, `/auditor/*`.
  2. `src/shared/`: typed REST client (auto-attaches `Authorization`, `X-Act-For-Citizen`, `Idempotency-Key`, ETag handling), auth store + Demo Persona Login page, `PrototypeBanner`, Urdu RTL / English LTR i18n dictionary, Lite Mode detector, AudioPlayer component, Dexie DB + Offline Outbox sync manager.
  3. Citizen Home (`/c`), 14-step Guided Icon+Audio Wizard (`/c/apply/:caseId`) with tap/keypad/counter + 🎤 voice readback confirmation + client-side canvas image compression (≤ 250 KB) + retake audio feedback + offline submission.
  4. Citizen Status & Timeline (`/c/cases/:id`) with audio explanation & "Money not received" complaint trigger; Consent Center (`/c/consent`) with withdraw confirmation modal + live Allowed/Blocked Access Log; My Data & Corrections (`/c/my-data`).
  5. Public Scam Checker (`/scam-check`) with text/screenshot/voice input, verdict card, audio playback, and "I think this is wrong" feedback; RAG "Ask a Question" (`/c/ask`) with citations & `NOT_SURE` escalation button.
  6. **Helper Mode (`/h/*`):** Family Roster, Add Family (OTP or Verbal Witnessed audio consent), safe ≤ 2-tap switcher with synchronous React Query wipe + full-screen audio/avatar confirmation interstitial + persistent top strip.
- **Done Criteria:** `npm run build` produces citizen entry bundle ≤ 150 KB gzipped; offline submit + reconnect works without duplicating cases; zero RTL layout glitches.

---

## Agent A6 - Staff Consoles Frontend (Officer, Admin, Auditor, Eval, Demo Ops)

- **Required Reading:** `02-product-spec.md`, `05-api-contracts.md`, `11-ux-accessibility-offline.md` (§6).
- **Owned Paths:** `frontend/src/staff/` (lazy-loaded entry exported for A5's router).
- **Forbidden Paths:** `backend/`, `frontend/src/citizen/`, `frontend/src/helper/`.
- **Deliverables (in order):**
  1. Staff Shell layout with role-aware navigation, tenant badge, and lazy-loaded route tree.
  2. **Officer Console:** Prioritised Queue (`/staff/queue` with priority/confidence/oldest sort & filters) + 2-column Case Review (`/staff/cases/:id` with AI Handoff card, facts & conflict highlights, rule trace, document viewer + CV checks, stale-rule banner + Re-evaluate button, Decide panel with reason codes & four-eyes indicator, graceful `403 CONSENT_REVOKED` lock view).
  3. **Admin Rule Editor & Digital Twin (`/admin/rules`):** Form-based rule/formula/threshold editor, Validate feedback, **Digital Twin simulation view** (before/after chart, PKR budget delta, flipped cases table), Publish modal with mandatory change note, immutable version history with hashes.
  4. **Auditor Console (`/auditor/*`):** Filterable event stream, **Verify Hash Chain** integrity banner, Decision Trace Inspector (input snapshot + hash, facts, rule version/hash, model versions, 4-pillar confidence bars, agent steps), Consent Audit view.
  5. **Evaluation & Analytics Dashboards (`/staff/eval`, `/staff/analytics`):** Threshold sweep curve highlighting `0.90`, Scam confusion matrix + hard-negative FPR + disputed count, Document verifier metrics + false tamper rate, Live ops KPIs, Tenant analytics.
  6. **Admin Ops & Demo Support:** Users & API Keys CRUD (copy-once modal), Mock Service Chaos Control cards (`NORMAL`/`SLOW`/`FLAKY`/`DOWN`) + Demo Reset button, Jobs queue + Retry button, `/transparency` Real-vs-Simulated page, and **Device Simulator (`/staff/device-sim`)** showing live simulated SMS/OTPs with copyable verification codes.
- **Done Criteria:** Every staff role workflow functions against real backend APIs; zero TypeScript errors; all staff code lives in lazy-loaded chunks (does not inflate A5's citizen bundle).

---

## Agent A7 - QA, Security Verification, DevOps & Demo Ops

- **Required Reading:** `03-system-architecture.md`, `12-execution-plan.md`, `13-testing-and-quality.md`, `15-demo-and-submission.md`.
- **Owned Paths:** `docker-compose.yml`, `Dockerfile`, `.env.example`, `backend/tests/{test_invariants.py,security/,integration/}`, `frontend/src/e2e/`, `README.md`.
- **Forbidden Paths:** Application feature code (reports bugs cleanly to owning agent; only patches infra/test files unless Integration Lead authorizes).
- **Deliverables (in order):**
  1. `docker-compose.yml` (`db`, `api`, `worker`), multi-stage production `Dockerfile` (builds Vite static + serves via FastAPI + optional embedded worker), `.env.example`.
  2. `test_invariants.py` (enforces pure engine, mock HTTP isolation, RBAC declarations).
  3. Full backend security, consent, audit chain, golden path, rule versioning/twin, idempotency, and mock chaos test suites (`13`).
  4. Playwright E2E suite (`golden_path.spec.ts`, `offline_sync.spec.ts`, `helper_consent.spec.ts`).
  5. Cloud deployment to Railway (PostgreSQL 16 + `web-api` + persistent volume) + verification of local Docker fallback + final competition `README.md`.
- **Done Criteria:** All CI gates green; Railway public HTTPS URL and local Docker fallback both pass the 8-scene live demo checklist.
