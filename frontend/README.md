# Haqdaar frontend (prototype)

React 18 + Vite 5 + TypeScript + Tailwind PWA. One app, two speeds:

| Surface | Routes | Notes |
|---|---|---|
| Citizen & helper PWA | `/login`, `/c/*`, `/h/*`, `/scam-check`, `/transparency` | Urdu RTL by default, audio on every screen, offline outbox, entry bundle ~126 KB gz (budget 150) |
| Staff consoles | `/staff/*`, `/admin/*`, `/auditor/*` | Lazy-loaded chunk, English, dark theme toggle |

## Run

```bash
npm install
npm run dev        # proxies /api, /mock, /health to http://127.0.0.1:8000 (FastAPI)
npm run dev:mock   # no backend needed: in-browser simulated backend following docs/05
npm run typecheck
npm run build
```

`dev:mock` patches `fetch` for `/api/v1/*` and `/mock/v1/*` with a TypeScript port of the
decision engine (docs/06), seeded personas, queue cases, 60 historical cases for the Digital
Twin, consent enforcement, four-eyes, and a SHA-256 audit chain. It is never part of a normal
build. Use it for UI work, Playwright runs, and as a last-resort offline demo.

## Where things live

- `src/shared/api` typed client + one function per endpoint (Idempotency-Key, ETag, X-Act-For-Citizen, refresh)
- `src/shared/offline` Dexie DB + ordered outbox (exactly-once replay, placeholder case ids for offline create)
- `src/shared/i18n` Urdu/English dictionary · `src/shared/audio.ts` MP3 → TTS → speechSynthesis fallback
- `src/citizen` home, 14-step wizard, status, consent center, my data, scam checker, Q&A
- `src/helper` roster, safe switch interstitial, add family + consent capture
- `src/staff` officer queue/review, rule editor + Digital Twin, auditor, eval, analytics, admin ops, device simulator

Audio clips are loaded from `public/audio/ur/<clip>.mp3` (owned by A4); missing clips fall back to speech synthesis.
