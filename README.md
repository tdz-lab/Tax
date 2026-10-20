# AU Tax & Trading Ledger

A local-first, offline-capable web application for keeping the records an Australian tax resident needs for their
individual tax return — personal income and deductions, sole-trader/business records, and extensive trading
activity (Australian and US shares, ETFs, crypto, forex, futures, options, CFDs and prop-firm accounts) — and for
producing professional PDF reports for review by a registered tax agent.

> **Important.** This is a recordkeeping and tax-preparation tool. It is **not** tax advice, it is **not**
> ATO-certified, and it **cannot lodge** tax returns or BAS. Every estimate it shows depends on your data and on
> the assumptions it lists. Have a registered tax agent review your figures.

---

## Contents

1. [What it does](#1-what-it-does)
2. [What it does not do](#2-what-it-does-not-do)
3. [System requirements](#3-system-requirements)
4. [Installation and first launch (no programming needed)](#4-installation-and-first-launch)
5. [Using it offline / installing it as an app](#5-offline-use-and-installing-as-an-app)
6. [Automatic saving](#6-automatic-saving)
7. [Backup and restore](#7-backup-and-restore)
8. [Importing CSV files](#8-importing-csv-files)
9. [Creating your own import templates](#9-creating-your-own-import-templates)
10. [Currency conversion](#10-currency-conversion)
11. [Tax calculations](#11-tax-calculations)
12. [Reports](#12-reports)
13. [Updating the application](#13-updating-the-application)
14. [Database migrations](#14-database-migrations)
15. [Troubleshooting](#15-troubleshooting)
16. [Known limitations](#16-known-limitations)
17. [Testing](#17-testing)
18. [Development](#18-development)
19. [Future integration architecture](#19-future-integration-architecture)
20. [Project layout](#20-project-layout)

Further documents: [Tax methodology](docs/TAX_METHODOLOGY.md) · [Architecture](docs/ARCHITECTURE.md) ·
[Known limitations](docs/KNOWN_LIMITATIONS.md) · [Validation status](docs/VALIDATION_STATUS.md) · [Test report](docs/TESTING.md) ·
[Adding a connector](docs/CONNECTORS.md)

---

## 1. What it does

| Area | Implemented |
| --- | --- |
| **Dashboard** | Income, business, deductions, estimated taxable income, CGT gains/losses, trading results by tax classification, dividends, crypto income, foreign income & FX exposure, data-quality counts (unclassified, missing cost bases, missing rates, unmatched transfers, duplicates, reconciliation, missing evidence), readiness, last backup/import. Every total opens its source records. |
| **Tax & Business** | Income and expense ledgers with configurable categories, business-use %, GST tracking, split transactions, recurring entries; sole-trader profile (ABN, GST registration, BAS frequency); business P&L and cash-flow; GST/BAS quarterly summaries; asset register with prime-cost / diminishing-value / instant write-off / low-value-pool depreciation; vehicle, travel and home-office logs; trading-stock records; per-year tax profile (residency incl. part-year months, Medicare, spouse and dependants, private cover and days without cover, income-test amounts, HELP and loan balance, carried-forward capital and tax losses, forex election). |
| **Trading & Investments** | Multiple accounts (brokers, exchanges, wallets, futures, forex, CFD, options, prop-firm evaluation/funded, bank) each with an explicit tax treatment; instrument registry (multipliers, tick size, expiry, strike, call/put, spam flag); trade ledger; holdings and acquisition parcels; economic performance (separate from tax); derivative positions; prop-firm fees/payouts; corporate actions (splits, consolidations, bonus issues, scrip-for-scrip rollover, spin-offs, return of capital, symbol changes). |
| **Engines** | Decimal arithmetic everywhere; CGT parcel engine (FIFO, specific identification, LIFO/HIFO identification orders), partial disposals, 12-month discount test, loss netting and carry-forward; crypto-to-crypto swaps, stablecoin quote assets, staking income, forks, own-wallet transfers, network fees; futures/CFD/forex/short-position P&L; written-option D2 events; versioned tax rule sets with a per-parameter check record; Medicare levy family test, Medicare levy surcharge, study-loan repayments (2025–26), part-year and working-holiday-maker scales, FITO limit, tax-loss carry-forward, trust AMMA capital-gain components, pre-CGT exemption, review flags for indexation, wash sales, franking 45-day rule and Div 775 forex; historical FX engine with provenance. |
| **Imports** | CSV import wizard with automatic layout detection, column mapping, constants, value mapping, date-format detection (day-first vs month-first), time zones, validation, duplicate detection (source IDs + occurrence-aware fingerprints), preview of totals, atomic commit, rejected-row reporting, rollback, reusable templates, 13 sample files. Wide (one column per currency) and long rate tables. |
| **Documents** | Local storage of PDF/JPG/PNG/CSV files with SHA-256, linking to any record, missing-evidence views, basic local metadata extraction (no OCR). |
| **Tax calculations** | Recorded totals, calculated amounts, estimates, items awaiting review and readiness kept separate; traceability to records; rule-set version and warnings; immutable calculation snapshots with history. |
| **Reports** | Report A (basic annual summary) and Report B (33-section tax-agent report) as PDF, generated offline; CSV exports; print view; report snapshots with SHA-256. |
| **Reconciliation** | Data-quality summary, statement balance and holding checks, own-transfer matching, duplicate review, unresolved classifications. |
| **Interactive tutorials** | 30 guided tutorials (≈325 steps) that move through the real app, spotlight each button, field and table, explain it, and wait for you on “Your turn” steps. Detailed coverage of trading (accounts & tax treatment, instruments, shares, crypto, derivatives & options, parcels/lots, performance, prop firms, corporate actions) and currencies (conversion methodology, importing rates, manual rates & overrides, markets/time zones/FY boundaries). Optional practice data, progress tracking, a complete course, and cleanup of practice records. |
| **Data management** | Automatic saving, crash-recoverable drafts, undo for deletes, audit history, full backups (optionally encrypted), restore (replace or merge), integrity checks, demonstration data. |

## 2. What it does not do

* **No live connections** to banks, brokers, exchanges, wallets or accounting systems. No credentials are requested
  or stored and no data leaves your device. The connector *framework* exists for future versions (see §19).
* **No lodgment** of tax returns or BAS, and no ATO-certified calculations.
* **No automatic download** of exchange rates or prices — you import published tables (e.g. RBA historical rates)
  or enter rates with their source. Missing rates are flagged, never guessed.
* **No OCR** or automatic reading of PDF statements.
* Some personal-tax items are **not calculated** or only partly calculated: HELP repayments outside 2025–26,
  the Medicare family reduction between the family thresholds, SAPTO, private health insurance rebate,
  non-commercial loss rules, forex gains on foreign currency balances (Div 775), indexation, ETP concessions. They
  are flagged in the results. Full list: [docs/KNOWN_LIMITATIONS.md](docs/KNOWN_LIMITATIONS.md).
* **Not tax-ready on its own.** Rates and thresholds were compared with ATO pages through web-search summaries and
  nothing has been reviewed by a registered tax agent — see [docs/VALIDATION_STATUS.md](docs/VALIDATION_STATUS.md).

## 3. System requirements

* A current desktop browser: **Google Chrome, Microsoft Edge or Brave (recommended)**, Firefox, or Safari 16+.
* **Node.js 18 or newer** (free, from <https://nodejs.org> — choose “LTS”) to run the small local web server.
  Nothing else is required to run the pre-built application included in the ZIP.
* About 200 MB of free disk space (more if you store many documents).

## 4. Installation and first launch

1. **Install Node.js** from <https://nodejs.org> (LTS version, default options).
2. **Unzip** `au-tax-trading-ledger-1.2.0.zip` somewhere permanent, e.g. your Documents folder.
3. **Start the application:**
   * **Windows:** double-click `start-windows.bat`.
   * **macOS:** right-click `start-mac.command` → *Open* (the first time macOS may ask you to confirm).
   * **Linux:** run `./start-linux.sh` in a terminal.
   * Or, in a terminal inside the folder: `node scripts/serve.mjs`
4. Your browser opens <http://localhost:4173>. If it doesn’t, open that address yourself. Keep the small
   terminal window open while you use the application.
5. **New to the app?** Click **Take the 4-minute guided tour** on the welcome screen, or open **Tutorials** in the menu
   (every section also has a **? Tutorial** button at the top right).
6. On the welcome screen, either load the **demonstration data** (fictional, clearly marked, removable) to explore,
   or start with your own records:
   1. *Tax & Business → Tax profile*: record your residency for the year.
   2. *Trading & Investments → Accounts*: add each broker/exchange/wallet/prop-firm/bank account and choose its tax
      treatment (investor, trader, or “not yet determined”).
   3. *Imports*: import historical exchange rates, then your statements. Or add records manually from any list.
   4. *Reconciliation*: resolve the issues listed.
   5. *Reports*: generate the PDFs for your tax agent.
   6. *Settings → Backup & restore*: export a backup.

The pre-built application is in `dist/`. If it is missing (e.g. you deleted it), the start scripts run
`npm install` and `npm run build` once (this needs an internet connection).

### Tutorials

*Tutorials* (menu) lists every tutorial by section with its length, whether it uses practice data, and your
progress. Choose **Quick start**, any single tutorial, **Run all in this section**, or the **Complete course** (all
30 in a sensible order). During a tutorial use **Next / Back**; **Your turn** steps unlock *Next* once you have
done the action (or press **Skip**); **Exit tutorial** stops at any time. When a tutorial finishes you can delete
any practice records you created and remove the practice (DEMO) data.

## 5. Offline use and installing as an app

After the first visit, the application caches itself in your browser (service worker) and **works without an
internet connection** — adding, editing, searching, importing local files, calculating, generating PDFs and
backups all work offline. The top bar shows *Online* / *Offline*.

To install it as an app: in Chrome/Edge click the install icon in the address bar (or menu → *Install AU Tax &
Trading Ledger*). The installed app still needs the local server to be running **only the first time** it is
opened on a computer; afterwards it opens from the browser’s cache. (Running `node scripts/serve.mjs` is always a
safe way to start it.)

Your data belongs to the browser profile and the address you used (`http://localhost:4173`). Using a different
browser, profile or port shows a different, empty database — use backups to move data.

## 6. Automatic saving

* Edits to existing records save automatically a moment after you stop typing; the top bar shows
  **Saving… / Saved / Save failed**. *Save now* (or **Ctrl+S**) is available for reassurance.
* New records are kept as a **draft** (recovered automatically after a crash or accidental close) until you click
  **Add record**; after that, changes save automatically.
* Deletes can be undone from the notification, and deleted records can be restored until you purge them
  (*Settings → Data health*).
* Every create/update/delete, rate override, import and rollback is written to the **audit history**.
* If something cannot be saved (e.g. validation fails or storage is full) you see the reason — nothing is
  silently discarded.

## 7. Backup and restore

Browser storage can be cleared by you, by the browser under storage pressure, or lost with the device.
**It is not a backup.** The top bar reminds you when your last backup is older than the reminder period.

* **Export:** *Settings → Backup & restore → Export backup…*. Choose whether to include document files and,
  optionally, a password. Files are named `au-tax-ledger-backup-YYYYMMDD-HHMMSS[.encrypted].json`, so existing
  backups are never overwritten. In Chrome/Edge you choose the folder; other browsers save to *Downloads*.
* **Encryption:** with a password the backup is encrypted with AES-256-GCM using a key derived by PBKDF2-SHA-256
  (600,000 iterations) through the browser’s WebCrypto API. A lost password cannot be recovered.
* **Integrity:** each backup carries the schema version, application version, record counts and SHA-256 hashes;
  tampered or corrupted files are rejected.
* **Restore:** choose the file (and password). After verification you can **Merge** (add records not already
  present; existing records win and conflicts are counted) or **Replace** (erase current data first — you must
  type `RESTORE`). Older backups are migrated to the current schema automatically; backups from a newer version
  are refused.

## 8. Importing CSV files

*Imports → Choose CSV file…*

1. Choose what the file contains (or let the app recognise a known layout).
2. Choose the **default account** the records belong to (or map an *Account name* column).
3. Check the **date format** (the app warns when dates like 01/02/2025 are ambiguous), the **time zone** of the
   times in the file (e.g. `America/New_York` for a US broker, `UTC` for many crypto exchanges) and the decimal
   separator.
4. Map columns to fields. Unmapped columns are kept with the raw source row, never discarded. Unrecognised
   transaction types (e.g. “Bought”, “STO”) can be mapped to a side.
5. **Preview & validate**: each row shows *new*, *duplicate source*, *likely duplicate* or *changed source*,
   with errors and warnings, plus totals per currency. You can change the action per row (import / skip / update).
6. **Import**. The batch is written atomically. The summary lists created, updated, skipped and rejected rows.
7. **Roll back** any batch from *Import history* (you are warned if records were edited after import).

Duplicate prevention uses the source’s transaction ID when present, plus a fingerprint of account, time,
instrument, side, quantity, price, amount and description **with an occurrence number**, so two genuinely
identical fills in one file are kept as two records, while re-importing the same file creates nothing new.

**Samples:** *Imports → Sample files* (or `public/samples/`) has fictional CSVs for income, expenses, bank
transactions, shares, crypto trades, wallet transfers, dividends, forex, futures, options, CFDs, prop-firm payouts
and historical rates. Every value — including the exchange rates — is invented and labelled DEMO.

**Exchange-rate tables:** import long tables (`Date, Base, Quote, Rate, Source`) or wide tables (a date column
plus one column per currency code, as in the RBA’s historical F11 data once you remove its extra header rows —
use *Skip leading rows*). State whether values are “units per 1 AUD” or “AUD per unit” and name the source.

## 9. Creating your own import templates

In the mapping step, enter a name under *Save mapping as template*. The template stores the mapping, constants,
value mappings, date format, time zone and decimal separator. Files whose header row matches a template are
recognised automatically next time. Manage templates in *Settings → Import templates*.

## 10. Currency conversion

* Every record keeps its **original amount and currency**. AUD values are derived as amount × rate and never
  re-converted from rounded AUD figures.
* The rate used for each record is stored with **provenance**: AUD per unit, the rate exactly as quoted and its
  direction, rate date/time, type (daily reference, execution, intraday, manual, cross), source, methodology,
  retrieval time, record IDs, whether a prior-day rate was used, and any manual override with its reason. Previous
  rates are kept in the record’s rate history.
* **Methodology** (*Settings → Currencies & rates*): prefer broker execution rates when present; otherwise the
  daily reference rate for the event date in your time zone (or the trading venue’s date); optional look-back of
  up to N days for weekends/holidays (flagged); optional cross rates via USD. No methodology is presumed legally
  correct for every event — document your choice for your tax agent.
* Crypto and stablecoins need **price records** (e.g. `USDT/AUD`) — a stablecoin is never assumed to equal US$1.
* **Missing rates** are flagged everywhere (record, dashboard, data quality, reports). Fix them by importing rates
  or entering a manual rate with its **source and reason**; affected figures recalculate automatically.

## 11. Tax calculations

See [docs/TAX_METHODOLOGY.md](docs/TAX_METHODOLOGY.md) for exactly how each item is treated. In short:

* Financial years run 1 July – 30 June and are assigned using **your** time zone (a US trade at 3 PM New York on
  30 June is 1 July in Sydney).
* Each trading account has an explicit **tax treatment** (investor/capital, business trader, profit-making, or
  undetermined). Undetermined results are excluded from totals and block “ready” status.
* CGT: parcels matched by the selected method; brokerage in cost base/proceeds; 50% discount only for
  capital-account assets held at least 12 months (acquisition and disposal days excluded) by residents;
  losses applied before the discount; carry-forward computed year to year (or from an opening balance you enter).
* Tax estimates use **versioned rule sets** (FY2022–23 to FY2026–27). Every parameter records how it was checked
  (ATO page via search summary, legislation, conflicting, or not confirmed) — shown under *Tax Calculations → How
  each figure was checked* and in the PDF report. Unconfirmed parameters are left out (and the calculation flagged)
  or used with a warning; unimplemented items are listed.
* The estimate includes the Medicare levy (single and family test), Medicare levy surcharge, study-loan repayment
  (2025–26), the foreign income tax offset limit and carried-forward tax losses, each with the assumptions shown.
* *Tax Calculations* shows recorded totals, calculated amounts, estimates, items awaiting review and readiness
  separately; every line opens its source records. *Save calculation snapshot* stores an immutable snapshot with
  the rule-set version, an input fingerprint and your reason; earlier snapshots are never rewritten.

## 12. Reports

*Reports & PDF Export*:

* **Report A — Basic annual tax summary** (compact).
* **Report B — Full tax-agent report** (33 numbered sections, parcel-level CGT detail, currency conversion ledger,
  document index, reconciliation, overrides, audit history, closing balances, questions for the agent).
* Options: financial year (top bar), included accounts and markets, optional schedules.
* **CSV exports**: transaction ledger with AUD values and rate provenance; CGT parcel allocations; tax summary lines.
* Each report records the calculation snapshot and rule set used and the file’s SHA-256.
* Reports are clearly marked as preparation documents — not ATO forms or lodged returns.

## 13. Updating the application

1. **Export a backup** first.
2. Replace the application folder with the new version (keep your backup files elsewhere).
3. Start it as usual. Your data lives in the browser, not in the folder, so it remains. When the browser detects
   the new version it asks whether to reload.
4. Database changes are migrated automatically on first open (see §14).

## 14. Database migrations

The IndexedDB schema is versioned (`src/db/schema.ts`). Each version’s store definitions are kept verbatim and
new versions add an `upgrade()` function that transforms existing records (v1 → v2 adds indexes and back-fills
required fields). Migrations run automatically when the app opens, record an audit event, and are covered by an
automated test that creates a v1 database and opens it with the current code. Backups record their schema
version and are migrated on restore.

## 15. Troubleshooting

| Problem | What to do |
| --- | --- |
| “Local database unavailable” | Private/incognito windows and some privacy settings block IndexedDB. Use a normal window and allow site data for `localhost`. |
| Port 4173 already in use | Close the other window, or run `node scripts/serve.mjs 4174` (note: a different port = a different browser database; restore a backup there). |
| My data disappeared | You may be using a different browser, profile or port, or site data was cleared. Restore your latest backup. |
| “No rate” badges | Import historical rates (*Imports*) or enter a manual rate with its source in the record. Check the time zone and date basis in *Settings → Currencies & rates*. |
| A disposal shows “missing cost base” | The holding was acquired before your records start, or a transfer in is not matched. Add an *Adjustment → Opening balance* with the original cost, or match the transfer. |
| Imported dates look wrong | Check the date format (day-first vs month-first) and the time zone in the mapping step; roll back and re-import. |
| Tax estimate “not available” | Record residency in the tax profile for that year. |
| PDF does not open | Use *Preview*, or allow pop-ups for `localhost`. |
| Storage nearly full | *Settings → Data health* shows usage. Export a backup, then remove large documents you no longer need. |

## 16. Known limitations

Summarised in §2; full, explicit list in [docs/KNOWN_LIMITATIONS.md](docs/KNOWN_LIMITATIONS.md).

## 17. Testing

```bash
npm install
npm run typecheck      # TypeScript (strict)
npm run lint           # ESLint
npm test               # unit/integration tests (Vitest, fake IndexedDB)
npm run build          # production build + service worker
npm run test:e2e       # browser tests (Playwright/Chromium): offline, backup/restore, PDFs, every tutorial step
npm run verify         # all of the above
```

Results of the last run and what each suite covers: [docs/TESTING.md](docs/TESTING.md).

## 18. Development

```bash
npm install
npm run dev            # http://localhost:5173 with hot reload (service worker disabled in dev)
npm run build && npm run preview   # production build at http://localhost:4173
npm run package        # creates release/au-tax-trading-ledger-<version>.zip
```

Stack: TypeScript, React 18, Vite 5, Dexie 4 (IndexedDB), decimal.js, Luxon, jsPDF + jspdf-autotable,
PapaParse, vite-plugin-pwa (Workbox), Vitest + Testing Library, Playwright. Architecture:
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Critical calculations live in `src/engines` (pure functions, no
React), persistence in `src/db` + `src/services`, UI in `src/ui`.

## 19. Future integration architecture

`src/connectors/` defines the connector contract (authorise, revoke, incremental fetch with cursors, normalise),
provider registry, connection-status model, retry/back-off policy and sync-job model. Every future connector must
feed the **same** import pipeline (duplicate detection → preview → explicit user approval → atomic commit →
rollback). No connector is active in this build. How to add one: [docs/CONNECTORS.md](docs/CONNECTORS.md).

## 20. Project layout

```
├── README.md                 this file
├── start-windows.bat / start-mac.command / start-linux.sh   double-click launchers
├── dist/                     pre-built application (served by scripts/serve.mjs)
├── docs/                     tax methodology, architecture, limitations, test report, connectors
├── public/                   icons, PWA assets, samples/ (fictional CSV samples)
├── scripts/                  serve.mjs (local server), package-zip.mjs, make-icons.mjs
├── src/
│   ├── domain/               types and reference data (categories, currencies, labels)
│   ├── lib/                  decimal, dates/financial years, ids/hashes, files
│   ├── db/                   Dexie schema + migrations
│   ├── engines/              currency, trading (lots, derivatives, performance), tax (rules, engine),
│   │                         business (depreciation, GST), reconciliation (quality, transfers, duplicates)
│   ├── services/             ledger write path, settings, classification, validation, calc snapshots,
│   │                         documents, demo data, recurring, integrity, bootstrap
│   ├── import/               CSV parsing, mapping, templates, commit/rollback
│   ├── backup/               backup/restore + WebCrypto encryption
│   ├── reports/              PDF (basic/full), CSV, report data gathering
│   ├── connectors/           future connector framework (inactive)
│   └── ui/                   React app: shell, components, pages, tour/ (tutorial engine + 30 tutorials)
└── tests/
    ├── unit/                 Vitest suites (engines, persistence, imports, backup, reports, UI, performance)
    └── e2e/                  Playwright browser workflows (offline, full workflow, navigation)
```
