/**
 * Offline PDF reports (jsPDF + autotable). Report A: basic annual summary. Report B: full tax-agent report.
 * These are preparation documents for review — NOT official ATO forms or lodged returns.
 */
import { jsPDF } from 'jspdf';
import autoTable, { type RowInput } from 'jspdf-autotable';
import { D, formatMoney, formatQty, tryD } from '../lib/decimal';
import { formatDate, formatInstant, fyLabel, fyLongLabel } from '../lib/dates';
import { ACCOUNT_TYPE_LABEL, ASSET_CLASS_LABEL, KIND_LABEL, SIDE_LABEL, TAX_CLASS_INFO, TREATMENT_LABEL } from '../domain/reference';
import type { AssetClass, Transaction } from '../domain/types';
import { QUALITY_LABEL } from '../engines/reconciliation/quality';
import { ruleSetFor } from '../engines/tax/rules';
import type { TaxLine } from '../engines/tax/taxEngine';
import { returnFigures } from '../engines/tax/simpleFigures';
import { audOf, grossOf } from '../engines/ledger';
import type { ReportContext } from './reportData';

const DISCLAIMER =
  'Prepared from the taxpayer’s own records for review by a registered tax agent. This is not an official ATO form, not a lodged return and not tax advice. Estimates depend on the data and assumptions shown and must be verified.';

/** jsPDF core fonts use WinAnsi; map typographic characters to safe equivalents. */
export function pdfSafe(s: unknown): string {
  return String(s ?? '')
    .replace(/[–—−]/g, '-')
    .replace(/→/g, '->')
    .replace(/×/g, 'x')
    .replace(/≥/g, '>=')
    .replace(/≤/g, '<=')
    .replace(/·/g, '-')
    .replace(/…/g, '...')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/Δ/g, 'delta ')
    .replace(/Σ/g, 'Sum ')
    .replace(/✓/g, 'Yes')
    // eslint-disable-next-line no-control-regex -- deliberately whitelisting tab/CR/LF plus printable Latin-1
    .replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g, '?');
}

const m = (v: string | null | undefined) => (v === null || v === undefined ? 'INCOMPLETE' : formatMoney(v));
const statusLabel: Record<string, string> = { recorded: 'Recorded', calculated: 'Calculated', estimate: 'Estimate', review: 'Awaiting review', incomplete: 'INCOMPLETE' };

