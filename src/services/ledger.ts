/**
 * Ledger service: the single write path for financial records.
 * Validates → normalises → classifies → resolves historical FX → writes record + audit event
 * inside one IndexedDB transaction. Writes are idempotent by id (retries never duplicate).
 */
import { getDb } from '../db/schema';
import { newId } from '../lib/ids';
import { D, dstr, tryD } from '../lib/decimal';
import { fyOfLocalDate, localDateOf, localToUtc, nowIso } from '../lib/dates';
import type { Account, AppSettings, AuditEvent, Category, Conversion, Instrument, Transaction } from '../domain/types';
import { RateIndex, manualConversion, resolveAudConversion } from '../engines/currency/rates';
import type { LedgerData } from '../engines/ledger';
import { classify, type ClassificationRule } from './classification';
import { validateTransaction } from './validation';
import { getSetting, loadSettings } from './settings';

export class ValidationError extends Error {
  constructor(public errors: string[]) {
    super(errors.join(' '));
  }
}

// ---------------- revision / audit ----------------
export async function bumpRevision(kind: 'data' | 'rates' = 'data'): Promise<number> {
  const db = getDb();
  const key = kind === 'rates' ? 'ratesRevision' : 'revision';
  const cur = ((await db.meta.get(key))?.value as number) ?? 0;
  await db.meta.put({ key, value: cur + 1 });
  if (kind === 'rates') {
    const dr = ((await db.meta.get('revision'))?.value as number) ?? 0;
    await db.meta.put({ key: 'revision', value: dr + 1 });
  }
  return cur + 1;
}

export async function getRevision(): Promise<number> {
  return ((await getDb().meta.get('revision'))?.value as number) ?? 0;
}

function diff(before: any, after: any): { before: Record<string, unknown>; after: Record<string, unknown> } {
  const b: Record<string, unknown> = {};
  const a: Record<string, unknown> = {};
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  for (const k of keys) {
    if (k === 'updatedAt' || k === 'version' || k === 'fxHistory') continue;
    if (JSON.stringify(before?.[k]) !== JSON.stringify(after?.[k])) {
      b[k] = before?.[k];
      a[k] = after?.[k];
    }
  }
  return { before: b, after: a };
}

let auditSeq = 0;
/** Audit ids sort chronologically (timestamp + per-session counter), so history order is stable. */
export function auditId(): string {
  auditSeq = (auditSeq + 1) % 1_000_000;
  return `aud_${Date.now().toString().padStart(15, '0')}_${String(auditSeq).padStart(6, '0')}_${newId().slice(0, 8)}`;
}

export async function writeAudit(e: Omit<AuditEvent, 'id' | 'at'> & { at?: string }): Promise<void> {
  await getDb().audit.add({ id: auditId(), at: e.at ?? nowIso(), ...e });
}

// ---------------- rate index cache ----------------
let rateCache: { rev: number; index: RateIndex } | null = null;
export async function getRateIndex(): Promise<RateIndex> {
  const db = getDb();
  const rev = ((await db.meta.get('ratesRevision'))?.value as number) ?? 0;
  if (rateCache && rateCache.rev === rev) return rateCache.index;
  const index = new RateIndex(await db.rates.toArray());
  rateCache = { rev, index };
  return index;
}
export function invalidateRateCache(): void {
  rateCache = null;
}

// ---------------- normalisation ----------------
export interface RefData {
  accounts: Map<string, Account>;
  instruments: Map<string, Instrument>;
  categories: Map<string, Category>; // key `${type}:${code}`
  rules: ClassificationRule[];
}

export async function loadRefData(): Promise<RefData> {
  const db = getDb();
  const [accounts, instruments, categories, rules] = await Promise.all([
    db.accounts.toArray(),
    db.instruments.toArray(),
    db.categories.toArray(),
    getSetting<ClassificationRule[]>('classificationRules', [])
  ]);
  return {
    accounts: new Map(accounts.map((a) => [a.id, a])),
    instruments: new Map(instruments.map((i) => [i.id, i])),
    categories: new Map(categories.map((c) => [`${c.type}:${c.code}`, c])),
    rules
  };
}

