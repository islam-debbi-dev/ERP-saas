import { Injectable } from '@nestjs/common';
import {
  algiersDay,
  applyPromotions,
  type DocumentTotals,
  ErrorCode,
  Feature,
  money,
  type PromotionRule,
  PromotionTarget,
  PromotionType,
  Permission,
  qty,
  type SaleLineInput,
  toBase,
  toQtyString,
} from '@erp/shared';
import { AuditService } from '../audit/audit.service';
import type { CurrentUserInfo } from '../auth/auth.types';
import { can } from '../auth/permissions';
import { FeaturesService } from '../billing/features.service';
import { ClockService } from '../clock/clock.service';
import { AppException } from '../common/app-exception';
import { tenantContext } from '../common/tenant-context';
import { Prisma } from '../generated/prisma/client';
import { type Tx } from '../prisma/prisma.service';
import {
  type PriceOverride,
  type SaleSnapshotLine,
  snapshotSaleLines,
  totalLines,
} from '../sales/sale-lines';
import { fromIsoDate } from '../sales/sale.mapper';

/** A line where the user did not take what the promotion gives (PROMO_OVERRIDE). */
export interface PromoOverride {
  position: number;
  productId: string;
  promotionId: string;
  promotionName: string;
  kind: 'FREE_QTY' | 'DISCOUNT' | 'FREE_WITHOUT_PROMOTION';
  /** What the promotion gives (free quantity or remise %). */
  expected: string;
  /** What was asked. */
  actual: string;
}

export interface PricedLines {
  lines: SaleSnapshotLine[];
  totals: DocumentTotals;
  /** Price and remise overrides outside promotions (PRICE_OVERRIDE / DISCOUNT_ABOVE_X). */
  overrides: PriceOverride[];
  promoOverrides: PromoOverride[];
  /** For each priced line, the index of the input line it comes from. */
  inputIndex: number[];
}

/**
 * Prices sale and order lines (phase 20): the client's level (`snapshotSaleLines`), then
 * the promotions of the day when the module is on. Each paid line gets at most one
 * promotion; free units (UG) become a separate line priced 0 right after it.
 */
@Injectable()
export class PricingService {
  constructor(
    private readonly features: FeaturesService,
    private readonly clock: ClockService,
    private readonly audit: AuditService,
  ) {}

  async enabled(): Promise<boolean> {
    const tenantId = tenantContext.requireTenantId();
    return (await this.features.of(tenantId)).features.includes(Feature.PROMOTIONS);
  }

