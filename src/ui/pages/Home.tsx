/** Simple-mode home: four headline numbers, one chart, a short to-do list and quick actions. */
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { getDb } from '../../db/schema';
import { D, formatMoney } from '../../lib/decimal';
import { daysBetween, fyEnd, fyLabel, fyLongLabel, fyStart } from '../../lib/dates';
import { audOf } from '../../engines/ledger';
import { headline } from '../../engines/tax/simpleFigures';
import { loadDemoData } from '../../services/demo';
import { useApp } from '../AppContext';
import { useQuality, useTaxYear } from '../hooks';
import { useTour } from '../tour/TourEngine';
import { LineChart, type Series } from '../simple/LineChart';
import { SetupWizard } from '../simple/SetupWizard';
import { buildTodos } from '../simple/todo';
import { plRows, QuickMoneyModal } from './Money';

const money = (v: string | null | undefined) => (v === undefined ? '—' : v === null ? 'incomplete' : formatMoney(v, 'AUD', { dp: 2 }));

export function TodoList({ fy, onSetup, hideNotesLink }: { fy: number; onSetup: () => void; hideNotesLink?: boolean }) {
  const nav = useNavigate();
  const { value: r } = useTaxYear(fy);
  const { value: q } = useQuality(fy);
  const tp = useLiveQuery(async () => (await getDb().taxProfiles.get(`tp_${fy}`)) ?? null, [fy]);
  const { todos, notes } = useMemo(() => buildTodos(r, q, tp, fyLabel(fy)), [r, q, tp, fy]);
  if (!r) return <p className="muted">Checking…</p>;
  return (
    <>
      {todos.length === 0 ? (
        <div className="row" style={{ gap: 12, padding: '6px 0' }}>
          <span className="big-check" aria-hidden>
            ✓
          </span>
          <div>
            <b>Nothing to fix</b>
            <div className="muted">Your figures for {fyLabel(fy)} are ready to review.</div>
          </div>
        </div>
      ) : (
        <ul className="todo">
          {todos.map((t) => (
            <li key={t.id}>
              <span className={`dot ${t.severity}`} />
              <span className="txt">
                <b>{t.text}</b>
                {t.detail && <div className="muted" style={{ fontSize: 12 }}>{t.detail}</div>}
              </span>
              <button className="small primary" onClick={() => (t.fix === 'setup' ? onSetup() : nav(t.fix))}>
                {t.fixLabel}
              </button>
            </li>
          ))}
        </ul>
      )}
      {notes.length > 0 && !hideNotesLink && (
        <p className="faint" style={{ marginTop: 6 }}>
          + {notes.length} note{notes.length === 1 ? '' : 's'} for your accountant — see <a href="#/tax-summary">Tax summary</a>.
        </p>
      )}
    </>
  );
}

