import { Injectable } from '@nestjs/common';
import {
  addDays,
  changePercent,
  type DayRange,
  money,
  type Money,
  netResult,
  type OverviewDto,
  type OverviewFigures,
  type OverviewQuery,
  type OverviewWarehouse,
  Permission,
  previousPeriod,
  sharePercent,
  sum,
  toMoneyString,
  WarehouseType,
  ZERO,
} from '@erp/shared';
import type { CurrentUserInfo } from '../auth/auth.types';
import { can } from '../auth/permissions';
import { algiersRange } from '../common/algiers';
import { businessUnit } from '../common/business-unit-sql';
import { tenantContext } from '../common/tenant-context';
import { AgingService } from '../credit/aging.service';
import { ChargesService } from '../expenses/charges.service';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ScopeService } from '../sales-force/scope.service';
import { StockQueriesService } from '../stock/stock-queries.service';
import {
  algiersDayOf,
  inWarehouses,
  saleDocumentFacts,
  saleLineFacts,
  type Scope,
  within,
} from './reports-sql';

/** One dépôt's raw figures before formatting; amounts as Money. */
interface Unit {
  perDay: Map<string, { ttc: Money; count: number }>;
  previousTtc: Money;
  cashIn: Money;
  supplierPayments: Money;
  expenses: Money;
  margin: Money;
  charges: Money;
  credit: Money;
  over90: Money;
  debtors: Set<string>;
  stockValue: Money;
  lowStock: number;
  sellers: Map<string, Money>;
}

const newUnit = (): Unit => ({
  perDay: new Map(),
  previousTtc: ZERO,
  cashIn: ZERO,
  supplierPayments: ZERO,
  expenses: ZERO,
  margin: ZERO,
  charges: ZERO,
  credit: ZERO,
  over90: ZERO,
  debtors: new Set(),
  stockValue: ZERO,
  lowStock: 0,
  sellers: new Map(),
});

const dec = (v: Prisma.Decimal | null | undefined): Money => money(v?.toString() ?? '0');

/**
 * Vue d'ensemble (phase 26, MULTI_UNIT): every dépôt the user sees figures of, one card
 * each, over one period. Each measure is one SQL pass grouped by dépôt (a truck counts
 * for its dépôt, a row without dépôt for the dépôt principal), reusing the dashboard's
 * definitions: CA from `saleDocumentFacts`, margin from `saleLineFacts`, charges from
 * ChargesService, créances from the ledger per dépôt. The total is the sum of the cards;
 * only the counts of products and debtors are counted once company-wide.
 */
