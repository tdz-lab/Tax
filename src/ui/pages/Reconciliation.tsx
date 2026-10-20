import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { getDb } from '../../db/schema';
import type { ReconciliationItem, Transaction } from '../../domain/types';
import { D, formatQty } from '../../lib/decimal';
import { formatDate, fyLabel, nowIso } from '../../lib/dates';
import { newId } from '../../lib/ids';
import { QUALITY_LABEL, findDuplicateGroups, reconcileBalances, suggestTransferMatches } from '../../engines/reconciliation/quality';
import { bulkUpdateTransactions, markNotDuplicate, softDeleteTransactions, restoreTransactions } from '../../services/ledger';
import { useApp, useSessionState } from '../AppContext';
import { useAccounts, useInstruments, useQuality, useWorkspace } from '../hooks';
import { DataTable } from '../components/DataTable';
import { EntityModal } from '../components/EntityModal';
import { StatusBadge, Tabs } from '../components/ui';
import { TraceModal, TxnTable } from '../components/TxnTable';

type Tab = 'quality' | 'balances' | 'transfers' | 'duplicates' | 'unclassified';

export function Reconciliation() {
  const { fy } = useApp();
  const [params] = useSearchParams();
  const [tab, setTab] = useSessionState<Tab>('recon-tab', (params.get('tab') as Tab) || 'quality');
  const wanted = params.get('tab') as Tab | null;
  useEffect(() => {
    if (wanted) setTab(wanted);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wanted]);
  return (
    <div>
      <div className="page-head">
        <h1>Reconciliation & data quality — {fyLabel(fy)}</h1>
        <span className="muted">Nothing here creates artificial transactions to force balances to match.</span>
      </div>
      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'quality', label: 'Data-quality summary' },
          { id: 'balances', label: 'Statement balances' },
          { id: 'transfers', label: 'Transfer matching' },
          { id: 'duplicates', label: 'Possible duplicates' },
          { id: 'unclassified', label: 'Unresolved classifications' }
        ]}
      />
      {tab === 'quality' && <QualityTab />}
      {tab === 'balances' && <BalancesTab />}
      {tab === 'transfers' && <TransfersTab />}
      {tab === 'duplicates' && <DuplicatesTab />}
      {tab === 'unclassified' && <UnclassifiedTab />}
    </div>
  );
}

