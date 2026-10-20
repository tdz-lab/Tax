/**
 * Start again: permanently deletes chosen groups of data from this browser. Unlike deleting single records this
 * cannot be undone (except by restoring a backup), so the screen offers a backup first and asks for confirmation.
 */
import { getDb } from '../db/schema';
import { invalidateCalcCache } from './calc';
import { ensureSeeded } from './bootstrap';
import { bumpRevision, invalidateRateCache, writeAudit } from './ledger';

export const RESET_GROUPS = {
  records: {
    label: 'Transactions & records',
    detail: 'Every money in / out, trade, move and import (all years), receipts and documents, report and calculation history, assets, logbooks, recurring entries and symbols.',
    tables: ['transactions', 'instruments', 'corporateActions', 'documents', 'docBlobs', 'importBatches', 'rawRows', 'reconciliation', 'calcRuns', 'reports', 'recurring', 'drafts', 'assets', 'logEntries', 'inventory']
  },
  accounts: {
    label: 'Accounts',
    detail: 'Money in, money out, banks and payment accounts, brokers, exchanges and wallets, payers and suppliers.',
    tables: ['accounts', 'counterparties']
  },
  tax: {
    label: 'Tax answers & profile',
    detail: 'Quick-question answers for every year, your name and business details.',
    tables: ['taxProfiles', 'userProfile', 'businessProfiles']
  },
  rates: {
    label: 'Exchange rates & prices',
    detail: 'All imported and fetched rates.',
    tables: ['rates']
  },
  settings: {
    label: 'Settings, categories & templates',
    detail: 'Back to the defaults: layout, time zone and other settings, your own categories, classification rules and import templates, backup history.',
    tables: ['settings', 'categories', 'importTemplates', 'connectors', 'backups']
  }
} as const;
export type ResetGroup = keyof typeof RESET_GROUPS;
export const ALL_RESET_GROUPS = Object.keys(RESET_GROUPS) as ResetGroup[];

/** Accounts can only go together with the records that point at them. */
export function normaliseGroups(groups: ResetGroup[]): ResetGroup[] {
  const set = new Set(groups);
  if (set.has('accounts')) set.add('records');
  return ALL_RESET_GROUPS.filter((g) => set.has(g));
}

/** Deletes the chosen groups; deleting every group also clears the history log, like a fresh install. Returns rows removed. */
export async function resetData(groups: ResetGroup[]): Promise<number> {
  const db = getDb();
  const chosen = normaliseGroups(groups);
  if (!chosen.length) return 0;
  const everything = chosen.length === ALL_RESET_GROUPS.length;
  const names = [...new Set([...chosen.flatMap((g) => RESET_GROUPS[g].tables), ...(everything ? ['audit', 'meta'] : [])])];
  const tables = names.map((n) => (db as any)[n]).filter(Boolean);
  let removed = 0;
  await db.transaction('rw', [...tables, db.audit, db.meta], async () => {
    for (const t of tables) {
      removed += await t.count();
      await t.clear();
    }
    if (!everything) await writeAudit({ entityType: 'settings', entityId: 'reset', action: 'delete', summary: `Reset: deleted ${chosen.map((g) => RESET_GROUPS[g].label.toLowerCase()).join(', ')} (${removed} item(s))` });
    await bumpRevision();
  });
  // Built-in categories, templates and connector placeholders come back so the app works as on first launch.
  await ensureSeeded();
  invalidateRateCache();
  invalidateCalcCache();
  return removed;
}
