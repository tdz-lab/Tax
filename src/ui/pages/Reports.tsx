import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { getDb } from '../../db/schema';
import { ASSET_CLASS_LABEL } from '../../domain/reference';
import { ASSET_CLASSES, type AssetClass } from '../../domain/types';
import { formatInstant, fyLabel } from '../../lib/dates';
import { saveFile } from '../../lib/files';
import { generateCsvExport, generatePdfReport } from '../../reports/generate';
import type { ReportOptions } from '../../reports/reportData';
import { useApp, useSessionState } from '../AppContext';
import { useAccounts, useTaxYear } from '../hooks';
import { DataTable } from '../components/DataTable';
import { Disclaimer, StatusBadge } from '../components/ui';

export function Reports() {
  const { fy, run, settings, toast } = useApp();
  const nav = useNavigate();
  const accounts = useAccounts();
  const { value: r } = useTaxYear(fy);
  const [opts, setOpts] = useSessionState<{ accountIds: string[] | null; markets: AssetClass[] | null; schedules: ReportOptions['schedules'] }>('report-opts', {
    accountIds: null,
    markets: null,
    schedules: { conversionLedger: true, documentIndex: true, auditHistory: true, lotDetail: true }
  });
  const [busy, setBusy] = useState<string | null>(null);
  const history = useLiveQuery(() => getDb().reports.orderBy('createdAt').reverse().limit(100).toArray(), [], []) ?? [];
  const options = (type: ReportOptions['type']): ReportOptions => ({ fy, type, accountIds: opts.accountIds, markets: opts.markets, schedules: opts.schedules });

  const pdf = async (type: ReportOptions['type'], mode: 'save' | 'preview') => {
    setBusy(type);
    const res = await run(() => generatePdfReport(options(type)));
    setBusy(null);
    if (!res) return;
    if (mode === 'preview') {
      const url = URL.createObjectURL(res.blob);
      window.open(url, '_blank', 'noopener');
      setTimeout(() => URL.revokeObjectURL(url), 120_000);
    } else {
      const how = await saveFile(res.blob, res.fileName, 'PDF report', { 'application/pdf': ['.pdf'] });
      if (how !== 'cancelled') toast(`${res.fileName} ${how === 'saved' ? 'saved' : 'downloaded'}.`);
    }
  };
  const csv = async (which: 'ledger' | 'cgt' | 'summary') => {
    setBusy(which);
    const res = await run(() => generateCsvExport(options('full'), which));
    setBusy(null);
    if (res) await saveFile(res.blob, res.fileName, 'CSV', { 'text/csv': ['.csv'] });
  };
  const toggle = <T,>(list: T[] | null, all: T[], v: T): T[] | null => {
    const cur = list ?? all;
    const next = cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v];
    return next.length === all.length ? null : next;
  };

  return (
    <div>
      <div className="page-head">
        <h1>Reports & PDF export — {fyLabel(fy)}</h1>
        {r && <StatusBadge status={r.readiness.status} />}
      </div>
      <Disclaimer />
      {r && r.readiness.status === 'incomplete' && <div className="notice warn">This year has blocking data issues — reports will show affected figures as INCOMPLETE. <button className="link" onClick={() => nav('/tax-calc')}>Review issues</button></div>}
      <div className="grid cols-2">
        <div className="panel">
          <h2>My tax return figures (short)</h2>
          <p className="muted">One or two pages: what still needs fixing, then each figure grouped the way the tax return asks for it, with the estimate.</p>
          <div className="row">
            <button className="primary" disabled={!!busy} onClick={() => pdf('summary', 'save')}>
              {busy === 'summary' ? 'Generating…' : 'Download PDF'}
            </button>
            <button disabled={!!busy} onClick={() => pdf('summary', 'preview')}>
              Preview
            </button>
          </div>
        </div>
        <div className="panel">
          <h2>Report A — Basic annual tax summary</h2>
          <p className="muted">Compact summary: profile, income, business, deductions, trading by classification, CGT & discount, dividends, foreign income & withholding, GST/BAS, estimates, unresolved items, data-quality warnings, rule-set version.</p>
          <div className="row">
            <button className="primary" disabled={!!busy} onClick={() => pdf('basic', 'save')}>
              {busy === 'basic' ? 'Generating…' : 'Download PDF'}
            </button>
            <button disabled={!!busy} onClick={() => pdf('basic', 'preview')}>
              Preview
            </button>
          </div>
        </div>
        {settings.showFullReport ? (
        <div className="panel">
          <h2>Report B — Full tax-agent report</h2>
          <p className="muted">33 sections including income/expense ledgers, depreciation, CGT calculations with parcel allocations, cost-basis method, every market’s records, prop-firm activity, currency conversion ledger and rate sources, document index, reconciliation, overrides, audit history, closing balances and questions for the agent.</p>
          <div className="row">
            <button className="primary" disabled={!!busy} onClick={() => pdf('full', 'save')}>
              {busy === 'full' ? 'Generating…' : 'Download PDF'}
            </button>
            <button disabled={!!busy} onClick={() => pdf('full', 'preview')}>
              Preview
            </button>
          </div>
        </div>
        ) : (
          <div className="panel">
            <h2>Report B — Full tax-agent report</h2>
            <p className="muted">The long, detailed report (ledgers, parcels, conversions, audit history) is switched off. Turn on “Show the full accountant report” in <button className="link" onClick={() => nav('/settings')}>Settings</button> to use it.</p>
          </div>
        )}
      </div>
      <div className="panel">
        <h2>Report options</h2>
        <div className="grid cols-3">
          <fieldset>
            <legend>Accounts included</legend>
            <label className="row">
              <input type="checkbox" checked={opts.accountIds === null} onChange={() => setOpts({ ...opts, accountIds: opts.accountIds === null ? [] : null })} /> All accounts
            </label>
            {accounts.map((a) => (
              <label key={a.id} className="row">
                <input type="checkbox" checked={opts.accountIds === null || opts.accountIds.includes(a.id)} onChange={() => setOpts({ ...opts, accountIds: toggle(opts.accountIds, accounts.map((x) => x.id), a.id) })} /> {a.name}
              </label>
            ))}
          </fieldset>
          <fieldset>
            <legend>Markets included</legend>
            <label className="row">
              <input type="checkbox" checked={opts.markets === null} onChange={() => setOpts({ ...opts, markets: opts.markets === null ? [] : null })} /> All markets
            </label>
            {ASSET_CLASSES.map((m) => (
              <label key={m} className="row">
                <input type="checkbox" checked={opts.markets === null || opts.markets.includes(m)} onChange={() => setOpts({ ...opts, markets: toggle(opts.markets, [...ASSET_CLASSES], m) })} /> {ASSET_CLASS_LABEL[m]}
              </label>
            ))}
          </fieldset>
          <fieldset>
            <legend>Optional schedules (full report)</legend>
            {(
              [
                ['lotDetail', 'Parcel-level cost-base allocations'],
                ['conversionLedger', 'Currency conversion ledger'],
                ['documentIndex', 'Supporting-document index'],
                ['auditHistory', 'Audit history detail']
              ] as const
            ).map(([k, label]) => (
              <label key={k} className="row">
                <input type="checkbox" checked={opts.schedules[k]} onChange={(e) => setOpts({ ...opts, schedules: { ...opts.schedules, [k]: e.target.checked } })} /> {label}
              </label>
            ))}
            <p className="faint">Account/market filters narrow ledgers and trading sections; tax totals are always computed on all records for the year.</p>
          </fieldset>
        </div>
      </div>
      <div className="panel">
        <h2>CSV exports & print</h2>
        <div className="row">
          <button disabled={!!busy} onClick={() => csv('ledger')}>
            Transaction ledger CSV (with AUD values & rate provenance)
          </button>
          <button disabled={!!busy} onClick={() => csv('cgt')}>
            CGT parcel allocations CSV
          </button>
          <button disabled={!!busy} onClick={() => csv('summary')}>
            Tax summary lines CSV
          </button>
          <button onClick={() => { nav('/tax-calc'); setTimeout(() => window.print(), 400); }}>Print-friendly calculation view</button>
        </div>
      </div>
      <div className="panel tight">
        <div className="panel-head">
          <h2 style={{ margin: 0 }}>Generated reports</h2>
          <span className="muted">Each report references the immutable calculation snapshot and rule set it used, with the file’s SHA-256.</span>
        </div>
        <DataTable
          id="report-history"
          short
          rows={history}
          rowKey={(h) => h.id}
          columns={[
            { key: 'w', header: 'Generated', render: (h) => formatInstant(h.createdAt, settings.taxTimeZone, { timeFormat: settings.timeFormat }), sortValue: (h) => h.createdAt },
            { key: 'f', header: 'File', render: (h) => h.fileName },
            { key: 't', header: 'Type', render: (h) => h.reportType },
            { key: 'y', header: 'FY', render: (h) => fyLabel(h.fy) },
            { key: 'r', header: 'Rule set', render: (h) => h.ruleSetId },
            { key: 'c', header: 'Calculation snapshot', render: (h) => <span className="mono">{h.calculationRunId}</span> },
            { key: 's', header: 'SHA-256', render: (h) => <span className="mono">{h.sha256.slice(0, 12)}…</span> }
          ]}
          emptyText="No reports generated yet."
        />
      </div>
    </div>
  );
}
