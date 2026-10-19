/**
 * Import commit / rollback. A batch is written atomically: either every accepted row, its raw
 * source row, created instruments and the batch record are stored, or nothing is.
 */
import { getDb } from '../db/schema';
import { newId, sha256Hex } from '../lib/ids';
import { nowIso } from '../lib/dates';
import { D } from '../lib/decimal';
import type { ImportBatch, ImportTarget, ImportTemplate, Instrument, RateRecord, RawImportRow, Transaction } from '../domain/types';
import { manualConversion, validateRate } from '../engines/currency/rates';
import { applyConversions, bumpRevision, getRateIndex, invalidateRateCache, loadRefData, normaliseTransaction, writeAudit } from '../services/ledger';
import { loadSettings, saveSettings } from '../services/settings';
import { validateTransaction } from '../services/validation';
import type { PreparedRow } from './transform';

export interface CommitInput {
  filename: string;
  fileText: string;
  target: ImportTarget;
  template: Omit<ImportTemplate, 'id' | 'createdAt' | 'updatedAt' | 'builtin' | 'name'>;
  templateId?: string;
  accountId?: string;
  rows: PreparedRow[];
}

/** Load lookup maps used for duplicate detection during preview. */
export async function loadDedupeMaps(): Promise<{ bySource: Map<string, { id: string; amount: string; quantity?: string }>; byFingerprint: Map<string, string> }> {
  const db = getDb();
  const bySource = new Map<string, { id: string; amount: string; quantity?: string }>();
  const byFingerprint = new Map<string, string>();
  await db.transactions.where('status').equals('active').each((t) => {
    if (t.sourceId && t.accountId) bySource.set(`${t.accountId}|${t.sourceId}`, { id: t.id, amount: t.amount, quantity: t.quantity });
    if (t.fingerprint) byFingerprint.set(t.fingerprint, t.id);
  });
  return { bySource, byFingerprint };
}

