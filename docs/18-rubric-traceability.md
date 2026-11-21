# 18 — Rubric Traceability

> **Status:** v1.0. Maps all **21 criteria / 100 points** of `AI_Hackathon_Evaluation_Rubrics.pdf` to the mechanism that earns the point, the file that implements it, and the command that proves it.
>
> `docs/16-traceability-matrix.md` maps the *problem statement*. This document maps the *scoring rubric*, because that is what a judge has in front of them.

Every number below is read from a running system. The reproduce command is given next to it.

---

## 01 — AI Implementation & Intelligence (30 points)

### 1.1 Functional AI Features — 12 pts (≥ 3 required)

Five distinct AI features, each with its own model, its own failure mode, and its own evaluation set.

| # | Feature | What it does | Implementation | Evaluation |
|---|---|---|---|---|
| 1 | **Scam classifier** | Verdict on a suspicious SMS/WhatsApp message (text, screenshot OCR, or voice): `LIKELY_SCAM` / `CANNOT_TELL` / `LIKELY_SAFE` / `VERIFIED_OFFICIAL` | `app/ai/scam_classifier.py` — hybrid word + char_wb `FeatureUnion` TF-IDF + calibrated logistic regression, `scam-tfidf-lr-v1.0.0`, plus Stage-1 cryptographic `HQ-*` / `body_sha256` verification | 172 train / 43 test. Precision **0.9444**, recall **0.9444**, F1 **0.9444**, FPR **0.04**, hard-negative FPR **0.00**, confusion `[[24,1],[1,17]]` |
| 2 | **Document verifier** | Genuine / forged / blurry verdict on a CNIC photo, cross-checking the printed text against an HMAC-signed QR | `app/ai/doc_verify.py` — OpenCV preprocess + QR decode + RapidFuzz name match + `OCR_VS_QR` tamper propagation to four-eyes review | 30 images. Genuine verified **100 %**, forged caught **100 %**, false-tamper **0.00 %**, blurry→retake **100 %** |
| 3 | **Policy RAG assistant** | Answers "what documents do I need?" by text or **voice** (`POST /rag/transcribe`) from the real policy corpus, in Urdu/Sindhi/English, with a citation — or abstains | `app/ai/rag.py` — hybrid Postgres `tsvector` + NumPy cosine (with live/fake dimension resilience), extractive/LLM answerer, two-gate abstention | 4 bilingual policy documents, 30 section-pure chunks. Abstains on off-topic questions; cites the section it quoted |
| 4 | **Urdu & regional voice** | Speech→text for every wizard field and Policy Q&A, text→speech for every prompt and dynamic explanation, plus Auto-Read mode | `app/ai/voice.py` (Deepgram `nova-3` / OpenAI `whisper-1` STT, `edge-tts` live TTS) + `app/ai/urdu_nlp.py` (Roman/Urdu normaliser + LLM fallback) | 73 pre-recorded Urdu MP3s (`flux-ambreen-ur`, `ur-PK`), all `status: ready`; `tests/ai/test_urdu_nlp.py`, `test_voice.py` |
| 5 | **Case agent** | Reads the case, calls the mock DPI services, assembles facts, proposes a route — and is structurally unable to decide | `app/agent/case_agent.py`, `assemble.py` | `tests/engine/test_pipeline.py`, `tests/integration/test_golden_path_and_rules.py` |

**Reproduce:** `GET /api/v1/eval/dashboard` returns 1–3 in one payload.

### 1.2 AI Workflow Integration — 8 pts

The AI is not a side panel; it sits inside the case lifecycle and its output is consumed by the state machine.

```
Citizen submits → agent assembles facts (mock DPI over HTTP)
                → engine evaluates rules (pure Python, tri-state)
                → router picks AUTO_APPROVE / HUMAN_REVIEW / NEEDS_INFO
                → officer sees facts + rule trace + AI handoff note
                → decision persisted with input snapshot + audit row
```

