/**
 * Plain-language "To do" list for simple mode. Only items that stop the figures from being finished or
 * change them are shown as to-dos; everything else stays available as notes for an accountant.
 */
import type { TaxYearResult, Issue } from '../../engines/tax/taxEngine';
import type { QualityIssue } from '../../engines/reconciliation/quality';
import type { TaxProfile } from '../../domain/types';

export interface Todo {
  id: string;
  text: string;
  detail?: string;
  severity: 'bad' | 'warn';
  /** Route to fix it, or the special value 'setup' to open the setup questions. */
  fix: string;
  fixLabel: string;
  count: number;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Setup answers that are still missing for the year. */
export function missingSetup(tp: TaxProfile | null | undefined): string[] {
  const out: string[] = [];
  if (!tp || tp.residency === 'unknown') out.push('residency');
  if (tp?.residency === 'part_year' && !tp.residentMonths) out.push('months');
  if (!tp || tp.privateHospitalCover === 'unknown') out.push('cover');
  if (!tp || tp.spouse === 'unknown') out.push('spouse');
  if (!tp || tp.helpDebt === 'unknown') out.push('help');
  if (!tp || tp.medicareExemption === 'unknown') out.push('medicare');
  return out;
}

/** Codes that are answered by the setup questions (not shown separately). */
const SETUP_CODES = new Set(['RESIDENCY_UNKNOWN', 'RESIDENCY_UNSUPPORTED', 'MLS_NOT_COMPUTED', 'HELP_NOT_COMPUTED', 'MEDICARE_ESTIMATE']);

export function buildTodos(r: TaxYearResult | null, quality: QualityIssue[] | null, tp: TaxProfile | null | undefined, yearLabel: string): { todos: Todo[]; notes: { title: string; text: string }[] } {
  const todos: Todo[] = [];
  const notes: { title: string; text: string }[] = [];
  const missing = missingSetup(tp);
  if (missing.length) {
    todos.push({ id: 'setup', text: `Answer ${plural(missing.length, 'quick question')} about ${yearLabel}`, detail: 'Residency, private health cover, spouse and study loans decide which tax rules apply.', severity: 'bad', fix: 'setup', fixLabel: 'Answer now', count: missing.length });
  }
  if (!r) return { todos, notes };
  const seen = new Set<string>();
  const add = (code: string, n: number, t: Omit<Todo, 'id' | 'count'>) => {
    if (seen.has(code) || n === 0) return;
    seen.add(code);
    todos.push({ id: code, count: n, ...t });
  };
  const byCode = (code: string): Issue | undefined => r.issues.find((i) => i.code === code);
  const q = (code: string) => quality?.find((i) => i.code === code);
  const n = (i?: { txnIds: string[] }) => i?.txnIds.length ?? 0;

  const unclassified = Math.max(n(byCode('UNCLASSIFIED')), n(q('UNCLASSIFIED')));
  add('UNCLASSIFIED', unclassified, { text: `${plural(unclassified, 'record')} ${unclassified === 1 ? 'needs' : 'need'} a category`, detail: 'Tell the app what each one is (income, expense, personal…).', severity: 'bad', fix: '/reconciliation?tab=unclassified', fixLabel: 'Categorise' });

  const treat = byCode('ACCOUNT_TREATMENT');
  if (treat) add('ACCOUNT_TREATMENT', 1, { text: 'Choose how some trading accounts are taxed', detail: treat.message.replace(/^Tax treatment \(investor vs trader\) not set for: /, 'Investor or trader? ').replace(/ — .*$/, ''), severity: 'bad', fix: '/trading?tab=accounts', fixLabel: 'Choose' });

  const cost = Math.max(n(byCode('MISSING_COST_BASE')), n(byCode('CGT_INCOMPLETE')), n(q('MISSING_COST_BASE')));
  add('MISSING_COST_BASE', cost, { text: `${plural(cost, 'sale')} ${cost === 1 ? 'is' : 'are'} missing what you paid`, detail: 'Add the original purchase (or an opening balance) so the gain can be worked out.', severity: 'bad', fix: '/add-trades', fixLabel: 'Add purchase' });

  const rate = Math.max(n(byCode('MISSING_RATE')), n(q('MISSING_RATE')));
  add('MISSING_RATE', rate, { text: `${plural(rate, 'foreign-currency record')} ${rate === 1 ? 'needs' : 'need'} an exchange rate`, detail: 'Fetch them (RBA for currencies, CoinGecko for crypto) or import a rate table so amounts can be converted to AUD.', severity: 'bad', fix: '/imports', fixLabel: 'Get rates' });

  const review = n(byCode('REVIEW_ITEMS'));
  add('REVIEW_ITEMS', review, { text: `${plural(review, 'item')} ${review === 1 ? 'needs' : 'need'} a decision`, detail: 'For example an airdrop, a prop-firm payout or an unusual expense.', severity: 'warn', fix: '/reconciliation?tab=unclassified', fixLabel: 'Review' });

  const transfers = n(q('UNMATCHED_TRANSFER'));
  add('UNMATCHED_TRANSFER', transfers, { text: `${plural(transfers, 'transfer')} between your own accounts ${transfers === 1 ? 'is' : 'are'} not matched`, detail: 'Matching them stops a move between wallets looking like a sale.', severity: 'warn', fix: '/reconciliation?tab=transfers', fixLabel: 'Match' });

  const dups = n(q('POSSIBLE_DUPLICATE'));
  add('POSSIBLE_DUPLICATE', dups, { text: `${plural(dups, 'possible duplicate')} to check`, severity: 'warn', fix: '/reconciliation?tab=duplicates', fixLabel: 'Check' });

  const frank = byCode('FRANKING_HOLDING_PERIOD');
  if (frank && frank.severity !== 'info') add('FRANKING', Math.max(1, frank.txnIds.length), { text: 'Check franking credits ($5,000 or more this year)', detail: 'The 45-day holding rule applies — add ex-dividend dates to your dividends.', severity: 'warn', fix: '/transactions?ids=' + frank.txnIds.slice(0, 200).join(','), fixLabel: 'Show' });

  if (byCode('CGT_2027_REFORM') || byCode('CGT_DISCOUNT_UNKNOWN') || byCode('NO_RULES')) {
    add('UNSUPPORTED_YEAR', 1, { text: 'This year isn’t supported yet', detail: 'Tax rules after 30 June 2027 (including CGT changes) are not built in — see an accountant.', severity: 'bad', fix: '/tax-summary', fixLabel: 'Details' });
  }

  // Everything else becomes a note for the accountant.
  for (const i of r.issues) {
    if (seen.has(i.code) || SETUP_CODES.has(i.code) || ['UNCLASSIFIED', 'ACCOUNT_TREATMENT', 'MISSING_COST_BASE', 'CGT_INCOMPLETE', 'MISSING_RATE', 'REVIEW_ITEMS', 'FRANKING_HOLDING_PERIOD', 'CGT_2027_REFORM', 'CGT_DISCOUNT_UNKNOWN', 'NO_RULES'].includes(i.code)) continue;
    if (i.severity === 'info' && ['RULES_NOT_VERIFIED'].includes(i.code)) continue;
    notes.push({ title: NOTE_TITLE[i.code] ?? i.code.replace(/_/g, ' ').toLowerCase(), text: i.message });
  }
  if (missing.length === 0) {
    for (const code of ['MLS_NOT_COMPUTED', 'HELP_NOT_COMPUTED', 'MEDICARE_ESTIMATE']) {
      const i = byCode(code);
      if (i) notes.push({ title: NOTE_TITLE[code] ?? code, text: i.message });
    }
  }
  return { todos, notes };
}

const NOTE_TITLE: Record<string, string> = {
  PART_YEAR: 'Part-year resident',
  WHM: 'Working holiday maker',
  NON_RESIDENT: 'Foreign resident',
  PARAM_UNCONFIRMED: 'A tax figure is not confirmed for this year',
  FITO_LIMIT: 'Foreign tax offset',
  TAX_LOSS: 'Tax loss',
  PRIOR_TAX_LOSSES: 'Earlier tax losses',
  BUSINESS_LOSS: 'Side-project / business loss',
  REVENUE_LOSS: 'Trading loss',
  TRADING_STOCK: 'Trading stock',
  TRUST_CG: 'Managed fund capital gains',
  DISCOUNT_WITHHELD: 'CGT discount not applied',
  PRIOR_YEAR_CGT_INCOMPLETE: 'Earlier year incomplete',
  WASH_SALE_REVIEW: 'Possible wash sale',
  PERSONAL_USE_NOT_APPLIED: 'Small crypto sales',
  FOREX_DIV775: 'Foreign currency balances',
  PRE_CGT: 'Shares bought before 20 Sep 1985',
  INDEXATION_OPTION: 'Shares bought before 21 Sep 1999',
  ETP_REVIEW: 'Termination payment',
  DEPRECIATION_REVIEW: 'Depreciation',
  MLS_NOT_COMPUTED: 'Medicare levy surcharge',
  HELP_NOT_COMPUTED: 'Study loan',
  MEDICARE_ESTIMATE: 'Medicare levy'
};
