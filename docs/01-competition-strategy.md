# 01 - Competition Analysis & Winning Strategy

> **Status:** FROZEN v1.0 (Fri 20 Nov 2026). Changes only via the Integration Lead and [17-decision-log.md](17-decision-log.md).
> **Audience:** Everyone. Read this first after [00-index.md](00-index.md).

---

## 1. The brief, compressed

Coder's Cup '26 asks for **one multi-user SaaS platform** on top of (mocked) Pakistani digital public infrastructure (identity, payments, data exchange) that serves three people at once:

| Persona in brief | Their barrier | What the platform must do for them |
|---|---|---|
| The **widow** | Cannot read forms, weak phone signal | Voice/icon-first, small pages, saved progress, offline |
| The **shopkeeper** | Receives fake "relief payment" messages | Scam detection with honest uncertainty |
| The **helper** | Serves 40 families from one shared phone | Fast, safe switching between people, separate consent each |

…with **incomplete records, inconsistent name spellings, and the fact that one wrong approval can cost someone their savings.**

The platform must **decide, explain, protect**, and be able to say **"I am not sure"** and hand over to a human. *"This is not a chatbot."* It needs users, roles, cases, rules, and audit trails.

The organisers explicitly say: **judges score judgment - how the system handles risk, mistakes, and surprises - and actual behaviour, not claims.**

---

## 2. Complete requirement extraction

Every item below is tracked in [16-traceability-matrix.md](16-traceability-matrix.md) with an owner and a verification method.

### 2.1 Hard rules (eligibility - violating any one can disqualify)

| ID | Rule | Our compliance mechanism |
|---|---|---|
| RULE-1 | All development during the hackathon window | Fresh repo created after 18:00 Fri; commit history is the evidence. No pre-built code imported. |
| RULE-2 | Original solution, no plagiarism | Only open-source libraries via package managers; all app code written in-window. |
| RULE-3 | No real personal data | 100 % synthetic seed data generator; mock CNIC numbers in a reserved fake range; "MOCK SPECIMEN" watermark on all generated documents. |
| RULE-4 | Mock identity, payment, data services | Separate `/mock/*` simulated services behind HTTP APIs, each response tagged `"simulated": true`. |
| RULE-5 | Label as prototype, not official service | Persistent banner on every screen + `/transparency` page + README section. |
| RULE-6 | Tell judges what is real vs simulated | `/transparency` page and README table; mock services visually marked in the UI. |

### 2.2 Constraints (system "must handle all")

| ID | Constraint |
|---|---|
| CON-1 | Wrong approvals cost more than slow approvals - show the trade-off |
| CON-2 | Weak internet - works on slow/dropping connection |
| CON-3 | Low literacy - usable by someone who cannot read |
| CON-4 | Rules change without notice - adapt without code changes |
| CON-5 | Bad data - missing, duplicated, wrong |
| CON-6 | Explainable decisions - to the user and to an auditor |
| CON-7 | User control - control sharing and take it back |
| CON-8 | "I am not sure" - low confidence stops and hands to a human |

### 2.3 Roles (≥ 3 required) - **we implement all 5**

Citizen · Community helper · Department officer · Admin · Auditor.

### 2.4 Core platform features (all required)

| ID | Feature |
|---|---|
| CORE-1 | Secure login (JWT/OAuth) with RBAC |
| CORE-2 | Dashboard with task progress, status, history |
| CORE-3 | Case management (create, assign, escalate, close) |
| CORE-4 | Public REST API with API keys + Swagger/OpenAPI docs |
| CORE-5 | Audit log of every user, AI and agent action |
| CORE-6 | Consent management (see, share, withdraw, correct) |
| CORE-7 | Mock identity, payment and data services behind clean APIs |

### 2.5 "Pick at least 3" platform features - our selection