class Builder {
  doc: jsPDF;
  y = 0;
  readonly margin = 40;
  section = 0;
  constructor(private ctx: ReportContext, private title: string) {
    this.doc = new jsPDF({ unit: 'pt', format: 'a4', compress: true });
    this.doc.setProperties({ title: pdfSafe(title), subject: `${fyLabel(ctx.options.fy)} tax preparation report`, creator: 'AU Tax & Trading Ledger (local)' });
    this.y = this.margin + 20;
  }
  get width() {
    return this.doc.internal.pageSize.getWidth();
  }
  get height() {
    return this.doc.internal.pageSize.getHeight();
  }
  ensure(space: number) {
    if (this.y + space > this.height - 50) {
      this.doc.addPage();
      this.y = this.margin + 20;
    }
  }
  cover(subtitle: string) {
    const d = this.doc;
    const c = this.ctx;
    d.setFont('helvetica', 'bold').setFontSize(18).text(pdfSafe(this.title), this.margin, this.y);
    this.y += 22;
    d.setFont('helvetica', 'normal').setFontSize(11).text(pdfSafe(`${fyLabel(c.options.fy)} (${fyLongLabel(c.options.fy)}) - ${subtitle}`), this.margin, this.y);
    this.y += 16;
    d.setFontSize(9).setTextColor(90);
    const meta = [
      `Taxpayer: ${c.user?.fullName || '(name not recorded)'}${c.user?.tfnLast3 ? `  |  TFN ending ${c.user.tfnLast3}` : ''}`,
      `Generated: ${formatInstant(c.generatedAt, c.settings.taxTimeZone, { showZone: true })}  |  Calculation snapshot: ${c.run.id}`,
      `Tax rules: ${c.result.ruleSetId ?? 'none available'} (${c.result.ruleStatus.replace('_', ' ')})  |  Residency: ${c.result.residency}`,
      `Readiness: ${c.result.readiness.status.replace(/_/g, ' ').toUpperCase()}  |  Estimate status: ${c.result.estimateStatus.replace('_', ' ')}`
    ];
    for (const line of meta) {
      d.text(pdfSafe(line), this.margin, this.y);
      this.y += 12;
    }
    d.setTextColor(150, 30, 30);
    const lines = d.splitTextToSize(pdfSafe(DISCLAIMER), this.width - this.margin * 2);
    d.text(lines, this.margin, this.y + 4);
    this.y += lines.length * 11 + 12;
    d.setTextColor(0);
  }
  heading(text: string, numbered = true) {
    this.ensure(40);
    if (numbered) this.section++;
    this.doc.setFont('helvetica', 'bold').setFontSize(12).setTextColor(20, 40, 80);
    this.doc.text(pdfSafe(numbered ? `${this.section}. ${text}` : text), this.margin, this.y);
    this.doc.setDrawColor(200).line(this.margin, this.y + 4, this.width - this.margin, this.y + 4);
    this.doc.setTextColor(0).setFont('helvetica', 'normal');
    this.y += 16;
  }
  para(text: string, size = 8.5, color = 60) {
    const lines = this.doc.splitTextToSize(pdfSafe(text), this.width - this.margin * 2);
    this.ensure(lines.length * (size + 2) + 4);
    this.doc.setFontSize(size).setTextColor(color).text(lines, this.margin, this.y);
    this.doc.setTextColor(0);
    this.y += lines.length * (size + 2.5) + 4;
  }
  table(head: string[], body: RowInput[], opts: { money?: number[]; small?: boolean; widths?: Record<number, number> } = {}) {
    if (!body.length) {
      this.para('No records in scope.', 8.5, 120);
      return;
    }
    const columnStyles: Record<number, any> = {};
    for (const i of opts.money ?? []) columnStyles[i] = { halign: 'right' };
    for (const [k, w] of Object.entries(opts.widths ?? {})) columnStyles[Number(k)] = { ...(columnStyles[Number(k)] ?? {}), cellWidth: w };
    autoTable(this.doc, {
      head: [head.map(pdfSafe)],
      body: body.map((r) => (Array.isArray(r) ? r.map((c) => (typeof c === 'string' ? pdfSafe(c) : c)) : r)) as RowInput[],
      startY: this.y,
      margin: { left: this.margin, right: this.margin, top: this.margin + 14, bottom: 46 },
      theme: 'grid',
      showHead: 'everyPage',
      styles: { fontSize: opts.small ? 6.5 : 7.5, cellPadding: 2.5, overflow: 'linebreak', lineColor: 220, lineWidth: 0.4 },
      headStyles: { fillColor: [235, 239, 245], textColor: 20, fontStyle: 'bold' },
      columnStyles
    });
    this.y = (this.doc as any).lastAutoTable.finalY + 12;
  }
  lines(lines: TaxLine[]) {
    this.table(
      ['Item', 'Amount (AUD)', 'Status', 'Sources', 'Method / notes'],
      lines.map((l) => [l.label, m(l.amount), statusLabel[l.status] ?? l.status, String(l.sourceIds.length), [l.method, ...(l.notes ?? [])].filter(Boolean).join(' ')]),
      { money: [1], widths: { 0: 170, 1: 80, 2: 60, 3: 40 } }
    );
  }
  finish(): Blob {
    const d = this.doc;
    const n = d.getNumberOfPages();
    for (let i = 1; i <= n; i++) {
      d.setPage(i);
      d.setFontSize(7).setTextColor(120);
      d.text(pdfSafe(`${this.title} - ${fyLabel(this.ctx.options.fy)} - not an official ATO form or lodged return`), this.margin, this.height - 22);
      d.text(`Page ${i} of ${n}`, this.width - this.margin, this.height - 22, { align: 'right' });
      d.text(pdfSafe(`Generated ${formatInstant(this.ctx.generatedAt, this.ctx.settings.taxTimeZone)}  |  ${this.ctx.result.ruleSetId ?? 'no rules'}`), this.margin, this.margin);
    }
    return d.output('blob');
  }
}

const sym = (ctx: ReportContext, id?: string) => (id ? ctx.instruments.get(id)?.symbol ?? id : '');
const acctName = (ctx: ReportContext, id?: string) => (id ? ctx.accounts.get(id)?.name ?? id : '');
const fd = (ctx: ReportContext, d?: string) => formatDate(d, ctx.settings.dateFormat);
const ac = (ctx: ReportContext, t: Transaction): AssetClass | undefined => (t.instrumentId ? ctx.instruments.get(t.instrumentId)?.assetClass : undefined);
const audStr = (t: Transaction, v?: string) => {
  const a = audOf(t, v ?? t.amount);
  return a === null ? 'NO RATE' : formatMoney(a);
};

function profileSection(b: Builder, ctx: ReportContext) {
  const tp = ctx.taxProfile;
  b.table(
    ['Field', 'Value'],
    [
      ['Name', ctx.user?.fullName || '(not recorded)'],
      ['Date of birth', ctx.user?.dateOfBirth ? fd(ctx, ctx.user.dateOfBirth) : '(not recorded)'],
      ['Residency', tp?.residency ?? 'unknown'],
      ['Medicare levy exemption', tp?.medicareExemption ?? 'unknown'],
      ['Private hospital cover', tp?.privateHospitalCover ?? 'unknown'],
      ['Spouse', tp?.spouse ?? 'unknown'],
      ['HELP / study loan debt', tp?.helpDebt ?? 'unknown'],
      ['Tax agent', ctx.user?.taxAgent || '(not recorded)'],
      ['Business', ctx.business ? `${ctx.business.name}${ctx.business.tradingName ? ` (trading as ${ctx.business.tradingName})` : ''}` : 'No business profile'],
      ['ABN', ctx.business?.abn || '-'],
      ['Business activity', ctx.business?.activity || '-'],
      ['GST registered', ctx.business ? (ctx.business.gstRegistered ? `Yes (${ctx.business.gstBasis} basis, ${ctx.business.basFrequency} BAS)` : 'No') : '-']
    ]
  );
}

