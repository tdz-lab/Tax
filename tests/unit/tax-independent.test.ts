/**
 * Independently derived tax tests (v1.2).
 *
 * "Independent" here means the expected values are NOT produced by the application's own rule
 * tables or bracket loop:
 *   1. A separate reference implementation in integer cents, written from the ATO's published
 *      "$base plus Xc for each $1 over $threshold" table form (typed in below from the ATO text),
 *      is compared with the engine's marginal-bracket calculation across boundaries.
 *   2. ATO worked examples (MLS, HELP) and the statutory part-year formula are used verbatim.
 *   3. Other expected values are hand calculations shown in comments.
 *
 * v1.3 (20 Oct 2026): the tables below were re-checked against the ATO pages (printed copies supplied
 * by the user) and the legislation — see docs/TAX_RULE_VERIFICATION.md and tax-official.test.ts.
 * Passing tests does not prove the application is complete or tax-ready, and nothing here has been
 * reviewed by a registered tax agent.
 */
import { describe, expect, it } from 'vitest';
import { D } from '../../src/lib/decimal';
import { computeTaxYear, taxOnBrackets } from '../../src/engines/tax/taxEngine';
import { RULE_SETS, ruleSetById, ruleSetFor } from '../../src/engines/tax/rules';
import { daysInFy, fitoClaim, fitoLimit, helpRepayment, medicareLevy, mlsAmount, partYearBrackets, partYearThreshold } from '../../src/engines/tax/individual';
import { builtinCategories } from '../../src/domain/reference';
import type { Instrument, TaxProfile, Transaction } from '../../src/domain/types';
import { account, instrument, profile, rate, txn, withFx } from './helpers';

// ---------- 1. Reference implementation (integer cents, ATO table form) ----------
type Row = [above: number, baseDollars: number, centsPerDollar: number];
/** Tax in cents: base + c × (income − above) for the highest row whose `above` the income exceeds. */
function refTaxCents(income: number, table: Row[]): number {
  let row: Row | undefined;
  for (const r of table) if (income > r[0]) row = r;
  if (!row) return 0;
  // (income − above) × cents-per-dollar is exact in integer cents when cents-per-dollar has ≤ 1 decimal place.
  return row[1] * 100 + Math.round((income - row[0]) * row[2]);
}
// Typed from ATO "Tax rates – Australian residents" (2022–23 / 2023–24 and 2024–25 onwards).
const ATO_RES_2024: Row[] = [[18200, 0, 19], [45000, 5092, 32.5], [120000, 29467, 37], [180000, 51667, 45]];
const ATO_RES_2025: Row[] = [[18200, 0, 16], [45000, 4288, 30], [135000, 31288, 37], [190000, 51638, 45]];
// 2026–27: 15c from 1 July 2026 (ATO: "now law"). Bases derived: 26,800 × 15% = 4,020; + 27,000 = 31,020; + 20,350 = 51,370.
const ATO_RES_2027: Row[] = [[18200, 0, 15], [45000, 4020, 30], [135000, 31020, 37], [190000, 51370, 45]];
// Foreign residents 2025–26 (ATO): 30c to $135,000; $40,500 + 37c; $60,850 + 45c over $190,000.
const ATO_FOREIGN_2026: Row[] = [[0, 0, 30], [135000, 40500, 37], [190000, 60850, 45]];
// Working holiday makers 2024–25 and 2025–26 (ATO Schedule 15): 15% to $45,000, then 30/37/45.
const ATO_WHM_2026: Row[] = [[0, 0, 15], [45000, 6750, 30], [135000, 33750, 37], [190000, 54100, 45]];

const INCOMES = [0, 1, 18200, 18201, 30000, 44999, 45000, 45001, 66667, 80000, 119999, 120000, 120001, 134999, 135000, 135001, 150000, 179999, 180000, 180001, 189999, 190000, 190001, 250000, 1000000];
const cents = (d: { toFixed: (n: number) => string }) => Math.round(Number(d.toFixed(2)) * 100);

