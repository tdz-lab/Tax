import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { getDb } from '../../db/schema';
import { ASSET_CLASS_LABEL, FIAT_CURRENCIES, TAX_CLASS_INFO } from '../../domain/reference';
import { ASSET_CLASSES, SIDES, TAX_CLASSES, TXN_KINDS, type AppSettings, type Category, type CostBasisMethod, type RateRecord, type TaxClass } from '../../domain/types';
import { formatInstant, isValidZone, nowIso } from '../../lib/dates';
import { readFileText, saveFile } from '../../lib/files';
import { newId } from '../../lib/ids';
import { exportBackup, readBackup, restoreBackup, isEncryptedBackup, type BackupPayload } from '../../backup/backup';
import { allRuleSets, registerImportedRuleSets, validateRuleSet, type TaxRuleSet } from '../../engines/tax/rules';
import { validateRate } from '../../engines/currency/rates';
import { PROVIDERS } from '../../connectors/registry';
import { LIVE_CONNECTORS_ENABLED } from '../../connectors/types';
import type { ClassificationRule } from '../../services/classification';
import { bumpRevision, deleteEntity, invalidateRateCache, reclassifyAll, refreshAllConversions, writeAudit } from '../../services/ledger';
import { getSetting, setSetting, APP_VERSION } from '../../services/settings';
import { invalidateCalcCache } from '../../services/calc';
import { loadDemoData, removeDemoData } from '../../services/demo';
import { purgeDeleted, runIntegrityChecks, type IntegrityReport } from '../../services/integrity';
import { storageEstimate, requestPersistentStorage } from '../../services/bootstrap';
import { useApp } from '../AppContext';
import { useAccounts, useCategories } from '../hooks';
import { DataTable } from '../components/DataTable';
import { EntityModal } from '../components/EntityModal';
import { Check, Confirm, DecimalInput, Modal, Select, StatusBadge, Tabs, TextInput } from '../components/ui';

type Tab = 'general' | 'tax' | 'rates' | 'categories' | 'templates' | 'backup' | 'health' | 'connectors' | 'rules' | 'security';

export function Settings() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) || 'general';
  return (
    <div>
      <div className="page-head">
        <h1>Settings & data management</h1>
      </div>
      <Tabs<Tab>
        value={tab}
        onChange={(t) => setParams({ tab: t })}
        tabs={[
          { id: 'general', label: 'General & display' },
          { id: 'tax', label: 'Tax & classification' },
          { id: 'rates', label: 'Currencies & rates' },
          { id: 'categories', label: 'Categories' },
          { id: 'templates', label: 'Import templates' },
          { id: 'backup', label: 'Backup & restore' },
          { id: 'health', label: 'Data health' },
          { id: 'rules', label: 'Tax rule sets' },
          { id: 'connectors', label: 'Connectors (planned)' },
          { id: 'security', label: 'Privacy & security' }
        ]}
      />
      {tab === 'general' && <General />}
      {tab === 'tax' && <TaxSettings />}
      {tab === 'rates' && <RatesTab />}
      {tab === 'categories' && <CategoriesTab />}
      {tab === 'templates' && <TemplatesTab />}
      {tab === 'backup' && <BackupTab />}
      {tab === 'health' && <HealthTab />}
      {tab === 'rules' && <RulesTab />}
      {tab === 'connectors' && <ConnectorsTab />}
      {tab === 'security' && <SecurityTab />}
    </div>
  );
}

