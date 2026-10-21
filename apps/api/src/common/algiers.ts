import { addDays } from '@erp/shared';

/** Midnight of an Algiers day as an instant. Algiers has no DST: always UTC+1. */
export function algiersMidnight(day: string): Date {
  return new Date(`${day}T00:00:00+01:00`);
}

/** Half-open instant range covering the Algiers days `from` to `to` included. */
export function algiersRange(from: string, to: string): { start: Date; end: Date } {
  return { start: algiersMidnight(from), end: algiersMidnight(addDays(to, 1)) };
}
