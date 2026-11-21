# 09 - Security, RBAC, Multi-Tenancy, Consent & Audit Chain

> **Status:** FROZEN v1.0. Source of truth for `backend/app/security/`.
> **Owner:** A1.
> **Judging Note:** *"Implementations must demonstrate appropriate security measures, including server-side enforcement of access controls and permissions."*

---

## 1. Authentication Architecture

### 1.1 Flows
- **Citizens (Phone + OTP):**
  1. `POST /api/v1/auth/otp/request` generates a cryptographically random 6-digit code (`secrets.randbelow(1_000_000)`), stores `SHA-256(code + salt)` in `otp_challenges` (TTL 5 min, max 5 attempts), and delivers the OTP to the **Simulated SMS Inbox** (`/mock/v1/sms/inbox/{phone}`) with a verification code.
  2. `POST /api/v1/auth/otp/verify` checks constant-time hash (`hmac.compare_digest`), marks `consumed_at`, creates `users` + `citizens` row if first time, and issues JWT + refresh token.
- **Staff & Helpers (Email + Password):**
  - Passwords hashed with **Argon2id** (via `argon2-cffi` or `passlib[bcrypt]`). Plaintext passwords never stored or logged.
- **Demo Persona Login (`DEMO_MODE=true` only):**
  - `POST /api/v1/auth/demo-login` issues real signed JWTs for the seeded personas so judges can test every role seamlessly. When `DEMO_MODE=false`, endpoint returns `404`.
- **Public REST API (`X-API-Key`):**
  - Format: `hq_live_<8-char-prefix>_<32-char-secret>`. Only `SHA-256(full_key)` and `key_prefix` are stored; plaintext is returned once at creation.

### 1.2 Token Specification
- **Access Token (JWT HS256):** TTL = 15 min. Claims: `{ sub: user_id, role, tenant_id, citizen_id, iat, exp, jti }`.
- **Refresh Token:** Opaque 256-bit random token, stored hashed (`SHA-256`) in `refresh_tokens`. TTL = 30 days (Citizens) / 12 hours (Staff & Helpers). Rotated on every `/auth/refresh`; reuse of revoked token revokes all tokens for that user.

---

## 2. Server-Side RBAC Matrix

Enforced via FastAPI dependencies `require_roles(...)` and `require_tenant_scope(...)`. UI visibility is strictly cosmetic.

| Endpoint Group | CITIZEN | HELPER (with `X-Act-For-Citizen`) | OFFICER (tenant) | ADMIN (tenant) | Platform ADMIN | AUDITOR (read-only) | Public `X-API-Key` |
|---|---|---|---|---|---|---|---|
| Own/Assisted Cases (`POST/PATCH/SUBMIT/GET`) | Own only | Active `HELPER` grant only | Read tenant cases (with dept consent) | No (use Auditor/Analytics) | No | Read-only all | Status-only via `/public` (`cases:read`) |
| Documents Upload (`POST /documents`) | Own only | Active `HELPER` grant | No | No | No | No | No |
| Documents Download (`GET /documents/{id}/file`) | Own only | Active `HELPER` (`DOCUMENTS`) | Tenant + Dept `DOCUMENTS` consent | No | No | Read-only (audited) | No |
| Consent Grants (`POST/PATCH/WITHDRAW`) | Own only | Create only with OTP/verbal proof; **cannot withdraw** | No | No | No | Read-only via `/auditor/consents` | No |
| Helper Family List (`GET/POST /helper/families`) | No (`403`) | Own granted families only | No (`403`) | No (`403`) | No (`403`) | No (`403`) | No |
| Officer Queue & Decide (`/officer/*`) | No (`403`) | No (`403`) | Tenant-scoped only | No (`403`) | No (`403`) | No (`403`) | No |
| Rule Editor & Digital Twin (`/admin/rules/*`) | No (`403`) | No (`403`) | No (`403`) | Tenant-scoped | All tenants | Read-only (`GET`) | Active rule summary via `/public` (`rules:read`) |
| Users & API Keys (`/admin/users`, `/admin/api-keys`) | No (`403`) | No (`403`) | No (`403`) | Tenant-scoped | All tenants | No (`403`) | No |
| Mock Service Chaos & Demo Reset (`/admin/mocks`, `/admin/demo/reset`) | No (`403`) | No (`403`) | No (`403`) | No (`403`) | **Yes** | No (`403`) | No |
| Auditor Console (`/auditor/*`) | No (`403`) | No (`403`) | No (`403`) | No (`403`) | No (`403`) | **Yes (GET only)** | No |
| Eval & Tenant Analytics (`/eval/*`, `/analytics/*`) | No (`403`) | No (`403`) | Tenant-scoped | Tenant-scoped | All tenants | All tenants | No |
| Scam Checker (`/scam/check`) | Yes | Yes | Yes | Yes | Yes | Yes | Yes (`scam:check`) |
| RAG Policy Assistant (`/rag/ask`) | Yes | Yes | Yes | Yes | Yes | Yes | No |

