import { fileURLToPath } from 'node:url';
import { expect, type Page } from '@playwright/test';

/** Shared helpers for the Haqdaar e2e specs. */

export const PERSONA = {
  fatima: 'widow_fatima',
  rasool: 'shopkeeper_rasool',
  ayesha: 'helper_ayesha',
  sana: 'officer_sana',
  bilal: 'admin_bilal',
  nadia: 'auditor_nadia',
} as const;

const DEMO_DOCUMENTS = {
  cnic: 'fatima_cnic_genuine.jpg',
  deathCertificate: 'ghulam_rasool_death_cert_genuine.jpg',
} as const;

/** Matches the "I don't know" affordance in either language. */
export const DONT_KNOW = /don't know|مجھے نہیں معلوم/i;

/**
 * Log in through the demo persona list (the judge-facing affordance) and wait
 * for the prototype banner, which every route must carry (RULE-3).
 */
export async function demoLogin(page: Page, personaKey: string): Promise<void> {
  await page.goto('/login');
  const card = page.locator(`[data-persona="${personaKey}"]`);
  await expect(card.first()).toBeVisible();
  await card.first().click();
  // The banner also renders on /login, so wait for the redirect before asserting.
  await expect(page).not.toHaveURL(/\/login/);
  await expect(page.locator('[data-testid="prototype-banner"]')).toBeVisible();
}

/**
 * Switch the UI to English so selectors stay readable. The toggle's accessible
 * name is the localised "switch language" label, not the visible "EN".
 */
export async function useEnglish(page: Page): Promise<void> {
  const toggle = page.getByRole('button', { name: /English|switch language|زبان/i }).first();
  await toggle.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => undefined);
  if ((await page.locator('html').getAttribute('dir')) === 'ltr') return;
  if ((await toggle.count()) === 0) return;
  await toggle.click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
}

/** Read the wizard's current step name. */
export async function wizardStep(page: Page): Promise<string> {
  const wizard = page.locator('[data-testid="wizard"]');
  await expect(wizard).toBeVisible();
  return (await wizard.getAttribute('data-step')) ?? '';
}

/**
 * Clear the consent gate.
 *
 * The gate auto-skips when a live DEPARTMENT grant already exists, so the screen
 * can disappear on its own a beat after mount. Race the two outcomes instead of
 * reading the step once and clicking into a vanished button.
 */
export async function passConsentGate(page: Page): Promise<void> {
  const grant = page.locator('[data-testid="consent-grant"]');
  const nameStep = page.locator('[data-testid="wizard"][data-step="applicant_full_name"]');

  await Promise.race([
    grant.waitFor({ state: 'visible', timeout: 20_000 }),
    nameStep.waitFor({ state: 'visible', timeout: 20_000 }),
  ]).catch(() => undefined);

  // Re-check rather than trusting the race winner: the gate can unmount between
  // the two, and clicking a vanished button would hang until the test timeout.
  if (await nameStep.isVisible().catch(() => false)) return;
  if (await grant.isVisible().catch(() => false)) {
    await grant.click({ timeout: 5_000 }).catch(() => undefined);
  }
  await expect(nameStep).toBeVisible({ timeout: 30_000 });
}

/** Tap a digit on the on-screen keypad. */
export async function tapDigits(page: Page, digits: string): Promise<void> {
  const pad = page.locator('[data-testid="digit-pad"]');
  for (const digit of digits) {
    await pad.getByRole('button', { name: digit, exact: true }).click();
  }
}

/** Advance the wizard one step. */
export async function wizardNext(page: Page): Promise<void> {
  const next = page.locator('[data-testid="wizard-next"]');
  await expect(next).toBeEnabled();
  await next.click();
}

/** Assert the prototype banner is present on the current route (RULE-3). */
export async function expectBanner(page: Page): Promise<void> {
  await expect(page.locator('[data-testid="prototype-banner"]')).toBeVisible();
}

/**
 * Tap the camera button and hand the browser a file - the real user path, so the
 * wizard's own `pendingDocType` bookkeeping is exercised too.
 */
export async function uploadDoc(page: Page, document: keyof typeof DEMO_DOCUMENTS): Promise<void> {
  const specimen = new URL(`../../../backend/app/data/demo_docs/${DEMO_DOCUMENTS[document]}`, import.meta.url);
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByRole('button', { name: /take photo|take the photo again|تصویر/i }).first().click(),
  ]);
  await chooser.setFiles(fileURLToPath(specimen));
}

/** Fill the wizard from the name step through the payout phone, inclusive. */
export async function fillWizardToPhone(page: Page): Promise<void> {
  await expect(page.locator('[data-testid="wizard"]')).toHaveAttribute('data-step', 'applicant_full_name');
  await page.locator('#full-name').fill('Fatima Bibi');
  await wizardNext(page);

  await tapDigits(page, '9990010000012');
  await wizardNext(page);

  await page.getByRole('button', { name: '1965', exact: true }).click();
  await wizardNext(page);

  await page.locator('#spouse-name').fill('Muhammad Ramzan');
  await wizardNext(page);

  await page.getByRole('button', { name: DONT_KNOW }).click();
  await wizardNext(page);

  await page.getByRole('button', { name: /Thatta/i }).click();
  await wizardNext(page);

  for (let i = 0; i < 3; i += 1) await page.getByRole('button', { name: /one more|ایک زیادہ/i }).click();
  await wizardNext(page);

  for (let i = 0; i < 4; i += 1) await page.getByRole('button', { name: /one more|ایک زیادہ/i }).click();
  await wizardNext(page);

  await page.getByRole('button', { name: /20,000|20000|20 ہزار/i }).first().click();
  await wizardNext(page);

  await tapDigits(page, '3001000001');
  await wizardNext(page);
}
