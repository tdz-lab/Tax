import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { getDb } from '../../db/schema';
import { ACCOUNT_TYPE_LABEL, ASSET_CLASS_LABEL, TAX_CLASS_INFO, TREATMENT_LABEL } from '../../domain/reference';
import { ACCOUNT_TYPES, ASSET_CLASSES, type Account, type AssetClass, type CorporateAction, type Instrument } from '../../domain/types';
import { D, formatMoney, formatQty } from '../../lib/decimal';
import { formatDate, fyLabel, nowIso } from '../../lib/dates';
import { newId } from '../../lib/ids';
import { audOf } from '../../engines/ledger';
import { computePerformance } from '../../engines/trading/performance';
import { accountCashBalances, accountHoldings } from '../../engines/trading/performance';
import { reclassifyAll } from '../../services/ledger';
import { useApp, useSessionState } from '../AppContext';
import { useAccounts, useInstruments, useWorkspace } from '../hooks';
import { TxnTable } from '../components/TxnTable';
import { DataTable } from '../components/DataTable';
import { EntityModal, type FieldSpec } from '../components/EntityModal';
import { Money, Stat, Tabs } from '../components/ui';

type Tab = 'ledger' | 'accounts' | 'instruments' | 'lots' | 'performance' | 'positions' | 'prop' | 'corporate';

export function Trading() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) || 'ledger';
  const { fy } = useApp();
  return (
    <div>
      <div className="page-head">
        <h1>Trading & Investments — {fyLabel(fy)}</h1>
      </div>
      <Tabs<Tab>
        value={tab}
        onChange={(t) => setParams({ tab: t })}
        tabs={[
          { id: 'ledger', label: 'Trade ledger' },
          { id: 'accounts', label: 'Accounts' },
          { id: 'instruments', label: 'Instruments' },
          { id: 'lots', label: 'Holdings & lots' },
          { id: 'performance', label: 'Performance' },
          { id: 'positions', label: 'Derivatives & positions' },
          { id: 'prop', label: 'Prop firms' },
          { id: 'corporate', label: 'Corporate actions' }
        ]}
      />
      {tab === 'ledger' && <LedgerTab />}
      {tab === 'accounts' && <AccountsTab />}
      {tab === 'instruments' && <InstrumentsTab />}
      {tab === 'lots' && <LotsTab />}
      {tab === 'performance' && <PerformanceTab />}
      {tab === 'positions' && <PositionsTab />}
      {tab === 'prop' && <PropTab />}
      {tab === 'corporate' && <CorporateTab />}
    </div>
  );
}