function capitalSummary(b: Builder, ctx: ReportContext) {
  const c = ctx.result.capital;
  b.table(
    ['CGT item', 'AUD'],
    [
      ['Discount-eligible capital gains (gross)', m(c.discountableGains)],
      ['Other capital gains (incl. trust capital gains)', m(c.nonDiscountableGains)],
      ['Current-year capital losses', m(c.currentYearLosses)],
      ['Net capital losses from earlier years', m(c.priorYearLossesAvailable)],
      ['Losses applied - current year', m(c.lossesAppliedCurrent)],
      ['Losses applied - earlier years', m(c.lossesAppliedPrior)],
      [`CGT discount (${D(c.discountRate).times(100).toFixed(0)}%)`, m(c.discountApplied)],
      ['NET CAPITAL GAIN', c.incomplete ? 'INCOMPLETE' : m(c.netCapitalGain)],
      ['Net capital losses carried forward', c.incomplete ? 'INCOMPLETE' : m(c.lossesCarriedForward)]
    ],
    { money: [1] }
  );
  b.para(`Method: ${c.lossOrdering}. ${c.steps.join(' ')}`);
}

function issuesTable(b: Builder, ctx: ReportContext) {
  const rows = [...ctx.result.issues.map((i) => [i.severity.toUpperCase(), i.code, i.message, String(i.txnIds.length)]), ...ctx.quality.filter((q) => !ctx.result.issues.some((i) => i.code === q.code)).map((q) => [q.severity.toUpperCase(), QUALITY_LABEL[q.code], q.message, String(q.txnIds.length)])];
  b.table(['Severity', 'Code', 'Detail', 'Records'], rows, { widths: { 0: 60, 1: 110, 3: 45 } });
}

export function buildBasicReport(ctx: ReportContext): Blob {
  const r = ctx.result;
  const b = new Builder(ctx, 'Annual Tax Summary');
  b.cover('Basic annual tax summary');
  b.heading('Taxpayer profile');
  profileSection(b, ctx);
  b.heading('Personal income');
  b.lines(r.income.filter((l) => !l.key.startsWith('trust_') || true));
  b.heading('Business income and expenses');
  b.lines(r.business);
  b.heading('Deductions');
  b.lines(r.deductions);
  b.heading('Trading results by tax classification');
  const byClass = new Map<string, { n: number; net: ReturnType<typeof tryD> | null }>();
  for (const d of r.disposals) {
    const e = byClass.get(d.taxClass) ?? { n: 0, net: D(0) };
    e.n++;
    e.net = e.net === null || d.gainAud === null ? null : e.net.plus(D(d.gainAud));
    byClass.set(d.taxClass, e);
  }
  for (const d of r.derivativeEvents) {
    const e = byClass.get(d.taxClass) ?? { n: 0, net: D(0) };
    e.n++;
    e.net = e.net === null || d.netAud === null ? null : e.net.plus(D(d.netAud));
    byClass.set(d.taxClass, e);
  }
  b.table(['Classification', 'Events', 'Net result (AUD)'], [...byClass].map(([k, v]) => [TAX_CLASS_INFO[k as keyof typeof TAX_CLASS_INFO]?.label ?? k, String(v.n), v.net === null ? 'INCOMPLETE' : formatMoney(v.net)]), { money: [2] });
  b.lines(r.revenueTrading);
  b.heading('Capital gains and losses');
  capitalSummary(b, ctx);
  b.heading('Dividends and distributions');
  b.lines(r.income.filter((l) => l.key.startsWith('div') || l.key.includes('franking') || l.key.startsWith('trust')));
  b.heading('Foreign income and foreign withholding tax');
  b.lines(r.foreign);
  b.heading('GST / BAS summary');
  b.table(['Period', 'G1 sales', '1A GST on sales', '1B GST credits', 'Net GST'], r.bas.periods.map((p: any) => [p.label, m(p.g1), m(p.a1), m(p.b1), m(p.net)]), { money: [1, 2, 3, 4] });
  for (const n of r.bas.notes) b.para(n);
  b.heading('Estimated taxable income and tax');
  b.lines(r.estimate);
  b.lines(r.offsetsAndCredits);
  if (r.estimateStatus !== 'estimate') b.para(`Tax estimate status: ${r.estimateStatus.replace('_', ' ').toUpperCase()} - resolve the blocking items below before relying on any figure.`, 9, 150);
  b.heading('Unresolved items, assumptions and data-quality warnings');
  issuesTable(b, ctx);
  b.table(['Item awaiting review', 'AUD', 'Reason'], r.reviewItems.map((i) => [i.label, m(i.amountAud), i.reason]), { money: [1] });
  b.para('Assumptions: ' + r.assumptions.join(' '));
  b.heading('Rule set');
  const rs = r.ruleSetId ? ruleSetFor(ctx.options.fy) : null;
  b.para(rs ? `${rs.id} (${rs.status}). Sources: ${rs.sources.join('; ')}. Not implemented: ${rs.notImplemented.join('; ')}.` : 'No rule set available for this year.');
  if (rs?.checks?.length) {
    const weak = rs.checks.filter((c) => c.status === 'conflicting' || c.status === 'unverified');
    const verified = rs.checks.filter((c) => c.status === 'verified').length;
    b.para(`Parameter checks (${rs.checks[0].checkedOn}): ${verified} of ${rs.checks.length} parameters were read in an official source (ATO pages or Federal Register of Legislation) and compared with the application; none has been reviewed by a registered tax agent. ${weak.length ? `Unconfirmed or conflicting: ${weak.map((c) => `${c.param} (${c.status}${c.note ? ': ' + c.note : ''})`).join('; ')}.` : 'No parameter is marked unconfirmed for this year.'} Details: docs/TAX_RULE_VERIFICATION.md.`);
  }
  return b.finish();
}