@Injectable()
export class OverviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scopes: ScopeService,
    private readonly charges: ChargesService,
    private readonly aging: AgingService,
    private readonly stock: StockQueriesService,
  ) {}

  async get(query: OverviewQuery, user: CurrentUserInfo): Promise<OverviewDto> {
    const tenantId = tenantContext.requireTenantId();
    const units = await this.scopes.warehouses(user);
    const reach = units.statsWarehouseIds;
    // A row without dépôt counts for the dépôt principal, also for a user who sees all.
    const mainId =
      units.defaultWarehouseId ??
      (
        await this.prisma.db.warehouse.findFirst({
          where: { isDefault: true },
          select: { id: true },
        })
      )?.id ??
      null;
    const scope: Scope = {
      tenantId,
      sellerIds: await this.scopes.figuresSellerIds(user),
      brandId: null,
      warehouseIds: reach,
      defaultWarehouseId: mainId,
    };
    const range: DayRange = { from: query.from, to: query.to };
    const previous = previousPeriod(range);
    const seesCost = can(user, Permission.VIEW_COST_AND_MARGIN);
    const withCharges = await this.scopes.expensesOn(tenantId);

    const depots = await this.prisma.db.warehouse.findMany({
      where: {
        type: { not: WarehouseType.VEHICLE },
        ...(reach ? { id: { in: reach } } : {}),
      },
      select: { id: true, name: true, isDefault: true, deletedAt: true },
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
    });
    const byUnit = new Map(depots.map((d) => [d.id, newUnit()]));
    /** Rows of a dépôt outside the cards (a truck without dépôt) are left out. */
    const at = (unitId: string | null): Unit | undefined =>
      unitId ? byUnit.get(unitId) : undefined;

    const [sales, margins, sellers, cashIn, supplierPayments, expenses, charges, credit, stock] =
      await Promise.all([
        this.salesByDay(scope, previous.from, range.to),
        seesCost ? this.margins(scope, range) : [],
        this.sellers(scope, range),
        this.cashIn(scope, range),
        this.supplierPayments(scope, range),
        this.expenses(scope, range),
        withCharges ? this.charges.report({ from: range.from, to: range.to }, user) : null,
        this.aging.clientsByUnit(mainId, reach),
        this.stock.summaryByUnit(seesCost, reach),
      ]);

    for (const r of sales) {
      const u = at(r.unitId);
      if (!u) continue;
      const ttc = dec(r.ttc);
      if (r.day >= range.from) u.perDay.set(r.day, { ttc, count: Number(r.count) });
      else u.previousTtc = u.previousTtc.plus(ttc);
    }
    for (const r of margins) {
      const u = at(r.unitId);
      if (u) u.margin = dec(r.net).minus(dec(r.cost));
    }
    for (const r of sellers) {
      const u = at(r.unitId);
      if (u && r.seller) u.sellers.set(r.seller, dec(r.ttc));
    }
    for (const r of cashIn) {
      const u = at(r.unitId);
      if (u) u.cashIn = dec(r.total);
    }
    for (const r of supplierPayments) {
      const u = at(r.unitId);
      if (u) u.supplierPayments = dec(r.total);
    }
    for (const r of expenses) {
      const u = at(r.unitId);
      if (u) u.expenses = dec(r.total);
    }
    for (const r of charges?.byWarehouse ?? []) {
      const u = at(r.warehouse?.id ?? null);
      if (u) u.charges = money(r.total);
    }
    for (const r of credit) {
      const u = at(r.unitId);
      if (!u) continue;
      u.credit = u.credit.plus(r.balance);
      u.over90 = u.over90.plus(r.over90);
      u.debtors.add(r.clientId);
    }
    for (const [unitId, s] of stock) {
      const u = at(unitId);
      if (!u) continue;
      u.stockValue = money(s.value ?? '0');
      u.lowStock = s.lowStock;
    }

    // An archived dépôt only shows when it still has figures in the period.
    const shown = depots.filter((d) => !d.deletedAt || hasFigures(byUnit.get(d.id)!));
    const names = await this.userNames(shown.map((d) => byUnit.get(d.id)!));
    const flags = { seesCost, withCharges };
    const warehouses: OverviewWarehouse[] = shown.map((d) => ({
      warehouse: { id: d.id, name: d.name, isDefault: d.isDefault },
      ...figures(byUnit.get(d.id)!, range, flags, names),
    }));

    const total = mergeUnits(shown.map((d) => byUnit.get(d.id)!));
    // Counted once: a product low in two dépôts is one product to reorder.
    total.lowStock = (await this.stock.dashboardSummary(false, reach)).lowStock;
    return {
      from: range.from,
      to: range.to,
      previousFrom: previous.from,
      previousTo: previous.to,
      total: figures(total, range, flags, names),
      warehouses,
    };
  }

  private salesByDay(scope: Scope, from: string, to: string) {
    const { start, end } = algiersRange(from, to);
    const u = businessUnit('f."warehouseId"', scope.defaultWarehouseId ?? null);
    return this.prisma.db.$queryRaw<
      { unitId: string | null; day: string; ttc: Prisma.Decimal; count: bigint }[]
    >`
      SELECT ${u.unit} AS "unitId", ${algiersDayOf('f.at')} AS day,
             SUM(f.ttc - f."retTtc") AS ttc, SUM(f.docs) AS count
      FROM (${saleDocumentFacts(scope, start, end)}) f ${u.join}
      GROUP BY 1, 2`;
  }

  private margins(scope: Scope, range: DayRange) {
    const { start, end } = algiersRange(range.from, range.to);
    const u = businessUnit('f."warehouseId"', scope.defaultWarehouseId ?? null);
    return this.prisma.db.$queryRaw<
      { unitId: string | null; net: Prisma.Decimal | null; cost: Prisma.Decimal | null }[]
    >`
      SELECT ${u.unit} AS "unitId", SUM(f.ht - f."retHt") AS net, SUM(f.cost) AS cost
      FROM (${saleLineFacts(scope, start, end)}) f ${u.join}
      GROUP BY 1`;
  }

  private sellers(scope: Scope, range: DayRange) {
    const { start, end } = algiersRange(range.from, range.to);
    const u = businessUnit('f."warehouseId"', scope.defaultWarehouseId ?? null);
    return this.prisma.db.$queryRaw<
      { unitId: string | null; seller: string | null; ttc: Prisma.Decimal }[]
    >`
      SELECT ${u.unit} AS "unitId", f.seller, SUM(f.ttc - f."retTtc") AS ttc
      FROM (${saleDocumentFacts(scope, start, end)}) f ${u.join}
      GROUP BY 1, 2`;
  }

  /** Versements received, as in the payments report. */
  private cashIn(scope: Scope, range: DayRange) {
    const { start, end } = algiersRange(range.from, range.to);
    const u = businessUnit('py."warehouseId"', scope.defaultWarehouseId ?? null);
    return this.prisma.db.$queryRaw<{ unitId: string | null; total: Prisma.Decimal }[]>`
      SELECT ${u.unit} AS "unitId", SUM(py.amount) AS total
      FROM payments py ${u.join}
      WHERE py."tenantId" = ${scope.tenantId}::uuid AND py.status = 'VALID'
        AND ${within('py."receivedAt"', start, end)} ${inWarehouses(scope, 'py')}
      GROUP BY 1`;
  }

  /** Règlements fournisseur paid (phase 21), by the dépôt that paid (phase 26). */
  private supplierPayments(scope: Scope, range: DayRange) {
    const { start, end } = algiersRange(range.from, range.to);
    const u = businessUnit('sp."warehouseId"', scope.defaultWarehouseId ?? null);
    return this.prisma.db.$queryRaw<{ unitId: string | null; total: Prisma.Decimal }[]>`
      SELECT ${u.unit} AS "unitId", SUM(sp.amount) AS total
      FROM supplier_payments sp ${u.join}
      WHERE sp."tenantId" = ${scope.tenantId}::uuid AND sp.status = 'VALID'
        AND ${within('sp."paidAt"', start, end)} ${inWarehouses(scope, 'sp')}
      GROUP BY 1`;
  }

  /** Dépenses paid on a day of the period, rent payments included: cash, not cost. */
  private expenses(scope: Scope, range: DayRange) {
    const u = businessUnit('e."warehouseId"', scope.defaultWarehouseId ?? null);
    return this.prisma.db.$queryRaw<{ unitId: string | null; total: Prisma.Decimal }[]>`
      SELECT ${u.unit} AS "unitId", SUM(e.amount) AS total
      FROM expenses e ${u.join}
      WHERE e."tenantId" = ${scope.tenantId}::uuid AND e.status = 'VALID'
        AND e.date >= ${range.from}::date AND e.date <= ${range.to}::date
        ${inWarehouses(scope, 'e')}
      GROUP BY 1`;
  }

  private async userNames(units: Unit[]): Promise<Map<string, string>> {
    const ids = [...new Set(units.flatMap((u) => [...u.sellers.keys()]))];
    if (ids.length === 0) return new Map();
    const users = await this.prisma.db.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, fullName: true },
    });
    return new Map(users.map((u) => [u.id, u.fullName]));
  }
}

