import type { Tour } from '../types';
import { tryCreated, tryOpenDialog, tryValue } from './helpers';

export const transactionsTour: Tour = {
  id: 'transactions',
  section: '/transactions',
  title: 'Transactions & the record editor',
  summary: 'Find, filter, edit, bulk-edit and delete records; every part of the record editor, autosave, history and undo.',
  minutes: 8,
  needsData: true,
  steps: [
    { title: 'One ledger for everything', route: '/transactions', target: 'h1', body: 'Every income, expense, trade, transfer, deposit/withdrawal, fee and adjustment lives in one list. The Tax & Business and Trading pages are filtered views of these same records — nothing is entered twice.' },
    { title: 'Filters', target: '.toolbar', body: `Narrow the list by:
- **year** (selected year or all years)
- **type**, **tax classification**, **account**, **currency**
- **Missing rate** — foreign-currency records without a historical AUD rate
- **Show deleted** — deleted records you can restore

Filters are remembered while you move around the app.` },
    { title: 'Quick filter box', target: '[aria-label="Filter table"]', body: 'Type to filter the rows shown (description, payer, symbol, account, reference, tags). Several words must all match.' },
    { title: 'Columns', target: 'button:Columns', body: 'Choose which columns to show — e.g. turn on **Time**, **Price**, **Recon** or **Source** (manual / import / demo).' },
    { title: 'Sorting', target: 'col:Date', body: 'Click any column heading to sort; click again to reverse. ▲ / ▼ shows the direction.' },
    { title: 'Columns explained', target: 'col:AUD', body: `- **Amount** — in the original currency (for trades: quantity × price × multiplier)
- **AUD** — converted at the record’s historical rate; **no rate** in red means the rate is missing
- **Tax classification** — orange when it needs review
- **Docs** — number of linked receipts / statements` },
    { title: 'Paging', target: '.pager', body: 'Large ledgers are split into pages. Change rows per page or jump to the first/last page here.' },
    { title: 'Selecting rows', target: '[aria-label="Select page"]', body: 'Tick rows (or the header box for the whole page) to **Bulk edit** or **Delete** many records at once. After ticking a page you can “select all” matching rows.' },
    { title: 'Bulk edit', body: `Bulk edit changes only the fields you fill in: category, tax classification, account, business flag, reconciliation status, or add a tag. You can give a reason, which goes into the audit history.

Changing category or account re-works automatic classifications; choosing a classification fixes it.` },
    { title: 'Deleting and undo', body: 'Deleting moves records to a deleted state. A notice with **Undo** appears for a few seconds, and you can also restore later with **Show deleted**. Permanent removal happens only from Settings → Data health.' },
    { title: 'Create a record', target: 'button:+ New record', body: 'Opens the record editor.', tryIt: tryOpenDialog('Click “+ New record”.') },
    { before: [{ ensureDialog: 'button:+ New record' }], title: 'Record type', target: 'label:Record type', body: `First choose what you are recording:
- **Income**, **Expense**, **Fee**
- **Trade** (buy, sell, swap, futures, options, CFDs, P&L statements, financing…)
- **Transfer** (between your own accounts/wallets)
- **Deposit / withdrawal** (never taxable)
- **Adjustment** (opening balances, lost/stolen assets, corrections)

The form changes to show only relevant fields.`, tryIt: tryValue('Choose “Expense”.', 'label:Record type', 'expense') },
    { title: 'Date, time and time zone', before: [{ select: ['label:Record type', 'expense'] }], target: 'label:Time zone', body: `Enter the date (and time if you know it) **as shown on the statement**, and the time zone it was recorded in.

The app stores the exact moment in UTC and works out which Australian financial year it belongs to in **your** time zone — important for US trades near 30 June.

Times can be typed as 2:30 PM or 14:30.` },
    { title: 'Description, category and account', target: 'label:Category', body: 'Categories decide the default tax classification (e.g. “Software and subscriptions” → business expense, “Private / personal” → not deductible). The account is optional for income and expenses, required for trades.' },
    { title: 'Currency and amount', target: 'label:Currency / asset', body: 'Type the currency of the amount (AUD, USD, EUR… or a crypto symbol). The **AUD value** beside it updates once a historical exchange rate is available.' },
    { title: 'Deductibility & GST', before: [{ fill: ['label:Amount', '110'] }], target: 'text:Deductibility & GST', body: `- **Business / work-use %** — only this share is claimed (private use excluded)
- **Business (sole trader) expense** — counts towards the business schedule
- **GST treatment** and **GST amount** — tracked only if you enter them; use “1/11 of amount” for GST-inclusive taxable purchases
- **Split across categories** — divide one payment between categories and percentages` },
    { title: 'Classification & notes', target: 'text:Classification & notes', body: `**Tax classification** is automatic (from the category, account and your rules) — the current result is shown in the list. Choose a specific classification to override it; your choice is never changed automatically.

Also here: payer/supplier, tags, **Tax event date** (only if it differs from the transaction date), reconciliation status and notes.` },
    { title: 'Your turn: add a practice expense', target: 'button:Add record', body: 'Fill in: a **Date** in the selected year, a **Description** (e.g. “Practice expense”), **Category** e.g. “Software and subscriptions”, **Amount** e.g. 110. Then click **Add record**. (You can delete practice records at the end.)', tryIt: tryCreated('Fill the fields and click “Add record”.', (t) => t.kind === 'expense') },
    { title: 'Now it saves automatically', target: '.modal-foot', body: 'After the record is added, every change is saved a moment after you stop typing — “Saved” with the time appears here. **Save now** (or Ctrl+S) forces an immediate save.' },
    { title: 'Conversion, documents, provenance, history', target: 'text:Supporting documents', body: `Below the form of a saved record:
- **Historical AUD conversion** — the exact rate, its source and how it was chosen (foreign records)
- **Supporting documents** — attach a receipt or link an existing document
- **Provenance & timestamps** — record ID, source, original time and zone, UTC, financial year, import row
- **Audit history** — every change, when, and why` },
    { title: 'Close the editor', target: 'button:Close', body: 'Close saves any pending change first. **Delete** (bottom left) deletes the record with Undo available.', tryIt: { hint: 'Click “Close”.', check: (ctx) => !ctx.dialogOpen() } }
  ]
};
