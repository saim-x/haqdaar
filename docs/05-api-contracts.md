# 05 — API Architecture & Endpoint Contracts

> **Status:** FROZEN v1.0. Source of truth for all HTTP endpoints, payloads, headers, error codes, and OpenAPI docs.
> **Base URL:** `/api/v1` (App API) · `/mock/v1` (Simulated DPI APIs) · `/api/docs` (Swagger UI) · `/api/openapi.json`

---

## 1. API Conventions

- **Content-Type:** `application/json` (except file/audio uploads: `multipart/form-data`, file downloads: binary stream).
- **Timestamps:** ISO-8601 UTC (`2026-11-21T10:15:00Z`).
- **Authentication:**
  - User endpoints: `Authorization: Bearer <access_jwt>`
  - Helper acting for a citizen: `Authorization: Bearer <helper_jwt>` + `X-Act-For-Citizen: <citizen_uuid>` (verified on server against active `HELPER` consent grant!).
  - Public API (`/api/v1/public/*`): `X-API-Key: <api_key>`.
- **Idempotency (Offline Sync):** All mutating Citizen/Helper endpoints (`POST /cases`, `PATCH /cases/{id}/draft`, `POST /cases/{id}/submit`, `POST /documents`, `POST /cases/{id}/complaint`, `POST /consent/grants`) support `Idempotency-Key: <uuid>`. Replays return the exact cached HTTP status and body.
- **ETag Support:** `GET /cases/{id}` and `GET /cases` return weak `ETag` headers and honour `If-None-Match` → `304 Not Modified` to minimise bandwidth on slow connections.
- **Pagination:** Query params `limit` (default 20, max 100) and `offset` (default 0). Envelope:
  ```json
  { "items": [...], "total": 42, "limit": 20, "offset": 0 }
  ```

---

## 2. Uniform Error Envelope & Standard Error Codes

Every 4xx/5xx error returns:
```json
{
  "error": {
    "code": "CONSENT_REVOKED",
    "message_en": "Access blocked because the citizen withdrew consent for this data category.",
    "message_ur": "شہری نے اس ڈیٹا تک رسائی کی اجازت واپس لے لی ہے۔",
    "request_id": "req_9f2a4c...",
    "details": { "category": "DOCUMENTS" }
  }
}
```

| HTTP | Error Code | When Returned |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Schema/field validation failure (`details.fields`) |
| 401 | `UNAUTHORIZED` | Missing/expired/invalid JWT or revoked API key |
| 401 | `INVALID_OTP` | Wrong or expired OTP |
| 403 | `FORBIDDEN` | Role lacks permission for endpoint |
| 403 | `CONSENT_REVOKED` | Citizen never granted, expired, or withdrew consent |
| 403 | `SAME_OFFICER` | Same officer attempted second approval on four-eyes case |
| 404 | `NOT_FOUND` | Missing resource OR resource belongs to another tenant/citizen (prevents existence leak) |
| 409 | `INVALID_TRANSITION` | Illegal case state transition (e.g., AI rejecting, approving closed case) |
| 409 | `IDEMPOTENCY_CONFLICT` | Same `Idempotency-Key` reused with a different request body |
| 409 | `RULE_VERSION_IMMUTABLE` | Attempt to edit a published rule version |
| 413 | `FILE_TOO_LARGE` | Upload exceeds 2 MB (images) or 5 MB (audio) |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | Non-JPEG/PNG/WebP image or non-WebM/MP3/WAV audio |
| 422 | `RULE_VALIDATION_FAILED` | Rule draft failed DSL validation (`details.errors`) |
| 429 | `RATE_LIMITED` | Exceeded rate limit (`Retry-After` header set) |
| 503 | `SERVICE_UNAVAILABLE` | External/mock or AI service unavailable when synchronous call required |

---

## 3. Endpoint Catalogue

### 3.1 Authentication (`/api/v1/auth`) — Owner: A1

