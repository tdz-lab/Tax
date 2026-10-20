/**
 * Simple-mode tax summary: what still needs fixing, the figures grouped the way the return asks for them,
 * the setup answers, and the short "My tax return figures" PDF. The full accountant pack is offered only
 * when it is switched on in Settings.
 */
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { getDb } from '../../db/schema';
import { D, formatMoney } from '../../lib/decimal';
import { fyLabel, fyLongLabel } from '../../lib/dates';
import { saveFile } from '../../lib/files';
import { headline, returnFigures } from '../../engines/tax/simpleFigures';
import { generateCsvExport, generatePdfReport } from '../../reports/generate';
import type { ReportOptions } from '../../reports/reportData';
import { useApp } from '../AppContext';
import { useQuality, useTaxYear } from '../hooks';
import { SetupWizard } from '../simple/SetupWizard';
import { buildTodos, missingSetup } from '../simple/todo';
import { TodoList } from './Home';

const amt = (v: string | null | undefined) => (v === null ? 'incomplete' : v === undefined ? '—' : formatMoney(v, 'AUD', { dp: 2 }));

const RESIDENCY: Record<string, string> = { resident: 'Resident all year', part_year: 'Resident part of the year', non_resident: 'Foreign resident', working_holiday: 'Working holiday maker', unknown: 'Not answered' };
const YES_NO: Record<string, string> = { yes: 'Yes', no: 'No', unknown: 'Not answered' };

