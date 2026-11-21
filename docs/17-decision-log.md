# 17 - Architectural Decision Records (ADR Log) & Change Control

> **Status:** FROZEN v1.0. Any deviation from Docs `01–16` during development MUST be appended here by the Integration Lead before merging code.

---

## ADR-001: Central Use Case - Cash-Relief Grant (Sahara Widow Support Grant)
- **Context:** Brief asks for one deep public task uniting the widow, shopkeeper, and helper personas.
- **Decision:** Build end-to-end widow benefit application → verification → decision → payment → anti-scam verification, with a second config-driven program (`Guzara Allowance`) proving multi-tenancy.
- **Rationale:** Directly exercises monetary cost-of-being-wrong, forged documents, messy registries, fake "relief payment" SMS, consent, and shared-phone helper workflows in one coherent narrative.

## ADR-002: LLM Proposes, Deterministic Policy Disposes
- **Context:** Temptation in AI hackathons to let an LLM decide eligibility and output a self-reported confidence score.
- **Decision:** Keep `app/engine/` 100 % pure Python with zero LLM calls; use LLMs/ML only for extraction, voice, OCR, scam scoring, and grounded RAG. Never implement `AUTO_REJECT`.
- **Rationale:** Guarantees deterministic replay (Digital Twin), verifiable rule hashes for auditors, calibrated threshold sweeps, immunity to prompt injection in decisions, and resilience if OpenAI fails during the live demo.

## ADR-003: Synchronous SQLAlchemy 2.0 + `psycopg` v3 (Over Async)
- **Context:** FastAPI supports both `async def` and sync `def` routes.
- **Decision:** Use synchronous SQLAlchemy 2.0 + `psycopg[binary]` in FastAPI `def` endpoints (executed in AnyIO threadpool).
- **Rationale:** Eliminates `MissingGreenlet` / detached-session / event-loop bugs across 7 parallel agents and integrates cleanly with Alembic, pytest, OpenCV, and scikit-learn.

## ADR-004: PostgreSQL `SKIP LOCKED` Job Queue (Over Celery + Redis)
- **Context:** Case processing, payments, RAG re-indexing, and mock-outage retries require background jobs.
- **Decision:** Store jobs in a PostgreSQL `jobs` table claimed via `SELECT ... FOR UPDATE SKIP LOCKED` by `app/jobs/worker.py` (with optional `RUN_EMBEDDED_WORKER=true` for simple single-container deploy).
- **Rationale:** Transactional enqueue in the same commit as case submit (zero lost jobs), zero Redis dependency to deploy or debug, and native Admin Jobs UI directly over the table.

## ADR-005: React 18 + Vite PWA With Route-Split Bundles (Over Next.js)
- **Context:** Challenge 07 requires true offline support and tiny pages for weak connections, while Staff Consoles need rich dashboards.
- **Decision:** Single Vite React TypeScript app with `vite-plugin-pwa` (Workbox) and `React.lazy` route splitting isolating `/staff/*`, `/admin/*`, `/auditor/*` from the ≤ 150 KB gzipped Citizen/Helper PWA bundle.
- **Rationale:** Clean offline app-shell caching without Next.js SSR/RSC hydration failures; smaller citizen JS footprint; single-origin static serving from FastAPI eliminates CORS/SameSite friction.

## ADR-006: Hybrid Postgres `tsvector` + NumPy Cosine RAG (Over `pgvector`/Chroma)
- **Context:** Need grounded RAG over ~5–15 policy documents (~150–400 chunks) without deployment fragility.
- **Decision:** Store embeddings in standard PostgreSQL `DOUBLE PRECISION[]` alongside `TSVECTOR` and compute hybrid ranking in Python/NumPy (< 15 ms).
- **Rationale:** Works out-of-the-box on every managed Postgres (Railway/Supabase/Docker) with zero custom extensions or external vector DB services.

## ADR-007: Signed-QR + OpenCV + OCR Document Verification (Over Tesseract-Only)
- **Context:** Document forgery detection (Challenge 08) must catch edited names without falsely accusing genuine WhatsApp-compressed photos.
- **Decision:** Use OpenCV Laplacian blur (`NEEDS_RETAKE`), `cv2.QRCodeDetector` + `HMAC-SHA256` signature check, and printed-text OCR cross-check against QR payload (`TAMPER_SUSPECTED`). Missing QR or low quality degrades to `UNVERIFIABLE` / `NEEDS_RETAKE`.
- **Rationale:** Avoids flaky OS binary installs (`tesseract`/`libzbar`), achieves `0 %` false-tamper rate on compressed genuine cards, and demonstrates cryptographic + AI defense-in-depth.