function General() {
  const { settings, updateSettings } = useApp();
  const [tz, setTz] = useState(settings.taxTimeZone);
  return (
    <>
      <div className="panel">
        <h2>Layout and reports</h2>
        <div className="form-grid">
          <Select<AppSettings['uiMode']> label="Layout" value={settings.uiMode} onChange={(v) => updateSettings({ uiMode: v })} options={[{ value: 'simple', label: 'Simple (recommended)' }, { value: 'advanced', label: 'Advanced — every screen and tab' }]} hint="Same data either way. Also switchable at the bottom of the sidebar." />
          <Check label="Show the full accountant report" checked={settings.showFullReport} onChange={(v) => updateSettings({ showFullReport: v })} hint="Adds the long, detailed PDF (ledgers, parcels, conversions, audit history) next to the short “My tax return figures” report." />
        </div>
      </div>
    <div className="panel">
      <div className="form-grid">
        <div className="field span-2">
          <label htmlFor="tz">Your time zone (determines the Australian financial year of each timestamp)</label>
          <div className="row" style={{ flexWrap: 'nowrap' }}>
            <select id="tz" value={tz} onChange={(e) => setTz(e.target.value)}>
              {['Australia/Sydney', 'Australia/Melbourne', 'Australia/Brisbane', 'Australia/Adelaide', 'Australia/Darwin', 'Australia/Perth', 'Australia/Hobart', 'Australia/Lord_Howe', 'Indian/Christmas'].map((z) => (
                <option key={z}>{z}</option>
              ))}
            </select>
            <button className="small" disabled={tz === settings.taxTimeZone || !isValidZone(tz)} onClick={() => updateSettings({ taxTimeZone: tz })}>
              Apply
            </button>
          </div>
          <span className="hint">Existing records keep their original timestamps; their FY is re-derived when next saved. Edit dates near 30 June if needed.</span>
        </div>
        <Select<AppSettings['dateFormat']> label="Date format" value={settings.dateFormat} onChange={(v) => updateSettings({ dateFormat: v })} options={[{ value: 'dd/MM/yyyy', label: '31/12/2025' }, { value: 'd MMM yyyy', label: '31 Dec 2025' }, { value: 'yyyy-MM-dd', label: '2025-12-31' }]} />
        <Select<AppSettings['timeFormat']> label="Time format" value={settings.timeFormat} onChange={(v) => updateSettings({ timeFormat: v })} options={[{ value: '12h', label: '12-hour (2:30:00 PM)' }, { value: '24h', label: '24-hour (14:30:00)' }]} />
        <Select label="Default transaction currency" value={settings.defaultCurrency} onChange={(v) => updateSettings({ defaultCurrency: v })} options={FIAT_CURRENCIES.map((c) => ({ value: c.code, label: `${c.code} — ${c.name}` }))} />
        <Select label="Display currency" value="AUD" onChange={() => undefined} options={[{ value: 'AUD', label: 'AUD (all tax figures)' }]} hint="Original currencies are always retained on each record" />
        <Select label="Display decimals" value={String(settings.displayDecimals)} onChange={(v) => updateSettings({ displayDecimals: Number(v) })} options={['2', '4'].map((x) => ({ value: x, label: x }))} hint="Calculations always use full decimal precision" />
        <Select<AppSettings['theme']> label="Appearance" value={settings.theme} onChange={(v) => updateSettings({ theme: v })} options={[{ value: 'system', label: 'Match system' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]} />
        <Select label="Rows per page" value={String(settings.pageSize)} onChange={(v) => updateSettings({ pageSize: Number(v) })} options={['25', '50', '100', '250'].map((x) => ({ value: x, label: x }))} />
        <TextInput label="Backup reminder after (days)" type="number" value={String(settings.backupReminderDays)} onChange={(v) => updateSettings({ backupReminderDays: Math.max(1, Number(v) || 14) })} />
      </div>
    </div>
    </>
  );
}

function TaxSettings() {
  const { settings, updateSettings, run } = useApp();
  const accounts = useAccounts();
  const categories = useCategories();
  const rules = useLiveQuery(() => getSetting<ClassificationRule[]>('classificationRules', []), [], []) ?? [];
  const [edit, setEdit] = useState<ClassificationRule | null>(null);
  const saveRules = async (next: ClassificationRule[]) => {
    await run(async () => {
      await setSetting('classificationRules', next);
      await writeAudit({ entityType: 'settings', entityId: 'classificationRules', action: 'update', summary: `Classification rules updated (${next.length})` });
      const n = await reclassifyAll('Classification rules changed');
      return n;
    }, { success: 'Rules saved and automatic classifications refreshed (user-set classifications unchanged).' });
  };
  return (
    <>
      <div className="panel">
        <h2>Cost-basis method by asset class</h2>
        <p className="muted">Applies to disposals unless an account or a specific disposal overrides it. The application never picks a method because it produces less tax. Average cost is not offered for CGT parcels. LIFO/HIFO are parcel-selection orders — only appropriate if your records identify the parcels sold.</p>
        <div className="form-grid">
          {(['au_share', 'us_share', 'intl_share', 'etf', 'managed_fund', 'crypto', 'stablecoin', 'nft', 'option', 'bond', 'other'] as const).map((a) => (
            <Select<CostBasisMethod> key={a} label={ASSET_CLASS_LABEL[a]} value={settings.costBasisDefaults[a] ?? 'FIFO'} onChange={(v) => run(() => updateSettings({ costBasisDefaults: { ...settings.costBasisDefaults, [a]: v } }).then(() => bumpRevision()))} options={[{ value: 'FIFO', label: 'FIFO' }, { value: 'SPECIFIC', label: 'Specific identification' }, { value: 'LIFO', label: 'LIFO (identification)' }, { value: 'HIFO', label: 'Highest cost first (identification)' }]} />
          ))}
        </div>
      </div>
      <div className="panel">
        <h2>Capital loss ordering</h2>
        <Select label="Apply capital losses against" value={settings.lossOrdering} onChange={(v) => run(() => updateSettings({ lossOrdering: v }).then(() => bumpRevision()))} options={[{ value: 'non_discount_first', label: 'Non-discount gains first (ATO method statement default)' }, { value: 'discount_first', label: 'Discount-eligible gains first' }]} />
      </div>
      <div className="panel tight">
        <div className="panel-head">
          <h2 style={{ margin: 0 }}>Classification rules</h2>
          <button className="small primary" onClick={() => setEdit({ id: newId('rule'), name: '', enabled: true, match: {}, taxClass: 'REVIEW' })}>
            + Add rule
          </button>
        </div>
        <p className="muted" style={{ padding: '6px 12px' }}>
          Rules are evaluated in order before the defaults (account tax treatment → category → transaction type). They can vary by transaction type, side, asset class, account, category, financial-year range and description. Classifications you set on a record are never overridden.
        </p>
        <DataTable
          id="rules"
          short
          search={false}
          rows={rules}
          rowKey={(r) => r.id}
          onRowClick={(r) => setEdit(r)}
          columns={[
            { key: 'n', header: 'Rule', render: (r) => r.name },
            { key: 'm', header: 'Matches', render: (r) => Object.entries(r.match).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => `${k}=${v}`).join(', ') || 'everything' },
            { key: 'c', header: 'Classification', render: (r) => TAX_CLASS_INFO[r.taxClass].label },
            { key: 'e', header: 'Enabled', render: (r) => (r.enabled ? 'Yes' : 'No') }
          ]}
          emptyText="No custom rules."
        />
      </div>
      {edit && (
        <Modal
          title="Classification rule"
          onClose={() => setEdit(null)}
          footer={
            <>
              {rules.some((r) => r.id === edit.id) && (
                <button className="danger" style={{ marginRight: 'auto' }} onClick={() => saveRules(rules.filter((r) => r.id !== edit.id)).then(() => setEdit(null))}>
                  Delete
                </button>
              )}
              <button onClick={() => setEdit(null)}>Cancel</button>
              <button className="primary" disabled={!edit.name.trim()} onClick={() => saveRules(rules.some((r) => r.id === edit.id) ? rules.map((r) => (r.id === edit.id ? edit : r)) : [...rules, edit]).then(() => setEdit(null))}>
                Save rule
              </button>
            </>
          }
        >
          <div className="form-grid">
            <TextInput label="Rule name" value={edit.name} onChange={(v) => setEdit({ ...edit, name: v })} className="span-2" required />
            <Select label="Then classify as" value={edit.taxClass} onChange={(v) => setEdit({ ...edit, taxClass: v as TaxClass })} options={TAX_CLASSES.map((c) => ({ value: c, label: TAX_CLASS_INFO[c].label }))} className="span-2" />
            <Select label="Record type" value={edit.match.kind ?? ''} includeEmpty="Any" onChange={(v) => setEdit({ ...edit, match: { ...edit.match, kind: (v || undefined) as any } })} options={TXN_KINDS.map((k) => ({ value: k, label: k }))} />
            <Select label="Side" value={edit.match.side ?? ''} includeEmpty="Any" onChange={(v) => setEdit({ ...edit, match: { ...edit.match, side: (v || undefined) as any } })} options={SIDES.map((k) => ({ value: k, label: k }))} />
            <Select label="Asset class" value={edit.match.assetClass ?? ''} includeEmpty="Any" onChange={(v) => setEdit({ ...edit, match: { ...edit.match, assetClass: (v || undefined) as any } })} options={ASSET_CLASSES.map((k) => ({ value: k, label: ASSET_CLASS_LABEL[k] }))} />
            <Select label="Account" value={edit.match.accountId ?? ''} includeEmpty="Any" onChange={(v) => setEdit({ ...edit, match: { ...edit.match, accountId: v || undefined } })} options={accounts.filter((a) => !a.deletedAt).map((a) => ({ value: a.id, label: a.name }))} />
            <Select label="Category" value={edit.match.category ?? ''} includeEmpty="Any" onChange={(v) => setEdit({ ...edit, match: { ...edit.match, category: v || undefined } })} options={categories.map((c) => ({ value: c.code, label: c.name }))} />
            <TextInput label="FY from (ending year)" type="number" value={edit.match.fyFrom ? String(edit.match.fyFrom) : ''} onChange={(v) => setEdit({ ...edit, match: { ...edit.match, fyFrom: v ? Number(v) : undefined } })} />
            <TextInput label="FY to (ending year)" type="number" value={edit.match.fyTo ? String(edit.match.fyTo) : ''} onChange={(v) => setEdit({ ...edit, match: { ...edit.match, fyTo: v ? Number(v) : undefined } })} />
            <TextInput label="Description contains" value={edit.match.descriptionContains ?? ''} onChange={(v) => setEdit({ ...edit, match: { ...edit.match, descriptionContains: v || undefined } })} />
            <Check label="Enabled" checked={edit.enabled} onChange={(v) => setEdit({ ...edit, enabled: v })} />
          </div>
        </Modal>
      )}
    </>
  );
}

