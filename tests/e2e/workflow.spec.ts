/**
 * End-to-end workflow in a real browser (production build served by `vite preview`):
 * create → autosave → reopen → import → duplicates → correct → recalculate → both PDFs →
 * backup → restore into a fresh browser profile → verify records, documents and links.
 */
import { test, expect, type Page, type Download } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SAMPLES = resolve(process.cwd(), 'public/samples');

async function noSavePicker(page: Page) {
  // Force the download fallback (native "Save as" dialogs cannot be automated).
  await page.addInitScript(() => {
    (window as any).showSaveFilePicker = undefined;
  });
}

async function selectFY(page: Page, fy: string) {
  await page.getByLabel('Selected financial year').selectOption(fy);
}

async function readDownload(d: Download): Promise<Buffer> {
  const p = await d.path();
  return readFileSync(p!);
}

test('complete recordkeeping workflow', async ({ page, browser }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await noSavePicker(page);
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Welcome' })).toBeVisible();
  await selectFY(page, '2025');

  await test.step('record residency in the tax profile (autosaves)', async () => {
    await page.goto('./#/tax?tab=profile');
    await page.getByLabel('Residency for tax purposes').selectOption('resident');
    await page.getByLabel('Full name').fill('E2E Test Person');
    await expect(page.locator('.save-ind')).toHaveText('Saved', { timeout: 10_000 });
  });

  await test.step('create a record, autosave an edit', async () => {
    await page.goto('./#/transactions');
    await page.getByRole('button', { name: '+ New record' }).click();
    const dlg = page.getByRole('dialog');
    await dlg.getByLabel('Record type').selectOption('income');
    await dlg.getByLabel('Date', { exact: false }).first().fill('2024-09-30');
    await dlg.getByLabel('Description').fill('E2E salary payment');
    await dlg.getByLabel('Category').selectOption('salary');
    await dlg.getByLabel('Amount (gross)').fill('5000');
    await dlg.getByRole('button', { name: 'Add record' }).click();
    await expect(page.getByText('Record added')).toBeVisible();
    await dlg.getByLabel('PAYG / TFN tax withheld (AUD)').fill('1000');
    await expect(dlg.getByText(/^Saved /)).toBeVisible({ timeout: 10_000 });
    await dlg.getByRole('button', { name: 'Close' }).last().click();
    await expect(page.getByRole('cell', { name: 'E2E salary payment' })).toBeVisible();
  });

  await test.step('attach a receipt document to the record', async () => {
    await page.getByRole('cell', { name: 'E2E salary payment' }).click();
    const dlg = page.getByRole('dialog');
    await dlg.locator('input[type=file]').setInputFiles({ name: 'payslip-2024-09-30.csv', mimeType: 'text/csv', buffer: Buffer.from('Item,Amount\nGross,5000\nTax,1000\n') });
    await expect(page.getByText('Document stored and linked.')).toBeVisible();
    await expect(dlg.getByText('payslip-2024-09-30.csv')).toBeVisible();
    await dlg.getByRole('button', { name: 'Close' }).last().click();
  });

  await test.step('records survive closing and reopening the application', async () => {
    await page.reload();
    await page.goto('./#/transactions');
    await expect(page.getByRole('cell', { name: 'E2E salary payment' })).toBeVisible();
  });

  await test.step('create a trading account', async () => {
    await page.goto('./#/trading?tab=accounts');
    await page.getByRole('button', { name: '+ Add account' }).click();
    const dlg = page.getByRole('dialog');
    await dlg.getByLabel('Account name').fill('E2E Broker');
    await dlg.getByLabel('Broker / exchange / bank / firm').fill('Test broker');
    await dlg.getByLabel('Australian tax treatment of gains').selectOption('investor_cgt');
    await dlg.getByRole('button', { name: 'Add' }).click();
    await expect(page.getByText('Added — further changes save automatically.')).toBeVisible();
    await dlg.getByRole('button', { name: 'Close' }).last().click();
    await expect(page.getByRole('cell', { name: 'E2E Broker' })).toBeVisible();
  });

  const importShares = async () => {
    await page.goto('./#/imports');
    await page.getByLabel('CSV file').setInputFiles(resolve(SAMPLES, 'shares.csv'));
    await expect(page.getByText('Template: Generic share trades')).toBeVisible();
    await page.getByLabel('Default account', { exact: false }).selectOption({ label: 'E2E Broker' });
    await page.getByRole('button', { name: 'Preview & validate' }).click();
  };

  await test.step('import a broker statement with preview and mapping', async () => {
    await importShares();
    await expect(page.getByText('5 to create')).toBeVisible();
    await page.getByRole('button', { name: 'Import 5 record(s)' }).click();
    await expect(page.getByText('Import complete')).toBeVisible();
    await expect(page.getByText('Created 5 · Updated 0 · Skipped 0 · Rejected 0 of 5 row(s).')).toBeVisible();
  });

  await test.step('re-importing the same file is detected as duplicates', async () => {
    await page.getByRole('button', { name: 'Import another file' }).click();
    await importShares();
    await expect(page.getByText('0 to create')).toBeVisible();
    await expect(page.getByText('5 to skip (duplicates)')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Import 0 record(s)' })).toBeDisabled();
  });

  await test.step('USD trades are flagged for a missing historical rate, then fixed by importing rates', async () => {
    await page.goto('./#/reconciliation');
    await expect(page.getByText('Missing historical exchange rate')).toBeVisible();
    await page.goto('./#/imports');
    await page.getByLabel('CSV file').setInputFiles(resolve(SAMPLES, 'rates.csv'));
    await page.getByRole('button', { name: 'Preview & validate' }).click();
    await page.getByRole('button', { name: /Import \d+ record\(s\)/ }).click();
    await expect(page.getByText('Import complete')).toBeVisible();
    await page.goto('./#/reconciliation');
    await expect(page.getByText('Account tax treatment not set')).toHaveCount(0);
    await expect(page.getByText('Missing historical exchange rate')).toHaveCount(0);
  });

  await test.step('correct a transaction and recalculate', async () => {
    await page.goto('./#/transactions');
    await page.getByRole('cell', { name: 'E2E salary payment' }).click();
    const dlg = page.getByRole('dialog');
    await dlg.getByLabel('Description').fill('E2E salary payment (corrected)');
    await expect(dlg.getByText(/^Saved /)).toBeVisible({ timeout: 10_000 });
    await dlg.getByRole('button', { name: 'Close' }).last().click();
    await page.goto('./#/tax-calc');
    await expect(page.getByText('Salary and wages (gross)')).toBeVisible();
    await page.getByLabel('Reason for snapshot').fill('E2E recalculation');
    await page.getByRole('button', { name: 'Save calculation snapshot' }).click();
    await expect(page.getByRole('cell', { name: 'E2E recalculation' })).toBeVisible();
  });

  await test.step('generate both PDF reports and a CSV export', async () => {
    await page.goto('./#/reports');
    const [basic] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download PDF' }).first().click()]);
    expect(basic.suggestedFilename()).toMatch(/^tax-summary-FY2024-25-.*\.pdf$/);
    expect((await readDownload(basic)).subarray(0, 5).toString()).toBe('%PDF-');
    const [full] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download PDF' }).nth(1).click()]);
    expect(full.suggestedFilename()).toMatch(/^tax-agent-report-FY2024-25-.*\.pdf$/);
    const fullBuf = await readDownload(full);
    expect(fullBuf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(fullBuf.length).toBeGreaterThan(20_000);
    const [csv] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Transaction ledger CSV/ }).click()]);
    expect((await readDownload(csv)).toString()).toContain('E2E salary payment (corrected)');
    await expect(page.getByRole('cell', { name: /tax-agent-report-FY2024-25/ })).toBeVisible();
  });

  let backupPath = '';
  await test.step('export a full backup', async () => {
    await page.goto('./#/settings?tab=backup');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export backup…' }).click()]);
    expect(dl.suggestedFilename()).toMatch(/^au-tax-ledger-backup-\d{8}-\d{6}\.json$/);
    backupPath = (await dl.path())!;
    const json = JSON.parse(readFileSync(backupPath, 'utf8'));
    expect(json.format).toBe('au-tax-ledger-backup');
    expect(json.counts.transactions).toBe(6);
    expect(json.documents.length).toBe(1);
  });

  await test.step('restore the backup into a fresh browser profile (new device)', async () => {
    const ctx = await browser.newContext({ acceptDownloads: true });
    const p2 = await ctx.newPage();
    await noSavePicker(p2);
    await p2.goto('./#/settings?tab=backup');
    await p2.getByLabel('Backup file').setInputFiles(backupPath);
    await expect(p2.getByText(/Verified backup from/)).toBeVisible();
    await p2.getByLabel('Restore mode').selectOption('replace');
    await p2.getByRole('button', { name: 'Restore…' }).click();
    await p2.getByLabel('Confirmation text').fill('RESTORE');
    await p2.getByRole('dialog').getByRole('button', { name: 'Restore' }).click();
    await p2.waitForLoadState('load');
    await p2.waitForTimeout(2500);
    await p2.goto('./#/transactions');
    await selectFY(p2, '2025');
    await expect(p2.getByRole('cell', { name: 'E2E salary payment (corrected)' })).toBeVisible();
    await p2.getByRole('cell', { name: 'E2E salary payment (corrected)' }).click();
    await expect(p2.getByRole('dialog').getByText('payslip-2024-09-30.csv')).toBeVisible();
    await p2.getByRole('dialog').getByRole('button', { name: 'Close' }).last().click();
    await p2.goto('./#/documents');
    await p2.getByLabel('Scope').selectOption('all');
    await expect(p2.getByRole('cell', { name: 'payslip-2024-09-30', exact: true })).toBeVisible();
    await p2.goto('./#/settings?tab=health');
    await expect(p2.getByText('Document files verified against SHA-256: 1 OK, 0 missing, 0 mismatched')).toBeVisible();
    await p2.goto('./#/trading?tab=accounts');
    await expect(p2.getByRole('cell', { name: 'E2E Broker' })).toBeVisible();
    await ctx.close();
  });

  expect(errors).toEqual([]);
});