## ADR-008: Isolated DB Session for Denied Consent Access Logging
- **Context:** Raising HTTP `403 CONSENT_REVOKED` inside a FastAPI request normally triggers a SQLAlchemy transaction rollback, which would erase the `consent_access_logs` entry.
- **Decision:** `enforce_consent()` persists denied access rows and `consent.access_denied` audit events using a separate short-lived `SessionLocal()` commit before raising `ConsentRevokedError`.
- **Rationale:** Guarantees citizens and auditors immediately see blocked access attempts (Challenge 06).

## ADR-009: `AI_PROVIDER=live|fake` Dual Mode & Pre-Generated Static Urdu Prompts
- **Context:** Live demos can suffer OpenAI rate limits, latency spikes, or venue Wi-Fi issues; CI tests must be fast and free.
- **Decision:** Pre-generate ~45 static Urdu MP3 prompts (`ur-PK-UzmaNeural`) cached in the PWA; route all dynamic AI calls through `AIProvider` with automatic fallback to `FakeDeterministicProvider` and deterministic rule-template explanations.
- **Rationale:** Zero-latency offline audio for citizens, < 45 s deterministic CI tests, and an unbreakable live demo.

## ADR-010: Single Database With Strict Import Boundary for Mock DPI Services
- **Context:** Brief requires clean APIs for mock identity/payment/data services and a fast demo reset.
- **Decision:** Store `mock_*` tables in the same PostgreSQL instance for atomic `< 5 s` demo reset, but enforce via `test_invariants.py` that `app/api/`, `app/engine/`, and `app/agent/` NEVER import `app/mocks/` and call `/mock/v1/*` strictly over HTTP (`httpx`).
- **Rationale:** Full architectural separation + authentic HTTP chaos testing without managing a second database.

---

## ADR-011: Pinned Cross-Agent Helper Import Paths
- **Context:** The four-agent consolidation (BE/EN/DPI/FE) exchanges functions between owners; docs `14` names the functions but not module locations, which would desync parallel agents.
- **Decision (Integration Lead pins):** `app/notify.py::create_notification(...)` (BE); `app/jobs/handlers.py` maps job types to lazily-imported handlers: `PROCESS_CASE → app.agent.case_agent.run_case_agent(db, case_id, *, correlation_id=None)`, `CHECK_COMPLAINT → app.agent.case_agent.check_complaint_agent(db, case_id)`, `VERIFY_DOCUMENT → app.ai.doc_verify.verify_document(db, document_id)`, `REINDEX_RAG → app.ai.rag.reindex_program_rules(db, program_id)`; `app.ai.benchmarks.py::scam_metrics()/doc_metrics()` (DPI, consumed by `/eval/dashboard`); `app.engine.entity_resolution.py::name_sim(a, b)` (EN, consumed by doc_verify cross-check at threshold 0.80).
- **Rationale:** Zero-ambiguity integration; mismatches surface at the merge gate, not at runtime.

## ADR-012: OTP Delivery via `notifications` Row (Simulated SMS)
- **Context:** Doc `09` requires OTPs to be delivered to the simulated SMS inbox, but `notifications.verification_code` is UNIQUE and formatted `HQ-XXXXX` for official codes - it cannot safely hold arbitrary 6-digit OTPs (uniqueness collisions).
- **Decision:** `POST /auth/otp/request` additionally inserts a `notifications` row (`channel='SMS_SIMULATED'`, citizen `phone`, the 6-digit code inside `body_ur`/`body_en`); the `verification_code` column carries a unique generated `HQ-` code (not displayed as the OTP). `GET /mock/v1/sms/inbox/{phone}` reads these rows.
- **Rationale:** Keeps schema exactly per doc `04` while powering the Device Simulator; OTP plaintext never appears in logs.