function RatesTab() {
  const { settings, updateSettings, run, toast } = useApp();
  const m = settings.rateMethodology;
  const [pair, setPair] = useState('');
  const rates = useLiveQuery(() => getDb().rates.toArray(), [], []) ?? [];
  const pairs = [...new Set(rates.map((r) => `${r.base}/${r.quote}`))].sort();
  const shown = rates.filter((r) => !pair || `${r.base}/${r.quote}` === pair);
  const [add, setAdd] = useState<Partial<RateRecord> | null>(null);
  const [errs, setErrs] = useState<string[]>([]);
  const [del, setDel] = useState<RateRecord | null>(null);
  const custom = useLiveQuery(() => getSetting<string[]>('customCurrencies', []), [], []) ?? [];
  const [newCode, setNewCode] = useState('');
  const setM = (patch: Partial<typeof m>) => run(async () => {
    await updateSettings({ rateMethodology: { ...m, ...patch } });
    const r = await refreshAllConversions('Rate methodology changed');
    toast(`Methodology updated; ${r.updated} conversion(s) re-resolved (manual and execution rates unchanged).`);
  });
  return (
    <>
      <div className="panel">
        <h2>Historical-rate methodology</h2>
        <p className="muted">Applied to every foreign-currency record unless the record carries a broker execution rate or a manual override. No methodology is presumed legally correct for every event — document your choice for your tax agent. Rates are never invented and today’s rate is never substituted.</p>
        <div className="form-grid">
          <Check label="Prefer execution / intraday rates nearest the trade time" checked={m.preferExecutionRate} onChange={(v) => setM({ preferExecutionRate: v })} />
          <Select label="Daily rate date basis" value={m.dailyRateDateBasis} onChange={(v) => setM({ dailyRateDateBasis: v })} options={[{ value: 'tax_timezone_date', label: 'Date of the event in your (Australian) time zone' }, { value: 'trade_timezone_date', label: 'Date of the event at the trading venue' }]} className="span-2" />
          <TextInput label="Look back for prior published rate (days)" type="number" value={String(m.maxLookbackDays)} onChange={(v) => setM({ maxLookbackDays: Math.max(0, Math.min(10, Number(v) || 0)) })} hint="Weekends / holidays. 0 = exact date only. Uses are flagged." />
          <TextInput label="Preferred source name" value={m.preferredSource ?? ''} onChange={(v) => setM({ preferredSource: v || undefined })} hint="When several sources have a rate for the same date" />
          <Check label="Allow cross rates via USD" checked={m.allowCrossViaUSD} onChange={(v) => setM({ allowCrossViaUSD: v })} />
          <div className="row" style={{ alignItems: 'flex-end' }}>
            <button onClick={() => run(() => refreshAllConversions('Manual refresh'), { success: 'Conversions refreshed.' })}>Re-resolve all conversions</button>
          </div>
        </div>
      </div>
      <div className="panel tight">
        <div className="panel-head">
          <h2 style={{ margin: 0 }}>Historical rates & prices ({rates.length})</h2>
          <div className="row">
            <select aria-label="Pair" value={pair} onChange={(e) => setPair(e.target.value)}>
              <option value="">All pairs</option>
              {pairs.map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
            <button className="small primary" onClick={() => { setErrs([]); setAdd({ base: 'AUD', quote: 'USD', type: 'manual', date: new Date().toISOString().slice(0, 10) }); }}>
              + Add rate manually
            </button>
            <a className="btn small" href="#/imports">Import rate file…</a>
          </div>
        </div>
        <DataTable
          id="rates"
          rows={shown}
          rowKey={(r) => r.id}
          columns={[
            { key: 'd', header: 'Date', render: (r) => r.date, sortValue: (r) => `${r.date}${r.timestamp ?? ''}` },
            { key: 'p', header: 'Pair', render: (r) => `${r.base}/${r.quote}`, sortValue: (r) => `${r.base}/${r.quote}` },
            { key: 'r', header: 'Rate', numeric: true, render: (r) => r.rate },
            { key: 'meaning', header: 'Meaning', render: (r) => `1 ${r.base} = ${r.rate} ${r.quote}` },
            { key: 't', header: 'Type', render: (r) => r.type.replace('_', ' ') },
            { key: 'ts', header: 'Timestamp', render: (r) => r.timestamp ?? '', hidden: true },
            { key: 's', header: 'Source', render: (r) => r.source, sortValue: (r) => r.source },
            { key: 'ret', header: 'Retrieved / imported', render: (r) => (r.retrievedAt ? formatInstant(r.retrievedAt, settings.taxTimeZone) : ''), hidden: true },
            { key: 'x', header: '', render: (r) => <button className="small danger" onClick={(e) => { e.stopPropagation(); setDel(r); }}>Delete</button> }
          ]}
          emptyText="No historical rates. Import a published rate table (e.g. downloaded RBA historical data) or add rates manually with their source."
        />
      </div>
      <div className="panel">
        <h2>Currency registry</h2>
        <p className="muted">ISO 4217 fiat currencies: {FIAT_CURRENCIES.map((c) => c.code).join(', ')}. Crypto assets and stablecoins are instruments (Trading → Instruments) and need their own price records. Additional fiat codes:</p>
        <div className="row">
          {custom.map((c) => (
            <span key={c} className="badge">
              {c}{' '}
              <button className="link" onClick={() => setSetting('customCurrencies', custom.filter((x) => x !== c))}>
                ✕
              </button>
            </span>
          ))}
          <input aria-label="New currency code" placeholder="ISO code" value={newCode} onChange={(e) => setNewCode(e.target.value.toUpperCase().slice(0, 3))} style={{ width: 70 }} />
          <button className="small" disabled={!/^[A-Z]{3}$/.test(newCode)} onClick={() => setSetting('customCurrencies', [...new Set([...custom, newCode])]).then(() => setNewCode(''))}>
            Add
          </button>
        </div>
      </div>
      {add && (
        <Modal
          title="Add historical rate"
          onClose={() => setAdd(null)}
          size="small"
          footer={
            <>
              <button onClick={() => setAdd(null)}>Cancel</button>
              <button
                className="primary"
                onClick={async () => {
                  const r = { ...add, base: add.base?.toUpperCase(), quote: add.quote?.toUpperCase() } as RateRecord;
                  const e = validateRate(r);
                  setErrs(e);
                  if (e.length) return;
                  const ok = await run(async () => {
                    const db = getDb();
                    await db.rates.add({ ...r, id: newId('rate'), retrievedAt: nowIso(), createdAt: nowIso() });
                    await writeAudit({ entityType: 'rate', entityId: `${r.base}/${r.quote}/${r.date}`, action: 'create', summary: `Manual rate ${r.base}/${r.quote} ${r.rate} on ${r.date}`, reason: r.notes, after: r });
                    await bumpRevision('rates');
                    invalidateRateCache();
                    return refreshAllConversions(`Manual rate added ${r.base}/${r.quote} ${r.date}`);
                  });
                  if (ok) {
                    toast(`Rate saved; ${ok.updated} transaction(s) updated.`);
                    setAdd(null);
                  }
                }}
              >
                Save rate
              </button>
            </>
          }
        >
          {errs.length > 0 && <div className="notice bad">{errs.join(' ')}</div>}
          <div className="form-grid">
            <TextInput label="Base" value={add.base} onChange={(v) => setAdd({ ...add, base: v })} hint="1 unit of this…" />
            <TextInput label="Quote" value={add.quote} onChange={(v) => setAdd({ ...add, quote: v })} hint="…equals rate units of this" />
            <DecimalInput label="Rate" value={add.rate} onChange={(v) => setAdd({ ...add, rate: v })} required />
            <TextInput label="Date" type="date" value={add.date} onChange={(v) => setAdd({ ...add, date: v })} />
            <Select label="Type" value={add.type} onChange={(v) => setAdd({ ...add, type: v })} options={['manual', 'daily_reference', 'execution', 'intraday', 'price'].map((x) => ({ value: x as RateRecord['type'], label: x.replace('_', ' ') }))} />
            <TextInput label="Source (required)" value={add.source} onChange={(v) => setAdd({ ...add, source: v })} className="span-2" placeholder="e.g. RBA F11 table, broker statement #123" />
            <TextInput label="Reason / note" value={add.notes} onChange={(v) => setAdd({ ...add, notes: v })} className="span-4" />
          </div>
        </Modal>
      )}
      {del && (
        <Confirm
          title="Delete rate"
          danger
          message={`Delete ${del.base}/${del.quote} ${del.rate} on ${del.date} (${del.source})? Transactions using it will be re-resolved and may become flagged as missing a rate.`}
          onCancel={() => setDel(null)}
          onConfirm={async () => {
            const r = del;
            setDel(null);
            await run(async () => {
              await getDb().rates.delete(r.id);
              await writeAudit({ entityType: 'rate', entityId: r.id, action: 'delete', summary: `Deleted rate ${r.base}/${r.quote} ${r.date}`, before: r });
              await bumpRevision('rates');
              invalidateRateCache();
              return refreshAllConversions('Rate deleted');
            }, { success: 'Rate deleted and conversions re-resolved.' });
          }}
        />
      )}
    </>
  );
}

function CategoriesTab() {
  const categories = useCategories();
  const [edit, setEdit] = useState<Partial<Category> | null>(null);
  return (
    <div className="panel tight">
      <DataTable
        id="cats"
        rows={categories}
        rowKey={(c) => c.id}
        onRowClick={(c) => setEdit(c)}
        toolbar={
          <button className="small primary" onClick={() => setEdit({ id: newId('cat'), type: 'expense', builtin: false, defaultTaxClass: 'REVIEW', group: 'Custom' })}>
            + Add category
          </button>
        }
        columns={[
          { key: 't', header: 'Type', render: (c) => c.type, sortValue: (c) => c.type },
          { key: 'g', header: 'Group', render: (c) => c.group, sortValue: (c) => c.group },
          { key: 'n', header: 'Name', render: (c) => <>{c.name}{c.archived && <span className="badge"> archived</span>}</>, sortValue: (c) => c.name },
          { key: 'code', header: 'Code', render: (c) => <span className="mono">{c.code}</span> },
          { key: 'cls', header: 'Default classification', render: (c) => TAX_CLASS_INFO[c.defaultTaxClass].label },
          { key: 'pct', header: 'Default deductible %', render: (c) => c.defaultDeductiblePct ?? '' },
          { key: 'b', header: 'Built-in', render: (c) => (c.builtin ? 'Yes' : '') }
        ]}
      />
      {edit && (
        <EntityModal<Category>
          title="Category"
          table="categories"
          initial={edit as Category}
          isNew={!categories.some((c) => c.id === edit.id)}
          onClose={() => setEdit(null)}
          validate={(c) => (c.code && !/^[a-z0-9_]+$/.test(c.code) ? ['Code: lower-case letters, digits and underscores only.'] : categories.some((x) => x.id !== c.id && x.type === c.type && x.code === c.code) ? ['Code already used.'] : [])}
          afterSave={() => reclassifyAll('Category default changed').then(() => undefined)}
          fields={[
            { key: 'type', label: 'Type', type: 'select', options: [{ value: 'income', label: 'Income' }, { value: 'expense', label: 'Expense' }], show: (c) => !c.builtin },
            { key: 'code', label: 'Code', type: 'text', required: true, show: (c) => !c.builtin },
            { key: 'name', label: 'Name', type: 'text', required: true, span: 2 },
            { key: 'group', label: 'Group', type: 'text', required: true },
            { key: 'defaultTaxClass', label: 'Default classification', type: 'select', options: TAX_CLASSES.map((c) => ({ value: c, label: TAX_CLASS_INFO[c].label })), span: 2 },
            { key: 'defaultDeductiblePct', label: 'Default deductible / business %', type: 'decimal' },
            { key: 'guidance', label: 'Eligibility note', type: 'textarea' },
            { key: 'archived', label: 'Archived (hidden from pickers)', type: 'check' }
          ]}
        />
      )}
    </div>
  );
}

function TemplatesTab() {
  const { run } = useApp();
  const templates = useLiveQuery(() => getDb().importTemplates.toArray(), [], []) ?? [];
  return (
    <div className="panel tight">
      <DataTable
        id="tpls"
        rows={templates}
        rowKey={(t) => t.id}
        columns={[
          { key: 'n', header: 'Template', render: (t) => t.name, sortValue: (t) => t.name },
          { key: 't', header: 'Target', render: (t) => t.target },
          { key: 'tz', header: 'Time zone', render: (t) => t.timeZone },
          { key: 'df', header: 'Date format', render: (t) => t.dateFormat },
          { key: 'm', header: 'Mapped columns', render: (t) => Object.values(t.mapping).filter(Boolean).join(', ') },
          { key: 'b', header: '', render: (t) => (t.builtin ? <span className="badge">built-in</span> : <button className="small danger" onClick={() => run(() => deleteEntity('importTemplates', t.id), { success: 'Template deleted.' })}>Delete</button>) }
        ]}
      />
      <p className="faint" style={{ padding: '0 12px 8px' }}>Create templates from the Imports wizard (“Save mapping as template”). Files whose headers match a template are recognised automatically.</p>
    </div>
  );
}

function BackupTab() {
  const { settings, updateSettings, run, toast } = useApp();
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [restoreFile, setRestoreFile] = useState<{ name: string; text: string; encrypted: boolean } | null>(null);
  const [restorePw, setRestorePw] = useState('');
  const [payload, setPayload] = useState<BackupPayload | null>(null);
  const [mode, setMode] = useState<'replace' | 'merge'>('merge');
  const [confirm, setConfirm] = useState(false);
  const history = useLiveQuery(() => getDb().backups.orderBy('createdAt').reverse().toArray(), [], []) ?? [];
  const doExport = async () => {
    if (pw && pw !== pw2) return toast('Passwords do not match.', { kind: 'bad' });
    const res = await run(() => exportBackup({ includeDocuments: settings.includeDocumentsInBackup, password: pw || undefined }));
    if (!res) return;
    const how = await saveFile(res.blob, res.fileName, 'Backup', { 'application/json': ['.json'] });
    if (how === 'cancelled') toast('Backup not saved (cancelled).', { kind: 'bad' });
    else toast(`Backup ${how === 'saved' ? 'saved' : 'downloaded'}: ${res.fileName}`);
    setPw('');
    setPw2('');
  };
  return (
    <>
      <div className="notice warn">
        Your data lives in this browser’s storage on this device. Clearing site data, uninstalling the browser, browser storage eviction or device loss will delete it. <b>Export backups regularly and keep them somewhere safe.</b> Last backup: {settings.lastBackupAt ? formatInstant(settings.lastBackupAt, settings.taxTimeZone, { timeFormat: settings.timeFormat }) : 'never'}.
      </div>
      <div className="grid cols-2">
        <div className="panel">
          <h2>Export full backup</h2>
          <Check label="Include document files (receipts, statements)" checked={settings.includeDocumentsInBackup} onChange={(v) => updateSettings({ includeDocumentsInBackup: v })} />
          <div className="form-grid" style={{ marginTop: 6 }}>
            <TextInput label="Password (optional — encrypts the backup)" type="password" value={pw} onChange={setPw} className="span-2" hint="AES-256-GCM with PBKDF2-SHA-256 (600,000 iterations), via the browser’s WebCrypto. A lost password cannot be recovered." />
            <TextInput label="Confirm password" type="password" value={pw2} onChange={setPw2} className="span-2" />
          </div>
          <button className="primary" style={{ marginTop: 8 }} disabled={!!pw && (pw.length < 8 || pw !== pw2)} onClick={doExport}>
            Export backup…
          </button>
          <p className="faint">Each backup gets a timestamped file name, so existing backups are never overwritten. Where supported you choose the folder; otherwise it goes to Downloads.</p>
        </div>
        <div className="panel">
          <h2>Restore from backup</h2>
          <label className="btn">
            Choose backup file…
            <input
              type="file"
              accept=".json,application/json"
              className="sr-only"
              aria-label="Backup file"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                const text = await readFileText(f);
                let encrypted = false;
                try {
                  encrypted = isEncryptedBackup(JSON.parse(text));
                } catch {
                  /* reported below */
                }
                setRestoreFile({ name: f.name, text, encrypted });
                setPayload(null);
                if (!encrypted) setPayload((await run(() => readBackup(text))) ?? null);
                e.target.value = '';
              }}
            />
          </label>
          {restoreFile?.encrypted && !payload && (
            <div className="row" style={{ marginTop: 6 }}>
              <TextInput label="Backup password" type="password" value={restorePw} onChange={setRestorePw} />
              <button style={{ alignSelf: 'flex-end' }} onClick={async () => setPayload((await run(() => readBackup(restoreFile.text, restorePw))) ?? null)}>
                Decrypt & verify
              </button>
            </div>
          )}
          {payload && (
            <>
              <div className="notice ok" style={{ marginTop: 6 }}>
                Verified backup from {formatInstant(payload.createdAt, settings.taxTimeZone)} · app v{payload.appVersion} · schema v{payload.schemaVersion} · integrity hash OK.
                <div className="faint">
                  {Object.entries(payload.counts).filter(([, n]) => n).map(([k, n]) => `${k}: ${n}`).join(' · ')}
                </div>
              </div>
              <Select label="Restore mode" value={mode} onChange={setMode} options={[{ value: 'merge', label: 'Merge — add records not already present (existing records win)' }, { value: 'replace', label: 'Replace — erase current data and restore the backup' }]} />
              <button className="primary" style={{ marginTop: 8 }} onClick={() => setConfirm(true)}>
                Restore…
              </button>
            </>
          )}
        </div>
      </div>
      <div className="panel tight">
        <div className="panel-head">
          <h2 style={{ margin: 0 }}>Backup history</h2>
        </div>
        <DataTable id="backups" short search={false} rows={history} rowKey={(b) => b.id} columns={[{ key: 'w', header: 'Created', render: (b) => formatInstant(b.createdAt, settings.taxTimeZone, { timeFormat: settings.timeFormat }), sortValue: (b) => b.createdAt }, { key: 'f', header: 'File', render: (b) => b.fileName }, { key: 'e', header: 'Encrypted', render: (b) => (b.encrypted ? 'Yes' : 'No') }, { key: 'd', header: 'Documents', render: (b) => (b.includesDocuments ? 'Included' : 'Excluded') }, { key: 'c', header: 'Transactions', numeric: true, render: (b) => b.counts.transactions ?? 0 }, { key: 'h', header: 'SHA-256', render: (b) => <span className="mono">{b.sha256.slice(0, 12)}…</span> }]} emptyText="No backups exported from this device yet." />
      </div>
      {confirm && payload && (
        <Confirm
          title={mode === 'replace' ? 'Replace all data?' : 'Merge backup?'}
          danger={mode === 'replace'}
          confirmLabel="Restore"
          requireText={mode === 'replace' ? 'RESTORE' : undefined}
          message={mode === 'replace' ? 'All current records, documents and settings in this browser will be erased and replaced by the backup. Export a backup of the current data first if you might need it.' : 'Records from the backup that are not already present will be added. Conflicting records keep their current version and are counted.'}
          onCancel={() => setConfirm(false)}
          onConfirm={async () => {
            setConfirm(false);
            const rep = await run(() => restoreBackup(payload, mode));
            if (rep) {
              invalidateCalcCache();
              const added = Object.values(rep.added).reduce((a, b) => a + b, 0);
              const conflicts = Object.values(rep.conflicts).reduce((a, b) => a + b, 0);
              toast(`Restore complete: ${added} record(s) restored${mode === 'merge' ? `, ${conflicts} conflict(s) kept current` : ''}, ${rep.documentsRestored} document file(s). Reloading…`);
              setTimeout(() => window.location.reload(), 1500);
            }
          }}
        />
      )}
    </>
  );
}

