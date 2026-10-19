/**
 * Trading performance (economic results) — deliberately separate from tax results.
 * Pools per account+instrument, includes simulated accounts, and reports native-currency and AUD figures.
 */
import { D, Decimal, tryD } from '../../lib/decimal';
import type { AssetClass, Transaction } from '../../domain/types';
import { ZERO, audOf, feesAud, grossOf, sortTxns, type LedgerData } from '../ledger';
import { runLotEngine } from './lots';
import { runDerivativeEngine } from './derivatives';

export interface PerformanceFilter {
  fy?: number;
  accountId?: string;
  instrumentId?: string;
  assetClass?: AssetClass;
  currency?: string;
  direction?: 'long' | 'short';
  includeSimulated?: boolean;
}

export interface PerformanceRow {
  accountId?: string;
  instrumentId: string;
  realisedAud: Decimal | null;
  realisedNative: Decimal | null;
  nativeCurrency: string;
  feesAud: Decimal | null;
  closedCount: number;
  wins: number;
  losses: number;
  direction: 'long' | 'short' | 'mixed';
  simulated: boolean;
}

export interface PerformanceSummary {
  rows: PerformanceRow[];
  totalRealisedAud: Decimal | null;
  totalFeesAud: Decimal | null;
  grossAud: Decimal | null;
  tradeCount: number;
  winRate: number | null;
  openPositions: { accountId?: string; instrumentId: string; quantity: Decimal; costAud: Decimal | null; markPrice: Decimal | null; markCurrency: string; direction: 'long' | 'short' }[];
  incomplete: number;
}

const add = (a: Decimal | null, b: Decimal | null) => (a === null || b === null ? null : a.plus(b));

export function lastTradePrices(txns: Transaction[]): Map<string, { price: Decimal; currency: string; date: string }> {
  const m = new Map<string, { price: Decimal; currency: string; date: string }>();
  for (const t of sortTxns(txns)) {
    if (t.kind !== 'trade' || !t.instrumentId || t.status !== 'active') continue;
    const p = tryD(t.price);
    if (p && p.gt(0)) m.set(t.instrumentId, { price: p, currency: t.currency, date: t.date });
  }
  return m;
}

