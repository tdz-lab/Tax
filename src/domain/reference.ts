/** Static reference data: labels, currency registry, built-in categories. */
import type { AccountTaxTreatment, AccountType, AssetClass, Category, Side, TaxClass, TxnKind } from './types';

export const TAX_CLASS_INFO: Record<TaxClass, { label: string; group: 'income' | 'capital' | 'expense' | 'neutral' | 'review'; help: string }> = {
  SALARY_WAGES: { label: 'Salary & wages', group: 'income', help: 'Assessable employment income (item 1).' },
  ALLOWANCE_BONUS: { label: 'Allowances, bonuses', group: 'income', help: 'Assessable allowances, earnings, tips, bonuses (item 2).' },
  ETP: { label: 'Employment termination payment', group: 'income', help: 'ETP components need the payment summary; concessional treatment requires review.' },
  GOVERNMENT_PAYMENT: { label: 'Government payment', group: 'income', help: 'Some government payments are assessable, some are exempt — check the payment type.' },
  INTEREST: { label: 'Interest', group: 'income', help: 'Gross interest (item 10).' },
  DIVIDEND: { label: 'Dividend', group: 'income', help: 'Franked/unfranked dividends plus franking credits (item 11).' },
  TRUST_DISTRIBUTION: { label: 'Trust / managed-fund distribution', group: 'income', help: 'Use the annual tax statement components (item 13/18/20).' },
  FOREIGN_INCOME: { label: 'Foreign income', group: 'income', help: 'Assessable foreign-source income, gross of foreign tax (item 20).' },
  RENTAL_INCOME: { label: 'Rental income', group: 'income', help: 'Gross rent (item 21).' },
  ORDINARY_INCOME: { label: 'Other ordinary income', group: 'income', help: 'Other assessable ordinary income (item 24).' },
  BUSINESS_INCOME: { label: 'Business income', group: 'income', help: 'Sole-trader / business income (business schedule).' },
  CRYPTO_INCOME: { label: 'Crypto income (staking, mining, rewards)', group: 'income', help: 'Ordinary income at market value when derived; the received tokens get that value as cost base.' },
  CGT_EVENT: { label: 'Capital (CGT event)', group: 'capital', help: 'Gain or loss calculated by the CGT engine from acquisition lots.' },
  REVENUE_TRADING: { label: 'Revenue trading gain/loss', group: 'income', help: 'Realised gains are ordinary income and losses deductible (trader / profit-making). No CGT discount.' },
  TRADING_STOCK: { label: 'Trading stock', group: 'income', help: 'Held as trading stock of a business — Div 70 closing-stock valuation applies (review).' },
  DEDUCTIBLE_EXPENSE: { label: 'Potentially deductible (personal)', group: 'expense', help: 'Work-related or investment expense — subject to substantiation and nexus tests.' },
  BUSINESS_EXPENSE: { label: 'Business expense', group: 'expense', help: 'Business operating expense, net of private use and GST credits.' },
  FINANCING_EXPENSE: { label: 'Financing / interest expense', group: 'expense', help: 'Interest, swap and funding charges — deductibility depends on purpose.' },
  COST_BASE_INCLUDED: { label: 'Included in cost base / proceeds', group: 'neutral', help: 'Incidental cost (e.g. brokerage) absorbed into a CGT cost base or reducing proceeds — not separately deductible.' },
  NON_DEDUCTIBLE: { label: 'Not deductible', group: 'neutral', help: 'Private or capital expense with no deduction.' },
  TAX_DEFERRED: { label: 'Tax-deferred / return of capital', group: 'neutral', help: 'Non-assessable; reduces the CGT cost base of the asset.' },
  NON_ASSESSABLE: { label: 'Non-assessable / exempt', group: 'neutral', help: 'Exempt or non-assessable non-exempt income.' },
  TRANSFER_NO_DISPOSAL: { label: 'Own transfer (no disposal)', group: 'neutral', help: 'Movement between your own accounts/wallets — no change in ownership.' },
  NON_TAXABLE: { label: 'Non-taxable movement', group: 'neutral', help: 'Deposits, withdrawals and other movements with no tax effect.' },
  SIMULATED: { label: 'Simulated (prop evaluation)', group: 'neutral', help: 'Simulated trading — no real gain or loss; excluded from tax.' },
  REVIEW: { label: 'Needs specialist review', group: 'review', help: 'Treatment depends on circumstances — confirm with a registered tax agent.' },
  UNCLASSIFIED: { label: 'Unclassified', group: 'review', help: 'No tax classification has been assigned.' }
};