function HealthTab() {
  const { run, settings, toast } = useApp();
  const [rep, setRep] = useState<IntegrityReport | null>(null);
  const [est, setEst] = useState<Awaited<ReturnType<typeof storageEstimate>>>(null);
  const [confirmPurge, setConfirmPurge] = useState(false);
  const [confirmDemo, setConfirmDemo] = useState(false);
  const revision = useLiveQuery(async () => (await getDb().meta.get('revision'))?.value, []);
  const hasDemo = useLiveQuery(async () => (await getDb().transactions.filter((t) => !!t.isDemo).count()) > 0, [], false);
  const refresh = async () => {
    setRep(await runIntegrityChecks());
    setEst(await storageEstimate());
  };
  useEffect(() => {
    void refresh();
  }, [revision]);
  return (
    <>
      <div className="grid cols-2">
        <div className="panel">
          <h2>Storage</h2>
          <dl className="kv">
            <dt>Storage used / available</dt>
            <dd>{est ? `${(est.usage / 1048576).toFixed(1)} MB of ~${(est.quota / 1048576).toFixed(0)} MB` : 'Not reported by this browser'}</dd>
            <dt>Persistent storage</dt>
            <dd>
              {est?.persisted ? <span className="badge ok">granted</span> : <span className="badge warn">not granted</span>}{' '}
              {!est?.persisted && (
                <button className="link" onClick={async () => { const r = await requestPersistentStorage(); toast(r ? 'Persistent storage granted.' : 'The browser declined persistent storage — keep regular backups.'); void refresh(); }}>
                  request
                </button>
              )}
            </dd>
            <dt>Database schema</dt>
            <dd>
              v{rep?.dbVersion} (application expects v{rep?.schemaVersion})
            </dd>
            <dt>App version</dt>
            <dd>{APP_VERSION}</dd>
            <dt>Last backup</dt>
            <dd>{settings.lastBackupAt ? formatInstant(settings.lastBackupAt, settings.taxTimeZone) : <span className="badge bad">never</span>}</dd>
            <dt>Data revision</dt>
            <dd>{String(revision ?? 0)}</dd>
          </dl>
          <p className="faint">Large histories (100,000+ records) are supported; browsers typically allow hundreds of MB to several GB per site. Calculations run on this device and may take a few seconds for very large ledgers.</p>
        </div>
        <div className="panel">
          <h2>Integrity checks</h2>
          {rep && (
            <ul className="list-plain">
              <li>Records referencing missing accounts: {rep.orphanAccountRefs.length}</li>
              <li>Records referencing missing instruments: {rep.orphanInstrumentRefs.length}</li>
              <li>Records linked to missing documents: {rep.orphanDocumentRefs.length}</li>
              <li>Documents linked to missing records: {rep.docLinksToMissingRecords.length}</li>
              <li>
                Document files verified against SHA-256: {rep.documents.ok} OK, {rep.documents.missing.length} missing, {rep.documents.mismatched.length} mismatched
              </li>
              <li>Records with invalid financial year: {rep.invalidFy.length}</li>
              <li>Soft-deleted records: {rep.deletedTransactions}</li>
            </ul>
          )}
          <div className="row">
            <button className="small" onClick={refresh}>
              Re-run checks
            </button>
            <button className="small danger" disabled={!rep?.deletedTransactions} onClick={() => setConfirmPurge(true)}>
              Permanently purge deleted records
            </button>
          </div>
        </div>
      </div>
      <div className="panel">
        <h2>Record counts</h2>
        <div className="row">{rep && Object.entries(rep.counts).map(([k, n]) => <span key={k} className="badge">{k}: {n}</span>)}</div>
      </div>
      <div className="panel">
        <h2>Demonstration data</h2>
        <p className="muted">Fictional records (marked DEMO, with fictional exchange rates) for exploring the application. Never use them for a real return.</p>
        <div className="row">
          <button onClick={() => run(() => loadDemoData(), { success: 'Demonstration data loaded.' })}>Load demonstration data</button>
          <button className="danger" disabled={!hasDemo} onClick={() => setConfirmDemo(true)}>
            Remove demonstration data
          </button>
        </div>
      </div>
      {confirmPurge && <Confirm title="Purge deleted records" danger message="Permanently remove all soft-deleted records? Undo will no longer be possible." onCancel={() => setConfirmPurge(false)} onConfirm={async () => { setConfirmPurge(false); await run(() => purgeDeleted(), { success: 'Deleted records purged.' }); void refresh(); }} />}
      {confirmDemo && <Confirm title="Remove demonstration data" danger message="Remove all DEMO accounts, records, instruments and fictional rates?" onCancel={() => setConfirmDemo(false)} onConfirm={async () => { setConfirmDemo(false); await run(() => removeDemoData(), { success: 'Demonstration data removed.' }); }} />}
    </>
  );
}

