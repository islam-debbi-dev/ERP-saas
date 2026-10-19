import { Injectable } from '@nestjs/common';
import {
  type CreateProductInput,
  ErrorCode,
  type ProductDto,
  type UnitDto,
  type UpdateProductInput,
} from '@erp/shared';
import { AuditService } from '../audit/audit.service';
import { AppException } from '../common/app-exception';
import { tenantContext } from '../common/tenant-context';
import { Prisma } from '../generated/prisma/client';
import { type Tx } from '../prisma/prisma.service';
import { createDefaultUnits, ensurePriceLevels } from './catalog-defaults';
import { CategoriesService } from './categories.service';
import { PriceLevelsService } from './price-levels.service';
import { ProductsService } from './products.service';

export interface PriceUpdate {
  productId: string;
  unitId: string;
  priceLevelId: string;
  priceHt: string;
}

export interface CatalogLookups {
  units: UnitDto[];
  /** Active levels only, by position. */
  priceLevels: { id: string; position: number; name: string }[];
  categories: { id: string; name: string }[];
}

/** Entry point other modules use to set up or adjust a tenant's catalog. */
@Injectable()
export class CatalogService {
  constructor(
    private readonly priceLevels: PriceLevelsService,
    private readonly audit: AuditService,
    private readonly products: ProductsService,
    private readonly categories: CategoriesService,
  ) {}

  // ---------------------------------------------------------------- Excel import

  /** Units, active price levels and live categories, to validate imported rows. */
  async importLookups(tx: Tx): Promise<CatalogLookups> {
    const active = await this.priceLevels.activeIds(tx);
    const [units, levels, categories] = await Promise.all([
      tx.unit.findMany({ orderBy: { createdAt: 'asc' } }),
      tx.priceLevel.findMany({ orderBy: { position: 'asc' } }),
      tx.category.findMany({ where: { deletedAt: null }, select: { id: true, name: true } }),
    ]);
    return {
      units: units.map((u) => ({
        id: u.id,
        code: u.code,
        name: u.name,
        allowsDecimal: u.allowsDecimal,
      })),
      priceLevels: levels
        .filter((l) => active.has(l.id))
        .map((l) => ({ id: l.id, position: l.position, name: l.name })),
      categories,
    };
  }

  productsByReference(tx: Tx, references: string[]): Promise<Map<string, ProductDto>> {
    return this.products.byReferences(tx, references);
  }

  usedBarcodes(tx: Tx, barcodes: string[]): Promise<Map<string, string>> {
    return this.products.usedBarcodes(tx, barcodes);
  }

  ensureCategories(tx: Tx, names: string[]): Promise<Map<string, string>> {
    return this.categories.ensureByNames(tx, names);
  }

  createProducts(tx: Tx, inputs: CreateProductInput[]): Promise<string[]> {
    return this.products.createManyInTx(tx, inputs);
  }

  updateProduct(tx: Tx, id: string, input: UpdateProductInput): Promise<ProductDto> {
    return this.products.updateInTx(tx, id, input);
  }

  /** Called inside the registration transaction. */
  async initTenant(tx: Tx, tenantId: string, priceLevelCount: number): Promise<void> {
    await createDefaultUnits(tx, tenantId);
    await ensurePriceLevels(tx, tenantId, priceLevelCount);
  }

  /** Called inside the settings transaction when priceLevelCount changes. */
  async ensurePriceLevels(tx: Tx, tenantId: string, count: number): Promise<void> {
    await ensurePriceLevels(tx, tenantId, count);
  }

  /**
   * Sets selling prices chosen by the user (e.g. on the purchase validation screen),
   * inside the caller's transaction. Each product's version is bumped so an open
   * product form notices, and every change is audited with old and new values.
   */
  async updatePrices(tx: Tx, updates: PriceUpdate[]): Promise<void> {
    if (updates.length === 0) return;
    const active = await this.priceLevels.activeIds(tx);
    const units = await tx.productUnit.findMany({
      where: { productId: { in: updates.map((u) => u.productId) }, deletedAt: null },
      include: { prices: true },
    });
    const byKey = new Map(units.map((u) => [`${u.productId}:${u.unitId}`, u]));
    const changes = new Map<
      string,
      { unitId: string; priceLevelId: string; from: string | null; to: string }[]
    >();

    for (const update of updates) {
      const unit = byKey.get(`${update.productId}:${update.unitId}`);
      if (!unit || !active.has(update.priceLevelId)) {
        throw new AppException(ErrorCode.VALIDATION_FAILED, 'Unknown product unit or price level', {
          productId: update.productId,
        });
      }
      const old = unit.prices.find((p) => p.priceLevelId === update.priceLevelId);
      if (old?.priceHt.eq(update.priceHt)) continue;
      await tx.productPrice.upsert({
        where: {
          productUnitId_priceLevelId: { productUnitId: unit.id, priceLevelId: update.priceLevelId },
        },
        update: { priceHt: update.priceHt },
        create: {
          tenantId: tenantContext.requireTenantId(),
          productId: update.productId,
          productUnitId: unit.id,
          priceLevelId: update.priceLevelId,
          priceHt: update.priceHt,
        },
      });
      const list = changes.get(update.productId) ?? [];
      list.push({
        unitId: update.unitId,
        priceLevelId: update.priceLevelId,
        from: old ? old.priceHt.toFixed(2) : null,
        to: new Prisma.Decimal(update.priceHt).toFixed(2),
      });
      changes.set(update.productId, list);
    }

    for (const [productId, priceChanges] of changes) {
      await tx.product.update({ where: { id: productId }, data: { version: { increment: 1 } } });
      await this.audit.log(tx, {
        action: 'PRODUCT_PRICES_UPDATED',
        entity: 'Product',
        entityId: productId,
        after: { priceChanges },
      });
    }
  }
}
