import { Injectable } from '@nestjs/common';
import {
  type BarcodeMatchDto,
  type CreateProductInput,
  ErrorCode,
  isWholeQuantity,
  type ProductDto,
  type ProductListQuery,
  type ProductPage,
  type UpdateProductInput,
} from '@erp/shared';
import { AuditService } from '../audit/audit.service';
import { AppException } from '../common/app-exception';
import { tenantContext } from '../common/tenant-context';
import { Prisma } from '../generated/prisma/client';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import { CategoriesService } from './categories.service';
import { PriceLevelsService } from './price-levels.service';
import {
  productInclude,
  type ProductWithRelations,
  toProductDto,
  toUnitDto,
} from './product.mapper';

type ProductInput = CreateProductInput | UpdateProductInput;

interface PriceChange {
  unitId: string;
  priceLevelId: string;
  from: string | null;
  to: string | null;
}

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly categories: CategoriesService,
    private readonly priceLevels: PriceLevelsService,
  ) {}

  /** Product, units and prices in one transaction. */
  async create(input: CreateProductInput): Promise<ProductDto> {
    return this.withUniqueErrors(() =>
      this.prisma.db.$transaction(async (tx) => {
        await this.validate(tx, input);
        const tenantId = tenantContext.requireTenantId();
        const product = await tx.product.create({
          data: {
            tenantId,
            reference: input.reference,
            designation: input.designation,
            categoryId: input.categoryId,
            baseUnitId: input.baseUnitId,
            tvaRate: input.tvaRate,
            minStock: input.minStock,
            active: input.active,
          },
        });
        const productUnitIds = new Map<string, string>();
        for (const u of input.units) {
          const row = await tx.productUnit.create({
            data: {
              tenantId,
              productId: product.id,
              unitId: u.unitId,
              factorToBase: u.factorToBase,
              barcode: u.barcode,
              isDefaultSale: u.isDefaultSale,
              isDefaultPurchase: u.isDefaultPurchase,
            },
          });
          productUnitIds.set(u.unitId, row.id);
        }
        if (input.prices.length > 0) {
          await tx.productPrice.createMany({
            data: input.prices.map((p) => ({
              tenantId,
              productId: product.id,
              productUnitId: productUnitIds.get(p.unitId) ?? '',
              priceLevelId: p.priceLevelId,
              priceHt: p.priceHt,
            })),
          });
        }
        const dto = toProductDto(await this.load(tx, product.id));
        await this.audit.log(tx, {
          action: 'PRODUCT_CREATED',
          entity: 'Product',
          entityId: product.id,
          after: dto,
        });
        return dto;
      }),
    );
  }

  /**
   * Replaces the product, its units and its prices. `version` must match the
   * stored one, so two people editing the same product cannot overwrite each other.
   */
  async update(id: string, input: UpdateProductInput): Promise<ProductDto> {
    return this.withUniqueErrors(() =>
      this.prisma.db.$transaction(async (tx) => {
        await this.lockProduct(tx, id);
        const current = await this.load(tx, id);
        if (current.version !== input.version) {
          throw new AppException(ErrorCode.PRODUCT_MODIFIED, 'Product changed since it was read', {
            currentVersion: current.version,
          });
        }
        if (input.baseUnitId !== current.baseUnitId) {
          // Stock is stored in the base unit: changing it would reinterpret every quantity.
          throw new AppException(
            ErrorCode.INVALID_PRODUCT_UNITS,
            'The base unit cannot be changed',
            {
              rule: 'base_unit_immutable',
            },
          );
        }
        await this.validate(tx, input);
        const before = toProductDto(current);
        const tenantId = tenantContext.requireTenantId();

        // Units: match by catalog unit. Free the barcodes that move or disappear
        // first, so swapping two barcodes in one save does not trip the unique index.
        const live = new Map(current.units.map((u) => [u.unitId, u]));
        const wanted = new Map(input.units.map((u) => [u.unitId, u]));
        for (const [unitId, row] of live) {
          const next = wanted.get(unitId);
          if (row.barcode && (!next || next.barcode !== row.barcode)) {
            await tx.productUnit.update({
              where: { id: row.id },
              data: next
                ? { barcode: null }
                : { barcode: null, deletedBarcode: row.barcode, deletedAt: new Date() },
            });
          } else if (!next) {
            await tx.productUnit.update({ where: { id: row.id }, data: { deletedAt: new Date() } });
          }
        }
        const productUnitIds = new Map<string, string>();
        for (const u of input.units) {
          const data = {
            factorToBase: u.factorToBase,
            barcode: u.barcode,
            isDefaultSale: u.isDefaultSale,
            isDefaultPurchase: u.isDefaultPurchase,
            deletedAt: null,
          };
          // A unit removed earlier is revived (the (product, unit) pair is unique).
          const row = await tx.productUnit.upsert({
            where: { productId_unitId: { productId: id, unitId: u.unitId } },
            update: data,
            create: { ...data, tenantId, productId: id, unitId: u.unitId },
          });
          productUnitIds.set(u.unitId, row.id);
        }

        const priceChanges = await this.syncPrices(tx, id, current, input, productUnitIds);

        await tx.product.update({
          where: { id },
          data: {
            reference: input.reference,
            designation: input.designation,
            categoryId: input.categoryId,
            tvaRate: input.tvaRate,
            minStock: input.minStock,
            active: input.active,
            version: { increment: 1 },
          },
        });
        const after = toProductDto(await this.load(tx, id));
        await this.audit.log(tx, {
          action: 'PRODUCT_UPDATED',
          entity: 'Product',
          entityId: id,
          before,
          after: { ...after, priceChanges },
        });
        return after;
      }),
    );
  }

  async archive(id: string, archived: boolean): Promise<ProductDto> {
    return this.prisma.db.$transaction(async (tx) => {
      await this.lockProduct(tx, id);
      const current = await this.load(tx, id);
      if (Boolean(current.deletedAt) === archived) return toProductDto(current);
      await tx.product.update({
        where: { id },
        data: { deletedAt: archived ? new Date() : null, version: { increment: 1 } },
      });
      const after = toProductDto(await this.load(tx, id));
      await this.audit.log(tx, {
        action: archived ? 'PRODUCT_ARCHIVED' : 'PRODUCT_RESTORED',
        entity: 'Product',
        entityId: id,
        before: { archivedAt: current.deletedAt },
        after: { archivedAt: after.archivedAt },
      });
      return after;
    });
  }

  async get(id: string): Promise<ProductDto> {
    return toProductDto(await this.load(this.prisma.db, id));
  }

  /** Cursor pagination ordered by designation then id (stable under inserts). */
  async list(query: ProductListQuery): Promise<ProductPage> {
    const search = query.search?.trim();
    const where: Prisma.ProductWhereInput = {
      deletedAt: query.archived ? { not: null } : null,
      ...(query.categoryId
        ? { categoryId: { in: await this.categories.idsWithChildren(query.categoryId) } }
        : {}),
      ...(search
        ? {
            OR: [
              { reference: { contains: search, mode: 'insensitive' } },
              { designation: { contains: search, mode: 'insensitive' } },
              { units: { some: { barcode: search, deletedAt: null } } },
            ],
          }
        : {}),
    };
    const rows = await this.prisma.db.product.findMany({
      where,
      include: productInclude,
      orderBy: [{ designation: 'asc' }, { id: 'asc' }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > query.limit;
    const items = rows.slice(0, query.limit).map(toProductDto);
    return { items, nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null };
  }

  /** For the sale screen: the live product and the unit whose barcode was scanned. */
  async byBarcode(code: string): Promise<BarcodeMatchDto> {
    const unit = await this.prisma.db.productUnit.findFirst({
      where: { barcode: code, deletedAt: null, product: { deletedAt: null } },
      select: { productId: true, id: true },
    });
    if (!unit) throw new AppException(ErrorCode.PRODUCT_NOT_FOUND, 'No product with this barcode');
    const product = await this.load(this.prisma.db, unit.productId);
    const matched = product.units.find((u) => u.id === unit.id);
    if (!matched)
      throw new AppException(ErrorCode.PRODUCT_NOT_FOUND, 'No product with this barcode');
    return { product: toProductDto(product), unit: toUnitDto(matched) };
  }

  // ---------------------------------------------------------------- helpers

  private async load(db: Pick<Tx, 'product'>, id: string): Promise<ProductWithRelations> {
    const product = await db.product.findUnique({ where: { id }, include: productInclude });
    if (!product) throw new AppException(ErrorCode.PRODUCT_NOT_FOUND, 'Product not found');
    return product;
  }

  private async lockProduct(tx: Tx, id: string): Promise<void> {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM products
      WHERE id = ${id}::uuid AND "tenantId" = ${tenantContext.requireTenantId()}::uuid
      FOR UPDATE`;
    if (rows.length === 0) throw new AppException(ErrorCode.PRODUCT_NOT_FOUND, 'Product not found');
  }

  /** Rules that need the database: units, levels and category belong to the tenant. */
  private async validate(tx: Tx, input: ProductInput): Promise<void> {
    const unitIds = input.units.map((u) => u.unitId);
    const units = await tx.unit.findMany({ where: { id: { in: unitIds } } });
    if (units.length !== new Set(unitIds).size) {
      throw new AppException(ErrorCode.INVALID_PRODUCT_UNITS, 'Unknown unit', {
        rule: 'unknown_unit',
      });
    }
    const base = units.find((u) => u.id === input.baseUnitId);
    if (base && !base.allowsDecimal) {
      // Counted products (pièce): a carton holds a whole number of pieces.
      const fractional = input.units.find((u) => !isWholeQuantity(u.factorToBase));
      if (fractional) {
        throw new AppException(ErrorCode.INVALID_PRODUCT_UNITS, 'Factor must be a whole number', {
          rule: 'whole_factor_required',
          unitId: fractional.unitId,
        });
      }
      if (!isWholeQuantity(input.minStock)) {
        throw new AppException(
          ErrorCode.INVALID_PRODUCT_UNITS,
          'Minimum stock must be a whole number',
          {
            rule: 'whole_min_stock_required',
          },
        );
      }
    }
    if (input.prices.length > 0) {
      const active = await this.priceLevels.activeIds(tx);
      const unknown = input.prices.find((p) => !active.has(p.priceLevelId));
      if (unknown) {
        throw new AppException(ErrorCode.VALIDATION_FAILED, 'Unknown price level', {
          priceLevelId: unknown.priceLevelId,
        });
      }
    }
    if (input.categoryId) {
      const category = await tx.category.findFirst({
        where: { id: input.categoryId, deletedAt: null },
      });
      if (!category) throw new AppException(ErrorCode.VALIDATION_FAILED, 'Unknown category');
    }
  }

  /** Upserts the wanted prices, deletes the dropped ones, and returns what changed. */
  private async syncPrices(
    tx: Tx,
    productId: string,
    current: ProductWithRelations,
    input: UpdateProductInput,
    productUnitIds: Map<string, string>,
  ): Promise<PriceChange[]> {
    const unitIdOf = new Map(current.units.map((u) => [u.id, u.unitId]));
    const existing = new Map(
      current.prices.map((p) => [
        `${unitIdOf.get(p.productUnitId) ?? p.productUnitId}:${p.priceLevelId}`,
        p,
      ]),
    );
    const changes: PriceChange[] = [];
    const kept = new Set<string>();

    for (const p of input.prices) {
      const key = `${p.unitId}:${p.priceLevelId}`;
      kept.add(key);
      const old = existing.get(key);
      const productUnitId = productUnitIds.get(p.unitId) ?? '';
      if (old && old.priceHt.eq(p.priceHt)) continue;
      changes.push({
        unitId: p.unitId,
        priceLevelId: p.priceLevelId,
        from: old ? old.priceHt.toFixed(2) : null,
        to: new Prisma.Decimal(p.priceHt).toFixed(2),
      });
      await tx.productPrice.upsert({
        where: { productUnitId_priceLevelId: { productUnitId, priceLevelId: p.priceLevelId } },
        update: { priceHt: p.priceHt },
        create: {
          tenantId: tenantContext.requireTenantId(),
          productId,
          productUnitId,
          priceLevelId: p.priceLevelId,
          priceHt: p.priceHt,
        },
      });
    }
    for (const [key, old] of existing) {
      if (kept.has(key)) continue;
      changes.push({
        unitId: unitIdOf.get(old.productUnitId) ?? old.productUnitId,
        priceLevelId: old.priceLevelId,
        from: old.priceHt.toFixed(2),
        to: null,
      });
      await tx.productPrice.deleteMany({ where: { id: old.id } });
    }
    return changes;
  }

  /** Maps the unique indexes to the business errors the UI can explain. */
  private async withUniqueErrors<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const target = JSON.stringify(err.meta ?? {});
        if (target.includes('barcode')) {
          throw new AppException(ErrorCode.BARCODE_ALREADY_USED, 'Barcode already used');
        }
        if (target.includes('reference')) {
          throw new AppException(ErrorCode.REFERENCE_ALREADY_USED, 'Reference already used');
        }
      }
      throw err;
    }
  }
}
