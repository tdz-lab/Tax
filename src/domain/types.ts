/**
 * Core domain model. Monetary values and quantities are decimal strings.
 * Dates: `date` fields are local calendar dates (YYYY-MM-DD); `...At` fields are UTC ISO instants.
 */
import type { FYear } from '../lib/dates';

export type ID = string;
export type DecStr = string;

// ---------- Tax classifications ----------
export const TAX_CLASSES = [
  'SALARY_WAGES',
  'ALLOWANCE_BONUS',
  'ETP',
  'GOVERNMENT_PAYMENT',
  'INTEREST',
  'DIVIDEND',
  'TRUST_DISTRIBUTION',
  'FOREIGN_INCOME',
  'RENTAL_INCOME',
  'ORDINARY_INCOME',
  'BUSINESS_INCOME',
  'CRYPTO_INCOME',
  'CGT_EVENT',
  'REVENUE_TRADING',
  'TRADING_STOCK',
  'DEDUCTIBLE_EXPENSE',
  'BUSINESS_EXPENSE',
  'FINANCING_EXPENSE',
  'COST_BASE_INCLUDED',
  'NON_DEDUCTIBLE',
  'TAX_DEFERRED',
  'NON_ASSESSABLE',
  'TRANSFER_NO_DISPOSAL',
  'NON_TAXABLE',
  'SIMULATED',
  'REVIEW',
  'UNCLASSIFIED'
] as const;
export type TaxClass = (typeof TAX_CLASSES)[number];

export type TaxClassSource = 'user' | 'rule' | 'category' | 'account' | 'import' | 'default';

// ---------- Accounts / instruments ----------
export const ACCOUNT_TYPES = [
  'au_broker',
  'us_broker',
  'intl_broker',
  'crypto_exchange',
  'crypto_wallet',
  'futures',
  'forex',
  'cfd',
  'options',
  'prop_evaluation',
  'prop_funded',
  'bank',
  'cash',
  'other'
] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

/** How gains in the account are treated for Australian tax purposes. Must be chosen explicitly. */
export type AccountTaxTreatment = 'investor_cgt' | 'business_trader' | 'profit_making' | 'unresolved' | 'not_applicable';
export type PropStatus = 'none' | 'evaluation' | 'funded_simulated' | 'funded_live';

export interface Account {
  id: ID;
  name: string;
  type: AccountType;
  institution: string;
  accountRef?: string; // masked identifier only
  currency: string;
  country?: string;
  taxTreatment: AccountTaxTreatment;
  costBasisMethod?: CostBasisMethod;
  propStatus: PropStatus;
  profitSharePct?: DecStr;
  payoutCurrency?: string;
  openingBalance?: DecStr;
  openingBalanceDate?: string;
  notes?: string;
  archived?: boolean;
  isDemo?: boolean;
  createdAt: string;
  updatedAt: string;
}

export const ASSET_CLASSES = [
  'au_share',
  'us_share',
  'intl_share',
  'etf',
  'managed_fund',
  'crypto',
  'stablecoin',
  'nft',
  'forex',
  'future',
  'option',
  'cfd',
  'bond',
  'other'
] as const;
export type AssetClass = (typeof ASSET_CLASSES)[number];

export interface Instrument {
  id: ID;
  symbol: string;
  name: string;
  assetClass: AssetClass;
  market?: string; // exchange / venue, e.g. ASX, NASDAQ, CME
  currency: string; // pricing currency
  country?: string;
  multiplier?: DecStr; // contract multiplier (futures/options/CFD contract size)
  tickSize?: DecStr;
  tickValue?: DecStr;
  expiry?: string;
  underlying?: string;
  strike?: DecStr;
  optionType?: 'call' | 'put';
  pegCurrency?: string; // stablecoins: documented peg only — never assumed as a rate
  isSpam?: boolean;
  isin?: string;
  notes?: string;
  isDemo?: boolean;
  createdAt: string;
  updatedAt: string;
}

// ---------- Currency conversion ----------
export type RateType = 'daily_reference' | 'execution' | 'intraday' | 'manual' | 'price';

/** One historical rate: 1 unit of `base` = `rate` units of `quote`. */
export interface RateRecord {
  id: ID;
  base: string;
  quote: string;
  rate: DecStr;
  date: string; // date the rate applies to (in `timeZone`, if given)
  timestamp?: string; // UTC instant for intraday / execution rates
  timeZone?: string;
  type: RateType;
  source: string;
  sourceRef?: string;
  retrievedAt?: string;
  importBatchId?: ID;
  notes?: string;
  createdAt: string;
}