## ADR-013: Single Whitelisted Import for Mock Chaos Administration
- **Context:** Invariant 4 forbids `app/api/` importing `app/mocks/models.py` or querying `mock_*` tables, yet doc `14` assigns `/api/v1/admin_mocks.py` (chaos controls + demo reset) to the mock owner.
- **Decision:** Mock service configuration is exposed only through functions in `app/mocks/config.py`; `tests/test_invariants.py` whitelists exactly one import pair: `app/api/v1/admin_mocks.py → app.mocks.config` (no `models`/`db`/session imports anywhere in `app/api/`). All case-flow modules remain strictly HTTP-only over `MOCK_BASE_URL`.
- **Rationale:** Preserves the automatable simulation boundary for the case pipeline while allowing platform-admin chaos control without HTTP gymnastics.

## ADR-014: Alembic Migration Ownership Split
- **Context:** BE owns models/migrations; DPI owns the `mock_*` ORM models - parallel migration chains would conflict.
- **Decision:** `backend/alembic/versions/` is BE-owned except exactly one mock-tables migration owned by DPI, whose `down_revision` is rebased onto BE's tip at merge time (coordinated by the Integration Lead).
- **Rationale:** Parallel work with a single linear migration history and zero chain conflicts.

## ADR-015: Mandatory Children-Count Rule (R09_CHILDREN_KNOWN) - Grant Never Auto-Approved with Provisional Amount
- **Context:** Agent EN's M0 review (Fri 20 Nov, ~21:50 PKT) exposed a spec gap: Sahara v1's 8 rules never reference `children_under_18`, so a case with UNKNOWN children could clear every rule and AUTO_APPROVE paying the provisional base PKR 12,000 - finalizing a payment on an amount known to be incomplete, contrary to the "no silent guessing" principle (SP-3). (Docs/06 §2.4 correctly withheld the child bonus, but no routing constraint prevented payment.)
- **Decision (Integration Lead, approved):** Add rule `R09_CHILDREN_KNOWN` (`fact: children_under_18`, `op: gte`, `value: 0`, `on_fail: HUMAN`, `on_unknown: ASK`, `required_for_auto: true`) to docs/06 §2.1 Sahara v1; DPI mirrors an equivalent children-known rule in the Guzara Allowance v1 seed. Any rule referencing a fact forces tri-state exposure: UNKNOWN children now routes ASK_MORE → (after 2 rounds) HUMAN_REVIEW - never AUTO_APPROVE. Provisional amounts remain visible to officers/AI notes only. Data-only fix using existing DSL semantics; zero engine or routing-order changes.
- Also recorded from the EN review: (a) docs/04 §5 has 20 fact keys, not 19 - the agent briefs said 19; the 20th (`citizen_has_active_dept_consent`) is non-tri-state; (b) `CNIC_NOT_IN_REGISTRY` (named in docs/06 §5.2) is a 13th HIGH anomaly code missing from the §6 table - implemented as HIGH; (c) canonicalization maps `"Mst. Fatima Bibi"` vs `"Fatima Bibi"` to similarity 1.0 (→ identity 0.98 band), not 0.93 as the §3.2 example implied - accepted: variant spelling is logged transparently in provenance, Fatima's golden path still auto-approves, and the 0.70–0.84 band is exercised by non-canonical pairs (e.g., "Zainab Bibi" vs "Zubaida Bibi" ≈ 0.77); (d) identity resolution of the Fatima canonicalization quantity is surfaced in the rule trace so officers/auditors see the raw→canonical mapping.

## ADR-016: Agent Consent-Gate Scope, Cross-Tenant Fraud Queries, and `rule.draft_updated` Audit Action
- **Context:** Agent EN's Phase-2 case-agent implementation requested Integration Lead confirmation of two readings that go beyond the letter of the docs, plus registration of one new audit action.
- **Decision (confirmed):**
  1. Case-agent step 1 (`verify_consent`) gates DEPARTMENT consent for exactly `IDENTITY`, `HOUSEHOLD`, `DOCUMENTS` (docs/07 §7 step 1 verbatim). Benefits-registry and shared-payout-alias lookups are cross-program/cross-citizen **fraud checks** under purpose `BENEFIT_APPLICATION` - not disclosures of the applicant's record to a third party - and surface only as risk flags. Selective category revocation conservatively halts the whole case (`ON_HOLD_CONSENT`), since step 1 blocks the pipeline.
  2. The shared-payout-alias anomaly query is deliberately **not tenant-scoped**: docs/06 §6's "distinct citizens" is a platform-wide fraud check (fraud rings span departments); tenant isolation still governs all tenant business-data reads, and the anomaly output discloses no other-tenant PII to officers - flag only.
  3. `rule.draft_updated` is added to the docs/09 §5.3 action set - that list is mandatory, not exhaustive; same-style additions are permitted.
