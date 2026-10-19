# Test report

Environment of the recorded run: Linux container, Node.js 22.22.0, Chromium (Playwright 1.56.1 bundled build),
Vitest 2.1.4 with jsdom 25 and `fake-indexeddb`. Date of run: 19–20 October 2026 (Australia/Sydney).

## Commands and results

| Command | What it checks | Result |
| --- | --- | --- |
| `npm run typecheck` | TypeScript strict mode, app + tests + configs | **Passed** (0 errors) |
| `npm run lint` | ESLint (typescript-eslint, react-hooks) | **Passed** (0 errors, 0 warnings) |
| `npm test` | 103 unit/integration tests in 9 files | **103 passed, 0 failed** |
| `npm run build` | Production build + service worker (Workbox precache of 41 entries) | **Passed** |
| `npm run test:e2e` | 3 Playwright tests against the production build | **3 passed, 0 failed** |

## What the automated tests cover

### Core (`tests/unit/lib.test.ts`, `currency.test.ts`, `persistence.test.ts`)
* Decimal arithmetic exactness, accounting-style number parsing, half-up money rounding, whole-dollar truncation,
  very small and very large values.
* Financial-year boundaries (30 June / 1 July), FY evaluated in the taxpayer time zone (US trade on 30 June NY time
  → FY2026–27 in Sydney), current FY derived from the clock, DST gap and overlap handling in Sydney, 12-hour time
  parsing/display, the CGT 12-month test (anniversary day, leap-day acquisitions).
* Currency conversion direction (inversion of AUD-base quotes), direct quotes, cross rates via USD (and disabled),
  stablecoins never assumed = US$1, prior-day look-back recorded, missing rates flagged (never zero/today’s rate),
  execution-rate preference, manual overrides requiring source + reason, reciprocal precision, rate validation.
* Persistence: create/update idempotent by id, audit diffs, closing and reopening the database, validation errors,
  soft delete/undo, FX resolved on save and refreshed when rates arrive, manual override history and removal,
  overseas time-zone handling, re-classification on account-treatment change, bulk updates, settings.
* **Database migration**: a real v1 database is created and opened with the v2 schema; records preserved and
  back-filled; compound index usable; migration audited.

### Australian tax (`tests/unit/tax.test.ts`) — expected values hand-calculated from published ATO tables/formulas
* Resident rates FY2024–25 at $80,000 ($14,788), $150,000 ($36,838), $200,000 ($56,138); FY2023–24 at $80,000
  ($16,467); non-resident FY2024–25.
* LITO at $30k/$40k/$50k/$70k; Medicare levy shade-in (FY2024–25 singles thresholds) and half exemption; flagged
  when thresholds are unverified (FY2025–26).
* CGT netting order (losses before discount; non-discount first), carry-forward.
* Scenarios: salary + deduction → refund ($89,000 taxable income, $17,488 tax, $1,780 Medicare, −$732);
  GST-registered business income/expenses and BAS credits; franked dividends gross-up and offset; foreign
  dividend with withholding → gross income and FITO; missing rate blocks finalisation; CGT discount (held > 12
  months) vs anniversary-day disposal; non-resident discount withheld; prior-year losses (computed chain) and
  explicit opening balance; prop-firm payouts excluded until classified; residency unknown → no estimate.

### Trading (`tests/unit/trading.test.ts`)
* FIFO partial disposal across parcels; LIFO/HIFO selection; specific identification; missing cost base flagged.
* US shares converted at each date’s historical rate; missing rate → unknown result.
* Corporate actions: split, return of capital (incl. G1 excess), scrip-for-scrip rollover preserving acquisition date.
* Crypto: crypto-to-crypto swap, stablecoin quote-asset disposal, staking income lot, fork nil cost base, own-wallet
  transfer with network-fee disposal, unmatched transfers, spam exclusion.
* Futures P&L with multiplier and per-leg fee conversion; CFD short, financing, capital-account review flag;
  option expiry loss; call exercise adding premium to the underlying; written option D2; simulated prop-firm
  trading excluded from tax but present in performance; holdings.

