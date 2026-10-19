/**
 * Date, time-zone and Australian financial-year utilities.
 * Timestamps are stored as UTC ISO strings with the original IANA time zone kept separately.
 */
import { DateTime } from 'luxon';

export const DEFAULT_TAX_TZ = 'Australia/Sydney';

/** Financial year identified by its ending calendar year: FY2026 = 1 Jul 2025 – 30 Jun 2026. */
export type FYear = number;

export function fyLabel(fy: FYear): string {
  return `FY${fy - 1}–${String(fy).slice(-2)}`;
}

export function fyLongLabel(fy: FYear): string {
  return `1 July ${fy - 1} – 30 June ${fy}`;
}

/** FY for a local calendar date string YYYY-MM-DD. */
export function fyOfLocalDate(isoDate: string): FYear {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate);
  if (!m) throw new Error(`Invalid date: ${isoDate}`);
  const year = Number(m[1]);
  const month = Number(m[2]);
  return month >= 7 ? year + 1 : year;
}

/** FY for a UTC instant, evaluated in the taxpayer's time zone. */
export function fyOfInstant(utcIso: string, taxTz = DEFAULT_TAX_TZ): FYear {
  return fyOfLocalDate(localDateOf(utcIso, taxTz));
}

export function fyStart(fy: FYear): string {
  return `${fy - 1}-07-01`;
}
export function fyEnd(fy: FYear): string {
  return `${fy}-06-30`;
}

/** Current FY according to the user's local Australian date (never hard-coded). */
export function currentFY(now: Date = new Date(), taxTz = DEFAULT_TAX_TZ): FYear {
  return fyOfInstant(now.toISOString(), taxTz);
}

export function localDateOf(utcIso: string, tz: string): string {
  const dt = DateTime.fromISO(utcIso, { zone: 'utc' }).setZone(tz);
  if (!dt.isValid) throw new Error(`Invalid timestamp: ${utcIso}`);
  return dt.toISODate()!;
}

/**
 * Convert a wall-clock local date/time in a given zone into a UTC ISO instant.
 * Handles daylight-saving transitions: non-existent local times (spring-forward gap)
 * are shifted forward by Luxon; ambiguous times (fall-back) resolve to the earlier offset.
 */
export function localToUtc(date: string, time: string | undefined, tz: string): string {
  const t = normaliseTime(time);
  const dt = DateTime.fromISO(`${date}T${t}`, { zone: tz });
  if (!dt.isValid) throw new Error(`Invalid local date/time ${date} ${time ?? ''} (${tz}): ${dt.invalidExplanation}`);
  return dt.toUTC().toISO({ suppressMilliseconds: true })!;
}

/** Is a wall-clock time inside a DST gap (doesn't exist) in that zone? */
export function isNonexistentLocalTime(date: string, time: string, tz: string): boolean {
  const t = normaliseTime(time);
  const dt = DateTime.fromISO(`${date}T${t}`, { zone: tz });
  return dt.isValid && dt.toFormat('HH:mm:ss') !== t;
}

export function normaliseTime(time?: string): string {
  if (!time || !time.trim()) return '00:00:00';
  const s = time.trim().toUpperCase();
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?\s*(AM|PM)?$/.exec(s);
  if (!m) throw new Error(`Invalid time: ${time}`);
  let h = Number(m[1]);
  const min = Number(m[2]);
  const sec = Number(m[3] ?? 0);
  if (m[4]) {
    if (h < 1 || h > 12) throw new Error(`Invalid 12-hour time: ${time}`);
    if (m[4] === 'AM') h = h === 12 ? 0 : h;
    else h = h === 12 ? 12 : h + 12;
  }
  if (h > 23 || min > 59 || sec > 59) throw new Error(`Invalid time: ${time}`);
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

export type DateFormat = 'dd/MM/yyyy' | 'd MMM yyyy' | 'yyyy-MM-dd';
export type TimeFormat = '12h' | '24h';

export function formatDate(isoDate: string | undefined | null, fmt: DateFormat = 'dd/MM/yyyy'): string {
  if (!isoDate) return '';
  const dt = DateTime.fromISO(isoDate.slice(0, 10));
  return dt.isValid ? dt.toFormat(fmt) : isoDate;
}

export function formatInstant(
  utcIso: string | undefined | null,
  tz: string,
  opts: { dateFormat?: DateFormat; timeFormat?: TimeFormat; showZone?: boolean } = {}
): string {
  if (!utcIso) return '';
  const dt = DateTime.fromISO(utcIso, { zone: 'utc' }).setZone(tz);
  if (!dt.isValid) return utcIso;
  const t = (opts.timeFormat ?? '12h') === '12h' ? 'h:mm:ss a' : 'HH:mm:ss';
  return dt.toFormat(`${opts.dateFormat ?? 'dd/MM/yyyy'} ${t}`) + (opts.showZone ? ` ${dt.offsetNameShort ?? tz}` : '');
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function isValidIsoDate(s: string | undefined | null): boolean {
  if (!s) return false;
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && DateTime.fromISO(s).isValid;
}

export function isValidZone(tz: string): boolean {
  return DateTime.local().setZone(tz).isValid;
}

/** Add calendar days to an ISO date. */
export function addDays(isoDate: string, days: number): string {
  return DateTime.fromISO(isoDate).plus({ days }).toISODate()!;
}

/** Whole days between two ISO dates (b - a). */
export function daysBetween(a: string, b: string): number {
  const t = (s: string) => Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)));
  return Math.round((t(b) - t(a)) / 86_400_000);
}

/**
 * CGT discount holding test (s115-25 ITAA 1997): the asset must have been acquired at
 * least 12 months before the CGT event. The ATO's guidance excludes the day of acquisition
 * and the day of the CGT event, so the earliest qualifying disposal date is the day after
 * the 12-month anniversary of acquisition (e.g. acquired 1 Jul 2023 → qualifies from 2 Jul 2024).
 */
export function heldAtLeast12Months(acquiredLocalDate: string, disposedLocalDate: string): boolean {
  const y = Number(acquiredLocalDate.slice(0, 4)) + 1;
  const m = acquiredLocalDate.slice(5, 7);
  let d = acquiredLocalDate.slice(8, 10);
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  if (m === '02' && d === '29' && !leap) d = '28';
  const anniversary = `${String(y).padStart(4, '0')}-${m}-${d}`;
  return disposedLocalDate.slice(0, 10) > anniversary;
}

export function listFYs(from: FYear, to: FYear): FYear[] {
  const out: FYear[] = [];
  for (let y = to; y >= from; y--) out.push(y);
  return out;
}

/** BAS quarters within a FY (quarterly cycle). */
export function basQuarters(fy: FYear): { label: string; start: string; end: string }[] {
  const y0 = fy - 1;
  return [
    { label: `Q1 (Jul–Sep ${y0})`, start: `${y0}-07-01`, end: `${y0}-09-30` },
    { label: `Q2 (Oct–Dec ${y0})`, start: `${y0}-10-01`, end: `${y0}-12-31` },
    { label: `Q3 (Jan–Mar ${fy})`, start: `${fy}-01-01`, end: `${fy}-03-31` },
    { label: `Q4 (Apr–Jun ${fy})`, start: `${fy}-04-01`, end: `${fy}-06-30` }
  ];
}