export function categoryFor(t: Partial<Transaction>, ref: RefData): Category | undefined {
  if (!t.category) return undefined;
  const type = t.kind === 'income' ? 'income' : 'expense';
  return ref.categories.get(`${type}:${t.category}`);
}

/** Build a complete, normalised transaction from a partial (manual form, import row, recurring template). */
export function normaliseTransaction(p: Partial<Transaction>, ref: RefData, settings: AppSettings, existing?: Transaction): Transaction {
  const now = nowIso();
  const tz = p.timeZone || existing?.timeZone || settings.taxTimeZone;
  const date = p.date ?? existing?.date ?? '';
  const time = p.time ?? existing?.time;
  let occurredAt = p.occurredAt ?? existing?.occurredAt ?? '';
  let localDate = date;
  // If a time zone + wall-clock are supplied, the UTC instant is authoritative; the FY date is the taxpayer-local date.
  if (date && (p.date !== undefined || p.time !== undefined || p.timeZone !== undefined || !occurredAt)) {
    try {
      occurredAt = localToUtc(date, time, tz);
      localDate = localDateOf(occurredAt, settings.taxTimeZone);
    } catch {
      occurredAt = ''; // invalid date/time/zone — reported by validation
    }
  }
  let fy = 0;
  try {
    fy = fyOfLocalDate(p.taxEventDate ?? existing?.taxEventDate ?? localDate);
  } catch {
    /* reported by validation */
  }
  const t: Transaction = {
    id: p.id ?? existing?.id ?? newId('txn'),
    kind: (p.kind ?? existing?.kind)!,
    status: p.status ?? existing?.status ?? 'active',
    date: localDate,
    time: time ? time : undefined,
    timeZone: tz,
    occurredAt,
    fy,
    category: p.category ?? existing?.category ?? (p.kind === 'trade' || existing?.kind === 'trade' ? 'trading' : ''),
    taxClass: 'UNCLASSIFIED',
    taxClassSource: 'default',
    description: (p.description ?? existing?.description ?? '').trim(),
    tags: p.tags ?? existing?.tags ?? [],
    currency: (p.currency ?? existing?.currency ?? settings.defaultCurrency).toUpperCase(),
    amount: p.amount !== undefined ? dstr(D(p.amount || '0')) : existing?.amount ?? '0',
    documentIds: p.documentIds ?? existing?.documentIds ?? [],
    relatedIds: p.relatedIds ?? existing?.relatedIds ?? [],
    reconStatus: p.reconStatus ?? existing?.reconStatus ?? 'unreconciled',
    reviewFlags: p.reviewFlags ?? existing?.reviewFlags ?? [],
    source: p.source ?? existing?.source ?? 'manual',
    createdAt: existing?.createdAt ?? p.createdAt ?? now,
    updatedAt: now,
    version: (existing?.version ?? 0) + 1
  };
  // Copy remaining optional fields (explicit undefined in the patch clears a field).
  const optional: (keyof Transaction)[] = [
    'settlementDate', 'taxEventDate', 'subcategory', 'counterparty', 'counterpartyId', 'paymentMethod', 'notes', 'fx', 'fxHistory', 'providedAudAmount',
    'taxWithheld', 'foreignTaxPaid', 'frankingCredit', 'frankedAmount', 'unfrankedAmount', 'taxDeferredAmount', 'capitalGainComponent', 'businessUsePct',
    'isBusiness', 'gstTreatment', 'gstAmount', 'splits', 'accountId', 'instrumentId', 'side', 'quantity', 'price', 'multiplier', 'commission', 'exchangeFees',
    'financingCosts', 'otherFees', 'feeCurrency', 'feeFx', 'counterInstrumentId', 'counterQuantity', 'valuationAud', 'valuationSource', 'positionRef',
    'costBasisMethod', 'specificLots', 'transferPairId', 'isOwnTransfer', 'feeQuantity', 'adjustmentType', 'assetId', 'importBatchId', 'sourceId',
    'fingerprint', 'rawRowId', 'recurringId', 'isDemo'
  ];
  for (const k of optional) {
    const v = k in p ? (p as any)[k] : (existing as any)?.[k];
    if (v !== undefined && v !== '' && v !== null) (t as any)[k] = v;
  }
  if (t.feeCurrency) t.feeCurrency = t.feeCurrency.toUpperCase();
  // Classification: an explicit user (or import) choice is preserved; taxClassSource 'default' without a class asks for re-derivation.
  const keepExisting = !('taxClass' in p) && p.taxClassSource !== 'default' && existing && (existing.taxClassSource === 'user' || existing.taxClassSource === 'import');
  if (p.taxClass && (p.taxClassSource === 'user' || p.taxClassSource === 'import')) {
    t.taxClass = p.taxClass;
    t.taxClassSource = p.taxClassSource;
  } else if (keepExisting) {
    t.taxClass = existing!.taxClass;
    t.taxClassSource = existing!.taxClassSource;
  } else {
    const c = classify(t, {
      account: t.accountId ? ref.accounts.get(t.accountId) : undefined,
      instrument: t.instrumentId ? ref.instruments.get(t.instrumentId) : undefined,
      category: categoryFor(t, ref),
      rules: ref.rules
    });
    t.taxClass = c.taxClass;
    t.taxClassSource = c.source;
  }
  if (t.businessUsePct === undefined && (t.kind === 'expense' || t.kind === 'fee')) {
    const cat = categoryFor(t, ref);
    if (cat?.defaultDeductiblePct !== undefined) t.businessUsePct = cat.defaultDeductiblePct;
  }
  return t;
}

