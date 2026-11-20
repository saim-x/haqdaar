import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { demoLogin, useEnglish } from './helpers';

/**
 * Helper Mode + consent withdrawal — docs/11 §4, AC-13.2, AC-11.2.
 *
 * Ayesha switches to Fatima on a shared phone. Fatima then withdraws the HELPER
 * grant from her own device. The helper's very next read must be refused with
 * `403 CONSENT_REVOKED` and must render a zero-PII lock screen — no name, no
 * CNIC, no case reference.
 *
 * The seeded HELPER grant is single-use: once withdrawn it stays withdrawn, so
 * the spec arranges its own precondition through the real consent-OTP flow
 * (helper asks → simulated SMS → citizen code) and restores it afterwards. That
 * keeps the suite re-runnable and leaves the demo stack as it found it.
 */

const API = '/api/v1';
const MOCK = '/mock/v1';
const FATIMA_PHONE = '+923001000001';

async function token(request: APIRequestContext, personaKey: string): Promise<string> {
  const res = await request.post(`${API}/auth/demo-login`, { data: { persona_key: personaKey } });
  expect(res.ok(), `demo-login ${personaKey}`).toBeTruthy();
  return (await res.json()).access_token as string;
}

async function fatimaConsentStatus(request: APIRequestContext, helperToken: string): Promise<string> {
  const res = await request.get(`${API}/helper/families`, { headers: { Authorization: `Bearer ${helperToken}` } });
  const body = await res.json();
  const items: Array<{ citizen_id?: string; id?: string; full_name: string; consent_status: string }> =
    body.items ?? body;
  const fatima = items.find((f) => f.full_name.startsWith('Fatima'));
  expect(fatima, 'Fatima is on Ayesha’s roster').toBeTruthy();
  return fatima!.consent_status;
}

/** Drive the witnessed consent-OTP flow so the HELPER grant is ACTIVE again. */
async function grantHelperConsent(request: APIRequestContext): Promise<void> {
  const helperToken = await token(request, 'helper_ayesha');
  const auth = { Authorization: `Bearer ${helperToken}` };

  const families = await request.get(`${API}/helper/families`, { headers: auth });
  const items: Array<{ citizen_id?: string; id?: string; full_name: string }> =
    (await families.json()).items ?? [];
  const fatima = items.find((f) => f.full_name.startsWith('Fatima'));
  expect(fatima, 'Fatima is on Ayesha’s roster').toBeTruthy();
  const citizenId = fatima!.citizen_id ?? fatima!.id!;

  const otp = await request.post(`${API}/helper/families/${citizenId}/consent-otp`, {
    headers: { ...auth, 'Idempotency-Key': crypto.randomUUID() },
    data: {},
  });
  expect(otp.ok(), 'consent-otp').toBeTruthy();
  const challengeId = (await otp.json()).challenge_id as string;

  const inbox = await request.get(`${MOCK}/sms/inbox/${encodeURIComponent(FATIMA_PHONE)}`, { headers: auth });
  const messages: Array<{ body_en: string }> = (await inbox.json()).messages ?? [];
  const code = messages
    .map((m) => /(\d{6})/.exec(m.body_en)?.[1])
    .find((c): c is string => Boolean(c));
  expect(code, 'the simulated SMS carries a 6-digit consent code').toBeTruthy();

  const verify = await request.post(`${API}/helper/families/${citizenId}/consent-verify`, {
    headers: { ...auth, 'Idempotency-Key': crypto.randomUUID() },
    data: { challenge_id: challengeId, code },
  });
  expect(verify.ok(), 'consent-verify').toBeTruthy();
}

/** Withdraw the HELPER grant from the citizen's own Consent Center. */
async function withdrawHelperGrant(page: Page): Promise<void> {
  await page.goto('/c/consent');
  const card = page.locator('li', { hasText: /Ayesha Khatoon/i }).first();
  await expect(card).toBeVisible({ timeout: 30_000 });
  await card.getByRole('button', { name: /withdraw access|اجازت واپس لیں/i }).click();

  const dialog = page.locator('[role="dialog"]');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: /withdraw access|اجازت واپس لیں/i }).click();
  await expect(dialog).toBeHidden({ timeout: 30_000 });
}

test('helper consent: withdrawal locks the helper out with zero PII', async ({ page, browser, request }) => {
  // ---- arrange: the HELPER grant must be live before we can withdraw it ------
  if ((await fatimaConsentStatus(request, await token(request, 'helper_ayesha'))) !== 'ACTIVE') {
    await grantHelperConsent(request);
  }

  // ---- helper device --------------------------------------------------------
  await demoLogin(page, 'helper_ayesha');
  await useEnglish(page);
  await expect(page).toHaveURL(/\/h/);

  // Switch to Fatima. The switch wipes the previous family's cached data and
  // shows a full-screen interstitial before anything of hers is rendered.
  const fatimaCard = page.getByRole('button', { name: /Fatima Bibi/i }).first();
  await expect(fatimaCard).toBeVisible();
  await fatimaCard.click();

  const continueBtn = page.getByRole('button', { name: /continue|جاری رکھیں/i }).first();
  await expect(continueBtn).toBeVisible();
  await continueBtn.click();
  await expect(page).toHaveURL(/\/c$/);

  // The citizen strip names whose data is on screen.
  await expect(page.getByText(/Fatima Bibi/i).first()).toBeVisible();

  // Her case list is readable while consent is active.
  await page.goto('/c/cases');
  await expect(page.getByText(/HQ-2026-\d{6}/).first()).toBeVisible({ timeout: 30_000 });

  // ---- citizen device: withdraw the HELPER grant ----------------------------
  const citizenContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const citizen = await citizenContext.newPage();
  await demoLogin(citizen, 'widow_fatima');
  await useEnglish(citizen);
  await withdrawHelperGrant(citizen);

  // The grant moves to the withdrawn section on the citizen's own screen.
  await expect(citizen.getByText(/withdrawn/i).first()).toBeVisible({ timeout: 30_000 });

  // ---- helper device: the next read is refused ------------------------------
  await page.goto('/c/cases');

  // Zero PII inside the content area: no case reference, no citizen name. The
  // header strip still names whose session is active — that is the helper's own
  // roster entry and the affordance they need to switch away (docs/11 §4).
  const content = page.locator('main');
  await expect(page.locator('[data-testid="consent-revoked"]')).toBeVisible({ timeout: 30_000 });
  await expect(content.getByText(/HQ-2026-\d{6}/)).toHaveCount(0);
  await expect(content.getByText(/Fatima Bibi/i)).toHaveCount(0);

  await citizenContext.close();

  // ---- restore: leave the demo stack as we found it -------------------------
  await grantHelperConsent(request);
  expect(await fatimaConsentStatus(request, await token(request, 'helper_ayesha'))).toBe('ACTIVE');
});