> **Anti-IDOR Rule:** If a Citizen, Helper, Officer, or Tenant Admin requests a resource ID belonging to another citizen or another tenant, return **`404 NOT_FOUND`** (never `403`, which leaks resource existence) and write an `auth.cross_scope_denied` audit event.

---

## 3. Multi-Tenant Isolation

- Every tenant-scoped query MUST include `.where(Model.tenant_id == current_user.tenant_id)` derived strictly from the verified JWT/API-key context - **never** from a client-supplied `tenant_id` query/body field.
- Seeded tenants:
  1. `SPD`: *Social Protection Department (Mock)* - operates `SAHARA_WIDOW_GRANT`.
  2. `ZWB`: *Zakat & Welfare Board (Mock)* - operates `GUZARA_ALLOWANCE`.
- Automated security test suite verifies that `officer_zakat` cannot view, assign, decide, or list any `SPD` case, rule, document, or analytics metric.

---

## 4. Consent Enforcement Engine (`backend/app/security/consent.py`)

### 4.1 Single Enforcement Point (Zero Bypass, Zero Caching)
Every read/write of citizen data by a Helper, Officer, or Agent MUST invoke `enforce_consent(...)`:

```python
def enforce_consent(
    db: Session,
    *,
    citizen_id: UUID,
    actor: ActorContext,      # user_id, role, tenant_id, label
    category: DataCategory,   # IDENTITY | HOUSEHOLD | DOCUMENTS | PAYMENT | CASE_HISTORY
    purpose: ConsentPurpose,  # BENEFIT_APPLICATION | PAYMENT_DISBURSEMENT | HELPER_ASSISTANCE | COMPLAINT_RESOLUTION
    resource_ref: str,
) -> ConsentGrant | None:
    # 1. Citizen accessing own data is always allowed (no grant needed)
    if actor.role == "CITIZEN" and actor.citizen_id == citizen_id:
        return None

    # 2. Auditor has statutory read-only oversight (logged to audit_events + access_log)
    if actor.role == "AUDITOR":
        _log_access(db, citizen_id, actor, category, purpose, resource_ref, allowed=True)
        return None

    # 3. Helper requires active HELPER grant to this specific user_id
    if actor.role == "HELPER":
        grant = _find_active_grant(db, citizen_id, recipient_type="HELPER", recipient_user_id=actor.user_id)
    # 4. Officer / Department Agent requires active DEPARTMENT grant to actor.tenant_id
    elif actor.role in ("OFFICER", "AGENT"):
        grant = _find_active_grant(db, citizen_id, recipient_type="DEPARTMENT", recipient_tenant_id=actor.tenant_id)
    else:
        grant = None

    reason = None
    if grant is None:
        reason = "CONSENT_REVOKED"
    elif grant.expires_at and grant.expires_at < utcnow():
        grant.status = "EXPIRED"
        reason = "CONSENT_EXPIRED"
    elif category not in grant.categories:
        reason = "CATEGORY_NOT_GRANTED"
    elif purpose not in grant.purposes:
        reason = "PURPOSE_NOT_GRANTED"

    allowed = reason is None
    # CRITICAL: Always persist access log EVEN WHEN DENIED (use independent commit/savepoint
    # so the denied-attempt record survives the HTTP 403 error response!)
    _persist_access_log_and_audit(db, citizen_id, actor, category, purpose, resource_ref, allowed, reason)

    if not allowed:
        raise ConsentRevokedError(code="CONSENT_REVOKED", detail={"reason": reason, "category": category})
    return grant
```

> **Implementation Pitfall Prevented:** Notice the comment on persisting the denied access log! If an endpoint raises HTTP 403 and rolls back the request's DB session, a naive implementation would roll back the `consent_access_logs` row too! A1 MUST write the denied `consent_access_logs` + `audit_events` row in an isolated session (`SessionLocal()`) before raising `ConsentRevokedError`, guaranteeing the citizen immediately sees *"Ayesha tried to view your documents at 15:40 - Blocked"*!

