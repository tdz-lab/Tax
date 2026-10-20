import type { Tour } from '../types';
import { getDb } from '../../../db/schema';
import { tryOpenDialog, tryVisible } from './helpers';

export const importsTour: Tour = {
  id: 'imports',
  section: '/imports',
  title: 'Importing statements (CSV)',
  summary: 'The import wizard step by step: layouts, accounts, dates and time zones, mapping, value mapping, preview, duplicates, templates and rollback.',
  minutes: 9,
  steps: [
    { title: 'Imports', route: '/imports', target: 'h1', body: 'Bring in CSV statements from brokers, exchanges, wallets, banks, prop firms, accounting exports and rate tables. Everything is processed on this computer.' },
    { title: 'Step 1 — what the file contains', target: 'label:What does the file contain?', body: `- **Income records**, **Expenses / receipts**
- **Bank statement** (signed amounts: + money in, − money out)
- **Dividends & distributions**
- **Trades** (shares, ETFs, crypto, futures, options, CFDs, forex)
- **Wallet / account transfers**
- **Prop-firm payouts & fees**
- **Historical exchange rates / prices**

If the layout matches a saved template it is recognised automatically.` },
    { title: 'Sample files', target: 'panel:Sample files', body: 'Fictional sample CSVs for every type — download one to see the layout or to practise. Every value is invented and marked DEMO.' },
    { title: 'Your turn: try a real file (optional)', target: 'button:Choose CSV file', body: 'Download the **Shares** sample above, then choose it here. (You can also Skip — the next steps explain each part of the wizard.)', tryIt: tryVisible('Choose a CSV file.', 'button:Preview & validate') },
    { title: 'Step 2 — default account', target: 'label:Default account', body: 'Which account the records belong to. Required unless your file has an account-name column you map. The account’s currency and type supply sensible defaults.' },
    { title: 'Dates and time zones', target: 'label:Date format', body: `- **Date format**: “auto” recognises most layouts, but for dates like 01/02/2025 the wizard warns that it can’t tell day-first from month-first — US brokers are usually **MM/dd/yyyy**.
- **Time zone of times in file**: e.g. America/New_York for a US broker, UTC for many crypto exchanges. Times with a UTC offset in the file are exact anyway.` },
    { title: 'Decimal separator and skipping rows', target: 'label:Skip leading rows', body: 'European files may use 1.234,56 — choose the comma separator. Use **Skip leading rows** when the real header row isn’t the first line (e.g. a title or account summary above it).' },
    { title: 'Step 3 — map columns', target: 'col:Column in file', body: 'For each field choose the matching column. Sample values from your file help you check. Required fields are marked *. Common header names are matched automatically.' },
    { title: 'Constant values', target: 'col:Or constant value', body: 'If the file doesn’t have a column (e.g. every row is a US share), type a constant — such as asset class “us_share” or currency “USD”.' },
    { title: 'Unmapped columns are kept', body: 'Columns you don’t map are **not thrown away** — the original row is stored with each imported record (see “Provenance” in the record editor).' },
    { title: 'Unrecognised transaction types', body: 'If the file uses words the app doesn’t know (e.g. “STO”, “Bought”, “Dist”), a “Map unrecognised transaction types” box appears so you can say what each one means.' },
    { title: 'Save as template', target: 'label:Save mapping as template', body: 'Name your mapping and click **Save template**. Next time a file with the same header row is recognised automatically.' },
    { title: 'Step 4 — preview & validate', target: 'button:Preview & validate', body: `Nothing is saved yet. The preview shows every row with:
- **new**, **duplicate source** (same broker ID already imported), **likely duplicate**, or **changed source** (same ID, different values)
- errors (row rejected, with the reason) and warnings
- the totals per currency about to be imported

You can change the action per row: Import, Skip or Update existing.` },
    { title: 'How duplicates are detected', body: `- If the file has a broker/exchange transaction ID, it is matched per account.
- Otherwise a fingerprint of account, time, instrument, side, quantity, price, amount and description is used, **plus an occurrence number** — so two genuinely identical fills in one file stay two records, but importing the same file twice creates nothing new.` },
    { title: 'Step 5 — import', body: 'The batch is saved **all-or-nothing**. The summary shows created, updated, skipped and rejected rows; rejected rows and their reasons are kept with the batch.' },
    { title: 'Import history and rollback', target: 'panel:Import history', body: 'Every batch is listed with its file fingerprint and counts. **Roll back** removes everything the batch created (you are warned if any of those records were edited since). Rate imports can be rolled back too.' }
  ]
};

