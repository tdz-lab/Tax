/**
 * Versioned Australian individual tax rule sets (data-driven).
 *
 * Every parameter is attributed to a public source. A rule set's `status` states how far it has
 * been verified; calculations using anything other than 'verified' parameters are flagged.
 * Rule sets are immutable once published: corrections create a new `version`, and calculation
 * snapshots record the rule-set id they used.
 */
import type { FYear } from '../../lib/dates';

export type RuleStatus = 'verified' | 'partially_verified' | 'unverified';

export interface Bracket {
  /** Lower bound (exclusive) in whole dollars: tax applies to income above this. */
  above: number;
  rate: string; // decimal fraction
}

export interface MedicareLowIncome {
  singleLower: number; // no levy at or below
  singleUpper: number; // full 2% above
  shadeInRate: string; // 10c per $1 above the lower threshold
  saptoLower?: number; // recorded for reference; SAPTO is not applied
  saptoUpper?: number;
}

export interface LitoParams {
  max: number;
  t1: number; // full offset up to
  rate1: string; // reduction per $ between t1 and t2
  t2: number;
  mid: number; // offset at t2
  rate2: string; // reduction per $ between t2 and t3
  t3: number; // offset nil above
}

/**
 * How a single parameter was checked. Nothing here means "independently verified by a tax
 * professional": the strongest status is a figure read from an ATO page (via search summaries
 * on the date shown, because direct page access was blocked in the build environment).
 */
export type CheckStatus =
  | 'ato_search_summary' // figure matched an ato.gov.au page as returned by a web-search summary
  | 'statutory_reference' // fixed by legislation (section cited), not re-checked against the ATO site
  | 'conflicting' // ATO sources returned conflicting figures — treat as unverified
  | 'unverified'; // entered from secondary knowledge, not confirmed

export interface ParamCheck {
  param: string;
  status: CheckStatus;
  source: string;
  checkedOn: string;
  note?: string;
}

/** Family (spouse / dependants) Medicare levy low-income thresholds. Null members are not known. */
export interface MedicareFamily {
  lower: number | null; // family income at or below → no levy
  lowerPerChild: number | null;
  upper: number | null; // family taxable income limit for any reduction
  upperPerChild: number | null;
}

/** Medicare levy surcharge tiers: income above tiers[i] attracts rates[i]. */
export interface MlsParams {
  single: [number, number, number];
  family: [number, number, number];
  rates: [string, string, string];
  familyIncreasePerChildAfterFirst: number;
}

/** Compulsory study-loan repayment schedule (marginal system from 2025–26). */
export interface HelpParams {
  minimum: number; // no repayment at or below
  bands: { above: number; base: string; rate: string }[]; // repayment = base + rate × (RI − above)
  totalIncomeRate: { above: number; rate: string }; // above this, rate × total repayment income
}

export interface TaxRuleSet {
  id: string;
  fy: FYear;
  version: number;
  status: RuleStatus;
  publishedAt: string;
  supersededBy?: string;
  residentBrackets: Bracket[];
  nonResidentBrackets: Bracket[] | null;
  medicareLevyRate: string;
  medicareLowIncome: MedicareLowIncome | null;
  lito: LitoParams | null;
  cgtDiscountIndividual: string;
  fitoDeMinimis: number; // foreign income tax offset claimable without a limit calculation
  instantAssetWriteOff: { threshold: number; status: RuleStatus; note: string } | null;
  lowValuePool: { firstYearRate: string; subsequentRate: string } | null;
  // ---- added in rule-set version 2 (optional so older imported JSON stays valid) ----
  medicareFamily?: MedicareFamily | null;
  mls?: MlsParams | null;
  help?: HelpParams | null;
  /** Part-year resident tax-free threshold: base + perYear × months resident / 12. */
  partYearThreshold?: { base: number; perYear: number } | null;
  whmBrackets?: Bracket[] | null;
  checks?: ParamCheck[];
  sources: string[];
  notes: string[];
  /** Areas the engine deliberately does not compute for this year. */
  notImplemented: string[];
}

const LITO_2021_ON: LitoParams = { max: 700, t1: 37500, rate1: '0.05', t2: 45000, mid: 325, rate2: '0.015', t3: 66667 };

