/**
 * Paie (phase 31b): pure rules, used by the API and by the screens that explain a payslip.
 * One function per step, so a bulletin can show where each line comes from.
 *
 * Rounding: each line is rounded half-up to 2 decimals and every total is the sum of the
 * rounded lines (like the cells of the charges report), so a bulletin adds up to the
 * centime. The IRG is rounded down to the dinar.
 *
 * The rates and the IRG barème are dated rows (`PayrollRateSet`), never constants here.
 * An Algerian comptable must check them, and this rounding, before the first real payslip.
 */
import { DayStatus, EmployeeLedgerType, PayItemMode, PayLineCode, PayType } from './enums';
import { type Money, type MoneyInput, money, round2, sum, toMoneyString, ZERO } from './money';

export const PAYROLL_DAY_DIVISORS = [30, 26, 22] as const;
export const DEFAULT_PAYROLL_DAY_DIVISOR = 30;
/** 40 h × 52 / 12. */
export const DEFAULT_PAYROLL_HOUR_DIVISOR = '173.33';
/** +50 %. */
export const DEFAULT_PAYROLL_OVERTIME_RATE = '0.50';

export interface IrgBracket {
  /** Top of the annual bracket; null for the last one. */
  upTo: string | null;
  rate: string;
}

export interface PayrollRates {
  cnasEmployeeRate: string;
  cnasEmployerRate: string;
  /** Annual, lowest first. Applied monthly on 1/12 of each bracket. */
  irgBrackets: readonly IrgBracket[];
  abattementRate: string;
  abattementMin: string;
  abattementMax: string;
  /** Monthly taxable at or below this pays no IRG. */
  exemptionThreshold: string;
  /** Between the exemption and this, the IRG is smoothed (`lissage`). */
  lissageCeiling: string;
  /** IRG × num / den − offsetNum / offsetDen. */
  lissageNum: string;
  lissageDen: string;
  lissageOffsetNum: string;
  lissageOffsetDen: string;
  snmg: string;
}

export interface PayrollSettings {
  dayDivisor: number;
  hourDivisor: string;
  overtimeRate: string;
  deductLateness: boolean;
  /** The company's daily hours: the hourly rate of a daily worker. */
  dailyHours: number;
}

export interface PayDay {
  status: DayStatus;
  /** False on a rest day or a holiday, as the calendar sees it for this employee. */
  workingDay: boolean;
  lateMinutes?: number;
  overtimeHours?: string;
}

export interface PayDaySummary {
  /** Days worked, a half day counting 0.5, rest days and holidays worked included. */
  present: string;
  halfDays: number;
  absentUnjustified: number;
  absentJustified: number;
  sick: number;
  leavePaid: number;
  leaveUnpaid: number;
  /** Holidays not worked, inside the employment. */
  holidays: number;
  /** Rest days and holidays worked; a half day counts 0.5. */
  offDaysWorked: string;
  /** Calendar days outside the employment. */
  notEmployed: number;
  /** The same, on working days only. */
  notEmployedWorking: number;
  unmarked: number;
  lateMinutes: number;
  overtimeHours: string;
}

/** Step 1: what the month's derived days say. */
export function summarizeDays(days: readonly PayDay[]): PayDaySummary {
  const count = (test: (d: PayDay) => boolean) => days.filter(test).length;
  const is = (s: DayStatus) => (d: PayDay) => d.status === s;
  const halfDays = count(is(DayStatus.HALF_DAY));
  const fullDays = count(is(DayStatus.PRESENT));
  const offFull = count((d) => d.status === DayStatus.PRESENT && !d.workingDay);
  const offHalf = count((d) => d.status === DayStatus.HALF_DAY && !d.workingDay);
  return {
    present: money(fullDays).add(money(halfDays).div(2)).toFixed(1),
    // Only a half day on a working day loses half a day of pay.
    halfDays: halfDays - offHalf,
    absentUnjustified: count(is(DayStatus.ABSENT_UNJUSTIFIED)),
    absentJustified: count(is(DayStatus.ABSENT_JUSTIFIED)),
    sick: count(is(DayStatus.SICK)),
    leavePaid: count(is(DayStatus.LEAVE_PAID)),
    leaveUnpaid: count(is(DayStatus.LEAVE_UNPAID)),
    holidays: count(is(DayStatus.HOLIDAY)),
    offDaysWorked: money(offFull).add(money(offHalf).div(2)).toFixed(1),
    notEmployed: count(is(DayStatus.NOT_EMPLOYED)),
    notEmployedWorking: count((d) => d.status === DayStatus.NOT_EMPLOYED && d.workingDay),
    unmarked: count(is(DayStatus.UNMARKED)),
    lateMinutes: days.reduce((n, d) => n + (d.lateMinutes ?? 0), 0),
    overtimeHours: sum(days.map((d) => d.overtimeHours ?? '0')).toFixed(2),
  };
}

