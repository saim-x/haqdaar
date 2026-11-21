# 02 - Product Specification

> **Status:** FROZEN v1.0. Source of truth for *what* we build. *How* lives in 03–11.
> Feature IDs (`F-xx`) and acceptance criteria (`AC-xx.y`) are referenced by tests ([13-testing-and-quality.md](13-testing-and-quality.md)) and the traceability matrix ([16-traceability-matrix.md](16-traceability-matrix.md)).

---

## 1. Vision

**Haqdaar** makes a public cash benefit reachable and safe for the people least able to navigate digital government: it lets a woman who cannot read apply by voice and pictures on a weak connection, lets a community helper serve dozens of families without mixing up their data, lets a department decide quickly *without ever silently guessing*, and protects everyone from scams.

**Objectives (measurable in the demo):**

| # | Objective | Demonstrable measure |
|---|---|---|
| O-1 | A non-reader completes an application | Wizard completed using only audio + icons + taps |
| O-2 | No silent guessing | 100 % of low-confidence/flagged cases routed to ASK_MORE or HUMAN_REVIEW with reason codes |
| O-3 | Wrong approvals minimised with numbers | Threshold sweep on eval dashboard: false-approval rate at chosen threshold ≤ 1 % of auto-approvals |
| O-4 | Rules change live | Admin publishes new version; next evaluation uses it; old decision still shows previous version |
| O-5 | Consent truly enforced | Withdrawal → next access returns `403 CONSENT_REVOKED`, logged, visible to citizen |
| O-6 | Works offline | Submission made offline syncs exactly once after reconnection |
| O-7 | Scams caught honestly | Classifier metrics incl. false-positive rate visible; official messages verifiable by code |

---

## 2. Problem & solution

**Problem.** Widowed women in poor households are entitled to support but: (a) forms assume literacy; (b) connectivity is weak; (c) their names are spelled differently in different records ("Mst. Fatima Bibi" / "Fatima" / "فاطمہ بی بی"), dates are missing, households are duplicated; (d) scammers send "Your relief payment of Rs 25,000 is ready, send Rs 500 fee / share your PIN"; (e) departments face fraud (forged documents, duplicate claims) and respond with slow, opaque manual processing.

**Solution.** A multi-tenant platform where:
1. Citizens (or helpers on their behalf) apply through a **voice + icon wizard** that works offline and confirms every answer by reading it back.
2. A **case-processing agent** gathers evidence from simulated identity, civil-registry, household-survey and benefits registries, verifies documents, checks for duplicates and anomalies.
3. A **versioned rules engine** evaluates eligibility with tri-state logic; a **router** computes weakest-link confidence and decides: auto-approve, ask for more, or hand to a human - never auto-reject.
4. **Officers** work a prioritised review queue with AI-prepared case notes; risky approvals need a second officer.
5. Approved cases are paid through a **simulated Raast-like payment service**; every official message carries a **verification code** citizens can check.
6. Citizens see and control **who has their data**; withdrawal is enforced on the server and shown in the audit trail.
7. **Auditors** see the full trace of every decision; **admins** change rules without code and preview impact on past cases.

---

## 3. Personas (seeded in demo data)