const PRE_STAGE3_RES: Bracket[] = [
  { above: 0, rate: '0' },
  { above: 18200, rate: '0.19' },
  { above: 45000, rate: '0.325' },
  { above: 120000, rate: '0.37' },
  { above: 180000, rate: '0.45' }
];
const PRE_STAGE3_NONRES: Bracket[] = [
  { above: 0, rate: '0.325' },
  { above: 120000, rate: '0.37' },
  { above: 180000, rate: '0.45' }
];
const STAGE3_RES: Bracket[] = [
  { above: 0, rate: '0' },
  { above: 18200, rate: '0.16' },
  { above: 45000, rate: '0.30' },
  { above: 135000, rate: '0.37' },
  { above: 190000, rate: '0.45' }
];
const STAGE3_NONRES: Bracket[] = [
  { above: 0, rate: '0.30' },
  { above: 135000, rate: '0.37' },
  { above: 190000, rate: '0.45' }
];
const STAGE3_WHM: Bracket[] = [
  { above: 0, rate: '0.15' },
  { above: 45000, rate: '0.30' },
  { above: 135000, rate: '0.37' },
  { above: 190000, rate: '0.45' }
];
const MLS_RATES: [string, string, string] = ['0.01', '0.0125', '0.015'];
const PART_YEAR = { base: 13464, perYear: 4736 };

const V1_NOT_IMPLEMENTED = [
  'HELP / study-loan compulsory repayments',
  'Medicare levy surcharge (requires income-for-MLS-purposes and family details)',
  'Private health insurance rebate adjustments',
  'Spouse / family Medicare thresholds',
  'Non-commercial loss rules (Div 35) for business losses',
  'Working holiday maker rates',
  'Part-year residency tax-free threshold pro-rating',
  'Foreign income tax offset limit calculation above the de minimis amount',
  'Concessional ETP / lump-sum taxation',
  'Small business income tax offset'
];

/** Still not computed in rule-set version 2 (applies to every year). */
const V2_NOT_IMPLEMENTED = [
  'Private health insurance rebate adjustments',
  'Medicare levy family reduction amount between the family thresholds (shade-in formula not sourced) — flagged',
  'Seniors and pensioners tax offset (SAPTO) and its Medicare thresholds',
  'Non-commercial loss rules (Div 35) for business losses',
  'Concessional ETP / lump-sum taxation',
  'Small business income tax offset',
  'Net exempt income reduction of carried-forward tax losses',
  'Forex realisation gains/losses on foreign currency balances (Div 775) — flagged only',
  'Indexation of cost base for assets acquired before 21 September 1999 — flagged only',
  'Trading stock (Div 70) closing-stock valuation'
];

const ATO_RATES = 'ATO — Individual income tax rates (ato.gov.au/rates/individual-income-tax-rates)';
const ATO_LITO = 'ATO — Low income tax offset (ato.gov.au, LITO: $700, reducing 5c/$ above $37,500 and 1.5c/$ above $45,000)';
const ATO_MEDICARE = 'ATO — Medicare levy reduction for low-income earners';
const ATO_CGT_DISCOUNT = 'ITAA 1997 Div 115 — 50% CGT discount for individuals (assets held ≥ 12 months)';
const ATO_FITO = 'ATO — Foreign income tax offset: claim up to $1,000 without calculating the limit';

