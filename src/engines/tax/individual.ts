/**
 * Individual tax components (v1.2, audited against official sources in v1.3): part-year residency, Medicare levy family test,
 * Medicare levy surcharge, compulsory HELP repayment and the foreign income tax offset limit.
 *
 * Every function returns null (or reliable=false) when a parameter for the year is missing or
 * unconfirmed — callers flag it. Nothing here substitutes a guessed rate.
 */
import { D, Decimal, dstr } from '../../lib/decimal';
import { daysBetween, fyEnd, fyStart, type FYear } from '../../lib/dates';
import type { TaxProfile } from '../../domain/types';
import type { Bracket, TaxRuleSet } from './rules';

const ZERO = new Decimal(0);

/** Days in an income year (366 when it contains 29 February). */
export function daysInFy(fy: FYear): number {
  return daysBetween(fyStart(fy), fyEnd(fy)) + 1;
}

/**
 * Part-year resident scale: the tax-free threshold is base + perYear × months / 12 (ATO: $13,464 +
 * $4,736 × months resident / 12); the next resident rate applies from that threshold.
 */
export function partYearThreshold(rs: TaxRuleSet, months: number): Decimal | null {
  const p = rs.partYearThreshold;
  if (!p || !Number.isInteger(months) || months < 1 || months > 12) return null;
  return new Decimal(p.perYear).times(months).div(12).plus(p.base);
}

export function partYearBrackets(rs: TaxRuleSet, months: number): Bracket[] | null {
  const t = partYearThreshold(rs, months);
  if (t === null) return null;
  const sorted = [...rs.residentBrackets].sort((a, b) => a.above - b.above);
  if (sorted.length < 2 || sorted[0].rate !== '0' || t.gt(sorted[1].above)) return null;
  return [{ above: 0, rate: '0' }, { above: t.toNumber(), rate: sorted[1].rate }, ...sorted.slice(2)];
}

export interface LevyResult {
  levy: Decimal | null;
  note: string;
  reliable: boolean;
}

/** Medicare levy with single low-income shade-in (10c per $1 above the lower threshold). */
export function medicareLevySingle(ti: Decimal, rs: TaxRuleSet, exemption: TaxProfile['medicareExemption']): LevyResult {
  const rate = D(rs.medicareLevyRate);
  if (exemption === 'full') return { levy: ZERO, note: 'Full Medicare levy exemption recorded.', reliable: true };
  const factor = exemption === 'half' ? new Decimal('0.5') : new Decimal(1);
  const li = rs.medicareLowIncome;
  if (!li) {
    return { levy: ti.times(rate).times(factor), note: `${dstr(rate.times(100))}% of taxable income; low-income reduction NOT applied (thresholds not confirmed for this year).`, reliable: ti.gt(60000) };
  }
  if (ti.lte(li.singleLower)) return { levy: ZERO, note: `At or below the single low-income threshold $${li.singleLower}.`, reliable: true };
  if (ti.lte(li.singleUpper)) return { levy: Decimal.min(ti.minus(li.singleLower).times(li.shadeInRate), ti.times(rate)).times(factor), note: `Shade-in: ${li.shadeInRate} × (taxable income − $${li.singleLower}).`, reliable: true };
  return { levy: ti.times(rate).times(factor), note: `${dstr(rate.times(100))}% of taxable income${factor.lt(1) ? ' (half exemption)' : ''}.`, reliable: true };
}

export interface FamilyInput {
  /** Spouse on 30 June, or sole parent with dependants. */
  hasFamily: boolean;
  spouse: boolean;
  spouseTaxableIncome: Decimal | null;
  children: number;
}

/**
 * Medicare levy with the family reduction of Medicare Levy Act 1986 s 8:
 *  - s 8(1): no levy if family income ≤ the family income threshold;
 *  - s 8(2): otherwise the levy (after the s 7 low-income limit) is reduced by
 *            2% × threshold − 0.08 × (family income − threshold), where positive;
 *  - s 8(3): if married and the spouse would be liable to levy (taxable income above the threshold
 *            amount, s 7(1)), the reduction is reduced by spouse taxable income ÷ family income.
 * Family income = taxable income + spouse taxable income (a negative amount counts as $0, as in the
 * ATO M1 worksheet). The excess-reduction transfer to the spouse (s 8(4)) does not affect this person.
 */
