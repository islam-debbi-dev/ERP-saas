import { Injectable } from '@nestjs/common';
import {
  type CreateSaleInput,
  ErrorCode,
  money,
  Permission,
  type PricePreviewDto,
  type PricePreviewQuery,
  type ReassignSellerInput,
  Role,
  type SaleDto,
  type SaleListQuery,
  type SalePage,
  SaleStatus,
  SaleType,
  toMoneyString,
  type UpdateSaleInput,
  addDays,
  type SaleListSummary,
  isTeamLead,
  isFieldSeller,
} from '@erp/shared';
import { AuditService } from '../audit/audit.service';
import type { CurrentUserInfo } from '../auth/auth.types';
import { can, requirePermission } from '../auth/permissions';
import { algiersMidnight } from '../common/algiers';
import { AppException } from '../common/app-exception';
import { tenantContext } from '../common/tenant-context';
import { type Prisma } from '../generated/prisma/client';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import { ScopeService } from '../sales-force/scope.service';
import { WarehousesService } from '../stock/warehouses.service';
import { fromIsoDate, saleInclude, toIsoDate, toSaleDto } from './sale.mapper';
import { PackagingLedgerService } from '../packaging/packaging-ledger.service';
import { PricingService } from '../promotions/pricing.service';
import {
  carryPromotions,
  type PriceOverride,
  type PromotionFields,
  resolvePriceLevel,
  snapshotSaleLines,
} from './sale-lines';