const U = {
  rates: 'https://www.ato.gov.au/tax-rates-and-codes/tax-rates-australian-residents (URL pattern matches the confirmed foreign-resident and WHM pages)',
  foreign: 'https://www.ato.gov.au/tax-rates-and-codes/tax-rates-foreign-residents',
  whm: 'https://www.ato.gov.au/tax-rates-and-codes/tax-rates-working-holiday-makers',
  whmSched15: 'https://www.ato.gov.au/tax-rates-and-codes/schedule-15-tax-table-for-working-holiday-makers-01-july-2024-to-30-june-2026',
  partYear: 'ATO resident tax rates page, part-year residents section ($13,464 + $4,736 × months/12)',
  medicare: 'https://www.ato.gov.au/individuals-and-families/medicare-and-private-health-insurance/medicare-levy/medicare-levy-reduction/medicare-levy-reduction-for-low-income-earners',
  medicareFamily: 'https://www.ato.gov.au/individuals-and-families/your-tax-return/instructions-to-complete-your-tax-return/mytax-instructions/2026/medicare-and-private-health-insurance/medicare-levy-reduction-or-exemption',
  mls: 'https://www.ato.gov.au/individuals-and-families/medicare-and-private-health-insurance/medicare-levy-surcharge/medicare-levy-surcharge-income-thresholds-and-rates',
  help: 'https://www.ato.gov.au/tax-rates-and-codes/study-and-training-support-loans-rates-and-repayment-thresholds',
  lito: 'ato.gov.au — “Low income tax offset” page (exact URL not captured)',
  fito: 'https://www.ato.gov.au/forms-and-instructions/foreign-income-tax-offset-rules-guide-2024/calculate-your-fito-or-offset-limit',
  iawo: 'ato.gov.au — “Instant asset write-off” page for small business (exact URL not captured)'
};
const CHECKED = '2026-10-20';
const chk = (param: string, status: CheckStatus, source: string, note?: string): ParamCheck => ({ param, status, source, checkedOn: CHECKED, ...(note ? { note } : {}) });
const STATUTORY = [
  chk('cgtDiscountIndividual', 'statutory_reference', 'ITAA 1997 s 115-100 (50% discount for individuals)'),
  chk('fitoDeMinimis', 'ato_search_summary', U.fito, '$1,000 default limit; limit method: tax (incl. Medicare levy and MLS, disregarding offsets) less tax with foreign income and related deductions disregarded.')
];
const V2_NOTE = 'Rule-set version 2 (20 Oct 2026): figures cross-checked against ato.gov.au pages using web-search summaries (direct page access was blocked). See "checks" for each parameter. Not reviewed by a registered tax agent.';