| Feature | Decision | Priority | Why |
|---|---|---|---|
| Admin rule editor | **BUILD** | P0 | Directly required by Challenge 04. |
| Officer review queue (priority + confidence sorting) | **BUILD** | P0 | Core of Challenges 01/02 (human handoff). |
| Low-bandwidth / offline mode | **BUILD** | P0 | Core of Challenge 07 and the widow persona. |
| Background jobs & queues | **BUILD** | P0 | Case pipeline runs as jobs anyway; retries when mocks are down. |
| Multi-tenant workspaces | **BUILD** | P0 (data level) / P1 (2nd program) | `tenant_id` from day one is cheap; retrofitting is expensive. Enables per-department consent. |
| Notifications (in-app + simulated SMS) | **BUILD** | P1 | Powers the anti-scam "verification code" mechanism. |
| Rate limiting & error handling | **BUILD** | P1 | Cheap; demonstrates security/reliability. |
| Analytics dashboard per tenant | **BUILD** | P1 | Shares data with the evaluation dashboard. |
| Webhooks | Stretch | P2 | Low judging value relative to effort. |
| Subscription plans & usage limits | **SKIP** | - | No relevance to the public-service story; judges would see it as filler. |

We claim in the README **only** features that actually work at submission time.

### 2.6 AI features (≥ 3 required) - our selection

| AI feature | Decision | Priority | Role in product |
|---|---|---|---|
| Classification & routing ("Jev" pattern) | **BUILD** | P0 | Case router (auto / ask more / human) and scam classifier, each with a confidence score. |
| Guardrails + human approval | **BUILD** | P0 | No auto-rejection ever; risky steps require approval; four-eyes on flagged cases. |
| Explainability | **BUILD** | P0 | Rule-trace-based explanations in Urdu + English, audio playable. |
| Structured outputs | **BUILD** | P0 | Voice/text answers parsed into a validated Pydantic application schema. |
| Voice (Urdu STT/TTS) | **BUILD** | P1 (pre-recorded prompts P0) | Low literacy. Voice is an accelerator, never a single point of failure. |
| Computer vision | **BUILD** | P1 | Mock CNIC/death-certificate verification: blur check, signed-QR verification, OCR-vs-QR comparison. |
| RAG | **BUILD** | P1 | Answers program questions from official (mock) policy documents with citations; says "not sure" below a retrieval threshold. |
| Evaluation dashboard | **BUILD** | P1 | "Show the numbers": threshold sweep, false-alarm rates, latency, cost, overrides. |
| Anomaly detection | **BUILD (rule-based)** | P1 | Shared payout accounts, repeat claims, helper velocity. |
| Memory & context | **BUILD (implicit)** | P0 | Server-side drafts + wizard step + local IndexedDB; progress survives sessions. |
| Autonomous agents + tool calling | **BUILD (deterministic planner)** | P1 | Case-processing agent calls mock identity, civil, household, payment and complaint APIs step by step; every step logged as an agent action. A free-form LLM tool-calling assistant is P2. |

### 2.7 Engineering basics (required)

Postgres with migrations (Alembic) · deployed link · monitoring, logs, basic tests.

### 2.8 Technical challenges (the judges' real scorecard)

All eight are specified as concrete behaviour in [08-responsible-ai-challenges.md](08-responsible-ai-challenges.md). Summary of our answer to each:

| # | Challenge | Our one-line answer |
|---|---|---|
| 01 | Cost of being wrong | Explicit cost matrix → auto-approve only when weakest-link confidence ≥ 0.90; **never auto-reject**; threshold justified by a live threshold sweep on a labelled synthetic set. |
| 02 | Saying "I am not sure" | Enumerated escalation reason codes; handoff creates a case note (verified / uncertain / suggested checks); citizen told plainly; zero silent guessing (no fallback to defaults, unknown is a first-class value). |
| 03 | Bad data | Tri-state facts with provenance; Roman-Urdu/Urdu name canonicalisation + phonetic keys + Jaro-Winkler; never match on name alone; ambiguity → human, never auto-merge. |
| 04 | Rules that change | Rules are versioned JSON data evaluated by a pure engine; publish = new immutable version, used instantly; every decision stores version id + hash; Digital Twin previews impact on past cases. |
| 05 | Explain & audit | Every decision stores input snapshot, facts+sources, rule version, model/prompt versions, confidence components, result; citizen gets a 3-reason Urdu explanation; audit log is append-only and hash-chained. |
| 06 | Consent & take-back | Per-recipient, per-category, per-purpose grants; one server-side enforcement point on every data read; withdrawal blocks the very next request; denied attempts are logged and shown to the citizen. |
| 07 | Works for everyone | Icon + audio-first wizard, one question per screen, tap or speak, readback confirmation, PWA offline outbox with idempotent sync, < 150 KB citizen bundle. |
| 08 | Scams & fake documents | Every official message carries a verifiable code; hybrid rules + calibrated classifier with an explicit "suspicious/cannot tell" band; signed-QR document verification; false-alarm rates displayed honestly; nothing is ever blocked automatically. |

