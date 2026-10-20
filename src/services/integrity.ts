/** Data health / integrity checks. */
import { BACKUP_TABLES, SCHEMA_VERSION, getDb } from '../db/schema';
import { verifyDocuments } from './documents';

export interface IntegrityReport {
  schemaVersion: number;
  dbVersion: number;
  counts: Record<string, number>;
  deletedTransactions: number;
  orphanAccountRefs: string[];
  orphanInstrumentRefs: string[];
  orphanDocumentRefs: string[];
  docLinksToMissingRecords: string[];
  documents: { ok: number; missing: string[]; mismatched: string[] };
  invalidFy: string[];
}

export async function runIntegrityChecks(): Promise<IntegrityReport> {
  const db = getDb();
  const counts: Record<string, number> = {};
  for (const t of [...BACKUP_TABLES, 'docBlobs', 'drafts'] as const) counts[t] = await (db as any)[t].count();
  const [txns, accounts, instruments, docs] = await Promise.all([db.transactions.toArray(), db.accounts.toArray(), db.instruments.toArray(), db.documents.toArray()]);
  const a = new Set(accounts.map((x) => x.id));
  const i = new Set(instruments.map((x) => x.id));
  const d = new Set(docs.map((x) => x.id));
  const t = new Set(txns.map((x) => x.id));
  return {
    schemaVersion: SCHEMA_VERSION,
    dbVersion: db.verno,
    counts,
    deletedTransactions: txns.filter((x) => x.status === 'deleted').length,
    orphanAccountRefs: txns.filter((x) => x.accountId && !a.has(x.accountId)).map((x) => x.id),
    orphanInstrumentRefs: txns.filter((x) => (x.instrumentId && !i.has(x.instrumentId)) || (x.counterInstrumentId && !i.has(x.counterInstrumentId))).map((x) => x.id),
    orphanDocumentRefs: txns.filter((x) => x.documentIds.some((id) => !d.has(id))).map((x) => x.id),
    docLinksToMissingRecords: docs.filter((x) => x.linkedRecordIds.some((id) => !t.has(id))).map((x) => x.id),
    documents: await verifyDocuments(),
    invalidFy: txns.filter((x) => !x.fy || x.fy < 1990 || x.fy > 2200).map((x) => x.id)
  };
}

/** Permanently remove soft-deleted transactions (after confirmation). */
export async function purgeDeleted(): Promise<number> {
  const db = getDb();
  return db.transaction('rw', [db.transactions, db.accounts, db.audit], async () => {
    const ids = await db.transactions.where('status').equals('deleted').primaryKeys();
    await db.transactions.bulkDelete(ids);
    // Accounts deleted together with their records go once none of their records remain.
    for (const a of await db.accounts.filter((x) => !!x.deletedAt).toArray()) {
      if ((await db.transactions.where('accountId').equals(a.id).count()) === 0) await db.accounts.delete(a.id);
    }
    await db.audit.add({ id: `aud_purge_${Date.now()}`, at: new Date().toISOString(), entityType: 'transaction', entityId: '*', action: 'delete', summary: `Permanently purged ${ids.length} deleted record(s)` });
    return ids.length;
  });
}