/** A conversion that must not be replaced automatically (manual override or broker execution rate). */
export function isPinned(c?: Conversion): boolean {
  return !!c && (c.isManualOverride || (c.rateType === 'execution' && c.rateRecordIds.length === 0));
}

function rateDateFor(t: Transaction, settings: AppSettings): string {
  if (t.taxEventDate) return t.taxEventDate;
  return settings.rateMethodology.dailyRateDateBasis === 'trade_timezone_date' ? localDateOf(t.occurredAt, t.timeZone) : t.date;
}

/** Resolve (or re-resolve) automatic conversions on a transaction. Returns true if anything changed. */
export function applyConversions(
  t: Transaction,
  index: RateIndex,
  settings: AppSettings,
  reason = 'Automatic rate resolution',
  instruments?: Map<string, Instrument>
): boolean {
  let changed = false;
  const date = rateDateFor(t, settings);
  const resolve = (currency: string) => resolveAudConversion({ currency, date, occurredAt: t.occurredAt, timeZone: t.timeZone, methodology: settings.rateMethodology }, index);
  const update = (field: 'fx' | 'feeFx', currency: string) => {
    const cur = t[field];
    if (isPinned(cur)) return;
    const r = resolve(currency);
    const next = r.ok ? r.conversion : undefined;
    const same = (a?: Conversion, b?: Conversion) => (!a && !b) || (!!a && !!b && a.audPerUnit === b.audPerUnit && a.rateRecordIds.join() === b.rateRecordIds.join());
    if (same(cur, next)) return;
    if (cur && field === 'fx') t.fxHistory = [...(t.fxHistory ?? []), { ...cur, replacedAt: nowIso(), replacedReason: reason }];
    if (next) t[field] = next;
    else delete t[field];
    changed = true;
  };
  if (t.currency !== 'AUD') update('fx', t.currency);
  else if (t.fx && !isPinned(t.fx)) {
    delete t.fx;
    changed = true;
  }
  if (t.feeCurrency && t.feeCurrency !== t.currency && t.feeCurrency !== 'AUD') update('feeFx', t.feeCurrency);
  // Auto valuation of crypto events from price records when not supplied by the user/source.
  const needsValuation = (t.side === 'swap' || (t.kind === 'income' && t.instrumentId && t.quantity) || (t.side === 'send' && t.feeQuantity)) && (!t.valuationAud || t.valuationSource?.startsWith('Auto'));
  if (needsValuation && t.instrumentId) {
    const inst = instruments?.get(t.instrumentId);
    if (inst) {
      const qty = t.side === 'send' ? tryD(t.feeQuantity) : tryD(t.quantity);
      const r = resolve(inst.symbol);
      if (qty && r.ok) {
        const v = dstr(qty.abs().times(D(r.conversion.audPerUnit)));
        if (v !== t.valuationAud) {
          t.valuationAud = v;
          t.valuationSource = `Auto: ${qty.toFixed()} ${inst.symbol} × ${r.conversion.audPerUnit} AUD (${r.conversion.methodology})`;
          changed = true;
        }
      }
    }
  }
  return changed;
}

