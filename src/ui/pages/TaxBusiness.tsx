import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { getDb } from '../../db/schema';
import type { Asset, BusinessProfile, Counterparty, InventoryRecord, LogEntry, Recurring, TaxProfile, Transaction, UserProfile, YesNoUnknown } from '../../domain/types';
import { D, formatMoney, sum } from '../../lib/decimal';
import { formatDate, fyLabel, nowIso, fyOfLocalDate } from '../../lib/dates';
import { newId } from '../../lib/ids';
import { depreciationSchedule } from '../../engines/business/depreciation';
import { audOf } from '../../engines/ledger';
import { saveEntity } from '../../services/ledger';
import { generateRecurring } from '../../services/recurring';
import { useApp } from '../AppContext';
import { useCategories, useTaxYear } from '../hooks';
import { TxnTable } from '../components/TxnTable';
import { DataTable } from '../components/DataTable';
import { EntityModal, type FieldSpec } from '../components/EntityModal';
import { Check, DecimalInput, Disclaimer, Money, Select, StatusBadge, Tabs, TextInput } from '../components/ui';

type Tab = 'income' | 'expenses' | 'business' | 'assets' | 'logbook' | 'inventory' | 'recurring' | 'profile';

export function TaxBusiness() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) || 'income';
  const { fy } = useApp();
  const txns = useLiveQuery(() => getDb().transactions.where('fy').equals(fy).filter((t) => t.status === 'active').toArray(), [fy], []);
  return (
    <div>
      <div className="page-head">
        <h1>Tax & Business — {fyLabel(fy)}</h1>
      </div>
      <Disclaimer />
      <Tabs<Tab>
        value={tab}
        onChange={(t) => setParams({ tab: t })}
        tabs={[
          { id: 'income', label: 'Income' },
          { id: 'expenses', label: 'Expenses & deductions' },
          { id: 'business', label: 'Sole trader / business' },
          { id: 'assets', label: 'Assets & depreciation' },
          { id: 'logbook', label: 'Vehicle, travel & home office' },
          { id: 'inventory', label: 'Stock / inventory' },
          { id: 'recurring', label: 'Recurring entries' },
          { id: 'profile', label: 'Tax profile' }
        ]}
      />
      {tab === 'income' && (
        <div className="panel tight">
          <TxnTable id="tb-income" rows={(txns ?? []).filter((t) => t.kind === 'income')} newDefaults={{ kind: 'income', category: 'salary' }} emptyText="No income recorded for this year." />
        </div>
      )}
      {tab === 'expenses' && (
        <div className="panel tight">
          <TxnTable id="tb-exp" rows={(txns ?? []).filter((t) => t.kind === 'expense' || t.kind === 'fee')} newDefaults={{ kind: 'expense', category: 'work_general', businessUsePct: '100' }} emptyText="No expenses recorded for this year." />
        </div>
      )}
      {tab === 'business' && <BusinessTab txns={txns ?? []} />}
      {tab === 'assets' && <AssetsTab />}
      {tab === 'logbook' && <LogbookTab />}
      {tab === 'inventory' && <InventoryTab />}
      {tab === 'recurring' && <RecurringTab />}
      {tab === 'profile' && <ProfileTab />}
    </div>
  );
}