- **LLM proposes, policy disposes.** `app/engine/` is 100 % pure Python — no `sqlalchemy`, `fastapi`, `httpx`, `openai`, `app.mocks` import. Enforced by `tests/test_invariants.py::test_engine_is_pure_python`.
- **The agent cannot reject.** There is no `AUTO_REJECT` route action anywhere; `PROCESSING → REJECTED` raises `409 INVALID_TRANSITION`. Only an `OFFICER` can reject. Enforced by `test_no_auto_reject_route_action_exists`, `test_processing_to_rejected_is_illegal`, `test_only_an_officer_can_reject`.
- **Every AI step is audited** in the same transaction as the mutation it informs (`audit.record`), and every model call is metered in `ai_telemetry` (tokens, latency, success, error code).
- **Degradation is designed, not accidental.** `AIProvider` is a strict interface with `live` and `fake` implementations; a provider failure raises `ProviderError` and the caller falls back to the deterministic path rather than failing the request.

### 1.3 AI Output Quality & Consistency — 6 pts

| Property | How it is held | Evidence |
|---|---|---|
| Measured, not asserted | Every model has a frozen eval set and a test that fails if the metric moves | `tests/ai/test_benchmarks.py`, `tests/engine/test_eval_sweep.py` |
| Calibrated confidence | Scam model is `CalibratedClassifierCV`-wrapped, so `confidence` is a probability, not a margin | `app/ai/scam_classifier.py` |
| Consistent language | Answers come back in the language asked; the corpus is bilingual and the answerer scores script match | `_extractive_answer` in `app/ai/provider.py` |
| No hallucinated citations | The answerer quotes **one whole paragraph from one source**; the citation is that source's chunk id | `tests/ai/test_rag.py` |
| Honest abstention | Two independent gates: similarity **and** corpus coverage. Below either, `NOT_SURE` with zero LLM calls | `MIN_CORPUS_COVERAGE = 0.5` in `app/ai/rag.py` |
| Guardrails | Personal-claim filter, PII redaction, prompt-injection sanitisation | `app/ai/guardrails.py`, `tests/ai/test_guardrails.py` |

### 1.4 Model & Tool Selection — 4 pts

See `docs/07-ai-components.md §9` for the full rationale. Summary:

| Task | Chosen | Rejected alternative | Why |
|---|---|---|---|
| Policy Q&A | `gpt-4o-mini` + hybrid retrieval | A larger model, or `pgvector` | The corpus is 4 documents; retrieval quality dominates model size. `tsvector` + NumPy cosine needs no extension and no extra service |
| Scam classification | Word + char n-gram `FeatureUnion` TF-IDF + calibrated LR | A fine-tuned transformer | 172 labelled examples. A transformer would memorise them; a hybrid word/subword linear model generalises cleanly (**0.9444 F1**, **0.04 FPR**, **0.00 hard-negative FPR**) and stays auditable per-feature |
| Document check | OpenCV + HMAC QR + OCR cross-check | A vision LLM alone | The QR is a cryptographic fact, not a judgement; `ocr_vs_qr` cross-check catches Photoshopped cards and propagates `TAMPER_SUSPECTED` (HIGH) to four-eyes approval |
| Speech→text | Deepgram `nova-3` / OpenAI `whisper-1` | Browser Web Speech API | Web Speech is unavailable offline and unsupported for Urdu on most Android builds |
| Text→speech | Deepgram Flux (`flux-ambreen-ur`, 73 pre-cached MP3s) + `edge-tts` live | Live TTS for every prompt | A citizen on 2G cannot wait for synthesis; critical prompts precache immediately and the full 73-clip pack caches on demand |
| Embeddings | `text-embedding-3-small` (live) / hashed TF-IDF (fake) | `text-embedding-3-large` | 1536 dims is ample for 30 chunks; the fake path is deterministic so tests are reproducible |

---

## 02 — SaaS Functionality & Technical Architecture (20 points)