export interface PayLine {
  code: PayLineCode;
  /** French: printed as is on the bulletin. */
  label: string;
  /** Days or hours. */
  quantity?: string;
  /** What one unit is worth, or the amount a rate applies to. */
  base?: string;
  rate?: string;
  /** Signed: a deduction is negative. Rounded. */
  amount: string;
  cotisable: boolean;
  imposable: boolean;
  /** The approved incentive run this line comes from. */
  incentiveRunId?: string;
}

export interface PayItemInput {
  code: typeof PayLineCode.ITEM | typeof PayLineCode.INCENTIVE | typeof PayLineCode.REGULARISATION;
  label: string;
  /** Signed for a régularisation. */
  amount: string;
  mode?: PayItemMode;
  cotisable: boolean;
  imposable: boolean;
  incentiveRunId?: string;
}

export interface RetenueInput {
  label: string;
  amount: string;
}

export interface PayslipInput {
  payType: PayType;
  /** The monthly salary, or the daily rate of a daily worker. */
  salary: string;
  declared: boolean;
  days: PayDaySummary;
  items: readonly PayItemInput[];
  retenues: readonly RetenueInput[];
  /** The employee's avances outstanding (may be below zero: then nothing is taken). */
  advanceOutstanding: string;
  settings: PayrollSettings;
  rates: PayrollRates;
}

export interface IrgDetail {
  /** Tax of the barème before the abattement, not rounded. */
  scaleTax: string;
  abattement: string;
  /** Whether the taxable is in the smoothing band. */
  lissage: boolean;
  exempt: boolean;
}

export interface PayslipResult {
  lines: PayLine[];
  /** Everything earned, before CNAS and IRG. */
  gross: string;
  cotisable: string;
  cnasEmployee: string;
  cnasEmployer: string;
  taxable: string;
  irg: string;
  irgDetail: IrgDetail;
  net: string;
  retenues: string;
  advanceDeducted: string;
  /** Avance left for next month. */
  advanceCarried: string;
  netToPay: string;
  /** What the company pays: gross + employer CNAS. */
  employerCost: string;
}

function line(
  code: PayLineCode,
  label: string,
  amount: MoneyInput,
  extra: Partial<Omit<PayLine, 'code' | 'label' | 'amount'>> = {},
): PayLine {
  return { cotisable: true, imposable: true, ...extra, code, label, amount: toMoneyString(amount) };
}

/** The value of one absent day of a monthly worker, not rounded. */
export function dayValue(salary: MoneyInput, dayDivisor: number): Money {
  return money(salary).div(dayDivisor);
}

/** The hourly rate overtime and lateness use, not rounded. */
export function hourlyRate(
  payType: PayType,
  salary: MoneyInput,
  settings: Pick<PayrollSettings, 'hourDivisor' | 'dailyHours'>,
): Money {
  return payType === PayType.DAILY
    ? money(salary).div(settings.dailyHours)
    : money(salary).div(money(settings.hourDivisor));
}

