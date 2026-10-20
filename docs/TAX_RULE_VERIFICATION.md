# Tax rule verification audit

**Audit date:** 20 October 2026 · **Application version:** 1.3.0 · **Rule sets:** `AU-IND-FY2023-v3` … `AU-IND-FY2027-v3`

This document records, for every tax rate, threshold, formula and treatment the application implements, the
official source that was actually read, the figure found there, what the code does, and the result. It is the
evidence behind the statuses shown in *Tax Calculations → Rule set → How each figure was checked*.

> **This is not a statement that the application is tax-ready.** The audit compares the code with official
> published figures and legislation. It has not been reviewed by a registered tax agent, it was not compared
> with ATO lodgment software, and several scenarios remain unsupported (section 6).

## 1. How the sources were accessed

| Route | Result |
| --- | --- |
| Direct HTTP access to `www.ato.gov.au` from the build server | **Refused.** The network policy allowed the request, but the ATO’s content-delivery network (Akamai) answered *403 Access Denied* for every path, including `robots.txt`, from both `curl` and a real Chromium browser. Nothing on ato.gov.au could be read directly. |
| ATO pages printed to PDF by the user from their own browser (20 Oct 2026, 4:00–4:09 pm) and uploaded | **Used.** Each PDF carries the page title, the (truncated) ato.gov.au URL in its header, and the page’s *Last updated* / *Published* date. Some printouts contain only the first pages of a long page — noted below. |
| Federal Register of Legislation (`www.legislation.gov.au`) | **Used.** Authorised compilations downloaded as PDF and read in full text. |
| `treasury.gov.au` | Reachable; not needed — every figure was found in the ATO pages or the legislation. |
| `studyassist.gov.au` | Connection reset (HTTP/2 stream error); not needed — the ATO study-loan page covers every year. |
| Web-search summaries | **Not relied on.** Figures previously recorded from search summaries (v1.2) were re-checked against the sources below; one test that used summary figures was replaced. |

### 1.1 Official sources read

| # | Source | Identifier / location | Date on source |
| --- | --- | --- | --- |
| A1 | ATO — *Tax rates – Australian resident* | ato.gov.au/tax-rates-and-codes/tax-rates-austr… (URL truncated in print). Printed pp 1–3 of 19 only. | Last updated 13 Aug 2026 |
| A2 | ATO — *Tax rates – foreign resident* | ato.gov.au/tax-rates-and-codes/tax-rates-forei… pp 1–2 of 14 | Last updated 1 Jun 2026 |
| A3 | ATO — *Tax rates – working holiday maker* | ato.gov.au/tax-rates-and-codes/tax-rates-work… pp 1–2 of 5 | Last updated 1 Jun 2026 |
| A4 | ATO — *Medicare levy reduction for low-income earners* | ato.gov.au/individuals-and-families/medicare… | Last updated 30 Jun 2026 |
| A5 | ATO — *M1 Medicare levy reduction or exemption 2023* | ato.gov.au/individuals-and-families/your-tax-… (14 pp; pp 1–7 read) | Last updated 25 May 2023 |
| A6 | ATO — *M1 Medicare levy reduction or exemption 2024* | as above (13 pp; pp 1–7 read) | Published 29 May 2024 |
| A7 | ATO — *M1 Medicare levy reduction or exemption 2025* | ato.gov.au/forms-and-instructions/individual-… QC 104128 (12 pp, all read) | Published 27 May 2025 |
| A8 | ATO — *M1 Medicare levy reduction or exemption 2026* | ato.gov.au/forms-and-instructions/individual-… (printed pp 1–3 of 12; uploaded twice, identical files) | Last updated 30 May 2026 |
| A9 | ATO — *Medicare levy surcharge income, thresholds and rates* | QC 49961 (7 pp, all read) | Last updated 22 Jun 2026 |
| A10 | ATO — *Study and training loan minimum repayment income and rates* | ato.gov.au/tax-rates-and-codes/study-and-trai… QC 16176 (12 pp, all read) | Last updated 13 Oct 2026 |
| A11 | ATO — *Calculate your FITO or offset limit* (Guide to foreign income tax offset rules 2024) | QC 101688 (11 pp, all read) | Published 30 May 2024 |
| A12 | ATO — *Personal investors guide to capital gains tax 2025* | QC 104651 (51-page PDF, text layer read) | Published 29 May 2025 |
| A13 | ATO — *Forex elections* | ato.gov.au/businesses-and-organisations/corp… (pp 1–11 of 20 read) | Last updated 4 Oct 2022 |
| A14 | ATO — *Refund of franking credits for individuals* | QC 16183 (6 pp) | Last updated 22 Jun 2026 |
| A15 | ATO — *Rules on claiming a franking credit refund* (not-for-profit guidance; used only for the qualification-period definitions) | QC 81972 | Last updated 28 Aug 2025 |
| A16 | ATO — *How to claim a tax loss* | printed pp 1–4 of 6 | Last updated 4 Mar 2025 |
| A17 | ATO — *Instant asset write-off for eligible businesses* | QC 61417 (9 pp) | Last updated 28 Aug 2026 |
| L1 | *Income Tax Rates Act 1986* — Compilation No. 66 | legislation.gov.au/C2004A03348/2026-07-01/2026-07-01/text/original/pdf (C2026C00300) | In force 1 Jul 2026 |
| L2 | *Income Tax Rates Act 1986* — Compilation No. 61 | legislation.gov.au/C2004A03348/2023-10-20/2023-10-20/text/original/pdf | 20 Oct 2023 |
| L3 | *Medicare Levy Act 1986* — Compilation No. 53 | legislation.gov.au/C2004A03351/2026-07-01/2026-07-01/text/original/pdf (C2026C00295) | 1 Jul 2026 |
| L4 | *Medicare Levy Act 1986* — Compilations No. 49, 50, 51, 52 | …/C2004A03351/2023-06-24/…, /2024-03-06/…, /2025-01-01/…, /2025-03-28/… | 24 Jun 2023; 6 Mar 2024; 1 Jan 2025; 28 Mar 2025 |
| L5 | *Income Tax Assessment Act 1997* — Compilation No. 267 (vols 2 and 3) | legislation.gov.au/C2004A05138/2026-08-27/2026-08-27/text/original/pdf/2 and /3 (C2026C00400) | 27 Aug 2026 |

