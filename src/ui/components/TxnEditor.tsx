/**
 * Universal record editor. Existing records autosave (debounced) after each valid change;
 * new records are kept as a crash-recoverable draft until committed with “Add record” (Ctrl+S).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { getDb } from '../../db/schema';
import { ACCOUNT_TYPE_LABEL, ASSET_CLASS_LABEL, FIAT_CURRENCIES, KIND_LABEL, SIDE_LABEL, TAX_CLASS_INFO } from '../../domain/reference';
import { ASSET_CLASSES, TAX_CLASSES, type AdjustmentType, type CostBasisMethod, type GstTreatment, type Instrument, type Side, type Split, type TaxClass, type Transaction, type TxnKind } from '../../domain/types';
import { D, formatMoney, formatQty, tryD } from '../../lib/decimal';
import { formatInstant, nowIso, localDateOf } from '../../lib/dates';
import { newId } from '../../lib/ids';
import { gstFromInclusive } from '../../engines/business/gst';
import { audOf, grossOf } from '../../engines/ledger';
import { clearRateOverride, overrideRate, saveEntity, saveTransaction, softDeleteTransactions, restoreTransactions, ValidationError } from '../../services/ledger';
import { addDocument, linkDocument } from '../../services/documents';
import { getWorkspace } from '../../services/calc';
import { useApp } from '../AppContext';
import { useAccounts, useCategories, useInstruments } from '../hooks';
import { Check, DecimalInput, Modal, Select, TextInput } from './ui';

const TIMEZONES = ['Australia/Sydney', 'Australia/Melbourne', 'Australia/Brisbane', 'Australia/Adelaide', 'Australia/Perth', 'Australia/Hobart', 'Australia/Darwin', 'UTC', 'America/New_York', 'America/Chicago', 'Europe/London', 'Europe/Frankfurt', 'Asia/Tokyo', 'Asia/Hong_Kong', 'Asia/Singapore', 'Pacific/Auckland'];
const TRADE_SIDES: Side[] = ['buy', 'sell', 'short', 'cover', 'swap', 'send', 'receive', 'income', 'realised_pnl', 'financing', 'settlement', 'expire', 'exercise', 'assign'];

type Draft = Partial<Transaction>;

export function TxnEditor({ initial, onClose }: { initial: Draft; onClose: () => void }) {
  const { settings, toast, reportSave } = useApp();
  const isNew = !initial.id;
  const [draft, setDraft] = useState<Draft>(() => ({ timeZone: settings.taxTimeZone, currency: settings.defaultCurrency, tags: [], documentIds: [], relatedIds: [], ...initial }));
  const [savedId, setSavedId] = useState<string | undefined>(initial.id);
  const [errors, setErrors] = useState<string[]>([]);
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'invalid' | 'failed'>('idle');
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [recovered, setRecovered] = useState(false);
  const dirty = useRef(false);
  const accounts = useAccounts();
  const instruments = useInstruments();
  const categories = useCategories();
  const stored = useLiveQuery(() => (savedId ? getDb().transactions.get(savedId) : undefined), [savedId]);
  const draftKey = 'txn-new';

  // Crash recovery for unsaved new records.
  useEffect(() => {
    if (!isNew) return;
    getDb()
      .drafts.get(draftKey)
      .then((d) => {
        if (d && d.data && !initial.kind) {
          setDraft(d.data as Draft);
          setRecovered(true);
        }
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const set = (patch: Draft) => {
    dirty.current = true;
    setDraft((d) => ({ ...d, ...patch }));
  };

  const payload = useCallback((d: Draft): Draft => {
    const p: Draft = { ...d, id: savedId ?? d.id };
    if (p.taxClassSource !== 'user') {
      delete p.taxClass;
      p.taxClassSource = 'default';
    }
    delete (p as any).fx;
    delete (p as any).fxHistory;
    delete (p as any).feeFx;
    return p;
  }, [savedId]);

  const persist = useCallback(
    async (d: Draft) => {
      setStatus('saving');
      reportSave('saving');
      try {
        const t = await saveTransaction(payload(d));
        setSavedId(t.id);
        setErrors([]);
        setStatus('saved');
        setSavedAt(nowIso());
        reportSave('saved');
        dirty.current = false;
        return t;
      } catch (e) {
        if (e instanceof ValidationError) {
          setErrors(e.errors);
          setStatus('invalid');
          reportSave('idle');
        } else {
          setStatus('failed');
          setErrors([(e as Error).message]);
          reportSave('failed', (e as Error).message);
          toast(`Save failed: ${(e as Error).message}`, { kind: 'bad' });
        }
        return undefined;
      }
    },
    [payload, reportSave, toast]
  );

  // Autosave existing records (debounced); keep drafts of new records.
  useEffect(() => {
    if (!dirty.current) return;
    const h = setTimeout(() => {
      if (savedId) void persist(draft);
      else void getDb().drafts.put({ id: draftKey, form: 'txn', data: draft, updatedAt: nowIso() });
    }, savedId ? 700 : 400);
    return () => clearTimeout(h);
  }, [draft, savedId, persist]);

  const commitNew = async () => {
    const t = await persist(draft);
    if (t) {
      await getDb().drafts.delete(draftKey);
      setDraft({ ...draft, ...t });
      toast('Record added — further changes save automatically.');
    }
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (savedId) void persist(draft);
        else void commitNew();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const kind = draft.kind;
  const inst = instruments.find((i) => i.id === draft.instrumentId);
  const cats = categories.filter((c) => !c.archived && c.type === (kind === 'income' ? 'income' : 'expense'));
  const current = stored ?? (draft as Transaction);
  const signedSide = draft.side === 'realised_pnl' || draft.side === 'financing' || draft.side === 'settlement';
  const grossDraft = kind === 'trade' && !signedSide ? grossOf(draft as Transaction, inst) : D(draft.amount || '0');
  const aud = current.currency ? audOf({ ...(draft as Transaction), fx: stored?.fx }, grossDraft) : null;

  const close = async () => {
    if (savedId && dirty.current) await persist(draft);
    onClose();
  };
  const del = async () => {
    if (!savedId) {
      await getDb().drafts.delete(draftKey);
      onClose();
      return;
    }
    await softDeleteTransactions([savedId]);
    const id = savedId;
    toast('Record deleted.', { undo: () => restoreTransactions([id]) });
    onClose();
  };

  return (
    <Modal
      title={isNew && !savedId ? 'New record' : `Edit ${KIND_LABEL[kind as TxnKind] ?? 'record'}`}
      onClose={close}
      size="wide"
      footer={
        <>
          <span className="muted" style={{ marginRight: 'auto' }} aria-live="polite">
            {status === 'saving' && 'Saving…'}
            {status === 'saved' && savedAt && `Saved ${formatInstant(savedAt, settings.taxTimeZone, { timeFormat: settings.timeFormat }).split(' ').slice(1).join(' ')}`}
            {status === 'invalid' && <span style={{ color: 'var(--warn)' }}>Not saved — fix the highlighted issues</span>}
            {status === 'failed' && <span style={{ color: 'var(--bad)' }}>Save failed</span>}
            {!savedId && status !== 'invalid' && 'Draft kept automatically until you add the record.'}
          </span>
          <button className="danger" onClick={del}>
            {savedId ? 'Delete' : 'Discard'}
          </button>
          {savedId ? (
            <button className="primary" onClick={() => persist(draft)}>
              Save now
            </button>
          ) : (
            <button className="primary" onClick={commitNew} disabled={!kind}>
              Add record
            </button>
          )}
          <button onClick={close}>Close</button>
        </>
      }
    >
      {recovered && <div className="notice warn">Recovered an unsaved draft from your previous session.</div>}
      {errors.length > 0 && (
        <div className="notice bad" role="alert">
          <ul className="list-plain">
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="form-grid">
        <Select
          label="Record type"
          value={kind ?? ''}
          includeEmpty={kind ? undefined : 'Choose…'}
          disabled={!!savedId}
          onChange={(v) => set({ kind: v as TxnKind, side: v === 'cash' ? 'deposit' : v === 'trade' ? 'buy' : v === 'transfer' ? 'send' : undefined, category: v === 'trade' ? 'trading' : v === 'cash' ? 'cash' : v === 'transfer' ? 'transfer' : '' })}
          options={(Object.keys(KIND_LABEL) as TxnKind[]).map((k) => ({ value: k, label: KIND_LABEL[k] }))}
          required
        />
        <TextInput label="Date" type="date" value={draft.date} onChange={(v) => set({ date: v })} required />
        <TextInput label="Time" value={draft.time} onChange={(v) => set({ time: v || undefined })} placeholder="e.g. 2:30 PM" hint="Optional, local to the time zone" />
        <Select label="Time zone" value={draft.timeZone} onChange={(v) => set({ timeZone: v })} options={[...new Set([draft.timeZone ?? settings.taxTimeZone, ...TIMEZONES])].map((z) => ({ value: z, label: z }))} />
        <TextInput label="Description" value={draft.description} onChange={(v) => set({ description: v })} className="span-2" />
        {(kind === 'income' || kind === 'expense' || kind === 'fee') && (
          <Select label="Category" value={draft.category} includeEmpty="Choose…" onChange={(v) => set({ category: v })} options={cats.map((c) => ({ value: c.code, label: `${c.group} · ${c.name}` }))} className="span-2" required />
        )}
        {(kind === 'trade' || kind === 'transfer' || kind === 'cash' || kind === 'adjustment' || kind === 'income' || kind === 'fee' || kind === 'expense') && (
          <Select label="Account" value={draft.accountId ?? ''} includeEmpty={kind === 'trade' || kind === 'cash' || kind === 'transfer' ? 'Choose…' : '(none)'} onChange={(v) => set({ accountId: v || undefined })} options={accounts.filter((a) => !a.archived).map((a) => ({ value: a.id, label: `${a.name} — ${ACCOUNT_TYPE_LABEL[a.type]}` }))} className="span-2" required={kind === 'trade' || kind === 'cash' || kind === 'transfer'} />
        )}
        {(kind === 'trade' || kind === 'transfer') && <Select label="Side / event" value={draft.side} onChange={(v) => set({ side: v })} options={(kind === 'transfer' ? (['send', 'receive'] as Side[]) : TRADE_SIDES).map((s) => ({ value: s, label: SIDE_LABEL[s] }))} required />}
        {kind === 'cash' && <Select label="Direction" value={draft.side} onChange={(v) => set({ side: v })} options={(['deposit', 'withdrawal'] as Side[]).map((s) => ({ value: s, label: SIDE_LABEL[s] }))} required />}
        {(kind === 'trade' || kind === 'transfer' || kind === 'adjustment' || kind === 'income') && <InstrumentPicker value={draft.instrumentId} instruments={instruments} onChange={(id) => set({ instrumentId: id })} label={kind === 'income' ? 'Instrument (dividend / in-kind income)' : 'Instrument'} />}
        <CurrencyInput value={draft.currency} onChange={(v) => set({ currency: v })} instruments={instruments} />
        {kind === 'trade' && ['realised_pnl', 'financing', 'settlement'].includes(draft.side ?? '') ? (
          <DecimalInput label="Amount (signed: + profit / − loss or charge)" value={draft.amount} onChange={(v) => set({ amount: v })} allowNegative required />
        ) : (
          <DecimalInput label={kind === 'trade' ? 'Gross consideration (optional — else qty × price × multiplier)' : kind === 'adjustment' ? 'Cost / value (opening balance)' : 'Amount (gross)'} value={kind === 'trade' && draft.amount === '0' ? undefined : draft.amount} onChange={(v) => set({ amount: v })} required={kind === 'income' || kind === 'expense' || kind === 'fee' || kind === 'cash'} />
        )}
        <div className="field">
          <span className="lbl">AUD value</span>
          <div style={{ padding: '4px 0' }}>{grossDraft.isZero() ? '—' : draft.currency === 'AUD' || !draft.currency ? formatMoney(grossDraft) : aud === null ? <span className="badge bad">rate missing</span> : formatMoney(aud)}</div>
        </div>
      </div>

      {(kind === 'trade' || kind === 'transfer' || kind === 'adjustment' || (kind === 'income' && draft.instrumentId)) && (
        <fieldset style={{ marginTop: 8 }}>
          <legend>Trade / position details</legend>
          <div className="form-grid">
            <DecimalInput label={`Quantity${inst?.assetClass === 'future' || inst?.assetClass === 'option' ? ' (contracts)' : ''}`} value={draft.quantity} onChange={(v) => set({ quantity: v })} />
            {kind === 'trade' && <DecimalInput label="Unit price" value={draft.price} onChange={(v) => set({ price: v })} />}
            {kind === 'trade' && <DecimalInput label="Contract multiplier" value={draft.multiplier} onChange={(v) => set({ multiplier: v })} hint={inst?.multiplier ? `Instrument default ${inst.multiplier}` : 'Futures / options / CFD contract size'} />}
            {kind === 'trade' && <DecimalInput label="Commission / brokerage" value={draft.commission} onChange={(v) => set({ commission: v })} />}
            {kind === 'trade' && <DecimalInput label="Exchange / clearing fees" value={draft.exchangeFees} onChange={(v) => set({ exchangeFees: v })} />}
            {kind === 'trade' && <DecimalInput label="Other fees" value={draft.otherFees} onChange={(v) => set({ otherFees: v })} />}
            {kind === 'trade' && <DecimalInput label="Financing costs" value={draft.financingCosts} onChange={(v) => set({ financingCosts: v })} />}
            {kind === 'trade' && <TextInput label="Fee currency" value={draft.feeCurrency} onChange={(v) => set({ feeCurrency: v.toUpperCase() || undefined })} placeholder="Same as trade" />}
            {kind === 'trade' && <TextInput label="Settlement date" type="date" value={draft.settlementDate} onChange={(v) => set({ settlementDate: v || undefined })} />}
            {kind === 'adjustment' && <Select label="Adjustment type" value={draft.adjustmentType} includeEmpty="Choose…" onChange={(v) => set({ adjustmentType: v as AdjustmentType })} options={(['opening_balance', 'lost', 'stolen', 'spam', 'correction', 'other'] as AdjustmentType[]).map((a) => ({ value: a, label: a.replace('_', ' ') }))} required />}
            {draft.side === 'swap' && (
              <>
                <InstrumentPicker label="Asset received" value={draft.counterInstrumentId} instruments={instruments} onChange={(id) => set({ counterInstrumentId: id })} />
                <DecimalInput label="Quantity received" value={draft.counterQuantity} onChange={(v) => set({ counterQuantity: v })} />
              </>
            )}
            {(draft.side === 'swap' || draft.side === 'send' || draft.side === 'receive' || (kind === 'income' && draft.instrumentId)) && (
              <DecimalInput label="AUD market value at the time" value={draft.valuationAud} onChange={(v) => set({ valuationAud: v, valuationSource: v ? 'User-entered market value' : undefined })} hint={draft.valuationSource ?? 'Required for swaps, gifts and crypto income'} />
            )}
            {(draft.side === 'send' || draft.side === 'receive') && (
              <>
                <Select label="Own-account transfer?" value={draft.isOwnTransfer === undefined ? '' : draft.isOwnTransfer ? 'yes' : 'no'} includeEmpty="Not yet determined" onChange={(v) => set({ isOwnTransfer: (v as string) === '' ? undefined : v === 'yes' })} options={[{ value: 'yes', label: 'Yes — between my own accounts (no disposal)' }, { value: 'no', label: 'No — to/from a third party' }]} className="span-2" />
                {draft.side === 'send' && <DecimalInput label="Network fee (asset units)" value={draft.feeQuantity} onChange={(v) => set({ feeQuantity: v })} />}
              </>
            )}
            {kind === 'trade' && ['sell', 'swap', 'send'].includes(draft.side ?? '') && (
              <Select label="Cost-basis method (this disposal)" value={draft.costBasisMethod ?? ''} includeEmpty="Default for account / asset class" onChange={(v) => set({ costBasisMethod: (v || undefined) as CostBasisMethod | undefined })} options={['FIFO', 'LIFO', 'HIFO', 'SPECIFIC'].map((m) => ({ value: m, label: m === 'SPECIFIC' ? 'Specific identification' : m }))} />
            )}
            <TextInput label="Position / order reference" value={draft.positionRef} onChange={(v) => set({ positionRef: v || undefined })} />
            <TextInput label="Source ID (broker / tx hash)" value={draft.sourceId} onChange={(v) => set({ sourceId: v || undefined })} />
          </div>
          {draft.costBasisMethod === 'SPECIFIC' && draft.instrumentId && <LotPicker instrumentId={draft.instrumentId} value={draft.specificLots ?? []} onChange={(v) => set({ specificLots: v })} excludeTxnId={savedId} />}
        </fieldset>
      )}

      {kind === 'income' && (
        <fieldset style={{ marginTop: 8 }}>
          <legend>Tax details</legend>
          <div className="form-grid">
            <DecimalInput label="PAYG / TFN tax withheld (AUD)" value={draft.taxWithheld} onChange={(v) => set({ taxWithheld: v })} />
            <DecimalInput label="Foreign tax paid (in transaction currency)" value={draft.foreignTaxPaid} onChange={(v) => set({ foreignTaxPaid: v })} />
            <DecimalInput label="Franked amount (AUD)" value={draft.frankedAmount} onChange={(v) => set({ frankedAmount: v })} />
            <DecimalInput label="Unfranked amount (AUD)" value={draft.unfrankedAmount} onChange={(v) => set({ unfrankedAmount: v })} />
            <DecimalInput label="Franking credit (AUD)" value={draft.frankingCredit} onChange={(v) => set({ frankingCredit: v })} />
            <DecimalInput label="Tax-deferred component" value={draft.taxDeferredAmount} onChange={(v) => set({ taxDeferredAmount: v })} hint="Reduces cost base of the holding" />
            <DecimalInput label="Capital gain component (AUD)" value={draft.capitalGainComponent} onChange={(v) => set({ capitalGainComponent: v })} />
            <Check label="Business income" checked={draft.isBusiness} onChange={(v) => set({ isBusiness: v })} />
          </div>
        </fieldset>
      )}

      {(kind === 'expense' || kind === 'fee' || (kind === 'income' && draft.isBusiness)) && (
        <fieldset style={{ marginTop: 8 }}>
          <legend>Deductibility & GST</legend>
          <div className="form-grid">
            {kind !== 'income' && <DecimalInput label="Business / work-use %" value={draft.businessUsePct} onChange={(v) => set({ businessUsePct: v })} hint="Private-use portion is excluded" />}
            {kind !== 'income' && <Check label="Business (sole trader) expense" checked={draft.isBusiness} onChange={(v) => set({ isBusiness: v })} />}
            <Select label="GST treatment" value={draft.gstTreatment ?? 'none'} onChange={(v) => set({ gstTreatment: v as GstTreatment })} options={[{ value: 'none', label: 'Not tracked' }, { value: 'taxable', label: 'Taxable (includes GST)' }, { value: 'gst_free', label: 'GST-free' }, { value: 'input_taxed', label: 'Input-taxed (financial supply) — review' }, { value: 'imported_service', label: 'Imported service — review' }, { value: 'review', label: 'Needs review' }]} />
            <DecimalInput label="GST amount" value={draft.gstAmount} onChange={(v) => set({ gstAmount: v })} hint={draft.amount && draft.gstTreatment === 'taxable' ? <button className="link" type="button" onClick={() => set({ gstAmount: gstFromInclusive(draft.amount!) })}>Use 1/11 of amount ({gstFromInclusive(draft.amount)})</button> : undefined} />
            <TextInput label="Payment method" value={draft.paymentMethod} onChange={(v) => set({ paymentMethod: v || undefined })} />
          </div>
          {kind !== 'income' && <SplitEditor splits={draft.splits ?? []} total={draft.amount} onChange={(s) => set({ splits: s.length ? s : undefined })} cats={cats.map((c) => ({ value: c.code, label: c.name }))} />}
        </fieldset>
      )}

      <fieldset style={{ marginTop: 8 }}>
        <legend>Classification & notes</legend>
        <div className="form-grid">
          <Select
            label="Tax classification"
            value={draft.taxClassSource === 'user' ? draft.taxClass : ''}
            includeEmpty={`Automatic${stored ? ` (currently: ${TAX_CLASS_INFO[stored.taxClass].label})` : ''}`}
            onChange={(v) => set(v ? { taxClass: v as TaxClass, taxClassSource: 'user' } : { taxClass: undefined, taxClassSource: 'default' })}
            options={TAX_CLASSES.map((c) => ({ value: c, label: TAX_CLASS_INFO[c].label }))}
            className="span-2"
            hint={stored ? TAX_CLASS_INFO[stored.taxClass].help : undefined}
          />
          <TextInput label="Payer / supplier / counterparty" value={draft.counterparty} onChange={(v) => set({ counterparty: v || undefined })} />
          <TextInput label="Tags (comma separated)" value={(draft.tags ?? []).join(', ')} onChange={(v) => set({ tags: v.split(',').map((x) => x.trim()).filter(Boolean) })} />
          <TextInput label="Tax event date (override)" type="date" value={draft.taxEventDate} onChange={(v) => set({ taxEventDate: v || undefined })} hint="Only if the tax event date differs from the transaction date" />
          <Select label="Reconciliation" value={draft.reconStatus ?? 'unreconciled'} onChange={(v) => set({ reconStatus: v as Transaction['reconStatus'] })} options={['unreconciled', 'reconciled', 'disputed', 'not_required'].map((x) => ({ value: x, label: x.replace('_', ' ') }))} />
          <div className="field span-4">
            <label htmlFor="txn-notes">Notes</label>
            <textarea id="txn-notes" value={draft.notes ?? ''} onChange={(e) => set({ notes: e.target.value || undefined })} />
          </div>
        </div>
      </fieldset>

      {stored && (
        <div className="grid cols-2" style={{ marginTop: 8 }}>
          <FxPanel t={stored} />
          <DocsPanel t={stored} />
          <ProvenancePanel t={stored} />
          <AuditPanel id={stored.id} />
        </div>
      )}
    </Modal>
  );
}

function CurrencyInput({ value, onChange, instruments }: { value?: string; onChange: (v: string) => void; instruments: Instrument[] }) {
  const codes = [...FIAT_CURRENCIES.map((c) => c.code), ...instruments.filter((i) => i.assetClass === 'crypto' || i.assetClass === 'stablecoin').map((i) => i.symbol)];
  return (
    <>
      <TextInput label="Currency / asset" value={value} onChange={(v) => onChange(v.toUpperCase())} list="currency-list" required />
      <datalist id="currency-list">
        {[...new Set(codes)].map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
    </>
  );
}

export function InstrumentPicker({ value, onChange, instruments, label = 'Instrument' }: { value?: string; onChange: (id: string | undefined) => void; instruments: Instrument[]; label?: string }) {
  const [adding, setAdding] = useState(false);
  const [n, setN] = useState<Partial<Instrument>>({ assetClass: 'au_share', currency: 'AUD' });
  const { run } = useApp();
  if (adding)
    return (
      <div className="span-4" style={{ gridColumn: '1 / -1' }}>
        <fieldset>
          <legend>New instrument</legend>
          <div className="form-grid">
            <TextInput label="Symbol" value={n.symbol} onChange={(v) => setN({ ...n, symbol: v.toUpperCase() })} required />
            <TextInput label="Name" value={n.name} onChange={(v) => setN({ ...n, name: v })} />
            <Select label="Asset class" value={n.assetClass} onChange={(v) => setN({ ...n, assetClass: v })} options={ASSET_CLASSES.map((a) => ({ value: a, label: ASSET_CLASS_LABEL[a] }))} />
            <TextInput label="Pricing currency" value={n.currency} onChange={(v) => setN({ ...n, currency: v.toUpperCase() })} />
            <DecimalInput label="Contract multiplier" value={n.multiplier} onChange={(v) => setN({ ...n, multiplier: v })} />
            <TextInput label="Exchange / market" value={n.market} onChange={(v) => setN({ ...n, market: v })} />
            <div className="row" style={{ alignItems: 'flex-end' }}>
              <button
                className="primary"
                disabled={!n.symbol}
                onClick={async () => {
                  const id = newId('ins');
                  const now = nowIso();
                  const ok = await run(() => saveEntity('instruments', { name: n.symbol!, ...n, id, createdAt: now, updatedAt: now } as Instrument));
                  if (ok) {
                    onChange(id);
                    setAdding(false);
                  }
                }}
              >
                Add
              </button>
              <button onClick={() => setAdding(false)}>Cancel</button>
            </div>
          </div>
        </fieldset>
      </div>
    );
  return (
    <div className="field span-2">
      <label htmlFor="instrument-select">{label}</label>
      <div className="row" style={{ flexWrap: 'nowrap' }}>
        <select id="instrument-select" value={value ?? ''} onChange={(e) => onChange(e.target.value || undefined)} style={{ flex: 1 }}>
          <option value="">(none)</option>
          {[...instruments].sort((a, b) => a.symbol.localeCompare(b.symbol)).map((i) => (
            <option key={i.id} value={i.id}>
              {i.symbol} — {i.name} ({ASSET_CLASS_LABEL[i.assetClass]})
            </option>
          ))}
        </select>
        <button type="button" className="small" onClick={() => setAdding(true)}>
          + New
        </button>
      </div>
    </div>
  );
}

function SplitEditor({ splits, total, onChange, cats }: { splits: Split[]; total?: string; onChange: (s: Split[]) => void; cats: { value: string; label: string }[] }) {
  const sum = splits.reduce((s, x) => s.plus(D(x.amount)), D(0));
  return (
    <div style={{ marginTop: 8 }}>
      <div className="row">
        <b style={{ fontSize: 12 }}>Split across categories</b>
        <button type="button" className="small" onClick={() => onChange([...splits, { category: cats[0]?.value ?? 'other', amount: splits.length ? '0' : total ?? '0' }])}>
          + Add split
        </button>
        {splits.length > 0 && (
          <span className={sum.eq(D(total)) ? 'muted' : 'neg'}>
            Allocated {formatMoney(sum)} of {formatMoney(total ?? '0')}
          </span>
        )}
      </div>
      {splits.map((s, i) => (
        <div key={i} className="form-grid" style={{ marginTop: 4 }}>
          <Select label="Category" value={s.category} onChange={(v) => onChange(splits.map((x, j) => (j === i ? { ...x, category: v } : x)))} options={cats} />
          <DecimalInput label="Amount" value={s.amount} onChange={(v) => onChange(splits.map((x, j) => (j === i ? { ...x, amount: v ?? '0' } : x)))} />
          <DecimalInput label="Business %" value={s.businessUsePct} onChange={(v) => onChange(splits.map((x, j) => (j === i ? { ...x, businessUsePct: v } : x)))} />
          <div className="row" style={{ alignItems: 'flex-end' }}>
            <button type="button" className="small danger" onClick={() => onChange(splits.filter((_, j) => j !== i))}>
              Remove
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

function LotPicker({ instrumentId, value, onChange, excludeTxnId }: { instrumentId: string; value: { lotId: string; quantity: string }[]; onChange: (v: { lotId: string; quantity: string }[]) => void; excludeTxnId?: string }) {
  const [lots, setLots] = useState<{ id: string; date: string; qty: string; cost: string | null }[]>([]);
  useEffect(() => {
    getWorkspace().then((ws) => setLots(ws.lots.lots.filter((l) => l.instrumentId === instrumentId && l.sourceTxnId !== excludeTxnId).map((l) => ({ id: l.id, date: l.acquiredDate, qty: l.qtyOriginal.toString(), cost: l.costAudOriginal?.toFixed(2) ?? null }))));
  }, [instrumentId, excludeTxnId]);
  const q = (id: string) => value.find((v) => v.lotId === id)?.quantity;
  return (
    <div style={{ marginTop: 8 }}>
      <b style={{ fontSize: 12 }}>Specific identification — choose parcels</b>
      <p className="faint">Quantities are validated against parcels still held at the disposal date; any shortfall is matched FIFO and flagged.</p>
      <table className="dt">
        <thead>
          <tr>
            <th>Parcel</th>
            <th>Acquired</th>
            <th className="num">Original qty</th>
            <th className="num">Cost base</th>
            <th>Qty to dispose</th>
          </tr>
        </thead>
        <tbody>
          {lots.map((l) => (
            <tr key={l.id}>
              <td className="mono">{l.id.slice(0, 18)}</td>
              <td>{l.date}</td>
              <td className="num">{formatQty(l.qty)}</td>
              <td className="num">{l.cost ? formatMoney(l.cost) : '—'}</td>
              <td>
                <input
                  aria-label={`Quantity from parcel ${l.id}`}
                  value={q(l.id) ?? ''}
                  onChange={(e) => {
                    const v = e.target.value;
                    const rest = value.filter((x) => x.lotId !== l.id);
                    onChange(tryD(v) && tryD(v)!.gt(0) ? [...rest, { lotId: l.id, quantity: tryD(v)!.toString() }] : rest);
                  }}
                  style={{ width: 100 }}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FxPanel({ t }: { t: Transaction }) {
  const { run, settings } = useApp();
  const [form, setForm] = useState<{ rate?: string; direction: 'AUD_PER_UNIT' | 'UNITS_PER_AUD'; source: string; reason: string } | null>(null);
  if (t.currency === 'AUD' && !t.feeFx) return <div className="panel"><h3>Currency</h3><p className="muted">AUD record — no conversion required.</p></div>;
  const c = t.fx;
  return (
    <div className="panel">
      <h3>Historical AUD conversion</h3>
      {c ? (
        <dl className="kv">
          <dt>AUD per 1 {t.currency}</dt>
          <dd className="mono" title={c.audPerUnit}>{D(c.audPerUnit).toDecimalPlaces(10).toString()}</dd>
          <dt>Rate as quoted</dt>
          <dd>
            {c.sourceRate} ({c.sourceDirection})
          </dd>
          <dt>Rate date</dt>
          <dd>
            {c.rateDate}
            {c.staleDays ? <span className="badge warn"> prior day −{c.staleDays}</span> : null}
          </dd>
          <dt>Type / source</dt>
          <dd>
            {c.isManualOverride ? <span className="badge warn">manual</span> : c.rateType} · {c.source}
          </dd>
          <dt>Methodology</dt>
          <dd className="faint">{c.methodology}</dd>
          {c.isManualOverride && (
            <>
              <dt>Reason</dt>
              <dd>{c.overrideReason}</dd>
            </>
          )}
        </dl>
      ) : (
        <div className="notice bad">No historical {t.currency}→AUD rate for {t.date}. Import rates (Settings → Currencies & rates) or enter the rate used, with its source.</div>
      )}
      <div className="row" style={{ marginTop: 6 }}>
        <button className="small" onClick={() => setForm({ direction: 'UNITS_PER_AUD', source: '', reason: '' })}>
          {c ? 'Override rate' : 'Enter rate manually'}
        </button>
        {c?.isManualOverride && (
          <button className="small" onClick={() => run(() => clearRateOverride(t.id, 'Override removed by user'), { success: 'Override removed; methodology rate applied if available.' })}>
            Remove override
          </button>
        )}
      </div>
      {form && (
        <div className="form-grid" style={{ marginTop: 6 }}>
          <DecimalInput label="Rate" value={form.rate} onChange={(v) => setForm({ ...form, rate: v })} required />
          <Select label="Direction" value={form.direction} onChange={(v) => setForm({ ...form, direction: v })} options={[{ value: 'UNITS_PER_AUD', label: `${t.currency} per 1 AUD` }, { value: 'AUD_PER_UNIT', label: `AUD per 1 ${t.currency}` }]} />
          <TextInput label="Source" value={form.source} onChange={(v) => setForm({ ...form, source: v })} placeholder="e.g. broker contract note" required />
          <TextInput label="Reason" value={form.reason} onChange={(v) => setForm({ ...form, reason: v })} required />
          <div className="row span-4">
            <button className="primary small" disabled={!form.rate || !form.source.trim() || !form.reason.trim()} onClick={async () => { const ok = await run(() => overrideRate(t.id, { rate: form.rate!, direction: form.direction, source: form.source, reason: form.reason }), { success: 'Manual rate saved and recorded in the audit history.' }); if (ok) setForm(null); }}>
              Save rate
            </button>
            <button className="small" onClick={() => setForm(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {!!t.fxHistory?.length && (
        <details className="adv">
          <summary>Rate history ({t.fxHistory.length})</summary>
          <ul className="list-plain">
            {t.fxHistory.map((h, i) => (
              <li key={i}>
                {formatInstant(h.replacedAt, settings.taxTimeZone)}: {h.audPerUnit} AUD/unit ({h.source}, {h.rateDate}) — {h.replacedReason}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function DocsPanel({ t }: { t: Transaction }) {
  const { run } = useApp();
  const docs = useLiveQuery(() => getDb().documents.toArray(), [], []) ?? [];
  const linked = docs.filter((d) => t.documentIds.includes(d.id));
  const [pick, setPick] = useState('');
  return (
    <div className="panel">
      <h3>Supporting documents</h3>
      {linked.length ? (
        <ul className="list-plain">
          {linked.map((d) => (
            <li key={d.id}>
              {d.title} <span className="faint">({d.originalFilename})</span>{' '}
              <button className="link" onClick={() => run(() => linkDocument(d.id, t.id, false))}>
                unlink
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">No evidence linked.</p>
      )}
      <div className="row">
        <label className="btn small">
          Attach file…
          <input
            type="file"
            className="sr-only"
            accept=".pdf,.jpg,.jpeg,.png,.csv,.txt"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (f) await run(() => addDocument(f, { linkedRecordIds: [t.id], docType: t.kind === 'expense' ? 'receipt' : 'statement', date: t.date }), { success: 'Document stored and linked.' });
              e.target.value = '';
            }}
          />
        </label>
        <select aria-label="Link existing document" value={pick} onChange={(e) => setPick(e.target.value)}>
          <option value="">Link existing…</option>
          {docs.filter((d) => !t.documentIds.includes(d.id)).map((d) => (
            <option key={d.id} value={d.id}>
              {d.title}
            </option>
          ))}
        </select>
        <button className="small" disabled={!pick} onClick={() => run(() => linkDocument(pick, t.id)).then(() => setPick(''))}>
          Link
        </button>
      </div>
    </div>
  );
}

function ProvenancePanel({ t }: { t: Transaction }) {
  const { settings } = useApp();
  const raw = useLiveQuery(() => (t.rawRowId ? getDb().rawRows.get(t.rawRowId) : undefined), [t.rawRowId]);
  return (
    <div className="panel">
      <h3>Provenance & timestamps</h3>
      <dl className="kv">
        <dt>Record ID</dt>
        <dd className="mono">{t.id}</dd>
        <dt>Source</dt>
        <dd>
          {t.source}
          {t.importBatchId && <span className="faint"> · batch {t.importBatchId.slice(0, 12)}</span>}
        </dd>
        <dt>Transaction time</dt>
        <dd>
          {formatInstant(t.occurredAt, t.timeZone, { timeFormat: settings.timeFormat, dateFormat: settings.dateFormat, showZone: true })} ({t.timeZone})
        </dd>
        <dt>Taxpayer-local date</dt>
        <dd>
          {localDateOf(t.occurredAt, settings.taxTimeZone)} · FY{t.fy - 1}–{String(t.fy).slice(-2)}
        </dd>
        <dt>UTC</dt>
        <dd className="mono">{t.occurredAt}</dd>
        {t.settlementDate && (
          <>
            <dt>Settlement date</dt>
            <dd>{t.settlementDate}</dd>
          </>
        )}
        <dt>Tax event date</dt>
        <dd>{t.taxEventDate ?? t.date}</dd>
        <dt>Classification source</dt>
        <dd>{t.taxClassSource}</dd>
        <dt>Created / modified</dt>
        <dd>
          {formatInstant(t.createdAt, settings.taxTimeZone)} / {formatInstant(t.updatedAt, settings.taxTimeZone)} (v{t.version})
        </dd>
      </dl>
      {raw && (
        <details className="adv">
          <summary>Original imported values (row {raw.rowNumber})</summary>
          <pre className="mono" style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(raw.raw, null, 1)}</pre>
        </details>
      )}
    </div>
  );
}

function AuditPanel({ id }: { id: string }) {
  const { settings } = useApp();
  const events = useLiveQuery(() => getDb().audit.where('entityId').equals(id).toArray(), [id]);
  const list = useMemo(() => [...(events ?? [])].sort((a, b) => (a.at < b.at ? 1 : -1)), [events]);
  return (
    <div className="panel">
      <h3>Audit history</h3>
      <ul className="list-plain" style={{ maxHeight: 200, overflow: 'auto' }}>
        {list.map((e) => (
          <li key={e.id}>
            <span className="faint">{formatInstant(e.at, settings.taxTimeZone, { timeFormat: settings.timeFormat })}</span> {e.action}: {e.summary}
            {e.after && e.action === 'update' ? <span className="faint"> — {Object.keys(e.after as object).join(', ')}</span> : null}
            {e.reason ? <span className="faint"> ({e.reason})</span> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
