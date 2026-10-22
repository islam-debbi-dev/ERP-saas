import { addDays } from '@erp/shared';

/** Midnight of an Algiers day as an instant. Algiers has no DST: always UTC+1. */
export function algiersMidnight(day: string): Date {
  return new Date(`${day}T00:00:00+01:00`);
}

/** Half-open instant range covering the Algiers days `from` to `to` included. */
export function algiersRange(from: string, to: string): { start: Date; end: Date } {
  return { start: algiersMidnight(from), end: algiersMidnight(addDays(to, 1)) };
}

/** The next instant (after `now`) at hour:minute Algiers time. */
export function nextAlgiersTime(hour: number, minute: number, now = new Date()): Date {
  // Algiers is UTC+1 all year, so hour:00 Algiers is (hour - 1):00 UTC.
  const next = new Date(now);
  next.setUTCHours(hour - 1, minute, 0, 0);
  if (next.getTime() <= now.getTime()) next.setUTCDate(next.getUTCDate() + 1);
  return next;
}