**Tying a compilation to an income year.** Each Medicare Levy Act compilation’s single thresholds were matched to the
ATO M1 page for the year (A5–A8); the family limits printed in the M1 worksheets equal 1.25 × the Act’s family
income threshold (the point where the s 8(2) reduction reaches nil), which cross-checks the family figures.

## 2. Status definitions

| Status | Meaning |
| --- | --- |
| **VERIFIED** | The figure or formula was read in an official source above and the implementation matches it exactly (and is covered by a test). |
| **PARTIALLY VERIFIED** | Part was confirmed; the remainder is stated (e.g. the method is confirmed but an input or sub-rule is simplified). |
| **MISMATCH FOUND → FIXED** | The code differed from the official rule; corrected in v1.3 with a regression test. |
| **UNVERIFIED** | No official source read for it, or the source does not yet publish it. Not used, or used with a warning. |

## 3. Results by rule and year

### 3.1 Income tax rates

| Rule | Year | Implemented | Official evidence | Status | Tests |
| --- | --- | --- | --- | --- | --- |
| Resident rates | 2022–23 | 0 / 19% > $18,200 / 32.5% > $45,000 / 37% > $120,000 / 45% > $180,000 | L2 Sch 7 Pt I table “2020-21, 2021-22, 2022-23 or 2023-24”; A1 shows the first two 2022–23 rows (rest cut off in print) | VERIFIED | independent integer-cents reference, 25 incomes (`tax-independent`) |
| Resident rates | 2023–24 | as above | A1 “Resident tax rates 2023–24” ($5,092 + 32.5c; $29,467 + 37c; $51,667 + 45c); L2 | VERIFIED | same |
| Resident rates | 2024–25, 2025–26 | 16% / 30% > $45,000 / 37% > $135,000 / 45% > $190,000 | A1 tables ($4,288 + 30c; $31,288 + 37c; $51,638 + 45c); L1 Sch 7 Pt I “2024-25 or 2025-26” | VERIFIED | same |
| Resident rates | 2026–27 | 15% then as above | A1 “Resident tax rates 2026–27” ($4,020 + 30c; $31,020 + 37c; $51,370 + 45c); L1 table for 2026-27 (enacted; 14% from 2027-28) | VERIFIED | same |
| Tax-free threshold | all | $18,200 | L1/L2 s 3 “tax-free threshold means $18,200” | VERIFIED | boundary tests at 18,200 / 18,201 |
| Foreign-resident rates | 2022–23, 2023–24 | 32.5% to $120,000 / 37% / 45% > $180,000 | A2 (both years); L2 Sch 7 Pt II | VERIFIED (was unverified) | `tax-official` reference |
| Foreign-resident rates | 2024–25 | 30% to $135,000 / 37% / 45% > $190,000 | A2 “Foreign resident tax rates 2024–25”; L1 Sch 7 Pt II “2024-25 or later” | VERIFIED — **earlier conflict resolved** (the v1.2 search summary that showed 32.5% for 2024–25 was wrong) | `tax-official` |
| Foreign-resident rates | 2025–26 | as 2024–25 | A2; L1 | VERIFIED | `tax-independent` |
| Foreign-resident rates | 2026–27 | as 2024–25 | L1 Sch 7 Pt II: “second resident personal tax rate” (item 2 = 30% in 2026-27), “third” (37%), 45% — enacted. A2 does not yet list 2026–27. | VERIFIED (legislation) | `tax-official` |
| Working holiday maker rates | 2022–23 | 15% to $45,000 / 32.5% to $120,000 / 37% to $180,000 / 45% | L2 Sch 7 Pt III. A3 printed pages do not reach 2022–23. | VERIFIED (legislation) — **gap filled** (was not estimated) | `tax-official` |
| Working holiday maker rates | 2023–24 | as above | A3 “2023–24” ($6,750 + 32.5c; $31,125 + 37c; top row cut off in print); L2 for the 45% row | VERIFIED — **gap filled** | `tax-official`, engine scenario ($8,375 on $50,000) |
| Working holiday maker rates | 2024–25, 2025–26 | 15% / 30% / 37% / 45% at $45k / $135k / $190k | A3; L1 Sch 7 Pt III “2024-25 or later” | VERIFIED | `tax-independent` |
| Working holiday maker rates | 2026–27 | as above | L1 Sch 7 Pt III “2024-25 year of income or a later year” (enacted); A3 not yet listing 2026–27 | VERIFIED (legislation) — **gap filled** | `tax-official` |
| WHM — other income | all | All taxable income taxed at WHM rates (assumption) | L1 Sch 7 Pt I/II cl 4: WHM income is the first part of taxable income; other income is taxed at resident/foreign rates above it | PARTIALLY VERIFIED — simplification kept and **flagged** (WHM warning) | — |
| Part-year tax-free threshold | 2022–23 to 2026–27 | $13,464 + $4,736 × months ÷ 12; part months count as whole months | L1/L2 s 20(1): (TFT − $4,736) + $4,736 × months/12; s 16 definition: a part-year residency period runs from the start of the arrival month / to the end of the departure month | VERIFIED — **2026–27 gap filled** | ATO-style examples (3 mo $14,648; 6 mo $15,832), 2025–26 and 2026–27 engine scenarios |
| Part-year — eligible pensioners | all | not handled | L1 s 16 (part-year residency period, subs (2)(a)): not a part-year period for an eligible pensioner | UNVERIFIED scenario — not supported (documented) | — |

