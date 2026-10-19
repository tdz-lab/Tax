/**
 * CSV parsing and row transformation (pure — no database access).
 * Original row values are always retained alongside the normalised record.
 */
import Papa from 'papaparse';
import { DateTime } from 'luxon';
import { D, dstr, normaliseNumberString } from '../lib/decimal';
import { isValidZone, normaliseTime } from '../lib/dates';
import { fnv1a } from '../lib/ids';
import { isFiat } from '../domain/reference';
import { ASSET_CLASSES } from '../domain/types';
import type { Account, AccountType, AssetClass, ImportTarget, ImportTemplate, RateRecord, RateType, Side, Transaction } from '../domain/types';

export interface ParsedFile {
  headers: string[];
  rows: Record<string, string>[];
  delimiter: string;
  errors: string[];
}

export function parseCsv(text: string, opts: { delimiter?: string; skipRows?: number } = {}): ParsedFile {
  let body = text.replace(/^﻿/, '');
  if (opts.skipRows && opts.skipRows > 0) body = body.split(/\r?\n/).slice(opts.skipRows).join('\n');
  const res = Papa.parse<Record<string, string>>(body, {
    header: true,
    skipEmptyLines: 'greedy',
    delimiter: opts.delimiter || '',
    transformHeader: (h) => h.trim()
  });
  const errors = res.errors.map((e) => `Row ${(e.row ?? 0) + 2}: ${e.message}`);
  const headers = (res.meta.fields ?? []).filter((h) => h !== '');
  const rows = res.data.map((r) => {
    const o: Record<string, string> = {};
    for (const h of headers) o[h] = r[h] === undefined || r[h] === null ? '' : String(r[h]).trim();
    // Never silently discard unrecognised/extra columns: keep them under __extra.
    const extra = (r as any).__parsed_extra;
    if (Array.isArray(extra) && extra.length) o.__extra = extra.join(' | ');
    return o;
  });
  return { headers, rows, delimiter: res.meta.delimiter, errors };
}

// ---------------- dates ----------------
const AUTO_FORMATS = [
  'yyyy-MM-dd HH:mm:ss',
  'yyyy-MM-dd HH:mm',
  'yyyy-MM-dd',
  'yyyy/MM/dd HH:mm:ss',
  'yyyy/MM/dd',
  'dd/MM/yyyy HH:mm:ss',
  'dd/MM/yyyy HH:mm',
  'dd/MM/yyyy h:mm a',
  'dd/MM/yyyy h:mm:ss a',
  'dd/MM/yyyy',
  'd/M/yyyy HH:mm',
  'd/M/yyyy',
  'dd-MM-yyyy',
  'd MMM yyyy',
  'dd MMM yyyy',
  'd MMM yyyy HH:mm',
  'dd-MMM-yyyy',
  'yyyyMMdd'
];

export interface ParsedWhen {
  date: string;
  time?: string;
  /** True when the source carried an explicit UTC offset (exact instant). */
  exact: boolean;
}

/** Parse a date (and optional time) in `tz`. `fmt` is a Luxon format or 'auto'. */
export function parseWhen(dateStr: string, timeStr: string | undefined, fmt: string, tz: string): ParsedWhen {
  const ds = (dateStr ?? '').trim();
  if (!ds) throw new Error('Date is empty');
  // ISO with explicit offset or Z → exact instant, expressed in tz wall-clock.
  if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/i.test(ds)) {
    const dt = DateTime.fromISO(ds.replace(' ', 'T'), { setZone: true });
    if (!dt.isValid) throw new Error(`Invalid timestamp "${ds}"`);
    const local = dt.setZone(tz);
    return { date: local.toISODate()!, time: local.toFormat('HH:mm:ss'), exact: true };
  }
  if (/^\d{10,13}$/.test(ds)) {
    const ms = ds.length === 13 ? Number(ds) : Number(ds) * 1000;
    const local = DateTime.fromMillis(ms, { zone: 'utc' }).setZone(tz);
    return { date: local.toISODate()!, time: local.toFormat('HH:mm:ss'), exact: true };
  }
  const formats = fmt && fmt !== 'auto' ? [fmt, `${fmt} HH:mm:ss`, `${fmt} HH:mm`, `${fmt} h:mm a`, `${fmt} h:mm:ss a`] : AUTO_FORMATS;
  for (const f of formats) {
    const dt = DateTime.fromFormat(ds, f, { zone: tz, locale: 'en-AU' });
    if (dt.isValid) {
      const hasTime = /[Hh]/.test(f);
      let time = hasTime ? dt.toFormat('HH:mm:ss') : undefined;
      if (timeStr && timeStr.trim()) time = normaliseTime(timeStr);
      return { date: dt.toISODate()!, time, exact: false };
    }
  }
  throw new Error(`Unrecognised date "${ds}"${fmt && fmt !== 'auto' ? ` for format ${fmt}` : ''}`);
}