### 2.1 Core SaaS Features — 8 pts

| Feature | Implementation |
|---|---|
| **Multi-tenancy** | `tenant_id` derived **exclusively** from the JWT, never from the request. A foreign tenant/citizen id returns `404`, never `403` — no existence leak. `tests/security/test_rbac_and_tenancy.py` |
| **Five roles** | CITIZEN, HELPER, OFFICER, ADMIN, AUDITOR — each with a distinct console and a distinct route guard |
| **RBAC on every route** | `test_every_non_public_route_has_an_rbac_dependency` walks the router and fails on any non-public route without a dependency |
| **Programs & rule versioning** | `programs`, `rule_versions` — a ruleset is versioned JSON DSL, published immediately, with a Digital Twin to preview the change before publishing |
| **Officer queue** | Priority-sorted, masked CNICs, structured AI handoff note, four-eyes approval (`PENDING_SECOND_APPROVAL`; same officer gets `403 SAME_OFFICER`) |
| **Admin console** | Users, API keys (reveal-once), rules, mocks, jobs — `app/api/v1/admin_*.py` |
| **Auditor console** | Hash-chain verification, consent access log, decision trace |
| **API keys** | Hashed at rest, scoped, revocable, reveal-once |

### 2.2 Backend Architecture & API Design — 5 pts

- **75 endpoints across 21 modules**, all under `/api/v1`, validated with Pydantic v2 schemas and uniform structured error envelopes.
- **Documented error codes**, not bare HTTP statuses: `CONSENT_REVOKED`, `INVALID_TRANSITION`, `SAME_OFFICER`, `IDEMPOTENCY_CONFLICT`, `RULE_VALIDATION_FAILED`, `VALIDATION_ERROR`.
- **Idempotency**: citizen/helper writes honour `Idempotency-Key`; a replay returns the cached response, a payload mismatch returns `409 IDEMPOTENCY_CONFLICT`.
- **ETag / conditional GET** on `GET /cases/{id}`.
- **Layered**: `api/` (transport) → `agent/` (orchestration) → `engine/` (pure policy) → `models/` (persistence). The dependency direction is enforced by the purity test.
- **OpenAPI** served at `/api/docs` and `/api/openapi.json`.

### 2.3 Database Design — 4 pts

- **PostgreSQL 16**, **27 application tables + 7 mock tables**, **4 Alembic revisions** in a linear chain (`app_0001 → dpi_mock_0001 → be_0002 → be_0003`).
- **Job queue with no broker**: `jobs` uses `SELECT … FOR UPDATE SKIP LOCKED`, so the queue is transactional with the data it mutates. No Redis, no Celery.
- **Hash-chained audit**: `audit_events` serialised with `pg_advisory_xact_lock(99887766)`, each row hashing `prev_hash|seq|created_at|action|resource_type|resource_id|payload`. `GET /api/v1/auditor/verify-chain` returns `first_broken_seq`.
- **Tri-state facts** stored as `{state, value, source, missing_reason}` — `UNKNOWN` is a stored value, never a null to be interpreted.
- **Generated `tsvector`** column on `rag_chunks` (`GENERATED ALWAYS`), so lexical search cannot drift from content.
- **Idempotency keys** and **worker heartbeats** are tables, not in-process state.

### 2.4 Deployment, Testing & Monitoring — 3 pts

| Concern | Mechanism |
|---|---|
| **CI** | `.github/workflows/ci.yml` — three jobs: backend (ruff + full pytest against a Postgres 16 service), frontend (typecheck + build + bundle budget), invariants (engine purity, mock boundary, no auto-reject) |
| **Tests** | **1,162 passing** of 1,162 collected, across engine (596), ai (356), integration (95), mocks (69), security (21), conftest-heal (14), invariants (11) — 100 % green across all 3 GitHub Actions CI jobs |
| **Health** | `GET /health` reports DB, worker heartbeat freshness, upload dir, AI provider, demo mode |
| **Observability** | Request-id middleware on every request, structured JSON logs, `ai_telemetry` per model call, `GET /api/v1/eval/dashboard` for live metrics |
| **Rate limiting** | Per-route limits, disabled in tests via `RATE_LIMIT_ENABLED` |
| **Deployment** | `docker-compose.yml`, `.env.example`, `alembic upgrade head` on boot, `DEMO_MODE` gate that makes `demo-login` return `404` in a production-shaped deployment |

