/**
 * End-to-end workflow in a real browser (production build served by `vite preview`):
 * create → autosave → reopen → import → duplicates → correct → recalculate → the PDFs →
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
    const [short] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download PDF' }).first().click()]);
    expect(short.suggestedFilename()).toMatch(/^my-tax-return-figures-FY2024-25-.*\.pdf$/);
    expect((await readDownload(short)).subarray(0, 5).toString()).toBe('%PDF-');
    const [basic] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download PDF' }).nth(1).click()]);
    expect(basic.suggestedFilename()).toMatch(/^tax-summary-FY2024-25-.*\.pdf$/);
    expect((await readDownload(basic)).subarray(0, 5).toString()).toBe('%PDF-');
    // The full report is off by default and switched on in Settings.
    await expect(page.getByRole('button', { name: 'Download PDF' })).toHaveCount(2);
    await page.goto('./#/settings');
    await page.getByLabel('Show the full accountant report').check();
    await page.goto('./#/reports');
    const [full] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download PDF' }).nth(2).click()]);
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
  await page.getByRole('group', { name: 'Screen mode' }).getByRole('button', { name: 'Advanced' }).click();
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

test('simple mode: home, money accounts, add trades and tax summary', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await noSavePicker(page);
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Welcome' })).toBeVisible();
  await selectFY(page, '2025');
  const nav = page.getByRole('navigation', { name: 'Main navigation' });

  await test.step('quick questions', async () => {
    await page.getByRole('button', { name: /Answer a few quick questions/ }).click();
    const dlg = page.getByRole('dialog');
    await dlg.getByRole('button', { name: 'Yes, all year' }).first().click();
    await dlg.getByRole('button', { name: 'Yes, all year' }).nth(1).click();
    await dlg.getByRole('button', { name: 'No', exact: true }).nth(0).click();
    await dlg.getByRole('button', { name: 'No', exact: true }).nth(1).click();
    await dlg.getByRole('button', { name: 'No', exact: true }).nth(2).click();
    await dlg.getByRole('button', { name: 'Save answers' }).click();
    await expect(dlg).toHaveCount(0);
  });

  await test.step('add a custom income source and record income', async () => {
    await nav.getByRole('link', { name: 'Income & expenses' }).click();
    await page.getByRole('button', { name: '+ Add account' }).click();
    const dlg = page.getByRole('dialog');
    await dlg.getByLabel('Name (anything you like)').fill('My CPA Network');
    await dlg.getByRole('button', { name: 'Add account' }).click();
    await expect(dlg).toHaveCount(0);
    await expect(page.getByText('My CPA Network').first()).toBeVisible();
    await page.getByRole('button', { name: '+ Income' }).first().click();
    const q = page.getByRole('dialog');
    await q.getByLabel('Date').fill('2024-10-01');
    await q.getByLabel('Amount').fill('1200');
    await q.getByLabel('Description').fill('E2E affiliate payout');
    if (!(await q.getByLabel('What is it?').inputValue())) await q.getByLabel('What is it?').selectOption({ index: 1 });
    await q.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('cell', { name: 'E2E affiliate payout' })).toBeVisible();
  });

  await test.step('trading links highlight one at a time', async () => {
    await nav.getByRole('link', { name: 'Holdings' }).click();
    await expect(nav.getByRole('link', { name: 'Holdings' })).toHaveClass(/active/);
    await expect(nav.getByRole('link', { name: 'My trades' })).not.toHaveClass(/active/);
    await nav.getByRole('link', { name: 'Add trades' }).click();
    await expect(page.getByRole('heading', { name: 'Add trades' })).toBeVisible();
  });

  await test.step('tax summary and the short PDF', async () => {
    await nav.getByRole('link', { name: 'Tax summary' }).click();
    await expect(page.getByRole('heading', { name: /Tax summary/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Full accountant pack/ })).toHaveCount(0);
    const [pdf] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'My tax return figures (PDF)', exact: true }).click()]);
    expect(pdf.suggestedFilename()).toMatch(/^my-tax-return-figures-FY2024-25-.*\.pdf$/);
    expect((await readDownload(pdf)).subarray(0, 5).toString()).toBe('%PDF-');
  });

  await nav.getByRole('link', { name: 'Home' }).click();
  await expect(page.getByRole('heading', { name: /Your FY2024/ })).toBeVisible();
  expect(errors).toEqual([]);
});

test('typing letter by letter in dialogs keeps the cursor in the field', async ({ page }) => {
  await page.goto('./');
  await selectFY(page, '2025');
  const typeInto = async (field: ReturnType<Page['getByLabel']>, text: string) => {
    await field.click();
    await field.pressSequentially(text, { delay: 15 });
    await expect(field).toHaveValue(text);
  };
  await page.goto('./#/money');
  await page.getByRole('button', { name: '+ Add account' }).click();
  let dlg = page.getByRole('dialog');
  await expect(dlg.getByLabel('Name (anything you like)')).toBeFocused();
  await typeInto(dlg.getByLabel('Name (anything you like)'), 'Impact affiliate');
  await typeInto(dlg.getByLabel('Notes (optional)'), 'paid monthly');
  await dlg.getByRole('button', { name: 'Add account' }).click();
  await page.getByRole('button', { name: '+ Income' }).first().click();
  dlg = page.getByRole('dialog');
  await typeInto(dlg.getByLabel('Description'), 'October commissions');
  await dlg.getByRole('button', { name: 'Cancel' }).click();
  await page.goto('./#/');
  await page.getByRole('button', { name: /Answer a few quick questions/ }).click();
  dlg = page.getByRole('dialog');
  await dlg.getByRole('button', { name: 'Part of the year' }).first().click();
  await typeInto(dlg.getByLabel('How many months were you a resident?'), '7');
  await dlg.getByRole('button', { name: 'Cancel' }).click();
  await page.goto('./#/settings?tab=tax');
  await page.getByRole('button', { name: '+ Add rule' }).click();
  dlg = page.getByRole('dialog');
  await typeInto(dlg.getByLabel('Rule name'), 'Hosting is a business expense');
  await dlg.getByRole('button', { name: 'Cancel' }).click();
  await page.goto('./#/transactions');
  await page.getByRole('button', { name: '+ New record' }).click();
  dlg = page.getByRole('dialog');
  await typeInto(dlg.getByLabel('Description'), 'Typed one key at a time');
});

test('get exchange rates: fetch from the RBA (stand-in response), preview, save, record converted', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // The real file comes from rba.gov.au through the local server; here a hand-written file in the same layout stands in.
  const rba = ['Title,AUD/USD Exchange Rate', 'Units,USD', 'Series ID,FXRUSD', '27-Sep-2024,0.6890', '30-Sep-2024,0.6920'].join('\n');
  await page.route('**/__rates/rba-f11', (r) => r.fulfill({ status: 200, contentType: 'text/csv', body: rba }));
  await page.goto('./');
  await selectFY(page, '2025');
  await page.goto('./#/money');
  await page.getByRole('button', { name: '+ Income' }).first().click();
  const q = page.getByRole('dialog');
  await q.getByLabel('Date').fill('2024-09-30');
  await q.getByLabel('Amount').fill('100');
  await q.getByLabel('Currency').fill('USD');
  await q.getByLabel('Description').fill('US affiliate payout');
  if (!(await q.getByLabel('What is it?').inputValue())) await q.getByLabel('What is it?').selectOption({ index: 1 });
  await q.getByRole('button', { name: 'Save', exact: true }).click();
  await page.goto('./#/');
  await page.getByRole('button', { name: 'Get rates' }).click();
  const panel = page.locator('#get-rates');
  await expect(panel.getByRole('cell', { name: 'USD' })).toBeVisible();
  await panel.getByRole('button', { name: 'Fetch rates' }).click();
  await expect(panel.getByText('USD — RBA')).toBeVisible();
  await expect(panel.getByText(/2 daily rates/)).toBeVisible();
  await panel.getByRole('button', { name: 'Save 2 rates' }).click();
  await expect(page.getByText(/2 rates added; 1 record now converted to AUD/).first()).toBeVisible();
  await expect(panel.getByText('Every record has an AUD rate.')).toBeVisible();
  // The fetched rates are an ordinary import that can be rolled back.
  await expect(page.getByRole('cell', { name: /RBA F11\.1 exchange rates — fetched/ })).toBeVisible();
  const ping = await page.request.get('./__rates/ping');
  expect(await ping.text()).toBe('ok');
  expect(errors).toEqual([]);
});

