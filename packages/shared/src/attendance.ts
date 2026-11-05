/**
 * Pointage and congés (phase 31): pure rules, used by the API, the reconcile and the
 * payroll of phase 31b. Days are Algiers `YYYY-MM-DD` strings (see periods.ts). Day
 * counts and hours go through the decimal helpers, never float arithmetic.
 */
import {
  AbsenceReason,
  AttendanceEventKind,
  type CorrectableStatus,
  DayStatus,
  LeaveType,
} from './enums';
import { money, sum } from './money';
import { addDays, daysInMonth, weekdayOf } from './periods';

/** Friday, the Algerian weekly rest day (0 = Sunday). */
export const DEFAULT_REST_DAYS: readonly number[] = [5];
export const DEFAULT_DAILY_HOURS = 8;
/** Congé days earned by a full month of work. */
export const DEFAULT_LEAVE_ACCRUAL_DAYS = '2.5';

/** One letter per status, on the month grid and in its Excel export. */
export const STATUS_LETTERS: Record<DayStatus, string> = {
  [DayStatus.PRESENT]: 'P',
  [DayStatus.ABSENT_UNJUSTIFIED]: 'A',
  [DayStatus.ABSENT_JUSTIFIED]: 'J',
  [DayStatus.SICK]: 'M',
  [DayStatus.LEAVE_PAID]: 'C',
  [DayStatus.LEAVE_UNPAID]: 'S',
  [DayStatus.HALF_DAY]: 'D',
  [DayStatus.REST]: 'R',
  [DayStatus.HOLIDAY]: 'F',
  [DayStatus.NOT_EMPLOYED]: '-',
  [DayStatus.UNMARKED]: '?',
};

export interface AttendanceDayEvent {
  kind: AttendanceEventKind;
  absenceReason?: AbsenceReason | null;
  correctedTo?: CorrectableStatus | null;
  lateMinutes?: number | null;
  overtimeHours?: string | null;
}

export interface DayContext {
  day: string;
  hireDate: string;
  exitDate?: string | null;
  restDays: readonly number[];
  holidays: ReadonlySet<string>;
  /** The approved leave covering this day, if any. */
  leaveType?: LeaveType | null;
  /** The day's events, oldest first. */
  events: readonly AttendanceDayEvent[];
}

const LEAVE_STATUS: Record<LeaveType, DayStatus> = {
  [LeaveType.PAID]: DayStatus.LEAVE_PAID,
  [LeaveType.UNPAID]: DayStatus.LEAVE_UNPAID,
  [LeaveType.SICK]: DayStatus.SICK,
  [LeaveType.OTHER]: DayStatus.ABSENT_JUSTIFIED,
};

const ABSENCE_STATUS: Record<AbsenceReason, DayStatus> = {
  [AbsenceReason.JUSTIFIED]: DayStatus.ABSENT_JUSTIFIED,
  [AbsenceReason.SICK]: DayStatus.SICK,
  [AbsenceReason.UNJUSTIFIED]: DayStatus.ABSENT_UNJUSTIFIED,
};

function lastCorrectionIndex(events: readonly AttendanceDayEvent[]): number {
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i]?.kind === AttendanceEventKind.CORRECTION) return i;
  }
  return -1;
}

/** What a mark says on its own; null for the events that say nothing about presence. */
function statusOfEvent(e: AttendanceDayEvent): DayStatus | null {
  switch (e.kind) {
    case AttendanceEventKind.PRESENT:
    case AttendanceEventKind.LATE:
    case AttendanceEventKind.CHECK_IN:
      return DayStatus.PRESENT;
    case AttendanceEventKind.HALF_DAY:
      return DayStatus.HALF_DAY;
    case AttendanceEventKind.ABSENT:
      return ABSENCE_STATUS[e.absenceReason ?? AbsenceReason.UNJUSTIFIED];
    default:
      return null;
  }
}

/** The status the day's marks give, ignoring leaves and the calendar. */
function markedStatus(events: readonly AttendanceDayEvent[]): DayStatus | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const status = statusOfEvent(events[i]!);
    if (status) return status;
  }
  return null;
}

/**
 * The status of a day. First match wins: not employed, a correction, an approved leave on
 * a working day, a worked rest day or holiday, holiday, rest day, the day's last mark,
 * unmarked. A correction back to `UNMARKED` cancels the marks before it, so the day
 * falls through to the rules below it. A day never marked stays `UNMARKED`.
 */
