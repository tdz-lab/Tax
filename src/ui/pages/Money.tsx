/**
 * Simple mode: money in & money out. Your own named accounts (banks, affiliate / CPA networks, PayPal,
 * brokers, wallets…), quick entry of money in / out, and a plain profit & loss for the year.
 */
import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { getDb } from '../../db/schema';
import { ACCOUNT_TYPE_LABEL } from '../../domain/reference';
import type { Account, AccountType, Transaction } from '../../domain/types';
import { D, Decimal, formatMoney } from '../../lib/decimal';
import { fyLabel, fyLongLabel, fyEnd, fyStart, nowIso } from '../../lib/dates';
import { newId } from '../../lib/ids';
import { audOf } from '../../engines/ledger';
import { accountRecordCounts, reclassifyAll, removeAccount, saveEntity, saveTransaction } from '../../services/ledger';
import { useApp } from '../AppContext';
import { useAccounts, useCategories } from '../hooks';
import { DecimalInput, Modal, Select, TextInput } from '../components/ui';
import { TxnTable } from '../components/TxnTable';
import { TxnEditor } from '../components/TxnEditor';

/** Account kinds offered in simple mode, in plain words. */
export const SIMPLE_KINDS: { type: AccountType; label: string; hint: string; trading: boolean }[] = [
  { type: 'income_source', label: 'Income source', hint: 'Affiliate network, CPA network, marketplace, ad network, freelance platform…', trading: false },
  { type: 'expense_source', label: 'Expense account', hint: 'Where money goes: hosting, software, ad spend, suppliers…', trading: false },
  { type: 'bank', label: 'Bank account', hint: 'Everyday, savings or business bank account', trading: false },
  { type: 'payment', label: 'Payment account', hint: 'PayPal, Stripe, Wise, Payoneer…', trading: false },
  { type: 'us_broker', label: 'Share broker', hint: 'Stocks and ETFs — US, Australian or international', trading: true },
  { type: 'crypto_exchange', label: 'Crypto exchange', hint: 'Binance, Coinbase, Kraken, CoinSpot…', trading: true },
  { type: 'crypto_wallet', label: 'Crypto wallet', hint: 'MetaMask, Ledger, Phantom…', trading: true },
  { type: 'futures', label: 'Futures / forex / CFDs', hint: 'Futures, forex or CFD broker', trading: true },
  { type: 'prop_funded', label: 'Prop-firm account', hint: 'Evaluation or funded trading account', trading: true },
  { type: 'other', label: 'Something else', hint: 'Anything that doesn’t fit above', trading: false }
];
const isTradingType = (t: AccountType) => !['bank', 'cash', 'income_source', 'expense_source', 'payment', 'other'].includes(t);

/** Whether an account is offered for money in, money out or both (banks and payment accounts are both). */
export function moneyUseOf(a: Pick<Account, 'type' | 'moneyUse'>): 'in' | 'out' | 'both' {
  return a.moneyUse ?? (a.type === 'income_source' ? 'in' : a.type === 'expense_source' ? 'out' : 'both');
}
const usableFor = (a: Account, dir: 'in' | 'out') => moneyUseOf(a) === 'both' || moneyUseOf(a) === dir;

/** Capitalises the first letter of a name as it is typed (“impact affiliate” → “Impact affiliate”). */
export const capFirst = (v: string) => v.replace(/^(\s*)(\p{Ll})/u, (_, sp: string, c: string) => sp + c.toUpperCase());

const audAmount = (t: Transaction) => audOf(t, t.amount);

