/** Moving money between your own accounts: one entry, two linked records, never income or an expense. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppDB } from '../../src/db/schema';
import type { Account } from '../../src/domain/types';
import { saveEntity } from '../../src/services/ledger';
import { deleteMove, isMoneyMove, loadMove, saveMove } from '../../src/services/moves';
import { computeYear, qualityIssues } from '../../src/services/calc';
import { dropDb, freshDb } from './dbHelpers';

let db: AppDB;
beforeEach(async () => {
  db = await freshDb();
});
afterEach(async () => dropDb(db));

const bank = (id: string, name: string): Account => ({ id, name, type: 'bank', institution: name, currency: 'AUD', taxTreatment: 'not_applicable', propStatus: 'none', createdAt: '', updatedAt: '' });
const base = { fromAccountId: 'nab', toAccountId: 'cba', date: '2024-10-01', amount: '500', currency: 'AUD', timeZone: 'Australia/Sydney' };

describe('money moves', () => {
  beforeEach(async () => {
    await saveEntity('accounts', bank('nab', 'NAB'));
    await saveEntity('accounts', bank('cba', 'CommBank'));
  });

  it('creates two linked own-transfer records that change no tax figures and raise no issues', async () => {
    const m = await saveMove({ ...base, note: 'savings' });
    const out = (await db.transactions.get(m.outId))!;
    const inn = (await db.transactions.get(m.inId))!;
    expect([out.side, out.accountId, inn.side, inn.accountId]).toEqual(['send', 'nab', 'receive', 'cba']);
    expect(out.transferPairId).toBe(inn.id);
    expect(inn.transferPairId).toBe(out.id);
    expect(out.taxClass).toBe('TRANSFER_NO_DISPOSAL');
    expect(out.description).toBe('Moved to CommBank — savings');
    expect(inn.description).toBe('Moved from NAB — savings');
    expect(isMoneyMove(out) && isMoneyMove(inn)).toBe(true);
    const r = await computeYear(2025);
    expect(r.income.every((l) => l.amount === null || Number(l.amount) === 0)).toBe(true);
    expect(r.totals.deductions === null || Number(r.totals.deductions) === 0).toBe(true);
    expect((await qualityIssues(2025)).map((i) => i.code)).not.toContain('UNMATCHED_TRANSFER');
  });

  it('edits both halves from either record, and deletes both', async () => {
    const m = await saveMove(base);
    const loaded = (await loadMove((await db.transactions.get(m.inId))!))!;
    expect(loaded).toMatchObject({ outId: m.outId, inId: m.inId, fromAccountId: 'nab', toAccountId: 'cba', amount: '500' });
    await saveMove({ ...loaded, amount: '750', fromAccountId: 'cba', toAccountId: 'nab' });
    expect(await db.transactions.count()).toBe(2);
    const out = (await db.transactions.get(m.outId))!;
    expect([out.amount, out.accountId, out.description]).toEqual(['750', 'cba', 'Moved to NAB']);
    await deleteMove(loaded);
    expect((await db.transactions.toArray()).every((t) => t.status === 'deleted')).toBe(true);
  });

  it('refuses the same account twice or a zero amount', async () => {
    await expect(saveMove({ ...base, toAccountId: 'nab' })).rejects.toThrow(/different accounts/);
    await expect(saveMove({ ...base, amount: '0' })).rejects.toThrow(/above zero/);
  });
});