| Persona | Role | Profile | Key needs | Primary device / conditions |
|---|---|---|---|---|
| **Fatima Bibi** (52) | CITIZEN | Widow, Thatta district, 3 children under 18, cannot read, speaks Sindhi-accented Urdu. Husband *Ghulam Rasool* died 2025. Registry spells her name "Mst. Fatima Bibi"; her own CNIC card says "Fatima Bibi". | Apply without reading; know what is happening; not be cheated | Low-end Android, Slow 3G, drops |
| **Rasool Bakhsh** (45) | CITIZEN | Kiryana shopkeeper, Hyderabad. Receives 2–3 fake "relief payment" SMS weekly; customers ask him if they're real. | Quick, trustworthy "is this real?" check | Android, OK signal |
| **Ayesha Khatoon** (34) | HELPER | Community health volunteer in Thatta, assists 40 families from **one shared phone**. | Switch between families fast without mistakes; only see what each family allowed | Shared Android |
| **Sana Qureshi** | OFFICER | Social Protection Dept (Mock) case officer | Prioritised queue, clear AI notes, fast safe decisions | Laptop |
| **Imran Siddiqui** | OFFICER | Second officer in same tenant (four-eyes approver) | Review flagged approvals | Laptop |
| **Bilal Ahmed** | ADMIN | Tenant admin, Social Protection Dept (Mock) | Change rules safely, manage users, keys, see impact | Laptop |
| **Platform Admin** | ADMIN (tenant = null) | Operates the platform & mock services | Control mock services (chaos), tenants | Laptop |
| **Nadia Farooq** | AUDITOR | Independent auditor (platform scope, read-only) | Full decision traces, consent history, tamper evidence | Laptop |
| Zakat officer/admin | OFFICER/ADMIN | Zakat & Welfare Board (Mock) tenant | Prove tenant isolation | Laptop |

---

## 4. Core user journeys

### J-1 Widow applies (alone, weak signal) - **golden path**
1. Fatima opens the PWA link (cached after first visit). Taps 🔊 on every screen to hear Urdu audio.
2. Logs in with phone + OTP (OTP shown in the simulated SMS inbox in the demo).
3. Consent step: hears what data is used, by whom, why; taps ✅ to grant the Social Protection Dept access for *Benefit application* + *Payment*.
4. Wizard, one question per screen (icons + audio): name, CNIC (keypad), date of birth, husband's name, husband's CNIC (optional), district (picture list), number of children (big +/– counter), monthly household income (picture bands or keypad), payout (mobile number for Raast alias).
   Each answer can be spoken; the system reads it back; she confirms ✅ or retries ❌.
5. Photos: CNIC front, husband's death certificate. Blurry → "Please take the photo again, hold steady" (audio).
6. Goes offline mid-way → progress saved locally; "Will send when signal returns" icon. Reconnects → synced once.
7. Submits → "We are checking your application" → within seconds: **Approved** (green ✓, coin icon, audio explanation with 3 reasons, amount) → payment sent → SMS with verification code.

### J-2 Helper assists a family (shared phone)
1. Ayesha logs in (email/phone + password). Sees her family list (photo avatar + name + audio name).
2. Adds new family member profile or selects existing → **"You are now helping Fatima Bibi"** confirmation screen (avatar, name, audio). All data from previous family cleared from view.
3. If no active helper consent for this family → consent capture: OTP sent to the citizen's own phone (preferred) or *witnessed verbal consent* (audio recording + helper attestation, marked low-assurance).
4. Completes the wizard as in J-1. Every action is recorded as "Helper Ayesha on behalf of Fatima".
5. Switches to the next family in ≤ 2 taps.

### J-3 Shopkeeper checks a suspicious message
1. Rasool opens "Is this message real?" (no login required for basic check; logged-in adds history).
2. Pastes text / shares screenshot / reads it aloud.
3. Result in large icon + audio: e.g. **"Likely scam"**: reasons: asks for a fee; asks for PIN; amount Rs 25,000 does not match the program's real amounts; official messages always carry a code you can check here.
4. A genuine message with code `HQ-7K3P9` → **"Verified official message"** (provenance match).
5. Optional: "I think this result is wrong" feedback → recorded for false-alarm tracking.

### J-4 Uncertain case → human handoff
1. A case where the CNIC photo's printed name was edited (QR mismatch) or identity is ambiguous.
2. Router → HUMAN_REVIEW with reason codes (e.g. `TAMPER_SUSPECTED`, `POSSIBLE_DUPLICATE_IDENTITY`), priority computed, case note generated (verified / uncertain / suggested checks).
3. Citizen sees: "An officer will check your application. Usually within 2 days. You do not need to do anything." (no accusation).
4. Officer Sana opens queue sorted by priority, reviews evidence, approves → because a HIGH flag exists, status becomes PENDING_SECOND_APPROVAL → Imran approves → payment.

