# 00 — Haqdaar Master Planning Index

> **Competition:** Coder's Cup 2026 — *The Last Mile: AI on Public Rails* (FAST-NUCES Karachi)
> **Build Window:** Fri 20 Nov 2026, 18:00 PKT – Sun 22 Nov 2026, 18:00 PKT · **Live Demo:** Mon 23 Nov 2026
> **Product:** **Haqdaar (حقدار)** — Multi-tenant AI-assisted public benefit delivery, consent, audit, and anti-scam platform (*Sahara Widow Support Grant* & *Guzara Allowance*, prototype with simulated DPI rails).
> **Status:** **PLANNING SUITE COMPLETE & FROZEN v1.0** — Ready for parallel multi-agent implementation.

---

## Problem Statement Sentence (Completed)
> **We help widowed women in low-income Sindh households claim and safely receive the (fictional) Sahara Widow Support Grant, even though they cannot read the forms, have weak and dropping mobile signal, have records that are misspelled or incomplete across government systems, and are targeted by fake "relief payment" scam messages.**

---

## Document Map (Single Source of Truth)

| # | Document | Purpose | Primary Readers |
|---|---|---|---|
| **Root** | [AGENTS.md](../AGENTS.md) | Hard rules, architectural invariants, repo quickstart for coding agents | **All Agents (Read First)** |
| **01** | [01-competition-strategy.md](01-competition-strategy.md) | PDF analysis, winning thesis, scope picks, strategic principles (`SP-1..9`), risk register | Everyone |
| **02** | [02-product-spec.md](02-product-spec.md) | Vision, 9 seeded personas, 9 user journeys (`J-1..9`), P0/P1/P2 scope (`F-01..31`), ACs, 20 edge cases | Everyone |
| **03** | [03-system-architecture.md](03-system-architecture.md) | Locked tech stack, topology diagram, repo layout & ownership, env vars, logging, deployment | All Engineers |
| **04** | [04-data-model.md](04-data-model.md) | Full PostgreSQL 16 schema, ERD, enums, case state machine, **Canonical Fact Keys (§5)** | A1, A2, A3, A4 |
| **05** | [05-api-contracts.md](05-api-contracts.md) | REST endpoints (`/api/v1/*`, `/mock/v1/*`), headers, idempotency, **Error Codes (§2)**, Swagger | A1, A2, A3, A4, A5, A6 |
| **06** | [06-decision-engine.md](06-decision-engine.md) | Pure Rules DSL + Sahara v1 JSON, tri-state logic, weakest-link confidence, cost matrix math, routing, entity resolution, anomalies, Digital Twin, explainer | A2, A6, A7 |
| **07** | [07-ai-components.md](07-ai-components.md) | `AIProvider` (`live\|fake`), Urdu voice STT/TTS + structured outputs, CV signed-QR doc verification, calibrated scam classifier, hybrid RAG, guardrails, case agent, eval metrics | A4, A2, A5, A6 |
| **08** | [08-responsible-ai-challenges.md](08-responsible-ai-challenges.md) | Concrete system implementation & verification of **Technical Challenges 01–08** from the PDF | Everyone (Judge Prep) |
| **09** | [09-security-consent-audit.md](09-security-consent-audit.md) | Auth/JWT/OTP, full RBAC matrix, multi-tenancy, `enforce_consent()` isolated-session pattern, SHA-256 audit hash chain, threat model | A1, A7 |
| **10** | [10-mock-services-and-seed-data.md](10-mock-services-and-seed-data.md) | 7 simulated DPI APIs, chaos controls, synthetic `99900-*` rules, 9 personas, 60+ historical & 6 showcase cases, mock CNIC/QR generator, labelled eval datasets | A3, A2, A4, A7 |
| **11** | [11-ux-accessibility-offline.md](11-ux-accessibility-offline.md) | Citizen PWA (≤ 150 KB, Urdu RTL, icon+audio wizard), Helper Mode safe switcher, Workbox + Dexie offline outbox, Officer/Admin/Auditor/Eval/Device-Sim UI specs | A5, A6 |
| **12** | [12-execution-plan.md](12-execution-plan.md) | 48-hour phase schedule (PKT), critical path, checkpoints C1–C5, explicit scope cut rules, merge discipline | Integration Lead + All |
| **13** | [13-testing-and-quality.md](13-testing-and-quality.md) | Test pyramid, mandatory negative security/AI assertions, CI verification gate, Definition of Done | A7 + All |
| **14** | [14-agent-playbooks.md](14-agent-playbooks.md) | Copy-pasteable per-agent briefs (A1–A7): exact owned/forbidden paths, ordered tasks, handoff contracts | Integration Lead + A1–A7 |
| **15** | [15-demo-and-submission.md](15-demo-and-submission.md) | 8-minute live demo choreography, Real vs Simulated table, judge Q&A defence, submission checklist | Integration Lead, A7 |
| **16** | [16-traceability-matrix.md](16-traceability-matrix.md) | 100 % mapping from every PDF requirement → Feature → Spec → Owner → Test | Integration Lead, A7 |
| **17** | [17-decision-log.md](17-decision-log.md) | ADRs 001–022 justifying every frozen architectural choice + change-control process | Everyone |
| **18** | [18-rubric-traceability.md](18-rubric-traceability.md) | All 21 scoring criteria / 100 points → mechanism → file → reproduce command | Integration Lead, A7 |

---

## Fast Reading Paths by Agent

- **A1 (Core Backend):** `AGENTS.md` → `03` → `04` → `05` → `09` → `14 (A1)`
- **A2 (Engine & Case Agent):** `AGENTS.md` → `04 (§3, §5)` → `06` → `07 (§7–8)` → `08` → `14 (A2)`
- **A3 (Mocks & Seed Data):** `AGENTS.md` → `04 (§4.6)` → `05 (§3.11)` → `10` → `14 (A3)`
- **A4 (AI Services):** `AGENTS.md` → `05 (§3.3, §3.9)` → `07` → `08` → `14 (A4)`
- **A5 (Citizen & Helper PWA):** `AGENTS.md` → `02` → `05` → `11 (§1–5)` → `14 (A5)`
- **A6 (Staff Consoles):** `AGENTS.md` → `02` → `05` → `11 (§6)` → `14 (A6)`
- **A7 (QA, DevOps & Demo):** `AGENTS.md` → `03` → `12` → `13` → `15` → `16` → `14 (A7)`
