/**
 * Australian individual tax-year engine. Pure function: ledger data in → traceable result out.
 *
 * It separates (1) recorded totals, (2) calculated tax amounts, (3) estimates that depend on
 * assumptions, (4) values awaiting review and (5) readiness for tax-agent review. Nothing with a
 * missing exchange rate, missing cost base or unresolved classification is silently included.
 */
import { D, Decimal, dstr, toWholeDollarsDown, tryD } from '../../lib/decimal';
import { fyLabel, type FYear } from '../../lib/dates';
import { TAX_CLASS_INFO } from '../../domain/reference';
import type { Asset, BusinessProfile, Category, TaxClass, TaxProfile, Transaction } from '../../domain/types';
import { ZERO, audOf, type LedgerData } from '../ledger';
import { runLotEngine, type Disposal, type LotEngineResult } from '../trading/lots';
import { runDerivativeEngine, type DerivativeResult, type RealisedEvent } from '../trading/derivatives';
import { depreciationSchedule } from '../business/depreciation';
import { basSummary, type BasPeriod } from '../business/gst';
import { ruleSetFor, type Bracket, type TaxRuleSet } from './rules';

export type LineStatus = 'recorded' | 'calculated' | 'estimate' | 'review' | 'incomplete';

export interface TaxLine {
  key: string;
  label: string;
  amount: string | null; // AUD, unrounded decimal string; null = cannot be determined
  status: LineStatus;
  sourceIds: string[];
  method?: string;
  notes?: string[];
}

export interface Issue {
  code: string;
  severity: 'blocking' | 'warning' | 'info';
  message: string;
  txnIds: string[];
}

export interface CgtDisposalOut {
  id: string;
  txnId: string;
  instrumentId: string;
  accountId?: string;
  kind: string;
  date: string;
  quantity: string;
  proceedsAud: string | null;
  costAud: string | null;
  gainAud: string | null;
  discountEligible: boolean;
  method: string;
  taxClass: TaxClass;
  allocations: { lotId: string; sourceTxnId: string; quantity: string; acquiredDate: string; costAud: string | null; proceedsAud: string | null; gainAud: string | null; heldDays: number; discountEligible: boolean }[];
  flags: string[];
}

export interface DerivEventOut {
  id: string;
  txnId: string;
  openTxnIds: string[];
  accountId?: string;
  instrumentId?: string;
  kind: string;
  direction?: string;
  date: string;
  quantity: string;
  currency: string;
  pnlNative: string;
  feesNative: string;
  netAud: string | null;
  taxClass: TaxClass;
  flags: string[];
}

export interface CapitalSummary {
  currentYearGainsGross: string;
  discountableGains: string;
  nonDiscountableGains: string;
  trustCapitalGains: string;
  currentYearLosses: string;
  priorYearLossesAvailable: string;
  lossesAppliedCurrent: string;
  lossesAppliedPrior: string;
  discountRate: string;
  discountApplied: string;
  netCapitalGain: string;
  lossesCarriedForward: string;
  lossOrdering: string;
  incomplete: boolean;
  steps: string[];
}

export interface TaxYearResult {
  fy: FYear;
  fyLabel: string;
  ruleSetId: string | null;
  ruleStatus: string;
  generatedAt: string;
  residency: string;
  income: TaxLine[];
  deductions: TaxLine[];
  business: TaxLine[];
  revenueTrading: TaxLine[];
  capital: CapitalSummary;
  capitalLines: TaxLine[];
  foreign: TaxLine[];
  offsetsAndCredits: TaxLine[];
  estimate: TaxLine[];
  estimateStatus: 'estimate' | 'incomplete' | 'not_available';
  reviewItems: { id: string; txnId: string; label: string; amountAud: string | null; reason: string }[];
  excluded: { txnId: string; reason: string }[];
  issues: Issue[];
  readiness: { status: 'ready_for_agent_review' | 'needs_attention' | 'incomplete'; blocking: string[]; warnings: string[] };
  disposals: CgtDisposalOut[];
  derivativeEvents: DerivEventOut[];
  depreciation: { assetId: string; name: string; opening: string; decline: string; deductible: string; closing: string; balancingAdjustment: string | null; flags: string[] }[];
  bas: { periods: (Omit<BasPeriod, 'g1TotalSalesAud' | 'gstFreeSalesAud' | 'gstOnSalesAud' | 'gstOnPurchasesAud' | 'netGstAud'> & Record<string, unknown>)[]; notes: string[] };
  totals: Record<string, string | null>;
  assumptions: string[];
}

export interface TaxEngineInput {
  data: LedgerData;
  fy: FYear;
  taxProfiles: TaxProfile[];
  business?: BusinessProfile;
  assets: Asset[];
  categories: Category[];
  taxTz: string;
  costBasisDefaults: Record<string, any>;
  lossOrdering: 'non_discount_first' | 'discount_first';
  now?: string;
  /** Pre-computed engine runs (to avoid recomputation when evaluating several years). */
  lotRun?: LotEngineResult;
  derivRun?: DerivativeResult;
}

const s = (d: Decimal | null) => (d === null ? null : dstr(d));
const add = (a: Decimal | null, b: Decimal | null) => (a === null || b === null ? null : a.plus(b));

export function taxOnBrackets(income: Decimal, brackets: Bracket[]): Decimal {
  let tax = ZERO;
  const sorted = [...brackets].sort((a, b) => a.above - b.above);
  for (let i = 0; i < sorted.length; i++) {
    const lo = new Decimal(sorted[i].above);
    const hi = i + 1 < sorted.length ? new Decimal(sorted[i + 1].above) : null;
    if (income.lte(lo)) break;
    const top = hi === null ? income : Decimal.min(income, hi);
    tax = tax.plus(top.minus(lo).times(sorted[i].rate));
  }
  return tax;
}

export function litoAmount(ti: Decimal, rs: TaxRuleSet): Decimal {
  const p = rs.lito;
  if (!p) return ZERO;
  if (ti.lte(p.t1)) return new Decimal(p.max);
  if (ti.lte(p.t2)) return new Decimal(p.max).minus(ti.minus(p.t1).times(p.rate1));
  if (ti.lte(p.t3)) return Decimal.max(ZERO, new Decimal(p.mid).minus(ti.minus(p.t2).times(p.rate2)));
  return ZERO;
}