export const documentsTour: Tour = {
  id: 'documents',
  section: '/documents',
  title: 'Documents & receipts',
  summary: 'Storing receipts and statements, linking them to records, finding records without evidence, and what metadata is (and isn’t) extracted.',
  minutes: 4,
  steps: [
    { title: 'Documents & Receipts', route: '/documents', target: 'h1', body: 'Store receipts, invoices, payment summaries, broker statements, payout statements and contracts (PDF, JPG, PNG, CSV, up to 15 MB each). Files stay in this browser and are included in backups.' },
    { title: 'Add documents', target: 'button:Add documents', body: 'Choose one or more files. Each gets a SHA-256 fingerprint (so changes or duplicates are detected). The same file can’t be stored twice.' },
    { title: 'What is extracted', body: 'Only simple, checkable details: PDF page count and title, image size, a CSV’s header row and line count, and dates in file names. **No OCR** — the app does not read amounts from receipts. Suggestions are shown for you to review.' },
    { title: 'Filters', target: '.toolbar', body: 'Show the selected year or all years, filter by type, or show only **unlinked** documents.' },
    { title: 'Opening a document', body: 'Click a document to edit its title/type/date/notes, **Open file**, link it to records (search by description, date or amount), create an expense from it, or delete it.' },
    { title: 'Records needing evidence', target: 'tab:Records needing evidence', body: 'Expenses, fees and prop-firm payouts for the year that have no linked document. Open any of them to attach a file directly.' },
    { title: 'Attaching from a record', body: 'In any record editor, **Supporting documents → Attach file…** stores and links in one step. The Docs column in lists shows the count.' }
  ]
};