### J-5 Admin changes a rule
1. Bilal opens rule editor for Sahara, creates draft from active v1, changes income threshold 40,000 → 35,000 and per-child amount 1,000 → 1,500.
2. Clicks **Simulate (Digital Twin)** → sees: N past cases replayed, X outcome changes (list), budget delta PKR.
3. Publishes with change note → v2 active immediately (no deploy). New submissions show "Rule version v2"; old decisions still show v1.

### J-6 Citizen withdraws consent
1. Fatima opens "My data" (🔒 icon) → sees who has access (Department, Helper Ayesha) and a log of who viewed what.
2. Withdraws Ayesha's access → Ayesha's next attempt to open Fatima's profile is blocked; Fatima sees "Ayesha tried to view your documents at 15:40 - blocked".
3. If she withdraws the Department's access while a case is open → case goes ON_HOLD_CONSENT; officer sees only reference code and status; clear explanation to citizen of the consequence before confirming.

### J-7 Auditor reviews
1. Nadia filters audit events by case → sees timeline of user, AI, agent actions.
2. Opens decision trace: input snapshot, facts with sources, rule version + hash, model/prompt versions, confidence components, router path, result, citizen explanation.
3. Clicks **Verify audit chain** → "Chain intact: 4,213 events verified".

### J-8 Mock service outage (resilience)
1. Platform admin sets Identity Registry (mock) to DOWN.
2. New submission → agent cannot verify identity → case WAITING_EXTERNAL ("We are waiting for a government system; we will continue automatically") → retry job with backoff.
3. Admin restores NORMAL → job retries → case proceeds. No guess was made.

### J-9 Payment not received → complaint
1. Citizen taps "Money not received" on an approved/paid case → COMPLAINT case created linked to the application.
2. Agent checks payment status via mock payment API; if FAILED, files complaint in mock complaint service, notifies officer queue; citizen informed.

---

## 5. Scope & prioritisation

**P0 = must work in the live demo. P1 = differentiators, built after the golden path works. P2 = only with slack. Cut lines in [12-execution-plan.md](12-execution-plan.md).**

