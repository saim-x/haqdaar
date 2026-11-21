# 16 - Requirements Traceability Matrix

> **Status:** FROZEN v1.0. Maps **100 %** of items in the official 7-page Coder's Cup 2026 PDF to Product Features, Specifications, Owners, and Verification Tests.

---

## 1. Competition Rules & Integrity

| PDF Item | Requirement | Product Mechanism | Spec Ref | Owner | Verification |
|---|---|---|---|---|---|
| RULE-1 | Build during event | Fresh git repo post Fri 18:00 PKT | `01 §2.1` | All | Git commit timestamps |
| RULE-2 | Original solution | Written from scratch; OSS via package managers | `01 §2.1` | All | Code review |
| RULE-3 | No real personal data | Synthetic CNICs (`99900-*`), watermarked mock docs | `10 §1–3` | A3 | Seed audit + log PII check |
| RULE-4 | Mock identity, payment, data | `/mock/v1/*` behind HTTP with `"simulated": true` | `10 §1` | A3 | `test_invariants.py` |
| RULE-5 | Label as prototype | Persistent banner on every screen + `/transparency` | `11 §1` | A5, A6 | UI inspection |
| RULE-6 | Tell judges real vs simulated | `/transparency` page + `README.md` table | `15 §1` | A6, A7 | Manual + README check |

---

## 2. Core Constraints (All 8 Mandatory)

| PDF ID | Constraint | Implementation | Spec Ref | Owner | Verification |
|---|---|---|---|---|---|
| CON-1 | Wrong approvals > slow approvals | Cost matrix (`100` vs `8`), weakest-link ≥ 0.90, never auto-reject, four-eyes | `06 §3–4`, `08 Ch01` | A2, A1 | `test_router_policy.py`, `test_eval_sweep.py` |
| CON-2 | Weak internet | ≤ 150 KB citizen PWA, Workbox cache, Dexie outbox, ETag, Lite mode | `11 §5`, `08 Ch07` | A5, A1 | Build budget + `offline_sync.spec.ts` |
| CON-3 | Low literacy | Icon+audio-first wizard, 1 Q/screen, pre-recorded Urdu MP3s, readback | `11 §2–3`, `08 Ch07` | A5, A4 | Manual a11y + `golden_path.spec.ts` |
| CON-4 | Rules change without notice | DB-stored versioned DSL JSON, immediate publish, Digital Twin, RAG reindex | `06 §2`, `08 Ch04` | A2, A6 | `test_rule_versioning_and_twin.py` |
| CON-5 | Bad data | Tri-state facts, Urdu/Roman phonetic normalizer, RapidFuzz, conflict flags | `06 §5`, `08 Ch03` | A2 | `test_entity_resolution.py` |
| CON-6 | Explainable decisions | 3-reason Urdu/English citizen card + full auditor trace + hash chain | `06 §8`, `09 §5`, `08 Ch05` | A2, A1, A6 | `test_audit_chain.py` |
| CON-7 | User control & take-back | Per-recipient/category consent, immediate `403`, logged denials, `ON_HOLD_CONSENT` | `09 §4`, `08 Ch06` | A1, A5 | `test_consent_enforcement.py` |
| CON-8 | "I am not sure" | Enumerated escalation codes, AI handoff note, RAG `NOT_SURE`, scam `CANNOT_TELL`, `WAITING_EXTERNAL` | `06 §4`, `07`, `08 Ch02` | A2, A4 | `test_uncertainty_handoff.py`, `test_rag_abstention.py` |

---

## 3. User Roles (5 of 5 Implemented; ≥ 3 Required)

| Role | Capabilities | Spec Ref | Owner | Verification |
|---|---|---|---|---|
| Citizen | Wizard (voice/tap), docs, track status, consent & take-back, my-data, scam check | `02 §3`, `09 §2`, `11 §3` | A1, A5 | `test_rbac_and_tenancy.py`, `golden_path.spec.ts` |
| Community Helper | Serve 40 families on shared phone, safe switcher, per-family OTP/verbal consent | `02 §3`, `11 §4` | A1, A5 | `helper_consent.spec.ts` |
| Department Officer | Prioritised queue, review AI handoff, approve/reject/request-info, four-eyes | `02 §3`, `11 §6.1` | A1, A6 | `test_rbac_and_tenancy.py` |
| Admin | Tenant rules + Twin + users + API keys; Platform mock chaos + jobs + reset | `02 §3`, `11 §6.2` | A1, A2, A3, A6 | `test_rule_versioning_and_twin.py` |
| Auditor | Strictly read-only events, decision traces, consent logs, hash chain verify | `02 §3`, `09 §5`, `11 §6.3` | A1, A6 | `test_audit_chain.py`, `test_rbac_and_tenancy.py` |

---

## 4. Platform Core & Selected Optional Features

