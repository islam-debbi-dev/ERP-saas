import { Injectable } from '@nestjs/common';
import {
  type EmployeePayItemDto,
  type EmployeePayItemInput,
  ErrorCode,
  type PayItemMode,
  PayItemMode as Mode,
  type PayItemTypeDto,
  type PayItemTypeInput,
  type PayrollSettingsDto,
  type PayrollSettingsInput,
  toMoneyString,
} from '@erp/shared';
import { AuditService } from '../audit/audit.service';
import type { CurrentUserInfo } from '../auth/auth.types';
import { AppException } from '../common/app-exception';
import { tenantContext } from '../common/tenant-context';
import { EmployeeAccessService } from '../hr/employee-access.service';
import { fromDay, toDay } from '../hr/attendance-days.service';
import { PrismaService, type Tx } from '../prisma/prisma.service';

type Db = PrismaService['db'] | Tx;

/** The list a company starts with. Keys stay; names and flags are the tenant's to change. */
const SEEDED_TYPES: readonly {
  key: string;
  name: string;
  cotisable: boolean;
  imposable: boolean;
  mode: PayItemMode;
}[] = [
  {
    key: 'RENDEMENT',
    name: 'Prime de rendement',
    cotisable: true,
    imposable: true,
    mode: Mode.FIXED,
  },
  { key: 'PANIER', name: 'Panier', cotisable: false, imposable: true, mode: Mode.PER_DAY },
  { key: 'TRANSPORT', name: 'Transport', cotisable: false, imposable: true, mode: Mode.PER_DAY },
  {
    key: 'EXCEPTIONNELLE',
    name: 'Prime exceptionnelle',
    cotisable: true,
    imposable: true,
    mode: Mode.FIXED,
  },
];

