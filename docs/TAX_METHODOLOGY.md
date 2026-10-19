# Tax methodology

This document explains how AU Tax & Trading Ledger treats each supported Australian tax event, which parameters it
relies on, and which items **require user or tax-agent review**. It describes the code in `src/engines/`.

> The application prepares records and estimates for review by a registered tax agent. It is not tax advice and
> not ATO-certified. Where Australian tax treatment depends on the taxpayer’s circumstances, the application asks
> for an explicit classification or flags the item — it never silently guesses.

## 1. General principles

| Principle | Implementation |
| --- | --- |
| Decimal arithmetic | All amounts and quantities are decimal strings processed with `decimal.js` (40 significant digits, half-up). No binary floating point is used for money. |
| Rounding | Values are kept unrounded internally; reports display cents (half-up). Taxable income is truncated to whole dollars (ATO ignores cents). |
| Unknown ≠ zero | A missing exchange rate or cost base makes the affected figure *unknown* (`null`); totals that depend on it show **INCOMPLETE** and the year’s readiness is blocked. |
| Traceability | Every total carries the IDs of the records it was computed from; CGT disposals carry their parcel allocations. |
| Versioned rules | Rates/thresholds are data in `src/engines/tax/rules.ts`, each rule set has an id, version, verification status and sources. Snapshots record the rule-set id; new rules never rewrite stored snapshots. |
| Separate economics from tax | *Trading → Performance* shows broker-style economic P&L (including simulated prop-firm trading); tax results come only from the tax engine. |

## 2. Financial year and time

* FY = 1 July – 30 June; labelled by its ending year (FY2025 = FY2024–25 = 1 Jul 2024 – 30 Jun 2025).
* Each record stores the original wall-clock time and **IANA time zone**, the UTC instant, and the **taxpayer-local
  date** (Settings → time zone, default `Australia/Sydney`). The FY comes from the taxpayer-local date, or from an
  explicit *tax event date* if one is entered.
  Example (tested): 30 June 2026 3:00 PM New York = 1 July 2026 5:00 AM Sydney → FY2026–27.
* Records whose trading-venue date and taxpayer-local date fall in different FYs are flagged (*FY boundary*).
* Daylight saving: non-existent local times (spring forward) are shifted forward; ambiguous times (fall back)
  resolve to the earlier offset (tested).
* The current FY is derived from the clock in the taxpayer’s time zone; it is never hard-coded.

## 3. Classification

Each record has a tax classification (`TAX_CLASSES` in `src/domain/types.ts`) and a *source*:

1. **User** — chosen on the record or by bulk edit. Never overwritten automatically.
2. **Import** — set by an import (e.g. bank lines without a category are *Unclassified*).
3. **Rule** — user-defined rules (Settings → Tax & classification) by record type, side, asset class, account,
   category, FY range or description text, evaluated in order.
4. **Account** — from the account’s declared tax treatment:
   * *Investor — capital account* → share/crypto/option disposals are CGT events.
   * *Carrying on a business of trading* or *isolated profit-making undertaking* → realised results are revenue
     (ordinary income / deductible losses), no CGT discount.
   * *Not yet determined* → **Needs specialist review**; results are excluded from totals and the year is blocked.
   * Prop-firm *evaluation* and *funded — simulated* accounts → **Simulated**, excluded from tax entirely.
5. **Category** — the default for income/expense categories (e.g. salary → Salary & wages; prop-firm payout →
   Needs review).
6. **Default** — deposits/withdrawals are *Non-taxable*; transfers between own accounts are *Own transfer (no
   disposal)*; adjustments are *Needs review*.

Items classified *Needs review* or *Unclassified* are listed under “Awaiting review” and excluded from totals.

## 4. Income