| ID | Feature | Priority | Owner agent |
|---|---|---|---|
| F-01 | Authentication (OTP for citizens, password for staff/helpers), JWT, RBAC, demo persona login | P0 | A1 |
| F-02 | Tenants (2 seeded) & tenant isolation | P0 | A1 |
| F-03 | Benefit application wizard (icon + audio prompts + tap input), drafts | P0 | A5 |
| F-04 | Document upload + verification (blur, signed QR, OCR compare) | P0 upload / P1 verification | A4, A5 |
| F-05 | Case-processing agent (pipeline over mock services) | P0 | A2 (logic), A1 (jobs) |
| F-06 | Decision router, confidence, explanations (template) | P0 | A2 |
| F-07 | Officer review queue + case review + decision | P0 | A6, A1 |
| F-08 | Four-eyes approval on HIGH-risk cases | P1 | A1, A6 |
| F-09 | Mock payment + "money not received" complaint | P0 payment / P1 complaint | A3, A2 |
| F-10 | Citizen dashboard: status, timeline, history, explanation audio | P0 | A5 |
| F-11 | Consent center: see, grant, modify, withdraw; enforcement; access log | P0 | A1, A5 |
| F-12 | My data view + correction requests | P1 | A1, A5, A6 |
| F-13 | Helper mode: family list, safe switching, per-family consent capture | P0 basic / P1 OTP+verbal | A1, A5 |
| F-14 | Scam checker + official message verification code | P0 text / P1 screenshot & voice | A4, A5 |
| F-15 | Admin rule editor + versioning + validation | P0 | A2, A6 |
| F-16 | Digital Twin simulation | P1 | A2, A6 |
| F-17 | Admin: users, API keys, mock-service controls, jobs view | P0 users+keys / P1 rest | A1, A3, A6 |
| F-18 | Auditor console: events, decision trace, consent records, chain verify | P0 | A1, A6 |
| F-19 | Public REST API with API keys + Swagger | P0 | A1 |
| F-20 | Notifications: in-app + simulated SMS inbox with verification codes | P1 (OTP via SMS mock is P0) | A1, A3 |
| F-21 | RAG "Ask about the program" with citations & not-sure | P1 | A4, A5 |
| F-22 | Evaluation dashboard (threshold sweep, scam metrics, doc metrics, LLM usage, overrides) | P1 | A2, A4, A6 |
| F-23 | Tenant analytics dashboard | P1 | A6 |
| F-24 | Offline / low-bandwidth mode (PWA cache, outbox, idempotent sync, lite mode) | P0 drafts+outbox / P1 lite mode | A5, A1 |
| F-25 | Prototype banner + transparency page | P0 | A5, A6 |
| F-26 | Scam map | P2 | A6 |
| F-27 | Second program (Guzara Allowance, Zakat tenant) by configuration only | P1 | A3 |
| F-28 | Webhooks | P2 | A1 |
| F-29 | Demo ops: reset endpoint, device simulator (SMS inbox) page | P0 | A3, A7 |
| F-30 | Anomaly flags (shared payout, repeat claims, helper velocity) | P1 | A2 |
| F-31 | LLM tool-calling assistant (status, complaint, policy Q&A) | P2 | A4 |

**Explicitly out of scope:** real NADRA/Raast/SMS integrations, biometric verification, appeals workflow (P2 note only), subscription billing, native mobile apps, Sindhi/Pashto UI (architecture supports adding; Urdu + English only), real-time chat with officers, payment reconciliation.

---

## 6. Feature specifications & acceptance criteria

Conventions: "citizen" includes a helper acting for that citizen unless stated. All server checks return the error codes in [05-api-contracts.md §2](05-api-contracts.md).

### F-01 Authentication & RBAC
- Citizens: phone + 6-digit OTP (simulated SMS). Staff & helpers: email + password. Access JWT 15 min, refresh 30 days (citizens) / 12 h (staff).
- Demo persona login (`DEMO_MODE=true` only) - one-tap login for judges, clearly labelled "Prototype demo login".
- **AC-01.1** Each of the 5 roles can log in and lands on its own home screen.
- **AC-01.2** Calling any staff endpoint with a citizen token returns `403 FORBIDDEN`; the attempt is audited (`auth.forbidden`).
- **AC-01.3** OTP request limited to 3 per phone per 10 min (`429 RATE_LIMITED`).
- **AC-01.4** With `DEMO_MODE=false`, `/auth/demo-login` returns 404.

### F-02 Tenants
- **AC-02.1** An officer of tenant ZWB requesting a case of tenant SPD gets `404 NOT_FOUND` (not 403 - no existence leak).
- **AC-02.2** Queue, analytics, rule sets, API keys are always tenant-filtered server-side.

### F-03 Application wizard
- One question per screen; each screen: icon/pictogram, short Urdu text, 🔊 audio prompt (auto-plays once if audio-first mode), input (tap choices / keypad / counter / voice), ✅ next, ◀ back.
- Questions (exact canonical keys in [04-data-model.md §5](04-data-model.md)): `applicant_full_name`, `applicant_cnic`, `applicant_dob`, `spouse_full_name`, `spouse_cnic` (optional, "I don't know" allowed), `applicant_district`, `children_under_18`, `household_size`, `monthly_income_pkr`, `payout_phone`, plus document steps.
- "I don't know" is a valid answer for optional facts → stored as `null` with `missing_reason: "USER_UNKNOWN"`.
- Draft autosaved locally on every step and to server when online.
- **AC-03.1** A user can complete all steps without reading text (audio on every screen, icon on every choice).
- **AC-03.2** Closing the app and reopening resumes at the last step with answers intact (local + server).
- **AC-03.3** Invalid CNIC (not 13 digits) cannot be confirmed; audio explains.
- **AC-03.4** Every voice-derived value is read back and requires ✅ before it is stored as `confirmed: true`.
- **AC-03.5** Submission requires all required fields confirmed and required documents attached, else the missing step is highlighted and spoken.

