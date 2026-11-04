import { Injectable } from '@nestjs/common';
import {
  type ChargesCategoryRow,
  type ChargesQuery,
  type ChargesReportDto,
  type ChargesWarehouseRow,
  type DayRange,
  type ExpenseCategoryKey,
  ExpenseCategoryKey as CategoryKey,
  ExpenseStatus,
  type Money,
  money,
  rentCost,
  round2,
  spreadExpense,
  sum,
  toMoneyString,
  WarehouseType,
  ZERO,
} from '@erp/shared';
import type { CurrentUserInfo } from '../auth/auth.types';
import { type Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ScopeService } from '../sales-force/scope.service';
import { ExpenseCategoriesService } from './expense-categories.service';
import { fromDay, termsOf, toDay } from './expenses.service';

interface Cell {
  categoryId: string;
  warehouseId: string | null;
  rent: Money;
  expenses: Money;
}

/**
 * Charges of a period (phase 25): the rent charged by the contracts (by day, accrual) plus
 * every other expense spread over the period it covers (else on its date). A Loyer payment
 * linked to a contract is cash only: the contract carries the cost, so rent is never
 * counted twice. Figures are rounded once per category × dépôt cell; every total is the sum
 * of the rounded cells, so the parts always add up to the centime.
 */
@Injectable()
export class ChargesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly categories: ExpenseCategoriesService,
  ) {}

  async report(query: ChargesQuery, user: CurrentUserInfo): Promise<ChargesReportDto> {
    const db = this.prisma.db;
    const units = await this.scope.warehouses(user);
    const depots = await db.warehouse.findMany({
      select: { id: true, name: true, type: true, parentWarehouseId: true, isDefault: true },
    });
    const narrowed = this.scope.narrowWarehouses(units.statsWarehouseIds, query.warehouseId);
    // A dépôt includes its trucks (they are part of the business unit).
    const ids =
      narrowed === null
        ? null
        : [
            ...new Set([
              ...narrowed,
              ...depots
                .filter((w) => w.parentWarehouseId && narrowed.includes(w.parentWarehouseId))
                .map((w) => w.id),
            ]),
          ];
    const range: DayRange = { from: query.from, to: query.to };
    const from = fromDay(range.from);
    const to = fromDay(range.to);
    const multiUnit = await this.scope.multiUnitOn(user.tenantId);
    // A row without dépôt counts as the dépôt principal's once dépôts are business units.
    const scopeWhere = (this.scope.warehouseWhere(
      { userId: user.id, defaultWarehouseId: units.defaultWarehouseId },
      ids,
      'createdBy',
    ) ?? {}) as Prisma.ExpenseWhereInput;

    const [contracts, expenses, paid, rentCategoryId] = await Promise.all([
      db.rentContract.findMany({
        where: {
          ...(ids ? { warehouseId: { in: ids } } : {}),
          startDate: { lte: to },
          OR: [{ endDate: null }, { endDate: { gte: from } }],
        },
        select: { warehouseId: true, amount: true, period: true, startDate: true, endDate: true },
      }),
      db.expense.findMany({
        where: {
          AND: [
            scopeWhere,
            // An avance sur salaire (phase 31) is cash, not a charge: 31b counts the salary.
            { status: ExpenseStatus.VALID, rentContractId: null, employeeId: null },
            {
              OR: [
                { periodStart: null, date: { gte: from, lte: to } },
                { periodStart: { lte: to }, periodEnd: { gte: from } },
              ],
            },
          ],
        },
        select: {
          warehouseId: true,
          categoryId: true,
          amount: true,
          date: true,
          periodStart: true,
          periodEnd: true,
        },
      }),
      db.expense.findMany({
        where: {
          AND: [
            scopeWhere,
            { status: ExpenseStatus.VALID, rentContractId: { not: null } },
            { date: { gte: from, lte: to } },
          ],
        },
        select: { amount: true },
      }),
      this.categories.rentId(db),
    ]);

    const byId = new Map(depots.map((w) => [w.id, w]));
    const mainId = depots.find((w) => w.isDefault)?.id ?? null;
    /** A truck's charges are its dépôt's: the profit is per business unit. */
    const unitOf = (warehouseId: string | null): string | null => {
      const id = warehouseId ?? (multiUnit ? mainId : null);
      if (!id) return null;
      const w = byId.get(id);
      return w?.type === WarehouseType.VEHICLE && w.parentWarehouseId ? w.parentWarehouseId : id;
    };

    const cells = new Map<string, Cell>();
    const cell = (categoryId: string, warehouseId: string | null): Cell => {
      const key = `${categoryId}|${warehouseId ?? ''}`;
      let c = cells.get(key);
      if (!c) {
        c = { categoryId, warehouseId, rent: ZERO, expenses: ZERO };
        cells.set(key, c);
      }
      return c;
    };
    for (const c of contracts) {
      const target = cell(rentCategoryId, unitOf(c.warehouseId));
      target.rent = target.rent.plus(rentCost(termsOf(c), range));
    }
    for (const e of expenses) {
      const target = cell(e.categoryId, unitOf(e.warehouseId));
      target.expenses = target.expenses.plus(
        spreadExpense(
          {
            amount: e.amount.toString(),
            date: toDay(e.date),
            periodStart: e.periodStart ? toDay(e.periodStart) : null,
            periodEnd: e.periodEnd ? toDay(e.periodEnd) : null,
          },
          range,
        ),
      );
    }
    const rounded = [...cells.values()]
      .map((c) => ({ ...c, rent: round2(c.rent), expenses: round2(c.expenses) }))
      .filter((c) => !c.rent.isZero() || !c.expenses.isZero());

    const categoryRows = await db.expenseCategory.findMany({
      where: { id: { in: [...new Set(rounded.map((c) => c.categoryId))] } },
      select: { id: true, name: true, key: true },
    });
    const byCategory: ChargesCategoryRow[] = categoryRows
      .map((cat) => {
        const mine = rounded.filter((c) => c.categoryId === cat.id);
        const rent = sum(mine.map((c) => c.rent));
        const exp = sum(mine.map((c) => c.expenses));
        return {
          category: { ...cat, key: (cat.key as ExpenseCategoryKey | null) ?? null },
          rent: toMoneyString(rent),
          expenses: toMoneyString(exp),
          total: toMoneyString(rent.plus(exp)),
        };
      })
      .sort((a, b) =>
        a.category.key === CategoryKey.RENT
          ? -1
          : b.category.key === CategoryKey.RENT
            ? 1
            : money(b.total).cmp(a.total) || a.category.name.localeCompare(b.category.name),
      );

    const unitIds = [...new Set(rounded.map((c) => c.warehouseId))];
    const byWarehouse: ChargesWarehouseRow[] = unitIds
      .map((wid) => {
        const mine = rounded.filter((c) => c.warehouseId === wid);
        const rent = sum(mine.map((c) => c.rent));
        const exp = sum(mine.map((c) => c.expenses));
        const w = wid ? byId.get(wid) : undefined;
        return {
          warehouse: w ? { id: w.id, name: w.name } : null,
          rent: toMoneyString(rent),
          expenses: toMoneyString(exp),
          total: toMoneyString(rent.plus(exp)),
        };
      })
      .sort((a, b) => (a.warehouse?.name ?? '￿').localeCompare(b.warehouse?.name ?? '￿'));

    const rent = sum(rounded.map((c) => c.rent));
    const exp = sum(rounded.map((c) => c.expenses));
    return {
      from: range.from,
      to: range.to,
      warehouseId: query.warehouseId ?? null,
      rent: toMoneyString(rent),
      expenses: toMoneyString(exp),
      total: toMoneyString(rent.plus(exp)),
      rentPaid: toMoneyString(sum(paid.map((p) => p.amount.toString()))),
      byCategory,
      byWarehouse,
    };
  }
}