/** Sale drafts and reads. Effects (stock, account, payments) live in SaleWorkflowService. */
@Injectable()
export class SalesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly scope: ScopeService,
    private readonly warehouses: WarehousesService,
    private readonly pricing: PricingService,
    private readonly packaging: PackagingLedgerService,
  ) {}

  async create(input: CreateSaleInput, user: CurrentUserInfo): Promise<SaleDto> {
    const id = await this.prisma.db.$transaction((tx) => this.createDraftInTx(tx, input, user));
    return this.get(id, user);
  }

  /** Also used by the quick sale, which validates in the same transaction. */
  async createDraftInTx(
    tx: Tx,
    input: CreateSaleInput,
    user: CurrentUserInfo,
    /**
     * Set when the sale is the BL of a delivered bon de commande (phase 16): its prices were
     * checked at confirmation and its seller is the order's, whoever delivers.
     */
    fromOrder?: {
      sellerId: string | null;
      /** The order lines' promotion fields, same order as `input.lines` (phase 20). */
      promotions: PromotionFields[];
    },
  ): Promise<string> {
    const tenantId = tenantContext.requireTenantId();
    await this.checkClient(tx, input.clientId, user);
    const sellerId = fromOrder
      ? fromOrder.sellerId
      : ((await this.resolveSeller(tx, user, input.sellerId, undefined)) ?? null);
    // Checked now (exists, module); the final choice is made at validation. A user who
    // works in one dépôt only sells from it (phase 24), unless the seller drives a truck:
    // then no dépôt is fixed here and validation takes the truck (phase 15; audit 02, A-1).
    const warehouseId = input.warehouseId
      ? await this.warehouses.resolve(tx, input.warehouseId)
      : (await this.warehouses.vehicleOf(tx, sellerId))
        ? null
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
    const priceLevelId = await resolvePriceLevel(tx, input.clientId);
    const assujetti = await this.assujettiTva(tx);
    // An order's BL keeps the order's lines as they are, free lines included (phase 20).
    const { lines, totals, overrides, promoOverrides } = fromOrder
      ? await snapshotSaleLines(tx, input.lines, priceLevelId, assujetti).then((r) => ({
          ...r,
          lines: carryPromotions(r.lines, fromOrder.promotions),
          promoOverrides: [],
        }))
      : await this.pricing.priceLines(tx, input.lines, {
          clientId: input.clientId,
          priceLevelId,
          assujettiTva: assujetti,
        });
    if (!fromOrder) await this.checkOverrides(tx, overrides, user);
    const sale = await tx.sale.create({
      data: {
        tenantId,
        type: input.type,
        clientId: input.clientId,
        documentDate: fromIsoDate(input.documentDate),
        priceLevelId,
        note: input.note,
        assujettiTva: assujetti,
        totalHt: totals.totalHt.toString(),
        totalTva: totals.totalTva.toString(),
        totalTtc: totals.totalTtc.toString(),
        createdBy: user.id,
        sellerId,
        warehouseId,
      },
    });
    if (lines.length > 0) {
      await tx.saleLine.createMany({
        data: lines.map((l) => ({ ...l, tenantId, saleId: sale.id })),
      });
    }
    await this.audit.log(tx, {
      action: 'SALE_DRAFT_CREATED',
      entity: 'Sale',
      entityId: sale.id,
      after: {
        type: input.type,
        clientId: input.clientId,
        sellerId,
        warehouseId,
        lines: input.lines,
        overrides,
        promoOverrides,
      },
    });
    await this.pricing.checkPromoOverrides(tx, promoOverrides, user, {
      entity: 'Sale',
      id: sale.id,
    });
    return sale.id;
  }

  /** Replaces the draft (header and lines). `version` guards against concurrent edits. */
  async update(id: string, input: UpdateSaleInput, user: CurrentUserInfo): Promise<SaleDto> {
    await this.prisma.db.$transaction(async (tx) => {
      await this.assertInScope(tx, user, id);
      const current = await lockSale(tx, id);
      if (current.status !== SaleStatus.DRAFT) {
        throw new AppException(ErrorCode.SALE_NOT_DRAFT, 'Only a draft can be edited', {
          status: current.status,
        });
      }
      if (current.version !== input.version) {
        throw new AppException(ErrorCode.SALE_MODIFIED, 'Sale changed since it was read', {
          currentVersion: current.version,
        });
      }
      await this.checkClient(tx, input.clientId, user);
      const sellerId = await this.resolveSeller(tx, user, input.sellerId, current.sellerId);
      const warehouseId = input.warehouseId
        ? await this.warehouses.resolve(tx, input.warehouseId)
        : input.warehouseId;
      const lineWarehouseId = warehouseId === undefined ? current.warehouseId : warehouseId;
      if (lineWarehouseId) {
        await this.scope.assertWarehouse(tx, user, lineWarehouseId);
        await this.warehouses.assertSells(
          tx,
          user,
          lineWarehouseId,
          input.lines.map((l) => l.productId),
        );
      }
      const priceLevelId = await resolvePriceLevel(tx, input.clientId);
      const assujetti = await this.assujettiTva(tx);
      const { lines, totals, overrides, promoOverrides } = await this.pricing.priceLines(
        tx,
        input.lines,
        { clientId: input.clientId, priceLevelId, assujettiTva: assujetti },
      );
      await this.checkOverrides(tx, overrides, user);
      await this.pricing.checkPromoOverrides(tx, promoOverrides, user, { entity: 'Sale', id });
      // Draft lines have no effect anywhere, so they are simply replaced.
      await tx.saleLine.deleteMany({ where: { saleId: id } });
      if (lines.length > 0) {
        const tenantId = tenantContext.requireTenantId();
        await tx.saleLine.createMany({ data: lines.map((l) => ({ ...l, tenantId, saleId: id })) });
      }
      await tx.sale.update({
        where: { id },
        data: {
          type: input.type,
          clientId: input.clientId,
          documentDate: fromIsoDate(input.documentDate),
          priceLevelId,
          note: input.note,
          assujettiTva: assujetti,
          totalHt: totals.totalHt.toString(),
          totalTva: totals.totalTva.toString(),
          totalTtc: totals.totalTtc.toString(),
          ...(sellerId !== undefined ? { sellerId } : {}),
          ...(warehouseId !== undefined ? { warehouseId } : {}),
          version: { increment: 1 },
        },
      });
      await this.audit.log(tx, {
        action: 'SALE_DRAFT_UPDATED',
        entity: 'Sale',
        entityId: id,
        after: {
          type: input.type,
          clientId: input.clientId,
          sellerId: sellerId === undefined ? current.sellerId : sellerId,
          ...(warehouseId !== undefined ? { warehouseId } : {}),
          lines: input.lines,
          overrides,
          promoOverrides,
        },
      });
    });
    return this.get(id, user);
  }

  /**
   * One sale. With a user, a sale outside his scope (phase 14) answers 404; without
   * one (share links, internal reads after a write already checked) it is not scoped.
   */
  async get(id: string, user?: CurrentUserInfo): Promise<SaleDto> {
    const scope = user ? await this.scope.of(user) : null;
    const s = await this.prisma.db.sale.findFirst({
      where: { id, ...(scope ? this.scope.saleWhere(scope) : {}) },
      include: saleInclude,
    });
    if (!s) throw new AppException(ErrorCode.NOT_FOUND, 'Sale not found');
    // Sales before phase 14 have no sellerId: their creator is shown as the seller.
    const sellerUserId = s.sellerId ?? s.createdBy;
    const seller = sellerUserId
      ? await this.prisma.db.user.findUnique({
          where: { id: sellerUserId },
          select: { id: true, fullName: true },
        })
      : null;
    return toSaleDto(s, seller, await this.packaging.ofSale(this.prisma.db, s.id));
  }

  /**
   * Changes the seller of a validated sale (phase 14): SALE_REASSIGN_SELLER and a reason,
   * audited with before/after. A draft is simply edited. Phase 18 refuses it once the
   * month's incentives are approved (`assertSellerChangeAllowed`).
   */
  async reassignSeller(
    id: string,
    input: ReassignSellerInput,
    user: CurrentUserInfo,
  ): Promise<SaleDto> {
    requirePermission(user, Permission.SALE_REASSIGN_SELLER);
    await this.prisma.db.$transaction(async (tx) => {
      await this.assertInScope(tx, user, id);
      const current = await lockSale(tx, id);
      if (current.status !== SaleStatus.VALIDATED) {
        throw new AppException(
          ErrorCode.SALE_NOT_VALIDATED,
          'Only a validated sale is reassigned',
          {
            status: current.status,
          },
        );
      }
      const sale = await tx.sale.findUniqueOrThrow({
        where: { id },
        select: { sellerId: true, createdBy: true, validatedAt: true, number: true },
      });
      await this.scope.assertSellerChangeAllowed(tx, {
        kind: 'SALE',
        at: sale.validatedAt ?? new Date(),
      });
      if (input.sellerId) await this.scope.assertSeller(tx, input.sellerId);
      if (input.sellerId === sale.sellerId) return;
      await tx.sale.update({
        where: { id },
        data: { sellerId: input.sellerId, version: { increment: 1 } },
      });
      await this.audit.log(tx, {
        action: 'SALE_SELLER_REASSIGNED',
        entity: 'Sale',
        entityId: id,
        before: { sellerId: sale.sellerId, number: sale.number },
        after: { sellerId: input.sellerId, reason: input.reason },
      });
    });
    return this.get(id, user);
  }

  /**
   * 404 unless the sale is in the user's scope (phase 14: seller and team; phase 24: his
   * dépôts). Used by every write on a sale.
   */
  async assertInScope(tx: Tx, user: CurrentUserInfo, id: string): Promise<void> {
    const scope = await this.scope.of(user, tx);
    if (!scope.documentUserIds && !scope.warehouseIds) return;
    const s = await tx.sale.findFirst({
      where: { id, ...this.scope.saleWhere(scope) },
      select: { id: true },
    });
    if (!s) throw new AppException(ErrorCode.NOT_FOUND, 'Sale not found');
  }

  /** A BL or a facture by its number, in the user's scope (phase 30). */
  async findByNumber(number: string, user: CurrentUserInfo): Promise<SaleDto> {
    const scope = await this.scope.of(user);
    const s = await this.prisma.db.sale.findFirst({
      where: { number, ...this.scope.saleWhere(scope) },
      select: { id: true },
    });
    if (!s) throw new AppException(ErrorCode.NOT_FOUND, 'Sale not found');
    return this.get(s.id, user);
  }

  /** An avoir by its number: the user must be able to see the sale it was made on. */
  async findReturnByNumber(
    number: string,
    user: CurrentUserInfo,
  ): Promise<{ number: string; totalTtc: string; createdAt: string; sale: SaleDto }> {
    const r = await this.prisma.db.saleReturn.findFirst({
      where: { number },
      select: { number: true, totalTtc: true, createdAt: true, saleId: true },
    });
    if (!r) throw new AppException(ErrorCode.NOT_FOUND, 'Avoir not found');
    return {
      number: r.number,
      totalTtc: r.totalTtc.toString(),
      createdAt: r.createdAt.toISOString(),
      sale: await this.get(r.saleId, user),
    };
  }

  /** The sale an avoir was made on (printing an avoir starts from its id). */
  async saleIdOfReturn(returnId: string): Promise<string> {
    const r = await this.prisma.db.saleReturn.findUnique({
      where: { id: returnId },
      select: { saleId: true },
    });
    if (!r) throw new AppException(ErrorCode.NOT_FOUND, 'Avoir not found');
    return r.saleId;
  }

  async list(query: SaleListQuery, user: CurrentUserInfo): Promise<SalePage> {
    const scope = await this.scope.of(user);
    // Sales before phase 14 have no sellerId: they belong to their creator.
    const soldBy = (ids: string[]): Prisma.SaleWhereInput => ({
      OR: [{ sellerId: { in: ids } }, { sellerId: null, createdBy: { in: ids } }],
    });
    const team = query.teamOf ? await this.scope.teamIds(query.teamOf) : null;
    const where: Prisma.SaleWhereInput = {
      AND: [
        this.scope.saleWhere(scope),
        query.sellerId ? soldBy([query.sellerId]) : {},
        team ? soldBy(team) : {},
        query.brandId ? { lines: { some: { product: { brandId: query.brandId } } } } : {},
        query.warehouseId ? { warehouseId: query.warehouseId } : {},
        query.segmentId ? { client: { segmentId: query.segmentId } } : {},
        query.depotId ? await this.depotWhere(query.depotId) : {},
        query.validatedFrom || query.validatedTo
          ? {
              validatedAt: {
                ...(query.validatedFrom ? { gte: algiersMidnight(query.validatedFrom) } : {}),
                ...(query.validatedTo
                  ? { lt: algiersMidnight(addDays(query.validatedTo, 1)) }
                  : {}),
              },
            }
          : {},
      ],
      ...(query.type ? { type: query.type } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.clientId ? { clientId: query.clientId } : {}),
      ...(query.notInvoiced ? { type: SaleType.BL, invoiceId: null } : {}),
      ...(query.from || query.to
        ? {
            documentDate: {
              ...(query.from ? { gte: fromIsoDate(query.from) } : {}),
              ...(query.to ? { lte: fromIsoDate(query.to) } : {}),
            },
          }
        : {}),
    };
    const rows = await this.prisma.db.sale.findMany({
      where,
      include: {
        client: { select: { id: true, code: true, name: true } },
        invoice: { select: { id: true, number: true } },
        _count: { select: { lines: true } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const page = rows.slice(0, query.limit);
    const sellerOf = (s: { sellerId: string | null; createdBy: string | null }) =>
      s.sellerId ?? s.createdBy;
    const sellerIds = [...new Set(page.map(sellerOf).filter((u): u is string => !!u))];
    const sellers = await this.prisma.db.user.findMany({
      where: { id: { in: sellerIds } },
      select: { id: true, fullName: true },
    });
    const sellerById = new Map(sellers.map((u) => [u.id, u]));
    return {
      items: page.map((s) => ({
        id: s.id,
        type: s.type,
        number: s.number,
        status: s.status,
        client: s.client,
        documentDate: toIsoDate(s.documentDate),
        totalTtc: toMoneyString(s.totalTtc.toString()),
        paidAmount: toMoneyString(s.paidAmount.toString()),
        invoice: s.invoice,
        seller: sellerById.get(sellerOf(s) ?? '') ?? null,
        lineCount: s._count.lines,
      })),
      nextCursor: rows.length > query.limit ? (page.at(-1)?.id ?? null) : null,
      ...(query.summary && !query.cursor ? { summary: await this.summary(where, query) } : {}),
    };
  }

  /** The documents of a dépôt as the figures count them: its own, its trucks', and the
   *  ones without a dépôt when it is the dépôt principal. */
  private async depotWhere(depotId: string): Promise<Prisma.SaleWhereInput> {
    const ids = (await this.scope.figureWarehouses(null, depotId)) ?? [depotId];
    const main = await this.prisma.db.warehouse.findFirst({
      where: { id: depotId, isDefault: true },
      select: { id: true },
    });
    return main
      ? { OR: [{ warehouseId: { in: ids } }, { warehouseId: null }] }
      : { warehouseId: { in: ids } };
  }

  /**
   * What the documents of a filtered list add up to, with the definitions of the figures
   * (phase 37): validated documents, a facture that groups BLs left out, and the avoirs
   * made on them in the validation period subtracted. Opened from a statistic, the list
   * shows the same total as the figure that led to it.
   */
  private async summary(
    where: Prisma.SaleWhereInput,
    query: SaleListQuery,
  ): Promise<SaleListSummary> {
    const counted: Prisma.SaleWhereInput = {
      AND: [where, { status: SaleStatus.VALIDATED, sourceBls: { none: {} } }],
    };
    // The avoirs follow their own date: made in the period, on a sale that still counts.
    const saleOfReturn: Prisma.SaleWhereInput = {
      AND: [
        ...(where.AND as Prisma.SaleWhereInput[]).filter((w) => !('validatedAt' in w)),
        { status: SaleStatus.VALIDATED, sourceBls: { none: {} } },
      ],
      ...(query.type ? { type: query.type } : {}),
      ...(query.clientId ? { clientId: query.clientId } : {}),
    };
    const period =
      query.validatedFrom || query.validatedTo
        ? {
            createdAt: {
              ...(query.validatedFrom ? { gte: algiersMidnight(query.validatedFrom) } : {}),
              ...(query.validatedTo ? { lt: algiersMidnight(addDays(query.validatedTo, 1)) } : {}),
            },
          }
        : null;
    const [sales, returns] = await Promise.all([
      this.prisma.db.sale.aggregate({ where: counted, _count: true, _sum: { totalTtc: true } }),
      period
        ? this.prisma.db.saleReturn.aggregate({
            where: { ...period, sale: saleOfReturn },
            _sum: { totalTtc: true },
          })
        : null,
    ]);
    const total = money(sales._sum.totalTtc?.toString() ?? '0');
    const back = money(returns?._sum.totalTtc?.toString() ?? '0');
    return {
      count: sales._count,
      totalTtc: toMoneyString(total),
      returnsTtc: toMoneyString(back),
      netTtc: toMoneyString(total.minus(back)),
    };
  }

  /** The price the client would get for one product unit. */
  async pricePreview(query: PricePreviewQuery, user: CurrentUserInfo): Promise<PricePreviewDto> {
    const db = this.prisma.db;
    const unit = await db.productUnit.findFirst({
      where: { id: query.productUnitId, deletedAt: null },
      select: { id: true },
    });
    if (!unit) throw new AppException(ErrorCode.NOT_FOUND, 'Product unit not found');
    if (query.clientId) {
      const client = await db.client.findUnique({ where: { id: query.clientId } });
      if (!client) throw new AppException(ErrorCode.NOT_FOUND, 'Client not found');
      await this.scope.assertClient(db, user, query.clientId);
    }
    const priceLevelId = await db.$transaction((tx) =>
      resolvePriceLevel(tx, query.clientId ?? null),
    );
    const price = priceLevelId
      ? await db.productPrice.findUnique({
          where: { productUnitId_priceLevelId: { productUnitId: unit.id, priceLevelId } },
        })
      : null;
    return {
      productUnitId: unit.id,
      priceLevelId,
      priceHt: price ? toMoneyString(price.priceHt.toString()) : null,
    };
  }

  /**
   * A changed unit price needs PRICE_OVERRIDE. A remise up to the tenant's
   * `maxDiscountPct` is free; above it needs DISCOUNT_ABOVE_X. Also run when a bon de
   * commande is confirmed (phase 16).
   */
  async checkOverrides(tx: Tx, overrides: PriceOverride[], user: CurrentUserInfo): Promise<void> {
    if (overrides.length === 0) return;
    const priced = overrides.filter((o) => o.priceChanged);
    if (priced.length > 0 && !can(user, Permission.PRICE_OVERRIDE)) {
      throw new AppException(
        ErrorCode.PRICE_OVERRIDE_FORBIDDEN,
        'You may not change the price of a line',
        { permission: Permission.PRICE_OVERRIDE, lines: priced },
      );
    }
    if (can(user, Permission.DISCOUNT_ABOVE_X)) return;
    const { maxDiscountPct } = await tx.tenant.findUniqueOrThrow({
      where: { id: tenantContext.requireTenantId() },
      select: { maxDiscountPct: true },
    });
    const above = overrides.filter((o) => money(o.discountPct).gt(maxDiscountPct.toString()));
    if (above.length > 0) {
      throw new AppException(
        ErrorCode.PRICE_OVERRIDE_FORBIDDEN,
        'This discount is above what you may give',
        {
          permission: Permission.DISCOUNT_ABOVE_X,
          maxDiscountPct: maxDiscountPct.toString(),
          lines: above,
        },
      );
    }
  }

  async checkClient(tx: Tx, clientId: string | null, user: CurrentUserInfo): Promise<void> {
    if (!clientId) return;
    const c = await tx.client.findFirst({ where: { id: clientId, deletedAt: null } });
    if (!c) {
      throw new AppException(ErrorCode.VALIDATION_FAILED, 'Unknown client', { field: 'clientId' });
    }
    await this.scope.assertClient(tx, user, clientId);
  }

  /**
   * The seller to store (phase 14), on a sale or on a commande. `current` is undefined on a
   * create; the result is undefined when the stored seller does not change. A SELLER (and,
   * for a commande, a pré-vendeur) always acts in his own name; office roles pick any
   * seller, a team lead one of his team(s). A pré-vendeur is never the seller of a sale
   * typed here: only the BL of a commande he took keeps his name (phase 40b).
   */
  async resolveSeller(
    tx: Tx,
    user: CurrentUserInfo,
    requested: string | null | undefined,
    current: string | null | undefined,
    document: 'SALE' | 'ORDER' = 'SALE',
  ): Promise<string | null | undefined> {
    const creating = current === undefined;
    if (document === 'SALE' && user.role === Role.PREVENDEUR) {
      throw new AppException(ErrorCode.FORBIDDEN, 'A pre-seller does not sell');
    }
    if (isFieldSeller(user.role)) {
      const keeps = requested === undefined || requested === (creating ? user.id : current);
      if (!keeps) {
        throw new AppException(ErrorCode.FORBIDDEN, 'A seller cannot sell in the name of another', {
          field: 'sellerId',
        });
      }
      return creating ? user.id : undefined;
    }
    if (requested === undefined) return creating ? null : undefined;
    if (requested === current) return undefined;
    if (requested !== null) {
      if (document === 'ORDER') await this.scope.assertOrderTaker(tx, requested);
      else await this.scope.assertSeller(tx, requested);
      if (isTeamLead(user.role) && !(await this.scope.teamIds(user.id, tx)).includes(requested)) {
        throw new AppException(ErrorCode.FORBIDDEN, 'This seller is not in your team', {
          field: 'sellerId',
        });
      }
    }
    return requested;
  }

  async assujettiTva(tx: Tx): Promise<boolean> {
    const t = await tx.tenant.findUniqueOrThrow({
      where: { id: tenantContext.requireTenantId() },
      select: { assujettiTva: true },
    });
    return t.assujettiTva;
  }
}

/** Locks the sale row for the rest of the transaction. */
export async function lockSale(
  tx: Tx,
  id: string,
): Promise<{
  status: SaleStatus;
  version: number;
  sellerId: string | null;
  warehouseId: string | null;
}> {
  const rows = await tx.$queryRaw<
    { status: SaleStatus; version: number; sellerId: string | null; warehouseId: string | null }[]
  >`
    SELECT status, version, "sellerId", "warehouseId" FROM sales
    WHERE id = ${id}::uuid AND "tenantId" = ${tenantContext.requireTenantId()}::uuid
    FOR UPDATE`;
  const row = rows[0];
  if (!row) throw new AppException(ErrorCode.NOT_FOUND, 'Sale not found');
  return row;
}