/** Version 1 rule sets (19 Oct 2026) are kept so earlier calculation snapshots remain reproducible. */
const RULE_SETS_V1: TaxRuleSet[] = [
  {
    id: 'AU-IND-FY2023-v1',
    fy: 2023,
    version: 1,
    status: 'verified',
    publishedAt: '2026-10-19',
    supersededBy: 'AU-IND-FY2023-v2',
    residentBrackets: PRE_STAGE3_RES,
    nonResidentBrackets: PRE_STAGE3_NONRES,
    medicareLevyRate: '0.02',
    medicareLowIncome: { singleLower: 24276, singleUpper: 30345, shadeInRate: '0.10' },
    lito: LITO_2021_ON,
    cgtDiscountIndividual: '0.5',
    fitoDeMinimis: 1000,
    instantAssetWriteOff: { threshold: 0, status: 'unverified', note: 'FY2022–23 was covered by temporary full expensing (no threshold) — eligibility must be reviewed.' },
    lowValuePool: { firstYearRate: '0.1875', subsequentRate: '0.375' },
    sources: [ATO_RATES, ATO_LITO, ATO_MEDICARE + ' (2022–23 single: $24,276 / $30,345)', ATO_CGT_DISCOUNT, ATO_FITO],
    notes: ['LMITO ceased after 2021–22 and is not applied.'],
    notImplemented: V1_NOT_IMPLEMENTED
  },
  {
    id: 'AU-IND-FY2024-v1',
    fy: 2024,
    version: 1,
    status: 'verified',
    publishedAt: '2026-10-19',
    supersededBy: 'AU-IND-FY2024-v2',
    residentBrackets: PRE_STAGE3_RES,
    nonResidentBrackets: PRE_STAGE3_NONRES,
    medicareLevyRate: '0.02',
    medicareLowIncome: { singleLower: 26000, singleUpper: 32500, shadeInRate: '0.10' },
    lito: LITO_2021_ON,
    cgtDiscountIndividual: '0.5',
    fitoDeMinimis: 1000,
    instantAssetWriteOff: { threshold: 20000, status: 'partially_verified', note: 'Small business entities (aggregated turnover < $10m): $20,000 per asset for 2023–24.' },
    lowValuePool: { firstYearRate: '0.1875', subsequentRate: '0.375' },
    sources: [ATO_RATES, ATO_LITO, ATO_MEDICARE + ' (2023–24 single: $26,000 / $32,500)', ATO_CGT_DISCOUNT, ATO_FITO],
    notes: [],
    notImplemented: V1_NOT_IMPLEMENTED
  },
  {
    id: 'AU-IND-FY2025-v1',
    fy: 2025,
    version: 1,
    status: 'verified',
    publishedAt: '2026-10-19',
    supersededBy: 'AU-IND-FY2025-v2',
    residentBrackets: STAGE3_RES,
    nonResidentBrackets: STAGE3_NONRES,
    medicareLevyRate: '0.02',
    medicareLowIncome: { singleLower: 27222, singleUpper: 34027, shadeInRate: '0.10' },
    lito: LITO_2021_ON,
    cgtDiscountIndividual: '0.5',
    fitoDeMinimis: 1000,
    instantAssetWriteOff: { threshold: 20000, status: 'partially_verified', note: 'Small business entities: $20,000 per asset for 2024–25.' },
    lowValuePool: { firstYearRate: '0.1875', subsequentRate: '0.375' },
    sources: [ATO_RATES + ' (Stage 3 rates from 1 July 2024)', ATO_LITO, ATO_MEDICARE + ' (2024–25 single: $27,222 / $34,027)', ATO_CGT_DISCOUNT, ATO_FITO],
    notes: [],
    notImplemented: V1_NOT_IMPLEMENTED
  },
  {
    id: 'AU-IND-FY2026-v1',
    fy: 2026,
    version: 1,
    status: 'partially_verified',
    publishedAt: '2026-10-19',
    supersededBy: 'AU-IND-FY2026-v2',
    residentBrackets: STAGE3_RES,
    nonResidentBrackets: STAGE3_NONRES,
    medicareLevyRate: '0.02',
    medicareLowIncome: null,
    lito: LITO_2021_ON,
    cgtDiscountIndividual: '0.5',
    fitoDeMinimis: 1000,
    instantAssetWriteOff: { threshold: 20000, status: 'unverified', note: 'Extension of the $20,000 threshold to 2025–26 must be confirmed against current law.' },
    lowValuePool: { firstYearRate: '0.1875', subsequentRate: '0.375' },
    sources: [ATO_RATES, ATO_LITO, ATO_CGT_DISCOUNT, ATO_FITO],
    notes: ['Medicare levy low-income thresholds for 2025–26 have not been entered/verified — the low-income reduction is NOT applied and the levy is flagged.'],
    notImplemented: [...V1_NOT_IMPLEMENTED, 'Medicare levy low-income reduction (thresholds not verified)']
  },
  {
    id: 'AU-IND-FY2027-v1',
    fy: 2027,
    version: 1,
    status: 'unverified',
    publishedAt: '2026-10-19',
    supersededBy: 'AU-IND-FY2027-v2',
    residentBrackets: [
      { above: 0, rate: '0' },
      { above: 18200, rate: '0.15' },
      { above: 45000, rate: '0.30' },
      { above: 135000, rate: '0.37' },
      { above: 190000, rate: '0.45' }
    ],
    nonResidentBrackets: STAGE3_NONRES,
    medicareLevyRate: '0.02',
    medicareLowIncome: null,
    lito: LITO_2021_ON,
    cgtDiscountIndividual: '0.5',
    fitoDeMinimis: 1000,
    instantAssetWriteOff: null,
    lowValuePool: { firstYearRate: '0.1875', subsequentRate: '0.375' },
    sources: ['Treasury / 2025 legislated reduction of the 16% rate to 15% from 1 July 2026 — verify against ATO published rates', ATO_LITO, ATO_CGT_DISCOUNT, ATO_FITO],
    notes: ['Current/incomplete financial year. Rates must be confirmed against ATO publications before relying on any estimate.'],
    notImplemented: [...V1_NOT_IMPLEMENTED, 'Medicare levy low-income reduction (thresholds not verified)', 'Instant asset write-off threshold']
  }
];

/**
 * Version 2 rule sets. No year is marked 'verified': the best evidence available is an ATO page
 * read through a search summary. Unknown or conflicting parameters are null and the engine flags them.
 */
