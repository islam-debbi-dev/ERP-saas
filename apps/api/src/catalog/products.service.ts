import { randomUUID } from 'node:crypto';
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
import { BillingService } from '../billing/billing.service';
import { AppException } from '../common/app-exception';
import { chunks } from '../common/chunks';
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
    private readonly billing: BillingService,
  ) {}

  /** Product, units and prices in one transaction. */
  async create(input: CreateProductInput): Promise<ProductDto> {
    return this.withUniqueErrors(() =>
      this.prisma.db.$transaction(async (tx) => {
        await this.validate(tx, input);
        await this.assertProductSlots(tx, 1);
        const tenantId = tenantContext.requireTenantId();
        const product = await tx.product.create({
          data: {
            tenantId,
            reference: input.reference,
            designation: input.designation,
            categoryId: input.categoryId,
            brandId: input.brandId ?? null,
            baseUnitId: input.baseUnitId,
            tvaRate: input.tvaRate,
            minStock: input.minStock,
            weightKg: input.weightKg ?? null,
            volumeM3: input.volumeM3 ?? null,
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
      this.prisma.db.$transaction((tx) => this.updateInTx(tx, id, input)),
    );
  }

  /** `update` inside the caller's transaction (the Excel import updates many products in one). */
  async updateInTx(tx: Tx, id: string, input: UpdateProductInput): Promise<ProductDto> {
    await this.lockProduct(tx, id);
    const current = await this.load(tx, id);
    if (current.version !== input.version) {
      throw new AppException(ErrorCode.PRODUCT_MODIFIED, 'Product changed since it was read', {
        currentVersion: current.version,
      });
    }
    if (input.baseUnitId !== current.baseUnitId) {
      // Stock is stored in the base unit: changing it would reinterpret every quantity.
      throw new AppException(ErrorCode.INVALID_PRODUCT_UNITS, 'The base unit cannot be changed', {
        rule: 'base_unit_immutable',
      });
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
        ...(input.brandId !== undefined ? { brandId: input.brandId } : {}),
        tvaRate: input.tvaRate,
        minStock: input.minStock,
        ...(input.weightKg !== undefined ? { weightKg: input.weightKg } : {}),
        ...(input.volumeM3 !== undefined ? { volumeM3: input.volumeM3 } : {}),
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
      ...(query.brandId ? { brandId: query.brandId } : {}),
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
    if (input.brandId) {
      const brand = await tx.brand.findFirst({ where: { id: input.brandId, deletedAt: null } });
      if (!brand) throw new AppException(ErrorCode.VALIDATION_FAILED, 'Unknown brand');
    }
    this.checkUnits(input, units);
  }

  /**
   * Creates many new products with their units and prices in the caller's
   * transaction, with set-based checks and batched inserts (Excel import).
   */
  async createManyInTx(tx: Tx, inputs: CreateProductInput[]): Promise<string[]> {
    if (inputs.length === 0) return [];
    await this.assertProductSlots(tx, inputs.length);
    const tenantId = tenantContext.requireTenantId();
    const units = await tx.unit.findMany();
    const active = await this.priceLevels.activeIds(tx);
    const categoryIds = new Set(
      (await tx.category.findMany({ where: { deletedAt: null }, select: { id: true } })).map(
        (c) => c.id,
      ),
    );
    const brandIds = new Set(
      (await tx.brand.findMany({ where: { deletedAt: null }, select: { id: true } })).map(
        (b) => b.id,
      ),
    );
    const products: Prisma.ProductCreateManyInput[] = [];
    const productUnits: Prisma.ProductUnitCreateManyInput[] = [];
    const prices: Prisma.ProductPriceCreateManyInput[] = [];
    for (const input of inputs) {
      this.checkUnits(input, units);
      if (input.prices.some((p) => !active.has(p.priceLevelId))) {
        throw new AppException(ErrorCode.VALIDATION_FAILED, 'Unknown price level');
      }
      if (input.categoryId && !categoryIds.has(input.categoryId)) {
        throw new AppException(ErrorCode.VALIDATION_FAILED, 'Unknown category');
      }
      if (input.brandId && !brandIds.has(input.brandId)) {
        throw new AppException(ErrorCode.VALIDATION_FAILED, 'Unknown brand');
      }
      const productId = randomUUID();
      products.push({
        id: productId,
        tenantId,
        reference: input.reference,
        designation: input.designation,
        categoryId: input.categoryId,
        brandId: input.brandId ?? null,
        baseUnitId: input.baseUnitId,
        tvaRate: input.tvaRate,
        minStock: input.minStock,
        active: input.active,
      });
      const productUnitIds = new Map<string, string>();
      for (const u of input.units) {
        const id = randomUUID();
        productUnitIds.set(u.unitId, id);
        productUnits.push({
          id,
          tenantId,
          productId,
          unitId: u.unitId,
          factorToBase: u.factorToBase,
          barcode: u.barcode,
          isDefaultSale: u.isDefaultSale,
          isDefaultPurchase: u.isDefaultPurchase,
        });
      }
      for (const p of input.prices) {
        prices.push({
          tenantId,
          productId,
          productUnitId: productUnitIds.get(p.unitId) ?? '',
          priceLevelId: p.priceLevelId,
          priceHt: p.priceHt,
        });
      }
    }
    await this.withUniqueErrors(async () => {
      for (const chunk of chunks(products)) await tx.product.createMany({ data: chunk });
      for (const chunk of chunks(productUnits)) await tx.productUnit.createMany({ data: chunk });
      for (const chunk of chunks(prices)) await tx.productPrice.createMany({ data: chunk });
    });
    await this.audit.logMany(
      tx,
      products.map((p, i) => ({
        action: 'PRODUCT_CREATED',
        entity: 'Product',
        entityId: p.id ?? null,
        after: { id: p.id, ...inputs[i] },
      })),
    );
    return products.map((p) => p.id ?? '');
  }

  /** Products (archived included) by reference, for matching imported rows. */
  async byReferences(tx: Tx, references: string[]): Promise<Map<string, ProductDto>> {
    const out = new Map<string, ProductDto>();
    for (const chunk of chunks([...new Set(references)])) {
      const rows = await tx.product.findMany({
        where: { reference: { in: chunk } },
        include: productInclude,
      });
      for (const r of rows) out.set(r.reference, toProductDto(r));
    }
    return out;
  }

  /** Barcodes already used by live units, among `barcodes`, with the owning product id. */
  async usedBarcodes(tx: Tx, barcodes: string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    for (const chunk of chunks([...new Set(barcodes)])) {
      const rows = await tx.productUnit.findMany({
        where: { barcode: { in: chunk } },
        select: { barcode: true, productId: true },
      });
      for (const r of rows) if (r.barcode) out.set(r.barcode, r.productId);
    }
    return out;
  }

  /** Units belong to the tenant; counted base units need whole factors and minimum stock. */
  private checkUnits(input: ProductInput, tenantUnits: { id: string; allowsDecimal: boolean }[]) {
    const known = new Map(tenantUnits.map((u) => [u.id, u]));
    if (input.units.some((u) => !known.has(u.unitId))) {
      throw new AppException(ErrorCode.INVALID_PRODUCT_UNITS, 'Unknown unit', {
        rule: 'unknown_unit',
      });
    }
    const base = known.get(input.baseUnitId);
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

  /** The plan's product limit counts products not deleted (archived ones included). */
  private assertProductSlots(tx: Tx, adding: number): Promise<void> {
    return this.billing.assertCanAdd(tx, 'products', adding, () =>
      tx.product.count({ where: { deletedAt: null } }),
    );
  }
}
