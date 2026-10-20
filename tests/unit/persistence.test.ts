import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Dexie from 'dexie';
import { AppDB, SCHEMA_V1, setDb } from '../../src/db/schema';
import { saveTransaction, softDeleteTransactions, restoreTransactions, overrideRate, clearRateOverride, refreshAllConversions, ValidationError, saveEntity, bulkUpdateTransactions, reclassifyAll, deleteEntity, removeAccount, accountRecordCounts } from '../../src/services/ledger';
import { saveSettings, loadSettings } from '../../src/services/settings';
import { dropDb, freshDb } from './dbHelpers';
import { purgeDeleted } from '../../src/services/integrity';
import { D } from '../../src/lib/decimal';
import type { Account } from '../../src/domain/types';

let db: AppDB;
beforeEach(async () => {
  db = await freshDb();
});
afterEach(async () => dropDb(db));

const acct = (p: Partial<Account> = {}): Account => ({ id: 'acc1', name: 'Broker', type: 'au_broker', institution: 'X', currency: 'AUD', taxTreatment: 'investor_cgt', propStatus: 'none', createdAt: '', updatedAt: '', ...p });

describe('persistence and audit', () => {
  it('creates, updates (idempotently by id) and audits a record', async () => {
    const t = await saveTransaction({ kind: 'expense', date: '2024-08-01', description: 'Membership', category: 'memberships', amount: '450', currency: 'AUD' });
    expect(t.fy).toBe(2025);
    expect(t.taxClass).toBe('DEDUCTIBLE_EXPENSE');
    // Retrying the same save with the same id must not duplicate.
    await saveTransaction({ ...t, amount: '460' });
    await saveTransaction({ ...t, amount: '460' });
    expect(await db.transactions.count()).toBe(1);
    expect((await db.transactions.get(t.id))!.amount).toBe('460');
    const audit = await db.audit.where('entityId').equals(t.id).toArray();
    expect(audit.map((a) => a.action)).toEqual(['create', 'update']);
    expect(audit[1].before).toEqual({ amount: '450' });
  });
  it('survives closing and reopening the database', async () => {
    const t = await saveTransaction({ kind: 'income', date: '2024-08-01', description: 'Salary', category: 'salary', amount: '1000', currency: 'AUD' });
    db.close();
    const reopened = new AppDB(db.name);
    setDb(reopened);
    await reopened.open();
    expect((await reopened.transactions.get(t.id))!.description).toBe('Salary');
    db = reopened;
  });
  it('rejects invalid records with actionable messages', async () => {
    await expect(saveTransaction({ kind: 'expense', date: '2024-13-01', category: '', amount: '-5', currency: 'AUD' })).rejects.toBeInstanceOf(ValidationError);
    try {
      await saveTransaction({ kind: 'trade', date: '2024-08-01', side: 'buy', currency: 'AUD' });
    } catch (e) {
      expect((e as ValidationError).errors).toEqual(expect.arrayContaining(['Account is required.', 'Instrument is required.']));
    }
    expect(await db.transactions.count()).toBe(0);
  });
  it('soft delete and undo', async () => {
    const t = await saveTransaction({ kind: 'income', date: '2024-08-01', description: 'x', category: 'other', amount: '1', currency: 'AUD' });
    await softDeleteTransactions([t.id]);
    expect((await db.transactions.get(t.id))!.status).toBe('deleted');
    await restoreTransactions([t.id]);
    expect((await db.transactions.get(t.id))!.status).toBe('active');
  });
  it('resolves historical FX on save, flags missing rates, and refreshes after rates are added', async () => {
    const t = await saveTransaction({ kind: 'expense', date: '2024-09-12', description: 'USD sub', category: 'software', amount: '39', currency: 'USD' });
    expect(t.fx).toBeUndefined();
    await db.rates.add({ id: 'r1', base: 'AUD', quote: 'USD', rate: '0.65', date: '2024-09-12', type: 'daily_reference', source: 'Test', createdAt: '2024-01-01' });
    await db.meta.put({ key: 'ratesRevision', value: 99 });
    const res = await refreshAllConversions('test');
    expect(res.updated).toBe(1);
    const after = await db.transactions.get(t.id);
    expect(D(after!.fx!.audPerUnit).toFixed(10)).toBe(D(1).div('0.65').toFixed(10));
    expect(after!.fx!.rateRecordIds).toEqual(['r1']);
  });
  it('manual rate overrides need source + reason, keep history, and can be removed', async () => {
    await db.rates.add({ id: 'r1', base: 'AUD', quote: 'USD', rate: '0.65', date: '2024-09-12', type: 'daily_reference', source: 'Test', createdAt: '2024-01-01' });
    await db.meta.put({ key: 'ratesRevision', value: 5 });
    const t = await saveTransaction({ kind: 'expense', date: '2024-09-12', description: 'USD sub', category: 'software', amount: '39', currency: 'USD' });
    await expect(overrideRate(t.id, { rate: '0.66', direction: 'UNITS_PER_AUD', source: 'Card statement', reason: '' })).rejects.toThrow();
    const o = await overrideRate(t.id, { rate: '0.66', direction: 'UNITS_PER_AUD', source: 'Card statement', reason: 'Bank applied rate' });
    expect(o.fx!.isManualOverride).toBe(true);
    expect(o.fxHistory).toHaveLength(1);
    // A refresh must not replace a manual override.
    await refreshAllConversions('test');
    expect((await db.transactions.get(t.id))!.fx!.isManualOverride).toBe(true);
    const c = await clearRateOverride(t.id, 'Use daily rate');
    expect(c.fx!.rateRecordIds).toEqual(['r1']);
    expect(c.fxHistory!.length).toBe(2);
    expect((await db.audit.filter((a) => a.action === 'fx_override').count())).toBe(2);
  });
  it('derives FY from the taxpayer time zone for overseas trades and preserves the original zone', async () => {
    await saveEntity('accounts', acct());
    await saveEntity('instruments', { id: 'ins1', symbol: 'DEMOU', name: 'Demo', assetClass: 'us_share', currency: 'USD', createdAt: '', updatedAt: '' });
    const t = await saveTransaction({ kind: 'trade', side: 'sell', accountId: 'acc1', instrumentId: 'ins1', date: '2026-06-30', time: '3:00 PM', timeZone: 'America/New_York', quantity: '1', price: '10', currency: 'USD' });
    expect(t.occurredAt).toBe('2026-06-30T19:00:00Z');
    expect(t.date).toBe('2026-07-01');
    expect(t.fy).toBe(2027);
    expect(t.timeZone).toBe('America/New_York');
  });
  it('re-classifies records when the account tax treatment changes (unless user-set)', async () => {
    await saveEntity('accounts', acct({ taxTreatment: 'unresolved' }));
    await saveEntity('instruments', { id: 'ins1', symbol: 'DEMOA', name: 'Demo', assetClass: 'au_share', currency: 'AUD', createdAt: '', updatedAt: '' });
    const t = await saveTransaction({ kind: 'trade', side: 'buy', accountId: 'acc1', instrumentId: 'ins1', date: '2024-08-01', quantity: '1', price: '10', currency: 'AUD' });
    expect(t.taxClass).toBe('REVIEW');
    await saveEntity('accounts', acct({ taxTreatment: 'business_trader' }));
    expect(await reclassifyAll()).toBe(1);
    expect((await db.transactions.get(t.id))!.taxClass).toBe('REVENUE_TRADING');
  });
  it('bulk updates multiple records in one transaction', async () => {
    const a = await saveTransaction({ kind: 'expense', date: '2024-08-01', description: 'a', category: 'other', amount: '1', currency: 'AUD' });
    const b = await saveTransaction({ kind: 'expense', date: '2024-08-02', description: 'b', category: 'other', amount: '2', currency: 'AUD' });
    expect(await bulkUpdateTransactions([a.id, b.id], { category: 'software', isBusiness: true }, 'recategorise')).toBe(2);
    expect((await db.transactions.get(b.id))!.taxClass).toBe('BUSINESS_EXPENSE');
  });
  it('settings round-trip', async () => {
    await saveSettings({ timeFormat: '24h', selectedFY: 2025 });
    const s = await loadSettings();
    expect(s.timeFormat).toBe('24h');
    expect(s.rateMethodology.maxLookbackDays).toBe(4);
  });
});