test('every navigation item and tab renders without errors (with demonstration data)', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto('./');
  await page.getByRole('button', { name: 'Load demonstration data' }).click();
  await expect(page.getByText('Demonstration data loaded')).toBeVisible({ timeout: 30_000 });
  await selectFY(page, '2025');
  const nav = page.getByRole('navigation', { name: 'Main navigation' });
  for (const label of ['Dashboard', 'Tax & Business', 'Trading & Investments', 'Transactions', 'Imports', 'Documents & Receipts', 'Tax Calculations', 'Reports & PDF Export', 'Reconciliation', 'Settings & Data']) {
    await nav.getByRole('link', { name: label }).click();
    await expect(page.locator('h1').first()).toBeVisible();
    const tabs = page.getByRole('tab');
    const n = await tabs.count();
    for (let i = 0; i < n; i++) {
      await tabs.nth(i).click();
      await page.waitForTimeout(150);
    }
  }
  // Dashboard totals open their underlying records
  await nav.getByRole('link', { name: 'Dashboard' }).click();
  await page.getByText('Capital gains (gross) / losses').click();
  await expect(page.getByRole('dialog', { name: /Source records/ })).toBeVisible();
  await expect(page.getByRole('dialog').getByRole('row')).not.toHaveCount(1);
  expect(errors).toEqual([]);
});