describe('resident and foreign scales vs an independent integer-cents reference', () => {
  const cases: [string, number, keyof Pick<(typeof RULE_SETS)[number], 'residentBrackets' | 'nonResidentBrackets' | 'whmBrackets'>, Row[]][] = [
    ['2022–23 resident', 2023, 'residentBrackets', ATO_RES_2024],
    ['2023–24 resident', 2024, 'residentBrackets', ATO_RES_2024],
    ['2024–25 resident', 2025, 'residentBrackets', ATO_RES_2025],
    ['2025–26 resident', 2026, 'residentBrackets', ATO_RES_2025],
    ['2026–27 resident (15%)', 2027, 'residentBrackets', ATO_RES_2027],
    ['2025–26 foreign resident', 2026, 'nonResidentBrackets', ATO_FOREIGN_2026],
    ['2025–26 working holiday maker', 2026, 'whmBrackets', ATO_WHM_2026],
    ['2024–25 working holiday maker', 2025, 'whmBrackets', ATO_WHM_2026]
  ];
  for (const [label, fy, key, table] of cases) {
    it(label, () => {
      const brackets = ruleSetFor(fy)![key]!;
      for (const inc of INCOMES) expect(cents(taxOnBrackets(D(inc), brackets)), `${label} at $${inc}`).toBe(refTaxCents(inc, table));
    });
  }
  it('the ATO base amounts are continuous (each base = tax at the threshold under the previous row)', () => {
    for (const table of [ATO_RES_2024, ATO_RES_2025, ATO_RES_2027, ATO_FOREIGN_2026, ATO_WHM_2026]) {
      for (let i = 1; i < table.length; i++) expect(refTaxCents(table[i][0], table.slice(0, i))).toBe(table[i][1] * 100);
    }
  });
});

describe('rule-set provenance', () => {
  it('no rule set as a whole claims to be verified; every one records a check for each core parameter', () => {
    for (const fy of [2023, 2024, 2025, 2026, 2027]) {
      const rs = ruleSetFor(fy)!;
      expect(rs.version).toBe(3);
      expect(rs.status).not.toBe('verified');
      for (const p of ['residentBrackets', 'nonResidentBrackets', 'medicareLowIncome', 'medicareFamily', 'mls', 'help', 'partYearThreshold', 'whmBrackets', 'lito', 'medicareLevyRate', 'cgtDiscountIndividual']) {
        expect(rs.checks?.some((c) => c.param === p), `${rs.id} check for ${p}`).toBe(true);
      }
      // A "verified" check must name the source, the section/table and the source's date.
      for (const c of rs.checks!.filter((x) => x.status === 'verified')) {
        expect(c.source.length, `${rs.id} ${c.param} source`).toBeGreaterThan(10);
        expect(c.section, `${rs.id} ${c.param} section`).toBeTruthy();
        expect(c.sourceDate, `${rs.id} ${c.param} date`).toBeTruthy();
      }
    }
  });
  it('earlier rule-set versions remain available for snapshots and point to their replacement', () => {
    expect(ruleSetById('AU-IND-FY2025-v1')?.supersededBy).toBe('AU-IND-FY2025-v2');
    expect(ruleSetById('AU-IND-FY2025-v2')?.supersededBy).toBe('AU-IND-FY2025-v3');
  });
  it('parameters that no official source published yet are null rather than guessed', () => {
    expect(ruleSetFor(2027)!.medicareLowIncome).toBeNull(); // 2026–27 not published
    expect(ruleSetFor(2027)!.medicareFamily).toBeNull();
    expect(ruleSetFor(2027)!.checks!.find((c) => c.param === 'medicareLowIncome')!.status).toBe('unverified');
    for (const fy of [2023, 2024, 2025, 2026, 2027]) expect(ruleSetFor(fy)!.checks!.some((c) => c.status === 'conflicting')).toBe(false);
  });
});

describe('part-year residents (Income Tax Rates Act s 20)', () => {
  const rs = ruleSetFor(2026)!;
  it('threshold = (TFT − $4,736) + $4,736 × months / 12 (ITRA s 20): 3 months $14,648; 6 months $15,832', () => {
    expect(partYearThreshold(rs, 3)!.toFixed(2)).toBe('14648.00');
    expect(partYearThreshold(rs, 6)!.toFixed(2)).toBe('15832.00');
    expect(partYearThreshold(rs, 12)!.toFixed(2)).toBe('18200.00');
    expect(partYearThreshold(rs, 0)).toBeNull();
    expect(partYearThreshold(rs, 13)).toBeNull();
  });
  it('tax at $50,000 with 6 months residency, 2025–26: 16% × (45,000 − 15,832) + 30% × 5,000 = $6,166.88', () => {
    expect(taxOnBrackets(D(50000), partYearBrackets(rs, 6)!).toFixed(2)).toBe('6166.88');
  });
  it('2026–27 uses the same statutory formula (ITRA s 20, comp. 66) with the 15% first rate: 6 months, $50,000 → 15% × 29,168 + 30% × 5,000 = $5,875.20', () => {
    expect(taxOnBrackets(D(50000), partYearBrackets(ruleSetFor(2027)!, 6)!).toFixed(2)).toBe('5875.20');
  });
});