  async priceLines(
    tx: Tx,
    input: SaleLineInput[],
    ctx: { clientId: string | null; priceLevelId: string | null; assujettiTva: boolean },
  ): Promise<PricedLines> {
    const base = await snapshotSaleLines(tx, input, ctx.priceLevelId, ctx.assujettiTva);
    const plain: PricedLines = {
      ...base,
      promoOverrides: [],
      inputIndex: base.lines.map((_, i) => i),
    };
    if (input.length === 0 || !(await this.enabled())) return this.withoutPromotion(plain, input);
    const day = algiersDay(this.clock.now());
    const rules = await this.rulesOf(tx, day);
    if (rules.length === 0) return this.withoutPromotion(plain, input);

    const products = await tx.product.findMany({
      where: { id: { in: [...new Set(input.map((l) => l.productId))] } },
      select: { id: true, brandId: true, categoryId: true },
    });
    const productById = new Map(products.map((p) => [p.id, p]));
    const sectorId = ctx.clientId
      ? ((await tx.client.findUnique({ where: { id: ctx.clientId }, select: { sectorId: true } }))
          ?.sectorId ?? null)
      : null;
    const freeUnitPriceHt = await this.freeUnitPrices(tx, rules, ctx.priceLevelId);
    const applied = applyPromotions(
      rules,
      base.lines.map((l) => {
        const p = productById.get(l.productId);
        return {
          productId: l.productId,
          brandId: p?.brandId ?? null,
          categoryId: p?.categoryId ?? null,
          qtyBase: l.qtyBase,
          grossHt: money(l.qty).times(l.unitPriceHt).toDecimalPlaces(2).toString(),
        };
      }),
      { day, clientId: ctx.clientId, priceLevelId: ctx.priceLevelId, sectorId, freeUnitPriceHt },
    );

    const promoOverrides: PromoOverride[] = [];
    const freeInputs: { after: number; line: SaleLineInput; rule: PromotionRule }[] = [];
    const overrideDropped = new Set<number>();
    base.lines.forEach((line, i) => {
      const a = applied[i];
      const typed = input[i];
      if (!a || !typed) {
        if (typed?.freeQty !== undefined && !qty(typed.freeQty).isZero()) {
          throw new AppException(ErrorCode.FREE_LINE_NOT_EDITABLE, 'No promotion on this line', {
            position: line.position,
          });
        }
        return;
      }
      line.promotionId = a.rule.id;
      line.promotionName = a.rule.name;
      if (a.rule.type === PromotionType.PERCENT_DISCOUNT && a.discountPct) {
        // A typed remise of 0 (the default) takes the promotion's; another one is an override.
        const typedPct = money(typed.discountPct);
        if (typedPct.isZero() || typedPct.eq(a.discountPct)) {
          line.discountPct = money(a.discountPct).toString();
          overrideDropped.add(line.position);
        } else {
          promoOverrides.push({
            position: line.position,
            productId: line.productId,
            promotionId: a.rule.id,
            promotionName: a.rule.name,
            kind: 'DISCOUNT',
            expected: a.discountPct,
            actual: typedPct.toString(),
          });
        }
        return;
      }
      const given = a.freeQty ?? qty(0);
      const wanted = typed.freeQty === undefined ? given : qty(typed.freeQty);
      if (!wanted.eq(given)) {
        promoOverrides.push({
          position: line.position,
          productId: line.productId,
          promotionId: a.rule.id,
          promotionName: a.rule.name,
          kind: 'FREE_QTY',
          expected: toQtyString(given),
          actual: toQtyString(wanted),
        });
      }
      if (wanted.gt(0) && a.rule.freeUnitId) {
        freeInputs.push({
          after: i,
          rule: a.rule,
          line: {
            productId: a.rule.freeProductId ?? line.productId,
            unitId: a.rule.freeUnitId,
            qty: wanted.toString(),
            unitPriceHt: '0',
            discountPct: '0',
          },
        });
      }
    });

    const free =
      freeInputs.length > 0
        ? await snapshotSaleLines(
            tx,
            freeInputs.map((f) => f.line),
            ctx.priceLevelId,
            ctx.assujettiTva,
          )
        : null;
    const lines: SaleSnapshotLine[] = [];
    const inputIndex: number[] = [];
    const positionOf = new Map<number, number>();
    base.lines.forEach((line, i) => {
      lines.push(line);
      inputIndex.push(i);
      const newPosition = lines.length;
      positionOf.set(line.position, newPosition);
      freeInputs.forEach((f, k) => {
        const freeLine = free?.lines[k];
        if (f.after !== i || !freeLine) return;
        lines.push({
          ...freeLine,
          // The client's price stays as the line's list price: the value of the gift.
          isFree: true,
          promotionId: f.rule.id,
          promotionName: f.rule.name,
          freeOfPosition: newPosition,
        });
        inputIndex.push(i);
      });
    });
    lines.forEach((l, i) => {
      l.position = i + 1;
    });
    const remap = (o: { position: number }) => positionOf.get(o.position) ?? o.position;
    const overrides = base.overrides
      .filter((o) => !(overrideDropped.has(o.position) && !o.priceChanged))
      .map((o) => ({ ...o, position: remap(o) }));
    const totals = totalLines(lines, ctx.assujettiTva);
    return {
      lines,
      totals,
      overrides,
      promoOverrides: promoOverrides.map((o) => ({ ...o, position: remap(o) })),
      inputIndex,
    };
  }

  /**
   * Free units or a promotion's remise changed by hand need PROMO_OVERRIDE; when allowed,
   * the change is audited on the document.
   */
  async checkPromoOverrides(
    tx: Tx,
    promoOverrides: PromoOverride[],
    user: CurrentUserInfo,
    ref: { entity: 'Sale' | 'Order'; id: string },
  ): Promise<void> {
    if (promoOverrides.length === 0) return;
    if (!can(user, Permission.PROMO_OVERRIDE)) {
      throw new AppException(
        ErrorCode.PROMO_OVERRIDE_FORBIDDEN,
        'You may not change what a promotion gives',
        { permission: Permission.PROMO_OVERRIDE, lines: promoOverrides },
      );
    }
    await this.audit.log(tx, {
      action: 'PROMO_OVERRIDE_USED',
      entity: ref.entity,
      entityId: ref.id,
      after: { lines: promoOverrides },
    });
  }

  /** A typed free quantity with no promotion behind it is refused. */
  private withoutPromotion(plain: PricedLines, input: SaleLineInput[]): PricedLines {
    const asked = input.findIndex((l) => l.freeQty !== undefined && !qty(l.freeQty).isZero());
    if (asked >= 0) {
      throw new AppException(ErrorCode.FREE_LINE_NOT_EDITABLE, 'No promotion on this line', {
        position: asked + 1,
      });
    }
    return plain;
  }

