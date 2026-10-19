/**
 * GST / BAS period summaries (cash or accrual basis by transaction date). Only business transactions
 * with a GST treatment are included; GST is never assumed. Labels follow the simplified BAS (G1, 1A, 1B).
 */
import { D, Decimal } from '../../lib/decimal';
import { basQuarters, type FYear } from '../../lib/dates';
import type { BusinessProfile, Transaction } from '../../domain/types';
import { audOf } from '../ledger';

export interface BasPeriod {
  label: string;
  start: string;
  end: string;
  g1TotalSalesAud: Decimal; // GST-inclusive
  gstFreeSalesAud: Decimal;
  gstOnSalesAud: Decimal; // 1A
  gstOnPurchasesAud: Decimal; // 1B
  netGstAud: Decimal; // 1A − 1B
  txnIds: string[];
  reviewTxnIds: string[];
  missingRateTxnIds: string[];
}

const ZERO = new Decimal(0);

export function basSummary(txns: Transaction[], fy: FYear, profile: BusinessProfile | undefined): { periods: BasPeriod[]; notes: string[] } {
  const notes: string[] = [];
  if (!profile?.gstRegistered) notes.push('Business is not recorded as GST-registered — GST amounts are tracked but BAS figures may not apply.');
  if (profile?.basFrequency === 'monthly') notes.push('Monthly BAS frequency selected — quarterly summaries are shown; split months manually.');
  const periods: BasPeriod[] = basQuarters(fy).map((q) => ({
    ...q,
    g1TotalSalesAud: ZERO,
    gstFreeSalesAud: ZERO,
    gstOnSalesAud: ZERO,
    gstOnPurchasesAud: ZERO,
    netGstAud: ZERO,
    txnIds: [],
    reviewTxnIds: [],
    missingRateTxnIds: []
  }));
  for (const t of txns) {
    if (t.status !== 'active' || t.fy !== fy || !t.isBusiness) continue;
    if (!t.gstTreatment || t.gstTreatment === 'none') continue;
    const p = periods.find((x) => t.date >= x.start && t.date <= x.end);
    if (!p) continue;
    const amt = audOf(t, t.amount);
    const gst = audOf(t, t.gstAmount);
    if (amt === null || gst === null) {
      p.missingRateTxnIds.push(t.id);
      continue;
    }
    p.txnIds.push(t.id);
    if (t.gstTreatment === 'review' || t.gstTreatment === 'imported_service' || t.gstTreatment === 'input_taxed') p.reviewTxnIds.push(t.id);
    if (t.kind === 'income') {
      p.g1TotalSalesAud = p.g1TotalSalesAud.plus(amt);
      if (t.gstTreatment === 'gst_free') p.gstFreeSalesAud = p.gstFreeSalesAud.plus(amt);
      if (t.gstTreatment === 'taxable') p.gstOnSalesAud = p.gstOnSalesAud.plus(gst);
    } else if (t.kind === 'expense' || t.kind === 'fee') {
      if (t.gstTreatment === 'taxable') p.gstOnPurchasesAud = p.gstOnPurchasesAud.plus(gst.times(D(t.businessUsePct ?? '100')).div(100));
    }
  }
  for (const p of periods) p.netGstAud = p.gstOnSalesAud.minus(p.gstOnPurchasesAud);
  return { periods, notes };
}

/** Standard 1/11th GST component of a GST-inclusive taxable amount (suggestion only; user confirms). */
export function gstFromInclusive(amount: string): string {
  return D(amount).div(11).toDecimalPlaces(2).toFixed(2);
}
