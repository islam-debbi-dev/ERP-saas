import { describe, expect, it } from 'vitest';
import {
  DayStatus as S,
  EmployeeLedgerType as L,
  PayItemMode,
  PayLineCode,
  PayType,
} from './enums';
import { money, sum } from './money';
import {
  computeIrg,
  computePayslip,
  employeeBalanceDelta,
  type PayDaySummary,
  type PayItemInput,
  payItemsOn,
  type PayrollRates,
  type PayrollSettings,
  type PayslipInput,
  summarizeDays,
} from './payroll';

const rates: PayrollRates = {
  cnasEmployeeRate: '0.09',
  cnasEmployerRate: '0.26',
  irgBrackets: [
    { upTo: '240000', rate: '0' },
    { upTo: '480000', rate: '0.23' },
    { upTo: '960000', rate: '0.27' },
    { upTo: '1920000', rate: '0.30' },
    { upTo: '3840000', rate: '0.33' },
    { upTo: null, rate: '0.35' },
  ],
  abattementRate: '0.40',
  abattementMin: '1000',
  abattementMax: '1500',
  exemptionThreshold: '30000',
  lissageCeiling: '35000',
  lissageNum: '137',
  lissageDen: '51',
  lissageOffsetNum: '27925',
  lissageOffsetDen: '8',
  snmg: '20000',
};

const settings: PayrollSettings = {
  dayDivisor: 30,
  hourDivisor: '173.33',
  overtimeRate: '0.50',
  deductLateness: false,
  dailyHours: 8,
};

const noDays: PayDaySummary = summarizeDays([]);

function slip(over: Partial<PayslipInput> = {}): PayslipInput {
  return {
    payType: PayType.MONTHLY,
    salary: '60000',
    declared: true,
    days: noDays,
    items: [],
    retenues: [],
    advanceOutstanding: '0',
    settings,
    rates,
    ...over,
  };
}

const amountOf = (r: ReturnType<typeof computePayslip>, code: PayLineCode) =>
  r.lines.find((l) => l.code === code)?.amount;

describe('computeIrg', () => {
  it.each([
    ['0', '0.00'],
    ['30000', '0.00'],
    ['32500', '1143.00'],
    ['35000', '2070.00'],
    ['50000', '5800.00'],
    ['120000', '25900.00'],
    ['400000', '118700.00'],
  ])('taxable %s gives %s', (taxable, irg) => {
    expect(computeIrg(taxable, rates).irg).toBe(irg);
  });

  it('exempts up to the threshold, and only there', () => {
    expect(computeIrg('30000', rates).detail.exempt).toBe(true);
    expect(computeIrg('30000.01', rates).detail).toMatchObject({ exempt: false, lissage: true });
  });

  it('smooths strictly below the ceiling', () => {
    expect(computeIrg('34999.99', rates).detail.lissage).toBe(true);
    expect(computeIrg('35000', rates).detail.lissage).toBe(false);
  });

  it('joins up at both ends of the smoothing band', () => {
    expect(money(computeIrg('30000.01', rates).irg).lte(2)).toBe(true);
    const below = money(computeIrg('34999.99', rates).irg);
    expect(money(computeIrg('35000', rates).irg).minus(below).lte(1)).toBe(true);
  });

  it('applies the minimum abattement', () => {
    // 40 % of 2 300 is 920: the minimum of 1 000 applies.
    expect(computeIrg('30000', rates).detail.abattement).toBe('1000.00');
  });

  it('applies the maximum abattement', () => {
    expect(computeIrg('50000', rates).detail.abattement).toBe('1500.00');
  });

  it('reaches the top bracket', () => {
    expect(computeIrg('400000', rates).detail.scaleTax).toBe('120200.00');
  });
});