function hasFigures(u: Unit): boolean {
  return (
    u.perDay.size > 0 ||
    !u.previousTtc.isZero() ||
    !u.cashIn.isZero() ||
    !u.supplierPayments.isZero() ||
    !u.expenses.isZero() ||
    !u.charges.isZero() ||
    !u.credit.isZero()
  );
}

/** The sum of the cards. */
function mergeUnits(units: Unit[]): Unit {
  const t = newUnit();
  for (const u of units) {
    for (const [day, v] of u.perDay) {
      const d = t.perDay.get(day) ?? { ttc: ZERO, count: 0 };
      t.perDay.set(day, { ttc: d.ttc.plus(v.ttc), count: d.count + v.count });
    }
    t.previousTtc = t.previousTtc.plus(u.previousTtc);
    t.cashIn = t.cashIn.plus(u.cashIn);
    t.supplierPayments = t.supplierPayments.plus(u.supplierPayments);
    t.expenses = t.expenses.plus(u.expenses);
    t.margin = t.margin.plus(u.margin);
    t.charges = t.charges.plus(u.charges);
    t.credit = t.credit.plus(u.credit);
    t.over90 = t.over90.plus(u.over90);
    for (const c of u.debtors) t.debtors.add(c);
    t.stockValue = t.stockValue.plus(u.stockValue);
    for (const [seller, ttc] of u.sellers) {
      t.sellers.set(seller, (t.sellers.get(seller) ?? ZERO).plus(ttc));
    }
  }
  return t;
}

