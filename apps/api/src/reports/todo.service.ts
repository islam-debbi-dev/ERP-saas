import { Injectable } from '@nestjs/common';
import {
  addDays,
  algiersDay,
  CHEQUE_OVERDUE_DAYS,
  type DashboardTodoDto,
  DRAFT_OLD_HOURS,
  RECENT_SALE_DAYS,
  rankTodo,
  Role,
  SUPPLIER_CHEQUE_LEAD_DAYS,
  TODO_LIST_CAP,
  type TodoItem,
  todoKey,
  type TodoType,
  toMoneyString,
} from '@erp/shared';
import type { CurrentUserInfo } from '../auth/auth.types';
import { algiersRange } from '../common/algiers';
import { tenantContext } from '../common/tenant-context';
import { AgingService } from '../credit/aging.service';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ScopeService } from '../sales-force/scope.service';
import { OrdersService } from '../tournees/orders.service';
import { saleLineFacts } from './reports-sql';

const MANAGERS: readonly Role[] = [Role.OWNER, Role.MANAGER];
const FIELD: readonly Role[] = [Role.SELLER, Role.SUPERVISOR];

const day = (d: Date): string => d.toISOString().slice(0, 10);
const daysBetween = (from: string, to: string): number =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

function base(type: TodoType, id: string, fields: Partial<TodoItem>): TodoItem {
  return {
    key: todoKey(type, id),
    type,
    id,
    label: null,
    amount: null,
    limit: null,
    count: null,
    date: null,
    days: null,
    clientId: null,
    supplierId: null,
    productId: null,
    phone: null,
    document: null,
    ...fields,
  };
}

/**
 * "À faire aujourd'hui" (phase 33). Read only, like the dashboard: the same roles see
 * the same things. Managers see the company; a seller or supervisor sees the items of
 * the clients assigned to him or his team only (and his own drafts and orders); a
 * storekeeper the stock. Raw SQL takes the tenant id explicitly (reports-sql rule).
 */