const RULE_SETS_V2: TaxRuleSet[] = [
  {
    id: 'AU-IND-FY2023-v2',
    fy: 2023,
    version: 2,
    status: 'partially_verified',
    publishedAt: CHECKED,
    residentBrackets: PRE_STAGE3_RES,
    nonResidentBrackets: PRE_STAGE3_NONRES,
    medicareLevyRate: '0.02',
    medicareLowIncome: { singleLower: 24276, singleUpper: 30345, shadeInRate: '0.10' },
    medicareFamily: null,
    mls: { single: [90000, 105000, 140000], family: [180000, 210000, 280000], rates: MLS_RATES, familyIncreasePerChildAfterFirst: 1500 },
    help: null,
    partYearThreshold: PART_YEAR,
    whmBrackets: null,
    lito: LITO_2021_ON,
    cgtDiscountIndividual: '0.5',
    fitoDeMinimis: 1000,
    instantAssetWriteOff: { threshold: 0, status: 'unverified', note: 'FY2022–23 was covered by temporary full expensing (no threshold) — eligibility must be reviewed.' },
    lowValuePool: { firstYearRate: '0.1875', subsequentRate: '0.375' },
    checks: [
      chk('residentBrackets', 'ato_search_summary', U.rates, '0–18,200 nil; 19%; $5,092 + 32.5% over 45,000; $29,467 + 37% over 120,000; $51,667 + 45% over 180,000.'),
      chk('nonResidentBrackets', 'unverified', U.foreign, '2022–23 foreign resident table not confirmed in this review.'),
      chk('medicareLowIncome', 'ato_search_summary', U.medicare, 'Single $24,276 / $30,345.'),
      chk('medicareFamily', 'unverified', U.medicare, '2022–23 family thresholds not confirmed — family reduction not applied.'),
      chk('mls', 'ato_search_summary', U.mls, 'Single 90,000 / 105,000 / 140,000; family 180,000 / 210,000 / 280,000 (one ATO print view is mislabelled with 2023–24 figures).'),
      chk('help', 'unverified', U.help, 'Pre-2025–26 repayment table (percentage of total income) not entered — HELP not calculated.'),
      chk('partYearThreshold', 'ato_search_summary', U.partYear),
      chk('whmBrackets', 'unverified', U.whm, 'Pre-Stage 3 WHM table not confirmed — WHM estimate not available.'),
      chk('lito', 'ato_search_summary', U.lito),
      ...STATUTORY
    ],
    sources: [ATO_RATES, ATO_LITO, ATO_MEDICARE, U.mls, ATO_CGT_DISCOUNT, ATO_FITO],
    notes: [V2_NOTE, 'LMITO ceased after 2021–22 and is not applied.'],
    notImplemented: [...V2_NOT_IMPLEMENTED, 'HELP repayment (table not entered)', 'Working holiday maker rates (not confirmed)', 'Medicare family thresholds (not confirmed)']
  },
  {
    id: 'AU-IND-FY2024-v2',
    fy: 2024,
    version: 2,
    status: 'partially_verified',
    publishedAt: CHECKED,
    residentBrackets: PRE_STAGE3_RES,
    nonResidentBrackets: PRE_STAGE3_NONRES,
    medicareLevyRate: '0.02',
    medicareLowIncome: { singleLower: 26000, singleUpper: 32500, shadeInRate: '0.10' },
    medicareFamily: { lower: null, lowerPerChild: null, upper: 54807, upperPerChild: 5034 },
    mls: { single: [93000, 108000, 144000], family: [186000, 216000, 288000], rates: MLS_RATES, familyIncreasePerChildAfterFirst: 1500 },
    help: null,
    partYearThreshold: PART_YEAR,
    whmBrackets: null,
    lito: LITO_2021_ON,
    cgtDiscountIndividual: '0.5',
    fitoDeMinimis: 1000,
    instantAssetWriteOff: { threshold: 20000, status: 'partially_verified', note: 'Small business entities (aggregated turnover < $10m): $20,000 per asset for 2023–24.' },
    lowValuePool: { firstYearRate: '0.1875', subsequentRate: '0.375' },
    checks: [
      chk('residentBrackets', 'ato_search_summary', U.rates, 'Same scale as 2022–23.'),
      chk('nonResidentBrackets', 'unverified', U.foreign, '2023–24 foreign resident table not confirmed in this review.'),
      chk('medicareLowIncome', 'ato_search_summary', U.medicare, 'Single $26,000 / $32,500.'),
      chk('medicareFamily', 'ato_search_summary', U.medicareFamily, 'Upper family limit $54,807 + $5,034 per child only; lower family threshold not confirmed.'),
      chk('mls', 'ato_search_summary', U.mls),
      chk('help', 'unverified', U.help, 'Pre-2025–26 repayment table not entered — HELP not calculated.'),
      chk('partYearThreshold', 'ato_search_summary', U.partYear),
      chk('whmBrackets', 'unverified', U.whm, 'Pre-Stage 3 WHM table not confirmed — WHM estimate not available.'),
      chk('lito', 'ato_search_summary', U.lito),
      chk('instantAssetWriteOff', 'ato_search_summary', U.iawo, '$20,000 per asset, aggregated turnover under $10 million.'),
      ...STATUTORY
    ],
    sources: [ATO_RATES, ATO_LITO, ATO_MEDICARE, U.mls, ATO_CGT_DISCOUNT, ATO_FITO],
    notes: [V2_NOTE],
    notImplemented: [...V2_NOT_IMPLEMENTED, 'HELP repayment (table not entered)', 'Working holiday maker rates (not confirmed)']
  },
  {
    id: 'AU-IND-FY2025-v2',
    fy: 2025,
    version: 2,
    status: 'partially_verified',
    publishedAt: CHECKED,
    residentBrackets: STAGE3_RES,
    nonResidentBrackets: STAGE3_NONRES,
    medicareLevyRate: '0.02',
    medicareLowIncome: { singleLower: 27222, singleUpper: 34027, shadeInRate: '0.10', saptoLower: 43020, saptoUpper: 53775 },
    medicareFamily: { lower: null, lowerPerChild: null, upper: 57383, upperPerChild: 5270 },
    mls: { single: [97000, 113000, 151000], family: [194000, 226000, 302000], rates: MLS_RATES, familyIncreasePerChildAfterFirst: 1500 },
    help: null,
    partYearThreshold: PART_YEAR,
    whmBrackets: STAGE3_WHM,
    lito: LITO_2021_ON,
    cgtDiscountIndividual: '0.5',
    fitoDeMinimis: 1000,
    instantAssetWriteOff: { threshold: 20000, status: 'partially_verified', note: 'Small business entities: $20,000 per asset for 2024–25.' },
    lowValuePool: { firstYearRate: '0.1875', subsequentRate: '0.375' },
    checks: [
      chk('residentBrackets', 'ato_search_summary', U.rates, 'Stage 3: $4,288 + 30% over 45,000; $31,288 + 37% over 135,000; $51,638 + 45% over 190,000.'),
      chk('nonResidentBrackets', 'conflicting', U.foreign, 'The ATO foreign-resident page summary listed 32.5% / $120,000 / $180,000 under 2024–25 while the WHM Schedule 15 (2024–26) uses 30% / 37% / 45% at $135,000 / $190,000. The Stage 3 figures are used and flagged; confirm before relying on them.'),
      chk('medicareLowIncome', 'ato_search_summary', U.medicare, 'Single $27,222 / $34,027; SAPTO $43,020 / $53,775 (SAPTO not applied).'),
      chk('medicareFamily', 'ato_search_summary', U.medicareFamily, 'Upper family limit $57,383 + $5,270 per child; lower family threshold not confirmed.'),
      chk('mls', 'ato_search_summary', U.mls),
      chk('help', 'unverified', U.help, '2024–25 repayment table (percentage of total income, many bands) not confirmed — HELP not calculated.'),
      chk('partYearThreshold', 'ato_search_summary', U.partYear),
      chk('whmBrackets', 'ato_search_summary', U.whmSched15, '15% to $45,000; 30% to $135,000; 37% to $190,000; 45% above (Schedule 15, 1 July 2024 – 30 June 2026). The main WHM rates page summary showed an older-looking table for 2024–25.'),
      chk('lito', 'ato_search_summary', U.lito),
      chk('instantAssetWriteOff', 'ato_search_summary', U.iawo),
      ...STATUTORY
    ],
    sources: [ATO_RATES + ' (Stage 3 rates from 1 July 2024)', ATO_LITO, ATO_MEDICARE, U.mls, U.whmSched15, ATO_CGT_DISCOUNT, ATO_FITO],
    notes: [V2_NOTE, 'Foreign-resident rates for 2024–25 had conflicting ATO search results — see checks.'],
    notImplemented: [...V2_NOT_IMPLEMENTED, 'HELP repayment (2024–25 table not confirmed)']
  },
  {
    id: 'AU-IND-FY2026-v2',
    fy: 2026,
    version: 2,
    status: 'partially_verified',
    publishedAt: CHECKED,
    residentBrackets: STAGE3_RES,
    nonResidentBrackets: STAGE3_NONRES,
    medicareLevyRate: '0.02',
    medicareLowIncome: { singleLower: 28011, singleUpper: 35013, shadeInRate: '0.10', saptoLower: 44268, saptoUpper: 55335 },
    medicareFamily: { lower: 47238, lowerPerChild: 4338, upper: 59047, upperPerChild: 5423 },
    mls: { single: [101000, 118000, 158000], family: [202000, 236000, 316000], rates: MLS_RATES, familyIncreasePerChildAfterFirst: 1500 },
    help: {
      minimum: 67000,
      bands: [
        { above: 67000, base: '0', rate: '0.15' },
        { above: 125000, base: '8700', rate: '0.17' }
      ],
      totalIncomeRate: { above: 179285, rate: '0.10' }
    },
    partYearThreshold: PART_YEAR,
    whmBrackets: STAGE3_WHM,
    lito: LITO_2021_ON,
    cgtDiscountIndividual: '0.5',
    fitoDeMinimis: 1000,
    instantAssetWriteOff: { threshold: 20000, status: 'partially_verified', note: 'Small business entities (aggregated turnover < $10m): $20,000 per asset for 2025–26 (ATO page via search summary).' },
    lowValuePool: { firstYearRate: '0.1875', subsequentRate: '0.375' },
    checks: [
      chk('residentBrackets', 'ato_search_summary', U.rates),
      chk('nonResidentBrackets', 'ato_search_summary', U.foreign, '30% to $135,000; $40,500 + 37% to $190,000; $60,850 + 45% above.'),
      chk('medicareLowIncome', 'ato_search_summary', U.medicare, 'Single $28,011 / $35,013; SAPTO $44,268 / $55,335 (SAPTO not applied).'),
      chk('medicareFamily', 'ato_search_summary', U.medicareFamily, 'Lower $47,238 + $4,338 per child; upper $59,047 + $5,423 per child. Reduction amount between them is not calculated.'),
      chk('mls', 'ato_search_summary', U.mls),
      chk('help', 'ato_search_summary', U.help, 'Marginal system: nil to $67,000; 15c per $1 to $125,000; $8,700 + 17c per $1 to $179,285; 10% of total repayment income above. Internally consistent at $179,285.'),
      chk('partYearThreshold', 'ato_search_summary', U.partYear),
      chk('whmBrackets', 'ato_search_summary', U.whm),
      chk('lito', 'ato_search_summary', U.lito),
      chk('instantAssetWriteOff', 'ato_search_summary', U.iawo),
      ...STATUTORY
    ],
    sources: [ATO_RATES, ATO_LITO, ATO_MEDICARE, U.medicareFamily, U.mls, U.help, U.whm, ATO_CGT_DISCOUNT, ATO_FITO],
    notes: [V2_NOTE],
    notImplemented: V2_NOT_IMPLEMENTED
  },
  {
    id: 'AU-IND-FY2027-v2',
    fy: 2027,
    version: 2,
    status: 'partially_verified',
    publishedAt: CHECKED,
    residentBrackets: [
      { above: 0, rate: '0' },
      { above: 18200, rate: '0.15' },
      { above: 45000, rate: '0.30' },
      { above: 135000, rate: '0.37' },
      { above: 190000, rate: '0.45' }
    ],
    nonResidentBrackets: STAGE3_NONRES,
    medicareLevyRate: '0.02',
    medicareLowIncome: null,
    medicareFamily: null,
    mls: { single: [105000, 123000, 164000], family: [210000, 246000, 328000], rates: MLS_RATES, familyIncreasePerChildAfterFirst: 1500 },
    help: null,
    partYearThreshold: null,
    whmBrackets: null,
    lito: LITO_2021_ON,
    cgtDiscountIndividual: '0.5',
    fitoDeMinimis: 1000,
    instantAssetWriteOff: null,
    lowValuePool: { firstYearRate: '0.1875', subsequentRate: '0.375' },
    checks: [
      chk('residentBrackets', 'ato_search_summary', U.rates, '16% rate reduced to 15% from 1 July 2026 ("now law"); 14% from 1 July 2027. Other brackets unchanged.'),
      chk('nonResidentBrackets', 'unverified', U.foreign, '2026–27 foreign resident table not confirmed.'),
      chk('medicareLowIncome', 'unverified', U.medicare, '2026–27 thresholds not published/confirmed — low-income reduction not applied.'),
      chk('mls', 'ato_search_summary', U.mls),
      chk('help', 'conflicting', U.help, 'Search results gave both $69,528 and $67,000 as the 2026–27 minimum — HELP not calculated.'),
      chk('partYearThreshold', 'unverified', U.partYear, 'Not confirmed for 2026–27.'),
      chk('whmBrackets', 'unverified', U.whm),
      chk('lito', 'unverified', U.lito, 'Assumed unchanged; not confirmed for 2026–27.'),
      ...STATUTORY
    ],
    sources: [ATO_RATES, ATO_LITO, U.mls, ATO_CGT_DISCOUNT, ATO_FITO],
    notes: [V2_NOTE, 'Current/incomplete financial year. Several 2026–27 parameters are not yet confirmed (see checks).'],
    notImplemented: [...V2_NOT_IMPLEMENTED, 'Medicare levy low-income reduction (thresholds not confirmed)', 'HELP repayment (conflicting threshold)', 'Part-year residency (formula not confirmed for 2026–27)', 'Working holiday maker rates (not confirmed)', 'Instant asset write-off threshold']
  }
];