export function medicareLevy(ti: Decimal, rs: TaxRuleSet, exemption: TaxProfile['medicareExemption']): { levy: Decimal; note: string; reliable: boolean } {
  const rate = D(rs.medicareLevyRate);
  let factor = new Decimal(1);
  if (exemption === 'full') return { levy: ZERO, note: 'Full Medicare levy exemption recorded.', reliable: true };
  if (exemption === 'half') factor = new Decimal('0.5');
  const li = rs.medicareLowIncome;
  if (!li) {
    return { levy: ti.times(rate).times(factor), note: `${dstr(rate.times(100))}% of taxable income; low-income reduction NOT applied (thresholds not verified for this year).`, reliable: ti.gt(60000) };
  }
  if (ti.lte(li.singleLower)) return { levy: ZERO, note: `Below single low-income threshold $${li.singleLower}.`, reliable: true };
  if (ti.lte(li.singleUpper)) return { levy: Decimal.min(ti.minus(li.singleLower).times(li.shadeInRate), ti.times(rate)).times(factor), note: `Shade-in: ${li.shadeInRate} × (TI − $${li.singleLower}). Singles thresholds only.`, reliable: true };
  return { levy: ti.times(rate).times(factor), note: `${dstr(rate.times(100))}% of taxable income${factor.lt(1) ? ' (half exemption)' : ''}. Singles thresholds assumed.`, reliable: true };
}

function disposalOut(d: Disposal): CgtDisposalOut {
  return {
    id: d.id,
    txnId: d.txnId,
    instrumentId: d.instrumentId,
    accountId: d.accountId,
    kind: d.kind,
    date: d.disposedDate,
    quantity: dstr(d.quantity),
    proceedsAud: s(d.proceedsAud),
    costAud: s(d.costAud),
    gainAud: s(d.gainAud),
    discountEligible: d.discountEligible,
    method: d.method,
    taxClass: d.taxClass,
    allocations: d.allocations.map((a) => ({
      lotId: a.lotId,
      sourceTxnId: a.sourceTxnId,
      quantity: dstr(a.quantity),
      acquiredDate: a.acquiredDate,
      costAud: s(a.costAud),
      proceedsAud: s(a.proceedsAud),
      gainAud: s(a.gainAud),
      heldDays: a.heldDays,
      discountEligible: a.discountEligible
    })),
    flags: d.flags
  };
}

function derivOut(e: RealisedEvent): DerivEventOut {
  return {
    id: e.id,
    txnId: e.txnId,
    openTxnIds: e.openTxnIds,
    accountId: e.accountId,
    instrumentId: e.instrumentId,
    kind: e.kind,
    direction: e.direction,
    date: e.date,
    quantity: dstr(e.quantity),
    currency: e.currency,
    pnlNative: dstr(e.pnlNative),
    feesNative: dstr(e.feesNative),
    netAud: s(e.netAud),
    taxClass: e.taxClass,
    flags: e.flags
  };
}

/** CGT netting for one year (ATO method statement order: losses before discount). */
export function netCapitalGain(
  disc: Decimal,
  nonDisc: Decimal,
  currentLosses: Decimal,
  priorLosses: Decimal,
  discountRate: Decimal,
  ordering: 'non_discount_first' | 'discount_first'
): { net: Decimal; carryForward: Decimal; appliedCurrent: Decimal; appliedPrior: Decimal; discount: Decimal; steps: string[] } {
  const steps: string[] = [];
  let d = disc;
  let n = nonDisc;
  const apply = (losses: Decimal, label: string) => {
    let rem = losses;
    const order: ('n' | 'd')[] = ordering === 'non_discount_first' ? ['n', 'd'] : ['d', 'n'];
    for (const o of order) {
      if (rem.lte(0)) break;
      if (o === 'n') {
        const use = Decimal.min(rem, n);
        n = n.minus(use);
        rem = rem.minus(use);
        if (use.gt(0)) steps.push(`${label}: ${use.toFixed(2)} applied against non-discount gains.`);
      } else {
        const use = Decimal.min(rem, d);
        d = d.minus(use);
        rem = rem.minus(use);
        if (use.gt(0)) steps.push(`${label}: ${use.toFixed(2)} applied against discount-eligible gains.`);
      }
    }
    return rem;
  };
  steps.push(`Gross gains: discount-eligible ${disc.toFixed(2)}, other ${nonDisc.toFixed(2)}.`);
  const remCurrent = apply(currentLosses, 'Current-year capital losses');
  const remPrior = apply(priorLosses, 'Prior-year net capital losses');
  const discount = d.times(discountRate);
  if (discount.gt(0)) steps.push(`CGT discount ${discountRate.times(100).toFixed(0)}% on remaining discount-eligible gains ${d.toFixed(2)} = ${discount.toFixed(2)}.`);
  const net = d.minus(discount).plus(n);
  const cf = remCurrent.plus(remPrior);
  steps.push(`Net capital gain ${net.toFixed(2)}; net capital losses carried forward ${cf.toFixed(2)}.`);
  return { net, carryForward: cf, appliedCurrent: currentLosses.minus(remCurrent), appliedPrior: priorLosses.minus(remPrior), discount, steps };
}

interface YearCapital {
  disc: Decimal;
  nonDisc: Decimal;
  losses: Decimal;
  trust: Decimal;
  incomplete: boolean;
  disposals: Disposal[];
  derivCapital: RealisedEvent[];
  trustTxnIds: string[];
  withheld: Decimal;
}