/**
 * "My tax return figures" — the short (1–2 page) default report: the totals to enter in myTax / give
 * your accountant, plus anything still to fix. No ledgers or technical schedules.
 */
export function buildSummaryReport(ctx: ReportContext): Blob {
  const r = ctx.result;
  const b = new Builder(ctx, 'My tax return figures');
  const d = b.doc;
  d.setFont('helvetica', 'bold').setFontSize(18).text(pdfSafe('My tax return figures'), b.margin, b.y);
  b.y += 20;
  d.setFont('helvetica', 'normal').setFontSize(11).text(pdfSafe(`${fyLabel(ctx.options.fy)} (${fyLongLabel(ctx.options.fy)})${ctx.user?.fullName ? ` - ${ctx.user.fullName}` : ''}`), b.margin, b.y);
  b.y += 14;
  d.setFontSize(8.5).setTextColor(110).text(pdfSafe(`Prepared ${formatInstant(ctx.generatedAt, ctx.settings.taxTimeZone)} from your own records. An estimate to help you fill in your return - not an ATO form and not tax advice.`), b.margin, b.y);
  d.setTextColor(0);
  b.y += 16;
  const blocking = r.issues.filter((i) => i.severity === 'blocking');
  if (blocking.length || r.estimateStatus !== 'estimate') {
    b.heading('Still to fix before relying on these figures', false);
    for (const i of blocking.slice(0, 8)) b.para(`- ${i.message}`, 8.5, 140);
    if (r.estimateStatus === 'not_available') b.para('- The tax estimate is not available: answer the quick questions (residency etc.) for this year.', 8.5, 140);
  }
  for (const g of returnFigures(r)) {
    b.heading(g.title, false);
    b.table(
      ['Item', 'Amount (AUD)', 'Where it goes'],
      g.rows.map((x) => [x.strong ? { content: pdfSafe(x.label), styles: { fontStyle: 'bold' } } : x.label, x.amount === null ? 'INCOMPLETE' : x.amount === undefined ? '' : x.strong ? { content: formatMoney(x.amount), styles: { fontStyle: 'bold', halign: 'right' } } : formatMoney(x.amount), x.where ?? '']),
      { money: [1], widths: { 0: 230, 1: 90 } }
    );
  }
  b.para('Question numbers are shown only where they were confirmed in ATO guidance (question 11 Dividends, question 13 Partnerships and trusts, question 18 Capital gains labels H, A and V, M1/M2 Medicare). The ATO calculates your actual tax when you lodge. Keep your records and receipts - the ATO asks for records to be kept for 5 years.', 7.5, 110);
  return b.finish();
}

function txnRows(ctx: ReportContext, ts: Transaction[]): RowInput[] {
  return ts.map((t) => {
    const signed = t.side === 'realised_pnl' || t.side === 'financing' || t.side === 'settlement';
    const gross = signed ? D(t.amount) : grossOf(t, t.instrumentId ? ctx.instruments.get(t.instrumentId) : undefined);
    const aud = t.instrumentId && t.valuationAud && (t.kind === 'income' || t.side === 'swap') ? D(t.valuationAud) : audOf(t, gross);
    return [
    fd(ctx, t.date),
    t.time ? formatInstant(t.occurredAt, t.timeZone, { timeFormat: ctx.settings.timeFormat }).split(' ').slice(1).join(' ') + ` ${t.timeZone}` : '',
    acctName(ctx, t.accountId),
    sym(ctx, t.instrumentId),
    t.side ? SIDE_LABEL[t.side] : KIND_LABEL[t.kind],
    t.quantity ? formatQty(t.quantity) : '',
    t.price ? formatQty(t.price, 6) : '',
    `${formatQty(gross, 4)} ${t.currency}`,
    formatQty(D(t.commission).plus(D(t.exchangeFees)).plus(D(t.otherFees)), 4),
    aud === null ? 'NO RATE' : formatMoney(aud),
    TAX_CLASS_INFO[t.taxClass].label
  ];
  });
}
const TXN_HEAD = ['Date', 'Time (zone)', 'Account', 'Symbol', 'Type', 'Qty', 'Price', 'Gross', 'Fees', 'AUD', 'Classification'];

