/** Large-dataset performance: 100,000 transactions through the lot, derivative and tax engines. */
import { describe, expect, it } from 'vitest';
import { runLotEngine } from '../../src/engines/trading/lots';
import { runDerivativeEngine } from '../../src/engines/trading/derivatives';
import { computeTaxYear } from '../../src/engines/tax/taxEngine';
import { builtinCategories } from '../../src/domain/reference';
import type { Transaction } from '../../src/domain/types';
import { account, instrument, profile } from './helpers';

function bigLedger(n: number): Transaction[] {
  const out: Transaction[] = [];
  const base = Date.parse('2023-07-01T00:00:00Z');
  for (let i = 0; i < n; i++) {
    const at = new Date(base + i * 60_000 * 10).toISOString();
    const date = at.slice(0, 10);
    const fy = Number(date.slice(5, 7)) >= 7 ? Number(date.slice(0, 4)) + 1 : Number(date.slice(0, 4));
    const inst = `I${i % 50}`;
    const side = i >= 1000 && i % 3 === 2 ? 'sell' : 'buy';
    out.push({
      id: `t${i}`, kind: i % 10 === 9 ? 'expense' : 'trade', status: 'active', date, timeZone: 'UTC', occurredAt: at, fy,
      category: i % 10 === 9 ? 'software' : 'trading', taxClass: i % 10 === 9 ? 'DEDUCTIBLE_EXPENSE' : 'CGT_EVENT', taxClassSource: 'user', description: '', tags: [],
      currency: 'AUD', amount: i % 10 === 9 ? '10' : '0', accountId: i % 7 === 0 ? 'F' : 'A', instrumentId: i % 7 === 0 ? 'FUT' : inst, side: i % 10 === 9 ? undefined : side,
      quantity: '1', price: String(100 + (i % 17)), commission: '1', documentIds: [], relatedIds: [], reconStatus: 'unreconciled', reviewFlags: [], source: 'import',
      createdAt: at, updatedAt: at, version: 1
    } as Transaction);
  }
  return out;
}

describe('performance with large histories', () => {
  it('processes 100,000 transactions in reasonable time', () => {
    const txns = bigLedger(100_000);
    const instruments = [...Array.from({ length: 50 }, (_, i) => instrument({ id: `I${i}`, symbol: `S${i}` })), instrument({ id: 'FUT', symbol: 'FUT', assetClass: 'future', multiplier: '50' })];
    const data = { transactions: txns, accounts: [account({ id: 'A' }), account({ id: 'F', type: 'futures', taxTreatment: 'business_trader' })], instruments, corporateActions: [] };
    const t0 = performance.now();
    const lots = runLotEngine(data, { taxTz: 'Australia/Sydney', costBasisDefaults: {} });
    const deriv = runDerivativeEngine(data);
    const t1 = performance.now();
    const r = computeTaxYear({ data, fy: 2024, taxProfiles: [profile(2024)], assets: [], categories: builtinCategories(), taxTz: 'Australia/Sydney', costBasisDefaults: {}, lossOrdering: 'non_discount_first', lotRun: lots, derivRun: deriv });
    const t2 = performance.now();
    console.info(`100k: engines ${(t1 - t0).toFixed(0)} ms, tax year ${(t2 - t1).toFixed(0)} ms, disposals ${lots.disposals.length}`);
    expect(lots.disposals.length).toBeGreaterThan(20_000);
    expect(r.capital.incomplete).toBe(false);
    expect(t1 - t0).toBeLessThan(60_000);
    expect(t2 - t1).toBeLessThan(30_000);
  }, 120_000);
});