| Method | Path | Roles | Request | Response (200/201) |
|---|---|---|---|---|
| `POST` | `/auth/otp/request` | Public | `{ "phone": "+923001234567", "purpose": "LOGIN" }` | `{ "challenge_id": "uuid", "expires_in_sec": 300, "simulated_sms_hint": "Check Device Simulator inbox" }` |
| `POST` | `/auth/otp/verify` | Public | `{ "challenge_id": "uuid", "code": "123456" }` | `{ "access_token", "refresh_token", "user": {...}, "citizen_id": "uuid" }` |
| `POST` | `/auth/login` | Public | `{ "email": "sana@spd.mock", "password": "..." }` | `{ "access_token", "refresh_token", "user": {...} }` |
| `POST` | `/auth/demo-login` | Public (`DEMO_MODE=true`) | `{ "persona_key": "widow_fatima" \| "shopkeeper_rasool" \| "helper_ayesha" \| "officer_sana" \| "officer_imran" \| "admin_bilal" \| "admin_platform" \| "auditor_nadia" \| "officer_zakat" }` | Same token payload as `/auth/login` |
| `POST` | `/auth/refresh` | Public | `{ "refresh_token": "..." }` | `{ "access_token", "refresh_token" }` |
| `POST` | `/auth/logout` | Any auth | `{ "refresh_token": "..." }` | `{ "ok": true }` |
| `GET` | `/auth/me` | Any auth | — | `{ "user": {...}, "citizen": {...} \| null, "tenant": {...} \| null }` |

---

### 3.2 Programs & Citizen/Helper Cases (`/api/v1/programs`, `/api/v1/cases`) — Owner: A1

| Method | Path | Roles | Consent Required | Summary |
|---|---|---|---|---|
| `GET` | `/programs` | Any auth | None | List active programs with localized names, required docs, wizard schema |
| `POST` | `/cases` | CITIZEN, HELPER | `BENEFIT_APPLICATION` (for dept) + `HELPER_ASSISTANCE` (if helper) | Create `DRAFT` case (`{ "program_id", "case_type": "BENEFIT_APPLICATION" }`). Idempotent. |
| `GET` | `/cases` | CITIZEN, HELPER | `CASE_HISTORY` (if helper) | List cases for current citizen (or `X-Act-For-Citizen`) with ETag |
| `GET` | `/cases/{case_id}` | CITIZEN, HELPER, OFFICER, AUDITOR | `CASE_HISTORY` (enforced server-side) | Full case view tailored to role (citizen gets simplified timeline + explanation; officer/auditor gets full facts, trace, flags, notes) |
| `PATCH` | `/cases/{case_id}/draft` | CITIZEN, HELPER | `BENEFIT_APPLICATION` | Save wizard step & answers (`{ "wizard_step", "answers": { "<fact_key>": { "value", "confirmed", "missing_reason" } } }`). Idempotent. |
| `POST` | `/cases/{case_id}/submit` | CITIZEN, HELPER | `BENEFIT_APPLICATION` + `IDENTITY` + `HOUSEHOLD` | Validates required confirmed fields & docs, transitions `DRAFT`/`NEEDS_INFO` → `SUBMITTED`, enqueues `PROCESS_CASE` job. Idempotent. |
| `POST` | `/cases/{case_id}/withdraw` | CITIZEN, HELPER | `BENEFIT_APPLICATION` | Withdraws draft/open case (`DRAFT`/`NEEDS_INFO`/`ON_HOLD_CONSENT` → `WITHDRAWN`) |
| `POST` | `/cases/{case_id}/complaint` | CITIZEN, HELPER | `COMPLAINT_RESOLUTION` | Files "Money not received" `COMPLAINT` linked to an `APPROVED`/`PAID`/`PAYMENT_FAILED` case; enqueues `CHECK_COMPLAINT` job |

**Example `GET /api/v1/cases/{id}` (Citizen view):**
```json
{
  "id": "uuid",
  "reference_code": "HQ-2026-000142",
  "program": { "code": "SAHARA_WIDOW_GRANT", "name": "Sahara Widow Support Grant", "name_ur": "سہارا بیوہ امدادی گرانٹ" },
  "status": "APPROVED",
  "approved_amount_pkr": 15000,
  "wizard_step": "review",
  "draft_answers": { "...": "..." },
  "documents": [{ "id": "uuid", "doc_type": "CNIC_FRONT", "verify_status": "VERIFIED" }],
  "citizen_explanation": {
    "headline_ur": "آپ کی درخواست منظور ہو گئی ہے۔ 15,000 روپے بھیجے جا رہے ہیں۔",
    "headline_en": "Your application is approved. PKR 15,000 is being sent.",
    "reasons_ur": ["آپ کا شناختی کارڈ اور بیوہ ہونے کی تصدیق ہو گئی۔", "گھریلو آمدنی حد کے اندر ہے (28,000 روپے)۔", "3 بچوں کے ساتھ کل رقم 15,000 روپے بنتی ہے۔"],
    "reasons_en": ["Your CNIC and widow status were verified.", "Household income is within the limit (PKR 28,000).", "With 3 children, your total grant is PKR 15,000."],
    "next_step_ur": "رقم آپ کے راسط نمبر پر بھیجی جائے گی اور تصدیقی کوڈ کے ساتھ پیغام ملے گا۔",
    "next_step_en": "Payment will be sent to your Raast number with a verification code SMS."
  },
  "payment": { "status": "COMPLETED", "amount_pkr": 15000, "external_ref": "RAAST-99102" },
  "timeline": [{ "at": "2026-11-21T10:15:02Z", "label_ur": "...", "label_en": "..." }]
}
```

