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

export interface TaxRuleSet {
  id: string;
  fy: FYear;
  version: number;
  status: RuleStatus;
  publishedAt: string;
  residentBrackets: Bracket[];
  nonResidentBrackets: Bracket[] | null;
  medicareLevyRate: string;
  medicareLowIncome: MedicareLowIncome | null;
  lito: LitoParams | null;
  cgtDiscountIndividual: string;
  fitoDeMinimis: number; // foreign income tax offset claimable without a limit calculation
  instantAssetWriteOff: { threshold: number; status: RuleStatus; note: string } | null;
  lowValuePool: { firstYearRate: string; subsequentRate: string } | null;
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

const COMMON_NOT_IMPLEMENTED = [
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

const ATO_RATES = 'ATO — Individual income tax rates (ato.gov.au/rates/individual-income-tax-rates)';
const ATO_LITO = 'ATO — Low income tax offset (ato.gov.au, LITO: $700, reducing 5c/$ above $37,500 and 1.5c/$ above $45,000)';
const ATO_MEDICARE = 'ATO — Medicare levy reduction for low-income earners';
const ATO_CGT_DISCOUNT = 'ITAA 1997 Div 115 — 50% CGT discount for individuals (assets held ≥ 12 months)';
const ATO_FITO = 'ATO — Foreign income tax offset: claim up to $1,000 without calculating the limit';

export const RULE_SETS: TaxRuleSet[] = [
  {
    id: 'AU-IND-FY2023-v1',
    fy: 2023,
    version: 1,
    status: 'verified',
    publishedAt: '2026-10-19',
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
    notImplemented: COMMON_NOT_IMPLEMENTED
  },
  {
    id: 'AU-IND-FY2024-v1',
    fy: 2024,
    version: 1,
    status: 'verified',
    publishedAt: '2026-10-19',
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
    notImplemented: COMMON_NOT_IMPLEMENTED
  },
  {
    id: 'AU-IND-FY2025-v1',
    fy: 2025,
    version: 1,
    status: 'verified',
    publishedAt: '2026-10-19',
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
    notImplemented: COMMON_NOT_IMPLEMENTED
  },
  {
    id: 'AU-IND-FY2026-v1',
    fy: 2026,
    version: 1,
    status: 'partially_verified',
    publishedAt: '2026-10-19',
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
    notImplemented: [...COMMON_NOT_IMPLEMENTED, 'Medicare levy low-income reduction (thresholds not verified)']
  },
  {
    id: 'AU-IND-FY2027-v1',
    fy: 2027,
    version: 1,
    status: 'unverified',
    publishedAt: '2026-10-19',
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
    notImplemented: [...COMMON_NOT_IMPLEMENTED, 'Medicare levy low-income reduction (thresholds not verified)', 'Instant asset write-off threshold']
  }
];

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
