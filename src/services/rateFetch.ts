/**
 * "Get exchange rates": works out which currencies and dates still have no AUD rate, fetches them through the
 * local server (RBA F11.1 daily rates for currencies, CoinGecko AUD prices for crypto) and imports them through
 * the normal rate-import pipeline, so every fetched rate keeps its source, can be previewed and rolled back.
 * Nothing is guessed: a date the source has no figure for stays "missing".
 */
import Papa from 'papaparse';
import { DateTime } from 'luxon';
import { getDb } from '../db/schema';
import { FIAT_CURRENCIES } from '../domain/reference';
import type { ImportBatch, RateRecord } from '../domain/types';
import { addDays } from '../lib/dates';
import { commitImport } from '../import/commit';
import type { PreparedRow } from '../import/transform';
import { refreshAllConversions } from './ledger';
import { getSetting, setSetting } from './settings';

export const RBA_SOURCE = 'RBA F11.1 (daily, 4pm AEST)';
export const COINGECKO_SOURCE = 'CoinGecko (AUD, daily)';

/** CoinGecko coin ids for common symbols. Anything else can be entered by the user (the id is in the coin page URL). */
export const COINGECKO_IDS: Record<string, string> = {
  BTC: 'bitcoin',
  ETH: 'ethereum',
  USDT: 'tether',
  USDC: 'usd-coin',
  BNB: 'binancecoin',
  SOL: 'solana',
  XRP: 'ripple',
  ADA: 'cardano',
  DOGE: 'dogecoin',
  TRX: 'tron',
  DOT: 'polkadot',
  LTC: 'litecoin',
  LINK: 'chainlink',
  AVAX: 'avalanche-2',
  MATIC: 'matic-network',
  XLM: 'stellar',
  DAI: 'dai',
  SHIB: 'shiba-inu',
  ATOM: 'cosmos',
  BCH: 'bitcoin-cash'
};

const FIAT = new Set(FIAT_CURRENCIES.map((c) => c.code));

export interface RateNeed {
  currency: string;
  /** Number of records (amounts or fees) without an AUD rate. */
  count: number;
  from: string;
  to: string;
  kind: 'fiat' | 'crypto';
  coingeckoId?: string;
}

/** Currencies and date ranges that still have no AUD rate (active records only). */
export async function rateNeeds(): Promise<RateNeed[]> {
  const ids = { ...COINGECKO_IDS, ...(await getSetting<Record<string, string>>('coingeckoIds', {})) };
  const m = new Map<string, RateNeed>();
  const add = (cur: string, date: string) => {
    const c = cur.toUpperCase();
    if (!c || c === 'AUD') return;
    const e = m.get(c) ?? { currency: c, count: 0, from: date, to: date, kind: FIAT.has(c) ? 'fiat' : 'crypto', coingeckoId: FIAT.has(c) ? undefined : ids[c] };
    e.count++;
    if (date < e.from) e.from = date;
    if (date > e.to) e.to = date;
    m.set(c, e);
  };
  await getDb()
    .transactions.where('status')
    .equals('active')
    .each((t) => {
      if (t.currency.toUpperCase() !== 'AUD' && !t.fx) add(t.currency, t.date);
      if (t.feeCurrency && t.feeCurrency !== t.currency && t.feeCurrency.toUpperCase() !== 'AUD' && !t.feeFx) add(t.feeCurrency, t.date);
    });
  return [...m.values()].sort((a, b) => b.count - a.count || a.currency.localeCompare(b.currency));
}

export async function saveCoinGeckoId(symbol: string, id: string): Promise<void> {
  const cur = await getSetting<Record<string, string>>('coingeckoIds', {});
  const next = { ...cur };
  if (id.trim()) next[symbol.toUpperCase()] = id.trim().toLowerCase();
  else delete next[symbol.toUpperCase()];
  await setSetting('coingeckoIds', next);
}

export type FetchedRate = Omit<RateRecord, 'id' | 'createdAt'>;