describe('summarizeDays', () => {
  it('counts halves and days off worked', () => {
    const days = summarizeDays([
      { status: S.PRESENT, workingDay: true, overtimeHours: '1.50', lateMinutes: 10 },
      { status: S.HALF_DAY, workingDay: true },
      { status: S.PRESENT, workingDay: false },
      { status: S.HALF_DAY, workingDay: false },
      { status: S.REST, workingDay: false },
      { status: S.HOLIDAY, workingDay: false },
      { status: S.NOT_EMPLOYED, workingDay: true },
      { status: S.NOT_EMPLOYED, workingDay: false },
      { status: S.UNMARKED, workingDay: true },
    ]);
    expect(days).toMatchObject({
      present: '3.0',
      halfDays: 1,
      offDaysWorked: '1.5',
      holidays: 1,
      notEmployed: 2,
      notEmployedWorking: 1,
      monthDays: 9,
      monthWorkingDays: 4,
      unmarked: 1,
      lateMinutes: 10,
      overtimeHours: '1.50',
    });
  });
});

describe('monthly worker', () => {
  it('deducts an absence with divisor 30', () => {
    const r = computePayslip(slip({ days: { ...noDays, absentUnjustified: 2 } }));
    expect(amountOf(r, PayLineCode.ABSENCE_UNJUSTIFIED)).toBe('-4000.00');
    expect(r.gross).toBe('56000.00');
  });

  it('deducts an absence with divisor 26', () => {
    const r = computePayslip(
      slip({
        settings: { ...settings, dayDivisor: 26 },
        days: { ...noDays, absentUnjustified: 2 },
      }),
    );
    expect(amountOf(r, PayLineCode.ABSENCE_UNJUSTIFIED)).toBe('-4615.38');
  });

  it('counts a half day as 0.5', () => {
    const r = computePayslip(slip({ days: { ...noDays, halfDays: 1 } }));
    expect(amountOf(r, PayLineCode.HALF_DAY)).toBe('-1000.00');
  });

  it('shows sick days apart from the other deductions', () => {
    const r = computePayslip(
      slip({ days: { ...noDays, sick: 3, leaveUnpaid: 1, absentJustified: 1 } }),
    );
    expect(amountOf(r, PayLineCode.SICK)).toBe('-6000.00');
    expect(amountOf(r, PayLineCode.LEAVE_UNPAID)).toBe('-2000.00');
    expect(amountOf(r, PayLineCode.ABSENCE_JUSTIFIED)).toBe('-2000.00');
  });

  it('takes out the days outside the contract, against the length of the month', () => {
    const days = {
      ...noDays,
      notEmployed: 15,
      notEmployedWorking: 11,
      monthDays: 30,
      monthWorkingDays: 22,
    };
    expect(amountOf(computePayslip(slip({ days })), PayLineCode.NOT_EMPLOYED)).toBe('-30000.00');
    const r = computePayslip(slip({ days, settings: { ...settings, dayDivisor: 22 } }));
    expect(amountOf(r, PayLineCode.NOT_EMPLOYED)).toBe('-30000.00');
  });

  it.each([30, 26, 22])('pays the day worked by someone hired on the last day (÷%i)', (d) => {
    const days = {
      ...noDays,
      notEmployed: 30,
      notEmployedWorking: 26,
      monthDays: 31,
      monthWorkingDays: 27,
    };
    const r = computePayslip(slip({ days, settings: { ...settings, dayDivisor: d } }));
    expect(money(r.gross).gt(0)).toBe(true);
  });

  it('keeps the month whole for someone employed all month', () => {
    const r = computePayslip(slip({ days: { ...noDays, monthDays: 31, monthWorkingDays: 27 } }));
    expect(amountOf(r, PayLineCode.NOT_EMPLOYED)).toBeUndefined();
    expect(r.gross).toBe('60000.00');
  });

  it('never deducts more than the base', () => {
    const r = computePayslip(
      slip({
        settings: { ...settings, dayDivisor: 22 },
        days: { ...noDays, absentUnjustified: 20, sick: 5 },
      }),
    );
    expect(r.gross).toBe('0.00');
    expect(amountOf(r, PayLineCode.SICK)).toBe('-5454.55');
  });

  it('pays a rest day worked on top of the base', () => {
    const r = computePayslip(slip({ days: { ...noDays, offDaysWorked: '1.5' } }));
    expect(amountOf(r, PayLineCode.REST_WORKED)).toBe('3000.00');
  });

  it('leaves lateness alone unless the tenant deducts it', () => {
    const days = { ...noDays, lateMinutes: 90 };
    expect(amountOf(computePayslip(slip({ days })), PayLineCode.LATENESS)).toBeUndefined();
    const r = computePayslip(slip({ days, settings: { ...settings, deductLateness: true } }));
    // 60 000 / 173.33 × 1.5
    expect(amountOf(r, PayLineCode.LATENESS)).toBe('-519.24');
  });

  it('pays overtime with the premium', () => {
    const r = computePayslip(slip({ days: { ...noDays, overtimeHours: '10.00' } }));
    // 60 000 / 173.33 × 1.5 × 10
    expect(amountOf(r, PayLineCode.OVERTIME)).toBe('5192.41');
    expect(r.cotisable).toBe('65192.41');
  });
});

