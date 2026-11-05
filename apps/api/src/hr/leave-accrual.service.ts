import { Injectable } from '@nestjs/common';
import {
  accrualForMonth,
  algiersDay,
  LeaveEntryType,
  missingAccrualMonths,
  money,
  previousMonth,
} from '@erp/shared';
import { tenantContext } from '../common/tenant-context';
import { type Tx } from '../prisma/prisma.service';
import { toDay } from './attendance-days.service';
import { EmployeeLedgerService } from './employee-ledger.service';

/** Room for a first read that catches up years of months. */
export const ACCRUAL_TX = { timeout: 30_000 };

interface Owed {
  employeeId: string;
  entries: { month: string; days: string }[];
}

/**
 * The congé days earned in closed months, posted on demand: a serverless deployment has no
 * timer to rely on, so whatever reads or writes a leave balance calls this first, in its
 * transaction. The timer of a long-running server does the same work ahead of them.
 *
 * Reading costs one query when nothing is owed, and takes no lock. When something is, the
 * employee rows are locked in id order and read again, so two requests never post a month
 * twice (the unique index on employee and month would fail the second one).
 */
@Injectable()
export class LeaveAccrualService {
  constructor(private readonly ledger: EmployeeLedgerService) {}

  ensureAccruals(tx: Tx, employeeId: string): Promise<number> {
    return this.ensureMany(tx, [employeeId]);
  }

  /** Returns how many months were posted. */
  async ensureMany(
    tx: Tx,
    employeeIds: string[],
    lastClosedMonth: string = previousMonth(algiersDay().slice(0, 7)),
  ): Promise<number> {
    const ids = [...new Set(employeeIds)].sort();
    if (ids.length === 0) return 0;
    const owedIds = (await this.owed(tx, ids, lastClosedMonth)).map((o) => o.employeeId);
    if (owedIds.length === 0) return 0;

    const tenantId = tenantContext.requireTenantId();
    await tx.$queryRaw`
      SELECT id FROM employees
      WHERE id = ANY(${owedIds}::uuid[]) AND "tenantId" = ${tenantId}::uuid
      ORDER BY id FOR UPDATE`;
    let posted = 0;
    for (const { employeeId, entries } of await this.owed(tx, owedIds, lastClosedMonth)) {
      await this.ledger.postAccruals(tx, employeeId, entries);
      posted += entries.length;
    }
    return posted;
  }

  private async owed(tx: Tx, ids: string[], lastClosedMonth: string): Promise<Owed[]> {
    const employees = await tx.employee.findMany({
      where: { id: { in: ids }, deletedAt: null },
      orderBy: { id: 'asc' },
      select: {
        id: true,
        hireDate: true,
        exitDate: true,
        leaveEntries: {
          where: { type: { in: [LeaveEntryType.ACCRUAL, LeaveEntryType.OPENING] } },
          select: { type: true, month: true, createdAt: true },
        },
      },
    });
    let rate: string | null = null;
    const owed: Owed[] = [];
    for (const e of employees) {
      const hireDate = toDay(e.hireDate);
      const exitDate = e.exitDate ? toDay(e.exitDate) : null;
      const openings = e.leaveEntries
        .filter((l) => l.type === LeaveEntryType.OPENING)
        .map((l) => algiersDay(l.createdAt).slice(0, 7))
        .sort();
      const months = missingAccrualMonths({
        hireDate,
        exitDate,
        openingMonth: openings.at(-1) ?? null,
        lastClosedMonth,
        posted: e.leaveEntries.flatMap((l) =>
          l.type === LeaveEntryType.ACCRUAL && l.month ? [l.month] : [],
        ),
      });
      if (months.length === 0) continue;
      rate ??= await this.monthlyRate(tx);
      const monthly = rate;
      const entries = months
        .map((month) => ({ month, days: accrualForMonth(month, hireDate, exitDate, monthly) }))
        .filter((entry) => !money(entry.days).isZero());
      if (entries.length > 0) owed.push({ employeeId: e.id, entries });
    }
    return owed;
  }

  private async monthlyRate(tx: Tx): Promise<string> {
    const tenant = await tx.tenant.findUniqueOrThrow({
      where: { id: tenantContext.requireTenantId() },
      select: { hrLeaveAccrualDays: true },
    });
    return tenant.hrLeaveAccrualDays.toFixed(1);
  }
}