### F-04 Documents
- Types: `CNIC_FRONT` (required), `SPOUSE_DEATH_CERTIFICATE` (required unless civil registry already confirms death), `OTHER`.
- Client compresses to ≤ 1280 px longest side, JPEG q≈0.7 (≤ 250 KB).
- Verification outcomes: `VERIFIED`, `NEEDS_RETAKE`, `UNVERIFIABLE`, `TAMPER_SUSPECTED` ([07-ai-components.md §5](07-ai-components.md)).
- **AC-04.1** Blurry image → `NEEDS_RETAKE` within 5 s with spoken retake instructions; case not submitted for decision with it.
- **AC-04.2** Genuine mock CNIC → `VERIFIED` with extracted fields matching QR payload.
- **AC-04.3** Mock CNIC with edited printed name → `TAMPER_SUSPECTED` → case routed HUMAN_REVIEW; citizen sees neutral wording.
- **AC-04.4** Genuine CNIC re-compressed (WhatsApp-like quality) still `VERIFIED` (false-positive guard).
- **AC-04.5** Image without readable QR → `UNVERIFIABLE` (not tamper) → ASK_MORE or HUMAN_REVIEW.

### F-05 Case-processing agent
- Runs as `PROCESS_CASE` background job after submit. Steps (each an audited `agent.step` with tool, input summary, output summary, duration): load case → resolve identity (mock identity registry) → civil registry (spouse death) → household survey (income, size) → benefits registry (other programs) → document verification results → duplicate & anomaly checks → build facts → evaluate active rule set → route → persist decision → side effects (notify, payment job if auto-approved).
- **AC-05.1** Case timeline shows each agent step in order with timing.
- **AC-05.2** If any registry call fails after retries → `WAITING_EXTERNAL`, retry job scheduled, no decision recorded.
- **AC-05.3** Re-running the job for the same case version is idempotent (no duplicate decisions/payments).

### F-06 Routing, confidence & explanation
- Spec in [06-decision-engine.md](06-decision-engine.md). Outputs: `AUTO_APPROVE`, `ASK_MORE`, `HUMAN_REVIEW`, `WAIT_EXTERNAL`.
- **AC-06.1** No code path produces REJECTED without an officer.
- **AC-06.2** A case with all rules PASS, confidence ≥ threshold, no flags, amount ≤ cap → APPROVED automatically with explanation in Urdu + English.
- **AC-06.3** Any UNKNOWN required fact that the citizen can supply → NEEDS_INFO with a specific, spoken request (max 2 rounds, then HUMAN_REVIEW).
- **AC-06.4** Citizen explanation lists ≤ 3 reasons in plain words and the next step; audio available.

### F-07 Officer queue & review
- Queue columns: priority band, reference, applicant (masked CNIC), status, top reason codes, confidence, AI recommendation, waiting time, assigned officer. Sort by priority (default), confidence ascending, oldest. Filters: status, flag, assigned to me.
- Case review: facts table with source badges, rule trace (PASS/FAIL/UNKNOWN), documents with verification checks, risk flags, AI case note, timeline, actions: Assign to me, Approve, Reject (reason required), Request info (select items), Escalate, Add note, Re-evaluate with current rules.
- **AC-07.1** Queue default sort is priority desc; switching to confidence asc works server-side.
- **AC-07.2** Reject requires at least one reason code and a note; citizen explanation generated from them.
- **AC-07.3** If the rule set changed since the AI recommendation, a banner shows "Evaluated with v1, current is v2" with a Re-evaluate button.
- **AC-07.4** Officer decision that disagrees with the AI recommendation is recorded as an override (counts in evaluation dashboard).