describe('Medicare levy — single and family thresholds (2025–26)', () => {
  const rs = ruleSetFor(2026)!;
  it('single shade-in $28,011 / $35,013 with exact boundaries', () => {
    expect(medicareLevy(D(28011), rs, 'none').levy!.toFixed(2)).toBe('0.00');
    expect(medicareLevy(D(30000), rs, 'none').levy!.toFixed(2)).toBe('198.90'); // 10% × 1,989
    expect(medicareLevy(D(35013), rs, 'none').levy!.toFixed(2)).toBe('700.20'); // 10% × 7,002 < 2% × 35,013 = 700.26
    expect(medicareLevy(D(35014), rs, 'none').levy!.toFixed(2)).toBe('700.28'); // 2%
  });
  const fam = (spouseTi: number | null, children = 0, spouse = true) => ({ hasFamily: spouse || children > 0, spouse, spouseTaxableIncome: spouseTi === null ? null : D(spouseTi), children });
  it('nil levy at or below the family threshold ($47,238 + $4,338 per child)', () => {
    expect(medicareLevy(D(40000), rs, 'none', fam(5000)).levy!.toFixed(2)).toBe('0.00'); // 45,000 ≤ 47,238
    expect(medicareLevy(D(40000), rs, 'none', fam(7238)).levy!.toFixed(2)).toBe('0.00'); // exactly 47,238
    expect(medicareLevy(D(40000), rs, 'none', fam(15000, 2)).levy!.toFixed(2)).toBe('0.00'); // 55,000 ≤ 55,914
    expect(medicareLevy(D(50000), rs, 'none', fam(null, 2, false)).levy!.toFixed(2)).toBe('0.00'); // sole parent
  });
  it('s 8(2) family reduction between the thresholds (spouse not liable): 2% × 47,238 − 8% × (50,000 − 47,238) = 723.80 off 800 → $76.20', () => {
    const r = medicareLevy(D(40000), rs, 'none', fam(10000));
    expect(r.levy!.toFixed(2)).toBe('76.20');
    expect(r.reliable).toBe(true);
  });
  it('s 8(3) apportionment when the spouse is also liable: TI 29,000 + spouse 29,000 → reduction 83.80 × ½ = 41.90 off the s 7 levy 98.90 → $57.00', () => {
    // s 7(2): levy ≤ 10% × (29,000 − 28,011) = 98.90 (less than 2% × 29,000 = 580).
    const r = medicareLevy(D(29000), rs, 'none', fam(29000));
    expect(r.levy!.toFixed(2)).toBe('57.00');
  });
  it('a negative spouse taxable income counts as $0 (ATO M1 worksheet 1)', () => {
    expect(medicareLevy(D(40000), rs, 'none', fam(-5000)).levy!.toFixed(2)).toBe(medicareLevy(D(40000), rs, 'none', fam(0)).levy!.toFixed(2));
  });
  it('the reduction reaches nil at 1.25 × the threshold (ATO family limit $59,047)', () => {
    expect(medicareLevy(D(40000), rs, 'none', fam(19047)).levy!.toFixed(2)).toBe('799.96'); // FI 59,047: reduction 0.04
    expect(medicareLevy(D(40000), rs, 'none', fam(19048)).levy!.toFixed(2)).toBe('800.00');
  });
  it('above the family limit ($59,047 + $5,423 per child) the single result stands', () => {
    const r = medicareLevy(D(40000), rs, 'none', fam(30000));
    expect(r.levy!.toFixed(2)).toBe('800.00');
    expect(r.reliable).toBe(true);
  });
  it('missing spouse income is flagged, never assumed to be nil', () => {
    expect(medicareLevy(D(40000), rs, 'none', fam(null)).reliable).toBe(false);
  });
});