- **Rationale:** Reading (1) is the verbatim spec; (2) honours the anti-fraud intent of E-7/docs/06 §6 while preserving PII minimisation and the anti-IDOR tenant rule; (3) is additive audit bookkeeping.

## ADR-017: Given-Name Protection in Name-Similarity Checks (Shared-Surname Populations)
- **Context:** DPI's evaluation set exposed that full-string token-set similarity lets a Photoshopped **given** name pass a 0.80 threshold whenever the surname is shared - the demo population heavily shares "Bibi" ("Zainab Bibi" vs "Sakina Bibi" = 0.818 on full string).
- **Decision (approved):** DPI's `doc_verify` printed-vs-QR cross-check uses `min(full_name_ratio, given_name_ratio)` after honorific stripping (verified samples: Zainab/Sakina 0.667, Fatima/Fatima 1.0, Mst. Fatima/Fatima 1.0, Muhammad/Mohammad Akram 0.875). EN evaluates adding the same guard to `entity_resolution.name_sim` adopted **iff** the full 25+ case regression suite stays green (golden path must remain 1.0). Also recorded: scam classifier adds `MIN_MEANINGFUL_WORDS = 5` alongside the spec's `< 15 chars` rule so "Bhai payment bhej dena" resolves to `CANNOT_TELL` per demo scene 3; RAG fake-mode embeddings are 64-dim per docs/04 §4.5 and `cosine` returns 0.0 (not truncated) on dimension mismatch.
- **Rationale:** Tamper and identity-jacking protection for a surname-colliding population; conservative direction - can only increase human review, never auto-approvals.

## ADR-018: Audio Prompt Registry - Canonical Manifest Shape and Key Names
- **Context:** FE (consumer) and DPI (producer) independently invented disjoint key names for the same Urdu prompts (FE `wizard_applicant_full_name`… vs DPI `step_full_name`…), and DPI shipped `manifest.json` as an envelope (`{voice, voice_alt, language, count, keys, files}`) while the pinned contract was a top-level `{key: text}` map. Result: had the two merged silently, every audio prompt in the UI would be a no-op.
- **Decision (Lead):** Canonical manifest = top-level `{key: text}` (+ optional `_meta` for voice/language data). Canonical key registry = **FE's 31 UI keys, DPI renames/retargets its texts accordingly and authors the missing 6 scam/home/intro texts** + DPI's extra keys retained (`status_*` ×16, `doc_*`/`retake_*` ×7, `readback_confirm`, `needs_retry`, `offline_saved`, `network_error`, `submit_confirm`, `consent_grant_confirm`, `consent_withdrawn`, `consent_required`, `unknown_ok`) for FE to adopt at status/doc-feedback/readback call sites (optional; silent-degrade unchanged). `tts_pregen` table updated to emit the merged registry.
- **Rationale:** The consumer's call sites define the contract; producer metadata moves under `_meta`; one artifact both agents trust. MP3 generation (blocked by edge-tts 403) is tracked separately by the Lead.

## ADR-019: `consent_access_logs.actor_user_id` Becomes Nullable
- **Context:** EN's S2 review found that the case agent (actor_type=AGENT, no user) makes `enforce_consent`-driven access-log inserts that violated the `actor_user_id` NOT NULL FK; the old `actor.user_id or uuid.UUID(int=0)` fallback wrote a sentinel that breached `fk_consent_access_logs_actor_user_id_users`, and the isolated-session handler swallowed the insert - so every consent access written by the agent was silently DROPPED. That silently destroys Challenge-06 evidence (invariant 5: every citizen-data read logs).
- **Decision (Integration Lead):** `consent_access_logs.actor_user_id` is NULLABLE (docs/04 §4.4 updated). `AGENT`/`SYSTEM` rows carry `actor_user_id = NULL` with `actor_role= 'AGENT'` and a descriptive `actor_label` (e.g. "Case Agent"), mirroring `audit_events.actor_id` semantics. BE ships the migration (down_revision = current head after the S2 merges) + model + code change; the sentinel-UUID fallback is removed.
- **Rationale:** RESTores the evidence chain for agent consent reads; aligns consent logging with the audit table's existing nullability pattern; no UI impact (citizen view filters on non-null label columns).