export interface SaveOptions {
  reason?: string;
  audit?: boolean;
  skipValidation?: boolean;
}

/** Create or update one transaction (validated, classified, converted, audited). */
export async function saveTransaction(p: Partial<Transaction>, opts: SaveOptions = {}): Promise<Transaction> {
  const db = getDb();
  const [ref, settings, index] = await Promise.all([loadRefData(), loadSettings(), getRateIndex()]);
  const existing = p.id ? await db.transactions.get(p.id) : undefined;
  const t = normaliseTransaction(p, ref, settings, existing);
  if (!opts.skipValidation) {
    const errs = validateTransaction(t);
    if (errs.length) throw new ValidationError(errs);
  }
  applyConversions(t, index, settings, undefined, ref.instruments);
  await db.transaction('rw', [db.transactions, db.audit, db.meta], async () => {
    await db.transactions.put(t);
    if (opts.audit !== false) {
      const d = diff(existing, t);
      if (!existing || Object.keys(d.after).length)
        await writeAudit({ entityType: 'transaction', entityId: t.id, action: existing ? 'update' : 'create', summary: `${existing ? 'Updated' : 'Created'} ${t.kind}: ${t.description || t.category}`, before: existing ? d.before : undefined, after: d.after, reason: opts.reason });
    }
    await bumpRevision();
  });
  return t;
}

export async function softDeleteTransactions(ids: string[], reason = 'Deleted by user'): Promise<void> {
  const db = getDb();
  await db.transaction('rw', [db.transactions, db.audit, db.meta], async () => {
    for (const id of ids) {
      const t = await db.transactions.get(id);
      if (!t || t.status === 'deleted') continue;
      await db.transactions.put({ ...t, status: 'deleted', updatedAt: nowIso(), version: t.version + 1 });
      await writeAudit({ entityType: 'transaction', entityId: id, action: 'delete', summary: `Deleted ${t.kind}: ${t.description}`, reason });
    }
    await bumpRevision();
  });
}

export async function restoreTransactions(ids: string[]): Promise<void> {
  const db = getDb();
  await db.transaction('rw', [db.transactions, db.audit, db.meta], async () => {
    for (const id of ids) {
      const t = await db.transactions.get(id);
      if (!t || t.status !== 'deleted') continue;
      await db.transactions.put({ ...t, status: 'active', updatedAt: nowIso(), version: t.version + 1 });
      await writeAudit({ entityType: 'transaction', entityId: id, action: 'restore', summary: `Restored ${t.kind}: ${t.description}` });
    }
    await bumpRevision();
  });
}

/** Apply the same field changes to many transactions (re-normalised and re-classified unless a class is given). */
export async function bulkUpdateTransactions(ids: string[], patch: Partial<Transaction>, reason: string): Promise<number> {
  const db = getDb();
  const [ref, settings, index] = await Promise.all([loadRefData(), loadSettings(), getRateIndex()]);
  let n = 0;
  await db.transaction('rw', [db.transactions, db.audit, db.meta], async () => {
    for (const id of ids) {
      const existing = await db.transactions.get(id);
      if (!existing) continue;
      const t = normaliseTransaction({ ...patch, id }, ref, settings, existing);
      const errs = validateTransaction(t);
      if (errs.length) throw new ValidationError([`${existing.description || id}: ${errs.join(' ')}`]);
      applyConversions(t, index, settings, undefined, ref.instruments);
      await db.transactions.put(t);
      n++;
    }
    await writeAudit({ entityType: 'transaction', entityId: ids.join(',').slice(0, 500), action: 'bulk_update', summary: `Bulk update of ${n} record(s): ${Object.keys(patch).join(', ')}`, after: patch, reason });
    await bumpRevision();
  });
  return n;
}

