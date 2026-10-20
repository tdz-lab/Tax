/** Canonical import fields per target, with header synonyms used for automatic mapping. */
import type { ImportTarget } from '../domain/types';

export interface FieldDef {
  key: string;
  label: string;
  required?: boolean;
  synonyms: string[];
  help?: string;
}

const F = (key: string, label: string, synonyms: string[], extra: Partial<FieldDef> = {}): FieldDef => ({ key, label, synonyms, ...extra });

const COMMON: FieldDef[] = [
  F('date', 'Date', ['date', 'trade date', 'transaction date', 'value date', 'paid date', 'date received', 'time (utc)', 'datetime', 'timestamp', 'date/time', 'execution time', 'utc_time'], { required: true, help: 'Date, or combined date-time.' }),
  F('time', 'Time', ['time', 'trade time', 'execution time of day']),
  F('timezone', 'Time zone (IANA)', ['timezone', 'time zone', 'tz']),
  F('description', 'Description', ['description', 'details', 'narrative', 'memo', 'particulars', 'name']),
  F('amount', 'Amount', ['amount', 'gross amount', 'value', 'total', 'net amount', 'proceeds', 'debit/credit']),
  F('currency', 'Currency', ['currency', 'ccy', 'curr', 'currency code', 'quote currency', 'price currency']),
  F('category', 'Category code', ['category', 'type code', 'category code']),
  F('counterparty', 'Payer / supplier', ['payer', 'supplier', 'payee', 'merchant', 'employer', 'counterparty', 'firm']),
  F('reference', 'Source ID / reference', ['id', 'reference', 'ref', 'transaction id', 'trade id', 'order id', 'txid', 'tx hash', 'execution id', 'source id']),
  F('notes', 'Notes', ['notes', 'comment', 'comments']),
  F('account', 'Account name', ['account', 'account name', 'portfolio', 'wallet']),
  F('fxRate', 'FX rate (AUD per 1 unit)', ['fx rate', 'aud rate', 'exchange rate', 'aud per unit', 'fx to aud']),
  F('fxRateInverse', 'FX rate (units per 1 AUD)', ['units per aud', 'rate per aud']),
  F('audAmount', 'AUD amount stated by source', ['aud amount', 'amount aud', 'value aud', 'aud value']),
  F('settlementDate', 'Settlement date', ['settlement date', 'settle date', 'value date settlement'])
];

const TAXY: FieldDef[] = [
  F('taxWithheld', 'Tax withheld (AUD)', ['tax withheld', 'payg withheld', 'withholding', 'tfn withholding']),
  F('foreignTaxPaid', 'Foreign tax paid', ['foreign tax', 'foreign tax paid', 'withholding tax', 'wht']),
  F('frankingCredit', 'Franking credit (AUD)', ['franking credit', 'franking credits', 'imputation credit']),
  F('frankedAmount', 'Franked amount (AUD)', ['franked amount', 'franked']),
  F('unfrankedAmount', 'Unfranked amount (AUD)', ['unfranked amount', 'unfranked']),
  F('gstAmount', 'GST amount', ['gst', 'gst amount', 'tax amount']),
  F('businessUsePct', 'Business use %', ['business use', 'business use %', 'business %']),
  F('isBusiness', 'Business record (Y/N)', ['business', 'is business'])
];

const TRADE: FieldDef[] = [
  F('side', 'Side / type', ['side', 'type', 'action', 'buy/sell', 'transaction type', 'operation', 'direction'], { required: true }),
  F('symbol', 'Symbol', ['symbol', 'ticker', 'code', 'asset', 'instrument', 'coin', 'contract', 'security code', 'base asset', 'market'], { required: true }),
  F('instrumentName', 'Instrument name', ['instrument name', 'security', 'security name', 'asset name']),
  F('assetClass', 'Asset class', ['asset class', 'asset type', 'security type', 'product']),
  F('market', 'Exchange / market', ['exchange', 'venue', 'listing exchange']),
  F('quantity', 'Quantity', ['quantity', 'qty', 'units', 'shares', 'volume', 'size', 'contracts', 'lots', 'amount (units)'], { required: true }),
  F('price', 'Price', ['price', 'unit price', 'trade price', 'avg price', 'execution price', 'fill price']),
  F('multiplier', 'Contract multiplier', ['multiplier', 'contract size', 'point value']),
  F('commission', 'Commission / brokerage', ['commission', 'brokerage', 'comm', 'fee', 'fees', 'trading fee']),
  F('exchangeFees', 'Exchange fees', ['exchange fee', 'exchange fees', 'clearing fee', 'regulatory fee']),
  F('otherFees', 'Other fees', ['other fees', 'misc fees', 'gst on brokerage']),
  F('financingCosts', 'Financing costs', ['financing', 'swap', 'overnight fee', 'funding']),
  F('feeCurrency', 'Fee currency', ['fee currency', 'commission currency', 'fee asset']),
  F('counterSymbol', 'Asset received (swaps)', ['received asset', 'buy asset', 'to asset', 'counter asset']),
  F('counterQuantity', 'Quantity received (swaps)', ['received quantity', 'buy amount', 'to amount']),
  F('valuationAud', 'AUD market value (crypto events)', ['aud market value', 'market value aud', 'value in aud']),
  F('feeQuantity', 'Network fee (asset units)', ['network fee', 'gas fee', 'gas']),
  F('positionRef', 'Position reference', ['position id', 'position', 'ticket']),
  F('expiry', 'Expiry date', ['expiry', 'expiration', 'expiry date']),
  F('strike', 'Strike', ['strike', 'strike price']),
  F('optionType', 'Call / put', ['put/call', 'call/put', 'option type', 'right']),
  F('underlying', 'Underlying', ['underlying', 'underlying symbol']),
  F('ownTransfer', 'Own transfer (Y/N)', ['own transfer', 'internal transfer', 'self transfer'])
];

