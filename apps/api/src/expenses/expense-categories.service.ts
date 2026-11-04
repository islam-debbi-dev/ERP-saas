import { Injectable } from '@nestjs/common';
import {
  DEFAULT_EXPENSE_CATEGORIES,
  type ExpenseCategoryDto,
  type ExpenseCategoryInput,
  ExpenseCategoryKey,
  ErrorCode,
} from '@erp/shared';
import { AuditService } from '../audit/audit.service';
import { AppException } from '../common/app-exception';
import { tenantContext } from '../common/tenant-context';
import { PrismaService, type Tx } from '../prisma/prisma.service';

type Db = PrismaService['db'] | Tx;

function toDto(c: {
  id: string;
  name: string;
  key: string | null;
  deletedAt: Date | null;
}): ExpenseCategoryDto {
  return {
    id: c.id,
    name: c.name,
    key: (c.key as ExpenseCategoryKey | null) ?? null,
    archived: c.deletedAt !== null,
  };
}

/** Charge categories (phase 25): master data, soft delete. Loyer (`RENT`) is never archived. */
@Injectable()
export class ExpenseCategoriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(includeArchived = false): Promise<ExpenseCategoryDto[]> {
    const rows = await this.prisma.db.expenseCategory.findMany({
      where: includeArchived ? {} : { deletedAt: null },
      orderBy: [{ deletedAt: { sort: 'asc', nulls: 'first' } }, { createdAt: 'asc' }],
    });
    // The seeded categories share one createdAt (one insert): keep them in seed order,
    // then by name, so the list is the same on every call.
    const seed = (key: string | null) => {
      const i = DEFAULT_EXPENSE_CATEGORIES.findIndex((c) => c.key === key);
      return i === -1 ? DEFAULT_EXPENSE_CATEGORIES.length : i;
    };
    return rows
      .map((r, i) => ({ r, i }))
      .sort(
        (a, b) =>
          Number(a.r.deletedAt !== null) - Number(b.r.deletedAt !== null) ||
          a.r.createdAt.getTime() - b.r.createdAt.getTime() ||
          seed(a.r.key) - seed(b.r.key) ||
          a.r.name.localeCompare(b.r.name) ||
          a.i - b.i,
      )
      .map(({ r }) => toDto(r));
  }

  /** The Loyer category, created again if a very old company lost it. */
  rentId(db: Db): Promise<string> {
    return this.seededId(db, ExpenseCategoryKey.RENT, 'Loyer');
  }

  /** The Salaires category avances go to (phase 31), even if the owner archived it. */
  salariesId(db: Db): Promise<string> {
    return this.seededId(db, ExpenseCategoryKey.SALARIES, 'Salaires');
  }

  private async seededId(db: Db, key: ExpenseCategoryKey, name: string): Promise<string> {
    const found = await db.expenseCategory.findFirst({ where: { key }, select: { id: true } });
    if (found) return found.id;
    const created = await db.expenseCategory.create({
      data: { tenantId: tenantContext.requireTenantId(), name, key },
      select: { id: true },
    });
    return created.id;
  }

  async create(input: ExpenseCategoryInput): Promise<ExpenseCategoryDto> {
    return this.prisma.db.$transaction(async (tx) => {
      await this.assertNameFree(tx, input.name);
      const row = await tx.expenseCategory.create({
        data: { tenantId: tenantContext.requireTenantId(), name: input.name },
      });
      await this.audit.log(tx, {
        action: 'EXPENSE_CATEGORY_CREATED',
        entity: 'ExpenseCategory',
        entityId: row.id,
        after: { name: row.name },
      });
      return toDto(row);
    });
  }

  async rename(id: string, input: ExpenseCategoryInput): Promise<ExpenseCategoryDto> {
    return this.prisma.db.$transaction(async (tx) => {
      const before = await this.find(tx, id);
      await this.assertNameFree(tx, input.name, id);
      const row = await tx.expenseCategory.update({ where: { id }, data: { name: input.name } });
      await this.audit.log(tx, {
        action: 'EXPENSE_CATEGORY_UPDATED',
        entity: 'ExpenseCategory',
        entityId: id,
        before: { name: before.name },
        after: { name: row.name },
      });
      return toDto(row);
    });
  }

  async archive(id: string): Promise<void> {
    await this.prisma.db.$transaction(async (tx) => {
      const before = await this.find(tx, id);
      if (before.key === ExpenseCategoryKey.RENT) {
        throw new AppException(
          ErrorCode.EXPENSE_CATEGORY_PROTECTED,
          'The Loyer category is used by rent payments',
        );
      }
      if (before.deletedAt) return;
      await tx.expenseCategory.update({ where: { id }, data: { deletedAt: new Date() } });
      await this.audit.log(tx, {
        action: 'EXPENSE_CATEGORY_ARCHIVED',
        entity: 'ExpenseCategory',
        entityId: id,
        before: { name: before.name },
      });
    });
  }

  async restore(id: string): Promise<ExpenseCategoryDto> {
    return this.prisma.db.$transaction(async (tx) => {
      const before = await this.find(tx, id);
      await this.assertNameFree(tx, before.name, id);
      const row = await tx.expenseCategory.update({ where: { id }, data: { deletedAt: null } });
      await this.audit.log(tx, {
        action: 'EXPENSE_CATEGORY_RESTORED',
        entity: 'ExpenseCategory',
        entityId: id,
      });
      return toDto(row);
    });
  }

  private async find(tx: Tx, id: string) {
    const row = await tx.expenseCategory.findUnique({ where: { id } });
    if (!row) throw new AppException(ErrorCode.NOT_FOUND, 'Expense category not found');
    return row;
  }

  private async assertNameFree(tx: Tx, name: string, exceptId?: string): Promise<void> {
    const taken = await tx.expenseCategory.findFirst({
      where: {
        name: { equals: name, mode: 'insensitive' },
        deletedAt: null,
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      select: { id: true },
    });
    if (taken) {
      throw new AppException(ErrorCode.EXPENSE_CATEGORY_NAME_TAKEN, 'This category exists', {
        field: 'name',
      });
    }
  }
}