describe('Medicare levy surcharge', () => {
  const rs = ruleSetFor(2026)!; // single 101,000 / 118,000 / 158,000; family 202,000 / 236,000 / 316,000
  const base = { rfb: D(0), reportableSuper: D(0), netInvestmentLoss: D(0), exemptForeignEmployment: D(0), family: false, spouseMlsIncome: null, children: 0, daysWithoutCover: 365, daysInYear: 365 };
  it('single tiers with exact boundaries', () => {
    expect(mlsAmount(rs, { ...base, ti: D(101000) }).amount!.toFixed(2)).toBe('0.00');
    expect(mlsAmount(rs, { ...base, ti: D(101001) }).amount!.toFixed(2)).toBe('1010.01'); // 1%
    expect(mlsAmount(rs, { ...base, ti: D(118001) }).amount!.toFixed(4)).toBe('1475.0125'); // 1.25%
    expect(mlsAmount(rs, { ...base, ti: D(158001) }).amount!.toFixed(4)).toBe('2370.0150'); // 1.5%
  });
  it('income for MLS includes RFB, net investment losses and reportable super; the rate applies to taxable income + RFB', () => {
    const r = mlsAmount(rs, { ...base, ti: D(95000), rfb: D(3000), netInvestmentLoss: D(4000) }); // 102,000 → tier 1
    expect(r.incomeForMls.toFixed(0)).toBe('102000');
    expect(r.amount!.toFixed(2)).toBe('980.00'); // 1% × 98,000
  });
  it('pro-rated for days without cover', () => {
    expect(mlsAmount(rs, { ...base, ti: D(110000), daysWithoutCover: 73 }).amount!.toFixed(2)).toBe('220.00'); // 1,100 × 73/365
    expect(mlsAmount(rs, { ...base, ti: D(200000), daysWithoutCover: 0 }).amount!.toFixed(2)).toBe('0.00');
  });
  it('family thresholds increase by $1,500 per dependent child after the first', () => {
    const f = { ...base, family: true, spouseMlsIncome: D(90000) };
    expect(mlsAmount(rs, { ...f, ti: D(120000) }).amount!.toFixed(2)).toBe('1200.00'); // 210,000 > 202,000
    expect(mlsAmount(rs, { ...f, ti: D(120000), children: 7 }).amount!.toFixed(2)).toBe('0.00'); // 202,000 + 9,000 = 211,000
  });
  it('married person whose own income for MLS purposes does not exceed $28,011 pays no MLS (Medicare Levy Act s 8D(3)(c))', () => {
    expect(mlsAmount(rs, { ...base, family: true, spouse: true, spouseMlsIncome: D(250000), ti: D(28011) }).amount!.toFixed(2)).toBe('0.00');
    expect(mlsAmount(rs, { ...base, family: true, spouse: true, spouseMlsIncome: D(250000), ti: D(28012) }).amount!.toFixed(2)).toBe('350.15'); // 1.25% × 28,012
  });
  it('ATO example (2026–27, Tom): taxable income $90,000 + RFB $27,000 = $117,000 → tier 1 → $1,170', () => {
    expect(mlsAmount(ruleSetFor(2027)!, { ...base, ti: D(90000), rfb: D(27000) }).amount!.toFixed(2)).toBe('1170.00');
  });
  it('days in income year (leap year 2023–24 has 366)', () => {
    expect(daysInFy(2024)).toBe(366);
    expect(daysInFy(2026)).toBe(365);
  });
});

