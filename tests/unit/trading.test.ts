/**
 * Trading / lot engine fixtures. Expected values are computed by hand and stated in comments.
 */
import { describe, expect, it } from 'vitest';
import { D } from '../../src/lib/decimal';
import { runLotEngine } from '../../src/engines/trading/lots';
import { runDerivativeEngine } from '../../src/engines/trading/derivatives';
import { computePerformance, accountHoldings } from '../../src/engines/trading/performance';
import type { CorporateAction, Transaction } from '../../src/domain/types';
import { account, instrument, rate, txn, withFx } from './helpers';

const TZ = 'Australia/Sydney';
const shares = instrument({ id: 'S', symbol: 'DEMOA' });
const acc = account({ id: 'A' });
const run = (transactions: Transaction[], extra: { instruments?: any[]; accounts?: any[]; corporateActions?: CorporateAction[]; defaults?: any } = {}) =>
  runLotEngine(
    { transactions, accounts: extra.accounts ?? [acc], instruments: extra.instruments ?? [shares], corporateActions: extra.corporateActions ?? [] },
    { taxTz: TZ, costBasisDefaults: extra.defaults ?? {} }
  );
const buy = (date: string, qty: string, price: string, fee = '0', p: Partial<Transaction> = {}) => txn({ kind: 'trade', side: 'buy', date, accountId: 'A', instrumentId: 'S', quantity: qty, price, commission: fee, ...p });
const sell = (date: string, qty: string, price: string, fee = '0', p: Partial<Transaction> = {}) => txn({ kind: 'trade', side: 'sell', date, accountId: 'A', instrumentId: 'S', quantity: qty, price, commission: fee, ...p });

describe('lot engine — shares', () => {
  it('FIFO partial disposal across two parcels', () => {
    // Lot1 100 @ $10 + $10 = 1,010; Lot2 100 @ $12 + $10 = 1,210. Sell 150 @ $15 − $15 = 2,235.
    // Cost = 1,010 + 50/100 × 1,210 = 1,615 → gain 620. Remaining 50 units, cost 605.
    const r = run([buy('2024-08-01', '100', '10', '10'), buy('2024-09-01', '100', '12', '10'), sell('2024-10-01', '150', '15', '15')]);
    const d = r.disposals[0];
    expect(d.proceedsAud!.toFixed(2)).toBe('2235.00');
    expect(d.costAud!.toFixed(2)).toBe('1615.00');
    expect(d.gainAud!.toFixed(2)).toBe('620.00');
    expect(d.allocations).toHaveLength(2);
    const remaining = r.lots.filter((l) => l.qtyRemaining.gt(0));
    expect(remaining).toHaveLength(1);
    expect(remaining[0].qtyRemaining.toString()).toBe('50');
    expect(remaining[0].costAud!.toFixed(2)).toBe('605.00');
  });
  it('LIFO and HIFO select different parcels (no automatic "lowest tax" choice)', () => {
    const t = [buy('2024-08-01', '100', '10'), buy('2024-09-01', '100', '14'), buy('2024-09-15', '100', '12'), sell('2024-10-01', '100', '15')];
    expect(run(t, { defaults: { au_share: 'FIFO' } }).disposals[0].gainAud!.toString()).toBe('500');
    expect(run(t, { defaults: { au_share: 'LIFO' } }).disposals[0].gainAud!.toString()).toBe('300');
    expect(run(t, { defaults: { au_share: 'HIFO' } }).disposals[0].gainAud!.toString()).toBe('100');
  });
  it('specific identification uses the chosen lots', () => {
    const b1 = buy('2024-08-01', '100', '10');
    const b2 = buy('2024-09-01', '100', '14');
    const s = sell('2024-10-01', '60', '15', '0', { specificLots: [{ lotId: b2.id, quantity: '60' }] });
    const d = run([b1, b2, s]).disposals[0];
    expect(d.method).toBe('SPECIFIC');
    expect(d.allocations[0].lotId).toBe(b2.id);
    expect(d.gainAud!.toString()).toBe('60');
  });
  it('flags disposals with no acquisition (missing cost base) rather than assuming zero', () => {
    const r = run([sell('2024-10-01', '10', '15')]);
    expect(r.disposals[0].gainAud).toBeNull();
    expect(r.issues.some((i) => i.code === 'MISSING_COST_BASE')).toBe(true);
  });
  it('US shares: cost and proceeds converted at each date’s historical rate', () => {
    const us = instrument({ id: 'U', symbol: 'DEMOU', assetClass: 'us_share', currency: 'USD' });
    const rates = [rate('AUD', 'USD', '2024-08-01', '0.65'), rate('AUD', 'USD', '2024-12-02', '0.70')];
    const b = withFx(txn({ kind: 'trade', side: 'buy', date: '2024-08-01', accountId: 'A', instrumentId: 'U', quantity: '10', price: '100', commission: '1', currency: 'USD' }), rates);
    const s = withFx(txn({ kind: 'trade', side: 'sell', date: '2024-12-02', accountId: 'A', instrumentId: 'U', quantity: '10', price: '120', commission: '1', currency: 'USD' }), rates);
    const d = run([b, s], { instruments: [us] }).disposals[0];
    // cost 1,001 / 0.65 = 1,540.00; proceeds 1,199 / 0.70 = 1,712.857142857…; gain 172.857142857…
    expect(d.costAud!.toFixed(2)).toBe('1540.00');
    expect(d.proceedsAud!.toFixed(6)).toBe('1712.857143');
    expect(d.gainAud!.toFixed(2)).toBe('172.86');
    expect(d.costNative!.toString()).toBe('1001');
    expect(d.proceedsNative!.toString()).toBe('1199');
  });
  it('a missing exchange rate makes the result unknown, not zero', () => {
    const us = instrument({ id: 'U', symbol: 'DEMOU', assetClass: 'us_share', currency: 'USD' });
    const b = txn({ kind: 'trade', side: 'buy', date: '2024-08-01', accountId: 'A', instrumentId: 'U', quantity: '10', price: '100', currency: 'USD' });
    const s = txn({ kind: 'trade', side: 'sell', date: '2024-12-02', accountId: 'A', instrumentId: 'U', quantity: '10', price: '120', currency: 'USD' });
    const d = run([b, s], { instruments: [us] }).disposals[0];
    expect(d.gainAud).toBeNull();
    expect(d.flags.join(' ')).toMatch(/MISSING_RATE/);
  });
});