/** Delete an account: removed outright when it has no records, otherwise hidden or deleted together with its records. */
function DeleteAccountModal({ account, onBack, onDone }: { account: Account; onBack: () => void; onDone: () => void }) {
  const { run } = useApp();
  const counts = useLiveQuery(() => accountRecordCounts(account.id), [account.id]);
  const go = async (mode: 'hide' | 'delete_records') => {
    const n = counts?.active ?? 0;
    const ok = await run(() => removeAccount(account.id, mode), {
      success: !counts || counts.active + counts.deleted === 0 ? `Account “${account.name}” deleted.` : mode === 'hide' ? `“${account.name}” hidden — its records still count. Show it again under Hidden accounts.` : `“${account.name}” and its ${n} record${n === 1 ? '' : 's'} deleted. Records can be restored from All transactions → Show deleted.`
    });
    if (ok !== undefined) onDone();
  };
  if (counts === undefined) return null;
  const total = counts.active + counts.deleted;
  return (
    <Modal
      title={`Delete “${account.name}”?`}
      onClose={onBack}
      footer={
        <>
          <button onClick={onBack}>Back</button>
          {total === 0 && (
            <button className="danger" onClick={() => go('delete_records')}>
              Delete account
            </button>
          )}
        </>
      }
    >
      {total === 0 ? (
        <p>This account has no records, so it can be deleted completely.</p>
      ) : counts.active === 0 ? (
        <>
          <p>This account’s records are already deleted ({counts.deleted}), so it will be hidden. It disappears from your lists; it is kept only so those records can be restored.</p>
          <div className="row">
            <button className="danger" onClick={() => go('hide')}>
              Delete account
            </button>
          </div>
        </>
      ) : (
        <>
          <p>
            “{account.name}” has <b>{counts.active} record{counts.active === 1 ? '' : 's'}</b> (all years). What would you like to do?
          </p>
          <div className="choice-cards">
            <button type="button" className="choice-card" onClick={() => go('hide')}>
              <b>Hide the account</b>
              <span>It disappears from your lists, but its records stay and still count in your tax figures. You can show it again later.</span>
            </button>
            <button type="button" className="choice-card" style={{ borderColor: 'var(--bad)' }} onClick={() => go('delete_records')}>
              <b style={{ color: 'var(--bad)' }}>
                Delete the account and its {counts.active} record{counts.active === 1 ? '' : 's'}
              </b>
              <span>The records stop counting and move to Deleted — you can restore them from All transactions → Show deleted until you purge them.</span>
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}

export function AccountModal({ initial, onClose, defaultType = 'income_source' }: { initial?: Account; onClose: (saved?: Account) => void; defaultType?: AccountType }) {
  const { run, settings } = useApp();
  const [deleting, setDeleting] = useState(false);
  const expenseCats = useCategories().filter((c) => !c.archived && c.type === 'expense');
  const isNew = !initial;
  const [a, setA] = useState<Partial<Account>>(initial ?? { id: newId('acc'), type: defaultType, currency: settings.defaultCurrency || 'AUD', taxTreatment: isTradingType(defaultType) ? 'unresolved' : 'not_applicable', propStatus: 'none', createdAt: nowIso() });
  const trading = isTradingType(a.type as AccountType);
  const save = async () => {
    const rec = { ...a, name: (a.name ?? '').trim(), institution: (a.institution || a.name || '').trim(), currency: (a.currency || 'AUD').toUpperCase(), taxTreatment: trading ? a.taxTreatment === 'not_applicable' ? 'unresolved' : a.taxTreatment : 'not_applicable', propStatus: a.type === 'prop_funded' ? (a.propStatus === 'none' ? 'funded_live' : a.propStatus) : 'none', updatedAt: nowIso() } as Account;
    if (!rec.name) return;
    const out = await run(async () => {
      const s = await saveEntity('accounts', rec);
      if (!isNew && initial && (initial.taxTreatment !== rec.taxTreatment || initial.type !== rec.type)) await reclassifyAll('Account type / tax treatment changed');
      return s;
    }, { success: isNew ? `Account “${rec.name}” added.` : 'Account saved.' });
    if (out) onClose(out);
  };
  if (deleting && initial) return <DeleteAccountModal account={initial} onBack={() => setDeleting(false)} onDone={() => onClose()} />;
  return (
    <Modal
      title={isNew ? 'Add an account' : `Edit ${initial!.name}`}
      onClose={() => onClose()}
      footer={
        <>
          {!isNew && (
            <button className="danger" style={{ marginRight: 'auto' }} onClick={() => setDeleting(true)}>
              Delete…
            </button>
          )}
          <button onClick={() => onClose()}>Cancel</button>
          <button className="primary" disabled={!a.name?.trim()} onClick={save}>
            {isNew ? 'Add account' : 'Save & close'}
          </button>
        </>
      }
    >
      <TextInput label="Name (anything you like)" value={a.name} onChange={(v) => setA({ ...a, name: capFirst(v) })} placeholder="e.g. Impact affiliate, MaxBounty, CommBank, Stake US" required />
      <div style={{ margin: '10px 0 4px', fontWeight: 600 }}>What kind of account is it?</div>
      <div className="choice-cards">
        {SIMPLE_KINDS.map((k) => (
          <button key={k.type} type="button" className="choice-card" aria-pressed={a.type === k.type} style={a.type === k.type ? { borderColor: 'var(--accent)', background: 'var(--accent-weak)' } : undefined} onClick={() => setA({ ...a, type: k.type, moneyUse: undefined, taxTreatment: isTradingType(k.type) ? (a.taxTreatment && a.taxTreatment !== 'not_applicable' ? a.taxTreatment : 'unresolved') : 'not_applicable' })}>
            <b>{k.label}</b>
            <span>{k.hint}</span>
          </button>
        ))}
      </div>
      <div className="form-grid" style={{ marginTop: 10 }}>
        <TextInput label="Currency" value={a.currency} onChange={(v) => setA({ ...a, currency: v.toUpperCase() })} hint="e.g. AUD, USD" />
        <TextInput label="Company / platform (optional)" value={a.institution} onChange={(v) => setA({ ...a, institution: v })} />
        {trading && (
          <Select
            label="How are gains in this account taxed?"
            className="span-2"
            value={a.taxTreatment as 'investor_cgt' | 'business_trader' | 'unresolved'}
            onChange={(v) => setA({ ...a, taxTreatment: v })}
            options={[
              { value: 'investor_cgt', label: 'Investor — capital gains (most people)' },
              { value: 'business_trader', label: 'Trader running a business — business income' },
              { value: 'unresolved', label: 'Not sure yet (results are held back until you choose)' }
            ]}
            hint="If unsure, most people who buy and hold or trade part-time are investors — check with your accountant."
          />
        )}
        {!trading && (
          <div className="field span-2">
            <label>Use it for</label>
            <div className="row" style={{ gap: 6 }} role="group" aria-label="Use it for">
              {(
                [
                  ['in', 'Money in'],
                  ['out', 'Money out'],
                  ['both', 'Both']
                ] as const
              ).map(([v, l]) => (
                <button key={v} type="button" className={moneyUseOf(a as Account) === v ? 'primary' : ''} aria-pressed={moneyUseOf(a as Account) === v} onClick={() => setA({ ...a, moneyUse: v })}>
                  {l}
                </button>
              ))}
            </div>
            <span className="hint">+ Money in only offers accounts for money in (or both), and + Money out only accounts for money out (or both). Choose “Both” for banks, PayPal and other accounts you also move money between.</span>
          </div>
        )}
        {!trading && moneyUseOf(a as Account) !== 'in' && (
          <Select
            label="Money going out is usually…"
            className="span-2"
            value={a.defaultExpenseCategory ?? ''}
            onChange={(v) => setA({ ...a, defaultExpenseCategory: v || undefined })}
            includeEmpty="Ask me each time"
            options={expenseCats.map((c) => ({ value: c.code, label: `${c.name} (${c.group})` }))}
          />
        )}
        {!trading && moneyUseOf(a as Account) !== 'out' && (
          <Select
            label="Money coming in is usually…"
            className="span-2"
            value={a.defaultIncomeCategory ?? (a.type === 'income_source' ? 'business' : '')}
            onChange={(v) => setA({ ...a, defaultIncomeCategory: v || undefined })}
            includeEmpty="Ask me each time"
            options={[
              { value: 'business', label: 'Side-project / business income' },
              { value: 'other', label: 'Other income (e.g. a hobby that isn’t a business — ask your accountant)' },
              { value: 'interest', label: 'Interest' },
              { value: 'salary', label: 'Salary / wages' }
            ]}
          />
        )}
      </div>
      <TextInput label="Notes (optional)" value={a.notes} onChange={(v) => setA({ ...a, notes: v })} />
    </Modal>
  );
}

/** Quick money in / money out entry. */
export function QuickMoneyModal({ direction, accountId, onClose }: { direction: 'in' | 'out'; accountId?: string; onClose: () => void }) {
  const { run, fy, settings } = useApp();
  const accounts = useAccounts().filter((a) => !a.archived && (usableFor(a, direction) || a.id === accountId));
  const categories = useCategories().filter((c) => !c.archived && c.type === (direction === 'in' ? 'income' : 'expense'));
  const today = new Date().toISOString().slice(0, 10);
  const inYear = today >= fyStart(fy) && today <= fyEnd(fy) ? today : fyEnd(fy);
  const first = accounts.find((a) => a.id === accountId);
  const [f, setF] = useState({ accountId: accountId ?? '', date: inYear, description: '', amount: undefined as string | undefined, currency: first?.currency ?? settings.defaultCurrency ?? 'AUD', category: (direction === 'in' ? first?.defaultIncomeCategory ?? (first?.type === 'income_source' ? 'business' : '') : first?.defaultExpenseCategory ?? '') as string });
  const [newAcct, setNewAcct] = useState(false);
  const pickAccount = (id: string) => {
    if (id === '__new') return setNewAcct(true);
    const a = accounts.find((x) => x.id === id);
    setF({ ...f, accountId: id, currency: a?.currency ?? f.currency, category: f.category || (direction === 'in' ? a?.defaultIncomeCategory ?? (a?.type === 'income_source' ? 'business' : '') : a?.defaultExpenseCategory ?? '') });
  };
  const ok = f.date && f.amount && D(f.amount).gt(0) && f.category;
  const save = async () => {
    const cat = categories.find((c) => c.code === f.category);
    const t = await run(
      () =>
        saveTransaction({
          kind: direction === 'in' ? 'income' : 'expense',
          date: f.date,
          description: f.description || cat?.name || (direction === 'in' ? 'Money in' : 'Money out'),
          amount: f.amount!,
          currency: f.currency.toUpperCase(),
          category: f.category,
          accountId: f.accountId || undefined,
          isBusiness: cat?.group === 'Business' || undefined,
          timeZone: settings.taxTimeZone,
          tags: [],
          documentIds: [],
          relatedIds: [],
          source: 'manual'
        }),
      { success: direction === 'in' ? 'Money in recorded.' : 'Money out recorded.' }
    );
    if (t) onClose();
  };
  if (newAcct) return <AccountModal defaultType={direction === 'in' ? 'income_source' : 'expense_source'} onClose={(a) => { setNewAcct(false); if (a) setF({ ...f, accountId: a.id, currency: a.currency }); }} />;
  return (
    <Modal
      title={direction === 'in' ? 'Money in' : 'Money out'}
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={!ok} onClick={save}>
            Save
          </button>
        </>
      }
    >
      <div className="form-grid">
        <Select label="Account" className="span-2" value={f.accountId} includeEmpty="(no account)" onChange={pickAccount} options={[...accounts.map((a) => ({ value: a.id, label: `${a.name} — ${ACCOUNT_TYPE_LABEL[a.type].split(' (')[0]}` })), { value: '__new', label: '+ Add a new account…' }]} />
        <TextInput label="Date" type="date" value={f.date} onChange={(v) => setF({ ...f, date: v })} required />
        <DecimalInput label="Amount" value={f.amount} onChange={(v) => setF({ ...f, amount: v })} required />
        <TextInput label="Currency" value={f.currency} onChange={(v) => setF({ ...f, currency: v.toUpperCase() })} />
        <TextInput label="Description" value={f.description} onChange={(v) => setF({ ...f, description: v })} placeholder={direction === 'in' ? 'e.g. October commissions' : 'e.g. Web hosting'} />
        <Select label={direction === 'in' ? 'What is it?' : 'What was it for?'} className="span-2" value={f.category} includeEmpty="Choose…" required onChange={(v) => setF({ ...f, category: v })} options={categories.map((c) => ({ value: c.code, label: `${c.name} (${c.group})` }))} />
      </div>
      {f.currency.toUpperCase() !== 'AUD' && <div className="notice">Amounts in {f.currency.toUpperCase()} are converted to AUD with the exchange rate for the date (import rates under Import files if one is missing).</div>}
    </Modal>
  );
}

export function plRows(txns: Transaction[], catName: Map<string, string>) {
  const group = (ts: Transaction[]) => {
    const m = new Map<string, Decimal | null>();
    for (const t of ts) {
      const v = audAmount(t);
      const k = catName.get(t.category) ?? t.category;
      const cur = m.has(k) ? m.get(k)! : new Decimal(0);
      m.set(k, cur === null || v === null ? null : cur.plus(v));
    }
    return [...m.entries()].sort((a, b) => (b[1]?.toNumber() ?? 0) - (a[1]?.toNumber() ?? 0));
  };
  const total = (rows: [string, Decimal | null][]) => rows.reduce<Decimal | null>((a, [, v]) => (a === null || v === null ? null : a.plus(v)), new Decimal(0));
  const inRows = group(txns.filter((t) => t.kind === 'income'));
  const outRows = group(txns.filter((t) => t.kind === 'expense' || t.kind === 'fee'));
  return { inRows, outRows, inTotal: total(inRows), outTotal: total(outRows) };
}
const SECTIONS: { use: 'in' | 'out' | 'both'; title: string; addType: AccountType; empty: string }[] = [
  { use: 'in', title: 'Money in', addType: 'income_source', empty: 'Where money comes from — e.g. affiliate or CPA networks, marketplaces, clients.' },
  { use: 'out', title: 'Money out', addType: 'expense_source', empty: 'Where money goes — e.g. hosting, software, ad spend, suppliers.' },
  { use: 'both', title: 'Banks & payment accounts', addType: 'bank', empty: 'Bank accounts, PayPal, Stripe, Wise… — used for money in, money out and moving money between your accounts.' }
];
const fm = (v: Decimal | null) => (v === null ? 'needs exchange rate' : formatMoney(v));

export function Money() {
  const { fy, run } = useApp();
  const accounts = useAccounts();
  const categories = useCategories();
  const [quick, setQuick] = useState<{ dir: 'in' | 'out'; accountId?: string } | null>(null);
  const [editAcct, setEditAcct] = useState<Account | { type: AccountType } | null>(null);
  const [move, setMove] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>('');
  const txns = useLiveQuery(() => getDb().transactions.where('fy').equals(fy).filter((t) => t.status === 'active' && (t.kind === 'income' || t.kind === 'expense' || t.kind === 'fee')).toArray(), [fy], []);
  const catName = useMemo(() => new Map(categories.map((c) => [c.code, c.name])), [categories]);
  const shown = filter ? txns.filter((t) => (filter === '__none' ? !t.accountId : t.accountId === filter)) : txns;
  const pl = useMemo(() => plRows(shown, catName), [shown, catName]);
  const net = pl.inTotal === null || pl.outTotal === null ? null : pl.inTotal.minus(pl.outTotal);
  const uncategorised = shown.filter((t) => t.taxClass === 'UNCLASSIFIED' || t.taxClass === 'REVIEW').length;
  const perAccount = useMemo(() => {
    const m = new Map<string, { inn: Decimal | null; out: Decimal | null; n: number }>();
    for (const t of txns) {
      const k = t.accountId ?? '__none';
      const e = m.get(k) ?? { inn: new Decimal(0), out: new Decimal(0), n: 0 };
      const v = audAmount(t);
      if (t.kind === 'income') e.inn = e.inn === null || v === null ? null : e.inn.plus(v);
      else e.out = e.out === null || v === null ? null : e.out.plus(v);
      e.n++;
      m.set(k, e);
    }
    return m;
  }, [txns]);
  // Brokers, exchanges and wallets live under Trading; their dividends etc. still appear in the profit & loss.
  const moneyAccounts = accounts.filter((a) => !a.archived && !isTradingType(a.type));
  const hiddenAccounts = accounts.filter((a) => a.archived && !isTradingType(a.type));
  return (
    <div className="simple-page">
      <div className="page-head">
        <div>
          <h1>Money in & out</h1>
          <div className="simple-sub">
            {fyLongLabel(fy)} · side projects, income and expenses {filter && <>· showing <b>{filter === '__none' ? 'records without an account' : accounts.find((a) => a.id === filter)?.name}</b> <button className="link" onClick={() => setFilter('')}>show all</button></>}
          </div>
        </div>
        <div className="actions">
          <button className="primary" onClick={() => setQuick({ dir: 'in', accountId: filter && filter !== '__none' ? filter : undefined })}>+ Money in</button>
          <button className="primary" onClick={() => setQuick({ dir: 'out', accountId: filter && filter !== '__none' ? filter : undefined })}>+ Money out</button>
          <button onClick={() => setMove('')} title="Move money between your own accounts — not income or an expense">
            Move money
          </button>
          <button onClick={() => setEditAcct({ type: 'income_source' })}>+ Add account</button>
        </div>
      </div>
      <div className="grid cols-2">
        <div className="panel">
          <h2>Profit & loss — {fyLabel(fy)}</h2>
          <table className="pl-table">
            <tbody>
              <tr className="head">
                <td>Money in</td>
                <td className="num">{fm(pl.inTotal)}</td>
              </tr>
              {pl.inRows.map(([k, v]) => (
                <tr key={'i' + k} className="sub">
                  <td>{k}</td>
                  <td className="num">{fm(v)}</td>
                </tr>
              ))}
              <tr className="head">
                <td>Money out</td>
                <td className="num">{pl.outTotal === null ? fm(null) : formatMoney(pl.outTotal.neg())}</td>
              </tr>
              {pl.outRows.map(([k, v]) => (
                <tr key={'o' + k} className="sub">
                  <td>{k}</td>
                  <td className="num">{v === null ? fm(null) : formatMoney(v.neg())}</td>
                </tr>
              ))}
              <tr className="head">
                <td>Net result</td>
                <td className="num">{fm(net)}</td>
              </tr>
            </tbody>
          </table>
          <p className="faint" style={{ marginTop: 8 }}>
            Cash basis, in AUD at each date’s exchange rate. Trading results are under Trading. Personal items you mark as private are listed but not deductible.
          </p>
        </div>
        <div>
          <div className="bubbles" style={{ justifyContent: 'flex-start' }}>
            <div className="bubble green" style={{ width: 128, height: 128 }}>
              <div className="big">{shown.length}</div>
              <div className="small">Records</div>
            </div>
            <div className="bubble blue" style={{ width: 128, height: 128 }}>
              <div className="big">{shown.length - uncategorised}</div>
              <div className="small">Categorised</div>
            </div>
            <div className={`bubble ${uncategorised ? 'amber' : 'slate'}`} style={{ width: 128, height: 128 }}>
              <div className="big">{uncategorised}</div>
              <div className="small">Need a category</div>
            </div>
          </div>
          <div className="panel">
            <h2>Your accounts</h2>
            {moneyAccounts.length === 0 && <p className="muted">Add the places money comes from or goes to — e.g. your affiliate or CPA networks, hosting or ad spend, PayPal and bank accounts. Give them any name you like.</p>}
            {SECTIONS.map((sec) => {
              const list = moneyAccounts.filter((a) => moneyUseOf(a) === sec.use);
              const showNone = sec.use === 'both' && perAccount.has('__none');
              return (
                <section key={sec.use} className="acct-section" aria-label={sec.title}>
                  <div className="acct-section-head">
                    <b>{sec.title}</b>
                    <span className="faint">{list.length}</span>
                    <button className="small link" style={{ marginLeft: 'auto' }} onClick={() => setEditAcct({ type: sec.addType })}>
                      + Add
                    </button>
                  </div>
                  {list.length === 0 && !showNone ? (
                    <p className="faint" style={{ margin: '4px 0 8px', fontSize: 12 }}>{sec.empty}</p>
                  ) : (
                    <div className="acct-scroll">
                      <table className="pl-table">
                        <tbody>
                          {list.map((a) => {
                            const e = perAccount.get(a.id);
                            return (
                              <tr key={a.id}>
                                <td>
                                  <button className="link" onClick={() => setFilter(a.id)}>
                                    {a.name}
                                  </button>
                                  <div className="faint" style={{ fontSize: 11 }}>
                                    {ACCOUNT_TYPE_LABEL[a.type].split(' (')[0]} · {e?.n ?? 0} records
                                  </div>
                                </td>
                                <td className="num">
                                  {sec.use !== 'out' && <span className="pos">{e ? fm(e.inn) : '$0.00'}</span>}
                                  {sec.use === 'both' && <div className="faint" style={{ fontSize: 11 }}>out {e ? fm(e.out) : '$0.00'}</div>}
                                  {sec.use === 'out' && <span>{e ? fm(e.out) : '$0.00'}</span>}
                                </td>
                                <td className={`acct-actions ${sec.use}`}>
                                  {sec.use !== 'out' && (
                                    <button className="small" onClick={() => setQuick({ dir: 'in', accountId: a.id })}>
                                      + In
                                    </button>
                                  )}{' '}
                                  {sec.use !== 'in' && (
                                    <button className="small" onClick={() => setQuick({ dir: 'out', accountId: a.id })}>
                                      + Out
                                    </button>
                                  )}{' '}
                                  {sec.use === 'both' && (
                                    <button className="small" onClick={() => setMove(a.id)} title="Move money to another of your accounts">
                                      Move
                                    </button>
                                  )}{' '}
                                  <button className="small link" onClick={() => setEditAcct(a)} aria-label={`Edit ${a.name}`}>
                                    Edit
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                          {showNone && (
                            <tr>
                              <td>
                                <button className="link" onClick={() => setFilter('__none')}>
                                  No account
                                </button>
                              </td>
                              <td className="num">
                                {fm(perAccount.get('__none')!.inn)}
                                <div className="faint" style={{ fontSize: 11 }}>out {fm(perAccount.get('__none')!.out)}</div>
                              </td>
                              <td />
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>
              );
            })}
            {hiddenAccounts.length > 0 && (
              <details style={{ marginTop: 8 }}>
                <summary className="muted">Hidden accounts ({hiddenAccounts.length})</summary>
                <div className="acct-scroll">
                  <table className="pl-table">
                    <tbody>
                      {hiddenAccounts.map((a) => (
                        <tr key={a.id}>
                          <td>
                            {a.name}
                            <div className="faint" style={{ fontSize: 11 }}>{ACCOUNT_TYPE_LABEL[a.type].split(' (')[0]}</div>
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            <button className="small" onClick={() => run(() => saveEntity('accounts', { ...a, archived: false, updatedAt: nowIso() }), { success: `“${a.name}” is shown again.` })}>
                              Show again
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            )}
          </div>
        </div>
      </div>
      <div className="panel tight">
        <TxnTable id="money-records" rows={shown} newDefaults={{ kind: 'income' }} emptyText="No money in or out recorded for this year yet — use + Money in / + Money out above." />
      </div>
      {quick && <QuickMoneyModal direction={quick.dir} accountId={quick.accountId} onClose={() => setQuick(null)} />}
      {editAcct && <AccountModal initial={'id' in editAcct ? editAcct : undefined} defaultType={'id' in editAcct ? undefined : editAcct.type} onClose={() => setEditAcct(null)} />}
      {move !== null && <TxnEditor initial={{ kind: 'transfer', side: 'send', accountId: move || undefined, currency: accounts.find((a) => a.id === move)?.currency }} onClose={() => setMove(null)} />}
    </div>
  );
}