### F-08 Four-eyes
- **AC-08.1** Approving a case with any HIGH-severity flag (or amount above policy cap) moves it to PENDING_SECOND_APPROVAL; the same officer cannot give the second approval (`403 SAME_OFFICER`).
- **AC-08.2** Second officer approval → APPROVED → payment; rejection → back to IN_REVIEW with note.

### F-09 Payment & complaint
- On APPROVED, `INITIATE_PAYMENT` job calls mock payment API with idempotency key = payment id. Statuses: CREATED → INITIATED → COMPLETED | FAILED.
- **AC-09.1** Exactly one transfer per approved case even if the job runs twice.
- **AC-09.2** On COMPLETED, citizen receives in-app + simulated SMS with amount and verification code.
- **AC-09.3** "Money not received" creates a COMPLAINT case linked to the application; agent checks payment status and files a mock complaint if FAILED.

### F-10 Citizen dashboard
- Big status card: icon + colour + audio (never colour alone). Timeline of steps in plain words. History of past cases. "What happens next" line.
- **AC-10.1** Status text and audio exist for every case status in [04-data-model.md §3](04-data-model.md).
- **AC-10.2** Status polling uses ETag and backs off (no more than 1 request / 5 s, max 60 s interval).

### F-11 Consent center
- Shows active grants (who, what categories, purpose, since, until), history (granted / modified / withdrawn), access log (allowed and **denied** attempts).
- **AC-11.1** Withdrawal takes effect on the next request (no caching of consent decisions beyond a single request).
- **AC-11.2** Denied access attempts appear in the citizen's access log within one refresh.
- **AC-11.3** Withdrawing the department's grant while a case is open requires an explicit confirmation explaining the consequence and sets the case ON_HOLD_CONSENT.
- **AC-11.4** Re-granting resumes the case from where it was.

### F-12 My data & corrections
- "See my data": everything stored about the citizen, grouped by category, with source badges.
- Correction request: self-declared fields → applied immediately as a new value (old value kept in history); registry-sourced fields → correction request to an officer (we cannot edit the registry).
- **AC-12.1** Correction of a self-declared field triggers re-evaluation if a case is in NEEDS_INFO/IN_REVIEW.

### F-13 Helper mode
- **AC-13.1** Helper sees only families with an ACTIVE `HELPER` grant to them; other citizens' data returns 404.
- **AC-13.2** Switching family issues a new act-for token; the UI clears all cached data of the previous family; a confirmation screen with the new family's name + avatar + audio is shown.
- **AC-13.3** Helper-entered values are marked `entered_by: HELPER` in fact provenance.
- **AC-13.4** Witnessed verbal consent creates a `LOW_ASSURANCE_CONSENT` flag on cases (lowers confidence; see 06).
- **AC-13.5** Phone-number reuse across a helper's families is **not** treated as a duplicate signal (shared phone is expected).

### F-14 Scam checker & message verification
- **AC-14.1** Message requesting a PIN/OTP or a fee → `LIKELY_SCAM` with those red flags listed.
- **AC-14.2** A real platform notification text with its code → `VERIFIED_OFFICIAL`.
- **AC-14.3** A message with a code that does not exist, or exists but with different text → `LIKELY_SCAM` (`RF_FAKE_CODE` / `RF_CODE_MISMATCH`).
- **AC-14.4** Short/ambiguous text → `CANNOT_TELL` with safety advice, never "safe".
- **AC-14.5** The checker never blocks or deletes anything; it advises.