export function TaxSummary() {
  const { fy, run, toast, settings } = useApp();
  const nav = useNavigate();
  const { value: r } = useTaxYear(fy);
  const { value: q } = useQuality(fy);
  const tp = useLiveQuery(async () => (await getDb().taxProfiles.get(`tp_${fy}`)) ?? null, [fy]);
  const [setup, setSetup] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const groups = useMemo(() => (r ? returnFigures(r) : []), [r]);
  const { notes } = useMemo(() => buildTodos(r, q, tp, fyLabel(fy)), [r, q, tp, fy]);
  const h = r ? headline(r) : null;

  const options = (type: ReportOptions['type']): ReportOptions => ({ fy, type, accountIds: null, markets: null, schedules: { conversionLedger: type === 'full', documentIndex: type === 'full', auditHistory: type === 'full', lotDetail: type === 'full' } });
  const pdf = async (type: 'summary' | 'full') => {
    setBusy(type);
    const res = await run(() => generatePdfReport(options(type)));
    setBusy(null);
    if (!res) return;
    const how = await saveFile(res.blob, res.fileName, 'PDF report', { 'application/pdf': ['.pdf'] });
    if (how !== 'cancelled') toast(`${res.fileName} ${how === 'saved' ? 'saved' : 'downloaded'}.`);
  };
  const cgtCsv = async () => {
    setBusy('csv');
    const res = await run(() => generateCsvExport(options('full'), 'cgt'));
    setBusy(null);
    if (res) await saveFile(res.blob, res.fileName, 'CSV', { 'text/csv': ['.csv'] });
  };

  const est = h?.netPayable;
  return (
    <div className="simple-page">
      <div className="page-head">
        <div>
          <h1>Tax summary — {fyLabel(fy)}</h1>
          <div className="simple-sub">{fyLongLabel(fy)} · the figures to copy into your tax return (myTax) or give to your accountant</div>
        </div>
        <div className="actions">
          <button className="primary" disabled={!!busy || !r} onClick={() => pdf('summary')}>
            {busy === 'summary' ? 'Generating…' : 'Download my tax return figures (PDF)'}
          </button>
        </div>
      </div>

      <div className="grid cols-2" style={{ gridTemplateColumns: 'minmax(0, 3fr) minmax(0, 2fr)' }}>
        <div className="panel">
          <h2>Review needed</h2>
          <TodoList fy={fy} onSetup={() => setSetup(true)} hideNotesLink />
        </div>
        <div className="panel">
          <h2>Your answers</h2>
          <table className="pl-table">
            <tbody>
              <tr><td>Residency</td><td className="num">{RESIDENCY[tp?.residency ?? 'unknown'] ?? tp?.residency}{tp?.residency === 'part_year' && tp.residentMonths ? ` (${tp.residentMonths} months)` : ''}</td></tr>
              <tr><td>Private hospital cover</td><td className="num">{tp?.privateHospitalCover === 'yes' && tp.daysWithoutCover ? `Part of the year (${tp.daysWithoutCover} days without)` : YES_NO[tp?.privateHospitalCover ?? 'unknown']}</td></tr>
              <tr><td>Spouse on 30 June</td><td className="num">{YES_NO[tp?.spouse ?? 'unknown']}</td></tr>
              <tr><td>Dependent children</td><td className="num">{tp?.dependants ?? 0}</td></tr>
              <tr><td>Study loan (HELP)</td><td className="num">{YES_NO[tp?.helpDebt ?? 'unknown']}</td></tr>
              <tr><td>Medicare exemption</td><td className="num">{tp?.medicareExemption === 'half' ? 'Half' : tp?.medicareExemption === 'full' ? 'Full' : tp?.medicareExemption === 'none' ? 'No' : 'Not answered'}</td></tr>
            </tbody>
          </table>
          <div className="row" style={{ marginTop: 10 }}>
            <button className={missingSetup(tp).length ? 'primary' : ''} onClick={() => setSetup(true)}>
              {missingSetup(tp).length ? 'Answer the questions' : 'Change answers'}
            </button>
          </div>
        </div>
      </div>

      {r && est !== undefined && (
        <div className="panel row" style={{ gap: 16, borderLeft: `6px solid ${est === null ? 'var(--border-strong)' : D(est).lt(0) ? '#8cc56b' : D(est).isZero() ? '#8cc56b' : '#d9534f'}` }}>
          <span style={{ fontSize: 28, fontWeight: 700 }}>{est === null ? 'Incomplete' : formatMoney(D(est).abs(), 'AUD', { dp: 2 })}</span>
          <span>
            <b>{est === null ? 'Fix the items above to see your estimate' : D(est).lt(0) ? 'Estimated refund' : 'Estimated tax to pay'}</b>
            <div className="muted">An estimate only — the ATO works out the real amount when you lodge.</div>
          </span>
        </div>
      )}

      {!r ? (
        <p className="muted">Working out your figures…</p>
      ) : groups.length === 0 ? (
        <div className="panel">
          <p className="muted">Nothing recorded for {fyLabel(fy)} yet.</p>
        </div>
      ) : (
        groups.map((g) => (
          <div className="panel" key={g.title}>
            <h2>{g.title}</h2>
            <table className="summary-lines">
              <tbody>
                {g.rows.map((row, i) => (
                  <tr key={i} className={row.strong ? 'total' : undefined}>
                    <td>
                      {row.label}
                      {row.where && row.where !== row.label && <span className="where">{row.where}</span>}
                    </td>
                    <td className="num">{amt(row.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))
      )}

      <div className="panel">
        <h2>Downloads</h2>
        <div className="row">
          <button className="primary" disabled={!!busy || !r} onClick={() => pdf('summary')}>
            {busy === 'summary' ? 'Generating…' : 'My tax return figures (PDF)'}
          </button>
          <button disabled={!!busy || !r} onClick={cgtCsv}>
            {busy === 'csv' ? 'Generating…' : 'Capital gains detail (CSV)'}
          </button>
          {settings.showFullReport && (
            <button disabled={!!busy || !r} onClick={() => pdf('full')}>
              {busy === 'full' ? 'Generating…' : 'Full accountant pack (PDF)'}
            </button>
          )}
        </div>
        {!settings.showFullReport && (
          <p className="faint" style={{ marginTop: 8 }}>
            Need the long, detailed report for an accountant? Turn it on in <button className="link" onClick={() => nav('/settings')}>Settings</button>.
          </p>
        )}
      </div>

      {notes.length > 0 && (
        <details className="panel">
          <summary>
            <b>Notes for your accountant ({notes.length})</b> <span className="muted">— things worth mentioning; they don’t stop you finishing</span>
          </summary>
          <ul style={{ marginTop: 8 }}>
            {notes.map((n, i) => (
              <li key={i} style={{ marginBottom: 6 }}>
                <b>{n.title}:</b> <span className="muted">{n.text}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
      <p className="faint">These figures come from the records you entered and the app’s built-in rules. They have not been checked by a registered tax agent — see “Notes for your accountant” and Tutorials for the app’s limits.</p>
      {setup && <SetupWizard onClose={() => setSetup(false)} />}
    </div>
  );
}
