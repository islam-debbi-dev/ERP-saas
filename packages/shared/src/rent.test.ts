import { describe, expect, it } from 'vitest';
import { RentPeriod } from './enums';
import { round2, sum, toMoneyString } from './money';
import {
  alignedRentPeriods,
  RentAlert,
  rentCost,
  rentSchedule,
  rentSlots,
  rentSlotsFrom,
  RentSlotStatus,
  type RentTerms,
  spreadExpense,
} from './rent';

const yearly2025: RentTerms = {
  amount: '1200000',
  period: RentPeriod.YEARLY,
  startDate: '2025-01-01',
};

const months = (year: number) =>
  Array.from({ length: 12 }, (_, i) => {
    const mm = String(i + 1).padStart(2, '0');
    const last = new Date(Date.UTC(year, i + 1, 0)).getUTCDate();
    return { from: `${year}-${mm}-01`, to: `${year}-${mm}-${last}` };
  });

describe('rentCost (accrual by day)', () => {
  it('charges October of a yearly lease 1 200 000 × 31 / 365', () => {
    const october = rentCost(yearly2025, { from: '2025-10-01', to: '2025-10-31' });
    expect(october.toString()).toBe(
      round2('1200000').times(31).dividedBy(365).toString(), // not rounded until shown
    );
    expect(toMoneyString(october)).toBe('101917.81');
  });

  it('divides by 366 in a leap year', () => {
    const lease: RentTerms = { ...yearly2025, startDate: '2024-01-01' };
    expect(toMoneyString(rentCost(lease, { from: '2024-02-01', to: '2024-02-29' }))).toBe(
      toMoneyString(round2('1200000').times(29).dividedBy(366)),
    );
    expect(toMoneyString(rentCost(lease, { from: '2024-01-01', to: '2024-12-31' }))).toBe(
      '1200000.00',
    );
  });

  it('charges the whole year, exactly, over the year', () => {
    expect(toMoneyString(rentCost(yearly2025, { from: '2025-01-01', to: '2025-12-31' }))).toBe(
      '1200000.00',
    );
    // Months not rounded add up to the year exactly; rounded once at the end.
    const parts = months(2025).map((m) => rentCost(yearly2025, m));
    expect(toMoneyString(sum(parts))).toBe('1200000.00');
  });

  it('starts mid-month: a monthly lease from the 15th', () => {
    const lease: RentTerms = {
      amount: '60000',
      period: RentPeriod.MONTHLY,
      startDate: '2025-03-15',
    };
    // March 15–31 is 17 days of the 15 Mar – 14 Apr period (31 days).
    expect(toMoneyString(rentCost(lease, { from: '2025-03-01', to: '2025-03-31' }))).toBe(
      toMoneyString(round2('60000').times(17).dividedBy(31)),
    );
    // April: 14 days of the first period + 16 of the second (15 Apr – 14 May, 30 days).
    const april = round2('60000')
      .times(14)
      .dividedBy(31)
      .plus(round2('60000').times(16).dividedBy(30));
    expect(toMoneyString(rentCost(lease, { from: '2025-04-01', to: '2025-04-30' }))).toBe(
      toMoneyString(april),
    );
    // Nothing before it starts.
    expect(rentCost(lease, { from: '2025-02-01', to: '2025-02-28' }).isZero()).toBe(true);
  });

  it('adds two contracts in one month (old one closed, new one opened)', () => {
    const old: RentTerms = {
      amount: '50000',
      period: RentPeriod.MONTHLY,
      startDate: '2025-01-01',
      endDate: '2025-06-15',
    };
    const next: RentTerms = {
      amount: '70000',
      period: RentPeriod.MONTHLY,
      startDate: '2025-06-16',
    };
    const june = { from: '2025-06-01', to: '2025-06-30' };
    const expected = round2('50000')
      .times(15)
      .dividedBy(30)
      .plus(round2('70000').times(15).dividedBy(30));
    expect(toMoneyString(rentCost(old, june).plus(rentCost(next, june)))).toBe(
      toMoneyString(expected),
    );
    expect(toMoneyString(expected)).toBe('60000.00');
  });

  it('costs nothing after the contract ended', () => {
    const ended: RentTerms = { ...yearly2025, endDate: '2025-06-30' };
    expect(rentCost(ended, { from: '2025-07-01', to: '2025-12-31' }).isZero()).toBe(true);
    // The first half of the year is charged by day of the full year (181 / 365).
    expect(toMoneyString(rentCost(ended, { from: '2025-01-01', to: '2025-12-31' }))).toBe(
      toMoneyString(round2('1200000').times(181).dividedBy(365)),
    );
  });

  it('keeps the day of the month on short months (lease from the 31st)', () => {
    const lease: RentTerms = {
      amount: '30000',
      period: RentPeriod.MONTHLY,
      startDate: '2025-01-31',
    };
    const slots = rentSlots(lease, '2025-04-30').map((s) => [s.start, s.end]);
    expect(slots).toEqual([
      ['2025-01-31', '2025-02-27'],
      ['2025-02-28', '2025-03-30'],
      ['2025-03-31', '2025-04-29'],
      ['2025-04-30', '2025-05-30'],
    ]);
  });

  it('cuts quarterly periods on the contract end', () => {
    const lease: RentTerms = {
      amount: '90000',
      period: RentPeriod.QUARTERLY,
      startDate: '2025-01-01',
      endDate: '2025-05-15',
    };
    const slots = rentSlots(lease, '2030-01-01');
    expect(slots.map((s) => [s.start, s.end, s.days])).toEqual([
      ['2025-01-01', '2025-03-31', 90],
      ['2025-04-01', '2025-05-15', 91],
    ]);
    expect(slots[1]!.amount.toFixed(2)).toBe(
      toMoneyString(round2('90000').times(45).dividedBy(91)),
    );
  });
});

