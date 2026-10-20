/**
 * Get exchange rates. The RBA fixture below is written by hand in the layout the parser expects (description rows,
 * a "Series ID" row, then dd-MMM-yyyy rows of foreign units per A$1); it is not a copy of a live RBA file.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppDB } from '../../src/db/schema';
import { saveTransaction } from '../../src/services/ledger';
import { rollbackImport } from '../../src/import/commit';
import { COINGECKO_SOURCE, RBA_SOURCE, coingeckoWindow, filterToNeeds, importFetchedRates, parseCoinGecko, parseRbaF11, rateNeeds } from '../../src/services/rateFetch';
import { dropDb, freshDb } from './dbHelpers';

const RBA = [
  'F11.1 EXCHANGE RATES,,,',
  'Title,AUD/USD Exchange Rate,Trade-weighted Index May 1970 = 100,AUD/JPY Exchange Rate',
  'Description,AUD/USD,TWI,AUD/JPY',
  'Frequency,Daily,Daily,Daily',
  'Type,Indicative,Indicative,Indicative',
  'Units,USD,Index,JPY',
  ',,,',
  'Source,RBA,RBA,RBA',
  'Publication date,01-Jul-2025,01-Jul-2025,01-Jul-2025',
  'Series ID,FXRUSD,FXRTWI,FXRJY',
  '27-Sep-2024,0.6890,62.1,98.12',
  '30-Sep-2024,0.6920,62.3,98.40',
  '01-Oct-2024,0.6905,62.2,',
  '02-Oct-2024,CLOSED,CLOSED,CLOSED'
].join('\n');

describe('RBA F11.1 parser', () => {
  it('reads each currency column as foreign units per A$1 and skips the index and blanks', () => {
    const rates = parseRbaF11(RBA);
    expect(rates.filter((r) => r.quote === 'USD').map((r) => [r.date, r.rate])).toEqual([
      ['2024-09-27', '0.6890'],
      ['2024-09-30', '0.6920'],
      ['2024-10-01', '0.6905']
    ]);
    expect(rates.filter((r) => r.quote === 'JPY')).toHaveLength(2);
    expect(rates.some((r) => r.quote === 'TWI')).toBe(false);
    expect(rates.every((r) => r.base === 'AUD' && r.type === 'daily_reference' && r.source === RBA_SOURCE)).toBe(true);
  });
  it('refuses a file it does not recognise instead of guessing', () => {
    expect(() => parseRbaF11('date,rate\n2024-01-01,0.65')).toThrow(/not recognised/);
  });
});

describe('CoinGecko parser', () => {
  it('keeps the first AUD price of each UTC date', () => {
    const day = Date.UTC(2025, 8, 1);
    const rates = parseCoinGecko('btc', { prices: [[day, 160000.5], [day + 3600_000, 161000], [day + 86400_000, 158000], [day + 2 * 86400_000, 0]] });
    expect(rates.map((r) => [r.base, r.quote, r.date, r.rate])).toEqual([
      ['BTC', 'AUD', '2025-09-01', '160000.5'],
      ['BTC', 'AUD', '2025-09-02', '158000']
    ]);
    expect(rates[0].type).toBe('price');
    expect(rates[0].source).toBe(COINGECKO_SOURCE);
  });
  it('rejects an answer without prices', () => {
    expect(() => parseCoinGecko('BTC', { error: 'rate limited' })).toThrow(/unexpected/);
  });
  it('limits requests to the free plan window and says which dates are too old', () => {
    expect(coingeckoWindow({ from: '2025-01-10', to: '2026-03-01' }, '2026-10-20')).toEqual({ from: '2025-10-21', to: '2026-03-01', tooOldBefore: '2025-10-21' });
    expect(coingeckoWindow({ from: '2026-05-10', to: '2026-06-01' }, '2026-10-20')).toEqual({ from: '2026-05-07', to: '2026-06-01', tooOldBefore: undefined });
    expect(coingeckoWindow({ from: '2023-01-01', to: '2023-06-01' }, '2026-10-20')).toBeNull();
  });
});

describe('fetch → save → convert', () => {
  let db: AppDB;
  beforeEach(async () => {
    db = await freshDb();
  });
  afterEach(async () => dropDb(db));

  it('lists what is missing, imports the needed RBA rates as one batch and converts the records; rollback undoes it', async () => {
    const t = await saveTransaction({ kind: 'income', date: '2024-09-30', description: 'US affiliate payout', category: 'business', amount: '100', currency: 'USD' });
    expect(t.fx).toBeUndefined();
    const needs = await rateNeeds();
    expect(needs).toEqual([{ currency: 'USD', count: 1, from: '2024-09-30', to: '2024-09-30', kind: 'fiat', coingeckoId: undefined }]);
    const wanted = filterToNeeds(parseRbaF11(RBA), needs, (r) => r.quote);
    expect(wanted.map((r) => r.date)).toEqual(['2024-09-27', '2024-09-30']); // JPY not needed; nothing after the last record
    const res = await importFetchedRates('RBA F11.1 exchange rates', wanted);
    expect(res.batch.counts.created).toBe(2);
    expect(res.stillMissing).toBe(0);
    const after = (await db.transactions.get(t.id))!;
    expect(after.fx?.source).toBe(RBA_SOURCE);
    expect(after.fx?.audPerUnit.startsWith('1.445')).toBe(true); // 1 / 0.6920
    expect(await rateNeeds()).toEqual([]);
    // Fetching again adds nothing new.
    const again = await importFetchedRates('RBA F11.1 exchange rates', wanted);
    expect(again.batch.counts.created).toBe(0);
    expect(again.batch.counts.skipped).toBe(2);
    await rollbackImport(res.batch.id);
    expect(await db.rates.count()).toBe(0);
  });

  it('treats coins as crypto and suggests the CoinGecko id for common symbols', async () => {
    await saveTransaction({ kind: 'income', date: '2025-01-15', description: 'Staking reward', category: 'crypto_staking', amount: '0.01', currency: 'ETH' });
    const [n] = await rateNeeds();
    expect(n).toMatchObject({ currency: 'ETH', kind: 'crypto', coingeckoId: 'ethereum' });
  });
});
