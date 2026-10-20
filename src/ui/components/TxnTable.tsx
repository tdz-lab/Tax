/** Transaction list with filters, configurable columns, bulk edit/delete and the record editor. */
import { useEffect, useMemo, useState } from 'react';
import { ACCOUNT_TYPE_LABEL, KIND_LABEL, SIDE_LABEL, TAX_CLASS_INFO } from '../../domain/reference';
import { TAX_CLASSES, type TaxClass, type Transaction } from '../../domain/types';
import { D, formatMoney, formatQty } from '../../lib/decimal';
import { formatDate, formatInstant } from '../../lib/dates';
import { audOf, grossOf } from '../../engines/ledger';
import { getDb } from '../../db/schema';
import { bulkUpdateTransactions, restoreTransactions, softDeleteTransactions } from '../../services/ledger';
import { useApp } from '../AppContext';
import { useAccounts, useCategories, useInstruments } from '../hooks';
import { DataTable, type Column } from './DataTable';
import { Confirm, Modal, Select, TextInput } from './ui';
import { TxnEditor } from './TxnEditor';
import { MoveMoneyModal } from './MoveMoneyModal';
import { isMoneyMove } from '../../services/moves';

export function TxnTable({ id, rows, newDefaults, showAccount = true, emptyText, extraToolbar }: { id: string; rows: Transaction[]; newDefaults?: Partial<Transaction>; showAccount?: boolean; emptyText?: string; extraToolbar?: React.ReactNode }) {
  const { settings, run, toast } = useApp();
  const accounts = useAccounts();
  const instruments = useInstruments();
  const categories = useCategories();
  const [editing, setEditing] = useState<Partial<Transaction> | null>(null);
  const [moving, setMoving] = useState<Transaction | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulk, setBulk] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const acct = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);
  const inst = useMemo(() => new Map(instruments.map((i) => [i.id, i])), [instruments]);
  const catName = useMemo(() => new Map(categories.map((c) => [c.code, c.name])), [categories]);
  const signed = (t: Transaction) => t.side === 'realised_pnl' || t.side === 'financing' || t.side === 'settlement';
  const gross = (t: Transaction) => (signed(t) ? D(t.amount) : grossOf(t, inst.get(t.instrumentId ?? '')));
  const audValue = (t: Transaction) => (t.instrumentId && t.valuationAud && (t.kind === 'income' || t.side === 'swap') ? D(t.valuationAud) : audOf(t, gross(t)));

  const columns: Column<Transaction>[] = [
    { key: 'date', header: 'Date', render: (t) => formatDate(t.date, settings.dateFormat), sortValue: (t) => t.occurredAt, searchValue: (t) => t.date, width: 86 },
    { key: 'time', header: 'Time', render: (t) => (t.time ? formatInstant(t.occurredAt, t.timeZone, { timeFormat: settings.timeFormat }).split(' ').slice(1).join(' ') : ''), hidden: true, searchValue: () => '' },
    { key: 'kind', header: 'Type', render: (t) => (isMoneyMove(t) ? (t.side === 'send' ? 'Moved out' : 'Moved in') : t.side ? SIDE_LABEL[t.side] : KIND_LABEL[t.kind]), sortValue: (t) => t.side ?? t.kind },
    { key: 'description', header: 'Description', render: (t) => <>{t.description || <span className="faint">(none)</span>}{t.isDemo && <span className="badge"> demo</span>}</>, sortValue: (t) => t.description.toLowerCase(), searchValue: (t) => `${t.description} ${t.counterparty ?? ''} ${t.notes ?? ''} ${t.sourceId ?? ''} ${t.tags.join(' ')}` },
    { key: 'category', header: 'Category', render: (t) => catName.get(t.category) ?? t.category, sortValue: (t) => t.category },
    ...(showAccount ? [{ key: 'account', header: 'Account', render: (t: Transaction) => acct.get(t.accountId ?? '')?.name ?? '', sortValue: (t: Transaction) => acct.get(t.accountId ?? '')?.name ?? '', searchValue: (t: Transaction) => acct.get(t.accountId ?? '')?.name ?? '' }] : []),
    { key: 'symbol', header: 'Symbol', render: (t) => inst.get(t.instrumentId ?? '')?.symbol ?? '', sortValue: (t) => inst.get(t.instrumentId ?? '')?.symbol ?? '', searchValue: (t) => inst.get(t.instrumentId ?? '')?.symbol ?? '' },
    { key: 'qty', header: 'Qty', numeric: true, render: (t) => (t.quantity ? formatQty(t.quantity) : ''), sortValue: (t) => (t.quantity ? Number(t.quantity) : null) },
    { key: 'price', header: 'Price', numeric: true, render: (t) => (t.price ? formatQty(t.price, 6) : ''), sortValue: (t) => (t.price ? Number(t.price) : null) },
    { key: 'amount', header: 'Amount', numeric: true, render: (t) => { const g = gross(t); return g.isZero() ? '' : formatMoney(t.side === 'realised_pnl' || t.side === 'financing' || t.side === 'settlement' ? t.amount : g, t.currency); }, sortValue: (t) => gross(t).toNumber() },
    {
      key: 'aud',
      header: 'AUD',
      numeric: true,
      render: (t) => {
        const a = audValue(t);
        return a === null ? <span className="badge bad">no rate</span> : a.isZero() ? '' : formatMoney(a);
      },
      sortValue: (t) => audValue(t)?.toNumber() ?? null
    },
    { key: 'class', header: 'Tax classification', render: (t) => <span className={`badge ${t.taxClass === 'REVIEW' || t.taxClass === 'UNCLASSIFIED' ? 'warn' : ''}`}>{TAX_CLASS_INFO[t.taxClass].label}</span>, sortValue: (t) => t.taxClass, searchValue: (t) => TAX_CLASS_INFO[t.taxClass].label },
    { key: 'docs', header: 'Docs', render: (t) => (t.documentIds.length ? `📎${t.documentIds.length}` : ''), hidden: false, sortValue: (t) => t.documentIds.length },
    { key: 'recon', header: 'Recon', render: (t) => (t.reconStatus === 'reconciled' ? '✓' : ''), hidden: true, sortValue: (t) => t.reconStatus },
    { key: 'source', header: 'Source', render: (t) => t.source, hidden: true, sortValue: (t) => t.source },
    { key: 'fy', header: 'FY', render: (t) => t.fy, hidden: true, sortValue: (t) => t.fy }
  ];

  const ids = [...selected];
  return (
    <>
      <DataTable
        id={id}
        rows={rows}
        columns={columns}
        rowKey={(t) => t.id}
        onRowClick={(t) => (isMoneyMove(t) ? setMoving(t) : setEditing(t))}
        selectable
        selected={selected}
        onSelectedChange={setSelected}
        defaultSort={{ key: 'date', dir: 'desc' }}
        pageSize={settings.pageSize}
        emptyText={emptyText}
        toolbar={
          <>
            <button className="primary small" onClick={() => setEditing({ ...newDefaults })}>
              + New record
            </button>
            {extraToolbar}
            {selected.size > 0 && (
              <>
                <button className="small" onClick={() => setBulk(true)}>
                  Bulk edit ({selected.size})
                </button>
                <button className="small danger" onClick={() => setConfirmDel(true)}>
                  Delete ({selected.size})
                </button>
              </>
            )}
          </>
        }
      />
      {editing && <TxnEditor initial={editing} onClose={() => setEditing(null)} />}
      {moving && <MoveMoneyModal record={moving} onClose={() => setMoving(null)} />}
      {bulk && <BulkEdit ids={ids} onClose={() => { setBulk(false); setSelected(new Set()); }} />}
      {confirmDel && (
        <Confirm
          title="Delete records"
          danger
          confirmLabel={`Delete ${ids.length}`}
          message={<>Delete {ids.length} record(s)? They are moved to the deleted state and can be restored with Undo or from Settings → Data health.</>}
          requireText={ids.length > 20 ? 'DELETE' : undefined}
          onCancel={() => setConfirmDel(false)}
          onConfirm={async () => {
            setConfirmDel(false);
            const ok = await run(() => softDeleteTransactions(ids));
            if (ok !== undefined) {
              toast(`${ids.length} record(s) deleted.`, { undo: () => restoreTransactions(ids) });
              setSelected(new Set());
            }
          }}
        />
      )}
    </>
  );
}