/** Inspect sample dates to detect dd/MM vs MM/dd ambiguity. */
export function detectDateFormat(samples: string[]): { suggestion: string; ambiguous: boolean; note: string } {
  const slash = samples.map((s) => /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/.exec(s.trim())).filter(Boolean) as RegExpExecArray[];
  if (!slash.length) return { suggestion: 'auto', ambiguous: false, note: 'ISO or textual dates detected.' };
  const firstOver12 = slash.some((m) => Number(m[1]) > 12);
  const secondOver12 = slash.some((m) => Number(m[2]) > 12);
  if (secondOver12 && !firstOver12) return { suggestion: 'MM/dd/yyyy', ambiguous: false, note: 'Month-first (US) dates detected.' };
  if (firstOver12) return { suggestion: 'dd/MM/yyyy', ambiguous: false, note: 'Day-first (Australian) dates detected.' };
  return { suggestion: 'dd/MM/yyyy', ambiguous: true, note: 'Dates are ambiguous (all parts ≤ 12). Day-first assumed — confirm the date format.' };
}

// ---------------- value normalisation ----------------
const SIDE_MAP: Record<string, Side> = {
  buy: 'buy', b: 'buy', bought: 'buy', purchase: 'buy', 'market buy': 'buy', 'limit buy': 'buy', long: 'buy', bot: 'buy',
  sell: 'sell', s: 'sell', sold: 'sell', sale: 'sell', 'market sell': 'sell', 'limit sell': 'sell', sld: 'sell',
  short: 'short', 'sell short': 'short', 'short sell': 'short', 'sell to open': 'short', write: 'short', sto: 'short',
  cover: 'cover', 'buy to cover': 'cover', 'buy to close': 'cover', btc: 'cover',
  'buy to open': 'buy', bto: 'buy', 'sell to close': 'sell', stc: 'sell',
  swap: 'swap', convert: 'swap', conversion: 'swap', trade: 'swap', exchange: 'swap',
  receive: 'receive', received: 'receive', 'transfer in': 'receive', 'crypto deposit': 'receive', incoming: 'receive',
  send: 'send', sent: 'send', 'transfer out': 'send', 'crypto withdrawal': 'send', outgoing: 'send',
  deposit: 'deposit', 'fiat deposit': 'deposit', 'cash in': 'deposit', funding: 'deposit',
  withdrawal: 'withdrawal', withdraw: 'withdrawal', 'fiat withdrawal': 'withdrawal', 'cash out': 'withdrawal',
  income: 'income', 'staking reward': 'income', staking: 'income', reward: 'income', interest: 'income', airdrop: 'income', mining: 'income', dividend: 'income',
  fee: 'fee', commission: 'fee',
  'realised pnl': 'realised_pnl', 'realized pnl': 'realised_pnl', 'closed p&l': 'realised_pnl', pnl: 'realised_pnl', 'p&l': 'realised_pnl', 'realized p&l': 'realised_pnl', 'realised p&l': 'realised_pnl',
  financing: 'financing', swapfee: 'financing', 'overnight financing': 'financing', rollover: 'financing', 'funding fee': 'financing',
  settlement: 'settlement', 'daily settlement': 'settlement', 'variation margin': 'settlement',
  expire: 'expire', expired: 'expire', expiry: 'expire', expiration: 'expire',
  exercise: 'exercise', exercised: 'exercise', assign: 'assign', assigned: 'assign', assignment: 'assign'
};