function RulesTab() {
  const { run, toast } = useApp();
  const [sets, setSets] = useState<TaxRuleSet[]>(allRuleSets());
  return (
    <>
      <div className="panel tight">
        <DataTable
          id="rulesets"
          search={false}
          rows={sets}
          rowKey={(r) => r.id}
          columns={[
            { key: 'id', header: 'Rule set', render: (r) => <span className="mono">{r.id}</span> },
            { key: 'fy', header: 'FY', render: (r) => `${r.fy - 1}–${String(r.fy).slice(-2)}`, sortValue: (r) => r.fy },
            { key: 'v', header: 'Version', render: (r) => r.version },
            { key: 's', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
            { key: 'b', header: 'Resident rates', render: (r) => r.residentBrackets.map((b) => `${(Number(b.rate) * 100).toFixed(1)}%>$${Number(b.above).toLocaleString('en-AU')}`).join(' ') },
            { key: 'm', header: 'Medicare low-income', render: (r) => (r.medicareLowIncome ? `${r.medicareLowIncome.singleLower}–${r.medicareLowIncome.singleUpper}` : <span className="badge warn">not verified</span>) },
            { key: 'chk', header: 'Unconfirmed figures', render: (r) => (r.checks ? r.checks.filter((c) => c.status === 'conflicting' || c.status === 'unverified').map((c) => c.param).join(', ') || 'none' : '—') },
            { key: 'sup', header: 'Superseded by', render: (r) => r.supersededBy ?? '' },
            { key: 'src', header: 'Sources', render: (r) => r.sources.length }
          ]}
        />
      </div>
      <div className="panel">
        <h2>Import an updated rule set</h2>
        <p className="muted">Rule sets are data (JSON) with a new id/version. Importing never rewrites historical calculation snapshots; recalculate and save a new snapshot with a reason. Only import rule sets you have verified against ATO publications.</p>
        <label className="btn">
          Choose rule-set JSON…
          <input
            type="file"
            accept=".json"
            className="sr-only"
            aria-label="Rule set file"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              await run(async () => {
                const obj = JSON.parse(await readFileText(f));
                const list = Array.isArray(obj) ? obj : [obj];
                for (const r of list) {
                  const errs = validateRuleSet(r);
                  if (errs.length) throw new Error(`${r?.id ?? 'rule set'}: ${errs.join('; ')}`);
                }
                const existing = await getSetting<TaxRuleSet[]>('importedRuleSets', []);
                const merged = [...existing.filter((x) => !list.some((l: TaxRuleSet) => l.id === x.id)), ...list];
                await setSetting('importedRuleSets', merged);
                registerImportedRuleSets(merged);
                await writeAudit({ entityType: 'settings', entityId: 'importedRuleSets', action: 'update', summary: `Imported rule set(s): ${list.map((l: TaxRuleSet) => l.id).join(', ')}` });
                await bumpRevision();
                invalidateCalcCache();
                setSets(allRuleSets());
              });
              toast('Rule set imported. Existing snapshots are unchanged.');
              e.target.value = '';
            }}
          />
        </label>
        <button className="small" style={{ marginLeft: 8 }} onClick={() => saveFile(new Blob([JSON.stringify(allRuleSets(), null, 2)], { type: 'application/json' }), 'tax-rule-sets.json')}>
          Export current rule sets (template)
        </button>
      </div>
    </>
  );
}

