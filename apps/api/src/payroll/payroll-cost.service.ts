import { Injectable } from '@nestjs/common';
import {
  type DayRange,
  type Money,
  money,
  monthBounds,
  PayrollRunStatus,
  rangeLength,
} from '@erp/shared';
import { PrismaService, type Tx } from '../prisma/prisma.service';

type Db = PrismaService['db'] | Tx;

export interface PayrollCost {
  warehouseId: string | null;
  /** Not rounded: the charges report rounds each cell once. */
  amount: Money;
}

function overlap(a: DayRange, b: DayRange): number {
  const from = a.from > b.from ? a.from : b.from;
  const to = a.to < b.to ? a.to : b.to;
  return from > to ? 0 : rangeLength({ from, to });
}

/**
 * What approved payroll costs a period (phase 31b): gross + employer CNAS of the run's
 * month, spread by day like rent, by the dépôt frozen on each payslip. Salary payments and
 * avances are cash and never counted here. Lives apart from the payroll module, which needs
 * ExpensesService, so that ChargesService can read it.
 */
@Injectable()
export class PayrollCostService {
  constructor(private readonly prisma: PrismaService) {}

  async ofRange(range: DayRange, db: Db = this.prisma.db): Promise<PayrollCost[]> {
    const months = monthsOf(range);
    const rows = await db.payslip.findMany({
      where: { month: { in: months }, run: { status: PayrollRunStatus.APPROVED } },
      select: { month: true, warehouseId: true, employerCost: true },
    });
    return rows.map((r) => {
      const month = monthBounds(r.month);
      return {
        warehouseId: r.warehouseId,
        amount: money(r.employerCost.toString())
          .times(overlap(month, range))
          .div(rangeLength(month)),
      };
    });
  }
}

function monthsOf(range: DayRange): string[] {
  const months: string[] = [];
  let year = Number(range.from.slice(0, 4));
  let month = Number(range.from.slice(5, 7));
  const last = range.to.slice(0, 7);
  for (;;) {
    const current = `${year}-${String(month).padStart(2, '0')}`;
    if (current > last) return months;
    months.push(current);
    month = month === 12 ? 1 : month + 1;
    if (month === 1) year += 1;
  }
}
