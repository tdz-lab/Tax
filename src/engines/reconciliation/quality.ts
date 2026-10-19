/**
 * Data-quality checks, transfer matching and duplicate detection. Pure functions over ledger data.
 */
import { D, Decimal, dstr, tryD } from '../../lib/decimal';
import { daysBetween, fyOfLocalDate, localDateOf } from '../../lib/dates';
import type { Account, Instrument, ReconciliationItem, Transaction } from '../../domain/types';
import type { LedgerData } from '../ledger';
import type { LotEngineResult } from '../trading/lots';
import { accountCashBalances, accountHoldings } from '../trading/performance';
import type { DerivativeResult } from '../trading/derivatives';

export type QualityCode =
  | 'MISSING_COST_BASE'
  | 'MISSING_DISPOSAL_VALUE'
  | 'MISSING_RATE'
  | 'UNMATCHED_TRANSFER'
  | 'UNCLASSIFIED'
  | 'NEEDS_REVIEW'
  | 'POSSIBLE_DUPLICATE'
  | 'MISSING_MULTIPLIER'
  | 'INCONSISTENT_TIMESTAMP'
  | 'FY_BOUNDARY'
  | 'MISSING_EVIDENCE'
  | 'UNRECONCILED_BALANCE'
  | 'MANUAL_RATE'
  | 'STALE_RATE'
  | 'ACCOUNT_TREATMENT'
  | 'SPAM_TOKEN';

export interface QualityIssue {
  code: QualityCode;
  severity: 'blocking' | 'warning' | 'info';
  message: string;
  txnIds: string[];
  fy?: number;
}

export const QUALITY_LABEL: Record<QualityCode, string> = {
  MISSING_COST_BASE: 'Missing acquisition cost',
  MISSING_DISPOSAL_VALUE: 'Missing disposal / market value',
  MISSING_RATE: 'Missing historical exchange rate',
  UNMATCHED_TRANSFER: 'Unmatched wallet / account transfer',
  UNCLASSIFIED: 'Unresolved classification',
  NEEDS_REVIEW: 'Needs specialist review',
  POSSIBLE_DUPLICATE: 'Possible duplicate',
  MISSING_MULTIPLIER: 'Missing contract multiplier',
  INCONSISTENT_TIMESTAMP: 'Inconsistent timestamps',
  FY_BOUNDARY: 'Financial-year boundary timing',
  MISSING_EVIDENCE: 'Missing supporting evidence',
  UNRECONCILED_BALANCE: 'Unreconciled account balance',
  MANUAL_RATE: 'Manual exchange-rate override',
  STALE_RATE: 'Prior-day exchange rate used',
  ACCOUNT_TREATMENT: 'Account tax treatment not set',
  SPAM_TOKEN: 'Spam / dust token excluded'
};

/** Key used to detect likely duplicates (does not include ids/batches). */
export function duplicateKey(t: Transaction): string {
  return [t.kind, t.accountId ?? '', t.occurredAt, t.instrumentId ?? '', t.side ?? '', dstr(D(t.quantity)), dstr(D(t.price)), dstr(D(t.amount)), t.currency, t.description.trim().toLowerCase()].join('|');
}

export function findDuplicateGroups(txns: Transaction[]): Transaction[][] {
  const m = new Map<string, Transaction[]>();
  for (const t of txns) {
    if (t.status !== 'active') continue;
    const k = duplicateKey(t);
    const arr = m.get(k) ?? [];
    arr.push(t);
    m.set(k, arr);
  }
  // Same key AND from different sources/batches (or manual) — identical fills within one import batch are kept apart.
  return [...m.values()].filter((g) => g.length > 1 && new Set(g.map((t) => t.importBatchId ?? `manual:${t.id}`)).size > 1);
}

export interface TransferSuggestion {
  sendId: string;
  receiveId: string;
  instrumentId: string;
  sendQty: string;
  receiveQty: string;
  hoursApart: number;
  confidence: 'high' | 'medium';
}

