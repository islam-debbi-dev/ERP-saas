import { nextAlgiersTime } from './algiers';

describe('nextAlgiersTime', () => {
  it('is later the same day when the time has not passed yet (Algiers = UTC+1)', () => {
    // 01:30 Algiers → 03:00 Algiers the same day = 02:00 UTC.
    expect(nextAlgiersTime(3, 0, new Date('2026-10-22T00:30:00Z')).toISOString()).toBe(
      '2026-10-22T02:00:00.000Z',
    );
  });

  it('is the next day once the time has passed, including exactly at it', () => {
    expect(nextAlgiersTime(3, 0, new Date('2026-10-22T02:00:00Z')).toISOString()).toBe(
      '2026-10-23T02:00:00.000Z',
    );
    expect(nextAlgiersTime(3, 0, new Date('2026-12-31T22:30:00Z')).toISOString()).toBe(
      '2027-01-01T02:00:00.000Z',
    );
  });

  it('handles 00:xx Algiers, which is the previous UTC day', () => {
    // 00:15 Algiers on Oct 23 = 23:15 UTC on Oct 22.
    expect(nextAlgiersTime(0, 15, new Date('2026-10-22T12:00:00Z')).toISOString()).toBe(
      '2026-10-22T23:15:00.000Z',
    );
  });
});