function capitalInputsForYear(fy: FYear, lots: LotEngineResult, deriv: DerivativeResult, txns: Transaction[], discountAllowed: boolean): YearCapital {
  let disc = ZERO;
  let nonDisc = ZERO;
  let losses = ZERO;
  let trust = ZERO;
  let incomplete = false;
  let withheld = ZERO;
  const disposals = lots.disposals.filter((d) => d.fy === fy && d.taxClass === 'CGT_EVENT');
  for (const d of disposals) {
    if (d.gainAud === null) {
      incomplete = true;
      continue;
    }
    if (discountAllowed) disc = disc.plus(d.discountableGainAud);
    else {
      nonDisc = nonDisc.plus(d.discountableGainAud);
      withheld = withheld.plus(d.discountableGainAud);
    }
    nonDisc = nonDisc.plus(d.nonDiscountableGainAud);
    losses = losses.plus(d.lossAud);
  }
  const derivCapital = deriv.realised.filter((e) => e.fy === fy && e.taxClass === 'CGT_EVENT');
  for (const e of derivCapital) {
    if (e.netAud === null) {
      incomplete = true;
      continue;
    }
    if (e.netAud.gt(0)) nonDisc = nonDisc.plus(e.netAud);
    else losses = losses.plus(e.netAud.neg());
  }
  const trustTxnIds: string[] = [];
  for (const t of txns) {
    if (t.fy !== fy || t.status !== 'active' || !t.capitalGainComponent) continue;
    trust = trust.plus(D(t.capitalGainComponent));
    trustTxnIds.push(t.id);
  }
  nonDisc = nonDisc.plus(trust);
  return { disc, nonDisc, losses, trust, incomplete, disposals, derivCapital, trustTxnIds, withheld };
}

/** Effective tax class of a ledger record (splits handled separately). */
function effClass(t: Transaction): TaxClass {
  return t.taxClass ?? 'UNCLASSIFIED';
}

const INCOME_LINES: { key: string; label: string; classes: TaxClass[] }[] = [
  { key: 'salary', label: 'Salary and wages (gross)', classes: ['SALARY_WAGES'] },
  { key: 'allowances', label: 'Allowances, earnings, tips, bonuses', classes: ['ALLOWANCE_BONUS'] },
  { key: 'govt', label: 'Government payments (assessable)', classes: ['GOVERNMENT_PAYMENT'] },
  { key: 'interest', label: 'Gross interest', classes: ['INTEREST'] },
  { key: 'rent', label: 'Gross rent', classes: ['RENTAL_INCOME'] },
  { key: 'crypto_income', label: 'Crypto income (staking, rewards) at market value', classes: ['CRYPTO_INCOME'] },
  { key: 'other_income', label: 'Other ordinary income', classes: ['ORDINARY_INCOME'] }
];

