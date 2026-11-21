/**
 * Credit guard for the E2E suite - ADR-025.
 *
 * Playwright drives the real FastAPI app, so a developer whose `.env` carries a
 * real `ANAM_API_KEY` with `ANAM_ALLOW_LIVE_IN_FAKE_AI=true` would otherwise open
 * a real WebRTC session on every guide test and quietly spend the free tier.
 *
 * This refuses to run instead. The suite is only ever allowed to talk to the
 * zero-credit simulator, and the failure message says exactly how to get there.
 */

const API_BASE = process.env.E2E_API_URL ?? 'http://127.0.0.1:8000';

interface AvatarConfig {
  enabled?: boolean;
  provider?: string;
  mode?: string;
}

async function readAvatarProvider(): Promise<AvatarConfig | null> {
  const login = await fetch(`${API_BASE}/api/v1/auth/demo-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ persona_key: 'widow_fatima' }),
  });
  if (!login.ok) return null;
  const session = (await login.json()) as { access_token?: string; token?: string };
  const token = session.access_token ?? session.token;
  if (!token) return null;
  const config = await fetch(`${API_BASE}/api/v1/avatar/config`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!config.ok) return null;
  return (await config.json()) as AvatarConfig;
}

export default async function globalSetup(): Promise<void> {
  let config: AvatarConfig | null = null;
  try {
    config = await readAvatarProvider();
  } catch {
    // The backend is not up yet. The specs themselves will report that clearly;
    // this guard only exists to stop a live session, not to replace that error.
    return;
  }
  if (!config) return;
  if (config.provider !== 'anam') return;

  throw new Error(
    [
      '',
      'Refusing to run the E2E suite: the backend is serving a LIVE Anam avatar.',
      '',
      `  GET /api/v1/avatar/config -> provider=${config.provider} mode=${config.mode}`,
      '',
      'Every guide spec would open a real WebRTC session and spend free-tier',
      'streaming minutes. Restart the backend with the simulator forced:',
      '',
      '  ANAM_ALLOW_LIVE_IN_FAKE_AI=false python -m uvicorn app.main:app --port 8000',
      '',
      'or set ANAM_ALLOW_LIVE_IN_FAKE_AI=false in the root .env before running e2e.',
      '',
    ].join('\n'),
  );
}
