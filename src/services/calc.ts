/**
 * Calculation service: runs the pure engines over the stored ledger, caches results by data
 * revision (invalidated on any write, rate change or rule change), and stores immutable
 * calculation snapshots. Snapshots are never rewritten; a recalculation creates a new run that
 * references the run it supersedes, with a reason.
 */
import { getDb } from '../db/schema';
import { newId, fnv1a } from '../lib/ids';
import { nowIso, type FYear } from '../lib/dates';
import type { CalculationRun } from '../domain/types';
import { computeTaxYear, type TaxYearResult } from '../engines/tax/taxEngine';
import { runLotEngine, type LotEngineResult } from '../engines/trading/lots';
import { runDerivativeEngine, type DerivativeResult } from '../engines/trading/derivatives';
import { runQualityChecks, type QualityIssue } from '../engines/reconciliation/quality';
import type { LedgerData } from '../engines/ledger';
import { getRevision, loadLedger, writeAudit } from './ledger';
import { loadSettings } from './settings';

export interface Workspace {
  revision: number;
  data: LedgerData;
  lots: LotEngineResult;
  deriv: DerivativeResult;
}

let wsCache: Workspace | null = null;
const yearCache = new Map<string, TaxYearResult>();

export async function getWorkspace(): Promise<Workspace> {
  const rev = await getRevision();
  if (wsCache && wsCache.revision === rev) return wsCache;
  const settings = await loadSettings();
  const data = await loadLedger();
  const lots = runLotEngine(data, { taxTz: settings.taxTimeZone, costBasisDefaults: settings.costBasisDefaults });
  const deriv = runDerivativeEngine(data, { includeSimulated: true });
  wsCache = { revision: rev, data, lots, deriv };
  yearCache.clear();
  return wsCache;
}

export function invalidateCalcCache(): void {
  wsCache = null;
  yearCache.clear();
}

export async function computeYear(fy: FYear): Promise<TaxYearResult> {
  const ws = await getWorkspace();
  const key = `${ws.revision}:${fy}`;
  const hit = yearCache.get(key);
  if (hit) return hit;
  const db = getDb();
  const [settings, taxProfiles, businessProfiles, assets, categories] = await Promise.all([loadSettings(), db.taxProfiles.toArray(), db.businessProfiles.toArray(), db.assets.toArray(), db.categories.toArray()]);
  const res = computeTaxYear({
    data: ws.data,
    fy,
    taxProfiles,
    business: businessProfiles[0],
    assets,
    categories,
    taxTz: settings.taxTimeZone,
    costBasisDefaults: settings.costBasisDefaults,
    lossOrdering: settings.lossOrdering,
    lotRun: ws.lots,
    derivRun: ws.deriv
  });
  yearCache.set(key, res);
  return res;
}

export async function qualityIssues(fy?: FYear): Promise<QualityIssue[]> {
  const ws = await getWorkspace();
  const settings = await loadSettings();
  const reconciliation = await getDb().reconciliation.toArray();
  return runQualityChecks({ data: ws.data, lots: ws.lots, deriv: ws.deriv, reconciliation, taxTz: settings.taxTimeZone, fy });
}

export function inputHashOf(data: LedgerData, extra: unknown): string {
  const parts = data.transactions.map((t) => `${t.id}:${t.version}`).sort().join(',');
  return fnv1a(parts + '|' + JSON.stringify(extra));
}

/** Store an immutable snapshot of a calculation. */
export async function saveCalculationRun(fy: FYear, reason: string): Promise<CalculationRun> {
  const db = getDb();
  const ws = await getWorkspace();
  const result = await computeYear(fy);
  const prev = await db.calcRuns.where('fy').equals(fy).reverse().sortBy('createdAt');
  const run: CalculationRun = {
    id: newId('calc'),
    fy,
    createdAt: nowIso(),
    ruleSetId: result.ruleSetId ?? 'none',
    reason,
    inputHash: inputHashOf(ws.data, { taxProfiles: await db.taxProfiles.toArray(), assets: await db.assets.toArray() }),
    summary: Object.fromEntries(Object.entries(result.totals).map(([k, v]) => [k, v ?? 'incomplete'])),
    warningsCount: result.issues.filter((i) => i.severity !== 'info').length,
    result,
    supersedesId: prev[0]?.id
  };
  await db.calcRuns.add(run);
  await writeAudit({ entityType: 'calculation', entityId: run.id, action: 'recalc', summary: `Calculation snapshot for FY${fy} (${run.ruleSetId})`, reason });
  return run;
}

/** Differences between two snapshot summaries (for "what changed since the last calculation"). */
export function diffSummaries(a: Record<string, string>, b: Record<string, string>): { key: string; before: string; after: string }[] {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].filter((k) => a[k] !== b[k]).map((k) => ({ key: k, before: a[k] ?? '—', after: b[k] ?? '—' }));
}