---

### 3.3 Documents (`/api/v1/documents`) — Owner: A1 (CRUD/storage) + A4 (verification)

| Method | Path | Roles | Summary |
|---|---|---|---|
| `POST` | `/documents` | CITIZEN, HELPER | `multipart/form-data`: `file`, `doc_type`, `case_id` (optional). Stores compressed file, runs synchronous fast verification (blur + QR + OCR, ≤ 4 s) or enqueues if slow, returns verification status + retake instructions. Idempotent. |
| `GET` | `/documents/{doc_id}` | CITIZEN, HELPER, OFFICER, AUDITOR | Metadata + verification checks (enforces `DOCUMENTS` consent) |
| `GET` | `/documents/{doc_id}/file` | CITIZEN, HELPER, OFFICER, AUDITOR | Streams raw image bytes (enforces `DOCUMENTS` consent + logs access) |

---

### 3.4 Consent & My Data (`/api/v1/consent`, `/api/v1/me`) — Owner: A1

| Method | Path | Roles | Summary |
|---|---|---|---|
| `GET` | `/consent/grants` | CITIZEN, HELPER (only own grant) | List all grants (active, withdrawn, expired) for the citizen |
| `POST` | `/consent/grants` | CITIZEN, HELPER (with OTP or verbal proof) | Grant new consent (`recipient_type`, `recipient_tenant_id` / `recipient_user_id`, `categories`, `purposes`, `assurance_level`, `otp_challenge_id` or `verbal_audio_id`). Resumes `ON_HOLD_CONSENT` cases if dept consent re-granted. |
| `PATCH` | `/consent/grants/{grant_id}` | CITIZEN | Modify categories/purposes |
| `POST` | `/consent/grants/{grant_id}/withdraw` | CITIZEN | Immediately sets `status = 'WITHDRAWN'`. If `DEPARTMENT` grant withdrawn and open cases exist, requires `{ "confirm_case_hold": true }` and moves open cases in that tenant to `ON_HOLD_CONSENT`. |
| `GET` | `/consent/access-logs` | CITIZEN, AUDITOR | Paginated list of **allowed and denied** data accesses on this citizen |
| `GET` | `/me/data` | CITIZEN, HELPER (with consent) | Grouped view of all stored citizen data + provenance badges |
| `POST` | `/me/corrections` | CITIZEN, HELPER | Request correction `{ "field_key", "requested_value", "reason" }`. Self-declared applied immediately; registry-sourced queued for officer. |
| `GET` | `/me/notifications` | CITIZEN, HELPER | In-app notifications with verification codes |

---

### 3.5 Helper Mode (`/api/v1/helper`) — Owner: A1

| Method | Path | Roles | Summary |
|---|---|---|---|
| `GET` | `/helper/families` | HELPER | List citizens who have an active (or recently expired, shown as locked) `HELPER` grant for this helper; includes avatar color, masked CNIC, active case count, consent expiry |
| `POST` | `/helper/families` | HELPER | Onboard a new citizen profile (`full_name`, `phone`, `district`, `cnic_digits` optional) + initiate consent capture (`OTP` or `VERBAL_WITNESSED` audio upload) |
| `POST` | `/helper/families/{citizen_id}/consent-otp` | HELPER | Triggers simulated SMS OTP to the citizen's phone to authorize helper consent |
| `POST` | `/helper/families/{citizen_id}/consent-verify` | HELPER | Verifies OTP (or accepts verbal audio attestation) → creates active `HELPER` grant |

---

