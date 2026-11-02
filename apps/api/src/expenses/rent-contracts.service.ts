import { Injectable } from '@nestjs/common';
import {
  algiersDay,
  type CreateRentContractInput,
  ErrorCode,
  ExpenseStatus,
  type RentContractDto,
  type RentContractListQuery,
  rentSchedule,
  type RentScheduleDto,
  toMoneyString,
  type UpdateRentContractInput,
  WarehouseType,
} from '@erp/shared';
import { AuditService } from '../audit/audit.service';
import type { CurrentUserInfo } from '../auth/auth.types';
import { AppException } from '../common/app-exception';
import { tenantContext } from '../common/tenant-context';
import { type Prisma } from '../generated/prisma/client';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import { ScopeService } from '../sales-force/scope.service';
import { WarehousesService } from '../stock/warehouses.service';
import { ExpensesService, fromDay, termsOf, toDay } from './expenses.service';

const contractInclude = {
  warehouse: { select: { id: true, name: true } },
  payments: {
    where: { status: ExpenseStatus.VALID, periodStart: { not: null } },
    select: {
      id: true,
      number: true,
      date: true,
      amount: true,
      periodStart: true,
      periodEnd: true,
    },
    orderBy: { periodStart: 'asc' },
  },
} satisfies Prisma.RentContractInclude;
type ContractRow = Prisma.RentContractGetPayload<{ include: typeof contractInclude }>;

function paidPeriods(c: ContractRow) {
  return c.payments.map((p) => ({
    periodStart: toDay(p.periodStart!),
    periodEnd: toDay(p.periodEnd!),
  }));
}

function toDto(c: ContractRow, today: string): RentContractDto {
  const terms = termsOf(c);
  const s = rentSchedule(terms, paidPeriods(c), today);
  return {
    id: c.id,
    warehouse: c.warehouse,
    landlordName: c.landlordName,
    landlordPhone: c.landlordPhone,
    amount: toMoneyString(c.amount.toString()),
    period: c.period,
    startDate: terms.startDate,
    endDate: terms.endDate,
    note: c.note,
    locked: c.payments.length > 0,
    ended: terms.endDate !== null && terms.endDate < today,
    paidUntil: s.paidUntil,
    nextDueDate: s.nextDueDate,
    amountDue: toMoneyString(s.amountDue),
    alerts: s.alerts,
    createdAt: c.createdAt.toISOString(),
  };
}

/**
 * Baux (phase 25). A contract is never edited after its first valid payment, and never
 * deleted: a new rent closes it (endDate) and opens a new one, so past months keep their
 * cost. Payments are expenses (ExpensesService); the cost is computed from the terms.
 */
