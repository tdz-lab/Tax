/** Offline operation after installation: the service worker serves the app shell with no network. */
import { test, expect } from '@playwright/test';

test('app starts and saves records while offline', async ({ page, context }) => {
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Welcome' })).toBeVisible();
  // Wait for the service worker to install and take control (precache complete).
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller), { timeout: 20_000 }).toBe(true);
  expect(await page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Welcome' })).toBeVisible();
  await expect(page.getByText('Offline', { exact: true })).toBeVisible();

  // Add a record offline
  await page.goto('./#/transactions');
  await page.getByRole('button', { name: '+ New record' }).click();
  const dlg = page.getByRole('dialog');
  await dlg.getByLabel('Record type').selectOption('expense');
  await dlg.getByLabel('Date', { exact: false }).first().fill('2025-01-10');
  await dlg.getByLabel('Description').fill('Offline expense');
  await dlg.getByLabel('Category').selectOption('software');
  await dlg.getByLabel('Amount (gross)').fill('20');
  await dlg.getByRole('button', { name: 'Add record' }).click();
  await expect(page.getByText('Record added')).toBeVisible();
  await dlg.getByRole('button', { name: 'Close' }).last().click();
  await page.getByLabel('Selected financial year').selectOption('2025');
  await expect(page.getByRole('cell', { name: 'Offline expense' })).toBeVisible();

  // Sample files (cached) and PDF generation work offline.
  const res = await page.evaluate(async () => (await fetch('./samples/shares.csv')).status);
  expect(res).toBe(200);
  await page.addInitScript(() => ((window as any).showSaveFilePicker = undefined));
  await page.goto('./#/reports');
  await page.evaluate(() => ((window as any).showSaveFilePicker = undefined));
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download PDF' }).first().click()]);
  expect(dl.suggestedFilename()).toMatch(/\.pdf$/);

  // Reload offline again — data persisted.
  await page.reload();
  await page.goto('./#/transactions');
  await expect(page.getByRole('cell', { name: 'Offline expense' })).toBeVisible();
  await context.setOffline(false);
});