/** Days outside the employment, in the unit of the divisor: calendar days for 30. */
function notEmployedDays(days: PayDaySummary, dayDivisor: number): number {
  return dayDivisor === DEFAULT_PAYROLL_DAY_DIVISOR ? days.notEmployed : days.notEmployedWorking;
}

/** Step 2, monthly worker: the base, then each deduction, never more than the base. */
export function monthlyBaseLines(input: PayslipInput): PayLine[] {
  const { salary, days, settings } = input;
  const unit = dayValue(salary, settings.dayDivisor);
  const lines = [line(PayLineCode.BASE_SALARY, 'Salaire de base', salary)];
  let left = round2(salary);
  const deduct = (
    code: PayLineCode,
    label: string,
    wanted: Money,
    extra: Pick<PayLine, 'quantity' | 'base'>,
  ) => {
    if (wanted.isZero()) return;
    const rounded = round2(wanted);
    const amount = rounded.gt(left) ? left : rounded;
    left = left.minus(amount);
    lines.push(line(code, label, amount.neg(), extra));
  };
  const perDay = (code: PayLineCode, label: string, count: MoneyInput) =>
    deduct(code, label, unit.times(money(count)), {
      quantity: money(count).toFixed(1),
      base: toMoneyString(unit),
    });

  perDay(
    PayLineCode.NOT_EMPLOYED,
    'Jours hors contrat',
    notEmployedDays(days, settings.dayDivisor),
  );
  perDay(PayLineCode.ABSENCE_UNJUSTIFIED, 'Absences non justifiées', days.absentUnjustified);
  perDay(PayLineCode.ABSENCE_JUSTIFIED, 'Absences justifiées non payées', days.absentJustified);
  perDay(PayLineCode.HALF_DAY, 'Demi-journées', money(days.halfDays).div(2));
  perDay(PayLineCode.LEAVE_UNPAID, 'Congé sans solde', days.leaveUnpaid);
  perDay(PayLineCode.SICK, 'Maladie (à la charge de la CNAS)', days.sick);
  if (settings.deductLateness && days.lateMinutes > 0) {
    const hourly = hourlyRate(PayType.MONTHLY, salary, settings);
    const hours = money(days.lateMinutes).div(60);
    deduct(PayLineCode.LATENESS, 'Retards', hourly.times(hours), {
      quantity: hours.toFixed(2),
      base: toMoneyString(hourly),
    });
  }
  // Worked on a day off: the month's base does not cover it.
  if (!money(days.offDaysWorked).isZero()) {
    lines.push(
      line(PayLineCode.REST_WORKED, 'Repos ou fête travaillés', unit.times(days.offDaysWorked), {
        quantity: days.offDaysWorked,
        base: toMoneyString(unit),
      }),
    );
  }
  return lines;
}

/** Step 2, daily worker: days present + paid leave + paid holidays. */
export function dailyBaseLines(input: PayslipInput): PayLine[] {
  const { salary, days, settings } = input;
  const rate = toMoneyString(salary);
  const paid = (code: PayLineCode, label: string, count: MoneyInput) =>
    line(code, label, money(salary).times(money(count)), {
      quantity: money(count).toFixed(1),
      base: rate,
    });
  const lines = [paid(PayLineCode.DAYS_WORKED, 'Jours travaillés', days.present)];
  if (days.leavePaid > 0) lines.push(paid(PayLineCode.LEAVE_PAID, 'Congé payé', days.leavePaid));
  if (days.holidays > 0) lines.push(paid(PayLineCode.HOLIDAY_PAID, 'Jours fériés', days.holidays));
  if (settings.deductLateness && days.lateMinutes > 0) {
    const earned = sum(lines.map((l) => l.amount));
    const hourly = hourlyRate(PayType.DAILY, salary, settings);
    const hours = money(days.lateMinutes).div(60);
    const wanted = round2(hourly.times(hours));
    lines.push(
      line(PayLineCode.LATENESS, 'Retards', (wanted.gt(earned) ? earned : wanted).neg(), {
        quantity: hours.toFixed(2),
        base: toMoneyString(hourly),
      }),
    );
  }
  return lines;
}