### 3.2 Offsets

| Rule | Year | Implemented | Official evidence | Status | Tests |
| --- | --- | --- | --- | --- | --- |
| LITO | 2022–23 to 2026–27 | $700; less 5% over $37,500; $325 less 1.5% over $45,000; nil above $66,667; non-refundable | L5 s 61-115(1) table; s 61-110(1) “2020-21 income year or a later income year”, resident at any time in the year, TI ≤ $66,667 | VERIFIED (2026–27 previously “assumed unchanged”) | `tax` (30k/40k/50k/70k) |
| LITO — part-year residents | all | full offset | L5 s 61-110(1)(a) “Australian resident at any time during the income year”; no pro-rating in s 61-115 | VERIFIED — warning text corrected (previously “confirm”) | part-year engine scenario |
| LITO — under 18 | all | not applied | L5 s 61-115(2) cap for prescribed persons (Div 6AA) | UNVERIFIED scenario — not supported | — |
| FITO up to $1,000 | all | foreign tax paid up to $1,000 claimed without a limit | A11 “FITO up to $1000” | VERIFIED | `tax` |
| FITO limit above $1,000 | all | step 1 (tax + Medicare levy + MLS, offsets ignored) − step 2 (same, foreign income disregarded); limit used only if > $1,000 | A11 steps 1–3; Example 17 reproduced exactly ($18,067 − $11,167 = $6,900) | PARTIALLY VERIFIED — related deductions (step 2(b)) are assumed nil and foreign capital gains are not identified (flagged) | `tax-official` Examples 16–17; engine scenario |
| Franking credit offset | all | refundable; gross-up included in assessable income | A14 “refund any franking credits … after your tax and Medicare levy liabilities are met” | VERIFIED | `tax` |
| SAPTO | all | not applied (thresholds recorded for information) | A4, A5–A8 | UNVERIFIED scenario — not supported | — |

