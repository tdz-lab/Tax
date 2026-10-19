import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { getDb } from '../../db/schema';
import { TAX_CLASS_INFO } from '../../domain/reference';
import type { CalculationRun } from '../../domain/types';
import { D, formatMoney, formatQty } from '../../lib/decimal';
import { formatDate, formatInstant, fyLabel, fyLongLabel } from '../../lib/dates';
import { ruleSetFor } from '../../engines/tax/rules';
import type { TaxLine, TaxYearResult } from '../../engines/tax/taxEngine';
import { diffSummaries, saveCalculationRun } from '../../services/calc';
import { useApp } from '../AppContext';
import { useInstruments, useTaxYear } from '../hooks';
import { DataTable } from '../components/DataTable';
import { Disclaimer, Modal, Money, StatusBadge } from '../components/ui';
import { TraceModal } from '../components/TxnTable';

export function LinesTable({ lines, onTrace, title }: { lines: TaxLine[]; onTrace: (title: string, ids: string[]) => void; title?: string }) {
  if (!lines.length) return <p className="muted">{title ? `No ${title.toLowerCase()} recorded.` : 'Nothing recorded.'}</p>;
  return (
    <table className="dt">
      <thead>
        <tr>
          <th>Item</th>
          <th className="num">AUD</th>
          <th>Status</th>
          <th>Method / notes</th>
          <th className="num">Sources</th>
        </tr>
      </thead>
      <tbody>
        {lines.map((l) => (
          <tr key={l.key}>
            <td>{l.label}</td>
            <td className="num">
              <Money value={l.amount} />
            </td>
            <td>
              <StatusBadge status={l.status} />
            </td>
            <td className="faint" style={{ maxWidth: 420 }}>
              {[l.method, ...(l.notes ?? [])].filter(Boolean).join(' ')}
            </td>
            <td className="num">
              {l.sourceIds.length ? (
                <button className="link" onClick={() => onTrace(l.label, l.sourceIds)}>
                  {new Set(l.sourceIds).size} record(s)
                </button>
              ) : (
                '—'
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function TaxCalc() {
  const { fy, run, settings } = useApp();
  const { value: r, loading, error } = useTaxYear(fy);
  const instruments = useInstruments();
  const inst = new Map(instruments.map((i) => [i.id, i]));
  const [trace, setTrace] = useState<{ title: string; ids: string[] } | null>(null);
  const [reason, setReason] = useState('');
  const [viewRun, setViewRun] = useState<CalculationRun | null>(null);
  const runs = useLiveQuery(() => getDb().calcRuns.where('fy').equals(fy).toArray(), [fy], []) ?? [];
  const sortedRuns = [...runs].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const onTrace = (title: string, ids: string[]) => setTrace({ title, ids: [...new Set(ids)] });
  const rs = ruleSetFor(fy);
  const latest = sortedRuns[0];
  const changes = latest && r ? diffSummaries(latest.summary, Object.fromEntries(Object.entries(r.totals).map(([k, v]) => [k, v ?? 'incomplete']))) : [];

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Tax calculations — {fyLabel(fy)}</h1>
          <span className="muted">{fyLongLabel(fy)}</span>
        </div>
        <div className="actions">
          <input aria-label="Reason for snapshot" placeholder="Reason (e.g. after importing June statements)" value={reason} onChange={(e) => setReason(e.target.value)} style={{ width: 280 }} />
          <button className="primary" onClick={() => run(() => saveCalculationRun(fy, reason || 'Manual recalculation'), { success: 'Calculation snapshot saved. Earlier snapshots are kept unchanged.' }).then(() => setReason(''))}>
            Save calculation snapshot
          </button>
        </div>
      </div>
      <Disclaimer />
      {error && <div className="notice bad">{error}</div>}
      {loading && !r && <p>Calculating…</p>}
      {r && (
        <>
          <div className="panel">
            <div className="row">
              <b>Readiness:</b> <StatusBadge status={r.readiness.status} />
              <span>Estimate status: <StatusBadge status={r.estimateStatus === 'estimate' ? 'estimate' : r.estimateStatus === 'incomplete' ? 'incomplete' : 'blocking'} /></span>
              <span>
                Rules: <b>{r.ruleSetId ?? 'none'}</b> <StatusBadge status={r.ruleStatus} />
              </span>
              <span>Residency: <b>{r.residency}</b></span>
              {changes.length > 0 && <span className="badge warn">Results differ from the last snapshot ({changes.length} total(s) changed)</span>}
            </div>
          </div>
          {(r.readiness.blocking.length > 0 || r.issues.length > 0) && (
            <div className="panel">
              <h2>Warnings and unresolved items</h2>
              <table className="dt">
                <tbody>
                  {r.issues.map((i, n) => (
                    <tr key={n}>
                      <td style={{ width: 90 }}>
                        <StatusBadge status={i.severity} />
                      </td>
                      <td>{i.message}</td>
                      <td className="num">
                        {i.txnIds.length > 0 && (
                          <button className="link" onClick={() => onTrace(i.code, i.txnIds)}>
                            {i.txnIds.length} record(s)
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="grid cols-2">
            <div className="panel">
              <h2>1. Recorded income</h2>
              <LinesTable lines={r.income} onTrace={onTrace} title="Income" />
              <h3 style={{ marginTop: 10 }}>Foreign income & foreign tax</h3>
              <LinesTable lines={r.foreign} onTrace={onTrace} title="Foreign income" />
            </div>
            <div className="panel">
              <h2>1. Recorded deductions</h2>
              <LinesTable lines={r.deductions} onTrace={onTrace} title="Deductions" />
            </div>
            <div className="panel">
              <h2>2. Business income & expenses (calculated)</h2>
              <LinesTable lines={r.business} onTrace={onTrace} title="Business records" />
            </div>
            <div className="panel">
              <h2>2. Revenue trading results (calculated)</h2>
              <LinesTable lines={r.revenueTrading} onTrace={onTrace} title="Revenue trading" />
            </div>
          </div>
          <div className="panel">
            <h2>2. Capital gains and losses (calculated)</h2>
            <LinesTable lines={r.capitalLines} onTrace={onTrace} />
            <ol className="list-plain" style={{ marginTop: 6 }}>
              {r.capital.steps.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
            <CgtTable r={r} inst={inst} onTrace={onTrace} />
          </div>
          <div className="grid cols-2">
            <div className="panel">
              <h2>3. Estimates (depend on assumptions)</h2>
              {r.estimateStatus === 'not_available' ? (
                <div className="notice bad">A tax estimate is not available: {r.readiness.blocking.filter((b) => /residency|rule/i.test(b)).join(' ') || 'record residency and ensure a rule set exists for this year.'}</div>
              ) : (
                <>
                  {r.estimateStatus === 'incomplete' && <div className="notice bad">INCOMPLETE — blocking issues mean these figures are not reliable.</div>}
                  <LinesTable lines={r.estimate} onTrace={onTrace} />
                  <h3 style={{ marginTop: 8 }}>Offsets and credits</h3>
                  <LinesTable lines={r.offsetsAndCredits} onTrace={onTrace} />
                </>
              )}
              <h3 style={{ marginTop: 8 }}>Assumptions</h3>
              <ul className="list-plain">
                {r.assumptions.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            </div>
            <div className="panel">
              <h2>4. Awaiting review (excluded from totals)</h2>
              {r.reviewItems.length === 0 ? (
                <p className="muted">Nothing awaiting review.</p>
              ) : (
                <table className="dt">
                  <tbody>
                    {r.reviewItems.map((i) => (
                      <tr key={i.id}>
                        <td>
                          <button className="link" onClick={() => onTrace(i.label, [i.txnId])}>
                            {i.label}
                          </button>
                        </td>
                        <td className="num">
                          <Money value={i.amountAud} />
                        </td>
                        <td className="faint">{i.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <h3 style={{ marginTop: 8 }}>Excluded / non-assessable</h3>
              <p className="muted">
                {r.excluded.length} record(s){' '}
                {r.excluded.length > 0 && (
                  <button className="link" onClick={() => onTrace('Excluded records', r.excluded.map((e) => e.txnId))}>
                    view
                  </button>
                )}
              </p>
              <h2 style={{ marginTop: 10 }}>5. Ready for tax-agent review?</h2>
              <p>
                <StatusBadge status={r.readiness.status} /> {r.readiness.status === 'ready_for_agent_review' ? 'No blocking or warning items. Generate the full report for your tax agent.' : 'Resolve blocking items; warnings should be explained to your tax agent.'}
              </p>
            </div>
          </div>
          {rs && (
            <div className="panel">
              <h2>Rule set {rs.id}</h2>
              <p>
                Status: <StatusBadge status={rs.status} /> · Resident brackets: {rs.residentBrackets.map((b) => `${(Number(b.rate) * 100).toFixed(1)}% over $${b.above.toLocaleString()}`).join('; ')}
              </p>
              <details className="adv">
                <summary>Sources, notes and items not calculated</summary>
                <ul className="list-plain">
                  {rs.sources.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                  {rs.notes.map((s) => (
                    <li key={s}>
                      <b>Note:</b> {s}
                    </li>
                  ))}
                  {rs.notImplemented.map((s) => (
                    <li key={s}>
                      <b>Not calculated:</b> {s}
                    </li>
                  ))}
                </ul>
              </details>
            </div>
          )}
        </>
      )}
      <div className="panel tight">
        <div className="panel-head">
          <h2 style={{ margin: 0 }}>Calculation snapshots ({sortedRuns.length})</h2>
          <span className="muted">Snapshots are immutable; each records the rule set, input fingerprint and reason.</span>
        </div>
        <DataTable
          id="calc-runs"
          short
          rows={sortedRuns}
          rowKey={(c) => c.id}
          onRowClick={(c) => setViewRun(c)}
          columns={[
            { key: 'w', header: 'Created', render: (c) => formatInstant(c.createdAt, settings.taxTimeZone, { timeFormat: settings.timeFormat }), sortValue: (c) => c.createdAt },
            { key: 'r', header: 'Reason', render: (c) => c.reason },
            { key: 'rs', header: 'Rule set', render: (c) => c.ruleSetId },
            { key: 'ti', header: 'Taxable income', numeric: true, render: (c) => (c.summary.taxableIncome === 'incomplete' ? 'incomplete' : formatMoney(c.summary.taxableIncome)) },
            { key: 'np', header: 'Net payable', numeric: true, render: (c) => (c.summary.netPayable === 'incomplete' ? 'incomplete' : formatMoney(c.summary.netPayable)) },
            { key: 'wc', header: 'Warnings', numeric: true, render: (c) => c.warningsCount },
            { key: 'h', header: 'Input fingerprint', render: (c) => <span className="mono">{c.inputHash}</span>, hidden: true }
          ]}
          emptyText="No snapshots yet. Reports create one automatically."
        />
      </div>
      {viewRun && (
        <Modal title={`Snapshot ${viewRun.id}`} onClose={() => setViewRun(null)}>
          <p>
            {formatInstant(viewRun.createdAt, settings.taxTimeZone)} · {viewRun.ruleSetId} · {viewRun.reason}
            {viewRun.supersedesId && <> · supersedes {viewRun.supersedesId}</>}
          </p>
          <table className="dt">
            <thead>
              <tr>
                <th>Total</th>
                <th className="num">At snapshot</th>
                <th className="num">Now</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(viewRun.summary).map(([k, v]) => (
                <tr key={k}>
                  <td>{k}</td>
                  <td className="num">{v}</td>
                  <td className="num">{r?.totals[k] ?? 'incomplete'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Modal>
      )}
      {trace && <TraceModal title={trace.title} ids={trace.ids} onClose={() => setTrace(null)} />}
    </div>
  );
}

function CgtTable({ r, inst, onTrace }: { r: TaxYearResult; inst: Map<string, { symbol: string }>; onTrace: (t: string, ids: string[]) => void }) {
  const { settings } = useApp();
  const [open, setOpen] = useState<string | null>(null);
  const rows = r.disposals.filter((d) => d.kind !== 'quote_asset' || d.gainAud !== '0');
  return (
    <>
      <h3 style={{ marginTop: 10 }}>Disposals and parcel allocations</h3>
      <DataTable
        id="cgt-disposals"
        rows={rows}
        rowKey={(d) => d.id}
        onRowClick={(d) => setOpen(open === d.id ? null : d.id)}
        columns={[
          { key: 'd', header: 'Date', render: (d) => formatDate(d.date, settings.dateFormat), sortValue: (d) => d.date },
          { key: 'i', header: 'Instrument', render: (d) => inst.get(d.instrumentId)?.symbol ?? d.instrumentId, sortValue: (d) => inst.get(d.instrumentId)?.symbol ?? '' },
          { key: 'k', header: 'Event', render: (d) => d.kind.replace(/_/g, ' ') },
          { key: 'q', header: 'Qty', numeric: true, render: (d) => formatQty(d.quantity) },
          { key: 'p', header: 'Proceeds', numeric: true, render: (d) => <Money value={d.proceedsAud} /> },
          { key: 'c', header: 'Cost base', numeric: true, render: (d) => <Money value={d.costAud} /> },
          { key: 'g', header: 'Gain / (loss)', numeric: true, render: (d) => <Money value={d.gainAud} />, sortValue: (d) => (d.gainAud === null ? null : Number(d.gainAud)) },
          { key: 'disc', header: 'Discount', render: (d) => (d.discountEligible ? <span className="badge ok">eligible</span> : d.allocations.some((a) => a.discountEligible) ? <span className="badge accent">partly</span> : 'no') },
          { key: 'm', header: 'Method', render: (d) => d.method },
          { key: 'cls', header: 'Class', render: (d) => TAX_CLASS_INFO[d.taxClass].label },
          {
            key: 'detail',
            header: 'Detail',
            render: (d) =>
              open === d.id ? (
                <div onClick={(e) => e.stopPropagation()}>
                  {d.allocations.map((a, i) => (
                    <div key={i} className="faint">
                      {a.lotId === 'UNKNOWN' ? 'No acquisition record' : <button className="link" onClick={() => onTrace('Acquisition', [a.sourceTxnId])}>parcel {a.acquiredDate}</button>}: {formatQty(a.quantity)} units, cost {a.costAud ? formatMoney(a.costAud) : '?'}, gain {a.gainAud ? formatMoney(a.gainAud) : '?'}, held {a.heldDays} days{a.discountEligible ? ' (discount)' : ''}
                    </div>
                  ))}
                  {d.flags.map((f) => (
                    <div key={f} className="neg">
                      {f}
                    </div>
                  ))}
                  <button className="link" onClick={() => onTrace('Disposal', [d.txnId])}>
                    open disposal record
                  </button>
                </div>
              ) : (
                <span className="faint">{d.allocations.length} parcel(s){d.flags.length ? ' · ⚠' : ''}</span>
              )
          }
        ]}
        footer={
          <tr>
            <td colSpan={6}>Total</td>
            <td className="num">{rows.some((d) => d.gainAud === null) ? 'incomplete' : formatMoney(rows.reduce((s, d) => s.plus(D(d.gainAud!)), D(0)))}</td>
            <td colSpan={4} />
          </tr>
        }
        emptyText="No disposals in this year."
      />
    </>
  );
}
