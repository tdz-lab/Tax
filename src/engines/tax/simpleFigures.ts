/**
 * Plain-language figures for simple mode and the short "My tax return figures" report. Pure functions
 * over the tax-year result — no new calculations. Return question numbers are given only where they were
 * read in an official source (ATO CGT guide 2025: question 18 labels H, A, V and question 13; ATO
 * franking page: question 11 Dividends; M1 / M2 Medicare questions).
 */
import { D, Decimal } from '../../lib/decimal';
import type { TaxLine, TaxYearResult } from './taxEngine';

export interface FigureRow {
  label: string;
  amount: string | null | undefined;
  /** Where it goes in the return, in plain words. */
  where?: string;
  strong?: boolean;
}
export interface FigureGroup {
  title: string;
  rows: FigureRow[];
}

const lineAmt = (ls: TaxLine[], key: string): string | null | undefined => {
  const l = ls.find((x) => x.key === key);
  return l ? l.amount : undefined;
};
const sum = (vals: (string | null | undefined)[]): string | null => {
  let t = new Decimal(0);
  for (const v of vals) {
    if (v === undefined) continue;
    if (v === null) return null;
    t = t.plus(D(v));
  }
  return t.toString();
};

/** The four headline numbers on the home screen. */
export function headline(r: TaxYearResult) {
  const incomeKeys = ['salary', 'allowances', 'govt', 'interest', 'rent', 'crypto_income', 'other_income', 'div_unfranked', 'div_franked', 'trust_dist', 'foreign_income'];
  const moneyIn = sum([...incomeKeys.map((k) => lineAmt(r.income, k) ?? lineAmt(r.foreign, k)), lineAmt(r.business, 'bus_income')]);
  const moneyOut = sum([r.totals.deductions ?? null, lineAmt(r.business, 'bus_expenses')]);
  const c = r.capital;
  const trading = c.incomplete ? null : sum([D(c.currentYearGainsGross).minus(c.currentYearLosses).toString(), lineAmt(r.revenueTrading, 'rev_net')]);
  const net = r.estimate.find((l) => l.key === 'net_payable');
  return { moneyIn, moneyOut, trading, netPayable: net ? net.amount : undefined, estimateStatus: r.estimateStatus };
}

export function returnFigures(r: TaxYearResult): FigureGroup[] {
  const groups: FigureGroup[] = [];
  const push = (title: string, rows: FigureRow[]) => {
    const kept = rows.filter((x) => x.amount !== undefined && !(x.amount !== null && D(x.amount).isZero() && !x.strong));
    if (kept.some((x) => x.amount === null || !D(x.amount!).isZero())) groups.push({ title, rows: kept });
  };
  const I = (k: string) => lineAmt(r.income, k);
  push('Work and personal income', [
    { label: 'Salary and wages', amount: I('salary'), where: 'Salary and wages' },
    { label: 'Allowances, bonuses, tips', amount: I('allowances'), where: 'Allowances and earnings' },
    { label: 'Government payments', amount: I('govt'), where: 'Government payments' },
    { label: 'Interest', amount: I('interest'), where: 'Interest' },
    { label: 'Rent received', amount: I('rent'), where: 'Rent (rental schedule)' },
    { label: 'Crypto rewards / staking income', amount: I('crypto_income'), where: 'Other income' },
    { label: 'Other income', amount: I('other_income'), where: 'Other income' }
  ]);
  push('Dividends (question 11)', [
    { label: 'Unfranked amount', amount: I('div_unfranked'), where: 'Question 11 Dividends' },
    { label: 'Franked amount', amount: I('div_franked'), where: 'Question 11 Dividends' },
    { label: 'Franking credits', amount: I('franking_credits'), where: 'Question 11 Dividends' }
  ]);
  push('Managed funds and trusts (question 13)', [
    { label: 'Trust / fund distributions (excluding capital gains)', amount: I('trust_dist'), where: 'Question 13 Partnerships and trusts — use your fund’s tax statement' },
    { label: 'Franking credits from trusts', amount: I('trust_franking'), where: 'Question 13 Partnerships and trusts' }
  ]);
  push('Foreign income', [
    { label: 'Foreign income (before foreign tax)', amount: lineAmt(r.foreign, 'foreign_income'), where: 'Foreign source income' },
    { label: 'Foreign tax paid', amount: lineAmt(r.foreign, 'foreign_tax'), where: 'Foreign source income' },
    { label: 'Foreign income tax offset claimed', amount: lineAmt(r.offsetsAndCredits, 'fito'), where: 'Foreign income tax offset' }
  ]);
  const c = r.capital;
  push('Capital gains — shares, crypto, funds (question 18)', [
    { label: 'Total current-year capital gains', amount: c.incomplete ? null : c.currentYearGainsGross, where: 'Question 18, label H', strong: true },
    { label: 'Net capital gain', amount: c.incomplete ? null : c.netCapitalGain, where: 'Question 18, label A', strong: true },
    { label: 'Net capital losses carried forward to later years', amount: c.incomplete ? null : c.lossesCarriedForward, where: 'Question 18, label V' }
  ]);
  push('Trading treated as business income', [{ label: 'Net trading result (revenue account)', amount: lineAmt(r.revenueTrading, 'rev_net'), where: 'Business / other income — ask your accountant where it goes' }]);
  push('Side projects and business', [
    { label: 'Income', amount: lineAmt(r.business, 'bus_income'), where: 'Business and professional items' },
    { label: 'Expenses', amount: lineAmt(r.business, 'bus_expenses'), where: 'Business and professional items' },
    ...r.business.filter((l) => l.key.startsWith('bus_cat_')).map((l) => ({ label: `   ${l.label.replace(/^\s*·\s*/, '')}`, amount: l.amount, where: 'Part of expenses' })),
    { label: 'Depreciation', amount: lineAmt(r.business, 'bus_depreciation'), where: 'Business and professional items' },
    { label: 'Net profit / (loss)', amount: lineAmt(r.business, 'bus_net'), where: 'Business and professional items', strong: true }
  ]);
  push('Deductions', [
    ...r.deductions.filter((l) => l.key.startsWith('ded_cat_')).map((l) => ({ label: l.label.replace(/^\s*·\s*/, ''), amount: l.amount, where: 'Deductions' })),
    { label: 'Interest / financing expenses', amount: lineAmt(r.deductions, 'ded_financing'), where: 'Deductions' },
    { label: 'Total deductions', amount: r.totals.deductions ?? null, strong: true }
  ]);
  const E = (k: string) => lineAmt(r.estimate, k);
  push('Estimate (the ATO works out the real figure)', [
    { label: 'Taxable income', amount: E('taxable_income'), strong: true },
    { label: 'Tax on taxable income', amount: E('gross_tax') },
    { label: 'Low income tax offset', amount: E('lito') },
    { label: 'Medicare levy', amount: E('medicare'), where: 'Question M1' },
    { label: 'Medicare levy surcharge', amount: E('mls'), where: 'Question M2' },
    { label: 'Study-loan repayment', amount: E('help') },
    { label: 'Franking credit refund', amount: lineAmt(r.offsetsAndCredits, 'franking_offset') },
    { label: 'Tax already withheld (PAYG)', amount: lineAmt(r.offsetsAndCredits, 'payg_withheld') },
    { label: 'Estimated refund (–) or amount to pay', amount: E('net_payable'), strong: true }
  ]);
  return groups;
}
