# Test report

Environment of the recorded run: Linux container, Node.js 22.22.0, Chromium (Playwright 1.56.1 bundled build),
Vitest 2.1.4 with jsdom 25 and `fake-indexeddb`. Date of run: 20 October 2026 (Australia/Sydney), version 1.2.0.

## Commands and results

| Command | What it checks | Result |
| --- | --- | --- |
| `npm run typecheck` | TypeScript strict mode, app + tests + configs | **Passed** (0 errors) |
| `npm run lint` | ESLint (typescript-eslint, react-hooks) | **Passed** (0 errors, 0 warnings) |
| `npm test` | 154 unit/integration tests in 10 files | **154 passed, 0 failed** |
| `npm run build` | Production build + service worker (Workbox precache of 41 entries) | **Passed** |
| `npm run test:e2e` | 5 Playwright tests against the production build (incl. every tutorial step) | **5 passed, 0 failed** |

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

### Independently derived tax tests (`tests/unit/tax-independent.test.ts`, new in 1.2.0 — 51 tests)
* **Separate reference implementation**: integer-cents tax from the ATO’s “$base + c for each $1 over $threshold”
  tables (typed from the ATO text, not from the app’s rule sets) compared with the engine at 25 incomes per scale,
  including every threshold and threshold + $1, for resident 2022–23 to 2026–27, foreign resident 2025–26 and
  working holiday makers 2024–25 / 2025–26; continuity of the ATO base amounts.
* **ATO worked examples**: part-year tax-free threshold (3 months $14,648; 6 months $15,832); FITO limit
  ($2,581.80 − $260.80 = $2,321.00 with $3,400 paid).
* **Hand-calculated edge cases**: Medicare single shade-in at $28,011 / $30,000 / $35,013 / $35,014; family test
  (exactly at the threshold, children, sole parent, between thresholds → flagged, above the limit, missing spouse
  income → flagged); MLS tiers at threshold and threshold + $1, RFB / net investment loss, days without cover,
  family + per-child increase, leap-year day count; HELP 2025–26 at every band boundary and $1 either side of
  $179,285; FITO default limit.
* **Provenance**: no built-in current rule set claims “verified”; every one records checks for each core
  parameter; version 1 sets retained; conflicting/unconfirmed parameters are null rather than guessed.
* **Engine scenarios**: FITO limit above $1,000; HELP added to payable and capped at the balance; HELP 2024–25
  flagged; MLS included / not guessed when cover unknown; Medicare family nil levy; part-year estimate and
  missing-months block; WHM 2025–26 and unsupported 2023–24; prior-year and current-year tax losses; trust AMMA
  gross-up with losses and re-discount; pre-CGT disregarded (19 Sep 1985 vs 20 Sep 1985 boundary, indexation flag);
  wash-sale flag; franking > $5,000 without ex-date, possible holding-period failure, ≤ $5,000 exemption; Div 775
  warning vs recorded election; crypto personal-use note.

### Australian tax (`tests/unit/tax.test.ts`) — expected values hand-calculated from published ATO tables/formulas
* Resident rates FY2024–25 at $80,000 ($14,788), $150,000 ($36,838), $200,000 ($56,138); FY2023–24 at $80,000
  ($16,467); non-resident FY2024–25.
* LITO at $30k/$40k/$50k/$70k; Medicare levy shade-in (FY2024–25 singles thresholds) and half exemption; flagged
  when thresholds are not confirmed (FY2026–27).
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
  tax-year computation **≈0.18 s**, 25,456 disposals, no incomplete results (measured in the test container).

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

### Interactive tutorials (`tests/e2e/tutorials.spec.ts`)
4. **Every tutorial step** — with practice data loaded, all 30 tutorials (318 steps) are run from the Tutorials
   page; at every step the highlighted element must be found on screen. “Your turn” steps are skipped (so the test
   also proves later steps recover when a user skips); the only exceptions are 11 steps that by design need the
   user’s action first (e.g. the mapping screen after choosing a CSV file, the conversion panel of a just-saved
   record). Completion progress is recorded for all 30.
5. **Interactive step** — “Your turn” keeps *Next* disabled until the user performs the action (opening the
   record editor, choosing a record type), shows “✓ Done!”, then unlocks; the practice-data prompt appears when
   there are no records; *Exit tutorial* closes it.

## Additional manual checks performed

* Visual inspection of tutorial cards and spotlight placement (inside dialogs and on pages).
* Visual inspection of every page and tab (desktop 1440 px) and the dashboard at phone width (390 px, no horizontal
  scrolling).
* Rendered PDF pages of both reports inspected as images (layout, repeated headers, page numbers, disclaimers).
* Local server (`scripts/serve.mjs`): correct MIME types, SPA fallback, path traversal attempts served `index.html`.

## Not tested / limitations of testing

* **What the tax tests prove — and do not prove.** They show that the code reproduces the rates, thresholds and
  formulas as read from ATO pages, and that two independent implementations agree. They do **not** prove those
  figures are complete or current: the ATO pages were read through web-search summaries because ato.gov.au was
  blocked in the build environment (see [VALIDATION_STATUS.md](VALIDATION_STATUS.md)). Nothing was compared with
  ATO lodgment software or reviewed by a registered tax agent. Passing tests does not make the application
  tax-ready.
* Browsers other than Chromium (Firefox, Safari, mobile browsers) were not tested automatically.
* Installation via the double-click launchers on real Windows/macOS machines was not performed (the launchers
  call the same `node scripts/serve.mjs` that was tested on Linux).
* The File System Access “Save as” dialog cannot be automated; tests use the download fallback.
* The franking 45-day check, wash-sale flag and Div 775 warning are review heuristics; their tests prove the flags
  appear, not that the underlying legal tests are satisfied.
