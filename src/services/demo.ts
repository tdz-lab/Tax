/**
 * Demonstration data: FICTIONAL records loaded through the normal import pipeline and clearly marked
 * (isDemo, tag "DEMO", "[DEMO]" descriptions, "DEMO fictional rate" sources). Removable in one action.
 */
import { getDb } from '../db/schema';
import { newId } from '../lib/ids';
import { nowIso } from '../lib/dates';
import type { Account } from '../domain/types';
import { importWithTemplate } from '../import/service';
import { bumpRevision, invalidateRateCache, refreshAllConversions, saveEntity, writeAudit } from './ledger';

type Fetcher = (file: string) => Promise<string>;

const browserFetcher: Fetcher = async (file) => {
  const res = await fetch(`./samples/${file}`);
  if (!res.ok) throw new Error(`Sample file ${file} unavailable (${res.status})`);
  return res.text();
};

const ACCOUNTS: Omit<Account, 'createdAt' | 'updatedAt'>[] = [
  { id: 'acc_demo_au', name: 'DEMO AU Broker', type: 'au_broker', institution: 'Demo Broker (fictional)', currency: 'AUD', taxTreatment: 'investor_cgt', propStatus: 'none', isDemo: true },
  { id: 'acc_demo_us', name: 'DEMO US Broker', type: 'us_broker', institution: 'Demo US Broker (fictional)', currency: 'USD', taxTreatment: 'investor_cgt', propStatus: 'none', isDemo: true },
  { id: 'acc_demo_cx', name: 'DEMO Crypto Exchange', type: 'crypto_exchange', institution: 'Demo Exchange (fictional)', currency: 'AUD', taxTreatment: 'investor_cgt', propStatus: 'none', isDemo: true },
  { id: 'acc_demo_wallet', name: 'DEMO Wallet', type: 'crypto_wallet', institution: 'Self-custody (fictional)', currency: 'AUD', taxTreatment: 'investor_cgt', propStatus: 'none', isDemo: true },
  { id: 'acc_demo_fx', name: 'DEMO Forex', type: 'forex', institution: 'Demo FX (fictional)', currency: 'USD', taxTreatment: 'unresolved', propStatus: 'none', isDemo: true },
  { id: 'acc_demo_fut', name: 'DEMO Futures', type: 'futures', institution: 'Demo Futures (fictional)', currency: 'USD', taxTreatment: 'business_trader', propStatus: 'none', isDemo: true },
  { id: 'acc_demo_opt', name: 'DEMO Options', type: 'options', institution: 'Demo US Broker (fictional)', currency: 'USD', taxTreatment: 'investor_cgt', propStatus: 'none', isDemo: true },
  { id: 'acc_demo_cfd', name: 'DEMO CFD', type: 'cfd', institution: 'Demo CFD (fictional)', currency: 'AUD', taxTreatment: 'unresolved', propStatus: 'none', isDemo: true },
  { id: 'acc_demo_prop', name: 'DEMO Prop Firm', type: 'prop_funded', institution: 'Demo Prop Firm LLC (fictional)', currency: 'USD', taxTreatment: 'unresolved', propStatus: 'funded_live', isDemo: true },
  { id: 'acc_demo_bank', name: 'DEMO Bank', type: 'bank', institution: 'Demo Bank (fictional)', currency: 'AUD', taxTreatment: 'not_applicable', propStatus: 'none', isDemo: true }
];

const IMPORTS: [file: string, template: string, account?: string][] = [
  ['rates.csv', 'tpl_builtin_rates'],
  ['income.csv', 'tpl_builtin_income', 'acc_demo_bank'],
  ['expenses.csv', 'tpl_builtin_expenses', 'acc_demo_bank'],
  ['shares.csv', 'tpl_builtin_shares', 'acc_demo_au'],
  ['crypto_trades.csv', 'tpl_builtin_crypto', 'acc_demo_cx'],
  ['dividends.csv', 'tpl_builtin_dividends', 'acc_demo_au'],
  ['forex.csv', 'tpl_builtin_forex', 'acc_demo_fx'],
  ['futures.csv', 'tpl_builtin_futures', 'acc_demo_fut'],
  ['options.csv', 'tpl_builtin_options', 'acc_demo_opt'],
  ['cfds.csv', 'tpl_builtin_cfds', 'acc_demo_cfd'],
  ['prop_firm.csv', 'tpl_builtin_prop', 'acc_demo_prop']
];