const RATES: FieldDef[] = [
  F('date', 'Date', ['date', 'day', 'rate date'], { required: true }),
  F('base', 'Base currency/asset', ['base', 'from', 'currency', 'asset', 'from currency'], { required: true }),
  F('quote', 'Quote currency', ['quote', 'to', 'to currency', 'counter'], { required: true }),
  F('rate', 'Rate (quote per 1 base)', ['rate', 'value', 'close', 'price', 'fx rate'], { required: true }),
  F('source', 'Source', ['source', 'provider', 'publisher']),
  F('type', 'Rate type', ['type', 'rate type']),
  F('timestamp', 'Timestamp (intraday)', ['timestamp', 'datetime', 'time (utc)'])
];

export const TARGET_FIELDS: Record<ImportTarget, FieldDef[]> = {
  income: [...COMMON, ...TAXY],
  expense: [...COMMON, ...TAXY],
  bank: COMMON,
  dividend: [...COMMON, ...TAXY, F('symbol', 'Symbol', ['symbol', 'ticker', 'code', 'security']), F('quantity', 'Units held', ['units', 'quantity', 'holding']), F('taxDeferred', 'Tax-deferred amount', ['tax deferred', 'return of capital', 'tax-deferred']), F('capitalGain', 'Capital gain component (AUD)', ['capital gain', 'capital gains']), F('cgDiscounted', 'Discounted capital gain (AMMA, AUD)', ['discounted capital gain', 'discounted capital gains', 'capital gains discounted method']), F('cgIndexation', 'Capital gain — indexation method (AUD)', ['capital gains indexation method', 'indexed capital gain']), F('cgOther', 'Capital gain — other method (AUD)', ['capital gains other method', 'other capital gain', 'non-discounted capital gain']), F('exDividendDate', 'Ex-dividend date', ['ex date', 'ex-dividend date', 'ex dividend date', 'ex-date'])],
  trade: [...COMMON, ...TRADE],
  transfer: [...COMMON, ...TRADE],
  prop: [...COMMON, ...TAXY, F('side', 'Type (payout / fee / refund)', ['type', 'transaction type', 'kind'], { required: true })],
  rates: RATES
};

export const TARGET_LABEL: Record<ImportTarget, string> = {
  income: 'Income records',
  expense: 'Expenses / receipts',
  bank: 'Bank statement (signed amounts)',
  dividend: 'Dividends & distributions',
  trade: 'Trades (shares, ETFs, crypto, futures, options, CFDs, forex)',
  transfer: 'Wallet / account transfers',
  prop: 'Prop-firm payouts & fees',
  rates: 'Historical exchange rates / prices'
};

const norm = (s: string) => s.toLowerCase().replace(/[_\-./()]+/g, ' ').replace(/\s+/g, ' ').trim();

/** Best-effort automatic mapping: exact synonym match, then contains-match. */
export function autoMap(target: ImportTarget, headers: string[]): Record<string, string> {
  const fields = TARGET_FIELDS[target];
  const mapping: Record<string, string> = {};
  const used = new Set<string>();
  const nh = headers.map((h) => ({ h, n: norm(h) }));
  for (const pass of ['exact', 'contains'] as const) {
    for (const f of fields) {
      if (mapping[f.key]) continue;
      const cands = [norm(f.key), norm(f.label), ...f.synonyms.map(norm)];
      const hit = nh.find(({ h, n }) => !used.has(h) && (pass === 'exact' ? cands.includes(n) : cands.some((c) => c.length > 3 && (n.includes(c) || c.includes(n)) && n.length > 2)));
      if (hit) {
        mapping[f.key] = hit.h;
        used.add(hit.h);
      }
    }
  }
  return mapping;
}
