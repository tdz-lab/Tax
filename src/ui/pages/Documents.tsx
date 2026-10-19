import { Fragment, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { getDb } from '../../db/schema';
import type { DocumentMeta, Transaction } from '../../domain/types';
import { formatDate, formatInstant, fyLabel } from '../../lib/dates';
import { formatMoney } from '../../lib/decimal';
import { ACCEPTED_TYPES, MAX_DOC_BYTES, addDocument, deleteDocument, linkDocument, openDocument, updateDocumentMeta } from '../../services/documents';
import { useApp, useSessionState } from '../AppContext';
import { DataTable } from '../components/DataTable';
import { Confirm, Modal, Select, TextInput, Tabs } from '../components/ui';
import { TxnTable } from '../components/TxnTable';
import { TxnEditor } from '../components/TxnEditor';

const DOC_TYPES: DocumentMeta['docType'][] = ['receipt', 'invoice', 'statement', 'payment_summary', 'contract', 'payout_statement', 'tax_statement', 'other'];

export function Documents() {
  const { fy, run, settings } = useApp();
  const [tab, setTab] = useSessionState<'docs' | 'missing'>('docs-tab', 'docs');
  const [filter, setFilter] = useSessionState('docs-filter', { scope: 'fy', type: '', unlinked: false });
  const docs = useLiveQuery(() => getDb().documents.toArray(), [], []) ?? [];
  const missing = useLiveQuery(() => getDb().transactions.where('fy').equals(fy).filter((t) => t.status === 'active' && (t.kind === 'expense' || t.kind === 'fee' || t.category === 'prop_payout') && t.documentIds.length === 0).toArray(), [fy], []) ?? [];
  const [edit, setEdit] = useState<DocumentMeta | null>(null);
  const rows = docs.filter((d) => (filter.scope === 'all' || d.fy === fy || (!d.fy && filter.scope === 'fy')) && (!filter.type || d.docType === filter.type) && (!filter.unlinked || d.linkedRecordIds.length === 0));
  const upload = async (files: FileList) => {
    for (const f of Array.from(files)) {
      if (f.size > MAX_DOC_BYTES) {
        await run(async () => { throw new Error(`${f.name} is larger than ${MAX_DOC_BYTES / 1048576} MB`); });
        continue;
      }
      await run(() => addDocument(f, { docType: f.name.toLowerCase().includes('statement') ? 'statement' : 'receipt' }), { success: `Stored ${f.name}` });
    }
  };
  return (
    <div>
      <div className="page-head">
        <h1>Documents & Receipts</h1>
        <div className="actions">
          <label className="btn primary">
            Add documents…
            <input type="file" multiple className="sr-only" aria-label="Add documents" accept={ACCEPTED_TYPES.join(',') + ',.csv,.pdf,.jpg,.jpeg,.png'} onChange={(e) => e.target.files && void upload(e.target.files).then(() => (e.target.value = ''))} />
          </label>
        </div>
      </div>
      <p className="muted">Files are stored in this browser’s database with a SHA-256 fingerprint and included in backups (if enabled). Basic metadata (PDF page count/title, image size, CSV header, dates in filenames) is extracted locally. <b>No OCR or automatic statement reading is performed.</b></p>
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'docs', label: `Documents (${docs.length})` }, { id: 'missing', label: `Records needing evidence — ${fyLabel(fy)} (${missing.length})` }]} />
      {tab === 'docs' && (
        <div className="panel tight">
          <DataTable
            id="docs"
            rows={rows}
            rowKey={(d) => d.id}
            onRowClick={(d) => setEdit(d)}
            toolbar={
              <>
                <select aria-label="Scope" value={filter.scope} onChange={(e) => setFilter({ ...filter, scope: e.target.value })}>
                  <option value="fy">{fyLabel(fy)}</option>
                  <option value="all">All years</option>
                </select>
                <select aria-label="Type" value={filter.type} onChange={(e) => setFilter({ ...filter, type: e.target.value })}>
                  <option value="">All types</option>
                  {DOC_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t.replace('_', ' ')}
                    </option>
                  ))}
                </select>
                <label className="row" style={{ gap: 4 }}>
                  <input type="checkbox" checked={filter.unlinked} onChange={(e) => setFilter({ ...filter, unlinked: e.target.checked })} /> Unlinked only
                </label>
              </>
            }
            columns={[
              { key: 'title', header: 'Title', render: (d) => d.title, sortValue: (d) => d.title, searchValue: (d) => `${d.title} ${d.originalFilename} ${d.notes ?? ''}` },
              { key: 'type', header: 'Type', render: (d) => d.docType.replace('_', ' '), sortValue: (d) => d.docType },
              { key: 'date', header: 'Date', render: (d) => formatDate(d.date), sortValue: (d) => d.date ?? '' },
              { key: 'fy', header: 'FY', render: (d) => (d.fy ? fyLabel(d.fy) : '—') },
              { key: 'file', header: 'File', render: (d) => d.originalFilename },
              { key: 'size', header: 'Size', numeric: true, render: (d) => `${(d.size / 1024).toFixed(0)} KB`, sortValue: (d) => d.size },
              { key: 'links', header: 'Linked', numeric: true, render: (d) => (d.linkedRecordIds.length ? d.linkedRecordIds.length : <span className="badge warn">0</span>), sortValue: (d) => d.linkedRecordIds.length },
              { key: 'hash', header: 'SHA-256', render: (d) => <span className="mono">{d.sha256.slice(0, 10)}…</span>, hidden: true },
              { key: 'imported', header: 'Added', render: (d) => formatInstant(d.importedAt, settings.taxTimeZone), hidden: true }
            ]}
            emptyText="No documents."
          />
        </div>
      )}
      {tab === 'missing' && (
        <div className="panel tight">
          <TxnTable id="missing-evidence" rows={missing} emptyText="Every expense, fee and payout this year has evidence linked." />
        </div>
      )}
      {edit && <DocModal doc={edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

function DocModal({ doc, onClose }: { doc: DocumentMeta; onClose: () => void }) {
  const { run, settings } = useApp();
  const [d, setD] = useState(doc);
  const [confirm, setConfirm] = useState(false);
  const [q, setQ] = useState('');
  const [newRec, setNewRec] = useState<Partial<Transaction> | null>(null);
  const linked = useLiveQuery(() => getDb().transactions.bulkGet(d.linkedRecordIds), [d.linkedRecordIds]);
  const live = useLiveQuery(() => getDb().documents.get(doc.id), [doc.id]);
  const candidates = useLiveQuery(async () => {
    if (q.trim().length < 2) return [];
    const term = q.toLowerCase();
    return getDb().transactions.filter((t) => t.status === 'active' && `${t.description} ${t.counterparty ?? ''} ${t.date} ${t.amount}`.toLowerCase().includes(term)).limit(10).toArray();
  }, [q]);
  const linkedRows = useMemo(() => (linked ?? []).filter(Boolean) as Transaction[], [linked]);
  return (
    <Modal
      title={`Document — ${d.title}`}
      onClose={onClose}
      size="wide"
      footer={
        <>
          <button className="danger" style={{ marginRight: 'auto' }} onClick={() => setConfirm(true)}>
            Delete document
          </button>
          <button onClick={async () => { const url = await openDocument(d.id); if (url) window.open(url, '_blank', 'noopener'); }}>Open file</button>
          <button className="primary" onClick={() => run(() => updateDocumentMeta({ ...(live ?? d), title: d.title, docType: d.docType, date: d.date, notes: d.notes }), { success: 'Saved.' })}>
            Save details
          </button>
          <button onClick={onClose}>Close</button>
        </>
      }
    >
      <div className="form-grid">
        <TextInput label="Title" value={d.title} onChange={(v) => setD({ ...d, title: v })} className="span-2" />
        <Select label="Type" value={d.docType} onChange={(v) => setD({ ...d, docType: v })} options={DOC_TYPES.map((t) => ({ value: t, label: t.replace('_', ' ') }))} />
        <TextInput label="Document date" type="date" value={d.date} onChange={(v) => setD({ ...d, date: v || undefined })} />
        <div className="field span-4">
          <label htmlFor="doc-notes">Notes</label>
          <textarea id="doc-notes" value={d.notes ?? ''} onChange={(e) => setD({ ...d, notes: e.target.value })} />
        </div>
      </div>
      <dl className="kv" style={{ marginTop: 8 }}>
        <dt>Original file</dt>
        <dd>
          {d.originalFilename} ({d.mimeType}, {(d.size / 1024).toFixed(1)} KB)
        </dd>
        <dt>SHA-256</dt>
        <dd className="mono">{d.sha256}</dd>
        <dt>Added</dt>
        <dd>{formatInstant(d.importedAt, settings.taxTimeZone)}</dd>
        <dt>Storage</dt>
        <dd>{d.storageStatus}</dd>
        {Object.entries(d.extracted ?? {}).map(([k, v]) => (
          <Fragment key={k}>
            <dt>Extracted: {k}</dt>
            <dd>{v}</dd>
          </Fragment>
        ))}
      </dl>
      <p className="faint">Extracted values are suggestions only — review them before creating a record.</p>
      <div className="row" style={{ margin: '8px 0' }}>
        <button className="small" onClick={() => setNewRec({ kind: 'expense', date: d.date, description: d.title, documentIds: [d.id] })}>
          Create expense from this document…
        </button>
        <input aria-label="Find record to link" placeholder="Find a record to link (description, date, amount)…" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 320 }} />
      </div>
      {!!candidates?.length && (
        <ul className="list-plain">
          {candidates.map((t) => (
            <li key={t.id}>
              {t.date} · {t.description} · {formatMoney(t.amount, t.currency)}{' '}
              <button className="link" onClick={() => run(() => linkDocument(d.id, t.id), { success: 'Linked.' }).then(() => setD((x) => ({ ...x, linkedRecordIds: [...new Set([...x.linkedRecordIds, t.id])] })))}>
                link
              </button>
            </li>
          ))}
        </ul>
      )}
      <h3>Linked records</h3>
      <TxnTable id="doc-linked" rows={linkedRows} emptyText="Not linked to any record." />
      {newRec && (
        <TxnEditor
          initial={newRec}
          onClose={async () => {
            setNewRec(null);
            const t = await getDb().transactions.filter((x) => x.documentIds.includes(d.id)).toArray();
            for (const x of t) if (!d.linkedRecordIds.includes(x.id)) await linkDocument(d.id, x.id);
          }}
        />
      )}
      {confirm && (
        <Confirm
          title="Delete document"
          danger
          message="Delete this file and unlink it from all records? This cannot be undone (except by restoring a backup)."
          onCancel={() => setConfirm(false)}
          onConfirm={async () => {
            await run(() => deleteDocument(d.id), { success: 'Document deleted.' });
            onClose();
          }}
        />
      )}
    </Modal>
  );
}