function LedgerTab() {
  const { fy } = useApp();
  const instruments = useInstruments();
  const accounts = useAccounts();
  const [f, setF] = useSessionState('trade-filter', { accountId: '', assetClass: '', scope: 'fy' });
  const txns = useLiveQuery(() => (f.scope === 'fy' ? getDb().transactions.where('fy').equals(fy).toArray() : getDb().transactions.toArray()), [fy, f.scope], []) ?? [];
  const inst = new Map(instruments.map((i) => [i.id, i]));
  const rows = txns.filter(
    (t) =>
      t.status === 'active' &&
      (t.kind === 'trade' || t.kind === 'transfer' || t.kind === 'cash' || t.kind === 'adjustment' || (t.instrumentId && t.kind === 'income') || (t.accountId && accounts.find((a) => a.id === t.accountId)?.type.startsWith('prop'))) &&
      (!f.accountId || t.accountId === f.accountId) &&
      (!f.assetClass || inst.get(t.instrumentId ?? '')?.assetClass === f.assetClass)
  );
  return (
    <div className="panel tight">
      <TxnTable
        id="trade-ledger"
        rows={rows}
        newDefaults={{ kind: 'trade', side: 'buy', category: 'trading', accountId: f.accountId || undefined }}
        extraToolbar={
          <>
            <select aria-label="Scope" value={f.scope} onChange={(e) => setF({ ...f, scope: e.target.value })}>
              <option value="fy">{fyLabel(fy)}</option>
              <option value="all">All years</option>
            </select>
            <select aria-label="Account" value={f.accountId} onChange={(e) => setF({ ...f, accountId: e.target.value })}>
              <option value="">All accounts</option>
              {accounts.filter((a) => !a.deletedAt).map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
            <select aria-label="Asset class" value={f.assetClass} onChange={(e) => setF({ ...f, assetClass: e.target.value })}>
              <option value="">All asset classes</option>
              {ASSET_CLASSES.map((a) => (
                <option key={a} value={a}>
                  {ASSET_CLASS_LABEL[a]}
                </option>
              ))}
            </select>
          </>
        }
      />
    </div>
  );
}

const ACCOUNT_FIELDS: FieldSpec<Account>[] = [
  { key: 'name', label: 'Account name', type: 'text', required: true, span: 2 },
  { key: 'type', label: 'Account type', type: 'select', required: true, options: ACCOUNT_TYPES.map((t) => ({ value: t, label: ACCOUNT_TYPE_LABEL[t] })) },
  { key: 'institution', label: 'Broker / exchange / bank / firm', type: 'text', required: true },
  { key: 'accountRef', label: 'Account identifier (masked)', type: 'text', hint: 'e.g. last 4 digits — never passwords' },
  { key: 'currency', label: 'Account currency', type: 'text', required: true },
  { key: 'country', label: 'Country', type: 'text' },
  {
    key: 'taxTreatment',
    label: 'Australian tax treatment of gains',
    type: 'select',
    required: true,
    span: 2,
    options: (['investor_cgt', 'business_trader', 'profit_making', 'unresolved', 'not_applicable'] as const).map((t) => ({ value: t, label: TREATMENT_LABEL[t] })),
    hint: 'Investor vs trader depends on your circumstances — choose “Not yet determined” if unsure; results will be flagged for review.'
  },
  { key: 'costBasisMethod', label: 'Cost-basis method override', type: 'select', includeEmpty: 'Use asset-class default', options: ['FIFO', 'LIFO', 'HIFO', 'SPECIFIC'].map((m) => ({ value: m, label: m })) },
  { key: 'propStatus', label: 'Prop-firm status', type: 'select', options: [{ value: 'none', label: 'Not a prop-firm account' }, { value: 'evaluation', label: 'Evaluation / challenge (simulated)' }, { value: 'funded_simulated', label: 'Funded — simulated capital' }, { value: 'funded_live', label: 'Funded — live capital' }] },
  { key: 'profitSharePct', label: 'Profit share to trader %', type: 'decimal', show: (a) => !!a.propStatus && a.propStatus !== 'none' },
  { key: 'payoutCurrency', label: 'Payout currency', type: 'text', show: (a) => !!a.propStatus && a.propStatus !== 'none' },
  { key: 'openingBalance', label: 'Opening cash balance', type: 'signed' },
  { key: 'openingBalanceDate', label: 'Opening balance date', type: 'date' },
  { key: 'archived', label: 'Archived', type: 'check' },
  { key: 'notes', label: 'Notes', type: 'textarea' }
];

function AccountsTab() {
  const accounts = useAccounts();
  const { value: ws } = useWorkspace();
  const [edit, setEdit] = useState<Partial<Account> | null>(null);
  const balances = useMemo(() => (ws ? accountCashBalances(ws.data) : new Map()), [ws]);
  return (
    <div className="panel tight">
      <DataTable
        id="accounts"
        rows={accounts.filter((a) => !a.deletedAt)}
        rowKey={(a) => a.id}
        onRowClick={(a) => setEdit(a)}
        toolbar={
          <button className="small primary" onClick={() => setEdit({ id: newId('acc'), type: 'au_broker', currency: 'AUD', taxTreatment: 'unresolved', propStatus: 'none', createdAt: nowIso() })}>
            + Add account
          </button>
        }
        columns={[
          { key: 'name', header: 'Account', render: (a) => <>{a.name}{a.archived && <span className="badge"> archived</span>}</>, sortValue: (a) => a.name },
          { key: 'type', header: 'Type', render: (a) => ACCOUNT_TYPE_LABEL[a.type], sortValue: (a) => a.type },
          { key: 'inst', header: 'Institution', render: (a) => a.institution },
          { key: 'ccy', header: 'Currency', render: (a) => a.currency },
          { key: 'treat', header: 'Tax treatment', render: (a) => <span className={`badge ${a.taxTreatment === 'unresolved' ? 'warn' : ''}`}>{TREATMENT_LABEL[a.taxTreatment]}</span>, sortValue: (a) => a.taxTreatment },
          { key: 'prop', header: 'Prop status', render: (a) => (a.propStatus === 'none' ? '' : a.propStatus.replace('_', ' ')) },
          { key: 'bal', header: 'Recorded cash balance', render: (a) => [...(balances.get(a.id) ?? new Map()).entries()].map(([c, v]: any) => formatMoney(v, c)).join(' · ') }
        ]}
        emptyText="No accounts yet. Add your brokers, exchanges, wallets, prop-firm and bank accounts."
      />
      <p className="faint" style={{ padding: '0 12px 8px' }}>
        Deposits and withdrawals are never treated as profit. Recorded cash balance = opening balance + deposits − withdrawals ± trade cash flows − fees (statement P&L rows included; matched derivative P&L shown in Reconciliation).
      </p>
      {edit && (
        <EntityModal<Account>
          title="Account"
          table="accounts"
          initial={edit as Account}
          isNew={!accounts.some((a) => a.id === edit.id)}
          onClose={() => setEdit(null)}
          fields={ACCOUNT_FIELDS}
          afterSave={async () => {
            await reclassifyAll('Account tax treatment / type changed');
          }}
        />
      )}
    </div>
  );
}

const INSTRUMENT_FIELDS: FieldSpec<Instrument>[] = [
  { key: 'symbol', label: 'Symbol', type: 'text', required: true },
  { key: 'name', label: 'Name', type: 'text', required: true, span: 2 },
  { key: 'assetClass', label: 'Asset class', type: 'select', required: true, options: ASSET_CLASSES.map((a) => ({ value: a, label: ASSET_CLASS_LABEL[a] })) },
  { key: 'market', label: 'Exchange / market', type: 'text' },
  { key: 'currency', label: 'Pricing currency', type: 'text', required: true },
  { key: 'country', label: 'Country', type: 'text' },
  { key: 'isin', label: 'ISIN', type: 'text' },
  { key: 'multiplier', label: 'Contract multiplier / size', type: 'decimal', show: (i) => ['future', 'option', 'cfd', 'forex'].includes(i.assetClass ?? '') },
  { key: 'tickSize', label: 'Tick size', type: 'decimal', show: (i) => i.assetClass === 'future' },
  { key: 'tickValue', label: 'Tick value', type: 'decimal', show: (i) => i.assetClass === 'future' },
  { key: 'expiry', label: 'Expiry', type: 'date', show: (i) => i.assetClass === 'future' || i.assetClass === 'option' },
  { key: 'underlying', label: 'Underlying', type: 'text', show: (i) => ['future', 'option', 'cfd'].includes(i.assetClass ?? '') },
  { key: 'strike', label: 'Strike', type: 'decimal', show: (i) => i.assetClass === 'option' },
  { key: 'optionType', label: 'Call / put', type: 'select', includeEmpty: '—', options: [{ value: 'call', label: 'Call' }, { value: 'put', label: 'Put' }], show: (i) => i.assetClass === 'option' },
  { key: 'pegCurrency', label: 'Documented peg (info only)', type: 'text', show: (i) => i.assetClass === 'stablecoin', hint: 'Never used as a rate — import actual prices' },
  { key: 'isSpam', label: 'Spam / dust token (exclude from calculations)', type: 'check', show: (i) => i.assetClass === 'crypto' || i.assetClass === 'nft' },
  { key: 'notes', label: 'Notes', type: 'textarea' }
];

function InstrumentsTab() {
  const instruments = useInstruments();
  const [edit, setEdit] = useState<Partial<Instrument> | null>(null);
  return (
    <div className="panel tight">
      <DataTable
        id="instruments"
        rows={instruments}
        rowKey={(i) => i.id}
        onRowClick={(i) => setEdit(i)}
        toolbar={
          <button className="small primary" onClick={() => setEdit({ id: newId('ins'), assetClass: 'au_share', currency: 'AUD', createdAt: nowIso() })}>
            + Add instrument
          </button>
        }
        columns={[
          { key: 's', header: 'Symbol', render: (i) => <>{i.symbol}{i.isSpam && <span className="badge warn"> spam</span>}</>, sortValue: (i) => i.symbol },
          { key: 'n', header: 'Name', render: (i) => i.name, sortValue: (i) => i.name },
          { key: 'c', header: 'Asset class', render: (i) => ASSET_CLASS_LABEL[i.assetClass], sortValue: (i) => i.assetClass },
          { key: 'm', header: 'Market', render: (i) => i.market ?? '' },
          { key: 'cur', header: 'Currency', render: (i) => i.currency },
          { key: 'mult', header: 'Multiplier', numeric: true, render: (i) => i.multiplier ?? '' },
          { key: 'exp', header: 'Expiry', render: (i) => i.expiry ?? '' }
        ]}
      />
      {edit && <EntityModal<Instrument> title="Instrument" table="instruments" initial={edit as Instrument} isNew={!instruments.some((i) => i.id === edit.id)} onClose={() => setEdit(null)} fields={INSTRUMENT_FIELDS} />}
    </div>
  );
}

function LotsTab() {
  const { value: ws } = useWorkspace();
  const instruments = useInstruments();
  const accounts = useAccounts();
  const inst = new Map(instruments.map((i) => [i.id, i]));
  const acct = new Map(accounts.map((a) => [a.id, a]));
  const lots = (ws?.lots.lots ?? []).filter((l) => l.qtyRemaining.gt(0));
  const holdings = ws ? accountHoldings(ws.data.transactions) : new Map();
  const holdRows = [...holdings.entries()].flatMap(([a, m]: any) => [...m.entries()].filter(([, q]: any) => !q.isZero()).map(([i, q]: any) => ({ id: `${a}|${i}`, a, i, q })));
  return (
    <>
      <div className="panel tight">
        <div className="panel-head">
          <h2 style={{ margin: 0 }}>Open acquisition parcels (tax pools)</h2>
          <span className="muted">Pooled per instrument and tax treatment; partial disposals reduce remaining quantity and cost base proportionally.</span>
        </div>
        <DataTable
          id="lots"
          rows={lots}
          rowKey={(l) => l.id}
          columns={[
            { key: 'sym', header: 'Instrument', render: (l) => inst.get(l.instrumentId)?.symbol ?? l.instrumentId, sortValue: (l) => inst.get(l.instrumentId)?.symbol ?? '' },
            { key: 'acq', header: 'Acquired', render: (l) => formatDate(l.acquiredDate), sortValue: (l) => l.acquiredAt },
            { key: 'origin', header: 'Origin', render: (l) => l.origin.replace('_', ' ') },
            { key: 'grp', header: 'Treatment', render: (l) => l.group },
            { key: 'acct', header: 'Account (acquired in)', render: (l) => acct.get(l.accountId ?? '')?.name ?? '' },
            { key: 'q', header: 'Remaining qty', numeric: true, render: (l) => formatQty(l.qtyRemaining), sortValue: (l) => l.qtyRemaining.toNumber() },
            { key: 'qo', header: 'Original qty', numeric: true, render: (l) => formatQty(l.qtyOriginal), hidden: true },
            { key: 'cost', header: 'Remaining cost base', numeric: true, render: (l) => (l.costAud === null ? <span className="badge bad">unknown</span> : formatMoney(l.costAud)), sortValue: (l) => l.costAud?.toNumber() ?? null },
            { key: 'unit', header: 'Cost / unit', numeric: true, render: (l) => (l.costAud === null ? '' : formatMoney(l.costAud.div(l.qtyRemaining), 'AUD', { dp: 4 })) },
            { key: 'adj', header: 'Adjustments', render: (l) => l.adjustments.join(' ') }
          ]}
          emptyText="No open parcels."
        />
      </div>
      <div className="panel tight">
        <div className="panel-head">
          <h2 style={{ margin: 0 }}>Holdings by account (from recorded flows)</h2>
        </div>
        <DataTable id="holdings" rows={holdRows} rowKey={(r) => r.id} short columns={[{ key: 'a', header: 'Account', render: (r) => acct.get(r.a)?.name ?? r.a, sortValue: (r) => acct.get(r.a)?.name ?? '' }, { key: 'i', header: 'Instrument', render: (r) => inst.get(r.i)?.symbol ?? r.i, sortValue: (r) => inst.get(r.i)?.symbol ?? '' }, { key: 'q', header: 'Quantity', numeric: true, render: (r) => <span className={r.q.isNegative() ? 'neg' : ''}>{formatQty(r.q)}</span>, sortValue: (r) => r.q.toNumber() }]} />
      </div>
    </>
  );
}

function PerformanceTab() {
  const { fy, settings } = useApp();
  const { value: ws } = useWorkspace();
  const instruments = useInstruments();
  const accounts = useAccounts();
  const [f, setF] = useSessionState('perf-filter', { scope: 'fy', accountId: '', assetClass: '', currency: '', direction: '', includeSimulated: true });
  const inst = new Map(instruments.map((i) => [i.id, i]));
  const acct = new Map(accounts.map((a) => [a.id, a]));
  const perf = useMemo(
    () =>
      ws
        ? computePerformance(ws.data, settings.taxTimeZone, {
            fy: f.scope === 'fy' ? fy : undefined,
            accountId: f.accountId || undefined,
            assetClass: (f.assetClass || undefined) as AssetClass | undefined,
            currency: f.currency || undefined,
            direction: (f.direction || undefined) as 'long' | 'short' | undefined,
            includeSimulated: f.includeSimulated
          })
        : null,
    [ws, f, fy, settings.taxTimeZone]
  );
  return (
    <>
      <div className="notice">Economic trading performance (broker-style) — <b>not</b> a tax calculation. Tax results depend on classification, CGT rules and timing; see Tax Calculations.</div>
      <div className="panel tight">
        <div className="toolbar">
          <select aria-label="Period" value={f.scope} onChange={(e) => setF({ ...f, scope: e.target.value })}>
            <option value="fy">{fyLabel(fy)}</option>
            <option value="all">All years</option>
          </select>
          <select aria-label="Account" value={f.accountId} onChange={(e) => setF({ ...f, accountId: e.target.value })}>
            <option value="">All accounts</option>
            {accounts.filter((a) => !a.deletedAt).map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          <select aria-label="Asset class" value={f.assetClass} onChange={(e) => setF({ ...f, assetClass: e.target.value })}>
            <option value="">All asset classes</option>
            {ASSET_CLASSES.map((a) => (
              <option key={a} value={a}>
                {ASSET_CLASS_LABEL[a]}
              </option>
            ))}
          </select>
          <input aria-label="Currency" placeholder="Currency" value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value.toUpperCase() })} style={{ width: 80 }} />
          <select aria-label="Direction" value={f.direction} onChange={(e) => setF({ ...f, direction: e.target.value })}>
            <option value="">Long & short</option>
            <option value="long">Long</option>
            <option value="short">Short</option>
          </select>
          <label className="row" style={{ gap: 4 }}>
            <input type="checkbox" checked={f.includeSimulated} onChange={(e) => setF({ ...f, includeSimulated: e.target.checked })} /> Include simulated (prop evaluation)
          </label>
        </div>
        {perf && (
          <div style={{ padding: 10 }}>
            <div className="grid cols-4">
              <Stat label="Realised P&L (net of fees, AUD)" value={<Money value={perf.totalRealisedAud === null ? null : perf.totalRealisedAud.toString()} />} sub={perf.incomplete ? `${perf.incomplete} event(s) missing AUD values` : undefined} />
              <Stat label="Fees (AUD)" value={<Money value={perf.totalFeesAud === null ? null : perf.totalFeesAud.toString()} />} />
              <Stat label="Closed events" value={perf.tradeCount} />
              <Stat label="Win rate" value={perf.winRate === null ? '—' : `${(perf.winRate * 100).toFixed(1)}%`} />
            </div>
          </div>
        )}
        <DataTable
          id="perf"
          rows={perf?.rows ?? []}
          rowKey={(r) => `${r.accountId}|${r.instrumentId}`}
          columns={[
            { key: 'a', header: 'Account', render: (r) => <>{acct.get(r.accountId ?? '')?.name ?? ''}{r.simulated && <span className="badge"> simulated</span>}</>, sortValue: (r) => acct.get(r.accountId ?? '')?.name ?? '' },
            { key: 'i', header: 'Instrument', render: (r) => inst.get(r.instrumentId)?.symbol ?? '', sortValue: (r) => inst.get(r.instrumentId)?.symbol ?? '' },
            { key: 'cls', header: 'Asset class', render: (r) => ASSET_CLASS_LABEL[inst.get(r.instrumentId)?.assetClass ?? 'other'] },
            { key: 'dir', header: 'Direction', render: (r) => r.direction },
            { key: 'n', header: 'Closed', numeric: true, render: (r) => r.closedCount, sortValue: (r) => r.closedCount },
            { key: 'w', header: 'W / L', render: (r) => `${r.wins} / ${r.losses}` },
            { key: 'native', header: 'Realised (native)', numeric: true, render: (r) => (r.realisedNative === null ? 'mixed' : formatMoney(r.realisedNative, r.nativeCurrency)) },
            { key: 'aud', header: 'Realised (AUD)', numeric: true, render: (r) => <Money value={r.realisedAud === null ? null : r.realisedAud.toString()} />, sortValue: (r) => r.realisedAud?.toNumber() ?? null },
            { key: 'fees', header: 'Fees (AUD)', numeric: true, render: (r) => <Money value={r.feesAud === null ? null : r.feesAud.toString()} /> }
          ]}
        />
      </div>
      <div className="panel tight">
        <div className="panel-head">
          <h2 style={{ margin: 0 }}>Open positions / exposure</h2>
          <span className="muted">Mark = last recorded trade price (no market data feed in this build)</span>
        </div>
        <DataTable
          id="open-pos"
          short
          rows={perf?.openPositions ?? []}
          rowKey={(p) => `${p.accountId}|${p.instrumentId}|${p.direction}`}
          columns={[
            { key: 'a', header: 'Account', render: (p) => acct.get(p.accountId ?? '')?.name ?? '' },
            { key: 'i', header: 'Instrument', render: (p) => inst.get(p.instrumentId)?.symbol ?? '' },
            { key: 'd', header: 'Direction', render: (p) => p.direction },
            { key: 'q', header: 'Quantity', numeric: true, render: (p) => formatQty(p.quantity) },
            { key: 'c', header: 'Cost base (AUD)', numeric: true, render: (p) => (p.costAud ? formatMoney(p.costAud) : '—') },
            { key: 'm', header: 'Last price', numeric: true, render: (p) => (p.markPrice ? formatMoney(p.markPrice, p.markCurrency || 'AUD', { dp: 4 }) : '—') },
            { key: 'e', header: 'Exposure (native, approx.)', numeric: true, render: (p) => (p.markPrice ? formatMoney(p.markPrice.times(p.quantity).times(D(inst.get(p.instrumentId)?.multiplier ?? '1')), p.markCurrency || 'AUD') : '—') }
          ]}
        />
      </div>
    </>
  );
}