export function buildFullReport(ctx: ReportContext): Blob {
  const r = ctx.result;
  const o = ctx.options;
  const b = new Builder(ctx, 'Tax Agent Report');
  b.cover('Full tax-agent report');
  const byClass = (cls: AssetClass[]) => ctx.txns.filter((t) => t.kind !== 'income' && t.kind !== 'expense' && cls.includes(ac(ctx, t)!));

  b.heading('Taxpayer and business profile');
  profileSection(b, ctx);
  b.heading('Financial year and reporting scope');
  b.table(
    ['Scope', 'Value'],
    [
      ['Financial year', `${fyLabel(o.fy)} (${fyLongLabel(o.fy)})`],
      ['Accounts included', o.accountIds ? o.accountIds.map((id) => acctName(ctx, id)).join(', ') : 'All accounts'],
      ['Markets included', o.markets ? o.markets.map((x) => ASSET_CLASS_LABEL[x]).join(', ') : 'All markets'],
      ['Records in scope', String(ctx.txns.length)],
      ['Taxpayer time zone (FY assignment)', ctx.settings.taxTimeZone],
      ['Exchange-rate methodology', `${ctx.settings.rateMethodology.preferExecutionRate ? 'Execution rate where recorded, otherwise ' : ''}daily reference rate for the ${ctx.settings.rateMethodology.dailyRateDateBasis === 'tax_timezone_date' ? 'taxpayer-local' : 'trade-venue'} date; prior-day lookback up to ${ctx.settings.rateMethodology.maxLookbackDays} day(s); cross via USD ${ctx.settings.rateMethodology.allowCrossViaUSD ? 'allowed' : 'not allowed'}`]
    ]
  );
  b.heading('Income ledger');
  const income = ctx.txns.filter((t) => t.kind === 'income');
  b.table(['Date', 'Description', 'Payer', 'Category', 'Classification', 'Gross', 'AUD', 'Withheld', 'Docs'], income.map((t) => [fd(ctx, t.date), t.description, t.counterparty ?? '', t.category, TAX_CLASS_INFO[t.taxClass].label, `${formatQty(t.amount, 4)} ${t.currency}`, t.valuationAud && t.instrumentId ? formatMoney(t.valuationAud) : audStr(t), t.taxWithheld ? formatMoney(t.taxWithheld) : '', String(t.documentIds.length)]), { small: true, money: [5, 6, 7] });
  b.heading('Expense and deduction ledger');
  const exp = ctx.txns.filter((t) => t.kind === 'expense' || t.kind === 'fee');
  b.table(['Date', 'Description', 'Supplier', 'Category', 'Classification', 'Amount', 'AUD', 'Use %', 'GST', 'Evidence'], exp.map((t) => [fd(ctx, t.date), t.description, t.counterparty ?? '', t.category, TAX_CLASS_INFO[t.taxClass].label, `${formatQty(t.amount, 4)} ${t.currency}`, audStr(t), t.businessUsePct ?? '100', t.gstAmount ?? '', t.documentIds.length ? 'Yes' : 'MISSING']), { small: true, money: [5, 6] });
  b.lines(r.deductions);
  b.heading('Business profit and loss');
  b.lines(r.business);
  b.heading('Asset and depreciation schedules');
  b.table(['Asset', 'Opening value', 'Decline in value', 'Deductible (business %)', 'Closing value', 'Balancing adj.', 'Notes'], r.depreciation.map((d) => [d.name, m(d.opening), m(d.decline), m(d.deductible), m(d.closing), d.balancingAdjustment ? m(d.balancingAdjustment) : '', d.flags.join(' ')]), { money: [1, 2, 3, 4, 5] });
  b.heading('Capital gains tax event summary');
  b.lines(r.capitalLines);
  b.heading('Capital gains calculations');
  const disp = r.disposals.filter((d) => !o.accountIds || !d.accountId || o.accountIds.includes(d.accountId)).filter((d) => !o.markets || o.markets.includes(ctx.instruments.get(d.instrumentId)?.assetClass ?? 'other'));
  b.table(['Disposal date', 'Instrument', 'Event', 'Qty', 'Proceeds', 'Cost base', 'Gain/(loss)', 'Disc.', 'Method', 'Class'], disp.map((d) => [fd(ctx, d.date), sym(ctx, d.instrumentId), d.kind.replace(/_/g, ' '), formatQty(d.quantity), m(d.proceedsAud), m(d.costAud), m(d.gainAud), d.discountEligible ? 'Yes' : 'No', d.method, TAX_CLASS_INFO[d.taxClass].label]), { small: true, money: [4, 5, 6] });
  b.heading('Capital loss schedule');
  b.table(['Disposal date', 'Instrument', 'Capital loss (AUD)', 'Notes'], disp.filter((d) => d.gainAud !== null && D(d.gainAud).lt(0) && d.taxClass === 'CGT_EVENT').map((d) => [fd(ctx, d.date), sym(ctx, d.instrumentId), formatMoney(D(d.gainAud!).neg()), d.flags.join(' ')]), { money: [2] });
  capitalSummary(b, ctx);
  b.heading('Cost-base calculations (parcel allocations)');
  if (o.schedules.lotDetail) {
    b.table(['Disposal', 'Instrument', 'Parcel (source record)', 'Acquired', 'Qty', 'Cost base', 'Proceeds share', 'Gain/(loss)', 'Days held', 'Disc.'], disp.flatMap((d) => d.allocations.map((a) => [fd(ctx, d.date), sym(ctx, d.instrumentId), a.lotId === 'UNKNOWN' ? 'NO ACQUISITION RECORD' : a.sourceTxnId, fd(ctx, a.acquiredDate), formatQty(a.quantity), m(a.costAud), m(a.proceedsAud), m(a.gainAud), String(a.heldDays), a.discountEligible ? 'Yes' : 'No'])), { small: true, money: [5, 6, 7] });
  } else b.para('Parcel-level detail excluded by report options.');
  b.heading('Acquisition and disposal dates');
  b.para('Acquisition dates are the taxpayer-local contract dates of the matched parcels (see section above); disposal dates are the contract (trade) dates unless a tax-event date override was recorded. Records with overrides:');
  b.table(['Record', 'Trade date', 'Tax event date', 'Settlement date'], ctx.txns.filter((t) => t.taxEventDate || t.settlementDate).map((t) => [t.description || t.id, fd(ctx, t.date), fd(ctx, t.taxEventDate), fd(ctx, t.settlementDate)]));
  b.heading('Cost-basis methodology');
  b.table(['Scope', 'Method'], [
    ...Object.entries(ctx.settings.costBasisDefaults).map(([k, v]) => [`Default - ${ASSET_CLASS_LABEL[k as AssetClass]}`, v as string]),
    ...[...ctx.accounts.values()].filter((a) => a.costBasisMethod).map((a) => [`Account - ${a.name}`, a.costBasisMethod!]),
    ...ctx.txns.filter((t) => t.costBasisMethod || t.specificLots?.length).map((t) => [`Record ${t.description || t.id}`, t.costBasisMethod ?? 'SPECIFIC'])
  ]);
  b.para('FIFO = first in, first out. SPECIFIC = parcels identified by the taxpayer. LIFO/HIFO are parcel-selection orders and are only appropriate where records support identification of the parcels sold. Average cost is not used for CGT. Pooling: identical assets on the same tax treatment are pooled across accounts.');
  b.heading('CGT discount eligibility and calculations');
  b.para(`Discount applies only to capital-account assets acquired at least 12 months before the CGT event (acquisition and event days excluded), for resident individuals. Discount-eligible gains: ${m(r.capital.discountableGains)}; discount applied after losses: ${m(r.capital.discountApplied)}.`);
  b.heading('Australian share transactions');
  b.table(TXN_HEAD, txnRows(ctx, byClass(['au_share', 'etf', 'managed_fund'])), { small: true });
  b.heading('US and international share transactions');
  b.table(TXN_HEAD, txnRows(ctx, byClass(['us_share', 'intl_share'])), { small: true });
  b.heading('Cryptocurrency disposals and income events');
  b.table(TXN_HEAD, txnRows(ctx, ctx.txns.filter((t) => ['crypto', 'stablecoin', 'nft'].includes(ac(ctx, t) ?? ''))), { small: true });
  b.heading('Forex trading records');
  b.table(TXN_HEAD, txnRows(ctx, byClass(['forex'])), { small: true });
  const derivTable = (cls: AssetClass) =>
    b.table(['Close date', 'Account', 'Instrument', 'Direction', 'Qty', 'P&L (native)', 'Fees (native)', 'Net AUD', 'Class', 'Notes'], r.derivativeEvents.filter((e) => ctx.instruments.get(e.instrumentId ?? '')?.assetClass === cls).map((e) => [fd(ctx, e.date), acctName(ctx, e.accountId), sym(ctx, e.instrumentId), e.direction ?? e.kind, formatQty(e.quantity), `${formatQty(e.pnlNative, 4)} ${e.currency}`, formatQty(e.feesNative, 4), m(e.netAud), TAX_CLASS_INFO[e.taxClass].label, e.flags.join(' ')]), { small: true, money: [7] });
  derivTable('forex');
  b.heading('Futures trading records');
  b.table(TXN_HEAD, txnRows(ctx, byClass(['future'])), { small: true });
  derivTable('future');
  b.heading('Options transactions');
  b.table(TXN_HEAD, txnRows(ctx, byClass(['option'])), { small: true });
  derivTable('option');
  b.heading('CFD results');
  b.table(TXN_HEAD, txnRows(ctx, byClass(['cfd'])), { small: true });
  derivTable('cfd');
  b.heading('Prop-firm income, fees and payouts');
  const prop = ctx.txns.filter((t) => t.category.startsWith('prop_') || (t.accountId && ['prop_evaluation', 'prop_funded'].includes(ctx.accounts.get(t.accountId)?.type ?? '')));
  b.table(['Date', 'Account', 'Type', 'Description', 'Amount', 'AUD', 'Classification'], prop.map((t) => [fd(ctx, t.date), acctName(ctx, t.accountId), t.side ? SIDE_LABEL[t.side] : KIND_LABEL[t.kind], t.description, `${formatQty(t.amount, 4)} ${t.currency}`, audStr(t), TAX_CLASS_INFO[t.taxClass].label]), { small: true, money: [4, 5] });
  b.para('Simulated (evaluation / demo-funded) trading is excluded from tax figures and shown for completeness only.');
  b.heading('Dividends, distributions and franking credits');
  const divs = ctx.txns.filter((t) => ['DIVIDEND', 'TRUST_DISTRIBUTION'].includes(t.taxClass) || t.category.startsWith('dividend') || t.category === 'distribution');
  b.table(['Date', 'Security', 'Description', 'Cash', 'Franked', 'Unfranked', 'Franking credit', 'Tax-deferred', 'Capital gain'], divs.map((t) => [fd(ctx, t.date), sym(ctx, t.instrumentId), t.description, `${formatQty(t.amount, 4)} ${t.currency}`, t.frankedAmount ?? '', t.unfrankedAmount ?? '', t.frankingCredit ?? '', t.taxDeferredAmount ?? '', t.capitalGainComponent ?? '']), { small: true });
  b.heading('Foreign income and withholding tax');
  b.lines(r.foreign);
  b.table(['Date', 'Description', 'Currency', 'Gross', 'Foreign tax', 'AUD gross', 'AUD tax'], ctx.txns.filter((t) => t.foreignTaxPaid || t.taxClass === 'FOREIGN_INCOME').map((t) => [fd(ctx, t.date), t.description, t.currency, formatQty(t.amount, 4), t.foreignTaxPaid ?? '0', audStr(t), audStr(t, t.foreignTaxPaid)]), { small: true, money: [5, 6] });
  b.heading('Currency conversion ledger');
  const fx = ctx.txns.filter((t) => t.currency !== 'AUD' || t.feeFx);
  if (o.schedules.conversionLedger)
    b.table(['Date', 'Record', 'Amount', 'AUD per unit', 'Source rate (as quoted)', 'Rate date', 'Type', 'Source', 'AUD'], fx.map((t) => [fd(ctx, t.date), t.description || t.id, `${formatQty(t.amount, 4)} ${t.currency}`, t.fx ? formatQty(t.fx.audPerUnit, 8) : 'MISSING', t.fx ? `${t.fx.sourceRate} ${t.fx.sourceDirection}` : '', t.fx ? fd(ctx, t.fx.rateDate) + (t.fx.staleDays ? ` (-${t.fx.staleDays}d)` : '') : '', t.fx ? (t.fx.isManualOverride ? 'MANUAL' : t.fx.rateType) : '', t.fx?.source ?? '', audStr(t)]), { small: true, money: [8] });
  else b.para('Conversion ledger excluded by report options.');
  b.heading('Historical exchange-rate sources');
  const sources = new Map<string, { n: number; min: string; max: string; types: Set<string> }>();
  for (const t of fx) {
    if (!t.fx) continue;
    const e = sources.get(t.fx.source) ?? { n: 0, min: t.fx.rateDate, max: t.fx.rateDate, types: new Set<string>() };
    e.n++;
    if (t.fx.rateDate < e.min) e.min = t.fx.rateDate;
    if (t.fx.rateDate > e.max) e.max = t.fx.rateDate;
    e.types.add(t.fx.rateType);
    sources.set(t.fx.source, e);
  }
  b.table(['Source', 'Conversions', 'First rate date', 'Last rate date', 'Rate types'], [...sources].map(([k, v]) => [k, String(v.n), fd(ctx, v.min), fd(ctx, v.max), [...v.types].join(', ')]));
  b.heading('Fees and adjustments');
  const feeByAcct = new Map<string, ReturnType<typeof D>>();
  for (const t of ctx.txns.filter((x) => x.kind === 'trade')) {
    const f = audOf(t, D(t.commission).plus(D(t.exchangeFees)).plus(D(t.otherFees)));
    if (f === null) continue;
    feeByAcct.set(t.accountId ?? '-', (feeByAcct.get(t.accountId ?? '-') ?? D(0)).plus(f));
  }
  b.table(['Account', 'Trading fees (AUD, inside cost base/proceeds or P&L)'], [...feeByAcct].map(([k, v]) => [acctName(ctx, k), formatMoney(v)]), { money: [1] });
  b.table(['Date', 'Adjustment', 'Record', 'Notes'], ctx.txns.filter((t) => t.kind === 'adjustment').map((t) => [fd(ctx, t.date), t.adjustmentType ?? '', t.description, t.notes ?? '']));
  b.heading('Supporting-document index');
  if (o.schedules.documentIndex) {
    const docs = ctx.documents.filter((d) => d.fy === o.fy || d.linkedRecordIds.some((id) => ctx.txns.some((t) => t.id === id)));
    b.table(['Title', 'Type', 'Date', 'File', 'SHA-256 (first 16)', 'Linked records'], docs.map((d) => [d.title, d.docType, fd(ctx, d.date), d.originalFilename, d.sha256.slice(0, 16), String(d.linkedRecordIds.length)]), { small: true });
    const missing = ctx.txns.filter((t) => (t.kind === 'expense' || t.kind === 'fee') && !t.documentIds.length);
    b.para(`${missing.length} expense/fee record(s) in scope have no linked evidence.`);
  } else b.para('Document index excluded by report options.');
  b.heading('Account reconciliation summaries');
  b.table(['Account', 'Type', 'As at', 'Statement', 'Recorded', 'Difference', 'Status'], ctx.balances.map((x) => [acctName(ctx, x.accountId), x.type === 'holding' ? `Holding ${sym(ctx, x.instrumentId)}` : `Cash ${x.currency}`, fd(ctx, x.asAtDate), x.statementValue ?? '', x.recordedValue ?? '', x.difference ?? '', x.status]));
  b.table(['Account', 'Type', 'Tax treatment', 'Currency'], [...ctx.accounts.values()].map((a) => [a.name, ACCOUNT_TYPE_LABEL[a.type], TREATMENT_LABEL[a.taxTreatment], a.currency]));
  b.heading('Unmatched transfers and unresolved items');
  b.table(['Item', 'AUD', 'Reason'], r.reviewItems.map((i) => [i.label, m(i.amountAud), i.reason]), { money: [1] });
  const unmatched = ctx.quality.find((q) => q.code === 'UNMATCHED_TRANSFER');
  b.table(['Unmatched transfer', 'Date', 'Asset', 'Qty'], (unmatched?.txnIds ?? []).map((id) => ctx.allTxnsById.get(id)).filter(Boolean).map((t) => [t!.description || t!.id, fd(ctx, t!.date), sym(ctx, t!.instrumentId), formatQty(t!.quantity)]));
  issuesTable(b, ctx);
  b.heading('Manual overrides and their reasons');
  const overrides = ctx.txns.filter((t) => t.fx?.isManualOverride || t.taxClassSource === 'user' || t.fxHistory?.length);
  b.table(['Record', 'Override', 'Detail', 'Reason / source'], overrides.flatMap((t) => [
    ...(t.fx?.isManualOverride ? [[t.description || t.id, 'Exchange rate', `${t.fx.audPerUnit} AUD per ${t.currency}`, `${t.fx.overrideReason ?? ''} (source: ${t.fx.overrideSource ?? ''})`]] : []),
    ...(t.taxClassSource === 'user' ? [[t.description || t.id, 'Classification', TAX_CLASS_INFO[t.taxClass].label, 'Set by user']] : []),
    ...(t.fxHistory ?? []).map((h) => [t.description || t.id, 'Previous rate replaced', `${h.audPerUnit} (${h.source}, ${h.rateDate})`, h.replacedReason])
  ]), { small: true });
  b.heading('Audit and calculation history');
  b.table(['Snapshot', 'Created', 'Rule set', 'Reason', 'Net payable', 'Warnings'], ctx.calcRuns.slice(0, 20).map((c) => [c.id, formatInstant(c.createdAt, ctx.settings.taxTimeZone), c.ruleSetId, c.reason, c.summary.netPayable ?? '', String(c.warningsCount)]), { small: true });
  if (o.schedules.auditHistory) b.table(['When', 'Entity', 'Action', 'Summary', 'Reason'], ctx.audit.slice(0, 150).map((a) => [formatInstant(a.at, ctx.settings.taxTimeZone), a.entityType, a.action, a.summary, a.reason ?? '']), { small: true });
  b.heading('Closing balances and carried-forward information');
  b.table(['Instrument', 'Parcel acquired', 'Qty held at 30 June', 'Cost base (AUD)', 'Treatment'], ctx.closingLots.map((l) => [sym(ctx, l.instrumentId), fd(ctx, l.acquiredDate), formatQty(l.qtyRemaining), l.costAud === null ? 'UNKNOWN' : formatMoney(l.costAud), l.group]), { small: true, money: [3] });
  b.table(['Open derivative position', 'Direction', 'Qty', 'Avg entry', 'Currency'], ctx.openDerivatives.map((p) => [sym(ctx, p.instrumentId), p.direction, formatQty(p.quantity), formatQty(p.avgEntry, 6), p.currency]));
  b.table(['Carried forward', 'AUD'], [['Net capital losses carried forward', r.capital.incomplete ? 'INCOMPLETE' : m(r.capital.lossesCarriedForward)], ['Opening revenue losses recorded', ctx.taxProfile?.openingRevenueLosses ? m(ctx.taxProfile.openingRevenueLosses) : '-']], { money: [1] });
  b.heading('Outstanding questions for the tax agent');
  const qs: string[] = [];
  for (const i of r.issues.filter((x) => x.severity !== 'info')) qs.push(`${i.message}`);
  for (const a of ctx.accounts.values()) if (a.taxTreatment === 'unresolved') qs.push(`Confirm whether activity in "${a.name}" is investing (capital account) or a business / profit-making undertaking (revenue account).`);
  if (prop.length) qs.push('Confirm the tax character of prop-firm payouts and deductibility of evaluation/reset fees.');
  if (r.reviewItems.length) qs.push(`${r.reviewItems.length} item(s) listed under "Unresolved items" need a classification decision.`);
  qs.push(...(ruleSetFor(o.fy)?.notImplemented ?? []).map((x) => `Not computed by the application: ${x}.`));
  b.table(['#', 'Question / item'], qs.map((q, i) => [String(i + 1), q]), { widths: { 0: 25 } });
  b.para('Assumptions: ' + r.assumptions.join(' '));
  return b.finish();
}