describe('daily worker', () => {
  const daily = (days: Partial<PayDaySummary>, over: Partial<PayslipInput> = {}) =>
    computePayslip(
      slip({ payType: PayType.DAILY, salary: '2000', days: { ...noDays, ...days }, ...over }),
    );

  it('earns days present, paid leave and paid holidays', () => {
    const r = daily({ present: '20.5', leavePaid: 2, holidays: 1 });
    expect(amountOf(r, PayLineCode.DAYS_WORKED)).toBe('41000.00');
    expect(amountOf(r, PayLineCode.LEAVE_PAID)).toBe('4000.00');
    expect(amountOf(r, PayLineCode.HOLIDAY_PAID)).toBe('2000.00');
    expect(r.gross).toBe('47000.00');
  });

  it('earns nothing on a sick day', () => {
    expect(daily({ present: '10.0', sick: 5 }).gross).toBe('20000.00');
  });

  it('takes overtime from the daily rate and the company hours', () => {
    const r = daily({ present: '1.0', overtimeHours: '2.00' });
    // 2 000 / 8 × 1.5 × 2
    expect(amountOf(r, PayLineCode.OVERTIME)).toBe('750.00');
  });

  it('never loses more to lateness than the days earned', () => {
    const r = daily(
      { present: '0.5', lateMinutes: 6000 },
      { settings: { ...settings, deductLateness: true } },
    );
    expect(r.gross).toBe('0.00');
  });
});

