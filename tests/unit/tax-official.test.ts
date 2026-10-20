/**
 * Official-source audit tests (v1.3, 20 October 2026).
 *
 * Every table below is typed again here from the official source named in its comment — ATO pages
 * (printed copies supplied by the user) or Federal Register of Legislation compilations — and NOT
 * imported from the application. Separate reference implementations (integer cents where practical)
 * are compared with the engine at each threshold and either side of it, so a wrong constant in the app
 * cannot be hidden by a test that reuses it. Worked examples are quoted from the ATO; where an ATO
 * example is internally inconsistent this is stated and the statutory rule is followed.
 *
 * See docs/TAX_RULE_VERIFICATION.md for the source list. These tests do not replace review by a
 * registered tax agent.
 */
import { describe, expect, it } from 'vitest';
import { D } from '../../src/lib/decimal';
import { computeTaxYear, discountRateFor, netCapitalGain, taxOnBrackets } from '../../src/engines/tax/taxEngine';
import { ruleSetFor } from '../../src/engines/tax/rules';
import { fitoClaim, fitoLimit, helpRepayment, medicareLevy, mlsAmount } from '../../src/engines/tax/individual';
import { builtinCategories } from '../../src/domain/reference';
import type { TaxProfile, Transaction } from '../../src/domain/types';
import { account, instrument, profile, txn } from './helpers';

const cents = (d: { toFixed: (n: number) => string }) => Math.round(Number(d.toFixed(2)) * 100);
/** Exact value in cents (no rounding) — for comparing with references that produce fractional cents. */
const exactCents = (d: { times: (n: number) => { toString: () => string } }) => Number(d.times(100).toString());

// ---------------------------------------------------------------------------------------------
// 1. Working holiday makers and foreign residents (years not covered in v1.2)
// ---------------------------------------------------------------------------------------------
type Row = [above: number, baseDollars: number, centsPerDollar: number];
function refTaxCents(income: number, table: Row[]): number {
  let row: Row | undefined;
  for (const r of table) if (income > r[0]) row = r;
  return row ? row[1] * 100 + Math.round((income - row[0]) * row[2]) : 0;
}
// ATO "Tax rates – working holiday maker" 2023–24 rows + ITRA comp. 61 Sch 7 Pt III (45% over $180,000;
// base 31,125 + 37% × 60,000 = 53,325).
const WHM_PRE_STAGE3: Row[] = [[0, 0, 15], [45000, 6750, 32.5], [120000, 31125, 37], [180000, 53325, 45]];
// ATO "Tax rates – foreign resident" 2022–23 and 2023–24.
const FOREIGN_PRE_STAGE3: Row[] = [[0, 0, 32.5], [120000, 39000, 37], [180000, 61200, 45]];
// ATO "Tax rates – foreign resident" 2024–25 and 2025–26; ITRA comp. 66 Sch 7 Pt II for 2026–27.
const FOREIGN_STAGE3: Row[] = [[0, 0, 30], [135000, 40500, 37], [190000, 60850, 45]];
const WHM_STAGE3: Row[] = [[0, 0, 15], [45000, 6750, 30], [135000, 33750, 37], [190000, 54100, 45]];
const INCOMES = [0, 1, 44999, 45000, 45001, 119999, 120000, 120001, 134999, 135000, 135001, 179999, 180000, 180001, 189999, 190000, 190001, 500000];

describe('scales added or confirmed in the audit', () => {
  const cases: [string, number, 'nonResidentBrackets' | 'whmBrackets', Row[]][] = [
    ['WHM 2022–23', 2023, 'whmBrackets', WHM_PRE_STAGE3],
    ['WHM 2023–24', 2024, 'whmBrackets', WHM_PRE_STAGE3],
    ['WHM 2026–27 (enacted, ITRA comp. 66)', 2027, 'whmBrackets', WHM_STAGE3],
    ['foreign 2022–23', 2023, 'nonResidentBrackets', FOREIGN_PRE_STAGE3],
    ['foreign 2023–24', 2024, 'nonResidentBrackets', FOREIGN_PRE_STAGE3],
    ['foreign 2024–25 (conflict resolved by ATO page)', 2025, 'nonResidentBrackets', FOREIGN_STAGE3],
    ['foreign 2026–27 (enacted, ITRA comp. 66)', 2027, 'nonResidentBrackets', FOREIGN_STAGE3]
  ];
  for (const [label, fy, key, table] of cases) {
    it(label, () => {
      for (const inc of INCOMES) expect(cents(taxOnBrackets(D(inc), ruleSetFor(fy)![key]!)), `${label} @ ${inc}`).toBe(refTaxCents(inc, table));
    });
  }
});

