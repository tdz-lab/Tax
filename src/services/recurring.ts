/** Recurring entries: generates due records idempotently (record id = recurring id + date). */
import { DateTime } from 'luxon';
import { getDb } from '../db/schema';
import type { Recurring } from '../domain/types';
import { saveTransaction, saveEntity } from './ledger';

export function dueDates(r: Recurring, until: string): string[] {
  const out: string[] = [];
  let d = DateTime.fromISO(r.startDate);
  const end = DateTime.fromISO(r.endDate && r.endDate < until ? r.endDate : until);
  const step = { weekly: { weeks: 1 }, fortnightly: { weeks: 2 }, monthly: { months: 1 }, quarterly: { months: 3 }, annually: { years: 1 } }[r.frequency];
  let i = 0;
  while (d <= end && i < 2000) {
    const iso = d.toISODate()!;
    if (!r.lastGeneratedDate || iso > r.lastGeneratedDate) out.push(iso);
    i++;
    d = DateTime.fromISO(r.startDate).plus(Object.fromEntries(Object.entries(step).map(([k, v]) => [k, v * i])));
  }
  return out;
}

export async function generateRecurring(until: string): Promise<number> {
  const db = getDb();
  let n = 0;
  for (const r of await db.recurring.toArray()) {
    if (!r.active) continue;
    const dates = dueDates(r, until);
    for (const date of dates) {
      const id = `rec_${r.id}_${date}`;
      if (await db.transactions.get(id)) continue;
      await saveTransaction({ ...r.template, id, date, source: 'recurring', recurringId: r.id, description: r.template.description || r.name }, { reason: `Recurring entry ${r.name}` });
      n++;
    }
    if (dates.length) await saveEntity('recurring', { ...r, lastGeneratedDate: dates[dates.length - 1] });
  }
  return n;
}
