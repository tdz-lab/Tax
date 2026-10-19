/** Built-in import templates matching the bundled sample files (and generic layouts). */
import type { ImportTarget, ImportTemplate } from '../domain/types';

type T = Omit<ImportTemplate, 'createdAt' | 'updatedAt'>;
const t = (id: string, name: string, target: ImportTarget, mapping: Record<string, string>, extra: Partial<T> = {}): T => ({
  id: `tpl_builtin_${id}`,
  name,
  target,
  dateFormat: 'auto',
  timeZone: 'Australia/Sydney',
  decimalSeparator: '.',
  mapping,
  constants: {},
  builtin: true,
  headerSignature: Object.values(mapping),
  ...extra
});

export const BUILTIN_TEMPLATES: T[] = [
  t('income', 'Generic income (sample: income.csv)', 'income', { date: 'Date', description: 'Description', category: 'Category', counterparty: 'Payer', amount: 'Amount', currency: 'Currency', taxWithheld: 'Tax Withheld', reference: 'Reference' }, { dateFormat: 'dd/MM/yyyy' }),
  t('expenses', 'Generic expenses (sample: expenses.csv)', 'expense', { date: 'Date', description: 'Description', category: 'Category', counterparty: 'Supplier', amount: 'Amount', currency: 'Currency', gstAmount: 'GST', businessUsePct: 'Business Use %', isBusiness: 'Business', reference: 'Reference' }, { dateFormat: 'dd/MM/yyyy' }),
  t('bank', 'Generic bank statement (sample: bank.csv)', 'bank', { date: 'Date', description: 'Description', amount: 'Amount', currency: 'Currency', reference: 'Reference' }, { dateFormat: 'dd/MM/yyyy' }),
  t('shares', 'Generic share trades (sample: shares.csv)', 'trade', { date: 'Trade Date', time: 'Time', timezone: 'Time Zone', side: 'Type', symbol: 'Symbol', instrumentName: 'Security Name', assetClass: 'Asset Class', market: 'Exchange', quantity: 'Quantity', price: 'Price', commission: 'Brokerage', currency: 'Currency', reference: 'Reference' }, { dateFormat: 'dd/MM/yyyy' }),
  t('crypto', 'Generic crypto exchange (sample: crypto_trades.csv)', 'trade', { date: 'Date', side: 'Type', symbol: 'Asset', assetClass: 'Asset Class', quantity: 'Quantity', price: 'Price', currency: 'Quote Currency', commission: 'Fee', feeCurrency: 'Fee Currency', counterSymbol: 'Received Asset', counterQuantity: 'Received Quantity', valuationAud: 'AUD Market Value', reference: 'Tx ID' }, { timeZone: 'UTC' }),
  t('transfers', 'Generic wallet transfers (sample: wallet_transfers.csv)', 'transfer', { date: 'Date', side: 'Type', symbol: 'Asset', assetClass: 'Asset Class', quantity: 'Quantity', feeQuantity: 'Network Fee', ownTransfer: 'Own Transfer', reference: 'Tx Hash' }, { timeZone: 'UTC' }),
  t('dividends', 'Dividends & distributions (sample: dividends.csv)', 'dividend', { date: 'Date', symbol: 'Symbol', description: 'Description', amount: 'Amount', currency: 'Currency', frankedAmount: 'Franked Amount', unfrankedAmount: 'Unfranked Amount', frankingCredit: 'Franking Credit', foreignTaxPaid: 'Foreign Tax', taxDeferred: 'Tax Deferred', capitalGain: 'Capital Gain', reference: 'Reference' }, { dateFormat: 'dd/MM/yyyy' }),
  t('forex', 'Forex positions (sample: forex.csv)', 'trade', { date: 'Date', time: 'Time', timezone: 'Time Zone', side: 'Type', symbol: 'Symbol', assetClass: 'Asset Class', quantity: 'Quantity', price: 'Price', commission: 'Commission', currency: 'Currency', amount: 'Amount', reference: 'Reference' }, { dateFormat: 'dd/MM/yyyy' }),
  t('futures', 'Futures (sample: futures.csv)', 'trade', { date: 'Date', time: 'Time', timezone: 'Time Zone', side: 'Type', symbol: 'Symbol', instrumentName: 'Contract', assetClass: 'Asset Class', market: 'Exchange', quantity: 'Quantity', price: 'Price', multiplier: 'Multiplier', commission: 'Commission', exchangeFees: 'Exchange Fees', currency: 'Currency', reference: 'Reference' }, { dateFormat: 'dd/MM/yyyy' }),
  t('options', 'Options (sample: options.csv)', 'trade', { date: 'Date', side: 'Type', symbol: 'Symbol', assetClass: 'Asset Class', underlying: 'Underlying', optionType: 'Put/Call', strike: 'Strike', expiry: 'Expiry', quantity: 'Quantity', price: 'Price', multiplier: 'Multiplier', commission: 'Commission', currency: 'Currency', reference: 'Reference' }),
  t('cfds', 'CFDs (sample: cfds.csv)', 'trade', { date: 'Date', side: 'Type', symbol: 'Symbol', assetClass: 'Asset Class', quantity: 'Quantity', price: 'Price', commission: 'Commission', currency: 'Currency', amount: 'Amount', reference: 'Reference' }, { dateFormat: 'dd/MM/yyyy' }),
  t('prop', 'Prop-firm payouts & fees (sample: prop_firm.csv)', 'prop', { date: 'Date', side: 'Type', description: 'Description', counterparty: 'Firm', amount: 'Amount', currency: 'Currency', reference: 'Reference' }, { dateFormat: 'dd/MM/yyyy' }),
  t('rates', 'Historical rates — long format (sample: rates.csv)', 'rates', { date: 'Date', base: 'Base', quote: 'Quote', rate: 'Rate', source: 'Source', type: 'Type' })
];