export function computePerformance(data: LedgerData, taxTz: string, f: PerformanceFilter = {}): PerformanceSummary {
  const accounts = new Map(data.accounts.map((a) => [a.id, a]));
  const instruments = new Map(data.instruments.map((i) => [i.id, i]));
  const isSim = (id?: string) => {
    const a = id ? accounts.get(id) : undefined;
    return !!a && (a.propStatus === 'evaluation' || a.propStatus === 'funded_simulated');
  };
  const lots = runLotEngine(data, { taxTz, costBasisDefaults: {}, mode: 'economic' });
  const deriv = runDerivativeEngine(data, { includeSimulated: true });
  const match = (accountId: string | undefined, instrumentId: string | undefined, fy: number, currency: string, direction: 'long' | 'short') => {
    if (f.fy && fy !== f.fy) return false;
    if (f.accountId && accountId !== f.accountId) return false;
    if (f.instrumentId && instrumentId !== f.instrumentId) return false;
    if (f.assetClass && (!instrumentId || instruments.get(instrumentId)?.assetClass !== f.assetClass)) return false;
    if (f.currency && currency !== f.currency) return false;
    if (f.direction && direction !== f.direction) return false;
    if (f.includeSimulated === false && isSim(accountId)) return false;
    return true;
  };
  const rows = new Map<string, PerformanceRow>();
  const row = (accountId: string | undefined, instrumentId: string, cur: string, dir: 'long' | 'short') => {
    const k = `${accountId}|${instrumentId}`;
    let r = rows.get(k);
    if (!r) {
      r = { accountId, instrumentId, realisedAud: ZERO, realisedNative: ZERO, nativeCurrency: cur, feesAud: ZERO, closedCount: 0, wins: 0, losses: 0, direction: dir, simulated: isSim(accountId) };
      rows.set(k, r);
    } else if (r.direction !== dir) r.direction = 'mixed';
    if (r.nativeCurrency !== cur) r.realisedNative = null;
    return r;
  };
  let incomplete = 0;
  for (const d of lots.disposals) {
    if (d.kind === 'quote_asset' || d.kind === 'fee_disposal') continue;
    if (!match(d.accountId, d.instrumentId, d.fy, d.nativeCurrency, 'long')) continue;
    const r = row(d.accountId, d.instrumentId, d.nativeCurrency, 'long');
    r.realisedAud = add(r.realisedAud, d.gainAud);
    r.realisedNative = r.realisedNative === null || d.proceedsNative === null || d.costNative === null ? null : r.realisedNative.plus(d.proceedsNative.minus(d.costNative));
    r.closedCount++;
    if (d.gainAud === null) incomplete++;
    else if (d.gainAud.gt(0)) r.wins++;
    else if (d.gainAud.lt(0)) r.losses++;
  }
  for (const e of deriv.realised) {
    if (!e.instrumentId || e.kind === 'financing') continue;
    if (!match(e.accountId, e.instrumentId, e.fy, e.currency, e.direction ?? 'long')) continue;
    const r = row(e.accountId, e.instrumentId, e.currency, e.direction ?? 'long');
    r.realisedAud = add(r.realisedAud, e.netAud);
    r.realisedNative = r.realisedNative === null ? null : r.realisedNative.plus(e.pnlNative.minus(e.feesNative));
    r.feesAud = add(r.feesAud, e.feesAud);
    r.closedCount++;
    if (e.netAud === null) incomplete++;
    else if (e.netAud.gt(0)) r.wins++;
    else if (e.netAud.lt(0)) r.losses++;
  }
  // Fees on lot-asset trades (already inside cost/proceeds; reported for visibility).
  for (const t of data.transactions) {
    if (t.status !== 'active' || t.kind !== 'trade' || !t.instrumentId) continue;
    const inst = instruments.get(t.instrumentId);
    if (!inst || ['future', 'cfd', 'forex'].includes(inst.assetClass)) continue;
    if (!match(t.accountId, t.instrumentId, t.fy, t.currency, t.side === 'short' || t.side === 'cover' ? 'short' : 'long')) continue;
    const k = `${t.accountId}|${t.instrumentId}`;
    const r = rows.get(k);
    if (r) r.feesAud = add(r.feesAud, feesAud(t));
  }
  const list = [...rows.values()];
  const totalRealised = list.reduce<Decimal | null>((s, r) => add(s, r.realisedAud), ZERO);
  const totalFees = list.reduce<Decimal | null>((s, r) => add(s, r.feesAud), ZERO);
  const closed = list.reduce((s, r) => s + r.closedCount, 0);
  const wins = list.reduce((s, r) => s + r.wins, 0);
  const marks = lastTradePrices(data.transactions);
  const openPositions: PerformanceSummary['openPositions'] = [];
  const byKey = new Map<string, { accountId?: string; instrumentId: string; qty: Decimal; cost: Decimal | null }>();
  for (const l of lots.lots) {
    if (l.qtyRemaining.lte(0)) continue;
    if (f.accountId && l.accountId !== f.accountId) continue;
    if (f.instrumentId && l.instrumentId !== f.instrumentId) continue;
    if (f.assetClass && instruments.get(l.instrumentId)?.assetClass !== f.assetClass) continue;
    if (f.includeSimulated === false && isSim(l.accountId)) continue;
    const k = `${l.accountId}|${l.instrumentId}`;
    const e = byKey.get(k) ?? { accountId: l.accountId, instrumentId: l.instrumentId, qty: ZERO, cost: ZERO as Decimal | null };
    e.qty = e.qty.plus(l.qtyRemaining);
    e.cost = add(e.cost, l.costAud);
    byKey.set(k, e);
  }
  for (const e of byKey.values()) {
    const m = marks.get(e.instrumentId);
    openPositions.push({ accountId: e.accountId, instrumentId: e.instrumentId, quantity: e.qty, costAud: e.cost, markPrice: m?.price ?? null, markCurrency: m?.currency ?? '', direction: 'long' });
  }
  for (const p of deriv.open) {
    if (f.accountId && p.accountId !== f.accountId) continue;
    if (f.instrumentId && p.instrumentId !== f.instrumentId) continue;
    if (f.assetClass && instruments.get(p.instrumentId)?.assetClass !== f.assetClass) continue;
    if (f.direction && p.direction !== f.direction) continue;
    const m = marks.get(p.instrumentId);
    openPositions.push({ accountId: p.accountId, instrumentId: p.instrumentId, quantity: p.quantity, costAud: null, markPrice: m?.price ?? null, markCurrency: p.currency, direction: p.direction });
  }
  return {
    rows: list,
    totalRealisedAud: totalRealised,
    totalFeesAud: totalFees,
    grossAud: totalRealised === null || totalFees === null ? null : totalRealised.plus(totalFees),
    tradeCount: closed,
    winRate: closed ? wins / closed : null,
    openPositions,
    incomplete
  };
}