### F-15 Rule editor
- Form-based editor (no JSON typing required; raw JSON view read-only + "advanced edit" for admins).
- Draft → Validate → Simulate (optional) → Publish (change note required). Published versions immutable.
- **AC-15.1** Publishing makes the next evaluation use the new version with no restart.
- **AC-15.2** Invalid drafts (unknown fact key, type mismatch, missing explanation text) cannot be published; errors shown per field.
- **AC-15.3** Each decision displays rule version number + hash; old decisions keep their version.

### F-16 Digital Twin
- **AC-16.1** Simulation replays stored fact snapshots of the last N (default 200) decided cases of the program through the draft; shows counts per outcome (before/after), list of changed cases, budget delta.
- **AC-16.2** Simulation causes no side effects (no decisions, payments, notifications on real cases); only a `simulation_runs` record and an audit event.

### F-17 Admin
- Users (create, disable, change role within tenant), API keys (create shows secret once, revoke), mock services (mode NORMAL/SLOW/FLAKY/DOWN, latency, failure rate) - platform admin only, jobs (list, retry dead).
- **AC-17.1** A revoked API key fails on the next call with `401`.
- **AC-17.2** Mock service set to DOWN causes J-8 behaviour.

### F-18 Auditor
- **AC-18.1** Auditor cannot call any mutating endpoint (`403`).
- **AC-18.2** Decision trace shows: input snapshot hash + content, facts with sources, rule version + hash, model/prompt versions, confidence components, route, result, explanation.
- **AC-18.3** "Verify chain" recomputes hashes and reports first broken link if any.

### F-19 Public API
- **AC-19.1** `/api/docs` (Swagger UI) and `/api/openapi.json` reachable; public endpoints documented with examples.
- **AC-19.2** Public endpoints require `X-API-Key`; scopes enforced; per-key rate limit.

### F-20 Notifications
- **AC-20.1** Every outbound simulated SMS/in-app notification has a unique verification code and is visible in the device simulator for that phone.

### F-21 RAG assistant
- **AC-21.1** Answers include ≥ 1 citation (document title, section, version).
- **AC-21.2** If top retrieval similarity < threshold or no supporting chunk → status `NOT_SURE` with an offer to ask a helper/officer; no fabricated answer.
- **AC-21.3** Never states a personal eligibility outcome ("you will get money"); refers to the application instead.
- **AC-21.4** After a rule publish, the auto-generated "Current eligibility rules" document is re-indexed and answers reflect the new values.

### F-22 Evaluation dashboard
- **AC-22.1** Threshold sweep table/chart for the decision router: per threshold → auto-approve rate, false-approval rate, human-review load, expected cost; chosen threshold highlighted.
- **AC-22.2** Scam classifier: confusion matrix, precision, recall, **false-positive rate** on held-out set + count of user-disputed results.
- **AC-22.3** Document verifier metrics on the synthetic image set incl. false tamper alarms.
- **AC-22.4** Live: decisions by route, officer override rate, p50/p95 pipeline latency, LLM calls/cost/failures.

### F-24 Offline / low bandwidth
- **AC-24.1** After first load, the citizen app shell opens with no network.
- **AC-24.2** Actions taken offline are queued and replayed with the same `Idempotency-Key`; server returns the original response for replays; no duplicate cases/documents.
- **AC-24.3** Citizen initial JS ≤ 150 KB gzipped; lite mode disables non-essential images.

### F-25 Transparency
- **AC-25.1** Every page shows "PROTOTYPE - not an official government service. All identity, payment and data services are simulated."
- **AC-25.2** `/transparency` lists real vs simulated components (table in [15-demo-and-submission.md](15-demo-and-submission.md)).

---

## 7. Non-functional requirements

