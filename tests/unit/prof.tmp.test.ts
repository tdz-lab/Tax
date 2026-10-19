import { it } from 'vitest';
import { runLotEngine } from '../../src/engines/trading/lots';
import { runDerivativeEngine } from '../../src/engines/trading/derivatives';
import { sortTxns } from '../../src/engines/ledger';
import { heldAtLeast12Months, daysBetween } from '../../src/lib/dates';
import { D } from '../../src/lib/decimal';
import { account, instrument } from './helpers';
import type { Transaction } from '../../src/domain/types';
it('prof', () => {
  const out: Transaction[] = [];
  const base = Date.parse('2023-07-01T00:00:00Z');
  for (let i = 0; i < 100000; i++) {
    const at = new Date(base + i * 600000).toISOString();
    out.push({ id: `t${i}`, kind: 'trade', status: 'active', date: at.slice(0, 10), timeZone: 'UTC', occurredAt: at, fy: 2024, category: 'trading', taxClass: 'CGT_EVENT', taxClassSource: 'user', description: '', tags: [], currency: 'AUD', amount: '0', accountId: i % 7 === 0 ? 'F' : 'A', instrumentId: i % 7 === 0 ? 'FUT' : `I${i % 50}`, side: i >= 1000 && i % 3 === 2 ? 'sell' : 'buy', quantity: '1', price: String(100 + (i % 17)), commission: '1', documentIds: [], relatedIds: [], reconStatus: 'unreconciled', reviewFlags: [], source: 'import', createdAt: at, updatedAt: at, version: 1 } as Transaction);
  }
  const instruments = [...Array.from({ length: 50 }, (_, i) => instrument({ id: `I${i}`, symbol: `S${i}` })), instrument({ id: 'FUT', symbol: 'FUT', assetClass: 'future', multiplier: '50' })];
  const data = { transactions: out, accounts: [account({ id: 'A' }), account({ id: 'F', type: 'futures', taxTreatment: 'business_trader' })], instruments, corporateActions: [] };
  let t = performance.now();
  sortTxns(out); console.log('sort', performance.now() - t); t = performance.now();
  for (let i = 0; i < 30000; i++) heldAtLeast12Months('2023-07-01', '2024-07-02'); console.log('held x30k', performance.now() - t); t = performance.now();
  for (let i = 0; i < 30000; i++) daysBetween('2023-07-01', '2024-07-02'); console.log('days x30k', performance.now() - t); t = performance.now();
  for (let i = 0; i < 300000; i++) D('123.45').times('1.5').plus('2'); console.log('decimal x300k', performance.now() - t); t = performance.now();
  runLotEngine(data, { taxTz: 'Australia/Sydney', costBasisDefaults: {} }); console.log('lots', performance.now() - t); t = performance.now();
  runDerivativeEngine(data); console.log('deriv', performance.now() - t);
}, 120000);
