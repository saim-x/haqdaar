# 10 — Simulated DPI Services, Chaos Controls & Synthetic Seed Data

> **Status:** FROZEN v1.0. Source of truth for `backend/app/mocks/` and `backend/app/data/`.
> **Owner:** A3.
> **Hard Compliance Rule (RULE-3 & RULE-4):** Zero real personal data. Every synthetic CNIC MUST use the reserved fictional prefix **`99900`** (e.g., `99900-1000001-2`), which does not correspond to any NADRA geographic division. Every generated document image MUST carry a visible **"MOCK SPECIMEN — NOT AN OFFICIAL DOCUMENT"** watermark.

---

## 1. Simulated DPI Services (`/mock/v1/*`)

Mounted as an isolated FastAPI router (`app/mocks/router.py`). Called by `app/agent/` strictly via HTTP (`httpx` → `MOCK_BASE_URL`).

### 1.1 Universal Response Envelope & Chaos Middleware
Every `/mock/v1/*` endpoint passes through `mock_chaos_middleware(service_name)`:
1. Reads `mock_service_configs` for `service_name` (`identity`, `civil`, `household`, `benefits`, `payment`, `complaint`, `sms`).
2. Applies mode:
   - `NORMAL`: 30–80 ms jitter, 0 % error.
   - `SLOW`: sleeps `latency_ms` (default 4,000 ms), 0 % error.
   - `FLAKY`: sleeps `latency_ms`, fails with HTTP `503` at probability `failure_rate` (default `0.50`).
   - `DOWN`: immediately returns HTTP `503 {"simulated": true, "service": "...", "error": "MOCK_SERVICE_DOWN"}`.
3. Every `200/201` response includes `"simulated": true` and `"service_mode": "<MODE>"`.

### 1.2 Mock Endpoint Specifications

#### A. Identity Registry (NADRA-like, simulated) — `GET /mock/v1/identity/lookup`
- Query params: `cnic` (13 digits) OR `name` + `district` (+ optional `dob`).
- Response:
```json
{
  "simulated": true,
  "service": "identity",
  "matches": [
    {
      "cnic_digits": "9990010000012",
      "full_name": "Mst. Fatima Bibi",
      "full_name_ur": "مسماۃ فاطمہ بی بی",
      "father_or_spouse_name": "Ghulam Rasool",
      "dob": "1974-05-14",
      "gender": "F",
      "district": "Thatta",
      "is_alive": true,
      "cnic_expiry_date": "2030-08-01",
      "marital_status": "WIDOWED"
    }
  ]
}
```
- When queried by `name` + `district` without `cnic`, performs broad case-insensitive substring/token match so duplicate candidates (Challenge 03) are returned for `engine/entity_resolution` to disambiguate or flag as ambiguous.

#### B. Civil Death Registry (simulated) — `GET /mock/v1/civil/death-records`
- Query params: `spouse_cnic` OR `deceased_cnic` OR (`deceased_name` + `district`).
- Response: `{ "simulated": true, "service": "civil", "records": [{ "deceased_cnic", "deceased_name", "spouse_cnic", "spouse_name", "death_date", "district", "certificate_no" }] }`.

#### C. Household Socio-Economic Survey (BISP/NSER-like, simulated) — `GET /mock/v1/household/survey`
- Query params: `cnic`.
- Response: `{ "simulated": true, "service": "household", "found": true, "record": { "head_cnic", "district", "household_size": 4, "monthly_income_pkr": 28000, "poverty_score": 24, "survey_year": 2025 } }`.

#### D. Benefits Registry (Cross-Program Check, simulated) — `GET /mock/v1/benefits/active`
- Query params: `cnic`.
- Response: `{ "simulated": true, "service": "benefits", "active_benefits": [{ "program_name", "monthly_amount_pkr", "started_at" }] }`.

#### E. Instant Payment Service (Raast-like, simulated) — `POST /mock/v1/payments/transfer` & `GET /mock/v1/payments/{payment_ref}`
- Header: `Idempotency-Key` (required — set to `payments.id`).
- Request: `{ "payout_alias": "+923001000001", "amount_pkr": 15000, "reference_code": "HQ-2026-000142" }`.
- Behavior: If `Idempotency-Key` already exists in `mock_payments`, returns the exact prior result (idempotent!). Also supports `GET /mock/v1/payments/account-title?alias=+923001000001` returning `{ "simulated": true, "account_title": "FATIMA BIBI" }` for `PAYOUT_NAME_MISMATCH` checks.
- Special test alias `+923009999999` simulates a deterministic Raast transfer failure (`status: "FAILED"`, `failure_reason: "ACCOUNT_DORMANT"`) so Journey J-9 ("Money not received" complaint) is reliably demonstrable.

