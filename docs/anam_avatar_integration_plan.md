# Anam.ai Interactive Urdu Video Guide ("Saima — Haqdaar Guide") — Master Plan v2 (Creative + Competition-Safe)

> **Product:** Haqdaar (حقدار) — Coder's Cup 2026 (*The Last Mile: AI on Public Rails*)
> **Persona:** **سائرہ — حقدار گائیڈ (Saima — Haqdaar Guide)**
> **Design Philosophy ("Best of Both Sides"):** Maximum **human warmth, creativity, visual wow-factor, and multimodal delight** for citizens & judges — **paired with ironclad architectural discipline** (zero hallucinated decisions, pure-Python policy engine untouched, ≤ 150 KB citizen initial JS bundle, bandwidth-aware Lite/Offline step-down, full RBAC/audit/telemetry, and zero-waste Anam free-tier credit management).

---

## 1. The "Best of Both Sides" Architecture

| Dimension | Grounded Discipline (Protects Core Score) | Creative Innovation (Maximizes Innovation + Accessibility + Video Wow) |
|---|---|---|
| **Conversation & Truth** | Policy engine (`app/engine/`) stays 100% pure Python; RAG keeps strict two-gate abstention (`NOT_SURE`); zero `AUTO_REJECT`; zero Anam LLM access to case state or PII. | **Two-Layer Saima Experience:** (1) Warm, empathetic Pakistani Urdu conversational reframing of grounded RAG answers (only when `status == "ANSWERED"`, with exact verbatim policy citations shown beneath) + natural, warm abstention on `NOT_SURE`; (2) **Voice-to-Action Guided Handoffs** (e.g., *"مجھے درخواست دینی ہے"* → Saima responds warmly AND presents a giant 1-tap action card to jump to Apply / My Cases / Consent / Scam Check). |
| **Voice & Lip-Sync** | Audio Passthrough (`enableAudioPassthrough: true`, `disableInputAudio: true`) — Anam never sees citizen PII or prompts. | Streams our **existing Deepgram Flux Pakistani Urdu voice (`flux-ambreen-ur`)** — both 73 pre-cached wizard MP3s AND dynamic `/voice/tts` — decoded in-browser via Web Audio API (`OfflineAudioContext` → 24 kHz mono `pcm_s16le`) for authentic Pakistani Urdu lip-sync! Includes `ANAM_MODE=talk` (`CUSTOMER_CLIENT_V1`) config switch as fallback. |
| **Visual Presence** | Strictly lazy-loaded (`React.lazy()` + dynamic `import('@anam-ai/js-sdk')`) so citizen initial JS bundle stays **≤ 150 KB gzipped** (`npm run budget` passes). | **Dynamic Visual State Halo** (Listening pulse / Thinking / Speaking / Honest `NOT_SURE` Amber / Anti-Scam Red Shield), **Synchronized Urdu Subtitle Bar**, **Picture-in-Picture (PiP) Wizard Bubble**, and **Smooth Seamless Session Renewal** (auto-warns before Anam's 180 s free-tier cap with 1-tap reconnect). |
| **Weak Internet / 2G** | Automatically reads `LiteModeProvider` (`saveData`/`2g`/`slow-2g`) & `OfflineProvider`. | **Live Adaptive Degradation Showcase:** Flipping `Lite Mode` or `Offline` smoothly morphs Saima's WebRTC stream into a crisp, zero-bandwidth **Audio-Only Companion Strip** using cached MP3s — turning a potential judge objection into a live proof of Challenge 07! |
| **Free-Tier Credits** | 30 min/mo, 3 min/session, 1 concurrent session on Anam Free Plan. | **Zero-Credit Local Simulator (`AI_PROVIDER=fake` / `ANAM_ENABLED=false`)** with animated speaking waveform avatar + local audio playback for all dev/CI/Playwright testing (0 Anam minutes used), plus **pre-flight verification script** (`verify_anam.py`) that verifies API key + avatar list without consuming streaming minutes. |

---

## 2. Four High-Impact Creative Citizen Surfaces (All Powered by One Lazy Engine)

### Surface 1 — **Saima Live Guide on `/c/ask`** ([AskPage.tsx](file:///E:/Projects/renaissance/coderscup/hackathon/frontend/src/citizen/AskPage.tsx))
- **Visual Stage:** Clean, rounded-card WebRTC video player (`16:9` / compact portrait on mobile) with:
  - Top trust bar: `AI گائیڈ · صرف معلومات` (*AI Guide · Info Only — Does not decide*) + subtle session timer pill.
  - **Dynamic Status Ring/Halo:** Teal pulse (Listening), Soft amber shimmer (Thinking), Emerald wave (Speaking grounded answer), Amber shield (`NOT_SURE` honest abstention).
  - **Synchronized Live Caption Strip:** Shows the exact Urdu/Sindhi/English sentence Saima is speaking in Nastaliq typography.
  - **Guided Voice-to-Action Handoff Chips:** Lightweight deterministic intent detector (`detectGuideIntent()` in frontend/backend) spots navigation goals (*"درخواست دینی ہے / apply"*, *"کیس / status"*, *"اجازت / consent"*, *"سکیم / fake message"*) and surfaces a giant 48px+ 1-tap confirmation button right under Saima's response — Saima guides without ever silently mutating state!
  - **Spoken Urdu Reframing (Optional Grounded Layer):** When `POST /api/v1/rag/ask` returns `status === "ANSWERED"` and `conversational: true` is passed (additive optional param, default `false` so existing tests stay 100% unchanged!), backend optionally produces a short, warm, spoken-Urdu `spoken_summary` (≤ 280 chars) strictly constrained to the single retrieved citation chunk (never adding facts, never firing on `NOT_SURE`), while `answer` + `citations` keep the exact verbatim grounded text!

### Surface 2 — **Personal Decision Video Briefing on `/c/cases/:id`** ([CaseStatusPage.tsx](file:///E:/Projects/renaissance/coderscup/hackathon/frontend/src/citizen/CaseStatusPage.tsx))
- Next to the existing 🔊 button in the explanation section, add **"سائرہ سے ویڈیو میں سنیں (Watch Saima Explain)"**.
- Saima opens inline and delivers a **status-aware empathetic Urdu video briefing** using our pure deterministic explanation (`headline + top 3 reasons + next_step`):
  - `APPROVED` / `PAID`: Warm congratulatory tone + exact PKR amount + payment reassurance (*"مبارک ہو بہن..."*).
  - `NEEDS_INFO`: Gentle, encouraging coaching on exactly what document/info is needed.
  - `HUMAN_REVIEW` / `IN_REVIEW` / `PENDING_SECOND_APPROVAL`: Calm reassurance that **no automatic rejection happened** and a human officer is reviewing carefully.
  - `ON_HOLD_CONSENT`: Clear, respectful explanation that her data is locked because she paused permission, and how to re-enable it anytime.

### Surface 3 — **Floating Picture-in-Picture (PiP) Wizard Companion on `/c/apply/:caseId`** ([ApplyWizard.tsx](file:///E:/Projects/renaissance/coderscup/hackathon/frontend/src/citizen/ApplyWizard.tsx))
- A sleek, non-intrusive **floating circular avatar button** (bottom-start corner, RTL-aware, hidden in Lite Mode / Offline).
- When toggled ON, expands into a compact docked **PiP Video Guide Card** (collapsible with 1 tap) that automatically:
  1. **Lip-syncs every wizard step's pre-cached `/audio/ur/<step>.mp3` prompt** (decoded straight from Workbox cache → 24 kHz PCM → Anam — **zero backend TTS calls**!).
  2. **Speaks the mandatory voice readback confirmation** (*"آپ نے اٹھائیس ہزار روپے بتایا، کیا یہ درست ہے؟"*) face-to-face!
  3. **Delivers live face-to-face retake coaching** whenever `POST /documents` returns `NEEDS_RETAKE` (blurry CNIC photo) — Saima warmly coaches the citizen to steady the phone in good light!

### Surface 4 — **Anti-Scam Guardian Briefing on `/scam-check`** ([ScamCheckPage.tsx](file:///E:/Projects/renaissance/coderscup/hackathon/frontend/src/citizen/ScamCheckPage.tsx))
- **Strictly gated to authenticated `CITIZEN` / `HELPER` users** (anonymous public `/scam-check` stays audio-only to protect Anam free-tier minutes and keep RBAC clean).
- After a verdict (`LIKELY_SCAM`, `VERIFIED_OFFICIAL`, `CANNOT_TELL`, `LIKELY_SAFE`), signed-in users see **"سائرہ سے تفصیل سنیں (Ask Saima to Explain Verdict)"** — Saima explains the exact red flags or verified `HQ-XXXXX` match with a protective red/green/amber badge.

---

## 3. Exact Backend, Frontend & Invariant Specifications (`ADR-025`)

### Backend Components
1. **Settings (`backend/app/config.py` + `.env.example`):**
   - `anam_enabled: bool = False`
   - `anam_api_key: str = ""`
   - `anam_avatar_id: str = ""` *(auto-resolved from `GET /v1/avatars` if blank in live mode, cached in memory!)*
   - `anam_voice_id: str = ""` *(only used if `anam_mode == "talk"`)*
   - `anam_mode: Literal["passthrough", "talk"] = "passthrough"`
   - `anam_base_url: str = "https://api.anam.ai"`
   - `anam_max_session_seconds: int = 165` *(safely below 180 s free-tier cap)*
   - `anam_idle_timeout_seconds: int = 90`
2. **Service (`backend/app/ai/avatar.py`):**
   - `get_avatar_config()` — safe public-for-authed config payload (never exposes API key).
   - `resolve_default_avatar_id()` — if `ANAM_AVATAR_ID` is empty in live mode, queries `GET {anam_base_url}/v1/avatars` once, picks a female stock avatar (preferring `Cara` / `Layla` / `Mia` / first available), and caches it.
   - `create_avatar_session(db, user, surface, lang)` — exchanges `ANAM_API_KEY` at `POST {anam_base_url}/v1/auth/session-token` (`enableAudioPassthrough: true` in passthrough mode, or `llmId: "CUSTOMER_CLIENT_V1"` + `skipGreeting: true` in talk mode); logs `ai_telemetry` + `audit.record(db, action="avatar.session_created", ...)`; gracefully degrades to `{ available: false, fallback: "AUDIO_ONLY" }` on any network/quota/API error; in `AI_PROVIDER=fake` (or `ANAM_ENABLED=false` with `AI_PROVIDER=fake`) returns deterministic `{ available: true, provider: "fake", simulated: true }`.
3. **Router (`backend/app/api/v1/avatar.py`):**
   - `GET /api/v1/avatar/config` (`Depends(require_any_authenticated)`)
   - `POST /api/v1/avatar/session` (`Depends(require_roles(UserRole.CITIZEN, UserRole.HELPER))`, rate-limited 10/10 min per user via `check_avatar_limit` in `ratelimit.py`)
4. **Optional Grounded Spoken Reframing (`backend/app/api/v1/rag.py` & `backend/app/ai/rag.py`):**
   - Optional additive `spoken_summary` field returned when `conversational: true` is requested AND `status == "ANSWERED"`: strictly summarizes ONLY the retrieved citation chunk into warm, concise spoken Urdu (≤ 280 chars) with zero new claims; returns `None` on `NOT_SURE` (which uses Saima's honest abstention script). Zero breaking change to existing `/rag/ask` contract or tests!
5. **Transparency Lockstep (`backend/app/api/v1/transparency.py`, `docs/15-demo-and-submission.md`, `README.md`):**
   - Update row #6 of `COMPONENTS` (keeping `len(COMPONENTS) == 11` so `test_invariants.py` stays 100% green!) with authentic English + Urdu descriptions disclosing Anam.ai WebRTC Avatar with `fake` & Lite/Offline audio-only fallback.
6. **Pre-Flight Live Verification Script (`backend/scripts/verify_anam.py`):**
   - Validates `ANAM_API_KEY` against `GET /v1/avatars` and `POST /v1/auth/session-token` (token issuance only — **0 streaming minutes billed!**) and prints the chosen `avatarId` + status clearly.

### Frontend Components (Strict Lazy Isolation — ≤ 150 KB Initial Bundle)
1. **`frontend/src/shared/avatar/`:**
   - `types.ts` — shared TypeScript interfaces (`AvatarConfig`, `AvatarSession`, `AvatarMood`, `GuideAction`).
   - `pcmBridge.ts` — pure Web Audio API decoder/resampler (`AudioContext.decodeAudioData` → `OfflineAudioContext(1, frames, 24000)` → clamped `Int16Array` little-endian `pcm_s16le` → 4,800-byte 100 ms chunks on strict 2-byte boundaries → `audioInputStream.sendAudioChunk` + `endSequence`, with Urdu sentence splitting ≤ 500 chars and `AbortSignal` barge-in).
   - `intentRouter.ts` — deterministic Urdu/Sindhi/English guided-navigation intent detector returning 1-tap `GuideAction` chips (`apply`, `cases`, `consent`, `scam_check`, `my_data`).
   - `useAnamAvatar.ts` — dynamic `import('@anam-ai/js-sdk')`, session lifecycle, 90 s idle auto-disconnect, 165 s cap warning + 1-tap seamless `renew()`, unmount/`visibilitychange` cleanup, `interrupt()`, plus rich **zero-credit `fake` simulator mode** (renders animated photorealistic-style speaking avatar silhouette/waveform synced to real `<audio>` playback so dev/CI/Playwright work identically with 0 Anam credits!).
   - `AvatarStage.tsx` *(lazy-loaded)* — WebRTC `<video>` + fake-mode animated canvas fallback + mood halo + Nastaliq live caption bar + `AI گائیڈ · صرف معلومات` governance pill + citation/`NOT_SURE` chip + ≥48 px Mute / Stop / Renew controls.
   - `AvatarToggleCard.tsx` *(tiny < 1.5 KB static wrapper)* — checks `useLiteMode()`, `useOffline()`, and `/avatar/config`; shows smooth adaptive audio-only pill when Lite/Offline; lazily mounts `AvatarStage` on user tap.
   - `AvatarPiPBubble.tsx` *(tiny < 1.5 KB static wrapper)* — collapsible floating PiP guide trigger for `ApplyWizard.tsx`.
2. **Citizen Wiring:**
   - `AskPage.tsx` (Surface 1: Live Guide + spoken reframing + guided action chips + audio dedup).
   - `CaseStatusPage.tsx` (Surface 2: Empathetic deterministic decision briefing).
   - `ApplyWizard.tsx` (Surface 3: Floating PiP wizard prompt + readback + blurry-doc retake coaching).
   - `ScamCheckPage.tsx` (Surface 4: Authenticated Anti-Scam Guardian verdict briefing).
   - `dictionary.ts` + `sindhi.ts`: Full Urdu (`ur`), English (`en`), and Sindhi (`sd`) translations for all `avatar.*` keys.

---

## 4. Verification & Acceptance Criteria (All Must Pass Before Done)

1. **Backend Lint & Invariants:** `ruff check backend/app backend/tests` + `AI_PROVIDER=fake pytest backend/tests/test_invariants.py backend/tests/ai/test_avatar.py backend/tests/ai/test_rag.py -q`
2. **Full Backend Suite:** All 1,162+ existing tests plus all new avatar/conversational-RAG tests pass (`AI_PROVIDER=fake pytest backend/tests/ -q`).
3. **Frontend Typecheck & Strict Bundle Gate:** `npm --prefix frontend run typecheck && npm --prefix frontend run build && npm --prefix frontend run budget` — MUST pass **≤ 150 KB gzipped** with zero `@anam-ai/js-sdk` preload in `dist/index.html`!
4. **Playwright E2E Suite:** `avatar_degradation.spec.ts` passes (verifying collapsed initial render, Lite Mode / Offline adaptive degradation, fake-mode Q&A + `NOT_SURE` abstention + guided action chip, Case Status briefing, and Wizard PiP toggle).
5. **Live Anam Pre-Flight Check:** When `ANAM_API_KEY` is provided in `.env`, `python backend/scripts/verify_anam.py` succeeds cleanly (0 streaming minutes spent), confirming live token issuance & avatar availability!