### 4.2 Withdrawal Side Effects
When a citizen calls `POST /api/v1/consent/grants/{id}/withdraw`:
- If `recipient_type == 'HELPER'`: immediately sets `status = 'WITHDRAWN'`. Helper's next call fails with `403 CONSENT_REVOKED`.
- If `recipient_type == 'DEPARTMENT'`:
  - Checks for open cases (`status NOT IN ('DRAFT','PAID','REJECTED','WITHDRAWN','CLOSED')`) in `recipient_tenant_id`.
  - If open cases exist and `confirm_case_hold` is not `true` → returns `409` with `{ "open_case_count": N, "message_ur": "...", "message_en": "..." }` so the UI shows a clear confirmation dialog.
  - When confirmed: sets `status = 'WITHDRAWN'`, updates all open cases in that tenant to `previous_status = status`, `status = 'ON_HOLD_CONSENT'`, records `consent_events` + `audit_events`.
  - Officers viewing the queue still see the case row with **only** `reference_code` and `ON_HOLD_CONSENT` (all PII masked/omitted); opening the case returns `403 CONSENT_REVOKED` (logged!).
- When the citizen re-grants department consent: all `ON_HOLD_CONSENT` cases in that tenant automatically restore `status = previous_status`, `previous_status = NULL` (and if `SUBMITTED`/`PROCESSING`, re-enqueue `PROCESS_CASE`).

---

## 5. Tamper-Evident Audit Hash Chain (`backend/app/security/audit.py`)

### 5.1 Hash Formula
Every call to `audit.record(db, ...)` acquires a lightweight PostgreSQL advisory lock (`pg_advisory_xact_lock(99887766)`) inside the transaction to serialize chain tip reads, fetches the latest `event_hash` (or `"GENESIS"` if empty), computes:

```python
canonical_payload = json.dumps(redacted_payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
material = f"{prev_hash}|{seq}|{created_at.isoformat()}|{action}|{resource_type}|{resource_id or ''}|{canonical_payload}"
event_hash = hashlib.sha256(material.encode("utf-8")).hexdigest()
```

### 5.2 Chain Verification (`GET /api/v1/auditor/verify-chain`)
Iterates `audit_events` ordered by `seq ASC`, recomputing `prev_hash` linkage and `event_hash` for every row. Returns:
```json
{ "valid": true, "checked_count": 1482, "first_broken_seq": null, "verified_at": "2026-11-23T09:10:00Z" }
```
If any row is modified or deleted in Postgres, `valid: false` pinpoints the exact `first_broken_seq`.

### 5.3 Mandatory Audited Actions
`auth.login`, `auth.demo_login`, `auth.forbidden`, `auth.cross_scope_denied`, `case.created`, `case.submitted`, `case.status_changed`, `agent.step`, `decision.recorded`, `officer.decided`, `officer.second_approved`, `rule.draft_created`, `rule.simulated`, `rule.published`, `consent.granted`, `consent.modified`, `consent.withdrawn`, `consent.access_denied`, `document.uploaded`, `document.verified`, `payment.initiated`, `payment.completed`, `payment.failed`, `scam.checked`, `ai.call`, `ai.guardrail_triggered`, `mock.config_changed`, `api_key.created`, `api_key.revoked`, `rule.draft_updated`, `case.reevaluated`.

---

## 6. Threat Model & Protections

| Threat | Mitigation |
|---|---|
| Helper mixes up two families on shared phone | Server requires explicit `X-Act-For-Citizen` header verified against active grant; UI clears React Query cache + Dexie working state + displays mandatory audio/avatar confirmation screen on switch. |
| Officer approves fraudulent case alone | Four-eyes enforced server-side (`PENDING_SECOND_APPROVAL`, `first_approver_id != second_approver_id`). |
| Prompt injection via scam SMS or fake doc OCR | XML input framing + deterministic engine isolation (`app/ai/` cannot mutate cases) + guardrail log. |
| Forged official SMS using real `HQ-XXXXX` code with changed text | `body_sha256` verification catches text alteration (`RF_CODE_MISMATCH`). |
| Brute-force OTP or API abuse | 5-attempt OTP cap + 5 min TTL + per-phone/IP/key sliding-window rate limits (`429`). |
| Direct file URL guessing for uploaded CNICs | Files stored outside static root with UUID names; served only through `/api/v1/documents/{id}/file` behind JWT + RBAC + tenant + consent enforcement. |
| Real personal data leakage | Zero real CNICs/names; synthetic CNIC prefix `99900` enforced in seed script and documented in `/transparency`. |