export const RULE_SETS: TaxRuleSet[] = [...RULE_SETS_V1, ...RULE_SETS_V2];

/** The parameter checks for a rule set (empty for version 1 and imported sets without checks). */
export function checksFor(rs: TaxRuleSet | null, param: string): ParamCheck | null {
  return rs?.checks?.find((c) => c.param === param) ?? null;
}

/** Rule sets imported by the user (Settings → Tax rules) are merged on top of the built-ins. */
let importedRuleSets: TaxRuleSet[] = [];
export function registerImportedRuleSets(sets: TaxRuleSet[]): void {
  importedRuleSets = sets;
}

export function allRuleSets(): TaxRuleSet[] {
  return [...RULE_SETS, ...importedRuleSets];
}

/** Latest version for a FY, or null if no rules exist for that year. */
export function ruleSetFor(fy: FYear): TaxRuleSet | null {
  const candidates = allRuleSets().filter((r) => r.fy === fy);
  if (!candidates.length) return null;
  return candidates.reduce((a, b) => (b.version > a.version ? b : a));
}

export function ruleSetById(id: string): TaxRuleSet | null {
  return allRuleSets().find((r) => r.id === id) ?? null;
}

export function validateRuleSet(r: any): string[] {
  const errs: string[] = [];
  if (!r || typeof r !== 'object') return ['Rule set must be an object.'];
  if (typeof r.id !== 'string' || !r.id) errs.push('id required');
  if (typeof r.fy !== 'number') errs.push('fy (number) required');
  if (typeof r.version !== 'number') errs.push('version (number) required');
  if (!Array.isArray(r.residentBrackets) || !r.residentBrackets.length) errs.push('residentBrackets required');
  if (typeof r.medicareLevyRate !== 'string') errs.push('medicareLevyRate (string) required');
  if (typeof r.cgtDiscountIndividual !== 'string') errs.push('cgtDiscountIndividual (string) required');
  if (RULE_SETS.some((b) => b.id === r.id)) errs.push('id collides with a built-in rule set; use a new version id');
  return errs;
}
