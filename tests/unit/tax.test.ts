/**
 * Australian tax fixtures. Expected values are computed by hand from the published ATO resident
 * rate tables (“$X plus Yc for each $1 over $Z”), the LITO and Medicare low-income formulas, and the
 * CGT method statement. Each fixture states its inputs and the rule year relied on.
 */
import { describe, expect, it } from 'vitest';
import { D } from '../../src/lib/decimal';
import { computeTaxYear, litoAmount, medicareLevy, netCapitalGain, taxOnBrackets } from '../../src/engines/tax/taxEngine';
import { ruleSetFor } from '../../src/engines/tax/rules';
import { builtinCategories } from '../../src/domain/reference';
import type { Transaction } from '../../src/domain/types';
import { account, instrument, profile, rate, txn, withFx } from './helpers';

const rs25 = ruleSetFor(2025)!;
const rs24 = ruleSetFor(2024)!;

describe('resident tax rates (ATO published tables)', () => {
  it('FY2024–25 (Stage 3) — ATO: $4,288 + 30c over $45,000', () => {
    expect(taxOnBrackets(D(80000), rs25.residentBrackets).toFixed(2)).toBe('14788.00');
    expect(taxOnBrackets(D(150000), rs25.residentBrackets).toFixed(2)).toBe('36838.00'); // $31,288 + 37c over $135,000
    expect(taxOnBrackets(D(200000), rs25.residentBrackets).toFixed(2)).toBe('56138.00'); // $51,638 + 45c over $190,000
    expect(taxOnBrackets(D(18200), rs25.residentBrackets).toFixed(2)).toBe('0.00');
  });
  it('FY2023–24 — ATO: $5,092 + 32.5c over $45,000', () => {
    expect(taxOnBrackets(D(80000), rs24.residentBrackets).toFixed(2)).toBe('16467.00');
  });
  it('non-resident FY2024–25 — 30% from the first dollar', () => {
    expect(taxOnBrackets(D(50000), rs25.nonResidentBrackets!).toFixed(2)).toBe('15000.00');
  });
  it('low income tax offset formula', () => {
    expect(litoAmount(D(30000), rs25).toFixed(2)).toBe('700.00');
    expect(litoAmount(D(40000), rs25).toFixed(2)).toBe('575.00'); // 700 − 5% × 2,500
    expect(litoAmount(D(50000), rs25).toFixed(2)).toBe('250.00'); // 325 − 1.5% × 5,000
    expect(litoAmount(D(70000), rs25).toFixed(2)).toBe('0.00');
  });
  it('Medicare levy with low-income shade-in (FY2024–25 single thresholds $27,222 / $34,027)', () => {
    expect(medicareLevy(D(20000), rs25, 'none').levy!.toFixed(2)).toBe('0.00');
    expect(medicareLevy(D(30000), rs25, 'none').levy!.toFixed(2)).toBe('277.80'); // 10% × (30,000 − 27,222)
    expect(medicareLevy(D(80000), rs25, 'none').levy!.toFixed(2)).toBe('1600.00');
    expect(medicareLevy(D(80000), rs25, 'half').levy!.toFixed(2)).toBe('800.00');
  });
  it('FY2026–27 Medicare thresholds are not confirmed, so the estimate is flagged unreliable for low incomes', () => {
    const rs27 = ruleSetFor(2027)!;
    expect(rs27.medicareLowIncome).toBeNull();
    expect(medicareLevy(D(30000), rs27, 'none').reliable).toBe(false);
  });
});

describe('CGT netting (ATO method statement)', () => {
  it('applies losses before the discount, non-discount gains first by default', () => {
    // Discount-eligible gain 10,000; other gain 1,000; current loss 500; prior net capital loss 3,000.
    const r = netCapitalGain(D(10000), D(1000), D(500), D(3000), D('0.5'), 'non_discount_first');
    // 500 + 500 against the 1,000 other gain; remaining 2,500 against discount gain → 7,500 × 50% = 3,750.
    expect(r.net.toFixed(2)).toBe('3750.00');
    expect(r.carryForward.toFixed(2)).toBe('0.00');
    expect(r.discount.toFixed(2)).toBe('3750.00');
  });
  it('carries forward unused losses', () => {
    const r = netCapitalGain(D(0), D(1000), D(4000), D(0), D('0.5'), 'non_discount_first');
    expect(r.net.toFixed(2)).toBe('0.00');
    expect(r.carryForward.toFixed(2)).toBe('3000.00');
  });
});

