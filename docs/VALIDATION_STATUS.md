# Validation status (v1.3.0, 20 October 2026)

This page summarises what has and has not been validated. The detailed, rule-by-rule evidence is in
[TAX_RULE_VERIFICATION.md](TAX_RULE_VERIFICATION.md); the two documents are kept in agreement.

**Passing tests does not make the application tax-ready.** It is a record-keeping and preparation tool whose
estimates must be reviewed by a registered tax agent. Nothing has been reviewed by a tax agent or compared with
ATO lodgment software.

## 1. Evidence used in the v1.3 audit

| Evidence | Used for |
| --- | --- |
| **ATO web pages**, printed to PDF by the user (20 Oct 2026) — ato.gov.au itself refuses connections from the build server | Rates (resident, foreign, WHM), Medicare (single, family, M1 2023–2026), MLS, study loans, FITO, CGT guide 2025, forex elections, franking, tax losses, instant asset write-off |
| **Federal Register of Legislation** compilations, read in full text | Income Tax Rates Act 1986 (comp. 61 and 66), Medicare Levy Act 1986 (comp. 49–53), Income Tax Assessment Act 1997 (comp. 267) |
| **Independent reference implementations** in the tests (tables typed from the sources, not imported from the app) | Every scale, HELP table, Medicare (single and family) and MLS tier, at each threshold ±1 |
| **ATO worked examples** reproduced | MLS (Tom); HELP (Christina, Barry, Priya; Branson — ATO arithmetic slip noted); FITO (Example 17 exact; Example 16 step 2, step 1 inconsistent with the Act); CGT (Tim; Fred — ATO inconsistency noted) |
| Web-search summaries (used in v1.2) | **No longer relied on.** All such figures were re-checked; one conflicting summary (2024–25 foreign-resident rates) proved wrong. |

## 2. Parameters by year

✔ VERIFIED from an official source · ◐ PARTIALLY VERIFIED · ✖ UNVERIFIED (not used, or used with a warning) · — not applicable

| Parameter | 2022–23 | 2023–24 | 2024–25 | 2025–26 | 2026–27 |
| --- | --- | --- | --- | --- | --- |
| Resident rates | ✔ | ✔ | ✔ | ✔ | ✔ (15%, enacted) |
| Foreign-resident rates | ✔ | ✔ | ✔ (conflict resolved) | ✔ | ✔ (enacted law) |
| Working holiday maker rates | ✔ (law) | ✔ | ✔ | ✔ | ✔ (enacted law) |
| Part-year tax-free threshold | ✔ | ✔ | ✔ | ✔ | ✔ |
| LITO | ✔ | ✔ | ✔ | ✔ | ✔ |
| Medicare levy 2% | ✔ | ✔ | ✔ | ✔ | ✔ |
| Medicare single low-income thresholds | ✔ | ✔ | ✔ | ✔ | ✖ not yet published |
| Medicare family threshold and s 8 reduction | ✔ | ✔ | ✔ | ✔ | ✖ not yet published |
| MLS thresholds, rates and base | ✔ | ✔ | ✔ | ✔ | ✔ |
| MLS married own-income test (s 8D(3)(c)) | ✔ | ✔ | ✔ | ✔ | ✖ |
| Study-loan repayment | ✔ (% table) | ✔ (% table) | ✔ (% table) | ✔ (marginal) | ✔ (marginal) |
| FITO $1,000 and limit method | ◐ | ◐ | ◐ | ◐ | ◐ (related deductions assumed nil) |
| CGT discount 50% / netting order | ✔ | ✔ | ✔ | ✔ | ✔ |
| Instant asset write-off $20,000 | ◐ (TFE year) | ✔ | ✔ | ✔ | ◐ |
| Low-value pool rates | ✖ | ✖ | ✖ | ✖ | ✖ |

From **1 July 2027** the enacted ITAA 1997 changes (0% CGT discount for individuals except new dwellings;
deemed sale and reacquisition of assets on 1 July 2027) are **not supported**: the app applies no discount and
blocks the result for any later year or CGT event.

## 3. Calculations

| Calculation | Status | How it was checked |
| --- | --- | --- |
| Tax on taxable income (resident, foreign, WHM) | Implemented, ✔ | Independent integer-cents references for every supported year |
| Part-year residents | Implemented, ✔ (Medicare for foreign-resident days and CGT discount apportionment flagged) | ITRA s 16/s 20 formula; engine scenarios |
| WHM | Implemented, ◐ (all income treated as WHM income — flagged) | ITRA Sch 7 Pt III; ATO tables |
| LITO | Implemented, ✔ | ITAA 1997 s 61-110/61-115 |
| Medicare levy, single | Implemented, ✔ | Medicare Levy Act s 7 reference, every year |
| Medicare levy, family reduction | **Implemented in v1.3**, ✔ (half exemption + family flagged) | Medicare Levy Act s 8 reference (756 combinations) + hand calculations |
| Medicare levy surcharge | Implemented, ✔ (days without cover entered by the user) | ATO tables each year; ATO example; s 8D(3)(c) |
| Study-loan repayment | **All five years in v1.3**, ✔ | ATO tables at every band edge; four ATO examples |
| FITO limit | Implemented, ◐ | ATO Examples 16–17 (Example 16 step 1 is inconsistent with the Act — documented) |
| Tax losses carried forward | Implemented, ◐ (net exempt income, Div 35 not applied) | ATO page A16; hand calculations |
| CGT netting, discount, carry-forward | Implemented, ✔ | ATO CGT guide 2025; ITAA 1997 s 115-25/115-100 |
| Managed fund AMMA components | Implemented, ✔ | ATO CGT guide Part C (Tim example) |
| Pre-CGT | Implemented, ✔ (events before 1 Jul 2027) | ITAA 1997 s 104-10(5) |
| Indexation | Flagged only | ITAA 1997 s 110-36 |
| Franking holding period | ◐ ($5,000 boundary **fixed**; heuristic trade check) | ATO franking pages |
| Wash sales | Flag only, ✖ (no source read) | — |
| Div 775 forex on cash balances | Flag only; limited balance election description ✔ | ATO forex elections page |
| Crypto, derivatives, DeFi treatment | ✖ in this audit (no source supplied) | — |
| SAPTO, ETPs, Div 35, trading stock, TFE, small business pool, car limit | Not calculated — flagged | — |

## 4. Mismatches found and fixed in v1.3

1. Franking holding period rule now applies at **$5,000 or more** (exactly $5,000 was treated as exempt).
2. No 50% CGT discount fallback for years after 2026–27 (enacted 0% for individuals from 1 July 2027).
3. Pre-CGT disregard limited to CGT events before 1 July 2027.
4. A negative spouse taxable income counts as $0 in the Medicare family test.
5. Indexation flag now includes acquisitions on 21 September 1999.

Full details, evidence and regression tests: [TAX_RULE_VERIFICATION.md §4](TAX_RULE_VERIFICATION.md#4-discrepancies-found-and-corrections-made).

## 5. How to raise the level of validation further

1. Supply the remaining pages of the partially printed ATO pages (see TAX_RULE_VERIFICATION §6) and the ATO pages
   on crypto, wash sales and trading as a business, so those treatments can be audited.
2. When the ATO publishes 2026–27 Medicare thresholds, add a new rule-set version (Settings → Tax rule sets).
3. Compare your own figures with the ATO’s online calculators.
4. Have a registered tax agent review the full PDF report before lodging anything.