export function computeTaxYear(input: TaxEngineInput): TaxYearResult {
  const { data, fy } = input;
  const now = input.now ?? new Date().toISOString();
  const rs = ruleSetFor(fy);
  const profile = input.taxProfiles.find((p) => p.fy === fy);
  const residency = profile?.residency ?? 'unknown';
  const issues: Issue[] = [];
  const assumptions: string[] = [];
  const reviewItems: TaxYearResult['reviewItems'] = [];
  const excluded: TaxYearResult['excluded'] = [];
  const catByCode = new Map(input.categories.map((c) => [`${c.type}:${c.code}`, c]));
  const txnsFY = data.transactions.filter((t) => t.status === 'active' && t.fy === fy);
  const lots = input.lotRun ?? runLotEngine(data, { taxTz: input.taxTz, costBasisDefaults: input.costBasisDefaults });
  const deriv = input.derivRun ?? runDerivativeEngine(data, { includeSimulated: true });
  const discountAllowed = residency === 'resident' || residency === 'part_year';
  const accountsById = new Map(data.accounts.map((a) => [a.id, a]));

  if (!rs) issues.push({ code: 'NO_RULES', severity: 'blocking', message: `No tax rule set is available for ${fyLabel(fy)} — tax cannot be estimated.`, txnIds: [] });
  else if (rs.status !== 'verified') issues.push({ code: 'RULES_NOT_VERIFIED', severity: 'warning', message: `Tax rule set ${rs.id} is ${rs.status.replace('_', ' ')} — ${rs.notes.join(' ')}`.trim(), txnIds: [] });
  if (!profile || residency === 'unknown') issues.push({ code: 'RESIDENCY_UNKNOWN', severity: 'blocking', message: 'Residency status for this year has not been recorded (Tax & Business → Tax profile).', txnIds: [] });
  if (residency === 'working_holiday' || residency === 'part_year') issues.push({ code: 'RESIDENCY_UNSUPPORTED', severity: 'blocking', message: `Residency "${residency}" requires rates/adjustments not implemented — tax estimate unavailable.`, txnIds: [] });
  if (residency === 'non_resident') issues.push({ code: 'NON_RESIDENT', severity: 'warning', message: 'Non-resident: no tax-free threshold, no LITO, no Medicare levy, and CGT discount generally unavailable; only taxable Australian property is subject to CGT — review CGT events.', txnIds: [] });

  // ---------- trading accounts whose tax treatment is undetermined ----------
  const unresolvedTrades = txnsFY.filter((t) => t.kind === 'trade' && t.accountId && accountsById.get(t.accountId)?.taxTreatment === 'unresolved' && !['evaluation', 'funded_simulated'].includes(accountsById.get(t.accountId)?.propStatus ?? ''));
  if (unresolvedTrades.length) {
    const names = [...new Set(unresolvedTrades.map((t) => accountsById.get(t.accountId!)!.name))];
    issues.push({ code: 'ACCOUNT_TREATMENT', severity: 'blocking', message: `Tax treatment (investor vs trader) not set for: ${names.join(', ')} — their results are excluded until classified.`, txnIds: unresolvedTrades.map((t) => t.id) });
  }

  // ---------- missing FX / classification checks ----------
  const missingFx = txnsFY.filter((t) => t.currency.toUpperCase() !== 'AUD' && !t.fx && !(t.kind === 'cash'));
  if (missingFx.length) issues.push({ code: 'MISSING_RATE', severity: 'blocking', message: `${missingFx.length} transaction(s) have no historical AUD exchange rate.`, txnIds: missingFx.map((t) => t.id) });

  const line = (key: string, label: string, amount: Decimal | null, status: LineStatus, sourceIds: string[], method?: string, notes?: string[]): TaxLine => ({
    key,
    label,
    amount: s(amount),
    status: amount === null ? 'incomplete' : status,
    sourceIds,
    method,
    notes
  });

  // ---------- Income ----------
  const income: TaxLine[] = [];
  let assessable: Decimal | null = ZERO;
  let taxWithheld = ZERO;
  const withheldIds: string[] = [];
  const incomeTxns = txnsFY.filter((t) => t.kind === 'income');
  for (const t of txnsFY) {
    if (t.taxWithheld && D(t.taxWithheld).gt(0)) {
      taxWithheld = taxWithheld.plus(D(t.taxWithheld));
      withheldIds.push(t.id);
    }
  }
  const incomeValue = (t: Transaction): Decimal | null => (t.instrumentId && t.valuationAud ? D(t.valuationAud) : audOf(t, t.amount));

  for (const def of INCOME_LINES) {
    const ts = incomeTxns.filter((t) => def.classes.includes(effClass(t)));
    if (!ts.length) continue;
    const total = ts.reduce<Decimal | null>((acc, t) => add(acc, incomeValue(t)), ZERO);
    income.push(line(def.key, def.label, total, 'recorded', ts.map((t) => t.id), 'Sum of gross amounts converted to AUD at each transaction’s recorded rate.'));
    assessable = add(assessable, total);
  }
  const etp = incomeTxns.filter((t) => effClass(t) === 'ETP');
  if (etp.length) {
    issues.push({ code: 'ETP_REVIEW', severity: 'warning', message: 'Employment termination payments are listed but not included in taxable income (concessional rules not implemented).', txnIds: etp.map((t) => t.id) });
    for (const t of etp) reviewItems.push({ id: t.id, txnId: t.id, label: t.description, amountAud: s(audOf(t, t.amount)), reason: 'ETP — use the ETP payment summary; specialist treatment.' });
  }

  // Dividends (Australian)
  const divs = incomeTxns.filter((t) => effClass(t) === 'DIVIDEND');
  if (divs.length) {
    let franked = ZERO;
    let unfranked: Decimal | null = ZERO;
    let credits = ZERO;
    const notes: string[] = [];
    for (const t of divs) {
      const total = audOf(t, t.amount);
      const f = tryD(t.frankedAmount);
      const u = tryD(t.unfrankedAmount);
      if (f || u) {
        franked = franked.plus(f ?? ZERO);
        unfranked = add(unfranked, u ?? ZERO);
      } else {
        unfranked = add(unfranked, total);
        if (t.frankingCredit && D(t.frankingCredit).gt(0)) notes.push(`${t.date} ${t.description}: franked/unfranked split missing — total treated as unfranked.`);
      }
      credits = credits.plus(D(t.frankingCredit));
    }
    const ids = divs.map((t) => t.id);
    income.push(line('div_unfranked', 'Unfranked dividends', unfranked, 'recorded', ids));
    income.push(line('div_franked', 'Franked dividends', franked, 'recorded', ids));
    income.push(line('franking_credits', 'Franking credits (gross-up, assessable)', credits, 'recorded', ids, 'Franking credits are included in assessable income and claimed as a refundable offset (holding-period rule not tested — review for >$5,000 credits).', notes));
    assessable = add(add(add(assessable, unfranked), franked), credits);
  }
  // Trust distributions
  const dists = incomeTxns.filter((t) => effClass(t) === 'TRUST_DISTRIBUTION');
  if (dists.length) {
    let ordinary: Decimal | null = ZERO;
    let credits = ZERO;
    for (const t of dists) {
      const total = audOf(t, t.amount);
      const deferred = audOf(t, t.taxDeferredAmount);
      const cg = tryD(t.capitalGainComponent) ?? ZERO;
      const ord = total === null || deferred === null ? null : total.minus(deferred).minus(cg);
      ordinary = add(ordinary, ord);
      credits = credits.plus(D(t.frankingCredit));
    }
    income.push(line('trust_dist', 'Trust / managed-fund distributions (excluding tax-deferred & capital gains)', ordinary, 'estimate', dists.map((t) => t.id), 'Cash distribution − tax-deferred component − capital-gain component.', ['Use the annual tax statement (AMMA) components; this is an approximation of item 13.']));
    if (credits.gt(0)) income.push(line('trust_franking', 'Franking credits from trusts', credits, 'recorded', dists.map((t) => t.id)));
    assessable = add(add(assessable, ordinary), credits);
  }

  // Foreign income
  const foreign: TaxLine[] = [];
  const fIncome = incomeTxns.filter((t) => effClass(t) === 'FOREIGN_INCOME');
  let foreignTax: Decimal | null = ZERO;
  const ftIds: string[] = [];
  for (const t of txnsFY) {
    if (t.foreignTaxPaid && D(t.foreignTaxPaid).gt(0)) {
      foreignTax = add(foreignTax, audOf(t, t.foreignTaxPaid));
      ftIds.push(t.id);
    }
  }
  if (fIncome.length) {
    const total = fIncome.reduce<Decimal | null>((acc, t) => add(acc, audOf(t, t.amount)), ZERO);
    foreign.push(line('foreign_income', 'Assessable foreign income (gross, before foreign tax)', total, 'recorded', fIncome.map((t) => t.id), 'Gross foreign amounts × historical AUD rate per transaction.'));
    assessable = add(assessable, total);
  }
  if (ftIds.length) foreign.push(line('foreign_tax', 'Foreign tax paid (AUD)', foreignTax, 'recorded', ftIds));

  // Review / unclassified income
  for (const t of incomeTxns) {
    const c = effClass(t);
    if (c === 'REVIEW' || c === 'UNCLASSIFIED') reviewItems.push({ id: t.id, txnId: t.id, label: `${t.date} ${t.description}`, amountAud: s(incomeValue(t)), reason: c === 'UNCLASSIFIED' ? 'Income not classified.' : TAX_CLASS_INFO.REVIEW.help });
    if (c === 'NON_ASSESSABLE' || c === 'NON_TAXABLE' || c === 'TAX_DEFERRED') excluded.push({ txnId: t.id, reason: TAX_CLASS_INFO[c].label });
  }

  // ---------- Business ----------
  const business: TaxLine[] = [];
  const bIncome = incomeTxns.filter((t) => effClass(t) === 'BUSINESS_INCOME');
  const gstReg = !!input.business?.gstRegistered;
  const exGst = (t: Transaction): Decimal | null => {
    const a = audOf(t, t.amount);
    if (a === null) return null;
    if (gstReg && t.isBusiness && t.gstTreatment === 'taxable' && t.gstAmount) {
      const g = audOf(t, t.gstAmount);
      return g === null ? null : a.minus(g);
    }
    return a;
  };
  const bIncomeTotal = bIncome.reduce<Decimal | null>((acc, t) => add(acc, exGst(t)), ZERO);

  // ---------- Deductions (expenses, fees, splits) ----------
  const deductions: TaxLine[] = [];
  type Ded = { txnId: string; cls: TaxClass; amount: Decimal | null; category: string };
  const deds: Ded[] = [];
  for (const t of txnsFY.filter((x) => x.kind === 'expense' || x.kind === 'fee')) {
    if (t.splits?.length) {
      for (const sp of t.splits) {
        const cls = sp.taxClass ?? catByCode.get(`expense:${sp.category}`)?.defaultTaxClass ?? 'UNCLASSIFIED';
        const pct = D(sp.businessUsePct ?? t.businessUsePct ?? '100').div(100);
        const a = audOf(t, sp.amount);
        deds.push({ txnId: t.id, cls, amount: a === null ? null : a.times(pct), category: sp.category });
      }
      continue;
    }
    const cls = effClass(t);
    const pct = D(t.businessUsePct ?? '100').div(100);
    const a = exGst(t);
    deds.push({ txnId: t.id, cls, amount: a === null ? null : a.times(pct), category: t.category });
  }
  const dedGroups: { key: string; label: string; cls: TaxClass; status: LineStatus; note?: string }[] = [
    { key: 'ded_personal', label: 'Potentially deductible expenses (work-related, investment, other)', cls: 'DEDUCTIBLE_EXPENSE', status: 'recorded', note: 'Subject to substantiation and nexus — agent to confirm.' },
    { key: 'ded_financing', label: 'Interest / financing expenses', cls: 'FINANCING_EXPENSE', status: 'estimate', note: 'Deductible only to the extent incurred in earning assessable income.' }
  ];
  let totalDeductions: Decimal | null = ZERO;
  for (const g of dedGroups) {
    const items = deds.filter((d) => d.cls === g.cls);
    if (!items.length) continue;
    const total = items.reduce<Decimal | null>((acc, d) => add(acc, d.amount), ZERO);
    deductions.push(line(g.key, g.label, total, g.status, [...new Set(items.map((d) => d.txnId))], 'Σ AUD amount × business/deductible-use %.', g.note ? [g.note] : undefined));
    totalDeductions = add(totalDeductions, total);
  }
  // per-category breakdown for the report
  const byCat = new Map<string, { total: Decimal | null; ids: string[] }>();
  for (const d of deds.filter((x) => x.cls === 'DEDUCTIBLE_EXPENSE')) {
    const e = byCat.get(d.category) ?? { total: ZERO, ids: [] };
    e.total = add(e.total, d.amount);
    e.ids.push(d.txnId);
    byCat.set(d.category, e);
  }
  for (const [cat, e] of byCat) {
    deductions.push(line(`ded_cat_${cat}`, `  · ${catByCode.get(`expense:${cat}`)?.name ?? cat}`, e.total, 'recorded', e.ids));
  }
  for (const d of deds) {
    if (d.cls === 'REVIEW' || d.cls === 'UNCLASSIFIED') {
      const t = txnsFY.find((x) => x.id === d.txnId)!;
      reviewItems.push({ id: `${d.txnId}:${d.category}`, txnId: d.txnId, label: `${t.date} ${t.description}`, amountAud: s(d.amount), reason: catByCode.get(`expense:${d.category}`)?.guidance ?? 'Expense deductibility not determined.' });
    }
    if (d.cls === 'NON_DEDUCTIBLE' || d.cls === 'COST_BASE_INCLUDED') excluded.push({ txnId: d.txnId, reason: TAX_CLASS_INFO[d.cls].label });
  }

  const bExp = deds.filter((d) => d.cls === 'BUSINESS_EXPENSE');
  const bExpTotal = bExp.reduce<Decimal | null>((acc, d) => add(acc, d.amount), ZERO);
  // Depreciation
  const depreciation: TaxYearResult['depreciation'] = [];
  let depTotal = ZERO;
  for (const a of input.assets) {
    const sch = depreciationSchedule(a, fy);
    const y = sch.years.find((x) => x.fy === fy);
    if (!y) continue;
    depreciation.push({
      assetId: a.id,
      name: a.name,
      opening: dstr(y.openingValue),
      decline: dstr(y.decline),
      deductible: dstr(y.deductible),
      closing: dstr(y.closingValue),
      balancingAdjustment: y.balancingAdjustment ? dstr(y.balancingAdjustment) : null,
      flags: [...sch.flags, ...y.flags]
    });
    depTotal = depTotal.plus(y.deductible);
    if (y.flags.length) issues.push({ code: 'DEPRECIATION_REVIEW', severity: 'warning', message: `${a.name}: ${y.flags.join(' ')}`, txnIds: [] });
  }
  if (bIncome.length || bExp.length || depreciation.length) {
    business.push(line('bus_income', 'Business income (GST-exclusive where registered)', bIncomeTotal, 'recorded', bIncome.map((t) => t.id)));
    business.push(line('bus_expenses', 'Business expenses (net of private use)', bExpTotal, 'recorded', [...new Set(bExp.map((d) => d.txnId))]));
    business.push(line('bus_depreciation', 'Depreciation / capital allowances (business portion)', depTotal, 'calculated', depreciation.map((d) => d.assetId), 'See asset depreciation schedule.'));
    const net = bIncomeTotal === null || bExpTotal === null ? null : bIncomeTotal.minus(bExpTotal).minus(depTotal);
    business.push(line('bus_net', 'Net business income / (loss)', net, 'calculated', [], 'Income − expenses − depreciation.'));
    if (net !== null && net.lt(0)) issues.push({ code: 'BUSINESS_LOSS', severity: 'warning', message: 'Net business loss — non-commercial loss rules (Div 35) may defer the loss. Not tested by this application.', txnIds: [] });
    assessable = add(assessable, net);
  }

  // ---------- Revenue trading (trader / profit-making accounts) ----------
  const revenueTrading: TaxLine[] = [];
  const revDisposals = lots.disposals.filter((d) => d.fy === fy && d.taxClass === 'REVENUE_TRADING');
  const revDeriv = deriv.realised.filter((e) => e.fy === fy && e.taxClass === 'REVENUE_TRADING');
  if (revDisposals.length || revDeriv.length) {
    const lotsNet = revDisposals.reduce<Decimal | null>((acc, d) => add(acc, d.gainAud), ZERO);
    const derivNet = revDeriv.reduce<Decimal | null>((acc, e) => add(acc, e.netAud), ZERO);
    revenueTrading.push(line('rev_lots', 'Realised gains/(losses) on shares, crypto etc. held on revenue account', lotsNet, 'calculated', revDisposals.map((d) => d.txnId), 'Proceeds − cost (incl. fees), lots matched per selected method; no CGT discount.'));
    revenueTrading.push(line('rev_deriv', 'Realised futures / CFD / forex / options results (net of fees and financing)', derivNet, 'calculated', revDeriv.map((e) => e.txnId), 'Matched positions converted at closing-date rates; statement P&L rows as recorded.'));
    const net = add(lotsNet, derivNet);
    revenueTrading.push(line('rev_net', 'Net revenue trading result', net, 'calculated', []));
    assessable = add(assessable, net);
    if (net !== null && net.lt(0)) issues.push({ code: 'REVENUE_LOSS', severity: 'warning', message: 'Net revenue trading loss — deductibility depends on business status and non-commercial loss rules.', txnIds: [] });
    if (revDisposals.some((d) => accountsById.get(d.accountId ?? '')?.taxTreatment === 'business_trader')) {
      issues.push({ code: 'TRADING_STOCK', severity: 'info', message: 'Shares/crypto held by a share trader may be trading stock: closing-stock valuation (Div 70) on open positions is not calculated.', txnIds: [] });
    }
  }

  // Review items from trading
  for (const d of lots.disposals.filter((x) => x.fy === fy && x.taxClass === 'REVIEW')) {
    reviewItems.push({ id: d.id, txnId: d.txnId, label: `${d.disposedDate} disposal (${d.kind})`, amountAud: s(d.gainAud), reason: d.flags.join(' ') || 'Treatment requires review.' });
  }
  for (const e of deriv.realised.filter((x) => x.fy === fy && (x.taxClass === 'REVIEW' || x.taxClass === 'FINANCING_EXPENSE'))) {
    reviewItems.push({ id: e.id, txnId: e.txnId, label: `${e.date} ${e.kind.replace(/_/g, ' ')}`, amountAud: s(e.netAud), reason: e.flags.join(' ') });
  }
  for (const e of deriv.realised.filter((x) => x.fy === fy && x.taxClass === 'SIMULATED')) excluded.push({ txnId: e.txnId, reason: 'Simulated prop-firm trading' });
  for (const id of lots.excludedSimulated) {
    const t = data.transactions.find((x) => x.id === id);
    if (t?.fy === fy) excluded.push({ txnId: id, reason: 'Simulated prop-firm trading' });
  }

  // ---------- Capital gains (with prior-year chain) ----------
  const allFys = new Set<number>([...lots.disposals.map((d) => d.fy), ...deriv.realised.map((e) => e.fy), ...data.transactions.filter((t) => t.capitalGainComponent).map((t) => t.fy)]);
  const firstFy = Math.min(fy, ...[...allFys]);
  let carried = ZERO;
  let ny: ReturnType<typeof netCapitalGain> | null = null;
  let thisYear: YearCapital | null = null;
  let priorAvailable = ZERO;
  let chainIncomplete = false;
  for (let y = firstFy; y <= fy; y++) {
    const p = input.taxProfiles.find((x) => x.fy === y);
    const opening = p?.openingCapitalLosses ? D(p.openingCapitalLosses) : null;
    const available = opening !== null ? opening : carried;
    const resY = p?.residency ?? 'unknown';
    const yc = capitalInputsForYear(y, lots, deriv, data.transactions, resY === 'resident' || resY === 'part_year' || (resY === 'unknown' && y !== fy));
    if (y < fy && yc.incomplete) chainIncomplete = true;
    const r = netCapitalGain(yc.disc, yc.nonDisc, yc.losses, available, D(ruleSetFor(y)?.cgtDiscountIndividual ?? '0.5'), input.lossOrdering);
    carried = r.carryForward;
    if (y === fy) {
      ny = r;
      thisYear = yc;
      priorAvailable = available;
    }
  }
  const yc = thisYear!;
  const cgt = ny!;
  if (!discountAllowed && yc.withheld.gt(0)) issues.push({ code: 'DISCOUNT_WITHHELD', severity: 'warning', message: 'CGT discount not applied because residency is not "resident" for this year.', txnIds: [] });
  if (chainIncomplete) issues.push({ code: 'PRIOR_YEAR_CGT_INCOMPLETE', severity: 'warning', message: 'An earlier year has incomplete CGT calculations, so carried-forward losses may be misstated.', txnIds: [] });
  const capital: CapitalSummary = {
    currentYearGainsGross: dstr(yc.disc.plus(yc.nonDisc)),
    discountableGains: dstr(yc.disc),
    nonDiscountableGains: dstr(yc.nonDisc),
    trustCapitalGains: dstr(yc.trust),
    currentYearLosses: dstr(yc.losses),
    priorYearLossesAvailable: dstr(priorAvailable),
    lossesAppliedCurrent: dstr(cgt.appliedCurrent),
    lossesAppliedPrior: dstr(cgt.appliedPrior),
    discountRate: rs?.cgtDiscountIndividual ?? '0.5',
    discountApplied: dstr(cgt.discount),
    netCapitalGain: dstr(cgt.net),
    lossesCarriedForward: dstr(cgt.carryForward),
    lossOrdering: input.lossOrdering === 'non_discount_first' ? 'Losses applied to non-discount gains first' : 'Losses applied to discount gains first',
    incomplete: yc.incomplete,
    steps: cgt.steps
  };
  if (yc.trust.gt(0)) issues.push({ code: 'TRUST_CG', severity: 'warning', message: 'Trust capital-gain components were treated as non-discount gross gains — confirm discount/indexation/other components from the AMMA statement.', txnIds: yc.trustTxnIds });
  const cgtIds = [...yc.disposals.map((d) => d.txnId), ...yc.derivCapital.map((e) => e.txnId), ...yc.trustTxnIds];
  const capitalLines: TaxLine[] = [
    line('cgt_gross', 'Total current-year capital gains (gross)', yc.disc.plus(yc.nonDisc), 'calculated', cgtIds),
    line('cgt_losses', 'Current-year capital losses', yc.losses, 'calculated', cgtIds),
    line('cgt_prior', 'Net capital losses from earlier years available', priorAvailable, profile?.openingCapitalLosses ? 'recorded' : 'calculated', []),
    line('cgt_discount', 'CGT discount applied', cgt.discount, 'calculated', []),
    line('cgt_net', 'Net capital gain', yc.incomplete ? null : cgt.net, 'calculated', cgtIds, cgt.steps.join(' ')),
    line('cgt_cf', 'Net capital losses carried forward', yc.incomplete ? null : cgt.carryForward, 'calculated', [])
  ];
  if (yc.incomplete) issues.push({ code: 'CGT_INCOMPLETE', severity: 'blocking', message: 'Some CGT events have missing cost bases or exchange rates — net capital gain cannot be finalised.', txnIds: yc.disposals.filter((d) => d.gainAud === null).map((d) => d.txnId) });
  assessable = add(assessable, yc.incomplete ? null : cgt.net);

  // ---------- Lot engine & derivative issues relevant to the year ----------
  const fyTxnIds = new Set(txnsFY.map((t) => t.id));
  const grouped = new Map<string, string[]>();
  for (const i of [...lots.issues, ...deriv.issues]) {
    if (i.txnId && !fyTxnIds.has(i.txnId)) continue;
    const arr = grouped.get(i.code) ?? [];
    if (i.txnId) arr.push(i.txnId);
    grouped.set(i.code, arr);
  }
  for (const [code, ids] of grouped) {
    const sev: Issue['severity'] = code === 'MISSING_COST_BASE' || code === 'MISSING_RATE' ? 'blocking' : code.startsWith('REVIEW') || code === 'UNMATCHED_TRANSFER' || code === 'POSSIBLE_DOUBLE_COUNT' ? 'warning' : 'info';
    const sample = [...lots.issues, ...deriv.issues].find((i) => i.code === code)!;
    issues.push({ code, severity: sev, message: ids.length > 1 ? `${sample.message} (+${ids.length - 1} similar)` : sample.message, txnIds: ids });
  }

  // ---------- Taxable income & estimate ----------
  const offsetsAndCredits: TaxLine[] = [];
  const estimate: TaxLine[] = [];
  const totalIncome = assessable;
  const ti = totalIncome === null || totalDeductions === null ? null : toWholeDollarsDown(Decimal.max(ZERO, totalIncome.minus(totalDeductions)));
  const rawTi = totalIncome === null || totalDeductions === null ? null : totalIncome.minus(totalDeductions);
  if (rawTi !== null && rawTi.lt(0)) issues.push({ code: 'TAX_LOSS', severity: 'warning', message: 'Deductions exceed assessable income — a tax loss may arise (carry-forward of revenue losses not computed).', txnIds: [] });

  const frankingCredits = txnsFY.filter((t) => t.kind === 'income').reduce((acc, t) => acc.plus(D(t.frankingCredit)), ZERO);
  const fitoClaim = foreignTax === null ? null : Decimal.min(foreignTax, new Decimal(rs?.fitoDeMinimis ?? 1000));
  if (foreignTax !== null && foreignTax.gt(rs?.fitoDeMinimis ?? 1000)) issues.push({ code: 'FITO_LIMIT', severity: 'warning', message: `Foreign tax paid exceeds $${rs?.fitoDeMinimis ?? 1000}: offset limited to the de minimis amount pending a FITO limit calculation.`, txnIds: ftIds });
  const instalments = D(profile?.paygInstalments);
  const otherOffsets = D(profile?.otherOffsets);

  let estimateStatus: TaxYearResult['estimateStatus'] = 'estimate';
  const blocking = issues.filter((i) => i.severity === 'blocking');
  if (!rs || residency === 'unknown' || residency === 'working_holiday' || residency === 'part_year') estimateStatus = 'not_available';
  else if (ti === null || blocking.length) estimateStatus = 'incomplete';

  estimate.push(line('total_income', 'Total assessable income', totalIncome, 'calculated', []));
  estimate.push(line('total_deductions', 'Total deductions claimed', totalDeductions, 'calculated', []));
  estimate.push(line('taxable_income', 'Estimated taxable income (whole dollars)', ti, blocking.length ? 'incomplete' : 'estimate', [], 'Assessable income − deductions, cents ignored.'));

  let netPayable: Decimal | null = null;
  if (estimateStatus !== 'not_available' && rs && ti !== null) {
    const resident = residency === 'resident';
    const brackets = resident ? rs.residentBrackets : rs.nonResidentBrackets;
    if (!brackets) {
      estimateStatus = 'not_available';
    } else {
      const gross = taxOnBrackets(ti, brackets);
      const lito = resident ? Decimal.min(litoAmount(ti, rs), gross) : ZERO;
      const ml = resident
        ? profile?.medicareExemption === 'unknown'
          ? { levy: null as Decimal | null, note: 'Medicare levy exemption status unknown.', reliable: false }
          : medicareLevy(ti, rs, profile?.medicareExemption ?? 'none')
        : { levy: ZERO, note: 'Non-residents do not pay the Medicare levy.', reliable: true };
      if (!ml.reliable) issues.push({ code: 'MEDICARE_ESTIMATE', severity: 'warning', message: `Medicare levy: ${ml.note}`, txnIds: [] });
      estimate.push(line('gross_tax', 'Tax on taxable income', gross, 'estimate', [], `${resident ? 'Resident' : 'Non-resident'} rates, rule set ${rs.id}.`));
      if (resident) estimate.push(line('lito', 'Less: low income tax offset', lito, 'estimate', [], 'LITO (non-refundable, limited to tax payable).'));
      estimate.push(line('medicare', 'Medicare levy', ml.levy, ml.reliable ? 'estimate' : 'review', [], ml.note));
      const afterNonRef = Decimal.max(ZERO, gross.minus(lito).minus(fitoClaim ?? ZERO).minus(otherOffsets));
      offsetsAndCredits.push(line('franking_offset', 'Franking credit offset (refundable)', frankingCredits, 'recorded', txnsFY.filter((t) => t.frankingCredit).map((t) => t.id)));
      offsetsAndCredits.push(line('fito', 'Foreign income tax offset (claimed)', fitoClaim, 'estimate', ftIds));
      offsetsAndCredits.push(line('payg_withheld', 'PAYG tax withheld', taxWithheld, 'recorded', withheldIds));
      if (instalments.gt(0)) offsetsAndCredits.push(line('payg_instalments', 'PAYG instalments paid', instalments, 'recorded', []));
      if (otherOffsets.gt(0)) offsetsAndCredits.push(line('other_offsets', `Other offsets (user-entered${profile?.otherOffsetsNote ? ': ' + profile.otherOffsetsNote : ''})`, otherOffsets, 'recorded', []));
      netPayable = ml.levy === null ? null : afterNonRef.plus(ml.levy).minus(frankingCredits).minus(taxWithheld).minus(instalments);
      estimate.push(line('net_payable', 'Estimated tax payable / (refund)', netPayable, estimateStatus === 'incomplete' ? 'incomplete' : 'estimate', [], 'Tax − LITO − FITO − other offsets + Medicare − franking credits − PAYG withheld − instalments.'));
    }
  }
  if (profile?.helpDebt !== 'no') issues.push({ code: 'HELP_NOT_COMPUTED', severity: profile?.helpDebt === 'yes' ? 'warning' : 'info', message: 'HELP/study-loan repayments are not calculated.', txnIds: [] });
  if (profile?.privateHospitalCover !== 'yes' && residency === 'resident') issues.push({ code: 'MLS_NOT_COMPUTED', severity: 'info', message: 'Medicare levy surcharge is not calculated — confirm private hospital cover and income for MLS purposes.', txnIds: [] });
  if (reviewItems.length) issues.push({ code: 'REVIEW_ITEMS', severity: 'warning', message: `${reviewItems.length} item(s) await classification or specialist review and are excluded from totals.`, txnIds: [...new Set(reviewItems.map((r) => r.txnId))] });
  const unclassified = txnsFY.filter((t) => t.taxClass === 'UNCLASSIFIED');
  if (unclassified.length) issues.push({ code: 'UNCLASSIFIED', severity: 'blocking', message: `${unclassified.length} transaction(s) are unclassified.`, txnIds: unclassified.map((t) => t.id) });

  assumptions.push(
    'Amounts are AUD, converted per transaction at the recorded historical rate; original amounts are retained.',
    'Taxable income uses singles thresholds; family/spouse adjustments are not applied.',
    `Capital losses ordering: ${capital.lossOrdering.toLowerCase()}.`,
    'CGT discount (50%) only for capital-account assets held at least 12 months (excluding acquisition and disposal days) by a resident individual.',
    'Brokerage on CGT assets is included in the cost base or reduces proceeds — it is not separately deducted.'
  );

  const bas = basSummary(data.transactions, fy, input.business);
  const finalBlocking = issues.filter((i) => i.severity === 'blocking').map((i) => i.message);
  const warnings = issues.filter((i) => i.severity === 'warning').map((i) => i.message);
  const readiness = {
    status: finalBlocking.length ? ('incomplete' as const) : warnings.length || reviewItems.length ? ('needs_attention' as const) : ('ready_for_agent_review' as const),
    blocking: finalBlocking,
    warnings
  };

  const totals: Record<string, string | null> = {
    assessableIncome: s(totalIncome),
    deductions: s(totalDeductions),
    taxableIncome: s(ti),
    netCapitalGain: yc.incomplete ? null : dstr(cgt.net),
    capitalLossesCarriedForward: yc.incomplete ? null : dstr(cgt.carryForward),
    frankingCredits: dstr(frankingCredits),
    taxWithheld: dstr(taxWithheld),
    foreignTaxPaid: s(foreignTax),
    netPayable: s(netPayable),
    businessIncome: s(bIncomeTotal),
    businessExpenses: s(bExpTotal)
  };

  return {
    fy,
    fyLabel: fyLabel(fy),
    ruleSetId: rs?.id ?? null,
    ruleStatus: rs?.status ?? 'none',
    generatedAt: now,
    residency,
    income,
    deductions,
    business,
    revenueTrading,
    capital,
    capitalLines,
    foreign,
    offsetsAndCredits,
    estimate,
    estimateStatus,
    reviewItems,
    excluded,
    issues,
    readiness,
    disposals: lots.disposals.filter((d) => d.fy === fy).map(disposalOut),
    derivativeEvents: deriv.realised.filter((e) => e.fy === fy).map(derivOut),
    depreciation,
    bas: {
      periods: bas.periods.map((p) => ({
        label: p.label,
        start: p.start,
        end: p.end,
        txnIds: p.txnIds,
        reviewTxnIds: p.reviewTxnIds,
        missingRateTxnIds: p.missingRateTxnIds,
        g1: dstr(p.g1TotalSalesAud),
        gstFree: dstr(p.gstFreeSalesAud),
        a1: dstr(p.gstOnSalesAud),
        b1: dstr(p.gstOnPurchasesAud),
        net: dstr(p.netGstAud)
      })),
      notes: bas.notes
    },
    totals,
    assumptions
  };
}