export function medicareLevy(ti: Decimal, rs: TaxRuleSet, exemption: TaxProfile['medicareExemption'], family?: FamilyInput): LevyResult {
  const single = medicareLevySingle(ti, rs, exemption);
  if (!family?.hasFamily || exemption === 'full' || single.levy === null || single.levy.isZero()) return single;
  if (exemption === 'half') return { ...single, note: `${single.note} Half exemption with family: the s 8 family reduction interacts with the exemption (s 9) — not calculated.`, reliable: false };
  if (family.spouse && family.spouseTaxableIncome === null) return { ...single, note: `${single.note} Spouse taxable income not entered — family reduction not tested (levy may be overstated).`, reliable: false };
  const fam = rs.medicareFamily;
  const li = rs.medicareLowIncome;
  if (!fam || fam.lower === null || fam.lowerPerChild === null || !li) return { ...single, note: `${single.note} Family income threshold not available for this year — family reduction not tested (levy may be overstated).`, reliable: false };
  const spouseTi = family.spouse ? Decimal.max(ZERO, family.spouseTaxableIncome!) : ZERO;
  const familyIncome = ti.plus(spouseTi);
  const kids = Math.max(0, Math.floor(family.children));
  const fit = new Decimal(fam.lower).plus(new Decimal(fam.lowerPerChild).times(kids));
  const fi = `family income $${dstr(familyIncome)}`;
  const kidsTxt = `${kids} dependent child${kids === 1 ? '' : 'ren'}`;
  if (familyIncome.lte(fit)) return { levy: ZERO, note: `No levy (s 8(1)): ${fi} is at or below the family income threshold $${dstr(fit)} (${kidsTxt}).`, reliable: true };
  let reduction = fit.times(rs.medicareLevyRate).minus(familyIncome.minus(fit).times('0.08'));
  if (reduction.lte(0)) return { ...single, note: `${single.note} No family reduction: ${fi} is above the point where the s 8(2) reduction reaches nil.` };
  let apportioned = '';
  if (family.spouse && spouseTi.gt(li.singleLower)) {
    reduction = reduction.minus(reduction.times(spouseTi).div(familyIncome));
    apportioned = ` reduced by the spouse’s share (s 8(3))`;
  }
  const levy = Decimal.max(ZERO, single.levy.minus(reduction));
  return {
    levy,
    note: `Family reduction (s 8(2)): 2% × $${dstr(fit)} − 8% × ($${dstr(familyIncome)} − $${dstr(fit)})${apportioned} = $${reduction.toFixed(2)} off a levy of $${single.levy.toFixed(2)} (${kidsTxt}).`,
    reliable: true
  };
}

export interface MlsInput {
  ti: Decimal;
  rfb: Decimal;
  reportableSuper: Decimal;
  netInvestmentLoss: Decimal;
  exemptForeignEmployment: Decimal;
  family: boolean;
  /** Married (spouse on 30 June) — enables the s 8D(3)(c) own-income test. */
  spouse?: boolean;
  spouseMlsIncome: Decimal | null;
  children: number;
  daysWithoutCover: number;
  daysInYear: number;
}

export interface MlsResult {
  amount: Decimal | null;
  rate: string | null;
  incomeForMls: Decimal;
  threshold: string | null;
  note: string;
}

