# Known limitations

This list is deliberately explicit. Items marked **Not implemented** are absent; **Partial** items work with the
stated restrictions; **Flagged** items are recorded and shown for review but not calculated.

## Not implemented (by design in this build)

| Item | Notes |
| --- | --- |
| Live bank, broker, exchange, wallet, accounting or prop-firm connections | Framework only (`src/connectors`). No credentials are requested or stored; no network sync. Use CSV imports. |
| Automatic exchange-rate / price download | Import published tables (e.g. RBA historical data) or enter rates with a source. |
| Electronic lodgment of tax returns or BAS | Reports are preparation documents for a tax agent. |
| OCR / automatic reading of PDF statements or receipts | Documents are stored with hashes and basic metadata only. |
| Encrypted local database | Browser storage is protected only by the operating-system account. Backups can be encrypted. |
| Multi-user / cloud sync | Single person, single browser profile. Move data with backups. |
| Market data / mark-to-market valuations | “Open positions” use the last recorded trade price as an approximate mark. |

## Tax calculations not performed (flagged in results)

* HELP / study-loan compulsory repayments.
* Medicare levy surcharge; private health insurance rebate adjustments.
* Spouse/family Medicare thresholds (singles thresholds assumed), dependants.
* Medicare levy low-income reduction for FY2025–26 and FY2026–27 (thresholds not entered/verified).
* Working-holiday-maker rates; part-year residency (tax-free threshold pro-rating) — estimate not available.
* Non-resident CGT limits to taxable Australian property (non-residents get no discount and a warning).
* Non-commercial loss rules (Div 35); carry-forward of revenue/tax losses (opening amounts can be recorded as info).
* Trading-stock (Div 70) closing-stock valuation for share traders; the stock register is informational.
* Foreign income tax offset limit calculation above the $1,000 de minimis.
* Employment termination payments (concessional components).
* 45-day holding-period rule for franking credits.
* Small business income tax offset and other offsets (other offsets can be entered manually).
* Put-option exercise; written-option close-out and assignment adjustments; non-rollover takeovers.
* FY2026–27 rates are entered as **unverified** (15% bottom rate) and must be checked against ATO publications.

## Partial

| Area | Restriction |
| --- | --- |
| Trust / managed-fund distributions | Approximated from cash, tax-deferred and capital-gain components; use the AMMA statement figures (flagged). Capital-gain components treated as non-discount gross gains (flagged). |
| Low-value pool | Simplified per asset, not a pooled balance. |
| Instant asset write-off | Threshold from rule set; eligibility (turnover, dates) not tested. |
| Depreciation balancing adjustments | Computed; private-use and CGT interaction left to review. |
| GST / BAS | Quarterly summaries only (G1, 1A, 1B, GST-free); monthly cycles noted; PAYG instalments not on BAS. |
| Corporate actions | Splits, consolidations, bonus issues, rollovers, symbol changes, spin-offs and returns of capital are processed; taxable mergers are recorded and flagged for manual transactions. |
| Crypto DeFi | Liquidity pools, lending/borrowing, wrapped tokens and bridges can be recorded with the generic sides (swap, send/receive, income, fee, adjustment); their specific tax treatment is **not** inferred and must be classified (default review). |
| NFTs | Recorded as CGT parcels like other crypto assets; personal-use asset rules not applied. |
| Futures daily mark-to-market | Daily settlement rows are supported as statement P&L; mixing them with matched trades for the same contract is flagged as possible double counting. |
| Cash balances | Computed from recorded flows in each currency; derivative P&L from matched positions is added in balance checks. Interest/margin not otherwise modelled. |
| Transfer matching | Suggests pairs (same asset, different accounts, received ≤ sent within 2%, ≤ 72 hours); the user confirms. |
| Specific identification UI | Lists all parcels of the instrument; availability at the disposal date is validated by the engine (shortfall matched FIFO and flagged). |
| Localisation | Display uses Australian formats; native date pickers follow the browser/OS locale. |

## Technical limitations

* **Browser storage can be cleared or evicted.** Keep exported backups. Data is tied to the browser profile and the
  site address (`http://localhost:<port>`).
* Very large ledgers: the engines process 100,000 transactions in roughly 2 seconds on a typical desktop (measured
  in the automated test environment); tables page in memory. Browsers limit storage per site (often hundreds of
  MB to several GB; shown in *Data health*). Backups of very large ledgers with many documents produce large JSON
  files.
* The full report lists every record in scope; extremely large years produce long PDFs.
* jsPDF’s built-in fonts are Latin-1; characters outside it (e.g. CJK names) are replaced in PDFs (they remain intact
  in the app, CSV exports and backups).
* The service worker requires `localhost` or HTTPS; opening `dist/index.html` directly from the file system will not
  work offline — use the included server.

## Testing limitations

* Expected tax results in tests are hand-calculated from published ATO rate tables and formulas; they have **not**
  been reviewed by a registered tax agent.
* Browser tests run in Chromium only; Firefox and Safari were not tested.
* Performance was measured in a containerised CI-like environment, not on end-user hardware.
