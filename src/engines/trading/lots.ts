/**
 * Acquisition-lot / disposal engine for CGT assets (shares, ETFs, crypto, options held long, etc.).
 *
 * Pools lots per (instrument, treatment group). Treatment groups keep capital-account holdings
 * separate from revenue-account (trader) holdings. Simulated prop-firm accounts are excluded.
 * Every disposal records which lots were consumed so the result is fully traceable.
 */
import { D, Decimal, dstr, tryD } from '../../lib/decimal';
import { fyOfLocalDate, heldAtLeast12Months, localDateOf, localToUtc, daysBetween } from '../../lib/dates';
import { LOT_ASSET_CLASSES, isFiat } from '../../domain/reference';
import type { Account, AccountTaxTreatment, AssetClass, CorporateAction, CostBasisMethod, Instrument, TaxClass, Transaction } from '../../domain/types';
import { ZERO, audOf, feesAud, feesNative, grossOf, sortTxns, taxDateOf, type LedgerData } from '../ledger';

export type TreatmentGroup = 'capital' | 'revenue' | 'unresolved';

export interface Lot {
  id: string;
  instrumentId: string;
  group: TreatmentGroup;
  accountId?: string;
  sourceTxnId: string;
  origin: 'purchase' | 'swap' | 'income' | 'quote_asset' | 'opening' | 'corporate_action' | 'external_receive' | 'fork';
  acquiredAt: string;
  acquiredDate: string; // taxpayer-local date (CGT discount holding test)
  qtyOriginal: Decimal;
  qtyRemaining: Decimal;
  costAud: Decimal | null; // remaining cost base (null = unknown)
  costAudOriginal: Decimal | null;
  costNative: Decimal | null;
  nativeCurrency: string;
  adjustments: string[];
}

export interface Allocation {
  lotId: string;
  sourceTxnId: string;
  quantity: Decimal;
  acquiredDate: string;
  costAud: Decimal | null;
  proceedsAud: Decimal | null;
  gainAud: Decimal | null;
  heldDays: number;
  discountEligible: boolean;
  /** Acquired before 20 September 1985 on capital account: gain or loss disregarded (pre-CGT). */
  preCgt?: boolean;
}

/** CGT applies to assets acquired on or after 20 September 1985 (ITAA 1997 Div 104 / s 104-10(5)). */
export const CGT_START_DATE = '1985-09-20';
/** Indexation may be chosen instead of the discount for assets acquired before 11:45 am 21 September 1999 (s 114-10, s 115-20). */
export const INDEXATION_CUTOFF_DATE = '1999-09-21';

export interface Disposal {
  id: string;
  txnId: string;
  instrumentId: string;
  accountId?: string;
  group: TreatmentGroup;
  taxClass: TaxClass;
  kind: 'sale' | 'swap_out' | 'quote_asset' | 'fee_disposal' | 'expiry' | 'write_off_review' | 'return_of_capital_excess' | 'merger_taxable' | 'gift_or_payment';
  disposedAt: string;
  disposedDate: string;
  fy: number;
  quantity: Decimal;
  proceedsAud: Decimal | null;
  costAud: Decimal | null;
  gainAud: Decimal | null; // positive gain / negative loss
  discountEligible: boolean; // whole disposal eligible (all allocations)
  discountableGainAud: Decimal; // part of a positive gain eligible for discount
  nonDiscountableGainAud: Decimal;
  lossAud: Decimal; // positive number
  /** Gain (+) or loss (−) on pre-CGT parcels that is disregarded. */
  preCgtDisregardedAud?: Decimal;
  method: CostBasisMethod;
  allocations: Allocation[];
  flags: string[];
  proceedsNative: Decimal | null;
  costNative: Decimal | null;
  nativeCurrency: string;
}

export interface LotEngineIssue {
  txnId?: string;
  instrumentId?: string;
  code: string;
  message: string;
}

export interface LotEngineResult {
  lots: Lot[];
  disposals: Disposal[];
  issues: LotEngineIssue[];
  excludedSimulated: string[];
  spamTxnIds: string[];
}

export interface LotEngineOptions {
  taxTz: string;
  costBasisDefaults: Partial<Record<AssetClass, CostBasisMethod>>;
  /** 'tax' pools by instrument+treatment; 'economic' pools by account+instrument and includes simulated accounts. */
  mode?: 'tax' | 'economic';
}

export function treatmentGroup(t: AccountTaxTreatment | undefined): TreatmentGroup {
  if (t === 'investor_cgt') return 'capital';
  if (t === 'business_trader' || t === 'profit_making') return 'revenue';
  return 'unresolved';
}

export function classForGroup(g: TreatmentGroup): TaxClass {
  return g === 'capital' ? 'CGT_EVENT' : g === 'revenue' ? 'REVENUE_TRADING' : 'REVIEW';
}