const cats = builtinCategories();
const base = (txns: Transaction[], extra: Partial<Parameters<typeof computeTaxYear>[0]> = {}) =>
  computeTaxYear({
    data: { transactions: txns, accounts: [account({ id: 'acc' })], instruments: [instrument({ id: 'ins', symbol: 'DEMOA' })], corporateActions: [] },
    fy: 2025,
    taxProfiles: [profile(2025)],
    assets: [],
    categories: cats,
    taxTz: 'Australia/Sydney',
    costBasisDefaults: {},
    lossOrdering: 'non_discount_first',
    now: '2025-07-01T00:00:00Z',
    ...extra
  });

describe('tax-year engine — complete scenarios (FY2024–25 resident)', () => {
  it('salary and wages with a deduction: refund estimate', () => {
    const r = base([
      txn({ kind: 'income', date: '2024-09-30', category: 'salary', taxClass: 'SALARY_WAGES', amount: '90000', taxWithheld: '20000' }),
      txn({ kind: 'expense', date: '2024-10-10', category: 'work_general', taxClass: 'DEDUCTIBLE_EXPENSE', amount: '1000', businessUsePct: '100' })
    ]);
    const get = (k: string) => r.estimate.find((l) => l.key === k)?.amount;
    expect(get('taxable_income')).toBe('89000');
    expect(D(get('gross_tax')!).toFixed(2)).toBe('17488.00'); // 4,288 + 30% × 44,000
    expect(D(get('lito')!).toFixed(2)).toBe('0.00');
    expect(D(get('medicare')!).toFixed(2)).toBe('1780.00');
    expect(D(get('net_payable')!).toFixed(2)).toBe('-732.00'); // 17,488 + 1,780 − 20,000
    expect(r.estimateStatus).toBe('estimate');
  });

  it('business income and expenses flow into net business income (GST-exclusive when registered)', () => {
    const r = base(
      [
        txn({ kind: 'income', date: '2024-08-01', category: 'business', taxClass: 'BUSINESS_INCOME', amount: '11000', isBusiness: true, gstTreatment: 'taxable', gstAmount: '1000' }),
        txn({ kind: 'expense', date: '2024-08-02', category: 'software', taxClass: 'BUSINESS_EXPENSE', amount: '2200', isBusiness: true, gstTreatment: 'taxable', gstAmount: '200', businessUsePct: '50' })
      ],
      { business: { id: 'b', name: 'Biz', activity: 'Consulting', gstRegistered: true, gstBasis: 'cash', basFrequency: 'quarterly', smallBusinessEntity: 'yes', updatedAt: '' } }
    );
    const v = (k: string) => D(r.business.find((l) => l.key === k)!.amount!).toFixed(2);
    expect(v('bus_income')).toBe('10000.00');
    expect(v('bus_expenses')).toBe('1000.00'); // (2,200 − 200) × 50%
    expect(v('bus_net')).toBe('9000.00');
    const q1 = r.bas.periods[0] as any;
    expect(q1.a1).toBe('1000');
    expect(q1.b1).toBe('100'); // GST credit limited to business use
  });

  it('dividends with franking credits are grossed up and offset', () => {
    const r = base([txn({ kind: 'income', date: '2024-09-20', category: 'dividend_au', taxClass: 'DIVIDEND', amount: '700', frankedAmount: '700', frankingCredit: '300' })]);
    expect(r.income.find((l) => l.key === 'franking_credits')!.amount).toBe('300');
    expect(r.totals.assessableIncome).toBe('1000');
    expect(r.offsetsAndCredits.find((l) => l.key === 'franking_offset')!.amount).toBe('300');
  });

  it('foreign dividends with withholding tax: gross income and FITO (de minimis)', () => {
    const rates = [rate('AUD', 'USD', '2024-11-15', '0.5')];
    const t = withFx(txn({ kind: 'income', date: '2024-11-15', category: 'dividend_foreign', taxClass: 'FOREIGN_INCOME', currency: 'USD', amount: '100', foreignTaxPaid: '15' }), rates);
    const r = base([t]);
    expect(r.foreign.find((l) => l.key === 'foreign_income')!.amount).toBe('200');
    expect(r.foreign.find((l) => l.key === 'foreign_tax')!.amount).toBe('30');
    expect(r.offsetsAndCredits.find((l) => l.key === 'fito')!.amount).toBe('30');
  });

  it('a foreign transaction without a historical rate blocks finalisation', () => {
    const r = base([txn({ kind: 'income', date: '2024-11-15', category: 'dividend_foreign', taxClass: 'FOREIGN_INCOME', currency: 'USD', amount: '100' })]);
    expect(r.issues.find((i) => i.code === 'MISSING_RATE')?.severity).toBe('blocking');
    expect(r.estimateStatus).toBe('incomplete');
    expect(r.readiness.status).toBe('incomplete');
  });

  it('CGT discount: shares held more than 12 months (ATO day-count) — 50% discount', () => {
    const r = base([
      txn({ kind: 'trade', side: 'buy', date: '2023-07-01', accountId: 'acc', instrumentId: 'ins', quantity: '1000', price: '10', commission: '20' }),
      txn({ kind: 'trade', side: 'sell', date: '2024-07-02', accountId: 'acc', instrumentId: 'ins', quantity: '1000', price: '15', commission: '20' })
    ]);
    // proceeds 14,980; cost base 10,020; gain 4,960; discount 2,480
    expect(r.capital.discountableGains).toBe('4960');
    expect(r.capital.netCapitalGain).toBe('2480');
    expect(r.disposals[0].allocations[0].discountEligible).toBe(true);
  });

  it('no CGT discount when disposed on the 12-month anniversary', () => {
    const r = base([
      txn({ kind: 'trade', side: 'buy', date: '2023-07-01', accountId: 'acc', instrumentId: 'ins', quantity: '1000', price: '10', commission: '20' }),
      txn({ kind: 'trade', side: 'sell', date: '2024-07-01', accountId: 'acc', instrumentId: 'ins', quantity: '1000', price: '15', commission: '20' })
    ]);
    expect(r.capital.nonDiscountableGains).toBe('4960');
    expect(r.capital.netCapitalGain).toBe('4960');
  });

  it('non-residents do not receive the CGT discount', () => {
    const r = base(
      [
        txn({ kind: 'trade', side: 'buy', date: '2022-07-01', accountId: 'acc', instrumentId: 'ins', quantity: '10', price: '10' }),
        txn({ kind: 'trade', side: 'sell', date: '2024-08-01', accountId: 'acc', instrumentId: 'ins', quantity: '10', price: '20' })
      ],
      { taxProfiles: [profile(2025, { residency: 'non_resident' })] }
    );
    expect(r.capital.netCapitalGain).toBe('100');
    expect(r.issues.some((i) => i.code === 'DISCOUNT_WITHHELD')).toBe(true);
  });

  it('capital losses carried forward from a prior year are applied (computed chain)', () => {
    const r = base([
      txn({ kind: 'trade', side: 'buy', date: '2023-08-01', accountId: 'acc', instrumentId: 'ins', quantity: '100', price: '50' }),
      txn({ kind: 'trade', side: 'sell', date: '2024-01-15', accountId: 'acc', instrumentId: 'ins', quantity: '100', price: '20' }), // FY2024 loss 3,000
      txn({ kind: 'trade', side: 'buy', date: '2024-08-01', accountId: 'acc', instrumentId: 'ins', quantity: '100', price: '10' }),
      txn({ kind: 'trade', side: 'sell', date: '2024-12-01', accountId: 'acc', instrumentId: 'ins', quantity: '100', price: '50' }) // FY2025 gain 4,000 (non-discount)
    ]);
    expect(r.capital.priorYearLossesAvailable).toBe('3000');
    expect(r.capital.netCapitalGain).toBe('1000');
    expect(r.capital.lossesCarriedForward).toBe('0');
  });

  it('an explicit opening capital-loss balance overrides the computed chain', () => {
    const r = base(
      [
        txn({ kind: 'trade', side: 'buy', date: '2024-08-01', accountId: 'acc', instrumentId: 'ins', quantity: '100', price: '10' }),
        txn({ kind: 'trade', side: 'sell', date: '2024-12-01', accountId: 'acc', instrumentId: 'ins', quantity: '100', price: '50' })
      ],
      { taxProfiles: [profile(2025, { openingCapitalLosses: '5000' })] }
    );
    expect(r.capital.netCapitalGain).toBe('0');
    expect(r.capital.lossesCarriedForward).toBe('1000');
  });

  it('unresolved prop-firm payouts are excluded and listed for review; classified payouts are business income', () => {
    const p = txn({ kind: 'income', date: '2024-12-15', category: 'prop_payout', taxClass: 'REVIEW', amount: '2400' });
    const r1 = base([p]);
    expect(r1.reviewItems.map((i) => i.txnId)).toContain(p.id);
    expect(r1.totals.assessableIncome).toBe('0');
    const r2 = base([{ ...p, taxClass: 'BUSINESS_INCOME' }]);
    expect(r2.business.find((l) => l.key === 'bus_income')!.amount).toBe('2400');
  });

  it('unknown residency means no tax estimate is shown', () => {
    const r = base([txn({ kind: 'income', date: '2024-09-30', category: 'salary', taxClass: 'SALARY_WAGES', amount: '1000' })], { taxProfiles: [] });
    expect(r.estimateStatus).toBe('not_available');
    expect(r.estimate.find((l) => l.key === 'net_payable')).toBeUndefined();
  });
});