### 3.6 Officer Queue & Case Review (`/api/v1/officer`) — Owner: A1 (endpoints) + A2 (re-eval)

| Method | Path | Roles | Summary |
|---|---|---|---|
| `GET` | `/officer/queue` | OFFICER (tenant-scoped) | Params: `sort=priority\|confidence_asc\|oldest`, `status`, `flag`, `assigned=me\|unassigned\|all`, `limit`, `offset`. Returns queue cards (masked CNIC, priority band, confidence, reason codes, rule staleness badge). |
| `POST` | `/officer/cases/{case_id}/assign` | OFFICER | Assigns case to current officer (`HUMAN_REVIEW` → `IN_REVIEW`) |
| `POST` | `/officer/cases/{case_id}/decide` | OFFICER | `{ "action": "APPROVE" \| "REJECT" \| "REQUEST_INFO" \| "ESCALATE", "reason_codes": [...], "note": "...", "requested_fields": [...], "override_amount_pkr": null }`. Enforces four-eyes (`PENDING_SECOND_APPROVAL` if HIGH flag & first approval; `403 SAME_OFFICER` if same officer tries 2nd approval). Enforces active dept consent! |
| `POST` | `/officer/cases/{case_id}/reevaluate` | OFFICER | Re-runs `PROCESS_CASE` using current active rule version (for stale-rule banner) |
| `POST` | `/officer/cases/{case_id}/notes` | OFFICER | Adds internal or citizen-visible note |
| `GET` | `/officer/corrections` | OFFICER | List pending registry data correction requests |
| `POST` | `/officer/corrections/{id}/resolve` | OFFICER | Approve/reject correction request with note |

---

### 3.7 Admin: Rules, Digital Twin, Users, API Keys, Mocks, Jobs (`/api/v1/admin`) — Owners: A1, A2, A3

| Method | Path | Roles | Scope | Summary |
|---|---|---|---|---|
| `GET` | `/admin/programs/{program_id}/rules` | ADMIN, AUDITOR | Tenant | List all rule versions (draft, published, archived) with hashes & change notes |
| `POST` | `/admin/programs/{program_id}/rules` | ADMIN | Tenant | Create new `DRAFT` (cloned from active or custom `rules_json`) |
| `PUT` | `/admin/rules/{rule_version_id}` | ADMIN | Tenant | Update a `DRAFT` rule version (`409` if published) |
| `POST` | `/admin/rules/{rule_version_id}/validate` | ADMIN | Tenant | Validate DSL syntax, fact keys, types, bilingual explanations |
| `POST` | `/admin/rules/{rule_version_id}/simulate` | ADMIN | Tenant | **Digital Twin:** Replay last `sample_size` (default 200) historical decided cases; returns transition matrix, flipped cases, budget delta PKR |
| `POST` | `/admin/rules/{rule_version_id}/publish` | ADMIN | Tenant | `{ "change_note": "..." }` → validates, marks `PUBLISHED`, updates `programs.active_rule_version_id`, triggers `REINDEX_RAG` job |
| `GET/POST/PATCH` | `/admin/users` | ADMIN | Tenant (or Platform) | Manage staff/helper accounts, roles, `is_active` |
| `GET/POST/DELETE` | `/admin/api-keys` | ADMIN | Tenant | Create key (returns plaintext `api_key` **once**), list metadata, revoke (`is_active=false`) |
| `GET/PATCH` | `/admin/mocks` | Platform ADMIN | Platform | View/update mock service chaos modes (`NORMAL`/`SLOW`/`FLAKY`/`DOWN`, `latency_ms`, `failure_rate`) |
| `GET` | `/admin/jobs` | ADMIN | Platform/Tenant | Inspect queue (`PENDING`/`RUNNING`/`FAILED_RETRY`/`DEAD`) |
| `POST` | `/admin/jobs/{job_id}/retry` | ADMIN | Platform/Tenant | Re-queue a `DEAD` job |
| `POST` | `/admin/demo/reset` | Platform ADMIN (`DEMO_MODE=true`) | Platform | Resets DB + mock state + re-seeds synthetic demo personas and historical cases |

---

### 3.8 Auditor Console (`/api/v1/auditor`) — Owner: A1 (Strict Read-Only)