| ID | Requirement | Target |
|---|---|---|
| NFR-1 Performance | Pipeline decision latency (no LLM in the decision path) | p95 ≤ 8 s incl. mock latency (NORMAL mode) |
| NFR-2 Bandwidth | Citizen first load ≤ 300 KB total transfer; repeat load ≤ 20 KB; typical API response ≤ 10 KB | |
| NFR-3 Availability | Demo-time availability; no cold start | Railway always-on; health endpoint |
| NFR-4 Security | Server-side RBAC/tenant/consent on every endpoint; hashed passwords/API keys; no PII in logs | Tests per [13](13-testing-and-quality.md) |
| NFR-5 Auditability | 100 % of state changes and AI calls produce audit events | Chain verification passes |
| NFR-6 Determinism | Same facts + same rule version → same decision | Engine purity tests |
| NFR-7 Accessibility | Tap targets ≥ 48 px; never colour-only status; audio on every citizen screen; RTL correct | Manual checklist |
| NFR-8 Localisation | Urdu (default for citizen/helper) and English for all citizen strings; staff console English with Urdu explanations visible | |
| NFR-9 Resilience | Any single mock service DOWN → no crash, no guess | Chaos test |
| NFR-10 Privacy | Data minimisation to LLM (mask CNIC where not needed); synthetic data only | Review |

---

## 8. Edge cases & exceptional scenarios (must be handled)

| # | Scenario | Expected behaviour |
|---|---|---|
| E-1 | Same person submits twice (different devices) | Second submission flagged `DUPLICATE_APPLICATION` (HIGH) → human; first unaffected |
| E-2 | Same offline submission replayed 3× | One case; replays return original response |
| E-3 | CNIC in registry but name very different | `IDENTITY_CONFLICT` (HIGH) → human; never auto-match |
| E-4 | No CNIC known; two registry people with same name, different DOB | No match chosen; `POSSIBLE_DUPLICATE_IDENTITY`/ambiguity → ASK_MORE (CNIC photo) |
| E-5 | Self-declared income 25k, survey says 55k | `DATA_CONFLICT_INCOME` (MEDIUM) → human; explanation shows both with sources |
| E-6 | Applicant marked deceased in registry | `APPLICANT_DECEASED` (HIGH) → human |
| E-7 | Same payout number on 3 unrelated applicants | `PAYOUT_ACCOUNT_SHARED` (HIGH) → human (helper's own phone excluded only for *contact* phone, not payout) |
| E-8 | Payout account title doesn't match applicant name | `PAYOUT_NAME_MISMATCH` (MEDIUM) |
| E-9 | CNIC last digit odd (male convention) for a widow applicant | `CNIC_GENDER_MISMATCH` (LOW) - could be data entry error |
| E-10 | Expired CNIC | Rule fails with `on_fail: ASK` → NEEDS_INFO "please renew/upload valid CNIC" |
| E-11 | Rule set published while a case is mid-pipeline | Case uses version active at evaluation start (recorded) |
| E-12 | Case in NEEDS_INFO when new rules publish | Re-evaluated with the new version on resubmission; timeline notes the change |
| E-13 | Consent withdrawn while officer has case open | Officer's next action/refresh → `403 CONSENT_REVOKED`; case ON_HOLD_CONSENT |
| E-14 | Helper consent expires | Helper loses access automatically; family list shows "consent expired - renew" |
| E-15 | LLM API down | Explanations from templates; voice falls back to tap; doc OCR → `UNVERIFIABLE` (not tamper) → human; RAG returns NOT_SURE |
| E-16 | Payment service FLAKY | Retries with same idempotency key; after max attempts PAYMENT_FAILED + officer notified |
| E-17 | Upload of non-image/oversized file | `415`/`413` with spoken message |
| E-18 | Prompt injection text inside a scam message or document | Treated as data; no tool/action triggered; guardrail log |
| E-19 | Citizen answers "I don't know" for spouse CNIC | Allowed; civil registry search by spouse name+district; ambiguity → ASK death certificate |
| E-20 | Two helpers try to manage the same family | Allowed only if citizen granted both; each action attributed |
