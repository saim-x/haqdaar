# 06 — Decision Engine, Rules DSL, Confidence & Entity Resolution

> **Status:** FROZEN v1.0. Source of truth for `backend/app/engine/` and `backend/app/agent/`.
> **Owner:** A2.
> **Hard Invariant:** `backend/app/engine/` is **100 % pure Python** (Pydantic + stdlib + RapidFuzz). Zero DB, HTTP, or LLM imports. Given the same `FactBundle`, `RuleSet`, `Flags`, and `Config`, it MUST return byte-identical output.

---

## 1. Philosophy: LLM Proposes, Policy Disposes

An LLM cannot reliably enforce asymmetric social-protection risk ("wrong approvals cost more than slow approvals"), cannot guarantee reproducible audit traces across rule changes, and produces notoriously uncalibrated self-reported confidence scores.

Therefore, Haqdaar splits cognition from decisioning:
1. **Evidence & Extraction Layer (Mock APIs + AI):** Produces structured facts with provenance and measurable verification scores.
2. **Entity Resolution & Anomaly Layer (`engine/entity_resolution.py`, `engine/anomalies.py`):** Resolves messy names/records without guessing and raises typed risk flags.
3. **Versioned Rules Evaluator (`engine/evaluator.py`):** Evaluates eligibility with **tri-state Kleene logic** (`PASS`, `FAIL`, `UNKNOWN`).
4. **Confidence & Cost-Aware Router (`engine/confidence.py`, `engine/router.py`):** Computes weakest-link confidence from evidence quality, applies the cost matrix, and outputs `AUTO_APPROVE`, `ASK_MORE`, `HUMAN_REVIEW`, or `WAIT_EXTERNAL` — **never `AUTO_REJECT`**.
5. **Deterministic Explainer (`engine/explainer.py`):** Generates plain-language Urdu + English citizen reasons directly from the rule trace.

---

## 2. Versioned Rules DSL (`rule_versions.rules_json`)

### 2.1 DSL Schema
Every `rules_json` payload MUST validate against the Pydantic `RuleSetSchema`:

