/** First-run seeding of reference data (categories, templates, planned connectors). Idempotent. */
import { getDb } from '../db/schema';
import { builtinCategories } from '../domain/reference';
import { BUILTIN_TEMPLATES } from '../import/templates';
import { PROVIDERS } from '../connectors/registry';
import { nowIso } from '../lib/dates';

export async function ensureSeeded(): Promise<void> {
  const db = getDb();
  const now = nowIso();
  await db.transaction('rw', [db.categories, db.importTemplates, db.connectors, db.meta], async () => {
    const cats = builtinCategories();
    const existingCats = new Set(await db.categories.toCollection().primaryKeys());
    const missing = cats.filter((c) => !existingCats.has(c.id));
    if (missing.length) await db.categories.bulkPut(missing);
    for (const tpl of BUILTIN_TEMPLATES) await db.importTemplates.put({ ...tpl, createdAt: now, updatedAt: now });
    const existingConn = new Set((await db.connectors.toArray()).map((c) => c.providerId));
    for (const p of PROVIDERS) {
      if (!existingConn.has(p.id)) await db.connectors.put({ id: `con_${p.id}`, providerId: p.id, displayName: p.name, status: 'planned', scopes: [], createdAt: now, updatedAt: now });
    }
    if (!(await db.meta.get('installedAt'))) await db.meta.put({ key: 'installedAt', value: now });
  });
}

/** Ask the browser to keep IndexedDB data from being evicted under storage pressure. */
export async function requestPersistentStorage(): Promise<boolean | null> {
  try {
    if (navigator.storage?.persist) {
      if (await navigator.storage.persisted()) return true;
      return await navigator.storage.persist();
    }
  } catch {
    /* not supported */
  }
  return null;
}

export async function storageEstimate(): Promise<{ usage: number; quota: number; persisted: boolean | null } | null> {
  try {
    if (!navigator.storage?.estimate) return null;
    const e = await navigator.storage.estimate();
    const persisted = navigator.storage.persisted ? await navigator.storage.persisted() : null;
    return { usage: e.usage ?? 0, quota: e.quota ?? 0, persisted };
  } catch {
    return null;
  }
}
