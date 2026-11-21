# Haqdaar (حقدار) — To every rightful person, safely.

> **PROTOTYPE — THIS IS NOT AN OFFICIAL GOVERNMENT SERVICE.** Haqdaar was built during the Coder's Cup 2026 hackathon as a working prototype. **Every identity, civil-registry, household-survey, benefits, payment, complaint and SMS service it talks to is simulated** and lives under `/mock/v1/*`; no request ever reaches a real registry, bank or telecom. **All data is 100 % synthetic** — every citizen, case, phone number and document is fictional, and **every CNIC in this repository starts with the fictional prefix `99900`**. **Every generated card image is watermarked `MOCK SPECIMEN`.** No real personal data was used at any point, and nothing here should be presented to a citizen as a real entitlement.

---

## 1. The problem

> We help widowed women in low-income Sindh households claim and safely receive the (fictional) Sahara Widow Support Grant, even though they cannot read the forms, have weak and dropping mobile signal, have records that are misspelled or incomplete across government systems, and are targeted by fake "relief payment" scam messages.

Three people carry the whole design:

| Persona | Who they are | What breaks for them today | What that forces us to build |
|---|---|---|---|
| **Widow** | Cannot read the forms; weak, dropping signal | Text-heavy forms, one-shot submissions, no feedback when the network dies | Voice + icon-first wizard, one question per screen, saved progress, true offline submit |
| **Shopkeeper** | Receives fake "relief payment" messages | No way to tell a real SMS from a forged one | Scam checker with an explicit "cannot tell" answer, and verifiable official codes |
| **Helper** | Serves ~40 families from one shared phone | Shared device leaks one family's data into the next | Two-tap family switching with a full cache wipe and separate consent per family |

---

## 2. What we built

One platform, three surfaces (citizen PWA, staff consoles, public REST API), one decision path.

1. **Apply by voice and icons, offline.** Icon-led wizard, Urdu audio on every screen, IndexedDB autosave, and an offline outbox with client-generated `Idempotency-Key` so a dropped connection never loses or duplicates a case. → *Scene 1*
2. **A case agent over simulated DPI rails.** Identity, civil, household, benefits and payment lookups go out over HTTP to `/mock/v1/*` and every response is tagged `"simulated": true`. → *Scenes 1, 6*
3. **A versioned rules engine with weakest-link confidence.** Eligibility lives in `rule_versions.rules_json`, not in Python; confidence is the `min` across identity, documents, data consistency and consent assurance, so a strong signal can never mask a weak one. → *Scene 4*
4. **An officer queue with four-eyes approval.** Priority-sorted, masked CNICs, structured AI handoff notes, and any `HIGH` flag forces two distinct officers (`PENDING_SECOND_APPROVAL`; the same officer gets `403 SAME_OFFICER`). → *Scene 3*
5. **Payments with verification codes.** Every genuine notification carries a unique `HQ-XXXXX` code and a `body_sha256`, so a forwarded or edited message is provably fake. → *Scene 1*
6. **Consent take-back that actually stops access.** One server-side enforcement point on every citizen-data read; withdrawal takes effect on the very next request, and the blocked attempt is written to the citizen's access log. → *Scene 5*
7. **Auditors prove the hash chain.** Every mutation and AI step appends to an append-only SHA-256 chain; one click verifies it end to end and names the exact broken `seq` if a row was tampered with. → *Scene 7*
8. **A scam checker the shopkeeper can actually use.** Deterministic red flags plus a calibrated TF-IDF/LR model, with an honest `CANNOT_TELL` band instead of a confident guess. → *Scene 2*

---

## 3. The eight challenges

