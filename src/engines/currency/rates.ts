/**
 * Historical currency conversion engine.
 *
 * Principles:
 *  - Never invents a rate, never falls back to "today's" rate, never substitutes zero.
 *  - Original amount + currency remain authoritative; AUD values are derived as amount × audPerUnit.
 *  - Every conversion carries provenance (record ids, source, date, type, methodology).
 */
import { D, Decimal, dstr } from '../../lib/decimal';
import { addDays } from '../../lib/dates';
import type { Conversion, RateMethodology, RateRecord } from '../../domain/types';

export const DEFAULT_METHODOLOGY: RateMethodology = {
  preferExecutionRate: true,
  dailyRateDateBasis: 'tax_timezone_date',
  maxLookbackDays: 4,
  preferredSource: undefined,
  allowCrossViaUSD: true
};

export interface RateLookupHit {
  record: RateRecord;
  /** Units of `quote` per 1 `base` as requested (after any inversion). */
  value: Decimal;
  inverted: boolean;
  staleDays: number;
}

const key = (b: string, q: string) => `${b.toUpperCase()}/${q.toUpperCase()}`;

export class RateIndex {
  private byPairDate = new Map<string, Map<string, RateRecord[]>>();
  readonly size: number;

  constructor(records: RateRecord[]) {
    for (const r of records) {
      const k = key(r.base, r.quote);
      let m = this.byPairDate.get(k);
      if (!m) this.byPairDate.set(k, (m = new Map()));
      const list = m.get(r.date) ?? [];
      list.push(r);
      m.set(r.date, list);
    }
    for (const m of this.byPairDate.values()) {
      for (const list of m.values()) list.sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : 1));
    }
    this.size = records.length;
  }

  hasPair(base: string, quote: string): boolean {
    return this.byPairDate.has(key(base, quote)) || this.byPairDate.has(key(quote, base));
  }

  private pick(list: RateRecord[], opts: { preferredSource?: string; atInstant?: string; preferExecution?: boolean }): RateRecord {
    let candidates = list;
    if (opts.preferExecution && opts.atInstant) {
      const timed = list.filter((r) => r.timestamp && (r.type === 'execution' || r.type === 'intraday'));
      if (timed.length) {
        const target = Date.parse(opts.atInstant);
        return timed.reduce((best, r) =>
          Math.abs(Date.parse(r.timestamp!) - target) < Math.abs(Date.parse(best.timestamp!) - target) ? r : best
        );
      }
    }
    if (opts.preferredSource) {
      const pref = candidates.filter((r) => r.source === opts.preferredSource);
      if (pref.length) candidates = pref;
    }
    const daily = candidates.filter((r) => r.type === 'daily_reference' || r.type === 'price' || r.type === 'manual');
    return (daily.length ? daily : candidates)[0];
  }

  /** Look up `quote` per 1 `base` on `date`, searching up to `lookback` prior days. */
  lookup(
    base: string,
    quote: string,
    date: string,
    opts: { lookback?: number; preferredSource?: string; atInstant?: string; preferExecution?: boolean } = {}
  ): RateLookupHit | null {
    const lookback = Math.max(0, opts.lookback ?? 0);
    const direct = this.byPairDate.get(key(base, quote));
    const inverse = this.byPairDate.get(key(quote, base));
    for (let i = 0; i <= lookback; i++) {
      const d = i === 0 ? date : addDays(date, -i);
      const dl = direct?.get(d);
      if (dl?.length) {
        const r = this.pick(dl, opts);
        return { record: r, value: D(r.rate), inverted: false, staleDays: i };
      }
      const il = inverse?.get(d);
      if (il?.length) {
        const r = this.pick(il, opts);
        const v = D(r.rate);
        if (v.isZero()) continue;
        return { record: r, value: new Decimal(1).div(v), inverted: true, staleDays: i };
      }
    }
    return null;
  }
}

export type ConversionResult = { ok: true; conversion: Conversion } | { ok: false; reason: string };

export interface ConvertContext {
  currency: string;
  /** Local date selected by the methodology (tax-time-zone date or trade-time-zone date). */
  date: string;
  occurredAt?: string;
  timeZone?: string;
  methodology: RateMethodology;
}

function describe(hit: RateLookupHit, base: string, quote: string): string {
  const r = hit.record;
  return `${r.base}/${r.quote} ${r.rate} (${r.quote} per 1 ${r.base}) on ${r.date}${hit.inverted ? ` → inverted to ${quote} per 1 ${base}` : ''}`;
}