describe('compulsory study-loan repayment (2025–26 marginal system)', () => {
  const rs = ruleSetFor(2026)!;
  const h = (ri: number) => helpRepayment(rs, D(ri))!.toFixed(2);
  it('nil to $67,000; 15c per $1 to $125,000; $8,700 + 17c to $179,285; 10% of total above', () => {
    expect(h(67000)).toBe('0.00');
    expect(h(67001)).toBe('0.15');
    expect(h(100000)).toBe('4950.00');
    expect(h(125000)).toBe('8700.00');
    expect(h(150000)).toBe('12950.00');
    expect(h(179285)).toBe('17928.45');
    expect(h(179286)).toBe('17928.60');
    expect(h(200000)).toBe('20000.00');
  });
  it('ATO examples 2026–27: Christina $86,380 → $2,527.80; Barry $137,064 → $10,276.99; Priya $254,780 → $25,478', () => {
    const r27 = ruleSetFor(2027)!;
    expect(helpRepayment(r27, D(86380))!.toFixed(2)).toBe('2527.80');
    expect(helpRepayment(r27, D(137064))!.toFixed(2)).toBe('10276.99');
    expect(helpRepayment(r27, D(254780))!.toFixed(2)).toBe('25478.00');
    expect(helpRepayment(r27, D(69528))!.toFixed(2)).toBe('0.00');
    expect(helpRepayment(r27, D(186050))!.toFixed(2)).toBe('18604.61'); // 9,028 + 17% × 56,333
    expect(helpRepayment(r27, D(186051))!.toFixed(2)).toBe('18605.10'); // 10% of total
  });
  it('ATO example 2024–25 (Branson): repayment income $99,736 is in the 5.5% band; percentage tables at their boundaries', () => {
    // The ATO page states "$99,736 × 5.5% = $5,485.52", but 99,736 × 0.055 = 5,485.48 exactly
    // (4,986.80 + 498.68). The band and rate are taken from the ATO table; the ATO's product is an
    // arithmetic slip, documented in docs/TAX_RULE_VERIFICATION.md.
    expect(99736 * 55).toBe(5485480); // independent integer check (cents × 1000)
    expect(helpRepayment(ruleSetFor(2025)!, D(99736))!.toFixed(2)).toBe('5485.48');
    expect(helpRepayment(ruleSetFor(2025)!, D(54434))!.toFixed(2)).toBe('0.00');
    expect(helpRepayment(ruleSetFor(2025)!, D(54435))!.toFixed(2)).toBe('544.35');
    expect(helpRepayment(ruleSetFor(2024)!, D(151201))!.toFixed(2)).toBe('15120.10');
    expect(helpRepayment(ruleSetFor(2023)!, D(48360))!.toFixed(2)).toBe('0.00');
    expect(helpRepayment(ruleSetFor(2023)!, D(48361))!.toFixed(2)).toBe('483.61');
  });
});

describe('foreign income tax offset limit', () => {
  it('limit above $1,000 is used and the claim is the lesser of foreign tax and the limit (ATO 2024 guide examples are in tax-official.test.ts)', () => {
    const limit = fitoLimit(D('6000'), D('3000'), 1000);
    expect(limit.toFixed(2)).toBe('3000.00');
    expect(fitoClaim(D(3400), limit, 1000).toFixed(2)).toBe('3000.00');
  });
  it('a difference of $1,000 or less leaves the $1,000 default limit', () => {
    expect(fitoLimit(D(5000), D(4500), 1000).toFixed(2)).toBe('1000.00');
    expect(fitoClaim(D(800), null, 1000).toFixed(2)).toBe('800.00');
    expect(fitoClaim(D(1800), null, 1000).toFixed(2)).toBe('1000.00');
  });
});

// ---------- engine scenarios ----------
const cats = builtinCategories();
function run(fy: number, txns: Transaction[], p: Partial<TaxProfile> = {}, instruments: Instrument[] = [instrument({ id: 'ins', symbol: 'DEMOA' })], extraProfiles: TaxProfile[] = []) {
  return computeTaxYear({
    data: { transactions: txns, accounts: [account({ id: 'acc' })], instruments, corporateActions: [] },
    fy,
    taxProfiles: [profile(fy, p), ...extraProfiles],
    assets: [],
    categories: cats,
    taxTz: 'Australia/Sydney',
    costBasisDefaults: {},
    lossOrdering: 'non_discount_first',
    now: '2026-10-20T00:00:00Z'
  });
}
const est = (r: ReturnType<typeof run>, k: string) => r.estimate.find((l) => l.key === k)?.amount ?? null;
const salary = (date: string, amount: string, extra: Partial<Transaction> = {}) => txn({ kind: 'income', date, category: 'salary', taxClass: 'SALARY_WAGES', amount, ...extra });

