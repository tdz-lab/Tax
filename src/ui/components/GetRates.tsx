/**
 * "Get exchange rates" panel: lists the currencies that still have no AUD rate, fetches them (RBA for
 * currencies, CoinGecko for crypto) through the app's local server, previews what was found and imports it as a
 * normal, rollback-able rate import.
 */
import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { DateTime } from 'luxon';
import { fyLabel, fyOfLocalDate } from '../../lib/dates';
import { COINGECKO_FREE_DAYS, coingeckoWindow, fetchCoinGecko, fetchRba, filterToNeeds, importFetchedRates, rateNeeds, saveCoinGeckoId, type FetchedRate, type RateNeed } from '../../services/rateFetch';
import { useApp } from '../AppContext';

const KEY_STORE = 'coingeckoApiKey';
const readKey = () => {
  try {
    return localStorage.getItem(KEY_STORE) ?? '';
  } catch {
    return '';
  }
};
const writeKey = (v: string) => {
  try {
    if (v) localStorage.setItem(KEY_STORE, v);
    else localStorage.removeItem(KEY_STORE);
  } catch {
    /* storage unavailable — the key is then used for this visit only */
  }
};

interface Found {
  currency: string;
  source: 'RBA' | 'CoinGecko';
  rates: FetchedRate[];
  error?: string;
  note?: string;
}

const dmy = (d: string) => DateTime.fromISO(d).toFormat('d LLL yyyy');