export async function commitImport(input: CommitInput): Promise<ImportBatch> {
  const db = getDb();
  const fileHash = await sha256Hex(input.fileText);
  const batchId = newId('imp');
  const now = nowIso();
  const counts = { created: 0, skipped: 0, updated: 0, rejected: 0, total: input.rows.length };
  const rejected: ImportBatch['rejected'] = [];
  const rawRows: RawImportRow[] = [];

  if (input.target === 'rates') {
    const existing = new Set((await db.rates.toArray()).map((r) => `${r.base}|${r.quote}|${r.date}|${r.source}|${r.timestamp ?? ''}`));
    const rates: RateRecord[] = [];
    for (const row of input.rows) {
      const rawId = newId('raw');
      if (row.errors.length || !row.rate) {
        counts.rejected++;
        rejected.push({ row: row.rowNumber, errors: row.errors });
        rawRows.push({ id: rawId, batchId, rowNumber: row.rowNumber, raw: row.raw, outcome: 'rejected', errors: row.errors });
        continue;
      }
      const errs = validateRate(row.rate);
      const key = `${row.rate.base}|${row.rate.quote}|${row.rate.date}|${row.rate.source}|${row.rate.timestamp ?? ''}`;
      if (errs.length) {
        counts.rejected++;
        rejected.push({ row: row.rowNumber, errors: errs });
        rawRows.push({ id: rawId, batchId, rowNumber: row.rowNumber, raw: row.raw, outcome: 'rejected', errors: errs });
      } else if (existing.has(key) || row.action === 'skip') {
        counts.skipped++;
        rawRows.push({ id: rawId, batchId, rowNumber: row.rowNumber, raw: row.raw, outcome: 'skipped_duplicate' });
      } else {
        existing.add(key);
        const r: RateRecord = { ...row.rate, id: newId('rate'), retrievedAt: now, importBatchId: batchId, sourceRef: input.filename, createdAt: now };
        rates.push(r);
        counts.created++;
        rawRows.push({ id: rawId, batchId, rowNumber: row.rowNumber, raw: row.raw, outcome: 'created', recordId: r.id });
      }
    }
    const batch: ImportBatch = { id: batchId, createdAt: now, filename: input.filename, fileHash, target: 'rates', templateId: input.templateId, templateSnapshot: input.template, status: 'committed', counts, rejected, createdRateIds: rates.length };
    await db.transaction('rw', [db.rates, db.importBatches, db.rawRows, db.audit, db.meta], async () => {
      await db.importBatches.add(batch);
      for (let i = 0; i < rates.length; i += 5000) await db.rates.bulkAdd(rates.slice(i, i + 5000));
      await db.rawRows.bulkAdd(rawRows);
      await writeAudit({ entityType: 'import', entityId: batchId, action: 'import', summary: `Imported ${counts.created} rate(s) from ${input.filename}`, batchId });
      await bumpRevision('rates');
    });
    invalidateRateCache();
    await saveSettings({ lastImportAt: now });
    return batch;
  }

  const [ref, settings, index] = await Promise.all([loadRefData(), loadSettings(), getRateIndex()]);
  const instrumentsByKey = new Map<string, Instrument>();
  for (const i of ref.instruments.values()) instrumentsByKey.set(`${i.symbol.toUpperCase()}|${i.assetClass}`, i);
  const bySymbol = (sym: string) => [...ref.instruments.values()].filter((i) => i.symbol.toUpperCase() === sym);
  const createdInstruments: Instrument[] = [];
  const ensureInstrument = (symbol: string, assetClass: Instrument['assetClass'], currency: string, row: PreparedRow): Instrument => {
    const key = `${symbol}|${assetClass}`;
    let inst = instrumentsByKey.get(key);
    if (!inst && (assetClass === 'crypto' || assetClass === 'other')) {
      const same = bySymbol(symbol);
      if (same.length === 1) inst = same[0];
    }
    if (inst) return inst;
    inst = {
      id: newId('ins'),
      symbol,
      name: row.refs.instrumentName || symbol,
      assetClass,
      market: row.refs.market,
      currency: assetClass === 'crypto' || assetClass === 'stablecoin' ? 'USD' : currency,
      multiplier: row.refs.multiplier,
      expiry: row.refs.expiry,
      strike: row.refs.strike,
      optionType: row.refs.optionType,
      underlying: row.refs.underlying,
      createdAt: now,
      updatedAt: now
    };
    instrumentsByKey.set(key, inst);
    ref.instruments.set(inst.id, inst);
    createdInstruments.push(inst);
    return inst;
  };

  const txns: Transaction[] = [];
  const updates: Transaction[] = [];
  for (const row of input.rows) {
    const rawId = newId('raw');
    if (row.errors.length || !row.partial) {
      counts.rejected++;
      rejected.push({ row: row.rowNumber, errors: row.errors });
      rawRows.push({ id: rawId, batchId, rowNumber: row.rowNumber, raw: row.raw, outcome: 'rejected', errors: row.errors });
      continue;
    }
    if (row.action === 'skip') {
      counts.skipped++;
      rawRows.push({ id: rawId, batchId, rowNumber: row.rowNumber, raw: row.raw, outcome: 'skipped_duplicate', recordId: row.dupOf });
      continue;
    }
    const p: Partial<Transaction> = { ...row.partial, importBatchId: batchId, rawRowId: rawId };
    const provided = (p as any)._providedRate as { rate: string; direction: 'AUD_PER_UNIT' | 'UNITS_PER_AUD' } | undefined;
    delete (p as any)._providedRate;
    try {
      if (row.refs.symbol && row.refs.assetClass) {
        const inst = ensureInstrument(row.refs.symbol, row.refs.assetClass, p.currency ?? 'AUD', row);
        p.instrumentId = inst.id;
      }
      if (row.refs.counterSymbol) {
        const ac = row.refs.assetClass === 'crypto' || row.refs.assetClass === 'stablecoin' ? 'crypto' : row.refs.assetClass ?? 'other';
        p.counterInstrumentId = ensureInstrument(row.refs.counterSymbol, ac, p.currency ?? 'AUD', { ...row, refs: { ...row.refs, instrumentName: row.refs.counterSymbol } }).id;
      }
      // Crypto priced in another crypto asset (e.g. BTC/USDT): make sure the quote asset exists as an instrument.
      if (p.kind === 'trade' && row.refs.assetClass === 'crypto' && p.currency && !['AUD', 'USD', 'EUR', 'GBP', 'NZD', 'CAD', 'JPY', 'CHF', 'SGD', 'HKD'].includes(p.currency)) {
        ensureInstrument(p.currency, ['USDT', 'USDC', 'DAI', 'BUSD', 'TUSD', 'FDUSD', 'PYUSD'].includes(p.currency) ? 'stablecoin' : 'crypto', 'USD', { ...row, refs: { ...row.refs, instrumentName: p.currency } });
      }
      const existing = row.action === 'update' && row.dupOf ? await db.transactions.get(row.dupOf) : undefined;
      const t = normaliseTransaction(existing ? { ...p, id: existing.id, importBatchId: existing.importBatchId } : p, ref, settings, existing);
      if (provided && t.currency !== 'AUD') {
        t.fx = { ...manualConversion({ rate: provided.rate, direction: provided.direction, currency: t.currency, rateDate: t.date, source: `Source file ${input.filename}`, reason: 'Execution rate supplied by broker/exchange' }), isManualOverride: false, rateType: 'execution', methodology: 'Transaction-specific conversion rate supplied in the source file.' };
      }
      const errs = validateTransaction(t);
      if (errs.length) throw new Error(errs.join(' '));
      applyConversions(t, index, settings, 'Import', ref.instruments);
      if (existing) {
        updates.push(t);
        counts.updated++;
        rawRows.push({ id: rawId, batchId, rowNumber: row.rowNumber, raw: row.raw, outcome: 'updated', recordId: t.id });
      } else {
        txns.push(t);
        counts.created++;
        rawRows.push({ id: rawId, batchId, rowNumber: row.rowNumber, raw: row.raw, outcome: 'created', recordId: t.id });
      }
    } catch (e) {
      counts.rejected++;
      rejected.push({ row: row.rowNumber, errors: [(e as Error).message] });
      rawRows.push({ id: rawId, batchId, rowNumber: row.rowNumber, raw: row.raw, outcome: 'rejected', errors: [(e as Error).message] });
    }
  }
  const batch: ImportBatch = {
    id: batchId,
    createdAt: now,
    filename: input.filename,
    fileHash,
    target: input.target,
    templateId: input.templateId,
    templateSnapshot: input.template,
    accountId: input.accountId,
    status: 'committed',
    counts,
    rejected,
    createdInstrumentIds: createdInstruments.map((i) => i.id)
  };
  await db.transaction('rw', [db.transactions, db.instruments, db.importBatches, db.rawRows, db.audit, db.meta], async () => {
    await db.importBatches.add(batch);
    if (createdInstruments.length) await db.instruments.bulkAdd(createdInstruments);
    for (let i = 0; i < txns.length; i += 5000) await db.transactions.bulkAdd(txns.slice(i, i + 5000));
    if (updates.length) await db.transactions.bulkPut(updates);
    for (let i = 0; i < rawRows.length; i += 5000) await db.rawRows.bulkAdd(rawRows.slice(i, i + 5000));
    await writeAudit({ entityType: 'import', entityId: batchId, action: 'import', summary: `Imported ${input.filename}: ${counts.created} created, ${counts.updated} updated, ${counts.skipped} skipped, ${counts.rejected} rejected`, batchId });
    await bumpRevision();
  });
  await saveSettings({ lastImportAt: now });
  return batch;
}