export const ACCOUNT_TYPE_LABEL: Record<AccountType, string> = {
  au_broker: 'Australian share broker',
  us_broker: 'US share broker',
  intl_broker: 'International broker',
  crypto_exchange: 'Crypto exchange',
  crypto_wallet: 'Crypto wallet (self-custody)',
  futures: 'Futures account',
  forex: 'Forex account',
  cfd: 'CFD account',
  options: 'Options account',
  prop_evaluation: 'Prop-firm evaluation',
  prop_funded: 'Prop-firm funded account',
  bank: 'Bank account',
  cash: 'Cash / other',
  income_source: 'Income source (affiliate, CPA network, marketplace…)',
  payment: 'Payment account (PayPal, Stripe, Wise…)',
  other: 'Other'
};

export const TREATMENT_LABEL: Record<AccountTaxTreatment, string> = {
  investor_cgt: 'Investor — capital account (CGT)',
  business_trader: 'Carrying on a business of trading (revenue)',
  profit_making: 'Isolated profit-making undertaking (revenue)',
  unresolved: 'Not yet determined — review required',
  not_applicable: 'Not applicable (bank / cash)'
};

export const ASSET_CLASS_LABEL: Record<AssetClass, string> = {
  au_share: 'Australian share',
  us_share: 'US share',
  intl_share: 'International share',
  etf: 'ETF',
  managed_fund: 'Managed fund',
  crypto: 'Cryptocurrency / token',
  stablecoin: 'Stablecoin',
  nft: 'NFT',
  forex: 'Forex position',
  future: 'Futures contract',
  option: 'Option',
  cfd: 'CFD',
  bond: 'Bond / fixed income',
  other: 'Other'
};

/** Asset classes held as discrete CGT assets with acquisition lots. */
export const LOT_ASSET_CLASSES: AssetClass[] = ['au_share', 'us_share', 'intl_share', 'etf', 'managed_fund', 'crypto', 'stablecoin', 'nft', 'bond', 'other', 'option'];
/** Position-based derivatives: realised P&L from matched opens/closes. */
export const DERIVATIVE_CLASSES: AssetClass[] = ['future', 'cfd', 'forex'];

export const KIND_LABEL: Record<TxnKind, string> = {
  income: 'Income',
  expense: 'Expense',
  trade: 'Trade',
  transfer: 'Transfer',
  cash: 'Deposit / withdrawal',
  fee: 'Fee',
  adjustment: 'Adjustment'
};

export const SIDE_LABEL: Record<Side, string> = {
  buy: 'Buy',
  sell: 'Sell',
  short: 'Sell short / write',
  cover: 'Buy to cover / close',
  swap: 'Swap (crypto→crypto)',
  receive: 'Receive',
  send: 'Send',
  deposit: 'Deposit',
  withdrawal: 'Withdrawal',
  income: 'Income',
  fee: 'Fee',
  realised_pnl: 'Realised P&L (statement)',
  financing: 'Financing / swap charge',
  settlement: 'Settlement',
  expire: 'Expiry',
  exercise: 'Exercise',
  assign: 'Assignment',
  adjustment: 'Adjustment',
  other: 'Other'
};

export interface CurrencyInfo {
  code: string;
  name: string;
  decimals: number;
  type: 'fiat' | 'crypto';
}