### 3.3 Medicare levy, family reduction and surcharge

| Rule | Year | Implemented | Official evidence | Status | Tests |
| --- | --- | --- | --- | --- | --- |
| Levy rate | all | 2% | L3/L4 s 6(1) | VERIFIED | — |
| Single low-income reduction | 2022–23 | $24,276 / $30,345; ≤ 10% of excess | A5 Table 1; L4 comp 49 s 3 & s 7 | VERIFIED | `tax-official` reference |
| … | 2023–24 | $26,000 / $32,500 | A6 Table 1; L4 comp 50 | VERIFIED | same |
| … | 2024–25 | $27,222 / $34,027 | A7 Table 1; L4 comp 52 | VERIFIED | same |
| … | 2025–26 | $28,011 / $35,013 | A4, A8 Table 1; L3 comp 53 | VERIFIED | same + exact boundaries |
| … | 2026–27 | **not applied** | Not published in any source read. L3 (1 Jul 2026) still contains the 2025–26 amounts, which are normally amended later. | UNVERIFIED — reduction not applied, warning shown | `tax` |
| Family test & reduction | 2022–23 | family income threshold $40,939 + $3,760/child; s 8(2) reduction | L4 comp 49 s 8; A5 worksheet 2 limit $51,173 + $4,700 (= 1.25 ×) | VERIFIED — **implemented** (was flagged) | `tax-official` reference from the Act |
| … | 2023–24 | $43,846 + $4,027 | L4 comp 50; A6 limit $54,807 + $5,034 | VERIFIED — implemented | same |
| … | 2024–25 | $45,907 + $4,216 | L4 comp 52; A7 limit $57,383 + $5,270 | VERIFIED — implemented | same |
| … | 2025–26 | $47,238 + $4,338 | L3 comp 53 s 8(5); A4/A8 | VERIFIED — implemented | same + hand calculations ($76.20; $57.00) |
| … | 2026–27 | not applied | not published | UNVERIFIED | — |
| Family reduction formula | 2022–23 to 2025–26 | levy (after s 7) − [2% × FIT − 0.08 × (FI − FIT)], reduced by spouse TI / FI when the spouse’s TI exceeds the threshold amount | L3 s 8(1)–(3), s 8(5) definitions | VERIFIED — **previously “not sourced”, now implemented** | `tax-official` (756 combinations vs an independent implementation) |
| Family income — negative spouse income | all | counted as $0 | A7 worksheet 1 row b (“If the amount is less than $0, write $0”) | **MISMATCH FOUND → FIXED** (a negative spouse income previously reduced family income) | `tax-independent` |
| Sole parent — counting children | all | user-entered count; UI hint added | L3 s 8(6): only children for whom FTB was payable | PARTIALLY VERIFIED (input guidance only) | — |
| Medicare exemptions (full/half) | all | user-selected | A7 Part B | PARTIALLY VERIFIED — category eligibility, days and family agreements are the user’s; half exemption + family reduction flagged | — |
| Part-year Medicare exemption for foreign-resident days | all | not calculated (full-year levy shown, flagged) | A7 Part B category 2 | UNVERIFIED scenario — not supported | — |
| Super lump sums excluded from Medicare/MLS income | 2022–23, 2023–24 | not modelled | A5, A6, A9 | UNVERIFIED scenario — documented | — |
| MLS thresholds & rates | 2022–23 to 2026–27 | single / family tiers (table in rules), 1% / 1.25% / 1.5%; family + $1,500 per child after the first | A9 tables for each year (2022–23: $90k / $105k / $140k; … 2026–27: $105k / $123k / $164k) | VERIFIED (2022–23 middle tier previously “unknown”; confirmed) | `tax-official` (tiers ±1, each year) |
| Income for MLS purposes | all | TI + RFB + total net investment losses + reportable super + exempt foreign employment income (user inputs) | A9 items 1–4 | VERIFIED (the FHSS exclusion, family-trust-distribution-tax and spouse s 98 items are the user’s inputs) | — |
| MLS base | all | rate × (taxable income + RFB) × days without cover ÷ days in year | A9 example (Tom 2026–27: ($90,000 + $27,000) × 1% = $1,170); L3 s 8B/8D days formula | VERIFIED | `tax-official` Tom example |
| Married person with low own income | 2022–23 to 2025–26 | no MLS if own income for MLS ≤ threshold amount ($24,276 / $26,000 / $27,222 / $28,011) | L3/L4 s 8D(3)(c) (amount in each compilation) | VERIFIED — **implemented** (previously “not calculated”) | `tax-independent`, `tax-official` |
| … | 2026–27 | not calculated when the married path would apply | amount not yet published | UNVERIFIED (flagged) | `tax-official` |

