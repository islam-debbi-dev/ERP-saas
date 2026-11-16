import { Injectable } from '@nestjs/common';
import {
  proportionalFree,
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
  WarehouseType,
  addDays,
} from '@erp/shared';
import { AuditService } from '../audit/audit.service';
import { type CurrentUserInfo } from '../auth/auth.types';
import { ClockService } from '../clock/clock.service';
import { AppException } from '../common/app-exception';
import { tenantContext } from '../common/tenant-context';
import { DocumentNumberingService } from '../documents/document-numbering.service';
import { Prisma } from '../generated/prisma/client';
import { algiersMidnight } from '../common/algiers';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import { fromIsoDate, toIsoDate } from '../sales/sale.mapper';
import { PricingService } from '../promotions/pricing.service';
import { type PromotionFields, resolvePriceLevel } from '../sales/sale-lines';
import { SaleWorkflowService } from '../sales/sale-workflow.service';
import { SalesService } from '../sales/sales.service';
import { ScopeService } from '../sales-force/scope.service';
import { StockService } from '../stock/stock.service';
import { VehiclesService } from '../stock/vehicles.service';
import { WarehousesService } from '../stock/warehouses.service';

const orderInclude = {
  client: { select: { id: true, code: true, name: true, phone: true } },
  seller: { select: { id: true, fullName: true } },
  livreur: { select: { id: true, fullName: true } },
  warehouse: { select: { id: true, name: true } },
  vehicle: { select: { id: true, code: true, name: true } },
  deliveryVehicle: { select: { id: true, code: true, name: true } },
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
 * Trucks (phase 36): an order freezes the prévendeur's truck when it is taken. A confirmed
 * order can be put on a delivery truck instead of a person: it then follows the truck (its
 * driver of the day sees it, delivers it and holds the cash), and at delivery the truck the
 * BL left from is frozen as the delivery truck.
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
    private readonly pricing: PricingService,
    private readonly vehicles: VehiclesService,
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
          // Frozen: the truck the prévendeur drives now (phase 36).
          vehicleId: (await this.vehicles.currentVehicleOf(header.sellerId, tx))?.id ?? null,
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
      // Free lines are not input: the promotions of the confirmation day give them again.
      const input: SaleLineInput[] = order.lines
        .filter((l) => !l.isFree)
        .map((l) => ({
          productId: l.productId,
          unitId: l.unitId,
          qty: l.qty.toString(),
          // A price typed on the draft stays; a list price follows today's level.
          ...(l.listPriceHt === null || !l.listPriceHt.eq(l.unitPriceHt)
            ? { unitPriceHt: l.unitPriceHt.toString() }
            : {}),
          // A promotion's remise follows today's promotions too.
          discountPct: l.promotionId ? '0' : l.discountPct.toString(),
        }));
      // Phase 24: confirmed only for what the order's dépôt sells.
      if (order.warehouseId) {
        await this.warehouses.assertSells(
          tx,
          user,
          order.warehouseId,
          input.map((l) => l.productId),
        );
      }
      const priceLevelId = await resolvePriceLevel(tx, order.clientId);
      const assujetti = await this.sales.assujettiTva(tx);
      const { lines, totals, overrides, promoOverrides } = await this.pricing.priceLines(
        tx,
        input,
        { clientId: order.clientId, priceLevelId, assujettiTva: assujetti },
      );
      await this.sales.checkOverrides(tx, overrides, user);
      await this.pricing.checkPromoOverrides(tx, promoOverrides, user, { entity: 'Order', id });
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
      // A delivery truck wins over a person: the livreur is whoever drives it.
      let livreurId = input.livreurId;
      let deliveryVehicleId = input.deliveryVehicleId;
      if (deliveryVehicleId) {
        const truck = await this.vehicles.assertVehicle(tx, deliveryVehicleId);
        await this.scope.assertWarehouse(tx, user, deliveryVehicleId);
        livreurId = truck.assignedUserId;
      } else {
        // A person named alone takes the order off its truck.
        if (livreurId !== undefined && deliveryVehicleId === undefined) deliveryVehicleId = null;
        if (livreurId) {
          const u = await tx.user.findFirst({
            where: { id: livreurId, deletedAt: null, role: { in: [...DELIVERING_ROLES] } },
            select: { id: true },
          });
          if (!u) {
            throw new AppException(ErrorCode.SELLER_NOT_ALLOWED, 'This user cannot deliver', {
              userId: livreurId,
            });
          }
        }
      }
      await tx.order.update({
        where: { id },
        data: { livreurId, deliveryVehicleId, version: { increment: 1 } },
      });
      await this.audit.log(tx, {
        action: 'ORDER_LIVREUR_ASSIGNED',
        entity: 'Order',
        entityId: id,
        before: { livreurId: current.livreurId, deliveryVehicleId: current.deliveryVehicleId },
        after: { livreurId, deliveryVehicleId },
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
      // Free units go with their paid line, in proportion (shared `proportionalFree`).
      const units = await tx.unit.findMany({
        where: { id: { in: [...new Set(order.lines.map((l) => l.unitId))] } },
        select: { id: true, allowsDecimal: true },
      });
      const decimalUnit = new Map(units.map((u) => [u.id, u.allowsDecimal]));
      for (const l of order.lines) {
        if (!l.isFree) continue;
        const paid = order.lines.find((p) => !p.isFree && p.position === l.freeOfPosition);
        wanted.set(
          l.id,
          paid
            ? proportionalFree(
                l.qty.toString(),
                paid.qty.toString(),
                wanted.get(paid.id) ?? '0',
                !(decimalUnit.get(l.unitId) ?? false),
              ).toString()
            : '0',
        );
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
      // Positions on the BL, so a free line still points to its paid line.
      const blPosition = new Map(deliveredLines.map((d, i) => [d.line.position, i + 1]));
      const promotions: PromotionFields[] = deliveredLines.map(({ line }) => ({
        isFree: line.isFree,
        promotionId: line.promotionId,
        promotionName: line.promotionName,
        freeOfPosition:
          line.freeOfPosition === null ? null : (blPosition.get(line.freeOfPosition) ?? null),
      }));
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
      await this.scope.assertWarehouse(tx, user, warehouseId);
      // The cash is with the assigned livreur, even when the office records the delivery.
      // An order on a delivery truck follows the truck: its driver of today, not the one
      // it had when the order was assigned (phase 36).
      const truckDriver = order.deliveryVehicleId
        ? (await this.vehicles.driversOf([order.deliveryVehicleId], tx)).get(
            order.deliveryVehicleId,
          )?.id
        : undefined;
      const collectedBy = order.deliveryVehicleId
        ? (truckDriver ?? user.id)
        : (order.livreurId ?? user.id);
      // Frozen: the truck the BL leaves from, else the truck the order was put on.
      const blWarehouse = await tx.warehouse.findFirst({
        where: { id: warehouseId },
        select: { type: true },
      });
      const deliveryVehicleId =
        blWarehouse?.type === WarehouseType.VEHICLE ? warehouseId : order.deliveryVehicleId;
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
        { sellerId: order.sellerId, collectedBy, promotions },
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
          deliveryVehicleId,
          ...(order.deliveryVehicleId ? { livreurId: collectedBy } : {}),
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
          deliveryVehicleId,
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
    return this.toDto(
      o,
      available.get(o.id) ?? new Map<string, string>(),
      await this.truckDrivers([o]),
    );
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
          // "His deliveries" include the confirmed orders on the truck he drives now.
          query.livreurId ? { OR: await this.deliveredBy(query.livreurId) } : {},
          query.vehicleId ? { vehicleId: query.vehicleId } : {},
          query.deliveryVehicleId ? { deliveryVehicleId: query.deliveryVehicleId } : {},
          query.clientId ? { clientId: query.clientId } : {},
          query.warehouseId ? { warehouseId: query.warehouseId } : {},
          query.from || query.to ? { requestedDate } : {},
          query.confirmedFrom || query.confirmedTo
            ? {
                confirmedAt: {
                  ...(query.confirmedFrom ? { gte: algiersMidnight(query.confirmedFrom) } : {}),
                  ...(query.confirmedTo
                    ? { lt: algiersMidnight(addDays(query.confirmedTo, 1)) }
                    : {}),
                },
              }
            : {},
        ],
      },
      include: orderInclude,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const page = rows.slice(0, query.limit);
    const available = await this.available(page.filter((o) => o.status === OrderStatus.CONFIRMED));
    const drivers = await this.truckDrivers(page);
    return {
      items: page.map((o) => {
        const stock = available.get(o.id);
        return {
          id: o.id,
          number: o.number,
          status: o.status,
          client: { id: o.client.id, code: o.client.code, name: o.client.name },
          seller: o.seller,
          livreur: this.livreurOf(o, drivers),
          deliveryVehicle: o.deliveryVehicle,
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
  /**
   * Draft orders this user may confirm, oldest first (phase 33, "À faire"): the same
   * visibility as the list; storekeepers and livreurs do not confirm.
   */
  async toConfirm(
    user: CurrentUserInfo,
    limit: number,
  ): Promise<{ id: string; client: string; totalTtc: string; createdAt: Date }[]> {
    if (!([Role.OWNER, Role.MANAGER, Role.SUPERVISOR, Role.SELLER] as Role[]).includes(user.role))
      return [];
    const rows = await this.prisma.db.order.findMany({
      where: { AND: [await this.visibleWhere(user), { status: OrderStatus.DRAFT }] },
      select: { id: true, totalTtc: true, createdAt: true, client: { select: { name: true } } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: limit,
    });
    return rows.map((o) => ({
      id: o.id,
      client: o.client.name,
      totalTtc: toMoneyString(o.totalTtc.toString()),
      createdAt: o.createdAt,
    }));
  }

  private async visibleWhere(user: CurrentUserInfo, db?: Tx): Promise<Prisma.OrderWhereInput> {
    const own = await this.ownWhere(user, db);
    // Phase 24: and only the orders of the dépôts he works in.
    const scope = await this.scope.of(user, db);
    const w = this.scope.warehouseWhere(scope, scope.warehouseIds, 'createdBy');
    return w ? { AND: [own, w] } : own;
  }

  private async ownWhere(user: CurrentUserInfo, db?: Tx): Promise<Prisma.OrderWhereInput> {
    switch (user.role) {
      case Role.OWNER:
      case Role.MANAGER:
      case Role.STOREKEEPER:
        return {};
      case Role.LIVREUR:
        return { OR: await this.deliveredBy(user.id, db) };
      case Role.SUPERVISOR:
        return { sellerId: { in: await this.scope.teamIds(user.id, db) } };
      default:
        // A seller also delivers the orders put on him.
        return { OR: [{ sellerId: user.id }, ...(await this.deliveredBy(user.id, db))] };
    }
  }

  /**
   * The orders a user delivers: those put on him, and (phase 36) the confirmed orders put
   * on the truck he drives now. An order on a truck follows the truck: once its driver
   * changes, the previous one no longer has it; a delivered one stays with who delivered.
   */
  private async deliveredBy(userId: string, db?: Tx): Promise<Prisma.OrderWhereInput[]> {
    const truck = await this.vehicles.currentVehicleOf(userId, db);
    return [
      { livreurId: userId, deliveryVehicleId: null },
      {
        livreurId: userId,
        deliveryVehicleId: { not: null },
        status: { not: OrderStatus.CONFIRMED },
      },
      ...(truck ? [{ deliveryVehicleId: truck.id, status: OrderStatus.CONFIRMED }] : []),
    ];
  }

  /** Today's drivers of the delivery trucks of confirmed orders. */
  private async truckDrivers(
    orders: { status: string; deliveryVehicleId: string | null }[],
  ): Promise<Map<string, { id: string; fullName: string }>> {
    return this.vehicles.driversOf([
      ...new Set(
        orders
          .filter((o) => o.status === OrderStatus.CONFIRMED && o.deliveryVehicleId)
          .map((o) => o.deliveryVehicleId!),
      ),
    ]);
  }

  /** Who delivers: the driver of today of the order's truck while it waits, else the livreur. */
  private livreurOf(
    o: Pick<OrderRow, 'status' | 'deliveryVehicleId' | 'livreur'>,
    drivers: Map<string, { id: string; fullName: string }>,
  ): { id: string; fullName: string } | null {
    if (o.status === OrderStatus.CONFIRMED && o.deliveryVehicleId) {
      return drivers.get(o.deliveryVehicleId) ?? null;
    }
    return o.livreur;
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
        deliveryVehicleId: string | null;
        saleId: string | null;
      }[]
    >`
      SELECT status, version, "sellerId", "livreurId", "deliveryVehicleId", "saleId" FROM orders
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
    // A user who works in one dépôt takes orders for it (phase 24), and only for what it sells.
    const warehouseId = input.warehouseId
      ? await this.warehouses.resolve(tx, input.warehouseId)
      : await this.scope.onlyWarehouse(user, tx);
    if (warehouseId) {
      await this.scope.assertWarehouse(tx, user, warehouseId);
      await this.warehouses.assertSells(
        tx,
        user,
        warehouseId,
        input.lines.map((l) => l.productId),
      );
    }
    return { sellerId, warehouseId };
  }

  /** Draft lines at the client's level; prices are checked at confirmation. */
  private async snapshot(tx: Tx, input: CreateOrderInput) {
    const priceLevelId = await resolvePriceLevel(tx, input.clientId);
    const assujetti = await this.sales.assujettiTva(tx);
    const { lines, totals } = await this.pricing.priceLines(tx, input.lines, {
      clientId: input.clientId,
      priceLevelId,
      assujettiTva: assujetti,
    });
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

  private toDto(
    o: OrderRow,
    available: Map<string, string>,
    drivers: Map<string, { id: string; fullName: string }>,
  ): OrderDto {
    const q = (d: Prisma.Decimal | null) => (d === null ? null : toQtyString(d.toString()));
    return {
      id: o.id,
      number: o.number,
      status: o.status,
      client: o.client,
      seller: o.seller,
      livreur: this.livreurOf(o, drivers),
      vehicle: o.vehicle,
      deliveryVehicle: o.deliveryVehicle,
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
        isFree: l.isFree,
        promotion:
          l.promotionId && l.promotionName ? { id: l.promotionId, name: l.promotionName } : null,
        freeOfPosition: l.freeOfPosition,
      })),
    };
  }
}
