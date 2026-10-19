/**
 * Position engine for futures, CFDs, forex positions and any short positions (short/cover,
 * written options). Opens and closes are matched FIFO per (account, instrument). Realised P&L is
 * computed in the contract currency as (exit − entry) × qty × multiplier, then converted to AUD at
 * the closing transaction's rate. Fees are converted at the rate of their own transaction.
 */
import { D, Decimal, tryD } from '../../lib/decimal';
import { fyOfLocalDate } from '../../lib/dates';
import { DERIVATIVE_CLASSES } from '../../domain/reference';
import type { Account, Instrument, TaxClass, Transaction } from '../../domain/types';
import { ZERO, audOf, feesAud, feesNative, multiplierOf, sortTxns, taxDateOf, type LedgerData } from '../ledger';
import { isSimulatedAccount, treatmentGroup, type TreatmentGroup } from './lots';

export interface RealisedEvent {
  id: string;
  txnId: string; // closing / statement transaction
  openTxnIds: string[];
  accountId?: string;
  instrumentId?: string;
  kind: 'closed_position' | 'statement_pnl' | 'financing' | 'written_option_premium' | 'written_option_close';
  direction?: 'long' | 'short';
  date: string;
  fy: number;
  quantity: Decimal;
  currency: string;
  pnlNative: Decimal; // before fees
  feesNative: Decimal;
  pnlAud: Decimal | null; // before fees
  feesAud: Decimal | null;
  netAud: Decimal | null;
  group: TreatmentGroup;
  taxClass: TaxClass;
  simulated: boolean;
  flags: string[];
}

export interface OpenPosition {
  key: string;
  accountId?: string;
  instrumentId: string;
  direction: 'long' | 'short';
  quantity: Decimal;
  avgEntry: Decimal;
  currency: string;
  openTxnIds: string[];
}

interface OpenLeg {
  txn: Transaction;
  qty: Decimal; // remaining
  qtyOrig: Decimal;
  price: Decimal;
  feesAud: Decimal | null;
  feesNative: Decimal;
}

function derivClass(group: TreatmentGroup, inst: Instrument | undefined, simulated: boolean, kind: RealisedEvent['kind']): { taxClass: TaxClass; flags: string[] } {
  if (simulated) return { taxClass: 'SIMULATED', flags: ['Simulated (evaluation / demo) account — not a real gain or loss.'] };
  if (group === 'revenue') return { taxClass: 'REVENUE_TRADING', flags: [] };
  if (group === 'unresolved') return { taxClass: 'REVIEW', flags: ['Account tax treatment not determined — classify the account (investor vs trader).'] };
  // capital-account holder of a derivative / short: treatment is not straightforward.
  if (kind === 'written_option_premium')
    return { taxClass: 'CGT_EVENT', flags: ['Written option premium treated as CGT event D2 (no discount). Later exercise/close may adjust — review.'] };
  if (kind === 'written_option_close') return { taxClass: 'REVIEW', flags: ['Closing a written option — capital loss treatment requires specialist review.'] };
  const cls = inst?.assetClass;
  return {
    taxClass: 'REVIEW',
    flags: [
      cls === 'cfd' || cls === 'future' || cls === 'forex'
        ? `${cls?.toUpperCase()} results held on capital account — gains on these contracts are commonly on revenue account (e.g. TR 2005/15 for CFDs). Specialist review required.`
        : 'Short sale on a capital account — treatment requires specialist review.'
    ]
  };
}

export interface DerivativeResult {
  realised: RealisedEvent[];
  open: OpenPosition[];
  issues: { txnId?: string; code: string; message: string }[];
}