export const taxCalcTour: Tour = {
  id: 'tax-calc',
  section: '/tax-calc',
  title: 'Tax calculations explained',
  summary: 'Readiness, warnings, recorded vs calculated vs estimated amounts, CGT steps and parcels, review items, rule sets and snapshots.',
  minutes: 8,
  needsData: true,
  steps: [
    { title: 'The tax working', route: '/tax-calc', target: 'h1', body: 'Everything the app calculates for the selected year, with the method, status and source records of every line.' },
    { title: 'Readiness line', target: 'text:Readiness:', body: 'Overall readiness, whether the estimate is reliable, which **tax rule set** is used (and how far it is verified), and residency. If results changed since your last saved snapshot, it says so.' },
    { title: 'Warnings and unresolved items', target: 'panel:Warnings and unresolved items', body: '**blocking** items make the result incomplete (e.g. missing rate, missing cost base, unclassified records, undetermined account treatment); **warning** items should be explained to your agent; **info** items are notes. Click “N record(s)” to see the records.' },
    { title: 'The five kinds of figure', body: `- **1. Recorded** — sums of your records
- **2. Calculated** — engine results (CGT, business, revenue trading)
- **3. Estimates** — depend on assumptions and rule-set verification
- **4. Awaiting review** — excluded until classified
- **5. Ready for agent review** — when nothing blocks the year` },
    { title: 'Recorded income', target: 'panel:1. Recorded income', body: 'Each line shows the AUD amount, its status, how it was worked out, and a link to the records behind it.' },
    { title: 'Trace any number', target: 'panel:1. Recorded income', body: 'Click a “N record(s)” link to open exactly the records in that total.', tryIt: tryOpenDialog('Click a “record(s)” link.') },
    { title: 'Capital gains steps', before: [{ closeDialogs: true }], target: 'panel:2. Capital gains and losses', body: `The CGT working in the ATO’s order:
1. gross gains — discount-eligible and other
2. current-year losses applied
3. losses from earlier years applied
4. 50% discount on what is left of the eligible gains
5. net capital gain, and losses carried forward` },
    { title: 'Disposals and parcels', target: 'text:Disposals and parcel allocations', body: 'Every sale with proceeds, cost base, gain and discount eligibility. Click a row to see which parcels it used, days held and the discount decision per parcel.' },
    { title: 'Estimates', target: 'panel:3. Estimates', body: 'Taxable income (whole dollars), tax at the year’s rates, low income tax offset, Medicare levy, and then offsets and credits (franking credits, foreign tax, PAYG withheld, instalments) to give **estimated tax payable or refund** (negative = refund). Assumptions are listed underneath.' },
    { title: 'Awaiting review', target: 'panel:4. Awaiting review', body: 'Items excluded from totals until classified: unresolved payouts and fees, undetermined accounts, derivative results on investor accounts, ETPs and more. Each shows why.' },
    { title: 'Rule set details', target: 'text:Sources, notes and items not calculated', body: 'The published sources of the year’s rates, notes, and the list of things the app does **not** calculate for that year. Above it, **How each figure was checked** shows, for every parameter, whether it was confirmed from an ATO page, is conflicting, or is not confirmed.' },
    { title: 'Save a snapshot', target: 'button:Save calculation snapshot', body: 'Stores an unchangeable copy of the year’s results with the rule set, a fingerprint of the inputs and your reason. Reports create one automatically. Later recalculations never overwrite earlier snapshots.', tryIt: { hint: 'Type a reason and click “Save calculation snapshot”.', check: async (ctx) => (await getDb().calcRuns.filter((c) => c.createdAt >= ctx.startedAt).count()) > 0 } },
    { title: 'Snapshot history', target: 'panel:Calculation snapshots', body: 'Click a snapshot to compare its totals with the current figures — useful to explain what changed after new statements or rule updates.' }
  ]
};

export const reportsTour: Tour = {
  id: 'reports',
  section: '/reports',
  title: 'Reports for your tax agent',
  summary: 'The basic summary and full 33-section report, options, previewing, saving, CSV exports and report history.',
  minutes: 5,
  needsData: true,
  steps: [
    { title: 'Reports', route: '/reports', target: 'h1', body: 'Professional PDFs for the selected year, made entirely on this computer. They say clearly that they are preparation documents — not ATO forms or lodged returns.' },
    { title: 'Report A — basic summary', target: 'panel:Report A', body: 'A compact summary: profile, income, business, deductions, trading by classification, capital gains and discount, dividends, foreign income, GST/BAS, estimates, unresolved items and data-quality warnings.' },
    { title: 'Report B — full tax-agent report', target: 'panel:Report B', body: 'Thirty-three numbered sections: ledgers, depreciation, CGT calculations down to each parcel, cost-basis method, every market’s records, prop-firm activity, the currency conversion ledger and rate sources, documents, reconciliation, overrides, audit and calculation history, closing balances and questions for your agent.' },
    { title: 'Preview or download', target: 'button:Preview', body: '**Preview** opens the PDF in a new tab. **Download PDF** saves it — in Chrome/Edge you choose the folder; file names include the year and time so nothing is overwritten.' },
    { title: 'Options', target: 'panel:Report options', body: 'Choose which accounts and markets appear in ledgers and trading sections, and which optional schedules (parcel detail, conversion ledger, document index, audit detail) to include. Tax totals always use all records of the year.' },
    { title: 'CSV exports and print', target: 'panel:CSV exports & print', body: 'Spreadsheets for your agent: the full ledger with AUD values and rate sources, CGT parcel allocations, and tax summary lines. “Print-friendly calculation view” prints the Tax Calculations page.' },
    { title: 'Report history', target: 'panel:Generated reports', body: 'Every report is recorded with the calculation snapshot and rule set it used and the file’s fingerprint — so you can always tell which figures a printed report contained.' }
  ]
};