```json
{
  "schema_version": "1.0",
  "program_code": "SAHARA_WIDOW_GRANT",
  "policy": {
    "auto_approve_confidence_threshold": 0.90,
    "auto_approve_max_amount_pkr": 20000,
    "max_ask_more_rounds": 2,
    "cost_matrix": {
      "wrong_approval_cost": 100,
      "unnecessary_human_review_cost": 8,
      "ask_more_cost": 5,
      "missed_fraud_multiplier": 1.5
    }
  },
  "eligibility_rules": [
    {
      "id": "R01_ALIVE",
      "fact": "applicant_is_alive",
      "op": "eq",
      "value": true,
      "on_fail": "HUMAN",
      "on_unknown": "HUMAN",
      "required_for_auto": true,
      "label_en": "Applicant must be alive in identity registry",
      "label_ur": "درخواست گزار کا شناختی ریکارڈ میں زندہ ہونا ضروری ہے",
      "pass_reason_en": "Identity record confirmed active.",
      "pass_reason_ur": "آپ کا شناختی ریکارڈ درست اور فعال پایا گیا۔",
      "fail_reason_en": "Identity record shows a conflict requiring officer review.",
      "fail_reason_ur": "شناختی ریکارڈ میں تضاد ہے جس کی جانچ افسر کرے گا۔",
      "ask_prompt_en": null,
      "ask_prompt_ur": null
    },
    {
      "id": "R02_CNIC_VALID",
      "fact": "applicant_cnic_valid",
      "op": "eq",
      "value": true,
      "on_fail": "ASK",
      "on_unknown": "ASK",
      "required_for_auto": true,
      "label_en": "CNIC must not be expired",
      "label_ur": "شناختی کارڈ کی میعاد ختم نہیں ہونی چاہیے",
      "pass_reason_en": "Your CNIC is valid.",
      "pass_reason_ur": "آپ کا شناختی کارڈ قابلِ قبول ہے۔",
      "fail_reason_en": "Your CNIC appears expired.",
      "fail_reason_ur": "آپ کے شناختی کارڈ کی میعاد ختم ہو چکی ہے۔",
      "ask_prompt_en": "Please upload a renewed CNIC photo.",
      "ask_prompt_ur": "براہ کرم تجدید شدہ شناختی کارڈ کی تصویر اپ لوڈ کریں۔"
    },
    {
      "id": "R03_AGE_MIN",
      "fact": "applicant_age_years",
      "op": "gte",
      "value": 18,
      "on_fail": "HUMAN",
      "on_unknown": "ASK",
      "required_for_auto": true,
      "label_en": "Applicant must be at least 18 years old",
      "label_ur": "درخواست گزار کی عمر کم از کم 18 سال ہونی چاہیے",
      "pass_reason_en": "Age requirement met.",
      "pass_reason_ur": "عمر کی شرط پوری ہے۔",
      "fail_reason_en": "Recorded age is below 18.",
      "fail_reason_ur": "ریکارڈ کے مطابق عمر 18 سال سے کم ہے۔",
      "ask_prompt_en": "Please confirm your date of birth or upload your CNIC.",
      "ask_prompt_ur": "براہ کرم اپنی تاریخ پیدائش کی تصدیق کریں۔"
    },
    {
      "id": "R04_WIDOW_VERIFIED",
      "fact": "spouse_death_verified",
      "op": "eq",
      "value": true,
      "on_fail": "HUMAN",
      "on_unknown": "ASK",
      "required_for_auto": true,
      "label_en": "Spouse death must be verified via civil registry or death certificate",
      "label_ur": "شوہر کی وفات کی تصدیق سول ریکارڈ یا وفات سرٹیفکیٹ سے ہونی چاہیے",
      "pass_reason_en": "Widow status verified.",
      "pass_reason_ur": "بیوہ ہونے کی تصدیق ہو گئی۔",
      "fail_reason_en": "Spouse death could not be confirmed automatically.",
      "fail_reason_ur": "شوہر کی وفات کی خودکار تصدیق نہیں ہو سکی۔",
      "ask_prompt_en": "Please upload your husband's death certificate photo.",
      "ask_prompt_ur": "براہ کرم شوہر کے وفات سرٹیفکیٹ کی واضح تصویر اپ لوڈ کریں۔"
    },
    {
      "id": "R05_INCOME_CAP",
      "fact": "monthly_income_pkr",
      "op": "lte",
      "value": 40000,
      "on_fail": "HUMAN",
      "on_unknown": "ASK",
      "required_for_auto": true,
      "label_en": "Monthly household income must be at most PKR 40,000",
      "label_ur": "گھریلو ماہانہ آمدنی 40,000 روپے یا اس سے کم ہونی چاہیے",
      "pass_reason_en": "Household income is within the PKR 40,000 limit.",
      "pass_reason_ur": "گھریلو آمدنی 40,000 روپے کی حد کے اندر ہے۔",
      "fail_reason_en": "Recorded income exceeds the program limit; an officer will review.",
      "fail_reason_ur": "ریکارڈ شدہ آمدنی حد سے زیادہ ہے؛ افسر جائزہ لے گا۔",
      "ask_prompt_en": "Please tell us your approximate monthly household income.",
      "ask_prompt_ur": "براہ کرم اپنی ماہانہ گھریلو آمدنی بتائیں۔"
    },
    {
      "id": "R06_NO_CONFLICTING_GRANT",
      "fact": "has_conflicting_active_grant",
      "op": "eq",
      "value": false,
      "on_fail": "HUMAN",
      "on_unknown": "HUMAN",
      "required_for_auto": true,
      "label_en": "Must not currently receive a conflicting relief grant",
      "label_ur": "کسی اور متضاد امدادی پروگرام سے رقم نہ مل رہی ہو",
      "pass_reason_en": "No conflicting active benefit found.",
      "pass_reason_ur": "کوئی اور متضاد امداد فعال نہیں پائی گئی۔",
      "fail_reason_en": "Another active benefit record was found; an officer will verify.",
      "fail_reason_ur": "ایک اور فعال امدادی ریکارڈ ملا ہے؛ افسر تصدیق کرے گا۔",
      "ask_prompt_en": null,
      "ask_prompt_ur": null
    },
    {
      "id": "R07_DISTRICT_SINDH",
      "fact": "applicant_district",
      "op": "in",
      "value": ["Thatta", "Badin", "Hyderabad", "Karachi", "Tharparkar", "Umerkot", "Mirpurkhas", "Sukkur", "Larkana", "Dadu"],
      "on_fail": "HUMAN",
      "on_unknown": "ASK",
      "required_for_auto": true,
      "label_en": "Applicant must reside in an eligible Sindh district",
      "label_ur": "درخواست گزار کا تعلق سندھ کے اہل ضلع سے ہونا چاہیے",
      "pass_reason_en": "District is eligible for Sahara Grant.",
      "pass_reason_ur": "آپ کا ضلع سہارا گرانٹ کے لیے اہل ہے۔",
      "fail_reason_en": "District is outside the current pilot list; officer will check.",
      "fail_reason_ur": "یہ ضلع موجودہ فہرست میں شامل نہیں؛ افسر جانچ کرے گا۔",
      "ask_prompt_en": "Please select your district.",
      "ask_prompt_ur": "براہ کرم اپنا ضلع منتخب کریں۔"
    },
    {
      "id": "R08_CNIC_DOC",
      "fact": "cnic_doc_verified",
      "op": "eq",
      "value": true,
      "on_fail": "ASK",
      "on_unknown": "ASK",
      "required_for_auto": true,
      "label_en": "CNIC document must be verified",
      "label_ur": "شناختی کارڈ کی تصویر کی تصدیق ضروری ہے",
      "pass_reason_en": "CNIC document verified.",
      "pass_reason_ur": "شناختی کارڈ کی تصویر کی تصدیق ہو گئی۔",
      "fail_reason_en": "CNIC photo needs to be clearer or checked by an officer.",
      "fail_reason_ur": "شناختی کارڈ کی تصویر واضح نہیں یا مزید جانچ درکار ہے۔",
      "ask_prompt_en": "Please take a clear photo of the front of your CNIC.",
      "ask_prompt_ur": "براہ کرم شناختی کارڈ کے سامنے والے حصے کی واضح تصویر لیں۔"
    },
    {
      "id": "R09_CHILDREN_KNOWN",
      "fact": "children_under_18",
      "op": "gte",
      "value": 0,
      "on_fail": "HUMAN",
      "on_unknown": "ASK",
      "required_for_auto": true,
      "label_en": "Number of children under 18 must be known (it determines the grant amount)",
      "label_ur": "18 سال سے کم عمر بچوں کی تعداد معلوم ہونا ضروری ہے (رقم کا حساب اس سے بنتا ہے)",
      "pass_reason_en": "Children count confirmed.",
      "pass_reason_ur": "بچوں کی تعداد کی تصدیق ہو گئی۔",
      "fail_reason_en": "Recorded children count is invalid; an officer will review.",
      "fail_reason_ur": "بچوں کی تعداد درست نہیں؛ افسر جائزہ لے گا۔",
      "ask_prompt_en": "Please tell us how many children under 18 you have.",
      "ask_prompt_ur": "براہ کرم بتائیں کہ 18 سال سے کم عمر بچے کتنے ہیں۔"
    }
  ],
  "benefit_formula": {
    "base_amount_pkr": 12000,
    "per_child_bonus_pkr": 1000,
    "max_children_counted": 5,
    "hard_cap_pkr": 20000
  }
}
```

