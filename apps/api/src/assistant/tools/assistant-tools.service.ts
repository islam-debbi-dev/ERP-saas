import { Injectable, Logger } from '@nestjs/common';
import {
  AI_TOOL_MAX_ROWS,
  type AssistantLink,
  ASSISTANT_TOOLS,
  type AssistantToolName,
  ErrorCode,
  Permission,
  Role,
} from '@erp/shared';
import type { z } from 'zod';
import { type CurrentUserInfo } from '../../auth/auth.types';
import { can } from '../../auth/permissions';
import { ProductsService } from '../../catalog/products.service';
import { ClientsService } from '../../clients/clients.service';
import { AppException } from '../../common/app-exception';
import { AgingService } from '../../credit/aging.service';
import { PaymentsService } from '../../payments/payments.service';
import { PurchasesService } from '../../purchases/purchases.service';
import { DashboardService } from '../../reports/dashboard.service';
import { ScopeService } from '../../sales-force/scope.service';
import { SalesService } from '../../sales/sales.service';
import { StockQueriesService } from '../../stock/stock-queries.service';
import { WarehousesService } from '../../stock/warehouses.service';

export type ToolStatus = 'OK' | 'NOT_ALLOWED' | 'NOT_FOUND' | 'INVALID_INPUT' | 'FAILED';

export interface ToolOutcome {
  status: ToolStatus;
  /** What the model reads. */
  result: unknown;
  /** Screens to offer as buttons. */
  links: AssistantLink[];
}

type Input<N extends AssistantToolName> = z.infer<(typeof ASSISTANT_TOOLS)[N]['input']>;

const MANAGERS: readonly Role[] = [Role.OWNER, Role.MANAGER];

class NotAllowed extends Error {}

function requirePermission(user: CurrentUserInfo, permission: Permission): void {
  if (!can(user, permission)) throw new NotAllowed();
}

/**
 * The assistant's only way to data (phase 30, Part B). Every tool reads through a
 * module's exported service, with the permission and scope of the matching screen, in the
 * caller's tenant context. None of them writes, and this class never touches Prisma.
 */
@Injectable()
export class AssistantToolsService {
  private readonly logger = new Logger(AssistantToolsService.name);

  constructor(
    private readonly clients: ClientsService,
    private readonly aging: AgingService,
    private readonly payments: PaymentsService,
    private readonly products: ProductsService,
    private readonly stock: StockQueriesService,
    private readonly warehouses: WarehousesService,
    private readonly scope: ScopeService,
    private readonly dashboard: DashboardService,
    private readonly sales: SalesService,
    private readonly purchases: PurchasesService,
  ) {}

  /** Never throws: whatever goes wrong becomes a result the model can explain. */
  async run(name: string, input: unknown, user: CurrentUserInfo): Promise<ToolOutcome> {
    const tool = ASSISTANT_TOOLS[name as AssistantToolName] as
      (typeof ASSISTANT_TOOLS)[AssistantToolName] | undefined;
    const parsed = tool?.input.safeParse(input);
    if (!parsed?.success) return failure('INVALID_INPUT');
    try {
      return await this.dispatch(name as AssistantToolName, parsed.data, user);
    } catch (err) {
      if (err instanceof NotAllowed) return failure('NOT_ALLOWED');
      if (err instanceof AppException) {
        const { code } = err.getResponse() as { code?: string };
        if (code === ErrorCode.NOT_FOUND || code === ErrorCode.PRODUCT_NOT_FOUND) {
          return failure('NOT_FOUND');
        }
        if (code === ErrorCode.FORBIDDEN) return failure('NOT_ALLOWED');
      }
      this.logger.error({ tool: name, err }, 'Assistant tool failed');
      return failure('FAILED');
    }
  }