| Item | Treatment |
| --- | --- |
| Salary/wages, allowances, government payments, interest, rent, other ordinary income | Sum of gross AUD amounts by classification. PAYG/TFN withholding (AUD) is collected as a credit. |
| ETP | Listed, **not** included (concessional ETP rules not implemented) — review. |
| Australian dividends | Assessable = franked + unfranked amounts + franking credits (gross-up). Franking credits are a refundable offset. If the franked/unfranked split is missing the total is treated as unfranked and flagged. The 45-day holding-period rule is **not** tested (flagged for credits > $5,000). |
| Trust / managed-fund distributions | Ordinary component ≈ cash − tax-deferred − capital-gain component (an approximation of the AMMA statement; flagged). Tax-deferred amounts reduce the CGT cost base of the holding (pro rata across parcels); capital-gain components are included in CGT as gross non-discount gains and flagged for review of discount/other method components. |
| Foreign income | Gross foreign amount (before foreign tax) converted at the transaction’s historical rate. Foreign tax paid is converted at the same rate. |
| Business income | GST-exclusive when the business is GST-registered and the record carries GST. |
| Crypto staking/rewards | Ordinary income at AUD market value when received; the tokens become a parcel with that cost base. Airdrops and mining default to *Needs review* (character depends on circumstances); chain-split (fork) tokens default to non-assessable with a nil cost base (review). |
| Prop-firm payouts and refunds | Default *Needs review*. Once classified (e.g. business income) they flow into the business schedule without re-entry. |

## 5. Deductions and business expenses

* Deductible amount = AUD amount × business/work-use %. For GST-registered businesses, GST on taxable purchases is
  excluded (claimed as a GST credit instead), and GST credits on BAS are limited to the business-use portion.
* Split transactions apportion one payment across categories/percentages; splits must sum to the total.
* Category defaults: work-related, self-education, memberships, tax-agent fees, donations, investment expenses →
  *Potentially deductible*; business operating expenses/software → *Business expense*; interest → *Financing
  expense* (shown as an estimate; deductible only to the extent it relates to assessable income); private →
  *Not deductible*; equipment, trading fees, data feeds, bank fees, prop-firm fees, depreciation → *Needs review*.
* Substantiation is not judged by the software; missing receipts are flagged.
* Brokerage on CGT assets is **not** a separate deduction — it is included in the cost base or reduces proceeds.

## 6. Depreciation (asset register)

* Prime cost: cost × days held ÷ 365 × 100% ÷ effective life.
* Diminishing value: base value × days held ÷ 365 × 200% ÷ effective life (assets acquired after 10 May 2006).
* Instant asset write-off: full cost in the first year — the threshold is taken from the rule set (e.g. $20,000 for
  2023–24/2024–25 small business entities); eligibility and unverified years are flagged.
* Low-value pool: simplified per-asset 18.75% in the first year, 37.5% thereafter (flagged).
* Deduction = decline in value × business-use %. Disposals compute a balancing adjustment (flagged for review).
* Days held count from the later of acquisition/installed-ready date and 1 July, to the earlier of disposal and
  30 June, inclusive.

## 7. Capital gains tax

### 7.1 Parcels (lots)

* Each acquisition creates a parcel: quantity, acquisition date/time (taxpayer-local date for the holding test) and
  AUD cost base = gross consideration × historical rate + fees (each converted at its own rate).
* Identical assets are pooled **per instrument and tax treatment** across accounts (own transfers therefore do not
  break parcel history).
* Partial disposals consume parcels proportionally; remaining cost base is reduced pro rata.

### 7.2 Cost-basis method

* Default per asset class: **FIFO**. Alternatives: **specific identification** (choose parcels on the disposal),
  and LIFO / highest-cost-first as parcel-selection *identification orders*. The method precedence is record →
  account → asset-class default.
* The application never chooses a method because it lowers tax. Average cost is not offered for CGT parcels.
* If specific identification does not cover the quantity, the remainder is matched FIFO and flagged.

### 7.3 Capital proceeds and gains

* Proceeds = gross consideration × rate − selling fees.
* Gain = proceeds − cost base of the parcels consumed; losses are kept as positive “capital loss” amounts.
* If the disposal exceeds recorded holdings, the excess is flagged **MISSING_COST_BASE** and the result is unknown.

### 7.4 CGT discount