export interface Conversion {
  /** AUD per 1 unit of the transaction currency (canonical direction used for all AUD maths). */
  audPerUnit: DecStr;
  /** The rate exactly as recorded by its source and the direction it was quoted in. */
  sourceRate: DecStr;
  sourceDirection: string; // e.g. "USD per 1 AUD"
  rateRecordIds: ID[];
  source: string;
  rateType: RateType | 'cross';
  rateDate: string;
  rateTimestamp?: string;
  timeZone?: string;
  retrievedAt?: string;
  methodology: string;
  isManualOverride: boolean;
  overrideReason?: string;
  overrideSource?: string;
  staleDays?: number; // >0 when a prior-day rate was used under the configured methodology
  computedAt: string;
}

export interface ConversionHistoryEntry extends Conversion {
  replacedAt: string;
  replacedReason: string;
}

// ---------- Transactions ----------
export const TXN_KINDS = ['income', 'expense', 'trade', 'transfer', 'cash', 'fee', 'adjustment'] as const;
export type TxnKind = (typeof TXN_KINDS)[number];

export const SIDES = [
  'buy',
  'sell',
  'short',
  'cover',
  'swap',
  'receive',
  'send',
  'deposit',
  'withdrawal',
  'income',
  'fee',
  'realised_pnl',
  'financing',
  'settlement',
  'expire',
  'exercise',
  'assign',
  'adjustment',
  'other'
] as const;
export type Side = (typeof SIDES)[number];

export type AdjustmentType = 'lost' | 'stolen' | 'spam' | 'correction' | 'opening_balance' | 'other';

export interface Split {
  category: string;
  amount: DecStr;
  businessUsePct?: DecStr;
  taxClass?: TaxClass;
  note?: string;
}

export interface LotPick {
  lotId: ID;
  quantity: DecStr;
}

export type ReconStatus = 'unreconciled' | 'reconciled' | 'disputed' | 'not_required';
export type GstTreatment = 'none' | 'taxable' | 'gst_free' | 'input_taxed' | 'imported_service' | 'review';

export interface Transaction {
  id: ID;
  kind: TxnKind;
  status: 'active' | 'deleted';
  // --- dates ---
  date: string; // local date in the taxpayer's time zone (drives FY)
  time?: string; // HH:mm:ss wall clock in `timeZone`
  timeZone: string; // IANA zone the timestamp was recorded in
  occurredAt: string; // UTC instant
  settlementDate?: string;
  taxEventDate?: string; // override when the tax event date differs from the trade date
  fy: FYear;
  // --- classification ---
  category: string;
  subcategory?: string;
  taxClass: TaxClass;
  taxClassSource: TaxClassSource;
  description: string;
  counterparty?: string;
  counterpartyId?: ID;
  paymentMethod?: string;
  notes?: string;
  tags: string[];
  // --- money (original currency) ---
  currency: string;
  amount: DecStr; // gross amount (income received / expense paid / cash moved / trade gross consideration)
  fx?: Conversion; // conversion of `currency` into AUD
  fxHistory?: ConversionHistoryEntry[];
  providedAudAmount?: DecStr; // AUD amount stated by the source (broker / statement); kept for reconciliation
  // tax specifics
  taxWithheld?: DecStr; // PAYG withheld (AUD)
  foreignTaxPaid?: DecStr; // in `currency`
  frankingCredit?: DecStr; // AUD
  frankedAmount?: DecStr; // AUD
  unfrankedAmount?: DecStr; // AUD
  taxDeferredAmount?: DecStr; // non-assessable component (in `currency`)
  capitalGainComponent?: DecStr; // trust distribution capital gain component (AUD)
  // Trust annual tax statement (AMMA) capital-gain components (AUD). When any is present they
  // replace `capitalGainComponent`: the discounted amount is grossed up ×2 (with the CGT concession amount).
  cgDiscountedComponent?: DecStr; // discounted capital gain (after the trust's 50% discount)
  cgIndexationComponent?: DecStr;
  cgOtherComponent?: DecStr;
  exDividendDate?: string; // dividends: for the 45-day holding period check
  businessUsePct?: DecStr; // 0–100, defaults 100 for business, per-category for personal
  isBusiness?: boolean;
  gstTreatment?: GstTreatment;
  gstAmount?: DecStr; // in `currency`
  splits?: Split[];
  // --- trading ---
  accountId?: ID;
  instrumentId?: ID;
  side?: Side;
  quantity?: DecStr;
  price?: DecStr;
  multiplier?: DecStr;
  commission?: DecStr;
  exchangeFees?: DecStr;
  financingCosts?: DecStr;
  otherFees?: DecStr;
  feeCurrency?: string;
  feeFx?: Conversion;
  counterInstrumentId?: ID; // swap: asset received
  counterQuantity?: DecStr;
  valuationAud?: DecStr; // AUD market value of the event (swaps, crypto income) — with provenance
  valuationSource?: string;
  positionRef?: string; // links derivative opens/closes
  costBasisMethod?: CostBasisMethod;
  specificLots?: LotPick[];
  transferPairId?: ID;
  isOwnTransfer?: boolean;
  feeQuantity?: DecStr; // network fee paid in the asset (transfers)
  adjustmentType?: AdjustmentType;
  assetId?: ID;
  // --- provenance ---
  source: 'manual' | 'import' | 'demo' | 'recurring' | 'generated';
  importBatchId?: ID;
  sourceId?: string;
  fingerprint?: string;
  rawRowId?: ID;
  documentIds: ID[];
  relatedIds: ID[];
  reconStatus: ReconStatus;
  reviewFlags: string[];
  recurringId?: ID;
  isDemo?: boolean;
  createdAt: string;
  updatedAt: string;
  version: number;
}