/** Suggest own-account transfer pairs: same asset, different accounts, receive ≤ send, within 72h. */
export function suggestTransferMatches(txns: Transaction[], toleranceFraction = '0.02', windowHours = 72): TransferSuggestion[] {
  const sends = txns.filter((t) => t.status === 'active' && t.side === 'send' && !t.transferPairId && t.instrumentId);
  const receives = txns.filter((t) => t.status === 'active' && t.side === 'receive' && !t.transferPairId && t.instrumentId);
  const used = new Set<string>();
  const out: TransferSuggestion[] = [];
  const tol = D(toleranceFraction);
  for (const s of sends) {
    const sq = tryD(s.quantity)?.abs();
    if (!sq) continue;
    let best: { r: Transaction; hours: number; diff: Decimal } | null = null;
    for (const r of receives) {
      if (used.has(r.id) || r.instrumentId !== s.instrumentId || r.accountId === s.accountId) continue;
      const rq = tryD(r.quantity)?.abs();
      if (!rq || rq.gt(sq)) continue;
      const diff = sq.minus(rq);
      if (diff.gt(sq.times(tol))) continue;
      const hours = (Date.parse(r.occurredAt) - Date.parse(s.occurredAt)) / 3_600_000;
      if (hours < -1 || hours > windowHours) continue;
      if (!best || hours < best.hours) best = { r, hours, diff };
    }
    if (best) {
      used.add(best.r.id);
      out.push({
        sendId: s.id,
        receiveId: best.r.id,
        instrumentId: s.instrumentId!,
        sendQty: dstr(sq),
        receiveQty: dstr(D(best.r.quantity).abs()),
        hoursApart: Math.round(best.hours * 10) / 10,
        confidence: best.diff.isZero() || (s.feeQuantity && D(s.feeQuantity).eq(best.diff)) ? 'high' : 'medium'
      });
    }
  }
  return out;
}

export interface QualityContext {
  data: LedgerData;
  lots?: LotEngineResult;
  deriv?: DerivativeResult;
  reconciliation: ReconciliationItem[];
  taxTz: string;
  fy?: number;
  evidenceThreshold?: string; // AUD amount above which a receipt is expected
}