* 50% (`cgtDiscountIndividual`) for **resident** individuals on **capital-account** assets acquired **at least 12
  months before** the CGT event. Following ATO guidance, the day of acquisition and the day of the event are
  excluded: an asset acquired 1 July 2023 qualifies if disposed of on or after 2 July 2024 (tested, including 29
  February acquisitions).
* Applied per parcel, so a disposal of mixed parcels can be partly eligible.
* Not applied to revenue-account results, written-option premiums (CGT event D2) or non-residents (flagged).

### 7.5 Net capital gain (ATO method statement order)

1. Total current-year gains (discount-eligible and other).
2. Apply current-year capital losses — by default against *non-discount gains first* (configurable).
3. Apply net capital losses from earlier years (computed by replaying earlier years in the app, unless an opening
   balance is entered in the year’s tax profile).
4. Apply the 50% discount to the remaining discount-eligible gains.
5. Net capital gain = remaining non-discount gains + discounted gains. Unused losses carry forward.

If any CGT event in the year is incomplete, the net capital gain is INCOMPLETE. If an earlier year is incomplete, the
carried-forward amount is flagged.

### 7.6 Corporate actions

| Action | Treatment |
| --- | --- |
| Split / consolidation / bonus issue | Units × ratio; total cost base and acquisition dates unchanged. |
| Scrip-for-scrip (rollover) / symbol change | Parcels move to the new instrument with ratio applied, original acquisition date and cost base retained (rollover eligibility flagged for review). |
| Spin-off / demerger | The entered % of each parcel’s cost base moves to new parcels of the new instrument (acquisition date inherited — demerger relief assumed and flagged). |
| Return of capital | Cost base reduced by cash per unit; any excess over the cost base is a CGT event G1 gain (flagged). |
| Taxable merger / other | Recorded and flagged; must be entered as specific transactions after review. |

### 7.7 Crypto specifics

* **Crypto → crypto swap**: disposal of the asset given at the AUD market value of the event (minus fees); the
  asset received is acquired at that market value. The AUD value must be recorded (from the source, a price
  record, or entered) — otherwise flagged MISSING_VALUATION.
* **Buying with a stablecoin / other crypto** (e.g. BTC priced in USDT): the quote asset is disposed of at the AUD
  value of the purchase; selling into a stablecoin acquires a stablecoin parcel. Stablecoins need price records —
  never assumed to equal US$1.
* **Own-wallet transfers**: no disposal; a network fee paid in the asset is a small disposal at its market value.
  Unmatched transfers are flagged; transfers explicitly marked as to/from a third party are treated as disposals
  (gift/payment) or receipts at market value and flagged.
* **Lost/stolen**: recorded as a *Needs review* write-off (not counted) — a capital loss may only be claimable with
  evidence.
* **Spam/dust tokens** marked as spam are excluded and listed.

## 8. Derivatives, short positions and options

* **Futures, CFDs, forex positions and short sales** are matched FIFO per account and instrument (long and short).
  Realised P&L = (exit − entry) × quantity × multiplier in the contract currency, converted at the **closing
  transaction’s** historical rate; fees are converted at the rate of their own transaction.
* **Statement P&L rows** (`realised_pnl`, `settlement`) are taken as recorded (signed). If an account/instrument
  has both statement P&L and matched trades, possible double counting is flagged.
* **Financing / swap charges** are revenue items for trader accounts and *Financing expense* (review) otherwise.
* Classification by account treatment: revenue accounts → *Revenue trading*; capital accounts → *Needs review*
  (gains on CFDs, futures and forex are commonly on revenue account, e.g. TR 2005/15 for CFDs); undetermined →
  *Needs review*; simulated → excluded.
* **Bought options** are CGT parcels (premium × multiplier + fees). Sale = disposal; **expiry** = disposal with nil
  proceeds (capital loss of the premium); **exercise of a call** adds the option’s cost to the cost base of the
  linked underlying purchase (no gain/loss on the option); exercise of a put is flagged (not computed).
* **Written options** on capital account: the premium is a CGT event D2 gain when written (no discount); closing a
  written option, assignment and the interaction with the underlying are flagged for specialist review; expiry of a
  written option has no further effect.
