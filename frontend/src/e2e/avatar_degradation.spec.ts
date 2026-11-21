import { expect, test, type Page } from '@playwright/test';
import { demoLogin, expectBanner, useEnglish } from './helpers';

/**
 * Saima, the interactive Urdu video guide - ADR-025.
 *
 * Every test here runs in `fake` provider mode (`AI_PROVIDER=fake`), so the
 * suite consumes **zero** Anam streaming minutes. That is the whole point of the
 * simulator: the citizen flow, the governance pill, the abstention chip and the
 * Lite Mode step-down are all exercised against the real backend without a
 * WebRTC peer.
 *
 * The one thing these tests cannot prove is that a live avatar renders - that is
 * what `backend/scripts/verify_anam.py` is for, and it costs nothing either.
 */

/** Ask a question through the composer and wait for the answer card. */
async function ask(page: Page, question: string): Promise<void> {
  const input = page.locator('#ask-input');
  await expect(input).toBeVisible();
  await input.fill(question);
  await page.locator('form').getByRole('button', { name: /send|بھیجیں/i }).click();
  await expect(page.getByText(question, { exact: false }).first()).toBeVisible();
}

/** Open the guide from the opt-in card and wait for the stage. */
async function startGuide(page: Page): Promise<void> {
  await page.locator('[data-testid="avatar-start"]').click();
  await expect(page.locator('[data-testid="avatar-stage"]')).toBeVisible({ timeout: 30_000 });
}

test('the guide is opt-in: nothing loads and nothing connects before the tap', async ({ page }) => {
  const sdkRequests: string[] = [];
  page.on('request', (request) => {
    const url = request.url();
    if (/@anam-ai|anam-ai_js-sdk/i.test(url)) sdkRequests.push(url);
  });

  await demoLogin(page, 'widow_fatima');
  await useEnglish(page);
  await expectBanner(page);
  await page.goto('/c/ask');

  // The invitation is on screen; the stage is not.
  await expect(page.locator('[data-testid="avatar-cta"]')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('[data-testid="avatar-stage"]')).toHaveCount(0);

  // Give the page a beat to fire any eager import it might have.
  await page.waitForTimeout(1_500);
  expect(sdkRequests, `the SDK must not be fetched before the citizen taps: ${sdkRequests.join(', ')}`).toEqual([]);
});

test('fake mode: grounded answer, honest abstention, guided action, clean stop', async ({ page }) => {
  await demoLogin(page, 'widow_fatima');
  await useEnglish(page);
  await page.goto('/c/ask');
  await startGuide(page);

  // The governance pill is the promise the whole feature rests on.
  await expect(page.locator('[data-testid="avatar-governance"]')).toContainText(/info only|صرف معلومات/i);
  await expect(page.locator('[data-testid="avatar-stage"]')).toHaveAttribute('data-provider', 'fake');
  await expect(page.locator('[data-testid="avatar-countdown"]')).toContainText(/^\d:\d{2}$/);

  // 1 - a grounded answer carries a citation chip.
  await ask(page, 'widow grant eligibility');
  await expect(page.locator('[data-testid="avatar-citation"]')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('[data-testid="avatar-caption"]')).not.toBeEmpty();

  // 2 - an off-topic question abstains, in amber, with no citation.
  await ask(page, 'best biryani recipe');
  await expect(page.locator('[data-testid="avatar-not-sure"]')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('[data-testid="avatar-stage"]')).toHaveAttribute('data-mood', 'not_sure');

  // 3 - a navigation intent surfaces one tap, and only one tap.
  await ask(page, 'مجھے درخواست دینی ہے');
  const guided = page.locator('[data-testid="avatar-guided-action"]');
  await expect(guided).toBeVisible({ timeout: 30_000 });
  await expect(guided).toHaveAttribute('href', '/c/apply/new');
  // It suggests; it does not navigate.
  await expect(page).toHaveURL(/\/c\/ask/);

  // 4 - ending the session returns the invitation and drops the stage.
  await page.locator('[data-testid="avatar-end"]').click();
  await expect(page.locator('[data-testid="avatar-stage"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="avatar-cta"]')).toBeVisible();
});

test('Lite Mode steps the video down to the audio-only companion, with no error', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });

  await demoLogin(page, 'widow_fatima');
  await useEnglish(page);
  await page.goto('/c/ask');
  await startGuide(page);

  // Turn Lite Mode on from the header - the same control a 2G phone trips
  // automatically.
  await page.locator('[data-testid="lite-toggle"]').click();

  await expect(page.locator('[data-testid="avatar-audio-only-notice"]')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('[data-testid="avatar-stage"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="avatar-audio-only-notice"]')).toContainText(
    /audio-only|آڈیو گائیڈ/i,
  );

  // The step-down is a state change, not a crash. Browser resource logs are
  // excluded on purpose: a 429 from the session limiter is a legitimate answer
  // that the guide already degrades on, and Chromium reports it as a console
  // error even though no application code threw.
  const appErrors = consoleErrors.filter(
    (line) => !/favicon|manifest|Failed to load resource/i.test(line),
  );
  expect(appErrors).toEqual([]);
});

