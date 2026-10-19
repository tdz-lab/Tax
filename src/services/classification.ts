/**
 * Rule-based tax classification. User-defined rules (ordered) are evaluated first; then defaults
 * derived from the account's declared tax treatment, the category, and the transaction type.
 * A classification explicitly set by the user (taxClassSource 'user') is never overwritten.
 */
import { DERIVATIVE_CLASSES } from '../domain/reference';
import type { Account, AssetClass, Category, Instrument, Side, TaxClass, TaxClassSource, Transaction, TxnKind } from '../domain/types';

export interface ClassificationRule {
  id: string;
  name: string;
  enabled: boolean;
  match: { kind?: TxnKind; side?: Side; assetClass?: AssetClass; accountId?: string; category?: string; fyFrom?: number; fyTo?: number; descriptionContains?: string };
  taxClass: TaxClass;
  note?: string;
}

export function ruleMatches(r: ClassificationRule, t: Partial<Transaction>, inst?: Instrument): boolean {
  if (!r.enabled) return false;
  const m = r.match;
  if (m.kind && t.kind !== m.kind) return false;
  if (m.side && t.side !== m.side) return false;
  if (m.assetClass && inst?.assetClass !== m.assetClass) return false;
  if (m.accountId && t.accountId !== m.accountId) return false;
  if (m.category && t.category !== m.category) return false;
  if (m.fyFrom && (t.fy ?? 0) < m.fyFrom) return false;
  if (m.fyTo && (t.fy ?? 99999) > m.fyTo) return false;
  if (m.descriptionContains && !(t.description ?? '').toLowerCase().includes(m.descriptionContains.toLowerCase())) return false;
  return true;
}

export function classify(
  t: Partial<Transaction>,
  ctx: { account?: Account; instrument?: Instrument; category?: Category; rules: ClassificationRule[] }
): { taxClass: TaxClass; source: TaxClassSource; reason: string } {
  for (const r of ctx.rules) {
    if (ruleMatches(r, t, ctx.instrument)) return { taxClass: r.taxClass, source: 'rule', reason: `Rule: ${r.name}` };
  }
  const a = ctx.account;
  const simulated = a && (a.propStatus === 'evaluation' || a.propStatus === 'funded_simulated');
  switch (t.kind) {
    case 'cash':
      return { taxClass: 'NON_TAXABLE', source: 'default', reason: 'Deposits/withdrawals are not taxable events.' };
    case 'transfer':
      return { taxClass: 'TRANSFER_NO_DISPOSAL', source: 'default', reason: 'Movement between own accounts.' };
    case 'adjustment':
      return { taxClass: 'REVIEW', source: 'default', reason: 'Adjustments need review.' };
    case 'trade': {
      if (t.side === 'send' || t.side === 'receive') return { taxClass: t.isOwnTransfer ? 'TRANSFER_NO_DISPOSAL' : 'REVIEW', source: 'default', reason: 'Asset transfer.' };
      if (simulated) return { taxClass: 'SIMULATED', source: 'account', reason: 'Simulated prop-firm account.' };
      const deriv = ctx.instrument && DERIVATIVE_CLASSES.includes(ctx.instrument.assetClass);
      if (!a || a.taxTreatment === 'unresolved' || a.taxTreatment === 'not_applicable') return { taxClass: 'REVIEW', source: 'account', reason: 'Account tax treatment not determined.' };
      if (a.taxTreatment === 'business_trader' || a.taxTreatment === 'profit_making') return { taxClass: 'REVENUE_TRADING', source: 'account', reason: 'Revenue-account trading.' };
      if (t.side === 'financing') return { taxClass: 'FINANCING_EXPENSE', source: 'default', reason: 'Financing / swap charge.' };
      if (deriv || t.side === 'short' || t.side === 'cover' || t.side === 'realised_pnl') return { taxClass: 'REVIEW', source: 'account', reason: 'Derivative / short on capital account needs review.' };
      return { taxClass: 'CGT_EVENT', source: 'account', reason: 'Capital-account investor.' };
    }
    case 'income':
    case 'expense':
    case 'fee': {
      if (ctx.category) {
        if (t.kind !== 'income' && t.isBusiness && ctx.category.defaultTaxClass === 'DEDUCTIBLE_EXPENSE') return { taxClass: 'BUSINESS_EXPENSE', source: 'category', reason: 'Business expense.' };
        if (t.kind !== 'income' && a && a.taxTreatment === 'business_trader' && ctx.category.defaultTaxClass === 'REVIEW' && ctx.category.group === 'Trading')
          return { taxClass: 'BUSINESS_EXPENSE', source: 'account', reason: 'Trading business expense (account carries on a business).' };
        if (t.kind === 'income' && ctx.category.code === 'dividend_au' && ctx.instrument && ctx.instrument.assetClass !== 'au_share' && ctx.instrument.assetClass !== 'etf')
          return { taxClass: 'FOREIGN_INCOME', source: 'category', reason: 'Dividend on a non-Australian instrument.' };
        return { taxClass: ctx.category.defaultTaxClass, source: 'category', reason: `Category default (${ctx.category.name}).` };
      }
      return { taxClass: 'UNCLASSIFIED', source: 'default', reason: 'No category.' };
    }
    default:
      return { taxClass: 'UNCLASSIFIED', source: 'default', reason: 'Unknown type.' };
  }
}
