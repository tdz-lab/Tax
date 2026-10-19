import { describe, expect, it } from 'vitest';
import { RateIndex, resolveAudConversion, manualConversion, toAud, DEFAULT_METHODOLOGY, validateRate } from '../../src/engines/currency/rates';
import { rate } from './helpers';

const M = DEFAULT_METHODOLOGY;

describe('historical currency conversion', () => {
  const idx = new RateIndex([
    rate('AUD', 'USD', '2025-03-03', '0.6250'), // RBA-style direction: USD per 1 AUD
    rate('EUR', 'AUD', '2025-03-03', '1.6800'), // direct AUD per EUR
    rate('JPY', 'USD', '2025-03-03', '0.0066'),
    rate('USDT', 'USD', '2025-03-03', '0.9990', { type: 'price', source: 'Exchange close' }),
    rate('AUD', 'USD', '2025-02-28', '0.6200') // Friday before a weekend
  ]);

  it('inverts an AUD-base quote into AUD per unit', () => {
    const r = resolveAudConversion({ currency: 'USD', date: '2025-03-03', methodology: M }, idx);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.conversion.audPerUnit).toBe('1.6');
    expect(r.conversion.sourceRate).toBe('0.6250');
    expect(r.conversion.sourceDirection).toBe('USD per 1 AUD');
    expect(toAud('100', r.conversion)!.toString()).toBe('160');
  });
  it('uses a direct quote without inversion', () => {
    const r = resolveAudConversion({ currency: 'EUR', date: '2025-03-03', methodology: M }, idx);
    expect(r.ok && r.conversion.audPerUnit).toBe('1.68');
  });
  it('triangulates via USD when allowed and records both rate ids', () => {
    const r = resolveAudConversion({ currency: 'JPY', date: '2025-03-03', methodology: M }, idx);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.conversion.rateType).toBe('cross');
    expect(r.conversion.audPerUnit).toBe('0.01056'); // 0.0066 × 1.6
    expect(r.conversion.rateRecordIds).toHaveLength(2);
    const off = resolveAudConversion({ currency: 'JPY', date: '2025-03-03', methodology: { ...M, allowCrossViaUSD: false } }, idx);
    expect(off.ok).toBe(false);
  });
  it('never assumes a stablecoin equals one US dollar', () => {
    const r = resolveAudConversion({ currency: 'USDT', date: '2025-03-03', methodology: M }, idx);
    expect(r.ok && r.conversion.audPerUnit).toBe('1.5984'); // 0.999 × 1.6
    const none = resolveAudConversion({ currency: 'USDC', date: '2025-03-03', methodology: M }, idx);
    expect(none.ok).toBe(false);
  });
  it('looks back to the prior published rate within the configured window and records it', () => {
    const r = resolveAudConversion({ currency: 'USD', date: '2025-03-02', methodology: M }, idx); // Sunday
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.conversion.rateDate).toBe('2025-02-28');
    expect(r.conversion.staleDays).toBe(2);
    const strict = resolveAudConversion({ currency: 'USD', date: '2025-03-02', methodology: { ...M, maxLookbackDays: 0 } }, idx);
    expect(strict.ok).toBe(false);
  });
  it('flags a missing rate instead of inventing, using today’s rate or zero', () => {
    const r = resolveAudConversion({ currency: 'GBP', date: '2025-03-03', methodology: M }, idx);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toMatch(/No GBP→AUD rate/);
    expect(toAud('100', undefined)).toBeNull();
  });
  it('prefers an execution rate nearest the trade time when configured', () => {
    const i2 = new RateIndex([
      rate('USD', 'AUD', '2025-03-03', '1.60'),
      rate('USD', 'AUD', '2025-03-03', '1.62', { type: 'execution', timestamp: '2025-03-03T14:00:00Z', source: 'Broker' }),
      rate('USD', 'AUD', '2025-03-03', '1.65', { type: 'execution', timestamp: '2025-03-03T20:00:00Z', source: 'Broker' })
    ]);
    const r = resolveAudConversion({ currency: 'USD', date: '2025-03-03', occurredAt: '2025-03-03T15:00:00Z', methodology: M }, i2);
    expect(r.ok && r.conversion.audPerUnit).toBe('1.62');
    const d = resolveAudConversion({ currency: 'USD', date: '2025-03-03', occurredAt: '2025-03-03T15:00:00Z', methodology: { ...M, preferExecutionRate: false } }, i2);
    expect(d.ok && d.conversion.audPerUnit).toBe('1.6');
  });
  it('requires a source and reason for manual overrides', () => {
    expect(() => manualConversion({ rate: '0.65', direction: 'UNITS_PER_AUD', currency: 'USD', rateDate: '2025-01-01', source: '', reason: 'x' })).toThrow(/source/);
    expect(() => manualConversion({ rate: '0.65', direction: 'UNITS_PER_AUD', currency: 'USD', rateDate: '2025-01-01', source: 'Broker statement', reason: '' })).toThrow(/reason/);
    const m = manualConversion({ rate: '0.64', direction: 'UNITS_PER_AUD', currency: 'USD', rateDate: '2025-01-01', source: 'Broker statement', reason: 'Execution rate on contract note' });
    expect(m.audPerUnit).toBe('1.5625');
    expect(m.isManualOverride).toBe(true);
  });
  it('does not lose precision through reciprocal conversion of the original amount', () => {
    const r = resolveAudConversion({ currency: 'USD', date: '2025-03-03', methodology: { ...M } }, new RateIndex([rate('AUD', 'USD', '2025-03-03', '0.6543')]));
    if (!r.ok) throw new Error('expected rate');
    const aud = toAud('1000', r.conversion)!;
    expect(aud.toFixed(2)).toBe('1528.35');
    // Converting the unrounded AUD back gives the original amount; rounded AUD values are never re-converted.
    expect(aud.times('0.6543').toDecimalPlaces(10).toString()).toBe('1000');
  });
  it('validates rate records', () => {
    expect(validateRate({ base: 'AUD', quote: 'USD', date: '2025-01-01', rate: '0', source: 'x' })).toContain('Rate must be greater than zero.');
    expect(validateRate({ base: 'AUD', quote: 'AUD', date: '2025-01-01', rate: '1', source: 'x' })).toContain('Base and quote must differ.');
    expect(validateRate({ base: 'AUD', quote: 'USD', date: '2025-01-01', rate: '0.6', source: '' })).toContain('Rate source is required.');
  });
});