/** Per-account quantity holdings from raw flows (for reconciliation against statements). */
export function accountHoldings(txns: Transaction[]): Map<string, Map<string, Decimal>> {
  const out = new Map<string, Map<string, Decimal>>();
  const bump = (acct: string, inst: string, q: Decimal) => {
    let m = out.get(acct);
    if (!m) out.set(acct, (m = new Map()));
    m.set(inst, (m.get(inst) ?? ZERO).plus(q));
  };
  for (const t of txns) {
    if (t.status !== 'active' || !t.accountId || !t.instrumentId) continue;
    const q = tryD(t.quantity)?.abs() ?? ZERO;
    switch (t.side) {
      case 'buy':
      case 'receive':
      case 'income':
        bump(t.accountId, t.instrumentId, q);
        break;
      case 'cover':
        bump(t.accountId, t.instrumentId, q);
        break;
      case 'sell':
      case 'short':
      case 'expire':
      case 'exercise':
        bump(t.accountId, t.instrumentId, q.neg());
        break;
      case 'send':
        bump(t.accountId, t.instrumentId, q.plus(D(t.feeQuantity)).neg());
        break;
      case 'swap':
        bump(t.accountId, t.instrumentId, q.neg());
        if (t.counterInstrumentId) bump(t.accountId, t.counterInstrumentId, tryD(t.counterQuantity)?.abs() ?? ZERO);
        break;
      case 'adjustment':
        if (t.adjustmentType === 'opening_balance') bump(t.accountId, t.instrumentId, q);
        else if (t.adjustmentType === 'lost' || t.adjustmentType === 'stolen') bump(t.accountId, t.instrumentId, q.neg());
        break;
    }
  }
  return out;
}

/** Per-account cash balance by currency from recorded flows (original currency). */
export function accountCashBalances(data: LedgerData): Map<string, Map<string, Decimal>> {
  const out = new Map<string, Map<string, Decimal>>();
  const instruments = new Map(data.instruments.map((i) => [i.id, i]));
  const bump = (acct: string, cur: string, v: Decimal) => {
    let m = out.get(acct);
    if (!m) out.set(acct, (m = new Map()));
    m.set(cur, (m.get(cur) ?? ZERO).plus(v));
  };
  for (const a of data.accounts) if (a.openingBalance) bump(a.id, a.currency, D(a.openingBalance));
  for (const t of data.transactions) {
    if (t.status !== 'active' || !t.accountId) continue;
    const amt = D(t.amount).abs();
    const fees = D(t.commission).plus(D(t.exchangeFees)).plus(D(t.otherFees)).plus(D(t.financingCosts));
    const fc = t.feeCurrency || t.currency;
    const inst = t.instrumentId ? instruments.get(t.instrumentId) : undefined;
    const isDeriv = inst && ['future', 'cfd', 'forex'].includes(inst.assetClass);
    if (t.kind === 'cash') bump(t.accountId, t.currency, t.side === 'withdrawal' ? amt.neg() : amt);
    else if (t.kind === 'income') bump(t.accountId, t.currency, amt.minus(D(t.foreignTaxPaid)));
    else if (t.kind === 'expense' || t.kind === 'fee') bump(t.accountId, t.currency, amt.neg());
    else if (t.kind === 'trade') {
      if (t.side === 'realised_pnl' || t.side === 'settlement' || t.side === 'financing') bump(t.accountId, t.currency, D(t.amount));
      else if (!isDeriv && inst) {
        const gross = grossOf(t, inst);
        if (t.side === 'buy' || t.side === 'cover') bump(t.accountId, t.currency, gross.neg());
        if (t.side === 'sell' || t.side === 'short') bump(t.accountId, t.currency, gross);
      }
      if (!fees.isZero()) bump(t.accountId, fc, fees.neg());
    }
  }
  return out;
}

export { audOf };