function QualityTab() {
  const { fy } = useApp();
  const [scope, setScope] = useSessionState<'fy' | 'all'>('dq-scope', 'fy');
  const { value: issues, loading } = useQuality(scope === 'fy' ? fy : undefined);
  const [trace, setTrace] = useState<{ title: string; ids: string[] } | null>(null);
  return (
    <div className="panel">
      <div className="row" style={{ marginBottom: 8 }}>
        <select aria-label="Scope" value={scope} onChange={(e) => setScope(e.target.value as 'fy' | 'all')}>
          <option value="fy">{fyLabel(fy)}</option>
          <option value="all">All years</option>
        </select>
        {loading && <span className="muted">Checking…</span>}
      </div>
      {issues && issues.length === 0 && <div className="notice ok">No data-quality issues found.</div>}
      <table className="dt">
        <tbody>
          {(issues ?? []).map((i) => (
            <tr key={i.code}>
              <td style={{ width: 90 }}>
                <StatusBadge status={i.severity} />
              </td>
              <td style={{ width: 230 }}>
                <b>{QUALITY_LABEL[i.code]}</b>
              </td>
              <td>{i.message}</td>
              <td className="num">
                {i.txnIds.length > 0 && (
                  <button className="link" onClick={() => setTrace({ title: QUALITY_LABEL[i.code], ids: i.txnIds })}>
                    review {i.txnIds.length}
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {trace && <TraceModal title={trace.title} ids={trace.ids} onClose={() => setTrace(null)} />}
    </div>
  );
}

function BalancesTab() {
  const accounts = useAccounts();
  const instruments = useInstruments();
  const { value: ws } = useWorkspace();
  const itemsQ = useLiveQuery(() => getDb().reconciliation.toArray(), []);
  const items = useMemo(() => itemsQ ?? [], [itemsQ]);
  const [edit, setEdit] = useState<Partial<ReconciliationItem> | null>(null);
  const checks = useMemo(() => (ws ? reconcileBalances(ws.data, items, ws.deriv) : []), [ws, items]);
  const acct = new Map(accounts.map((a) => [a.id, a]));
  const inst = new Map(instruments.map((i) => [i.id, i]));
  const byId = new Map(items.map((i) => [i.id, i]));
  return (
    <div className="panel tight">
      <DataTable
        id="recon-items"
        rows={checks}
        rowKey={(c) => c.itemId}
        onRowClick={(c) => setEdit(byId.get(c.itemId) ?? null)}
        toolbar={
          <button className="small primary" onClick={() => setEdit({ id: newId('rec'), type: 'cash_balance', status: 'open', asAtDate: new Date().toISOString().slice(0, 10), linkedTxnIds: [], documentIds: [], createdAt: nowIso() })}>
            + Add statement balance
          </button>
        }
        columns={[
          { key: 'a', header: 'Account', render: (c) => acct.get(c.accountId ?? '')?.name ?? '', sortValue: (c) => acct.get(c.accountId ?? '')?.name ?? '' },
          { key: 't', header: 'Check', render: (c) => (c.type === 'holding' ? `Holding — ${inst.get(c.instrumentId ?? '')?.symbol ?? ''}` : `Cash — ${c.currency}`) },
          { key: 'd', header: 'As at', render: (c) => formatDate(c.asAtDate), sortValue: (c) => c.asAtDate },
          { key: 's', header: 'Statement', numeric: true, render: (c) => (c.statementValue ? formatQty(c.statementValue, 8) : '') },
          { key: 'r', header: 'Recorded', numeric: true, render: (c) => (c.recordedValue ? formatQty(c.recordedValue, 8) : '') },
          { key: 'x', header: 'Difference', numeric: true, render: (c) => (c.difference === null ? '' : <span className={D(c.difference).isZero() ? 'pos' : 'neg'}>{formatQty(c.difference, 8)}</span>) },
          { key: 'st', header: 'Status', render: (c) => <StatusBadge status={c.status} /> }
        ]}
        emptyText="Enter balances from broker, exchange, wallet, bank or prop-firm statements to compare them with your records."
      />
      {edit && (
        <EntityModal<ReconciliationItem>
          title="Statement balance check"
          table="reconciliation"
          initial={edit as ReconciliationItem}
          isNew={!items.some((i) => i.id === edit.id)}
          onClose={() => setEdit(null)}
          fields={[
            { key: 'type', label: 'Check type', type: 'select', options: [{ value: 'cash_balance', label: 'Cash balance' }, { value: 'holding', label: 'Holding quantity' }] },
            { key: 'accountId', label: 'Account', type: 'select', includeEmpty: 'Choose…', options: accounts.map((a) => ({ value: a.id, label: a.name })), required: true },
            { key: 'instrumentId', label: 'Instrument', type: 'select', includeEmpty: 'Choose…', options: instruments.map((i) => ({ value: i.id, label: i.symbol })), show: (r) => r.type === 'holding', required: true },
            { key: 'statementCurrency', label: 'Statement currency', type: 'text', show: (r) => r.type === 'cash_balance', hint: 'Defaults to account currency' },
            { key: 'asAtDate', label: 'Statement date (end of day)', type: 'date', required: true },
            { key: 'statementValue', label: 'Statement balance / quantity', type: 'signed', required: true },
            { key: 'status', label: 'Status', type: 'select', options: [{ value: 'open', label: 'Open' }, { value: 'reconciled', label: 'Reconciled' }, { value: 'explained', label: 'Difference explained' }] },
            { key: 'explanation', label: 'Explanation', type: 'textarea' }
          ]}
        />
      )}
    </div>
  );
}

function TransfersTab() {
  const { run } = useApp();
  const instruments = useInstruments();
  const accounts = useAccounts();
  const txnsQ = useLiveQuery(() => getDb().transactions.filter((t) => t.status === 'active' && (t.side === 'send' || t.side === 'receive')).toArray(), []);
  const txns = useMemo(() => txnsQ ?? [], [txnsQ]);
  const suggestions = useMemo(() => suggestTransferMatches(txns), [txns]);
  const byId = new Map(txns.map((t) => [t.id, t]));
  const inst = new Map(instruments.map((i) => [i.id, i]));
  const acct = new Map(accounts.map((a) => [a.id, a]));
  const unmatched = txns.filter((t) => !t.transferPairId && t.isOwnTransfer === undefined);
  const pair = async (s: string, r: string) => {
    await run(async () => {
      await bulkUpdateTransactions([s], { transferPairId: r, isOwnTransfer: true, relatedIds: [r], taxClass: 'TRANSFER_NO_DISPOSAL', taxClassSource: 'user' }, 'Matched own transfer');
      await bulkUpdateTransactions([r], { transferPairId: s, isOwnTransfer: true, relatedIds: [s], taxClass: 'TRANSFER_NO_DISPOSAL', taxClassSource: 'user' }, 'Matched own transfer');
    }, { success: 'Transfer matched — no disposal; any network fee is treated as a small disposal.' });
  };
  return (
    <>
      <div className="panel tight">
        <div className="panel-head">
          <h2 style={{ margin: 0 }}>Suggested own-account transfer matches</h2>
          <span className="muted">Same asset, different accounts, received ≤ sent (within 2%), within 72 hours.</span>
        </div>
        <DataTable
          id="transfer-suggest"
          short
          rows={suggestions}
          rowKey={(s) => s.sendId}
          columns={[
            { key: 'i', header: 'Asset', render: (s) => inst.get(s.instrumentId)?.symbol ?? '' },
            { key: 's', header: 'Sent from', render: (s) => `${acct.get(byId.get(s.sendId)?.accountId ?? '')?.name ?? ''} · ${byId.get(s.sendId)?.date}` },
            { key: 'r', header: 'Received in', render: (s) => `${acct.get(byId.get(s.receiveId)?.accountId ?? '')?.name ?? ''} · ${byId.get(s.receiveId)?.date}` },
            { key: 'q', header: 'Sent / received', render: (s) => `${formatQty(s.sendQty)} / ${formatQty(s.receiveQty)}` },
            { key: 'h', header: 'Hours apart', numeric: true, render: (s) => s.hoursApart },
            { key: 'c', header: 'Confidence', render: (s) => <span className={`badge ${s.confidence === 'high' ? 'ok' : 'warn'}`}>{s.confidence}</span> },
            { key: 'a', header: '', render: (s) => <button className="small primary" onClick={(e) => { e.stopPropagation(); void pair(s.sendId, s.receiveId); }}>Confirm match</button> }
          ]}
          emptyText="No transfer pairs to suggest."
        />
      </div>
      <div className="panel tight">
        <div className="panel-head">
          <h2 style={{ margin: 0 }}>Unmatched transfers ({unmatched.length})</h2>
          <span className="muted">Open a record to mark it as an own transfer or as a transfer to/from a third party.</span>
        </div>
        <TxnTable id="unmatched-transfers" rows={unmatched} />
      </div>
    </>
  );
}

function DuplicatesTab() {
  const { run, toast } = useApp();
  const txns = useLiveQuery(() => getDb().transactions.where('status').equals('active').toArray(), []);
  const groups = useMemo(() => findDuplicateGroups(txns ?? []), [txns]);
  const [selected, setSelected] = useState<Transaction[] | null>(null);
  return (
    <div className="panel">
      <p className="muted">Records with identical account, timestamp, instrument, side, quantity, price, amount and description that came from different sources. Identical fills within one import batch are not merged automatically.</p>
      {groups.length === 0 && <div className="notice ok">No likely duplicates.</div>}
      {groups.map((g, n) => (
        <div key={n} className="panel">
          <div className="row">
            <b>
              {g[0].date} · {g[0].description} · {g[0].amount} {g[0].currency}
            </b>
            <span className="badge warn">{g.length} copies</span>
            <span className="spacer" />
            <button className="small" onClick={() => setSelected(g)}>
              Compare
            </button>
            <button
              className="small danger"
              onClick={async () => {
                const del = g.slice(1).map((t) => t.id);
                const ok = await run(() => softDeleteTransactions(del, 'Duplicate removed'));
                if (ok !== undefined) toast(`Kept the first record, deleted ${del.length}.`, { undo: () => restoreTransactions(del) });
              }}
            >
              Keep first, delete others
            </button>
            <button className="small" onClick={() => run(() => markNotDuplicate(g.map((t) => t.id)), { success: 'Marked as legitimate separate records.' })}>
              Not duplicates
            </button>
          </div>
        </div>
      ))}
      {selected && <TraceModal title="Possible duplicates" ids={selected.map((t) => t.id)} onClose={() => setSelected(null)} />}
    </div>
  );
}

function UnclassifiedTab() {
  const { fy } = useApp();
  const rows = useLiveQuery(() => getDb().transactions.where('fy').equals(fy).filter((t) => t.status === 'active' && (t.taxClass === 'UNCLASSIFIED' || t.taxClass === 'REVIEW')).toArray(), [fy], []) ?? [];
  return (
    <div className="panel tight">
      <div className="panel-head">
        <span className="muted">Select records and use Bulk edit to set a classification. Choices are recorded in the audit history and the full report.</span>
      </div>
      <TxnTable id="unclassified" rows={rows} emptyText="Every record for this year has a classification." />
    </div>
  );
}