* Trading stock rules (Div 70 closing-stock valuation for share traders) are **not** calculated (flagged).

## 9. Prop-firm activity

* Evaluation and simulated-funded trading are excluded from tax (economic results remain visible in Performance).
* Evaluation, reset, subscription and withdrawal fees default to *Needs review*; when the account is declared a
  business, trading-group fees are classified as business expenses.
* Payouts and refunds default to *Needs review* until classified. Payout statements can be linked as documents.

## 10. GST / BAS

* GST is never assumed. Each business record states its GST treatment (taxable, GST-free, input-taxed, imported
  service, review) and GST amount; a 1/11 helper is offered for taxable GST-inclusive amounts.
* Quarterly summaries: G1 total sales (GST-inclusive), GST-free sales, 1A GST on sales, 1B GST credits (business
  portion), net GST; records needing review and records without rates are counted. Monthly cycles are noted.
* The application does not lodge BAS.

## 11. Tax estimate

Computed only when the year’s **residency** is recorded and a **rule set** exists:

1. Taxable income = assessable income (income + franking credits + net business income + net revenue trading +
   net capital gain) − deductions, truncated to whole dollars (≥ 0; a tax loss is flagged, not carried).
2. Tax on taxable income using resident or non-resident brackets.
3. LITO (residents; $700 reducing by 5c per $1 above $37,500 and 1.5c per $1 above $45,000; nil above $66,667),
   limited to tax payable.
4. Medicare levy 2% with the singles low-income shade-in (10c per $1 above the lower threshold) where thresholds are
   verified for the year; half/full exemptions honoured. Where thresholds are not verified (FY2025–26, FY2026–27)
   the reduction is **not** applied and the levy is flagged for incomes where it could matter.
5. Offsets/credits: foreign income tax offset limited to the $1,000 de minimis (larger claims flagged for a limit
   calculation), franking credits (refundable), user-entered other offsets, PAYG withheld and instalments.
6. Result = tax − LITO − FITO − other offsets + Medicare − franking credits − PAYG withheld − instalments.

Status is **Estimate** when there are no blocking issues, **Incomplete** otherwise, **Not available** when residency
or rules are missing. Working-holiday-maker and part-year residency are not supported (flagged).

## 12. Rule sets

| Rule set | Status | Notes |
| --- | --- | --- |
| AU-IND-FY2023-v1 | verified | Pre-Stage-3 rates (19 / 32.5 / 37 / 45%); Medicare singles $24,276–$30,345; LITO. |
| AU-IND-FY2024-v1 | verified | As above; Medicare singles $26,000–$32,500. |
| AU-IND-FY2025-v1 | verified | Stage 3 rates (16% to $45,000, 30% to $135,000, 37% to $190,000, 45%); Medicare singles $27,222–$34,027. |
| AU-IND-FY2026-v1 | partially verified | Stage 3 rates; Medicare low-income thresholds not entered → reduction not applied, flagged. |
| AU-IND-FY2027-v1 | unverified | 15% bottom rate legislated from 1 July 2026 — verify against ATO publications; Medicare thresholds not entered. |

Verification here means the parameters were checked against the published ATO tables listed in each rule set’s
`sources`. Tests reproduce the ATO’s published “$X plus Yc for each $1 over $Z” figures for several incomes.
Additional or corrected rule sets can be imported as JSON (*Settings → Tax rule sets*); they need new ids/versions
and do not alter existing snapshots.

## 13. Items always requiring review

HELP/study-loan repayments · Medicare levy surcharge · private health insurance rebate · spouse/family thresholds ·
non-commercial loss rules · trading-stock valuation · ETPs · FITO above $1,000 · trust distribution components ·
holding-period rule for franking credits · put-option exercise and written-option close/assignment · capital-account
derivatives · prop-firm payouts/fees until classified · crypto airdrops, mining, lending/DeFi · lost or stolen
assets · corporate-action rollovers and demergers · return-of-capital excesses · non-resident CGT (taxable
Australian property) · depreciation balancing adjustments and instant asset write-off eligibility.