function useAutosave<T>(value: T | null, save: (v: T) => Promise<unknown>, ms = 600) {
  const { reportSave } = useApp();
  const first = useRef(true);
  useEffect(() => {
    if (value === null) return;
    if (first.current) {
      first.current = false;
      return;
    }
    const h = setTimeout(async () => {
      reportSave('saving');
      try {
        await save(value);
        reportSave('saved');
      } catch (e) {
        reportSave('failed', (e as Error).message);
      }
    }, ms);
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
}

function BusinessTab({ txns }: { txns: Transaction[] }) {
  const { fy } = useApp();
  const stored = useLiveQuery(() => getDb().businessProfiles.toArray(), []);
  const [bp, setBp] = useState<BusinessProfile | null>(null);
  useEffect(() => {
    if (stored && bp === null) setBp(stored[0] ?? { id: 'biz_main', name: '', activity: '', gstRegistered: false, gstBasis: 'cash', basFrequency: 'quarterly', smallBusinessEntity: 'unknown', updatedAt: nowIso() });
  }, [stored, bp]);
  useAutosave(bp, (v) => saveEntity('businessProfiles', v));
  const { value: r } = useTaxYear(fy);
  const counterparties = useLiveQuery(() => getDb().counterparties.toArray(), [], []) ?? [];
  const [cp, setCp] = useState<Partial<Counterparty> | null>(null);
  const bTx = txns.filter((t) => t.isBusiness || t.taxClass === 'BUSINESS_INCOME' || t.taxClass === 'BUSINESS_EXPENSE');
  const monthly = useMemo(() => {
    const m = new Map<string, { inc: ReturnType<typeof D>; exp: ReturnType<typeof D>; missing: number }>();
    for (const t of bTx) {
      const k = t.date.slice(0, 7);
      const e = m.get(k) ?? { inc: D(0), exp: D(0), missing: 0 };
      const a = audOf(t, t.amount);
      if (a === null) e.missing++;
      else if (t.kind === 'income') e.inc = e.inc.plus(a);
      else e.exp = e.exp.plus(a);
      m.set(k, e);
    }
    return [...m].sort();
  }, [bTx]);
  if (!bp) return null;
  const set = (p: Partial<BusinessProfile>) => setBp({ ...bp, ...p });
  return (
    <>
      <div className="panel">
        <h2>Business profile</h2>
        <div className="form-grid">
          <TextInput label="Business name" value={bp.name} onChange={(v) => set({ name: v })} />
          <TextInput label="Trading name" value={bp.tradingName} onChange={(v) => set({ tradingName: v })} />
          <TextInput label="ABN" value={bp.abn} onChange={(v) => set({ abn: v.replace(/[^\d ]/g, '') })} hint={bp.abn && bp.abn.replace(/\s/g, '').length !== 11 ? 'An ABN has 11 digits' : undefined} />
          <TextInput label="Start date" type="date" value={bp.startDate} onChange={(v) => set({ startDate: v })} />
          <TextInput label="Business activity description" value={bp.activity} onChange={(v) => set({ activity: v })} className="span-2" />
          <Check label="Registered for GST" checked={bp.gstRegistered} onChange={(v) => set({ gstRegistered: v })} hint="GST is never assumed for transactions — set it per record." />
          <TextInput label="GST registered from" type="date" value={bp.gstRegisteredFrom} onChange={(v) => set({ gstRegisteredFrom: v })} />
          <Select label="GST accounting basis" value={bp.gstBasis} onChange={(v) => set({ gstBasis: v })} options={[{ value: 'cash', label: 'Cash' }, { value: 'accrual', label: 'Accrual (non-cash)' }]} />
          <Select label="BAS frequency" value={bp.basFrequency} onChange={(v) => set({ basFrequency: v })} options={[{ value: 'monthly', label: 'Monthly' }, { value: 'quarterly', label: 'Quarterly' }, { value: 'annual', label: 'Annual' }]} />
          <Select label="Small business entity?" value={bp.smallBusinessEntity} onChange={(v) => set({ smallBusinessEntity: v })} options={[{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }, { value: 'unknown', label: 'Unknown' }]} />
        </div>
      </div>
      <div className="grid cols-2">
        <div className="panel">
          <h2>Profit and loss — {fyLabel(fy)}</h2>
          <table className="dt">
            <tbody>
              {(r?.business ?? []).map((l) => (
                <tr key={l.key}>
                  <td>{l.label}</td>
                  <td className="num">
                    <Money value={l.amount} />
                  </td>
                  <td>
                    <StatusBadge status={l.status} />
                  </td>
                </tr>
              ))}
              {!r?.business.length && (
                <tr>
                  <td className="muted">No business income or expenses classified for this year.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="panel">
          <h2>Cash-flow summary (business records)</h2>
          <table className="dt">
            <thead>
              <tr>
                <th>Month</th>
                <th className="num">Received</th>
                <th className="num">Paid</th>
                <th className="num">Net</th>
              </tr>
            </thead>
            <tbody>
              {monthly.map(([k, v]) => (
                <tr key={k}>
                  <td>{k}</td>
                  <td className="num">{formatMoney(v.inc)}</td>
                  <td className="num">{formatMoney(v.exp)}</td>
                  <td className="num">
                    {formatMoney(v.inc.minus(v.exp))}
                    {v.missing ? <span className="badge bad"> {v.missing} no rate</span> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="panel">
        <h2>GST / BAS summary</h2>
        {r?.bas.notes.map((n) => (
          <div key={n} className="notice warn">
            {n}
          </div>
        ))}
        <table className="dt">
          <thead>
            <tr>
              <th>Period</th>
              <th className="num">G1 total sales</th>
              <th className="num">GST-free sales</th>
              <th className="num">1A GST on sales</th>
              <th className="num">1B GST credits</th>
              <th className="num">Net GST</th>
              <th>Review</th>
            </tr>
          </thead>
          <tbody>
            {(r?.bas.periods ?? []).map((p: any) => (
              <tr key={p.label}>
                <td>{p.label}</td>
                <td className="num">{formatMoney(p.g1)}</td>
                <td className="num">{formatMoney(p.gstFree)}</td>
                <td className="num">{formatMoney(p.a1)}</td>
                <td className="num">{formatMoney(p.b1)}</td>
                <td className="num">{formatMoney(p.net)}</td>
                <td>
                  {p.reviewTxnIds.length ? <span className="badge warn">{p.reviewTxnIds.length} to review</span> : null}
                  {p.missingRateTxnIds.length ? <span className="badge bad">{p.missingRateTxnIds.length} no rate</span> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="faint">Summaries only — this application does not lodge BAS. Imported services, financial (input-taxed) supplies and mixed-use items are flagged for review.</p>
      </div>
      <div className="panel tight">
        <div className="panel-head">
          <h2 style={{ margin: 0 }}>Business ledger (income & expenses marked as business)</h2>
        </div>
        <TxnTable id="tb-bus" rows={bTx} newDefaults={{ kind: 'income', category: 'business', isBusiness: true }} />
      </div>
      <div className="panel tight">
        <div className="panel-head">
          <h2 style={{ margin: 0 }}>Customers, suppliers and payers</h2>
          <button className="small primary" onClick={() => setCp({ id: newId('cp'), type: 'customer', createdAt: nowIso() })}>
            + Add
          </button>
        </div>
        <DataTable id="cps" rows={counterparties} rowKey={(c) => c.id} onRowClick={(c) => setCp(c)} short columns={[{ key: 'name', header: 'Name', render: (c) => c.name, sortValue: (c) => c.name }, { key: 'type', header: 'Type', render: (c) => c.type, sortValue: (c) => c.type }, { key: 'abn', header: 'ABN', render: (c) => c.abn ?? '' }, { key: 'country', header: 'Country', render: (c) => c.country ?? '' }, { key: 'notes', header: 'Notes', render: (c) => c.notes ?? '' }]} />
      </div>
      {cp && (
        <EntityModal<Counterparty>
          title="Counterparty"
          table="counterparties"
          initial={cp as Counterparty}
          isNew={!counterparties.some((c) => c.id === cp.id)}
          onClose={() => setCp(null)}
          fields={[
            { key: 'name', label: 'Name', type: 'text', required: true, span: 2 },
            { key: 'type', label: 'Type', type: 'select', options: ['payer', 'employer', 'supplier', 'customer', 'broker', 'exchange', 'prop_firm', 'bank', 'government', 'other'].map((x) => ({ value: x, label: x.replace('_', ' ') })) },
            { key: 'abn', label: 'ABN', type: 'text' },
            { key: 'country', label: 'Country', type: 'text' },
            { key: 'notes', label: 'Notes', type: 'textarea' }
          ]}
        />
      )}
    </>
  );
}

const ASSET_FIELDS: FieldSpec<Asset>[] = [
  { key: 'name', label: 'Asset', type: 'text', required: true, span: 2 },
  { key: 'category', label: 'Category', type: 'text', hint: 'e.g. computer, vehicle, furniture' },
  { key: 'acquisitionDate', label: 'Acquired', type: 'date', required: true },
  { key: 'installedReadyDate', label: 'First used / installed ready', type: 'date' },
  { key: 'cost', label: 'Cost (AUD, excl. claimable GST)', type: 'decimal', required: true },
  { key: 'method', label: 'Method', type: 'select', required: true, options: [{ value: 'prime_cost', label: 'Prime cost' }, { value: 'diminishing_value', label: 'Diminishing value' }, { value: 'instant_write_off', label: 'Instant asset write-off (eligibility to confirm)' }, { value: 'low_value_pool', label: 'Low-value pool' }, { value: 'none', label: 'None' }] },
  { key: 'effectiveLifeYears', label: 'Effective life (years)', type: 'decimal', show: (a) => a.method === 'prime_cost' || a.method === 'diminishing_value', required: true },
  { key: 'businessUsePct', label: 'Business / work use %', type: 'decimal', required: true },
  { key: 'openingAdjustableValue', label: 'Opening adjustable value (optional)', type: 'decimal', hint: 'For assets brought in from earlier records' },
  { key: 'openingValueFY', label: 'Opening value applies to FY (ending year)', type: 'int' },
  { key: 'disposalDate', label: 'Disposal date', type: 'date' },
  { key: 'disposalProceeds', label: 'Disposal proceeds (AUD)', type: 'decimal' },
  { key: 'notes', label: 'Notes', type: 'textarea' }
];

function AssetsTab() {
  const { fy } = useApp();
  const assets = useLiveQuery(() => getDb().assets.toArray(), [], []) ?? [];
  const [edit, setEdit] = useState<Partial<Asset> | null>(null);
  return (
    <div className="panel tight">
      <DataTable
        id="assets"
        rows={assets}
        rowKey={(a) => a.id}
        onRowClick={(a) => setEdit(a)}
        toolbar={
          <button className="small primary" onClick={() => setEdit({ id: newId('ast'), method: 'diminishing_value', businessUsePct: '100', documentIds: [], createdAt: nowIso() })}>
            + Add asset
          </button>
        }
        columns={[
          { key: 'name', header: 'Asset', render: (a) => a.name, sortValue: (a) => a.name },
          { key: 'acq', header: 'Acquired', render: (a) => formatDate(a.acquisitionDate), sortValue: (a) => a.acquisitionDate },
          { key: 'cost', header: 'Cost', numeric: true, render: (a) => formatMoney(a.cost), sortValue: (a) => Number(a.cost) },
          { key: 'method', header: 'Method', render: (a) => a.method.replace(/_/g, ' ') },
          { key: 'use', header: 'Business %', numeric: true, render: (a) => a.businessUsePct },
          ...(['opening', 'decline', 'deductible', 'closing'] as const).map((k) => ({
            key: k,
            header: `${fyLabel(fy)} ${k}`,
            numeric: true,
            render: (a: Asset) => {
              const y = depreciationSchedule(a, fy).years.find((x) => x.fy === fy);
              const v = y ? { opening: y.openingValue, decline: y.decline, deductible: y.deductible, closing: y.closingValue }[k] : null;
              return v ? formatMoney(v) : '—';
            }
          })),
          { key: 'flags', header: 'Notes', render: (a) => { const s = depreciationSchedule(a, fy); const y = s.years.find((x) => x.fy === fy); return [...s.flags, ...(y?.flags ?? [])].join(' '); } }
        ]}
      />
      {edit && (
        <EntityModal<Asset>
          title="Depreciating asset"
          table="assets"
          initial={edit as Asset}
          isNew={!assets.some((a) => a.id === edit.id)}
          onClose={() => setEdit(null)}
          fields={ASSET_FIELDS}
          validate={(a) => (a.businessUsePct && (D(a.businessUsePct).gt(100) || D(a.businessUsePct).lt(0)) ? ['Business use must be 0–100%.'] : [])}
          extra={(a) => {
            if (!a.cost || !a.acquisitionDate || !a.method) return null;
            const s = depreciationSchedule(a as Asset, Math.max(fy, fyOfLocalDate(a.acquisitionDate) + 5));
            return (
              <table className="dt" style={{ marginTop: 8 }}>
                <thead>
                  <tr>
                    <th>FY</th>
                    <th className="num">Days</th>
                    <th className="num">Opening</th>
                    <th className="num">Decline</th>
                    <th className="num">Deductible</th>
                    <th className="num">Closing</th>
                  </tr>
                </thead>
                <tbody>
                  {s.years.map((y) => (
                    <tr key={y.fy}>
                      <td>{fyLabel(y.fy)}</td>
                      <td className="num">{y.daysHeld}</td>
                      <td className="num">{formatMoney(y.openingValue)}</td>
                      <td className="num">{formatMoney(y.decline)}</td>
                      <td className="num">{formatMoney(y.deductible)}</td>
                      <td className="num">{formatMoney(y.closingValue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            );
          }}
        />
      )}
    </div>
  );
}

function LogbookTab() {
  const { fy } = useApp();
  const logs = useLiveQuery(() => getDb().logEntries.where('fy').equals(fy).toArray(), [fy], []) ?? [];
  const [edit, setEdit] = useState<Partial<LogEntry> | null>(null);
  const km = (b: boolean) => sum(logs.filter((l) => l.type === 'vehicle' && l.isBusiness === b).map((l) => l.km ?? '0'));
  const bus = km(true);
  const all = bus.plus(km(false));
  const hours = sum(logs.filter((l) => l.type === 'home_office').map((l) => l.hours ?? '0'));
  return (
    <>
      <div className="grid cols-3" style={{ marginBottom: 10 }}>
        <div className="stat">
          <div className="label">Vehicle — business km / total</div>
          <div className="value">
            {bus.toFixed(0)} / {all.toFixed(0)}
          </div>
          <div className="sub">{all.gt(0) ? `Business use ${bus.div(all).times(100).toFixed(1)}% (logbook method requires a valid 12-week logbook)` : 'No trips recorded'}</div>
        </div>
        <div className="stat">
          <div className="label">Home office hours</div>
          <div className="value">{hours.toFixed(1)}</div>
          <div className="sub">Fixed-rate method requires a record of actual hours</div>
        </div>
        <div className="stat">
          <div className="label">Travel entries</div>
          <div className="value">{logs.filter((l) => l.type === 'travel').length}</div>
        </div>
      </div>
      <div className="panel tight">
        <DataTable
          id="logs"
          rows={logs}
          rowKey={(l) => l.id}
          onRowClick={(l) => setEdit(l)}
          toolbar={
            <button className="small primary" onClick={() => setEdit({ id: newId('log'), type: 'vehicle', isBusiness: true, fy, createdAt: nowIso() })}>
              + Add entry
            </button>
          }
          columns={[
            { key: 'date', header: 'Date', render: (l) => formatDate(l.date), sortValue: (l) => l.date },
            { key: 'type', header: 'Type', render: (l) => l.type.replace('_', ' '), sortValue: (l) => l.type },
            { key: 'desc', header: 'Description', render: (l) => l.description, sortValue: (l) => l.description },
            { key: 'purpose', header: 'Purpose', render: (l) => l.purpose },
            { key: 'km', header: 'Km', numeric: true, render: (l) => l.km ?? '' },
            { key: 'hours', header: 'Hours', numeric: true, render: (l) => l.hours ?? '' },
            { key: 'bus', header: 'Business', render: (l) => (l.isBusiness ? 'Yes' : 'No') }
          ]}
        />
      </div>
      {edit && (
        <EntityModal<LogEntry>
          title="Log entry"
          table="logEntries"
          initial={edit as LogEntry}
          isNew={!logs.some((l) => l.id === edit.id)}
          onClose={() => setEdit(null)}
          validate={(l) => (l.date ? [] : ['Date is required.'])}
          afterSave={async (l) => {
            if (l.date && fyOfLocalDate(l.date) !== l.fy) await saveEntity('logEntries', { ...l, fy: fyOfLocalDate(l.date) });
          }}
          fields={[
            { key: 'type', label: 'Type', type: 'select', options: [{ value: 'vehicle', label: 'Vehicle trip' }, { value: 'travel', label: 'Travel' }, { value: 'home_office', label: 'Home office hours' }] },
            { key: 'date', label: 'Date', type: 'date', required: true },
            { key: 'description', label: 'Description', type: 'text', required: true, span: 2 },
            { key: 'purpose', label: 'Purpose', type: 'text', required: true, span: 2 },
            { key: 'vehicle', label: 'Vehicle', type: 'text', show: (l) => l.type === 'vehicle' },
            { key: 'odometerStart', label: 'Odometer start', type: 'decimal', show: (l) => l.type === 'vehicle' },
            { key: 'odometerEnd', label: 'Odometer end', type: 'decimal', show: (l) => l.type === 'vehicle' },
            { key: 'km', label: 'Kilometres', type: 'decimal', show: (l) => l.type === 'vehicle' },
            { key: 'from', label: 'From', type: 'text', show: (l) => l.type !== 'home_office' },
            { key: 'to', label: 'To', type: 'text', show: (l) => l.type !== 'home_office' },
            { key: 'hours', label: 'Hours', type: 'decimal', show: (l) => l.type === 'home_office' },
            { key: 'isBusiness', label: 'Business / work-related', type: 'check' },
            { key: 'notes', label: 'Notes', type: 'textarea' }
          ]}
        />
      )}
    </>
  );
}

function InventoryTab() {
  const { fy } = useApp();
  const rows = useLiveQuery(() => getDb().inventory.where('fy').equals(fy).toArray(), [fy], []) ?? [];
  const [edit, setEdit] = useState<Partial<InventoryRecord> | null>(null);
  return (
    <div className="panel tight">
      <DataTable
        id="inv"
        rows={rows}
        rowKey={(r) => r.id}
        onRowClick={(r) => setEdit(r)}
        toolbar={
          <button className="small primary" onClick={() => setEdit({ id: newId('inv'), fy, openingValue: '0', closingValue: '0', valuationMethod: 'cost' })}>
            + Add stock record
          </button>
        }
        columns={[
          { key: 'd', header: 'Description', render: (r) => r.description },
          { key: 'o', header: 'Opening value', numeric: true, render: (r) => formatMoney(r.openingValue) },
          { key: 'c', header: 'Closing value', numeric: true, render: (r) => formatMoney(r.closingValue) },
          { key: 'ch', header: 'Change (assessable if positive)', numeric: true, render: (r) => formatMoney(D(r.closingValue).minus(D(r.openingValue))) },
          { key: 'm', header: 'Valuation method', render: (r) => r.valuationMethod.replace(/_/g, ' ') }
        ]}
        emptyText="No trading-stock records. Only needed if the business holds trading stock (Div 70)."
      />
      {edit && (
        <EntityModal<InventoryRecord>
          title="Trading stock"
          table="inventory"
          initial={edit as InventoryRecord}
          isNew={!rows.some((r) => r.id === edit.id)}
          onClose={() => setEdit(null)}
          fields={[
            { key: 'description', label: 'Description', type: 'text', required: true, span: 2 },
            { key: 'openingValue', label: 'Opening value', type: 'decimal', required: true },
            { key: 'closingValue', label: 'Closing value', type: 'decimal', required: true },
            { key: 'valuationMethod', label: 'Valuation method', type: 'select', options: [{ value: 'cost', label: 'Cost' }, { value: 'market_selling_value', label: 'Market selling value' }, { value: 'replacement_value', label: 'Replacement value' }] },
            { key: 'notes', label: 'Notes', type: 'textarea' }
          ]}
        />
      )}
    </div>
  );
}

function RecurringTab() {
  const { run } = useApp();
  const categories = useCategories();
  const rows = useLiveQuery(() => getDb().recurring.toArray(), [], []) ?? [];
  const [edit, setEdit] = useState<(Partial<Recurring> & { kind?: string; category?: string; amount?: string; currency?: string; description?: string }) | null>(null);
  const today = new Date().toISOString().slice(0, 10);
  return (
    <div className="panel tight">
      <DataTable
        id="rec"
        rows={rows}
        rowKey={(r) => r.id}
        onRowClick={(r) => setEdit({ ...r, ...r.template } as any)}
        toolbar={
          <>
            <button className="small primary" onClick={() => setEdit({ id: newId('rcr'), frequency: 'monthly', active: true, startDate: today, kind: 'expense', currency: 'AUD', createdAt: nowIso() })}>
              + Add recurring entry
            </button>
            <button className="small" onClick={() => run(() => generateRecurring(today), { success: 'Due recurring records generated (existing ones are never duplicated).' })}>
              Generate due records
            </button>
          </>
        }
        columns={[
          { key: 'n', header: 'Name', render: (r) => r.name },
          { key: 'f', header: 'Frequency', render: (r) => r.frequency },
          { key: 's', header: 'Start', render: (r) => r.startDate },
          { key: 'e', header: 'End', render: (r) => r.endDate ?? '' },
          { key: 'a', header: 'Amount', numeric: true, render: (r) => formatMoney(r.template.amount ?? '0', r.template.currency ?? 'AUD') },
          { key: 'l', header: 'Last generated', render: (r) => r.lastGeneratedDate ?? '—' },
          { key: 'act', header: 'Active', render: (r) => (r.active ? 'Yes' : 'No') }
        ]}
      />
      {edit && (
        <EntityModal<any>
          title="Recurring entry"
          table="recurring"
          initial={edit as any}
          isNew={!rows.some((r) => r.id === edit.id)}
          onClose={() => setEdit(null)}
          validate={(r) => (r.amount && D(r.amount).gt(0) ? [] : ['Amount must be greater than zero.'])}
          afterSave={async (r: any) => {
            const { kind, category, amount, currency, description, ...rest } = r;
            await saveEntity('recurring', { ...rest, template: { kind, category, amount, currency, description } });
          }}
          fields={[
            { key: 'name', label: 'Name', type: 'text', required: true, span: 2 },
            { key: 'kind', label: 'Type', type: 'select', options: [{ value: 'income', label: 'Income' }, { value: 'expense', label: 'Expense' }] },
            { key: 'category', label: 'Category', type: 'select', required: true, includeEmpty: 'Choose…', options: categories.map((c) => ({ value: c.code, label: `${c.type} · ${c.name}` })) },
            { key: 'description', label: 'Description', type: 'text', span: 2 },
            { key: 'amount', label: 'Amount', type: 'decimal', required: true },
            { key: 'currency', label: 'Currency', type: 'text' },
            { key: 'frequency', label: 'Frequency', type: 'select', options: ['weekly', 'fortnightly', 'monthly', 'quarterly', 'annually'].map((x) => ({ value: x, label: x })) },
            { key: 'startDate', label: 'Start date', type: 'date', required: true },
            { key: 'endDate', label: 'End date', type: 'date' },
            { key: 'active', label: 'Active', type: 'check' }
          ]}
        />
      )}
    </div>
  );
}

function ProfileTab() {
  const { fy } = useApp();
  // null = loaded but absent; undefined = still loading
  const storedTp = useLiveQuery(async () => (await getDb().taxProfiles.get(`tp_${fy}`)) ?? null, [fy]);
  const storedUser = useLiveQuery(async () => (await getDb().userProfile.get('user')) ?? null, []);
  const [tp, setTp] = useState<TaxProfile | null>(null);
  const [user, setUser] = useState<UserProfile | null>(null);
  const loadedFy = useRef<number | null>(null);
  useEffect(() => {
    if (storedTp === undefined) return;
    if (storedTp && storedTp.fy !== fy) return;
    if (loadedFy.current !== fy) {
      loadedFy.current = fy;
      setTp(storedTp ?? { id: `tp_${fy}`, fy, residency: 'unknown', medicareExemption: 'none', privateHospitalCover: 'unknown', spouse: 'unknown', helpDebt: 'unknown', updatedAt: nowIso() });
    }
  }, [storedTp, fy]);
  useEffect(() => {
    if (user === null && storedUser !== undefined) setUser(storedUser ?? { id: 'user', fullName: '', updatedAt: nowIso() });
  }, [storedUser, user]);
  const tpKey = useRef<string>('');
  useAutosave(tp, async (v) => {
    if (tpKey.current === JSON.stringify(v)) return;
    tpKey.current = JSON.stringify(v);
    await saveEntity('taxProfiles', v);
  });
  useAutosave(user, (v) => saveEntity('userProfile', v));
  if (!tp || !user) return null;
  const yn: { value: YesNoUnknown; label: string }[] = [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }, { value: 'unknown', label: 'Unknown' }];
  return (
    <div className="grid cols-2">
      <div className="panel">
        <h2>Tax profile — {fyLabel(fy)}</h2>
        <p className="muted">These answers drive which rules apply. Leave “Unknown” rather than guessing — affected amounts are flagged as incomplete.</p>
        <div className="form-grid">
          <Select label="Residency for tax purposes" value={tp.residency} onChange={(v) => setTp({ ...tp, residency: v })} options={[{ value: 'resident', label: 'Australian resident (full year)' }, { value: 'non_resident', label: 'Foreign resident' }, { value: 'part_year', label: 'Part-year resident (review)' }, { value: 'working_holiday', label: 'Working holiday maker (not supported)' }, { value: 'unknown', label: 'Unknown' }]} className="span-2" />
          <Select label="Medicare levy exemption" value={tp.medicareExemption} onChange={(v) => setTp({ ...tp, medicareExemption: v })} options={[{ value: 'none', label: 'None' }, { value: 'half', label: 'Half' }, { value: 'full', label: 'Full' }, { value: 'unknown', label: 'Unknown' }]} />
          <Select label="Private hospital cover (full year)" value={tp.privateHospitalCover} onChange={(v) => setTp({ ...tp, privateHospitalCover: v })} options={yn} />
          <Select label="Spouse" value={tp.spouse} onChange={(v) => setTp({ ...tp, spouse: v })} options={yn} />
          <TextInput label="Dependent children" type="number" value={tp.dependants === undefined ? '' : String(tp.dependants)} onChange={(v) => setTp({ ...tp, dependants: v === '' ? undefined : Number(v) })} />
          <Select label="HELP / study loan debt" value={tp.helpDebt} onChange={(v) => setTp({ ...tp, helpDebt: v })} options={yn} />
          <DecimalInput label="Net capital losses carried into this year (override)" value={tp.openingCapitalLosses} onChange={(v) => setTp({ ...tp, openingCapitalLosses: v })} hint="Leave blank to use the amount calculated from earlier years in the app" />
          <DecimalInput label="Revenue / tax losses carried in (info)" value={tp.openingRevenueLosses} onChange={(v) => setTp({ ...tp, openingRevenueLosses: v })} />
          <DecimalInput label="PAYG instalments paid" value={tp.paygInstalments} onChange={(v) => setTp({ ...tp, paygInstalments: v })} />
          <DecimalInput label="Other tax offsets (verified by you)" value={tp.otherOffsets} onChange={(v) => setTp({ ...tp, otherOffsets: v })} />
          <TextInput label="Other offsets — description" value={tp.otherOffsetsNote} onChange={(v) => setTp({ ...tp, otherOffsetsNote: v })} className="span-2" />
          <div className="field span-4">
            <label htmlFor="tp-notes">Notes for the tax agent</label>
            <textarea id="tp-notes" value={tp.notes ?? ''} onChange={(e) => setTp({ ...tp, notes: e.target.value })} />
          </div>
        </div>
      </div>
      <div className="panel">
        <h2>Taxpayer details</h2>
        <div className="form-grid">
          <TextInput label="Full name" value={user.fullName} onChange={(v) => setUser({ ...user, fullName: v })} className="span-2" />
          <TextInput label="Date of birth" type="date" value={user.dateOfBirth} onChange={(v) => setUser({ ...user, dateOfBirth: v })} />
          <TextInput label="TFN — last 3 digits only" value={user.tfnLast3} onChange={(v) => setUser({ ...user, tfnLast3: v.replace(/\D/g, '').slice(0, 3) })} hint="The full TFN is deliberately not stored" />
          <TextInput label="Email" value={user.email} onChange={(v) => setUser({ ...user, email: v })} />
          <TextInput label="Phone" value={user.phone} onChange={(v) => setUser({ ...user, phone: v })} />
          <TextInput label="Address" value={user.address} onChange={(v) => setUser({ ...user, address: v })} className="span-2" />
          <TextInput label="Registered tax agent" value={user.taxAgent} onChange={(v) => setUser({ ...user, taxAgent: v })} className="span-2" />
        </div>
      </div>
    </div>
  );
}
