import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppDB } from '../../src/db/schema';
import { parseCsv, parseWhen, detectDateFormat, prepareRows, normaliseSide } from '../../src/import/transform';
import { autoMap } from '../../src/import/fields';
import { detectTemplate, wideRatesToLong, BUILTIN_TEMPLATES } from '../../src/import/templates';
import { importWithTemplate, previewWithTemplate } from '../../src/import/service';
import { rollbackImport, editedSinceImport } from '../../src/import/commit';
import { saveEntity, saveTransaction } from '../../src/services/ledger';
import { dropDb, freshDb, sample } from './dbHelpers';
import type { Account } from '../../src/domain/types';

let db: AppDB;
beforeEach(async () => {
  db = await freshDb();
  const now = new Date().toISOString();
  const a = (id: string, type: Account['type'], currency = 'AUD', taxTreatment: Account['taxTreatment'] = 'investor_cgt'): Account => ({ id, name: id, type, institution: 'x', currency, taxTreatment, propStatus: 'none', createdAt: now, updatedAt: now });
  await saveEntity('accounts', a('au', 'au_broker'));
  await saveEntity('accounts', a('cx', 'crypto_exchange'));
  await saveEntity('accounts', a('bank', 'bank', 'AUD', 'not_applicable'));
});
afterEach(async () => dropDb(db));

describe('CSV parsing and mapping', () => {
  it('parses quoted fields, BOM and keeps extra columns', () => {
    const p = parseCsv('﻿Date,Desc,Amount\n01/02/2025,"Coffee, large",4.50,EXTRA\n');
    expect(p.headers).toEqual(['Date', 'Desc', 'Amount']);
    expect(p.rows[0].Desc).toBe('Coffee, large');
    expect(p.rows[0].__extra).toBe('EXTRA');
  });
  it('parses dates in several formats and exact ISO instants', () => {
    expect(parseWhen('31/12/2024', undefined, 'auto', 'Australia/Sydney')).toEqual({ date: '2024-12-31', time: undefined, exact: false });
    expect(parseWhen('12/31/2024', '2:30 PM', 'MM/dd/yyyy', 'America/New_York')).toEqual({ date: '2024-12-31', time: '14:30:00', exact: false });
    expect(parseWhen('2024-07-05T02:00:00Z', undefined, 'auto', 'Australia/Sydney')).toEqual({ date: '2024-07-05', time: '12:00:00', exact: true });
    expect(() => parseWhen('31/31/2024', undefined, 'dd/MM/yyyy', 'UTC')).toThrow();
  });
  it('detects day-first vs month-first ambiguity', () => {
    expect(detectDateFormat(['13/01/2025']).suggestion).toBe('dd/MM/yyyy');
    expect(detectDateFormat(['01/13/2025']).suggestion).toBe('MM/dd/yyyy');
    expect(detectDateFormat(['01/02/2025']).ambiguous).toBe(true);
  });
  it('auto-maps common broker headers and normalises sides', () => {
    const m = autoMap('trade', ['Trade Date', 'Ticker', 'Action', 'Qty', 'Price', 'Brokerage', 'Currency']);
    expect(m).toMatchObject({ date: 'Trade Date', symbol: 'Ticker', side: 'Action', quantity: 'Qty', price: 'Price', commission: 'Brokerage', currency: 'Currency' });
    expect(normaliseSide('Buy to Cover')).toBe('cover');
    expect(normaliseSide('Staking Reward')).toBe('income');
    expect(normaliseSide('weird')).toBeNull();
  });
  it('detects a built-in template from headers', () => {
    const headers = parseCsv(sample('shares.csv')).headers;
    expect(detectTemplate(headers, BUILTIN_TEMPLATES as any)!.id).toBe('tpl_builtin_shares');
  });
  it('converts a wide rate table to long format with explicit direction', () => {
    const long = wideRatesToLong([{ Date: '2025-01-02', USD: '0.6200', EUR: '0.6000', Note: 'x' }], 'Date', 'units_per_aud', 'Published table');
    expect(long).toEqual([
      { Date: '2025-01-02', Base: 'AUD', Quote: 'USD', Rate: '0.6200', Source: 'Published table', Type: 'daily_reference' },
      { Date: '2025-01-02', Base: 'AUD', Quote: 'EUR', Rate: '0.6000', Source: 'Published table', Type: 'daily_reference' }
    ]);
  });
  it('rejects bad rows with reasons and never discards them silently', () => {
    const tpl = BUILTIN_TEMPLATES.find((t) => t.id === 'tpl_builtin_income')!;
    const rows = prepareRows(parseCsv('Date,Description,Category,Payer,Amount,Currency,Tax Withheld,Reference\nnot-a-date,x,salary,y,abc,AUD,0,R1\n').rows, { target: 'income', template: tpl, defaultCurrency: 'AUD' });
    expect(rows).toHaveLength(1);
    expect(rows[0].errors.length).toBeGreaterThan(0);
    expect(rows[0].action).toBe('skip');
  });
});

