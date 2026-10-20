/** Start again: deleting chosen groups of data, or everything. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppDB } from '../../src/db/schema';
import type { Account } from '../../src/domain/types';
import { saveEntity, saveTransaction } from '../../src/services/ledger';
import { saveSettings, loadSettings, setSetting, getSetting } from '../../src/services/settings';
import { ensureSeeded } from '../../src/services/bootstrap';
import { normaliseGroups, resetData } from '../../src/services/reset';
import { dropDb, freshDb } from './dbHelpers';

let db: AppDB;
beforeEach(async () => {
  db = await freshDb();
  await ensureSeeded();
  const acc: Account = { id: 'nab', name: 'NAB', type: 'bank', institution: 'NAB', currency: 'AUD', taxTreatment: 'not_applicable', propStatus: 'none', createdAt: '', updatedAt: '' };
  await saveEntity('accounts', acc);
  await saveTransaction({ kind: 'income', date: '2024-08-01', description: 'Payout', category: 'business', amount: '100', currency: 'AUD', accountId: 'nab' });
  await saveEntity('taxProfiles', { id: 'tp_2025', fy: 2025, residency: 'resident', medicareExemption: 'none', privateHospitalCover: 'yes', spouse: 'no', helpDebt: 'no', updatedAt: '' });
  await db.rates.add({ id: 'r1', base: 'AUD', quote: 'USD', rate: '0.65', date: '2024-08-01', type: 'daily_reference', source: 'RBA', createdAt: '' });
  await saveSettings({ uiMode: 'advanced' });
  await setSetting('classificationRules', [{ id: 'x' }]);
});
afterEach(async () => dropDb(db));

describe('reset', () => {
  it('deleting accounts always deletes the records that point at them', () => {
    expect(normaliseGroups(['accounts'])).toEqual(['records', 'accounts']);
  });
  it('records only: transactions go; accounts, tax answers, rates and settings stay; the reset is logged', async () => {
    await resetData(['records']);
    expect(await db.transactions.count()).toBe(0);
    expect(await db.accounts.count()).toBe(1);
    expect(await db.taxProfiles.count()).toBe(1);
    expect(await db.rates.count()).toBe(1);
    expect((await loadSettings()).uiMode).toBe('advanced');
    expect((await db.audit.toArray()).some((a) => a.summary.startsWith('Reset: deleted transactions & records'))).toBe(true);
  });
  it('everything: back to a first launch — defaults, built-in categories and templates only, empty history', async () => {
    const builtinCats = await db.categories.count();
    const n = await resetData(['records', 'accounts', 'tax', 'rates', 'settings']);
    expect(n).toBeGreaterThan(0);
    for (const t of ['transactions', 'accounts', 'taxProfiles', 'rates', 'audit', 'documents', 'importBatches']) expect(await (db as any)[t].count()).toBe(0);
    expect(await db.categories.count()).toBe(builtinCats);
    expect(await db.importTemplates.count()).toBeGreaterThan(0);
    expect((await loadSettings()).uiMode).toBe('simple');
    expect(await getSetting('classificationRules', [])).toEqual([]);
  });
});