| # | Challenge | Our answer | Where you see it live |
|---|---|---|---|
| **01** | The cost of being wrong | A wrong approval costs 100, a needless review 8, an extra question 5 — so the router acts alone only above `τ = 0.90`, and **auto-reject does not exist anywhere in the codebase**. | Scene 7 (threshold sweep), Scene 3 (four-eyes) |
| **02** | Saying "I am not sure" | Every uncertain path has a named state — `UNKNOWN` facts, `WAITING_EXTERNAL`, `CANNOT_TELL`, `NOT_SURE`, `POSSIBLE_DUPLICATE_IDENTITY` — and each one hands a structured note to a human instead of guessing. | Scene 6 (registry down → `WAITING_EXTERNAL`), Scene 2 (`CANNOT_TELL`) |
| **03** | Bad data | Names pass Urdu Unicode normalization, transliteration, honorific stripping and Pakistani phonetic canonicalization (`Muhammad`/`Mohammad`/`Muhammed` → one key) plus RapidFuzz; a name alone never matches — CNIC + a 0.70–0.84 variant succeeds, below 0.55 raises `IDENTITY_CONFLICT`. | Scene 1 (`"Mst. Fatima Bibi"` vs `"Fatima Bibi"`) |
| **04** | Rules that change | Rules live in `rule_versions.rules_json` and are evaluated by a pure DSL engine; publishing flips `programs.active_rule_version_id` atomically with no restart, and every decision keeps its `rule_version_id` + `rule_content_hash`. | Scene 4 (publish v2; the old decision still shows v1) |
| **05** | Explain and audit | Two views of every decision — three plain-language reasons for the citizen, and a full trace (input snapshot hash, per-rule trace, four confidence pillars, agent timeline) for the auditor, over an append-only SHA-256 chain. | Scene 7 (verify chain) |
| **06** | Consent and take-back | One enforcement point, `enforce_consent(...)`, on every citizen-data read; withdrawal applies on the next request and the denied attempt is committed in an isolated session **before** the `403` is raised, so a rollback can never erase the evidence. | Scene 5 (Ayesha blocked; access log shows it) |
| **07** | Works for everyone | Icon-first wizard, one question per screen, ≥48 px targets, Urdu audio everywhere, IndexedDB autosave and an offline outbox with client-generated idempotency keys. | Scene 1 (offline submit → syncs exactly once) |
| **08** | Scams and fake documents | Genuine notifications carry an `HQ-XXXXX` code plus `body_sha256`; documents are checked by Laplacian blur + HMAC-signed QR + printed-OCR cross-check, and a re-compressed genuine card stays `VERIFIED` or `UNVERIFIABLE` — never falsely accused. | Scene 2 (scam check), Scene 3 (forged card) |

---

## 4. Architecture

```mermaid
flowchart TB
    subgraph Clients["Client layer (single origin)"]
        PWA["Citizen & Helper PWA<br/>/c/*, /h/*, /scam-check<br/>≤150 KB gzip, offline outbox"]
        Staff["Staff consoles<br/>/staff/*, /admin/*, /auditor/*"]
        Ext["External API consumers<br/>Swagger + X-API-Key"]
    end

    subgraph API["FastAPI application"]
        Auth["Auth: JWT / OTP / API-Key"]
        Guards["Server-side guards<br/>RBAC + tenant + consent"]
        Routers["REST routers /api/v1/*"]
        Engine["Pure decision engine<br/>rules DSL, confidence, entity resolution, twin"]
        AI["AI layer (AIProvider: live | fake)<br/>voice, CV, scam, RAG"]
        Audit["Hash-chained audit writer"]
        Mocks["Simulated DPI services /mock/*<br/>identity, civil, household, benefits,<br/>payments, complaints, SMS inbox"]
    end

    subgraph Worker["Background worker"]
        Poller["Postgres SKIP LOCKED runner<br/>PROCESS_CASE, VERIFY_DOCUMENT,<br/>INITIATE_PAYMENT, CHECK_COMPLAINT, REINDEX_RAG"]
    end

    subgraph Storage["Data layer"]
        PG[("PostgreSQL 16<br/>app tables, rules, decisions,<br/>consent, audit chain, jobs, RAG chunks")]
        FS[("File storage<br/>/data/uploads")]
    end

    PWA -->|HTTPS + Idempotency-Key| Auth
    Staff -->|HTTPS| Auth
    Ext -->|X-API-Key| Auth
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
    Worker -->|httpx to MOCK_BASE_URL| Mocks
    Mocks --> PG
```

**LLM proposes, deterministic policy disposes.** The model is allowed to read a document, transcribe Urdu, or draft an explanation — it is never allowed to decide eligibility. Eligibility is a versioned rule set in the database, evaluated by a pure-Python engine that imports no database, no HTTP client and no model SDK. That single constraint buys three things at once: the same inputs always produce the same decision, an admin can change a threshold and have it apply on the next request with no deploy, and an auditor can be handed a rule hash that provably matches the decision that was made. It also means the decision path has **zero dependency on OpenAI** — if the model provider is down, applications still get decided; only the narration degrades.