describe('corporate actions', () => {
  it('2-for-1 split doubles units and keeps total cost base', () => {
    const ca: CorporateAction = { id: 'ca1', instrumentId: 'S', type: 'split', date: '2024-09-01', ratioFrom: '1', ratioTo: '2', documentIds: [], createdAt: '', updatedAt: '' };
    const r = run([buy('2024-08-01', '100', '10'), sell('2024-10-01', '200', '6')], { corporateActions: [ca] });
    expect(r.disposals[0].costAud!.toString()).toBe('1000');
    expect(r.disposals[0].gainAud!.toString()).toBe('200');
  });
  it('return of capital reduces cost base; excess over cost base is a G1 gain', () => {
    const roc: CorporateAction = { id: 'ca2', instrumentId: 'S', type: 'return_of_capital', date: '2024-09-01', ratioFrom: '1', ratioTo: '1', cashPerUnit: '2', documentIds: [], createdAt: '', updatedAt: '' };
    const r = run([buy('2024-08-01', '100', '10'), sell('2024-10-01', '100', '10')], { corporateActions: [roc] });
    expect(r.disposals[0].costAud!.toString()).toBe('800');
    expect(r.disposals[0].gainAud!.toString()).toBe('200');
    const big: CorporateAction = { ...roc, id: 'ca3', cashPerUnit: '12' };
    const r2 = run([buy('2024-08-01', '100', '10')], { corporateActions: [big] });
    const g1 = r2.disposals.find((d) => d.kind === 'return_of_capital_excess')!;
    expect(g1.gainAud!.toString()).toBe('200');
  });
  it('scrip-for-scrip rollover moves lots to the new instrument with original acquisition date', () => {
    const newI = instrument({ id: 'N', symbol: 'NEWCO' });
    const ca: CorporateAction = { id: 'ca4', instrumentId: 'S', type: 'merger_rollover', date: '2024-09-01', ratioFrom: '2', ratioTo: '1', newInstrumentId: 'N', documentIds: [], createdAt: '', updatedAt: '' };
    const s = txn({ kind: 'trade', side: 'sell', date: '2025-09-02', accountId: 'A', instrumentId: 'N', quantity: '50', price: '30' });
    const r = run([buy('2024-08-01', '100', '10'), s], { instruments: [shares, newI], corporateActions: [ca] });
    expect(r.disposals[0].costAud!.toString()).toBe('1000');
    expect(r.disposals[0].allocations[0].acquiredDate).toBe('2024-08-01');
    expect(r.disposals[0].discountEligible).toBe(true);
    expect(r.issues.some((i) => i.code === 'REVIEW_CORP_ACTION')).toBe(true);
  });
});

