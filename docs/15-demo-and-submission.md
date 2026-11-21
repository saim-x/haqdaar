# 15 - Live Demo Choreography, Transparency & Submission Guide

> **Status:** FROZEN v1.0.
> **Submission Deadline:** Sunday, 22 Nov 2026, 18:00 PKT.
> **Live Evaluation:** Monday, 23 Nov 2026, FAST-NUCES Karachi Library (mandatory live demonstration).

---

## 1. Real vs Simulated Transparency Table (Mandatory - RULE-5 & RULE-6)

Displayed identically on `/transparency` in the live app and in `README.md`:

| Component | Real or Simulated? | Exact Details |
|---|---|---|
| Auth, JWT, RBAC, Multi-Tenancy, Consent Engine, Audit Hash Chain | **REAL** | Enforced server-side in FastAPI + PostgreSQL 16 (Alembic migrations). |
| Versioned Rules Engine, Tri-State Evaluator, Entity Resolution, Confidence Router, Digital Twin | **REAL** | Pure Python deterministic engine (`app/engine/`) evaluating live DB rules. |
| Offline-First PWA & Idempotent Outbox | **REAL** | Workbox Service Worker + Dexie IndexedDB + server-side `Idempotency-Key` deduplication. |
| Scam Classifier & Official Verification Codes | **REAL** (trained on synthetic data) | Hybrid deterministic rules + calibrated `scikit-learn` TF-IDF/LR model + cryptographic SMS `body_sha256` lookup. |
| Document Verification (Blur, Signed QR, OCR Cross-Check) | **REAL** (on mock specimens) | OpenCV Laplacian blur + `QRCodeDetector` + `HMAC-SHA256` signature + vision OCR comparison. |
| Urdu Voice STT/TTS, RAG Policy Q&A & Optional Video Guide | **REAL** (with `fake` fallback) | Deepgram `nova-3` STT + Deepgram Flux pre-recorded Urdu prompts + OpenAI `gpt-4o-mini` / `text-embedding-3-small` + hybrid Postgres/NumPy retrieval. The optional video guide (Anam.ai WebRTC avatar) runs in **conversational mode** by default: it hears the citizen's spoken Urdu and replies in Urdu, guided only by a system prompt built from the live active rule set with zero citizen PII - it never receives a case, a decision, a CNIC or a phone number, and it never decides anything. In `passthrough` mode it only lip-syncs our own Urdu audio. It runs as a local simulator when `AI_PROVIDER=fake`, and steps down to the audio-only guide in Lite Mode or offline. |
| Identity Registry (NADRA-like) | **SIMULATED** | Mock REST API (`/mock/v1/identity/lookup`) with synthetic `99900-*` CNICs & chaos modes. |
| Civil Death, Household Survey & Benefits Registries | **SIMULATED** | Mock REST APIs (`/mock/v1/civil/*`, `/household/*`, `/benefits/*`) with synthetic data. |
| Instant Payment Rails (Raast-like) & Complaints | **SIMULATED** | Mock REST API (`/mock/v1/payments/*`, `/complaints`) with idempotent transfers & test failure alias. |
| SMS / OTP Delivery | **SIMULATED** | Stored in `notifications` & displayed live in `/staff/device-sim`; no real telecom gateway. |
| Citizens, Cases & Documents | **SYNTHETIC** | 100 % fictional Pakistani personas and watermarked `MOCK SPECIMEN` cards. Zero real personal data. |

---

## 2. Live Judge Demo Script (8 Minutes, 8 Proof Scenes)

**Setup before stepping up:**
- Open 2 browser windows side by side (Left: Mobile-width `390×844` Citizen/Helper PWA; Right: Desktop Staff Console + Device Simulator tab).
- Confirm `POST /api/v1/admin/demo/reset` was run 5 minutes prior (clean state, warmed server).
- Keep local `docker compose` running on laptop port `8000` as instant fallback if library Wi-Fi drops.

