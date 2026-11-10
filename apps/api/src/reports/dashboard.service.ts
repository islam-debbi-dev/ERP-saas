import { Injectable } from '@nestjs/common';
import {
  addDays,
  algiersDay,
  changePercent,
  chartBuckets,
  type DashboardDto,
  type DashboardPeriod,
  type DashboardPeriodRange,
  type DashboardTopDto,
  pickGreetingFact,
  salesTargetProgress,
  monthToDate,
  money,
  type Money,
  netResult,
  Permission,
  previousBucket,
  previousMonthToDate,
  qty,
  resolveDashboardPeriod,
  Role,
  type SalesFigure,
  toMoneyString,
} from '@erp/shared';
import type { CurrentUserInfo } from '../auth/auth.types';
import { can } from '../auth/permissions';
import { ClientsService } from '../clients/clients.service';
import { algiersRange } from '../common/algiers';
import { AgingService } from '../credit/aging.service';
import { ChargesService } from '../expenses/charges.service';
import { tenantContext } from '../common/tenant-context';
import { Prisma } from '../generated/prisma/client';
import { PaymentsService } from '../payments/payments.service';
import { PrismaService } from '../prisma/prisma.service';
import { ScopeService } from '../sales-force/scope.service';
import { StockQueriesService } from '../stock/stock-queries.service';
import { TreasuryService } from '../treasury/treasury.service';
import { algiersDayOf, saleDocumentFacts, saleLineFacts, type Scope } from './reports-sql';

const TOP_DEBTORS = 10;
/** Rows of each top list (phase 33). */
const TOP_ROWS = 5;
/** "Clients qui n'achètent plus": nothing in the last 30 days, something in the 90 before. */
const DORMANT_RECENT_DAYS = 30;
const DORMANT_BEFORE_DAYS = 90;

const MANAGERS: readonly Role[] = [Role.OWNER, Role.MANAGER];

function seesSalesFigures(user: CurrentUserInfo): boolean {
  return MANAGERS.includes(user.role) || user.role === Role.SELLER || user.role === Role.SUPERVISOR;
}

interface DayTotals {
  ttc: Money;
  count: number;
}

@Injectable()
export class DashboardService {
  constructor(
    private readonly treasury: TreasuryService,
    private readonly prisma: PrismaService,
    private readonly clients: ClientsService,
    private readonly payments: PaymentsService,
    private readonly stock: StockQueriesService,
    private readonly aging: AgingService,
    private readonly scopes: ScopeService,
    private readonly charges: ChargesService,
  ) {}

