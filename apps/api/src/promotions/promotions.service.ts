import { Injectable } from '@nestjs/common';
import {
  algiersDay,
  ErrorCode,
  PromotionClientScope,
  type PromotionDto,
  type PromotionInput,
  type PromotionListQuery,
  type PromotionStatus,
  PromotionTarget,
  PromotionType,
  type PricingPreviewDto,
  type PricingPreviewInput,
  toMoneyString,
  toQtyString,
  type UpdatePromotionInput,
} from '@erp/shared';
import { AuditService } from '../audit/audit.service';
import type { CurrentUserInfo } from '../auth/auth.types';
import { ClockService } from '../clock/clock.service';
import { AppException } from '../common/app-exception';
import { tenantContext } from '../common/tenant-context';
import { type Prisma } from '../generated/prisma/client';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import { ScopeService } from '../sales-force/scope.service';
import { resolvePriceLevel } from '../sales/sale-lines';
import { fromIsoDate, toIsoDate } from '../sales/sale.mapper';
import { PricingService } from './pricing.service';

const promotionInclude = {
  products: { include: { product: { select: { id: true, reference: true, designation: true } } } },
  clients: { include: { client: { select: { id: true, code: true, name: true } } } },
} satisfies Prisma.PromotionInclude;
type PromotionRow = Prisma.PromotionGetPayload<{ include: typeof promotionInclude }>;

/**
 * Promotions master data (phase 20, PROMOTIONS). Editing one never changes a sale: lines
 * keep the promotion's name and what it gave when they were priced.
 */