| Time | Scene | Persona & Action | Challenges Proven |
|---|---|---|---|
| **0:00 – 0:45** | **0. Framing & Honesty** | Point to persistent **PROTOTYPE** banner & `/transparency` page. State the problem sentence in one breath: *"We help widowed women in Sindh claim the Sahara Grant despite low literacy, weak signal, messy records, and relief scams."* | RULE-5, RULE-6 |
| **0:45 – 2:15** | **1. Widow Applies Offline + Voice + Bad Data** | Login as **Fatima Bibi** (Urdu RTL). Play 🔊 prompt; speak/tap income; tap **"I don't know"** on husband's CNIC; upload `fatima_cnic_blurry.jpg` → immediate spoken `NEEDS_RETAKE` → upload `fatima_cnic_whatsapp_compressed.jpg` → `VERIFIED` (0 % false tamper!). Toggle DevTools **Offline**, submit → queued in Outbox → toggle **Online** → syncs once! Agent resolves `"Mst. Fatima Bibi"` vs `"Fatima Bibi"` → **Auto-Approved PKR 15,000** in seconds → Urdu audio explanation plays → Raast payment SMS with `HQ-XXXXX` arrives in Device Simulator! | Ch 03, 05, 07, 08, Bonus Offline |
| **2:15 – 3:15** | **2. Shopkeeper Catches Scams + Verifies Real Code** | Open `/scam-check` (no login). Paste Fatima's real SMS with `HQ-XXXXX` → 🟢 **Verified Official**. Change one digit of amount in text → 🔴 **Likely Scam (`RF_CODE_MISMATCH`)**. Paste *"Rs 25,000 relief ready, send Rs 500 EasyPaisa fee"* → 🔴 **Likely Scam**. Paste *"Bhai payment bhej dena"* → 🟡 **Cannot Tell** (honest uncertainty). | Ch 02, 08 |
| **3:15 – 4:15** | **3. Forged Document, Uncertainty & Four-Eyes** | Switch right pane to **Officer Sana**'s priority queue. Open `HQ-2026-000101` (`TAMPER_SUSPECTED`: printed name `"Zainab Bibi"` vs signed QR `"Fatima Bibi"`). Show AI Handoff Note (Verified / Uncertain / Suggested Checks) and note citizen only sees calm non-accusatory wording. Sana approves → hits **Four-Eyes (`PENDING_SECOND_APPROVAL`)**; Sana tries 2nd approval → blocked (`403 SAME_OFFICER`); **Officer Imran** completes approval. | Ch 01, 02, 08 |
| **4:15 – 5:15** | **4. Rules That Change + Digital Twin** | Login as **Admin Bilal**. Draft rule v2 for Sahara: lower income cap `40,000 → 35,000`, raise child bonus `1,000 → 1,500`. Click **Simulate (Digital Twin)** → shows X of 60 past cases flipped & exact PKR budget delta! Click **Publish** → no restart, no deploy. Show Fatima's earlier decision STILL records `v1` + hash, while a new evaluation immediately uses `v2` (and RAG Q&A cites `35,000`!). | Ch 04, Bonus Digital Twin |
| **5:15 – 6:15** | **5. Helper Mode + Consent Take-Back** | Left pane: **Helper Ayesha** switches between families in 2 taps (cache wipe + audio/avatar confirmation screen). Switch to **Fatima** → Consent Center → **Withdraw Helper Ayesha's access**. Ayesha refreshes → **Blocked (`403 CONSENT_REVOKED`)**. Back on Fatima's screen → Access Log immediately displays **"Ayesha tried to view your data - Blocked"**. | Ch 06, Bonus Helper Mode |
| **6:15 – 7:00** | **6. Chaos Resilience (Mock Outage)** | **Platform Admin** toggles Identity Registry (Mock) → **`DOWN`**. New submission enters **`WAITING_EXTERNAL`** (never guesses!). Toggle back to `NORMAL` → worker retries automatically and completes. | Ch 02, Resilience |
| **7:00 – 8:00** | **7. Show the Numbers + Tamper-Evident Audit** | Open **Evaluation Dashboard**: show the live Cost-of-Being-Wrong threshold sweep justifying `0.90`, plus honest Scam Hard-Negative FPR and Doc Verifier metrics. Open **Auditor Nadia** → inspect Fatima's full decision trace (input snapshot hash, rule hash, 4-pillar confidence) → click **Verify Hash Chain** → **"Chain Intact: X,XXX events verified"**. Open `/api/docs` Swagger briefly to prove Public REST API. | Ch 01, 05, CORE-4/5 |

