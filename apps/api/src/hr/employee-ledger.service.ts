import { Injectable } from '@nestjs/common';
import { EmployeeLedgerType, type LeaveEntryType, money, toMoneyString } from '@erp/shared';
import { tenantContext } from '../common/tenant-context';
import { type Tx } from '../prisma/prisma.service';

interface LockedBalance {
  advanceBalance: string;
  leaveDays: string;
}

/**
 * The only writer of the employee's account and congé ledgers (phase 31). Both are
 * append-only; the cached balances are written in the same transaction, under a row lock,
 * and reconciled nightly. Lives in HrCoreModule so ExpensesService can reverse an avance
 * without depending on the HR module.
 */
@Injectable()
export class EmployeeLedgerService {
  /** Creates the balance row if needed and locks it until the transaction ends. */
  private async lock(tx: Tx, employeeId: string): Promise<LockedBalance> {
    const tenantId = tenantContext.requireTenantId();
    await tx.$executeRaw`
      INSERT INTO employee_balances ("id", "tenantId", "employeeId", "updatedAt")
      VALUES (gen_random_uuid(), ${tenantId}::uuid, ${employeeId}::uuid, CURRENT_TIMESTAMP)
      ON CONFLICT DO NOTHING`;
    const rows = await tx.$queryRaw<LockedBalance[]>`
      SELECT "advanceBalance"::text AS "advanceBalance", "leaveDays"::text AS "leaveDays"
      FROM employee_balances
      WHERE "employeeId" = ${employeeId}::uuid AND "tenantId" = ${tenantId}::uuid
      FOR UPDATE`;
    const row = rows[0];
    if (!row) throw new Error('Employee balance row missing after insert');
    return row;
  }

  /** `amount` is signed: + the worker owes more, − he owes less. */
  async post(
    tx: Tx,
    entry: {
      employeeId: string;
      type: EmployeeLedgerType;
      amount: string;
      expenseId?: string | null;
      note?: string | null;
      userId?: string | null;
    },
  ): Promise<{ id: string; balanceAfter: string }> {
    const before = await this.lock(tx, entry.employeeId);
    const balanceAfter = toMoneyString(money(before.advanceBalance).add(money(entry.amount)));
    const row = await tx.employeeLedgerEntry.create({
      data: {
        tenantId: tenantContext.requireTenantId(),
        employeeId: entry.employeeId,
        type: entry.type,
        amount: entry.amount,
        balanceAfter,
        expenseId: entry.expenseId ?? null,
        note: entry.note ?? null,
        createdBy: entry.userId ?? null,
      },
      select: { id: true },
    });
    await tx.employeeBalance.update({
      where: { employeeId: entry.employeeId },
      data: { advanceBalance: balanceAfter },
    });
    return { id: row.id, balanceAfter };
  }

  /** Cancels what a dépense put on the account: one reversing entry, nothing is edited. */
  async reverseExpense(
    tx: Tx,
    employeeId: string,
    expenseId: string,
    reason: string,
    userId: string,
  ): Promise<void> {
    const entries = await tx.employeeLedgerEntry.findMany({
      where: { employeeId, expenseId },
      select: { amount: true },
    });
    const net = entries.reduce((total, e) => total.add(money(e.amount.toString())), money(0));
    if (net.isZero()) return;
    await this.post(tx, {
      employeeId,
      type: EmployeeLedgerType.REVERSAL,
      amount: toMoneyString(net.neg()),
      expenseId,
      note: reason,
      userId,
    });
  }

  /** `days` is signed. Returns the balance after the entry. */
  async postLeave(
    tx: Tx,
    entry: {
      employeeId: string;
      type: LeaveEntryType;
      days: string;
      month?: string | null;
      leaveRequestId?: string | null;
      note?: string | null;
      userId?: string | null;
    },
  ): Promise<string> {
    const before = await this.lock(tx, entry.employeeId);
    const after = money(before.leaveDays).add(money(entry.days)).toFixed(1);
    await tx.leaveEntry.create({
      data: {
        tenantId: tenantContext.requireTenantId(),
        employeeId: entry.employeeId,
        type: entry.type,
        days: entry.days,
        month: entry.month ?? null,
        leaveRequestId: entry.leaveRequestId ?? null,
        note: entry.note ?? null,
        createdBy: entry.userId ?? null,
      },
    });
    await tx.employeeBalance.update({
      where: { employeeId: entry.employeeId },
      data: { leaveDays: after },
    });
    return after;
  }
}
