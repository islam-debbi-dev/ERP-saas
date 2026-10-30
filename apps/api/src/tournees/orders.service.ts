import { Injectable } from '@nestjs/common';
import {
  algiersDay,
  type AssignLivreurInput,
  type CreateOrderInput,
  type DeliverOrderInput,
  type DelivererDto,
  type DeliverOrderResultDto,
  DocType,
  ErrorCode,
  money,
  type OrderDto,
  type OrderListQuery,
  type OrderPage,
  OrderStatus,
  qty,
  Role,
  type SaleLineInput,
  SaleType,
  toMoneyString,
  toQtyString,
  type UpdateOrderInput,
} from '@erp/shared';
import { AuditService } from '../audit/audit.service';
import { type CurrentUserInfo } from '../auth/auth.types';
import { ClockService } from '../clock/clock.service';
import { AppException } from '../common/app-exception';
import { tenantContext } from '../common/tenant-context';
import { DocumentNumberingService } from '../documents/document-numbering.service';
import { Prisma } from '../generated/prisma/client';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import { fromIsoDate, toIsoDate } from '../sales/sale.mapper';
import { resolvePriceLevel, snapshotSaleLines } from '../sales/sale-lines';
import { SaleWorkflowService } from '../sales/sale-workflow.service';
import { SalesService } from '../sales/sales.service';
import { ScopeService } from '../sales-force/scope.service';
import { StockService } from '../stock/stock.service';
import { WarehousesService } from '../stock/warehouses.service';

const orderInclude = {
  client: { select: { id: true, code: true, name: true, phone: true } },
  seller: { select: { id: true, fullName: true } },
  livreur: { select: { id: true, fullName: true } },
  warehouse: { select: { id: true, name: true } },
  sale: { select: { id: true, number: true } },
  lines: { orderBy: { position: 'asc' }, include: { product: { select: { reference: true } } } },
} satisfies Prisma.OrderInclude;

type OrderRow = Prisma.OrderGetPayload<{ include: typeof orderInclude }>;

/** Who may hand over the goods of an order. */
const DELIVERING_ROLES: readonly Role[] = [Role.LIVREUR, Role.SELLER];

/**
 * Bons de commande (pré-vente, phase 16). A draft is free to change; confirmation checks
 * the prices (same rules as a sale) and freezes the lines and the BC number. An order
 * never moves stock or touches the client account: delivering it creates the BL through
 * the normal sale path, in the same transaction, and one order gives at most one BL.
 *
 * Lock order on delivery: the order row, then what the sale takes (stock rows by
 * productId, then client balances). Nothing else locks orders, so no deadlock.
 */