  private dispatch(
    name: AssistantToolName,
    input: unknown,
    user: CurrentUserInfo,
  ): Promise<ToolOutcome> {
    switch (name) {
      case 'search_clients':
        return this.searchClients(input as Input<'search_clients'>, user);
      case 'client_balance':
        return this.clientBalance(input as Input<'client_balance'>, user);
      case 'search_products':
        return this.searchProducts(input as Input<'search_products'>, user);
      case 'product_stock':
        return this.productStock(input as Input<'product_stock'>, user);
      case 'sales_summary':
        return this.salesSummary(input as Input<'sales_summary'>, user);
      case 'clients_to_remind':
        return this.clientsToRemind(user);
      case 'find_document':
        return this.findDocument(input as Input<'find_document'>, user);
    }
  }

  private async searchClients(
    { query }: Input<'search_clients'>,
    user: CurrentUserInfo,
  ): Promise<ToolOutcome> {
    requirePermission(user, Permission.CLIENTS_VIEW);
    const page = await this.clients.list(
      { search: query, limit: AI_TOOL_MAX_ROWS } as Parameters<ClientsService['list']>[0],
      user,
    );
    return ok({
      clients: page.items.map((c) => ({ id: c.id, code: c.code, name: c.name, phone: c.phone })),
    });
  }

  private async clientBalance(
    { clientId }: Input<'client_balance'>,
    user: CurrentUserInfo,
  ): Promise<ToolOutcome> {
    requirePermission(user, Permission.CLIENTS_VIEW);
    const client = await this.clients.get(clientId, user);
    const [oldestUnpaid, versements, { warehouseIds }] = await Promise.all([
      this.aging.oldestUnpaid(clientId),
      can(user, Permission.PAYMENTS_VIEW)
        ? this.payments.list({ clientId, status: 'VALID', sort: 'receivedAt', limit: 1 }, user)
        : null,
      this.scope.of(user),
    ]);
    const last = versements?.items[0];
    // One account across dépôts: the total is the relevé's, the split stops at his reach.
    const split = (client.debtByWarehouse ?? []).filter(
      (w) => !warehouseIds || (w.warehouse && warehouseIds.includes(w.warehouse.id)),
    );
    return ok(
      {
        name: client.name,
        balance: client.balance,
        creditLimit: client.creditLimit,
        oldestUnpaid,
        lastVersement: last ? { amount: last.amount, date: last.receivedAt } : null,
        byDepot: split.map((w) => ({ depot: w.warehouse?.name ?? null, balance: w.balance })),
      },
      [{ label: client.name, href: `/clients/${client.id}` }],
    );
  }

  private async searchProducts(
    { query }: Input<'search_products'>,
    user: CurrentUserInfo,
  ): Promise<ToolOutcome> {
    requirePermission(user, Permission.PRODUCTS_VIEW);
    const page = await this.products.list({
      search: query,
      limit: AI_TOOL_MAX_ROWS,
    } as Parameters<ProductsService['list']>[0]);
    return ok({
      products: page.items.map((p) => ({
        id: p.id,
        reference: p.reference,
        designation: p.designation,
      })),
    });
  }

  private async productStock(
    { productId }: Input<'product_stock'>,
    user: CurrentUserInfo,
  ): Promise<ToolOutcome> {
    requirePermission(user, Permission.STOCK_VIEW);
    const seesCost = can(user, Permission.VIEW_COST_AND_MARGIN);
    const { warehouseIds: reach } = await this.scope.warehouses(user);
    const level = await this.stock.level(
      productId,
      seesCost,
      await this.warehouses.enabled(user.tenantId),
      reach,
    );
    const names = new Map((await this.warehouses.list(user)).map((w) => [w.id, w.name]));
    return ok(
      {
        reference: level.reference,
        designation: level.designation,
        quantity: level.qtyBase,
        baseUnit: level.baseUnit.unitName ?? level.baseUnit.unitCode,
        mainUnit: level.packaging
          ? {
              name: level.packaging.unitName ?? level.packaging.unitCode,
              contains: level.packaging.factorToBase,
            }
          : null,
        alertThreshold: level.minStock,
        low: level.lowStock,
        byDepot: (level.byWarehouse ?? [])
          .slice(0, AI_TOOL_MAX_ROWS)
          .map((w) => ({ depot: names.get(w.warehouseId) ?? null, quantity: w.qtyBase })),
        ...(seesCost ? { averageCost: level.avgCost } : {}),
      },
      [{ label: level.designation, href: `/stock/${level.productId}` }],
    );
  }