---

## 03 — Real-World Problem Solving (15 points)

### 3.1 Problem Understanding — 5 pts

The problem is not "build a form". It is that a widow in Thatta has to prove her husband is dead, to a system that may not know, using a phone that may be offline, in a script she may not read, while someone may be trying to defraud her. Every architectural decision follows from one of those constraints:

| Real constraint | Design response |
|---|---|
| The registry may not know | Tri-state facts; `UNKNOWN` routes to human review, never to rejection |
| She may not read | Urdu default + **Sindhi (`sd`, سنڌي)** regional support, RTL, audio-first wizard with Auto-Read toggle, 73 pre-recorded prompts, voice input on every step, readback confirmation |
| The phone may be offline | **136.0 KB** gzipped citizen bundle (≤150 KB budget), **59-entry / 1.0 MB** Workbox precache (lazy audio caching), Dexie outbox with failed-item retry/discard UI, idempotent replay |
| Someone may be defrauding her | Scam checker with HMAC verification codes; the app never asks for a PIN or a fee |
| She may change her mind | Per-purpose consent, withdrawable at any time, denial logged before the 403 is raised |
| She may be wrongly refused | A free complaint creates a linked case with its own reference code, an in-app notification and a simulated SMS; a human officer is the only actor who can reject |

### 3.2 End-to-End Task Completion — 7 pts

The golden path runs from an empty database to a paid disbursement, and it is a test, not a demo script:

```
demo-login → consent (3 purposes) → wizard (9 steps, voice or tap)
→ document upload → doc verify → case created → job enqueued
→ agent assembles facts from 4 mock DPI services over HTTP
→ engine evaluates rules → router decides → officer reviews (if routed)
→ payment initiated → mock Raast → SMS with verification code → status PAID
```

`tests/integration/test_golden_path_and_rules.py` drives this end to end. The officer path, the consent-withdrawal path, the complaint path, the payment-failure path, and the offline-replay path each have their own integration test.

### 3.3 Practical Impact & Relevance — 3 pts

Quantified against the live seeded world (`GET /api/v1/eval/dashboard`):

| Measure | Value | What it means |
|---|---|---|
| Decisions recorded | 66 | A real workload, not a single happy path |
| Auto-approved | 43 (65 %) | Two thirds of citizens get a decision without waiting for an officer |
| Sent to a human | 23 (35 %) | The uncertain third is escalated, not guessed |
| **False approvals** | **0** | Nobody was paid who should not have been |
| Officer override rate | 0.0 | The router's escalations were the right ones |
| Decision latency p50 / p95 | 16 ms / 20 ms | The engine is not the bottleneck; a human is |
| LLM calls in 24 h | 0 | The deterministic path carries the load; the LLM is for language, not for arithmetic |

At the measured operating point (`τ = 0.90`, n = 133) the router auto-approves **55.6 %** with a **0.0 %** false-approval rate at an expected cost of **451** — against **2011** at `τ = 0.50`, where 17.3 % of approvals would be wrong. The saving is not the point; the zero is.

---

## 04 — Accessibility & Inclusion (10 points)

### 4.1 Voice & Regional Language — 4 pts