#### F. Public Complaint Registry (simulated) — `POST /mock/v1/complaints`
- Request: `{ "payment_ref", "citizen_cnic", "reason" }`.
- Response: `{ "simulated": true, "complaint_ref": "CMP-2026-00412", "status": "REGISTERED" }`.

#### G. Simulated SMS Inbox — `GET /mock/v1/sms/inbox/{phone}`
- Returns all `notifications` (with `channel='SMS_SIMULATED'`) and OTP messages sent to `phone`, ordered newest-first, including `verification_code` and `body_ur`/`body_en`.
- Powers the **Device Simulator** panel (`/staff/device-sim`) so judges can watch OTPs and official payment SMS arrive live and copy them into the Scam Checker!

---

## 2. Seeded Demo Personas & Accounts (`app/mocks/seed.py`)

Deterministic seed (`seed.py --reset` and `POST /api/v1/admin/demo/reset` with fixed RNG seed `20261120`):

| Persona Key | Role | Tenant | Credentials (Demo) | Synthetic CNIC | Story Role |
|---|---|---|---|---|---|
| `widow_fatima` | `CITIZEN` | — | Phone `+923001000001` (OTP) | `9990010000012` | Clean widow in Thatta (3 children, income 28k, spelling variant `"Mst. Fatima Bibi"` in registry vs `"Fatima Bibi"` on card) — **Auto-Approve golden path** |
| `shopkeeper_rasool` | `CITIZEN` | — | Phone `+923001000002` (OTP) | `9990010000021` | Kiryana shopkeeper in Hyderabad — **Scam checker demo** |
| `helper_ayesha` | `HELPER` | — | `ayesha@helper.mock` / `Demo@2026` | `9990010000032` | Community helper with 8 pre-linked families (incl. Fatima + 7 Thatta families; UI shows scalable list) — **Helper Mode + Consent withdrawal demo** |
| `officer_sana` | `OFFICER` | `SPD` | `sana@spd.mock` / `Demo@2026` | — | Social Protection Dept case officer |
| `officer_imran` | `OFFICER` | `SPD` | `imran@spd.mock` / `Demo@2026` | — | Second officer for four-eyes approval |
| `admin_bilal` | `ADMIN` | `SPD` | `bilal@spd.mock` / `Demo@2026` | — | Tenant admin — Rule Editor & Digital Twin |
| `admin_platform` | `ADMIN` | `null` | `platform@haqdaar.mock` / `Demo@2026` | — | Platform admin — Mock chaos controls & demo reset |
| `auditor_nadia` | `AUDITOR` | `null` | `nadia@audit.mock` / `Demo@2026` | — | Read-only auditor — Traces & chain verify |
| `officer_zakat` | `OFFICER` | `ZWB` | `tariq@zwb.mock` / `Demo@2026` | — | Zakat & Welfare Board officer — Multi-tenant isolation proof |

### Seeded Programs (Config-Driven Multi-Tenancy Proof)
1. **`SAHARA_WIDOW_GRANT`** (Tenant `SPD`): Active Rule `v1` (income ≤ 40,000, Sindh districts, base 12,000 + 1,000/child, cap 20,000, threshold 0.90).
2. **`GUZARA_ALLOWANCE`** (Tenant `ZWB`): Active Rule `v1` (poverty_score ≤ 30, income ≤ 30,000, base 8,000 + 500/child, cap 12,000, threshold 0.90) — **zero program-specific Python code!**

