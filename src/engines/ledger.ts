/** Shared helpers for engines: AUD valuation of transaction amounts with explicit "unknown" (null). */
import { D, Decimal, tryD } from '../lib/decimal';
import type { Instrument, Transaction } from '../domain/types';

export interface LedgerData {
  transactions: Transaction[];
  accounts: import('../domain/types').Account[];
  instruments: Instrument[];
  corporateActions: import('../domain/types').CorporateAction[];
}

export const ZERO = new Decimal(0);

/** AUD value of an amount in the transaction's currency. null = unknown (missing rate). */
export function audOf(t: Transaction, amount: string | Decimal | undefined | null): Decimal | null {
  if (amount === undefined || amount === null || amount === '') return ZERO;
  const a = D(amount);
  if (a.isZero()) return ZERO;
  if (t.currency.toUpperCase() === 'AUD') return a;
  if (!t.fx) return null;
  return a.times(D(t.fx.audPerUnit));
}

/** AUD value of fees (may be in a separate fee currency). */
export function feesAud(t: Transaction): Decimal | null {
  const total = feesNative(t);
  if (total.isZero()) return ZERO;
  const fc = (t.feeCurrency || t.currency).toUpperCase();
  if (fc === 'AUD') return total;
  if (fc === t.currency.toUpperCase()) return audOf(t, total);
  if (!t.feeFx) return null;
  return total.times(D(t.feeFx.audPerUnit));
}

export function feesNative(t: Transaction): Decimal {
  return D(t.commission).plus(D(t.exchangeFees)).plus(D(t.otherFees));
}

export function needsFx(t: Transaction): boolean {
  return t.currency.toUpperCase() !== 'AUD';
}

export function multiplierOf(t: Transaction, inst?: Instrument): Decimal {
  const m = tryD(t.multiplier) ?? tryD(inst?.multiplier);
  return m && !m.isZero() ? m : new Decimal(1);
}

/** Gross consideration in the transaction currency: explicit amount, else qty × price × multiplier. */
export function grossOf(t: Transaction, inst?: Instrument): Decimal {
  const amt = tryD(t.amount);
  if (amt && !amt.isZero()) return amt.abs();
  const q = tryD(t.quantity);
  const p = tryD(t.price);
  if (q && p) return q.abs().times(p).times(multiplierOf(t, inst));
  return new Decimal(0);
}

export function addOrNull(a: Decimal | null, b: Decimal | null): Decimal | null {
  return a === null || b === null ? null : a.plus(b);
}

export function sortTxns(txns: Transaction[]): Transaction[] {
  return [...txns].sort((a, b) =>
    a.occurredAt < b.occurredAt ? -1 : a.occurredAt > b.occurredAt ? 1 : a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  );
}

/** Date used for tax: explicit tax event date override, otherwise the taxpayer-local transaction date. */
export function taxDateOf(t: Transaction): string {
  return t.taxEventDate || t.date;
}