  /**
   * What the owner sees in 5 seconds. Sections the role does not see are null:
   * a seller sees his own sales only, a supervisor his team's, a storekeeper the stock only.
   * The seller / team / brand filters (phase 14) narrow the sales figures only; cash,
   * credit and stock stay company-wide.
   */
  async get(
    user: CurrentUserInfo,
    filters: {
      date?: string;
      sellerId?: string;
      teamOf?: string;
      brandId?: string;
      warehouseId?: string;
      period?: DashboardPeriod;
      from?: string;
      to?: string;
    } = {},
  ): Promise<DashboardDto> {
    const date = filters.date ?? algiersDay();
    // Phase 33: the period of the figures and the chart (validated by the query schema).
    const range = resolveDashboardPeriod(
      filters.period ?? 'month',
      date,
      filters.from && filters.to ? { from: filters.from, to: filters.to } : undefined,
    );
    const manager = MANAGERS.includes(user.role);
    const seesSales = seesSalesFigures(user);
    const seesStock = manager || user.role === Role.STOREKEEPER;
    const { scope, units, warehouseIds } = await this.figureScope(user, filters);
    const seesCost = can(user, Permission.VIEW_COST_AND_MARGIN);
    const byUnit = warehouseIds
      ? this.clients.creditInWarehouses(warehouseIds, units.defaultWarehouseId, TOP_DEBTORS)
      : null;
    const cashFor = manager ? { user, warehouseIds } : null;
    const [sales, cash, credit, debtors, stock, cheques, top] = await Promise.all([
      seesSales ? this.sales(scope, date, seesCost, range, cashFor) : null,
      manager ? this.payments.summary(date, user, warehouseIds) : null,
      manager ? (byUnit ?? this.clients.creditSummary(TOP_DEBTORS)) : null,
      manager
        ? byUnit
          ? byUnit.then((c) => c.topDebtors)
          : this.clients.debtors(TOP_DEBTORS)
        : null,
      seesStock ? this.stock.dashboardSummary(seesCost, warehouseIds) : null,
      manager ? this.aging.dueCheques(date) : null,
      seesSales ? this.top(scope, range, date) : null,
    ]);
    // Phase 26: résultat net of the period = marge − charges (phase 25), same dépôts.
    const margin = sales?.margin ?? null;
    const charges =
      manager && margin !== null && (await this.scopes.expensesOn(scope.tenantId))
        ? await this.charges.report(
            { from: range.from, to: range.to, warehouseId: filters.warehouseId },
            user,
          )
        : null;
    const result = charges ? netResult(margin, charges.total) : null;
    const treasury = (await this.scopes.treasuryOn(scope.tenantId))
      ? await this.treasury.balancesFor(user, warehouseIds, await this.mainId(units))
      : null;
    const filtered = Boolean(filters.sellerId || filters.teamOf || filters.brandId);
    const goal =
      manager && sales && !filtered
        ? (
            await this.prisma.db.tenant.findUnique({
              where: { id: scope.tenantId },
              select: { monthlySalesTarget: true },
            })
          )?.monthlySalesTarget
        : null;
    const greeting = pickGreetingFact({
      chequesDueToday: cheques
        ? cheques.client.items.filter((c) => c.dueDate === date).length
        : null,
      monthDays: sales?.perDay ?? [],
      today: date,
      monthChangePct: sales ? changePercent(sales.month.ttc, sales.previousMonth.ttc) : null,
      overLimitCount: credit?.overLimitCount ?? null,
    });
    return {
      date,
      target: goal && sales ? salesTargetProgress(goal.toString(), sales.month.ttc, date) : null,
      greeting,
      sales,
      cash: cash ? { total: cash.total, byMode: cash.byMode } : null,
      treasury,
      credit:
        credit && debtors
          ? {
              total: credit.total,
              debtorCount: credit.debtorCount,
              topDebtors: debtors,
              overLimitCount: credit.overLimitCount,
              overLimit: credit.overLimit,
            }
          : null,
      stock,
      cheques,
      net:
        charges && margin !== null && result !== null
          ? { margin, charges: charges.total, result }
          : null,
      top,
    };
  }

  private async mainId(units: { defaultWarehouseId: string | null }): Promise<string | null> {
    if (units.defaultWarehouseId) return units.defaultWarehouseId;
    const main = await this.prisma.db.warehouse.findFirst({
      where: { isDefault: true },
      select: { id: true },
    });
    return main?.id ?? null;
  }

  /** What a user's figures cover, the same for the dashboard and the assistant. */
  private async figureScope(
    user: CurrentUserInfo,
    filters: { sellerId?: string; teamOf?: string; brandId?: string; warehouseId?: string },
  ) {
    // Phase 24: the dépôts whose figures he sees (works in or VIEW_STATS), narrowed by
    // the dépôt switcher. null = all.
    const units = await this.scopes.warehouses(user);
    const warehouseIds = await this.scopes.figureWarehouses(
      units.statsWarehouseIds,
      filters.warehouseId,
    );
    const scope: Scope = {
      tenantId: tenantContext.requireTenantId(),
      sellerIds: await this.scopes.figuresSellerIds(user, filters),
      brandId: filters.brandId ?? null,
      warehouseIds,
      defaultWarehouseId: units.defaultWarehouseId,
    };
    return { scope, units, warehouseIds };
  }