## ADR-020: `GET /me/data` Emits the docs/04 §5 Tri-State, and Reads the Flat `profile_data`
- **Context:** Two defects in the citizen self-data view, found while auditing the Urdu UI. (a) `me.py` built `household` from `profile_data["household"]`, a nested key the seed never writes - `profile_data` is flat, with the canonical fact keys directly on it - so **every** citizen's household came back `{}`. An empty household is not a neutral answer: it reads as "we hold nothing about you", the opposite of the truth for a seeded citizen. The existing test only asserted the group *existed*, which an empty dict satisfies. (b) `MyDataValue` was `{value, source}`, so the frontend inferred "unknown" from `value === null`. That is the tri-state invariant (AGENTS.md §3.3) being reconstructed on the client from a null, which is exactly the coercion the invariant forbids - and it cannot distinguish "you have not told us" from "a government service was down".
- **Decision (Integration Lead):** `GET /me/data` returns every `identity` and `household` value in the docs/04 §5 fact shape: `{state, value, source, missing_reason}`. `state` is strictly `KNOWN`/`UNKNOWN`; a `KNOWN` value carries a `source` and a null `missing_reason`, an `UNKNOWN` value carries null `value`/`source` and a `missing_reason` from `app.engine.facts.MissingReason`. Every canonical household key is emitted whether or not it is held, so a missing fact is stated rather than omitted. `household` is read from the flat `profile_data` keys. The frontend reads `state` and renders the reason; it no longer infers anything from `null`.
- **Rationale:** Restores the invariant at the boundary that owns it. The shape is the same one `decisions.input_snapshot_json` already uses, so there is one fact representation in the system rather than two. Additive for existing consumers: `value` and `source` keep their names and positions, and `source` becomes nullable only where it was already meaningless.

---

## ADR-021: Deepgram Flux for Static Urdu Prompt Generation
- **Context:** The pinned `edge-tts` generator returned no audio for either Urdu voice on the integration machine, leaving all 73 manifest prompts without MP3 files. The citizen PWA needs the clips for offline playback.
- **Decision (user-approved):** Generate the fixed Urdu prompt library with Deepgram Flux TTS batch REST (`flux-ambreen-ur`, MP3). Read `DEEPGRAM_API_KEY` from the ignored repository-root `.env` at generation time. Keep dynamic `/voice/tts` on the existing `AIProvider` and `edge-tts`; no API or database contract changes. Commit only generated audio and the manifest, never the key.
- **Rationale:** Deepgram documents an Urdu voice and batch MP3 output. Static clips remain available offline after generation. Review pronunciation before the demo, especially numbers because Urdu Flux is Early Access.

## ADR-022: RAG Chunks Are One Section, and Abstention Adds a Corpus-Coverage Gate
- **Context:** Two defects found by asking the live `/rag/ask` endpoint real questions. (a) `CHUNK_MIN_TOKENS = 300` merged two or three policy sections per chunk, and `CHUNK_OVERLAP_TOKENS = 50` prepended the previous chunk's tail to every chunk - so the chunk titled "3. Required Documents" opened with the tail of the eligibility list in Urdu. The heading stopped describing the content, and an extractive answer quoted the neighbour's text under this section's citation. (b) The abstention gate was a similarity threshold alone, so "what is the weather in Karachi tomorrow?" was answered: Karachi is a district in the eligibility list, one word of three matched, and the cosine cleared the bar.
- **Decision (Integration Lead):** `CHUNK_MIN_TOKENS` 300 → 60 and `CHUNK_OVERLAP_TOKENS` 50 → 0, so a chunk is exactly one section and its heading describes all of it. `rag.ask` gains a second, independent gate: `_corpus_coverage(question)` is the share of the question's content words that appear anywhere in the corpus, and below `MIN_CORPUS_COVERAGE = 0.5` the answer is `NOT_SURE` whatever the similarity score. `RagAnswer.coverage` is exposed in `POST /rag/ask` (docs/05 updated) so an abstention can be explained. The extractive answerer quotes one whole paragraph from one source, joins a lead-in ending in `:` to the list it introduces, and answers in the language that was asked.
- **Rationale:** A citation names a section, so a section is the unit a chunk must hold - otherwise the citation is a lie even when the retrieval score is high. Coverage and similarity answer different questions ("is this about our corpus?" vs "is some chunk similar?"), and only coverage is stable when chunk sizes change; measured over the corpus, in-domain questions cover 0.67–1.00 of their content words and off-topic ones 0.00–0.33.

