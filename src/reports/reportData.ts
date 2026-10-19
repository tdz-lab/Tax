/** Gathers everything a report needs (shared by PDF and CSV exports). */
import { getDb } from '../db/schema';
import type { Account, AssetClass, AuditEvent, BusinessProfile, CalculationRun, DocumentMeta, Instrument, TaxProfile, Transaction, UserProfile } from '../domain/types';
import type { TaxYearResult } from '../engines/tax/taxEngine';
import { reconcileBalances, type BalanceCheck, type QualityIssue } from '../engines/reconciliation/quality';
import { holdingsFromLots, runLotEngine, type Lot } from '../engines/trading/lots';
import { runDerivativeEngine, type OpenPosition } from '../engines/trading/derivatives';
import { fyEnd, type FYear } from '../lib/dates';
import { computeYear, getWorkspace, qualityIssues, saveCalculationRun } from '../services/calc';
import { loadSettings } from '../services/settings';
import type { AppSettings } from '../domain/types';

export interface ReportOptions {
  fy: FYear;
  type: 'basic' | 'full';
  accountIds: string[] | null; // null = all
  markets: AssetClass[] | null; // null = all
  schedules: { conversionLedger: boolean; documentIndex: boolean; auditHistory: boolean; lotDetail: boolean };
}

export interface ReportContext {
  options: ReportOptions;
  settings: AppSettings;
  result: TaxYearResult;
  run: CalculationRun;
  user?: UserProfile;
  business?: BusinessProfile;
  taxProfile?: TaxProfile;
  accounts: Map<string, Account>;
  instruments: Map<string, Instrument>;
  txns: Transaction[]; // FY, active, in scope
  allTxnsById: Map<string, Transaction>;
  documents: DocumentMeta[];
  quality: QualityIssue[];
  balances: BalanceCheck[];
  audit: AuditEvent[];
  calcRuns: CalculationRun[];
  closingLots: Lot[];
  openDerivatives: OpenPosition[];
  generatedAt: string;
}

export function inScope(t: Transaction, o: ReportOptions, instruments: Map<string, Instrument>): boolean {
  if (o.accountIds && t.accountId && !o.accountIds.includes(t.accountId)) return false;
  if (o.markets && t.instrumentId) {
    const i = instruments.get(t.instrumentId);
    if (i && !o.markets.includes(i.assetClass)) return false;
  }
  return true;
}

export async function gatherReportContext(options: ReportOptions, reason: string): Promise<ReportContext> {
  const db = getDb();
  const run = await saveCalculationRun(options.fy, reason);
  const [result, ws, settings, user, businesses, taxProfiles, documents, recon, audit, calcRuns] = await Promise.all([
    computeYear(options.fy),
    getWorkspace(),
    loadSettings(),
    db.userProfile.get('user'),
    db.businessProfiles.toArray(),
    db.taxProfiles.toArray(),
    db.documents.toArray(),
    db.reconciliation.toArray(),
    db.audit.orderBy('at').reverse().limit(400).toArray(),
    db.calcRuns.where('fy').equals(options.fy).toArray()
  ]);
  const instruments = new Map(ws.data.instruments.map((i) => [i.id, i]));
  const accounts = new Map(ws.data.accounts.map((a) => [a.id, a]));
  const txns = ws.data.transactions.filter((t) => t.fy === options.fy && inScope(t, options, instruments)).sort((a, b) => (a.occurredAt < b.occurredAt ? -1 : 1));
  const end = fyEnd(options.fy);
  // Closing holdings: lots acquired by FY end and still open (as at now). Holdings as at FY end require
  // excluding later disposals, so re-run the lot engine on transactions up to FY end.
  const upTo = { ...ws.data, transactions: ws.data.transactions.filter((t) => t.date <= end), corporateActions: ws.data.corporateActions.filter((c) => c.date <= end) };
  const lotsAtEnd = runLotEngine(upTo, { taxTz: settings.taxTimeZone, costBasisDefaults: settings.costBasisDefaults });
  const closingLots = [...holdingsFromLots(lotsAtEnd.lots).values()].flatMap((h) => h.lots).filter((l) => !l.accountId || !options.accountIds || options.accountIds.includes(l.accountId));
  const openDerivatives = runDerivativeEngine(upTo).open;
  return {
    options,
    settings,
    result,
    run,
    user,
    business: businesses[0],
    taxProfile: taxProfiles.find((p) => p.fy === options.fy),
    accounts,
    instruments,
    txns,
    allTxnsById: new Map(ws.data.transactions.map((t) => [t.id, t])),
    documents,
    quality: await qualityIssues(options.fy),
    balances: reconcileBalances(ws.data, recon, ws.deriv),
    audit,
    calcRuns: calcRuns.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),
    closingLots,
    openDerivatives,
    generatedAt: new Date().toISOString()
  };
}