@Injectable()
export class TodoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scopes: ScopeService,
    private readonly aging: AgingService,
    private readonly orders: OrdersService,
  ) {}

  async get(user: CurrentUserInfo, now = new Date()): Promise<DashboardTodoDto> {
    const today = algiersDay(now);
    const tenantId = tenantContext.requireTenantId();
    const manager = MANAGERS.includes(user.role);
    const field = FIELD.includes(user.role);
    const seesStock = manager || user.role === Role.STOREKEEPER;
    // null = every client (managers); otherwise the sellers whose clients count.
    const sellers = field
      ? user.role === Role.SELLER
        ? [user.id]
        : await this.scopes.teamIds(user.id)
      : null;
    const seesClients = manager || field;
    const parts = await Promise.all([
      manager ? this.chequesDue(today) : [],
      manager ? this.supplierCheques(today) : [],
      seesClients ? this.overLimit(tenantId, sellers) : [],
      seesClients ? this.late(tenantId, sellers) : [],
      seesStock ? this.outOfStockSold(tenantId, today) : [],
      (await this.scopes.tourneesOn(tenantId)) ? this.ordersToConfirm(user, today) : [],
      this.oldDrafts(user, now, today),
    ]);
    const all = parts.flat();
    return {
      date: today,
      total: rankTodo(all, Number.MAX_SAFE_INTEGER).length,
      items: rankTodo(all, TODO_LIST_CAP),
    };
  }

  /** Client cheques due today or overdue by at most a week (there is no "cashed" state). */
  private async chequesDue(today: string): Promise<TodoItem[]> {
    const rows = await this.prisma.db.payment.findMany({
      where: {
        mode: 'CHEQUE',
        status: 'VALID',
        dueDate: {
          gte: new Date(`${addDays(today, -CHEQUE_OVERDUE_DAYS)}T00:00:00.000Z`),
          lte: new Date(`${today}T00:00:00.000Z`),
        },
      },
      include: { client: { select: { id: true, name: true, phone: true } } },
      take: TODO_LIST_CAP,
      orderBy: [{ dueDate: 'asc' }, { id: 'asc' }],
    });
    return rows.map((r) => {
      const due = r.dueDate ? day(r.dueDate) : today;
      return base('CHEQUE_DUE', r.id, {
        label: r.client?.name ?? r.reference,
        amount: toMoneyString(r.amount.toString()),
        date: due,
        days: daysBetween(due, today),
        clientId: r.client?.id ?? null,
        phone: r.client?.phone ?? null,
      });
    });
  }

  /** Own cheques to suppliers due today or within two days: money must be in the bank. */
  private async supplierCheques(today: string): Promise<TodoItem[]> {
    const rows = await this.prisma.db.supplierPayment.findMany({
      where: {
        mode: 'CHEQUE',
        status: 'VALID',
        dueDate: {
          gte: new Date(`${today}T00:00:00.000Z`),
          lte: new Date(`${addDays(today, SUPPLIER_CHEQUE_LEAD_DAYS)}T00:00:00.000Z`),
        },
      },
      include: { supplier: { select: { id: true, name: true } } },
      take: TODO_LIST_CAP,
      orderBy: [{ dueDate: 'asc' }, { id: 'asc' }],
    });
    return rows.map((r) => {
      const due = r.dueDate ? day(r.dueDate) : today;
      return base('SUPPLIER_CHEQUE_DUE', r.id, {
        label: r.supplier.name,
        amount: toMoneyString(r.amount.toString()),
        date: due,
        days: daysBetween(today, due),
        supplierId: r.supplier.id,
      });
    });
  }

  private sellerFilter(sellers: string[] | null, alias = 'c'): Prisma.Sql {
    return sellers
      ? Prisma.sql`AND ${Prisma.raw(`${alias}."assignedSellerId"`)} = ANY(${sellers}::uuid[])`
      : Prisma.empty;
  }

  private async overLimit(tenantId: string, sellers: string[] | null): Promise<TodoItem[]> {
    const rows = await this.prisma.db.$queryRaw<
      {
        id: string;
        name: string;
        phone: string | null;
        balance: Prisma.Decimal;
        creditLimit: Prisma.Decimal;
      }[]
    >`
      SELECT c.id, c.name, c.phone, b.balance, c."creditLimit"
      FROM client_balances b JOIN clients c ON c.id = b."clientId"
      WHERE b."tenantId" = ${tenantId}::uuid AND c."deletedAt" IS NULL
        AND c."creditLimit" IS NOT NULL AND b.balance > c."creditLimit"
        ${this.sellerFilter(sellers)}
      ORDER BY b.balance - c."creditLimit" DESC, c.id
      LIMIT ${TODO_LIST_CAP}`;
    return rows.map((r) =>
      base('CLIENT_OVER_LIMIT', r.id, {
        label: r.name,
        amount: toMoneyString(r.balance.toString()),
        limit: toMoneyString(r.creditLimit.toString()),
        clientId: r.id,
        phone: r.phone,
      }),
    );
  }

  /** "Clients à relancer" (phase 28): the oldest unpaid amount is older than the term. */
  private async late(tenantId: string, sellers: string[] | null): Promise<TodoItem[]> {
    const { items } = await this.aging.toRemind();
    let allowed: Set<string> | null = null;
    if (sellers) {
      const ids = items.map((i) => i.client.id);
      const mine = ids.length
        ? await this.prisma.db.$queryRaw<{ id: string }[]>`
            SELECT c.id FROM clients c
            WHERE c."tenantId" = ${tenantId}::uuid AND c.id = ANY(${ids}::uuid[])
              ${this.sellerFilter(sellers)}`
        : [];
      allowed = new Set(mine.map((r) => r.id));
    }
    return items
      .filter((i) => !allowed || allowed.has(i.client.id))
      .slice(0, TODO_LIST_CAP)
      .map((i) =>
        base('CLIENT_LATE', i.client.id, {
          label: i.client.name,
          amount: i.balance,
          date: i.oldestDate,
          days: i.oldestDays,
          clientId: i.client.id,
          phone: i.client.phone,
        }),
      );
  }

  /**
   * Products with nothing left (company-wide) that sold in the last 30 days, with the
   * supplier of their last validated purchase to order from.
   */
  private async outOfStockSold(tenantId: string, today: string): Promise<TodoItem[]> {
    const { start, end } = algiersRange(addDays(today, 1 - RECENT_SALE_DAYS), today);
    const scope = { tenantId, sellerIds: null, brandId: null };
    const rows = await this.prisma.db.$queryRaw<
      {
        id: string;
        designation: string;
        docs: bigint;
        supplierId: string | null;
      }[]
    >`
      SELECT p.id, p.designation, sold.docs,
             (SELECT pu."supplierId" FROM purchase_lines pl JOIN purchases pu ON pu.id = pl."purchaseId"
              WHERE pl."tenantId" = ${tenantId}::uuid AND pl."productId" = p.id
                AND pu.status IN ('VALIDATED', 'IN_TRANSIT')
              ORDER BY pu."validatedAt" DESC NULLS LAST, pu.id DESC LIMIT 1) AS "supplierId"
      FROM products p
      LEFT JOIN product_stocks s ON s."productId" = p.id
      JOIN (
        SELECT f."productId", COUNT(DISTINCT f."saleId") AS docs
        FROM (${saleLineFacts(scope, start, end)}) f
        WHERE f."saleId" IS NOT NULL
        GROUP BY f."productId"
      ) sold ON sold."productId" = p.id
      WHERE p."tenantId" = ${tenantId}::uuid AND p."deletedAt" IS NULL
        AND COALESCE(s."qtyBase", 0) <= 0
      ORDER BY sold.docs DESC, p.id
      LIMIT ${TODO_LIST_CAP}`;
    return rows.map((r) =>
      base('OUT_OF_STOCK_SOLD', r.id, {
        label: r.designation,
        count: Number(r.docs),
        productId: r.id,
        supplierId: r.supplierId,
      }),
    );
  }

  private async ordersToConfirm(user: CurrentUserInfo, today: string): Promise<TodoItem[]> {
    const rows = await this.orders.toConfirm(user, TODO_LIST_CAP);
    return rows.map((o) => {
      const date = algiersDay(o.createdAt);
      return base('ORDER_TO_CONFIRM', o.id, {
        label: o.client,
        amount: o.totalTtc,
        date,
        days: daysBetween(date, today),
      });
    });
  }

  /** The user's own drafts (sales and purchases) left for more than a day. */
  private async oldDrafts(user: CurrentUserInfo, now: Date, today: string): Promise<TodoItem[]> {
    const before = new Date(now.getTime() - DRAFT_OLD_HOURS * 3_600_000);
    const [sales, purchases] = await Promise.all([
      this.prisma.db.sale.findMany({
        where: { status: 'DRAFT', createdBy: user.id, createdAt: { lt: before } },
        select: {
          id: true,
          totalTtc: true,
          createdAt: true,
          client: { select: { id: true, name: true } },
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: TODO_LIST_CAP,
      }),
      this.prisma.db.purchase.findMany({
        where: { status: 'DRAFT', createdBy: user.id, createdAt: { lt: before } },
        select: {
          id: true,
          totalTtc: true,
          createdAt: true,
          supplier: { select: { id: true, name: true } },
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: TODO_LIST_CAP,
      }),
    ]);
    const item = (
      id: string,
      document: 'SALE' | 'PURCHASE',
      createdAt: Date,
      totalTtc: Prisma.Decimal,
      fields: Partial<TodoItem>,
    ) => {
      const date = algiersDay(createdAt);
      return base('DRAFT_OLD', id, {
        document,
        amount: toMoneyString(totalTtc.toString()),
        date,
        days: daysBetween(date, today),
        ...fields,
      });
    };
    return [
      ...sales.map((s) =>
        item(s.id, 'SALE', s.createdAt, s.totalTtc, {
          label: s.client?.name ?? null,
          clientId: s.client?.id ?? null,
        }),
      ),
      ...purchases.map((p) =>
        item(p.id, 'PURCHASE', p.createdAt, p.totalTtc, {
          label: p.supplier.name,
          supplierId: p.supplier.id,
        }),
      ),
    ];
  }
}