**Unknown is a first-class value, and nothing is auto-rejected.** Canonical facts are tri-state (`KNOWN` / `UNKNOWN`), and a missing field is never coerced to `0` or `false` to make a rule pass. Confidence is the weakest link across four pillars rather than an average, so a perfect identity match cannot paper over a blurry document. The router has exactly three actions — `AUTO_APPROVE`, `ASK_MORE`, `HUMAN_REVIEW` — and `AUTO_REJECT` exists nowhere in the codebase; `PROCESSING → REJECTED` raises `409 INVALID_TRANSITION`, and only an officer can reject, with a reason code.

---

## 5. Real vs Simulated

This table is the same eleven rows served by `GET /api/v1/transparency` and rendered on `/transparency` in the app.

| Component | Real or Simulated? | Exact details |
|---|---|---|
| Auth, JWT, RBAC, Multi-Tenancy, Consent Engine, Audit Hash Chain | **REAL** | Enforced server-side in FastAPI + PostgreSQL 16 (Alembic migrations). |
| Versioned Rules Engine, Tri-State Evaluator, Entity Resolution, Confidence Router, Digital Twin | **REAL** | Pure Python deterministic engine (`app/engine/`) evaluating live DB rules. |
| Offline-First PWA & Idempotent Outbox | **REAL** | Workbox Service Worker + Dexie IndexedDB + server-side `Idempotency-Key` deduplication. |
| Scam Classifier & Official Verification Codes | **REAL** (trained on synthetic data) | Hybrid deterministic rules + calibrated `scikit-learn` TF-IDF/LR model + cryptographic SMS `body_sha256` lookup. |
| Document Verification (Blur, Signed QR, OCR Cross-Check) | **REAL** (on mock specimens) | OpenCV Laplacian blur + `QRCodeDetector` + `HMAC-SHA256` signature + vision OCR comparison. |
| Urdu Voice STT/TTS & RAG Policy Q&A | **REAL** (with `fake` fallback) | OpenAI `whisper-1` / `gpt-4o-mini` / `text-embedding-3-small` + Deepgram Flux generated offline Urdu MP3s + `edge-tts` for dynamic speech + hybrid Postgres/NumPy retrieval. |
| Identity Registry (NADRA-like) | **SIMULATED** | Mock REST API (`/mock/v1/identity/lookup`) with synthetic `99900-*` CNICs & chaos modes. |
| Civil Death, Household Survey & Benefits Registries | **SIMULATED** | Mock REST APIs (`/mock/v1/civil/*`, `/household/*`, `/benefits/*`) with synthetic data. |
| Instant Payment Rails (Raast-like) & Complaints | **SIMULATED** | Mock REST API (`/mock/v1/payments/*`, `/complaints`) with idempotent transfers & test failure alias. |
| SMS / OTP Delivery | **SIMULATED** | Stored in `notifications` & displayed live in `/staff/device-sim`; no real telecom gateway. |
| Citizens, Cases & Documents | **SYNTHETIC** | 100 % fictional Pakistani personas and watermarked `MOCK SPECIMEN` cards. Zero real personal data. |

---

## 6. The numbers

Every figure below is read from a running system, not estimated. Reproduce them at `GET /api/v1/eval/dashboard` (ADMIN / AUDITOR / OFFICER).

### Cost of being wrong

The cost matrix is stored in each rule version's `policy.cost_matrix`, so it is auditable rather than hardcoded:

| Outcome | Cost | Why |
|---|---|---|
| Wrong auto-approval | **100** | Money leaves for someone not entitled; the error is public and irreversible |
| Unnecessary human review | **8** | An officer's time — real, but recoverable |
| Extra "ask for more proof" round | **5** | Citizen friction and a slower decision |

Bayes puts the break-even point at `p > 1 − 8/100 = 0.92`; we set `τ = 0.90` deliberately on the conservative side of it.

**The sweep is measured, not asserted.** `GET /api/v1/eval/dashboard` replays the labelled set (`backend/app/data/eval_cases.jsonl`, **n = 133**) through the real router at every threshold and reports what each one would have cost:

