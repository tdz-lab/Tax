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
| Australian dividends | Assessable = franked + unfranked amounts + franking credits (gross-up). Franking credits are a refundable offset. If the franked/unfranked split is missing the total is treated as unfranked and flagged. **Small shareholder exemption:** if total franking credits for the year are **less than $5,000** the holding period rule does not apply (the related payments rule still does). At **$5,000 or more**, each franked dividend needs an ex-dividend date and instrument; the app flags dividends where shares held fewer than 45 days (excluding acquisition and disposal days) were sold within 45 days after the ex-dividend date (possible failure), and those it cannot test. It is a recorded-trades check only — the ATO's last-in-first-out parcel rule, options, short sales and other risk-reducing positions are not tested, and credits are never removed automatically. |
| Trust / managed-fund distributions | Ordinary component ≈ cash − tax-deferred − capital-gain components. **With AMMA components** (discounted gain, indexation method, other method): the discounted gain is grossed up ×2 (the other half is the CGT concession amount, which is part of the cash), enters the netting as a discount-eligible gain, and your own losses are applied before the 50% discount is re-applied; indexation/other-method gains are non-discount gains. **Without components** (single “capital gain component”), the amount is treated as a non-discount gross gain and flagged. Tax-deferred amounts reduce the CGT cost base of the holding (pro rata across parcels). Foreign-source trust gains and the trust’s own losses are not separately handled. |
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
* **Pre-CGT assets:** parcels acquired before 20 September 1985 (capital account) are disregarded for CGT events
  before 1 July 2027 (ITAA 1997 s 104-10(5)) — their gain or loss is excluded and the disposal is flagged
  **PRE_CGT** (confirm the date, and that no corporate action or major capital improvement changed the status).
* **CGT events on or after 1 July 2027:** the enacted reforms (deemed sale and reacquisition on 1 July 2027 —
  Subdiv 112-E; 0% discount for individuals except new residential dwellings — s 115-100) are **not implemented**.
  Such disposals raise a blocking **CGT_2027_REFORM** issue and no discount is applied.
* **Indexation:** for parcels acquired at or before 11:45 am (ACT time) on 21 September 1999 and held at least 12
  months, the indexation method may be chosen instead of the discount (ITAA 1997 s 110-36). Indexation is **not
  calculated** (CPI factors not entered); such disposals are flagged **INDEXATION_OPTION** (the time of day is not
  checked) and the discount method is used.
* **Wash sales:** a capital loss on an asset re-acquired within 30 days before or after the sale is flagged
  **WASH_SALE_REVIEW** (ATO TR 2008/1 — Part IVA may deny the loss). The 30-day window is a review heuristic, not a
  legal rule; the loss is still included.
* **Personal-use assets:** the exemption (s 118-10) is **not applied** to crypto or NFTs; disposals costing $10,000
  or less are noted for review.

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
   net capital gain) − deductions − **prior-year tax losses** (entered in the tax profile; deducted up to the
   income remaining after deductions), truncated to whole dollars (≥ 0). Unused losses plus any current-year tax
   loss are carried forward (total shown). Net exempt income and the non-commercial loss rules (Div 35) are **not**
   applied (flagged).
2. Tax on taxable income using the scale for the recorded residency:
   * **Resident** — resident brackets.
   * **Foreign resident** — foreign-resident brackets (2024–25 figures had conflicting ATO search results; flagged).
   * **Part-year resident** — resident brackets with the tax-free threshold pro-rated (Income Tax Rates Act s 20):
     $13,464 + $4,736 × months resident ÷ 12, part months counting as whole months (s 16). Requires the months to be
     entered. Full LITO applies (ITAA 1997 s 61-110: resident at any time in the year). The Medicare levy is shown for
     a full year (exemption for foreign-resident days not calculated) and the CGT discount is not apportioned
     (s 115-105) — both flagged.
   * **Working holiday maker** — WHM scale (Income Tax Rates Act Sch 7 Pt III): 2022–23 and 2023–24 15% to $45,000,
     32.5% to $120,000, 37% to $180,000, 45%; from 2024–25 15% / 30% / 37% / 45% at $45,000 / $135,000 / $190,000.
     All taxable income is treated as working holiday income (the law taxes other income above it — flagged); no
     LITO, Medicare levy or CGT discount.
3. LITO (residents; $700 reducing by 5c per $1 above $37,500 and 1.5c per $1 above $45,000; nil above $66,667),
   limited to tax payable.
4. **Medicare levy** 2% (Medicare Levy Act s 6) with the single low-income limit of s 7 (no levy at or below the
   threshold amount; at most 10% of the excess up to the phase-in limit); half/full exemptions honoured. **Family
   reduction** (s 8; spouse on 30 June, or dependent children): family income = your taxable income + your spouse’s
   (a negative amount counts as $0). No levy if family income ≤ the family income threshold (+ per-child amount);
   otherwise the levy is reduced by 2% × threshold − 8% × (family income − threshold), and — when the spouse’s own
   taxable income exceeds the threshold amount — that reduction is reduced by the spouse’s share of family income
   (s 8(3)). Missing spouse income, a half exemption with family, or a year without published thresholds (2026–27)
   are flagged, never assumed.
