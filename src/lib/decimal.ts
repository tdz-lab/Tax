/**
 * Decimal arithmetic helpers. All monetary and quantity values are stored as
 * strings and manipulated with decimal.js — never with binary floating point.
 */
import Decimal from 'decimal.js';

Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP, toExpNeg: -30, toExpPos: 40 });

export { Decimal };
export type DecimalInput = Decimal | string | number | null | undefined;

/** Construct a Decimal. Empty / null / undefined → 0. Throws on garbage. */
export function D(v: DecimalInput): Decimal {
  if (v instanceof Decimal) return v;
  if (v === null || v === undefined || v === '') return new Decimal(0);
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new Error(`Invalid numeric value: ${v}`);
    return new Decimal(v.toString());
  }
  const cleaned = normaliseNumberString(v);
  if (cleaned === '') return new Decimal(0);
  return new Decimal(cleaned);
}

/** Parse a user / CSV number string such as "$1,234.50", "(12.30)", "1 234,5"? (no: comma decimal unsupported unless configured). */
export function normaliseNumberString(raw: string, decimalSeparator: '.' | ',' = '.'): string {
  let s = String(raw).trim();
  if (s === '') return '';
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  s = s.replace(/[A-Za-z$€£¥₿\s'"]/g, '');
  if (decimalSeparator === ',') {
    s = s.replace(/\./g, '').replace(',', '.');
  } else {
    s = s.replace(/,/g, '');
  }
  if (s.endsWith('-')) {
    negative = !negative;
    s = s.slice(0, -1);
  }
  if (s.startsWith('+')) s = s.slice(1);
  if (s.startsWith('-')) {
    negative = !negative;
    s = s.slice(1);
  }
  if (s === '') return '';
  if (!/^\d*\.?\d+(e[-+]?\d+)?$/i.test(s) && !/^\d+\.$/.test(s)) {
    throw new Error(`Not a number: "${raw}"`);
  }
  return (negative ? '-' : '') + s;
}

export function isValidDecimal(v: unknown): boolean {
  if (v === null || v === undefined || v === '') return false;
  try {
    D(v as DecimalInput);
    return true;
  } catch {
    return false;
  }
}

export function tryD(v: DecimalInput): Decimal | null {
  try {
    if (v === null || v === undefined || v === '') return null;
    return D(v);
  } catch {
    return null;
  }
}

export function sum(values: DecimalInput[]): Decimal {
  return values.reduce<Decimal>((acc, v) => acc.plus(D(v)), new Decimal(0));
}

/** Round to cents for reporting (half-up, the conventional Australian currency rounding). */
export function toCents(v: DecimalInput): Decimal {
  return D(v).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

/** Truncate to whole dollars (used by ATO for taxable income: cents are ignored). */
export function toWholeDollarsDown(v: DecimalInput): Decimal {
  return D(v).toDecimalPlaces(0, Decimal.ROUND_DOWN);
}

/** Canonical string for storage (no exponent, trimmed trailing zeros). */
export function dstr(v: DecimalInput): string {
  const d = D(v);
  return d.isZero() ? '0' : d.toFixed();
}

export function formatMoney(v: DecimalInput, currency = 'AUD', opts: { dp?: number; showCode?: boolean } = {}): string {
  const d = tryD(v);
  if (d === null) return '—';
  const dp = opts.dp ?? 2;
  const neg = d.isNegative();
  const abs = d.abs().toDecimalPlaces(dp, Decimal.ROUND_HALF_UP).toFixed(dp);
  const [int, frac] = abs.split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const symbol = currency === 'AUD' ? '$' : '';
  const body = `${symbol}${grouped}${frac ? '.' + frac : ''}`;
  const code = currency !== 'AUD' || opts.showCode ? ` ${currency}` : '';
  return neg ? `-${body}${code}` : `${body}${code}`;
}

export function formatQty(v: DecimalInput, maxDp = 8): string {
  const d = tryD(v);
  if (d === null) return '—';
  const s = d.toDecimalPlaces(maxDp, Decimal.ROUND_HALF_UP).toFixed();
  const [int, frac] = s.replace('-', '').split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (d.isNegative() ? '-' : '') + grouped + (frac ? '.' + frac : '');
}