export function isSimulatedAccount(a?: Account): boolean {
  return !!a && (a.propStatus === 'evaluation' || a.propStatus === 'funded_simulated');
}

interface Ctx {
  opts: LotEngineOptions;
  accounts: Map<string, Account>;
  instruments: Map<string, Instrument>;
  bySymbol: Map<string, Instrument>;
  pools: Map<string, Lot[]>;
  lotsById: Map<string, Lot>;
  allLots: Lot[];
  disposals: Disposal[];
  issues: LotEngineIssue[];
  pendingCostAdds: Map<string, { cost: Decimal | null; fromTxn: string }>;
  lotByTxn: Map<string, Lot[]>;
}

function poolKey(ctx: Ctx, instrumentId: string, group: TreatmentGroup, accountId?: string): string {
  return ctx.opts.mode === 'economic' ? `${accountId ?? '-'}|${instrumentId}` : `${instrumentId}|${group}`;
}

function getPool(ctx: Ctx, key: string): Lot[] {
  let p = ctx.pools.get(key);
  if (!p) ctx.pools.set(key, (p = []));
  return p;
}

function addLot(ctx: Ctx, lot: Lot) {
  const pending = ctx.pendingCostAdds.get(lot.sourceTxnId);
  if (pending) {
    lot.costAud = lot.costAud && pending.cost ? lot.costAud.plus(pending.cost) : null;
    lot.costAudOriginal = lot.costAud;
    lot.adjustments.push(`Option premium from ${pending.fromTxn} added to cost base (exercise).`);
    ctx.pendingCostAdds.delete(lot.sourceTxnId);
  }
  getPool(ctx, poolKey(ctx, lot.instrumentId, lot.group, lot.accountId)).push(lot);
  ctx.lotsById.set(lot.id, lot);
  ctx.allLots.push(lot);
  const arr = ctx.lotByTxn.get(lot.sourceTxnId) ?? [];
  arr.push(lot);
  ctx.lotByTxn.set(lot.sourceTxnId, arr);
}

function resolveMethod(ctx: Ctx, t: Transaction, inst: Instrument): CostBasisMethod {
  if (t.costBasisMethod) return t.costBasisMethod;
  if (t.specificLots?.length) return 'SPECIFIC';
  const acct = t.accountId ? ctx.accounts.get(t.accountId) : undefined;
  if (acct?.costBasisMethod) return acct.costBasisMethod;
  return ctx.opts.costBasisDefaults[inst.assetClass] ?? 'FIFO';
}

const byTime = (a: Lot, b: Lot) => (a.acquiredAt < b.acquiredAt ? -1 : a.acquiredAt > b.acquiredAt ? 1 : a.id < b.id ? -1 : 1);

/**
 * Open lots in selection order. Pools are kept in chronological order (appends happen in event
 * order; corporate-action moves re-sort the receiving pool), so FIFO/LIFO iterate lazily.
 */
function* lotsInOrder(pool: Lot[], method: CostBasisMethod): Generator<Lot> {
  if (method === 'FIFO' || method === 'SPECIFIC') {
    for (const l of pool) if (l.qtyRemaining.gt(ZERO)) yield l;
    return;
  }
  if (method === 'LIFO') {
    for (let i = pool.length - 1; i >= 0; i--) if (pool[i].qtyRemaining.gt(ZERO)) yield pool[i];
    return;
  }
  const open = pool.filter((l) => l.qtyRemaining.gt(ZERO));
  const unit = (l: Lot) => (l.costAud === null ? null : l.costAud.div(l.qtyRemaining));
  open.sort((a, b) => {
    const ua = unit(a);
    const ub = unit(b);
    if (ua === null && ub === null) return byTime(a, b);
    if (ua === null) return 1;
    if (ub === null) return -1;
    const c = ub.cmp(ua);
    return c !== 0 ? c : byTime(a, b);
  });
  yield* open;
}

function orderLots(lots: Lot[], method: CostBasisMethod): Lot[] {
  return [...lotsInOrder(lots, method)];
}

/** Drop fully consumed lots from a pool (they remain in the engine's full lot list). */
function compact(pool: Lot[]) {
  let k = 0;
  while (k < pool.length && pool[k].qtyRemaining.lte(ZERO)) k++;
  if (k >= 32) pool.splice(0, k);
}

interface DisposeInput {
  txn: Transaction;
  instrumentId: string;
  group: TreatmentGroup;
  quantity: Decimal;
  proceedsAud: Decimal | null;
  proceedsNative: Decimal | null;
  nativeCurrency: string;
  kind: Disposal['kind'];
  flags?: string[];
  forceClass?: TaxClass;
  noDiscount?: boolean;
}