// ---------------------------------------------------------------------------------------------
// 2. Study and training loans — ATO "Study and training loan minimum repayment income and rates"
// ---------------------------------------------------------------------------------------------
const HELP_PCT: Record<number, [number, number][]> = {
  // [from, rate in tenths of a percent] — Table 5 (2022–23), Table 4 (2023–24), Table 3 (2024–25).
  2023: [[48361, 10], [55837, 20], [59187, 25], [62739, 30], [66503, 35], [70493, 40], [74723, 45], [79207, 50], [83959, 55], [88997, 60], [94337, 65], [99997, 70], [105997, 75], [112356, 80], [119098, 85], [126244, 90], [133819, 95], [141848, 100]],
  2024: [[51550, 10], [59519, 20], [63090, 25], [66876, 30], [70889, 35], [75141, 40], [79650, 45], [84430, 50], [89495, 55], [94866, 60], [100558, 65], [106591, 70], [112986, 75], [119765, 80], [126951, 85], [134569, 90], [142643, 95], [151201, 100]],
  2025: [[54435, 10], [62851, 20], [66621, 25], [70619, 30], [74856, 35], [79347, 40], [84108, 45], [89155, 50], [94504, 55], [100175, 60], [106186, 65], [112557, 70], [119310, 75], [126468, 80], [134057, 85], [142101, 90], [150627, 95], [159664, 100]]
};
/** Repayment in cents for whole-dollar repayment income (one rate on the total). */
function refHelpPctCents(ri: number, table: [number, number][]): number {
  let r = 0;
  for (const [from, tenths] of table) if (ri >= from) r = tenths;
  return (ri * 100 * r) / 1000; // exact for whole-dollar incomes
}
// Marginal tables: Table 2 (2025–26) and Table 1 (2026–27): [minimum, band2Start, band2BaseDollars, topStart].
const HELP_MARGINAL: Record<number, [number, number, number, number]> = { 2026: [67000, 125000, 8700, 179285], 2027: [69528, 129717, 9028, 186050] };
function refHelpMarginalCents(ri: number, [min, b2, base, top]: [number, number, number, number]): number {
  if (ri <= min) return 0;
  if (ri > top) return ri * 10; // 10% of total, in cents
  if (ri <= b2) return (ri - min) * 15;
  return base * 100 + (ri - b2) * 17;
}

describe('study-loan repayments vs an independent reference', () => {
  for (const fy of [2023, 2024, 2025]) {
    it(`${fy - 1}–${String(fy).slice(2)} percentage table at every band edge`, () => {
      const pts = HELP_PCT[fy].flatMap(([from]) => [from - 1, from, from + 1]).concat([0, 1, 300000]);
      for (const ri of pts) expect(exactCents(helpRepayment(ruleSetFor(fy)!, D(ri))!), `${fy} @ ${ri}`).toBe(refHelpPctCents(ri, HELP_PCT[fy]));
    });
  }
  for (const fy of [2026, 2027]) {
    it(`${fy - 1}–${String(fy).slice(2)} marginal table at every band edge`, () => {
      const [min, b2, , top] = HELP_MARGINAL[fy];
      for (const ri of [0, min - 1, min, min + 1, b2 - 1, b2, b2 + 1, top - 1, top, top + 1, 400000]) {
        expect(cents(helpRepayment(ruleSetFor(fy)!, D(ri))!), `${fy} @ ${ri}`).toBe(refHelpMarginalCents(ri, HELP_MARGINAL[fy]));
      }
    });
  }
});