export function deriveDayStatus(ctx: DayContext): DayStatus {
  if (ctx.day < ctx.hireDate || (ctx.exitDate && ctx.day > ctx.exitDate)) {
    return DayStatus.NOT_EMPLOYED;
  }
  const corrected = lastCorrectionIndex(ctx.events);
  const correction = corrected >= 0 ? ctx.events[corrected] : undefined;
  if (correction?.correctedTo && correction.correctedTo !== DayStatus.UNMARKED) {
    return correction.correctedTo;
  }
  const holiday = ctx.holidays.has(ctx.day);
  const rest = ctx.restDays.includes(weekdayOf(ctx.day));
  if (ctx.leaveType && !holiday && !rest) return LEAVE_STATUS[ctx.leaveType];

  const marked = markedStatus(ctx.events.slice(corrected + 1));
  if (holiday || rest) {
    // Worked on a day off: 31b pays it. An absence on a day off means nothing.
    if (marked === DayStatus.PRESENT || marked === DayStatus.HALF_DAY) return marked;
    return holiday ? DayStatus.HOLIDAY : DayStatus.REST;
  }
  return marked ?? DayStatus.UNMARKED;
}

/** Lateness and overtime of a day. A correction restarts both from its own figures. */
export function dayFigures(events: readonly AttendanceDayEvent[]): {
  lateMinutes: number;
  overtimeHours: string;
} {
  const corrected = lastCorrectionIndex(events);
  const correction = corrected >= 0 ? events[corrected] : undefined;
  let lateMinutes = correction?.lateMinutes ?? 0;
  const hours: string[] = correction?.overtimeHours ? [correction.overtimeHours] : [];
  for (const e of events.slice(corrected + 1)) {
    if (e.kind === AttendanceEventKind.LATE) lateMinutes = e.lateMinutes ?? 0;
    if (e.kind === AttendanceEventKind.OVERTIME && e.overtimeHours) hours.push(e.overtimeHours);
  }
  return { lateMinutes, overtimeHours: sum(hours).toFixed(2) };
}

/** True when a new mark would replace what the day already says: that takes a correction. */
export function dayIsMarked(events: readonly AttendanceDayEvent[]): boolean {
  const corrected = lastCorrectionIndex(events);
  const correction = corrected >= 0 ? events[corrected] : undefined;
  if (correction?.correctedTo && correction.correctedTo !== DayStatus.UNMARKED) return true;
  return markedStatus(events.slice(corrected + 1)) !== null;
}

export interface WorkCalendar {
  restDays: readonly number[];
  holidays: ReadonlySet<string>;
}

export function isWorkingDay(day: string, calendar: WorkCalendar): boolean {
  return !calendar.restDays.includes(weekdayOf(day)) && !calendar.holidays.has(day);
}

/** Every day from `from` to `to` included. */
export function listDays(from: string, to: string): string[] {
  const days: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
  return days;
}

/** The working days of a range, rest days and holidays left out. */
export function workingDaysBetween(from: string, to: string, calendar: WorkCalendar): string[] {
  return listDays(from, to).filter((d) => isWorkingDay(d, calendar));
}

/** Congé days a leave takes: its working days only. */
export function leaveDaysTaken(from: string, to: string, calendar: WorkCalendar): number {
  return workingDaysBetween(from, to, calendar).length;
}

/** Only a paid leave comes out of the balance; the others only change the day's status. */
export function leaveUsesBalance(type: LeaveType): boolean {
  return type === LeaveType.PAID;
}

/** `YYYY-MM` → first and last day. */
export function monthBounds(month: string): { from: string; to: string } {
  const year = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  return {
    from: `${month}-01`,
    to: `${month}-${String(daysInMonth(year, m)).padStart(2, '0')}`,
  };
}

/** The `YYYY-MM` before `month`. */
export function previousMonth(month: string): string {
  return addDays(`${month}-01`, -1).slice(0, 7);
}

/** The `YYYY-MM` after `month`. */
export function nextMonth(month: string): string {
  return addDays(monthBounds(month).to, 1).slice(0, 7);
}

/**
 * Closed months still owed a congé accrual, oldest first: every month to the last closed
 * one, or to the exit, that has none. They start at the latest of the hire, the month the
 * file was created (a company brings its long-serving staff in with their balance, not their
 * whole career) and an OPENING balance, which holds what was earned before it.
 */