5. **Medicare levy surcharge** (residents): income for MLS purposes = taxable income + reportable fringe benefits +
   total net investment loss + reportable super contributions + exempt foreign employment income. Tier rate (1%,
   1.25%, 1.5%) by single or family thresholds (family + $1,500 per dependent child after the first; spouse’s MLS
   income added) × (taxable income + reportable fringe benefits) × days without cover ÷ days in the year (ATO example:
   ($90,000 + $27,000) × 1% = $1,170). A married person whose own income for MLS purposes does not exceed the
   threshold amount pays no MLS (Medicare Levy Act s 8D(3)(c)). Not calculated (flagged) when cover status is
   unknown, a Medicare exemption is recorded, spouse income is missing, or the s 8D(3)(c) amount is not published
   (2026–27).
6. **Compulsory study-loan repayment** (residents with a debt): repayment income = taxable income + reportable fringe
   benefits + total net investment loss + reportable super + exempt foreign employment income (ATO). 2022–23 to
   2024–25: one rate from the ATO table applied to the whole repayment income; 2025–26: nil to $67,000, 15c per $1
   to $125,000, $8,700 + 17c per $1 to $179,285, 10% of the total from $179,286; 2026–27: nil to $69,528, 15c per $1
   to $129,717, $9,028 + 17c per $1 to $186,050, 10% of the total from $186,051. Capped at the loan balance if
   entered. Foreign and part-year residents: flagged, not calculated.
7. **Foreign income tax offset:** up to $1,000 claimed without a limit. Above $1,000 the ATO limit method is used —
   step 1 tax + Medicare levy + MLS on taxable income (offsets disregarded); step 2 the same with foreign income
   (records classed as foreign income or carrying foreign tax) removed; limit = step 1 − step 2 if more than
   $1,000, otherwise $1,000; offset = lesser of foreign tax and limit. Deductions related to foreign income are
   assumed nil (may overstate the limit) and foreign capital gains are not identified — flagged.
8. Result = tax − LITO − FITO − other offsets + Medicare levy + MLS + study-loan repayment − franking credits − PAYG
   withheld − instalments.

Status is **Estimate** when there are no blocking issues, **Incomplete** otherwise, **Not available** when residency,
rules or the needed scale (e.g. WHM in years not confirmed) are missing.

**Foreign currency (Div 775):** forex realisation gains and losses on foreign currency balances (for example, USD
held at a broker after selling US shares, later converted to AUD) are **not calculated**. Records in a foreign fiat
currency raise a FOREX_DIV775 warning; recording a limited balance election (A$250,000 balance test, written
election kept with your records) lowers it to an information note. Gains on foreign shares themselves are fully
converted at historical rates as before.

## 12. Rule sets

Version 3 rule sets (`AU-IND-FY2023-v3` … `AU-IND-FY2027-v3`, 20 October 2026) replace versions 1 and 2. Earlier
versions are kept, marked *superseded*, so earlier calculation snapshots remain reproducible.

Version 3 is the result of an audit against official sources actually read — ATO pages (printed copies supplied
by the user, because ato.gov.au refuses connections from the build server) and Federal Register of Legislation
compilations. Each parameter carries a check (VERIFIED, partly verified, or unverified) with the source, the table
or section and the source’s date; they are shown in *Tax Calculations → How each figure was checked*, in
*Settings → Tax rule sets* and in the PDF report. No rule set as a whole is marked *verified*. The full evidence
is in [TAX_RULE_VERIFICATION.md](TAX_RULE_VERIFICATION.md) and the summary in
[VALIDATION_STATUS.md](VALIDATION_STATUS.md).

For years after 2026–27 there is no rule set: no tax estimate is produced and no CGT discount is applied.
Additional or corrected rule sets can be imported as JSON (*Settings → Tax rule sets*); they need new ids/versions
and do not alter existing snapshots.

## 13. Items always requiring review

HELP/study-loan repayments for foreign or part-year residents · MLS where inputs are missing · 2026–27 Medicare
low-income and family thresholds (not yet published) · private health insurance rebate · Medicare exemptions and
part-year Medicare days · SAPTO · CGT discount apportionment for foreign residency · any CGT event on or after
1 July 2027 · non-commercial loss rules · net exempt income ·
trading-stock valuation · ETPs · FITO related deductions and foreign capital gains · trust distributions without AMMA
components · franking holding-period rule (recorded-trade check only) · forex gains on foreign currency (Div 775) ·
indexation · wash sales · pre-CGT status · put-option exercise and written-option close/assignment · capital-account
derivatives · prop-firm payouts/fees until classified · crypto airdrops, mining, lending/DeFi · lost or stolen
assets · corporate-action rollovers and demergers · return-of-capital excesses · non-resident CGT (taxable
Australian property) · depreciation balancing adjustments and instant asset write-off eligibility.
