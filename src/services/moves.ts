/**
 * Moving money between your own accounts (bank → bank, bank → PayPal, bank → broker…). Like a "transfer" in
 * Xero or QuickBooks it is entered once — from, to, date, amount, optional note — and is never income, an
 * expense or a sale. It is stored as two linked records (out of one account, into the other), classified
 * as an own transfer, so each account's history stays complete.
 */
import { getDb } from '../db/schema';
import type { Transaction } from '../domain/types';
import { D } from '../lib/decimal';
import { newId } from '../lib/ids';
import { saveTransaction, softDeleteTransactions } from './ledger';

/** A money move: an own transfer of money (no instrument) linked to its other half. */
export const isMoneyMove = (t: Pick<Transaction, 'kind' | 'instrumentId' | 'transferPairId'>) => t.kind === 'transfer' && !t.instrumentId && !!t.transferPairId;

export interface MoveInput {
  /** The "out" record id when editing an existing move. */
  outId?: string;
  inId?: string;
  fromAccountId: string;
  toAccountId: string;
  date: string;
  amount: string;
  currency: string;
  note?: string;
  timeZone: string;
}

export interface Move extends MoveInput {
  outId: string;
  inId: string;
}

/** Both halves of a move from either record. */
export async function loadMove(t: Transaction): Promise<Move | null> {
  if (!isMoneyMove(t)) return null;
  const other = await getDb().transactions.get(t.transferPairId!);
  if (!other) return null;
  const out = t.side === 'send' ? t : other;
  const inn = t.side === 'send' ? other : t;
  return { outId: out.id, inId: inn.id, fromAccountId: out.accountId ?? '', toAccountId: inn.accountId ?? '', date: out.date, amount: out.amount, currency: out.currency, note: out.notes, timeZone: out.timeZone };
}

export async function saveMove(m: MoveInput): Promise<Move> {
  if (!m.fromAccountId || !m.toAccountId) throw new Error('Choose both accounts.');
  if (m.fromAccountId === m.toAccountId) throw new Error('Choose two different accounts.');
  if (!m.amount || !D(m.amount).gt(0)) throw new Error('Enter an amount above zero.');
  const db = getDb();
  const [from, to] = await Promise.all([db.accounts.get(m.fromAccountId), db.accounts.get(m.toAccountId)]);
  if (!from || !to) throw new Error('Account not found.');
  const outId = m.outId ?? newId('txn');
  const inId = m.inId ?? newId('txn');
  const note = m.note?.trim() || undefined;
  const common: Partial<Transaction> = {
    kind: 'transfer',
    date: m.date,
    amount: m.amount,
    currency: m.currency.toUpperCase(),
    category: 'transfer',
    isOwnTransfer: true,
    taxClass: 'TRANSFER_NO_DISPOSAL',
    taxClassSource: 'user',
    timeZone: m.timeZone,
    notes: note,
    tags: ['move'],
    documentIds: [],
    source: 'manual'
  };
  await saveTransaction({ ...common, id: outId, side: 'send', accountId: from.id, description: `Moved to ${to.name}${note ? ` — ${note}` : ''}`, transferPairId: inId, relatedIds: [inId] });
  await saveTransaction({ ...common, id: inId, side: 'receive', accountId: to.id, description: `Moved from ${from.name}${note ? ` — ${note}` : ''}`, transferPairId: outId, relatedIds: [outId] });
  return { ...m, outId, inId };
}

/** Deletes both halves (restorable from All transactions → Show deleted). */
export async function deleteMove(m: Pick<Move, 'outId' | 'inId'>): Promise<true> {
  await softDeleteTransactions([m.outId, m.inId], 'Money move deleted');
  return true;
}
