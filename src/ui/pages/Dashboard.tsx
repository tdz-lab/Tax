import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { getDb } from '../../db/schema';
import { D } from '../../lib/decimal';
import { formatInstant, fyLabel, fyLongLabel } from '../../lib/dates';
import { TAX_CLASS_INFO } from '../../domain/reference';
import { QUALITY_LABEL, type QualityCode } from '../../engines/reconciliation/quality';
import type { TaxLine } from '../../engines/tax/taxEngine';
import { useApp } from '../AppContext';
import { useInstruments, useQuality, useTaxYear } from '../hooks';
import { Disclaimer, Money, Stat, StatusBadge } from '../components/ui';
import { TraceModal } from '../components/TxnTable';
import { loadDemoData } from '../../services/demo';
import { useTour } from '../tour/TourEngine';

const sumLines = (ls: TaxLine[], keys?: string[]) => {
  let total = D(0);
  const ids: string[] = [];
  for (const l of ls) {
    if (keys && !keys.includes(l.key)) continue;
    if (l.key.startsWith('ded_cat_')) continue;
    if (l.amount === null) return { amount: null as string | null, ids };
    total = total.plus(D(l.amount));
    ids.push(...l.sourceIds);
  }
  return { amount: total.toString(), ids };
};

export function Dashboard() {
  const { fy, settings, run } = useApp();
  const nav = useNavigate();
  const { value: r, loading, error } = useTaxYear(fy);
  const { value: q } = useQuality(fy);
  const [trace, setTrace] = useState<{ title: string; ids: string[] } | null>(null);
  const { start } = useTour();
  const instruments = useInstruments();
  const counts = useLiveQuery(async () => {
    const db = getDb();
    const txns = await db.transactions.where('fy').equals(fy).filter((t) => t.status === 'active').toArray();
    const fx = new Map<string, number>();
    for (const t of txns) if (t.currency !== 'AUD') fx.set(t.currency, (fx.get(t.currency) ?? 0) + 1);
    return {
      total: await db.transactions.count(),
      fy: txns.length,
      fx: [...fx].sort((a, b) => b[1] - a[1]),
      openRecon: await db.reconciliation.where('status').equals('open').count(),
      lastBatch: (await db.importBatches.orderBy('createdAt').last())?.createdAt
    };
  }, [fy]);
  const issue = (code: QualityCode) => q?.find((i) => i.code === code);
  const issueStat = (code: QualityCode, label?: string) => {
    const i = issue(code);
    const n = i?.txnIds.length ?? 0;
    return <Stat label={label ?? QUALITY_LABEL[code]} value={n} tone={n ? (i!.severity === 'blocking' ? 'bad' : 'warn') : 'ok'} onClick={n ? () => setTrace({ title: QUALITY_LABEL[code], ids: i!.txnIds }) : () => nav('/reconciliation')} />;
  };

  const tradingByClass = useMemo(() => {
    const m = new Map<string, { n: number; net: ReturnType<typeof D> | null; ids: string[] }>();
    for (const d of r?.disposals ?? []) {
      if (d.kind === 'quote_asset') continue;
      const e = m.get(d.taxClass) ?? { n: 0, net: D(0), ids: [] };
      e.n++;
      e.net = e.net === null || d.gainAud === null ? null : e.net.plus(D(d.gainAud));
      e.ids.push(d.txnId);
      m.set(d.taxClass, e);
    }
    for (const d of r?.derivativeEvents ?? []) {
      const e = m.get(d.taxClass) ?? { n: 0, net: D(0), ids: [] };
      e.n++;
      e.net = e.net === null || d.netAud === null ? null : e.net.plus(D(d.netAud));
      e.ids.push(d.txnId);
      m.set(d.taxClass, e);
    }
    return [...m];
  }, [r]);

  if (counts && counts.total === 0)
    return (
      <div>
        <div className="page-head">
          <h1>Welcome</h1>
        </div>
        <Disclaimer />
        <div className="panel">
          <h2>Get started</h2>
          <ol className="list-plain">
            <li>Record your residency for the year: <a href="#/tax?tab=profile">Tax & Business → Tax profile</a>.</li>
            <li>Create accounts (brokers, exchanges, wallets, prop firms, bank): <a href="#/trading?tab=accounts">Trading → Accounts</a> — choose each trading account’s tax treatment.</li>
            <li>Import historical exchange rates and statements: <a href="#/imports">Imports</a>, or add records manually from any list.</li>
            <li>Review <a href="#/reconciliation">data-quality issues</a>, then generate reports in <a href="#/reports">Reports</a>.</li>
            <li>Export a backup regularly: <a href="#/settings?tab=backup">Settings → Backup</a>. Browser storage alone is not a backup.</li>
          </ol>
          <div className="notice" style={{ marginTop: 8 }}>
            New here? <button className="primary small" onClick={() => start('getting-started')}>Take the 4-minute guided tour</button> or open <a href="#/tutorials">all interactive tutorials</a>.
          </div>
          <p className="muted">Want to explore first? Load fictional demonstration data (clearly marked, removable in Settings → Data health).</p>
          <button onClick={() => run(() => loadDemoData(), { success: 'Demonstration data loaded (fictional, marked DEMO).' }).then(() => settings.selectedFY !== 2025 && nav('/'))}>Load demonstration data</button>
        </div>
      </div>
    );

  const incomeLines = r?.income ?? [];
  const personal = sumLines(incomeLines);
  const divs = sumLines(incomeLines.filter((l) => l.key.startsWith('div') || l.key.includes('franking') || l.key.startsWith('trust')));
  const cryptoIds = new Set(instruments.filter((i) => ['crypto', 'stablecoin', 'nft'].includes(i.assetClass)).map((i) => i.id));
  const crypto = (r?.disposals ?? []).filter((d) => d.kind !== 'quote_asset' && cryptoIds.has(d.instrumentId));
  const cryptoNet = crypto.reduce<ReturnType<typeof D> | null>((s, d) => (s === null || d.gainAud === null ? null : s.plus(D(d.gainAud))), D(0));
  const cryptoIncome = incomeLines.find((l) => l.key === 'crypto_income');
  const bus = (k: string) => r?.business.find((l) => l.key === k);
  const est = (k: string) => r?.estimate.find((l) => l.key === k);

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Dashboard — {fyLabel(fy)}</h1>
          <span className="muted">{fyLongLabel(fy)} · {counts?.fy ?? 0} records this year</span>
        </div>
        <div className="actions">
          {r && <StatusBadge status={r.readiness.status} />}
          <button onClick={() => nav('/tax-calc')}>Tax calculation</button>
          <button onClick={() => nav('/reports')}>Reports</button>
        </div>
      </div>
      <Disclaimer />
      {error && <div className="notice bad">Calculation error: {error}</div>}
      {loading && !r && <p className="muted">Calculating…</p>}
      {r && (
        <>
          <h3>Income & tax</h3>
          <div className="grid cols-4" style={{ marginBottom: 10 }}>
            <Stat label="Personal income recorded" value={<Money value={personal.amount} />} sub="Recorded totals" onClick={() => setTrace({ title: 'Personal income', ids: personal.ids })} />
            <Stat label="Business income / expenses" value={<><Money value={bus('bus_income')?.amount ?? '0'} /> / <Money value={bus('bus_expenses')?.amount ?? '0'} /></>} sub={bus('bus_net') ? <>Net <Money value={bus('bus_net')!.amount} /></> : 'No business records'} onClick={() => nav('/tax?tab=business')} />
            <Stat label="Deductions recorded" value={<Money value={r.totals.deductions} />} sub={`${r.reviewItems.length} item(s) awaiting review excluded`} onClick={() => setTrace({ title: 'Deductions', ids: r.deductions.flatMap((l) => l.sourceIds) })} />
            <Stat
              label="Estimated taxable income"
              value={r.estimateStatus === 'not_available' ? <span className="badge bad">not available</span> : <Money value={est('taxable_income')?.amount ?? null} />}
              sub={r.estimateStatus === 'estimate' ? 'Estimate — subject to review' : r.estimateStatus === 'incomplete' ? 'INCOMPLETE — blocking issues' : 'Needs residency / rules'}
              tone={r.estimateStatus === 'estimate' ? undefined : 'bad'}
              onClick={() => nav('/tax-calc')}
            />
            <Stat label="Capital gains (gross) / losses" value={<><Money value={r.capital.currentYearGainsGross} /> / <Money value={r.capital.currentYearLosses} /></>} sub={<>Net capital gain <Money value={r.capital.incomplete ? null : r.capital.netCapitalGain} /></>} onClick={() => setTrace({ title: 'CGT events', ids: r.disposals.map((d) => d.txnId) })} />
            <Stat label="Dividends & distributions" value={<Money value={divs.amount} />} sub="incl. franking credits" onClick={() => setTrace({ title: 'Dividends', ids: divs.ids })} />
            <Stat label="Crypto income / realised disposals" value={<><Money value={cryptoIncome?.amount ?? '0'} /> · <Money value={cryptoNet === null ? null : cryptoNet.toString()} /></>} sub={`${crypto.length} crypto disposal(s); income at market value`} onClick={() => setTrace({ title: 'Crypto disposals', ids: crypto.map((d) => d.txnId).concat(cryptoIncome?.sourceIds ?? []) })} />
            <Stat label="Foreign income" value={<Money value={r.foreign.find((l) => l.key === 'foreign_income')?.amount ?? '0'} />} sub={counts?.fx.length ? `FX exposure: ${counts.fx.map(([c, n]) => `${c} ${n}`).join(', ')}` : 'No foreign-currency records'} onClick={() => setTrace({ title: 'Foreign income', ids: r.foreign.flatMap((l) => l.sourceIds) })} />
            <Stat label="Estimated tax payable / (refund)" value={<Money value={est('net_payable')?.amount ?? (r.estimateStatus === 'not_available' ? undefined : null)} />} sub={r.estimateStatus === 'estimate' ? `Estimate · ${r.ruleSetId}` : 'Not final — resolve issues first'} tone={r.estimateStatus === 'estimate' ? undefined : 'warn'} onClick={() => nav('/tax-calc')} />
          </div>
          <h3>Trading results by tax classification</h3>
          <div className="grid cols-4" style={{ marginBottom: 10 }}>
            {tradingByClass.length === 0 && <Stat label="Trading" value="No realised events" />}
            {tradingByClass.map(([cls, v]) => (
              <Stat key={cls} label={TAX_CLASS_INFO[cls as keyof typeof TAX_CLASS_INFO].label} value={<Money value={v.net === null ? null : v.net.toString()} />} sub={`${v.n} realised event(s)`} onClick={() => setTrace({ title: TAX_CLASS_INFO[cls as keyof typeof TAX_CLASS_INFO].label, ids: v.ids })} tone={cls === 'REVIEW' ? 'warn' : undefined} />
            ))}
          </div>
          <h3>Data quality & readiness</h3>
          <div className="grid cols-4" style={{ marginBottom: 10 }}>
            {issueStat('UNCLASSIFIED', 'Unclassified transactions')}
            {issueStat('MISSING_COST_BASE')}
            {issueStat('MISSING_RATE')}
            {issueStat('UNMATCHED_TRANSFER')}
            {issueStat('POSSIBLE_DUPLICATE', 'Duplicate-import warnings')}
            <Stat label="Open reconciliation items" value={(counts?.openRecon ?? 0) + (issue('UNRECONCILED_BALANCE') ? 1 : 0)} tone={counts?.openRecon ? 'warn' : 'ok'} onClick={() => nav('/reconciliation')} />
            {issueStat('MISSING_EVIDENCE', 'Missing evidence / receipts')}
            {issueStat('NEEDS_REVIEW', 'Classified for review')}
            <Stat label="Report readiness" value={<StatusBadge status={r.readiness.status} />} sub={`${r.readiness.blocking.length} blocking · ${r.readiness.warnings.length} warnings`} onClick={() => nav('/tax-calc')} />
            <Stat label="Last successful backup" value={settings.lastBackupAt ? formatInstant(settings.lastBackupAt, settings.taxTimeZone, { timeFormat: settings.timeFormat }) : 'Never'} tone={settings.lastBackupAt ? undefined : 'bad'} onClick={() => nav('/settings?tab=backup')} />
            <Stat label="Last successful import" value={counts?.lastBatch ? formatInstant(counts.lastBatch, settings.taxTimeZone, { timeFormat: settings.timeFormat }) : 'None'} onClick={() => nav('/imports')} />
            <Stat label="Tax rules" value={r.ruleSetId ?? 'none'} sub={<StatusBadge status={r.ruleStatus} />} onClick={() => nav('/settings?tab=rules')} />
          </div>
          {r.readiness.blocking.length > 0 && (
            <div className="notice bad">
              <b>Blocking items</b>
              <ul className="list-plain">
                {r.readiness.blocking.slice(0, 8).map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            </div>
          )}
          <p className="faint">Recorded = summed from your records; Calculated = engine result from records; Estimate = depends on assumptions and rule-set verification.</p>
        </>
      )}
      {trace && <TraceModal title={trace.title} ids={[...new Set(trace.ids)]} onClose={() => setTrace(null)} />}
    </div>
  );
}