function ConnectorsTab() {
  const rows = useLiveQuery(() => getDb().connectors.toArray(), [], []) ?? [];
  return (
    <>
      <div className="notice warn">
        Live connections are <b>not available in this build</b> ({LIVE_CONNECTORS_ENABLED ? 'enabled' : 'disabled'} by design): no credentials are requested or stored, nothing connects to banks, brokers or exchanges, and no data is sent anywhere. Use CSV imports today. The connector framework (authorisation, scopes, incremental sync, rate limits, retries, duplicate prevention and user approval before import) is in place for future, provider-specific implementations.
      </div>
      <div className="panel tight">
        <DataTable
          id="connectors"
          search={false}
          rows={PROVIDERS}
          rowKey={(p) => p.id}
          columns={[
            { key: 'n', header: 'Provider type', render: (p) => p.name },
            { key: 'c', header: 'Category', render: (p) => p.category.replace('_', ' ') },
            { key: 's', header: 'Status', render: () => <span className="badge">Planned — not implemented</span> },
            { key: 'a', header: 'Planned access methods', render: (p) => p.plannedAuth.join(', ') },
            { key: 'notes', header: 'Notes', render: (p) => p.notes },
            { key: 'cfg', header: 'Local config', render: (p) => rows.find((r) => r.providerId === p.id)?.status ?? '—' }
          ]}
        />
      </div>
    </>
  );
}

function SecurityTab() {
  return (
    <div className="panel">
      <h2>Privacy & security</h2>
      <ul className="list-plain">
        <li>All data is stored locally in this browser (IndexedDB). There is no account, server, telemetry or analytics, and nothing is uploaded.</li>
        <li>After the first load the application works fully offline; it makes no network requests for its core functions.</li>
        <li>The full TFN is never stored (only the last three digits, optionally). Do not store passwords or seed phrases in notes.</li>
        <li>Browser storage is not encrypted by this application. Anyone with access to your device profile can read it — use device encryption and a locked user account.</li>
        <li>Encrypted backups use the browser’s built-in WebCrypto (PBKDF2-SHA-256 key derivation, AES-256-GCM authenticated encryption). No custom cryptography; no keys are stored.</li>
        <li>Browsers can evict site data under storage pressure, and clearing browsing data deletes it. The app requests persistent storage, but regular exported backups are essential.</li>
        <li>This is a recordkeeping and preparation tool. It is not ATO-certified, does not lodge returns or BAS, and is not tax advice.</li>
      </ul>
    </div>
  );
}