### 3.4 Study and training loans

| Year | Implemented | Official evidence | Status | Tests |
| --- | --- | --- | --- | --- |
| 2022–23 | % of total repayment income: 18 bands from $48,361 (1%) to $141,848 (10%) | A10 Table 5 | VERIFIED — **gap filled** | `tax-official` (every band edge ±1) |
| 2023–24 | 18 bands from $51,550 to $151,201 | A10 Table 4 | VERIFIED — **gap filled** | same |
| 2024–25 | 18 bands from $54,435 to $159,664 | A10 Table 3; Example 4 | VERIFIED — **gap filled**. ATO Example 4 states $99,736 × 5.5% = $5,485.52; the product is $5,485.48 — ATO arithmetic slip; the app applies the published band and rate. | same + example |
| 2025–26 | marginal: nil ≤ $67,000; 15c over $67,000; $8,700 + 17c over $125,000; 10% of total from $179,286 | A10 Table 2 | VERIFIED | `tax-independent`, `tax-official` |
| 2026–27 | nil ≤ $69,528; 15c over $69,528; $9,028 + 17c over $129,717; 10% of total from $186,051 | A10 Table 1; Examples 1–3 ($2,527.80; $10,276.99; $25,478) | VERIFIED — **conflict resolved** ($67,000 was the 2025–26 figure). Notes: the ATO’s $9,028 base is 15% × $60,189 = $9,028.35 rounded — the published table is used as shown; Example 1 lists TI $60,470 but adds $60,720 (typo; the total $86,380 matches $60,470); Example 3 text cites $179,286 (a 2025–26 figure) — result unaffected. | `tax-independent` examples, `tax-official` |
| Repayment income | all years | TI + RFB + total net investment loss + reportable super + exempt foreign employment income | A10 “Repayment income” (excludes FHSS released amounts) | VERIFIED | engine scenario |
| Cap at loan balance | all | repayment ≤ entered balance | not stated on A10 | PARTIALLY VERIFIED (logical cap; no source read for the rule) | engine scenario |
| Foreign / part-year residents | all | not calculated (flagged) | — | UNVERIFIED scenario | — |

### 3.5 Capital gains, losses and investment income