export function normaliseSide(v: string, valueMap?: Record<string, string>): Side | null {
  const raw = (v ?? '').trim();
  if (valueMap && valueMap[raw]) return valueMap[raw] as Side;
  return SIDE_MAP[raw.toLowerCase().replace(/_/g, ' ')] ?? null;
}

const ASSET_CLASS_SYNONYMS: Record<string, AssetClass> = {
  stk: 'us_share', stock: 'us_share', equity: 'us_share', share: 'au_share', shares: 'au_share', 'au share': 'au_share', 'us share': 'us_share',
  etf: 'etf', fund: 'managed_fund', 'managed fund': 'managed_fund', crypto: 'crypto', cryptocurrency: 'crypto', token: 'crypto', coin: 'crypto',
  stablecoin: 'stablecoin', nft: 'nft', fx: 'forex', forex: 'forex', cash: 'forex', fut: 'future', future: 'future', futures: 'future',
  opt: 'option', option: 'option', options: 'option', cfd: 'cfd', bond: 'bond'
};

export function normaliseAssetClass(v: string | undefined): AssetClass | null {
  if (!v) return null;
  const k = v.trim().toLowerCase().replace(/-/g, '_');
  if ((ASSET_CLASSES as readonly string[]).includes(k)) return k as AssetClass;
  return ASSET_CLASS_SYNONYMS[k.replace(/_/g, ' ')] ?? null;
}

export function assetClassForAccount(t: AccountType | undefined): AssetClass | null {
  switch (t) {
    case 'au_broker':
      return 'au_share';
    case 'us_broker':
      return 'us_share';
    case 'intl_broker':
      return 'intl_share';
    case 'crypto_exchange':
    case 'crypto_wallet':
      return 'crypto';
    case 'futures':
      return 'future';
    case 'forex':
      return 'forex';
    case 'cfd':
      return 'cfd';
    case 'options':
      return 'option';
    default:
      return null;
  }
}

function num(v: string | undefined, sep: '.' | ','): string | undefined {
  if (v === undefined || v === null || v.trim() === '' || v.trim() === '-') return undefined;
  const n = normaliseNumberString(v, sep);
  return n === '' ? undefined : dstr(D(n));
}

const yes = (v?: string) => !!v && /^(y|yes|true|1)$/i.test(v.trim());

// ---------------- row preparation ----------------
export interface RowRefs {
  symbol?: string;
  instrumentName?: string;
  assetClass?: AssetClass;
  market?: string;
  counterSymbol?: string;
  accountName?: string;
  expiry?: string;
  strike?: string;
  optionType?: 'call' | 'put';
  underlying?: string;
  multiplier?: string;
}

export type DupStatus = 'new' | 'duplicate_source' | 'duplicate_fingerprint' | 'changed_source';

export interface PreparedRow {
  rowNumber: number;
  raw: Record<string, string>;
  partial?: Partial<Transaction>;
  refs: RowRefs;
  rate?: Omit<RateRecord, 'id' | 'createdAt'>;
  errors: string[];
  warnings: string[];
  fingerprint?: string;
  dupStatus: DupStatus;
  dupOf?: string;
  action: 'create' | 'skip' | 'update';
}

export interface PrepareContext {
  target: ImportTarget;
  template: Pick<ImportTemplate, 'mapping' | 'constants' | 'dateFormat' | 'timeZone' | 'decimalSeparator' | 'valueMaps'>;
  account?: Account;
  accountsByName?: Map<string, Account>;
  existingBySource?: Map<string, { id: string; amount: string; quantity?: string }>; // key accountId|sourceId
  existingByFingerprint?: Map<string, string>; // fingerprint -> txn id
  defaultCurrency: string;
}

export function fingerprintOf(p: Partial<Transaction>, refs: RowRefs, occurrence: number): string {
  const base = [p.accountId ?? '', p.kind ?? '', p.date ?? '', p.time ?? '', p.timeZone ?? '', refs.symbol ?? '', p.side ?? '', p.quantity ?? '', p.price ?? '', p.amount ?? '', p.currency ?? '', (p.description ?? '').toLowerCase()].join('|');
  return `${fnv1a(base)}#${occurrence}`;
}