export function runQualityChecks(ctx: QualityContext): QualityIssue[] {
  const { data } = ctx;
  const issues: QualityIssue[] = [];
  const active = data.transactions.filter((t) => t.status === 'active');
  const inScope = ctx.fy ? active.filter((t) => t.fy === ctx.fy) : active;
  const scopeIds = new Set(inScope.map((t) => t.id));
  const instruments = new Map<string, Instrument>(data.instruments.map((i) => [i.id, i]));
  const accounts = new Map<string, Account>(data.accounts.map((a) => [a.id, a]));
  const push = (code: QualityCode, severity: QualityIssue['severity'], message: string, txnIds: string[]) => {
    if (txnIds.length || !message.includes('{n}')) issues.push({ code, severity, message: message.replace('{n}', String(txnIds.length)), txnIds, fy: ctx.fy });
  };

  const missingRate = inScope.filter((t) => t.currency.toUpperCase() !== 'AUD' && !t.fx);
  const missingFeeRate = inScope.filter((t) => t.feeCurrency && t.feeCurrency !== t.currency && t.feeCurrency !== 'AUD' && !t.feeFx);
  if (missingRate.length + missingFeeRate.length) push('MISSING_RATE', 'blocking', '{n} transaction(s) have no historical AUD rate for the amount or fees.', [...missingRate, ...missingFeeRate].map((t) => t.id));

  if (ctx.lots) {
    const mcb = ctx.lots.issues.filter((i) => i.code === 'MISSING_COST_BASE' && (!i.txnId || scopeIds.has(i.txnId))).map((i) => i.txnId!).filter(Boolean);
    if (mcb.length) push('MISSING_COST_BASE', 'blocking', '{n} disposal(s) have no matching acquisition / cost base.', [...new Set(mcb)]);
    const missingVal = ctx.lots.disposals.filter((d) => scopeIds.has(d.txnId) && d.flags.some((f) => f.startsWith('MISSING_VALUATION'))).map((d) => d.txnId);
    if (missingVal.length) push('MISSING_DISPOSAL_VALUE', 'blocking', '{n} disposal(s) have no AUD market value recorded.', [...new Set(missingVal)]);
    const unmatched = ctx.lots.issues.filter((i) => i.code === 'UNMATCHED_TRANSFER' && i.txnId && scopeIds.has(i.txnId)).map((i) => i.txnId!);
    if (unmatched.length) push('UNMATCHED_TRANSFER', 'warning', '{n} transfer(s) are not matched or marked as own transfers.', unmatched);
    const spam = ctx.lots.spamTxnIds.filter((id) => scopeIds.has(id));
    if (spam.length) push('SPAM_TOKEN', 'info', '{n} transaction(s) in tokens marked as spam are excluded from calculations.', spam);
  }
  const unclassified = inScope.filter((t) => t.taxClass === 'UNCLASSIFIED');
  if (unclassified.length) push('UNCLASSIFIED', 'blocking', '{n} transaction(s) have no tax classification.', unclassified.map((t) => t.id));
  const review = inScope.filter((t) => t.taxClass === 'REVIEW');
  if (review.length) push('NEEDS_REVIEW', 'warning', '{n} transaction(s) are classified as needing specialist review.', review.map((t) => t.id));

  const dups = findDuplicateGroups(inScope).flat();
  if (dups.length) push('POSSIBLE_DUPLICATE', 'warning', '{n} transaction(s) look like duplicates of each other (same account, time, instrument, quantity and amount from different sources).', dups.map((t) => t.id));

  const missingMult = inScope.filter((t) => {
    const i = t.instrumentId ? instruments.get(t.instrumentId) : undefined;
    return t.kind === 'trade' && i && (i.assetClass === 'future' || i.assetClass === 'option') && !i.multiplier && !t.multiplier;
  });
  if (missingMult.length) push('MISSING_MULTIPLIER', 'blocking', '{n} futures/options trade(s) have no contract multiplier (instrument or trade).', missingMult.map((t) => t.id));

  const badTs: string[] = [];
  const boundary: string[] = [];
  for (const t of inScope) {
    try {
      const local = localDateOf(t.occurredAt, ctx.taxTz);
      if (!t.taxEventDate && local !== t.date) badTs.push(t.id);
      if (t.settlementDate && t.settlementDate < t.date) badTs.push(t.id);
      const tradeLocal = localDateOf(t.occurredAt, t.timeZone || ctx.taxTz);
      if (fyOfLocalDate(tradeLocal) !== fyOfLocalDate(local)) boundary.push(t.id);
    } catch {
      badTs.push(t.id);
    }
  }
  if (badTs.length) push('INCONSISTENT_TIMESTAMP', 'warning', '{n} transaction(s) have a recorded date that differs from the timestamp’s local date, or settle before trade date.', [...new Set(badTs)]);
  if (boundary.length) push('FY_BOUNDARY', 'warning', '{n} transaction(s) fall in different financial years depending on the time zone used (trade venue vs taxpayer). Confirm the tax event date.', boundary);

  const threshold = D(ctx.evidenceThreshold ?? '0');
  const noEvidence = inScope.filter(
    (t) => (t.kind === 'expense' || t.kind === 'fee' || (t.kind === 'income' && t.category === 'prop_payout')) && t.documentIds.length === 0 && D(t.amount).abs().gt(threshold) && t.taxClass !== 'NON_DEDUCTIBLE'
  );
  if (noEvidence.length) push('MISSING_EVIDENCE', 'warning', '{n} expense/fee/payout record(s) have no linked receipt or statement.', noEvidence.map((t) => t.id));

  const manual = inScope.filter((t) => t.fx?.isManualOverride);
  if (manual.length) push('MANUAL_RATE', 'info', '{n} transaction(s) use manually entered exchange rates (source and reason recorded).', manual.map((t) => t.id));
  const stale = inScope.filter((t) => (t.fx?.staleDays ?? 0) > 0);
  if (stale.length) push('STALE_RATE', 'info', '{n} transaction(s) used the nearest prior published daily rate (weekend/holiday).', stale.map((t) => t.id));

  const unresolvedAccts = data.accounts.filter((a) => a.taxTreatment === 'unresolved' && active.some((t) => t.accountId === a.id && t.kind === 'trade'));
  if (unresolvedAccts.length) {
    const ids = inScope.filter((t) => t.kind === 'trade' && unresolvedAccts.some((a) => a.id === t.accountId)).map((t) => t.id);
    issues.push({ code: 'ACCOUNT_TREATMENT', severity: 'blocking', message: `${unresolvedAccts.length} trading account(s) have no tax treatment (investor vs trader): ${unresolvedAccts.map((a) => a.name).join(', ')}.`, txnIds: ids, fy: ctx.fy });
  }

  // Balance reconciliation against statements
  const recon = reconcileBalances(data, ctx.reconciliation, ctx.deriv);
  const off = recon.filter((r) => r.status === 'open' && r.difference !== null && !D(r.difference).isZero());
  if (off.length) {
    issues.push({
      code: 'UNRECONCILED_BALANCE',
      severity: 'warning',
      message: `${off.length} statement balance(s) do not match recorded balances: ${off.map((r) => `${accounts.get(r.accountId ?? '')?.name ?? '?'} (${r.difference})`).join('; ')}.`,
      txnIds: [],
      fy: ctx.fy
    });
  }
  return issues;
}

