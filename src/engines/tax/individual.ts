/**
 * Individual tax components added in v1.2: part-year residency, Medicare levy family test,
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
 * Medicare levy with the family test. Applies the confirmed parts only: no levy when family taxable
 * income is at or below the family lower threshold, and no family reduction above the family limit.
 * Between the two the reduction formula has not been sourced, so the single result is returned as
 * an upper bound and marked unreliable.
 */
export function medicareLevy(ti: Decimal, rs: TaxRuleSet, exemption: TaxProfile['medicareExemption'], family?: FamilyInput): LevyResult {
  const single = medicareLevySingle(ti, rs, exemption);
  if (!family?.hasFamily || exemption === 'full' || single.levy === null || single.levy.isZero()) return single;
  if (exemption === 'half') return { ...single, note: `${single.note} Half exemption with family: family reduction not calculated.`, reliable: false };
  if (family.spouse && family.spouseTaxableIncome === null) return { ...single, note: `${single.note} Spouse taxable income not entered — family reduction not tested (levy may be overstated).`, reliable: false };
  const fam = rs.medicareFamily;
  if (!fam) return { ...single, note: `${single.note} Family thresholds not confirmed for this year — family reduction not tested (levy may be overstated).`, reliable: false };
  const familyIncome = ti.plus(family.spouse ? family.spouseTaxableIncome! : ZERO);
  const kids = Math.max(0, Math.floor(family.children));
  const lower = fam.lower !== null && fam.lowerPerChild !== null ? new Decimal(fam.lower).plus(new Decimal(fam.lowerPerChild).times(kids)) : null;
  const upper = fam.upper !== null && fam.upperPerChild !== null ? new Decimal(fam.upper).plus(new Decimal(fam.upperPerChild).times(kids)) : null;
  const fi = `family taxable income $${dstr(familyIncome)}`;
  if (lower !== null && familyIncome.lte(lower)) return { levy: ZERO, note: `No levy: ${fi} is at or below the family threshold $${dstr(lower)} (${kids} dependent child${kids === 1 ? '' : 'ren'}).`, reliable: true };
  if (upper !== null && familyIncome.gt(upper)) return { ...single, note: `${single.note} No family reduction: ${fi} exceeds the family limit $${dstr(upper)}.` };
  return { ...single, note: `${single.note} A family reduction may apply (${fi}${upper !== null ? ` ≤ limit $${dstr(upper)}` : ''}) but its amount is not calculated — levy shown is an upper bound.`, reliable: false };
}

export interface MlsInput {
  ti: Decimal;
  rfb: Decimal;
  reportableSuper: Decimal;
  netInvestmentLoss: Decimal;
  exemptForeignEmployment: Decimal;
  family: boolean;
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
  if (m.family && rs.medicareLowIncome && m.ti.plus(m.rfb).lte(rs.medicareLowIncome.singleLower)) {
    return { amount: null, rate, incomeForMls, threshold: dstr(tiers[0]), note: `Family income exceeds the threshold, but this person's income is at or below the Medicare low-income threshold $${rs.medicareLowIncome.singleLower}; the ATO says such a family member may not pay MLS. The exact test was not sourced — MLS not calculated.` };
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

/** Compulsory study-loan repayment for a repayment income. Null when the year's schedule is not available. */
export function helpRepayment(rs: TaxRuleSet, repaymentIncome: Decimal): Decimal | null {
  const h = rs.help;
  if (!h) return null;
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