function PositionsTab() {
  const { fy } = useApp();
  const { value: ws } = useWorkspace();
  const instruments = useInstruments();
  const accounts = useAccounts();
  const inst = new Map(instruments.map((i) => [i.id, i]));
  const acct = new Map(accounts.map((a) => [a.id, a]));
  const events = (ws?.deriv.realised ?? []).filter((e) => e.fy === fy);
  return (
    <>
      <div className="panel tight">
        <div className="panel-head">
          <h2 style={{ margin: 0 }}>Realised derivative / short-position results — {fyLabel(fy)}</h2>
        </div>
        <DataTable
          id="deriv"
          rows={events}
          rowKey={(e) => e.id}
          columns={[
            { key: 'd', header: 'Date', render: (e) => formatDate(e.date), sortValue: (e) => e.date },
            { key: 'a', header: 'Account', render: (e) => acct.get(e.accountId ?? '')?.name ?? '' },
            { key: 'i', header: 'Instrument', render: (e) => inst.get(e.instrumentId ?? '')?.symbol ?? '', sortValue: (e) => inst.get(e.instrumentId ?? '')?.symbol ?? '' },
            { key: 'k', header: 'Event', render: (e) => `${e.kind.replace(/_/g, ' ')}${e.direction ? ` (${e.direction})` : ''}` },
            { key: 'q', header: 'Qty', numeric: true, render: (e) => formatQty(e.quantity) },
            { key: 'p', header: 'P&L (native)', numeric: true, render: (e) => formatMoney(e.pnlNative, e.currency) },
            { key: 'f', header: 'Fees (native)', numeric: true, render: (e) => formatMoney(e.feesNative, e.currency) },
            { key: 'n', header: 'Net AUD', numeric: true, render: (e) => <Money value={e.netAud === null ? null : e.netAud.toString()} />, sortValue: (e) => e.netAud?.toNumber() ?? null },
            { key: 'c', header: 'Classification', render: (e) => <span className={`badge ${e.taxClass === 'REVIEW' ? 'warn' : ''}`}>{TAX_CLASS_INFO[e.taxClass].label}</span> },
            { key: 'fl', header: 'Notes', render: (e) => e.flags.join(' ') }
          ]}
        />
      </div>
      <div className="panel tight">
        <div className="panel-head">
          <h2 style={{ margin: 0 }}>Open futures / CFD / forex / short positions</h2>
        </div>
        <DataTable id="deriv-open" short rows={ws?.deriv.open ?? []} rowKey={(p) => `${p.key}|${p.direction}`} columns={[{ key: 'a', header: 'Account', render: (p) => acct.get(p.accountId ?? '')?.name ?? '' }, { key: 'i', header: 'Instrument', render: (p) => inst.get(p.instrumentId)?.symbol ?? '' }, { key: 'd', header: 'Direction', render: (p) => p.direction }, { key: 'q', header: 'Quantity', numeric: true, render: (p) => formatQty(p.quantity) }, { key: 'e', header: 'Average entry', numeric: true, render: (p) => formatQty(p.avgEntry, 6) }, { key: 'c', header: 'Currency', render: (p) => p.currency }]} />
        {(ws?.deriv.issues ?? []).map((i, n) => (
          <div key={n} className="notice warn" style={{ margin: 8 }}>
            {i.message}
          </div>
        ))}
      </div>
    </>
  );
}

