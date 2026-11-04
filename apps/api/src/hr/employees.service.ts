import { Injectable } from '@nestjs/common';
import {
  algiersDay,
  type CreateEmployeeInput,
  DocType,
  type EmployeeDto,
  type EmployeeLedgerPage,
  type EmployeeListQuery,
  type EmployeePage,
  type EmployeeSalaryDto,
  type EmployeeSalaryInput,
  ErrorCode,
  Feature,
  type LedgerQuery,
  Permission,
  salaryOn,
  toMoneyString,
  type UpdateEmployeeInput,
  WarehouseType,
} from '@erp/shared';
import { AuditService } from '../audit/audit.service';
import type { CurrentUserInfo } from '../auth/auth.types';
import { can, requirePermission } from '../auth/permissions';
import { FeaturesService } from '../billing/features.service';
import { AppException } from '../common/app-exception';
import { tenantContext } from '../common/tenant-context';
import { DocumentNumberingService } from '../documents/document-numbering.service';
import { type Prisma } from '../generated/prisma/client';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import { ScopeService } from '../sales-force/scope.service';
import { AttendanceDaysService, fromDay, toDay } from './attendance-days.service';
import { CalendarService } from './calendar.service';
import { EmployeeAccessService } from './employee-access.service';

const include = {
  warehouse: { select: { id: true, name: true } },
  user: { select: { id: true, fullName: true } },
  balance: { select: { advanceBalance: true, leaveDays: true } },
  salaries: { orderBy: { seq: 'asc' } },
} satisfies Prisma.EmployeeInclude;
type EmployeeRow = Prisma.EmployeeGetPayload<{ include: typeof include }>;

const optionalDay = (d: string | null): Date | null => (d ? fromDay(d) : null);