// ---------- Cost basis ----------
export type CostBasisMethod = 'FIFO' | 'LIFO' | 'HIFO' | 'SPECIFIC';

// ---------- Corporate actions ----------
export type CorporateActionType =
  | 'split'
  | 'reverse_split'
  | 'bonus'
  | 'merger_rollover'
  | 'merger_taxable'
  | 'spinoff'
  | 'return_of_capital'
  | 'symbol_change'
  | 'other';

export interface CorporateAction {
  id: ID;
  instrumentId: ID;
  type: CorporateActionType;
  date: string;
  ratioFrom: DecStr; // e.g. 1 old
  ratioTo: DecStr; // e.g. 4 new (4-for-1 split)
  newInstrumentId?: ID;
  costBaseAllocationPct?: DecStr; // % of cost base moved to the new instrument (spin-off / demerger)
  cashPerUnit?: DecStr; // return of capital / cash component (AUD)
  notes?: string;
  documentIds: ID[];
  createdAt: string;
  updatedAt: string;
}

// ---------- Profiles ----------
export type YesNoUnknown = 'yes' | 'no' | 'unknown';

export interface TaxProfile {
  id: ID; // `tp_${fy}`
  fy: FYear;
  residency: 'resident' | 'non_resident' | 'working_holiday' | 'part_year' | 'unknown';
  medicareExemption: 'none' | 'full' | 'half' | 'unknown';
  privateHospitalCover: YesNoUnknown;
  spouse: YesNoUnknown;
  dependants?: number;
  helpDebt: YesNoUnknown;
  openingCapitalLosses?: DecStr; // net capital losses carried in from years not recorded in the app
  openingRevenueLosses?: DecStr; // prior-year tax losses (revenue) carried into this year
  paygInstalments?: DecStr;
  // --- added v1.2: inputs for part-year residency, Medicare family test, MLS and HELP ---
  residentMonths?: number; // part-year residents: months resident (1–11)
  spouseTaxableIncome?: DecStr; // spouse's taxable income (Medicare levy family test)
  spouseMlsIncome?: DecStr; // spouse's income for MLS purposes
  reportableFringeBenefits?: DecStr;
  reportableSuperContributions?: DecStr;
  netInvestmentLoss?: DecStr; // total net financial investment loss + net rental property loss (positive number)
  exemptForeignEmploymentIncome?: DecStr;
  daysWithoutCover?: number; // days in the year without appropriate private hospital cover
  helpBalance?: DecStr; // study-loan balance at 1 June (caps the compulsory repayment)
  forexLimitedBalanceElection?: YesNoUnknown; // Div 775 limited balance election in force

  otherOffsets?: DecStr;
  otherOffsetsNote?: string;
  notes?: string;
  updatedAt: string;
}

