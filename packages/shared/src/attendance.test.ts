import { describe, expect, it } from 'vitest';
import {
  accrualForMonth,
  missingAccrualMonths,
  type AttendanceDayEvent,
  dayFigures,
  dayIsMarked,
  type DayContext,
  deriveDayStatus,
  leaveDaysTaken,
  leaveUsesBalance,
  missingLunarHolidays,
  monthBounds,
  monthCounts,
  previousMonth,
  salaryOn,
  workingDaysBetween,
} from './attendance';
import { AbsenceReason, AttendanceEventKind as K, DayStatus as S, LeaveType } from './enums';

// 2026-11-02 is a Monday, 2026-11-06 a Friday.
const MONDAY = '2026-11-02';
const FRIDAY = '2026-11-06';
const ctx = (over: Partial<DayContext> = {}): DayContext => ({
  day: MONDAY,
  hireDate: '2026-01-01',
  restDays: [5],
  holidays: new Set(),
  events: [],
  ...over,
});
const ev = (kind: K, extra: Partial<AttendanceDayEvent> = {}): AttendanceDayEvent => ({
  kind,
  ...extra,
});

describe('deriveDayStatus', () => {
  it('leaves a day nobody marked as UNMARKED, never present', () => {
    expect(deriveDayStatus(ctx())).toBe(S.UNMARKED);
  });

  it('reads the marks', () => {
    expect(deriveDayStatus(ctx({ events: [ev(K.PRESENT)] }))).toBe(S.PRESENT);
    expect(deriveDayStatus(ctx({ events: [ev(K.LATE, { lateMinutes: 20 })] }))).toBe(S.PRESENT);
    expect(deriveDayStatus(ctx({ events: [ev(K.CHECK_IN)] }))).toBe(S.PRESENT);
    expect(deriveDayStatus(ctx({ events: [ev(K.HALF_DAY)] }))).toBe(S.HALF_DAY);
    expect(deriveDayStatus(ctx({ events: [ev(K.ABSENT)] }))).toBe(S.ABSENT_UNJUSTIFIED);
    expect(
      deriveDayStatus(ctx({ events: [ev(K.ABSENT, { absenceReason: AbsenceReason.JUSTIFIED })] })),
    ).toBe(S.ABSENT_JUSTIFIED);
    expect(
      deriveDayStatus(ctx({ events: [ev(K.ABSENT, { absenceReason: AbsenceReason.SICK })] })),
    ).toBe(S.SICK);
  });

  it('ignores the events that say nothing about presence', () => {
    expect(deriveDayStatus(ctx({ events: [ev(K.OVERTIME, { overtimeHours: '2' })] }))).toBe(
      S.UNMARKED,
    );
    expect(deriveDayStatus(ctx({ events: [ev(K.CHECK_IN), ev(K.CHECK_OUT)] }))).toBe(S.PRESENT);
  });

  it('lets a correction win over the marks and over a leave', () => {
    const correction = ev(K.CORRECTION, { correctedTo: S.PRESENT });
    expect(deriveDayStatus(ctx({ events: [ev(K.ABSENT), correction] }))).toBe(S.PRESENT);
    expect(deriveDayStatus(ctx({ leaveType: LeaveType.PAID, events: [correction] }))).toBe(
      S.PRESENT,
    );
    // The last correction is the one that counts.
    expect(
      deriveDayStatus(
        ctx({ events: [correction, ev(K.CORRECTION, { correctedTo: S.ABSENT_JUSTIFIED })] }),
      ),
    ).toBe(S.ABSENT_JUSTIFIED);
  });

  it('undoes a wrong tap with a correction to UNMARKED', () => {
    const undo = ev(K.CORRECTION, { correctedTo: S.UNMARKED });
    expect(deriveDayStatus(ctx({ events: [ev(K.ABSENT), undo] }))).toBe(S.UNMARKED);
    expect(deriveDayStatus(ctx({ events: [ev(K.ABSENT), undo, ev(K.PRESENT)] }))).toBe(S.PRESENT);
    expect(deriveDayStatus(ctx({ leaveType: LeaveType.PAID, events: [undo] }))).toBe(S.LEAVE_PAID);
  });

  it('puts a leave over an absence', () => {
    expect(deriveDayStatus(ctx({ leaveType: LeaveType.PAID, events: [ev(K.ABSENT)] }))).toBe(
      S.LEAVE_PAID,
    );
    expect(deriveDayStatus(ctx({ leaveType: LeaveType.UNPAID }))).toBe(S.LEAVE_UNPAID);
    expect(deriveDayStatus(ctx({ leaveType: LeaveType.SICK }))).toBe(S.SICK);
    expect(deriveDayStatus(ctx({ leaveType: LeaveType.OTHER }))).toBe(S.ABSENT_JUSTIFIED);
  });

  it('keeps rest days and holidays inside a leave as they are', () => {
    expect(deriveDayStatus(ctx({ day: FRIDAY, leaveType: LeaveType.PAID }))).toBe(S.REST);
    expect(deriveDayStatus(ctx({ leaveType: LeaveType.PAID, holidays: new Set([MONDAY]) }))).toBe(
      S.HOLIDAY,
    );
  });

  it('shows a holiday on a rest day as a holiday', () => {
    expect(deriveDayStatus(ctx({ day: FRIDAY, holidays: new Set([FRIDAY]) }))).toBe(S.HOLIDAY);
    expect(deriveDayStatus(ctx({ day: FRIDAY }))).toBe(S.REST);
  });

  it('keeps a day worked on a rest day or holiday, and ignores an absence there', () => {
    expect(deriveDayStatus(ctx({ day: FRIDAY, events: [ev(K.PRESENT)] }))).toBe(S.PRESENT);
    expect(deriveDayStatus(ctx({ holidays: new Set([MONDAY]), events: [ev(K.HALF_DAY)] }))).toBe(
      S.HALF_DAY,
    );
    expect(deriveDayStatus(ctx({ day: FRIDAY, events: [ev(K.ABSENT)] }))).toBe(S.REST);
  });

  it('is NOT_EMPLOYED before the hire date and after the exit date, whatever the marks', () => {
    const mid = { hireDate: '2026-11-15', day: '2026-11-14' };
    expect(deriveDayStatus(ctx(mid))).toBe(S.NOT_EMPLOYED);
    expect(deriveDayStatus(ctx({ ...mid, day: '2026-11-15', events: [ev(K.PRESENT)] }))).toBe(
      S.PRESENT,
    );
    const left = { exitDate: '2026-11-10' };
    expect(deriveDayStatus(ctx({ ...left, day: '2026-11-10', events: [ev(K.PRESENT)] }))).toBe(
      S.PRESENT,
    );
    expect(deriveDayStatus(ctx({ ...left, day: '2026-11-11', events: [ev(K.PRESENT)] }))).toBe(
      S.NOT_EMPLOYED,
    );
  });
});