/** ISO 4217 fiat registry (commonly used subset; extensible via Settings → Currencies). */
export const FIAT_CURRENCIES: CurrencyInfo[] = [
  ['AUD', 'Australian dollar', 2], ['USD', 'US dollar', 2], ['EUR', 'Euro', 2], ['GBP', 'Pound sterling', 2],
  ['NZD', 'New Zealand dollar', 2], ['CAD', 'Canadian dollar', 2], ['JPY', 'Japanese yen', 0], ['CHF', 'Swiss franc', 2],
  ['SGD', 'Singapore dollar', 2], ['HKD', 'Hong Kong dollar', 2], ['CNY', 'Chinese yuan renminbi', 2], ['INR', 'Indian rupee', 2],
  ['KRW', 'South Korean won', 0], ['TWD', 'New Taiwan dollar', 2], ['THB', 'Thai baht', 2], ['MYR', 'Malaysian ringgit', 2],
  ['IDR', 'Indonesian rupiah', 2], ['PHP', 'Philippine peso', 2], ['VND', 'Vietnamese dong', 0], ['SEK', 'Swedish krona', 2],
  ['NOK', 'Norwegian krone', 2], ['DKK', 'Danish krone', 2], ['PLN', 'Polish zloty', 2], ['CZK', 'Czech koruna', 2],
  ['HUF', 'Hungarian forint', 2], ['ZAR', 'South African rand', 2], ['AED', 'UAE dirham', 2], ['SAR', 'Saudi riyal', 2],
  ['ILS', 'Israeli new shekel', 2], ['TRY', 'Turkish lira', 2], ['MXN', 'Mexican peso', 2], ['BRL', 'Brazilian real', 2],
  ['CLP', 'Chilean peso', 0], ['COP', 'Colombian peso', 2], ['PGK', 'Papua New Guinean kina', 2], ['FJD', 'Fiji dollar', 2]
].map(([code, name, decimals]) => ({ code: code as string, name: name as string, decimals: decimals as number, type: 'fiat' as const }));

export const FIAT_CODES = new Set(FIAT_CURRENCIES.map((c) => c.code));

export function isFiat(code: string, custom: string[] = []): boolean {
  return FIAT_CODES.has(code.toUpperCase()) || custom.includes(code.toUpperCase());
}

type CatSeed = [code: string, name: string, group: string, taxClass: TaxClass, deductPct?: string, guidance?: string];

const INCOME_CATS: CatSeed[] = [
  ['salary', 'Salary and wages', 'Employment', 'SALARY_WAGES'],
  ['allowance', 'Allowances and bonuses', 'Employment', 'ALLOWANCE_BONUS'],
  ['etp', 'Employment termination payment', 'Employment', 'ETP', undefined, 'ETP components require the ETP payment summary; treatment needs review.'],
  ['govt', 'Government payments', 'Government', 'GOVERNMENT_PAYMENT'],
  ['interest', 'Interest income', 'Investment', 'INTEREST'],
  ['dividend_au', 'Australian dividends', 'Investment', 'DIVIDEND'],
  ['distribution', 'Managed-fund / ETF distributions', 'Investment', 'TRUST_DISTRIBUTION', undefined, 'Enter components from the AMMA / annual tax statement.'],
  ['dividend_foreign', 'Foreign dividends and distributions', 'Foreign', 'FOREIGN_INCOME'],
  ['interest_foreign', 'Foreign interest', 'Foreign', 'FOREIGN_INCOME'],
  ['foreign_other', 'Other foreign income', 'Foreign', 'FOREIGN_INCOME'],
  ['rent', 'Rental income', 'Property', 'RENTAL_INCOME'],
  ['business', 'Business income', 'Business', 'BUSINESS_INCOME'],
  ['prop_payout', 'Prop-firm payout', 'Trading', 'REVIEW', undefined, 'Payout characterisation depends on the arrangement (business income vs other). Classify explicitly.'],
  ['prop_refund', 'Prop-firm fee refund', 'Trading', 'REVIEW', undefined, 'A refund of a previously deducted fee is generally assessable; of a non-deducted fee generally not.'],
  ['crypto_staking', 'Crypto staking rewards', 'Crypto', 'CRYPTO_INCOME'],
  ['crypto_mining', 'Crypto mining', 'Crypto', 'REVIEW', undefined, 'Hobby vs business mining has different treatment.'],
  ['crypto_airdrop', 'Crypto airdrop', 'Crypto', 'REVIEW', undefined, 'Established-token airdrops are generally ordinary income; initial-allocation airdrops are generally not. Review.'],
  ['crypto_fork', 'Crypto fork (chain split)', 'Crypto', 'NON_ASSESSABLE', undefined, 'Generally not income for investors; new tokens have a nil cost base. Review.'],
  ['crypto_lending', 'Crypto lending / DeFi yield', 'Crypto', 'REVIEW'],
  ['other', 'Other income', 'Other', 'ORDINARY_INCOME']
];