/**
 * Reads the RBA F11.1 CSV: a few description rows ("Title", "Units", "Series ID"…) and then one row per day,
 * e.g. `02-Jan-2025,0.6211,…`, each figure being units of foreign currency per A$1. The currency of each column
 * is taken from its title ("AUD/USD …"), else its units, else its series id ("FXRUSD"). Columns that are not a
 * currency (e.g. the trade-weighted index) are skipped. Throws if the layout is not recognised.
 */
export function parseRbaF11(text: string): FetchedRate[] {
  const rows = Papa.parse<string[]>(text.replace(/^\uFEFF/, ''), { skipEmptyLines: false }).data;
  const first = (r: string[] | undefined) => (r?.[0] ?? '').trim().toLowerCase();
  const find = (name: string) => rows.find((r) => first(r) === name);
  const seriesIdx = rows.findIndex((r) => first(r) === 'series id');
  if (seriesIdx < 0) throw new Error('The RBA file layout was not recognised (no “Series ID” row). Download the file yourself and use Import a file instead.');
  const title = find('title');
  const units = find('units');
  const series = rows[seriesIdx];
  const currencyOf = (col: number): string | null => {
    const t = /AUD\s*\/\s*([A-Z]{3})\b/.exec(title?.[col] ?? '');
    if (t) return t[1];
    const u = (units?.[col] ?? '').trim();
    if (/^[A-Z]{3}$/.test(u) && u !== 'AUD') return u;
    const s = /^FXR([A-Z]{3})$/.exec((series[col] ?? '').trim());
    return s && FIAT.has(s[1]) ? s[1] : null; // e.g. FXRTWI is the trade-weighted index, not a currency
  };
  const cols: { col: number; cur: string }[] = [];
  for (let c = 1; c < series.length; c++) {
    const cur = currencyOf(c);
    if (cur) cols.push({ col: c, cur });
  }
  if (!cols.length) throw new Error('No currency columns were found in the RBA file.');
  const out: FetchedRate[] = [];
  for (const r of rows.slice(seriesIdx + 1)) {
    const raw = (r[0] ?? '').trim();
    if (!raw) continue;
    const d = DateTime.fromFormat(raw, 'dd-MMM-yyyy', { locale: 'en' });
    const date = d.isValid ? d.toISODate() : /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
    if (!date) continue;
    for (const { col, cur } of cols) {
      const v = (r[col] ?? '').trim().replace(/,/g, '');
      if (!/^\d+(\.\d+)?$/.test(v) || Number(v) <= 0) continue; // skips blanks and notes such as “CLOSED”
      out.push({ base: 'AUD', quote: cur, rate: v, date, type: 'daily_reference', source: RBA_SOURCE, notes: 'Units of foreign currency per A$1, as published by the Reserve Bank of Australia (table F11.1).' });
    }
  }
  if (!out.length) throw new Error('The RBA file contained no daily rates.');
  return out;
}

/**
 * Reads a CoinGecko `market_chart/range` answer (`{ prices: [[ms, price], …] }`, AUD). One rate per UTC date —
 * the first price of that date (CoinGecko's daily points are at 00:00 UTC; for short ranges the data is hourly
 * and the first hour of the date is used).
 */
export function parseCoinGecko(symbol: string, json: unknown): FetchedRate[] {
  const prices = (json as { prices?: unknown })?.prices;
  if (!Array.isArray(prices)) throw new Error('CoinGecko returned an unexpected answer (no price list).');
  const byDate = new Map<string, string>();
  for (const p of prices) {
    if (!Array.isArray(p) || typeof p[0] !== 'number' || typeof p[1] !== 'number' || !(p[1] > 0)) continue;
    const date = new Date(p[0]).toISOString().slice(0, 10);
    if (!byDate.has(date)) byDate.set(date, String(p[1]));
  }
  return [...byDate].map(([date, rate]) => ({ base: symbol.toUpperCase(), quote: 'AUD', rate, date, type: 'price' as const, source: COINGECKO_SOURCE, notes: 'AUD price at about 00:00 UTC on this date (CoinGecko market_chart/range).' }));
}