## ADR-023: Deepgram Flux for Dynamic Urdu TTS
- **Context:** Dynamic `/voice/tts` used `edge-tts`, but Urdu synthesis returned no audio in the local environment. Missing or changed prompt clips therefore fell through to browser speech, which is not consistently available in Urdu.
- **Decision (user-approved):** In `AI_PROVIDER=live`, route dynamic Urdu TTS through Deepgram Flux batch REST (`POST /v2/speak`, `flux-ambreen-ur`, MP3), using the existing `DEEPGRAM_API_KEY`. Cache successful responses by voice and text. Keep the `/voice/tts` contract unchanged and retain fake-provider behavior in `AI_PROVIDER=fake`.
- **Rationale:** The same Urdu voice used for prerecorded clips now covers dynamic text. Deepgram's Flux catalog documents Urdu as Early Access, so write numbers and dates out when natural normalization is needed.
- **Source:** [Deepgram Flux voices and languages](https://developers.deepgram.com/docs/flux-tts/voices), [Deepgram batch Speak API](https://developers.deepgram.com/docs/flux-tts/batch).

## ADR-024: Urdu Renders in Nastaliq, and the Subset Keeps the Joining Features
- **Context:** Every Urdu string in the UI rendered letter-by-letter - "پروٹوٹائپ ڈیمو لاگ ان" came out as isolated glyphs, unreadable as a word. Root cause was in `frontend/scripts/build-fonts.py`: `Options.layout_features` listed only `kern, liga, calt, mark, mkmk, rlig`, so the subsetter dropped the Arabic contextual-joining features `init`/`medi`/`fina`/`isol`. The shipped `NotoSansArabic-subset.woff2` therefore carried `rlig` alone, and every letter could only ever take its isolated form. Nothing errored - the font loaded, the glyphs drew, the text was simply wrong. Verified by shaping the string with HarfBuzz: the old face moved 5.7 px between shaped and unshaped layout (mark positioning only), the corrected face 251.9 px (real ligature joining). Separately, the face was `Noto Sans Arabic`, a Naskh design that reads as Arabic rather than Urdu.
- **Decision (user-approved):** The Urdu face becomes **`Noto Nastaliq Urdu`** (variable `wght` 400–700, subset to the Arabic block + supplement, 194 KB WOFF2). `build-fonts.py` now lists `ccmp, locl, init, medi, fina, isol, rlig, rclt, calt, liga, mark, mkmk, curs, kern` explicitly. The type scale's leading moves to CSS variables (`--lh-*`) so `html[lang='ur']` - set by `I18nProvider` - claims ~1.9 leading for Nastaliq while the English UI keeps the tighter Latin rhythm. No component changed.
- **Rationale:** Nastaliq is the script Urdu is actually written in; its sloped baseline and stacked ligatures are what make a word read as a word. The joining features are not optional decoration - omitting them is a silent correctness bug, so they are now named explicitly in the build script rather than inherited from a default. The leading is scoped to `lang='ur'` because Nastaliq's descenders sit far below the baseline and would otherwise collide with the next line's marks. Cost: the Urdu face grows 26 KB → 194 KB, which is inherent to Nastaliq (a glyph per positional form and per common ligature) and does not count against the 150 KB JS budget; the gate still passes at 131.2 KB.
- **Supersedes:** A parallel fix for the same joining bug landed on `main` first, keeping `Noto Sans Arabic` and widening `layout_features` to `["*"]`. That fixed the correctness defect but left the face as Naskh. This ADR keeps the correctness fix (the joining features are now named explicitly, and `subset(..., preserve_shaping=True)` is the only path that can produce the Urdu face) and changes the design to Nastaliq. `NotoSansArabic-subset.woff2` is removed; nothing else referenced it.

## Change Control Protocol (During Hackathon)
1. Minor bug fixes within a single agent's owned files need no ADR.
2. Any change to a DB column (`04`), API contract (`05`), canonical fact key (`04 §5`), or routing threshold (`06`) MUST be proposed to the Integration Lead, updated in the relevant doc, and logged as `ADR-011+` here before merging.