export const reconciliationTour: Tour = {
  id: 'reconciliation',
  section: '/reconciliation',
  title: 'Reconciliation & data quality',
  summary: 'Data-quality checks, statement balance and holding checks, own-transfer matching, duplicates and unresolved classifications.',
  minutes: 7,
  needsData: true,
  steps: [
    { title: 'Reconciliation', route: '/reconciliation', target: 'h1', body: 'Find problems that could change your tax result, compare your records with statements, and fix them. It never invents transactions to make balances match.' },
    { title: 'Data-quality summary', target: 'tab:Data-quality summary', body: `Checks include:
- missing acquisition cost, missing disposal value, missing exchange rate (**blocking**)
- account tax treatment not set, unclassified records (**blocking**)
- unmatched transfers, possible duplicates, missing contract multipliers
- inconsistent timestamps, 30 June boundary timing
- missing evidence, unreconciled balances
- manual rates and prior-day rates used (info)` },
    { title: 'Review the records', target: 'button:review', body: 'Each line links to the records involved. Open them, fix them, and the line disappears.' },
    { title: 'Statement balances', target: 'tab:Statement balances', body: 'Enter a balance or holding from a statement to compare with your records.', tryIt: { hint: 'Click the “Statement balances” tab.', check: () => !!document.querySelector('[role="tab"][aria-selected="true"]')?.textContent?.includes('Statement balances') } },
    { title: 'Add a statement balance', before: [{ click: 'tab:Statement balances' }], target: 'button:+ Add statement balance', body: `Choose **cash balance** (an account’s cash in a currency) or **holding quantity** (units of an instrument), the statement date and the figure.

The table shows the recorded value at the end of that day and the **difference**. Mark it reconciled, or “difference explained” with a note.` },
    { title: 'Transfer matching', target: 'tab:Transfer matching', body: 'Suggests pairs of “Send” and “Receive” records of the same asset between different accounts — received amount equal or slightly less (network fee), within 72 hours. **Confirm match** marks both as own transfers (no disposal).', tryIt: { hint: 'Click the “Transfer matching” tab.', check: () => !!document.querySelector('[role="tab"][aria-selected="true"]')?.textContent?.includes('Transfer matching') } },
    { title: 'Possible duplicates', target: 'tab:Possible duplicates', body: 'Records identical in account, time, instrument, quantity, price, amount and description that came from different sources (e.g. typed in and also imported). Keep the first and delete the others, or confirm they are genuinely separate.' },
    { title: 'Unresolved classifications', target: 'tab:Unresolved classifications', body: 'Every record of the year that is unclassified or needs review. Tick several and use **Bulk edit → Tax classification** to classify them in one go.' }
  ]
};