  /**
   * Ventes and encaissements between two Algiers days, by the dashboard's rules (phase 30):
   * sales for who sees them, cash for managers. null = this role does not see it.
   */
  async periodSummary(
    user: CurrentUserInfo,
    from: string,
    to: string,
  ): Promise<{ sales: SalesFigure | null; collected: { total: string; count: number } | null }> {
    if (!seesSalesFigures(user)) return { sales: null, collected: null };
    const { scope, warehouseIds } = await this.figureScope(user, {});
    const { start, end } = algiersRange(from, to);
    const [row] = await this.prisma.db.$queryRaw<
      { ttc: Prisma.Decimal | null; count: bigint | Prisma.Decimal | null }[]
    >`
      SELECT SUM(f.ttc - f."retTtc") AS ttc, SUM(f.docs) AS count
      FROM (${saleDocumentFacts(scope, start, end)}) f`;
    return {
      sales: {
        ttc: toMoneyString(money(row?.ttc?.toString() ?? 0)),
        count: Number(row?.count ?? 0),
      },
      collected: MANAGERS.includes(user.role)
        ? await this.payments.collected(from, to, user, warehouseIds)
        : null,
    };
  }

  private async sales(
    scope: Scope,
    date: string,
    withMargin: boolean,
    range: DashboardPeriodRange,
    cashFor: { user: CurrentUserInfo; warehouseIds: string[] | null } | null,
  ): Promise<NonNullable<DashboardDto['sales']>> {
    const month = monthToDate(date);
    const previousMonth = previousMonthToDate(date);
    // One pass over every day any figure needs; days are split in code.
    const from = [previousMonth.from, range.previousFrom].sort()[0]!;
    const to = [date, range.to].sort().at(-1)!;
    const { start, end } = algiersRange(from, to);
    const rows = await this.prisma.db.$queryRaw<
      { day: string; ttc: Prisma.Decimal; count: bigint }[]
    >`
      SELECT ${algiersDayOf('f.at')} AS day, SUM(f.ttc - f."retTtc") AS ttc, SUM(f.docs) AS count
      FROM (${saleDocumentFacts(scope, start, end)}) f
      GROUP BY 1`;
    const byDay = new Map<string, DayTotals>(
      rows.map((r) => [r.day, { ttc: money(r.ttc.toString()), count: Number(r.count) }]),
    );
    const total = (from: string, to: string): SalesFigure => {
      let ttc = money(0);
      let count = 0;
      for (const [day, v] of byDay) {
        if (day >= from && day <= to) {
          ttc = ttc.plus(v.ttc);
          count += v.count;
        }
      }
      return { ttc: toMoneyString(ttc), count };
    };
    const perDay: { date: string; ttc: string }[] = [];
    for (let day = month.from; day <= date; day = addDays(day, 1)) {
      perDay.push({ date: day, ttc: toMoneyString(byDay.get(day)?.ttc ?? 0) });
    }
    const [marginByDay, cashByDay] = await Promise.all([
      withMargin ? this.marginByDay(scope, range.from, range.to) : null,
      cashFor
        ? this.payments.collectedByDay(range.from, range.to, cashFor.user, cashFor.warehouseIds)
        : null,
    ]);
    const sumIn = (m: Map<string, string>, from: string, to: string): string => {
      let sum = money(0);
      for (const [day, v] of m) if (day >= from && day <= to) sum = sum.plus(v);
      return toMoneyString(sum);
    };
    const current = total(range.from, range.to);
    const previous = total(range.previousFrom, range.previousTo);
    return {
      today: total(date, date),
      month: total(month.from, month.to),
      previousMonth: total(previousMonth.from, previousMonth.to),
      perDay,
      margin: marginByDay ? sumIn(marginByDay, range.from, range.to) : null,
      period: range,
      current,
      previous,
      changePct: changePercent(current.ttc, previous.ttc),
      series: chartBuckets(range).map((b) => {
        const prev = previousBucket(range, b);
        const figure = total(b.from, b.to);
        return {
          from: b.from,
          to: b.to,
          ttc: figure.ttc,
          count: figure.count,
          cash: cashByDay ? sumIn(cashByDay, b.from, b.to) : null,
          margin: marginByDay ? sumIn(marginByDay, b.from, b.to) : null,
          previousTtc: total(prev.from, prev.to).ttc,
        };
      }),
    };
  }