export function GetRates() {
  const { run, toast, revision } = useApp();
  const needs = useLiveQuery(() => rateNeeds(), [revision]);
  const [key, setKey] = useState(readKey);
  const [ids, setIds] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<'fetch' | 'import' | null>(null);
  const [found, setFound] = useState<Found[] | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const idOf = (n: RateNeed) => ids[n.currency] ?? n.coingeckoId ?? '';
  const fetchAll = async (list: RateNeed[]) => {
    setBusy('fetch');
    setFound(null);
    setResult(null);
    const out: Found[] = [];
    const fiat = list.filter((n) => n.kind === 'fiat');
    if (fiat.length) {
      try {
        const all = filterToNeeds(await fetchRba(), fiat, (r) => r.quote);
        for (const n of fiat) {
          const rates = all.filter((r) => r.quote === n.currency);
          out.push({ currency: n.currency, source: 'RBA', rates, note: rates.length ? undefined : 'The RBA file has no rates for this currency and these dates.' });
        }
      } catch (e) {
        for (const n of fiat) out.push({ currency: n.currency, source: 'RBA', rates: [], error: e instanceof Error ? e.message : String(e) });
      }
    }
    const today = DateTime.now().toISODate()!;
    for (const n of list.filter((x) => x.kind === 'crypto')) {
      const id = idOf(n);
      if (!id) {
        out.push({ currency: n.currency, source: 'CoinGecko', rates: [], error: 'Enter the CoinGecko id for this coin first.' });
        continue;
      }
      const w = coingeckoWindow(n, today);
      if (!w) {
        out.push({ currency: n.currency, source: 'CoinGecko', rates: [], error: `All its dates are more than ${COINGECKO_FREE_DAYS} days ago — the free CoinGecko plan cannot supply them. Import a price CSV instead.` });
        continue;
      }
      try {
        const rates = await fetchCoinGecko(n.currency, id, w.from, w.to, key || undefined);
        out.push({ currency: n.currency, source: 'CoinGecko', rates, note: w.tooOldBefore ? `Dates before ${dmy(w.tooOldBefore)} are older than the free plan allows — import a price CSV for those.` : undefined });
      } catch (e) {
        out.push({ currency: n.currency, source: 'CoinGecko', rates: [], error: e instanceof Error ? e.message : String(e) });
      }
    }
    setFound(out);
    setBusy(null);
  };

  const importAll = async () => {
    if (!found) return;
    setBusy('import');
    const res = await run(async () => {
      let updated = 0;
      let stillMissing = 0;
      let added = 0;
      for (const src of ['RBA', 'CoinGecko'] as const) {
        const rates = found.filter((f) => f.source === src).flatMap((f) => f.rates);
        if (!rates.length) continue;
        const r = await importFetchedRates(src === 'RBA' ? 'RBA F11.1 exchange rates' : 'CoinGecko AUD prices', rates);
        updated = r.updated;
        stillMissing = r.stillMissing;
        added += r.batch.counts.created;
      }
      return { updated, stillMissing, added };
    });
    setBusy(null);
    if (!res) return;
    setFound(null);
    const msg = `${res.added} rate${res.added === 1 ? '' : 's'} added; ${res.updated} record${res.updated === 1 ? '' : 's'} now converted to AUD${res.stillMissing ? `; ${res.stillMissing} still missing a rate` : ''}.`;
    setResult(msg);
    toast(msg);
  };

  const total = found?.reduce((s, f) => s + f.rates.length, 0) ?? 0;
  const hasCrypto = !!needs?.some((n) => n.kind === 'crypto');
  return (
    <div className="panel" id="get-rates">
      <h2>Get exchange rates</h2>
      <p className="muted">
        Fetches the AUD rates your records are missing: currencies (e.g. USD) from the <b>Reserve Bank of Australia</b> daily table F11.1, crypto from <b>CoinGecko</b> AUD prices.
        Only the currency or coin and the dates are sent — never your records. You see what was found before anything is saved, and the import can be rolled back below.
      </p>
      {needs === undefined ? (
        <p className="muted">Checking your records…</p>
      ) : needs.length === 0 ? (
        <p>
          <span className="big-check" aria-hidden style={{ width: 22, height: 22, fontSize: 13, display: 'inline-flex', marginRight: 6 }}>
            ✓
          </span>
          Every record has an AUD rate.
        </p>
      ) : (
        <>
          <table className="pl-table" style={{ marginBottom: 10 }}>
            <tbody>
              <tr className="head">
                <td>Currency</td>
                <td>Records missing a rate</td>
                <td>Dates</td>
                <td>Where from</td>
              </tr>
              {needs.map((n) => (
                <tr key={n.currency}>
                  <td>
                    <b>{n.currency}</b>
                  </td>
                  <td>{n.count}</td>
                  <td>
                    {dmy(n.from)} – {dmy(n.to)} <span className="faint">({fyLabel(fyOfLocalDate(n.from))}{fyOfLocalDate(n.to) !== fyOfLocalDate(n.from) ? ` to ${fyLabel(fyOfLocalDate(n.to))}` : ''})</span>
                  </td>
                  <td>
                    {n.kind === 'fiat' ? (
                      'RBA'
                    ) : (
                      <label className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
                        <span className="muted">CoinGecko id</span>
                        <input
                          aria-label={`CoinGecko id for ${n.currency}`}
                          style={{ width: 150 }}
                          value={idOf(n)}
                          placeholder="e.g. bitcoin"
                          onChange={(e) => setIds({ ...ids, [n.currency]: e.target.value.trim().toLowerCase() })}
                          onBlur={(e) => void saveCoinGeckoId(n.currency, e.target.value)}
                        />
                      </label>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {hasCrypto && (
            <details style={{ marginBottom: 10 }}>
              <summary className="muted">CoinGecko key (free) and limits</summary>
              <div className="form-grid" style={{ marginTop: 6 }}>
                <div className="field span-2">
                  <label htmlFor="cg-key">CoinGecko Demo API key (optional, saved in this browser only)</label>
                  <input id="cg-key" value={key} autoComplete="off" onChange={(e) => setKey(e.target.value.trim())} onBlur={() => writeKey(key)} placeholder="CG-…" />
                  <span className="hint">
                    Create a free Demo account at coingecko.com (Developers → API) and paste the key here; without one CoinGecko may refuse or limit requests. The free plan only covers about the last {COINGECKO_FREE_DAYS} days — for older dates import a price CSV (e.g. from your exchange). The coin id is the last part of the coin’s CoinGecko page address, e.g. coingecko.com/en/coins/<b>bitcoin</b>.
                  </span>
                </div>
              </div>
            </details>
          )}
          <div className="row">
            <button className="primary" disabled={!!busy} onClick={() => fetchAll(needs)}>
              {busy === 'fetch' ? 'Fetching…' : 'Fetch rates'}
            </button>
            <span className="faint">Needs the app started with its start script (it fetches through the app’s local server).</span>
          </div>
        </>
      )}
      {found && (
        <div style={{ marginTop: 12 }}>
          <h3 style={{ margin: '0 0 6px' }}>What was found</h3>
          <ul className="todo">
            {found.map((f) => (
              <li key={`${f.source}-${f.currency}`}>
                <span className={`dot ${f.error ? 'bad' : f.rates.length ? 'ok' : 'warn'}`} />
                <span className="txt">
                  <b>
                    {f.currency} — {f.source}
                  </b>
                  <div className="muted" style={{ fontSize: 12 }}>
                    {f.error ?? (f.rates.length ? `${f.rates.length} daily rate${f.rates.length === 1 ? '' : 's'}, ${dmy(f.rates[0].date)} – ${dmy(f.rates[f.rates.length - 1].date)}` : 'Nothing found.')}
                    {f.note && <> {f.note}</>}
                  </div>
                </span>
              </li>
            ))}
          </ul>
          <div className="row" style={{ marginTop: 8 }}>
            <button className="primary" disabled={!!busy || total === 0} onClick={importAll}>
              {busy === 'import' ? 'Saving…' : `Save ${total} rate${total === 1 ? '' : 's'}`}
            </button>
            <button disabled={!!busy} onClick={() => setFound(null)}>
              Cancel
            </button>
          </div>
          <p className="faint" style={{ marginTop: 6 }}>
            Weekends and holidays have no RBA rate; the app then uses the nearest earlier rate (Settings → Currencies &amp; rates sets how many days back). Rates already saved for the same date and source are skipped.
          </p>
        </div>
      )}
      {result && <div className="notice">{result}</div>}
    </div>
  );
}