describe('primes', () => {
  const panier: PayItemInput = {
    code: PayLineCode.ITEM,
    label: 'Panier',
    amount: '200',
    mode: PayItemMode.PER_DAY,
    cotisable: false,
    imposable: true,
  };
  const rendement: PayItemInput = {
    code: PayLineCode.ITEM,
    label: 'Prime de rendement',
    amount: '10000',
    mode: PayItemMode.FIXED,
    cotisable: true,
    imposable: true,
  };

  it('multiplies a per-day item by the days present', () => {
    const r = computePayslip(slip({ items: [panier], days: { ...noDays, present: '20.5' } }));
    expect(amountOf(r, PayLineCode.ITEM)).toBe('4100.00');
  });

  it('keeps a non-cotisable imposable item out of the CNAS but in the IRG', () => {
    const r = computePayslip(slip({ items: [panier], days: { ...noDays, present: '20.0' } }));
    expect(r.cotisable).toBe('60000.00');
    expect(r.cnasEmployee).toBe('5400.00');
    // 60 000 − 5 400 + 4 000
    expect(r.taxable).toBe('58600.00');
    expect(r.gross).toBe('64000.00');
  });

  it('adds a cotisable prime to the base of the CNAS', () => {
    const r = computePayslip(slip({ items: [rendement] }));
    expect(r.cotisable).toBe('70000.00');
    expect(r.cnasEmployee).toBe('6300.00');
    expect(r.cnasEmployer).toBe('18200.00');
    expect(r.employerCost).toBe('88200.00');
  });

  it('adds a non-imposable item after the IRG', () => {
    const plain = computePayslip(slip());
    const r = computePayslip(
      slip({ items: [{ ...rendement, amount: '3000', cotisable: false, imposable: false }] }),
    );
    expect(r.taxable).toBe(plain.taxable);
    expect(r.irg).toBe(plain.irg);
    expect(money(r.net).minus(plain.net).toFixed(2)).toBe('3000.00');
  });

  it('counts a cotisable non-imposable item once', () => {
    const plain = computePayslip(slip());
    const r = computePayslip(slip({ items: [{ ...rendement, amount: '1000', imposable: false }] }));
    expect(r.cnasEmployee).toBe('5490.00');
    expect(r.taxable).toBe(money(plain.taxable).minus('90').toFixed(2));
    expect(money(r.gross).minus(r.cnasEmployee).minus(r.irg).toFixed(2)).toBe(r.net);
  });

  it('takes a negative régularisation off the same bases', () => {
    const r = computePayslip(
      slip({
        items: [
          {
            code: PayLineCode.REGULARISATION,
            label: 'Régularisation',
            amount: '-5000',
            cotisable: true,
            imposable: true,
          },
        ],
      }),
    );
    expect(r.cotisable).toBe('55000.00');
  });

  it('pays no contribution on a month below zero', () => {
    const r = computePayslip(
      slip({
        salary: '1000',
        items: [
          {
            code: PayLineCode.REGULARISATION,
            label: 'Régularisation',
            amount: '-5000',
            cotisable: true,
            imposable: true,
          },
        ],
      }),
    );
    expect(r.cnasEmployee).toBe('0.00');
    expect(r.netToPay).toBe('-4000.00');
  });

  it('keeps the incentive run on its line', () => {
    const r = computePayslip(
      slip({
        items: [
          {
            code: PayLineCode.INCENTIVE,
            label: 'Primes commerciales',
            amount: '7000',
            cotisable: true,
            imposable: true,
            incentiveRunId: 'run-1',
          },
        ],
      }),
    );
    expect(r.lines.find((l) => l.code === PayLineCode.INCENTIVE)?.incentiveRunId).toBe('run-1');
  });
});

describe('undeclared worker', () => {
  it('has no CNAS and no IRG: the net is the gross', () => {
    const r = computePayslip(slip({ declared: false }));
    expect(r).toMatchObject({
      cnasEmployee: '0.00',
      cnasEmployer: '0.00',
      irg: '0.00',
      gross: '60000.00',
      net: '60000.00',
      employerCost: '60000.00',
    });
    expect(amountOf(r, PayLineCode.CNAS_EMPLOYEE)).toBeUndefined();
    expect(amountOf(r, PayLineCode.IRG)).toBeUndefined();
  });

  it('still repays his avance', () => {
    const r = computePayslip(slip({ declared: false, advanceOutstanding: '5000' }));
    expect(r.netToPay).toBe('55000.00');
  });
});

describe('net à payer', () => {
  it('takes the whole avance when the net covers it', () => {
    const plain = computePayslip(slip());
    const r = computePayslip(slip({ advanceOutstanding: '10000' }));
    expect(r.advanceDeducted).toBe('10000.00');
    expect(r.advanceCarried).toBe('0.00');
    expect(r.netToPay).toBe(money(plain.net).minus('10000').toFixed(2));
  });

  it('carries over an avance bigger than the net', () => {
    const r = computePayslip(slip({ salary: '20000', advanceOutstanding: '50000' }));
    expect(r.net).toBe('18200.00');
    expect(r.advanceDeducted).toBe('18200.00');
    expect(r.advanceCarried).toBe('31800.00');
    expect(r.netToPay).toBe('0.00');
  });

  it('ignores a balance below zero', () => {
    const r = computePayslip(slip({ advanceOutstanding: '-300' }));
    expect(r.advanceDeducted).toBe('0.00');
    expect(r.advanceCarried).toBe('0.00');
  });

  it('takes the retenues before the avance', () => {
    const r = computePayslip(
      slip({
        salary: '20000',
        retenues: [{ label: 'Casse', amount: '3000' }],
        advanceOutstanding: '50000',
      }),
    );
    expect(r.advanceDeducted).toBe('15200.00');
    expect(r.netToPay).toBe('0.00');
  });

  it('goes below zero when the retenues exceed the net', () => {
    const r = computePayslip(
      slip({ salary: '20000', retenues: [{ label: 'Casse', amount: '19000' }] }),
    );
    expect(r.netToPay).toBe('-800.00');
  });
});