test('year selector follows the current year by default and can be pinned', async ({ page }) => {
  await page.goto('./');
  const sel = page.getByLabel('Selected financial year');
  await expect(sel).toHaveValue('auto');
  await expect(sel.locator('option[value="auto"]')).toHaveText(/^Current year — FY\d{4}–\d{2} \(moves on each 1 July\)$/);
  await sel.selectOption('2025');
  await page.reload();
  await expect(page.getByLabel('Selected financial year')).toHaveValue('2025');
  await page.getByLabel('Selected financial year').selectOption('auto');
  await page.reload();
  await expect(page.getByLabel('Selected financial year')).toHaveValue('auto');
});

test('delete money accounts: empty account deleted, account with records hidden or deleted with its records', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('./');
  await selectFY(page, '2025');
  await page.goto('./#/money');
  const add = async (name: string) => {
    await page.getByRole('button', { name: '+ Add account' }).click();
    const d = page.getByRole('dialog');
    await d.getByLabel('Name (anything you like)').fill(name);
    await d.getByRole('button', { name: 'Add account' }).click();
    await expect(d).toHaveCount(0);
  };
  await add('Empty network');
  await add('Busy network');
  await page.getByRole('row', { name: /Busy network/ }).getByRole('button', { name: '+ In' }).click();
  const q = page.getByRole('dialog');
  await q.getByLabel('Date').fill('2024-10-01');
  await q.getByLabel('Amount').fill('300');
  await q.getByLabel('Description').fill('Busy payout');
  if (!(await q.getByLabel('What is it?').inputValue())) await q.getByLabel('What is it?').selectOption({ index: 1 });
  await q.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('cell', { name: 'Busy payout' })).toBeVisible();

  // No records: deleted completely.
  await page.getByRole('button', { name: 'Edit Empty network' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete…' }).click();
  await expect(page.getByText('This account has no records')).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete account' }).click();
  await expect(page.getByRole('button', { name: 'Edit Empty network' })).toHaveCount(0);

  // With records: hide keeps the record; show again; then delete with records removes it from the year.
  await page.getByRole('button', { name: 'Edit Busy network' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete…' }).click();
  await page.getByRole('dialog').getByRole('button', { name: /Hide the account/ }).click();
  await expect(page.getByRole('button', { name: 'Edit Busy network' })).toHaveCount(0);
  await expect(page.getByRole('cell', { name: 'Busy payout' })).toBeVisible();
  await page.getByText('Hidden accounts (1)').click();
  await page.getByRole('button', { name: 'Show again' }).click();
  await page.getByRole('button', { name: 'Edit Busy network' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete…' }).click();
  await page.getByRole('dialog').getByRole('button', { name: /Delete the account and its 1 record/ }).click();
  await expect(page.getByRole('cell', { name: 'Busy payout' })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('income and expense accounts are kept apart; banks are offered for both and for moving money', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('./');
  await selectFY(page, '2025');
  await page.goto('./#/money');
  const addIn = page.getByRole('region', { name: 'Income', exact: true });
  const addOut = page.getByRole('region', { name: 'Expenses', exact: true });
  const banks = page.getByRole('region', { name: 'Banks & payment accounts' });
  const create = async (section: typeof addIn, typed: string) => {
    await section.getByRole('button', { name: '+ Add' }).click();
    const d = page.getByRole('dialog');
    await d.getByLabel('Name (anything you like)').pressSequentially(typed);
    await d.getByRole('button', { name: 'Add account' }).click();
    await expect(d).toHaveCount(0);
  };
  await create(addIn, 'impact affiliate');
  await create(addOut, 'hosting co');
  await create(banks, 'commbank');
  // First letter capitalised automatically.
  await expect(addIn.getByRole('button', { name: 'Impact affiliate', exact: true })).toBeVisible();
  await expect(addOut.getByRole('button', { name: 'Hosting co', exact: true })).toBeVisible();
  await expect(banks.getByRole('button', { name: 'Commbank', exact: true })).toBeVisible();

  const optionsFor = async (button: string) => {
    await page.getByRole('button', { name: button }).first().click();
    const d = page.getByRole('dialog');
    const texts = await d.getByLabel('Account').locator('option').allTextContents();
    await d.getByRole('button', { name: 'Cancel' }).click();
    return texts.join(' | ');
  };
  const inOpts = await optionsFor('+ Income');
  expect(inOpts).toContain('Impact affiliate');
  expect(inOpts).toContain('Commbank');
  expect(inOpts).not.toContain('Hosting co');
  const outOpts = await optionsFor('+ Expense');
  expect(outOpts).toContain('Hosting co');
  expect(outOpts).toContain('Commbank');
  expect(outOpts).not.toContain('Impact affiliate');

  // Banks can move money to another of your accounts (a transfer, not income or an expense).
  await banks.getByRole('button', { name: 'Move' }).click();
  await expect(page.getByRole('dialog', { name: 'Move money' })).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();

  // Trading accounts (e.g. a prop-firm account) are not offered for income or expenses, but are listed — and deletable.
  await page.getByRole('button', { name: '+ Add account' }).click();
  const d = page.getByRole('dialog');
  await d.getByLabel('Name (anything you like)').fill('65465');
  await d.getByRole('button', { name: /Prop-firm account/ }).click();
  await d.getByRole('button', { name: 'Add account' }).click();
  const trading = page.getByRole('region', { name: 'Trading accounts' });
  await expect(trading.getByText('65465')).toBeVisible();
  expect(await optionsFor('+ Income')).not.toContain('65465');
  await trading.getByRole('button', { name: 'Edit 65465' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete…' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete account' }).click();
  await expect(page.getByRole('region', { name: 'Trading accounts' })).toHaveCount(0);

  // After about five accounts the list scrolls instead of pushing the page down.
  for (const n of ['b network', 'c network', 'd network', 'e network', 'f network', 'g network']) await create(addIn, n);
  const box = addIn.locator('.acct-scroll');
  const { scroll, client } = await box.evaluate((el) => ({ scroll: el.scrollHeight, client: el.clientHeight }));
  expect(client).toBeLessThanOrEqual(265);
  expect(scroll).toBeGreaterThan(client);
  expect(errors).toEqual([]);
});

test('hidden accounts with records can be deleted and then disappear everywhere', async ({ page }) => {
  await page.goto('./');
  await selectFY(page, '2025');
  await page.goto('./#/money');
  await page.getByRole('button', { name: '+ Add account' }).click();
  let d = page.getByRole('dialog');
  await d.getByLabel('Name (anything you like)').fill('Old network');
  await d.getByRole('button', { name: 'Add account' }).click();
  await page.getByRole('row', { name: /Old network/ }).getByRole('button', { name: '+ In' }).click();
  d = page.getByRole('dialog');
  await d.getByLabel('Date').fill('2024-10-01');
  await d.getByLabel('Amount').fill('50');
  if (!(await d.getByLabel('What is it?').inputValue())) await d.getByLabel('What is it?').selectOption({ index: 1 });
  await d.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('button', { name: 'Edit Old network' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete…' }).click();
  await page.getByRole('dialog').getByRole('button', { name: /Hide the account/ }).click();
  await page.getByText('Hidden accounts (1)').click();
  await page.getByRole('button', { name: 'Delete Old network' }).click();
  d = page.getByRole('dialog');
  await expect(d.getByRole('button', { name: /Hide the account/ })).toHaveCount(0); // already hidden
  await d.getByRole('button', { name: /Delete the account and its 1 record/ }).click();
  await expect(page.getByText(/Hidden accounts/)).toHaveCount(0);
  await page.getByRole('button', { name: '+ Income' }).first().click();
  expect((await page.getByRole('dialog').getByLabel('Account').locator('option').allTextContents()).join('|')).not.toContain('Old network');
});

test('move money between banks: one simple entry, not a trade, not income or an expense', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('./');
  await selectFY(page, '2025');
  await page.goto('./#/money');
  const banks = page.getByRole('region', { name: 'Banks & payment accounts' });
  for (const n of ['NAB', 'CommBank']) {
    await banks.getByRole('button', { name: '+ Add' }).click();
    const d = page.getByRole('dialog');
    await d.getByLabel('Name (anything you like)').fill(n);
    await d.getByRole('button', { name: 'Add account' }).click();
    await expect(d).toHaveCount(0);
  }
  await page.getByRole('row', { name: /NAB/ }).getByRole('button', { name: 'Move' }).click();
  let d = page.getByRole('dialog', { name: 'Move money' });
  await expect(d.getByLabel('From')).toHaveValue(/.+/);
  // Only the essentials: from, to, date, amount, currency, note.
  await expect(d.locator('input, select')).toHaveCount(6);
  await d.getByLabel('To').selectOption({ label: 'CommBank' });
  await d.getByLabel('Date').fill('2024-10-01');
  await d.getByLabel('Amount').fill('500');
  await d.getByLabel('Note (optional)').fill('savings');
  await d.getByRole('button', { name: 'Move money' }).click();
  await expect(page.getByText('Money moved.')).toBeVisible();
  // Listed once on Income & expenses, not counted in the totals.
  await expect(page.getByRole('cell', { name: 'Moved to CommBank — savings' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Moved out' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Moved from NAB — savings' })).toHaveCount(0);
  await expect(page.locator('.bubble').first()).toContainText('0');
  // Not a trade.
  await page.goto('./#/trading?tab=ledger');
  await expect(page.getByRole('cell', { name: /Moved to CommBank/ })).toHaveCount(0);
  await page.goto('./#/add-trades');
  await expect(page.getByRole('cell', { name: /Moved to CommBank/ })).toHaveCount(0);
  // Clicking it opens the same simple window to edit; delete removes both sides.
  await page.goto('./#/money');
  await page.getByRole('cell', { name: 'Moved to CommBank — savings' }).click();
  d = page.getByRole('dialog', { name: 'Edit money move' });
  await expect(d.getByLabel('Amount')).toHaveValue('500');
  await d.getByLabel('Amount').fill('650');
  await d.getByRole('button', { name: 'Save' }).click();
  await page.goto('./#/transactions');
  await expect(page.getByRole('cell', { name: 'Moved from NAB — savings' })).toBeVisible();
  await expect(page.getByRole('row', { name: /Moved from NAB/ })).toContainText('650');
  await page.getByRole('cell', { name: 'Moved from NAB — savings' }).click();
  await page.getByRole('dialog', { name: 'Edit money move' }).getByRole('button', { name: 'Delete' }).click();
  await page.getByRole('dialog', { name: 'Delete this move?' }).getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByRole('cell', { name: /Moved (to|from)/ })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('start again: delete selected data, then everything', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await noSavePicker(page);
  await page.goto('./');
  await page.getByRole('button', { name: /Just exploring/ }).click();
  await expect(page.getByText(/Demonstration data loaded/)).toBeVisible({ timeout: 30_000 });
  await page.goto('./#/settings?tab=backup');
  const panel = page.locator('#reset');
  // Ticking accounts also ticks transactions.
  await panel.getByLabel('Accounts').check();
  await expect(panel.getByLabel('Transactions & records')).toBeChecked();
  const [backup] = await Promise.all([page.waitForEvent('download'), panel.getByRole('button', { name: 'Download a backup first' }).click()]);
  expect(backup.suggestedFilename()).toMatch(/\.json$/);
  await panel.getByRole('button', { name: 'Delete selected…' }).click();
  const d = page.getByRole('dialog', { name: 'Delete the selected data?' });
  await expect(d.getByRole('button', { name: 'Delete', exact: true })).toBeDisabled();
  await d.getByLabel('Confirmation text').fill('RESET');
  await d.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByText(/Done — \d+ items? deleted/)).toBeVisible();
  await page.goto('./#/money');
  await expect(page.getByRole('button', { name: /^Edit DEMO/ })).toHaveCount(0);
  // Everything: back to the welcome screen with default settings.
  await page.goto('./#/settings?tab=backup');
  await page.locator('#reset').getByRole('button', { name: 'Select everything' }).click();
  await page.locator('#reset').getByRole('button', { name: 'Delete everything…' }).click();
  const d2 = page.getByRole('dialog', { name: 'Delete everything?' });
  await d2.getByLabel('Confirmation text').fill('RESET');
  await d2.getByRole('button', { name: 'Delete everything' }).click();
  await expect(page.getByRole('heading', { name: 'Welcome' })).toBeVisible({ timeout: 15_000 });
  expect(errors).toEqual([]);
});

test('expenses: categories grouped under headings; business expenses broken down in the tax summary', async ({ page }) => {
  await page.goto('./');
  await selectFY(page, '2025');
  await page.goto('./#/money');
  await page.getByRole('button', { name: '+ Expense' }).first().click();
  const d = page.getByRole('dialog');
  const sel = d.getByLabel('What was it for?');
  await expect(sel.locator('optgroup[label="Marketing & advertising"] option')).toHaveText(['Paid ads (PPC)', 'Influencer & affiliate payouts', 'Native & solo ads']);
  await expect(sel.locator('optgroup[label="Equipment"] option')).toHaveCount(3);
  await expect(sel.locator('optgroup[label="Trading"] option').first()).toBeAttached();
  await d.getByLabel('Date').fill('2024-09-01');
  await d.getByLabel('Amount').fill('450');
  await sel.selectOption({ label: 'Paid ads (PPC)' });
  await d.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('cell', { name: 'Paid ads (PPC)' }).first()).toBeVisible();
  await page.goto('./#/tax-summary');
  const side = page.locator('.panel', { has: page.getByRole('heading', { name: 'Side projects and business' }) });
  await expect(side.getByRole('row', { name: /Paid ads \(PPC\)/ })).toContainText('$450.00');
});