/** Personnel (phase 31): master data, soft delete. Salaries are append-only rows. */
@Injectable()
export class EmployeesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: DocumentNumberingService,
    private readonly audit: AuditService,
    private readonly scope: ScopeService,
    private readonly features: FeaturesService,
    private readonly access: EmployeeAccessService,
    private readonly days: AttendanceDaysService,
    private readonly calendar: CalendarService,
  ) {}

  private toDto(e: EmployeeRow, user: CurrentUserInfo): EmployeeDto {
    const dto: EmployeeDto = {
      id: e.id,
      matricule: e.matricule,
      fullName: e.fullName,
      phone: e.phone,
      position: e.position,
      warehouse: e.warehouse,
      user: e.user,
      hireDate: toDay(e.hireDate),
      exitDate: e.exitDate ? toDay(e.exitDate) : null,
      contract: e.contract,
      contractEndDate: e.contractEndDate ? toDay(e.contractEndDate) : null,
      declared: e.declared,
      nss: e.nss,
      nin: e.nin,
      birthDate: e.birthDate ? toDay(e.birthDate) : null,
      restDays: e.restDays.length > 0 ? e.restDays : null,
      leaveBalance: e.balance?.leaveDays.toFixed(1) ?? '0.0',
      archived: e.deletedAt !== null,
    };
    if (!can(user, Permission.SALARY_VIEW)) return dto;
    const current = salaryOn(
      e.salaries.map((s) => ({ ...s, effectiveFrom: toDay(s.effectiveFrom) })),
      algiersDay(),
    );
    return {
      ...dto,
      pay: {
        bankAccount: e.bankAccount,
        payType: current?.payType ?? null,
        salary: current ? toMoneyString(current.amount.toString()) : null,
        advanceBalance: toMoneyString(e.balance?.advanceBalance.toString() ?? '0'),
      },
    };
  }

  async list(query: EmployeeListQuery, user: CurrentUserInfo): Promise<EmployeePage> {
    const search = query.search;
    const rows = await this.prisma.db.employee.findMany({
      where: {
        AND: [
          await this.access.where(user, 'operate', query.warehouseId),
          { deletedAt: query.archived ? { not: null } : null },
          search
            ? {
                OR: [
                  { fullName: { contains: search, mode: 'insensitive' } },
                  { matricule: { contains: search, mode: 'insensitive' } },
                  { phone: { contains: search } },
                ],
              }
            : {},
        ],
      },
      include,
      orderBy: [{ fullName: 'asc' }, { id: 'asc' }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const page = rows.slice(0, query.limit);
    return {
      items: page.map((e) => this.toDto(e, user)),
      nextCursor: rows.length > query.limit ? (page.at(-1)?.id ?? null) : null,
    };
  }

  async get(id: string, user: CurrentUserInfo): Promise<EmployeeDto> {
    await this.access.assertReach(this.prisma.db, user, id);
    const e = await this.prisma.db.employee.findFirstOrThrow({ where: { id }, include });
    return this.toDto(e, user);
  }

  async create(input: CreateEmployeeInput, user: CurrentUserInfo): Promise<EmployeeDto> {
    if (input.salary) requirePermission(user, Permission.SALARY_VIEW);
    const id = await this.prisma.db.$transaction((tx) => this.createInTx(tx, input, user));
    return this.get(id, user);
  }

  /** Also used by the Excel import, inside its transaction. */
  async createInTx(tx: Tx, input: CreateEmployeeInput, user: CurrentUserInfo): Promise<string> {
    const tenantId = tenantContext.requireTenantId();
    await this.assertWarehouse(tx, input.warehouseId, user);
    await this.assertUser(tx, input.userId, null);
    const matricule = await this.numbering.nextPerTenant(tx, tenantId, DocType.EMP);
    const employee = await tx.employee.create({
      data: {
        tenantId,
        matricule,
        ...this.fields(input),
        bankAccount: can(user, Permission.SALARY_VIEW) ? input.bankAccount : null,
        createdBy: user.id,
      },
      select: { id: true },
    });
    await tx.employeeBalance.create({ data: { tenantId, employeeId: employee.id } });
    if (input.salary) await this.addSalary(tx, employee.id, input.salary, user);
    // HR can be granted at any time: the first employee brings the fixed fêtes.
    await this.calendar.ensureFixedHolidays(tx, tenantId, this.calendar.thisAndNextYear());
    await this.audit.log(tx, {
      action: 'EMPLOYEE_CREATED',
      entity: 'Employee',
      entityId: employee.id,
      after: { matricule, fullName: input.fullName, warehouseId: input.warehouseId },
    });
    return employee.id;
  }

  async update(
    id: string,
    input: UpdateEmployeeInput,
    user: CurrentUserInfo,
  ): Promise<EmployeeDto> {
    await this.prisma.db.$transaction(
      async (tx) => {
        await this.access.assertReach(tx, user, id);
        const locked = (await this.access.lock(tx, [id])).get(id)!;
        await this.assertWarehouse(tx, input.warehouseId, user);
        await this.assertUser(tx, input.userId, id);
        const updated = await tx.employee.update({
          where: { id },
          data: {
            ...this.fields(input),
            // A user who cannot see the RIB cannot send it back: keep what is stored.
            ...(can(user, Permission.SALARY_VIEW) ? { bankAccount: input.bankAccount } : {}),
          },
          select: {
            id: true,
            hireDate: true,
            exitDate: true,
            restDays: true,
            warehouseId: true,
          },
        });
        // Hire, exit or rest days decide what cached days say (locked months stay frozen).
        const tenantId = tenantContext.requireTenantId();
        for (const d of await this.days.diffs(tx, tenantId)) {
          if (d.employee.id === id) await this.days.recompute(tx, updated, [d.day]);
        }
        await this.audit.log(tx, {
          action: 'EMPLOYEE_UPDATED',
          entity: 'Employee',
          entityId: id,
          before: { fullName: locked.fullName, warehouseId: locked.warehouseId },
          after: { fullName: input.fullName, warehouseId: input.warehouseId },
        });
      },
      { timeout: 30_000 },
    );
    return this.get(id, user);
  }

  async archive(id: string, user: CurrentUserInfo): Promise<void> {
    await this.setArchived(id, new Date(), 'EMPLOYEE_ARCHIVED', user);
  }

  async restore(id: string, user: CurrentUserInfo): Promise<EmployeeDto> {
    await this.setArchived(id, null, 'EMPLOYEE_RESTORED', user);
    return this.get(id, user);
  }

  private async setArchived(
    id: string,
    deletedAt: Date | null,
    action: string,
    user: CurrentUserInfo,
  ): Promise<void> {
    await this.prisma.db.$transaction(async (tx) => {
      await this.access.assertReach(tx, user, id);
      await tx.employee.update({ where: { id }, data: { deletedAt } });
      await this.audit.log(tx, { action, entity: 'Employee', entityId: id });
    });
  }

  async salaries(id: string, user: CurrentUserInfo): Promise<EmployeeSalaryDto[]> {
    await this.access.assertReach(this.prisma.db, user, id);
    const rows = await this.prisma.db.employeeSalary.findMany({
      where: { employeeId: id },
      orderBy: [{ effectiveFrom: 'desc' }, { seq: 'desc' }],
    });
    const ids = [...new Set(rows.map((r) => r.createdBy).filter((u): u is string => !!u))];
    const users = await this.prisma.db.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, fullName: true },
    });
    const byId = new Map(users.map((u) => [u.id, u]));
    return rows.map((r) => ({
      id: r.id,
      amount: toMoneyString(r.amount.toString()),
      payType: r.payType,
      effectiveFrom: toDay(r.effectiveFrom),
      reason: r.reason,
      createdBy: r.createdBy ? (byId.get(r.createdBy) ?? null) : null,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  async appendSalary(
    id: string,
    input: EmployeeSalaryInput,
    user: CurrentUserInfo,
  ): Promise<EmployeeSalaryDto[]> {
    await this.prisma.db.$transaction(async (tx) => {
      await this.access.assertReach(tx, user, id);
      await this.access.lock(tx, [id]);
      await this.addSalary(tx, id, input, user);
    });
    return this.salaries(id, user);
  }

  private async addSalary(
    tx: Tx,
    employeeId: string,
    input: EmployeeSalaryInput,
    user: CurrentUserInfo,
  ): Promise<void> {
    const row = await tx.employeeSalary.create({
      data: {
        tenantId: tenantContext.requireTenantId(),
        employeeId,
        amount: input.amount,
        payType: input.payType,
        effectiveFrom: fromDay(input.effectiveFrom),
        reason: input.reason,
        createdBy: user.id,
      },
      select: { id: true },
    });
    await this.audit.log(tx, {
      action: 'EMPLOYEE_SALARY_ADDED',
      entity: 'EmployeeSalary',
      entityId: row.id,
      after: { employeeId, ...input },
    });
  }

  async ledger(id: string, query: LedgerQuery, user: CurrentUserInfo): Promise<EmployeeLedgerPage> {
    await this.access.assertReach(this.prisma.db, user, id);
    const db = this.prisma.db;
    const [balance, rows] = await Promise.all([
      db.employeeBalance.findUnique({ where: { employeeId: id } }),
      db.employeeLedgerEntry.findMany({
        where: { employeeId: id },
        orderBy: { seq: 'desc' },
        take: query.limit + 1,
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      }),
    ]);
    const page = rows.slice(0, query.limit);
    const expenseIds = page.map((r) => r.expenseId).filter((e): e is string => !!e);
    const expenses = await db.expense.findMany({
      where: { id: { in: expenseIds } },
      select: { id: true, number: true },
    });
    const numbers = new Map(expenses.map((e) => [e.id, e.number]));
    return {
      balance: toMoneyString(balance?.advanceBalance.toString() ?? '0'),
      salaryDue: toMoneyString(balance?.salaryDue.toString() ?? '0'),
      items: page.map((r) => ({
        id: r.id,
        type: r.type,
        amount: toMoneyString(r.amount.toString()),
        balanceAfter: toMoneyString(r.balanceAfter.toString()),
        expenseId: r.expenseId,
        expenseNumber: r.expenseId ? (numbers.get(r.expenseId) ?? null) : null,
        note: r.note,
        createdAt: r.createdAt.toISOString(),
      })),
      nextCursor: rows.length > query.limit ? (page.at(-1)?.id ?? null) : null,
    };
  }

  private fields(input: UpdateEmployeeInput) {
    return {
      fullName: input.fullName,
      phone: input.phone,
      position: input.position,
      warehouseId: input.warehouseId,
      userId: input.userId,
      hireDate: fromDay(input.hireDate),
      exitDate: optionalDay(input.exitDate),
      contract: input.contract,
      contractEndDate: optionalDay(input.contractEndDate),
      declared: input.declared,
      nss: input.nss,
      nin: input.nin,
      birthDate: optionalDay(input.birthDate),
      restDays: input.restDays ?? [],
    };
  }

  /** A dépôt, never a truck, in the user's reach. Required once dépôts are business units. */
  private async assertWarehouse(
    tx: Tx,
    warehouseId: string | null,
    user: CurrentUserInfo,
  ): Promise<void> {
    if (!warehouseId) {
      const { features } = await this.features.of(user.tenantId);
      if (features.includes(Feature.MULTI_UNIT)) {
        throw new AppException(ErrorCode.VALIDATION_FAILED, 'A dépôt is required', {
          issues: [{ path: 'warehouseId', message: 'required' }],
        });
      }
      return;
    }
    const w = await tx.warehouse.findFirst({
      where: { id: warehouseId, deletedAt: null, type: { not: WarehouseType.VEHICLE } },
      select: { id: true },
    });
    if (!w) throw new AppException(ErrorCode.WAREHOUSE_NOT_FOUND, 'Warehouse not found');
    await this.scope.assertWarehouse(tx, user, warehouseId);
  }

  /** One employee per user account. */
  private async assertUser(tx: Tx, userId: string | null, self: string | null): Promise<void> {
    if (!userId) return;
    const found = await tx.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { id: true },
    });
    if (!found) {
      throw new AppException(ErrorCode.VALIDATION_FAILED, 'Unknown user', {
        issues: [{ path: 'userId', message: 'unknown' }],
      });
    }
    const taken = await tx.employee.findFirst({
      where: { userId, ...(self ? { id: { not: self } } : {}) },
      select: { id: true },
    });
    if (taken) throw new AppException(ErrorCode.EMPLOYEE_USER_TAKEN, 'User already linked');
  }
}