### Pre-Seeded Historical & Queue Cases (For Immediate Demo Richness)
Seed script populates **60 historical decided cases** for `SAHARA_WIDOW_GRANT` (spread across incomes 15k–45k and children 0–5, with realistic `input_snapshot_json`) so **Digital Twin simulation immediately shows realistic outcome flips (e.g., 8–12 cases flipping when income cap drops 40k → 35k)** plus **6 live cases waiting in Officer Sana's queue** illustrating every technical challenge:
1. `HQ-2026-000101` — `HUMAN_REVIEW` (`URGENT`): `TAMPER_SUSPECTED` (forged CNIC name vs signed QR) → demonstrates four-eyes & non-accusatory citizen view.
2. `HQ-2026-000102` — `HUMAN_REVIEW` (`HIGH`): `DATA_CONFLICT_INCOME` (self-declared 24k vs survey 54k).
3. `HQ-2026-000103` — `HUMAN_REVIEW` (`HIGH`): `POSSIBLE_DUPLICATE_IDENTITY` (two `"Muhammad Akram"` / `"Mohammad Akram"` records without CNIC).
4. `HQ-2026-000104` — `HUMAN_REVIEW` (`HIGH`): `PAYOUT_ACCOUNT_SHARED` (3 unrelated applicants using same payout alias).
5. `HQ-2026-000105` — `HUMAN_REVIEW` (`NORMAL`): `LOW_ASSURANCE_CONSENT` (helper verbal consent, confidence `0.82 < 0.90`).
6. `HQ-2026-000106` — `PAYMENT_FAILED` (`HIGH`): Payment failed on dormant account — ready for J-9 complaint demo.
Plus 10 historical cases in `ZWB` (`GUZARA_ALLOWANCE`) to prove tenant analytics & isolation.

---

## 3. Synthetic Document & QR Image Generator (`app/mocks/doc_generator.py`)

Generates realistic PNG/JPEG mock CNIC and Death Certificate specimen cards using `Pillow` + `qrcode`, saved to `backend/app/data/demo_docs/` (so judges/presenters have ready-to-upload test files AND `doc_eval_set/` has 30 benchmark images):

1. **QR Payload Format:**
   ```json
   {
     "doc_type": "CNIC_FRONT",
     "cnic": "9990010000012",
     "full_name": "Fatima Bibi",
     "dob": "1974-05-14",
     "issuer": "MOCK_IDENTITY_REGISTRY",
     "sig": "<hex HMAC-SHA256 of canonical fields using QR_HMAC_SECRET>"
   }
   ```
2. **Generated Demo Upload Pack (`backend/app/data/demo_docs/`):**
   - `fatima_cnic_genuine.jpg` — Clean mock CNIC for Fatima Bibi → `VERIFIED`
   - `fatima_cnic_whatsapp_compressed.jpg` — Same card rotated 3° + JPEG quality 45 + mild noise → still `VERIFIED` (proves low false-tamper rate!)
   - `fatima_cnic_blurry.jpg` — Gaussian blur applied → `NEEDS_RETAKE`
   - `fatima_cnic_forged_name.jpg` — Valid signed QR for Fatima Bibi, but printed name altered to `"Zainab Bibi"` → `TAMPER_SUSPECTED`
   - `fatima_cnic_no_qr.jpg` — QR obscured → `UNVERIFIABLE` (NOT tamper!)
   - `ghulam_rasool_death_cert_genuine.jpg` — Genuine mock death certificate → `VERIFIED`
   - `scam_sms_screenshot.jpg` — Mock WhatsApp/SMS screenshot of a fake Rs 25,000 relief scam → `LIKELY_SCAM`

---

## 4. Labelled Evaluation Datasets (Owned by A3 & A4)

1. **`backend/app/data/eval_cases.jsonl` (133 synthetic cases in 19 designed cohorts, incl. a clean-looking-but-ineligible population with hidden ground truth):** Ground-truth `truly_eligible: bool` + realistic noise injected *independently* of the rules engine (misspelled names, missing fields, conflicting survey data, forged docs, verbal consent, subtle fraud) → feeds `engine/eval_sweep.py` for the live cost-of-being-wrong curve.
2. **`backend/app/data/scam_dataset.jsonl` (240 synthetic messages):** Labelled `SCAM` vs `SAFE` across Roman-Urdu, Urdu, and English, including 35 hard negatives (real bank/family money messages) → trains/evaluates the scikit-learn scam model and computes honest FPR.
3. **`backend/app/data/doc_eval_set/` (30 synthetic images + `manifest.json`):** Ground-truth labels (`GENUINE_CLEAN`, `GENUINE_COMPRESSED`, `BLURRY`, `FORGED`) → computes real document verifier metrics for the Evaluation Dashboard.