function PropTab() {
  const { fy } = useApp();
  const accounts = useAccounts();
  const txns = useLiveQuery(() => getDb().transactions.where('fy').equals(fy).filter((t) => t.status === 'active').toArray(), [fy], []) ?? [];
  const propAccts = accounts.filter((a) => !a.deletedAt && (a.propStatus !== 'none' || a.type.startsWith('prop')));
  const propIds = new Set(propAccts.map((a) => a.id));
  const rows = txns.filter((t) => t.category.startsWith('prop_') || propIds.has(t.accountId ?? ''));
  const tot = (pred: (c: string, k: string) => boolean) => {
    let s = D(0);
    let missing = 0;
    for (const t of rows.filter((t) => pred(t.category, t.kind))) {
      const a = audOf(t, t.amount);
      if (a === null) missing++;
      else s = s.plus(a);
    }
    return { s: s.toString(), missing };
  };
  const fees = tot((c, k) => k === 'fee' || ['prop_eval_fee', 'prop_reset_fee', 'prop_subscription', 'prop_withdrawal_fee'].includes(c));
  const payouts = tot((c) => c === 'prop_payout');
  const refunds = tot((c) => c === 'prop_refund');
  return (
    <>
      <div className="grid cols-4" style={{ marginBottom: 10 }}>
        <Stat label="Evaluation / reset / platform fees" value={<Money value={fees.s} />} sub={fees.missing ? `${fees.missing} without rate` : undefined} />
        <Stat label="Payouts received" value={<Money value={payouts.s} />} sub={payouts.missing ? `${payouts.missing} without rate` : undefined} />
        <Stat label="Refunds" value={<Money value={refunds.s} />} />
        <Stat label="Prop accounts" value={propAccts.length} sub={propAccts.map((a) => `${a.name} (${a.propStatus.replace('_', ' ')})`).join(', ')} />
      </div>
      <div className="notice warn">Prop-firm payouts and fees default to “Needs specialist review”. Classify them (e.g. business income / business expense) once their character is confirmed — the same records then appear in the Tax & Business workspace without re-entry. Evaluation and simulated-funded trading is excluded from tax results.</div>
      <div className="panel tight">
        <TxnTable id="prop" rows={rows} newDefaults={{ kind: 'fee', category: 'prop_eval_fee', currency: 'USD' }} />
      </div>
    </>
  );
}