describe('totals', () => {
  it('equal the sum of the lines, to the centime', () => {
    const r = computePayslip(
      slip({
        salary: '47123.45',
        settings: { ...settings, dayDivisor: 26, deductLateness: true },
        days: {
          ...noDays,
          present: '21.5',
          absentUnjustified: 1,
          halfDays: 1,
          sick: 1,
          lateMinutes: 37,
          overtimeHours: '3.75',
          offDaysWorked: '0.5',
        },
        items: [
          {
            code: PayLineCode.ITEM,
            label: 'Transport',
            amount: '133.33',
            mode: PayItemMode.PER_DAY,
            cotisable: false,
            imposable: true,
          },
          {
            code: PayLineCode.ITEM,
            label: 'Prime',
            amount: '1234.56',
            mode: PayItemMode.FIXED,
            cotisable: true,
            imposable: true,
          },
        ],
        retenues: [{ label: 'Casse', amount: '100.10' }],
        advanceOutstanding: '1500.55',
      }),
    );
    expect(sum(r.lines.map((l) => l.amount)).toFixed(2)).toBe(r.netToPay);
    const earned = r.lines.filter(
      (l) =>
        l.code !== PayLineCode.CNAS_EMPLOYEE &&
        l.code !== PayLineCode.IRG &&
        l.code !== PayLineCode.RETENUE &&
        l.code !== PayLineCode.ADVANCE,
    );
    expect(sum(earned.map((l) => l.amount)).toFixed(2)).toBe(r.gross);
    for (const l of r.lines) expect(l.amount).toMatch(/^-?\d+\.\d{2}$/);
  });
});

describe('payItemsOn', () => {
  const rows = [
    { typeId: 'a', effectiveFrom: '2026-01-01', amount: '100' },
    { typeId: 'a', effectiveFrom: '2026-06-01', amount: '200' },
    { typeId: 'b', effectiveFrom: '2026-01-01', amount: '50' },
    { typeId: 'b', effectiveFrom: '2026-03-01', amount: '0' },
    { typeId: 'c', effectiveFrom: '2026-12-01', amount: '75' },
  ];

  it('takes the last row of each type, and a zero ends it', () => {
    expect(payItemsOn(rows, '2026-06-30').map((r) => [r.typeId, r.amount])).toEqual([['a', '200']]);
    expect(payItemsOn(rows, '2026-02-28').map((r) => [r.typeId, r.amount])).toEqual([
      ['a', '100'],
      ['b', '50'],
    ]);
  });
});

describe('employeeBalanceDelta', () => {
  const delta = (type: L, amount: string) => {
    const d = employeeBalanceDelta(type, amount);
    return [d.advance.toFixed(2), d.salaryDue.toFixed(2)];
  };

  it('keeps salary out of the avances', () => {
    expect(delta(L.ADVANCE, '100')).toEqual(['100.00', '0.00']);
    expect(delta(L.REVERSAL, '-100')).toEqual(['-100.00', '0.00']);
    expect(delta(L.OPENING, '100')).toEqual(['100.00', '0.00']);
    expect(delta(L.SALARY_DUE, '-500')).toEqual(['0.00', '500.00']);
    expect(delta(L.SALARY_PAID, '500')).toEqual(['0.00', '-500.00']);
    expect(delta(L.SALARY_REVERSAL, '500')).toEqual(['0.00', '-500.00']);
  });

  it('moves both on an avance taken back from a payslip', () => {
    expect(delta(L.ADVANCE_DEDUCTION, '-100')).toEqual(['-100.00', '-100.00']);
    expect(delta(L.ADVANCE_DEDUCTION, '100')).toEqual(['100.00', '100.00']);
  });
});
