import { expect, test } from '@playwright/test';
import { demoLogin, PERSONA } from './helpers';

test('citizen tour keeps its step number across pages and reloads', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('haqdaar.lang.v1', 'en');
    localStorage.setItem('haqdaar.autoread.v1', 'false');
  });
  await page.route('**/api/v1/voice/tts', (route) => route.fulfill({ status: 503 }));
  await demoLogin(page, PERSONA.fatima);
  await page.getByRole('button', { name: 'Take a quick tour' }).click();

  const tour = page.getByRole('dialog');
  const next = tour.getByRole('button', { name: 'Next', exact: true });
  const back = tour.getByRole('button', { name: 'Back', exact: true });
  await expect(tour.getByText('Step 1 / 6', { exact: true })).toBeVisible();
  await expect(tour.locator('bdi')).toHaveAttribute('dir', 'ltr');
  await next.click();
  await expect(tour.getByText('Step 2 / 6', { exact: true })).toBeVisible();
  await next.click();
  await expect(page).toHaveURL(/\/c\/cases$/);
  await expect(tour.getByText('Step 3 / 6', { exact: true })).toBeVisible();

  await page.reload();
  await expect(tour.getByText('Step 3 / 6', { exact: true })).toBeVisible();
  await back.click();
  await expect(page).toHaveURL(/\/c$/);
  await expect(tour.getByText('Step 2 / 6', { exact: true })).toBeVisible();

  for (const step of [3, 4, 5, 6]) {
    await next.click();
    await expect(tour.getByText(`Step ${step} / 6`, { exact: true })).toBeVisible();
  }
  await tour.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(tour).toBeHidden();
  await expect(page.getByRole('button', { name: 'Replay tour' })).toBeVisible();
});