function CorporateTab() {
  const instruments = useInstruments();
  const rows = useLiveQuery(() => getDb().corporateActions.toArray(), [], []) ?? [];
  const [edit, setEdit] = useState<Partial<CorporateAction> | null>(null);
  const inst = new Map(instruments.map((i) => [i.id, i]));
  const opts = instruments.map((i) => ({ value: i.id, label: `${i.symbol} — ${i.name}` }));
  return (
    <div className="panel tight">
      <DataTable
        id="ca"
        rows={rows}
        rowKey={(r) => r.id}
        onRowClick={(r) => setEdit(r)}
        toolbar={
          <button className="small primary" onClick={() => setEdit({ id: newId('ca'), type: 'split', ratioFrom: '1', ratioTo: '2', documentIds: [], createdAt: nowIso() })}>
            + Add corporate action
          </button>
        }
        columns={[
          { key: 'd', header: 'Date', render: (r) => formatDate(r.date), sortValue: (r) => r.date },
          { key: 'i', header: 'Instrument', render: (r) => inst.get(r.instrumentId)?.symbol ?? '' },
          { key: 't', header: 'Type', render: (r) => r.type.replace(/_/g, ' ') },
          { key: 'r', header: 'Ratio (old:new)', render: (r) => `${r.ratioFrom}:${r.ratioTo}` },
          { key: 'n', header: 'New instrument', render: (r) => inst.get(r.newInstrumentId ?? '')?.symbol ?? '' },
          { key: 'p', header: 'Cost base to new %', render: (r) => r.costBaseAllocationPct ?? '' },
          { key: 'c', header: 'Cash / unit', render: (r) => r.cashPerUnit ?? '' }
        ]}
        emptyText="No corporate actions recorded."
      />
      {edit && (
        <EntityModal<CorporateAction>
          title="Corporate action"
          table="corporateActions"
          initial={edit as CorporateAction}
          isNew={!rows.some((r) => r.id === edit.id)}
          onClose={() => setEdit(null)}
          fields={[
            { key: 'instrumentId', label: 'Instrument', type: 'select', includeEmpty: 'Choose…', options: opts, required: true, span: 2 },
            { key: 'type', label: 'Type', type: 'select', required: true, options: ['split', 'reverse_split', 'bonus', 'merger_rollover', 'merger_taxable', 'spinoff', 'return_of_capital', 'symbol_change', 'other'].map((x) => ({ value: x, label: x.replace(/_/g, ' ') })) },
            { key: 'date', label: 'Effective date', type: 'date', required: true },
            { key: 'ratioFrom', label: 'Old units', type: 'decimal', required: true },
            { key: 'ratioTo', label: 'New units', type: 'decimal', required: true },
            { key: 'newInstrumentId', label: 'New / resulting instrument', type: 'select', includeEmpty: '—', options: opts, show: (r) => ['merger_rollover', 'spinoff', 'symbol_change', 'merger_taxable'].includes(r.type ?? '') },
            { key: 'costBaseAllocationPct', label: '% of cost base to new instrument', type: 'decimal', show: (r) => r.type === 'spinoff' },
            { key: 'cashPerUnit', label: 'Cash per unit (AUD)', type: 'decimal', show: (r) => r.type === 'return_of_capital' },
            { key: 'notes', label: 'Notes', type: 'textarea' }
          ]}
        />
      )}
    </div>
  );
}