// ---------------------------------------------------------------------------------------------
// 3. Medicare levy — Medicare Levy Act 1986 ss 7 and 8 (compilations 49, 50, 52, 53)
// ---------------------------------------------------------------------------------------------
// [threshold amount, phase-in limit, family income threshold, per child] by income year.
const MLA: Record<number, [number, number, number, number]> = { 2023: [24276, 30345, 40939, 3760], 2024: [26000, 32500, 43846, 4027], 2025: [27222, 34027, 45907, 4216], 2026: [28011, 35013, 47238, 4338] };
/** Reference levy in cents, written from the Act's text. */
function refLevyCents(fy: number, ti: number, spouseTi: number | null, kids: number): number {
  const [thr, , fitBase, perChild] = MLA[fy];
  // s 7: no levy ≤ threshold; otherwise ≤ 10% of the excess (in cents: × 10).
  const levy = ti <= thr ? 0 : Math.min(ti * 2, (ti - thr) * 10);
  const family = spouseTi !== null || kids > 0;
  if (!family || levy === 0) return levy;
  const fi = ti + Math.max(0, spouseTi ?? 0);
  const fit = fitBase + perChild * kids;
  if (fi <= fit) return 0; // s 8(1)
  let red = fit * 2 - (fi - fit) * 8; // s 8(2), cents
  if (red <= 0) return levy;
  if (spouseTi !== null && spouseTi > thr) red = red - (red * spouseTi) / fi; // s 8(3)
  return Math.max(0, levy - red);
}
describe('Medicare levy vs an independent reference from the Act', () => {
  for (const fy of [2023, 2024, 2025, 2026]) {
    it(`${fy - 1}–${String(fy).slice(2)} single and family combinations`, () => {
      const [thr, phase, fit, per] = MLA[fy];
      const tis = [0, thr, thr + 1, phase - 1, phase, phase + 1, 40000, 60000, 90000];
      const spouses: (number | null)[] = [null, 0, 5000, thr, thr + 1, 30000, 80000];
      for (const ti of tis)
        for (const sp of spouses)
          for (const kids of [0, 1, 3]) {
            if (sp === null && kids === 0) {
              expect(cents(medicareLevy(D(ti), ruleSetFor(fy)!, 'none').levy!), `${fy} single ${ti}`).toBe(Math.round(refLevyCents(fy, ti, null, 0)));
              continue;
            }
            const got = medicareLevy(D(ti), ruleSetFor(fy)!, 'none', { hasFamily: true, spouse: sp !== null, spouseTaxableIncome: sp === null ? null : D(sp), children: kids });
            expect(Math.abs(cents(got.levy!) - refLevyCents(fy, ti, sp, kids)), `${fy} ti ${ti} spouse ${sp} kids ${kids}`).toBeLessThanOrEqual(1);
          }
      // The family limit printed in the ATO M1 worksheet is 1.25 × the threshold (where the reduction is nil).
      expect(Math.floor(fit * 1.25)).toBe(ruleSetFor(fy)!.medicareFamily!.upper);
      expect(Math.round(per * 1.25)).toBe(ruleSetFor(fy)!.medicareFamily!.upperPerChild);
    });
  }
});

// ---------------------------------------------------------------------------------------------
// 4. Medicare levy surcharge — ATO "MLS income thresholds and rates" for each year
// ---------------------------------------------------------------------------------------------
const MLS_TIERS: Record<number, [number[], number[]]> = {
  2023: [[90000, 105000, 140000], [180000, 210000, 280000]],
  2024: [[93000, 108000, 144000], [186000, 216000, 288000]],
  2025: [[97000, 113000, 151000], [194000, 226000, 302000]],
  2026: [[101000, 118000, 158000], [202000, 236000, 316000]],
  2027: [[105000, 123000, 164000], [210000, 246000, 328000]]
};
function refMlsRatePermyriad(income: number, tiers: number[]): number {
  return income > tiers[2] ? 150 : income > tiers[1] ? 125 : income > tiers[0] ? 100 : 0;
}
describe('MLS tiers vs the ATO tables (single and family, each year)', () => {
  const base = { rfb: D(0), reportableSuper: D(0), netInvestmentLoss: D(0), exemptForeignEmployment: D(0), spouseMlsIncome: null, children: 0, daysWithoutCover: 365, daysInYear: 365 };
  for (const fy of [2023, 2024, 2025, 2026, 2027]) {
    it(`${fy - 1}–${String(fy).slice(2)}`, () => {
      const [single, fam] = MLS_TIERS[fy];
      for (const inc of single.flatMap((t) => [t, t + 1])) {
        const exp = (inc * 100 * refMlsRatePermyriad(inc, single)) / 10000;
        expect(exactCents(mlsAmount(ruleSetFor(fy)!, { ...base, ti: D(inc), family: false }).amount!), `${fy} single ${inc}`).toBe(exp);
      }
      for (const comb of fam.flatMap((t) => [t, t + 1])) {
        if (fy === 2027) {
          // 2026–27: the s 8D(3)(c) own-income amount for married people is not yet published, so the
          // married path is not calculated; the family tiers are checked through a sole parent (s 8C).
          const married = mlsAmount(ruleSetFor(fy)!, { ...base, ti: D(100000), family: true, spouse: true, spouseMlsIncome: D(comb - 100000) }).amount;
          if (refMlsRatePermyriad(comb, fam) > 0) expect(married).toBeNull();
          else expect(married!.toFixed(2)).toBe('0.00'); // not above the base tier: no MLS whatever the own-income amount
          const exp = (comb * 100 * refMlsRatePermyriad(comb, fam)) / 10000;
          expect(exactCents(mlsAmount(ruleSetFor(fy)!, { ...base, ti: D(comb), family: true, spouse: false, children: 1 }).amount!), `${fy} sole parent ${comb}`).toBe(exp);
          continue;
        }
        const own = 100000;
        const exp = (own * 100 * refMlsRatePermyriad(comb, fam)) / 10000;
        expect(exactCents(mlsAmount(ruleSetFor(fy)!, { ...base, ti: D(own), family: true, spouse: true, spouseMlsIncome: D(comb - own) }).amount!), `${fy} family ${comb}`).toBe(exp);
      }
    });
  }
});