function dispose(ctx: Ctx, input: DisposeInput): Disposal {
  const { txn } = input;
  const inst = ctx.instruments.get(input.instrumentId)!;
  const method = resolveMethod(ctx, txn, inst);
  const pool = getPool(ctx, poolKey(ctx, input.instrumentId, input.group, txn.accountId));
  const disposedDate = taxDateOf(txn);
  const flags = [...(input.flags ?? [])];
  let remaining = input.quantity;
  const picks: { lot: Lot; qty: Decimal }[] = [];

  if (method === 'SPECIFIC' && txn.specificLots?.length) {
    for (const pick of txn.specificLots) {
      const lot = ctx.lotsById.get(pick.lotId);
      if (!lot || !pool.includes(lot)) {
        flags.push(`Specific lot ${pick.lotId} not found in this holding — remainder matched FIFO.`);
        continue;
      }
      const q = Decimal.min(D(pick.quantity), lot.qtyRemaining, remaining);
      if (q.lte(ZERO)) continue;
      picks.push({ lot, qty: q });
      remaining = remaining.minus(q);
    }
    if (remaining.gt(ZERO)) flags.push('Specific identification did not cover the full quantity — remainder matched FIFO.');
  } else if (method === 'SPECIFIC') {
    flags.push('Specific identification selected but no lots were chosen — FIFO used. Select lots to apply specific identification.');
  }
  for (const lot of lotsInOrder(pool, method === 'SPECIFIC' ? 'FIFO' : method)) {
    if (remaining.lte(ZERO)) break;
    const already = picks.length ? picks.filter((p) => p.lot === lot).reduce((s, p) => s.plus(p.qty), ZERO) : ZERO;
    const avail = lot.qtyRemaining.minus(already);
    if (avail.lte(ZERO)) continue;
    const q = Decimal.min(avail, remaining);
    picks.push({ lot, qty: q });
    remaining = remaining.minus(q);
  }

  const allocations: Allocation[] = [];
  let costTotal: Decimal | null = ZERO;
  let costNative: Decimal | null = ZERO;
  let allEligible = true;
  for (const { lot, qty } of picks) {
    const frac = qty.div(lot.qtyRemaining);
    const cost = lot.costAud === null ? null : lot.costAud.times(frac);
    const cn = lot.costNative === null || lot.nativeCurrency !== input.nativeCurrency ? null : lot.costNative.times(frac);
    lot.costAud = lot.costAud === null ? null : lot.costAud.minus(cost!);
    lot.costNative = lot.costNative === null ? null : lot.costNative.minus(lot.costNative.times(frac));
    lot.qtyRemaining = lot.qtyRemaining.minus(qty);
    const proceeds = input.proceedsAud === null ? null : input.proceedsAud.times(qty).div(input.quantity);
    const gain = proceeds === null || cost === null ? null : proceeds.minus(cost);
    const held = heldAtLeast12Months(lot.acquiredDate, disposedDate);
    const preCgt = input.group === 'capital' && !!lot.acquiredDate && lot.acquiredDate < CGT_START_DATE;
    const eligible = input.group === 'capital' && held && !input.noDiscount && !preCgt;
    if (!eligible && !preCgt) allEligible = false;
    allocations.push({
      lotId: lot.id,
      sourceTxnId: lot.sourceTxnId,
      quantity: qty,
      acquiredDate: lot.acquiredDate,
      costAud: cost,
      proceedsAud: proceeds,
      gainAud: gain,
      heldDays: daysBetween(lot.acquiredDate, disposedDate),
      discountEligible: eligible,
      ...(preCgt ? { preCgt: true } : {})
    });
    costTotal = costTotal === null || cost === null ? null : costTotal.plus(cost);
    costNative = costNative === null || cn === null ? null : costNative.plus(cn);
  }
  if (remaining.gt(ZERO)) {
    flags.push(`MISSING_COST_BASE: ${dstr(remaining)} unit(s) disposed with no recorded acquisition (holding would go negative).`);
    ctx.issues.push({ txnId: txn.id, instrumentId: input.instrumentId, code: 'MISSING_COST_BASE', message: `Disposal of ${dstr(input.quantity)} ${inst.symbol} exceeds recorded holdings by ${dstr(remaining)}.` });
    const proceeds = input.proceedsAud === null ? null : input.proceedsAud.times(remaining).div(input.quantity);
    allocations.push({ lotId: 'UNKNOWN', sourceTxnId: '', quantity: remaining, acquiredDate: '', costAud: null, proceedsAud: proceeds, gainAud: null, heldDays: 0, discountEligible: false });
    costTotal = null;
    costNative = null;
    allEligible = false;
  }
  if (input.proceedsAud === null) {
    flags.push('MISSING_RATE: disposal proceeds could not be converted to AUD.');
  }
  if (allocations.some((a) => a.lotId !== 'UNKNOWN' && a.costAud === null)) {
    flags.push('MISSING_COST_BASE: one or more consumed lots have an unknown AUD cost base.');
  }
  const gain = input.proceedsAud === null || costTotal === null ? null : input.proceedsAud.minus(costTotal);
  let discountable = ZERO;
  let nonDiscountable = ZERO;
  let loss = ZERO;
  let preCgtAmt = ZERO;
  if (gain !== null) {
    // Split per allocation so mixed holding periods are handled exactly.
    for (const a of allocations) {
      const g = a.gainAud!;
      if (a.preCgt) preCgtAmt = preCgtAmt.plus(g);
      else if (g.gt(ZERO)) {
        if (a.discountEligible) discountable = discountable.plus(g);
        else nonDiscountable = nonDiscountable.plus(g);
      } else loss = loss.plus(g.neg());
    }
  }
  if (allocations.some((a) => a.preCgt)) {
    flags.push(`PRE_CGT: parcel(s) acquired before ${CGT_START_DATE} — gain/loss disregarded. Confirm the acquisition date (and that no corporate action or major improvement changed pre-CGT status).`);
    ctx.issues.push({ txnId: txn.id, instrumentId: input.instrumentId, code: 'PRE_CGT', message: `Disposal of ${inst.symbol} includes pre-CGT parcels (acquired before 20 September 1985) — gain/loss disregarded; confirm.` });
  }
  if (input.group === 'capital' && allocations.some((a) => !a.preCgt && a.acquiredDate && a.acquiredDate < INDEXATION_CUTOFF_DATE && a.heldDays >= 365)) {
    ctx.issues.push({ txnId: txn.id, instrumentId: input.instrumentId, code: 'INDEXATION_OPTION', message: `Disposal of ${inst.symbol} includes parcels acquired before 21 September 1999: the indexation method may be chosen instead of the discount. Indexation is not calculated (CPI factors not entered) — the discount method is used.` });
  }
  const taxClass = input.forceClass ?? classForGroup(input.group);
  if (input.group === 'unresolved') flags.push('Account tax treatment not determined — result requires classification (investor vs trader).');
  const d: Disposal = {
    id: `${txn.id}:${input.kind}:${input.instrumentId}`,
    txnId: txn.id,
    instrumentId: input.instrumentId,
    accountId: txn.accountId,
    group: input.group,
    taxClass,
    kind: input.kind,
    disposedAt: txn.occurredAt,
    disposedDate,
    fy: fyOfLocalDate(disposedDate),
    quantity: input.quantity,
    proceedsAud: input.proceedsAud,
    costAud: costTotal,
    gainAud: gain,
    discountEligible: allEligible && allocations.some((a) => !a.preCgt),
    discountableGainAud: discountable,
    nonDiscountableGainAud: nonDiscountable,
    lossAud: loss,
    ...(allocations.some((a) => a.preCgt) ? { preCgtDisregardedAud: preCgtAmt } : {}),
    method,
    allocations,
    flags,
    proceedsNative: input.proceedsNative,
    costNative,
    nativeCurrency: input.nativeCurrency
  };
  ctx.disposals.push(d);
  compact(pool);
  return d;
}

