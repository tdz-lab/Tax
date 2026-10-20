import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { getDb } from '../../db/schema';
import type { ImportBatch, ImportTarget, ImportTemplate } from '../../domain/types';
import { SIDES } from '../../domain/types';
import { SIDE_LABEL } from '../../domain/reference';
import { formatInstant, isValidZone } from '../../lib/dates';
import { readFileText } from '../../lib/files';
import { formatMoney } from '../../lib/decimal';
import { newId } from '../../lib/ids';
import { TARGET_FIELDS, TARGET_LABEL, autoMap } from '../../import/fields';
import { SAMPLE_FILES, detectTemplate, wideRatesToLong } from '../../import/templates';
import { detectDateFormat, normaliseSide, parseCsv, prepareRows, type PreparedRow } from '../../import/transform';
import { commitImport, editedSinceImport, loadDedupeMaps, rollbackImport, totalsPreview } from '../../import/commit';
import { refreshAllConversions, saveEntity } from '../../services/ledger';
import { loadSettings } from '../../services/settings';
import Papa from 'papaparse';
import { useApp } from '../AppContext';
import { useAccounts } from '../hooks';
import { DataTable } from '../components/DataTable';
import { Confirm, Select, StatusBadge, TextInput } from '../components/ui';

type Step = 'file' | 'map' | 'preview' | 'done';
const TARGETS = Object.keys(TARGET_LABEL) as ImportTarget[];

export function Imports() {
  const { settings } = useApp();
  return (
    <div>
      <div className="page-head">
        <h1>Imports</h1>
        <span className="muted">CSV statements from brokers, exchanges, wallets, banks, prop firms and rate tables — processed entirely on this device.</span>
      </div>
      <Wizard />
      <History />
      <div className="panel">
        <h2>Sample files & CSV templates (fictional demonstration data)</h2>
        <p className="muted">Each sample matches a built-in template. All values — including exchange rates — are invented and marked DEMO.</p>
        <div className="row">
          {SAMPLE_FILES.map((s) => (
            <a key={s.file} className="btn small" href={`./samples/${s.file}`} download={s.file}>
              {s.label}
            </a>
          ))}
          <a className="btn small" href="./samples/README.txt" download>
            README
          </a>
        </div>
        <p className="faint" style={{ marginTop: 6 }}>Time zone for FY assignment: {settings.taxTimeZone}. Times in files are interpreted in the template’s time zone unless the file carries a UTC offset.</p>
      </div>
    </div>
  );
}