export const settingsTour: Tour = {
  id: 'settings',
  section: '/settings',
  title: 'Settings, categories & classification rules',
  summary: 'Display options, cost-basis defaults, loss ordering, custom classification rules, categories, templates, rule sets, connectors and privacy.',
  minutes: 6,
  steps: [
    { title: 'Settings tabs', route: '/settings', target: '.tabs', body: 'General display, tax & classification, currencies & rates, categories, import templates, backup & restore, data health, tax rule sets, planned connectors and privacy & security.' },
    { title: 'Appearance', target: 'label:Appearance', body: 'Light, dark, or match your computer. Rows per page and the backup reminder period are here too.' },
    { title: 'Capital loss ordering', route: '/settings?tab=tax', target: 'panel:Capital loss ordering', body: 'Capital losses are applied to non-discount gains first by default (as in the ATO’s method statement), which keeps the most discount. You can change it if your agent advises.' },
    { title: 'Classification rules', target: 'panel:Classification rules', body: `Your own rules for automatic classification, applied before the defaults. A rule can match record type, side, asset class, account, category, a range of financial years and words in the description — e.g. “descriptions containing ‘Payout’ in account X are Business income”.

Rules never override a classification you set on a record yourself.` },
    { title: 'Add a rule', target: 'button:+ Add rule', body: 'Try opening the rule form (cancel if practising).', tryIt: tryOpenDialog('Click “+ Add rule”.') },
    { title: 'Categories', before: [{ closeDialogs: true }], route: '/settings?tab=categories', target: 'tab:Categories', body: 'Built-in income and expense categories with their default classification, default deductible % and eligibility notes. Add your own, rename, or archive ones you don’t use.' },
    { title: 'Import templates', route: '/settings?tab=templates', target: 'tab:Import templates', body: 'Built-in and saved import layouts. Delete templates you no longer need.' },
    { title: 'Tax rule sets', route: '/settings?tab=rules', target: 'tab:Tax rule sets', body: 'The rates and thresholds for each financial year, how far they are verified, and the published sources. Updated rule sets can be imported as files; they never change saved snapshots.' },
    { title: 'Connectors', route: '/settings?tab=connectors', target: 'tab:Connectors (planned)', body: 'Planned future connections to banks, brokers and exchanges. **None are active** — no passwords or keys are ever requested. Use CSV imports.' },
    { title: 'Privacy & security', route: '/settings?tab=security', target: 'panel:Privacy & security', body: 'Where your data lives, what is (and isn’t) protected, and how encrypted backups work.' }
  ]
};

export const backupTour: Tour = {
  id: 'backup',
  section: '/settings',
  title: 'Backup, restore & data health',
  summary: 'Why backups matter, encrypted backups, restoring (merge or replace), moving to a new computer, integrity checks and practice data.',
  minutes: 6,
  steps: [
    { title: 'Why back up', route: '/settings?tab=backup', target: '.notice', body: 'Your records exist only in this browser. Clearing browsing data, a new computer, a different browser or profile, or the browser reclaiming space can lose them. A backup file is the only protection.' },
    { title: 'Export a backup', target: 'panel:Export full backup', body: `- Choose whether to include document files (receipts etc.)
- Optionally set a **password** (8+ characters) to encrypt it
- Click **Export backup…** and choose where to save it (e.g. a USB drive or cloud folder you control)

File names include the date and time, so older backups are never overwritten.` },
    { title: 'Encryption', target: 'label:Password (optional — encrypts the backup)', body: 'Encrypted backups use strong standard encryption built into your browser (AES-256-GCM with a key derived from your password). **If you forget the password, the backup cannot be opened** — store it safely.' },
    { title: 'Restore', target: 'panel:Restore from backup', body: `Choose a backup file (and its password). It is verified first — damaged or altered files are rejected. Then:
- **Merge** adds records that aren’t already here (existing ones win)
- **Replace** erases everything here first (you must type RESTORE)` },
    { title: 'Moving to a new computer', body: 'Export a backup on the old computer, install the app on the new one, open Settings → Backup & restore and restore with **Replace**.' },
    { title: 'Backup history', target: 'panel:Backup history', body: 'Backups exported from this browser, with fingerprints and whether they were encrypted.' },
    { title: 'Data health', route: '/settings?tab=health', target: 'panel:Storage', body: 'Storage used, whether the browser granted **persistent storage** (less likely to be cleared — click “request” if not), the database version and last backup.' },
    { title: 'Integrity checks', target: 'panel:Integrity checks', body: 'Checks for broken links between records, documents whose files are missing or changed, and records in the deleted state. **Permanently purge deleted records** removes them for good.' },
    { title: 'Practice data', target: 'panel:Demonstration data', body: 'Load or remove the fictional practice data (everything marked DEMO) at any time.' },
    { title: 'Your turn: make a backup', route: '/settings?tab=backup', target: 'button:Export backup…', body: 'Click **Export backup…** and save the file somewhere safe.', tryIt: { hint: 'Export a backup.', check: async (ctx) => (await getDb().backups.filter((b) => b.createdAt >= ctx.startedAt).count()) > 0 } }
  ]
};