  /** The promotions live on `day`, as the engine needs them. */
  async rulesOf(tx: Tx, day: string): Promise<PromotionRule[]> {
    const date = fromIsoDate(day);
    const rows = await tx.promotion.findMany({
      where: { deletedAt: null, active: true, validFrom: { lte: date }, validTo: { gte: date } },
      include: {
        products: { select: { productId: true } },
        clients: { select: { clientId: true } },
      },
    });
    if (rows.length === 0) return [];
    const buyUnits = rows.filter((r) => r.buyProductId && r.buyUnitId);
    const factors = buyUnits.length
      ? await tx.productUnit.findMany({
          where: {
            OR: buyUnits.map((r) => ({
              productId: r.buyProductId ?? '',
              unitId: r.buyUnitId ?? '',
            })),
          },
          select: { productId: true, unitId: true, factorToBase: true },
        })
      : [];
    const factorOf = (productId: string | null, unitId: string | null) =>
      factors
        .find((f) => f.productId === productId && f.unitId === unitId)
        ?.factorToBase.toString();
    const categories = await this.categoryTrees(
      tx,
      rows.map((r) => r.categoryId).filter((c): c is string => !!c),
    );
    return rows.map((r): PromotionRule => {
      const factor = factorOf(r.buyProductId, r.buyUnitId);
      return {
        id: r.id,
        name: r.name,
        type: r.type,
        priority: r.priority,
        createdAt: r.createdAt.toISOString(),
        validFrom: r.validFrom.toISOString().slice(0, 10),
        validTo: r.validTo.toISOString().slice(0, 10),
        active: r.active,
        clientScope: r.clientScope,
        priceLevelId: r.priceLevelId,
        sectorId: r.sectorId,
        clientIds: r.clients.map((c) => c.clientId),
        buyProductId: r.buyProductId,
        buyQtyBase: r.buyQty && factor ? toBase(r.buyQty.toString(), factor).toString() : null,
        freeProductId: r.freeProductId ?? r.buyProductId,
        freeUnitId: r.freeUnitId,
        freeQty: r.freeQty?.toString() ?? null,
        repeatable: r.repeatable,
        target: r.target,
        productIds: r.products.map((p) => p.productId),
        brandId: r.brandId,
        categoryIds:
          r.target === PromotionTarget.CATEGORY && r.categoryId
            ? (categories.get(r.categoryId) ?? [r.categoryId])
            : [],
        discountPct: r.discountPct?.toString() ?? null,
        minQtyBase: r.minQtyBase?.toString() ?? null,
      };
    });
  }

  /** Each category with all its sub-categories. */
  private async categoryTrees(tx: Tx, roots: string[]): Promise<Map<string, string[]>> {
    const out = new Map<string, string[]>();
    if (roots.length === 0) return out;
    const tenantId = tenantContext.requireTenantId();
    const rows = await tx.$queryRaw<{ root: string; id: string }[]>`
      WITH RECURSIVE tree AS (
        SELECT id AS root, id FROM categories
        WHERE "tenantId" = ${tenantId}::uuid
          AND id IN (${Prisma.join([...new Set(roots)].map((r) => Prisma.sql`${r}::uuid`))})
        UNION
        SELECT t.root, c.id FROM categories c JOIN tree t ON c."parentId" = t.id
        WHERE c."tenantId" = ${tenantId}::uuid
      ) SELECT root::text AS root, id::text AS id FROM tree`;
    for (const r of rows) out.set(r.root, [...(out.get(r.root) ?? []), r.id]);
    return out;
  }

  /** List price of one free unit at the client's level, by promotion (to break a tie). */
  private async freeUnitPrices(
    tx: Tx,
    rules: PromotionRule[],
    priceLevelId: string | null,
  ): Promise<Record<string, string | null>> {
    const free = rules.filter((r) => r.type === PromotionType.FREE_UNITS && r.freeUnitId);
    if (free.length === 0 || !priceLevelId) return {};
    const prices = await tx.productPrice.findMany({
      where: {
        priceLevelId,
        productUnit: {
          OR: free.map((r) => ({ productId: r.freeProductId ?? '', unitId: r.freeUnitId ?? '' })),
        },
      },
      select: { priceHt: true, productUnit: { select: { productId: true, unitId: true } } },
    });
    return Object.fromEntries(
      free.map((r) => [
        r.id,
        prices
          .find(
            (p) =>
              p.productUnit.productId === r.freeProductId && p.productUnit.unitId === r.freeUnitId,
          )
          ?.priceHt.toString() ?? null,
      ]),
    );
  }
}