describe('database migrations', () => {
  it('migrates a v1 database to v2 preserving records and backfilling fields', async () => {
    const name = `mig-${Date.now()}`;
    const v1 = new Dexie(name);
    v1.version(1).stores(SCHEMA_V1);
    await v1.open();
    await v1.table('transactions').add({ id: 'old1', kind: 'income', fy: 2024, date: '2024-01-01', description: 'legacy', amount: '5', currency: 'AUD', category: 'other', taxClass: 'ORDINARY_INCOME' });
    v1.close();
    const v2 = new AppDB(name);
    await v2.open();
    expect(v2.verno).toBe(2);
    const t = await v2.transactions.get('old1');
    expect(t!.description).toBe('legacy');
    expect(t!.tags).toEqual([]);
    expect(t!.reviewFlags).toEqual([]);
    expect(t!.version).toBe(1);
    expect(t!.status).toBe('active');
    expect(await v2.transactions.where('[fy+date]').equals([2024, '2024-01-01']).count()).toBe(1);
    expect(await v2.audit.filter((a) => a.action === 'migrate').count()).toBe(1);
    v2.close();
    await Dexie.delete(name);
  });
});

describe('deleting accounts never orphans records', () => {
  const src = (id: string) => acct({ id, name: 'CPA network', type: 'income_source', taxTreatment: 'not_applicable' });
  it('an account without records is deleted completely', async () => {
    await saveEntity('accounts', src('a1'));
    expect(await removeAccount('a1', 'delete_records')).toBe('deleted');
    expect(await db.accounts.get('a1')).toBeUndefined();
  });
  it('"hide" keeps the records counting; "delete with records" moves them to Deleted and they can be restored', async () => {
    await saveEntity('accounts', src('a2'));
    const t1 = await saveTransaction({ kind: 'income', date: '2024-08-01', description: 'Payout', category: 'business', amount: '100', currency: 'AUD', accountId: 'a2' });
    const t2 = await saveTransaction({ kind: 'income', date: '2025-08-01', description: 'Payout 2', category: 'business', amount: '50', currency: 'AUD', accountId: 'a2' });
    expect(await removeAccount('a2', 'hide')).toBe('hidden');
    expect((await db.accounts.get('a2'))!.archived).toBe(true);
    expect((await db.transactions.get(t1.id))!.status).toBe('active');
    expect(await removeAccount('a2', 'delete_records')).toBe('deleted');
    expect(await accountRecordCounts('a2')).toEqual({ active: 0, deleted: 2 });
    const gone = (await db.accounts.get('a2'))!; // kept only so restored records still have their account
    expect(gone.deletedAt).toBeTruthy();
    expect(gone.archived).toBe(true);
    // Restoring a record brings the account back.
    await restoreTransactions([t1.id, t2.id]);
    expect((await db.transactions.get(t2.id))!.accountId).toBe('a2');
    const back = (await db.accounts.get('a2'))!;
    expect(back.deletedAt).toBeUndefined();
    expect(back.archived).toBe(false);
  });
  it('a hidden account can be deleted, and purging deleted records removes it for good', async () => {
    await saveEntity('accounts', src('a4'));
    await saveTransaction({ kind: 'income', date: '2024-08-01', description: 'Payout', category: 'business', amount: '100', currency: 'AUD', accountId: 'a4' });
    await removeAccount('a4', 'hide');
    expect(await removeAccount('a4', 'delete_records')).toBe('deleted');
    expect((await db.accounts.get('a4'))!.deletedAt).toBeTruthy();
    await purgeDeleted();
    expect(await db.accounts.get('a4')).toBeUndefined();
  });
  it('the generic delete refuses an account that still has records', async () => {
    await saveEntity('accounts', src('a3'));
    await saveTransaction({ kind: 'income', date: '2024-08-01', description: 'Payout', category: 'business', amount: '100', currency: 'AUD', accountId: 'a3' });
    await expect(deleteEntity('accounts', 'a3')).rejects.toThrow(/has 1 record/);
    expect(await db.accounts.get('a3')).toBeDefined();
  });
});