describe('tax-year engine — v1.2 scenarios (hand-calculated)', () => {
  it('FITO limit above $1,000 (2025–26): salary $100,000 + foreign income $10,000 with $4,000 foreign tax', () => {
    // Step 1 (TI 110,000): 4,288 + 30% × 65,000 = 23,788 + Medicare 2,200 = 25,988.
    // Step 2 (TI 100,000): 4,288 + 30% × 55,000 = 20,788 + Medicare 2,000 = 22,788. Limit 3,200.
    const r = run(2026, [salary('2025-09-01', '100000'), txn({ kind: 'income', date: '2025-10-01', category: 'other', taxClass: 'FOREIGN_INCOME', amount: '10000', foreignTaxPaid: '4000' })]);
    expect(est(r, 'taxable_income')).toBe('110000');
    expect(D(r.offsetsAndCredits.find((l) => l.key === 'fito')!.amount!).toFixed(2)).toBe('3200.00');
    expect(r.issues.find((i) => i.code === 'FITO_LIMIT')!.message).toContain('3200.00');
  });

  it('HELP repayment is added to the amount payable (2025–26, resident, RFB included)', () => {
    // TI 90,000 + RFB 10,000 = repayment income 100,000 → 15% × 33,000 = 4,950.
    // Tax 4,288 + 30% × 45,000 = 17,788; Medicare 1,800; withheld 20,000 → 17,788 + 1,800 + 4,950 − 20,000 = 4,538.
    const r = run(2026, [salary('2025-09-01', '90000', { taxWithheld: '20000' })], { helpDebt: 'yes', reportableFringeBenefits: '10000' });
    expect(D(est(r, 'help')!).toFixed(2)).toBe('4950.00');
    expect(D(est(r, 'net_payable')!).toFixed(2)).toBe('4538.00');
  });

  it('HELP repayment cannot exceed the loan balance', () => {
    const r = run(2026, [salary('2025-09-01', '90000')], { helpDebt: 'yes', helpBalance: '1234.56' });
    expect(D(est(r, 'help')!).toFixed(2)).toBe('1234.56');
  });

  it('HELP for 2024–25 uses the percentage-of-total table: $90,000 → 5.0% = $4,500', () => {
    const r = run(2025, [salary('2024-09-01', '90000')], { helpDebt: 'yes' });
    expect(D(est(r, 'help')!).toFixed(2)).toBe('4500.00');
  });

  it('MLS with no private cover is included in the amount payable (2025–26, single, $120,000)', () => {
    // 1.25% × 120,000 = 1,500 (tier 2: 118,001–158,000).
    const r = run(2026, [salary('2025-09-01', '120000')], { privateHospitalCover: 'no' });
    expect(D(est(r, 'mls')!).toFixed(2)).toBe('1500.00');
    // Tax 4,288 + 30% × 75,000 = 26,788 + Medicare 2,400 + MLS 1,500 = 30,688.
    expect(D(est(r, 'net_payable')!).toFixed(2)).toBe('30688.00');
  });

  it('MLS is not guessed when cover status is unknown', () => {
    const r = run(2026, [salary('2025-09-01', '120000')], { privateHospitalCover: 'unknown' });
    expect(est(r, 'mls')).toBeNull();
    expect(r.issues.find((i) => i.code === 'MLS_NOT_COMPUTED')?.severity).toBe('warning');
  });

  it('Medicare family test: no levy when family income is within the family threshold', () => {
    const r = run(2026, [salary('2025-09-01', '40000')], { spouse: 'yes', spouseTaxableIncome: '5000' });
    expect(D(est(r, 'medicare')!).toFixed(2)).toBe('0.00');
  });

  it('part-year resident estimate (6 months, $50,000, 2025–26)', () => {
    // Tax 6,166.88 (threshold 15,832); LITO 325 − 1.5% × 5,000 = 250; Medicare 2% × 50,000 = 1,000 (full year, flagged).
    const r = run(2026, [salary('2025-09-01', '50000')], { residency: 'part_year', residentMonths: 6 });
    expect(r.estimateStatus).toBe('estimate');
    expect(D(est(r, 'gross_tax')!).toFixed(2)).toBe('6166.88');
    expect(D(est(r, 'lito')!).toFixed(2)).toBe('250.00');
    expect(r.issues.some((i) => i.code === 'PART_YEAR')).toBe(true);
  });

  it('part-year resident without months entered is blocked, not guessed', () => {
    const r = run(2026, [salary('2025-09-01', '50000')], { residency: 'part_year' });
    expect(r.estimateStatus).toBe('not_available');
  });

  it('working holiday maker 2025–26: 15% to $45,000 then 30%, no LITO or Medicare levy', () => {
    const r = run(2026, [salary('2025-09-01', '50000')], { residency: 'working_holiday' });
    expect(D(est(r, 'gross_tax')!).toFixed(2)).toBe('8250.00'); // 6,750 + 1,500
    expect(est(r, 'lito')).toBeNull();
    expect(D(est(r, 'medicare')!).toFixed(2)).toBe('0.00');
  });

  it('working holiday maker 2023–24 (ATO / ITRA comp. 61): $6,750 + 32.5% × 5,000 = $8,375', () => {
    const r = run(2024, [salary('2023-09-01', '50000')], { residency: 'working_holiday' });
    expect(D(est(r, 'gross_tax')!).toFixed(2)).toBe('8375.00');
  });

  it('prior-year tax losses are deducted and the excess carried forward', () => {
    const r = run(2026, [salary('2025-09-01', '3000')], { openingRevenueLosses: '5000' });
    expect(est(r, 'taxable_income')).toBe('0');
    expect(D(est(r, 'prior_tax_losses')!).toFixed(2)).toBe('3000.00');
    expect(D(r.totals.revenueLossesCarriedForward!).toFixed(2)).toBe('2000.00');
  });

  it('a current-year tax loss is carried forward', () => {
    const r = run(2026, [salary('2025-09-01', '1000'), txn({ kind: 'expense', date: '2025-10-01', category: 'work_general', taxClass: 'DEDUCTIBLE_EXPENSE', amount: '1500', businessUsePct: '100' })]);
    expect(D(r.totals.revenueLossesCarriedForward!).toFixed(2)).toBe('500.00');
  });

  it('trust AMMA components: discounted gain grossed up ×2 and re-discounted after losses', () => {
    // Distribution $1,000: tax-deferred 50, discounted gain 100 (gross 200), other 50 → ordinary 1,000 − 50 − 250 = 700.
    // Own capital loss 120 (sale of DEMOA: cost 1,120, proceeds 1,000). Losses: 50 against other, 70 against discount gains.
    // Remaining discount gains 130 × 50% = 65 → net capital gain 65.
    const r = run(2026, [
      txn({ kind: 'income', date: '2025-08-01', category: 'distribution', taxClass: 'TRUST_DISTRIBUTION', amount: '1000', taxDeferredAmount: '50', cgDiscountedComponent: '100', cgOtherComponent: '50' }),
      txn({ kind: 'trade', side: 'buy', date: '2025-07-02', accountId: 'acc', instrumentId: 'ins', quantity: '10', price: '112' }),
      txn({ kind: 'trade', side: 'sell', date: '2025-09-01', accountId: 'acc', instrumentId: 'ins', quantity: '10', price: '100' })
    ]);
    expect(D(r.income.find((l) => l.key === 'trust_dist')!.amount!).toFixed(2)).toBe('700.00');
    expect(D(r.capital.discountableGains).toFixed(2)).toBe('200.00');
    expect(D(r.capital.netCapitalGain).toFixed(2)).toBe('65.00');
    expect(r.issues.some((i) => i.code === 'TRUST_CG')).toBe(false);
  });

  it('pre-CGT parcels (acquired before 20 September 1985) are disregarded and flagged', () => {
    const r = run(2026, [
      txn({ kind: 'trade', side: 'buy', date: '1984-03-01', accountId: 'acc', instrumentId: 'ins', quantity: '100', price: '1' }),
      txn({ kind: 'trade', side: 'sell', date: '2025-09-01', accountId: 'acc', instrumentId: 'ins', quantity: '100', price: '50' })
    ]);
    expect(D(r.capital.currentYearGainsGross).toFixed(2)).toBe('0.00');
    expect(r.issues.find((i) => i.code === 'PRE_CGT')?.severity).toBe('warning');
  });

  it('a parcel bought on 20 September 1985 is subject to CGT (boundary) and may use indexation (flagged)', () => {
    const r = run(2026, [
      txn({ kind: 'trade', side: 'buy', date: '1985-09-20', accountId: 'acc', instrumentId: 'ins', quantity: '100', price: '1' }),
      txn({ kind: 'trade', side: 'sell', date: '2025-09-01', accountId: 'acc', instrumentId: 'ins', quantity: '100', price: '50' })
    ]);
    expect(D(r.capital.discountableGains).toFixed(2)).toBe('4900.00');
    expect(r.issues.some((i) => i.code === 'INDEXATION_OPTION')).toBe(true);
  });

  it('wash-sale review: a capital loss re-acquired within 30 days is flagged (loss still included)', () => {
    const r = run(2026, [
      txn({ kind: 'trade', side: 'buy', date: '2025-07-02', accountId: 'acc', instrumentId: 'ins', quantity: '10', price: '100' }),
      txn({ kind: 'trade', side: 'sell', date: '2026-06-20', accountId: 'acc', instrumentId: 'ins', quantity: '10', price: '50' }),
      txn({ kind: 'trade', side: 'buy', date: '2026-06-25', accountId: 'acc', instrumentId: 'ins', quantity: '10', price: '51' })
    ]);
    expect(D(r.capital.currentYearLosses).toFixed(2)).toBe('500.00');
    expect(r.issues.some((i) => i.code === 'WASH_SALE_REVIEW')).toBe(true);
  });

  it('franking credits of $5,000 or more trigger the holding period rule; below $5,000 the small shareholder exemption applies (ATO)', () => {
    const div = (credit: string, extra: Partial<Transaction> = {}) => txn({ kind: 'income', date: '2025-09-20', category: 'dividend_au', taxClass: 'DIVIDEND', amount: '11667', frankedAmount: '11667', frankingCredit: credit, ...extra });
    expect(run(2026, [div('6000')]).issues.find((i) => i.code === 'FRANKING_HOLDING_PERIOD')?.severity).toBe('warning');
    // Regression: exactly $5,000 is "$5,000 or more" — previously treated as exempt.
    expect(run(2026, [div('5000')]).issues.find((i) => i.code === 'FRANKING_HOLDING_PERIOD')?.severity).toBe('warning');
    expect(run(2026, [div('4999.99')]).issues.some((i) => i.code === 'FRANKING_HOLDING_PERIOD')).toBe(false);
  });

  it('franking holding period: shares bought 10 days before ex-date and sold 5 days after → possible failure', () => {
    const r = run(2026, [
      txn({ kind: 'trade', side: 'buy', date: '2025-09-01', accountId: 'acc', instrumentId: 'ins', quantity: '1000', price: '100' }),
      txn({ kind: 'income', date: '2025-09-30', category: 'dividend_au', taxClass: 'DIVIDEND', amount: '14000', frankedAmount: '14000', frankingCredit: '6000', instrumentId: 'ins', exDividendDate: '2025-09-11' }),
      txn({ kind: 'trade', side: 'sell', date: '2025-09-16', accountId: 'acc', instrumentId: 'ins', quantity: '1000', price: '100' })
    ]);
    expect(r.issues.find((i) => i.code === 'FRANKING_HOLDING_PERIOD')!.message).toContain('possible failure');
  });

  it('foreign currency balances raise the Div 775 warning unless a limited balance election is recorded', () => {
    const rates = [rate('AUD', 'USD', '2025-09-01', '0.65')];
    const t = withFx(txn({ kind: 'cash', side: 'deposit', date: '2025-09-01', accountId: 'acc', currency: 'USD', amount: '1000' }), rates);
    expect(run(2026, [t]).issues.find((i) => i.code === 'FOREX_DIV775')?.severity).toBe('warning');
    expect(run(2026, [t], { forexLimitedBalanceElection: 'yes' }).issues.find((i) => i.code === 'FOREX_DIV775')?.severity).toBe('info');
  });

  it('small crypto disposals: personal-use exemption NOT applied, only noted', () => {
    const r = run(
      2026,
      [
        txn({ kind: 'trade', side: 'buy', date: '2025-07-02', accountId: 'acc', instrumentId: 'btc', quantity: '0.1', price: '50000' }),
        txn({ kind: 'trade', side: 'sell', date: '2025-09-01', accountId: 'acc', instrumentId: 'btc', quantity: '0.1', price: '60000' })
      ],
      {},
      [instrument({ id: 'btc', symbol: 'BTC', assetClass: 'crypto' })]
    );
    expect(D(r.capital.nonDiscountableGains).toFixed(2)).toBe('1000.00');
    expect(r.issues.find((i) => i.code === 'PERSONAL_USE_NOT_APPLIED')?.severity).toBe('info');
  });
});
