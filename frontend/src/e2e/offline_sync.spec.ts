import { expect, test } from '@playwright/test';
import { demoLogin, passConsentGate, tapDigits, uploadDoc, useEnglish, wizardNext } from './helpers';

/**
 * Offline truth - docs/11 §5, AC-10.x.
 *
 * The wizard must survive a dropped connection: drafts autosave to IndexedDB on
 * every step, the submit queues in the Dexie outbox with a client-generated
 * Idempotency-Key, and the replay on reconnect lands exactly once.
 *
 * The case is created while online (the outbox deliberately does not template
 * paths for a not-yet-existing case), then the connection is cut for the rest of
 * the wizard and the submit.
 */

async function outboxCount(page: import('@playwright/test').Page): Promise<number> {
  return page.evaluate(async () => {
    const open = indexedDB.open('haqdaar');
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    if (!db.objectStoreNames.contains('outbox')) return -1;
    const tx = db.transaction('outbox', 'readonly');
    const count = tx.objectStore('outbox').count();
    return await new Promise<number>((resolve) => {
      count.onsuccess = () => resolve(count.result);
      count.onerror = () => resolve(-1);
    });
  });
}

test('offline sync: submit queues offline and replays exactly once', async ({ page, context }) => {
  await demoLogin(page, 'widow_fatima');
  await useEnglish(page);

  await page.goto('/c/apply/new');
  await expect(page.locator('[data-testid="wizard"]')).toBeVisible();
  await passConsentGate(page);

  // Fill the first answer online so the case exists server-side before we cut
  // the connection.
  await page.locator('#full-name').fill('Fatima Bibi');
  await wizardNext(page);
  await expect(page.locator('[data-testid="wizard"]')).toHaveAttribute('data-step', 'applicant_cnic');

  // ---- go offline -----------------------------------------------------------
  await context.setOffline(true);

  await tapDigits(page, '9990010000012');
  await wizardNext(page);

  await page.getByRole('button', { name: '1965', exact: true }).click();
  await wizardNext(page);

  await page.locator('#spouse-name').fill('Muhammad Ramzan');
  await wizardNext(page);

  await page.getByRole('button', { name: /don't know|مجھے نہیں معلوم/i }).click();
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

  // Documents cannot reach the server offline - the wizard keeps the compressed
  // photo on the phone and queues the upload, so the submit still goes through.
  await expect(page.locator('[data-testid="wizard"]')).toHaveAttribute('data-step', 'cnic_doc');
  await uploadDoc(page, 'cnic');
  await expect(page.locator('[data-testid="wizard-next"]')).toBeEnabled({ timeout: 30_000 });
  await wizardNext(page);

  await expect(page.locator('[data-testid="wizard"]')).toHaveAttribute('data-step', 'death_cert_doc');
  await uploadDoc(page, 'deathCertificate');
  await expect(page.locator('[data-testid="wizard-next"]')).toBeEnabled({ timeout: 30_000 });
  await wizardNext(page);

  // ---- submit while offline -------------------------------------------------
  await expect(page.locator('[data-testid="wizard"]')).toHaveAttribute('data-step', 'review');
  await page.locator('[data-testid="wizard-submit"]').click();

  // The citizen is told the application is saved on the phone and will be sent
  // automatically - never a dead end.
  await expect(page.getByText(/saved|queued|محفوظ|بھیج دیا جائے گا/i).first()).toBeVisible({ timeout: 30_000 });

  // The outbox holds at least one row.
  expect(await outboxCount(page)).toBeGreaterThan(0);

  // ---- reconnect ------------------------------------------------------------
  const [submission] = await Promise.all([
    page.waitForResponse(
      (response) =>
        /\/api\/v1\/cases\/[^/]+\/submit$/.test(response.url()) &&
        response.request().method() === 'POST' &&
        response.ok(),
      { timeout: 90_000 },
    ),
    context.setOffline(false),
  ]);
  const { reference_code: referenceCode } = (await submission.json()) as { reference_code: string };
  expect(referenceCode).toMatch(/^HQ-2026-\d{6}$/);

  // The outbox drains: the queued row count returns to zero.
  await expect.poll(() => outboxCount(page), { timeout: 90_000, intervals: [1000, 2000, 3000] }).toBe(0);

  // The replayed application appears exactly once in the citizen's case list.
  await page.goto('/c/cases');
  await expect(page.getByText(referenceCode, { exact: true })).toHaveCount(1, { timeout: 30_000 });
});