describe('crypto', () => {
  const btc = instrument({ id: 'BTC', symbol: 'BTC', assetClass: 'crypto', currency: 'AUD' });
  const eth = instrument({ id: 'ETH', symbol: 'ETH', assetClass: 'crypto', currency: 'AUD' });
  const usdt = instrument({ id: 'USDT', symbol: 'USDT', assetClass: 'stablecoin', currency: 'USD' });
  const ex = account({ id: 'X', type: 'crypto_exchange' });
  const cfg = { instruments: [btc, eth, usdt], accounts: [ex] };
  it('crypto-to-crypto swap is a disposal at market value and an acquisition at the same value', () => {
    const b = txn({ kind: 'trade', side: 'buy', date: '2024-08-01', accountId: 'X', instrumentId: 'BTC', quantity: '1', price: '50000' });
    const sw = txn({ kind: 'trade', side: 'swap', date: '2024-09-01', accountId: 'X', instrumentId: 'BTC', quantity: '0.5', counterInstrumentId: 'ETH', counterQuantity: '10', valuationAud: '30000' });
    const s = txn({ kind: 'trade', side: 'sell', date: '2024-10-01', accountId: 'X', instrumentId: 'ETH', quantity: '10', price: '3200' });
    const r = run([b, sw, s], cfg);
    expect(r.disposals[0].gainAud!.toString()).toBe('5000'); // 30,000 − 25,000
    expect(r.disposals[1].costAud!.toString()).toBe('30000');
    expect(r.disposals[1].gainAud!.toString()).toBe('2000');
  });
  it('buying with a stablecoin disposes of the stablecoin (no 1:1 USD assumption)', () => {
    const rates = [rate('USDT', 'AUD', '2024-08-01', '1.5'), rate('USDT', 'AUD', '2024-07-01', '1.48')];
    const getUsdt = withFx(txn({ kind: 'trade', side: 'buy', date: '2024-07-01', accountId: 'X', instrumentId: 'USDT', quantity: '1000', price: '1.48', currency: 'AUD' }), rates);
    const b = withFx(txn({ kind: 'trade', side: 'buy', date: '2024-08-01', accountId: 'X', instrumentId: 'BTC', quantity: '0.01', price: '60000', currency: 'USDT' }), rates);
    const r = run([getUsdt, b], cfg);
    const out = r.disposals.find((d) => d.kind === 'quote_asset')!;
    expect(out.quantity.toString()).toBe('600');
    expect(out.proceedsAud!.toString()).toBe('900'); // 600 USDT × 1.5
    expect(out.costAud!.toString()).toBe('888'); // 600 × 1.48
    const btcLot = r.lots.find((l) => l.instrumentId === 'BTC')!;
    expect(btcLot.costAud!.toString()).toBe('900');
  });
  it('staking rewards create a lot at the income value; forks have nil cost base', () => {
    const inc = txn({ kind: 'income', side: 'income', category: 'crypto_staking', date: '2024-08-01', accountId: 'X', instrumentId: 'ETH', quantity: '0.1', amount: '400' });
    const fork = txn({ kind: 'income', side: 'income', category: 'crypto_fork', date: '2024-08-02', accountId: 'X', instrumentId: 'BTC', quantity: '1', amount: '0' });
    const r = run([inc, fork], cfg);
    expect(r.lots.find((l) => l.instrumentId === 'ETH')!.costAud!.toString()).toBe('400');
    expect(r.lots.find((l) => l.instrumentId === 'BTC')!.costAud!.toString()).toBe('0');
  });
  it('own-wallet transfers are not disposals; unmatched transfers are flagged', () => {
    const w = account({ id: 'W', type: 'crypto_wallet' });
    const b = txn({ kind: 'trade', side: 'buy', date: '2024-08-01', accountId: 'X', instrumentId: 'BTC', quantity: '1', price: '50000' });
    const send = txn({ kind: 'trade', side: 'send', date: '2024-08-05', accountId: 'X', instrumentId: 'BTC', quantity: '1', isOwnTransfer: true, feeQuantity: '0.0001', valuationAud: '5' });
    const recv = txn({ kind: 'trade', side: 'receive', date: '2024-08-05', accountId: 'W', instrumentId: 'BTC', quantity: '0.9999', isOwnTransfer: true });
    const r = run([b, send, recv], { ...cfg, accounts: [ex, w] });
    expect(r.disposals).toHaveLength(1); // only the network fee
    expect(r.disposals[0].kind).toBe('fee_disposal');
    expect(r.disposals[0].quantity.toString()).toBe('0.0001');
    const unm = run([b, { ...send, isOwnTransfer: undefined, id: 'sx' }], cfg);
    expect(unm.disposals).toHaveLength(0);
    expect(unm.issues.some((i) => i.code === 'UNMATCHED_TRANSFER')).toBe(true);
  });
  it('spam tokens are excluded', () => {
    const spam = instrument({ id: 'SP', symbol: 'SPAM', assetClass: 'crypto', isSpam: true });
    const r = run([txn({ kind: 'trade', side: 'receive', date: '2024-08-01', accountId: 'X', instrumentId: 'SP', quantity: '1000000' })], { ...cfg, instruments: [spam] });
    expect(r.spamTxnIds).toHaveLength(1);
  });
});