@Injectable()
export class PromotionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly clock: ClockService,
    private readonly pricing: PricingService,
    private readonly scope: ScopeService,
  ) {}

  async list(query: PromotionListQuery): Promise<PromotionDto[]> {
    const today = fromIsoDate(algiersDay(this.clock.now()));
    const where: Prisma.PromotionWhereInput =
      query.status === 'active'
        ? { active: true, validFrom: { lte: today }, validTo: { gte: today } }
        : query.status === 'upcoming'
          ? { active: true, validFrom: { gt: today } }
          : { OR: [{ validTo: { lt: today } }, { active: false }] };
    const rows = await this.prisma.db.promotion.findMany({
      where: { deletedAt: null, ...where },
      include: promotionInclude,
      orderBy: [{ priority: 'desc' }, { validFrom: 'asc' }, { createdAt: 'asc' }],
      take: 200,
    });
    return this.toDtos(rows);
  }

  async get(id: string): Promise<PromotionDto> {
    const row = await this.prisma.db.promotion.findFirst({
      where: { id, deletedAt: null },
      include: promotionInclude,
    });
    if (!row) throw new AppException(ErrorCode.NOT_FOUND, 'Promotion not found');
    const [dto] = await this.toDtos([row]);
    if (!dto) throw new AppException(ErrorCode.NOT_FOUND, 'Promotion not found');
    return dto;
  }

  async create(input: PromotionInput, user: CurrentUserInfo): Promise<PromotionDto> {
    const id = await this.prisma.db.$transaction(async (tx) => {
      await this.checkRefs(tx, input);
      const tenantId = tenantContext.requireTenantId();
      const p = await tx.promotion.create({
        data: { tenantId, ...this.columns(input), createdBy: user.id },
      });
      await this.writeLinks(tx, p.id, input);
      await this.audit.log(tx, {
        action: 'PROMOTION_CREATED',
        entity: 'Promotion',
        entityId: p.id,
        after: input,
      });
      return p.id;
    });
    return this.get(id);
  }

  async update(id: string, body: UpdatePromotionInput): Promise<PromotionDto> {
    await this.prisma.db.$transaction(async (tx) => {
      const before = await this.lockLive(tx, id);
      if (before.version !== body.version) {
        throw new AppException(ErrorCode.CONFLICT, 'Promotion changed since it was read', {
          currentVersion: before.version,
        });
      }
      const input = body.promotion;
      await this.checkRefs(tx, input);
      await tx.promotion.update({
        where: { id },
        data: { ...this.columns(input), version: { increment: 1 } },
      });
      // Links are master data of the promotion, not history: replaced.
      await tx.promotionProduct.deleteMany({ where: { promotionId: id } });
      await tx.promotionClient.deleteMany({ where: { promotionId: id } });
      await this.writeLinks(tx, id, input);
      await this.audit.log(tx, {
        action: 'PROMOTION_UPDATED',
        entity: 'Promotion',
        entityId: id,
        before,
        after: input,
      });
    });
    return this.get(id);
  }

  /** Soft delete: past sales keep the promotion's name on their lines. */
  async archive(id: string): Promise<void> {
    await this.prisma.db.$transaction(async (tx) => {
      const before = await this.lockLive(tx, id);
      await tx.promotion.update({ where: { id }, data: { deletedAt: new Date(), active: false } });
      await this.audit.log(tx, {
        action: 'PROMOTION_ARCHIVED',
        entity: 'Promotion',
        entityId: id,
        before,
      });
    });
  }

  /** What the API would charge for these lines now; writes nothing. */
  async preview(input: PricingPreviewInput, user: CurrentUserInfo): Promise<PricingPreviewDto> {
    return this.prisma.db.$transaction(async (tx) => {
      if (input.clientId) {
        const c = await tx.client.findFirst({ where: { id: input.clientId, deletedAt: null } });
        if (!c) throw new AppException(ErrorCode.NOT_FOUND, 'Client not found');
        await this.scope.assertClient(tx, user, input.clientId);
      }
      const priceLevelId = await resolvePriceLevel(tx, input.clientId);
      const { assujettiTva } = await tx.tenant.findUniqueOrThrow({
        where: { id: tenantContext.requireTenantId() },
        select: { assujettiTva: true },
      });
      const priced = await this.pricing.priceLines(tx, input.lines, {
        clientId: input.clientId,
        priceLevelId,
        assujettiTva,
      });
      return {
        lines: priced.lines.map((l, i) => ({
          position: l.position,
          productId: l.productId,
          unitId: l.unitId,
          designation: l.designation,
          unitCode: l.unitCode,
          unitName: l.unitName,
          qty: toQtyString(l.qty),
          qtyBase: toQtyString(l.qtyBase),
          listPriceHt: l.listPriceHt === null ? null : toMoneyString(l.listPriceHt),
          unitPriceHt: toMoneyString(l.unitPriceHt),
          discountPct: l.discountPct,
          tvaRate: l.tvaRate,
          lineHt: toMoneyString(l.lineHt),
          isFree: l.isFree,
          promotion:
            l.promotionId && l.promotionName ? { id: l.promotionId, name: l.promotionName } : null,
          freeOfPosition: l.freeOfPosition,
          inputIndex: priced.inputIndex[i] ?? 0,
        })),
        totalHt: toMoneyString(priced.totals.totalHt),
        totalTva: toMoneyString(priced.totals.totalTva),
        totalTtc: toMoneyString(priced.totals.totalTtc),
      };
    });
  }

  // ---------------------------------------------------------------- helpers

  private columns(input: PromotionInput) {
    const scope = {
      name: input.name,
      type: input.type,
      validFrom: fromIsoDate(input.validFrom),
      validTo: fromIsoDate(input.validTo),
      active: input.active,
      priority: input.priority,
      clientScope: input.clientScope,
      priceLevelId:
        input.clientScope === PromotionClientScope.PRICE_LEVEL ? input.priceLevelId : null,
      sectorId: input.clientScope === PromotionClientScope.SECTOR ? input.sectorId : null,
    };
    if (input.type === PromotionType.FREE_UNITS) {
      return {
        ...scope,
        buyProductId: input.buyProductId,
        buyUnitId: input.buyUnitId,
        buyQty: input.buyQty,
        freeProductId: input.freeProductId,
        freeUnitId: input.freeUnitId,
        freeQty: input.freeQty,
        repeatable: input.repeatable,
        target: null,
        brandId: null,
        categoryId: null,
        discountPct: null,
        minQtyBase: null,
      };
    }
    return {
      ...scope,
      buyProductId: null,
      buyUnitId: null,
      buyQty: null,
      freeProductId: null,
      freeUnitId: null,
      freeQty: null,
      repeatable: true,
      target: input.target,
      brandId: input.target === PromotionTarget.BRAND ? input.brandId : null,
      categoryId: input.target === PromotionTarget.CATEGORY ? input.categoryId : null,
      discountPct: input.discountPct,
      minQtyBase: input.minQtyBase,
    };
  }

  private async writeLinks(tx: Tx, promotionId: string, input: PromotionInput): Promise<void> {
    const tenantId = tenantContext.requireTenantId();
    if (
      input.type === PromotionType.PERCENT_DISCOUNT &&
      input.target === PromotionTarget.PRODUCTS
    ) {
      await tx.promotionProduct.createMany({
        data: [...new Set(input.productIds)].map((productId) => ({
          tenantId,
          promotionId,
          productId,
        })),
      });
    }
    if (input.clientScope === PromotionClientScope.CLIENTS) {
      await tx.promotionClient.createMany({
        data: [...new Set(input.clientIds)].map((clientId) => ({
          tenantId,
          promotionId,
          clientId,
        })),
      });
    }
  }

  /** Every id the promotion points to exists in this tenant (master data is never deleted). */
  private async checkRefs(tx: Tx, input: PromotionInput): Promise<void> {
    const invalid = (field: string) =>
      new AppException(ErrorCode.PROMOTION_INVALID, 'Unknown reference', { field });
    if (input.clientScope === PromotionClientScope.PRICE_LEVEL && input.priceLevelId) {
      if (!(await tx.priceLevel.findUnique({ where: { id: input.priceLevelId } }))) {
        throw invalid('priceLevelId');
      }
    }
    if (input.clientScope === PromotionClientScope.SECTOR && input.sectorId) {
      if (!(await tx.sector.findFirst({ where: { id: input.sectorId, deletedAt: null } }))) {
        throw invalid('sectorId');
      }
    }
    if (input.clientScope === PromotionClientScope.CLIENTS) {
      const ids = [...new Set(input.clientIds)];
      if ((await tx.client.count({ where: { id: { in: ids } } })) !== ids.length) {
        throw invalid('clientIds');
      }
    }
    if (input.type === PromotionType.FREE_UNITS) {
      const unitOn = (productId: string, unitId: string) =>
        tx.productUnit.findFirst({
          where: { productId, unitId, deletedAt: null, product: { deletedAt: null } },
        });
      if (!(await unitOn(input.buyProductId, input.buyUnitId))) throw invalid('buyUnitId');
      if (!(await unitOn(input.freeProductId ?? input.buyProductId, input.freeUnitId))) {
        throw invalid('freeUnitId');
      }
      return;
    }
    if (input.target === PromotionTarget.PRODUCTS) {
      const ids = [...new Set(input.productIds)];
      if (
        (await tx.product.count({ where: { id: { in: ids }, deletedAt: null } })) !== ids.length
      ) {
        throw invalid('productIds');
      }
    }
    if (input.target === PromotionTarget.BRAND && input.brandId) {
      if (!(await tx.brand.findFirst({ where: { id: input.brandId, deletedAt: null } }))) {
        throw invalid('brandId');
      }
    }
    if (input.target === PromotionTarget.CATEGORY && input.categoryId) {
      if (!(await tx.category.findFirst({ where: { id: input.categoryId, deletedAt: null } }))) {
        throw invalid('categoryId');
      }
    }
  }

  private async lockLive(tx: Tx, id: string) {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM promotions
      WHERE id = ${id}::uuid AND "tenantId" = ${tenantContext.requireTenantId()}::uuid
        AND "deletedAt" IS NULL
      FOR UPDATE`;
    if (rows.length === 0) throw new AppException(ErrorCode.NOT_FOUND, 'Promotion not found');
    return tx.promotion.findUniqueOrThrow({ where: { id } });
  }

  private async toDtos(rows: PromotionRow[]): Promise<PromotionDto[]> {
    const today = algiersDay(this.clock.now());
    const productIds = [
      ...new Set(
        rows.flatMap((r) => [r.buyProductId, r.freeProductId]).filter((x): x is string => !!x),
      ),
    ];
    const products = productIds.length
      ? await this.prisma.db.product.findMany({
          where: { id: { in: productIds } },
          select: { id: true, reference: true, designation: true },
        })
      : [];
    const productById = new Map(products.map((p) => [p.id, p]));
    return rows.map((r) => {
      const from = toIsoDate(r.validFrom);
      const to = toIsoDate(r.validTo);
      const status: PromotionStatus =
        !r.active || to < today ? 'ended' : from > today ? 'upcoming' : 'active';
      return {
        id: r.id,
        name: r.name,
        type: r.type,
        validFrom: from,
        validTo: to,
        active: r.active,
        priority: r.priority,
        status,
        clientScope: r.clientScope,
        priceLevelId: r.priceLevelId,
        sectorId: r.sectorId,
        clients: r.clients.map((c) => c.client),
        buyProduct: r.buyProductId ? (productById.get(r.buyProductId) ?? null) : null,
        buyUnitId: r.buyUnitId,
        buyQty: r.buyQty ? toQtyString(r.buyQty.toString()) : null,
        freeProduct: productById.get(r.freeProductId ?? r.buyProductId ?? '') ?? null,
        freeUnitId: r.freeUnitId,
        freeQty: r.freeQty ? toQtyString(r.freeQty.toString()) : null,
        repeatable: r.repeatable,
        target: r.target,
        products: r.products.map((p) => p.product),
        brandId: r.brandId,
        categoryId: r.categoryId,
        discountPct: r.discountPct ? r.discountPct.toFixed(2) : null,
        minQtyBase: r.minQtyBase ? toQtyString(r.minQtyBase.toString()) : null,
        version: r.version,
        createdAt: r.createdAt.toISOString(),
      };
    });
  }
}