export function prepareRows(rows: Record<string, string>[], ctx: PrepareContext): PreparedRow[] {
  const { mapping, constants, dateFormat, decimalSeparator, valueMaps } = ctx.template;
  const out: PreparedRow[] = [];
  const occurrences = new Map<string, number>();
  rows.forEach((raw, i) => {
    const get = (k: string): string | undefined => {
      const col = mapping[k];
      const v = col ? raw[col] : undefined;
      if (v !== undefined && v !== '') return valueMaps?.[k]?.[v] ?? v;
      return constants[k] || undefined;
    };
    const errors: string[] = [];
    const warnings: string[] = [];
    const refs: RowRefs = {};
    const row: PreparedRow = { rowNumber: i + 1, raw, refs, errors, warnings, dupStatus: 'new', action: 'create' };
    const tz = get('timezone') || ctx.template.timeZone;
    if (!isValidZone(tz)) errors.push(`Unknown time zone "${tz}"`);
    let when: ParsedWhen | null = null;
    try {
      when = parseWhen(get('date') ?? '', get('time'), dateFormat, isValidZone(tz) ? tz : 'Australia/Sydney');
    } catch (e) {
      errors.push((e as Error).message);
    }
    const n = (k: string) => {
      try {
        return num(get(k), decimalSeparator);
      } catch {
        errors.push(`${k}: "${get(k)}" is not a number`);
        return undefined;
      }
    };

    if (ctx.target === 'rates') {
      const base = (get('base') ?? '').toUpperCase();
      const quote = (get('quote') ?? '').toUpperCase();
      const rate = n('rate');
      if (!base || !quote) errors.push('Base and quote are required.');
      if (!rate || D(rate).lte(0)) errors.push('Rate must be > 0.');
      const type = (get('type') as RateType) || 'daily_reference';
      if (when && !errors.length) {
        row.rate = {
          base,
          quote,
          rate: rate!,
          date: when.date,
          timestamp: get('timestamp') && when.time ? new Date(DateTime.fromISO(`${when.date}T${when.time}`, { zone: tz }).toUTC().toISO()!).toISOString() : undefined,
          timeZone: tz,
          type: ['daily_reference', 'execution', 'intraday', 'manual', 'price'].includes(type) ? type : 'daily_reference',
          source: get('source') || 'Imported file'
        };
      }
      out.push(row);
      return;
    }

    let account = ctx.account;
    const acctName = get('account');
    if (acctName && ctx.accountsByName) {
      const a = ctx.accountsByName.get(acctName.trim().toLowerCase());
      if (a) account = a;
      else errors.push(`Account "${acctName}" not found — create it first or choose a default account.`);
    }
    const currency = (get('currency') || account?.currency || ctx.defaultCurrency).toUpperCase();
    const amountRaw = n('amount');
    const p: Partial<Transaction> = {
      date: when?.date,
      time: when?.time,
      timeZone: tz,
      currency,
      description: get('description') ?? '',
      counterparty: get('counterparty'),
      sourceId: get('reference'),
      notes: [get('notes'), raw.__extra ? `Unmapped extra values: ${raw.__extra}` : undefined].filter(Boolean).join(' · ') || undefined,
      accountId: account?.id,
      settlementDate: undefined,
      source: 'import',
      tags: []
    };
    if (get('settlementDate')) {
      try {
        p.settlementDate = parseWhen(get('settlementDate')!, undefined, dateFormat, tz).date;
      } catch {
        warnings.push('Settlement date not recognised — ignored.');
      }
    }
    const fxRate = n('fxRate');
    const fxInv = n('fxRateInverse');
    if (fxRate || fxInv) (p as any)._providedRate = fxRate ? { rate: fxRate, direction: 'AUD_PER_UNIT' } : { rate: fxInv, direction: 'UNITS_PER_AUD' };
    const audAmount = n('audAmount');
    if (audAmount) p.providedAudAmount = D(audAmount).abs().toFixed();
    for (const k of ['taxWithheld', 'foreignTaxPaid', 'frankingCredit', 'frankedAmount', 'unfrankedAmount', 'gstAmount', 'businessUsePct'] as const) {
      const v = n(k);
      if (v !== undefined) (p as any)[k] = D(v).abs().toFixed();
    }
    if (get('isBusiness')) p.isBusiness = yes(get('isBusiness'));
    if (p.gstAmount) p.gstTreatment = 'taxable';
    const category = get('category');

    switch (ctx.target) {
      case 'income':
      case 'expense':
        p.kind = ctx.target;
        p.amount = amountRaw ? D(amountRaw).abs().toFixed() : undefined;
        p.category = category || 'other';
        if (!amountRaw) errors.push('Amount is required.');
        break;
      case 'bank': {
        if (!amountRaw) {
          errors.push('Amount is required.');
          break;
        }
        const a = D(amountRaw);
        p.kind = a.gte(0) ? 'income' : 'expense';
        p.amount = a.abs().toFixed();
        p.category = category || 'other';
        if (!category) {
          p.taxClass = 'UNCLASSIFIED';
          p.taxClassSource = 'import';
          warnings.push('No category — imported as unclassified for review.');
        }
        break;
      }
      case 'dividend': {
        p.kind = 'income';
        p.amount = amountRaw ? D(amountRaw).abs().toFixed() : undefined;
        if (!amountRaw) errors.push('Amount is required.');
        refs.symbol = get('symbol')?.toUpperCase();
        p.quantity = n('quantity');
        const td = n('taxDeferred');
        if (td) p.taxDeferredAmount = D(td).abs().toFixed();
        const cg = n('capitalGain');
        if (cg) p.capitalGainComponent = D(cg).abs().toFixed();
        p.category = category || (currency === 'AUD' ? (td || cg ? 'distribution' : 'dividend_au') : 'dividend_foreign');
        if (p.quantity) delete p.quantity; // units held are informational for dividends; don't create lots
        if (n('quantity')) p.notes = [p.notes, `Units held: ${n('quantity')}`].filter(Boolean).join(' · ');
        break;
      }
      case 'prop': {
        const kind = (get('side') ?? '').toLowerCase();
        p.amount = amountRaw ? D(amountRaw).abs().toFixed() : undefined;
        if (!amountRaw) errors.push('Amount is required.');
        if (/payout|withdrawal|profit/.test(kind)) {
          p.kind = 'income';
          p.category = category || 'prop_payout';
        } else if (/refund/.test(kind)) {
          p.kind = 'income';
          p.category = category || 'prop_refund';
        } else if (/reset/.test(kind)) {
          p.kind = 'fee';
          p.category = category || 'prop_reset_fee';
        } else if (/subscription|platform|data/.test(kind)) {
          p.kind = 'fee';
          p.category = category || 'prop_subscription';
        } else if (/eval|challenge|fee|purchase/.test(kind)) {
          p.kind = 'fee';
          p.category = category || 'prop_eval_fee';
        } else errors.push(`Unknown prop-firm record type "${get('side')}" (use payout, refund, evaluation fee, reset fee, subscription).`);
        break;
      }
      case 'trade':
      case 'transfer': {
        const side = normaliseSide(get('side') ?? '', valueMaps?.side);
        if (!side) errors.push(`Unrecognised side/type "${get('side') ?? ''}" — map it in the value map.`);
        refs.symbol = get('symbol')?.toUpperCase().trim();
        refs.instrumentName = get('instrumentName');
        refs.market = get('market');
        refs.expiry = get('expiry');
        refs.strike = n('strike');
        const ot = get('optionType')?.toLowerCase();
        refs.optionType = ot ? (ot.startsWith('c') ? 'call' : ot.startsWith('p') ? 'put' : undefined) : undefined;
        refs.underlying = get('underlying');
        refs.multiplier = n('multiplier');
        refs.assetClass = normaliseAssetClass(get('assetClass')) ?? assetClassForAccount(account?.type) ?? undefined;
        if (refs.symbol && !refs.assetClass) {
          refs.assetClass = isFiat(refs.symbol) ? 'forex' : 'other';
          warnings.push(`Asset class unknown for ${refs.symbol} — set to "${refs.assetClass}". Map an asset-class column or set a constant.`);
        }
        refs.counterSymbol = get('counterSymbol')?.toUpperCase();
        const qty = n('quantity');
        p.quantity = qty ? D(qty).abs().toFixed() : undefined;
        p.price = n('price') ? D(n('price')!).abs().toFixed() : undefined;
        p.multiplier = refs.multiplier;
        p.commission = n('commission') ? D(n('commission')!).abs().toFixed() : undefined;
        p.exchangeFees = n('exchangeFees') ? D(n('exchangeFees')!).abs().toFixed() : undefined;
        p.otherFees = n('otherFees') ? D(n('otherFees')!).abs().toFixed() : undefined;
        p.financingCosts = n('financingCosts') ? D(n('financingCosts')!).abs().toFixed() : undefined;
        p.feeCurrency = get('feeCurrency')?.toUpperCase();
        p.counterQuantity = n('counterQuantity') ? D(n('counterQuantity')!).abs().toFixed() : undefined;
        p.valuationAud = n('valuationAud') ? D(n('valuationAud')!).abs().toFixed() : undefined;
        if (p.valuationAud) p.valuationSource = 'Import: AUD value supplied by source';
        p.feeQuantity = n('feeQuantity') ? D(n('feeQuantity')!).abs().toFixed() : undefined;
        p.positionRef = get('positionRef');
        if (side) {
          p.side = side;
          if (side === 'deposit' || side === 'withdrawal') {
            p.kind = 'cash';
            p.amount = amountRaw ? D(amountRaw).abs().toFixed() : p.quantity;
            p.category = 'cash';
          } else if (side === 'fee') {
            p.kind = 'fee';
            p.amount = amountRaw ? D(amountRaw).abs().toFixed() : p.commission;
            p.category = category || 'trading_fees';
          } else if (side === 'income' && !refs.symbol) {
            p.kind = 'income';
            p.amount = amountRaw ? D(amountRaw).abs().toFixed() : undefined;
            p.category = category || 'other';
          } else {
            p.kind = 'trade';
            p.category = 'trading';
            if (side === 'income') p.category = category || 'crypto_staking';
            if (side === 'realised_pnl' || side === 'financing' || side === 'settlement') p.amount = amountRaw; // signed
            else p.amount = amountRaw ? D(amountRaw).abs().toFixed() : undefined;
            if (side === 'income') {
              // Income received in kind: the amount is its value in `currency`; tokens become a lot.
              p.kind = 'income';
            }
            if (side === 'send' || side === 'receive') {
              const own = get('ownTransfer');
              if (own !== undefined) p.isOwnTransfer = yes(own);
              if (ctx.target === 'transfer' && own === undefined) p.isOwnTransfer = undefined;
            }
          }
        }
        if (refs.symbol && refs.symbol === currency && p.kind === 'trade' && (p.side === 'buy' || p.side === 'sell')) warnings.push('Symbol equals currency — check mapping.');
        break;
      }
    }
    if (!p.description) p.description = [p.side ?? p.kind, refs.symbol, p.category].filter(Boolean).join(' ');
    row.partial = p;
    // Duplicate detection
    if (!errors.length) {
      const base = fingerprintOf(p, refs, 0).split('#')[0];
      const occ = (occurrences.get(base) ?? 0) + 1;
      occurrences.set(base, occ);
      row.fingerprint = `${base}#${occ}`;
      p.fingerprint = row.fingerprint;
      if (occ > 1 && !p.sourceId) warnings.push(`Identical to an earlier row in this file (occurrence ${occ}) — kept as a separate transaction. Untick if it is a duplicate.`);
      const srcKey = p.sourceId && p.accountId ? `${p.accountId}|${p.sourceId}` : null;
      const bySrc = srcKey ? ctx.existingBySource?.get(srcKey) : undefined;
      if (bySrc) {
        const changed = (p.amount ?? '0') !== bySrc.amount || (p.quantity ?? undefined) !== (bySrc.quantity ?? undefined);
        row.dupStatus = changed ? 'changed_source' : 'duplicate_source';
        row.dupOf = bySrc.id;
        row.action = 'skip';
        warnings.push(changed ? 'Same source ID already imported with different values — choose “update” to apply the new values.' : 'Already imported (same source ID).');
      } else {
        const fp = ctx.existingByFingerprint?.get(row.fingerprint);
        if (fp) {
          row.dupStatus = 'duplicate_fingerprint';
          row.dupOf = fp;
          row.action = 'skip';
          warnings.push('Likely duplicate of an existing transaction (same account, time, instrument, quantity and amount).');
        }
      }
    } else row.action = 'skip';
    out.push(row);
  });
  return out;
}
