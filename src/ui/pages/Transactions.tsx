import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { getDb } from '../../db/schema';
import { KIND_LABEL, TAX_CLASS_INFO } from '../../domain/reference';
import { TAX_CLASSES, TXN_KINDS } from '../../domain/types';
import { fyLabel } from '../../lib/dates';
import { useApp, useSessionState } from '../AppContext';
import { useAccounts, useInstruments } from '../hooks';
import { TxnTable } from '../components/TxnTable';

export function Transactions() {
  const { fy } = useApp();
  const [params] = useSearchParams();
  const accounts = useAccounts();
  const instruments = useInstruments();
  const symbols = useMemo(() => new Map(instruments.map((i) => [i.id, `${i.symbol} ${i.name}`])), [instruments]);
  const [f, setF] = useSessionState('txn-filters', { scope: 'fy', kind: '', taxClass: '', accountId: '', currency: '', deleted: false, missingRate: false });
  const all = useLiveQuery(() => (f.scope === 'fy' ? getDb().transactions.where('fy').equals(fy).toArray() : getDb().transactions.toArray()), [f.scope, fy], []);
  const q = params.get('q')?.toLowerCase();
  const ids = params.get('ids')?.split(',');
  const rows = useMemo(
    () =>
      (all ?? []).filter(
        (t) =>
          (f.deleted ? t.status === 'deleted' : t.status === 'active') &&
          (!f.kind || t.kind === f.kind) &&
          (!f.taxClass || t.taxClass === f.taxClass) &&
          (!f.accountId || t.accountId === f.accountId) &&
          (!f.currency || t.currency === f.currency) &&
          (!f.missingRate || (t.currency !== 'AUD' && !t.fx)) &&
          (!ids || ids.includes(t.id)) &&
          (!q || `${t.description} ${t.counterparty ?? ''} ${t.sourceId ?? ''} ${t.notes ?? ''} ${t.tags.join(' ')} ${symbols.get(t.instrumentId ?? '') ?? ''}`.toLowerCase().includes(q))
      ),
    [all, f, q, ids, symbols]
  );
  const currencies = useMemo(() => [...new Set((all ?? []).map((t) => t.currency))].sort(), [all]);
  return (
    <div>
      <div className="page-head">
        <h1>Transactions</h1>
        <span className="muted">Every income, expense, trade, transfer and adjustment — one shared ledger for both workspaces.</span>
      </div>
      <div className="panel tight">
        <div className="toolbar">
          <select aria-label="Scope" value={f.scope} onChange={(e) => setF({ ...f, scope: e.target.value })}>
            <option value="fy">{fyLabel(fy)}</option>
            <option value="all">All years</option>
          </select>
          <select aria-label="Type filter" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
            <option value="">All types</option>
            {TXN_KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </select>
          <select aria-label="Classification filter" value={f.taxClass} onChange={(e) => setF({ ...f, taxClass: e.target.value })}>
            <option value="">All classifications</option>
            {TAX_CLASSES.map((c) => (
              <option key={c} value={c}>
                {TAX_CLASS_INFO[c].label}
              </option>
            ))}
          </select>
          <select aria-label="Account filter" value={f.accountId} onChange={(e) => setF({ ...f, accountId: e.target.value })}>
            <option value="">All accounts</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          <select aria-label="Currency filter" value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value })}>
            <option value="">All currencies</option>
            {currencies.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
          <label className="row" style={{ gap: 4 }}>
            <input type="checkbox" checked={f.missingRate} onChange={(e) => setF({ ...f, missingRate: e.target.checked })} /> Missing rate
          </label>
          <label className="row" style={{ gap: 4 }}>
            <input type="checkbox" checked={f.deleted} onChange={(e) => setF({ ...f, deleted: e.target.checked })} /> Show deleted
          </label>
          {(q || ids) && <a href="#/transactions">Clear search</a>}
        </div>
        <TxnTable id="all-txns" rows={rows} />
      </div>
    </div>
  );
}