export function Home() {
  const { fy, run, settings } = useApp();
  const nav = useNavigate();
  const { start } = useTour();
  const { value: r } = useTaxYear(fy);
  const [setup, setSetup] = useState(false);
  const [quick, setQuick] = useState<'in' | 'out' | null>(null);
  const total = useLiveQuery(() => getDb().transactions.count(), []);
  const txns = useLiveQuery(() => getDb().transactions.where('fy').equals(fy).filter((t) => t.status === 'active' && (t.kind === 'income' || t.kind === 'expense' || t.kind === 'fee')).toArray(), [fy], []);
  const h = r ? headline(r) : null;
  // Same cash-basis totals as the Income & expenses page, so the two screens always agree.
  const cash = useMemo(() => plRows(txns, new Map()), [txns]);

  const series = useMemo<Series[]>(() => {
    const start0 = fyStart(fy);
    const cum = (items: { date: string; v: number }[]) => {
      let acc = 0;
      return items
        .sort((a, b) => (a.date < b.date ? -1 : 1))
        .map((i) => ({ day: daysBetween(start0, i.date), value: (acc += i.v) }));
    };
    const inn = txns.filter((t) => t.kind === 'income').map((t) => ({ date: t.date, v: audOf(t, t.amount)?.toNumber() ?? 0 }));
    const out = txns.filter((t) => t.kind !== 'income').map((t) => ({ date: t.date, v: audOf(t, t.amount)?.toNumber() ?? 0 }));
    const trading = [...(r?.disposals ?? []).filter((d) => d.taxClass === 'CGT_EVENT' || d.taxClass === 'REVENUE_TRADING').map((d) => ({ date: d.date, v: d.gainAud ? Number(d.gainAud) : 0 })), ...(r?.derivativeEvents ?? []).filter((e) => e.taxClass === 'CGT_EVENT' || e.taxClass === 'REVENUE_TRADING').map((e) => ({ date: e.date, v: e.netAud ? Number(e.netAud) : 0 }))];
    return [
      { label: 'Income', color: '#8cc56b', points: cum(inn) },
      { label: 'Expenses', color: '#47aed6', points: cum(out) },
      { label: 'Trading gains / losses', color: '#f0b429', points: cum(trading) }
    ].filter((s) => s.points.length);
  }, [txns, r, fy]);

  if (total === 0)
    return (
      <div className="simple-page">
        <h1>Welcome</h1>
        <div className="simple-sub">Track your trading, side-project income and expenses, and get the figures for your tax return.</div>
        <div className="choice-cards">
          <button className="choice-card" onClick={() => setSetup(true)}>
            <b>1. Answer a few quick questions</b>
            <span>Residency, health cover, study loans — takes a minute.</span>
          </button>
          <button className="choice-card" onClick={() => nav('/money')}>
            <b>2. Add your income &amp; expense accounts</b>
            <span>Affiliate / CPA networks, PayPal, bank accounts — name them anything.</span>
          </button>
          <button className="choice-card" onClick={() => nav('/add-trades')}>
            <b>3. Add your trades</b>
            <span>Import files from your brokers and exchanges, or type trades in.</span>
          </button>
          <button className="choice-card" onClick={() => run(() => loadDemoData(), { success: 'Demonstration data loaded (fictional, marked DEMO).' })}>
            <b>Just exploring?</b>
            <span>Load fictional demonstration data (removable in Settings).</span>
          </button>
        </div>
        <p className="muted" style={{ marginTop: 14 }}>
          New here? <button className="link" onClick={() => start('getting-started')}>Take the guided tour</button>. Everything stays in this browser — nothing is uploaded.
        </p>
        {setup && <SetupWizard onClose={() => setSetup(false)} />}
      </div>
    );

  const est = h?.netPayable;
  const estBubble =
    !r || r.estimateStatus === 'not_available' || est === undefined
      ? { cls: 'slate', big: 'Answer', small: 'quick questions to see your tax', go: () => setSetup(true) }
      : est === null
        ? { cls: 'slate', big: '—', small: 'Tax estimate (fix the to-do list)', go: () => nav('/tax-summary') }
        : D(est).isZero()
          ? { cls: 'green', big: formatMoney('0', 'AUD', { dp: 0 }), small: 'Estimated tax to pay', go: () => nav('/tax-summary') }
          : D(est).lt(0)
          ? { cls: 'green', big: formatMoney(D(est).neg(), 'AUD', { dp: 0 }), small: 'Estimated refund', go: () => nav('/tax-summary') }
          : { cls: 'red', big: formatMoney(est, 'AUD', { dp: 0 }), small: 'Estimated tax to pay', go: () => nav('/tax-summary') };

  return (
    <div className="simple-page">
      <div className="page-head">
        <div>
          <h1>Your {fyLabel(fy)}</h1>
          <div className="simple-sub">
            {fyLongLabel(fy)}
            {settings.selectedFY !== null && ' · change the year at the top'}
          </div>
        </div>
        <div className="actions">
          <button className="primary" onClick={() => setQuick('in')}>+ Income</button>
          <button className="primary" onClick={() => setQuick('out')}>+ Expense</button>
          <button onClick={() => nav('/add-trades')}>+ Add trades</button>
        </div>
      </div>
      <div className="bubbles">
        <button className="bubble green" onClick={() => nav('/money')}>
          <span className="big">{money(cash.inTotal === null ? null : cash.inTotal.toString())}</span>
          <span className="small">Income</span>
        </button>
        <button className="bubble blue" onClick={() => nav('/money')}>
          <span className="big">{money(cash.outTotal === null ? null : cash.outTotal.toString())}</span>
          <span className="small">Expenses</span>
        </button>
        <button className="bubble amber" onClick={() => nav('/trading?tab=performance')}>
          <span className="big">{money(h?.trading)}</span>
          <span className="small">Trading gains</span>
        </button>
        <button className={`bubble ${estBubble.cls}`} onClick={estBubble.go}>
          <span className="big">{estBubble.big}</span>
          <span className="small">{estBubble.small}</span>
        </button>
      </div>
      <div className="grid cols-2" style={{ gridTemplateColumns: 'minmax(0, 3fr) minmax(0, 2fr)' }}>
        <div className="panel">
          <h2>Running totals — {fyLabel(fy)}</h2>
          <LineChart series={series} days={daysBetween(fyStart(fy), fyEnd(fy)) + 1} emptyText="Nothing recorded for this year yet." />
        </div>
        <div className="panel">
          <h2>To do</h2>
          <TodoList fy={fy} onSetup={() => setSetup(true)} />
        </div>
      </div>
      {setup && <SetupWizard onClose={() => setSetup(false)} />}
      {quick && <QuickMoneyModal direction={quick} onClose={() => setQuick(null)} />}
    </div>
  );
}