- **Urdu (`ur`) is the default + full Sindhi (`sd`, سنڌي) regional language support** (lazy-split into its own 4.3 KB chunk so it adds 0 KB to the initial bundle), both RTL with self-hosted `Noto Sans Arabic` (covering Urdu & Sindhi codepoints) and `Instrument Sans` (ADR-023).
- **73 pre-recorded Urdu prompts** (`flux-ambreen-ur`, `ur-PK`), SHA-256 pinned in `frontend/public/audio/ur/manifest.json`, all `status: ready`. Critical onboarding prompts precache on install; remaining clips cache on first play (`CacheFirst`).
- **Speech input everywhere**: every wizard field (including CNIC, district, counts, payout phone) plus Policy Q&A (`/c/ask`) accepts voice via Deepgram `nova-3` / OpenAI `whisper-1`, with a Roman-Urdu normaliser and LLM fallback so "pandrah hazaar", "Mirpur Khas", and "۱۵۰۰۰" all parse.
- **Dynamic explanations** are synthesised through `POST /voice/tts` (`edge-tts`) and cached, with an accessible **Auto-Read** toggle in the citizen header.
- **One 56×56 audio button per citizen screen** — the same position, every time.

### 4.2 Low-Literacy Usability — 3 pts

- **One question per screen**, icon + audio + large type + **WCAG AA ≥ 5.4:1 contrast**. No dense forms.
- **48 px minimum tap targets, 56 px for primary actions** (`docs/11 §2`), plus **Approximate Age quick-picker** (`~25 / ~35 / ~45 / ~55 / ~65`) and visual **Income Band tier bars**.
- **Readback confirmation** before submit — the app says the answer back in Urdu (and lets citizens confirm "I don't know" by voice too).
- **"I don't know" is a first-class button**, not a validation error. It produces `UNKNOWN`, which routes to a human.
- **Digit pad** for numeric entry instead of a keyboard.
- **Copyable reference codes** everywhere a code appears, so a citizen can read it to a helper.

### 4.3 Weak Internet — 3 pts

- **136.0 KB gzipped** citizen entry bundle against a **150 KB** budget (90.7 %), enforced by `npm run budget` in CI (with Sindhi `i18n-sd` lazy-loaded at 4.3 KB).
- **59 precache entries (1.0 MB)** via `vite-plugin-pwa` / Workbox — trimmed down from 2.67 MB so initial install succeeds cleanly on slow 2G/3G links, while non-critical audio clips cache lazily on demand.
- **Dexie outbox with failure recovery UI**: writes queue locally (preserving `X-Act-For-Citizen` for helpers) and replay with `Idempotency-Key`; failed items surface Retry / Discard controls in the header.
- **ETag / conditional GET** so a re-open costs a 304, not a payload.
- **Lite mode** genuinely pauses background polling and suppresses `.webp` illustrations on slow/low-end devices.

---

## 05 — Safety, Privacy & Reliability (15 points)

### 5.1 AI Uncertainty & Human Handoff — 5 pts

- **Unknown is a first-class value.** Canonical facts are `KNOWN` / `UNKNOWN` with a `missing_reason`; nothing is defaulted. `UNKNOWN` never becomes `false`.
- **No auto-reject exists.** Not disabled — absent. `PROCESSING → REJECTED` is a `409`.
- **Enumerated escalation codes** rather than a free-text "needs review".
- **Structured AI handoff note** so the officer sees what the agent saw, what it could not see, and why.
- **RAG abstains** below either gate (`NOT_SURE`), with zero LLM calls.
- **Scam checker has `CANNOT_TELL`** and advises; it never blocks or deletes a message.
- **`WAITING_EXTERNAL`** when a DPI service is down — the case waits rather than failing.

### 5.2 Privacy, Consent & Data Protection — 4 pts

- **Per-purpose consent** (identity, household survey, documents), granted and withdrawn separately.
- **`enforce_consent(...)` on every citizen-data read**, with no exceptions.
- **Denied attempts are persisted before the refusal**: `enforce_consent` commits the `consent_access_logs` and `audit_events` rows in an **isolated session** before raising `403 CONSENT_REVOKED`, so a request rollback cannot erase the evidence of the blocked access.
- **Withdrawal places a case `ON_HOLD_CONSENT`**, not `REJECTED` — it resumes if consent returns.
- **No raw PII in logs**: 13-digit CNICs, OTPs, passwords and JWTs are never logged. `test_no_raw_cnic_or_phone_in_log_statements`.
- **Zero real personal data**: every CNIC starts `99900`, every generated card is watermarked `MOCK SPECIMEN`.
- **Tenant isolation returns 404, not 403** — a foreign id must not confirm its own existence.