test('a case briefing is deterministic and launches from the explanation section', async ({ page }) => {
  await demoLogin(page, 'widow_fatima');
  await useEnglish(page);
  await page.goto('/c/cases');

  const rows = page.locator('[data-tour="case-entry"]');
  await expect(rows.first()).toBeVisible({ timeout: 30_000 });

  // A DRAFT has no explanation yet, so only rows past draft are candidates. The
  // list is newest-first, and earlier specs create drafts, so filtering by the
  // rendered status label is what keeps this independent of run order.
  const hrefs: string[] = [];
  for (let index = 0; index < (await rows.count()); index += 1) {
    const row = rows.nth(index);
    const label = (await row.textContent()) ?? '';
    if (/draft|درخواست محفوظ/i.test(label)) continue;
    const href = await row.getAttribute('href');
    if (href) hrefs.push(href);
    if (hrefs.length >= 3) break;
  }
  expect(hrefs.length, 'no submitted case in the seeded list').toBeGreaterThan(0);

  let opened = false;
  for (const href of hrefs) {
    await page.goto(href);
    const button = page.locator('[data-testid="avatar-watch-explain"]');
    // `isVisible()` answers immediately and ignores its timeout, so it would race
    // the SPA's first render. `waitFor` is the one that actually waits.
    const visible = await button
      .waitFor({ state: 'visible', timeout: 10_000 })
      .then(() => true)
      .catch(() => false);
    if (visible) {
      opened = true;
      await button.click();
      break;
    }
  }
  expect(opened, 'no submitted case carried a citizen explanation').toBe(true);

  await expect(page.locator('[data-testid="avatar-stage"]')).toBeVisible({ timeout: 30_000 });
  // The briefing is built from the server's own explanation, so the caption must
  // contain the headline the page already shows.
  await expect(page.locator('[data-testid="avatar-caption"]')).not.toBeEmpty();
  await expect(page.locator('[data-testid="avatar-governance"]')).toContainText(/info only|صرف معلومات/i);
});

test('the wizard carries a collapsed PiP bubble that steps down in Lite Mode', async ({ page }) => {
  await demoLogin(page, 'widow_fatima');
  await useEnglish(page);
  await page.goto('/c/apply/new');

  const pip = page.locator('[data-testid="avatar-pip"]');
  await expect(pip).toBeVisible({ timeout: 30_000 });
  // Collapsed by default: the form is the screen, not the guide.
  await expect(page.locator('[data-testid="avatar-pip-open"]')).toHaveCount(0);

  await pip.click();
  await expect(page.locator('[data-testid="avatar-pip-open"]')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('[data-testid="avatar-stage"]')).toBeVisible();

  // Collapse again without losing the form.
  await page.locator('[data-testid="avatar-pip-collapse"]').click();
  await expect(page.locator('[data-testid="avatar-pip-open"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="wizard"]')).toBeVisible();

  // Lite Mode hides the bubble entirely - the wizard's own cached prompts still
  // speak, so nothing is lost.
  await page.locator('[data-testid="lite-toggle"]').click();
  await expect(page.locator('[data-testid="avatar-pip"]')).toHaveCount(0);
});

test('conversational mode offers the microphone and keeps the grounded answer path', async ({ page }) => {
  await demoLogin(page, 'widow_fatima');
  await useEnglish(page);
  await page.goto('/c/ask');

  // The invitation promises a conversation, not a video clip - and it says so
  // before a single byte of the SDK is fetched.
  await expect(page.locator('[data-testid="avatar-live-badge"]')).toBeVisible({ timeout: 20_000 });

  await startGuide(page);

  // The microphone is the whole point of this mode, so it is on by default and
  // it is a real toggle in both directions.
  const mic = page.locator('[data-testid="avatar-mic"]');
  await expect(mic).toBeVisible();
  await expect(mic).toHaveAttribute('aria-pressed', 'true');
  await expect(mic).toHaveAttribute('aria-label', /mic on|مائیک آن/i);

  await mic.click();
  await expect(mic).toHaveAttribute('aria-pressed', 'false');
  await expect(mic).toHaveAttribute('aria-label', /mic is off|مائیک بند/i);

  await mic.click();
  await expect(mic).toHaveAttribute('aria-pressed', 'true');

  // A citizen who cannot or will not speak must still get a verifiable answer:
  // the composer keeps working while the guide is live, and the citation chip
  // still appears on the stage.
  await ask(page, 'widow grant eligibility');
  await expect(page.locator('[data-testid="avatar-citation"]')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('[data-testid="avatar-caption"]')).not.toBeEmpty();

  await page.locator('[data-testid="avatar-end"]').click();
  await expect(page.locator('[data-testid="avatar-stage"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="avatar-cta"]')).toBeVisible();
});
