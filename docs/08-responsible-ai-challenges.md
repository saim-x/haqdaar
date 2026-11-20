# 08 — Responsible AI & The Eight Technical Challenges

> **Status:** FROZEN v1.0. Translates Challenges 01–08 from the official PDF into concrete system behaviour, decision tables, and judge-verifiable demonstrations.

Every technical challenge in Section 04 of the official problem statement is engineered as a **first-class mechanism** in Haqdaar — never a prompt instruction or UI mock.

---

## Challenge 01 — The Cost of Being Wrong

- **PDF Requirement:** *"A wrong approval is worse than a slow one. Define your own rule for when the system acts alone, when it asks for more proof, and when it sends the case to a human. Show the numbers behind your choice."*
- **Concrete System Behaviour:**
  1. Explicit cost matrix encoded in each rule version's `policy.cost_matrix` (`wrong_approval_cost = 100`, `unnecessary_human_review_cost = 8`, `ask_more_cost = 5`).
  2. Weakest-link confidence (`min` across identity, documents, data consistency, consent assurance) prevents strong signals from masking a weak signal.
  3. **Three-way routing policy:**
     - **Act alone (`AUTO_APPROVE`):** ALL eligibility rules `PASS` AND zero `HIGH` flags AND `confidence_overall >= 0.90` AND `amount_pkr <= 20,000`.
     - **Ask for more proof (`ASK_MORE`):** Required user-providable fact is `UNKNOWN` or retakable document/expired CNIC (`on_fail/on_unknown == "ASK"`), up to max 2 rounds.
     - **Send to human (`HUMAN_REVIEW`):** Any `HIGH` flag, any `HUMAN` rule failure, `confidence_overall < 0.90`, verbal-only helper consent (`0.82`), `amount_pkr > 20,000`, or > 2 ask-more rounds.
     - **Hard ban on auto-rejection:** `AUTO_REJECT` does not exist anywhere in the codebase. Only an officer can reject, with mandatory reason codes.
  4. **Four-eyes approval:** Cases with any `HIGH` flag require two distinct officers (`PENDING_SECOND_APPROVAL`).
- **Numbers Shown:** Live threshold sweep on 120 labelled synthetic cases rendered in the Evaluation Dashboard (`/staff/eval`), showing expected cost, false-approval rate (≤ 1 % at `0.90`), and officer workload across thresholds `0.50–0.95`.
- **Verification:** `tests/engine/test_router_policy.py` + `tests/engine/test_eval_sweep.py`.

---

## Challenge 02 — Saying "I Am Not Sure"

- **PDF Requirement:** *"The system must know when it does not know. Low confidence must lead to a clear handoff to a human, with the case notes attached. Silent guessing earns zero."*
- **Concrete System Behaviour:**
  1. **Zero silent guessing everywhere:**
     - **Rules Engine:** Unknown facts stay `UNKNOWN` (tri-state), never coerced to `0`/`false`.
     - **Entity Resolution:** Ambiguous multi-candidate name matches produce `POSSIBLE_DUPLICATE_IDENTITY` → `HUMAN_REVIEW`, never "pick top-1".
     - **External Outage:** Mock API down → `WAITING_EXTERNAL` + retry job, never assume "no conflicting grant".
     - **Voice Parser:** Low parse confidence (< 0.70) → `needs_retry: true` + keypad fallback; every parsed answer requires citizen readback confirmation.
     - **Scam Checker:** Middle probability band (`0.35–0.75`) or very short text → explicit `CANNOT_TELL` verdict with safety tips.
     - **RAG Assistant:** Top hybrid retrieval score < threshold → `NOT_SURE` with offer to contact helper/officer, zero LLM fabrication.
  2. **Structured Handoff:** Every `HUMAN_REVIEW` route generates `ai_case_note` (`verified`, `uncertain`, `suggested_checks`) and enumerated `escalation_reasons`, visible at the top of the officer's review screen.
  3. **Citizen Dignity:** Citizen sees clear, reassuring Urdu + audio wording (*"An officer will check your application within 2 days"*) rather than an error or accusation.
- **Verification:** `tests/engine/test_uncertainty_handoff.py` + `tests/ai/test_rag_abstention.py` + `tests/ai/test_scam_calibration.py`.

---

## Challenge 03 — Bad Data

