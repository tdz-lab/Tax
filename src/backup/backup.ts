/**
 * Full backup export / restore with schema metadata, integrity hashes and optional encryption.
 */
import { BACKUP_TABLES, SCHEMA_VERSION, getDb, migrateTxnV1toV2, type BackupTable } from '../db/schema';
import { sha256Hex, newId } from '../lib/ids';
import { nowIso } from '../lib/dates';
import { base64ToBuf, bufToBase64, timestampForFile } from '../lib/files';
import type { BackupManifest } from '../domain/types';
import { APP_VERSION, saveSettings } from '../services/settings';
import { bumpRevision, invalidateRateCache, writeAudit } from '../services/ledger';
import { decryptText, encryptText, type EncryptedEnvelope } from './crypto';

export const BACKUP_FORMAT = 'au-tax-ledger-backup';

export interface BackupPayload {
  format: typeof BACKUP_FORMAT;
  formatVersion: 1;
  appVersion: string;
  schemaVersion: number;
  createdAt: string;
  includesDocuments: boolean;
  tables: Partial<Record<BackupTable, any[]>>;
  documents: { id: string; data: string }[];
  counts: Record<string, number>;
  tableHashes: Record<string, string>;
  payloadHash: string;
}

async function hashTables(tables: Record<string, any[]>, documents: { id: string; data: string }[]) {
  const tableHashes: Record<string, string> = {};
  for (const [k, v] of Object.entries(tables)) tableHashes[k] = await sha256Hex(JSON.stringify(v));
  tableHashes.__documents = await sha256Hex(JSON.stringify(documents));
  const payloadHash = await sha256Hex(JSON.stringify(tableHashes));
  return { tableHashes, payloadHash };
}

export async function buildBackup(opts: { includeDocuments: boolean }): Promise<BackupPayload> {
  const db = getDb();
  const tables: Record<string, any[]> = {};
  await db.transaction('r', BACKUP_TABLES.map((t) => (db as any)[t]).concat([db.docBlobs]), async () => {
    for (const t of BACKUP_TABLES) tables[t] = await (db as any)[t].toArray();
  });
  const documents: { id: string; data: string }[] = [];
  if (opts.includeDocuments) {
    for (const b of await db.docBlobs.toArray()) documents.push({ id: b.id, data: bufToBase64(b.data) });
  }
  const counts = Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, v.length]));
  counts.documentFiles = documents.length;
  const { tableHashes, payloadHash } = await hashTables(tables, documents);
  return { format: BACKUP_FORMAT, formatVersion: 1, appVersion: APP_VERSION, schemaVersion: SCHEMA_VERSION, createdAt: nowIso(), includesDocuments: opts.includeDocuments, tables, documents, counts, tableHashes, payloadHash };
}

/** Serialise a backup (optionally encrypted) and record its manifest. Filenames are timestamped so nothing is overwritten. */
export async function exportBackup(opts: { includeDocuments: boolean; password?: string }): Promise<{ blob: Blob; fileName: string; manifest: BackupManifest }> {
  const payload = await buildBackup(opts);
  const json = JSON.stringify(payload);
  const encrypted = !!opts.password;
  const body = encrypted ? JSON.stringify(await encryptText(json, opts.password!)) : json;
  const fileName = `au-tax-ledger-backup-${timestampForFile()}${encrypted ? '.encrypted' : ''}.json`;
  const manifest: BackupManifest = {
    id: newId('bak'),
    createdAt: payload.createdAt,
    fileName,
    schemaVersion: payload.schemaVersion,
    appVersion: payload.appVersion,
    counts: payload.counts,
    sha256: await sha256Hex(body),
    encrypted,
    includesDocuments: opts.includeDocuments
  };
  const db = getDb();
  await db.backups.add(manifest);
  await writeAudit({ entityType: 'backup', entityId: manifest.id, action: 'backup', summary: `Backup exported: ${fileName}` });
  await saveSettings({ lastBackupAt: payload.createdAt });
  return { blob: new Blob([body], { type: 'application/json' }), fileName, manifest };
}