/** Remove everything a batch created (records edited since import are reported first by the UI). */
export async function rollbackImport(batchId: string, reason = 'Rolled back by user'): Promise<{ removed: number }> {
  const db = getDb();
  const batch = await db.importBatches.get(batchId);
  if (!batch) throw new Error('Import batch not found');
  if (batch.status === 'rolled_back') return { removed: 0 };
  let removed = 0;
  await db.transaction('rw', [db.transactions, db.instruments, db.rates, db.importBatches, db.audit, db.meta], async () => {
    if (batch.target === 'rates') {
      removed = await db.rates.where('importBatchId').equals(batchId).delete();
    } else {
      const ids = await db.transactions.where('importBatchId').equals(batchId).primaryKeys();
      await db.transactions.bulkDelete(ids);
      removed = ids.length;
      for (const insId of batch.createdInstrumentIds ?? []) {
        const used = await db.transactions.where('instrumentId').equals(insId).count();
        if (!used) await db.instruments.delete(insId);
      }
    }
    await db.importBatches.put({ ...batch, status: 'rolled_back', rolledBackAt: nowIso() });
    await writeAudit({ entityType: 'import', entityId: batchId, action: 'rollback', summary: `Rolled back import ${batch.filename}: ${removed} record(s) removed`, reason, batchId });
    await bumpRevision(batch.target === 'rates' ? 'rates' : 'data');
  });
  if (batch.target === 'rates') invalidateRateCache();
  return { removed };
}

/** Count records from a batch that were edited after import (shown before rollback). */
export async function editedSinceImport(batchId: string): Promise<number> {
  const db = getDb();
  return db.transactions.where('importBatchId').equals(batchId).filter((t) => t.version > 1).count();
}

export function totalsPreview(rows: PreparedRow[]): { byCurrency: Record<string, string>; create: number; skip: number; reject: number; update: number } {
  const by: Record<string, ReturnType<typeof D>> = {};
  let create = 0;
  let skip = 0;
  let reject = 0;
  let update = 0;
  for (const r of rows) {
    if (r.errors.length) {
      reject++;
      continue;
    }
    if (r.action === 'skip') {
      skip++;
      continue;
    }
    if (r.action === 'update') update++;
    else create++;
    const p = r.partial;
    if (p?.amount) {
      const c = p.currency ?? 'AUD';
      by[c] = (by[c] ?? D(0)).plus(D(p.amount));
    }
  }
  return { byCurrency: Object.fromEntries(Object.entries(by).map(([k, v]) => [k, v.toFixed(2)])), create, skip, reject, update };
}