export const SAMPLE_FILES: { file: string; label: string; templateId: string }[] = [
  ['income.csv', 'Income', 'income'],
  ['expenses.csv', 'Expenses', 'expenses'],
  ['bank.csv', 'Bank transactions', 'bank'],
  ['shares.csv', 'Shares (AU & US)', 'shares'],
  ['crypto_trades.csv', 'Crypto trades', 'crypto'],
  ['wallet_transfers.csv', 'Wallet transfers', 'transfers'],
  ['dividends.csv', 'Dividends', 'dividends'],
  ['forex.csv', 'Forex', 'forex'],
  ['futures.csv', 'Futures', 'futures'],
  ['options.csv', 'Options', 'options'],
  ['cfds.csv', 'CFDs', 'cfds'],
  ['prop_firm.csv', 'Prop-firm payouts & fees', 'prop'],
  ['rates.csv', 'Historical exchange rates', 'rates']
].map(([file, label, id]) => ({ file, label, templateId: `tpl_builtin_${id}` }));

/** Choose the template whose header signature best matches the file headers. */
export function detectTemplate(headers: string[], templates: ImportTemplate[]): ImportTemplate | null {
  const set = new Set(headers.map((h) => h.trim().toLowerCase()));
  let best: { t: ImportTemplate; score: number } | null = null;
  for (const tpl of templates) {
    const sig = (tpl.headerSignature ?? Object.values(tpl.mapping)).map((h) => h.toLowerCase());
    if (!sig.length) continue;
    const hit = sig.filter((h) => set.has(h)).length;
    const score = hit / sig.length;
    if (score >= 0.8 && (!best || score > best.score || (score === best.score && sig.length > (best.t.headerSignature?.length ?? 0)))) best = { t: tpl, score };
  }
  return best?.t ?? null;
}

/** Wide-format rate table (one date column + one column per currency), e.g. "units of currency per 1 AUD". */
export function wideRatesToLong(rows: Record<string, string>[], dateColumn: string, direction: 'units_per_aud' | 'aud_per_unit', source: string): Record<string, string>[] {
  const out: Record<string, string>[] = [];
  for (const r of rows) {
    const date = r[dateColumn];
    if (!date) continue;
    for (const [col, v] of Object.entries(r)) {
      if (col === dateColumn || col === '__extra' || !v || !/^[A-Z]{3}$/.test(col.trim())) continue;
      if (!/^-?\d*\.?\d+$/.test(v.trim())) continue;
      out.push(direction === 'units_per_aud' ? { Date: date, Base: 'AUD', Quote: col.trim(), Rate: v.trim(), Source: source, Type: 'daily_reference' } : { Date: date, Base: col.trim(), Quote: 'AUD', Rate: v.trim(), Source: source, Type: 'daily_reference' });
    }
  }
  return out;
}
