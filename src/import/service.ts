/** High-level import helpers shared by the wizard, demo loader and tests. */
import { getDb } from '../db/schema';
import type { ImportTemplate } from '../domain/types';
import { loadSettings } from '../services/settings';
import { commitImport, loadDedupeMaps } from './commit';
import { parseCsv, prepareRows, type PreparedRow } from './transform';

export async function previewWithTemplate(text: string, template: ImportTemplate, accountId?: string): Promise<{ rows: PreparedRow[]; headers: string[]; parseErrors: string[] }> {
  const db = getDb();
  const parsed = parseCsv(text, { delimiter: template.delimiter, skipRows: template.skipRows });
  const [accounts, settings, maps] = await Promise.all([db.accounts.toArray(), loadSettings(), loadDedupeMaps()]);
  const rows = prepareRows(parsed.rows, {
    target: template.target,
    template,
    account: accounts.find((a) => a.id === accountId),
    accountsByName: new Map(accounts.map((a) => [a.name.trim().toLowerCase(), a])),
    existingBySource: maps.bySource,
    existingByFingerprint: maps.byFingerprint,
    defaultCurrency: settings.defaultCurrency
  });
  return { rows, headers: parsed.headers, parseErrors: parsed.errors };
}

export async function importWithTemplate(text: string, filename: string, templateId: string, accountId?: string) {
  const db = getDb();
  const template = await db.importTemplates.get(templateId);
  if (!template) throw new Error(`Template ${templateId} not found`);
  const { rows } = await previewWithTemplate(text, template, accountId);
  const { id: _i, createdAt: _c, updatedAt: _u, builtin: _b, name: _n, ...snapshot } = template;
  return commitImport({ filename, fileText: text, target: template.target, template: snapshot, templateId, accountId, rows });
}