export interface UserProfile {
  id: 'user';
  fullName: string;
  tfnLast3?: string; // never store the full TFN
  dateOfBirth?: string;
  email?: string;
  phone?: string;
  address?: string;
  taxAgent?: string;
  updatedAt: string;
}

export interface BusinessProfile {
  id: ID;
  name: string;
  tradingName?: string;
  abn?: string;
  activity: string;
  startDate?: string;
  gstRegistered: boolean;
  gstRegisteredFrom?: string;
  gstBasis: 'cash' | 'accrual';
  basFrequency: 'monthly' | 'quarterly' | 'annual';
  smallBusinessEntity: YesNoUnknown;
  notes?: string;
  updatedAt: string;
}

// ---------- Business records ----------
export type DepreciationMethod = 'prime_cost' | 'diminishing_value' | 'instant_write_off' | 'low_value_pool' | 'none';

export interface Asset {
  id: ID;
  name: string;
  category: string;
  acquisitionDate: string;
  installedReadyDate?: string;
  cost: DecStr; // AUD (GST-exclusive if GST credit claimed)
  method: DepreciationMethod;
  effectiveLifeYears?: DecStr;
  businessUsePct: DecStr;
  openingAdjustableValue?: DecStr;
  openingValueFY?: FYear;
  disposalDate?: string;
  disposalProceeds?: DecStr;
  linkedAccountId?: ID;
  documentIds: ID[];
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface LogEntry {
  id: ID;
  type: 'vehicle' | 'travel' | 'home_office';
  date: string;
  fy: FYear;
  description: string;
  vehicle?: string;
  odometerStart?: DecStr;
  odometerEnd?: DecStr;
  km?: DecStr;
  hours?: DecStr;
  from?: string;
  to?: string;
  purpose: string;
  isBusiness: boolean;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface InventoryRecord {
  id: ID;
  fy: FYear;
  description: string;
  openingValue: DecStr;
  closingValue: DecStr;
  valuationMethod: 'cost' | 'market_selling_value' | 'replacement_value';
  notes?: string;
  updatedAt: string;
}

export interface Counterparty {
  id: ID;
  name: string;
  type: 'payer' | 'employer' | 'supplier' | 'customer' | 'broker' | 'exchange' | 'prop_firm' | 'bank' | 'government' | 'other';
  abn?: string;
  country?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Category {
  id: ID;
  type: 'income' | 'expense';
  code: string;
  name: string;
  group: string;
  defaultTaxClass: TaxClass;
  defaultDeductiblePct?: DecStr;
  guidance?: string;
  builtin: boolean;
  archived?: boolean;
}

export interface Recurring {
  id: ID;
  name: string;
  template: Partial<Transaction>;
  frequency: 'weekly' | 'fortnightly' | 'monthly' | 'quarterly' | 'annually';
  startDate: string;
  endDate?: string;
  lastGeneratedDate?: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

// ---------- Documents ----------
export interface DocumentMeta {
  id: ID;
  title: string;
  docType: 'receipt' | 'invoice' | 'statement' | 'payment_summary' | 'contract' | 'payout_statement' | 'tax_statement' | 'other';
  date?: string;
  fy?: FYear;
  linkedRecordIds: ID[];
  notes?: string;
  originalFilename: string;
  mimeType: string;
  size: number;
  sha256: string;
  importedAt: string;
  storageStatus: 'stored' | 'metadata_only' | 'missing';
  extracted?: Record<string, string>;
  isDemo?: boolean;
}

export interface DocumentBlob {
  id: ID; // same as DocumentMeta.id
  data: ArrayBuffer;
}

// ---------- Imports ----------
export type ImportTarget = 'income' | 'expense' | 'bank' | 'trade' | 'transfer' | 'dividend' | 'prop' | 'rates';

export interface ImportTemplate {
  id: ID;
  name: string;
  target: ImportTarget;
  description?: string;
  delimiter?: string;
  skipRows?: number;
  dateFormat: string; // luxon format or 'auto'
  timeZone: string;
  decimalSeparator: '.' | ',';
  mapping: Record<string, string>; // field -> column header
  constants: Record<string, string>; // field -> constant value
  valueMaps?: Record<string, Record<string, string>>; // field -> (source value -> normalised)
  headerSignature?: string[];
  builtin: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ImportBatch {
  id: ID;
  createdAt: string;
  filename: string;
  fileHash: string;
  target: ImportTarget;
  templateId?: ID;
  templateSnapshot: Omit<ImportTemplate, 'id' | 'createdAt' | 'updatedAt' | 'builtin' | 'name'>;
  accountId?: ID;
  status: 'committed' | 'rolled_back' | 'failed';
  counts: { created: number; skipped: number; updated: number; rejected: number; total: number };
  rejected: { row: number; errors: string[] }[];
  notes?: string;
  rolledBackAt?: string;
  createdInstrumentIds?: ID[];
  createdRateIds?: number;
}

export interface RawImportRow {
  id: ID;
  batchId: ID;
  rowNumber: number;
  raw: Record<string, string>;
  outcome: 'created' | 'skipped_duplicate' | 'rejected' | 'updated';
  recordId?: ID;
  errors?: string[];
}

// ---------- Reconciliation ----------
export interface ReconciliationItem {
  id: ID;
  type: 'cash_balance' | 'holding' | 'statement' | 'issue_note';
  accountId?: ID;
  instrumentId?: ID;
  asAtDate: string;
  statementValue?: DecStr;
  statementCurrency?: string;
  status: 'open' | 'reconciled' | 'explained';
  explanation?: string;
  issueKey?: string;
  linkedTxnIds: ID[];
  documentIds: ID[];
  createdAt: string;
  updatedAt: string;
}

// ---------- Audit / calc / reports / backups ----------
export interface AuditEvent {
  id: ID;
  at: string;
  entityType: string;
  entityId: ID;
  action: 'create' | 'update' | 'delete' | 'restore' | 'fx_override' | 'import' | 'rollback' | 'recalc' | 'bulk_update' | 'backup' | 'migrate';
  summary: string;
  before?: unknown;
  after?: unknown;
  reason?: string;
  batchId?: ID;
}

export interface CalculationRun {
  id: ID;
  fy: FYear;
  createdAt: string;
  ruleSetId: string;
  reason: string;
  inputHash: string;
  summary: Record<string, string>;
  warningsCount: number;
  result: unknown; // serialised TaxYearResult
  supersedesId?: ID;
}

export interface ReportSnapshot {
  id: ID;
  createdAt: string;
  fy: FYear;
  reportType: 'basic' | 'full' | 'csv';
  calculationRunId: ID;
  ruleSetId: string;
  options: Record<string, unknown>;
  fileName: string;
  sha256: string;
}

export interface BackupManifest {
  id: ID;
  createdAt: string;
  fileName: string;
  schemaVersion: number;
  appVersion: string;
  counts: Record<string, number>;
  sha256: string;
  encrypted: boolean;
  includesDocuments: boolean;
}

export interface ConnectorConfig {
  id: ID;
  providerId: string;
  displayName: string;
  status: 'planned' | 'not_configured' | 'disabled';
  scopes: string[];
  lastSyncAt?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SettingRow {
  key: string;
  value: unknown;
}

export interface Draft {
  id: string;
  form: string;
  data: unknown;
  updatedAt: string;
}

export interface AppSettings {
  taxTimeZone: string;
  dateFormat: 'dd/MM/yyyy' | 'd MMM yyyy' | 'yyyy-MM-dd';
  timeFormat: '12h' | '24h';
  displayCurrency: 'AUD';
  displayDecimals: number;
  defaultCurrency: string;
  selectedFY: FYear | null;
  rateMethodology: RateMethodology;
  costBasisDefaults: Partial<Record<AssetClass, CostBasisMethod>>;
  lossOrdering: 'non_discount_first' | 'discount_first';
  theme: 'light' | 'dark' | 'system';
  backupReminderDays: number;
  pageSize: number;
  lastBackupAt?: string;
  lastImportAt?: string;
  includeDocumentsInBackup: boolean;
  onboarded: boolean;
}

export interface RateMethodology {
  /** Prefer a broker/exchange execution-specific rate recorded on the transaction when available. */
  preferExecutionRate: boolean;
  /** Use the daily reference rate for the event's local date. */
  dailyRateDateBasis: 'tax_timezone_date' | 'trade_timezone_date';
  /** Maximum number of prior days to look back for a published daily rate (weekends / holidays). 0 = exact date only. */
  maxLookbackDays: number;
  /** Preferred source name (when multiple sources hold a rate for the date). */
  preferredSource?: string;
  /** Allow triangulating through USD when no direct AUD rate exists. */
  allowCrossViaUSD: boolean;
}