/** Medicare levy surcharge: tier rate (by income for MLS purposes) × (taxable income + RFB) × uncovered days / days in year. */
export function mlsAmount(rs: TaxRuleSet, m: MlsInput): MlsResult {
  const incomeForMls = m.ti.plus(m.rfb).plus(m.reportableSuper).plus(m.netInvestmentLoss).plus(m.exemptForeignEmployment);
  const p = rs.mls;
  if (!p) return { amount: null, rate: null, incomeForMls, threshold: null, note: 'MLS thresholds not available for this year.' };
  if (m.daysWithoutCover <= 0) return { amount: ZERO, rate: '0', incomeForMls, threshold: null, note: 'Appropriate private hospital cover for the whole year — no MLS.' };
  let tested = incomeForMls;
  let tiers = p.single.map((x) => new Decimal(x));
  if (m.family) {
    if (m.spouseMlsIncome === null && m.children === 0) return { amount: null, rate: null, incomeForMls, threshold: null, note: 'Spouse income for MLS purposes not entered — MLS not calculated.' };
    tested = incomeForMls.plus(m.spouseMlsIncome ?? ZERO);
    const extra = new Decimal(p.familyIncreasePerChildAfterFirst).times(Math.max(0, Math.floor(m.children) - 1));
    tiers = p.family.map((x) => new Decimal(x).plus(extra));
  }
  let rate: string = '0';
  for (let i = 0; i < 3; i++) if (tested.gt(tiers[i])) rate = p.rates[i];
  const label = m.family ? 'family' : 'single';
  if (rate === '0') return { amount: ZERO, rate, incomeForMls, threshold: dstr(tiers[0]), note: `Income for MLS purposes ($${dstr(tested)}, ${label}) does not exceed the base-tier threshold $${dstr(tiers[0])}.` };
  if (m.spouse) {
    // Medicare Levy Act s 8D(3)(c): a married person pays MLS only if their own income for surcharge
    // purposes exceeds the threshold amount ($28,011 for 2025–26 — the single low-income threshold).
    if (!rs.medicareLowIncome) return { amount: null, rate, incomeForMls, threshold: dstr(tiers[0]), note: 'Family income exceeds the MLS threshold, but the s 8D(3)(c) own-income amount for this year is not available — MLS not calculated.' };
    if (incomeForMls.lte(rs.medicareLowIncome.singleLower)) return { amount: ZERO, rate: '0', incomeForMls, threshold: dstr(tiers[0]), note: `No MLS (Medicare Levy Act s 8D(3)(c)): own income for MLS purposes $${dstr(incomeForMls)} does not exceed $${rs.medicareLowIncome.singleLower}.` };
  }
  const days = Math.min(m.daysWithoutCover, m.daysInYear);
  const amount = m.ti.plus(m.rfb).times(rate).times(days).div(m.daysInYear);
  return {
    amount,
    rate,
    incomeForMls,
    threshold: dstr(tiers[0]),
    note: `${dstr(D(rate).times(100))}% × (taxable income + reportable fringe benefits) × ${days}/${m.daysInYear} days without cover; ${label} income for MLS purposes $${dstr(tested)} above $${dstr(tiers[0])}.`
  };
}

/**
 * Compulsory study-loan repayment for a repayment income. Up to 2024–25 one rate applies to the whole
 * repayment income; from 2025–26 the marginal system applies. Null when the year's table is unavailable.
 */
export function helpRepayment(rs: TaxRuleSet, repaymentIncome: Decimal): Decimal | null {
  const h = rs.help;
  if (!h) return null;
  if ('percentOfTotal' in h) {
    const band = [...h.percentOfTotal].sort((a, b) => a.from - b.from).filter((b) => repaymentIncome.gte(b.from)).pop();
    return band ? repaymentIncome.times(band.rate) : ZERO;
  }
  if (repaymentIncome.lte(h.minimum)) return ZERO;
  if (repaymentIncome.gt(h.totalIncomeRate.above)) return repaymentIncome.times(h.totalIncomeRate.rate);
  const band = [...h.bands].sort((a, b) => a.above - b.above).filter((b) => repaymentIncome.gt(b.above)).pop();
  if (!band) return ZERO;
  return D(band.base).plus(repaymentIncome.minus(band.above).times(band.rate));
}

/**
 * Foreign income tax offset limit (ATO guide): step 1 tax incl. Medicare levy and MLS, disregarding
 * offsets; step 2 the same with foreign income (and related deductions) disregarded; the limit is
 * step 1 − step 2 when that exceeds the $1,000 default, otherwise $1,000.
 */
export function fitoLimit(step1: Decimal, step2: Decimal, deMinimis: number): Decimal {
  return Decimal.max(new Decimal(deMinimis), step1.minus(step2));
}

export function fitoClaim(foreignTaxPaid: Decimal, limit: Decimal | null, deMinimis: number): Decimal {
  if (foreignTaxPaid.lte(deMinimis) || limit === null) return Decimal.min(foreignTaxPaid, new Decimal(deMinimis));
  return Decimal.min(foreignTaxPaid, limit);
}