export function missingAccrualMonths(input: {
  hireDate: string;
  exitDate?: string | null;
  createdMonth: string;
  openingMonth?: string | null;
  lastClosedMonth: string;
  posted: Iterable<string>;
}): string[] {
  const posted = new Set(input.posted);
  const start = [input.hireDate.slice(0, 7), input.createdMonth, input.openingMonth ?? '']
    .sort()
    .at(-1)!;
  const left = input.exitDate?.slice(0, 7);
  const end = left && left < input.lastClosedMonth ? left : input.lastClosedMonth;
  const months: string[] = [];
  for (let m = start; m <= end; m = nextMonth(m)) {
    if (!posted.has(m)) months.push(m);
  }
  return months;
}

/**
 * Congé days earned in a month, one decimal (half-up): the monthly rate, prorated by the
 * calendar days employed when the worker was hired or left during the month.
 */
export function accrualForMonth(
  month: string,
  hireDate: string,
  exitDate: string | null | undefined,
  monthlyDays: string = DEFAULT_LEAVE_ACCRUAL_DAYS,
): string {
  const { from, to } = monthBounds(month);
  const start = hireDate > from ? hireDate : from;
  const end = exitDate && exitDate < to ? exitDate : to;
  if (start > end) return '0.0';
  const employed = listDays(start, end).length;
  const total = listDays(from, to).length;
  return money(monthlyDays).mul(employed).div(total).toFixed(1);
}

export interface DatedSalary {
  effectiveFrom: string;
}

/** The row in force on a day: the last one on or before it. Rows are never edited. */
export function salaryOn<T extends DatedSalary>(rows: readonly T[], day: string): T | null {
  let found: T | null = null;
  for (const row of rows) {
    if (row.effectiveFrom > day) continue;
    if (!found || row.effectiveFrom >= found.effectiveFrom) found = row;
  }
  return found;
}

export interface MonthCounts {
  /** Half days count 0.5. */
  present: string;
  halfDays: number;
  absentJustified: number;
  absentUnjustified: number;
  sick: number;
  leavePaid: number;
  leaveUnpaid: number;
  unmarked: number;
  lateMinutes: number;
  overtimeHours: string;
}

export function monthCounts(
  days: readonly { status: DayStatus; lateMinutes?: number; overtimeHours?: string }[],
): MonthCounts {
  const count = (s: DayStatus) => days.filter((d) => d.status === s).length;
  const halfDays = count(DayStatus.HALF_DAY);
  return {
    present: money(count(DayStatus.PRESENT)).add(money(halfDays).div(2)).toFixed(1),
    halfDays,
    absentJustified: count(DayStatus.ABSENT_JUSTIFIED),
    absentUnjustified: count(DayStatus.ABSENT_UNJUSTIFIED),
    sick: count(DayStatus.SICK),
    leavePaid: count(DayStatus.LEAVE_PAID),
    leaveUnpaid: count(DayStatus.LEAVE_UNPAID),
    unmarked: count(DayStatus.UNMARKED),
    lateMinutes: days.reduce((n, d) => n + (d.lateMinutes ?? 0), 0),
    overtimeHours: sum(days.map((d) => d.overtimeHours ?? '0')).toFixed(2),
  };
}

/** Fêtes légales on a fixed date, seeded every year. */
export const FIXED_PUBLIC_HOLIDAYS: readonly { monthDay: string; key: string; name: string }[] = [
  { monthDay: '01-01', key: 'NEW_YEAR', name: "Jour de l'an" },
  { monthDay: '01-12', key: 'YENNAYER', name: 'Yennayer' },
  { monthDay: '05-01', key: 'LABOUR_DAY', name: 'Fête du travail' },
  { monthDay: '07-05', key: 'INDEPENDENCE', name: "Fête de l'indépendance" },
  { monthDay: '11-01', key: 'REVOLUTION', name: 'Fête de la révolution' },
];

/** Their dates move every year: the tenant enters them, the screen reminds him. */
export const LUNAR_HOLIDAY_KEYS = [
  'AID_EL_FITR',
  'AID_EL_ADHA',
  'AWAL_MOHARRAM',
  'ACHOURA',
  'MAWLID',
] as const;
export type LunarHolidayKey = (typeof LUNAR_HOLIDAY_KEYS)[number];

/** The lunar fêtes of a year not entered yet, given the keys of that year's rows. */
export function missingLunarHolidays(keys: readonly (string | null)[]): LunarHolidayKey[] {
  return LUNAR_HOLIDAY_KEYS.filter((k) => !keys.includes(k));
}
