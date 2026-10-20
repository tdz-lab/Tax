import type { Tour } from '../types';
import { tryRoute, tryValue } from './helpers';

export const gettingStarted: Tour = {
  id: 'getting-started',
  section: '/',
  title: 'Getting started — the app at a glance',
  summary: 'The layout, navigation, financial-year selector, search, saving, offline use and practice data.',
  minutes: 4,
  steps: [
    {
      title: 'Welcome',
      route: '/',
      body: `This app keeps your Australian tax records — income, expenses, sole-trader business, and trading in shares, crypto, forex, futures, options, CFDs and prop firms — and prepares reports for your tax agent.

Everything is stored **only in this browser on this computer**. Nothing is uploaded.

Use **Next** and **Back** to move through a tutorial. Steps marked **Your turn** wait for you to try something (you can always **Skip**).`
    },
    {
      title: 'The main menu',
      target: 'nav[aria-label="Main navigation"]',
      body: `The ten sections of the app:
- **Dashboard** — the year at a glance
- **Tax & Business** — income, expenses, business, assets, tax profile
- **Trading & Investments** — accounts, trades, holdings, performance
- **Transactions** — every record in one list
- **Imports** — bring in CSV statements
- **Documents & Receipts** — evidence files
- **Tax Calculations** — the tax working, step by step
- **Reports & PDF Export** — PDFs for your tax agent
- **Reconciliation** — find and fix data problems
- **Settings & Data** — preferences, exchange rates, backups

**Tutorials** at the bottom lists every tutorial.`
    },
    {
      title: 'Financial year',
      target: '[aria-label="Selected financial year"]',
      body: `Australian financial years run **1 July – 30 June**. FY2024–25 means 1 July 2024 to 30 June 2025.

Most pages show the year selected here. **Current year** (the first choice, and the default) moves on to the new financial year by itself each 1 July. Picking a specific year keeps that year until you change it.`
    },
    {
      title: 'Try changing the year',
      target: '[aria-label="Selected financial year"]',
      body: 'Pick a different financial year from the list. (The practice data, if loaded, is in FY2024–25.)',
      tryIt: tryValue('Choose any other financial year in the selector.', '[aria-label="Selected financial year"]', (v) => v !== '' && v !== 'auto')
    },
    {
      title: 'Search everything',
      target: '[aria-label="Global search"]',
      body: `Type at least two letters to search descriptions, payers/suppliers, symbols, accounts, documents, notes, tags and broker reference numbers.

Shortcut: press **/** anywhere to jump here. Use the arrow keys and Enter to open a result.`
    },
    {
      title: 'Automatic saving',
      target: '.save-ind',
      body: `Changes save automatically a moment after you stop typing. This badge shows **Saving…**, **Saved** or **Save failed** (with the reason).

New records are kept as a draft — even if the browser crashes — until you click **Add record**.`
    },
    {
      title: 'Online / offline',
      target: '.net-ind',
      body: 'Shows whether your computer is online. The app does **not** need the internet: after the first visit everything — including PDF reports and backups — works offline.'
    },
    {
      title: 'Backups matter',
      body: `Browser storage can be wiped (clearing browsing data, a new computer, a browser reset). **It is not a backup.**

When your last backup is older than the reminder period, a yellow badge appears at the top. Click it to go straight to *Settings → Backup & restore*. There’s a full tutorial on backups.`
    },
    {
      title: 'Disclaimers you will see',
      route: '/',
      target: '.disclaimer',
      body: 'This is a record-keeping and preparation tool — not tax advice, not ATO-certified, and it cannot lodge returns. Figures labelled **Estimate** depend on your data and the assumptions shown; **INCOMPLETE** means something is missing.'
    },
    {
      title: 'Open the Tutorials page',
      target: 'nav:Tutorials',
      body: 'Every tutorial — per section, plus a complete course — lives on the Tutorials page. The **Tutorial** button at the top right also lists the tutorials for the section you are in.',
      tryIt: tryRoute('Click “Tutorials” in the menu.', '/tutorials')
    },
    {
      title: 'You’re ready',
      body: `Suggested order for a new user:
- **Tax profile** (Tax & Business tutorials)
- **Trading accounts & tax treatment**
- **Currency & exchange rates**
- **Imports**
- **Reconciliation**, then **Reports**
- **Backup & restore**

Practice data (fictional, marked DEMO) can be loaded and removed at any time.`
    }
  ]
};

export const dashboardTour: Tour = {
  id: 'dashboard',
  section: '/',
  title: 'Dashboard',
  summary: 'Every tile explained — what it counts, how it’s calculated, and how to open the records behind it.',
  minutes: 4,
  needsData: true,
  steps: [
    { title: 'The Dashboard', route: '/', target: 'h1', body: 'A one-screen summary of the selected financial year. **Every tile is clickable** and opens the records behind it.' },
    { title: 'Readiness badge', target: '.page-head .badge', body: `Overall status of the year:
- **ready for agent review** — no blocking issues or warnings
- **needs attention** — warnings to explain to your agent
- **incomplete** — something essential is missing (residency, an exchange rate, a cost base, an unclassified record…)` },
    { title: 'Personal income', target: 'stat:Personal income recorded', body: 'Salary, allowances, interest, dividends (with franking credits), distributions, crypto rewards, foreign and other income — **recorded** amounts converted to AUD at each record’s historical rate.' },
    { title: 'Business income / expenses', target: 'stat:Business income / expenses', body: 'Sole-trader income and expenses (net of private use and GST credits where registered) and the resulting net business income. Click to open the business tab.' },
    { title: 'Deductions', target: 'stat:Deductions recorded', body: 'Potentially deductible personal expenses × your business/work-use %. Items still marked **Needs review** are excluded and counted underneath.' },
    { title: 'Estimated taxable income', target: 'stat:Estimated taxable income', body: 'Assessable income minus deductions, in whole dollars. Shown in red with **INCOMPLETE** while blocking issues exist, and **not available** until residency is recorded.' },
    { title: 'Capital gains', target: 'stat:Capital gains', body: 'Gross capital gains and capital losses for the year from the CGT engine, and the **net capital gain** after losses and the 50% discount. Click to see every disposal.' },
    { title: 'Try it: open the records behind a tile', target: 'stat:Capital gains', body: 'Click the Capital gains tile. A window lists the source records; click any record to open it.', tryIt: { hint: 'Click the Capital gains tile.', check: (ctx) => ctx.dialogOpen() } },
    { title: 'Trading by tax classification', before: [{ closeDialogs: true }], target: 'text:Trading results by tax classification', body: `Realised trading results grouped by how they are taxed:
- **Capital (CGT event)** — investor gains/losses
- **Revenue trading** — trader / profit-making results
- **Needs specialist review** — accounts whose treatment isn’t set yet (excluded from tax totals)
- **Financing** — swap and funding charges` },
    { title: 'Data quality tiles', target: 'text:Data quality & readiness', body: `Counts of problems that can change your tax result: unclassified records, missing cost bases, missing exchange rates, unmatched transfers, duplicate warnings, open reconciliation items, missing receipts.

**Red** = blocking, **orange** = warning, **green** = none. Click any tile to review the records.` },
    { title: 'Backup, import and rules status', target: 'stat:Last successful backup', body: 'When you last exported a backup and last imported a file, and which tax rule set (and its verification status) the year uses.' },
    { title: 'Blocking items', body: 'If anything blocks the year, a red box under the tiles lists it. Fix those first — the Reconciliation tutorial shows how.' }
  ]
};