@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sales: SalesService,
    private readonly workflow: SaleWorkflowService,
    private readonly stock: StockService,
    private readonly warehouses: WarehousesService,
    private readonly numbering: DocumentNumberingService,
    private readonly scope: ScopeService,
    private readonly audit: AuditService,
    private readonly clock: ClockService,
  ) {}

  // ---------------------------------------------------------------- drafts

  async create(input: CreateOrderInput, user: CurrentUserInfo): Promise<OrderDto> {
    const id = await this.prisma.db.$transaction(async (tx) => {
      const header = await this.checkHeader(tx, input, user, undefined);
      const { lines, totals, assujetti, priceLevelId } = await this.snapshot(tx, input);
      const tenantId = tenantContext.requireTenantId();
      const order = await tx.order.create({
        data: {
          tenantId,
          clientId: input.clientId,
          sellerId: header.sellerId ?? null,
          warehouseId: header.warehouseId,
          requestedDate: input.requestedDate ? fromIsoDate(input.requestedDate) : null,
          note: input.note,
          priceLevelId,
          assujettiTva: assujetti,
          totalHt: totals.totalHt.toString(),
          totalTva: totals.totalTva.toString(),
          totalTtc: totals.totalTtc.toString(),
          createdBy: user.id,
        },
      });
      if (lines.length > 0) {
        await tx.orderLine.createMany({
          data: lines.map((l) => ({ ...l, tenantId, orderId: order.id })),
        });
      }
      await this.audit.log(tx, {
        action: 'ORDER_DRAFT_CREATED',
        entity: 'Order',
        entityId: order.id,
        after: { ...input, sellerId: header.sellerId ?? null },
      });
      return order.id;
    });
    return this.get(id, user);
  }

  /** Replaces the draft (header and lines). `version` guards against concurrent edits. */
  async update(id: string, input: UpdateOrderInput, user: CurrentUserInfo): Promise<OrderDto> {
    await this.prisma.db.$transaction(async (tx) => {
      const current = await this.lockVisible(tx, id, user);
      if (current.status !== OrderStatus.DRAFT) {
        throw new AppException(ErrorCode.ORDER_NOT_DRAFT, 'Only a draft can be edited', {
          status: current.status,
        });
      }
      if (current.version !== input.version) {
        throw new AppException(ErrorCode.CONFLICT, 'Order changed since it was read', {
          currentVersion: current.version,
        });
      }
      const header = await this.checkHeader(tx, input, user, current.sellerId);
      const { lines, totals, assujetti, priceLevelId } = await this.snapshot(tx, input);
      await tx.orderLine.deleteMany({ where: { orderId: id } });
      if (lines.length > 0) {
        const tenantId = tenantContext.requireTenantId();
        await tx.orderLine.createMany({
          data: lines.map((l) => ({ ...l, tenantId, orderId: id })),
        });
      }
      await tx.order.update({
        where: { id },
        data: {
          clientId: input.clientId,
          ...(header.sellerId !== undefined ? { sellerId: header.sellerId } : {}),
          warehouseId: header.warehouseId,
          requestedDate: input.requestedDate ? fromIsoDate(input.requestedDate) : null,
          note: input.note,
          priceLevelId,
          assujettiTva: assujetti,
          totalHt: totals.totalHt.toString(),
          totalTva: totals.totalTva.toString(),
          totalTtc: totals.totalTtc.toString(),
          version: { increment: 1 },
        },
      });
      await this.audit.log(tx, {
        action: 'ORDER_DRAFT_UPDATED',
        entity: 'Order',
        entityId: id,
        after: input,
      });
    });
    return this.get(id, user);
  }

  // ---------------------------------------------------------------- confirm / cancel

  /**
   * Freezes the order (rule 9): lines re-read at the client's current level, a typed price
   * or a remise kept and checked against the confirming user's permissions, then the BC
   * number.
   */
  async confirm(id: string, user: CurrentUserInfo): Promise<OrderDto> {
    await this.prisma.db.$transaction(async (tx) => {
      const current = await this.lockVisible(tx, id, user);
      if (current.status !== OrderStatus.DRAFT) {
        throw new AppException(ErrorCode.ORDER_NOT_DRAFT, 'Only a draft can be confirmed', {
          status: current.status,
        });
      }
      const order = await tx.order.findUniqueOrThrow({
        where: { id },
        include: { lines: { orderBy: { position: 'asc' } } },
      });
      if (order.lines.length === 0) throw new AppException(ErrorCode.ORDER_EMPTY, 'No lines');
      const client = await tx.client.findFirst({
        where: { id: order.clientId, deletedAt: null },
        select: { id: true },
      });
      if (!client) {
        throw new AppException(ErrorCode.VALIDATION_FAILED, 'Unknown client', {
          field: 'clientId',
        });
      }
      const input: SaleLineInput[] = order.lines.map((l) => ({
        productId: l.productId,
        unitId: l.unitId,
        qty: l.qty.toString(),
        // A price typed on the draft stays; a list price follows today's level.
        ...(l.listPriceHt === null || !l.listPriceHt.eq(l.unitPriceHt)
          ? { unitPriceHt: l.unitPriceHt.toString() }
          : {}),
        discountPct: l.discountPct.toString(),
      }));
      const priceLevelId = await resolvePriceLevel(tx, order.clientId);
      const assujetti = await this.sales.assujettiTva(tx);
      const { lines, totals, overrides } = await snapshotSaleLines(
        tx,
        input,
        priceLevelId,
        assujetti,
      );
      await this.sales.checkOverrides(tx, overrides, user);
      const tenantId = tenantContext.requireTenantId();
      const number = await this.numbering.next(tx, tenantId, DocType.BC);
      await tx.orderLine.deleteMany({ where: { orderId: id } });
      await tx.orderLine.createMany({
        data: lines.map((l) => ({ ...l, tenantId, orderId: id })),
      });
      await tx.order.update({
        where: { id },
        data: {
          number,
          status: OrderStatus.CONFIRMED,
          priceLevelId,
          assujettiTva: assujetti,
          totalHt: totals.totalHt.toString(),
          totalTva: totals.totalTva.toString(),
          totalTtc: totals.totalTtc.toString(),
          confirmedAt: new Date(),
          confirmedBy: user.id,
          version: { increment: 1 },
        },
      });
      await this.audit.log(tx, {
        action: 'ORDER_CONFIRMED',
        entity: 'Order',
        entityId: id,
        after: { number, totalTtc: totals.totalTtc.toString(), overrides },
      });
    });
    return this.get(id, user);
  }

  async cancel(id: string, reason: string, user: CurrentUserInfo): Promise<OrderDto> {
    await this.prisma.db.$transaction(async (tx) => {
      const current = await this.lockVisible(tx, id, user);
      if (current.status !== OrderStatus.DRAFT && current.status !== OrderStatus.CONFIRMED) {
        throw new AppException(
          current.status === OrderStatus.DELIVERED
            ? ErrorCode.ORDER_ALREADY_DELIVERED
            : ErrorCode.ORDER_NOT_CONFIRMED,
          'This order cannot be cancelled',
          { status: current.status },
        );
      }
      await tx.order.update({
        where: { id },
        data: {
          status: OrderStatus.CANCELLED,
          cancelReason: reason,
          cancelledAt: new Date(),
          cancelledBy: user.id,
          version: { increment: 1 },
        },
      });
      await this.audit.log(tx, {
        action: 'ORDER_CANCELLED',
        entity: 'Order',
        entityId: id,
        before: { status: current.status },
        after: { reason },
      });
    });
    return this.get(id, user);
  }

  /** Puts a livreur (or a seller who delivers himself) on a confirmed order; null clears it. */
  async assignLivreur(
    id: string,
    input: AssignLivreurInput,
    user: CurrentUserInfo,
  ): Promise<OrderDto> {
    await this.prisma.db.$transaction(async (tx) => {
      const current = await this.lockVisible(tx, id, user);
      if (current.status !== OrderStatus.CONFIRMED) {
        throw new AppException(ErrorCode.ORDER_NOT_CONFIRMED, 'Only a confirmed order', {
          status: current.status,
        });
      }
      if (input.livreurId) {
        const u = await tx.user.findFirst({
          where: { id: input.livreurId, deletedAt: null, role: { in: [...DELIVERING_ROLES] } },
          select: { id: true },
        });
        if (!u) {
          throw new AppException(ErrorCode.SELLER_NOT_ALLOWED, 'This user cannot deliver', {
            userId: input.livreurId,
          });
        }
      }
      await tx.order.update({
        where: { id },
        data: { livreurId: input.livreurId, version: { increment: 1 } },
      });
      await this.audit.log(tx, {
        action: 'ORDER_LIVREUR_ASSIGNED',
        entity: 'Order',
        entityId: id,
        before: { livreurId: current.livreurId },
        after: input,
      });
    });
    return this.get(id, user);
  }

  // ---------------------------------------------------------------- deliver

  /**
   * One transaction: the BL of the delivered quantities (stock, ledger, BL number, credit
   * check, payment), then the order marked DELIVERED with what was not delivered.
   * A second deliver waits on the order lock, then finds it DELIVERED.
   */
  async deliver(
    id: string,
    input: DeliverOrderInput,
    user: CurrentUserInfo,
  ): Promise<DeliverOrderResultDto> {
    const result = await this.prisma.db.$transaction(async (tx) => {
      const current = await this.lockVisible(tx, id, user);
      if (current.status === OrderStatus.DELIVERED || current.saleId) {
        throw new AppException(ErrorCode.ORDER_ALREADY_DELIVERED, 'Already delivered', {
          saleId: current.saleId,
        });
      }
      if (current.status !== OrderStatus.CONFIRMED) {
        throw new AppException(ErrorCode.ORDER_NOT_CONFIRMED, 'Only a confirmed order', {
          status: current.status,
        });
      }
      const order = await tx.order.findUniqueOrThrow({
        where: { id },
        include: { lines: { orderBy: { position: 'asc' } } },
      });
      const wanted = new Map(input.lines.map((l) => [l.orderLineId, l.qty]));
      for (const lineId of wanted.keys()) {
        if (!order.lines.some((l) => l.id === lineId)) {
          throw new AppException(ErrorCode.ORDER_DELIVERY_QTY_INVALID, 'Unknown order line', {
            orderLineId: lineId,
          });
        }
      }
      const split = order.lines.map((l) => {
        const delivered = qty(wanted.get(l.id) ?? '0');
        if (delivered.gt(l.qty.toString())) {
          throw new AppException(ErrorCode.ORDER_DELIVERY_QTY_INVALID, 'More than ordered', {
            orderLineId: l.id,
            ordered: toQtyString(l.qty.toString()),
          });
        }
        return { line: l, delivered, notDelivered: qty(l.qty.toString()).minus(delivered) };
      });
      const deliveredLines = split.filter((s) => s.delivered.gt(0));
      if (deliveredLines.length === 0) {
        throw new AppException(ErrorCode.ORDER_DELIVERY_QTY_INVALID, 'Nothing delivered', {
          rule: 'nothing_delivered',
        });
      }

      // The order's dépôt, else the deliverer's truck, else MAIN (never the seller's truck:
      // the goods are not on it).
      const warehouseId =
        order.warehouseId ??
        (await this.warehouses.vehicleOf(tx, user.id)) ??
        (await this.warehouses.defaultId(tx));
      // The cash is with the assigned livreur, even when the office records the delivery.
      const collectedBy = order.livreurId ?? user.id;
      const { saleId, warnings, change } = await this.workflow.deliverOrderInTx(
        tx,
        {
          type: SaleType.BL,
          clientId: order.clientId,
          documentDate: algiersDay(this.clock.now()),
          note: order.number,
          warehouseId,
          lines: deliveredLines.map(({ line, delivered }) => ({
            productId: line.productId,
            unitId: line.unitId,
            qty: delivered.toString(),
            unitPriceHt: line.unitPriceHt.toString(),
            discountPct: line.discountPct.toString(),
          })),
        },
        input,
        user,
        { sellerId: order.sellerId, collectedBy },
      );
      for (const s of split) {
        await tx.orderLine.update({
          where: { id: s.line.id },
          data: {
            qtyDelivered: s.delivered.toString(),
            qtyNotDelivered: s.notDelivered.toString(),
          },
        });
      }
      await tx.order.update({
        where: { id },
        data: {
          status: OrderStatus.DELIVERED,
          saleId,
          warehouseId,
          deliveredAt: new Date(),
          deliveredBy: user.id,
          version: { increment: 1 },
        },
      });
      await this.audit.log(tx, {
        action: 'ORDER_DELIVERED',
        entity: 'Order',
        entityId: id,
        after: {
          saleId,
          warehouseId,
          collectedBy,
          lines: split.map((s) => ({
            orderLineId: s.line.id,
            delivered: s.delivered.toString(),
            notDelivered: s.notDelivered.toString(),
          })),
        },
      });
      return { saleId, warnings, change };
    });
    const [order, sale] = await Promise.all([
      this.get(id, user),
      this.prisma.db.sale.findUniqueOrThrow({
        where: { id: result.saleId },
        select: { id: true, number: true, totalTtc: true },
      }),
    ]);
    return {
      order,
      sale: { id: sale.id, number: sale.number, totalTtc: toMoneyString(sale.totalTtc.toString()) },
      warnings: result.warnings,
      change: result.change,
    };
  }

  // ---------------------------------------------------------------- reads

  async get(id: string, user: CurrentUserInfo): Promise<OrderDto> {
    const where = await this.visibleWhere(user);
    const o = await this.prisma.db.order.findFirst({
      where: { id, ...where },
      include: orderInclude,
    });
    if (!o) throw new AppException(ErrorCode.ORDER_NOT_FOUND, 'Order not found');
    const available = await this.available([o]);
    return this.toDto(o, available.get(o.id) ?? new Map<string, string>());
  }

  async list(query: OrderListQuery, user: CurrentUserInfo): Promise<OrderPage> {
    const where = await this.visibleWhere(user);
    const requestedDate: Prisma.DateTimeNullableFilter = {};
    if (query.from) requestedDate.gte = fromIsoDate(query.from);
    if (query.to) requestedDate.lte = fromIsoDate(query.to);
    const rows = await this.prisma.db.order.findMany({
      where: {
        AND: [
          where,
          query.status ? { status: query.status } : {},
          query.sellerId ? { sellerId: query.sellerId } : {},
          query.livreurId ? { livreurId: query.livreurId } : {},
          query.clientId ? { clientId: query.clientId } : {},
          query.from || query.to ? { requestedDate } : {},
        ],
      },
      include: orderInclude,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const page = rows.slice(0, query.limit);
    const available = await this.available(page.filter((o) => o.status === OrderStatus.CONFIRMED));
    return {
      items: page.map((o) => {
        const stock = available.get(o.id);
        return {
          id: o.id,
          number: o.number,
          status: o.status,
          client: { id: o.client.id, code: o.client.code, name: o.client.name },
          seller: o.seller,
          livreur: o.livreur,
          requestedDate: o.requestedDate ? toIsoDate(o.requestedDate) : null,
          totalTtc: toMoneyString(o.totalTtc.toString()),
          lineCount: o.lines.length,
          shortLines: stock
            ? o.lines.filter((l) => qty(stock.get(l.productId) ?? '0').lt(l.qtyBase.toString()))
                .length
            : 0,
          sale: o.sale,
          createdAt: o.createdAt.toISOString(),
        };
      }),
      nextCursor: rows.length > query.limit ? (page.at(-1)?.id ?? null) : null,
    };
  }

  /** Live users an order can be put on: livreurs, and sellers who deliver themselves. */
  async deliverers(): Promise<DelivererDto[]> {
    const users = await this.prisma.db.user.findMany({
      where: { deletedAt: null, role: { in: [...DELIVERING_ROLES] } },
      select: { id: true, fullName: true, role: true },
      orderBy: [{ role: 'asc' }, { fullName: 'asc' }],
    });
    return users.map((u) => ({ ...u, role: u.role as DelivererDto['role'] }));
  }

  // ---------------------------------------------------------------- helpers

  /**
   * Owner, manager and storekeeper see every order; a supervisor his team's, a seller his
   * own, a livreur only those assigned to him.
   */
  private async visibleWhere(user: CurrentUserInfo, db?: Tx): Promise<Prisma.OrderWhereInput> {
    switch (user.role) {
      case Role.OWNER:
      case Role.MANAGER:
      case Role.STOREKEEPER:
        return {};
      case Role.LIVREUR:
        return { livreurId: user.id };
      case Role.SUPERVISOR:
        return { sellerId: { in: await this.scope.teamIds(user.id, db) } };
      default:
        // A seller also delivers the orders put on him.
        return { OR: [{ sellerId: user.id }, { livreurId: user.id }] };
    }
  }

  /** Locks the order row (after checking the user may see it). */
  private async lockVisible(tx: Tx, id: string, user: CurrentUserInfo) {
    const where = await this.visibleWhere(user, tx);
    const visible = await tx.order.findFirst({ where: { id, ...where }, select: { id: true } });
    if (!visible) throw new AppException(ErrorCode.ORDER_NOT_FOUND, 'Order not found');
    const rows = await tx.$queryRaw<
      {
        status: OrderStatus;
        version: number;
        sellerId: string | null;
        livreurId: string | null;
        saleId: string | null;
      }[]
    >`
      SELECT status, version, "sellerId", "livreurId", "saleId" FROM orders
      WHERE id = ${id}::uuid AND "tenantId" = ${tenantContext.requireTenantId()}::uuid
      FOR UPDATE`;
    const row = rows[0];
    if (!row) throw new AppException(ErrorCode.ORDER_NOT_FOUND, 'Order not found');
    return row;
  }

  private async checkHeader(
    tx: Tx,
    input: CreateOrderInput,
    user: CurrentUserInfo,
    currentSellerId: string | null | undefined,
  ): Promise<{ sellerId: string | null | undefined; warehouseId: string | null }> {
    await this.sales.checkClient(tx, input.clientId, user);
    const sellerId = await this.sales.resolveSeller(tx, user, input.sellerId, currentSellerId);
    const warehouseId = input.warehouseId
      ? await this.warehouses.resolve(tx, input.warehouseId)
      : null;
    return { sellerId, warehouseId };
  }

  /** Draft lines at the client's level; prices are checked at confirmation. */
  private async snapshot(tx: Tx, input: CreateOrderInput) {
    const priceLevelId = await resolvePriceLevel(tx, input.clientId);
    const assujetti = await this.sales.assujettiTva(tx);
    const { lines, totals } = await snapshotSaleLines(tx, input.lines, priceLevelId, assujetti);
    return { lines, totals, assujetti, priceLevelId };
  }

  /** Stock now in each order's delivery dépôt (its own, else MAIN), per product. */
  private async available(orders: OrderRow[]): Promise<Map<string, Map<string, string>>> {
    const out = new Map<string, Map<string, string>>();
    if (orders.length === 0) return out;
    const defaultId = await this.warehouses.defaultId();
    const byWarehouse = new Map<string, OrderRow[]>();
    for (const o of orders) {
      const w = o.warehouseId ?? defaultId;
      byWarehouse.set(w, [...(byWarehouse.get(w) ?? []), o]);
    }
    for (const [warehouseId, list] of byWarehouse) {
      const productIds = list.flatMap((o) => o.lines.map((l) => l.productId));
      const quantities = await this.stock.warehouseQuantities(
        this.prisma.db,
        warehouseId,
        productIds,
      );
      for (const o of list) {
        out.set(
          o.id,
          new Map(
            o.lines.map((l) => [l.productId, (quantities.get(l.productId) ?? qty(0)).toString()]),
          ),
        );
      }
    }
    return out;
  }

  private toDto(o: OrderRow, available: Map<string, string>): OrderDto {
    const q = (d: Prisma.Decimal | null) => (d === null ? null : toQtyString(d.toString()));
    return {
      id: o.id,
      number: o.number,
      status: o.status,
      client: o.client,
      seller: o.seller,
      livreur: o.livreur,
      warehouse: o.warehouse,
      requestedDate: o.requestedDate ? toIsoDate(o.requestedDate) : null,
      note: o.note,
      assujettiTva: o.assujettiTva,
      totalHt: toMoneyString(o.totalHt.toString()),
      totalTva: toMoneyString(o.totalTva.toString()),
      totalTtc: toMoneyString(o.totalTtc.toString()),
      sale: o.sale,
      cancelReason: o.cancelReason,
      createdAt: o.createdAt.toISOString(),
      confirmedAt: o.confirmedAt?.toISOString() ?? null,
      deliveredAt: o.deliveredAt?.toISOString() ?? null,
      cancelledAt: o.cancelledAt?.toISOString() ?? null,
      version: o.version,
      lines: o.lines.map((l) => ({
        id: l.id,
        position: l.position,
        productId: l.productId,
        reference: l.product.reference,
        designation: l.designation,
        unitId: l.unitId,
        unitCode: l.unitCode,
        factorToBase: toQtyString(l.factorToBase.toString()),
        qty: toQtyString(l.qty.toString()),
        qtyBase: toQtyString(l.qtyBase.toString()),
        unitPriceHt: toMoneyString(l.unitPriceHt.toString()),
        discountPct: money(l.discountPct.toString()).toFixed(2),
        tvaRate: money(l.tvaRate.toString()).toFixed(2),
        lineHt: toMoneyString(l.lineHt.toString()),
        qtyDelivered: q(l.qtyDelivered),
        qtyNotDelivered: q(l.qtyNotDelivered),
        availableBase: toQtyString(available.get(l.productId) ?? '0'),
      })),
    };
  }
}