// ---------------------------------------------------------------------------------------------
// 5. Foreign income tax offset — ATO "Calculate your FITO or offset limit" (2024 guide)
// ---------------------------------------------------------------------------------------------
describe('FITO limit — ATO worked examples (2023–24 rates)', () => {
  const rs = ruleSetFor(2024)!;
  const taxAndLevy = (ti: number) => taxOnBrackets(D(ti), rs.residentBrackets).plus(medicareLevy(D(ti), rs, 'none').levy!);
  it('Example 17 (Karen): tax incl. Medicare on $80,000 = $18,067; on $60,000 = $11,167; limit $6,900; $2,000 paid → $2,000 offset', () => {
    expect(taxAndLevy(80000).toFixed(2)).toBe('18067.00');
    expect(taxAndLevy(60000).toFixed(2)).toBe('11167.00');
    const limit = fitoLimit(taxAndLevy(80000), taxAndLevy(60000), 1000);
    expect(limit.toFixed(2)).toBe('6900.00');
    expect(fitoClaim(D(2000), limit, 1000).toFixed(2)).toBe('2000.00');
  });
  it('Example 16 (Anna): step 2 tax on $19,830 = $309.70 (below the Medicare threshold) — matches', () => {
    expect(taxAndLevy(19830).toFixed(2)).toBe('309.70');
  });
  it('Example 16 step 1: the ATO figure ($3,079.30) adds a flat 2% levy; the Act’s s 7(2) limit gives $2,969.70 — the app follows the Act', () => {
    // 19% × (31,130 − 18,200) = 2,456.70; Medicare: min(2% × 31,130 = 622.60, 10% × (31,130 − 26,000) = 513.00) = 513.00.
    expect(taxAndLevy(31130).toFixed(2)).toBe('2969.70');
    expect(D('2456.70').plus('622.60').toFixed(2)).toBe('3079.30'); // the ATO's arithmetic, reproduced
  });
});

// ---------------------------------------------------------------------------------------------
// 6. Engine scenarios backed by the audit
// ---------------------------------------------------------------------------------------------
const cats = builtinCategories();
function run(fy: number, txns: Transaction[], p: Partial<TaxProfile> = {}) {
  return computeTaxYear({
    data: { transactions: txns, accounts: [account({ id: 'acc' })], instruments: [instrument({ id: 'ins', symbol: 'DEMOA' })], corporateActions: [] },
    fy,
    taxProfiles: [profile(fy, p)],
    assets: [],
    categories: cats,
    taxTz: 'Australia/Sydney',
    costBasisDefaults: {},
    lossOrdering: 'non_discount_first',
    now: '2026-10-20T00:00:00Z'
  });
}
const est = (r: ReturnType<typeof run>, k: string) => r.estimate.find((l) => l.key === k)?.amount ?? null;
const salary = (date: string, amount: string) => txn({ kind: 'income', date, category: 'salary', taxClass: 'SALARY_WAGES', amount });

describe('ATO CGT guide 2025 — Fred (Examples 7–9)', () => {
  it('gain $900 less prior net capital loss $75 = $825, then 50% discount = $412.50 (the guide’s Example 9 shows “$800 × 50% = $400” — inconsistent with its Example 8)', () => {
    const r = netCapitalGain(D(900), D(0), D(0), D(75), D('0.5'), 'non_discount_first');
    expect(r.appliedPrior.toFixed(2)).toBe('75.00');
    expect(r.net.toFixed(2)).toBe('412.50');
    expect(r.carryForward.toFixed(2)).toBe('0.00');
  });
});