function acquire(
  ctx: Ctx,
  t: Transaction,
  instrumentId: string,
  group: TreatmentGroup,
  qty: Decimal,
  costAud: Decimal | null,
  origin: Lot['origin'],
  suffix = '',
  costNative: Decimal | null = null,
  nativeCurrency = t.currency
): Lot {
  const lot: Lot = {
    id: suffix ? `${t.id}:${suffix}` : t.id,
    instrumentId,
    group,
    accountId: t.accountId,
    sourceTxnId: t.id,
    origin,
    acquiredAt: t.occurredAt,
    acquiredDate: taxDateOf(t),
    qtyOriginal: qty,
    qtyRemaining: qty,
    costAud,
    costAudOriginal: costAud,
    costNative,
    nativeCurrency,
    adjustments: []
  };
  if (costAud === null) ctx.issues.push({ txnId: t.id, instrumentId, code: 'MISSING_RATE', message: 'Acquisition cost could not be converted to AUD — cost base unknown.' });
  addLot(ctx, lot);
  return lot;
}

/** Is `code` a crypto asset (an instrument symbol, not a fiat currency)? */
function cryptoQuote(ctx: Ctx, code: string): Instrument | undefined {
  if (isFiat(code)) return undefined;
  return ctx.bySymbol.get(code.toUpperCase());
}