---

## 3. Tough Judge Q&A Preparation

| Likely Judge Question | Strong, Honest Engineering Answer |
|---|---|
| *"Why didn't you use an LLM agent to decide eligibility?"* | LLMs produce uncalibrated confidence and cannot guarantee reproducibility when rules change. We separate cognition from policy: **LLM proposes, deterministic rules dispose.** That also lets us run a zero-cost Digital Twin over 60 historical cases in milliseconds and prove exact rule hashes to auditors. |
| *"Aren't your evaluation numbers circular since you generated synthetic data?"* | Great catch - we explicitly disclose this on `/transparency`. To avoid circularity, our noise generator (`eval_cases.jsonl`) injects realistic independent failure modes (spelling drift, survey income gaps, WhatsApp compression, hard-negative benign money texts) separately from the decision logic. In production, this exact sweep runs on real officer-audited historical cases. |
| *"What happens if OpenAI goes down or is too slow in rural Sindh?"* | The decision path does **not** depend on OpenAI at all! Pre-recorded Urdu MP3 prompts are cached offline in the PWA, tap/keypad input works with zero AI, scam detection runs locally via scikit-learn in < 5 ms, document blur & QR checks run locally in OpenCV, and explanations fall back to deterministic rule templates. |
| *"What if a helper abuses witnessed verbal consent?"* | Witnessed verbal consent records an audio clip AND assigns `consent_assurance = 0.82`, which is intentionally below the `0.90` auto-approve threshold - so verbal-consent applications **always** require officer review before any money moves. |
| *"How do you prove tenant isolation and RBAC aren't just UI hiding?"* | Every endpoint enforces JWT role dependencies, derives `tenant_id` solely from the token (never client input), returns `404` for cross-tenant IDs (no existence leak), and is verified by our automated RBAC/tenancy security test suite (`tests/security/`). |
| *"What are your biggest limitations right now?"* | 1) Urdu-only voice (Sindhi/Pashto would be next - architecture is locale-keyed). 2) Mock QR signing assumes issuer-signed documents; real NADRA integration would use official Verifiable Credentials / PKI. 3) Rate limiting is in-memory (single instance; Redis needed for multi-replica scale). |

---

## 4. Submission Checklist (Due Sun 22 Nov 2026, 18:00 PKT)

- [ ] **Live Deployed URL** (Railway HTTPS) verified working + `/api/docs` Swagger reachable + `/health` green.
- [ ] **GitHub Repository Link** (public, clean commit history strictly inside hackathon window, zero secrets committed, `.env.example` present).
- [ ] **`README.md`** containing: problem sentence, live link, Swagger link, video link, architecture diagram, Real vs Simulated table, seeded demo credentials, local `docker compose up` instructions, and `pytest` verification steps.
- [ ] **Demo Video (4–5 min)** uploaded to **Public Google Drive** (verified accessible in an Incognito browser window without login!).
- [ ] **Optional Slides (6 slides max):** Problem & 3 Personas · Architecture (LLM Proposes, Policy Disposes) · Cost-of-Being-Wrong Numbers · Responsible AI Highlights · Real vs Simulated & Limitations · Live Demo Pointer.
- [ ] **Local Fallback Tested:** `docker compose up` verified on presentation laptop with `AI_PROVIDER=fake` and `live` both tested.