/** Resolve AUD per 1 unit of `ctx.currency`. */
export function resolveAudConversion(ctx: ConvertContext, index: RateIndex, now = new Date().toISOString()): ConversionResult {
  const cur = ctx.currency.toUpperCase();
  const m = ctx.methodology;
  if (cur === 'AUD') {
    return {
      ok: true,
      conversion: {
        audPerUnit: '1',
        sourceRate: '1',
        sourceDirection: 'AUD per 1 AUD',
        rateRecordIds: [],
        source: 'Identity (AUD)',
        rateType: 'daily_reference',
        rateDate: ctx.date,
        methodology: 'Amount already in AUD — no conversion.',
        isManualOverride: false,
        computedAt: now
      }
    };
  }
  const lookOpts = { lookback: m.maxLookbackDays, preferredSource: m.preferredSource, atInstant: ctx.occurredAt, preferExecution: m.preferExecutionRate };
  const direct = index.lookup(cur, 'AUD', ctx.date, lookOpts);
  if (direct) {
    const r = direct.record;
    return {
      ok: true,
      conversion: {
        audPerUnit: dstr(direct.value),
        sourceRate: r.rate,
        sourceDirection: `${r.quote} per 1 ${r.base}`,
        rateRecordIds: [r.id],
        source: r.source,
        rateType: r.type,
        rateDate: r.date,
        rateTimestamp: r.timestamp,
        timeZone: r.timeZone ?? ctx.timeZone,
        retrievedAt: r.retrievedAt,
        methodology:
          `${r.type === 'execution' || r.type === 'intraday' ? 'Execution/intraday rate' : 'Daily reference rate'} for event date ${ctx.date} (${m.dailyRateDateBasis === 'tax_timezone_date' ? 'taxpayer time-zone date' : 'trade time-zone date'}); ` +
          describe(direct, cur, 'AUD') +
          (direct.staleDays ? `; nearest prior published rate used (${direct.staleDays} day(s) earlier, lookback limit ${m.maxLookbackDays})` : ''),
        isManualOverride: false,
        staleDays: direct.staleDays,
        computedAt: now
      }
    };
  }
  if (m.allowCrossViaUSD && cur !== 'USD') {
    const leg1 = index.lookup(cur, 'USD', ctx.date, lookOpts);
    const leg2 = index.lookup('USD', 'AUD', ctx.date, lookOpts);
    if (leg1 && leg2) {
      const v = leg1.value.times(leg2.value);
      return {
        ok: true,
        conversion: {
          audPerUnit: dstr(v),
          sourceRate: dstr(v),
          sourceDirection: `AUD per 1 ${cur} (cross via USD)`,
          rateRecordIds: [leg1.record.id, leg2.record.id],
          source: `${leg1.record.source} × ${leg2.record.source}`,
          rateType: 'cross',
          rateDate: ctx.date,
          methodology: `Cross rate via USD for ${ctx.date}: [${describe(leg1, cur, 'USD')}] × [${describe(leg2, 'USD', 'AUD')}]`,
          isManualOverride: false,
          staleDays: Math.max(leg1.staleDays, leg2.staleDays),
          computedAt: now
        }
      };
    }
  }
  return {
    ok: false,
    reason: `No ${cur}→AUD rate on ${ctx.date} or within ${m.maxLookbackDays} prior day(s)${m.allowCrossViaUSD && cur !== 'USD' ? ' (direct or via USD)' : ''}. Import a historical rate or enter a manual rate with its source.`
  };
}

/** Build a manual override conversion. Source and reason are mandatory. */
export function manualConversion(input: {
  rate: string;
  direction: 'AUD_PER_UNIT' | 'UNITS_PER_AUD';
  currency: string;
  rateDate: string;
  source: string;
  reason: string;
  now?: string;
}): Conversion {
  if (!input.source.trim()) throw new Error('A rate source is required for a manual exchange rate.');
  if (!input.reason.trim()) throw new Error('A reason is required for a manual exchange-rate override.');
  const r = D(input.rate);
  if (r.lte(0)) throw new Error('Exchange rate must be greater than zero.');
  const audPerUnit = input.direction === 'AUD_PER_UNIT' ? r : new Decimal(1).div(r);
  return {
    audPerUnit: dstr(audPerUnit),
    sourceRate: dstr(r),
    sourceDirection: input.direction === 'AUD_PER_UNIT' ? `AUD per 1 ${input.currency}` : `${input.currency} per 1 AUD`,
    rateRecordIds: [],
    source: input.source.trim(),
    rateType: 'manual',
    rateDate: input.rateDate,
    methodology: `Manual rate entered by user (${input.direction === 'AUD_PER_UNIT' ? 'AUD per unit' : 'units per AUD'}).`,
    isManualOverride: true,
    overrideReason: input.reason.trim(),
    overrideSource: input.source.trim(),
    computedAt: input.now ?? new Date().toISOString()
  };
}

/** Convert an original-currency amount to AUD (unrounded; round only for display/reporting). */
export function toAud(amount: string | Decimal | undefined | null, conv: Conversion | undefined | null): Decimal | null {
  if (amount === undefined || amount === null || amount === '') return new Decimal(0);
  if (!conv) return null;
  return D(amount).times(D(conv.audPerUnit));
}

/** Validate a rate record before writing. */
export function validateRate(r: Partial<RateRecord>): string[] {
  const errs: string[] = [];
  if (!r.base || !/^[A-Z0-9.]{2,12}$/i.test(r.base)) errs.push('Base currency/asset code is required.');
  if (!r.quote || !/^[A-Z0-9.]{2,12}$/i.test(r.quote)) errs.push('Quote currency code is required.');
  if (r.base && r.quote && r.base.toUpperCase() === r.quote.toUpperCase()) errs.push('Base and quote must differ.');
  if (!r.date || !/^\d{4}-\d{2}-\d{2}$/.test(r.date)) errs.push('Rate date (YYYY-MM-DD) is required.');
  try {
    if (!r.rate || D(r.rate).lte(0)) errs.push('Rate must be greater than zero.');
  } catch {
    errs.push('Rate is not a valid number.');
  }
  if (!r.source || !r.source.trim()) errs.push('Rate source is required.');
  return errs;
}