export async function loadDemoData(fetcher: Fetcher = browserFetcher): Promise<{ batches: number; records: number }> {
  const db = getDb();
  const now = nowIso();
  for (const a of ACCOUNTS) await saveEntity('accounts', { ...a, createdAt: now, updatedAt: now } as Account, { reason: 'Demonstration data' });
  if (!(await db.taxProfiles.get('tp_2025'))) {
    await saveEntity('taxProfiles', { id: 'tp_2025', fy: 2025, residency: 'resident', medicareExemption: 'none', privateHospitalCover: 'yes', spouse: 'no', helpDebt: 'no', notes: 'DEMO profile', updatedAt: now });
  }
  let records = 0;
  const batchIds: string[] = [];
  for (const [file, tpl, acct] of IMPORTS) {
    const text = await fetcher(file);
    // The US-share rows go to the US broker account; split the sample by currency.
    if (file === 'shares.csv') {
      const [head, ...lines] = text.trim().split(/\r?\n/);
      const au = [head, ...lines.filter((l) => l.includes(',AUD,'))].join('\n');
      const us = [head, ...lines.filter((l) => l.includes(',USD,'))].join('\n');
      for (const [t, a] of [[au, 'acc_demo_au'], [us, 'acc_demo_us']] as const) {
        const b = await importWithTemplate(t, `DEMO ${file}`, tpl, a);
        batchIds.push(b.id);
        records += b.counts.created;
      }
      continue;
    }
    if (file === 'dividends.csv') {
      const [head, ...lines] = text.trim().split(/\r?\n/);
      for (const [t, a] of [[[head, ...lines.filter((l) => l.includes(',AUD,'))].join('\n'), 'acc_demo_au'], [[head, ...lines.filter((l) => l.includes(',USD,'))].join('\n'), 'acc_demo_us']] as const) {
        const b = await importWithTemplate(t, `DEMO ${file}`, tpl, a);
        batchIds.push(b.id);
        records += b.counts.created;
      }
      continue;
    }
    const b = await importWithTemplate(text, `DEMO ${file}`, tpl, acct);
    batchIds.push(b.id);
    records += b.counts.created;
  }
  // Wallet transfers: outgoing from the exchange, incoming to the wallet.
  const wt = (await fetcher('wallet_transfers.csv')).trim().split(/\r?\n/);
  const sendB = await importWithTemplate([wt[0], wt[1]].join('\n'), 'DEMO wallet_transfers.csv (send)', 'tpl_builtin_transfers', 'acc_demo_cx');
  const recvB = await importWithTemplate([wt[0], wt[2]].join('\n'), 'DEMO wallet_transfers.csv (receive)', 'tpl_builtin_transfers', 'acc_demo_wallet');
  batchIds.push(sendB.id, recvB.id);
  records += sendB.counts.created + recvB.counts.created;
  const sendT = await db.transactions.where('importBatchId').equals(sendB.id).first();
  const recvT = await db.transactions.where('importBatchId').equals(recvB.id).first();
  await db.transaction('rw', [db.transactions, db.instruments, db.importBatches, db.meta, db.audit], async () => {
    if (sendT && recvT) {
      await db.transactions.update(sendT.id, { transferPairId: recvT.id, relatedIds: [recvT.id] });
      await db.transactions.update(recvT.id, { transferPairId: sendT.id, relatedIds: [sendT.id] });
    }
    for (const id of batchIds) {
      await db.transactions.where('importBatchId').equals(id).modify((t) => {
        t.isDemo = true;
        if (!t.tags.includes('DEMO')) t.tags = [...t.tags, 'DEMO'];
        if (!t.description.startsWith('[DEMO]')) t.description = `[DEMO] ${t.description}`;
      });
      const batch = await db.importBatches.get(id);
      for (const ins of batch?.createdInstrumentIds ?? []) await db.instruments.update(ins, { isDemo: true });
    }
    await writeAudit({ entityType: 'demo', entityId: 'demo', action: 'import', summary: `Loaded demonstration data (${records} fictional records)` });
    await bumpRevision();
  });
  await db.meta.put({ key: 'demoBatches', value: batchIds });
  await refreshAllConversions('Demonstration data loaded');
  return { batches: batchIds.length, records };
}

export async function removeDemoData(): Promise<number> {
  const db = getDb();
  const batchIds = ((await db.meta.get('demoBatches'))?.value as string[]) ?? [];
  let n = 0;
  await db.transaction('rw', [db.transactions, db.accounts, db.instruments, db.rates, db.importBatches, db.rawRows, db.taxProfiles, db.meta, db.audit], async () => {
    n = await db.transactions.filter((t) => !!t.isDemo || t.tags.includes('DEMO')).delete();
    await db.accounts.filter((a) => !!a.isDemo).delete();
    await db.instruments.filter((i) => !!i.isDemo).delete();
    await db.rates.filter((r) => r.source.startsWith('DEMO')).delete();
    for (const id of batchIds) {
      await db.importBatches.delete(id);
      await db.rawRows.where('batchId').equals(id).delete();
    }
    const tp = await db.taxProfiles.get('tp_2025');
    if (tp?.notes === 'DEMO profile') await db.taxProfiles.delete('tp_2025');
    await db.meta.delete('demoBatches');
    await db.audit.add({ id: newId('aud'), at: nowIso(), entityType: 'demo', entityId: 'demo', action: 'delete', summary: `Removed demonstration data (${n} records)` });
    await bumpRevision('rates');
  });
  invalidateRateCache();
  return n;
}
