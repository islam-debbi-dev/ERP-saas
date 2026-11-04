import { createHash, randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  computePayslip,
  DayStatus,
  ErrorCode,
  type IrgBracket,
  isWorkingDay,
  money,
  monthBounds,
  type PayDay,
  type PayItemInput,
  PayLineCode,
  payItemsOn,
  type PayrollRates,
  PayrollManualKind,
  PayrollRunStatus,
  type PayslipIssue,
  PayslipIssueCode,
  type PayslipResult,
  PayType,
  previousMonth,
  type RetenueInput,
  salaryOn,
  summarizeDays,
  toMoneyString,
} from '@erp/shared';
import type { CurrentUserInfo } from '../auth/auth.types';
import { AppException } from '../common/app-exception';
import { tenantContext } from '../common/tenant-context';
import { type Prisma } from '../generated/prisma/client';
import {
  AttendanceDaysService,
  dayEmployeeSelect,
  fromDay,
  toDay,
} from '../hr/attendance-days.service';
import { EmployeeAccessService } from '../hr/employee-access.service';
import { RunsService } from '../incentives/runs.service';
import { type Tx } from '../prisma/prisma.service';
import { PayrollSettingsService } from './payroll-settings.service';

export interface ComputedSlip {
  employee: {
    id: string;
    fullName: string;
    matricule: string;
    position: string | null;
    nss: string | null;
    declared: boolean;
    warehouseId: string | null;
  };
  payType: PayType | null;
  salary: string;
  days: ReturnType<typeof summarizeDays>;
  issues: PayslipIssue[];
  result: PayslipResult;
  cumulGross: string;
  cumulIrg: string;
}

export interface ComputedRun {
  rateSetId: string;
  rateSetToVerify: boolean;
  slips: ComputedSlip[];
  fingerprint: string;
  incentivesWithoutEmployee: { userId: string; fullName: string; amount: string }[];
}

/**
 * Reads everything a month's payslips depend on and hands it to the pure rules of
 * packages/shared/payroll.ts. Nothing here decides an amount.
 */
@Injectable()
export class PayrollComputeService {
  constructor(
    private readonly days: AttendanceDaysService,
    private readonly access: EmployeeAccessService,
    private readonly settings: PayrollSettingsService,
    private readonly incentives: RunsService,
  ) {}

  /** The set valid on the month's last day: latest date, then the latest correction. */
  async rateSet(tx: Tx, month: string) {
    const rows = await tx.payrollRateSet.findMany({
      where: { effectiveFrom: { lte: fromDay(monthBounds(month).to) } },
      orderBy: [{ effectiveFrom: 'desc' }, { seq: 'desc' }],
      take: 1,
    });
    const row = rows[0];
    if (!row) {
      throw new AppException(ErrorCode.PAYROLL_NO_RATE_SET, 'No rate set covers this month', {
        month,
      });
    }
    return row;
  }