| `τ` | Auto-approved | False approvals | Sent to a human | Expected cost |
|---|---|---|---|---|
| 0.50 – 0.70 | 78.2 % | 17.3 % | 16.5 % | 2011 |
| 0.75 | 74.4 % | 13.1 % | 20.3 % | 1551 |
| 0.80 | 70.7 % | 8.5 % | 24.1 % | 1091 |
| 0.85 | 62.4 % | 4.8 % | 32.3 % | 779 |
| **0.90 (active)** | **55.6 %** | **0.0 %** | **39.1 %** | **451** |
| 0.95 | 41.4 % | 0.0 % | 53.4 % | 603 |

The curve has a knee at **0.90** and that is where the router sits: it is the lowest threshold at which the false-approval rate reaches **0.0 %**, and pushing to 0.95 costs more (603) because the extra human reviews outweigh the errors they prevent. The sweep is a test, not a dashboard-only calculation — `tests/engine/test_eval_sweep.py` fails if the knee moves.

### Scam classifier

| Metric | Value |
|---|---|
| Model | `scam-tfidf-lr-v1.0.0` (TF-IDF + logistic regression, calibrated) |
| Train / test cases | 172 / 43 |
| Precision | **0.8889** |
| Recall | **0.8889** |
| F1 | **0.8889** |
| False-positive rate | **0.08** |
| False-positive rate on hard negatives (benign texts that mention money, banks, transfers) | **0.00** |
| Confusion matrix | `[[23, 2], [2, 16]]` |

We show false alarms honestly: the dashboard reports the false-positive rate, the hard-negative rate, and a live count of verdicts citizens disputed via `POST /api/v1/scam/{check_id}/feedback`. Blocking a real person is a cost too, which is why the checker advises and never blocks or deletes a message.

### Document verifier

| Metric | Value |
|---|---|
| Eval set | 30 images (clean, WhatsApp-compressed, forged, blurry) |
| Genuine cards verified | **100 %** |
| Forged cards caught | **100 %** |
| **False-tamper rate on genuine cards** | **0.00 %** — including WhatsApp-compressed genuine cards |
| Blurry cards routed to `NEEDS_RETAKE` | **100 %** |

### Live operations

| Metric | Value |
|---|---|
| Decisions recorded (SPD tenant) | 66 |
| `AUTO_APPROVE` / `HUMAN_REVIEW` | 43 / 23 |
| Officer override rate | 0.0 |
| Decision latency p50 / p95 | 16 ms / 20 ms |
| LLM calls in 24 h | 0 |
| LLM cost in 24 h | $0.00 |

### Audit hash chain

Every mutation and AI/agent step appends one row to `audit_events`. The chain is serialized with `pg_advisory_xact_lock(99887766)` and hashed as:

```python
material = f"{prev_hash}|{seq}|{created_at.isoformat()}|{action}|{resource_type}|{resource_id or ''}|{canonical_payload}"
event_hash = hashlib.sha256(material.encode("utf-8")).hexdigest()
```

`GET /api/v1/auditor/verify-chain` walks the chain and returns `first_broken_seq` when a row has been altered. The test suite proves this by editing a row with direct SQL and asserting the exact broken `seq` is reported.

### Test suite

| Suite | Tests | Covers |
|---|---|---|
| `backend/tests/engine` | 596 | Rules DSL, tri-state evaluator, entity resolution, confidence, router policy, digital twin, eval sweep |
| `backend/tests/ai` | 347 | Scam classifier, document verifier, RAG, voice, guardrails, provider, API auth |
| `backend/tests/security` | 21 | RBAC matrix, tenant isolation, consent enforcement incl. denied-log persistence and agent reads |
| `backend/tests/integration` | 86 | Golden path, rule versioning, audit chain, idempotency, chaos resilience, my-data corrections, complaint path, transparency |
| `backend/tests/mocks` | 69 | Simulated DPI services and seed integrity |
| `backend/tests/test_conftest_heal.py` | 14 | The test harness heals a stale schema instead of dropping the database |
| `backend/tests/test_invariants.py` | 11 | Engine purity, mock-import ban, RBAC-on-every-route, no auto-reject, no raw PII in logs, transparency disclosure |
| **Total** | **1143 passing** | 1144 collected |