const EXPENSE_CATS: CatSeed[] = [
  ['work_general', 'Work-related expenses', 'Work-related', 'DEDUCTIBLE_EXPENSE', '100', 'Must relate directly to earning employment income; reimbursed amounts are not deductible.'],
  ['work_vehicle', 'Work-related vehicle expenses', 'Work-related', 'DEDUCTIBLE_EXPENSE', '100', 'Cents-per-km or logbook method; normal commuting is private.'],
  ['work_travel', 'Work-related travel', 'Work-related', 'DEDUCTIBLE_EXPENSE', '100'],
  ['home_office', 'Home office expenses', 'Work-related', 'DEDUCTIBLE_EXPENSE', '100', 'Fixed-rate or actual-cost method; keep a record of hours.'],
  ['work_equipment', 'Work-related equipment', 'Work-related', 'REVIEW', '100', 'Items over $300 are generally depreciated — record in the asset register.'],
  ['education', 'Self-education and training', 'Work-related', 'DEDUCTIBLE_EXPENSE', '100'],
  ['memberships', 'Professional memberships / union fees', 'Work-related', 'DEDUCTIBLE_EXPENSE', '100'],
  ['tax_agent', 'Accounting and tax agent fees', 'Cost of managing tax affairs', 'DEDUCTIBLE_EXPENSE', '100'],
  ['donations', 'Gifts and donations', 'Donations', 'DEDUCTIBLE_EXPENSE', '100', 'Only to deductible gift recipients (DGR) and $2 or more; no material benefit.'],
  ['investment', 'Investment-related expenses', 'Investment', 'DEDUCTIBLE_EXPENSE', '100'],
  ['business_operating', 'Business operating expenses', 'Business', 'BUSINESS_EXPENSE', '100'],
  ['software', 'Software and subscriptions', 'Business', 'BUSINESS_EXPENSE', '100'],
  ['trading_fees', 'Trading fees and commissions (standalone)', 'Trading', 'REVIEW', '100', 'Brokerage on CGT assets forms part of cost base/proceeds; for traders it is a revenue deduction.'],
  ['data_feeds', 'Market data / trading platform fees', 'Trading', 'REVIEW', '100'],
  ['prop_eval_fee', 'Prop-firm evaluation / challenge fee', 'Trading', 'REVIEW', '100', 'Deductibility depends on whether a business is carried on. Classify explicitly.'],
  ['prop_reset_fee', 'Prop-firm reset fee', 'Trading', 'REVIEW', '100'],
  ['prop_subscription', 'Prop-firm subscription / platform fee', 'Trading', 'REVIEW', '100'],
  ['prop_withdrawal_fee', 'Prop-firm withdrawal / termination fee', 'Trading', 'REVIEW', '100'],
  ['bank_fees', 'Bank and transaction fees', 'Financial', 'REVIEW', '0'],
  ['interest_expense', 'Interest and financing costs', 'Financial', 'FINANCING_EXPENSE', '100'],
  ['depreciation', 'Depreciation and capital allowances', 'Assets', 'REVIEW', '100', 'Calculated in the asset register — avoid double counting.'],
  ['rental_expense', 'Rental property expenses', 'Property', 'DEDUCTIBLE_EXPENSE', '100'],
  ['personal', 'Private / personal', 'Private', 'NON_DEDUCTIBLE', '0'],
  ['other', 'Other potentially deductible', 'Other', 'REVIEW', '100']
];

export function builtinCategories(): Category[] {
  const mk = (type: 'income' | 'expense', s: CatSeed): Category => ({
    id: `cat_${type}_${s[0]}`,
    type,
    code: s[0],
    name: s[1],
    group: s[2],
    defaultTaxClass: s[3],
    defaultDeductiblePct: s[4],
    guidance: s[5],
    builtin: true
  });
  return [...INCOME_CATS.map((c) => mk('income', c)), ...EXPENSE_CATS.map((c) => mk('expense', c))];
}

/** Category codes for trading-generated records. */
export const TRADING_CATEGORY = 'trading';