### 2.2 Supported Operators (`op`)
- `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `in`, `not_in`
- Validator enforces that `fact` exists in the **Canonical Fact Registry** ([04-data-model.md §5](04-data-model.md)), `value` matches the fact's type, all required bilingual strings are non-empty, and `auto_approve_confidence_threshold` is within `[0.50, 0.99]`.

### 2.3 Tri-State Rule Evaluation
For each rule `r`:
- If `facts[r.fact].state == "UNKNOWN"` → result is **`UNKNOWN`**.
- Else evaluate `op(facts[r.fact].value, r.value)` → **`PASS`** or **`FAIL`**.
- **No default substitution ever.** If `monthly_income_pkr` is missing, it is NEVER defaulted to `0` or `999999`.

### 2.4 Benefit Amount Formula
Computed only when `children_under_18` is `KNOWN` (else `base_amount_pkr` previewed for officers as provisional):
`amount = min(hard_cap_pkr, base_amount_pkr + min(max(0, children_under_18), max_children_counted) * per_child_bonus_pkr)`
For Fatima Bibi (3 children, Sahara v1): `12,000 + 3 * 1,000 = PKR 15,000`.

---

## 3. Confidence Model & Cost-of-Being-Wrong Mathematics (Challenge 01)

### 3.1 Why Weakest-Link Confidence (Not Averaging)
Averaging hides catastrophic single-point failure: if identity match is `0.99`, documents are `0.98`, consent is `1.00`, and data consistency is `0.40` (income conflict), the mean is `0.84` — dangerously high. **Weakest-link (`min`)** exposes the weakest pillar immediately.

### 3.2 Four Evidence Pillars (all in `[0.0, 1.0]`)
1. **`identity_confidence`**:
   - Exact CNIC match in Identity Registry + normalized name similarity ≥ 0.85 + DOB match → `0.98`
   - Exact CNIC match + name similarity `0.70–0.84` (e.g., spelling variant `"Mst. Fatima Bibi"` vs `"Fatima Bibi"`) + DOB match → `0.93`
   - Exact CNIC match + name similarity `0.55–0.69` → `0.75` (triggers `IDENTITY_NAME_VARIANT_CHECK`)
   - Exact CNIC match + name similarity < 0.55 → `0.30` (raises `IDENTITY_CONFLICT` HIGH)
   - No CNIC, fuzzy match only (single candidate ≥ 0.88 + DOB + district) → `0.78` (never ≥ 0.90; requires CNIC proof or human)
   - Ambiguous multiple candidates or not found → `0.25`
2. **`document_confidence`**:
   - Required docs `VERIFIED` (valid signed QR + OCR-vs-QR match ≥ 0.85 + sharp image) → `min(doc.verify_confidence)` (typically `0.92–0.98`)
   - Any required doc `UNVERIFIABLE` → `0.55`
   - Any required doc `NEEDS_RETAKE` → `0.40`
   - Any doc `TAMPER_SUSPECTED` → `0.10` (also raises `TAMPER_SUSPECTED` HIGH)
3. **`data_consistency_confidence`**:
   - Starts at `0.98`.
   - Each `LOW` flag deducts `0.05`.
   - Each `MEDIUM` flag (e.g. income mismatch > 30 %, payout name mismatch) caps pillar at `0.72`.
   - Each `HIGH` flag (duplicate app, applicant deceased, shared payout, tamper, identity conflict) caps pillar at `0.20`.
4. **`consent_assurance_confidence`**:
   - `SELF_OTP` or `CITIZEN_OTP` → `1.00`.
   - `VERBAL_WITNESSED` (helper verbal consent without citizen's own phone OTP) → `0.82` (caps overall confidence below `0.90`, meaning verbal-consent cases are **always** reviewed by an officer before money moves — a high-judgment safeguard!).

**Overall Confidence:**
```python
confidence_overall = round(min(
    identity_confidence,
    document_confidence,
    data_consistency_confidence,
    consent_assurance_confidence,
), 3)
```

### 3.3 The Cost Matrix & Threshold Justification
Let:
- $C_{\text{FP}} = 100$ — cost of a **wrong auto-approval** (direct loss of public funds + reputational harm + recovery difficulty).
- $C_{\text{HR}} = 8$ — cost of an **unnecessary human review** (officer minutes + ~1–2 day delay for an eligible widow).

By Bayes decision theory, auto-approving a case with true validity probability $p$ has lower expected cost than human review if and only if:
$$(1 - p) \cdot C_{\text{FP}} < C_{\text{HR}} \implies p > 1 - \frac{C_{\text{HR}}}{C_{\text{FP}}} = 1 - \frac{8}{100} = 0.92$$

Accounting for mild conservatism in weakest-link scores (which lower-bound true validity probability), we set the default Sahara v1 threshold at **$\tau = 0.90$** and **prove it empirically** in `engine/eval_sweep.py`:
- On our 133-case labelled synthetic evaluation benchmark (`backend/app/data/eval_cases.jsonl`), `eval_sweep.py` sweeps $\tau \in [0.50, 0.55, \dots, 0.95]$ and computes for every point:
  - `auto_approve_rate`
  - `false_approval_rate` (wrong approvals / auto-approvals)
  - `human_review_load` (% sent to officers)
  - `expected_total_cost = wrong_approvals * 100 + human_reviews * 8 + ask_mores * 5`
- The Evaluation Dashboard displays this exact live curve with $\tau = 0.90$ highlighted at the minimum-cost knee (false approval rate ≤ 1 %, while auto-approving ~55–65 % of clean applications in seconds).

---

## 4. Routing Policy & Enumerated Escalation Codes (Challenge 02)

### 4.1 Deterministic Routing Order (Evaluated Top-to-Bottom)
```python
def route_case(eval_result, confidence, flags, amount_pkr, policy, ask_more_rounds, external_unavailable):
    # 1. External dependency down -> never guess
    if external_unavailable:
        return RouteDecision(action="WAIT_EXTERNAL", outcome="WAITING_EXTERNAL",
                             reasons=["EXTERNAL_SERVICE_UNAVAILABLE"])

    # 2. Any HIGH severity flag -> mandatory HUMAN_REVIEW
    high_flags = [f for f in flags if f.severity == "HIGH"]
    if high_flags:
        return RouteDecision(action="HUMAN_REVIEW", outcome="HUMAN_REVIEW",
                             reasons=[f.code for f in high_flags])

    # 3. Any rule FAIL with on_fail == "HUMAN" -> NEVER auto-reject, send to HUMAN_REVIEW
    human_fails = [r for r in eval_result.rules if r.result == "FAIL" and r.on_fail == "HUMAN"]
    if human_fails:
        return RouteDecision(action="HUMAN_REVIEW", outcome="HUMAN_REVIEW",
                             reasons=[f"RULE_FAIL_{r.id}" for r in human_fails])

    # 4. Any rule UNKNOWN or FAIL with on_* == "ASK" -> ASK_MORE (max 2 rounds, else HUMAN_REVIEW)
    ask_items = [r for r in eval_result.rules
                 if (r.result == "UNKNOWN" and r.on_unknown == "ASK")
                 or (r.result == "FAIL" and r.on_fail == "ASK")]
    if ask_items:
        if ask_more_rounds >= policy.max_ask_more_rounds:
            return RouteDecision(action="HUMAN_REVIEW", outcome="HUMAN_REVIEW",
                                 reasons=["MAX_ASK_ROUNDS_EXCEEDED"] + [f"MISSING_{r.id}" for r in ask_items])
        return RouteDecision(action="ASK_MORE", outcome="NEEDS_INFO",
                             reasons=[f"ASK_{r.id}" for r in ask_items])

    # 5. Any rule UNKNOWN with on_unknown == "HUMAN" -> HUMAN_REVIEW
    human_unknowns = [r for r in eval_result.rules if r.result == "UNKNOWN" and r.on_unknown == "HUMAN"]
    if human_unknowns:
        return RouteDecision(action="HUMAN_REVIEW", outcome="HUMAN_REVIEW",
                             reasons=[f"UNKNOWN_{r.id}" for r in human_unknowns])

    # 6. Payout exceeds auto-approve cap -> HUMAN_REVIEW
    if amount_pkr > policy.auto_approve_max_amount_pkr:
        return RouteDecision(action="HUMAN_REVIEW", outcome="HUMAN_REVIEW",
                             reasons=["AMOUNT_EXCEEDS_AUTO_CAP"])

    # 7. Confidence below threshold -> HUMAN_REVIEW ("I am not sure")
    if confidence.overall < policy.auto_approve_confidence_threshold:
        reasons = ["LOW_CONFIDENCE"]
        if confidence.consent_assurance < policy.auto_approve_confidence_threshold:
            reasons.append("LOW_ASSURANCE_CONSENT")
        reasons.extend([f.code for f in flags if f.severity == "MEDIUM"])
        return RouteDecision(action="HUMAN_REVIEW", outcome="HUMAN_REVIEW", reasons=reasons)

    # 8. All checks PASS, zero HIGH flags, confidence >= threshold -> AUTO_APPROVE
    return RouteDecision(action="AUTO_APPROVE", outcome="APPROVED", reasons=[])
