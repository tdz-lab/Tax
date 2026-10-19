/** CSV exports of the ledger and calculation detail (AUD values alongside original amounts). */
import Papa from 'papaparse';
import { D, dstr } from '../lib/decimal';
import { TAX_CLASS_INFO } from '../domain/reference';
import { audOf } from '../engines/ledger';
import type { ReportContext } from './reportData';

export function ledgerCsv(ctx: ReportContext): string {
  const rows = ctx.txns.map((t) => {
    const aud = audOf(t, t.amount);
    return {
      id: t.id,
      date: t.date,
      time: t.time ?? '',
      time_zone: t.timeZone,
      utc_timestamp: t.occurredAt,
      settlement_date: t.settlementDate ?? '',
      tax_event_date: t.taxEventDate ?? t.date,
      fy: t.fy,
      kind: t.kind,
      side: t.side ?? '',
      account: t.accountId ? ctx.accounts.get(t.accountId)?.name ?? t.accountId : '',
      instrument: t.instrumentId ? ctx.instruments.get(t.instrumentId)?.symbol ?? '' : '',
      asset_class: t.instrumentId ? ctx.instruments.get(t.instrumentId)?.assetClass ?? '' : '',
      description: t.description,
      category: t.category,
      tax_classification: TAX_CLASS_INFO[t.taxClass].label,
      classification_source: t.taxClassSource,
      quantity: t.quantity ?? '',
      price: t.price ?? '',
      multiplier: t.multiplier ?? '',
      currency: t.currency,
      amount: t.amount,
      fees: dstr(D(t.commission).plus(D(t.exchangeFees)).plus(D(t.otherFees))),
      aud_per_unit: t.fx?.audPerUnit ?? (t.currency === 'AUD' ? '1' : ''),
      rate_source: t.fx?.source ?? '',
      rate_date: t.fx?.rateDate ?? '',
      rate_type: t.fx?.isManualOverride ? 'manual' : t.fx?.rateType ?? '',
      amount_aud: aud === null ? 'MISSING_RATE' : aud.toFixed(2),
      tax_withheld_aud: t.taxWithheld ?? '',
      franking_credit_aud: t.frankingCredit ?? '',
      foreign_tax_paid: t.foreignTaxPaid ?? '',
      gst: t.gstAmount ?? '',
      business_use_pct: t.businessUsePct ?? '',
      documents: t.documentIds.length,
      source: t.source,
      source_id: t.sourceId ?? '',
      import_batch: t.importBatchId ?? '',
      review_flags: t.reviewFlags.join('; ')
    };
  });
  return Papa.unparse(rows);
}

export function cgtCsv(ctx: ReportContext): string {
  const rows = ctx.result.disposals.flatMap((d) =>
    d.allocations.map((a) => ({
      disposal_id: d.id,
      disposal_record: d.txnId,
      disposal_date: d.date,
      instrument: ctx.instruments.get(d.instrumentId)?.symbol ?? d.instrumentId,
      event: d.kind,
      classification: TAX_CLASS_INFO[d.taxClass].label,
      method: d.method,
      parcel: a.lotId,
      parcel_record: a.sourceTxnId,
      acquired_date: a.acquiredDate,
      quantity: a.quantity,
      cost_base_aud: a.costAud ?? 'UNKNOWN',
      proceeds_aud: a.proceedsAud ?? 'UNKNOWN',
      gain_aud: a.gainAud ?? 'UNKNOWN',
      days_held: a.heldDays,
      discount_eligible: a.discountEligible ? 'yes' : 'no',
      flags: d.flags.join('; ')
    }))
  );
  return Papa.unparse(rows);
}

export function summaryCsv(ctx: ReportContext): string {
  const r = ctx.result;
  const lines = [...r.income, ...r.deductions, ...r.business, ...r.revenueTrading, ...r.capitalLines, ...r.foreign, ...r.estimate, ...r.offsetsAndCredits];
  return Papa.unparse(lines.map((l) => ({ key: l.key, label: l.label, amount_aud: l.amount ?? 'INCOMPLETE', status: l.status, source_records: l.sourceIds.join(' '), method: l.method ?? '' })));
}