  /** Who a run covers: those reached, employed in the month, not paid by another run. */
  async employeeIds(
    tx: Tx,
    month: string,
    warehouseId: string | null,
    runId: string | null,
    user: CurrentUserInfo,
  ): Promise<string[]> {
    const rows = await tx.employee.findMany({
      where: await this.employeeWhere(tx, month, warehouseId, runId, user),
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  private async employeeWhere(
    tx: Tx,
    month: string,
    warehouseId: string | null,
    runId: string | null,
    user: CurrentUserInfo,
  ): Promise<Prisma.EmployeeWhereInput> {
    const { from, to } = monthBounds(month);
    const paidElsewhere = await tx.payslip.findMany({
      where: {
        month,
        run: { status: PayrollRunStatus.APPROVED },
        ...(runId ? { runId: { not: runId } } : {}),
      },
      select: { employeeId: true },
    });
    return {
      AND: [
        await this.access.where(user, 'operate', warehouseId ?? undefined, tx),
        {
          deletedAt: null,
          hireDate: { lte: fromDay(to) },
          OR: [{ exitDate: null }, { exitDate: { gte: fromDay(from) } }],
          id: { notIn: paidElsewhere.map((p) => p.employeeId) },
        },
      ],
    };
  }

  async compute(
    tx: Tx,
    month: string,
    warehouseId: string | null,
    runId: string | null,
    user: CurrentUserInfo,
  ): Promise<ComputedRun> {
    const tenantId = tenantContext.requireTenantId();
    const { from, to } = monthBounds(month);
    await this.settings.ensureTypes(tx);
    const rateSet = await this.rateSet(tx, month);
    const rates = toRates(rateSet);
    const settings = await this.settings.get(tx);

    const employees = await tx.employee.findMany({
      where: await this.employeeWhere(tx, month, warehouseId, runId, user),
      select: {
        ...dayEmployeeSelect,
        fullName: true,
        matricule: true,
        position: true,
        nss: true,
        declared: true,
        userId: true,
      },
      orderBy: { fullName: 'asc' },
    });
    const ids = employees.map((e) => e.id);
    const year = month.slice(0, 4);
    const [
      calendar,
      dayMap,
      salaries,
      items,
      manual,
      balances,
      earlier,
      incentives,
      paidIncentives,
    ] = await Promise.all([
      this.days.calendar(tx, tenantId, from, to),
      this.days.read(tx, tenantId, employees, from, to),
      tx.employeeSalary.findMany({
        where: { employeeId: { in: ids }, effectiveFrom: { lte: fromDay(to) } },
        orderBy: { seq: 'asc' },
      }),
      tx.employeePayItem.findMany({
        where: {
          employeeId: { in: ids },
          effectiveFrom: { lte: fromDay(to) },
          type: { deletedAt: null },
        },
        orderBy: { seq: 'asc' },
        include: { type: true },
      }),
      runId ? tx.payrollManualLine.findMany({ where: { runId } }) : Promise.resolve([]),
      tx.employeeBalance.findMany({
        where: { employeeId: { in: ids } },
        select: { employeeId: true, advanceBalance: true },
      }),
      tx.payslip.groupBy({
        by: ['employeeId'],
        where: {
          employeeId: { in: ids },
          month: { gte: `${year}-01`, lt: month },
          run: { status: PayrollRunStatus.APPROVED },
        },
        _sum: { gross: true, irg: true },
      }),
      // This month and the one before: a run approved late is paid once, by the next
      // payroll. Older ones went through the Excel export.
      this.incentives.approvedForPayroll(tx, fromDay(`${previousMonth(month)}-01`), fromDay(to)),
      tx.payslipLine.findMany({
        where: {
          incentiveRunId: { not: null },
          payslip: { run: { status: PayrollRunStatus.APPROVED } },
        },
        select: { incentiveRunId: true, payslip: { select: { employeeId: true } } },
      }),
    ]);

    const alreadyPaid = new Set(
      paidIncentives.map((l) => `${l.incentiveRunId}|${l.payslip.employeeId}`),
    );
    const byUser = new Map<string, string>();
    for (const e of employees) if (e.userId) byUser.set(e.userId, e.id);
    const linkedElsewhere = await tx.employee.findMany({
      where: { userId: { in: incentives.map((i) => i.userId) } },
      select: { userId: true },
    });
    const linked = new Set(linkedElsewhere.map((e) => e.userId));
    const advances = new Map(balances.map((b) => [b.employeeId, b.advanceBalance.toString()]));
    const cumuls = new Map(earlier.map((c) => [c.employeeId, c._sum]));

    const slips = employees.map((employee): ComputedSlip => {
      const calendarOf = this.days.calendarOf(employee, calendar);
      const views = [...(dayMap.get(employee.id)?.entries() ?? [])];
      const payDays: PayDay[] = views.map(([day, v]) => ({
        status: v.status,
        workingDay: isWorkingDay(day, calendarOf),
        lateMinutes: v.lateMinutes,
        overtimeHours: v.overtimeHours,
      }));
      const days = summarizeDays(payDays);
      const unmarked = views.filter(([, v]) => v.status === DayStatus.UNMARKED).map(([d]) => d);
      const salaryRow = salaryOn(
        salaries
          .filter((s) => s.employeeId === employee.id)
          .map((s) => ({ ...s, effectiveFrom: toDay(s.effectiveFrom) })),
        to,
      );

      const payItems: PayItemInput[] = payItemsOn(
        items
          .filter((i) => i.employeeId === employee.id)
          .map((i) => ({
            typeId: i.typeId,
            effectiveFrom: toDay(i.effectiveFrom),
            amount: i.amount.toString(),
            type: i.type,
          })),
        to,
      ).map((i) => ({
        code: PayLineCode.ITEM,
        label: i.type.name,
        amount: i.amount,
        mode: i.type.mode,
        cotisable: i.type.cotisable,
        imposable: i.type.imposable,
      }));
      const retenues: RetenueInput[] = [];
      for (const m of manual.filter((l) => l.employeeId === employee.id)) {
        if (m.kind === PayrollManualKind.RETENUE) {
          retenues.push({ label: m.label, amount: m.amount.toString() });
        } else {
          payItems.push({
            code: m.kind === PayrollManualKind.ITEM ? PayLineCode.ITEM : PayLineCode.REGULARISATION,
            label: m.label,
            amount: m.amount.toString(),
            cotisable: m.cotisable,
            imposable: m.imposable,
          });
        }
      }
      for (const i of incentives) {
        if (byUser.get(i.userId) !== employee.id) continue;
        if (alreadyPaid.has(`${i.runId}|${employee.id}`) || money(i.amount).isZero()) continue;
        payItems.push({
          code: PayLineCode.INCENTIVE,
          label: `Primes commerciales ${i.period}`,
          amount: i.amount,
          cotisable: true,
          imposable: true,
          incentiveRunId: i.runId,
        });
      }

      const advanceOutstanding = advances.get(employee.id) ?? '0';
      const result = computePayslip({
        payType: salaryRow?.payType ?? PayType.MONTHLY,
        salary: salaryRow?.amount.toString() ?? '0',
        declared: employee.declared,
        days,
        items: payItems,
        retenues,
        advanceOutstanding,
        settings,
        rates,
      });

      const issues: PayslipIssue[] = [];
      if (unmarked.length > 0) {
        issues.push({ code: PayslipIssueCode.UNMARKED_DAYS, days: unmarked });
      }
      if (!salaryRow) issues.push({ code: PayslipIssueCode.NO_SALARY });
      if (money(result.netToPay).isNegative()) issues.push({ code: PayslipIssueCode.NEGATIVE_NET });
      if (
        salaryRow?.payType === PayType.MONTHLY &&
        money(salaryRow.amount.toString()).lt(money(rates.snmg))
      ) {
        issues.push({ code: PayslipIssueCode.BELOW_SNMG });
      }
      if (money(advanceOutstanding).isNegative()) {
        issues.push({ code: PayslipIssueCode.ADVANCE_CREDIT });
      }

      const before = cumuls.get(employee.id);
      return {
        employee,
        payType: salaryRow?.payType ?? null,
        salary: toMoneyString(salaryRow?.amount.toString() ?? '0'),
        days,
        issues,
        result,
        cumulGross: toMoneyString(money(before?.gross?.toString() ?? '0').add(money(result.gross))),
        cumulIrg: toMoneyString(money(before?.irg?.toString() ?? '0').add(money(result.irg))),
      };
    });

    const orphans = new Map<string, { userId: string; fullName: string; amount: string }>();
    for (const i of incentives) {
      if (linked.has(i.userId) || money(i.amount).isZero()) continue;
      const seen = orphans.get(i.userId);
      orphans.set(i.userId, {
        userId: i.userId,
        fullName: i.fullName,
        amount: toMoneyString(money(seen?.amount ?? '0').add(money(i.amount))),
      });
    }

    return {
      rateSetId: rateSet.id,
      rateSetToVerify: rateSet.toVerify,
      slips,
      fingerprint: createHash('sha256')
        .update(
          JSON.stringify([
            rateSet.id,
            slips.map((s) => [s.employee.id, s.employee.warehouseId, s.result, s.issues]),
          ]),
        )
        .digest('hex'),
      incentivesWithoutEmployee: [...orphans.values()],
    };
  }

  /** Replaces a draft's payslips. The freeze trigger refuses this on any other status. */
  async write(tx: Tx, runId: string, month: string, computed: ComputedRun): Promise<void> {
    const tenantId = tenantContext.requireTenantId();
    await tx.payslip.deleteMany({ where: { runId } });
    const slips = computed.slips.map((s) => ({ id: randomUUID(), slip: s }));
    if (slips.length === 0) return;
    await tx.payslip.createMany({
      data: slips.map(({ id, slip: s }) => ({
        id,
        tenantId,
        runId,
        employeeId: s.employee.id,
        month,
        warehouseId: s.employee.warehouseId,
        rateSetId: computed.rateSetId,
        rateSetToVerify: computed.rateSetToVerify,
        fullName: s.employee.fullName,
        matricule: s.employee.matricule,
        position: s.employee.position,
        nss: s.employee.nss,
        declared: s.employee.declared,
        payType: s.payType,
        salary: s.salary,
        days: s.days as unknown as Prisma.InputJsonValue,
        issues: s.issues as unknown as Prisma.InputJsonValue,
        irgDetail: s.result.irgDetail as unknown as Prisma.InputJsonValue,
        gross: s.result.gross,
        cotisable: s.result.cotisable,
        cnasEmployee: s.result.cnasEmployee,
        cnasEmployer: s.result.cnasEmployer,
        taxable: s.result.taxable,
        irg: s.result.irg,
        net: s.result.net,
        retenues: s.result.retenues,
        advanceDeducted: s.result.advanceDeducted,
        advanceCarried: s.result.advanceCarried,
        netToPay: s.result.netToPay,
        employerCost: s.result.employerCost,
        cumulGross: s.cumulGross,
        cumulIrg: s.cumulIrg,
      })),
    });
    await tx.payslipLine.createMany({
      data: slips.flatMap(({ id, slip }) =>
        slip.result.lines.map((l, position) => ({
          tenantId,
          runId,
          payslipId: id,
          position,
          code: l.code,
          label: l.label.slice(0, 120),
          quantity: l.quantity ?? null,
          base: l.base ?? null,
          rate: l.rate ?? null,
          amount: l.amount,
          cotisable: l.cotisable,
          imposable: l.imposable,
          incentiveRunId: l.incentiveRunId ?? null,
        })),
      ),
    });
  }
}

function toRates(r: {
  cnasEmployeeRate: { toString(): string };
  cnasEmployerRate: { toString(): string };
  irgBrackets: unknown;
  abattementRate: { toString(): string };
  abattementMin: { toString(): string };
  abattementMax: { toString(): string };
  exemptionThreshold: { toString(): string };
  lissageCeiling: { toString(): string };
  lissageNum: { toString(): string };
  lissageDen: { toString(): string };
  lissageOffsetNum: { toString(): string };
  lissageOffsetDen: { toString(): string };
  snmg: { toString(): string };
}): PayrollRates {
  return {
    cnasEmployeeRate: r.cnasEmployeeRate.toString(),
    cnasEmployerRate: r.cnasEmployerRate.toString(),
    irgBrackets: r.irgBrackets as IrgBracket[],
    abattementRate: r.abattementRate.toString(),
    abattementMin: r.abattementMin.toString(),
    abattementMax: r.abattementMax.toString(),
    exemptionThreshold: r.exemptionThreshold.toString(),
    lissageCeiling: r.lissageCeiling.toString(),
    lissageNum: r.lissageNum.toString(),
    lissageDen: r.lissageDen.toString(),
    lissageOffsetNum: r.lissageOffsetNum.toString(),
    lissageOffsetDen: r.lissageOffsetDen.toString(),
    snmg: r.snmg.toString(),
  };
}
