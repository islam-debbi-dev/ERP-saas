import { Injectable } from '@nestjs/common';
import {
  algiersDay,
  type CreateAdvanceInput,
  EmployeeLedgerType,
  type EmployeeLedgerEntryDto,
  ErrorCode,
  Permission,
  toMoneyString,
} from '@erp/shared';
import { AuditService } from '../audit/audit.service';
import type { CurrentUserInfo } from '../auth/auth.types';
import { requirePermission } from '../auth/permissions';
import { AppException } from '../common/app-exception';
import { ExpensesService } from '../expenses/expenses.service';
import { PrismaService } from '../prisma/prisma.service';
import { EmployeeAccessService } from './employee-access.service';
import { EmployeeLedgerService } from './employee-ledger.service';

/**
 * Avance sur salaire (phase 31): one operation, one transaction: a dépense, a debit on the
 * employee's account and the audit row. Cancelled with the dépense (ExpensesService.cancel
 * posts the reversal). Cash, never a charge: ChargesService leaves it out.
 */
@Injectable()
export class AdvancesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: EmployeeAccessService,
    private readonly expenses: ExpensesService,
    private readonly ledger: EmployeeLedgerService,
  ) {}

  async pay(
    employeeId: string,
    input: CreateAdvanceInput,
    user: CurrentUserInfo,
  ): Promise<EmployeeLedgerEntryDto> {
    requirePermission(user, Permission.SALARY_VIEW);
    return this.prisma.db.$transaction(async (tx) => {
      await this.access.assertReach(tx, user, employeeId);
      const employee = (await this.access.lock(tx, [employeeId])).get(employeeId)!;
      if (employee.deletedAt) throw new AppException(ErrorCode.NOT_FOUND, 'Employee not found');
      const date = input.date ?? algiersDay();
      const expense = await this.expenses.createEmployeePaymentInTx(
        tx,
        {
          employeeId,
          employeeName: employee.fullName,
          warehouseId: employee.warehouseId,
          amount: input.amount,
          mode: input.mode,
          date,
          reference: input.reference,
          note: input.note,
        },
        user,
      );
      const entry = await this.ledger.post(tx, {
        employeeId,
        type: EmployeeLedgerType.ADVANCE,
        amount: input.amount,
        expenseId: expense.id,
        note: input.note,
        userId: user.id,
      });
      await this.audit.log(tx, {
        action: 'ADVANCE_PAID',
        entity: 'EmployeeAdvance',
        entityId: expense.id,
        after: { employeeId, amount: input.amount, mode: input.mode, number: expense.number },
      });
      return {
        id: entry.id,
        type: EmployeeLedgerType.ADVANCE,
        amount: toMoneyString(input.amount),
        balanceAfter: entry.balanceAfter,
        expenseId: expense.id,
        expenseNumber: expense.number,
        note: input.note,
        createdAt: new Date().toISOString(),
      };
    });
  }
}