| Rule | Implemented | Official evidence | Status | Tests |
| --- | --- | --- | --- | --- |
| Net capital gain order | gains − current-year losses − prior net capital losses, then discount; losses carried forward indefinitely | A12 A1 (“subtract your total capital losses … and any unapplied net capital losses … subtract any CGT discount”); “no time limit … apply in the order you made them” | VERIFIED (2024–25 guide; same statutory method assumed for the other years — guides for other years not read) | `tax` netting tests; `tax-official` Fred example |
| Loss application order | non-discount (“other”) gains first by default, configurable | A12 Step 8 (“greatest benefit … 1. ‘other’ method gains, 2. indexation, 3. discount”) | VERIFIED | `tax` |
| CGT discount 50% | individuals, held ≥ 12 months, resident | L5 s 115-100(aa) (events before 1 July 2027), s 115-25(1) | VERIFIED for 2022–23 to 2026–27 | `tax` |
| 12-month day count | acquisition and disposal days excluded | L5 s 115-25(1) says “at least 12 months before”; the day-exclusion convention is the ATO’s guidance and **was not in the documents read** | PARTIALLY VERIFIED | `lib` (anniversary-day tests) |
| Discount for years from 2027–28 | none applied; blocking issue | L5 s 115-100(f): 0% for individuals except new residential dwellings (s 115-102) for events on/after 1 July 2027 | **MISMATCH FOUND → FIXED** — a year with no rule set silently fell back to 50% | `tax-official` |
| Foreign/temporary residents | no discount for foreign residents (flagged); part-year: full discount, now flagged | L5 s 115-105, 115-115 (apportionment for periods after 8 May 2012) | PARTIALLY VERIFIED — apportionment not implemented; part-year warning added | — |
| Pre-CGT assets | gain/loss disregarded for assets acquired before 20 Sep 1985 | L5 s 104-10(5)(a); A12 A4 | VERIFIED for events before 1 July 2027 | `tax-independent` (19/20 Sep 1985) |
| Pre-CGT from 1 July 2027 | not disregarded; blocking CGT_2027_REFORM issue | L5 Subdiv 112-E (s 112-175 deemed sale/reacquisition on 1 July 2027); s 100-25 note | **MISMATCH FOUND → FIXED** (previously disregarded regardless of date) | `tax-official` |
| Indexation option | flagged, not calculated | L5 s 110-36(1): most recent acquisition at or before 11:45 am (ACT legal time) on 21 Sep 1999, and for individuals a CGT event before 1 July 2027; A12 Table 1 | **MISMATCH FOUND → FIXED** in the flag: acquisitions *on* 21 Sep 1999 were not flagged | `tax-official` |
| Managed fund (AMMA) gains | discounted gain × 2; losses applied (other first); 50% re-applied; indexation/other not discounted; CGT concession amount does not reduce cost base | A12 Part C Steps 1–5, Examples 21–25 (Tim: $350); C2 | VERIFIED | `tax-official` Tim example; `tax-independent` |
| Tax-deferred amounts | reduce cost base; excess over cost base is a capital gain | A12 C2 | PARTIALLY VERIFIED — cost-base reduction implemented; excess-gain on tax-deferred amounts relies on the general return-of-capital handling (review) | `trading` |
| Collectables / personal use assets | not distinguished; crypto/NFT disposals ≤ $10,000 noted only | L5 s 118-10(1) ($500 collectables), s 118-10(3) ($10,000 first element of cost base) | PARTIALLY VERIFIED — note only; collectable-loss quarantining not implemented | `tax-independent` |
| Wash sales | 30-day review flag | **no source read** (TR 2008/1 not supplied) | UNVERIFIED — flag kept | `tax-independent` |
| Franking — small shareholder exemption | holding period rule applies when total credits are **$5,000 or more** | A14: “applies if your total franking credit entitlement … is $5,000 or more”; “less than $5,000 … only need to meet the related payments rule” | **MISMATCH FOUND → FIXED** (exactly $5,000 was treated as exempt) | `tax-independent` regression (4,999.99 / 5,000 / 6,000) |
| Franking — 45-day rule | heuristic check on recorded trades; days of acquisition and disposal not counted | A14 (“Don't count the day of acquisition or disposal”; 90 days for preference shares; once per purchase; whole parcel fails — no partial claim); A15 (primary qualification period ends 45th day after ex-dividend) | PARTIALLY VERIFIED — heuristic, preference shares, LIFO and related-payments not tested (flagged) | `tax-independent` |
| Dividends — TFN withholding | credited; unfranked amount entered gross | A14 (“add the tax withheld to the unfranked dividend amount”) | PARTIALLY VERIFIED — relies on entering the gross unfranked amount | — |
| Crypto (CGT asset, staking income, swaps) | as documented in TAX_METHODOLOGY §7.7 | **no ATO crypto page supplied** | UNVERIFIED in this audit | `trading` |
| Futures / CFD / forex trading results | revenue or capital per account treatment | **no source supplied** | UNVERIFIED in this audit | `trading` |

### 3.6 Foreign currency

| Rule | Implemented | Official evidence | Status |
| --- | --- | --- | --- |
| Translation of foreign amounts | each amount at the rate for its own date (proceeds at disposal, cost at acquisition) | A13 examples apply ITAA 1997 s 960-50(6) items 5 and 11 (amounts translated at the time of the event / tax recognition time); A11 “convert all foreign income, deductions and foreign tax paid to Australian dollars” | PARTIALLY VERIFIED (the rate *source* — e.g. RBA — is the user’s choice) |
| 12-month rule | currency movements between trade and settlement are not separately taxed (folded into CGT) | A13 “Election out of the 12-month rule”: gains on settlement within 12 months are folded into the CGT treatment unless the election is made | VERIFIED as the default; the election out is not supported |
| Forex gains on foreign currency balances (Div 775) | not calculated; FOREX_DIV775 warning | A13 | UNVERIFIED calculation — flagged |
| $250,000 limited balance election | recordable; changes the warning to information | A13: qualifying accounts; credit and debit balances added separately, each ≤ A$250,000; translated at the average rate for the third month before the year; buffer up to A$500,000 for at most 2 periods of ≤ 15 days; does **not** cover forex realisation event 1 (deposits); election in writing, kept, not lodged | VERIFIED (description); the balance test itself is not checked |

### 3.7 Losses and business items

| Rule | Implemented | Official evidence | Status |
| --- | --- | --- | --- |
| Prior-year tax losses | deducted automatically up to income after deductions; remainder and any current-year loss carried forward | A16: carried forward indefinitely; must be claimed at the first opportunity; against net exempt income first, then assessable income; in the order incurred | PARTIALLY VERIFIED — net exempt income and Div 35 (non-commercial losses) not applied (flagged) |
| Instant asset write-off | $20,000, cost must be **less than** the limit (whole cost incl. private use), aggregated turnover < $10m | A17 Table 1 (on or after 1 July 2023 — $20,000; no end date as at 28 Aug 2026); “same as or more than … small business pool”; examples | VERIFIED for 2023–24 to 2025–26; 2026–27 PARTIALLY VERIFIED (no year-specific statement) |
| 2022–23 | temporary full expensing note | A17 note to Table 1 | PARTIALLY VERIFIED (TFE not modelled) |
| Car limit, small business pool | not implemented | A17 (2025–26 car limit $69,674; pool 15% / 30%) | UNVERIFIED scenario — documented |
| Low-value pool (18.75% / 37.5%) | as before | no source read | UNVERIFIED |

## 4. Discrepancies found and corrections made

| # | Finding | Evidence | Correction | Regression test |
| --- | --- | --- | --- | --- |
| 1 | Holding period rule applied only above $5,000 — exactly $5,000 was treated as exempt | A14 | `gte(5000)`; messages reworded | `tax-independent` “$5,000 or more …” |
| 2 | Years without a rule set (2027–28 on) fell back to a 50% CGT discount | L5 s 115-100 as amended | `discountRateFor()` returns 50% only for years ending by 30 Jun 2027; otherwise no discount + blocking `CGT_DISCOUNT_UNKNOWN` | `tax-official` |
| 3 | Pre-CGT disregard applied to CGT events on or after 1 July 2027 | L5 Subdiv 112-E, s 100-25 | Disregard only for events before 1 July 2027; blocking `CGT_2027_REFORM` for later events | `tax-official` |
| 4 | Negative spouse taxable income reduced family income | A7 worksheet 1 | Clamped to $0 | `tax-independent` |
| 5 | Indexation flag missed acquisitions on 21 September 1999 | L5; A12 Table 1 | Inclusive date test (time of day not checked — stated) | `tax-official` |
| 6 | 2024–25 foreign-resident rates were marked “conflicting” (search summary) | A2 | Status now verified; warning removed because the figures are confirmed (the calculation was already right) | `tax-official` |
| 7 | Gaps now filled from official tables: HELP 2022–23, 2023–24, 2024–25, 2026–27; WHM 2022–23, 2023–24, 2026–27; foreign 2026–27; part-year 2026–27; Medicare family thresholds and the s 8 reduction for 2022–23 to 2025–26; married-person MLS test (s 8D(3)(c)) | A3, A10, L1–L4 | Implemented; corresponding “not calculated” warnings removed only for these now-implemented, tested cases | `tax-official`, `tax-independent` |
| 8 | One v1.2 test used FITO figures from a search summary | — | Replaced with ATO Example 17 (exact) and Example 16 | `tax-official` |

**ATO publication inconsistencies noted (the app follows the statute / published table):**
* A11 Example 16 step 1 shows $3,079.30 for TI $31,130 in 2023–24, which adds a flat 2% levy ($622.60). Under the
  Medicare Levy Act s 7(2) and the 2023–24 thresholds the levy is limited to $513.00, giving $2,969.70.
* A10 Example 4 (2024–25): $99,736 × 5.5% is $5,485.48, not $5,485.52.
* A10 Example 1 (2026–27) lists TI $60,470 but adds $60,720 (the total matches $60,470); Example 3 cites $179,286.
* A12 Example 8 reduces Fred’s $900 gain by a $75 prior-year loss to $825, but Example 9 then discounts “$800” to
  $400. Following the guide’s own method the result is $825 × 50% = $412.50 (the app’s result; tested).

## 5. Tests that cover the audited rules

| File | What it checks |
| --- | --- |
| `tests/unit/tax-official.test.ts` (new) | Independent references typed from the official sources (not the app): WHM and foreign scales (all supported years), HELP percentage and marginal tables at every band edge ±1, Medicare levy single + family from the Act (each year 2022–23 to 2025–26, 189 combinations per year), MLS tiers each year (single, married, sole parent), FITO ATO Examples 16–17, ATO CGT guide Tim example, post-1 July 2027 guards, indexation boundary, s 8D(3)(c), part-year 2026–27. |
| `tests/unit/tax-independent.test.ts` | Resident scales vs an integer-cents reference; part-year examples; Medicare boundaries and s 8 hand calculations; MLS (incl. the ATO Tom example); HELP ATO examples (all three 2026–27 examples and 2024–25 Branson); engine scenarios; franking regression. |
| `tests/unit/tax.test.ts` | Original ATO-table fixtures, LITO, CGT netting, full scenarios. |

## 6. Remaining gaps, assumptions and professional-review requirements

* **Not reviewed by a registered tax agent**; not compared with ATO lodgment software or the ATO calculators.
* **2026–27 Medicare levy low-income and family thresholds** are not yet published in any source read → the
  reduction is not applied (warning). The married-person MLS own-income test is likewise not applied for 2026–27.
* **Printed copies were partial** for some ATO pages (A1 pp 1–3 of 19; A2 pp 1–2 of 14; A3 pp 1–2 of 5; A8 pp 1–3
  of 12; A13 pp 1–11 of 20; A16 pp 1–4 of 6). Where a figure lay beyond the printed pages, the legislation was used.
* **Not supported (flagged, needs professional advice):** SAPTO; private health insurance rebate; Medicare
  exemption days for part-year residents; the under-18 LITO cap; ETPs and super lump sums; Div 35 non-commercial
  losses and net exempt income; trading stock; temporary full expensing, the small business pool and car limit;
  CGT discount apportionment for foreign or temporary residency; indexation; collectables; Div 775 forex
  calculations and the limited balance test; the WHM split between WHM and other income; HELP for foreign or
  part-year residents; franking holding-period details (LIFO, preference shares, related payments, risk
  positions); DeFi; any CGT event on or after 1 July 2027.
* **No source was read in this audit for:** crypto-specific treatment, derivative/forex trading treatment, wash
  sales (TR 2008/1), the low-value pool rates, the 12-month day-count convention. These remain UNVERIFIED.
* The application relies on the user’s classifications (residency, account treatment, cover, spouse income,
  income-test amounts). Wrong inputs give wrong results.