describe('spreadExpense', () => {
  it('puts an expense without period on its date', () => {
    const e = { amount: '12500.50', date: '2025-03-10' };
    expect(spreadExpense(e, { from: '2025-03-01', to: '2025-03-31' }).toFixed(2)).toBe('12500.50');
    expect(spreadExpense(e, { from: '2025-04-01', to: '2025-04-30' }).isZero()).toBe(true);
  });

  it('spreads a period by day, and the parts add up to the centime', () => {
    // An electricity bill for 2 months (Jan + Feb 2025 = 59 days) paid in March.
    const e = {
      amount: '10000',
      date: '2025-03-05',
      periodStart: '2025-01-01',
      periodEnd: '2025-02-28',
    };
    const jan = spreadExpense(e, { from: '2025-01-01', to: '2025-01-31' });
    const feb = spreadExpense(e, { from: '2025-02-01', to: '2025-02-28' });
    expect(toMoneyString(jan)).toBe(toMoneyString(round2('10000').times(31).dividedBy(59)));
    expect(toMoneyString(jan.plus(feb))).toBe('10000.00');
    // The month it was paid in carries nothing of it.
    expect(spreadExpense(e, { from: '2025-03-01', to: '2025-03-31' }).isZero()).toBe(true);
  });
});

describe('alignedRentPeriods', () => {
  const monthly: RentTerms = {
    amount: '40000',
    period: RentPeriod.MONTHLY,
    startDate: '2025-01-10',
  };

  it('counts whole periods', () => {
    expect(alignedRentPeriods(monthly, '2025-01-10', '2025-02-09')).toBe(1);
    expect(alignedRentPeriods(monthly, '2025-02-10', '2025-08-09')).toBe(6);
  });

  it('refuses a period off the boundaries', () => {
    expect(alignedRentPeriods(monthly, '2025-01-01', '2025-01-31')).toBeNull();
    expect(alignedRentPeriods(monthly, '2025-01-10', '2025-02-10')).toBeNull();
    expect(alignedRentPeriods(monthly, '2025-02-10', '2025-01-09')).toBeNull();
  });

  it('accepts the last period cut by the contract end, never beyond', () => {
    const ended = { ...monthly, endDate: '2025-03-20' };
    expect(alignedRentPeriods(ended, '2025-03-10', '2025-03-20')).toBe(1);
    expect(alignedRentPeriods(ended, '2025-03-10', '2025-04-09')).toBeNull();
  });
});

describe('rentSchedule', () => {
  const monthly: RentTerms = {
    amount: '40000',
    period: RentPeriod.MONTHLY,
    startDate: '2025-01-01',
  };

  it('shows paid until, the next due date and what is due', () => {
    const s = rentSchedule(
      monthly,
      [{ periodStart: '2025-01-01', periodEnd: '2025-02-28' }],
      '2025-04-05',
    );
    expect(s.slots.map((x) => x.status)).toEqual([
      RentSlotStatus.PAID,
      RentSlotStatus.PAID,
      RentSlotStatus.DUE,
      RentSlotStatus.DUE,
    ]);
    expect(s.paidUntil).toBe('2025-02-28');
    expect(s.nextDueDate).toBe('2025-03-01');
    expect(s.amountDue.toFixed(2)).toBe('80000.00');
    expect(s.alerts).toEqual([RentAlert.UNPAID_DUE]);
  });

  it('paid in advance: next period upcoming, nothing due', () => {
    const s = rentSchedule(
      monthly,
      [{ periodStart: '2025-01-01', periodEnd: '2025-12-31' }],
      '2025-04-05',
    );
    expect(s.paidUntil).toBe('2025-12-31');
    expect(s.nextDueDate).toBe('2026-01-01');
    expect(s.slots.at(-1)!.status).toBe(RentSlotStatus.UPCOMING);
    expect(s.amountDue.isZero()).toBe(true);
    expect(s.alerts).toEqual([]);
  });

  it('nothing paid yet', () => {
    const s = rentSchedule(monthly, [], '2025-01-01');
    expect(s.paidUntil).toBeNull();
    expect(s.nextDueDate).toBe('2025-01-01');
    expect(s.amountDue.toFixed(2)).toBe('40000.00');
  });

  it('alerts 30 days before the end, and stops after a fully paid end', () => {
    const ending = { ...monthly, endDate: '2025-05-31' };
    expect(
      rentSchedule(ending, [{ periodStart: '2025-01-01', periodEnd: '2025-05-31' }], '2025-05-02')
        .alerts,
    ).toEqual([RentAlert.ENDING_SOON]);
    const done = rentSchedule(
      ending,
      [{ periodStart: '2025-01-01', periodEnd: '2025-05-31' }],
      '2025-07-01',
    );
    expect(done.nextDueDate).toBeNull();
    expect(done.alerts).toEqual([]);
  });

  it('prefills the next periods to pay', () => {
    const next = rentSlotsFrom(monthly, '2025-03-01', 6);
    expect(next.map((s) => s.start)[0]).toBe('2025-03-01');
    expect(next.at(-1)!.end).toBe('2025-08-31');
    expect(toMoneyString(sum(next.map((s) => s.amount)))).toBe('240000.00');
  });
});
