/** Report generation entry point: builds the file, hashes it, and records an immutable report snapshot. */
import { getDb } from '../db/schema';
import { newId, sha256Hex } from '../lib/ids';
import { fyLabel } from '../lib/dates';
import { readFileBuffer, timestampForFile } from '../lib/files';
import type { ReportSnapshot } from '../domain/types';
import { writeAudit } from '../services/ledger';
import { gatherReportContext, type ReportOptions } from './reportData';
import { buildBasicReport, buildFullReport, buildSummaryReport } from './pdf';
import { cgtCsv, ledgerCsv, summaryCsv } from './csv';

export async function generatePdfReport(options: ReportOptions): Promise<{ blob: Blob; fileName: string; snapshot: ReportSnapshot }> {
  const label = { summary: 'Tax return figures', basic: 'Basic', full: 'Full' }[options.type];
  const ctx = await gatherReportContext(options, `${label} PDF report`);
  const blob = options.type === 'summary' ? buildSummaryReport(ctx) : options.type === 'basic' ? buildBasicReport(ctx) : buildFullReport(ctx);
  const fileName = `${{ summary: 'my-tax-return-figures', basic: 'tax-summary', full: 'tax-agent-report' }[options.type]}-${fyLabel(options.fy).replace('–', '-')}-${timestampForFile()}.pdf`;
  const snapshot: ReportSnapshot = {
    id: newId('rpt'),
    createdAt: ctx.generatedAt,
    fy: options.fy,
    reportType: options.type,
    calculationRunId: ctx.run.id,
    ruleSetId: ctx.result.ruleSetId ?? 'none',
    options: options as unknown as Record<string, unknown>,
    fileName,
    sha256: await sha256Hex(await readFileBuffer(blob))
  };
  await getDb().reports.add(snapshot);
  await writeAudit({ entityType: 'report', entityId: snapshot.id, action: 'create', summary: `Generated ${fileName}` });
  return { blob, fileName, snapshot };
}

export async function generateCsvExport(options: ReportOptions, which: 'ledger' | 'cgt' | 'summary'): Promise<{ blob: Blob; fileName: string; snapshot: ReportSnapshot }> {
  const ctx = await gatherReportContext(options, `CSV export (${which})`);
  const text = which === 'ledger' ? ledgerCsv(ctx) : which === 'cgt' ? cgtCsv(ctx) : summaryCsv(ctx);
  const blob = new Blob([text], { type: 'text/csv' });
  const fileName = `${which}-${fyLabel(options.fy).replace('–', '-')}-${timestampForFile()}.csv`;
  const snapshot: ReportSnapshot = { id: newId('rpt'), createdAt: ctx.generatedAt, fy: options.fy, reportType: 'csv', calculationRunId: ctx.run.id, ruleSetId: ctx.result.ruleSetId ?? 'none', options: { ...options, which } as any, fileName, sha256: await sha256Hex(text) };
  await getDb().reports.add(snapshot);
  return { blob, fileName, snapshot };
}