function BulkEdit({ ids, onClose }: { ids: string[]; onClose: () => void }) {
  const { run } = useApp();
  const accounts = useAccounts();
  const categories = useCategories();
  const [category, setCategory] = useState('');
  const [taxClass, setTaxClass] = useState<TaxClass | ''>('');
  const [accountId, setAccountId] = useState('');
  const [tag, setTag] = useState('');
  const [recon, setRecon] = useState('');
  const [isBusiness, setIsBusiness] = useState('');
  const [reason, setReason] = useState('');
  const patch: Partial<Transaction> = {};
  if (category) patch.category = category;
  if (taxClass) {
    patch.taxClass = taxClass;
    patch.taxClassSource = 'user';
  } else if (category || accountId || isBusiness) patch.taxClassSource = 'default';
  if (accountId) patch.accountId = accountId;
  if (recon) patch.reconStatus = recon as Transaction['reconStatus'];
  if (isBusiness) patch.isBusiness = isBusiness === 'yes';
  return (
    <Modal
      title={`Bulk edit ${ids.length} record(s)`}
      onClose={onClose}
      size="small"
      footer={
        <>
          <button onClick={onClose}>Cancel</button>
          <button
            className="primary"
            disabled={!Object.keys(patch).length && !tag}
            onClick={async () => {
              const db = getDb();
              const ok = await run(
                async () => {
                  if (tag) {
                    for (const id of ids) {
                      const t = await db.transactions.get(id);
                      if (t && !t.tags.includes(tag)) await bulkUpdateTransactions([id], { tags: [...t.tags, tag] }, reason || 'Bulk tag');
                    }
                  }
                  if (Object.keys(patch).length) await bulkUpdateTransactions(ids, patch, reason || 'Bulk edit');
                  return true;
                },
                { success: `Updated ${ids.length} record(s).` }
              );
              if (ok) onClose();
            }}
          >
            Apply
          </button>
        </>
      }
    >
      <p className="muted">Only filled fields are changed. Changing category or account re-derives automatic classifications.</p>
      <div className="grid">
        <Select label="Category" value={category} includeEmpty="(unchanged)" onChange={setCategory} options={categories.map((c) => ({ value: c.code, label: `${c.type} · ${c.name}` }))} />
        <Select label="Tax classification" value={taxClass} includeEmpty="(unchanged)" onChange={(v) => setTaxClass(v as TaxClass)} options={TAX_CLASSES.map((c) => ({ value: c, label: TAX_CLASS_INFO[c].label }))} />
        <Select label="Account" value={accountId} includeEmpty="(unchanged)" onChange={setAccountId} options={accounts.map((a) => ({ value: a.id, label: `${a.name} (${ACCOUNT_TYPE_LABEL[a.type]})` }))} />
        <Select label="Business record" value={isBusiness} includeEmpty="(unchanged)" onChange={setIsBusiness} options={[{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]} />
        <Select label="Reconciliation" value={recon} includeEmpty="(unchanged)" onChange={setRecon} options={['unreconciled', 'reconciled', 'disputed', 'not_required'].map((x) => ({ value: x, label: x }))} />
        <TextInput label="Add tag" value={tag} onChange={setTag} />
        <TextInput label="Reason (audit trail)" value={reason} onChange={setReason} />
      </div>
    </Modal>
  );
}

/** Show the records behind a total. */
export function TraceModal({ title, ids, onClose }: { title: string; ids: string[]; onClose: () => void }) {
  const [rows, setRows] = useState<Transaction[] | null>(null);
  useEffect(() => {
    let alive = true;
    getDb().transactions.bulkGet(ids).then((r) => alive && setRows(r.filter(Boolean) as Transaction[]));
    return () => {
      alive = false;
    };
  }, [ids]);
  return (
    <Modal title={`Source records — ${title}`} onClose={onClose} size="wide">
      {rows ? <TxnTable id={`trace`} rows={rows} /> : <p>Loading…</p>}
    </Modal>
  );
}
