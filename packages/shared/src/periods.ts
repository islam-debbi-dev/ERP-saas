/**
 * Calendar days as `YYYY-MM-DD` strings in Algiers time. Algiers has no DST
 * (UTC+1 all year), so plain UTC date arithmetic on these strings is exact.
 */

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

function parse(day: string): Date {
  const m = ISO_DAY.exec(day);
  if (!m) throw new Error(`invalid day ${day}`);
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

function format(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** The Algiers calendar day of an instant. */
export function algiersDay(instant: Date = new Date()): string {
  return format(new Date(instant.getTime() + 60 * 60 * 1000));
}

export function addDays(day: string, days: number): string {
  const d = parse(day);
  d.setUTCDate(d.getUTCDate() + days);
  return format(d);
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Inclusive range of days: `from` to `to`. */
export interface DayRange {
  from: string;
  to: string;
}

/** The 1st of the month up to `day` included. */
export function monthToDate(day: string): DayRange {
  return { from: `${day.slice(0, 7)}-01`, to: day };
}

/**
 * The same days of the previous month: 1st to the same day number, clipped to
 * that month's length (31 March compares with 1–28/29 February).
 */
export function previousMonthToDate(day: string): DayRange {
  const d = parse(day);
  const year = d.getUTCMonth() === 0 ? d.getUTCFullYear() - 1 : d.getUTCFullYear();
  const month = d.getUTCMonth() === 0 ? 12 : d.getUTCMonth();
  const last = Math.min(d.getUTCDate(), daysInMonth(year, month));
  const mm = String(month).padStart(2, '0');
  return { from: `${year}-${mm}-01`, to: `${year}-${mm}-${String(last).padStart(2, '0')}` };
}

/** Number of days in an inclusive range. */
export function rangeLength(range: DayRange): number {
  return Math.round((parse(range.to).getTime() - parse(range.from).getTime()) / 86_400_000) + 1;
}

/** Day of the week of an Algiers day, 0 = Sunday (the Algerian week starts on Sunday). */
export function weekdayOf(day: string): number {
  return parse(day).getUTCDay();
}

/** The UTC instants an Algiers day runs between: `[start, end)`. */
export function algiersDayBounds(day: string): { start: Date; end: Date } {
  const start = new Date(parse(day).getTime() - 60 * 60 * 1000);
  return { start, end: new Date(start.getTime() + 86_400_000) };
}