/** Step 3: overtime at the hourly rate plus the tenant's premium. */
export function overtimeLine(input: PayslipInput): PayLine | null {
  const hours = money(input.days.overtimeHours);
  if (hours.isZero()) return null;
  const hourly = hourlyRate(input.payType, input.salary, input.settings);
  const rate = money(1).add(money(input.settings.overtimeRate));
  return line(PayLineCode.OVERTIME, 'Heures supplémentaires', hourly.times(rate).times(hours), {
    quantity: hours.toFixed(2),
    base: toMoneyString(hourly),
    rate: rate.toFixed(2),
  });
}

/** Step 3: a prime. An amount per day is multiplied by the days present. */
export function itemLine(item: PayItemInput, days: PayDaySummary): PayLine {
  const perDay = item.mode === PayItemMode.PER_DAY;
  const amount = perDay ? money(item.amount).times(money(days.present)) : money(item.amount);
  return line(item.code, item.label, amount, {
    cotisable: item.cotisable,
    imposable: item.imposable,
    ...(perDay ? { quantity: days.present, base: toMoneyString(item.amount) } : {}),
    ...(item.incentiveRunId ? { incentiveRunId: item.incentiveRunId } : {}),
  });
}

/** Step 5: the IRG of a monthly taxable. The barème runs on 1/12 of each annual bracket. */
export function computeIrg(
  taxableInput: MoneyInput,
  rates: PayrollRates,
): { irg: string; detail: IrgDetail } {
  const taxable = money(taxableInput);
  let tax = ZERO;
  let floor = ZERO;
  for (const bracket of rates.irgBrackets) {
    const top = bracket.upTo === null ? null : money(bracket.upTo).div(12);
    const slice = (top && taxable.gt(top) ? top : taxable).minus(floor);
    if (slice.gt(0)) tax = tax.plus(slice.times(money(bracket.rate)));
    if (!top || taxable.lte(top)) break;
    floor = top;
  }
  const wanted = tax.times(money(rates.abattementRate));
  const min = money(rates.abattementMin);
  const max = money(rates.abattementMax);
  const abattement = wanted.lt(min) ? min : wanted.gt(max) ? max : wanted;
  const detail = { scaleTax: tax.toFixed(2), abattement: abattement.toFixed(2) };

  if (taxable.lte(money(rates.exemptionThreshold))) {
    return { irg: '0.00', detail: { ...detail, lissage: false, exempt: true } };
  }
  const afterAbattement = tax.minus(abattement);
  const lissage = taxable.lt(money(rates.lissageCeiling));
  const raw = lissage
    ? afterAbattement
        .times(money(rates.lissageNum))
        .div(money(rates.lissageDen))
        .minus(money(rates.lissageOffsetNum).div(money(rates.lissageOffsetDen)))
    : afterAbattement;
  const irg = raw.gt(0) ? raw.floor() : ZERO;
  return { irg: irg.toFixed(2), detail: { ...detail, lissage, exempt: false } };
}