function applyCorporateAction(ctx: Ctx, ca: CorporateAction, atUtc: string) {
  const inst = ctx.instruments.get(ca.instrumentId);
  if (!inst) return;
  const affected = ctx.allLots.filter((l) => l.instrumentId === ca.instrumentId && l.qtyRemaining.gt(ZERO));
  const ratio = D(ca.ratioTo).div(D(ca.ratioFrom || '1'));
  const note = `${ca.type} on ${ca.date} (${ca.ratioFrom}:${ca.ratioTo})`;
  switch (ca.type) {
    case 'split':
    case 'reverse_split':
    case 'bonus':
      for (const l of affected) {
        l.qtyRemaining = l.qtyRemaining.times(ratio);
        l.qtyOriginal = l.qtyOriginal.times(ratio);
        l.adjustments.push(`${note}: quantity × ${dstr(ratio)}, total cost base unchanged.`);
      }
      return;
    case 'symbol_change':
    case 'merger_rollover': {
      if (!ca.newInstrumentId) {
        ctx.issues.push({ instrumentId: ca.instrumentId, code: 'CORP_ACTION_INCOMPLETE', message: `${note}: no replacement instrument recorded.` });
        return;
      }
      for (const l of affected) {
        const pool = getPool(ctx, poolKey(ctx, l.instrumentId, l.group, l.accountId));
        pool.splice(pool.indexOf(l), 1);
        l.instrumentId = ca.newInstrumentId;
        l.qtyRemaining = l.qtyRemaining.times(ratio);
        l.qtyOriginal = l.qtyOriginal.times(ratio);
        l.adjustments.push(`${note}: rolled into new instrument; original acquisition date and cost base retained${ca.type === 'merger_rollover' ? ' (scrip-for-scrip rollover — confirm eligibility)' : ''}.`);
        const target = getPool(ctx, poolKey(ctx, l.instrumentId, l.group, l.accountId));
        target.push(l);
        target.sort(byTime);
      }
      if (ca.type === 'merger_rollover') ctx.issues.push({ instrumentId: ca.instrumentId, code: 'REVIEW_CORP_ACTION', message: `${note}: rollover relief assumed — confirm the choice and eligibility.` });
      return;
    }
    case 'spinoff': {
      if (!ca.newInstrumentId || !ca.costBaseAllocationPct) {
        ctx.issues.push({ instrumentId: ca.instrumentId, code: 'CORP_ACTION_INCOMPLETE', message: `${note}: spin-off needs the new instrument and cost-base apportionment %.` });
        return;
      }
      const pct = D(ca.costBaseAllocationPct).div(100);
      for (const l of affected) {
        const moved = l.costAud === null ? null : l.costAud.times(pct);
        if (l.costAud !== null) l.costAud = l.costAud.minus(moved!);
        l.adjustments.push(`${note}: ${dstr(pct.times(100))}% of cost base apportioned to spin-off.`);
        const child: Lot = {
          ...l,
          id: `${l.id}>${ca.id}`,
          instrumentId: ca.newInstrumentId,
          qtyOriginal: l.qtyRemaining.times(ratio),
          qtyRemaining: l.qtyRemaining.times(ratio),
          costAud: moved,
          costAudOriginal: moved,
          costNative: null,
          origin: 'corporate_action',
          adjustments: [`Created by ${note}; acquisition date inherited (demerger relief assumed — review).`]
        };
        addLot(ctx, child);
        getPool(ctx, poolKey(ctx, child.instrumentId, child.group, child.accountId)).sort(byTime);
      }
      ctx.issues.push({ instrumentId: ca.instrumentId, code: 'REVIEW_CORP_ACTION', message: `${note}: demerger roll-over and apportionment percentage require review.` });
      return;
    }
    case 'return_of_capital': {
      const per = D(ca.cashPerUnit);
      for (const l of affected) {
        const reduce = per.times(l.qtyRemaining);
        if (l.costAud === null) {
          l.adjustments.push(`${note}: return of capital ${dstr(reduce)} could not be applied — cost base unknown.`);
          continue;
        }
        if (reduce.gt(l.costAud)) {
          const excess = reduce.minus(l.costAud);
          l.adjustments.push(`${note}: cost base reduced to nil; excess ${dstr(excess)} is a capital gain (CGT event G1).`);
          l.costAud = ZERO;
          const date = localDateOf(atUtc, ctx.opts.taxTz);
          ctx.disposals.push({
            id: `${ca.id}:${l.id}:G1`,
            txnId: ca.id,
            instrumentId: l.instrumentId,
            accountId: l.accountId,
            group: l.group,
            taxClass: classForGroup(l.group),
            kind: 'return_of_capital_excess',
            disposedAt: atUtc,
            disposedDate: date,
            fy: fyOfLocalDate(date),
            quantity: ZERO,
            proceedsAud: excess,
            costAud: ZERO,
            gainAud: excess,
            discountEligible: l.group === 'capital' && heldAtLeast12Months(l.acquiredDate, date),
            discountableGainAud: l.group === 'capital' && heldAtLeast12Months(l.acquiredDate, date) ? excess : ZERO,
            nonDiscountableGainAud: l.group === 'capital' && heldAtLeast12Months(l.acquiredDate, date) ? ZERO : excess,
            lossAud: ZERO,
            method: 'FIFO',
            allocations: [],
            flags: ['Return of capital exceeded cost base (CGT event G1) — review.'],
            proceedsNative: null,
            costNative: null,
            nativeCurrency: 'AUD'
          });
        } else {
          l.costAud = l.costAud.minus(reduce);
          l.adjustments.push(`${note}: cost base reduced by ${dstr(reduce)} (return of capital).`);
        }
      }
      return;
    }
    case 'merger_taxable':
    case 'other':
      ctx.issues.push({ instrumentId: ca.instrumentId, code: 'REVIEW_CORP_ACTION', message: `${note}: this corporate action type is recorded but must be processed as specific transactions (sale/purchase at market value) after review.` });
      return;
  }
}