function figures(
  u: Unit,
  range: DayRange,
  flags: { seesCost: boolean; withCharges: boolean },
  names: Map<string, string>,
): OverviewFigures {
  const perDay: { date: string; ttc: string }[] = [];
  let count = 0;
  for (let day = range.from; day <= range.to; day = addDays(day, 1)) {
    const v = u.perDay.get(day);
    count += v?.count ?? 0;
    perDay.push({ date: day, ttc: toMoneyString(v?.ttc ?? 0) });
  }
  const ttc = sum([...u.perDay.values()].map((v) => v.ttc));
  const cashOut = u.supplierPayments.plus(u.expenses);
  const margin = flags.seesCost ? toMoneyString(u.margin) : null;
  const charges = flags.withCharges ? toMoneyString(u.charges) : null;
  // Highest CA wins; a tie goes to the name, so the card never flickers between two.
  let top: { id: string; fullName: string; ttc: Money } | null = null;
  for (const [id, v] of u.sellers) {
    const fullName = names.get(id) ?? '';
    if (v.lte(0)) continue;
    if (!top || v.gt(top.ttc) || (v.eq(top.ttc) && fullName.localeCompare(top.fullName) < 0)) {
      top = { id, fullName, ttc: v };
    }
  }
  return {
    sales: {
      ttc: toMoneyString(ttc),
      count,
      previousTtc: toMoneyString(u.previousTtc),
      changePct: changePercent(ttc, u.previousTtc),
      perDay,
    },
    cashIn: toMoneyString(u.cashIn),
    cashOut: {
      supplierPayments: toMoneyString(u.supplierPayments),
      expenses: toMoneyString(u.expenses),
      total: toMoneyString(cashOut),
    },
    netCash: toMoneyString(u.cashIn.minus(cashOut)),
    margin,
    charges,
    netResult: netResult(margin, charges),
    credit: {
      total: toMoneyString(u.credit),
      over90: toMoneyString(u.over90),
      over90Pct: sharePercent(u.over90, u.credit),
      debtorCount: u.debtors.size,
    },
    stock: { value: flags.seesCost ? toMoneyString(u.stockValue) : null, lowStock: u.lowStock },
    topSeller: top ? { id: top.id, fullName: top.fullName, ttc: toMoneyString(top.ttc) } : null,
  };
}