function Wizard() {
  const { run, toast } = useApp();
  const accounts = useAccounts();
  const templates = useLiveQuery(() => getDb().importTemplates.toArray(), [], []) ?? [];
  const [step, setStep] = useState<Step>('file');
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [target, setTarget] = useState<ImportTarget>('trade');
  const [tpl, setTpl] = useState<Omit<ImportTemplate, 'createdAt' | 'updatedAt'> | null>(null);
  const [params] = useSearchParams();
  const [accountId, setAccountId] = useState(params.get('account') ?? '');
  const [rows, setRows] = useState<PreparedRow[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rawRows, setRawRows] = useState<Record<string, string>[]>([]);
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [dateNote, setDateNote] = useState<string | null>(null);
  const [result, setResult] = useState<ImportBatch | null>(null);
  const [tplName, setTplName] = useState('');
  const [wide, setWide] = useState<{ enabled: boolean; dateCol: string; direction: 'units_per_aud' | 'aud_per_unit'; source: string }>({ enabled: false, dateCol: '', direction: 'units_per_aud', source: '' });

  const reset = () => {
    setStep('file');
    setFile(null);
    setTpl(null);
    setRows([]);
    setResult(null);
  };

  const parse = (text: string, t: { delimiter?: string; skipRows?: number }) => {
    const p = parseCsv(text, t);
    setHeaders(p.headers);
    setRawRows(p.rows);
    setParseErrors(p.errors);
    return p;
  };

  const onFile = async (f: File) => {
    const text = await readFileText(f);
    setFile({ name: f.name, text });
    const p = parse(text, {});
    const detected = detectTemplate(p.headers, templates as ImportTemplate[]);
    const dateSamples = p.rows.slice(0, 50).map((r) => r[detected?.mapping.date ?? autoMap(target, p.headers).date ?? ''] ?? '');
    const df = detectDateFormat(dateSamples);
    setDateNote(df.ambiguous || df.suggestion !== 'auto' ? df.note : null);
    if (detected) {
      setTarget(detected.target);
      setTpl({ ...detected });
      toast(`Recognised layout: ${detected.name}`);
    } else {
      const s = await loadSettings();
      setTpl({ id: newId('tpl'), name: '', target, dateFormat: df.suggestion, timeZone: s.taxTimeZone, decimalSeparator: '.', mapping: autoMap(target, p.headers), constants: {}, builtin: false });
    }
    setStep('map');
  };

  const changeTarget = (t: ImportTarget) => {
    setTarget(t);
    if (tpl) setTpl({ ...tpl, target: t, mapping: autoMap(t, headers) });
  };

  const effectiveRows = useMemo(() => (wide.enabled && wide.dateCol ? wideRatesToLong(rawRows, wide.dateCol, wide.direction, wide.source || 'Imported rate table') : rawRows), [rawRows, wide]);
  const effectiveTpl = useMemo(() => (tpl && wide.enabled ? { ...tpl, target: 'rates' as ImportTarget, mapping: { date: 'Date', base: 'Base', quote: 'Quote', rate: 'Rate', source: 'Source', type: 'Type' } } : tpl), [tpl, wide.enabled]);
  const unknownSides = useMemo(() => {
    if (!tpl || (tpl.target !== 'trade' && tpl.target !== 'transfer') || !tpl.mapping.side) return [];
    const vals = new Set(rawRows.map((r) => r[tpl.mapping.side]).filter(Boolean));
    return [...vals].filter((v) => !normaliseSide(v, tpl.valueMaps?.side));
  }, [tpl, rawRows]);

  const buildPreview = async () => {
    if (!effectiveTpl) return;
    const db = getDb();
    const maps = await loadDedupeMaps();
    const s = await loadSettings();
    const accts = await db.accounts.toArray();
    const prepared = prepareRows(effectiveRows, {
      target: effectiveTpl.target,
      template: effectiveTpl,
      account: accts.find((a) => a.id === accountId),
      accountsByName: new Map(accts.map((a) => [a.name.trim().toLowerCase(), a])),
      existingBySource: maps.bySource,
      existingByFingerprint: maps.byFingerprint,
      defaultCurrency: s.defaultCurrency
    });
    setRows(prepared);
    setStep('preview');
  };

  const commit = async () => {
    if (!file || !effectiveTpl) return;
    const { id: _i, builtin: _b, name: _n, ...snapshot } = effectiveTpl;
    const batch = await run(() => commitImport({ filename: file.name, fileText: file.text, target: effectiveTpl.target, template: snapshot as any, templateId: effectiveTpl.builtin ? effectiveTpl.id : undefined, accountId: accountId || undefined, rows }));
    if (batch) {
      if (batch.target === 'rates') {
        const r = await refreshAllConversions(`Rates imported from ${file.name}`);
        toast(`Rates imported. ${r.updated} transaction conversion(s) updated; ${r.stillMissing} still missing a rate.`);
      }
      setResult(batch);
      setStep('done');
    }
  };

  const fields = tpl ? TARGET_FIELDS[effectiveTpl!.target] : [];
  const totals = totalsPreview(rows);
  const needsAccount = tpl && tpl.target !== 'rates' && !wide.enabled && !tpl.mapping.account;
  const missingRequired = fields.filter((f) => f.required && !tpl?.mapping[f.key] && !tpl?.constants[f.key]).map((f) => f.label);

  return (
    <div className="panel">
      <div className="row" style={{ marginBottom: 8 }}>
        <h2 style={{ margin: 0 }}>Import a file</h2>
        <span className="spacer" />
        {(['file', 'map', 'preview', 'done'] as Step[]).map((s, i) => (
          <span key={s} className={`badge ${step === s ? 'accent' : ''}`}>
            {i + 1}. {s === 'file' ? 'Select file' : s === 'map' ? 'Map columns' : s === 'preview' ? 'Preview & validate' : 'Summary'}
          </span>
        ))}
        {step !== 'file' && (
          <button className="small" onClick={reset}>
            Start over
          </button>
        )}
      </div>
      {step === 'file' && (
        <div className="row">
          <Select label="What does the file contain?" value={target} onChange={changeTarget} options={TARGETS.map((t) => ({ value: t, label: TARGET_LABEL[t] }))} />
          <label className="btn primary" style={{ alignSelf: 'flex-end' }}>
            Choose CSV file…
            <input type="file" accept=".csv,.txt,text/csv" className="sr-only" aria-label="CSV file" onChange={(e) => e.target.files?.[0] && void onFile(e.target.files[0])} />
          </label>
          <span className="faint" style={{ alignSelf: 'flex-end' }}>The layout is detected automatically when it matches a saved template.</span>
        </div>
      )}
      {step === 'map' && tpl && file && (
        <>
          <p>
            <b>{file.name}</b> — {rawRows.length} data row(s), {headers.length} column(s).{' '}
            {tpl.builtin && <span className="badge ok">Template: {tpl.name}</span>}
          </p>
          {parseErrors.length > 0 && <div className="notice warn">{parseErrors.slice(0, 5).join(' · ')}</div>}
          {dateNote && <div className="notice warn">{dateNote}</div>}
          <div className="form-grid">
            <Select label="Record type" value={tpl.target} onChange={changeTarget} options={TARGETS.map((t) => ({ value: t, label: TARGET_LABEL[t] }))} className="span-2" />
            {tpl.target !== 'rates' && (
              <Select label={`Default account${needsAccount ? ' (required)' : ''}`} value={accountId} includeEmpty="Choose…" onChange={setAccountId} options={accounts.map((a) => ({ value: a.id, label: a.name }))} className="span-2" />
            )}
            <TextInput label="Date format" value={tpl.dateFormat} onChange={(v) => setTpl({ ...tpl, dateFormat: v || 'auto' })} hint="auto, dd/MM/yyyy, MM/dd/yyyy, yyyy-MM-dd…" />
            <TextInput label="Time zone of times in file" value={tpl.timeZone} onChange={(v) => setTpl({ ...tpl, timeZone: v })} hint={isValidZone(tpl.timeZone) ? 'IANA zone, e.g. America/New_York, UTC' : 'Unknown zone'} />
            <Select label="Decimal separator" value={tpl.decimalSeparator} onChange={(v) => setTpl({ ...tpl, decimalSeparator: v })} options={[{ value: '.', label: '1,234.56' }, { value: ',', label: '1.234,56' }]} />
            <TextInput
              label="Skip leading rows"
              type="number"
              value={String(tpl.skipRows ?? 0)}
              onChange={(v) => {
                const n = Math.max(0, Number(v) || 0);
                setTpl({ ...tpl, skipRows: n });
                const p = parse(file.text, { delimiter: tpl.delimiter, skipRows: n });
                setTpl((t) => (t ? { ...t, skipRows: n, mapping: t.builtin ? t.mapping : autoMap(t.target, p.headers) } : t));
              }}
            />
          </div>
          {tpl.target === 'rates' && (
            <fieldset style={{ marginTop: 8 }}>
              <legend>Rate table layout</legend>
              <div className="form-grid">
                <Select label="Layout" value={wide.enabled ? 'wide' : 'long'} onChange={(v) => setWide({ ...wide, enabled: v === 'wide' })} options={[{ value: 'long', label: 'Long: date, base, quote, rate per row' }, { value: 'wide', label: 'Wide: date column + one column per currency code' }]} className="span-2" />
                {wide.enabled && (
                  <>
                    <Select label="Date column" value={wide.dateCol} includeEmpty="Choose…" onChange={(v) => setWide({ ...wide, dateCol: v })} options={headers.map((h) => ({ value: h, label: h }))} />
                    <Select label="Values are" value={wide.direction} onChange={(v) => setWide({ ...wide, direction: v })} options={[{ value: 'units_per_aud', label: 'Units of currency per 1 AUD' }, { value: 'aud_per_unit', label: 'AUD per 1 unit of currency' }]} />
                    <TextInput label="Source name (required)" value={wide.source} onChange={(v) => setWide({ ...wide, source: v })} className="span-2" placeholder="e.g. RBA F11 table downloaded 2025-07-03" />
                  </>
                )}
              </div>
            </fieldset>
          )}
          {!wide.enabled && (
            <table className="dt" style={{ marginTop: 8 }}>
              <thead>
                <tr>
                  <th>Field</th>
                  <th>Column in file</th>
                  <th>Sample values</th>
                  <th>Or constant value</th>
                </tr>
              </thead>
              <tbody>
                {fields.map((f) => (
                  <tr key={f.key}>
                    <td>
                      {f.label}
                      {f.required && <span className="neg"> *</span>}
                      {f.help && <div className="faint">{f.help}</div>}
                    </td>
                    <td>
                      <select aria-label={`Column for ${f.label}`} value={tpl.mapping[f.key] ?? ''} onChange={(e) => setTpl({ ...tpl, mapping: { ...tpl.mapping, [f.key]: e.target.value } })}>
                        <option value="">(not mapped)</option>
                        {headers.map((h) => (
                          <option key={h}>{h}</option>
                        ))}
                      </select>
                    </td>
                    <td className="faint">{tpl.mapping[f.key] ? rawRows.slice(0, 3).map((r) => r[tpl.mapping[f.key]]).join(' | ') : ''}</td>
                    <td>
                      <input aria-label={`Constant for ${f.label}`} value={tpl.constants[f.key] ?? ''} onChange={(e) => setTpl({ ...tpl, constants: { ...tpl.constants, [f.key]: e.target.value } })} style={{ width: 140 }} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {headers.filter((h) => !Object.values(tpl.mapping).includes(h)).length > 0 && !wide.enabled && (
            <p className="faint">Unmapped columns (kept in the raw source record, not discarded): {headers.filter((h) => !Object.values(tpl.mapping).includes(h)).join(', ')}</p>
          )}
          {unknownSides.length > 0 && (
            <fieldset>
              <legend>Map unrecognised transaction types</legend>
              <div className="form-grid">
                {unknownSides.map((v) => (
                  <Select key={v} label={`“${v}”`} value={tpl.valueMaps?.side?.[v] ?? ''} includeEmpty="Choose…" onChange={(s) => setTpl({ ...tpl, valueMaps: { ...tpl.valueMaps, side: { ...(tpl.valueMaps?.side ?? {}), [v]: s } } })} options={SIDES.map((s) => ({ value: s, label: SIDE_LABEL[s] }))} />
                ))}
              </div>
            </fieldset>
          )}
          {missingRequired.length > 0 && !wide.enabled && <div className="notice warn">Required fields not mapped: {missingRequired.join(', ')}</div>}
          <div className="row" style={{ marginTop: 8 }}>
            <button className="primary" disabled={(!!needsAccount && !accountId) || (!wide.enabled && missingRequired.length > 0) || (wide.enabled && (!wide.dateCol || !wide.source.trim()))} onClick={buildPreview}>
              Preview & validate
            </button>
            <TextInput label="Save mapping as template" value={tplName} onChange={setTplName} placeholder="Template name" />
            <button
              disabled={!tplName.trim()}
              style={{ alignSelf: 'flex-end' }}
              onClick={() => run(() => saveEntity('importTemplates', { ...tpl, id: tpl.builtin ? newId('tpl') : tpl.id, name: tplName.trim(), builtin: false, headerSignature: Object.values(tpl.mapping).filter(Boolean), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } as ImportTemplate), { success: 'Template saved — files with the same layout will be recognised automatically.' })}
            >
              Save template
            </button>
          </div>
        </>
      )}
      {step === 'preview' && (
        <>
          <div className="row" style={{ marginBottom: 6 }}>
            <span className="badge ok">{totals.create} to create</span>
            <span className="badge accent">{totals.update} to update</span>
            <span className="badge warn">{totals.skip} to skip (duplicates)</span>
            <span className="badge bad">{totals.reject} rejected</span>
            <span className="muted">Totals to import: {Object.entries(totals.byCurrency).map(([c, v]) => formatMoney(v, c)).join(' · ') || '—'}</span>
            <span className="spacer" />
            <button onClick={() => setStep('map')}>Back to mapping</button>
            <button className="primary" disabled={totals.create + totals.update === 0} onClick={commit}>
              Import {totals.create + totals.update} record(s)
            </button>
          </div>
          <DataTable
            id="import-preview"
            rows={rows}
            rowKey={(r) => String(r.rowNumber)}
            columns={[
              { key: 'n', header: '#', render: (r) => r.rowNumber, sortValue: (r) => r.rowNumber, width: 40 },
              {
                key: 'act',
                header: 'Action',
                render: (r) =>
                  r.errors.length ? (
                    <span className="badge bad">rejected</span>
                  ) : (
                    <select
                      aria-label={`Action for row ${r.rowNumber}`}
                      value={r.action}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => setRows(rows.map((x) => (x.rowNumber === r.rowNumber ? { ...x, action: e.target.value as PreparedRow['action'] } : x)))}
                    >
                      <option value="create">Import</option>
                      <option value="skip">Skip</option>
                      {r.dupOf && r.dupStatus !== 'duplicate_fingerprint' && <option value="update">Update existing</option>}
                    </select>
                  ),
                sortValue: (r) => (r.errors.length ? 'z' : r.action)
              },
              { key: 'dup', header: 'Duplicate check', render: (r) => (r.dupStatus === 'new' ? <span className="faint">new</span> : <span className="badge warn">{r.dupStatus.replace(/_/g, ' ')}</span>), sortValue: (r) => r.dupStatus },
              { key: 'date', header: 'Date', render: (r) => (r.partial ? `${r.partial.date ?? ''} ${r.partial.time ?? ''}` : r.rate?.date ?? '') },
              { key: 'desc', header: 'Record', render: (r) => (r.rate ? `${r.rate.base}/${r.rate.quote} ${r.rate.rate} (${r.rate.source})` : `${r.partial?.side ?? r.partial?.kind ?? ''} ${r.refs.symbol ?? ''} ${r.partial?.quantity ?? ''} ${r.partial?.description ?? ''}`) },
              { key: 'amt', header: 'Amount', numeric: true, render: (r) => (r.partial?.amount ? formatMoney(r.partial.amount, r.partial.currency) : '') },
              { key: 'msg', header: 'Errors / warnings', render: (r) => <>{r.errors.map((e) => <div key={e} className="neg">{e}</div>)}{r.warnings.map((w) => <div key={w} className="faint">{w}</div>)}</> }
            ]}
          />
        </>
      )}
      {step === 'done' && result && (
        <div className="notice ok">
          <b>Import complete — {result.filename}</b>
          <div>
            Created {result.counts.created} · Updated {result.counts.updated} · Skipped {result.counts.skipped} · Rejected {result.counts.rejected} of {result.counts.total} row(s).
          </div>
          {result.rejected.length > 0 && (
            <details className="adv">
              <summary>Rejected rows (stored with the batch for review)</summary>
              <ul className="list-plain">
                {result.rejected.map((r) => (
                  <li key={r.row}>
                    Row {r.row}: {r.errors.join(' ')}
                  </li>
                ))}
              </ul>
            </details>
          )}
          <button className="small" onClick={reset} style={{ marginTop: 6 }}>
            Import another file
          </button>
        </div>
      )}
    </div>
  );
}

function History() {
  const { run, settings } = useApp();
  const batches = useLiveQuery(() => getDb().importBatches.orderBy('createdAt').reverse().toArray(), [], []) ?? [];
  const [rb, setRb] = useState<{ batch: ImportBatch; edited: number } | null>(null);
  return (
    <div className="panel tight">
      <div className="panel-head">
        <h2 style={{ margin: 0 }}>Import history & rollback</h2>
      </div>
      <DataTable
        id="batches"
        rows={batches}
        rowKey={(b) => b.id}
        short
        columns={[
          { key: 'when', header: 'When', render: (b) => formatInstant(b.createdAt, settings.taxTimeZone, { timeFormat: settings.timeFormat }), sortValue: (b) => b.createdAt },
          { key: 'file', header: 'File', render: (b) => b.filename, sortValue: (b) => b.filename },
          { key: 'type', header: 'Type', render: (b) => TARGET_LABEL[b.target] },
          { key: 'counts', header: 'Created / updated / skipped / rejected', render: (b) => `${b.counts.created} / ${b.counts.updated} / ${b.counts.skipped} / ${b.counts.rejected}` },
          { key: 'hash', header: 'File SHA-256', render: (b) => <span className="mono">{b.fileHash.slice(0, 12)}…</span>, hidden: true },
          { key: 'status', header: 'Status', render: (b) => <StatusBadge status={b.status} /> },
          {
            key: 'act',
            header: '',
            render: (b) =>
              b.status === 'committed' ? (
                <button className="small danger" onClick={async (e) => { e.stopPropagation(); setRb({ batch: b, edited: await editedSinceImport(b.id) }); }}>
                  Roll back
                </button>
              ) : null
          },
          {
            key: 'rej',
            header: 'Rejected rows',
            hidden: true,
            render: (b) =>
              b.rejected.length ? (
                <button className="small" onClick={(e) => { e.stopPropagation(); const blob = new Blob([Papa.unparse(b.rejected.map((r) => ({ row: r.row, errors: r.errors.join('; ') })))], { type: 'text/csv' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `rejected-${b.filename}`; a.click(); }}>
                  Download
                </button>
              ) : ''
          }
        ]}
        emptyText="No imports yet."
      />
      {rb && (
        <Confirm
          title="Roll back import"
          danger
          confirmLabel="Roll back"
          message={
            <>
              Remove all {rb.batch.counts.created} record(s) created by <b>{rb.batch.filename}</b>?
              {rb.edited > 0 && <div className="notice warn">{rb.edited} of them were edited after import — those edits will also be removed.</div>}
            </>
          }
          onCancel={() => setRb(null)}
          onConfirm={async () => {
            const b = rb.batch;
            setRb(null);
            await run(() => rollbackImport(b.id), { success: 'Import rolled back.' });
            if (b.target === 'rates') await refreshAllConversions('Rate import rolled back');
          }}
        />
      )}
    </div>
  );
}