/** Manual exchange-rate override for a transaction (source and reason mandatory; history preserved). */
export async function overrideRate(
  txnId: string,
  input: { rate: string; direction: 'AUD_PER_UNIT' | 'UNITS_PER_AUD'; source: string; reason: string; field?: 'fx' | 'feeFx' }
): Promise<Transaction> {
  const db = getDb();
  const t = await db.transactions.get(txnId);
  if (!t) throw new Error('Transaction not found');
  const field = input.field ?? 'fx';
  const currency = field === 'fx' ? t.currency : t.feeCurrency ?? t.currency;
  const conv = manualConversion({ rate: input.rate, direction: input.direction, currency, rateDate: t.taxEventDate ?? t.date, source: input.source, reason: input.reason });
  const prev = t[field];
  const next: Transaction = { ...t, [field]: conv, updatedAt: nowIso(), version: t.version + 1 };
  if (prev && field === 'fx') next.fxHistory = [...(t.fxHistory ?? []), { ...prev, replacedAt: nowIso(), replacedReason: `Manual override: ${input.reason}` }];
  await db.transaction('rw', [db.transactions, db.audit, db.meta], async () => {
    await db.transactions.put(next);
    await writeAudit({ entityType: 'transaction', entityId: txnId, action: 'fx_override', summary: `Manual ${currency}→AUD rate ${conv.audPerUnit} AUD/unit`, before: prev, after: conv, reason: input.reason });
    await bumpRevision();
  });
  return next;
}

/** Remove a manual override so the transaction uses the configured methodology again. */
export async function clearRateOverride(txnId: string, reason: string): Promise<Transaction> {
  const db = getDb();
  const t = await db.transactions.get(txnId);
  if (!t) throw new Error('Transaction not found');
  const [settings, index, ref] = await Promise.all([loadSettings(), getRateIndex(), loadRefData()]);
  const next: Transaction = { ...t, updatedAt: nowIso(), version: t.version + 1 };
  if (t.fx) next.fxHistory = [...(t.fxHistory ?? []), { ...t.fx, replacedAt: nowIso(), replacedReason: `Override removed: ${reason}` }];
  delete next.fx;
  applyConversions(next, index, settings, reason, ref.instruments);
  await db.transaction('rw', [db.transactions, db.audit, db.meta], async () => {
    await db.transactions.put(next);
    await writeAudit({ entityType: 'transaction', entityId: txnId, action: 'fx_override', summary: 'Manual rate override removed', before: t.fx, after: next.fx, reason });
    await bumpRevision();
  });
  return next;
}

/** Re-resolve automatic conversions for all transactions (after importing rates or changing methodology). */
export async function refreshAllConversions(reason = 'Rates updated'): Promise<{ updated: number; stillMissing: number }> {
  const db = getDb();
  invalidateRateCache();
  const [settings, index, ref] = await Promise.all([loadSettings(), getRateIndex(), loadRefData()]);
  let updated = 0;
  let stillMissing = 0;
  const all = await db.transactions.toArray();
  const changed: Transaction[] = [];
  for (const t of all) {
    if (applyConversions(t, index, settings, reason, ref.instruments)) {
      t.updatedAt = nowIso();
      t.version += 1;
      changed.push(t);
      updated++;
    }
    if (t.currency !== 'AUD' && !t.fx && t.status === 'active') stillMissing++;
  }
  await db.transaction('rw', [db.transactions, db.audit, db.meta], async () => {
    for (let i = 0; i < changed.length; i += 2000) await db.transactions.bulkPut(changed.slice(i, i + 2000));
    if (updated) await writeAudit({ entityType: 'transaction', entityId: '*', action: 'recalc', summary: `Re-resolved exchange rates on ${updated} transaction(s)`, reason });
    await bumpRevision();
  });
  return { updated, stillMissing };
}

/** Load everything the engines need. */
export async function loadLedger(includeDeleted = false): Promise<LedgerData> {
  const db = getDb();
  const [transactions, accounts, instruments, corporateActions] = await Promise.all([
    includeDeleted ? db.transactions.toArray() : db.transactions.where('status').equals('active').toArray(),
    db.accounts.toArray(),
    db.instruments.toArray(),
    db.corporateActions.toArray()
  ]);
  return { transactions, accounts, instruments, corporateActions };
}