### 5.3 Explainability & Auditability — 3 pts

- **Citizen-facing**: three plain-language reasons in Urdu and English, no jargon, no rule ids.
- **Officer-facing**: the full fact table (tri-state, with `missing_reason`) and the rule trace (each rule `PASSED` / `FAILED` / `UNKNOWN` with its inputs).
- **Auditor-facing**: the hash chain, `verify-chain` with `first_broken_seq`, and the consent access log.
- **Every mutation and AI step** writes an `audit_events` row in the same transaction.
- **The decision stores its own input snapshot**, so a past decision can be replayed against the ruleset that produced it.

### 5.4 Risk Handling & Reliability — 3 pts

- **Chaos tests**: mock services are made to fail, time out, and return malformed payloads; the case must land in a defined state, never in limbo.
- **Provider fallback**: `AIProvider` failure degrades to the deterministic path.
- **Idempotent replay** on every citizen/helper write.
- **Job post-conditions**: a `PROCESS_CASE` job can never leave a case in `PROCESSING`.
- **Conftest heals a stale schema** by upgrading/stamping rather than dropping the database, so a red test means a red test.

---

## 06 — Innovation & Creativity (10 points)

### 6.1 Originality — 4 pts

- **The Digital Twin** (`app/engine/twin.py`): before an admin publishes a ruleset change, the twin replays every historical decision against the new rules and reports exactly which citizens would flip, in which direction. A rules change is a *simulated* event before it is a real one.
- **HMAC-signed QR on every generated document**, so the verifier checks a cryptographic fact rather than guessing from pixels.
- **The scam checker verifies the department's own codes** — it does not just score text, it checks whether the code in the message is one the department actually issued, and whether it matches *this* message.
- **Consent denial is evidence**: the blocked read is logged before the refusal is returned.

### 6.2 Creative Feature — 4 pts

- **Device Simulator**: the demo can show the citizen's phone and the officer's console side by side, with the OTP readable in the simulator — which is how a judge can walk the whole flow without a second device.
- **Copyable codes everywhere**: OTP, HQ verification code, case reference, complaint reference — one shared `CopyCode` chip, with a clipboard-API fallback for non-secure contexts.
- **The threshold sweep as a product surface**: the cost matrix lives in the ruleset, so an admin can see what a threshold change would cost before making it.
- **Bilingual corpus with section-pure chunking**, so a citation names the section it actually quoted.

### 6.3 Technical Creativity — 2 pts

- **A job queue with no broker**: `SKIP LOCKED` on Postgres, transactional with the data it mutates.
- **Hybrid retrieval without `pgvector`**: generated `tsvector` + NumPy cosine over a 64-dim hashed TF-IDF vector, so the fake provider is deterministic and the abstention gate is meaningful without an embedding service.
- **A hash chain that survives concurrency** via `pg_advisory_xact_lock`.
- **Engine purity enforced by import scanning**, so "LLM proposes, policy disposes" is a test, not a promise.

---

## Verification commands

```bash
# Backend gates (AGENTS.md §4)
cd backend
ruff check app tests
TEST_DATABASE_URL=postgresql+psycopg://haqdaar:haqdaar@127.0.0.1:5433/haqdaar_test \
  AI_PROVIDER=fake python -m pytest tests/ -q

# Frontend gates
cd frontend
npm run typecheck
npm run build
npm run budget          # fails above 150 KB gzipped

# Live metrics behind every number in this document
curl -s localhost:8000/api/v1/eval/dashboard -H "Authorization: Bearer $TOKEN"
```