describe('derivatives and prop firms', () => {
  it('futures: P&L = Δprice × qty × multiplier, converted at the closing rate; fees at their own rates', () => {
    const es = instrument({ id: 'ES', symbol: 'DEMOES', assetClass: 'future', currency: 'USD', multiplier: '50' });
    const fa = account({ id: 'F', type: 'futures', taxTreatment: 'business_trader' });
    const rates = [rate('AUD', 'USD', '2025-02-11', '0.63'), rate('AUD', 'USD', '2025-02-12', '0.631')];
    const o = withFx(txn({ kind: 'trade', side: 'buy', date: '2025-02-11', accountId: 'F', instrumentId: 'ES', quantity: '2', price: '5000', commission: '4.5', exchangeFees: '2.4', currency: 'USD' }), rates);
    const c = withFx(txn({ kind: 'trade', side: 'sell', date: '2025-02-12', accountId: 'F', instrumentId: 'ES', quantity: '2', price: '5012.5', commission: '4.5', exchangeFees: '2.4', currency: 'USD' }), rates);
    const r = runDerivativeEngine({ transactions: [o, c], accounts: [fa], instruments: [es], corporateActions: [] });
    const e = r.realised[0];
    expect(e.pnlNative.toString()).toBe('1250'); // 12.5 × 2 × 50
    expect(e.feesNative.toString()).toBe('13.8');
    expect(e.pnlAud!.toFixed(2)).toBe('1980.98'); // 1,250 / 0.631
    expect(e.feesAud!.toFixed(4)).toBe(D('6.9').div('0.63').plus(D('6.9').div('0.631')).toFixed(4));
    expect(e.taxClass).toBe('REVENUE_TRADING');
    expect(r.open).toHaveLength(0);
  });
  it('CFD short position, financing and capital-account review flag', () => {
    const cfd = instrument({ id: 'C', symbol: 'DEMOIDX', assetClass: 'cfd' });
    const ca = account({ id: 'K', type: 'cfd', taxTreatment: 'investor_cgt' });
    const o = txn({ kind: 'trade', side: 'sell', date: '2025-03-12', accountId: 'K', instrumentId: 'C', quantity: '10', price: '7800', commission: '5' });
    const fin = txn({ kind: 'trade', side: 'financing', date: '2025-03-13', accountId: 'K', instrumentId: 'C', amount: '-6.40' });
    const c = txn({ kind: 'trade', side: 'buy', date: '2025-03-14', accountId: 'K', instrumentId: 'C', quantity: '10', price: '7765', commission: '5' });
    const r = runDerivativeEngine({ transactions: [o, fin, c], accounts: [ca], instruments: [cfd], corporateActions: [] });
    const closed = r.realised.find((x) => x.kind === 'closed_position')!;
    expect(closed.direction).toBe('short');
    expect(closed.pnlNative.toString()).toBe('350'); // (7,800 − 7,765) × 10
    expect(closed.netAud!.toString()).toBe('340');
    expect(closed.taxClass).toBe('REVIEW');
    const f = r.realised.find((x) => x.kind === 'financing')!;
    expect(f.pnlAud!.toString()).toBe('-6.4');
    expect(f.taxClass).toBe('FINANCING_EXPENSE');
  });
  it('options: bought call that expires is a capital loss of the premium', () => {
    const opt = instrument({ id: 'O', symbol: 'DEMOU-C200', assetClass: 'option', multiplier: '100', optionType: 'call' });
    const b = txn({ kind: 'trade', side: 'buy', date: '2024-10-01', accountId: 'A', instrumentId: 'O', quantity: '2', price: '5', commission: '1.30' });
    const e = txn({ kind: 'trade', side: 'expire', date: '2024-12-20', accountId: 'A', instrumentId: 'O', quantity: '2', price: '0' });
    const d = run([b, e], { instruments: [opt] }).disposals[0];
    expect(d.kind).toBe('expiry');
    expect(d.gainAud!.toFixed(2)).toBe('-1001.30');
  });
  it('options: exercised call adds the premium to the underlying cost base', () => {
    const opt = instrument({ id: 'O', symbol: 'DEMOA-C10', assetClass: 'option', multiplier: '100', optionType: 'call' });
    const b = txn({ kind: 'trade', side: 'buy', date: '2024-08-01', accountId: 'A', instrumentId: 'O', quantity: '1', price: '0.5' });
    const under = buy('2024-09-01', '100', '10');
    const ex = txn({ kind: 'trade', side: 'exercise', date: '2024-09-01', accountId: 'A', instrumentId: 'O', quantity: '1', relatedIds: [under.id] });
    const r = run([b, ex, under], { instruments: [opt, shares] });
    expect(r.lots.find((l) => l.instrumentId === 'S')!.costAud!.toString()).toBe('1050');
    expect(r.disposals).toHaveLength(0);
  });
  it('written option premium on capital account is a CGT event D2 gain (flagged)', () => {
    const opt = instrument({ id: 'O', symbol: 'DEMOA-C12', assetClass: 'option', multiplier: '100', optionType: 'call' });
    const w = txn({ kind: 'trade', side: 'short', date: '2024-08-01', accountId: 'A', instrumentId: 'O', quantity: '1', price: '0.4' });
    const r = runDerivativeEngine({ transactions: [w], accounts: [acc], instruments: [opt], corporateActions: [] });
    expect(r.realised[0].kind).toBe('written_option_premium');
    expect(r.realised[0].netAud!.toString()).toBe('40');
    expect(r.realised[0].taxClass).toBe('CGT_EVENT');
  });
  it('prop-firm evaluation (simulated) trades are excluded from tax but appear in performance', () => {
    const es = instrument({ id: 'ES', symbol: 'DEMOES', assetClass: 'future', multiplier: '50' });
    const ev = account({ id: 'P', type: 'prop_evaluation', propStatus: 'evaluation', taxTreatment: 'business_trader' });
    const o = txn({ kind: 'trade', side: 'buy', date: '2025-02-11', accountId: 'P', instrumentId: 'ES', quantity: '1', price: '5000' });
    const c = txn({ kind: 'trade', side: 'sell', date: '2025-02-11', time: '11:00:00', accountId: 'P', instrumentId: 'ES', quantity: '1', price: '5010' });
    const data = { transactions: [o, c], accounts: [ev], instruments: [es], corporateActions: [] };
    const r = runDerivativeEngine(data);
    expect(r.realised[0].taxClass).toBe('SIMULATED');
    const perf = computePerformance(data, TZ);
    expect(perf.totalRealisedAud!.toString()).toBe('500');
  });
});

describe('holdings', () => {
  it('per-account holdings from flows', () => {
    const h = accountHoldings([buy('2024-08-01', '100', '10'), sell('2024-09-01', '40', '11')]);
    expect(h.get('A')!.get('S')!.toString()).toBe('60');
  });
});