// ---------------- generic entity persistence ----------------
type EntityTable = 'accounts' | 'instruments' | 'corporateActions' | 'assets' | 'logEntries' | 'inventory' | 'counterparties' | 'categories' | 'businessProfiles' | 'taxProfiles' | 'userProfile' | 'reconciliation' | 'recurring' | 'connectors' | 'importTemplates';

export async function saveEntity<T extends { id: string }>(table: EntityTable, record: T, opts: { reason?: string; entityType?: string } = {}): Promise<T> {
  const db = getDb();
  const tbl = (db as any)[table];
  const now = nowIso();
  const rec: any = { ...record };
  if ('updatedAt' in rec || table !== 'categories') rec.updatedAt = now;
  await db.transaction('rw', [tbl, db.audit, db.meta], async () => {
    const existing = await tbl.get(rec.id);
    if (!existing && 'createdAt' in rec === false && table !== 'categories' && table !== 'taxProfiles' && table !== 'userProfile' && table !== 'businessProfiles' && table !== 'inventory') rec.createdAt = now;
    await tbl.put(rec);
    const d = diff(existing, rec);
    if (!existing || Object.keys(d.after).length)
      await writeAudit({ entityType: opts.entityType ?? table, entityId: rec.id, action: existing ? 'update' : 'create', summary: `${existing ? 'Updated' : 'Created'} ${opts.entityType ?? table} ${rec.name ?? rec.symbol ?? rec.title ?? rec.id}`, before: existing ? d.before : undefined, after: d.after, reason: opts.reason });
    await bumpRevision();
  });
  return rec;
}

export async function deleteEntity(table: EntityTable, id: string, reason = 'Deleted by user'): Promise<void> {
  const db = getDb();
  const tbl = (db as any)[table];
  await db.transaction('rw', [tbl, db.audit, db.meta], async () => {
    const existing = await tbl.get(id);
    if (!existing) return;
    await tbl.delete(id);
    await writeAudit({ entityType: table, entityId: id, action: 'delete', summary: `Deleted ${table} ${existing.name ?? existing.symbol ?? id}`, before: existing, reason });
    await bumpRevision();
  });
}

/** Re-run classification on records whose class was not set explicitly (after changing account treatment / rules). */
export async function reclassifyAll(reason = 'Classification inputs changed'): Promise<number> {
  const db = getDb();
  const ref = await loadRefData();
  const all = await db.transactions.toArray();
  const changed: Transaction[] = [];
  for (const t of all) {
    if (t.taxClassSource === 'user' || t.taxClassSource === 'import') continue;
    const c = classify(t, { account: t.accountId ? ref.accounts.get(t.accountId) : undefined, instrument: t.instrumentId ? ref.instruments.get(t.instrumentId) : undefined, category: categoryFor(t, ref), rules: ref.rules });
    if (c.taxClass !== t.taxClass || c.source !== t.taxClassSource) {
      changed.push({ ...t, taxClass: c.taxClass, taxClassSource: c.source, updatedAt: nowIso(), version: t.version + 1 });
    }
  }
  await db.transaction('rw', [db.transactions, db.audit, db.meta], async () => {
    for (let i = 0; i < changed.length; i += 2000) await db.transactions.bulkPut(changed.slice(i, i + 2000));
    if (changed.length) await writeAudit({ entityType: 'transaction', entityId: '*', action: 'recalc', summary: `Re-classified ${changed.length} record(s)`, reason });
    await bumpRevision();
  });
  return changed.length;
}

/** Mark records as confirmed non-duplicates so they stop appearing in duplicate warnings. */
export async function markNotDuplicate(ids: string[]): Promise<void> {
  const db = getDb();
  await db.transaction('rw', [db.transactions, db.audit, db.meta], async () => {
    for (const id of ids) {
      const t = await db.transactions.get(id);
      if (t && !t.reviewFlags.includes('NOT_DUPLICATE')) await db.transactions.put({ ...t, reviewFlags: [...t.reviewFlags, 'NOT_DUPLICATE'], updatedAt: nowIso(), version: t.version + 1 });
    }
    await writeAudit({ entityType: 'transaction', entityId: ids.join(',').slice(0, 500), action: 'bulk_update', summary: `Confirmed ${ids.length} record(s) are not duplicates` });
    await bumpRevision();
  });
}