describe('engine scenarios', () => {
  it('ATO CGT guide Examples 21–24 (Tim): discounted gain $400 → $800, other $100, loss $200 → net capital gain $350', () => {
    const r = run(2025, [
      txn({ kind: 'income', date: '2024-08-01', category: 'distribution', taxClass: 'TRUST_DISTRIBUTION', amount: '900', cgDiscountedComponent: '400', cgOtherComponent: '100' }),
      txn({ kind: 'trade', side: 'buy', date: '2024-07-02', accountId: 'acc', instrumentId: 'ins', quantity: '10', price: '120' }),
      txn({ kind: 'trade', side: 'sell', date: '2024-09-01', accountId: 'acc', instrumentId: 'ins', quantity: '10', price: '100' })
    ]);
    expect(D(r.capital.currentYearGainsGross).toFixed(2)).toBe('900.00');
    expect(D(r.capital.netCapitalGain).toFixed(2)).toBe('350.00');
  });
  it('Medicare family reduction in the estimate (2025–26): TI $40,000, spouse $10,000 → levy $76.20', () => {
    const r = run(2026, [salary('2025-09-01', '40000')], { spouse: 'yes', spouseTaxableIncome: '10000' });
    expect(D(est(r, 'medicare')!).toFixed(2)).toBe('76.20');
    expect(r.issues.some((i) => i.code === 'MEDICARE_ESTIMATE')).toBe(false);
  });
  it('no CGT discount and a blocking issue for a year after 30 June 2027 (ITAA 1997 s 115-100 as amended)', () => {
    expect(discountRateFor(2027)).toBe('0.5');
    expect(discountRateFor(2028)).toBeNull();
    const r = run(2028, [
      txn({ kind: 'trade', side: 'buy', date: '2025-07-02', accountId: 'acc', instrumentId: 'ins', quantity: '10', price: '100' }),
      txn({ kind: 'trade', side: 'sell', date: '2027-08-01', accountId: 'acc', instrumentId: 'ins', quantity: '10', price: '150' })
    ]);
    expect(D(r.capital.discountApplied).toFixed(2)).toBe('0.00');
    expect(r.issues.find((i) => i.code === 'CGT_DISCOUNT_UNKNOWN')?.severity).toBe('blocking');
    expect(r.issues.find((i) => i.code === 'CGT_2027_REFORM')?.severity).toBe('blocking');
  });
  it('pre-CGT parcels are not disregarded for a CGT event on or after 1 July 2027 (deemed reacquisition — not supported, flagged)', () => {
    const r = run(2028, [
      txn({ kind: 'trade', side: 'buy', date: '1984-03-01', accountId: 'acc', instrumentId: 'ins', quantity: '100', price: '1' }),
      txn({ kind: 'trade', side: 'sell', date: '2027-07-01', accountId: 'acc', instrumentId: 'ins', quantity: '100', price: '50' })
    ]);
    expect(r.issues.some((i) => i.code === 'PRE_CGT')).toBe(false);
    expect(r.issues.some((i) => i.code === 'CGT_2027_REFORM')).toBe(true);
  });
  it('indexation flag includes an acquisition on 21 September 1999 and not one on 22 September 1999', () => {
    const disp = (acq: string) =>
      run(2026, [
        txn({ kind: 'trade', side: 'buy', date: acq, accountId: 'acc', instrumentId: 'ins', quantity: '10', price: '1' }),
        txn({ kind: 'trade', side: 'sell', date: '2025-09-01', accountId: 'acc', instrumentId: 'ins', quantity: '10', price: '5' })
      ]);
    expect(disp('1999-09-21').issues.some((i) => i.code === 'INDEXATION_OPTION')).toBe(true);
    expect(disp('1999-09-22').issues.some((i) => i.code === 'INDEXATION_OPTION')).toBe(false);
  });
  it('married person with own MLS income ≤ $28,011 pays no surcharge although family income exceeds the tier (s 8D(3)(c))', () => {
    const r = run(2026, [salary('2025-09-01', '25000')], { spouse: 'yes', spouseTaxableIncome: '250000', spouseMlsIncome: '250000', privateHospitalCover: 'no' });
    expect(D(est(r, 'mls')!).toFixed(2)).toBe('0.00');
  });
  it('part-year resident 2026–27 is now estimated (formula enacted in ITRA s 20)', () => {
    const r = run(2027, [salary('2026-09-01', '50000')], { residency: 'part_year', residentMonths: 6 });
    expect(D(est(r, 'gross_tax')!).toFixed(2)).toBe('5875.20');
  });
});