describe('import commit, duplicates and rollback', () => {
  it('imports a share file, then re-importing the same file creates no duplicates', async () => {
    const text = sample('shares.csv');
    const b1 = await importWithTemplate(text, 'shares.csv', 'tpl_builtin_shares', 'au');
    expect(b1.counts).toMatchObject({ created: 5, rejected: 0 });
    expect(await db.rawRows.where('batchId').equals(b1.id).count()).toBe(5);
    const b2 = await importWithTemplate(text, 'shares.csv', 'tpl_builtin_shares', 'au');
    expect(b2.counts).toMatchObject({ created: 0, skipped: 5 });
    expect(await db.transactions.count()).toBe(5);
    // Instruments are created once
    expect(await db.instruments.count()).toBe(2);
    const us = await db.transactions.filter((t) => t.sourceId === 'SH-005').first();
    expect(us!.timeZone).toBe('America/New_York');
    expect(us!.date).toBe('2025-03-07'); // 3:30 PM NY on 6 Mar = 7 Mar Sydney
  });
  it('identical rows within one file are kept as separate trades (occurrence fingerprint)', async () => {
    const csv = 'Trade Date,Time,Time Zone,Type,Symbol,Security Name,Asset Class,Exchange,Quantity,Price,Brokerage,Currency,Reference\n' + '01/08/2024,10:00 AM,Australia/Sydney,Buy,DEMOA,Demo,au_share,ASX,10,5,0,AUD,\n'.repeat(2);
    const b = await importWithTemplate(csv, 'fills.csv', 'tpl_builtin_shares', 'au');
    expect(b.counts.created).toBe(2);
    const again = await importWithTemplate(csv, 'fills.csv', 'tpl_builtin_shares', 'au');
    expect(again.counts.skipped).toBe(2);
  });
  it('detects a manual record duplicated by an import fingerprint only when identical', async () => {
    const preview = await previewWithTemplate(sample('income.csv'), (await db.importTemplates.get('tpl_builtin_income'))!, 'bank');
    expect(preview.rows.every((r) => r.dupStatus === 'new')).toBe(true);
  });
  it('flags changed values for the same source id and allows update', async () => {
    const tpl = (await db.importTemplates.get('tpl_builtin_income'))!;
    await importWithTemplate(sample('income.csv'), 'income.csv', tpl.id, 'bank');
    const changed = sample('income.csv').replace('7500.00,AUD,1650.00,PAY-2407', '7600.00,AUD,1650.00,PAY-2407');
    const p = await previewWithTemplate(changed, tpl, 'bank');
    const row = p.rows.find((r) => r.partial?.sourceId === 'PAY-2407')!;
    expect(row.dupStatus).toBe('changed_source');
  });
  it('rolls back an import completely, including instruments it created', async () => {
    const b = await importWithTemplate(sample('crypto_trades.csv'), 'crypto.csv', 'tpl_builtin_crypto', 'cx');
    expect(b.counts.created).toBe(4);
    expect(await db.instruments.count()).toBe(2);
    expect(await editedSinceImport(b.id)).toBe(0);
    const r = await rollbackImport(b.id);
    expect(r.removed).toBe(4);
    expect(await db.transactions.count()).toBe(0);
    expect(await db.instruments.count()).toBe(0);
    expect((await db.importBatches.get(b.id))!.status).toBe('rolled_back');
  });
  it('a failing batch write leaves no partial data (atomic)', async () => {
    const tpl = (await db.importTemplates.get('tpl_builtin_income'))!;
    const { rows } = await previewWithTemplate(sample('income.csv'), tpl, 'bank');
    const { commitImport } = await import('../../src/import/commit');
    // Force a constraint error: pre-insert a raw row id collision is impractical; instead make transactions.bulkAdd fail via duplicate primary key.
    const first = await saveTransaction({ kind: 'income', date: '2024-07-31', description: 'x', category: 'other', amount: '1', currency: 'AUD' });
    const orig = db.transactions.bulkAdd.bind(db.transactions);
    (db.transactions as any).bulkAdd = (items: any[]) => orig([...items, { ...first }]);
    const before = await db.transactions.count();
    await expect(commitImport({ filename: 'x.csv', fileText: 'x', target: 'income', template: tpl, rows })).rejects.toThrow();
    (db.transactions as any).bulkAdd = orig;
    expect(await db.transactions.count()).toBe(before);
    expect(await db.importBatches.count()).toBe(0);
    expect(await db.rawRows.count()).toBe(0);
  });
  it('imports historical rates and skips duplicate rate rows', async () => {
    const b = await importWithTemplate(sample('rates.csv'), 'rates.csv', 'tpl_builtin_rates');
    expect(b.counts.created).toBeGreaterThan(10);
    const again = await importWithTemplate(sample('rates.csv'), 'rates.csv', 'tpl_builtin_rates');
    expect(again.counts.created).toBe(0);
    const r = await db.rates.toArray();
    expect(r.every((x) => x.source.startsWith('DEMO'))).toBe(true);
  });
  it('a broker-supplied execution rate is pinned on the transaction', async () => {
    const csv = 'Trade Date,Type,Symbol,Asset Class,Quantity,Price,Brokerage,Currency,FX Rate\n05/03/2025,Buy,DEMOU,us_share,1,100,0,USD,1.55\n';
    const tpl = { ...(await db.importTemplates.get('tpl_builtin_shares'))!, mapping: { date: 'Trade Date', side: 'Type', symbol: 'Symbol', assetClass: 'Asset Class', quantity: 'Quantity', price: 'Price', commission: 'Brokerage', currency: 'Currency', fxRate: 'FX Rate' }, id: 'tpl_x', builtin: false };
    await db.importTemplates.put(tpl);
    await importWithTemplate(csv, 'x.csv', 'tpl_x', 'au');
    const t = (await db.transactions.toArray())[0];
    expect(t.fx!.rateType).toBe('execution');
    expect(t.fx!.audPerUnit).toBe('1.55');
  });
});
