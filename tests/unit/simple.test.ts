/** Simple mode: plain-language figures, the to-do list and the short "My tax return figures" PDF. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { D } from '../../src/lib/decimal';
import { computeTaxYear } from '../../src/engines/tax/taxEngine';
import { headline, returnFigures } from '../../src/engines/tax/simpleFigures';
import { buildTodos, missingSetup } from '../../src/ui/simple/todo';
import { capFirst, moneyUseOf } from '../../src/ui/pages/Money';
import { builtinCategories, categoryOptions, isBusinessCategory } from '../../src/domain/reference';
import type { Transaction } from '../../src/domain/types';
import type { AppDB } from '../../src/db/schema';
import { loadDemoData } from '../../src/services/demo';
import { generatePdfReport } from '../../src/reports/generate';
import { readFileBuffer } from '../../src/lib/files';
import { account, instrument, profile, txn } from './helpers';
import { dropDb, freshDb, sample } from './dbHelpers';

const year = (txns: Transaction[], withProfile = true) =>
  computeTaxYear({
    data: { transactions: txns, accounts: [account({ id: 'acc' })], instruments: [instrument({ id: 'ins', symbol: 'DEMOA' })], corporateActions: [] },
    fy: 2025,
    taxProfiles: withProfile ? [profile(2025)] : [],
    assets: [],
    categories: builtinCategories(),
    taxTz: 'Australia/Sydney',
    costBasisDefaults: {},
    lossOrdering: 'non_discount_first',
    now: '2025-07-01T00:00:00Z'
  });

const salaryYear = () =>
  year([
    txn({ kind: 'income', date: '2024-09-30', category: 'salary', taxClass: 'SALARY_WAGES', amount: '90000', taxWithheld: '20000' }),
    txn({ kind: 'expense', date: '2024-10-10', category: 'work_general', taxClass: 'DEDUCTIBLE_EXPENSE', amount: '1000', businessUsePct: '100' })
  ]);

describe('simple figures (no new calculations — read from the engine result)', () => {
  it('headline numbers match the engine totals', () => {
    const r = salaryYear();
    const h = headline(r);
    expect(D(h.moneyIn!).toFixed(2)).toBe('90000.00');
    expect(D(h.moneyOut!).toFixed(2)).toBe('1000.00');
    expect(D(h.netPayable!).toFixed(2)).toBe(D(r.estimate.find((l) => l.key === 'net_payable')!.amount!).toFixed(2));
  });
  it('groups figures the way the return asks and hides empty lines', () => {
    const groups = returnFigures(salaryYear());
    const titles = groups.map((g) => g.title);
    expect(titles[0]).toBe('Work and personal income');
    expect(groups[0].rows.map((r) => r.label)).toEqual(['Salary and wages']);
    expect(titles.some((t) => t.startsWith('Capital gains'))).toBe(false);
    const est = groups.find((g) => g.title.startsWith('Estimate'))!;
    expect(D(est.rows.find((r) => r.label.startsWith('Estimated refund'))!.amount!).toFixed(2)).toBe('-732.00');
  });
});

describe('to-do list', () => {
  it('asks the setup questions when the profile is missing', () => {
    expect(missingSetup(null)).toEqual(['residency', 'cover', 'spouse', 'help', 'medicare']);
    expect(missingSetup(profile(2025))).toEqual([]);
    const { todos } = buildTodos(year([], false), [], null, '2024–25');
    expect(todos[0].fix).toBe('setup');
  });
  it('turns unclassified records into one plain-language to-do and keeps the rest as notes', () => {
    const r = year([txn({ kind: 'income', date: '2024-09-30', category: 'other', taxClass: 'UNCLASSIFIED', amount: '50' })]);
    const { todos } = buildTodos(r, [], profile(2025), '2024–25');
    const t = todos.find((x) => x.id === 'UNCLASSIFIED')!;
    expect(t.text).toBe('1 record needs a category');
    expect(t.fix).toBe('/reconciliation?tab=unclassified');
    expect(todos.some((x) => x.fix === 'setup')).toBe(false);
  });
  it('a clean year has nothing to do', () => {
    expect(buildTodos(salaryYear(), [], profile(2025), '2024–25').todos).toEqual([]);
  });
});

describe('short report', () => {
  let db: AppDB;
  beforeEach(async () => {
    db = await freshDb();
  });
  afterEach(async () => dropDb(db));
  it('"My tax return figures" is a valid PDF, much shorter than the full report', async () => {
    await loadDemoData(async (f) => sample(f));
    const opts = { fy: 2025, accountIds: null, markets: null, schedules: { conversionLedger: false, documentIndex: false, auditHistory: false, lotDetail: false } };
    const short = await generatePdfReport({ ...opts, type: 'summary' });
    const full = await generatePdfReport({ ...opts, type: 'full' });
    const text = async (b: Blob) => new TextDecoder('latin1').decode(new Uint8Array(await readFileBuffer(b)));
    const s = await text(short.blob);
    expect(s.startsWith('%PDF-1.')).toBe(true);
    expect(short.fileName).toMatch(/^my-tax-return-figures/);
    const pages = (t: string) => t.match(/\/Type \/Page[^s]/g)?.length ?? 0;
    expect(pages(s)).toBeLessThanOrEqual(3);
    expect(pages(await text(full.blob))).toBeGreaterThan(pages(s));
  });
});

describe('money accounts', () => {
  it('capitalises the first letter of a typed name only', () => {
    expect(capFirst('impact affiliate')).toBe('Impact affiliate');
    expect(capFirst('maxBounty')).toBe('MaxBounty');
    expect(capFirst('ébay store')).toBe('Ébay store');
    expect(capFirst('3commas')).toBe('3commas');
    expect(capFirst('')).toBe('');
  });
  it('income sources are for money in, expense accounts for money out, banks and payment accounts for both', () => {
    expect(moneyUseOf({ type: 'income_source' })).toBe('in');
    expect(moneyUseOf({ type: 'expense_source' })).toBe('out');
    expect(moneyUseOf({ type: 'bank' })).toBe('both');
    expect(moneyUseOf({ type: 'payment' })).toBe('both');
    expect(moneyUseOf({ type: 'income_source', moneyUse: 'both' })).toBe('both');
  });
});

describe('expense categories for side projects', () => {
  const cats = builtinCategories();
  const exp = (code: string) => cats.find((c) => c.type === 'expense' && c.code === code)!;
  it('include the online-business categories under headings; equipment and the business home office are flagged for review', () => {
    const names = ['Paid ads (PPC)', 'Influencer & affiliate payouts', 'Native & solo ads', 'Web hosting & servers', 'Domains & registrations', 'Web development & design', 'Security & compliance', 'Email marketing & funnel builders', 'SEO & analytics tools', 'Content creation software', 'Operations & project management', 'Freelance content & design', 'Virtual assistants (VAs)', 'Agency fees', 'Courses & certifications', 'Masterminds & communities', 'Events & conferences', 'Computers & mobile devices', 'A/V production gear', 'Networking hardware', 'Merchant & processing fees', 'Financial & legal software', 'Home office (side business)'];
    const have = new Set(cats.map((c) => c.name));
    expect(names.filter((n) => !have.has(n))).toEqual([]);
    expect(exp('ads_ppc')).toMatchObject({ group: 'Marketing & advertising', defaultTaxClass: 'BUSINESS_EXPENSE' });
    expect(exp('computers').defaultTaxClass).toBe('REVIEW');
    expect(exp('business_home_office').defaultTaxClass).toBe('REVIEW');
    expect(isBusinessCategory(exp('computers'))).toBe(true);
    expect(isBusinessCategory(exp('personal'))).toBe(false);
    // The earlier categories are all still there.
    for (const code of ['work_general', 'home_office', 'software', 'trading_fees', 'prop_eval_fee', 'bank_fees', 'personal', 'other']) expect(exp(code)).toBeDefined();
  });
  it('pick lists are grouped with the business headings first and every category exactly once', () => {
    const opts = categoryOptions(cats.filter((c) => c.type === 'expense'));
    expect(opts.length).toBe(cats.filter((c) => c.type === 'expense').length);
    const groups = [...new Set(opts.map((o) => o.group))];
    expect(groups.slice(0, 3)).toEqual(['Business & side projects', 'Marketing & advertising', 'Websites & hosting']);
    // Each heading appears as one run (no heading split in two).
    const runs = opts.map((o) => o.group).filter((g, i, a) => i === 0 || a[i - 1] !== g);
    expect(runs.length).toBe(groups.length);
  });
  it('business expenses are broken down by category in the figures (display only — the total is unchanged)', () => {
    const r = year([
      txn({ kind: 'expense', date: '2024-09-01', category: 'ads_ppc', taxClass: 'BUSINESS_EXPENSE', amount: '300', businessUsePct: '100', isBusiness: true }),
      txn({ kind: 'expense', date: '2024-09-02', category: 'web_hosting', taxClass: 'BUSINESS_EXPENSE', amount: '120', businessUsePct: '100', isBusiness: true }),
      txn({ kind: 'expense', date: '2024-09-03', category: 'ads_ppc', taxClass: 'BUSINESS_EXPENSE', amount: '200', businessUsePct: '100', isBusiness: true })
    ]);
    const side = returnFigures(r).find((g) => g.title === 'Side projects and business')!;
    const rows = side.rows.map((x) => [x.label.trim(), x.amount && D(x.amount).toFixed(2)]);
    expect(rows).toContainEqual(['Expenses', '620.00']);
    expect(rows).toContainEqual(['Paid ads (PPC)', '500.00']);
    expect(rows).toContainEqual(['Web hosting & servers', '120.00']);
    expect(D(r.business.find((l) => l.key === 'bus_net')!.amount!).toFixed(2)).toBe('-620.00');
  });
});