| Feature | Category | ID | Spec Ref | Owner | Verification |
|---|---|---|---|---|---|
| Secure login (JWT/OTP) + RBAC | Core | F-01 | `09 §1–2` | A1 | `test_rbac_and_tenancy.py` |
| Dashboard (progress, status, history) | Core | F-10 | `11 §3` | A5 | `golden_path.spec.ts` |
| Case management (create, assign, escalate, close) | Core | F-03, F-07 | `04 §3.3`, `05 §3.2/3.6` | A1, A5, A6 | `test_golden_path_and_rules.py` |
| Public REST API + API keys + Swagger | Core | F-17, F-19 | `05 §3.10` | A1 | `/api/docs` + `test_rbac_and_tenancy.py` |
| Audit log (user, AI, agent) + hash chain | Core | F-18 | `09 §5` | A1 | `test_audit_chain.py` |
| Consent management (see, share, withdraw, correct) | Core | F-11, F-12 | `09 §4`, `05 §3.4` | A1, A5 | `test_consent_enforcement.py` |
| Mock identity, payment, data APIs | Core | F-09, F-17 | `10 §1` | A3 | `test_chaos_resilience.py` |
| Admin rule editor (no code changes) | Pick ≥3 (#1) | F-15 | `06 §2`, `11 §6.2` | A2, A6 | `test_rule_versioning_and_twin.py` |
| Officer queue (priority + confidence sort) | Pick ≥3 (#2) | F-07 | `05 §3.6`, `11 §6.1` | A1, A6 | `test_golden_path_and_rules.py` |
| Low-bandwidth / offline mode | Pick ≥3 (#3) | F-24 | `11 §5` | A5, A1 | `offline_sync.spec.ts` |
| Background jobs & queues | Pick ≥3 (#4) | F-05 | `03 §2`, `04 §4.5` | A1 | `test_chaos_resilience.py` |
| Multi-tenant workspaces (`SPD` + `ZWB`) | Pick ≥3 (#5) | F-02, F-27 | `09 §3`, `10 §2` | A1, A3 | `test_rbac_and_tenancy.py` |
| Notifications (in-app + simulated SMS + codes) | Pick ≥3 (#6) | F-20 | `04 §4.5`, `10 §1.2` | A1, A3 | `test_golden_path_and_rules.py` |
| Rate limiting & error handling | Pick ≥3 (#7) | - | `03 §6.3`, `05 §2` | A1 | `test_rbac_and_tenancy.py` |
| Analytics dashboard per tenant | Pick ≥3 (#8) | F-23 | `05 §3.9`, `11 §6.4` | A1, A6 | Integration test |

---

## 5. AI Features (9 Implemented; ≥ 3 Required)

| AI Feature | ID | Implementation | Spec Ref | Owner | Verification |
|---|---|---|---|---|---|
| Classification & routing ("Jev") | F-06, F-14 | Case router + hybrid scikit-learn scam classifier | `06 §4`, `07 §3` | A2, A4 | `test_router_policy.py`, `test_scam_classifier.py` |
| Guardrails + human approval | F-06, F-08 | No auto-reject, four-eyes, prompt-injection XML framing, PII redact | `07 §6`, `09 §2` | A4, A1 | `test_ai_guardrails.py` |
| Explainability | F-06, F-18 | Rule-trace Urdu/English reasons + full auditor trace | `06 §8`, `08 Ch05` | A2, A6 | `test_audit_chain.py` |
| Structured outputs | F-03 | Field-scoped Pydantic JSON schema parsing + readback | `07 §2.2` | A4 | `test_voice_parse.py` |
| Voice (Urdu STT/TTS) | F-03, F-10 | Whisper STT + Deepgram Flux generated Urdu prompt MP3s + `edge-tts` dynamic TTS | `07 §2` | A4, A5 | `test_voice_parse.py` |
| Computer vision | F-04 | OpenCV blur + `QRCodeDetector` HMAC + OCR cross-check | `07 §5` | A4, A3 | `test_doc_verifier.py` |
| RAG with citations | F-21 | Hybrid `tsvector` + cosine similarity + `NOT_SURE` + auto rule reindex | `07 §4` | A4, A5 | `test_rag_abstention.py` |
| Anomaly detection | F-30 | Duplicate CNIC, shared payout alias, helper velocity, income conflict | `06 §6` | A2 | `test_anomalies.py` |
| Evaluation dashboard | F-22 | Live cost sweep, scam FPR, doc false-tamper, override/latency/cost | `07 §8`, `11 §6.4` | A2, A4, A6 | `test_eval_sweep.py` |
| Autonomous agent + tool calling | F-05 | 9-step deterministic case agent over HTTP mock DPI APIs | `07 §7` | A2 | `test_golden_path_and_rules.py` |
| Memory & context | F-03, F-24 | Server drafts + IndexedDB persistence across sessions | `11 §5` | A1, A5 | `offline_sync.spec.ts` |

---

## 6. Engineering Basics & Bonus Features

| Item | Implementation | Spec Ref | Owner | Verification |
|---|---|---|---|---|
| Postgres + migrations | PostgreSQL 16 + Alembic | `03 §2`, `04` | A1 | `alembic upgrade head` |
| Deployed link | Railway HTTPS + local Docker fallback | `03 §6.5` | A7 | Live smoke check |
| Monitoring, logs, tests | `/health`, JSON logs, `/eval`, pytest + Playwright | `03 §6`, `13` | A1, A7 | CI verification |
| **Bonus: Digital Twin** | Pure replay over 60+ past cases with budget delta | `06 §7`, `11 §6.2` | A2, A6 | `test_rule_versioning_and_twin.py` |
| **Bonus: Helper Mode** | Shared phone roster, safe switcher + cache wipe, per-family consent | `11 §4`, `05 §3.5` | A1, A5 | `helper_consent.spec.ts` |
| **Bonus: Offline-First Sync** | Workbox + Dexie outbox + `Idempotency-Key` | `11 §5`, `05 §1` | A5, A1 | `offline_sync.spec.ts` |