> One test is red on a machine whose FastAPI is older than the pinned `0.165.0`: `test_every_non_public_route_has_an_rbac_dependency` imports `fastapi.routing._IncludedRouter`, which does not exist in `0.115.x`. It is a version mismatch in the local environment, not a defect in the route table — the same assertion passes under the pinned version in CI.

**Citizen bundle: 127.5 KB gzipped of a 150 KB budget (85.0 %), 123 precache entries.** `npm --prefix frontend run budget` fails the build above 150 KB, so the number cannot drift silently.

---

## 7. Demo access

`POST /api/v1/auth/demo-login` with `{"persona_key": "..."}` — the key alone is enough, no password. Available only when `DEMO_MODE=true`; otherwise it returns `404` so the endpoint cannot exist in a production-shaped deployment. The password column below is for the staff consoles' normal login form.

| Persona key | Role | Tenant | Password login (staff consoles) | Phone |
|---|---|---|---|---|
| `widow_fatima` | CITIZEN | — | OTP only — read it in the Device Simulator | `+923001000001` |
| `shopkeeper_rasool` | CITIZEN | — | OTP only — read it in the Device Simulator | `+923001000002` |
| `helper_ayesha` | HELPER | — | `ayesha@helper.mock` / `Demo@2026` | — |
| `officer_sana` | OFFICER | SPD | `sana@spd.mock` / `Demo@2026` | — |
| `officer_imran` | OFFICER | SPD | `imran@spd.mock` / `Demo@2026` | — |
| `admin_bilal` | ADMIN | SPD | `bilal@spd.mock` / `Demo@2026` | — |
| `admin_platform` | ADMIN | — | `platform@haqdaar.mock` / `Demo@2026` | — |
| `auditor_nadia` | AUDITOR | — | `nadia@audit.mock` / `Demo@2026` | — |
| `officer_zakat` | OFFICER | ZWB | `tariq@zwb.mock` / `Demo@2026` | — |

Citizen CNICs are `9990010000012` (Fatima) and `9990010000021` (Rasool); the helper's is `9990010000032`.

**Seeing OTPs and SMS.** Nothing is sent to a real phone. Every OTP and notification is written to the `notifications` table and rendered live in the **Device Simulator** at `/staff/device-sim`, which shows the message body, the `HQ-XXXXX` verification code and the `body_sha256`. That is also where the Raast payment SMS appears in Scene 1.

---

## 8. Quickstart

```bash
cp .env.example .env          # HOST_DB_PORT=5433, HOST_API_PORT=8010 by default
docker compose up --build     # db + api + worker
```

The `api` container runs `alembic upgrade head` and seeds the demo world on boot, so there is nothing else to do. Once it is healthy:

```bash
curl http://127.0.0.1:8010/health
```

For a clean slate before a demo, reset instead of seeding-if-empty:

```bash
docker compose exec api python -m app.mocks.seed --reset
# or, with the app running: POST /api/v1/admin/demo/reset
```

| What | Where |
|---|---|
| Swagger UI | http://127.0.0.1:8010/api/docs |
| OpenAPI JSON | http://127.0.0.1:8010/api/openapi.json |
| Health (DB, worker heartbeat, upload dir) | http://127.0.0.1:8010/health — `200 OK` or `503 DEGRADED` |
| Prometheus metrics | http://127.0.0.1:8010/metrics — cases and decisions by tenant, audit-chain size, RAG chunk count, LLM calls and failures in 24 h, worker heartbeat age |
| Transparency page | http://127.0.0.1:8010/transparency |
| Device Simulator | http://127.0.0.1:8010/staff/device-sim |
| Demo reset | `POST /api/v1/admin/demo/reset` (ADMIN, `DEMO_MODE=true`) |

Ports are parameterized so several worktrees can run side by side: set `HOST_DB_PORT` and `HOST_API_PORT` in `.env`. The demo runs on `8000`; agent worktrees default to `8010`.

**Without Docker for the app:**

```bash
docker compose up -d db
cd backend
python -m venv .venv && ./.venv/Scripts/pip install -e ".[dev]"
alembic upgrade head
python -m app.mocks.seed --reset
uvicorn app.main:app --reload --port 8010
python -m app.jobs.worker          # second shell, or set RUN_EMBEDDED_WORKER=true
```