describe('dayFigures', () => {
  it('keeps the last lateness and adds the overtime', () => {
    expect(
      dayFigures([
        ev(K.LATE, { lateMinutes: 10 }),
        ev(K.LATE, { lateMinutes: 25 }),
        ev(K.OVERTIME, { overtimeHours: '1.5' }),
        ev(K.OVERTIME, { overtimeHours: '0.75' }),
      ]),
    ).toEqual({ lateMinutes: 25, overtimeHours: '2.25' });
  });

  it('restarts from the correction', () => {
    expect(
      dayFigures([
        ev(K.LATE, { lateMinutes: 30 }),
        ev(K.OVERTIME, { overtimeHours: '4' }),
        ev(K.CORRECTION, { correctedTo: S.PRESENT, lateMinutes: 5, overtimeHours: '1' }),
      ]),
    ).toEqual({ lateMinutes: 5, overtimeHours: '1.00' });
  });
});

describe('dayIsMarked', () => {
  it('says when a new mark would replace something', () => {
    expect(dayIsMarked([])).toBe(false);
    expect(dayIsMarked([ev(K.OVERTIME, { overtimeHours: '1' })])).toBe(false);
    expect(dayIsMarked([ev(K.PRESENT)])).toBe(true);
    expect(dayIsMarked([ev(K.CORRECTION, { correctedTo: S.PRESENT })])).toBe(true);
    expect(dayIsMarked([ev(K.PRESENT), ev(K.CORRECTION, { correctedTo: S.UNMARKED })])).toBe(false);
  });
});

describe('working days and leave', () => {
  const calendar = { restDays: [5], holidays: new Set(['2026-11-01']) };

  it('leaves out rest days and holidays', () => {
    // Sun 1 Nov (holiday) to Sat 7 Nov, with Friday 6 off.
    expect(workingDaysBetween('2026-11-01', '2026-11-07', calendar)).toEqual([
      '2026-11-02',
      '2026-11-03',
      '2026-11-04',
      '2026-11-05',
      '2026-11-07',
    ]);
    expect(leaveDaysTaken('2026-11-01', '2026-11-07', calendar)).toBe(5);
  });

  it('handles Friday + Saturday and a range with no working day', () => {
    const weekend = { restDays: [5, 6], holidays: new Set<string>() };
    expect(leaveDaysTaken('2026-11-02', '2026-11-08', weekend)).toBe(5);
    expect(leaveDaysTaken('2026-11-06', '2026-11-07', weekend)).toBe(0);
  });

  it('only takes a paid leave out of the balance', () => {
    expect(leaveUsesBalance(LeaveType.PAID)).toBe(true);
    expect(leaveUsesBalance(LeaveType.UNPAID)).toBe(false);
    expect(leaveUsesBalance(LeaveType.SICK)).toBe(false);
    expect(leaveUsesBalance(LeaveType.OTHER)).toBe(false);
  });
});