| Method | Path | Roles | Summary |
|---|---|---|---|
| `GET` | `/auditor/events` | AUDITOR | Filterable audit log (`case_id`, `actor_type`, `action`, `tenant_id`, `from`, `to`) |
| `GET` | `/auditor/cases/{case_id}/trace` | AUDITOR | Complete decision trace(s): input snapshot + hash, facts + sources, rule version + hash, model/prompt versions, confidence breakdown, route, result, agent steps |
| `GET` | `/auditor/consents` | AUDITOR | Consent grant history + access logs (allowed & denied) |
| `GET` | `/auditor/verify-chain` | AUDITOR | Recomputes SHA-256 hash chain across all `audit_events`; returns `{ "valid": true, "checked_count": 4213, "first_broken_seq": null }` |

---

### 3.9 AI Endpoints: Voice, Scam Checker, RAG, Evaluation (`/api/v1/*`) — Owners: A4, A2

| Method | Path | Roles | Summary |
|---|---|---|---|
| `POST` | `/voice/transcribe-parse` | CITIZEN, HELPER | `multipart/form-data`: `audio`, `field_key` (e.g. `monthly_income_pkr`), `lang=ur`. Returns `{ "transcript", "parsed_value", "confidence", "readback_ur", "readback_en", "needs_retry" }` |
| `POST` | `/voice/tts` | Any auth | `{ "text": "...", "lang": "ur" }` → streams/returns cached MP3 URL for dynamic explanations |
| `POST` | `/scam/check` | Public or Any auth | JSON `{ "text", "district" }` or multipart (`image` / `audio`). Returns `{ "check_id", "verdict", "confidence", "red_flags", "matched_official": {...} \| null, "explanation_ur", "explanation_en", "advice_ur", "advice_en" }` |
| `POST` | `/scam/{check_id}/feedback` | Public or Any auth | `{ "disputed": true, "note": "This was real" }` — logs false-alarm feedback |
| `POST` | `/rag/ask` | Any auth | `{ "question": "...", "program_id": "uuid" \| null, "lang": "ur" \| "en" }`. Returns `{ "status": "ANSWERED" \| "NOT_SURE", "answer", "citations": [{ "doc_title", "section", "version", "excerpt", "score" }], "top_score" }` |
| `GET` | `/eval/dashboard` | ADMIN, AUDITOR, OFFICER | Returns threshold sweep curve, scam confusion matrix + FPR, doc verifier metrics + false tamper rate, live decision breakdown, officer override rate, p50/p95 latency, LLM calls/cost/failures |
| `GET` | `/analytics/tenant` | ADMIN, OFFICER, AUDITOR | Per-tenant counts: cases by status, avg time-to-decision, auto-approve %, disbursed PKR, top flags |
| `GET` | `/transparency` | Public | Machine-readable list of real vs simulated subsystems + current mock statuses |

---

### 3.10 Public REST API (`/api/v1/public`) — Owner: A1 (`X-API-Key` Required)

Documented with rich examples in Swagger (`/api/docs`):
- `GET /api/v1/public/programs` (scope `rules:read`): Active programs & current published rule summary (no PII).
- `GET /api/v1/public/cases/{reference_code}/status` (scope `cases:read`): Status & non-PII milestone summary (tenant-scoped to the API key's tenant).
- `POST /api/v1/public/scam/check` (scope `scam:check`): External partner access to scam & official-message verification.
- `GET /api/v1/public/verify-message/{verification_code}` (scope `scam:check`): Verify an official Haqdaar notification code.

---

### 3.11 Simulated DPI Services (`/mock/v1/*`) — Owner: A3

Every response includes `"simulated": true` and `"service_mode": "NORMAL|SLOW|FLAKY"`. Full specs in [10-mock-services-and-seed-data.md](10-mock-services-and-seed-data.md):
- `GET /mock/v1/identity/lookup` (`cnic` or `name` + `district` + `dob`)
- `GET /mock/v1/civil/death-records` (`spouse_cnic` or `deceased_cnic` or `name` + `district`)
- `GET /mock/v1/household/survey` (`cnic`)
- `GET /mock/v1/benefits/active` (`cnic`)
- `POST /mock/v1/payments/transfer` (`Idempotency-Key`, `payout_alias`, `amount_pkr`, `reference_code`)
- `GET /mock/v1/payments/{payment_ref}`
- `POST /mock/v1/complaints` (`payment_ref`, `citizen_cnic`, `reason`)
- `GET /mock/v1/sms/inbox/{phone}` (Used by the Demo Device Simulator UI to display OTPs & official notifications!)
