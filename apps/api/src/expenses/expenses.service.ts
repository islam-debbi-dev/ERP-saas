import { Injectable } from '@nestjs/common';
import {
  algiersDay,
  alignedRentPeriods,
  type CreateExpenseInput,
  DocType,
  ErrorCode,
  type ExpenseCategoryKey,
  type ExpenseDto,
  type ExpenseListQuery,
  type ExpensePage,
  ExpenseStatus,
  Feature,
  Permission,
  type RentPeriod,
  toMoneyString,
} from '@erp/shared';
import { AuditService } from '../audit/audit.service';
import type { CurrentUserInfo } from '../auth/auth.types';
import { can } from '../auth/permissions';
import { FeaturesService } from '../billing/features.service';
import { AppException } from '../common/app-exception';
import { tenantContext } from '../common/tenant-context';
import { DocumentNumberingService } from '../documents/document-numbering.service';
import { type Prisma } from '../generated/prisma/client';
import { EmployeeLedgerService } from '../hr/employee-ledger.service';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import { ScopeService } from '../sales-force/scope.service';
import { WarehousesService } from '../stock/warehouses.service';
import { ExpenseCategoriesService } from './expense-categories.service';

export const expenseInclude = {
  warehouse: { select: { id: true, name: true } },
  category: { select: { id: true, name: true, key: true } },
} satisfies Prisma.ExpenseInclude;
type ExpenseRow = Prisma.ExpenseGetPayload<{ include: typeof expenseInclude }>;

/** `@db.Date` columns: midnight UTC of the Algiers day. */
export const toDay = (d: Date): string => d.toISOString().slice(0, 10);
export const fromDay = (day: string): Date => new Date(`${day}T00:00:00.000Z`);

function toDto(e: ExpenseRow, users: Map<string, { id: string; fullName: string }>): ExpenseDto {
  return {
    id: e.id,
    number: e.number,
    date: toDay(e.date),
    warehouse: e.warehouse,
    category: { ...e.category, key: (e.category.key as ExpenseCategoryKey | null) ?? null },
    amount: toMoneyString(e.amount.toString()),
    mode: e.mode,
    reference: e.reference,
    payee: e.payee,
    periodStart: e.periodStart ? toDay(e.periodStart) : null,
    periodEnd: e.periodEnd ? toDay(e.periodEnd) : null,
    note: e.note,
    rentContractId: e.rentContractId,
    status: e.status,
    createdBy: e.createdBy ? (users.get(e.createdBy) ?? null) : null,
    createdAt: e.createdAt.toISOString(),
    cancelReason: e.cancelReason,
    cancelledAt: e.cancelledAt?.toISOString() ?? null,
  };
}

/**
 * Dépenses (DEP, phase 25): the only writer of `expenses`. Immutable once saved; a mistake
 * is cancelled and entered again. A rent payment locks its contract row first, so payments
 * of one contract and the contract's edits never interleave.
 */
