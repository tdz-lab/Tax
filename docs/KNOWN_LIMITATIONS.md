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

See [TAX_RULE_VERIFICATION.md](TAX_RULE_VERIFICATION.md) for the official-source evidence behind every rate and
threshold, and [VALIDATION_STATUS.md](VALIDATION_STATUS.md) for the summary.

* **2026–27 Medicare levy low-income and family reductions** — thresholds not yet published; the full 2% is shown
  and flagged. The married-person MLS own-income test is not applied for 2026–27 either.
* **Any CGT event on or after 1 July 2027** — enacted reforms (deemed sale and reacquisition on 1 July 2027; 0%
  discount for individuals except new residential dwellings) are not implemented; results are blocked.
* HELP/study-loan repayments for foreign or part-year residents (overseas repayment obligations).
* Medicare levy: exemption days for foreign-resident periods of part-year residents; the interaction of a half
  exemption with the family reduction; super lump sums excluded from Medicare/MLS income (2022–23, 2023–24).
* Seniors and pensioners tax offset (SAPTO) and its Medicare thresholds; private health insurance rebate
  adjustments; the LITO cap for people under 18.
* Working-holiday-maker estimates treat all income as working holiday income (the law taxes other income above it).
* CGT discount apportionment for foreign or temporary residency periods (s 115-105, 115-115); non-resident CGT
  limits to taxable Australian property (non-residents get no discount and a warning).
* Non-commercial loss rules (Div 35); reduction of tax losses by net exempt income.
* Trading-stock (Div 70) closing-stock valuation for share traders; the stock register is informational.
* Foreign income tax offset: deductions related to foreign income are assumed nil in the limit calculation and
  foreign capital gains are not identified; excess foreign tax is not carried forward (it cannot be).
* Forex realisation gains/losses on foreign currency balances (Div 775) — flagged only; the limited balance election
  can be recorded but its $250,000 balance test is not checked; the election out of the 12-month rule is not
  supported.
* Indexation of cost base for assets acquired at or before 21 September 1999 — flagged only (CPI factors not entered).
* Franking credit holding period: only a recorded-trades heuristic (no last-in-first-out parcel rule, no 90-day rule
  for preference shares, no options/short positions, no related-payments test); franking credits are never removed
  automatically.
* Wash sales: a 30-day review flag, not a rule; losses are still included.
* Personal-use asset exemption (crypto/NFTs) — not applied; collectables are not distinguished.
* Employment termination payments (concessional components); small business income tax offset; temporary full
  expensing, the small business pool and the car limit; other offsets can be entered manually.
* Put-option exercise; written-option close-out and assignment adjustments; non-rollover takeovers.

## Partial

| Area | Restriction |
| --- | --- |
| Trust / managed-fund distributions | Ordinary income approximated from cash minus tax-deferred and capital-gain components. With AMMA components (discounted / indexation / other) the discounted gain is grossed up and re-discounted after losses; a single “capital gain component” is treated as a non-discount gain (flagged). Foreign-source trust gains are not separated. |
| Low-value pool | Simplified per asset, not a pooled balance. |
| Instant asset write-off | Threshold from rule set; eligibility (turnover, dates) not tested. |
| Depreciation balancing adjustments | Computed; private-use and CGT interaction left to review. |
| GST / BAS | Quarterly summaries only (G1, 1A, 1B, GST-free); monthly cycles noted; PAYG instalments not on BAS. |
| Corporate actions | Splits, consolidations, bonus issues, rollovers, symbol changes, spin-offs and returns of capital are processed; taxable mergers are recorded and flagged for manual transactions. |
| Crypto DeFi | Liquidity pools, lending/borrowing, wrapped tokens and bridges can be recorded with the generic sides (swap, send/receive, income, fee, adjustment); their specific tax treatment is **not** inferred and must be classified (default review). |
| NFTs | Recorded as CGT parcels like other crypto assets; personal-use asset rules not applied (noted for disposals costing $10,000 or less). |
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

* Expected tax results in tests come from official ATO tables, ATO worked examples and the legislation, checked with
  reference implementations written separately from the application. The ATO pages were read as printed copies
  supplied by the user (ato.gov.au refuses connections from the build server); some printouts were partial.
  Nothing has been reviewed by a registered tax agent or compared with ATO lodgment software.
* Browser tests run in Chromium only; Firefox and Safari were not tested.
* Performance was measured in a containerised CI-like environment, not on end-user hardware.
