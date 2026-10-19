import type { Account, Instrument, RateRecord, TaxProfile, Transaction } from '../../src/domain/types';
import { fyOfLocalDate, localDateOf, localToUtc } from '../../src/lib/dates';
import { RateIndex, resolveAudConversion, DEFAULT_METHODOLOGY } from '../../src/engines/currency/rates';

let seq = 0;
export function txn(p: Partial<Transaction> & { kind: Transaction['kind'] }): Transaction {
  seq++;
  const tz = p.timeZone ?? 'Australia/Sydney';
  const occurredAt = p.occurredAt ?? localToUtc(p.date!, p.time ?? '10:00:00', tz);
  const date = p.date && !p.occurredAt ? localDateOf(occurredAt, 'Australia/Sydney') : p.date ?? localDateOf(occurredAt, 'Australia/Sydney');
  return {
    id: p.id ?? `t${String(seq).padStart(5, '0')}`,
    status: 'active',
    timeZone: tz,
    fy: fyOfLocalDate(p.taxEventDate ?? date),
    category: p.kind === 'trade' ? 'trading' : 'other',
    taxClass: 'UNCLASSIFIED',
    taxClassSource: 'user',
    description: '',
    tags: [],
    currency: 'AUD',
    amount: '0',
    documentIds: [],
    relatedIds: [],
    reconStatus: 'unreconciled',
    reviewFlags: [],
    source: 'manual',
    createdAt: `2020-01-01T00:00:${String(seq % 60).padStart(2, '0')}.${String(seq).padStart(3, '0')}Z`,
    updatedAt: '2020-01-01T00:00:00Z',
    version: 1,
    ...p,
    date,
    occurredAt
  } as Transaction;
}

export function account(p: Partial<Account> & { id: string }): Account {
  return { name: p.id, type: 'au_broker', institution: 'Test', currency: 'AUD', taxTreatment: 'investor_cgt', propStatus: 'none', createdAt: '', updatedAt: '', ...p };
}

export function instrument(p: Partial<Instrument> & { id: string; symbol: string }): Instrument {
  return { name: p.symbol, assetClass: 'au_share', currency: 'AUD', createdAt: '', updatedAt: '', ...p };
}

export function rate(base: string, quote: string, date: string, value: string, extra: Partial<RateRecord> = {}): RateRecord {
  return { id: `r_${base}${quote}${date}${extra.source ?? ''}${extra.timestamp ?? ''}`, base, quote, rate: value, date, type: 'daily_reference', source: 'TEST', createdAt: '2020-01-01T00:00:00Z', ...extra };
}

/** Attach an fx conversion resolved from the given rates (mirrors the service layer). */
export function withFx(t: Transaction, rates: RateRecord[]): Transaction {
  const r = resolveAudConversion({ currency: t.currency, date: t.date, occurredAt: t.occurredAt, methodology: DEFAULT_METHODOLOGY }, new RateIndex(rates));
  if (r.ok) t.fx = r.conversion;
  return t;
}

export function profile(fy: number, p: Partial<TaxProfile> = {}): TaxProfile {
  return { id: `tp_${fy}`, fy, residency: 'resident', medicareExemption: 'none', privateHospitalCover: 'yes', spouse: 'no', helpDebt: 'no', updatedAt: '', ...p };
}