- **PDF Requirement:** *"Missing fields, duplicate people, and names spelled in many ways (e.g., Muhammad / Mohammad / Muhammed). Handle them without crashing and without a wrong match."*
- **Concrete System Behaviour:**
  1. **Messy Name Normalization:** Urdu Unicode normalization + Urdu-to-Roman transliteration + honorific stripping (`Mst.`, `Bibi`, `Haji`, `Syed`) + Pakistani phonetic canonicalization (`Muhammad`/`Mohammad`/`Muhammed`/`Mohd` → `muhammad`) + RapidFuzz Jaro-Winkler & token-set matching.
  2. **Strict Match Policy:** Never match on name alone. CNIC + variant spelling (0.70–0.84) succeeds cleanly and logs the variant; CNIC + very different name (< 0.55) raises `IDENTITY_CONFLICT` (HIGH) without merging; missing CNIC + ≥ 2 matching people raises `POSSIBLE_DUPLICATE_IDENTITY` (HIGH).
  3. **Missing Fields:** Citizens can explicitly select *"I don't know"* for optional fields (e.g., `spouse_cnic`); system pivots to spouse name + district lookup or requests death certificate without crashing.
  4. **Conflicting Sources:** When household survey income (PKR 55,000) conflicts with self-declared income (PKR 25,000), both values + sources are preserved in `input_snapshot_json.alternatives`, `DATA_CONFLICT_INCOME` (MEDIUM) is raised, and an officer decides.
  5. **Duplicate Applications vs Shared Helper Phones:** Repeat applications on the same CNIC raise `DUPLICATE_APPLICATION` (HIGH). Shared *contact* phone across a helper's 40 families is **allowed**; shared *payout* Raast alias across unrelated citizens raises `PAYOUT_ACCOUNT_SHARED` (HIGH).
- **Verification:** `tests/engine/test_entity_resolution.py` (25+ Pakistani spelling/duplicate/conflict edge cases).

---

## Challenge 04 — Rules That Change

- **PDF Requirement:** *"An admin changes an eligibility rule. The system must follow the new rule at once, with no code change and no redeploy. Old decisions must still show which rule version was used."*
- **Concrete System Behaviour:**
  1. Eligibility rules and benefit formulas live strictly in `rule_versions.rules_json` (database), evaluated by the pure DSL engine — zero hardcoded thresholds in Python.
  2. **Lifecycle:** `DRAFT` → `Validate` → `Simulate (Digital Twin)` → `Publish` (requires `change_note`). Published versions are immutable (`409 RULE_VERSION_IMMUTABLE` on edit).
  3. **Immediate Effect:** Publishing atomically updates `programs.active_rule_version_id`. The very next case evaluation loads the new version with zero restart or deploy, AND triggers `REINDEX_RAG` so policy Q&A updates automatically.
  4. **Historical Preservation:** Every `decisions` row records `rule_version_id` and `rule_content_hash` (SHA-256). Viewing an older case shows v1 + its exact rule trace; officers reviewing an older pending case see a staleness banner (*"Evaluated with v1; current active is v2 — Re-evaluate"*).
  5. **Digital Twin Preview:** Before publishing, admins replay the draft against historical decided cases to inspect outcome flips and PKR budget delta.
- **Verification:** `tests/integration/test_rule_versioning_and_twin.py`.

---

## Challenge 05 — Explain and Audit

- **PDF Requirement:** *"Every AI decision needs two views: a simple reason for the user, and a full trace for the auditor (input, rule or model version, confidence, result)."*
- **Concrete System Behaviour:**
  1. **User View (Citizen & Helper):** Max 3 plain-language reasons in Urdu and English, headline with outcome/amount, clear "what happens next", playable as Urdu audio. Neutral wording for human-review cases.
  2. **Auditor View (`GET /api/v1/auditor/cases/{id}/trace`):**
     - Complete `input_snapshot_json` + SHA-256 `input_snapshot_hash` (every fact with source, confidence, entered_by, alternatives).
     - `rule_version_id`, `version_number`, `rule_content_hash`, and per-rule `rule_trace_json` (`PASS`/`FAIL`/`UNKNOWN` with actual vs expected).
     - `model_versions` (engine version, OCR/STT/explainer model & prompt versions).
     - `confidence_components` (all 4 pillars + weakest-link overall) + `route_action` + `escalation_reasons`.
     - `agent.step` timeline (every mock API call, duration, status).
  3. **Tamper-Evident Audit Chain:** Every state mutation and AI/agent action writes to append-only `audit_events` with `event_hash = SHA256(prev_hash | seq | ...)`. Auditor can click **Verify Chain** (`GET /api/v1/auditor/verify-chain`) to prove zero tampering.
- **Verification:** `tests/integration/test_audit_chain_and_trace.py` (includes negative test modifying a DB row directly and verifying chain check detects exact broken `seq`).

---

## Challenge 06 — Consent and Take-Back