describe('missingAccrualMonths', () => {
  const base = { hireDate: '2026-08-15', lastClosedMonth: '2026-10', posted: [] as string[] };

  it('owes every closed month since the hire, the hire month included', () => {
    expect(missingAccrualMonths(base)).toEqual(['2026-08', '2026-09', '2026-10']);
  });

  it('skips what is posted, even in the middle', () => {
    expect(missingAccrualMonths({ ...base, posted: ['2026-09'] })).toEqual(['2026-08', '2026-10']);
  });

  it('crosses a new year', () => {
    expect(
      missingAccrualMonths({ ...base, hireDate: '2025-12-01', lastClosedMonth: '2026-01' }),
    ).toEqual(['2025-12', '2026-01']);
  });

  it('stops at the exit month', () => {
    expect(missingAccrualMonths({ ...base, exitDate: '2026-09-10' })).toEqual([
      '2026-08',
      '2026-09',
    ]);
  });

  it('starts at the opening balance, which holds what came before', () => {
    expect(
      missingAccrualMonths({ ...base, hireDate: '2015-01-01', openingMonth: '2026-10' }),
    ).toEqual(['2026-10']);
    expect(missingAccrualMonths({ ...base, openingMonth: '2020-01' })).toHaveLength(3);
  });

  it('owes nothing before the first closed month', () => {
    expect(missingAccrualMonths({ ...base, hireDate: '2026-11-02' })).toEqual([]);
  });
});

describe('accrualForMonth', () => {
  it('gives the full rate for a full month', () => {
    expect(accrualForMonth('2026-11', '2020-01-01', null)).toBe('2.5');
    expect(accrualForMonth('2026-11', '2020-01-01', null, '3')).toBe('3.0');
  });

  it('prorates a hire or an exit during the month, half-up to one decimal', () => {
    // 16 days of 30: 2.5 × 16 / 30 = 1.33.
    expect(accrualForMonth('2026-11', '2026-11-15', null)).toBe('1.3');
    // 15 days of 30: 1.25 rounds up.
    expect(accrualForMonth('2026-11', '2020-01-01', '2026-11-15')).toBe('1.3');
    expect(accrualForMonth('2026-02', '2026-02-15', null)).toBe('1.3');
  });

  it('gives nothing outside employment', () => {
    expect(accrualForMonth('2026-11', '2026-12-01', null)).toBe('0.0');
    expect(accrualForMonth('2026-11', '2020-01-01', '2026-10-31')).toBe('0.0');
  });
});

describe('salaryOn', () => {
  const rows = [
    { effectiveFrom: '2026-01-01', amount: '40000' },
    { effectiveFrom: '2026-06-01', amount: '45000' },
  ];

  it('takes the last row on or before the day', () => {
    expect(salaryOn(rows, '2025-12-31')).toBeNull();
    expect(salaryOn(rows, '2026-01-01')?.amount).toBe('40000');
    expect(salaryOn(rows, '2026-05-31')?.amount).toBe('40000');
    expect(salaryOn(rows, '2026-06-01')?.amount).toBe('45000');
  });

  it('prefers the later row when two start the same day', () => {
    const fixed = [...rows, { effectiveFrom: '2026-06-01', amount: '46000' }];
    expect(salaryOn(fixed, '2026-07-01')?.amount).toBe('46000');
  });
});

describe('months', () => {
  it('gives bounds and the previous month', () => {
    expect(monthBounds('2028-02')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
    expect(previousMonth('2026-01')).toBe('2025-12');
  });

  it('counts a month, half days as 0.5', () => {
    expect(
      monthCounts([
        { status: S.PRESENT, lateMinutes: 15, overtimeHours: '2.00' },
        { status: S.PRESENT, lateMinutes: 5, overtimeHours: '0.50' },
        { status: S.HALF_DAY },
        { status: S.ABSENT_JUSTIFIED },
        { status: S.ABSENT_UNJUSTIFIED },
        { status: S.SICK },
        { status: S.LEAVE_PAID },
        { status: S.LEAVE_UNPAID },
        { status: S.UNMARKED },
        { status: S.REST },
      ]),
    ).toEqual({
      present: '2.5',
      halfDays: 1,
      absentJustified: 1,
      absentUnjustified: 1,
      sick: 1,
      leavePaid: 1,
      leaveUnpaid: 1,
      unmarked: 1,
      lateMinutes: 20,
      overtimeHours: '2.50',
    });
  });

  it('lists the lunar fêtes still to enter', () => {
    expect(missingLunarHolidays(['NEW_YEAR', 'AID_EL_FITR', null])).toEqual([
      'AID_EL_ADHA',
      'AWAL_MOHARRAM',
      'ACHOURA',
      'MAWLID',
    ]);
  });
});