export function runDerivativeEngine(data: LedgerData, opts: { includeSimulated: boolean } = { includeSimulated: true }): DerivativeResult {
  const accounts = new Map<string, Account>(data.accounts.map((a) => [a.id, a]));
  const instruments = new Map(data.instruments.map((i) => [i.id, i]));
  const books = new Map<string, { longs: OpenLeg[]; shorts: OpenLeg[]; inst: Instrument }>();
  const realised: RealisedEvent[] = [];
  const issues: DerivativeResult['issues'] = [];
  const statementKeys = new Set<string>();
  const closeKeys = new Set<string>();

  for (const t of sortTxns(data.transactions.filter((x) => x.status === 'active' && x.kind === 'trade'))) {
    const inst = t.instrumentId ? instruments.get(t.instrumentId) : undefined;
    const acct = t.accountId ? accounts.get(t.accountId) : undefined;
    const simulated = isSimulatedAccount(acct);
    if (simulated && !opts.includeSimulated) continue;
    const group = treatmentGroup(acct?.taxTreatment);
    const date = taxDateOf(t);
    const key = `${t.accountId ?? '-'}|${t.instrumentId ?? '-'}`;

    if (t.side === 'realised_pnl' || t.side === 'settlement' || t.side === 'financing') {
      const amt = D(t.amount); // signed: + profit / − loss or charge
      const kind = t.side === 'financing' ? 'financing' : 'statement_pnl';
      const cls = t.side === 'financing' && group !== 'revenue' && !simulated ? { taxClass: 'FINANCING_EXPENSE' as TaxClass, flags: ['Financing / swap charge — deductibility depends on the purpose of the position. Review.'] } : derivClass(group, inst, simulated, kind);
      const fN = feesNative(t);
      const fA = feesAud(t);
      const pA = audOf(t, amt);
      if (t.side !== 'financing') statementKeys.add(key);
      realised.push({
        id: `${t.id}:stmt`,
        txnId: t.id,
        openTxnIds: [],
        accountId: t.accountId,
        instrumentId: t.instrumentId,
        kind,
        date,
        fy: fyOfLocalDate(date),
        quantity: tryD(t.quantity) ?? ZERO,
        currency: t.currency,
        pnlNative: amt,
        feesNative: fN,
        pnlAud: pA,
        feesAud: fA,
        netAud: pA === null || fA === null ? null : pA.minus(fA),
        group,
        taxClass: cls.taxClass,
        simulated,
        flags: [...cls.flags, ...(pA === null ? ['MISSING_RATE: amount could not be converted to AUD.'] : [])]
      });
      continue;
    }

    if (!inst) continue;
    const isDeriv = DERIVATIVE_CLASSES.includes(inst.assetClass);
    const isShortFlow = t.side === 'short' || t.side === 'cover' || (inst.assetClass === 'option' && t.side === 'assign');
    if (!isDeriv && !isShortFlow) continue;
    if (!isDeriv && t.side === 'cover' && !books.get(key)?.shorts.length) continue;

    let book = books.get(key);
    if (!book) books.set(key, (book = { longs: [], shorts: [], inst }));
    const qty = tryD(t.quantity)?.abs() ?? ZERO;
    const price = tryD(t.price) ?? ZERO;
    const mult = multiplierOf(t, inst);
    const legFeesA = feesAud(t);
    const legFeesN = feesNative(t);

    // Written options: premium recognised on writing (D2) for capital accounts.
    if (inst.assetClass === 'option' && t.side === 'short' && group === 'capital' && !simulated) {
      const prem = qty.times(price).times(mult);
      const pA = audOf(t, prem);
      const cls = derivClass(group, inst, simulated, 'written_option_premium');
      realised.push({
        id: `${t.id}:D2`, txnId: t.id, openTxnIds: [t.id], accountId: t.accountId, instrumentId: inst.id, kind: 'written_option_premium', direction: 'short', date, fy: fyOfLocalDate(date),
        quantity: qty, currency: t.currency, pnlNative: prem, feesNative: legFeesN, pnlAud: pA, feesAud: legFeesA, netAud: pA === null || legFeesA === null ? null : pA.minus(legFeesA),
        group, taxClass: cls.taxClass, simulated, flags: cls.flags
      });
      book.shorts.push({ txn: t, qty, qtyOrig: qty, price: ZERO, feesAud: ZERO, feesNative: ZERO });
      continue;
    }
    if (inst.assetClass === 'option' && (t.side === 'cover' || t.side === 'assign' || t.side === 'expire') && group === 'capital' && !simulated && book.shorts.length) {
      let remaining = qty;
      const opens: string[] = [];
      while (remaining.gt(0) && book.shorts.length) {
        const leg = book.shorts[0];
        const q = Decimal.min(leg.qty, remaining);
        leg.qty = leg.qty.minus(q);
        remaining = remaining.minus(q);
        opens.push(leg.txn.id);
        if (leg.qty.lte(0)) book.shorts.shift();
      }
      const cost = t.side === 'cover' ? qty.times(price).times(mult) : ZERO;
      const cA = audOf(t, cost);
      const cls = t.side === 'expire' ? { taxClass: 'NON_TAXABLE' as TaxClass, flags: ['Written option expired — premium already recognised (D2).'] } : t.side === 'assign' ? { taxClass: 'REVIEW' as TaxClass, flags: ['Written option assigned — premium adjusts the underlying cost base / proceeds and the D2 gain may be reversed. Specialist review.'] } : derivClass(group, inst, simulated, 'written_option_close');
      realised.push({
        id: `${t.id}:close`, txnId: t.id, openTxnIds: opens, accountId: t.accountId, instrumentId: inst.id, kind: 'written_option_close', direction: 'short', date, fy: fyOfLocalDate(date),
        quantity: qty, currency: t.currency, pnlNative: cost.neg(), feesNative: legFeesN, pnlAud: cA === null ? null : cA.neg(), feesAud: legFeesA,
        netAud: cA === null || legFeesA === null ? null : cA.neg().minus(legFeesA), group, taxClass: cls.taxClass, simulated, flags: cls.flags
      });
      continue;
    }

    const opening = t.side === 'buy' ? 'long' : t.side === 'short' || t.side === 'sell' ? 'short' : t.side === 'cover' ? 'long' : null;
    if (!opening || qty.isZero()) {
      if (t.side === 'expire') issues.push({ txnId: t.id, code: 'REVIEW_DERIVATIVE', message: 'Expiry/settlement without price — record as a closing trade at the settlement price.' });
      continue;
    }
    // A buy closes shorts first; a sell/short closes longs first.
    const closingAgainst = opening === 'long' ? book.shorts : book.longs;
    let remaining = qty;
    const opens: string[] = [];
    let pnl = ZERO;
    let openFeesA: Decimal | null = ZERO;
    let openFeesN = ZERO;
    let closedQty = ZERO;
    while (remaining.gt(0) && closingAgainst.length) {
      const leg = closingAgainst[0];
      const q = Decimal.min(leg.qty, remaining);
      const dir = opening === 'long' ? -1 : 1; // closing a short: (entry − exit); closing a long: (exit − entry)
      const diff = dir === 1 ? price.minus(leg.price) : leg.price.minus(price);
      pnl = pnl.plus(diff.times(q).times(mult));
      const share = q.div(leg.qtyOrig);
      openFeesA = openFeesA === null || leg.feesAud === null ? null : openFeesA.plus(leg.feesAud.times(share));
      openFeesN = openFeesN.plus(leg.feesNative.times(share));
      leg.qty = leg.qty.minus(q);
      remaining = remaining.minus(q);
      closedQty = closedQty.plus(q);
      opens.push(leg.txn.id);
      if (leg.qty.lte(0)) closingAgainst.shift();
    }
    if (closedQty.gt(0)) {
      closeKeys.add(key);
      const share = closedQty.div(qty);
      const closeFeesA = legFeesA === null ? null : legFeesA.times(share);
      const closeFeesN = legFeesN.times(share);
      const pA = audOf(t, pnl);
      const fA = openFeesA === null || closeFeesA === null ? null : openFeesA.plus(closeFeesA);
      const cls = derivClass(group, inst, simulated, 'closed_position');
      realised.push({
        id: `${t.id}:close`,
        txnId: t.id,
        openTxnIds: opens,
        accountId: t.accountId,
        instrumentId: inst.id,
        kind: 'closed_position',
        direction: opening === 'long' ? 'short' : 'long',
        date,
        fy: fyOfLocalDate(date),
        quantity: closedQty,
        currency: t.currency,
        pnlNative: pnl,
        feesNative: openFeesN.plus(closeFeesN),
        pnlAud: pA,
        feesAud: fA,
        netAud: pA === null || fA === null ? null : pA.minus(fA),
        group,
        taxClass: cls.taxClass,
        simulated,
        flags: [...cls.flags, ...(pA === null || fA === null ? ['MISSING_RATE: P&L or fees could not be converted to AUD.'] : [])]
      });
    }
    if (remaining.gt(0)) {
      const share = remaining.div(qty);
      const leg: OpenLeg = { txn: t, qty: remaining, qtyOrig: remaining, price, feesAud: legFeesA === null ? null : legFeesA.times(share), feesNative: legFeesN.times(share) };
      (opening === 'long' ? book.longs : book.shorts).push(leg);
    }
  }

  for (const k of statementKeys) {
    if (closeKeys.has(k)) issues.push({ code: 'POSSIBLE_DOUBLE_COUNT', message: `Account/instrument ${k} has both statement P&L rows and matched trades — realised results may be double counted.` });
  }

  const open: OpenPosition[] = [];
  for (const [key, b] of books) {
    for (const [direction, legs] of [['long', b.longs], ['short', b.shorts]] as const) {
      const live = legs.filter((l) => l.qty.gt(0));
      if (!live.length) continue;
      const q = live.reduce((s, l) => s.plus(l.qty), ZERO);
      const avg = live.reduce((s, l) => s.plus(l.qty.times(l.price)), ZERO).div(q);
      open.push({ key, accountId: live[0].txn.accountId, instrumentId: b.inst.id, direction, quantity: q, avgEntry: avg, currency: live[0].txn.currency, openTxnIds: live.map((l) => l.txn.id) });
    }
  }
  return { realised, open, issues };
}
