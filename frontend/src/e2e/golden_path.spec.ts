import { expect, test } from '@playwright/test';
import {
  demoLogin,
  expectBanner,
  fillWizardToPhone,
  passConsentGate,
  tapDigits,
  uploadDoc,
  useEnglish,
  wizardNext,
} from './helpers';

/**
 * Golden path - docs/13 §3, AC-01.x.
 *
 * Fatima logs in with one tap, walks the 14-step wizard (one question per
 * screen, keypad + picture alternatives everywhere), uploads two documents,
 * reviews, and submits. The case must then appear on her status screen with a
 * server-supplied status string.
 *
 * Runs against the real backend: the case goes through the real pipeline, so the
 * assertion accepts any post-submit state rather than pinning APPROVED.
 */
test('golden path: Fatima applies for the widow grant end to end', async ({ page }) => {
  await demoLogin(page, 'widow_fatima');
  await useEnglish(page);
  await expectBanner(page);

  await page.goto('/c/apply/new');
  await expect(page.locator('[data-testid="wizard"]')).toBeVisible();

  // 1 - consent gate (auto-skips when a live DEPARTMENT grant already exists).
  await passConsentGate(page);

  // 2–11 - name, CNIC, DOB, spouse, district, counters, income, payout phone.
  await fillWizardToPhone(page);

  // 12 - CNIC photo
  await expect(page.locator('[data-testid="wizard"]')).toHaveAttribute('data-step', 'cnic_doc');
  await uploadDoc(page, 'cnic');
  await expect(page.locator('[data-testid="wizard-next"]')).toBeEnabled({ timeout: 30_000 });
  await wizardNext(page);

  // 13 - death certificate photo
  await expect(page.locator('[data-testid="wizard"]')).toHaveAttribute('data-step', 'death_cert_doc');
  await uploadDoc(page, 'deathCertificate');
  await expect(page.locator('[data-testid="wizard-next"]')).toBeEnabled({ timeout: 30_000 });
  await wizardNext(page);

  // 14 - review + submit
  await expect(page.locator('[data-testid="wizard"]')).toHaveAttribute('data-step', 'review');
  await page.locator('[data-testid="wizard-submit"]').click();

  // The confirmation carries the reference code the citizen will quote later.
  const reference = page.locator('[data-testid="wizard-reference"]');
  await expect(reference).toBeVisible({ timeout: 60_000 });
  const code = (await reference.textContent())?.trim() ?? '';
  expect(code).toMatch(/^HQ-2026-\d{6}$/);

  // The status screen lists the same case with a server-supplied status string
  // (docs/04 §3.3). The pipeline may still be running, so any state is accepted.
  await page.getByRole('button', { name: /my applications/i }).click();
  await expect(page.getByText(code).first()).toBeVisible({ timeout: 30_000 });
  await expectBanner(page);
});

test('citizen shell: every route carries the prototype banner', async ({ page }) => {
  await demoLogin(page, 'widow_fatima');
  for (const route of ['/c', '/c/cases', '/c/consent', '/c/my-data', '/c/ask', '/scam-check', '/transparency']) {
    await page.goto(route);
    await expectBanner(page);
  }
});

test('citizen shell: no horizontal scroll at 390x844', async ({ page }) => {
  await demoLogin(page, 'widow_fatima');
  for (const route of ['/c', '/c/cases', '/c/consent', '/c/my-data', '/c/ask', '/scam-check', '/transparency']) {
    await page.goto(route);
    await expectBanner(page);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `${route} overflows horizontally by ${overflow}px`).toBeLessThanOrEqual(1);
  }
});

test('citizen shell: Urdu is the default direction and the toggle flips to LTR', async ({ page }) => {
  await demoLogin(page, 'widow_fatima');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await useEnglish(page);
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
});

test('wizard: CNIC keypad groups digits XXXXX-XXXXXXX-X', async ({ page }) => {
  await demoLogin(page, 'widow_fatima');
  await useEnglish(page);
  await page.goto('/c/apply/new');
  await passConsentGate(page);
  await page.locator('#full-name').fill('Fatima Bibi');
  await wizardNext(page);
  await tapDigits(page, '9990010000012');
  await expect(page.getByText('99900-1000001-2')).toBeVisible();
});