export function isEncryptedBackup(obj: any): obj is EncryptedEnvelope {
  return obj?.format === 'au-tax-ledger-backup-encrypted';
}

/** Parse, decrypt (if needed), verify integrity and migrate a backup file to the current schema. */
export async function readBackup(text: string, password?: string): Promise<BackupPayload> {
  let obj: any;
  try {
    obj = JSON.parse(text);
  } catch {
    throw new Error('This file is not a valid backup (not JSON).');
  }
  if (isEncryptedBackup(obj)) {
    if (!password) throw new Error('This backup is encrypted — enter its password.');
    obj = JSON.parse(await decryptText(obj, password));
  }
  if (obj?.format !== BACKUP_FORMAT) throw new Error('This file is not an AU Tax Ledger backup.');
  if (typeof obj.schemaVersion !== 'number' || obj.schemaVersion > SCHEMA_VERSION)
    throw new Error(`Backup schema v${obj.schemaVersion} is newer than this application (v${SCHEMA_VERSION}). Update the application first.`);
  const { tableHashes, payloadHash } = await hashTables(obj.tables, obj.documents ?? []);
  if (payloadHash !== obj.payloadHash) {
    const bad = Object.keys(tableHashes).filter((k) => tableHashes[k] !== obj.tableHashes?.[k]);
    throw new Error(`Backup integrity check failed — contents do not match their recorded hashes (${bad.join(', ')}).`);
  }
  // Migrate older backups to the current schema.
  if (obj.schemaVersion < 2) {
    for (const t of obj.tables.transactions ?? []) migrateTxnV1toV2(t);
    obj.tables.recurring = obj.tables.recurring ?? [];
  }
  return obj as BackupPayload;
}

export interface RestoreReport {
  mode: 'replace' | 'merge';
  added: Record<string, number>;
  conflicts: Record<string, number>;
  documentsRestored: number;
}

/** Restore a verified backup. 'replace' wipes current data first; 'merge' only adds records whose ids are absent (conflicts keep current data). */
export async function restoreBackup(payload: BackupPayload, mode: 'replace' | 'merge'): Promise<RestoreReport> {
  const db = getDb();
  const report: RestoreReport = { mode, added: {}, conflicts: {}, documentsRestored: 0 };
  const stores = [...BACKUP_TABLES.map((t) => (db as any)[t]), db.docBlobs, db.meta, db.drafts];
  await db.transaction('rw', stores, async () => {
    if (mode === 'replace') {
      for (const t of BACKUP_TABLES) await (db as any)[t].clear();
      await db.docBlobs.clear();
      await db.drafts.clear();
    }
    for (const t of BACKUP_TABLES) {
      const rows = payload.tables[t] ?? [];
      const tbl = (db as any)[t];
      if (mode === 'replace') {
        for (let i = 0; i < rows.length; i += 5000) await tbl.bulkPut(rows.slice(i, i + 5000));
        report.added[t] = rows.length;
      } else {
        const pk = t === 'settings' ? 'key' : 'id';
        let added = 0;
        let conflicts = 0;
        for (const r of rows) {
          const cur = await tbl.get(r[pk]);
          if (!cur) {
            await tbl.put(r);
            added++;
          } else if (JSON.stringify(cur) !== JSON.stringify(r)) conflicts++;
        }
        report.added[t] = added;
        report.conflicts[t] = conflicts;
      }
    }
    for (const d of payload.documents ?? []) {
      if (mode === 'merge' && (await db.docBlobs.get(d.id))) continue;
      await db.docBlobs.put({ id: d.id, data: base64ToBuf(d.data) });
      report.documentsRestored++;
    }
    await db.audit.add({ id: newId('aud'), at: nowIso(), entityType: 'backup', entityId: payload.payloadHash.slice(0, 16), action: 'restore', summary: `Backup from ${payload.createdAt} restored (${mode}).` });
    await bumpRevision('rates');
  });
  invalidateRateCache();
  return report;
}
