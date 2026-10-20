/**
 * Simple mode: add trades from any source — pick (or add) the broker / exchange / wallet, then enter a
 * trade by hand or import the file you downloaded from it.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { getDb } from '../../db/schema';
import { ACCOUNT_TYPE_LABEL } from '../../domain/reference';
import type { Account, Transaction } from '../../domain/types';
import { useApp } from '../AppContext';
import { useAccounts } from '../hooks';
import { TxnEditor } from '../components/TxnEditor';
import { TxnTable } from '../components/TxnTable';
import { AccountModal } from './Money';

const TRADING_TYPES = new Set(['au_broker', 'us_broker', 'intl_broker', 'crypto_exchange', 'crypto_wallet', 'futures', 'forex', 'cfd', 'options', 'prop_evaluation', 'prop_funded']);

const SOURCE_HELP: { title: string; text: string }[] = [
  { title: 'Share brokers', text: 'Download the trade history / transaction report as CSV (e.g. “Trade confirmations” or “Activity statement”).' },
  { title: 'Crypto exchanges', text: 'Download the full trade history and the deposit/withdrawal history as CSV.' },
  { title: 'Futures, forex, CFDs', text: 'Download the closed-positions or account statement as CSV.' },
  { title: 'Any other market', text: 'Any CSV works — you match its columns to the app once and can save that as a template for next time.' }
];

export function AddTrades() {
  const { fy } = useApp();
  const nav = useNavigate();
  const accounts = useAccounts().filter((a) => !a.archived && TRADING_TYPES.has(a.type));
  const [selected, setSelected] = useState<string>('');
  const [adding, setAdding] = useState(false);
  const [editor, setEditor] = useState<Partial<Transaction> | null>(null);
  const source = accounts.find((a) => a.id === selected);
  const trades = useLiveQuery(() => getDb().transactions.where('fy').equals(fy).filter((t) => t.status === 'active' && (t.kind === 'trade' || t.kind === 'transfer') && (!selected || t.accountId === selected)).toArray(), [fy, selected], []) ?? [];
  const counts = useLiveQuery(async () => {
    const m = new Map<string, number>();
    await getDb().transactions.filter((t) => t.status === 'active' && t.kind === 'trade').each((t) => t.accountId && m.set(t.accountId, (m.get(t.accountId) ?? 0) + 1));
    return m;
  }, [], new Map<string, number>());

  return (
    <div className="simple-page">
      <div className="page-head">
        <div>
          <h1>Add trades</h1>
          <div className="simple-sub">US stocks, Australian shares, crypto, futures, forex — from any broker, exchange or wallet.</div>
        </div>
      </div>

      <div className="panel">
        <h2>1. Where are the trades from?</h2>
        <div className="choice-cards">
          {accounts.map((a: Account) => (
            <button key={a.id} type="button" className="choice-card" aria-pressed={selected === a.id} style={selected === a.id ? { borderColor: 'var(--accent)', background: 'var(--accent-weak)' } : undefined} onClick={() => setSelected(selected === a.id ? '' : a.id)}>
              <b>{a.name}</b>
              <span>
                {ACCOUNT_TYPE_LABEL[a.type]} · {a.currency} · {counts?.get(a.id) ?? 0} trades
                {a.taxTreatment === 'unresolved' && <> · <span style={{ color: 'var(--warn)' }}>tax treatment not chosen</span></>}
              </span>
            </button>
          ))}
          <button type="button" className="choice-card" style={{ borderStyle: 'dashed' }} onClick={() => setAdding(true)}>
            <b>+ Add a broker, exchange or wallet</b>
            <span>Type any name — e.g. Stake, Interactive Brokers, Binance, Ledger</span>
          </button>
        </div>
      </div>

      <div className="panel">
        <h2>2. How do you want to add them?</h2>
        <div className="choice-cards">
          <button type="button" className="choice-card" onClick={() => setEditor({ kind: 'trade', side: 'buy', accountId: selected || undefined, currency: source?.currency })}>
            <b>Enter a trade by hand</b>
            <span>Buy, sell, swap, short, dividend reinvestment… one at a time.{source ? ` Goes into ${source.name}.` : ''}</span>
          </button>
          <button type="button" className="choice-card" onClick={() => nav(`/imports${selected ? `?account=${encodeURIComponent(selected)}` : ''}`)}>
            <b>Import a file</b>
            <span>Upload the CSV you downloaded{source ? ` from ${source.name}` : ''}. Duplicates are skipped automatically if you import the same file twice.</span>
          </button>
          <button type="button" className="choice-card" onClick={() => setEditor({ kind: 'transfer', side: 'send', accountId: selected || undefined })}>
            <b>Move between your accounts</b>
            <span>e.g. sending crypto from an exchange to your own wallet — not a sale.</span>
          </button>
        </div>
        <details style={{ marginTop: 10 }}>
          <summary className="muted">Where do I get the file?</summary>
          <ul>
            {SOURCE_HELP.map((h) => (
              <li key={h.title}>
                <b>{h.title}:</b> {h.text}
              </li>
            ))}
          </ul>
        </details>
      </div>

      <div className="panel tight">
        <div className="panel-head">
          <b>{source ? `Trades in ${source.name}` : 'All trades'} this year</b>
          <span className="muted">{trades.length} records</span>
        </div>
        <TxnTable id="add-trades" rows={trades} newDefaults={{ kind: 'trade', accountId: selected || undefined }} emptyText="No trades for this year yet." />
      </div>
      {adding && <AccountModal defaultType="us_broker" onClose={(a) => { setAdding(false); if (a) setSelected(a.id); }} />}
      {editor && <TxnEditor initial={editor} onClose={() => setEditor(null)} />}
    </div>
  );
}