### Generate offline Urdu audio

Add `DEEPGRAM_API_KEY=...` to the ignored repository-root `.env`, then run from `backend/`:

```bash
python -m app.ai.tts_pregen
```

This generates the 73 fixed Urdu prompts as MP3 files in `frontend/public/audio/ur/` and updates `manifest.json`. Keep the key out of the frontend and commit only the clips and manifest. `--force` regenerates all clips; without it, existing files are reused.

---

## 9. Verification

```bash
# Backend lint + full suite (needs a reachable Postgres; the suite creates and
# migrates a dedicated haqdaar_test database)
ruff check backend/app backend/tests
AI_PROVIDER=fake pytest backend/tests -q

# Frontend
npm --prefix frontend run typecheck
npm --prefix frontend run build
npm --prefix frontend run budget     # enforces the ≤150 KB gzipped citizen entry chunk
```

`AI_PROVIDER=fake` is the deterministic mode: no network calls, no API key, identical decisions. The suite points at `TEST_DATABASE_URL` (default `postgresql+psycopg://haqdaar:haqdaar@127.0.0.1:5433/haqdaar_test`).

The invariants in `backend/tests/test_invariants.py` are enforced by scanning the source tree, not by convention:

1. `app/engine/` imports no SQLAlchemy, FastAPI, httpx, OpenAI or `app.mocks` — it is pure Python.
2. `app/api/` and `app/agent/` never import `app.mocks.models` and never query a `mock_*` table.
3. Every route outside the documented public surface carries an explicit RBAC dependency.
4. `AUTO_REJECT` does not exist; `PROCESSING → REJECTED` raises `409 INVALID_TRANSITION`.
5. No log statement interpolates a raw CNIC, phone, OTP, password or token.
6. `/transparency` discloses all eleven components, including every simulated service.

---

## 10. Links

| Item | Link |
|---|---|
| Live deployment (Railway) | `<!-- PLACEHOLDER: deployed URL, filled Sunday -->` |
| Demo video (4–5 min, public) | `<!-- PLACEHOLDER: Google Drive link -->` |
| Slides (6 max) | `<!-- PLACEHOLDER: slides link -->` |
| Backend platform & security | [`backend/`](backend/) |
| Decision engine | [`backend/app/engine/`](backend/app/engine/) |
| AI components | [`backend/app/ai/`](backend/app/ai/) |
| Simulated DPI services | [`backend/app/mocks/`](backend/app/mocks/) |
| Frontend PWA & consoles | [`frontend/`](frontend/) |
| Architecture & decisions | [`docs/`](docs/) — start at [`docs/00-index.md`](docs/00-index.md) |

---

## 11. Repo layout

```
backend/
  app/
    main.py          app factory, middleware, error envelope, /health, /metrics
    config.py        Pydantic Settings
    db.py            sync engine, SessionLocal, Base
    models/          every app table (docs/04 §4.1–4.5)
    schemas/         request/response models, canonical facts
    security/        jwt, otp, passwords, rbac, audit chain, consent, idempotency
    jobs/            queue, SKIP LOCKED worker, handler registry, payment runner
    api/v1/          auth, programs, cases, documents, consent, me, helper,
                     officer, admin_*, auditor, public, analytics, transparency
    engine/          pure-Python rules engine (no I/O imports)
    agent/           case agent, fact assembly, mock client
    ai/              provider, doc verify, scam classifier, RAG, voice
    mocks/           simulated DPI services, mounted at /mock
    data/            synthetic datasets, specimen documents, policy corpus
  alembic/           app_0001 (app tables) + dpi_mock_0001 (mock tables)
  tests/             engine, ai, security, integration, mocks, invariants
frontend/            React 18 + Vite PWA, staff consoles, device simulator
docs/                frozen architecture, contracts and decision log
docker-compose.yml   db + api + worker
Dockerfile           multi-stage: builds the frontend, then the Python image
.env.example         every environment variable, documented
```

---

Built during the Coder's Cup 2026 window (Fri 20 Nov 18:00 – Sun 22 Nov 18:00 PKT). All code original to the hackathon. No real personal data, no real government service, no real money.