@Injectable()
export class RentContractsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly scope: ScopeService,
    private readonly warehouses: WarehousesService,
    private readonly expenses: ExpensesService,
  ) {}

  async list(query: RentContractListQuery, user: CurrentUserInfo): Promise<RentContractDto[]> {
    const { warehouseIds } = await this.scope.warehouses(user);
    const ids = this.scope.narrowWarehouses(warehouseIds, query.warehouseId);
    const today = algiersDay();
    const rows = await this.prisma.db.rentContract.findMany({
      where: {
        ...(ids ? { warehouseId: { in: ids } } : {}),
        ...(query.current ? { OR: [{ endDate: null }, { endDate: { gte: fromDay(today) } }] } : {}),
      },
      include: contractInclude,
      orderBy: [{ startDate: 'desc' }, { id: 'desc' }],
    });
    return rows.map((c) => toDto(c, today));
  }

  async get(id: string, user: CurrentUserInfo): Promise<RentContractDto> {
    return toDto(await this.find(id, user), algiersDay());
  }

  async schedule(id: string, user: CurrentUserInfo): Promise<RentScheduleDto> {
    const c = await this.find(id, user);
    const today = algiersDay();
    const s = rentSchedule(termsOf(c), paidPeriods(c), today);
    return {
      contract: toDto(c, today),
      slots: s.slots.map((slot) => ({
        start: slot.start,
        end: slot.end,
        days: slot.days,
        amount: toMoneyString(slot.amount),
        status: slot.status,
      })),
      payments: c.payments.map((p) => ({
        id: p.id,
        number: p.number,
        date: toDay(p.date),
        amount: toMoneyString(p.amount.toString()),
        periodStart: toDay(p.periodStart!),
        periodEnd: toDay(p.periodEnd!),
      })),
    };
  }

  async create(input: CreateRentContractInput, user: CurrentUserInfo): Promise<RentContractDto> {
    const id = await this.prisma.db.$transaction(async (tx) => {
      const warehouseId = await this.depot(tx, input.warehouseId, user);
      const c = await tx.rentContract.create({
        data: {
          tenantId: tenantContext.requireTenantId(),
          warehouseId,
          ...this.terms(input),
          createdBy: user.id,
        },
      });
      await this.audit.log(tx, {
        action: 'RENT_CONTRACT_CREATED',
        entity: 'RentContract',
        entityId: c.id,
        after: { warehouseId, ...this.auditTerms(input) },
      });
      return c.id;
    });
    return this.get(id, user);
  }

  /** Only while no valid payment exists: after one, close it and open a new contract. */
  async update(
    id: string,
    input: UpdateRentContractInput,
    user: CurrentUserInfo,
  ): Promise<RentContractDto> {
    await this.prisma.db.$transaction(async (tx) => {
      const before = await this.expenses.lockContract(tx, id);
      await this.scope.assertWarehouse(tx, user, before.warehouseId);
      if (before.closedAt) {
        throw new AppException(ErrorCode.RENT_CONTRACT_CLOSED, 'This contract is closed');
      }
      if (await this.hasPayment(tx, id)) {
        throw new AppException(
          ErrorCode.RENT_CONTRACT_LOCKED,
          'A paid contract is not edited: close it and open a new one',
        );
      }
      const warehouseId = await this.depot(tx, input.warehouseId ?? before.warehouseId, user);
      await tx.rentContract.update({
        where: { id },
        data: { warehouseId, ...this.terms(input), version: { increment: 1 } },
      });
      await this.audit.log(tx, {
        action: 'RENT_CONTRACT_UPDATED',
        entity: 'RentContract',
        entityId: id,
        before: { warehouseId: before.warehouseId, ...this.auditTerms(termsOf(before)) },
        after: { warehouseId, ...this.auditTerms(input) },
      });
    });
    return this.get(id, user);
  }

  /** Ends the contract on `endDate` (included). Never before what is already paid. */
  async close(id: string, endDate: string, user: CurrentUserInfo): Promise<RentContractDto> {
    await this.prisma.db.$transaction(async (tx) => {
      const c = await this.expenses.lockContract(tx, id);
      await this.scope.assertWarehouse(tx, user, c.warehouseId);
      if (c.closedAt) {
        throw new AppException(ErrorCode.RENT_CONTRACT_CLOSED, 'This contract is closed');
      }
      const start = toDay(c.startDate);
      if (endDate < start) {
        throw new AppException(ErrorCode.VALIDATION_FAILED, 'The end is before the start', {
          field: 'endDate',
        });
      }
      const lastPaid = await tx.expense.findFirst({
        where: { rentContractId: id, status: ExpenseStatus.VALID },
        orderBy: { periodEnd: 'desc' },
        select: { periodEnd: true },
      });
      const paidUntil = lastPaid?.periodEnd ? toDay(lastPaid.periodEnd) : null;
      if (paidUntil && endDate < paidUntil) {
        throw new AppException(
          ErrorCode.RENT_PERIOD_INVALID,
          'The contract is paid beyond this date',
          { rule: 'paid_beyond', paidUntil },
        );
      }
      await tx.rentContract.update({
        where: { id },
        data: {
          endDate: fromDay(endDate),
          closedAt: new Date(),
          closedBy: user.id,
          version: { increment: 1 },
        },
      });
      await this.audit.log(tx, {
        action: 'RENT_CONTRACT_CLOSED',
        entity: 'RentContract',
        entityId: id,
        before: { endDate: c.endDate ? toDay(c.endDate) : null },
        after: { endDate },
      });
    });
    return this.get(id, user);
  }

  private async find(id: string, user: CurrentUserInfo): Promise<ContractRow> {
    const { warehouseIds } = await this.scope.warehouses(user);
    const c = await this.prisma.db.rentContract.findFirst({
      where: { id, ...(warehouseIds ? { warehouseId: { in: warehouseIds } } : {}) },
      include: contractInclude,
    });
    if (!c) throw new AppException(ErrorCode.NOT_FOUND, 'Rent contract not found');
    return c;
  }

  private async hasPayment(tx: Tx, id: string): Promise<boolean> {
    const n = await tx.expense.count({
      where: { rentContractId: id, status: ExpenseStatus.VALID },
    });
    return n > 0;
  }

  /** A dépôt (never a truck) the user works in; the dépôt principal by default. */
  private async depot(
    tx: Tx,
    requested: string | null | undefined,
    user: CurrentUserInfo,
  ): Promise<string> {
    const id = await this.warehouses.resolve(tx, requested);
    const w = await tx.warehouse.findUniqueOrThrow({ where: { id }, select: { type: true } });
    if (w.type === WarehouseType.VEHICLE) {
      throw new AppException(ErrorCode.WAREHOUSE_INVALID, 'A truck has no rent', {
        rule: 'vehicle',
      });
    }
    await this.scope.assertWarehouse(tx, user, id);
    return id;
  }

  private terms(input: CreateRentContractInput) {
    return {
      landlordName: input.landlordName,
      landlordPhone: input.landlordPhone,
      amount: input.amount,
      period: input.period,
      startDate: fromDay(input.startDate),
      endDate: input.endDate ? fromDay(input.endDate) : null,
      note: input.note,
    };
  }

  private auditTerms(t: {
    amount: string;
    period: string;
    startDate: string;
    endDate?: string | null;
  }) {
    return {
      amount: t.amount,
      period: t.period,
      startDate: t.startDate,
      endDate: t.endDate ?? null,
    };
  }
}