### Imports (`tests/unit/import.test.ts`)
* CSV parsing (quotes, BOM, extra columns kept), date formats incl. exact ISO instants, day-first/month-first
  detection, header auto-mapping, side normalisation, template detection, wide→long rate tables, rejected rows
  retained with reasons.
* Import commit; re-import of the same file creates no duplicates; identical fills within one file kept separate;
  changed values for the same source ID detected; rollback removes records and created instruments; **a failure
  mid-batch leaves no partial data**; rate imports and duplicate rate rows; broker execution rate pinned.

### Backup, reports, documents (`tests/unit/backup-reports.test.ts`)
* Demonstration data loaded through the import pipeline; FY2024–25 CGT figures checked by hand (e.g. DEMOA disposal:
  proceeds $7,855.05, cost base $6,429.925, mixed discount eligibility); data-quality issues detected; demo removal
  leaves nothing behind.
* **Both PDF reports generated** (valid `%PDF-` files; full report larger and multi-page), CSV export, report and
  calculation snapshots recorded (snapshot supersession).
* Every tax line’s source IDs resolve to real records (traceability).
* Backup round-trip (replace) with documents and links, SHA-256 document verification after restore, tamper
  detection, newer-schema refusal, merge-mode conflicts, encrypted backups (wrong password / tamper rejected,
  minimum password length), full encrypted export → restore.
* Document storage with SHA-256 and duplicate rejection; transfer-pair suggestions; immutable calculation snapshots.

### UI components (`tests/unit/ui.test.tsx`)
* DataTable pagination, sorting, filtering, page/all selection; decimal input validation keeps strings.

### Performance (`tests/unit/performance.test.ts`)
* 100,000 transactions (shares across 50 instruments, futures, expenses): lot + derivative engines **≈1.7 s**,
  tax-year computation **≈0.16 s**, 25,456 disposals, no incomplete results (measured in the test container).

### Browser end-to-end (`tests/e2e`, production build)
1. **Complete workflow** — record residency (autosave) → create an income record → autosaved edit → attach a
   document → **reload; record persists** → create an account → import a broker CSV (template recognised, preview,
   5 created) → **re-import detected as 5 duplicates** → missing USD rates flagged, then fixed by importing rates →
   correct a record (autosave) → save a calculation snapshot → **download both PDFs** (validated `%PDF-` headers,
   names) and the ledger CSV → **export backup** (validated JSON, counts, document included) → **restore into a fresh
   browser profile** (replace, typed confirmation) → records, document link, document hash verification and
   account all present. No page errors.
2. **Offline** — service worker installs and controls the page; with the network disabled the app reloads, a
   record is added, cached sample files load, a PDF is generated, and the record persists across an offline reload.
3. **Navigation** — with demonstration data, every main navigation item and every tab renders without page or
   console errors; a dashboard total opens its source records.

## Additional manual checks performed

* Visual inspection of every page and tab (desktop 1440 px) and the dashboard at phone width (390 px, no horizontal
  scrolling).
* Rendered PDF pages of both reports inspected as images (layout, repeated headers, page numbers, disclaimers).
* Local server (`scripts/serve.mjs`): correct MIME types, SPA fallback, path traversal attempts served `index.html`.

## Not tested / limitations of testing

* Browsers other than Chromium (Firefox, Safari, mobile browsers) were not tested automatically.
* Installation via the double-click launchers on real Windows/macOS machines was not performed (the launchers
  call the same `node scripts/serve.mjs` that was tested on Linux).
* The File System Access “Save as” dialog cannot be automated; tests use the download fallback.
* Tax expectations are hand-calculated from public ATO tables and formulas and **have not been reviewed by a
  registered tax agent**. Passing these tests does not prove the application is correct for every taxpayer.
* Rule sets for FY2025–26 (partially verified) and FY2026–27 (unverified) are not covered by expected-value tests.
