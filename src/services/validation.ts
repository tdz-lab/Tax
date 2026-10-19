/** Record validation applied before every write (manual entry, import, restore). */
import { D, isValidDecimal, tryD } from '../lib/decimal';
import { isValidIsoDate, isValidZone, normaliseTime } from '../lib/dates';
import type { Transaction } from '../domain/types';

export function validateTransaction(t: Partial<Transaction>): string[] {
  const e: string[] = [];
  if (!t.kind) e.push('Transaction type is required.');
  if (!isValidIsoDate(t.date)) e.push('A valid date is required.');
  if (t.time) {
    try {
      normaliseTime(t.time);
    } catch {
      e.push('Time is not valid (use e.g. 2:30 PM or 14:30).');
    }
  }
  if (!t.timeZone || !isValidZone(t.timeZone)) e.push('A valid time zone is required.');
  else if (isValidIsoDate(t.date) && !t.occurredAt) e.push('Date/time could not be interpreted in the selected time zone.');
  if (!t.currency || !/^[A-Z0-9.]{2,12}$/.test(t.currency)) e.push('Currency / asset code is required (e.g. AUD, USD, USDT).');
  if (t.settlementDate && !isValidIsoDate(t.settlementDate)) e.push('Settlement date is invalid.');
  if (t.taxEventDate && !isValidIsoDate(t.taxEventDate)) e.push('Tax event date is invalid.');
  const dec = (v: unknown, label: string, opts: { positive?: boolean; nonNeg?: boolean } = {}) => {
    if (v === undefined || v === null || v === '') return;
    if (!isValidDecimal(v)) return e.push(`${label} is not a valid number.`);
    const d = D(v as string);
    if (opts.positive && d.lte(0)) e.push(`${label} must be greater than zero.`);
    if (opts.nonNeg && d.lt(0)) e.push(`${label} cannot be negative.`);
  };
  dec(t.amount, 'Amount');
  dec(t.quantity, 'Quantity');
  dec(t.price, 'Price', { nonNeg: true });
  dec(t.multiplier, 'Multiplier', { positive: true });
  for (const [k, label] of [
    ['commission', 'Commission'],
    ['exchangeFees', 'Exchange fees'],
    ['financingCosts', 'Financing costs'],
    ['otherFees', 'Other fees'],
    ['taxWithheld', 'Tax withheld'],
    ['foreignTaxPaid', 'Foreign tax paid'],
    ['frankingCredit', 'Franking credit'],
    ['gstAmount', 'GST'],
    ['feeQuantity', 'Network fee quantity'],
    ['valuationAud', 'AUD valuation'],
    ['counterQuantity', 'Received quantity']
  ] as const)
    dec((t as any)[k], label, { nonNeg: true });
  if (t.businessUsePct !== undefined && t.businessUsePct !== '') {
    const p = tryD(t.businessUsePct);
    if (!p || p.lt(0) || p.gt(100)) e.push('Business-use % must be between 0 and 100.');
  }
  switch (t.kind) {
    case 'income':
    case 'expense':
    case 'fee':
      if (!t.category) e.push('Category is required.');
      if (!tryD(t.amount) || D(t.amount).lte(0)) e.push('Amount must be greater than zero.');
      if (t.splits?.length) {
        const total = t.splits.reduce((s, x) => s.plus(D(x.amount)), D(0));
        if (!total.eq(D(t.amount))) e.push(`Split amounts (${total.toFixed()}) must add up to the total (${D(t.amount).toFixed()}).`);
      }
      break;
    case 'cash':
      if (!t.accountId) e.push('Account is required.');
      if (t.side !== 'deposit' && t.side !== 'withdrawal') e.push('Choose deposit or withdrawal.');
      if (!tryD(t.amount) || D(t.amount).lte(0)) e.push('Amount must be greater than zero.');
      break;
    case 'transfer':
      if (!t.accountId) e.push('Account is required.');
      if (!tryD(t.amount) && !tryD(t.quantity)) e.push('Amount or quantity is required.');
      break;
    case 'trade':
      if (!t.accountId) e.push('Account is required.');
      if (!t.side) e.push('Side is required.');
      if (['buy', 'sell', 'short', 'cover', 'swap', 'send', 'receive', 'expire', 'exercise', 'assign'].includes(t.side ?? '')) {
        if (!t.instrumentId) e.push('Instrument is required.');
        if (!tryD(t.quantity) || D(t.quantity).lte(0)) e.push('Quantity must be greater than zero.');
      }
      if (['buy', 'sell', 'short', 'cover'].includes(t.side ?? '') && !tryD(t.price) && !tryD(t.amount)) e.push('Price or gross amount is required.');
      if (t.side === 'swap') {
        if (!t.counterInstrumentId) e.push('Swap requires the asset received.');
        if (!tryD(t.counterQuantity) || D(t.counterQuantity).lte(0)) e.push('Swap requires the quantity received.');
      }
      if (['realised_pnl', 'financing', 'settlement'].includes(t.side ?? '') && !tryD(t.amount)) e.push('Amount (signed P&L or charge) is required.');
      break;
    case 'adjustment':
      if (!t.adjustmentType) e.push('Adjustment type is required.');
      break;
  }
  return e;
}