```

### 4.2 Officer Queue Priority Score (`0–100`)
Computed whenever a case enters `HUMAN_REVIEW`:
- Base: `30`
- Vulnerability boost: `+15` if `children_under_18 >= 3`, `+10` if `monthly_income_pkr <= 20000`
- Risk boost: `+35` if any `HIGH` flag (`TAMPER_SUSPECTED`, `DUPLICATE_APPLICATION`, `PAYOUT_ACCOUNT_SHARED`), `+15` if `MEDIUM` flag
- Age boost: `+2` per hour waiting (capped at `+20`)
- Bands: `URGENT` (≥ 80), `HIGH` (60–79), `NORMAL` (35–59), `LOW` (< 35).

### 4.3 AI Case Handoff Note (`cases.ai_case_note`)
Every `HUMAN_REVIEW` route automatically populates:
- `verified`: list of facts & rules that passed with sources
- `uncertain`: list of escalation reasons, conflicting facts, and lowest confidence pillar
- `suggested_checks`: concrete 1-line actions for the officer (e.g., *"Compare printed name on CNIC image against signed QR payload; call applicant if needed"*)

---

## 5. Entity Resolution & Bad Data Engine (`engine/entity_resolution.py` — Challenge 03)

Real Pakistani public records contain rampant spelling drift (`Muhammad`/`Mohammad`/`Muhammed`/`Mohd`/`M.`, `Bibi`/`Bano`, prefixes `Mst.`/`Syed`/`Haji`/`Smt.`, Urdu script `فاطمہ بی بی` vs Roman `Fatima Bibi`), missing DOBs, and duplicate entries.

### 5.1 Name Normalization Pipeline
1. **Script Detection & Transliteration:** If Urdu Unicode (`\u0600–\u06FF`), normalize Arabic/Urdu variants (`ي→ی`, `ك→ک`, `ة→ہ`, strip diacritics/tatweel) and map via a deterministic Urdu→Roman-Urdu lookup/transliteration table so Urdu and Roman names compare directly.
2. **Honorific & Noise Stripping:** Strip leading/trailing tokens `{mst, musammat, bibi, bano, begum, smt, mr, mrs, ms, haji, syed, s, m}` (keeping a copy if stripping empties the string).
3. **Pakistani Phonetic Token Canonicalization:**
   - `{muhammad, mohammad, muhammed, mohammed, mohd, md, muhd}` → `muhammad`
   - `{rasool, rasul}` → `rasool`
   - `{fatima, fatimah, fatma}` → `fatima`
   - `{ayesha, aisha, aysha}` → `ayesha`
   - `{husain, hussain, hossein}` → `hussain`
   - `{abdul, abdal}` → `abdul`
   - Collapse repeated consonants (`ll→l`, `ss→s`, `mm→m`), normalize vowels (`ee→i`, `oo→u`, `ph→f`, `kh→k`, `q→k`, `z→s` in secondary phonetic key).
4. **Similarity Metric:** `name_sim = max(jaro_winkler(canon_a, canon_b), token_set_ratio(canon_a, canon_b) / 100.0)` using `rapidfuzz`.

### 5.2 Record Matching Rules (Never Match on Name Alone!)
- **Case A — CNIC provided (13 digits):** Lookup by exact `cnic_digits`.
  - Found + `name_sim >= 0.70` → **MATCH** (`0.98` if ≥ 0.85, `0.93` if 0.70–0.84; logs spelling variant transparently).
  - Found + `0.55 <= name_sim < 0.70` → **SOFT MATCH** (`0.75`, flags `IDENTITY_NAME_VARIANT_CHECK` MEDIUM → human review).
  - Found + `name_sim < 0.55` → **CONFLICT** (`0.30`, flags `IDENTITY_CONFLICT` HIGH → human review, **never merges**).
  - Not found → **NO MATCH** (`0.25`, flags `CNIC_NOT_IN_REGISTRY` HIGH → human review).
- **Case B — CNIC missing:** Search by normalized name + district.
  - 0 candidates → `UNKNOWN` (`ASK_MORE` for CNIC).
  - 1 candidate with `name_sim >= 0.88` AND DOB year within ±1 year → **PROVISIONAL MATCH** (`0.78`, never auto-approves; asks for CNIC or sends to human).
  - ≥ 2 candidates → **AMBIGUOUS** (`0.25`, flags `POSSIBLE_DUPLICATE_IDENTITY` HIGH → human review; **never picks one silently**).

---

## 6. Anomaly & Fraud Flag Catalogue (`engine/anomalies.py`)

| Flag Code | Severity | Trigger Condition |
|---|---|---|
| `TAMPER_SUSPECTED` | `HIGH` | Document QR signature invalid OR OCR-vs-QR name/CNIC mismatch |
| `DUPLICATE_APPLICATION` | `HIGH` | Another non-withdrawn/non-rejected case in same program with same `cnic_digits` within 90 days |
| `IDENTITY_CONFLICT` | `HIGH` | CNIC exists in registry but name similarity < 0.55 |
| `POSSIBLE_DUPLICATE_IDENTITY` | `HIGH` | Multiple candidate registry records match without CNIC disambiguation |
| `APPLICANT_DECEASED` | `HIGH` | Identity registry reports `is_alive == false` |
| `PAYOUT_ACCOUNT_SHARED` | `HIGH` | Same `payout_phone` used on ≥ 2 other distinct citizens' cases (Note: helper's shared *contact* phone is excluded; only *payout* alias triggers this!) |
| `DATA_CONFLICT_INCOME` | `MEDIUM` | Self-declared income and household survey income differ by > 30 % and > PKR 5,000 |
| `PAYOUT_NAME_MISMATCH` | `MEDIUM` | Mock Raast account title similarity to applicant name < 0.65 |
| `IDENTITY_NAME_VARIANT_CHECK` | `MEDIUM` | CNIC matches but name similarity in `0.55–0.69` |
| `HELPER_HIGH_VELOCITY` | `MEDIUM` | Helper submitted > 10 applications in the last 60 minutes |
| `LOW_ASSURANCE_CONSENT` | `MEDIUM` | Helper consent uses `VERBAL_WITNESSED` rather than citizen OTP |
| `CNIC_GENDER_MISMATCH` | `LOW` | Last digit of CNIC is odd (male convention) on a widow program |

---

## 7. Digital Twin Replay (`engine/twin.py`)

Given `baseline_rules`, `candidate_rules`, and a list of historical `decisions` (each containing `input_snapshot_json`, `flags_json`, `confidence_components`, `ask_more_rounds`):
1. Runs `evaluate_and_route(snapshot, candidate_rules)` purely in memory for every case.
2. Produces:
   - `sample_size`
   - `before_counts`: `{APPROVED, NEEDS_INFO, HUMAN_REVIEW}`
   - `after_counts`: `{APPROVED, NEEDS_INFO, HUMAN_REVIEW}`
   - `flipped_count` and `flipped_cases`: `[{case_id, reference_code, before_route, after_route, before_amount, after_amount, primary_reason}]`
   - `budget_delta_pkr`: `sum(after_approved_amount) - sum(before_approved_amount)`
3. **Zero side effects** on live cases, payments, or notifications.

---

## 8. Deterministic Citizen Explanation Generator (`engine/explainer.py`)

Builds `citizen_explanation` directly from `rule_trace_json` and `route_action` (works even if LLM API is completely down):
- **APPROVED:** Headline with PKR amount + top 3 passing rule reasons (`pass_reason_ur` / `pass_reason_en`) + payment next step.
- **NEEDS_INFO:** Plain headline ("We need one more thing") + exact `ask_prompt_ur`/`ask_prompt_en` for the missing/failed items.
- **HUMAN_REVIEW:** Neutral, non-accusatory headline ("An officer will review your application — usually within 2 days. You do not need to do anything.") — **NEVER accuses a citizen of forgery or fraud**, even when `TAMPER_SUSPECTED` is flagged internally for the officer!
- **WAITING_EXTERNAL:** "A government verification system is temporarily slow. We saved everything and will continue automatically."
- Optional live LLM polish (`AI_PROVIDER=live`) may rephrase for natural Urdu flow, strictly bounded by a guardrail check confirming the PKR amount and outcome word were not altered; on any guardrail or API failure, falls back silently to the deterministic template.
