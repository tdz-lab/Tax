/**
 * IndexedDB schema (Dexie) with explicit, versioned migrations.
 * NEVER edit a published version's store definition — add a new version with an upgrade function.
 */
import Dexie, { type Table } from 'dexie';
import type {
  Account,
  Asset,
  AuditEvent,
  BackupManifest,
  BusinessProfile,
  CalculationRun,
  Category,
  ConnectorConfig,
  CorporateAction,
  Counterparty,
  DocumentBlob,
  DocumentMeta,
  Draft,
  ImportBatch,
  ImportTemplate,
  Instrument,
  InventoryRecord,
  LogEntry,
  RateRecord,
  RawImportRow,
  ReconciliationItem,
  Recurring,
  ReportSnapshot,
  SettingRow,
  TaxProfile,
  Transaction,
  UserProfile
} from '../domain/types';

export const DB_NAME = 'au-tax-ledger';
export const SCHEMA_VERSION = 2;

/** Version 1 store definitions (kept verbatim for migration history). */
export const SCHEMA_V1: Record<string, string> = {
  transactions: 'id, kind, status, fy, date, occurredAt, accountId, instrumentId, category, taxClass, importBatchId, fingerprint, sourceId, transferPairId, updatedAt',
  accounts: 'id, type, name',
  instruments: 'id, symbol, assetClass',
  rates: 'id, [base+quote+date], [base+quote], date, importBatchId, source',
  corporateActions: 'id, instrumentId, date',
  taxProfiles: 'id, fy',
  userProfile: 'id',
  businessProfiles: 'id',
  assets: 'id, acquisitionDate',
  logEntries: 'id, type, fy, date',
  inventory: 'id, fy',
  counterparties: 'id, name, type',
  categories: 'id, type, code',
  documents: 'id, fy, docType, sha256, importedAt, *linkedRecordIds',
  docBlobs: 'id',
  importBatches: 'id, createdAt, status',
  importTemplates: 'id, target, name',
  rawRows: 'id, batchId',
  reconciliation: 'id, type, accountId, status, issueKey',
  audit: 'id, at, entityId, entityType, batchId',
  calcRuns: 'id, fy, createdAt',
  reports: 'id, fy, createdAt',
  backups: 'id, createdAt',
  connectors: 'id, providerId',
  settings: 'key',
  meta: 'key'
};

/** Version 2: compound FY/date index, account+sourceId dedupe index, tag index, recurring + drafts stores. */
export const SCHEMA_V2: Record<string, string> = {
  ...SCHEMA_V1,
  transactions:
    'id, kind, status, fy, date, occurredAt, accountId, instrumentId, category, taxClass, importBatchId, fingerprint, sourceId, transferPairId, updatedAt, [fy+date], [accountId+sourceId], *tags',
  instruments: 'id, symbol, assetClass, [symbol+assetClass]',
  recurring: 'id',
  drafts: 'id, form'
};

/** v1 → v2 data migration: backfill array/version fields introduced as required in v2. */
export function migrateTxnV1toV2(t: any): void {
  if (!Array.isArray(t.tags)) t.tags = [];
  if (!Array.isArray(t.reviewFlags)) t.reviewFlags = [];
  if (!Array.isArray(t.documentIds)) t.documentIds = [];
  if (!Array.isArray(t.relatedIds)) t.relatedIds = [];
  if (typeof t.version !== 'number') t.version = 1;
  if (!t.reconStatus) t.reconStatus = 'unreconciled';
  if (!t.status) t.status = 'active';
}

export class AppDB extends Dexie {
  transactions!: Table<Transaction, string>;
  accounts!: Table<Account, string>;
  instruments!: Table<Instrument, string>;
  rates!: Table<RateRecord, string>;
  corporateActions!: Table<CorporateAction, string>;
  taxProfiles!: Table<TaxProfile, string>;
  userProfile!: Table<UserProfile, string>;
  businessProfiles!: Table<BusinessProfile, string>;
  assets!: Table<Asset, string>;
  logEntries!: Table<LogEntry, string>;
  inventory!: Table<InventoryRecord, string>;
  counterparties!: Table<Counterparty, string>;
  categories!: Table<Category, string>;
  documents!: Table<DocumentMeta, string>;
  docBlobs!: Table<DocumentBlob, string>;
  importBatches!: Table<ImportBatch, string>;
  importTemplates!: Table<ImportTemplate, string>;
  rawRows!: Table<RawImportRow, string>;
  reconciliation!: Table<ReconciliationItem, string>;
  audit!: Table<AuditEvent, string>;
  calcRuns!: Table<CalculationRun, string>;
  reports!: Table<ReportSnapshot, string>;
  backups!: Table<BackupManifest, string>;
  connectors!: Table<ConnectorConfig, string>;
  settings!: Table<SettingRow, string>;
  meta!: Table<{ key: string; value: unknown }, string>;
  recurring!: Table<Recurring, string>;
  drafts!: Table<Draft, string>;

  constructor(name = DB_NAME) {
    super(name);
    this.version(1).stores(SCHEMA_V1);
    this.version(2)
      .stores(SCHEMA_V2)
      .upgrade(async (tx) => {
        await tx.table('transactions').toCollection().modify((t: any) => migrateTxnV1toV2(t));
        await tx.table('audit').add({
          id: `audit_migrate_v2_${Date.now()}`,
          at: new Date().toISOString(),
          entityType: 'database',
          entityId: 'schema',
          action: 'migrate',
          summary: 'Migrated database schema v1 → v2 (indexes, recurring entries, drafts).'
        });
      });
  }
}

/** Table names that make up a complete backup (order matters for restore). */
export const BACKUP_TABLES = [
  'settings',
  'userProfile',
  'taxProfiles',
  'businessProfiles',
  'categories',
  'counterparties',
  'accounts',
  'instruments',
  'rates',
  'corporateActions',
  'assets',
  'logEntries',
  'inventory',
  'recurring',
  'importTemplates',
  'importBatches',
  'rawRows',
  'transactions',
  'documents',
  'reconciliation',
  'audit',
  'calcRuns',
  'reports',
  'backups',
  'connectors'
] as const;
export type BackupTable = (typeof BACKUP_TABLES)[number];

let _db: AppDB | null = null;

export function getDb(): AppDB {
  if (!_db) _db = new AppDB();
  return _db;
}

/** Test hook: replace the active DB (e.g. a fresh fake-indexeddb instance). */
export function setDb(db: AppDB | null): void {
  _db = db;
}
