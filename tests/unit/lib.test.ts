import { describe, expect, it } from 'vitest';
import { D, formatMoney, normaliseNumberString, toWholeDollarsDown, sum } from '../../src/lib/decimal';
import { currentFY, fyLabel, fyOfInstant, fyOfLocalDate, heldAtLeast12Months, isNonexistentLocalTime, localDateOf, localToUtc, normaliseTime, formatInstant } from '../../src/lib/dates';

describe('decimal arithmetic', () => {
  it('is exact where binary floating point is not', () => {
    expect(0.1 + 0.2).not.toBe(0.3);
    expect(D('0.1').plus('0.2').toString()).toBe('0.3');
    expect(sum(['0.1', '0.2', '0.3']).toString()).toBe('0.6');
  });
  it('parses accounting-style and currency-formatted numbers', () => {
    expect(normaliseNumberString('$1,234.50')).toBe('1234.50');
    expect(normaliseNumberString('(1,234.50)')).toBe('-1234.50');
    expect(normaliseNumberString('12.30-')).toBe('-12.30');
    expect(normaliseNumberString('1.234,56', ',')).toBe('1234.56');
    expect(() => normaliseNumberString('12abc34x5.5.5')).toThrow();
  });
  it('rounds money half-up and truncates taxable income to whole dollars', () => {
    expect(formatMoney('1234.565')).toBe('$1,234.57');
    expect(formatMoney('-0.005')).toBe('-$0.01');
    expect(formatMoney('10', 'USD')).toBe('10.00 USD');
    expect(toWholeDollarsDown('80000.99').toString()).toBe('80000');
  });
  it('handles very small and very large amounts', () => {
    expect(D('0.00000001').times('100000000').toString()).toBe('1');
    expect(D('123456789012345678.123456').plus('1').toFixed()).toBe('123456789012345679.123456');
  });
});

describe('financial years and time zones', () => {
  it('assigns the Australian financial year by local date', () => {
    expect(fyOfLocalDate('2026-06-30')).toBe(2026);
    expect(fyOfLocalDate('2026-07-01')).toBe(2027);
    expect(fyLabel(2026)).toBe('FY2025–26');
  });
  it('evaluates FY boundaries in the taxpayer time zone', () => {
    // 30 June 2026 3:00 PM New York = 1 July 2026 5:00 AM Sydney → FY2026–27 for an Australian resident.
    const utc = localToUtc('2026-06-30', '15:00', 'America/New_York');
    expect(utc).toBe('2026-06-30T19:00:00Z');
    expect(localDateOf(utc, 'Australia/Sydney')).toBe('2026-07-01');
    expect(fyOfInstant(utc, 'Australia/Sydney')).toBe(2027);
    expect(fyOfInstant(utc, 'America/New_York')).toBe(2026);
  });
  it('derives the current FY from the clock (not hard-coded)', () => {
    expect(currentFY(new Date('2026-10-19T00:00:00Z'))).toBe(2027);
    expect(currentFY(new Date('2026-06-30T13:59:59Z'))).toBe(2026); // 11:59:59 PM AEST 30 June
    expect(currentFY(new Date('2026-06-30T14:00:00Z'))).toBe(2027); // 12:00 AM AEST 1 July
  });
  it('handles daylight-saving transitions in Sydney', () => {
    // DST starts 2025-10-05 02:00 → 03:00 (02:30 does not exist)
    expect(isNonexistentLocalTime('2025-10-05', '02:30', 'Australia/Sydney')).toBe(true);
    expect(isNonexistentLocalTime('2025-10-05', '03:30', 'Australia/Sydney')).toBe(false);
    // DST ends 2025-04-06 03:00 → 02:00: 02:30 is ambiguous; Luxon resolves to the earlier (AEDT, +11) instant.
    expect(localToUtc('2025-04-06', '02:30', 'Australia/Sydney')).toBe('2025-04-05T15:30:00Z');
    expect(localToUtc('2025-01-15', '10:00', 'Australia/Sydney')).toBe('2025-01-14T23:00:00Z'); // AEDT +11
    expect(localToUtc('2025-07-15', '10:00', 'Australia/Sydney')).toBe('2025-07-15T00:00:00Z'); // AEST +10
  });
  it('parses 12-hour time and displays 12-hour AM/PM by default', () => {
    expect(normaliseTime('2:05 PM')).toBe('14:05:00');
    expect(normaliseTime('12:00 AM')).toBe('00:00:00');
    expect(normaliseTime('12:30 pm')).toBe('12:30:00');
    expect(() => normaliseTime('13:00 PM')).toThrow();
    expect(formatInstant('2025-01-14T23:00:00Z', 'Australia/Sydney')).toBe('15/01/2025 10:00:00 AM');
    expect(formatInstant('2025-01-14T23:00:00Z', 'Australia/Sydney', { timeFormat: '24h' })).toBe('15/01/2025 10:00:00');
  });
  it('applies the CGT 12-month holding test excluding acquisition and disposal days', () => {
    expect(heldAtLeast12Months('2023-07-01', '2024-07-01')).toBe(false);
    expect(heldAtLeast12Months('2023-07-01', '2024-07-02')).toBe(true);
    expect(heldAtLeast12Months('2024-02-29', '2025-03-01')).toBe(true);
    expect(heldAtLeast12Months('2024-02-29', '2025-02-28')).toBe(false);
  });
});
