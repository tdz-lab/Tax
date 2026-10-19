/**
 * Depreciation (Div 40 capital allowances) schedules.
 *  Prime cost:        cost × (days held ÷ 365) × (100% ÷ effective life)
 *  Diminishing value: base value × (days held ÷ 365) × (200% ÷ effective life)   (assets acquired after 10 May 2006)
 *  Instant asset write-off: full cost in the year first used/installed (eligibility & threshold flagged)
 *  Low-value pool: 18.75% in the year allocated, 37.5% of the opening pool balance thereafter (simplified per asset)
 * The deductible amount is reduced by private use (business-use %). Balancing adjustments are flagged.
 */
import { D, Decimal } from '../../lib/decimal';
import { daysBetween, fyEnd, fyOfLocalDate, fyStart, type FYear } from '../../lib/dates';
import type { Asset } from '../../domain/types';
import { ruleSetFor } from '../tax/rules';

export interface DepreciationYear {
  fy: FYear;
  openingValue: Decimal;
  daysHeld: number;
  decline: Decimal; // total decline in value
  deductible: Decimal; // business-use portion
  closingValue: Decimal;
  balancingAdjustment?: Decimal; // + assessable / − deductible (business portion)
  flags: string[];
}

export interface DepreciationSchedule {
  assetId: string;
  years: DepreciationYear[];
  flags: string[];
}

const ZERO = new Decimal(0);

export function depreciationSchedule(asset: Asset, upToFy: FYear): DepreciationSchedule {
  const flags: string[] = [];
  const start = asset.installedReadyDate || asset.acquisitionDate;
  const firstFy = fyOfLocalDate(start);
  const cost = D(asset.cost);
  const bus = D(asset.businessUsePct || '100').div(100);
  const life = asset.effectiveLifeYears ? D(asset.effectiveLifeYears) : null;
  const years: DepreciationYear[] = [];
  if (asset.method === 'none') return { assetId: asset.id, years, flags: ['No depreciation method selected.'] };
  if ((asset.method === 'prime_cost' || asset.method === 'diminishing_value') && (!life || life.lte(0))) {
    return { assetId: asset.id, years, flags: ['Effective life is required for prime cost / diminishing value.'] };
  }
  let value = cost;
  let fyStartIdx = firstFy;
  if (asset.openingAdjustableValue && asset.openingValueFY) {
    value = D(asset.openingAdjustableValue);
    fyStartIdx = asset.openingValueFY;
    flags.push(`Opening adjustable value ${asset.openingAdjustableValue} supplied for FY${asset.openingValueFY}.`);
  }
  const disposalFy = asset.disposalDate ? fyOfLocalDate(asset.disposalDate) : null;
  for (let fy = fyStartIdx; fy <= upToFy; fy++) {
    if (disposalFy !== null && fy > disposalFy) break;
    const from = fy === firstFy ? start : fyStart(fy);
    const to = disposalFy === fy ? asset.disposalDate! : fyEnd(fy);
    const daysHeld = Math.max(0, daysBetween(from, to) + 1);
    const yflags: string[] = [];
    let decline = ZERO;
    if (value.lte(0)) {
      decline = ZERO;
    } else if (asset.method === 'prime_cost') {
      decline = Decimal.min(value, cost.times(daysHeld).div(365).div(life!));
    } else if (asset.method === 'diminishing_value') {
      decline = Decimal.min(value, value.times(daysHeld).div(365).times(2).div(life!));
    } else if (asset.method === 'instant_write_off') {
      if (fy === firstFy) {
        decline = value;
        const rs = ruleSetFor(fy);
        const iawo = rs?.instantAssetWriteOff;
        if (!iawo) yflags.push('No instant asset write-off parameters recorded for this year — eligibility must be confirmed.');
        else {
          if (iawo.threshold > 0 && cost.gte(iawo.threshold)) yflags.push(`Cost ${cost.toFixed(2)} is not below the $${iawo.threshold} threshold — write-off likely not available.`);
          if (iawo.status !== 'verified') yflags.push(`Instant asset write-off: ${iawo.note}`);
        }
      }
    } else if (asset.method === 'low_value_pool') {
      const rs = ruleSetFor(fy)?.lowValuePool ?? { firstYearRate: '0.1875', subsequentRate: '0.375' };
      decline = Decimal.min(value, value.times(fy === firstFy ? rs.firstYearRate : rs.subsequentRate));
      yflags.push('Low-value pool calculated per asset (simplified) — pool balance should be reviewed.');
    }
    const closing = value.minus(decline);
    const y: DepreciationYear = { fy, openingValue: value, daysHeld, decline, deductible: decline.times(bus), closingValue: closing, flags: yflags };
    if (disposalFy === fy) {
      const proceeds = D(asset.disposalProceeds);
      y.balancingAdjustment = proceeds.minus(closing).times(bus);
      y.flags.push('Asset disposed: balancing adjustment event — assessable if proceeds exceed adjustable value, deductible if less. Review private-use and CGT interaction.');
    }
    years.push(y);
    value = closing;
  }
  if (bus.lt(1)) flags.push(`Private use ${D(100).minus(D(asset.businessUsePct || '100')).toFixed()}% excluded from deductions.`);
  return { assetId: asset.id, years, flags };
}