export interface BalanceCheck {
  itemId: string;
  accountId?: string;
  instrumentId?: string;
  type: ReconciliationItem['type'];
  asAtDate: string;
  statementValue: string | null;
  recordedValue: string | null;
  difference: string | null;
  currency: string;
  status: ReconciliationItem['status'];
}

/** Compare statement balances/holdings entered by the user with balances computed from records up to the as-at date. */
export function reconcileBalances(data: LedgerData, items: ReconciliationItem[], deriv?: DerivativeResult): BalanceCheck[] {
  const out: BalanceCheck[] = [];
  for (const it of items) {
    if (it.type !== 'cash_balance' && it.type !== 'holding') continue;
    const upTo = data.transactions.filter((t) => t.date <= it.asAtDate);
    let recorded: Decimal | null = null;
    let currency = it.statementCurrency ?? '';
    if (it.type === 'cash_balance' && it.accountId) {
      const acct = data.accounts.find((a) => a.id === it.accountId);
      currency = it.statementCurrency || acct?.currency || 'AUD';
      const balances = accountCashBalances({ ...data, transactions: upTo });
      recorded = balances.get(it.accountId)?.get(currency) ?? new Decimal(0);
      if (deriv) {
        for (const e of deriv.realised) {
          if (e.accountId === it.accountId && e.kind === 'closed_position' && e.date <= it.asAtDate && e.currency === currency) recorded = recorded.plus(e.pnlNative);
        }
      }
    } else if (it.type === 'holding' && it.accountId && it.instrumentId) {
      currency = 'units';
      recorded = accountHoldings(upTo).get(it.accountId)?.get(it.instrumentId) ?? new Decimal(0);
    }
    const stmt = tryD(it.statementValue);
    out.push({
      itemId: it.id,
      accountId: it.accountId,
      instrumentId: it.instrumentId,
      type: it.type,
      asAtDate: it.asAtDate,
      statementValue: stmt ? dstr(stmt) : null,
      recordedValue: recorded ? dstr(recorded) : null,
      difference: stmt && recorded ? dstr(stmt.minus(recorded)) : null,
      currency,
      status: it.status
    });
  }
  return out;
}

export function daysApart(a: string, b: string): number {
  return Math.abs(daysBetween(a, b));
}