/** Payroll settings, the primes list and each employee's recurring primes (phase 31b). */
@Injectable()
export class PayrollSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: EmployeeAccessService,
  ) {}

  async get(db: Db = this.prisma.db): Promise<PayrollSettingsDto> {
    const t = await db.tenant.findUniqueOrThrow({
      where: { id: tenantContext.requireTenantId() },
      select: {
        payrollDayDivisor: true,
        payrollHourDivisor: true,
        payrollOvertimeRate: true,
        payrollDeductLateness: true,
        hrDailyHours: true,
      },
    });
    return {
      dayDivisor: t.payrollDayDivisor as PayrollSettingsDto['dayDivisor'],
      hourDivisor: t.payrollHourDivisor.toFixed(2),
      overtimeRate: t.payrollOvertimeRate.toFixed(2),
      deductLateness: t.payrollDeductLateness,
      dailyHours: t.hrDailyHours,
    };
  }

  async update(input: PayrollSettingsInput): Promise<PayrollSettingsDto> {
    return this.prisma.db.$transaction(async (tx) => {
      const before = await this.get(tx);
      await tx.tenant.update({
        where: { id: tenantContext.requireTenantId() },
        data: {
          payrollDayDivisor: input.dayDivisor,
          payrollHourDivisor: input.hourDivisor,
          payrollOvertimeRate: input.overtimeRate,
          payrollDeductLateness: input.deductLateness,
        },
      });
      await this.audit.log(tx, {
        action: 'PAYROLL_SETTINGS_UPDATED',
        entity: 'Tenant',
        entityId: tenantContext.requireTenantId(),
        before,
        after: input,
      });
      return this.get(tx);
    });
  }

  /** Seeds the list once; `skipDuplicates` keeps two first calls safe. */
  async ensureTypes(db: Db): Promise<void> {
    const tenantId = tenantContext.requireTenantId();
    const found = await db.payItemType.count({ where: { key: { not: null } } });
    if (found > 0) return;
    await db.payItemType.createMany({
      data: SEEDED_TYPES.map((t) => ({ ...t, tenantId })),
      skipDuplicates: true,
    });
  }

  async types(): Promise<PayItemTypeDto[]> {
    await this.ensureTypes(this.prisma.db);
    const rows = await this.prisma.db.payItemType.findMany({
      where: { deletedAt: null },
      orderBy: [{ createdAt: 'asc' }, { name: 'asc' }],
    });
    return rows.map(toTypeDto);
  }

  async createType(input: PayItemTypeInput): Promise<PayItemTypeDto> {
    return this.prisma.db.$transaction(async (tx) => {
      const row = await tx.payItemType.create({
        data: { ...input, tenantId: tenantContext.requireTenantId() },
      });
      await this.audit.log(tx, {
        action: 'PAY_ITEM_TYPE_CREATED',
        entity: 'PayItemType',
        entityId: row.id,
        after: input,
      });
      return toTypeDto(row);
    });
  }

  async updateType(id: string, input: PayItemTypeInput): Promise<PayItemTypeDto> {
    return this.prisma.db.$transaction(async (tx) => {
      const before = await this.liveType(tx, id);
      const row = await tx.payItemType.update({ where: { id }, data: input });
      await this.audit.log(tx, {
        action: 'PAY_ITEM_TYPE_UPDATED',
        entity: 'PayItemType',
        entityId: id,
        before: toTypeDto(before),
        after: input,
      });
      return toTypeDto(row);
    });
  }

  async archiveType(id: string): Promise<void> {
    await this.prisma.db.$transaction(async (tx) => {
      await this.liveType(tx, id);
      await tx.payItemType.update({ where: { id }, data: { deletedAt: new Date() } });
      await this.audit.log(tx, {
        action: 'PAY_ITEM_TYPE_ARCHIVED',
        entity: 'PayItemType',
        entityId: id,
      });
    });
  }

  async liveType(db: Db, id: string) {
    const row = await db.payItemType.findFirst({ where: { id, deletedAt: null } });
    if (!row) throw new AppException(ErrorCode.NOT_FOUND, 'Pay item type not found');
    return row;
  }

  async employeeItems(employeeId: string, user: CurrentUserInfo): Promise<EmployeePayItemDto[]> {
    await this.access.assertReach(this.prisma.db, user, employeeId);
    return this.itemsOf(this.prisma.db, employeeId);
  }

  async appendEmployeeItem(
    employeeId: string,
    input: EmployeePayItemInput,
    user: CurrentUserInfo,
  ): Promise<EmployeePayItemDto[]> {
    return this.prisma.db.$transaction(async (tx) => {
      await this.access.assertReach(tx, user, employeeId);
      await this.liveType(tx, input.typeId);
      const row = await tx.employeePayItem.create({
        data: {
          tenantId: tenantContext.requireTenantId(),
          employeeId,
          typeId: input.typeId,
          amount: input.amount,
          effectiveFrom: fromDay(input.effectiveFrom),
          createdBy: user.id,
        },
      });
      await this.audit.log(tx, {
        action: 'EMPLOYEE_PAY_ITEM_ADDED',
        entity: 'EmployeePayItem',
        entityId: row.id,
        after: { employeeId, ...input },
      });
      return this.itemsOf(tx, employeeId);
    });
  }

  private async itemsOf(db: Db, employeeId: string): Promise<EmployeePayItemDto[]> {
    const rows = await db.employeePayItem.findMany({
      where: { employeeId },
      orderBy: { seq: 'desc' },
      include: { type: { select: { name: true, mode: true } } },
    });
    return rows.map((r) => ({
      id: r.id,
      typeId: r.typeId,
      typeName: r.type.name,
      amount: toMoneyString(r.amount.toString()),
      effectiveFrom: toDay(r.effectiveFrom),
      mode: r.type.mode,
    }));
  }
}

function toTypeDto(r: {
  id: string;
  key: string | null;
  name: string;
  cotisable: boolean;
  imposable: boolean;
  mode: PayItemMode;
}): PayItemTypeDto {
  return {
    id: r.id,
    key: r.key,
    name: r.name,
    cotisable: r.cotisable,
    imposable: r.imposable,
    mode: r.mode,
  };
}