- **PDF Requirement:** *"A user can see who has their data, change what is shared, and withdraw it. Withdrawal must truly stop access, and the audit log must show it."*
- **Concrete System Behaviour:**
  1. **Granular Grants:** Per recipient (`DEPARTMENT` tenant or specific `HELPER` user), per data category (`IDENTITY`, `HOUSEHOLD`, `DOCUMENTS`, `PAYMENT`, `CASE_HISTORY`), per purpose, with expiry and assurance level.
  2. **Single Server-Side Enforcement Point (`security/consent.py`):** Every read/action on citizen data invokes `enforce_consent(db, citizen_id, actor, category, purpose, resource_ref)` on **every request** (zero cross-request caching).
  3. **True Enforcement:**
     - Withdrawal sets `consent_grants.status = 'WITHDRAWN'` immediately, appends `consent_events`, writes `audit_events` (`consent.withdrawn`).
     - Next request by the withdrawn Helper or Officer returns `403 CONSENT_REVOKED`, writes a `consent_access_logs` row with `allowed=false, denial_reason='CONSENT_REVOKED'`, and writes `audit_events` (`consent.access_denied`).
     - Withdrawing a Department's consent with an open case prompts confirmation and transitions open cases to `ON_HOLD_CONSENT` (officer only sees reference code + paused status, zero PII/documents). Re-granting restores `previous_status`.
  4. **Citizen Visibility:** Citizen's Consent Center shows active grants, one-tap withdraw, and the full access log including **blocked attempts** (*"Helper Ayesha tried to view your documents at 15:40 — Blocked"*).
- **Verification:** `tests/security/test_consent_enforcement.py`.

---

## Challenge 07 — Works for Everyone

- **PDF Requirement:** *"A person who cannot read, on a weak connection, must still finish the task. Think voice, icons, small pages, and saved progress."*
- **Concrete System Behaviour:**
  1. **Zero-Literacy Floor:** Icon + pictogram-led wizard, one question per screen, ≥ 48 px tap targets, colour + icon + text (never colour alone), RTL Urdu default, pre-recorded Urdu audio prompt on every screen (🔊 auto-play option), tap/keypad/counter alternatives to voice so voice is never a single point of failure.
  2. **Voice Readback:** Every spoken answer is read back in Urdu and requires explicit ✅ confirmation.
  3. **Weak & Dropping Internet:**
     - Route-split Vite PWA keeps Citizen JS bundle ≤ 150 KB gzipped; initial transfer ≤ 300 KB; Lite Mode toggle removes non-essential imagery.
     - Pre-recorded audio & app shell cached by Workbox Service Worker.
     - Wizard state autosaved to IndexedDB (`Dexie.js`) on every tap.
     - Offline actions (draft updates, compressed ≤ 250 KB photo uploads, submit) stored in an **Offline Outbox** with client-generated `Idempotency-Key` UUIDs and replayed automatically on `online` event without losing or duplicating cases.
     - ETag/304 polling with exponential backoff for status checks.
  4. **Shared Phone Safety (Helper Mode):** Fast ≤ 2-tap family switch, explicit *"You are now helping [Name]"* audio/avatar banner, total memory/cache wipe between families, per-family consent.
- **Verification:** Build bundle-size check (`<= 150 KB` gzipped) + Playwright offline-submit-and-reconnect E2E test (`frontend/src/e2e/offline_sync.spec.ts`).

---

## Challenge 08 — Scams and Fake Documents

- **PDF Requirement:** *"Catch fake 'relief payment' messages and edited or forged documents. Show false alarms honestly. Blocking a real person is also a cost."*
- **Concrete System Behaviour:**
  1. **Anti-Scam Verification Codes:** Every genuine Haqdaar notification carries a unique `HQ-XXXXX` code + `body_sha256`. Checking it gives `VERIFIED_OFFICIAL`; forged or altered text gives `LIKELY_SCAM` (`RF_FAKE_CODE` / `RF_CODE_MISMATCH`).
  2. **Hybrid Scam Classifier:** Deterministic red flags + calibrated scikit-learn TF-IDF+LR model with an explicit `CANNOT_TELL` uncertainty band. Never blocks/deletes messages — advises with clear Urdu/English red flags.
  3. **Signed-QR Document Forgery Detection:** OpenCV Laplacian blur check (`NEEDS_RETAKE`), HMAC-SHA256 signed QR verification, and printed-OCR vs signed-QR cross-check (`TAMPER_SUSPECTED`). Re-compressed/noisy genuine photos stay `VERIFIED` or `UNVERIFIABLE` — never falsely accused of forgery.
  4. **Honest False-Alarm Reporting:**
     - Evaluation Dashboard displays scam classifier false-positive rate (specifically on hard negatives mentioning money/banks), document false-tamper rate, and user-disputed verdict counts (`POST /scam/{id}/feedback`).
     - Suspected tampered documents route to **officer human review** with neutral wording to the citizen — never automatic rejection or account ban, respecting that blocking a genuine widow is a severe cost.
- **Verification:** `tests/ai/test_scam_classifier.py` + `tests/ai/test_doc_verifier.py`.