/** Steps 2 to 6: the whole payslip. */
export function computePayslip(input: PayslipInput): PayslipResult {
  const { declared, rates } = input;
  const baseLines =
    input.payType === PayType.DAILY ? dailyBaseLines(input) : monthlyBaseLines(input);
  const overtime = overtimeLine(input);
  const items = input.items.map((i) => itemLine(i, input.days));
  const earned = [...baseLines, ...(overtime ? [overtime] : []), ...items];

  const gross = sum(earned.map((l) => l.amount));
  const total = (test: (l: PayLine) => boolean) => sum(earned.filter(test).map((l) => l.amount));
  const cotisable = total((l) => l.cotisable);
  // A negative régularisation may take a month below zero: no contribution comes back.
  const contributions = cotisable.gt(0) ? cotisable : ZERO;
  const cnasEmployee = declared ? round2(contributions.times(rates.cnasEmployeeRate)) : ZERO;
  const cnasEmployer = declared ? round2(contributions.times(rates.cnasEmployerRate)) : ZERO;

  // Cotisable items outside the IRG leave the taxable here and come back with the net.
  const taxable = declared ? gross.minus(cnasEmployee).minus(total((l) => !l.imposable)) : ZERO;
  const { irg, detail } = declared
    ? computeIrg(taxable, rates)
    : {
        irg: '0.00',
        detail: { scaleTax: '0.00', abattement: '0.00', lissage: false, exempt: true },
      };
  const net = gross.minus(cnasEmployee).minus(money(irg));

  const retenues = sum(input.retenues.map((r) => r.amount));
  // Retenues are entered by hand, so they go first; the avance takes what is left.
  const room = net.minus(retenues);
  const outstanding = money(input.advanceOutstanding);
  const owed = outstanding.gt(0) ? outstanding : ZERO;
  const payable = room.gt(0) ? room : ZERO;
  const advance = owed.gt(payable) ? payable : owed;

  const lines = [...earned];
  if (declared) {
    lines.push(
      line(PayLineCode.CNAS_EMPLOYEE, 'Cotisation CNAS', cnasEmployee.neg(), {
        base: toMoneyString(contributions),
        rate: rates.cnasEmployeeRate,
        cotisable: false,
        imposable: false,
      }),
      line(PayLineCode.IRG, 'IRG', money(irg).neg(), {
        base: toMoneyString(taxable),
        cotisable: false,
        imposable: false,
      }),
    );
  }
  for (const r of input.retenues) {
    lines.push(
      line(PayLineCode.RETENUE, r.label, money(r.amount).neg(), {
        cotisable: false,
        imposable: false,
      }),
    );
  }
  if (advance.gt(0)) {
    lines.push(
      line(PayLineCode.ADVANCE, 'Avance sur salaire', advance.neg(), {
        cotisable: false,
        imposable: false,
      }),
    );
  }
  return {
    lines,
    gross: toMoneyString(gross),
    cotisable: toMoneyString(cotisable),
    cnasEmployee: toMoneyString(cnasEmployee),
    cnasEmployer: toMoneyString(cnasEmployer),
    taxable: toMoneyString(taxable),
    irg,
    irgDetail: detail,
    net: toMoneyString(net),
    retenues: toMoneyString(retenues),
    advanceDeducted: toMoneyString(advance),
    advanceCarried: toMoneyString(owed.minus(advance)),
    netToPay: toMoneyString(room.minus(advance)),
    employerCost: toMoneyString(gross.plus(cnasEmployer)),
  };
}

/** The row in force for each pay item type on a day: a later row with 0 ends the item. */
export function payItemsOn<T extends { typeId: string; effectiveFrom: string; amount: string }>(
  rows: readonly T[],
  day: string,
): T[] {
  const found = new Map<string, T>();
  for (const row of rows) {
    if (row.effectiveFrom > day) continue;
    const current = found.get(row.typeId);
    if (!current || row.effectiveFrom >= current.effectiveFrom) found.set(row.typeId, row);
  }
  return [...found.values()].filter((r) => !money(r.amount).isZero());
}

/** Which of the two employee balances a ledger type moves. */
export type EmployeeBalanceDelta = { advance: Money; salaryDue: Money };

/**
 * The ledger's `amount` is signed from the worker's side: + he owes more. Avances and
 * salary owed are kept apart, or a month's unpaid salary would hide a running avance from
 * the next payslip. An avance taken back from a payslip moves both.
 */
export function employeeBalanceDelta(
  type: EmployeeLedgerType,
  amount: MoneyInput,
): EmployeeBalanceDelta {
  const value = money(amount);
  switch (type) {
    case EmployeeLedgerType.SALARY_DUE:
    case EmployeeLedgerType.SALARY_PAID:
    case EmployeeLedgerType.SALARY_REVERSAL:
      return { advance: ZERO, salaryDue: value.neg() };
    case EmployeeLedgerType.ADVANCE_DEDUCTION:
      return { advance: value, salaryDue: value };
    default:
      return { advance: value, salaryDue: ZERO };
  }
}
