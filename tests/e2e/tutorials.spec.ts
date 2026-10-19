/**
 * Walks every step of every interactive tutorial (with practice data loaded) and checks that each
 * highlighted element exists. “Your turn” steps are skipped, so steps that only make sense after the
 * user has performed the action (e.g. a saved record's conversion panel) are listed in ALLOWED_MISSING.
 */
import { test, expect, type Page } from '@playwright/test';

const ALLOWED_MISSING = new Set<string>([
  // Shown only after the user completes the preceding “Your turn” step (skipped in this test):
  'transactions:19', // conversion/documents panels of a saved record
  'trading-shares:13', // conversion panel of a saved record
  'expenses:8', // supporting documents of a saved record
  'imports:4', 'imports:5', 'imports:6', 'imports:7', 'imports:8', 'imports:11', 'imports:12', // mapping/preview need a chosen file
  'currency-manual:9', // override form opens after clicking “Override rate”
]);

async function walk(page: Page, id: string, missing: string[]) {
  await page.goto('./#/tutorials');
  await page.locator(`[data-tour-item="${id}"] button[aria-label^="Start tutorial"]`).click();
  await page.waitForSelector('.tour-card[data-tour-id]', { timeout: 10_000 });
  for (let guard = 0; guard < 80; guard++) {
    const card = page.locator('.tour-card[data-tour-id]');
    if (!(await card.count())) break;
    await page.waitForSelector('.tour-card[data-ready="true"]', { timeout: 15_000 });
    const step = (await card.getAttribute('data-step'))!;
    const tid = (await card.getAttribute('data-tour-id'))!;
    if ((await card.getAttribute('data-target-status')) === 'missing' && !ALLOWED_MISSING.has(`${tid}:${step}`)) missing.push(`${tid}:${step} ${await card.locator('h3').textContent()}`);
    const skip = card.getByRole('button', { name: 'Skip this step' });
    if (await skip.count()) await skip.click();
    await card.getByRole('button', { name: /^(Next|Finish|Next tutorial)$/ }).click();
    await page.waitForFunction(
      ([t, st]) => {
        const c = document.querySelector('.tour-card[data-tour-id]');
        return !c || c.getAttribute('data-tour-id') !== t || c.getAttribute('data-step') !== st;
      },
      [tid, step],
      { timeout: 15_000 }
    );
  }
  const fin = page.getByRole('dialog', { name: 'Tutorial complete' });
  await expect(fin).toBeVisible();
  await fin.getByRole('button', { name: 'Close' }).click();
}

test('every tutorial step finds its highlighted element', async ({ page }) => {
  test.setTimeout(900_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => ((window as any).showSaveFilePicker = undefined));
  await page.goto('./#/tutorials');
  await page.getByRole('button', { name: 'Load practice data' }).click();
  await expect(page.getByText('Practice data loaded')).toBeVisible({ timeout: 30_000 });
  const ids = await page.$$eval('[data-tour-item]', (els) => els.map((e) => e.getAttribute('data-tour-item')!));
  expect(ids.length).toBeGreaterThanOrEqual(30);
  const missing: string[] = [];
  for (const id of ids) await walk(page, id, missing);
  expect(missing).toEqual([]);
  // progress is recorded for every completed tutorial
  await page.goto('./#/tutorials');
  await expect(page.getByText(`${ids.length} completed`)).toBeVisible();
  expect(errors).toEqual([]);
});

test('an interactive step waits for the user and then unlocks Next', async ({ page }) => {
  await page.goto('./#/tutorials');
  await page.locator('[data-tour-item="transactions"] button[aria-label^="Start tutorial"]').click();
  // No records yet → offered practice data; continue without it.
  await page.getByRole('button', { name: 'Start without it' }).click();
  const card = page.locator('.tour-card[data-tour-id]');
  for (let i = 0; i < 10; i++) {
    await page.waitForSelector('.tour-card[data-ready="true"]');
    if ((await card.locator('h3').textContent()) === 'Create a record') break;
    await card.getByRole('button', { name: 'Next' }).click();
    await page.waitForTimeout(150);
  }
  await expect(card.locator('h3')).toHaveText('Create a record');
  await expect(card.getByRole('button', { name: 'Next' })).toBeDisabled();
  await page.getByRole('button', { name: '+ New record' }).click(); // the user performs the action
  await expect(card.getByText('✓ Done!')).toBeVisible();
  await expect(card.getByRole('button', { name: 'Next' })).toBeEnabled();
  await card.getByRole('button', { name: 'Next' }).click();
  await expect(card.locator('h3')).toHaveText('Record type');
  await page.getByRole('dialog', { name: /New record/ }).getByLabel('Record type').selectOption('expense');
  await expect(card.getByText('✓ Done!')).toBeVisible();
  await card.getByRole('button', { name: 'Exit tutorial' }).click();
  await expect(card).toHaveCount(0);
});