/** CoinGecko's free (Demo) plan only serves about the last 365 days. */
export const COINGECKO_FREE_DAYS = 365;

export function coingeckoWindow(need: Pick<RateNeed, 'from' | 'to'>, today: string): { from: string; to: string; tooOldBefore?: string } | null {
  const earliest = addDays(today, -(COINGECKO_FREE_DAYS - 1));
  const from = addDays(need.from, -3) < earliest ? earliest : addDays(need.from, -3);
  const to = need.to > today ? today : need.to;
  if (from > to) return null;
  return { from, to, tooOldBefore: need.from < earliest ? earliest : undefined };
}

async function getText(path: string, headers: Record<string, string> = {}): Promise<string> {
  let r: Response;
  try {
    r = await fetch(path, { headers, cache: 'no-store' });
  } catch {
    throw new Error('The app’s local server did not answer. Start the app with the start script (start-linux.sh, start-windows.bat or start-mac.command) to fetch rates.');
  }
  const text = await r.text();
  if (r.status === 404) throw new Error('Fetching rates needs the app’s local server — start the app with the start script, then try again.');
  if (!r.ok) throw new Error(text || `Request failed (${r.status}).`);
  return text;
}

export async function fetchRba(): Promise<FetchedRate[]> {
  return parseRbaF11(await getText('./__rates/rba-f11'));
}

export async function fetchCoinGecko(symbol: string, id: string, from: string, to: string, apiKey?: string): Promise<FetchedRate[]> {
  const unix = (d: string, end = false) => Math.floor(DateTime.fromISO(d, { zone: 'utc' }).plus({ days: end ? 1 : 0 }).toSeconds());
  let text: string;
  try {
    text = await getText(`./__rates/coingecko?id=${encodeURIComponent(id)}&from=${unix(from)}&to=${unix(to, true)}`, apiKey ? { 'x-coingecko-key': apiKey } : {});
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/answered 40[13]\b/.test(msg)) throw new Error(`CoinGecko refused the request — it needs a valid free Demo key (open “CoinGecko key (free) and limits”). ${msg}`);
    if (/answered 429\b/.test(msg)) throw new Error('CoinGecko’s request limit was reached — wait a minute and try again.');
    if (/answered 404\b/.test(msg)) throw new Error(`CoinGecko does not know the coin id “${id}” — check it on the coin’s CoinGecko page.`);
    throw e;
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error('CoinGecko returned something that is not price data.');
  }
  return parseCoinGecko(symbol, json);
}

/** Keeps only the rates needed: the requested currencies, from a week before the first record to the last. */
export function filterToNeeds(rates: FetchedRate[], needs: RateNeed[], pick: (r: FetchedRate) => string): FetchedRate[] {
  const by = new Map(needs.map((n) => [n.currency, n]));
  return rates.filter((r) => {
    const n = by.get(pick(r));
    return !!n && r.date >= addDays(n.from, -7) && r.date <= n.to;
  });
}

/** Imports fetched rates as one rollback-able import batch, then re-converts every record. */
export async function importFetchedRates(label: string, rates: FetchedRate[]): Promise<{ batch: ImportBatch; updated: number; stillMissing: number }> {
  const now = DateTime.now().toFormat('yyyy-LL-dd HH:mm');
  const rows: PreparedRow[] = rates.map((rate, i) => ({
    rowNumber: i + 1,
    raw: { base: rate.base, quote: rate.quote, date: rate.date, rate: rate.rate, source: rate.source },
    refs: {},
    rate,
    errors: [],
    warnings: [],
    dupStatus: 'new',
    action: 'create'
  }));
  const batch = await commitImport({
    filename: `${label} — fetched ${now}`,
    fileText: JSON.stringify(rates),
    target: 'rates',
    template: { target: 'rates', dateFormat: 'yyyy-MM-dd', timeZone: 'UTC', decimalSeparator: '.', mapping: {}, constants: {}, description: `Fetched by Get exchange rates (${label})` },
    rows
  });
  const { updated, stillMissing } = await refreshAllConversions(`Exchange rates fetched (${label})`);
  return { batch, updated, stillMissing };
}