### 2.9 Bonus features - our selection

| Bonus | Decision | Priority | Rationale |
|---|---|---|---|
| **Digital Twin** | BUILD | P1 (high) | Nearly free once the rule engine is a pure function over stored fact snapshots; spectacular demo moment ("this change flips 7 of 60 past cases and costs PKR +84,000"). |
| **Helper Mode** | BUILD | P0/P1 | It *is* persona 3. Required for a coherent story. |
| **Offline-First Sync** | BUILD | P1 | It *is* Challenge 07. Outbox + idempotency keys. |
| Scam Map | Stretch | P2 | Cheap aggregate view on top of scam checks; only after everything else is stable. |

The brief says *"One bonus feature that really works is worth more than four half-finished ones."* We commit to three because each one is a natural consequence of core architecture, not separate work. Scam Map is built only if Phase 3 has slack.

---

## 3. What separates average from winning submissions

**Average submissions will:**
- Build a chatbot wrapper with a nice UI and call it a platform.
- Let the LLM "decide" eligibility and print an LLM-reported confidence number.
- Hard-code rules; "rule editor" edits a number in a config file.
- Have consent as a toggle that changes nothing server-side.
- Show "offline mode" as a banner.
- Claim scam detection accuracy without showing false positives.
- Spread across many public tasks thinly.

**A winning submission will:**
1. **Pick one task and go deep** (brief: "A deep solution for one task beats a thin solution for many").
2. **Separate the LLM from the decision.** *LLM proposes, deterministic policy disposes.* The LLM extracts, transcribes, phrases and retrieves. A versioned, auditable rules engine decides. Confidence is computed from measurable evidence, not self-reported by a model.
3. **Show numbers** for thresholds and false alarms, computed live by the system on a labelled set.
4. **Demonstrate failure behaviour live**: forged document, ambiguous identity, mock service outage, consent withdrawal mid-review, offline submission - each producing a safe, explainable outcome.
5. **Enforce everything server-side** (judging note: "server-side enforcement of access controls and permissions").
6. **Be honest**: what is simulated, where the model is weak, what the false-alarm rate is.

---

## 4. The central use case (problem sentence)

> **We help widowed women in low-income Sindh households claim and safely receive the (fictional) Sahara Widow Support Grant, even though they cannot read the forms, have weak and dropping mobile signal, have records that are misspelled or incomplete across government systems, and are targeted by fake "relief payment" scam messages.**

### Why this task (alternatives evaluated)

| Candidate task | Fit with 3 personas | Exercises all 8 challenges? | Demo clarity | Verdict |
|---|---|---|---|---|
| **Cash-relief grant application → decision → payment** | Widow applies; helper assists 40 families; shopkeeper receives fake *relief payment* messages about this exact program | Yes - money (cost of wrong), documents (forgery), identity (bad data), eligibility rules (change), consent (department + helper), payment (Raast mock) | Very high | **CHOSEN** |
| Complaint filing about a public service | Weak link to scams and payments | Weak on cost-of-wrong & rules | Medium | Rejected (complaints exist only as a sub-flow: "payment not received") |
| Utility bill / subsidy correction | Weak helper story | Weak on documents | Medium | Rejected |
| Generic "document assistant" for many services | Thin | Thin | Low | Rejected - exactly what the brief warns against |

The brief's own vocabulary ("one wrong approval can cost someone their savings", "fake relief payment messages", "40 families") points at a benefit-payment flow. Every one of the three personas meets the same program from a different side, which gives us **one cohesive platform**, not three demos.

