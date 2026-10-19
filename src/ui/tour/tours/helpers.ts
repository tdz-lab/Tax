import type { Transaction } from '../../../domain/types';
import { resolveTarget } from '../resolve';
import type { TourCtx, TryIt } from '../types';

/** Current value of the input/select inside a field target. */
export function valueOf(target: string): string | null {
  const el = resolveTarget(target);
  if (!el) return null;
  const c = (el.matches('input, select, textarea') ? el : el.querySelector('input, select, textarea')) as HTMLInputElement | HTMLSelectElement | null;
  return c ? c.value : null;
}

export const tryOpenDialog = (hint: string): TryIt => ({ hint, check: (ctx: TourCtx) => ctx.dialogOpen() });
export const tryValue = (hint: string, target: string, value: string | ((v: string) => boolean)): TryIt => ({
  hint,
  check: () => {
    const v = valueOf(target);
    return v !== null && (typeof value === 'function' ? value(v) : v === value);
  }
});
export const tryCreated = (hint: string, filter?: (t: Transaction) => boolean): TryIt => ({ hint, check: async (ctx) => (await ctx.countCreatedSince(filter)) > 0 });
export const tryRoute = (hint: string, prefix: string): TryIt => ({ hint, check: () => window.location.hash.replace(/^#/, '').startsWith(prefix) });
export const tryVisible = (hint: string, target: string): TryIt => ({ hint, check: () => !!resolveTarget(target) });