  /** Marge (net HT − cost at sale) per Algiers day. */
  private async marginByDay(scope: Scope, from: string, to: string): Promise<Map<string, string>> {
    const { start, end } = algiersRange(from, to);
    const rows = await this.prisma.db.$queryRaw<
      { day: string; net: Prisma.Decimal; cost: Prisma.Decimal }[]
    >`
      SELECT ${algiersDayOf('f.at')} AS day, SUM(f.ht - f."retHt") AS net, SUM(f.cost) AS cost
      FROM (${saleLineFacts(scope, start, end)}) f
      GROUP BY 1`;
    return new Map(
      rows.map((r) => [r.day, toMoneyString(money(r.net.toString()).minus(r.cost.toString()))]),
    );
  }

  /**
   * Top products and clients of the period, and the clients who stopped buying: a sale in
   * the 90 days before the last 30, none in the last 30 (fixed windows, as of `date`).
   */
  private async top(
    scope: Scope,
    range: DashboardPeriodRange,
    date: string,
  ): Promise<DashboardTopDto> {
    const { start, end } = algiersRange(range.from, range.to);
    const dormantFrom = addDays(date, -(DORMANT_RECENT_DAYS + DORMANT_BEFORE_DAYS) + 1);
    const recentFrom = addDays(date, -DORMANT_RECENT_DAYS + 1);
    const span = algiersRange(dormantFrom, date);
    const recentStart = algiersRange(recentFrom, recentFrom).start;
    const [products, clients, dormant] = await Promise.all([
      this.prisma.db.$queryRaw<
        {
          id: string;
          designation: string;
          unit: string;
          qty: Prisma.Decimal;
          ttc: Prisma.Decimal;
        }[]
      >`
        SELECT p.id, p.designation, u.code AS unit, SUM(f.qty) AS qty, SUM(f.ttc - f."retTtc") AS ttc
        FROM (${saleLineFacts(scope, start, end)}) f
        JOIN products p ON p.id = f."productId"
        JOIN units u ON u.id = p."baseUnitId"
        GROUP BY p.id, p.designation, u.code
        HAVING SUM(f.ttc - f."retTtc") > 0
        ORDER BY 5 DESC, p.id
        LIMIT ${TOP_ROWS}`,
      this.prisma.db.$queryRaw<{ id: string; name: string; ttc: Prisma.Decimal; count: bigint }[]>`
        SELECT c.id, c.name, SUM(f.ttc - f."retTtc") AS ttc, SUM(f.docs) AS count
        FROM (${saleDocumentFacts(scope, start, end)}) f
        JOIN clients c ON c.id = f."clientId"
        GROUP BY c.id, c.name
        HAVING SUM(f.ttc - f."retTtc") > 0
        ORDER BY 3 DESC, c.id
        LIMIT ${TOP_ROWS}`,
      this.prisma.db.$queryRaw<
        { id: string; name: string; before: Prisma.Decimal; last: string }[]
      >`
        SELECT c.id, c.name,
               SUM(f.ttc - f."retTtc") FILTER (WHERE f.at < ${recentStart}) AS before,
               ${algiersDayOf('MAX(f.at) FILTER (WHERE f.docs > 0)')} AS last
        FROM (${saleDocumentFacts(scope, span.start, span.end)}) f
        JOIN clients c ON c.id = f."clientId"
        WHERE c."deletedAt" IS NULL
        GROUP BY c.id, c.name
        HAVING SUM(f.docs) FILTER (WHERE f.at < ${recentStart}) > 0
           AND COALESCE(SUM(f.docs) FILTER (WHERE f.at >= ${recentStart}), 0) = 0
           AND SUM(f.ttc - f."retTtc") FILTER (WHERE f.at < ${recentStart}) > 0
        ORDER BY 3 DESC, c.id
        LIMIT ${TOP_ROWS}`,
    ]);
    return {
      products: products.map((r) => ({
        id: r.id,
        designation: r.designation,
        unit: r.unit,
        qty: qty(r.qty.toString()).toFixed(3),
        ttc: toMoneyString(r.ttc.toString()),
      })),
      clients: clients.map((r) => ({
        id: r.id,
        name: r.name,
        ttc: toMoneyString(r.ttc.toString()),
        count: Number(r.count),
      })),
      dormant: dormant.map((r) => ({
        id: r.id,
        name: r.name,
        // 90 days ≈ 3 months.
        monthly: toMoneyString(money(r.before.toString()).div(DORMANT_BEFORE_DAYS / 30)),
        lastSale: r.last,
      })),
    };
  }
}
