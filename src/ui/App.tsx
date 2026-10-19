import { useEffect, useMemo, useRef, useState } from 'react';
import { HashRouter, NavLink, Route, Routes, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { getDb } from '../db/schema';
import { currentFY, fyLabel, listFYs } from '../lib/dates';
import { formatMoney } from '../lib/decimal';
import { AppProvider, useApp } from './AppContext';
import { Toasts } from './components/ui';
import { TxnEditor } from './components/TxnEditor';
import type { Transaction } from '../domain/types';
import { Dashboard } from './pages/Dashboard';
import { TaxBusiness } from './pages/TaxBusiness';
import { Trading } from './pages/Trading';
import { Transactions } from './pages/Transactions';
import { Imports } from './pages/Imports';
import { Documents } from './pages/Documents';
import { TaxCalc } from './pages/TaxCalc';
import { Reports } from './pages/Reports';
import { Reconciliation } from './pages/Reconciliation';
import { Settings } from './pages/Settings';
import { APP_VERSION } from '../services/settings';

export const NAV = [
  { path: '/', label: 'Dashboard', el: <Dashboard /> },
  { path: '/tax', label: 'Tax & Business', el: <TaxBusiness /> },
  { path: '/trading', label: 'Trading & Investments', el: <Trading /> },
  { path: '/transactions', label: 'Transactions', el: <Transactions /> },
  { path: '/imports', label: 'Imports', el: <Imports /> },
  { path: '/documents', label: 'Documents & Receipts', el: <Documents /> },
  { path: '/tax-calc', label: 'Tax Calculations', el: <TaxCalc /> },
  { path: '/reports', label: 'Reports & PDF Export', el: <Reports /> },
  { path: '/reconciliation', label: 'Reconciliation', el: <Reconciliation /> },
  { path: '/settings', label: 'Settings & Data', el: <Settings /> }
];

function SaveIndicator() {
  const { saveState, saveError } = useApp();
  if (saveState === 'idle') return <span className="save-ind saved" title="All changes are stored in this browser">Saved</span>;
  return (
    <span className={`save-ind ${saveState}`} title={saveError ?? undefined} role="status">
      {saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? 'Saved' : 'Save failed'}
    </span>
  );
}

function GlobalSearch() {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [hl, setHl] = useState(0);
  const [editing, setEditing] = useState<Transaction | null>(null);
  const nav = useNavigate();
  const ref = useRef<HTMLInputElement>(null);
  const results = useLiveQuery(async () => {
    const term = q.trim().toLowerCase();
    if (term.length < 2) return [];
    const db = getDb();
    const out: { label: string; sub: string; go: () => void }[] = [];
    const insts = await db.instruments.toArray();
    const instMatch = new Set(insts.filter((i) => i.symbol.toLowerCase().includes(term) || i.name.toLowerCase().includes(term)).map((i) => i.id));
    const txns = await db.transactions
      .filter((t) => t.status === 'active' && (t.description.toLowerCase().includes(term) || (t.counterparty ?? '').toLowerCase().includes(term) || (t.sourceId ?? '').toLowerCase().includes(term) || (t.notes ?? '').toLowerCase().includes(term) || t.tags.some((x) => x.toLowerCase().includes(term)) || instMatch.has(t.instrumentId ?? '')))
      .limit(12)
      .toArray();
    for (const t of txns) out.push({ label: t.description || t.category, sub: `${t.date} · ${t.kind} · ${formatMoney(t.amount, t.currency)}`, go: () => setEditing(t) });
    for (const a of (await db.accounts.toArray()).filter((a) => a.name.toLowerCase().includes(term)).slice(0, 4)) out.push({ label: a.name, sub: 'Account', go: () => nav('/trading?tab=accounts') });
    for (const i of insts.filter((i) => instMatch.has(i.id)).slice(0, 4)) out.push({ label: `${i.symbol} — ${i.name}`, sub: 'Instrument', go: () => nav(`/transactions?q=${encodeURIComponent(i.symbol)}`) });
    for (const d of (await db.documents.toArray()).filter((d) => d.title.toLowerCase().includes(term) || d.originalFilename.toLowerCase().includes(term)).slice(0, 4)) out.push({ label: d.title, sub: `Document · ${d.originalFilename}`, go: () => nav('/documents') });
    out.push({ label: `Search all transactions for “${q.trim()}”`, sub: 'Transactions', go: () => nav(`/transactions?q=${encodeURIComponent(q.trim())}`) });
    return out;
  }, [q]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '/' && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault();
        ref.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const pick = (i: number) => {
    results?.[i]?.go();
    setOpen(false);
    setQ('');
  };
  return (
    <div className="search">
      <input
        ref={ref}
        type="search"
        aria-label="Global search"
        placeholder="Search records, symbols, accounts, documents… ( / )"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
          setHl(0);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 200)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') setHl((h) => Math.min(h + 1, (results?.length ?? 1) - 1));
          if (e.key === 'ArrowUp') setHl((h) => Math.max(h - 1, 0));
          if (e.key === 'Enter') pick(hl);
          if (e.key === 'Escape') setOpen(false);
        }}
      />
      {open && !!results?.length && (
        <div className="search-results" role="listbox">
          {results.map((r, i) => (
            <button key={i} className={i === hl ? 'hl' : ''} role="option" aria-selected={i === hl} onMouseDown={() => pick(i)}>
              <div>{r.label}</div>
              <div className="faint" style={{ fontSize: 11 }}>
                {r.sub}
              </div>
            </button>
          ))}
        </div>
      )}
      {editing && <TxnEditor initial={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function FySelect() {
  const { fy, setFy, settings } = useApp();
  const earliest = useLiveQuery(async () => (await getDb().transactions.orderBy('fy').first())?.fy, []);
  const cur = currentFY(new Date(), settings.taxTimeZone);
  const years = listFYs(Math.min(earliest ?? cur - 3, cur - 3, fy), Math.max(cur, fy));
  return (
    <label className="row" style={{ gap: 4 }}>
      <span className="muted" style={{ fontSize: 12 }}>
        Financial year
      </span>
      <select aria-label="Selected financial year" value={fy} onChange={(e) => setFy(Number(e.target.value))}>
        {years.map((y) => (
          <option key={y} value={y}>
            {fyLabel(y)}
            {y === cur ? ' (current)' : ''}
          </option>
        ))}
      </select>
    </label>
  );
}

function BackupReminder() {
  const { settings } = useApp();
  const count = useLiveQuery(() => getDb().transactions.count(), [], 0);
  const days = settings.lastBackupAt ? (Date.now() - Date.parse(settings.lastBackupAt)) / 86_400_000 : Infinity;
  if (!count || days < settings.backupReminderDays) return null;
  return (
    <NavLink to="/settings?tab=backup" className="badge warn" title="Browser storage can be cleared — export a backup">
      {settings.lastBackupAt ? `Backup ${Math.floor(days)}d old` : 'No backup yet'}
    </NavLink>
  );
}

function Shell() {
  const { online } = useApp();
  const routes = useMemo(() => NAV.map((n) => <Route key={n.path} path={n.path} element={n.el} />), []);
  return (
    <div className="app">
      <nav className="sidebar" aria-label="Main navigation">
        <div className="brand">
          AU Tax & Trading Ledger
          <small>Local-first · v{APP_VERSION}</small>
        </div>
        <div className="nav">
          {NAV.map((n, i) => (
            <NavLink key={n.path} to={n.path} end={n.path === '/'}>
              <span className="num">{i + 1}</span>
              {n.label}
            </NavLink>
          ))}
        </div>
        <div className="sidebar-foot">Data stays in this browser. No telemetry. Not tax advice.</div>
      </nav>
      <div className="main">
        <header className="topbar">
          <GlobalSearch />
          <FySelect />
          <BackupReminder />
          <span className="spacer" />
          <SaveIndicator />
          <span className={`net-ind ${online ? '' : 'offline'}`} role="status">
            {online ? 'Online' : 'Offline'}
          </span>
        </header>
        <main className="content">
          <Routes>
            {routes}
            <Route path="*" element={<Dashboard />} />
          </Routes>
        </main>
      </div>
      <Toasts />
    </div>
  );
}

export function App() {
  return (
    <AppProvider>
      <HashRouter>
        <Shell />
      </HashRouter>
    </AppProvider>
  );
}