function reduceCostForTaxDeferred(ctx: Ctx, t: Transaction) {
  const td = audOf(t, t.taxDeferredAmount);
  if (!t.instrumentId || !td || td.isZero()) return;
  const lots = ctx.allLots.filter((l) => l.instrumentId === t.instrumentId && l.qtyRemaining.gt(ZERO));
  const totalQty = lots.reduce((s, l) => s.plus(l.qtyRemaining), ZERO);
  if (totalQty.isZero()) {
    ctx.issues.push({ txnId: t.id, code: 'TAX_DEFERRED_NO_HOLDING', message: 'Tax-deferred distribution recorded but no holding exists to reduce.' });
    return;
  }
  for (const l of lots) {
    const share = td.times(l.qtyRemaining).div(totalQty);
    if (l.costAud === null) continue;
    if (share.gt(l.costAud)) {
      ctx.issues.push({ txnId: t.id, code: 'REVIEW_TAX_DEFERRED', message: 'Tax-deferred amount exceeds cost base (CGT event E4 gain) — review.' });
      l.costAud = ZERO;
    } else l.costAud = l.costAud.minus(share);
    l.adjustments.push(`Tax-deferred distribution ${t.date}: cost base reduced by ${dstr(share)}.`);
  }
}

export function runLotEngine(data: LedgerData, opts: LotEngineOptions): LotEngineResult {
  const instruments = new Map(data.instruments.map((i) => [i.id, i]));
  const bySymbol = new Map<string, Instrument>();
  for (const i of data.instruments) if (i.assetClass === 'crypto' || i.assetClass === 'stablecoin') bySymbol.set(i.symbol.toUpperCase(), i);
  const ctx: Ctx = {
    opts,
    accounts: new Map(data.accounts.map((a) => [a.id, a])),
    instruments,
    bySymbol,
    pools: new Map(),
    lotsById: new Map(),
    allLots: [],
    disposals: [],
    issues: [],
    pendingCostAdds: new Map(),
    lotByTxn: new Map()
  };
  const economic = opts.mode === 'economic';
  const excludedSimulated: string[] = [];
  const spamTxnIds: string[] = [];

  type Ev = { at: string; order: number; t?: Transaction; ca?: CorporateAction };
  const events: Ev[] = [];
  for (const t of sortTxns(data.transactions.filter((x) => x.status === 'active'))) events.push({ at: t.occurredAt, order: 1, t });
  for (const ca of data.corporateActions) events.push({ at: localToUtc(ca.date, '00:00:00', opts.taxTz), order: 0, ca });
  events.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.order - b.order));

  for (const ev of events) {
    if (ev.ca) {
      applyCorporateAction(ctx, ev.ca, ev.at);
      continue;
    }
    const t = ev.t!;
    const acct = t.accountId ? ctx.accounts.get(t.accountId) : undefined;
    if (!economic && isSimulatedAccount(acct)) {
      if (t.kind === 'trade') excludedSimulated.push(t.id);
      continue;
    }
    if (t.kind === 'income' && t.taxDeferredAmount) reduceCostForTaxDeferred(ctx, t);
    const inst = t.instrumentId ? instruments.get(t.instrumentId) : undefined;
    if (!inst || !LOT_ASSET_CLASSES.includes(inst.assetClass)) continue;
    if (inst.isSpam) {
      spamTxnIds.push(t.id);
      continue;
    }
    const group = treatmentGroup(acct?.taxTreatment);
    const qty = tryD(t.quantity)?.abs() ?? ZERO;
    const quoteInst = t.kind === 'trade' ? cryptoQuote(ctx, t.currency) : undefined;

    switch (t.side) {
      case 'buy': {
        if (t.kind !== 'trade' || qty.isZero()) break;
        const gross = grossOf(t, inst);
        const fees = feesAud(t);
        const grossAud = audOf(t, gross);
        const cost = grossAud === null || fees === null ? null : grossAud.plus(fees);
        if (quoteInst) {
          // Paying with a crypto asset (e.g. USDT): that is a disposal of the quote asset at market value.
          const paidQty = gross.plus(feesNative(t));
          dispose(ctx, { txn: t, instrumentId: quoteInst.id, group, quantity: paidQty, proceedsAud: cost, proceedsNative: paidQty, nativeCurrency: t.currency, kind: 'quote_asset' });
        }
        acquire(ctx, t, inst.id, group, qty, cost, 'purchase', '', gross.plus(feesNative(t)));
        break;
      }
      case 'sell': {
        if (t.kind !== 'trade' || qty.isZero()) break;
        const gross = grossOf(t, inst);
        const fees = feesAud(t);
        const grossAud = audOf(t, gross);
        const proceeds = grossAud === null || fees === null ? null : grossAud.minus(fees);
        dispose(ctx, { txn: t, instrumentId: inst.id, group, quantity: qty, proceedsAud: proceeds, proceedsNative: gross.minus(feesNative(t)), nativeCurrency: t.currency, kind: 'sale' });
        if (quoteInst) acquire(ctx, t, quoteInst.id, group, gross.minus(feesNative(t)), proceeds, 'quote_asset', 'quote', gross.minus(feesNative(t)));
        break;
      }
      case 'swap': {
        const counter = t.counterInstrumentId ? instruments.get(t.counterInstrumentId) : undefined;
        const cq = tryD(t.counterQuantity)?.abs();
        const value = tryD(t.valuationAud);
        const fees = feesAud(t);
        const proceeds = value === null || fees === null ? null : value.minus(fees);
        const flags = value === null ? ['MISSING_VALUATION: AUD market value of the swap has not been recorded.'] : [];
        dispose(ctx, { txn: t, instrumentId: inst.id, group, quantity: qty, proceedsAud: proceeds, proceedsNative: null, nativeCurrency: 'AUD', kind: 'swap_out', flags });
        if (counter && cq && cq.gt(ZERO)) acquire(ctx, t, counter.id, group, cq, value, 'swap', 'counter', value, 'AUD');
        else ctx.issues.push({ txnId: t.id, code: 'SWAP_INCOMPLETE', message: 'Swap is missing the received asset or quantity.' });
        break;
      }
      case 'income': {
        if (qty.isZero()) break;
        const isFork = t.category === 'crypto_fork';
        const value = isFork ? ZERO : tryD(t.valuationAud) ?? audOf(t, t.amount);
        acquire(ctx, t, inst.id, group, qty, value, isFork ? 'fork' : 'income', '', null, 'AUD');
        break;
      }
      case 'receive': {
        if (qty.isZero()) break;
        if (t.isOwnTransfer || t.transferPairId) break; // own transfer — holding already pooled
        if (t.isOwnTransfer === false) {
          const value = tryD(t.valuationAud);
          acquire(ctx, t, inst.id, group, qty, value, 'external_receive');
          ctx.issues.push({ txnId: t.id, code: 'REVIEW_EXTERNAL_RECEIVE', message: 'Asset received from a third party — confirm whether it is income, a gift or a purchase.' });
        } else {
          ctx.issues.push({ txnId: t.id, code: 'UNMATCHED_TRANSFER', message: `Incoming ${inst.symbol} transfer not matched to an outgoing transfer — mark it as an own transfer or classify it.` });
        }
        break;
      }
      case 'send': {
        if (t.isOwnTransfer || t.transferPairId) {
          const fq = tryD(t.feeQuantity);
          if (fq && fq.gt(ZERO)) {
            const v = tryD(t.valuationAud);
            const flags = v === null ? ['MISSING_VALUATION: network fee paid in the asset has no AUD value.'] : [];
            dispose(ctx, { txn: t, instrumentId: inst.id, group, quantity: fq, proceedsAud: v, proceedsNative: null, nativeCurrency: 'AUD', kind: 'fee_disposal', flags });
          }
          break;
        }
        if (t.isOwnTransfer === false) {
          const v = tryD(t.valuationAud);
          dispose(ctx, { txn: t, instrumentId: inst.id, group, quantity: qty, proceedsAud: v, proceedsNative: null, nativeCurrency: 'AUD', kind: 'gift_or_payment', flags: ['Asset sent to a third party (payment/gift) — disposal at market value; review.'] });
        } else {
          ctx.issues.push({ txnId: t.id, code: 'UNMATCHED_TRANSFER', message: `Outgoing ${inst.symbol} transfer not matched — may be an own-wallet transfer or a disposal.` });
        }
        break;
      }
      case 'expire': {
        if (qty.isZero()) break;
        const held = getPool(ctx, poolKey(ctx, inst.id, group, t.accountId)).some((l) => l.qtyRemaining.gt(ZERO));
        if (!held) break; // written (short) option expiry is handled by the position engine
        dispose(ctx, { txn: t, instrumentId: inst.id, group, quantity: qty, proceedsAud: ZERO, proceedsNative: ZERO, nativeCurrency: t.currency, kind: 'expiry', flags: ['Option expired — cost is a capital loss (CGT event C2) for capital-account holders.'] });
        break;
      }
      case 'exercise': {
        if (qty.isZero()) break;
        if (inst.optionType === 'call') {
          // Consume option lots without gain/loss; carry their cost into the underlying acquisition.
          const pool = getPool(ctx, poolKey(ctx, inst.id, group, t.accountId));
          let remaining = qty;
          let cost: Decimal | null = ZERO;
          for (const lot of orderLots(pool, 'FIFO')) {
            if (remaining.lte(ZERO)) break;
            const q = Decimal.min(lot.qtyRemaining, remaining);
            const part = lot.costAud === null ? null : lot.costAud.times(q).div(lot.qtyRemaining);
            if (lot.costAud !== null) lot.costAud = lot.costAud.minus(part!);
            lot.qtyRemaining = lot.qtyRemaining.minus(q);
            lot.adjustments.push(`Exercised ${t.date}: cost carried to underlying acquisition.`);
            cost = cost === null || part === null ? null : cost.plus(part);
            remaining = remaining.minus(q);
          }
          const target = t.relatedIds.find((id) => id !== t.id);
          if (!target) {
            ctx.issues.push({ txnId: t.id, code: 'REVIEW_OPTION_EXERCISE', message: 'Call exercised but no related underlying purchase is linked — link the purchase so the premium is added to its cost base.' });
          } else {
            const existing = ctx.lotByTxn.get(target);
            if (existing?.length && existing[0].qtyRemaining.gt(ZERO)) {
              const l = existing[0];
              l.costAud = l.costAud === null || cost === null ? null : l.costAud.plus(cost);
              l.adjustments.push(`Option premium from ${t.id} added to cost base (exercise).`);
            } else ctx.pendingCostAdds.set(target, { cost, fromTxn: t.id });
          }
        } else {
          ctx.issues.push({ txnId: t.id, code: 'REVIEW_OPTION_EXERCISE', message: 'Put exercise: the premium adjustment to the underlying disposal requires specialist review — not computed.' });
        }
        break;
      }
      case 'adjustment': {
        if (qty.isZero()) break;
        if (t.adjustmentType === 'opening_balance') {
          const cost = t.providedAudAmount ? D(t.providedAudAmount) : audOf(t, t.amount);
          const lot = acquire(ctx, t, inst.id, group, qty, t.amount || t.providedAudAmount ? cost : null, 'opening');
          if (!t.amount && !t.providedAudAmount) ctx.issues.push({ txnId: t.id, code: 'MISSING_COST_BASE', message: `Opening balance for ${inst.symbol} has no cost base.` });
          void lot;
        } else if (t.adjustmentType === 'lost' || t.adjustmentType === 'stolen') {
          dispose(ctx, { txn: t, instrumentId: inst.id, group, quantity: qty, proceedsAud: ZERO, proceedsNative: ZERO, nativeCurrency: t.currency, kind: 'write_off_review', forceClass: 'REVIEW', flags: ['Lost/stolen asset: a capital loss may be available only with evidence of ownership and loss — specialist review.'] });
        } else {
          ctx.issues.push({ txnId: t.id, code: 'REVIEW_ADJUSTMENT', message: 'Quantity adjustment recorded — not applied to lots. Review.' });
        }
        break;
      }
      default:
        break;
    }
  }
  for (const [target, p] of ctx.pendingCostAdds) {
    ctx.issues.push({ txnId: p.fromTxn, code: 'REVIEW_OPTION_EXERCISE', message: `Exercise premium could not be applied: linked transaction ${target} did not create a holding.` });
  }
  return { lots: ctx.allLots, disposals: ctx.disposals, issues: ctx.issues, excludedSimulated, spamTxnIds };
}

/** Summed remaining holdings per instrument from the lot engine. */
export function holdingsFromLots(lots: Lot[]): Map<string, { qty: Decimal; costAud: Decimal | null; lots: Lot[] }> {
  const m = new Map<string, { qty: Decimal; costAud: Decimal | null; lots: Lot[] }>();
  for (const l of lots) {
    if (l.qtyRemaining.lte(ZERO)) continue;
    const e = m.get(l.instrumentId) ?? { qty: ZERO, costAud: ZERO as Decimal | null, lots: [] };
    e.qty = e.qty.plus(l.qtyRemaining);
    e.costAud = e.costAud === null || l.costAud === null ? null : e.costAud.plus(l.costAud);
    e.lots.push(l);
    m.set(l.instrumentId, e);
  }
  return m;
}