@Injectable()
export class ExpensesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: DocumentNumberingService,
    private readonly audit: AuditService,
    private readonly scope: ScopeService,
    private readonly warehouses: WarehousesService,
    private readonly features: FeaturesService,
    private readonly categories: ExpenseCategoriesService,
    private readonly employeeLedger: EmployeeLedgerService,
  ) {}

  async create(input: CreateExpenseInput, user: CurrentUserInfo): Promise<ExpenseDto> {
    const id = await this.prisma.db.$transaction(async (tx) => {
      const tenantId = tenantContext.requireTenantId();
      const date = input.date ?? algiersDay();
      let warehouseId: string | null;
      let categoryId: string;
      if (input.rentContractId) {
        const contract = await this.lockContract(tx, input.rentContractId);
        await this.scope.assertWarehouse(tx, user, contract.warehouseId);
        categoryId = await this.categories.rentId(tx);
        if (input.categoryId && input.categoryId !== categoryId) {
          throw new AppException(ErrorCode.VALIDATION_FAILED, 'A rent payment is a Loyer', {
            field: 'categoryId',
          });
        }
        await this.assertRentPeriod(tx, contract, input.periodStart!, input.periodEnd!);
        warehouseId = contract.warehouseId;
      } else {
        categoryId = await this.liveCategory(tx, input.categoryId!);
        warehouseId = await this.warehouseFor(tx, input.warehouseId, user);
      }
      const number = await this.numbering.next(tx, tenantId, DocType.DEP);
      const expense = await tx.expense.create({
        data: {
          tenantId,
          number,
          date: fromDay(date),
          warehouseId,
          categoryId,
          amount: input.amount,
          mode: input.mode,
          reference: input.reference,
          payee: input.payee,
          periodStart: input.periodStart ? fromDay(input.periodStart) : null,
          periodEnd: input.periodEnd ? fromDay(input.periodEnd) : null,
          note: input.note,
          rentContractId: input.rentContractId,
          createdBy: user.id,
        },
      });
      await this.audit.log(tx, {
        action: 'EXPENSE_CREATED',
        entity: 'Expense',
        entityId: expense.id,
        after: {
          number,
          date,
          amount: input.amount,
          categoryId,
          warehouseId,
          mode: input.mode,
          ...(input.periodStart ? { period: [input.periodStart, input.periodEnd] } : {}),
          ...(input.rentContractId ? { rentContractId: input.rentContractId } : {}),
        },
      });
      return expense.id;
    });
    return this.get(id, user);
  }

  /**
   * The dépense of an avance sur salaire (phase 31) or of a salary payment (31b, with its
   * run), inside the caller's transaction: the caller writes the employee ledger entry and
   * the audit row. Category Salaires, linked to the employee, in his dépôt. It is hidden
   * without SALARY_VIEW and never a charge.
   */
  async createEmployeePaymentInTx(
    tx: Tx,
    input: {
      employeeId: string;
      employeeName: string;
      warehouseId: string | null;
      amount: string;
      mode: ExpenseRow['mode'];
      date: string;
      reference: string | null;
      note: string | null;
      payrollRunId?: string;
    },
    user: CurrentUserInfo,
  ): Promise<{ id: string; number: string }> {
    const tenantId = tenantContext.requireTenantId();
    const warehouseId = await this.warehouseFor(tx, input.warehouseId, user);
    return tx.expense.create({
      data: {
        tenantId,
        number: await this.numbering.next(tx, tenantId, DocType.DEP),
        date: fromDay(input.date),
        warehouseId,
        categoryId: await this.categories.salariesId(tx),
        amount: input.amount,
        mode: input.mode,
        reference: input.reference,
        payee: input.employeeName,
        note: input.note,
        employeeId: input.employeeId,
        payrollRunId: input.payrollRunId ?? null,
        createdBy: user.id,
      },
      select: { id: true, number: true },
    });
  }

  /** Salaires dépenses of a period with no employee: entered by hand, they are charges. */
  async manualSalaryTotal(tx: Tx, from: string, to: string): Promise<string> {
    const total = await tx.expense.aggregate({
      where: {
        categoryId: await this.categories.salariesId(tx),
        employeeId: null,
        status: ExpenseStatus.VALID,
        date: { gte: fromDay(from), lte: fromDay(to) },
      },
      _sum: { amount: true },
    });
    return toMoneyString(total._sum.amount?.toString() ?? '0');
  }

  /** What was really paid on a run, per employee: cancelled payments do not count. */
  async paidOnRuns(tx: Tx, runIds: string[]): Promise<Map<string, string>> {
    const rows = await tx.expense.groupBy({
      by: ['payrollRunId', 'employeeId'],
      where: { payrollRunId: { in: runIds }, status: ExpenseStatus.VALID },
      _sum: { amount: true },
    });
    return new Map(
      rows.map((r) => [
        `${r.payrollRunId}|${r.employeeId}`,
        toMoneyString(r._sum.amount?.toString() ?? '0'),
      ]),
    );
  }

  /** Input mistake: the expense stays, marked cancelled, with the reason. Never deleted. */
  async cancel(id: string, reason: string, user: CurrentUserInfo): Promise<ExpenseDto> {
    await this.prisma.db.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<
        {
          id: string;
          status: ExpenseStatus;
          warehouseId: string | null;
          rentContractId: string | null;
          employeeId: string | null;
          payrollRunId: string | null;
          createdBy: string | null;
        }[]
      >`
        SELECT id, status, "warehouseId", "rentContractId", "employeeId", "payrollRunId",
               "createdBy" FROM expenses
        WHERE id = ${id}::uuid AND "tenantId" = ${tenantContext.requireTenantId()}::uuid
        FOR UPDATE`;
      const e = rows[0];
      if (!e || !(await this.visible(tx, user, e))) {
        throw new AppException(ErrorCode.NOT_FOUND, 'Expense not found');
      }
      if (e.status !== ExpenseStatus.VALID) {
        throw new AppException(ErrorCode.EXPENSE_NOT_VALID, 'Already cancelled', {
          status: e.status,
        });
      }
      await tx.expense.update({
        where: { id },
        data: {
          status: ExpenseStatus.CANCELLED,
          cancelReason: reason,
          cancelledBy: user.id,
          cancelledAt: new Date(),
          version: { increment: 1 },
        },
      });
      // An avance or a salary payment is reversed with its dépense, and its journal line
      // stays behind SALARY_VIEW. A cancelled payment is due again (paid is derived).
      if (e.employeeId) {
        await this.employeeLedger.reverseExpense(tx, e.employeeId, id, reason, user.id);
      }
      await this.audit.log(tx, {
        action: e.payrollRunId
          ? 'SALARY_PAYMENT_CANCELLED'
          : e.employeeId
            ? 'ADVANCE_CANCELLED'
            : 'EXPENSE_CANCELLED',
        entity: e.employeeId ? 'EmployeeAdvance' : 'Expense',
        entityId: id,
        before: { status: e.status },
        after: { reason },
      });
    });
    return this.get(id, user);
  }

  async get(id: string, user: CurrentUserInfo): Promise<ExpenseDto> {
    const scope = await this.scope.of(user);
    const e = await this.prisma.db.expense.findFirst({
      where: { id, AND: [this.where(scope), this.payWhere(user)] },
      include: expenseInclude,
    });
    if (!e) throw new AppException(ErrorCode.NOT_FOUND, 'Expense not found');
    return toDto(e, await this.users([e.createdBy]));
  }

  async list(query: ExpenseListQuery, user: CurrentUserInfo): Promise<ExpensePage> {
    const scope = await this.scope.of(user);
    const ids = this.scope.narrowWarehouses(scope.warehouseIds, query.warehouseId);
    const where: Prisma.ExpenseWhereInput = {
      AND: [
        this.where({ ...scope, warehouseIds: ids }),
        this.payWhere(user),
        query.categoryId ? { categoryId: query.categoryId } : {},
        query.rentContractId ? { rentContractId: query.rentContractId } : {},
        query.mode ? { mode: query.mode } : {},
        query.status ? { status: query.status } : {},
        query.from ? { date: { gte: fromDay(query.from) } } : {},
        query.to ? { date: { lte: fromDay(query.to) } } : {},
      ],
    };
    const rows = await this.prisma.db.expense.findMany({
      where,
      include: expenseInclude,
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const page = rows.slice(0, query.limit);
    const users = await this.users(page.map((e) => e.createdBy));
    return {
      items: page.map((e) => toDto(e, users)),
      nextCursor: rows.length > query.limit ? (page.at(-1)?.id ?? null) : null,
    };
  }

  /** Expenses of the dépôts a user works in (phase 24 rules, as for versements). */
  private where(scope: Awaited<ReturnType<ScopeService['of']>>): Prisma.ExpenseWhereInput {
    return this.scope.warehouseWhere(scope, scope.warehouseIds, 'createdBy') ?? {};
  }

  /** Avances are pay: without SALARY_VIEW they are not there (phase 31). */
  private payWhere(user: CurrentUserInfo): Prisma.ExpenseWhereInput {
    return can(user, Permission.SALARY_VIEW) ? {} : { employeeId: null };
  }

  private async visible(
    tx: Tx,
    user: CurrentUserInfo,
    e: { warehouseId: string | null; employeeId: string | null; createdBy: string | null },
  ): Promise<boolean> {
    if (e.employeeId && !can(user, Permission.SALARY_VIEW)) return false;
    const scope = await this.scope.of(user, tx);
    if (!scope.warehouseIds) return true;
    if (e.warehouseId) return scope.warehouseIds.includes(e.warehouseId);
    return (
      (!!scope.defaultWarehouseId && scope.warehouseIds.includes(scope.defaultWarehouseId)) ||
      e.createdBy === user.id
    );
  }

  /**
   * The dépôt of an expense. With MULTI_UNIT: the one chosen, else the user's only dépôt,
   * else the dépôt principal, and the user must work there. Without it: optional.
   */
  private async warehouseFor(
    tx: Tx,
    requested: string | null | undefined,
    user: CurrentUserInfo,
  ): Promise<string | null> {
    const multiUnit = (await this.features.of(user.tenantId)).features.includes(Feature.MULTI_UNIT);
    if (!multiUnit && !requested) return null;
    const id = await this.warehouses.resolve(tx, requested, () =>
      this.scope.onlyWarehouse(user, tx),
    );
    await this.scope.assertWarehouse(tx, user, id);
    return id;
  }

  private async liveCategory(tx: Tx, id: string): Promise<string> {
    const c = await tx.expenseCategory.findFirst({
      where: { id, deletedAt: null },
      select: { id: true },
    });
    if (!c) {
      throw new AppException(ErrorCode.VALIDATION_FAILED, 'Unknown category', {
        field: 'categoryId',
      });
    }
    return c.id;
  }

  /** Locks a rent contract row (FOR UPDATE): payments and edits of it never interleave. */
  async lockContract(tx: Tx, id: string): Promise<LockedContract> {
    const rows = await tx.$queryRaw<LockedContract[]>`
      SELECT id, "warehouseId", amount, period, "startDate", "endDate", "closedAt"
      FROM rent_contracts
      WHERE id = ${id}::uuid AND "tenantId" = ${tenantContext.requireTenantId()}::uuid
      FOR UPDATE`;
    const c = rows[0];
    if (!c) throw new AppException(ErrorCode.NOT_FOUND, 'Rent contract not found');
    return c;
  }

  /** A rent payment pays whole periods of its contract, inside it, not paid yet. */
  private async assertRentPeriod(
    tx: Tx,
    c: LockedContract,
    periodStart: string,
    periodEnd: string,
  ): Promise<void> {
    const periods = alignedRentPeriods(termsOf(c), periodStart, periodEnd);
    if (periods === null) {
      throw new AppException(
        ErrorCode.RENT_PERIOD_INVALID,
        'A rent payment covers whole periods of its contract',
        { rule: 'not_aligned' },
      );
    }
    const overlap = await tx.expense.findFirst({
      where: {
        rentContractId: c.id,
        status: ExpenseStatus.VALID,
        periodStart: { lte: fromDay(periodEnd) },
        periodEnd: { gte: fromDay(periodStart) },
      },
      select: { number: true },
    });
    if (overlap) {
      throw new AppException(ErrorCode.RENT_PERIOD_INVALID, 'This period is already paid', {
        rule: 'already_paid',
        number: overlap.number,
      });
    }
  }

  private async users(
    ids: (string | null)[],
  ): Promise<Map<string, { id: string; fullName: string }>> {
    const unique = [...new Set(ids.filter((u): u is string => !!u))];
    if (unique.length === 0) return new Map();
    const rows = await this.prisma.db.user.findMany({
      where: { id: { in: unique } },
      select: { id: true, fullName: true },
    });
    return new Map(rows.map((u) => [u.id, u]));
  }
}

export interface LockedContract {
  id: string;
  warehouseId: string;
  amount: Prisma.Decimal;
  period: RentPeriod;
  startDate: Date;
  endDate: Date | null;
  closedAt: Date | null;
}

export function termsOf(c: {
  amount: Prisma.Decimal;
  period: RentPeriod;
  startDate: Date;
  endDate: Date | null;
}) {
  return {
    amount: c.amount.toString(),
    period: c.period,
    startDate: toDay(c.startDate),
    endDate: c.endDate ? toDay(c.endDate) : null,
  };
}