  private async salesSummary(
    { from, to }: Input<'sales_summary'>,
    user: CurrentUserInfo,
  ): Promise<ToolOutcome> {
    if (from > to) return failure('INVALID_INPUT');
    const { sales, collected } = await this.dashboard.periodSummary(user, from, to);
    if (!sales) throw new NotAllowed();
    return ok({ from, to, sales, encaissements: collected }, [
      { label: 'Rapports', href: '/rapports' },
    ]);
  }

  private async clientsToRemind(user: CurrentUserInfo): Promise<ToolOutcome> {
    // The screen is for managers, and its list is not narrowed per seller.
    if (!MANAGERS.includes(user.role)) throw new NotAllowed();
    const { reminderDays, items } = await this.aging.toRemind();
    return ok(
      {
        reminderDays,
        total: items.length,
        clients: items.slice(0, AI_TOOL_MAX_ROWS).map((r) => ({
          id: r.client.id,
          name: r.client.name,
          balance: r.balance,
          oldestDate: r.oldestDate,
          oldestDays: r.oldestDays,
        })),
      },
      [{ label: 'Clients à relancer', href: '/clients/a-relancer' }],
    );
  }

  private async findDocument(
    { number }: Input<'find_document'>,
    user: CurrentUserInfo,
  ): Promise<ToolOutcome> {
    const wanted = number.toUpperCase();
    const prefix = wanted.split('-')[0];
    switch (prefix) {
      case 'BL':
      case 'FAC': {
        requirePermission(user, Permission.SALES_VIEW);
        const s = await this.sales.findByNumber(wanted, user);
        return ok(
          {
            type: s.type,
            number: s.number,
            status: s.status,
            client: s.client?.name ?? s.clientSnapshot?.name ?? null,
            total: s.totalTtc,
            date: s.documentDate,
          },
          [{ label: wanted, href: `/ventes/${s.id}` }],
        );
      }
      case 'AV': {
        requirePermission(user, Permission.SALES_VIEW);
        const r = await this.sales.findReturnByNumber(wanted, user);
        return ok(
          {
            type: 'AVOIR',
            number: r.number,
            client: r.sale.client?.name ?? r.sale.clientSnapshot?.name ?? null,
            total: r.totalTtc,
            date: r.createdAt,
            ofSale: r.sale.number,
          },
          [{ label: wanted, href: `/ventes/${r.sale.id}` }],
        );
      }
      case 'VER': {
        requirePermission(user, Permission.PAYMENTS_VIEW);
        const p = await this.payments.findByNumber(wanted, user);
        return ok(
          {
            type: 'VERSEMENT',
            number: p.number,
            status: p.status,
            client: p.client?.name ?? null,
            total: p.amount,
            date: p.receivedAt,
          },
          [{ label: wanted, href: '/versements' }],
        );
      }
      case 'BR': {
        requirePermission(user, Permission.PURCHASES_VIEW);
        const p = await this.purchases.findByNumber(wanted, user);
        return ok(
          {
            type: 'BON_DE_RECEPTION',
            number: p.number,
            status: p.status,
            supplier: p.supplier.name,
            ...(can(user, Permission.VIEW_COST_AND_MARGIN) ? { total: p.totalTtc } : {}),
            date: p.documentDate,
          },
          [{ label: wanted, href: `/achats/${p.id}` }],
        );
      }
      default:
        return failure('NOT_FOUND');
    }
  }
}

function ok(result: unknown, links: AssistantLink[] = []): ToolOutcome {
  return { status: 'OK', result, links };
}

function failure(status: Exclude<ToolStatus, 'OK'>): ToolOutcome {
  return { status, result: { error: status }, links: [] };
}
