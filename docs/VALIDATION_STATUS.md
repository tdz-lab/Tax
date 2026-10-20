# Validation status (v1.2.0, 20 October 2026)

This page states plainly what has and has not been validated. **Passing tests does not make the application
tax-ready.** It is a record-keeping and preparation tool whose estimates must be reviewed by a registered tax agent.

## 1. Levels of evidence used

| Level | Meaning | Strength |
| --- | --- | --- |
| **ATO page (search summary)** | The figure matched an ato.gov.au page as returned by a web-search summary on 20 Oct 2026. The page itself could not be opened: ato.gov.au was blocked by the build environment’s network policy. | Moderate — summaries can misread tables (two mislabelled ATO tables were found and are noted below). |
| **Legislation reference** | Fixed by statute (section cited); not re-checked against the ATO site. | Moderate |
| **ATO worked example** | The code reproduces a worked example published by the ATO (as quoted in the search summary). | Moderate–strong for the formula |
| **Independent reference test** | A second implementation written separately from the engine (integer cents, ATO “$base + c over $threshold” form) agrees with the engine at boundary incomes. | Proves the code matches the tables as typed — not that the tables are right |
| **Hand calculation** | Expected values worked out by hand in test comments. | Proves internal consistency only |
| **Not confirmed / conflicting** | Not found, or ATO sources disagreed. | None — the app flags instead of calculating, or warns when the figure must be used |

**Nothing has been reviewed by a registered tax agent or checked against ATO lodgment software.**

## 2. Parameters by year

✔ = ATO page (search summary) · ⚠ = conflicting · ✖ = not confirmed (not used, or used with a warning) · — = not applicable

| Parameter | 2022–23 | 2023–24 | 2024–25 | 2025–26 | 2026–27 |
| --- | --- | --- | --- | --- | --- |
| Resident rates | ✔ | ✔ | ✔ | ✔ | ✔ (15% from 1 Jul 2026) |
| Foreign-resident rates | ✖ (used, warned) | ✖ (used, warned) | ⚠ (Stage 3 used, warned) | ✔ | ✖ (used, warned) |
| Working holiday maker rates | ✖ (no estimate) | ✖ (no estimate) | ✔ (Schedule 15) | ✔ | ✖ (no estimate) |
| Part-year tax-free threshold | ✔ | ✔ | ✔ | ✔ | ✖ (no estimate) |
| LITO | ✔ | ✔ | ✔ | ✔ | ✖ (assumed unchanged, warned) |
| Medicare single low-income thresholds | ✔ | ✔ | ✔ | ✔ | ✖ (reduction not applied, warned) |
| Medicare family thresholds | ✖ | upper only ✔ | upper only ✔ | ✔ (lower and upper) | ✖ |
| Medicare family reduction amount (between thresholds) | ✖ | ✖ | ✖ | ✖ | ✖ |
| MLS thresholds and rates | ✔ | ✔ | ✔ | ✔ | ✔ |
| HELP / study-loan repayment | ✖ | ✖ | ✖ | ✔ (marginal system) | ⚠ ($67,000 vs $69,528) |
| FITO $1,000 default and limit method | ✔ | ✔ | ✔ | ✔ | ✔ |
| Instant asset write-off $20,000 | — (temporary full expensing) | ✔ | ✔ | ✔ | ✖ |
| CGT discount 50% | legislation | legislation | legislation | legislation | legislation |

Notes on conflicts found:

* **Foreign-resident 2024–25:** an ATO page summary listed 32.5% to $120,000 under 2024–25, while the ATO WHM Schedule
  15 for 1 July 2024 – 30 June 2026 uses the Stage 3 brackets (30% to $135,000, 37% to $190,000, 45%). The Stage 3
  figures are used and every estimate for a foreign resident in 2024–25 carries a PARAM_UNCONFIRMED warning.
* **WHM 2024–25:** the main WHM page summary showed an older-looking table under 2024–25; Schedule 15 was relied on.
* **MLS 2022–23:** one ATO print view showed 2023–24 figures under the 2022–23 heading; two other ATO pages agreed on
  $90,000 / $105,000 / $140,000.
* **HELP 2026–27:** two different minimum thresholds were returned; HELP is not calculated for 2026–27.

## 3. Calculations

| Calculation | Status | How it was checked |
| --- | --- | --- |
| Tax on taxable income (resident, foreign, WHM scales) | Implemented | Independent integer-cents reference at 25 incomes per scale, including every threshold ±1 |
| Part-year resident threshold | Implemented (months entered by user) | ATO worked examples (3 months $14,648; 6 months $15,832) + hand calculation |
| LITO | Implemented | Hand calculations (existing tests) |
| Medicare levy, single shade-in | Implemented | Hand calculations at exact boundaries |
| Medicare levy, family | **Partial** — nil-levy test and “above limit” only | Hand calculations; reduction in between flagged |
| Medicare levy surcharge | Implemented (resident, full or part year without cover) | Hand calculations at tier boundaries, family, days pro-rating |
| HELP / study loans | 2025–26 only | Hand calculations at every band boundary; continuity at $179,285 |
| Foreign income tax offset limit | Implemented with stated simplifications | ATO 2025 guide worked example ($2,581.80 − $260.80 = $2,321.00) + engine scenario |
| Prior-year and current-year tax losses | Implemented (simplified) | Hand calculations |
| CGT netting, discount, carry-forward | Implemented (v1.0) | Hand calculations / ATO method statement order |
| Trust AMMA capital-gain components | Implemented | Hand calculation (gross-up, losses, re-discount) |
| Pre-CGT exemption | Implemented (date test) | Boundary test (19 vs 20 Sep 1985) |
| Indexation | **Not calculated** — flagged | — |
| Franking 45-day rule | **Partial** — $5,000 exemption + recorded-trade heuristic; credits never removed | Scenario tests |
| Wash sales | Review flag only | Scenario test |
| Forex gains on foreign currency (Div 775) | **Not calculated** — flagged; limited balance election recordable | Scenario test |
| Crypto personal-use asset | **Not applied** — noted | Scenario test |
| DeFi, lending, liquidity pools | **Not inferred** — must be classified | — |
| SAPTO, ETPs, small business offset, Div 35, net exempt income, trading stock | **Not calculated** — flagged | — |

## 4. How to raise the level of validation

1. Allow `www.ato.gov.au` in the environment’s network settings (or check the pages yourself) and compare each
   parameter in *Tax Calculations → How each figure was checked* with the live ATO page.
2. Run your own figures through the ATO’s online calculators and compare with the app’s estimate.
3. Have a registered tax agent review the full PDF report before lodging anything.