### Product identity

- **Name:** **Haqdaar** (حقدار - "the rightful claimant").
- **Tagline (ur):** "ہر حقدار تک، محفوظ طریقے سے" - *To every rightful person, safely.*
- **Fictional program:** *Sahara Widow Support Grant* run by the fictional *Social Protection Department (Mock)* tenant.
- **Second tenant (multi-tenancy proof):** *Zakat & Welfare Board (Mock)* running the *Guzara Allowance* - created **purely by configuration** (P1).
- Never use real agency logos. Mock services are named "Identity Registry (NADRA-like, simulated)", "Instant Payments (Raast-like, simulated)".

---

## 5. Strategic principles (non-negotiable for all agents)

| # | Principle | Consequence in code |
|---|---|---|
| SP-1 | **LLM proposes, policy disposes.** | No LLM output can set a case to APPROVED/REJECTED. Only `engine/router` and officers can. |
| SP-2 | **Never auto-reject.** | Router has no AUTO_REJECT output. Negative outcomes are officer-only. |
| SP-3 | **Unknown is a value, not an error.** | Facts are tri-state; missing data → UNKNOWN → ASK_MORE or HUMAN, never a default. |
| SP-4 | **Every action leaves a trace.** | All writes and AI calls go through `audit.record()` in the same DB transaction. |
| SP-5 | **Server is the only authority.** | RBAC, tenant isolation and consent are enforced in API dependencies; the UI only hides. |
| SP-6 | **Degrade, don't guess.** | External outage → WAITING_EXTERNAL + retry job. AI outage → template fallbacks + tap input. |
| SP-7 | **Voice is an accelerator, icons are the floor.** | Every voice step has a tap alternative that works with zero network for AI. |
| SP-8 | **Demo = production path.** | No hard-coded demo branches. Determinism comes from seed data and the `fake` AI provider fixtures, not from `if demo:`. |
| SP-9 | **Honesty is a feature.** | False-alarm rates, simulated services, and limitations are shown in the product. |

---

## 6. Risk register (product/technical)

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Golden path not integrated by Sat noon | Medium | Fatal | Critical checkpoint C2; vertical-slice-first plan; P1 cut rules ([12-execution-plan.md](12-execution-plan.md)). |
| LLM/API quota or outage during live demo | Medium | High | `AI_PROVIDER=fake` fixture mode, template explanations, tap input path; cached TTS. |
| Venue internet fails on Monday | Medium | High | Local `docker compose` fallback on a laptop + phone hotspot; rehearsed. |
| Urdu STT quality poor | Medium | Medium | Field-scoped parsing, readback confirmation, keypad fallback; demo uses short, clear answers. |
| Agents produce incompatible components | High | High | Frozen contracts (04/05), path ownership, AGENTS.md rules, integration checkpoints every ~6 h. |
| Cold starts on free hosting | Medium | Medium | Railway (no sleep); warm-up request before demo. |
| Over-scoping | High | High | P0/P1/P2 with explicit cut lines and a feature freeze at Sat 22:00. |
| Judges probe security (IDOR, role bypass) | High | High | RBAC matrix tests per endpoint; tenant + consent tests; 404-not-403 for foreign resources. |
| Synthetic-data circularity questioned | Medium | Medium | Noise injection independent of pipeline; candid disclosure in Q&A prep ([15-demo-and-submission.md](15-demo-and-submission.md)). |

---

## 7. Scoring hypothesis → where we invest

Judging notes emphasise: functionality over claims, security & reliability, mandatory live demo, responsible AI behaviour, technical judgment. Investment allocation of build effort:

| Area | Share of effort |
|---|---|
| End-to-end case flow (citizen → pipeline → officer → payment → explanation) | 25 % |
| Decision engine, rules versioning, twin, confidence, entity resolution | 20 % |
| Consent, RBAC, audit chain (security) | 15 % |
| Accessibility: audio/icon wizard, offline outbox, helper mode | 15 % |
| AI services: voice, doc verification, scam classifier, RAG | 15 % |
| Evaluation dashboard, tests, deployment, demo prep | 10 % |
