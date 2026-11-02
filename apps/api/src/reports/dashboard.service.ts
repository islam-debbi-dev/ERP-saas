import { Injectable } from '@nestjs/common';
import {
  addDays,
  algiersDay,
  type DashboardDto,
  monthToDate,
  money,
  type Money,
  netResult,
  Permission,
  previousMonthToDate,
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
import { algiersDayOf, saleDocumentFacts, saleLineFacts, type Scope } from './reports-sql';

const TOP_DEBTORS = 10;

const MANAGERS: readonly Role[] = [Role.OWNER, Role.MANAGER];

interface DayTotals {
  ttc: Money;
  count: number;
}

@Injectable()
export class DashboardService {
  constructor(
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
    } = {},
  ): Promise<DashboardDto> {
    const date = filters.date ?? algiersDay();
    const manager = MANAGERS.includes(user.role);
    const seesSales = manager || user.role === Role.SELLER || user.role === Role.SUPERVISOR;
    const seesStock = manager || user.role === Role.STOREKEEPER;
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
    const seesCost = can(user, Permission.VIEW_COST_AND_MARGIN);
    const byUnit = warehouseIds
      ? this.clients.creditInWarehouses(warehouseIds, units.defaultWarehouseId, TOP_DEBTORS)
      : null;
    const [sales, cash, credit, debtors, stock, cheques] = await Promise.all([
      seesSales ? this.sales(scope, date, seesCost) : null,
      manager ? this.payments.summary(date, user, warehouseIds) : null,
      manager ? (byUnit ?? this.clients.creditSummary(TOP_DEBTORS)) : null,
      manager
        ? byUnit
          ? byUnit.then((c) => c.topDebtors)
          : this.clients.debtors(TOP_DEBTORS)
        : null,
      seesStock ? this.stock.dashboardSummary(seesCost, warehouseIds) : null,
      manager ? this.aging.dueCheques(date) : null,
    ]);
    // Phase 26: résultat net of the month = marge − charges (phase 25), same dépôts.
    const margin = sales?.margin ?? null;
    const charges =
      manager && margin !== null && (await this.scopes.expensesOn(scope.tenantId))
        ? await this.charges.report(
            { from: monthToDate(date).from, to: date, warehouseId: filters.warehouseId },
            user,
          )
        : null;
    const result = charges ? netResult(margin, charges.total) : null;
    return {
      date,
      sales,
      cash: cash ? { total: cash.total, byMode: cash.byMode } : null,
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
    };
  }

  private async sales(
    scope: Scope,
    date: string,
    withMargin: boolean,
  ): Promise<NonNullable<DashboardDto['sales']>> {
    const month = monthToDate(date);
    const previous = previousMonthToDate(date);
    // One pass from the 1st of last month to today; days are split in code.
    const { start, end } = algiersRange(previous.from, date);
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
    return {
      today: total(date, date),
      month: total(month.from, month.to),
      previousMonth: total(previous.from, previous.to),
      perDay,
      margin: withMargin ? await this.margin(scope, month.from, date) : null,
    };
  }

  private async margin(scope: Scope, from: string, to: string): Promise<string> {
    const { start, end } = algiersRange(from, to);
    const [row] = await this.prisma.db.$queryRaw<
      { net: Prisma.Decimal | null; cost: Prisma.Decimal | null }[]
    >`
      SELECT SUM(f.ht - f."retHt") AS net, SUM(f.cost) AS cost
      FROM (${saleLineFacts(scope, start, end)}) f`;
    const net = money(row?.net?.toString() ?? '0');
    const cost = money(row?.cost?.toString() ?? '0');
    return toMoneyString(net.minus(cost));
  }
}
