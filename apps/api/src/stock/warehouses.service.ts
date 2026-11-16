import { Injectable } from '@nestjs/common';
import {
  type CreateWarehouseInput,
  ErrorCode,
  Feature,
  Permission,
  type UpdateWarehouseInput,
  VEHICLE_ONLY_FIELDS,
  WarehouseAccessLevel,
  type WarehouseBrandsInput,
  type WarehouseCategoriesInput,
  type WarehouseDetailDto,
  type WarehouseDto,
  type WarehouseListQuery,
  WarehouseType,
} from '@erp/shared';
import { AuditService } from '../audit/audit.service';
import type { CurrentUserInfo } from '../auth/auth.types';
import { FeaturesService } from '../billing/features.service';
import { AppException } from '../common/app-exception';
import { tenantContext } from '../common/tenant-context';
import { Prisma } from '../generated/prisma/client';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import { ScopeService } from '../sales-force/scope.service';
import { VehicleTypesService } from './vehicle-types.service';
import { VehiclesService } from './vehicles.service';

/** Name of the dépôt every tenant has (shown in French on printed documents too). */
export const DEFAULT_WAREHOUSE_NAME = 'Dépôt principal';

type Db = PrismaService['db'] | Tx;

const warehouseInclude = {
  assignedUser: { select: { id: true, fullName: true } },
  manager: { select: { id: true, fullName: true } },
  parent: { select: { id: true, name: true } },
  vehicleType: { select: { id: true, code: true, name: true, activity: true } },
  _count: { select: { stocks: { where: { qtyBase: { not: 0 } } } } },
} satisfies Prisma.WarehouseInclude;

/** The identity a truck has (phase 36), as written in audits. */
const identityOf = (w: {
  code: string | null;
  vehicleTypeId: string | null;
  wilayaCode: number | null;
  plateNumber: string | null;
  capacityKg: number | null;
}) => ({
  code: w.code,
  vehicleTypeId: w.vehicleTypeId,
  wilayaCode: w.wilayaCode,
  plateNumber: w.plateNumber,
  capacityKg: w.capacityKg,
});

/**
 * Dépôts and trucks (phase 15). Every tenant has one default MAIN warehouse, created at
 * signup or on first use, so code never has to handle "no warehouse". Without the
 * WAREHOUSES module that is the only one a tenant can use; everything else stays as it was.
 */
@Injectable()
export class WarehousesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly features: FeaturesService,
    private readonly audit: AuditService,
    private readonly scope: ScopeService,
    private readonly vehicles: VehiclesService,
    private readonly vehicleTypes: VehicleTypesService,
  ) {}

  async enabled(tenantId: string = tenantContext.requireTenantId()): Promise<boolean> {
    return (await this.features.of(tenantId)).features.includes(Feature.WAREHOUSES);
  }

  /** The default MAIN warehouse, created if missing (partial unique index: one per tenant). */
  async defaultId(db: Db = this.prisma.db): Promise<string> {
    const tenantId = tenantContext.requireTenantId();
    const found = await db.warehouse.findFirst({
      where: { isDefault: true },
      select: { id: true },
    });
    if (found) return found.id;
    await db.$executeRaw`
      INSERT INTO warehouses ("id", "tenantId", "name", "type", "isDefault", "updatedAt")
      VALUES (gen_random_uuid(), ${tenantId}::uuid, ${DEFAULT_WAREHOUSE_NAME}, 'MAIN', true,
              CURRENT_TIMESTAMP)
      ON CONFLICT DO NOTHING`;
    const created = await db.warehouse.findFirst({
      where: { isDefault: true },
      select: { id: true },
    });
    if (!created) throw new Error('default warehouse could not be created');
    return created.id;
  }

  /**
   * The warehouse an operation uses: the requested one (must be live, and anything but
   * the default needs the module), else `fallback`, else the default.
   */
  async resolve(
    tx: Tx,
    requested: string | null | undefined,
    fallback?: () => Promise<string | null>,
  ): Promise<string> {
    if (requested) {
      const w = await tx.warehouse.findFirst({
        where: { id: requested, deletedAt: null },
        select: { id: true, isDefault: true, active: true },
      });
      if (!w) throw new AppException(ErrorCode.WAREHOUSE_NOT_FOUND, 'Warehouse not found');
      if (!w.isDefault && !(await this.enabled())) throw this.notInPlan();
      if (!w.active) {
        throw new AppException(ErrorCode.WAREHOUSE_INVALID, 'This warehouse is inactive', {
          rule: 'inactive',
        });
      }
      return w.id;
    }
    return (await fallback?.()) ?? this.defaultId(tx);
  }

  /** The active truck driven by this user, when the module is on. */
  async vehicleOf(tx: Tx, userId: string | null | undefined): Promise<string | null> {
    if (!userId || !(await this.enabled())) return null;
    return (await this.vehicles.currentVehicleOf(userId, tx))?.id ?? null;
  }

  /** Where a sale leaves from: the chosen dépôt, else the seller's truck, else MAIN. */
  async forSale(
    tx: Tx,
    requested: string | null | undefined,
    sellerId: string | null,
  ): Promise<string> {
    return this.resolve(tx, requested, () => this.vehicleOf(tx, sellerId));
  }

  /**
   * The dépôts a user can see (phase 24): those he works in or sees figures of; a dépôt
   * outside his reach is not listed. Without a user (internal reads): all of them.
   */
  async list(user?: CurrentUserInfo, query: WarehouseListQuery = {}): Promise<WarehouseDto[]> {
    await this.defaultId();
    const reach = user ? (await this.scope.warehouses(user)).statsWarehouseIds : null;
    const search = query.search ? { contains: query.search, mode: 'insensitive' as const } : null;
    const rows = await this.prisma.db.warehouse.findMany({
      where: {
        deletedAt: null,
        ...(reach ? { id: { in: reach } } : {}),
        ...(query.type ? { type: query.type } : {}),
        ...(query.vehicleTypeId ? { vehicleTypeId: query.vehicleTypeId } : {}),
        ...(query.wilayaCode ? { wilayaCode: query.wilayaCode } : {}),
        ...(query.parentWarehouseId ? { parentWarehouseId: query.parentWarehouseId } : {}),
        ...(search ? { OR: [{ code: search }, { name: search }, { plateNumber: search }] } : {}),
      },
      orderBy: [{ isDefault: 'desc' }, { type: 'asc' }, { name: 'asc' }],
      include: warehouseInclude,
    });
    return rows.map((w) => ({
      id: w.id,
      name: w.name,
      type: w.type,
      isDefault: w.isDefault,
      active: w.active,
      assignedUser: w.assignedUser,
      productCount: w._count.stocks,
      manager: w.manager,
      parent: w.parent,
      location:
        w.lat && w.lng
          ? { lat: w.lat.toNumber(), lng: w.lng.toNumber(), radiusM: w.radiusM }
          : null,
      code: w.code,
      vehicleType: w.vehicleType,
      wilayaCode: w.wilayaCode,
      plateNumber: w.plateNumber,
      capacityKg: w.capacityKg,
    }));
  }

  async get(id: string, user?: CurrentUserInfo): Promise<WarehouseDto> {
    const found = (await this.list(user)).find((w) => w.id === id);
    if (!found) throw new AppException(ErrorCode.WAREHOUSE_NOT_FOUND, 'Warehouse not found');
    return found;
  }

  /** A dépôt with what it sells, its team and its trucks (phase 24). */
  async detail(id: string, user: CurrentUserInfo): Promise<WarehouseDetailDto> {
    const base = await this.get(id, user);
    const [brands, categories, access, trucks] = await Promise.all([
      this.prisma.db.warehouseBrand.findMany({
        where: { warehouseId: id },
        select: { brand: { select: { id: true, name: true } } },
        orderBy: { brand: { name: 'asc' } },
      }),
      this.prisma.db.warehouseCategory.findMany({
        where: { warehouseId: id },
        select: { category: { select: { id: true, name: true } } },
        orderBy: { category: { name: 'asc' } },
      }),
      this.prisma.db.userWarehouseAccess.findMany({
        where: { warehouseId: id, user: { deletedAt: null } },
        select: { level: true, user: { select: { id: true, fullName: true, role: true } } },
        orderBy: { user: { fullName: 'asc' } },
      }),
      this.prisma.db.warehouse.findMany({
        where: { parentWarehouseId: id, deletedAt: null },
        select: {
          id: true,
          name: true,
          code: true,
          assignedUser: { select: { id: true, fullName: true } },
        },
        orderBy: { name: 'asc' },
      }),
    ]);
    return {
      ...base,
      brands: brands.map((b) => b.brand),
      categories: categories.map((c) => c.category),
      team: access.map((a) => ({ ...a.user, level: a.level })),
      trucks,
    };
  }

  async create(input: CreateWarehouseInput, user?: CurrentUserInfo): Promise<WarehouseDto> {
    const id = await this.prisma.db.$transaction(async (tx) => {
      const mainId = await this.defaultId(tx);
      await this.checkIdentity(tx, input.type, input, null);
      const w = await this.write(() =>
        tx.warehouse.create({
          data: {
            tenantId: tenantContext.requireTenantId(),
            name: input.name,
            type: input.type,
            // A truck belongs to a dépôt (phase 24): the dépôt principal until moved.
            parentWarehouseId: input.type === WarehouseType.VEHICLE ? mainId : null,
            code: input.code ?? null,
            vehicleTypeId: input.vehicleTypeId ?? null,
            wilayaCode: input.wilayaCode ?? null,
            plateNumber: input.plateNumber ?? null,
            capacityKg: input.capacityKg ?? null,
          },
        }),
      );
      // The driver goes through the one path that keeps the history (phase 36).
      if (input.assignedUserId) {
        await this.vehicles.assignDriver(tx, {
          vehicleId: w.id,
          userId: input.assignedUserId,
          moveDriver: false,
        });
      }
      // Whoever creates a dépôt works in it, so a user restricted to some dépôts sees it.
      if (user && input.type !== WarehouseType.VEHICLE) {
        const { warehouseIds } = await this.scope.warehouses(user, tx);
        if (warehouseIds) {
          await tx.userWarehouseAccess.create({
            data: {
              tenantId: tenantContext.requireTenantId(),
              userId: user.id,
              warehouseId: w.id,
              level: WarehouseAccessLevel.OPERATE,
              grantedBy: user.id,
            },
          });
        }
      }
      await this.audit.log(tx, {
        action: 'WAREHOUSE_CREATED',
        entity: 'Warehouse',
        entityId: w.id,
        after: input,
      });
      return w.id;
    });
    return this.get(id);
  }

  async update(
    id: string,
    input: UpdateWarehouseInput,
    user?: CurrentUserInfo,
  ): Promise<WarehouseDto> {
    await this.prisma.db.$transaction(async (tx) => {
      const before = await this.live(tx, id);
      if (user) await this.assertReach(tx, user, id);
      if (input.managerUserId !== undefined || input.parentWarehouseId !== undefined) {
        await this.assertMultiUnit();
      }
      if (input.managerUserId) {
        const manager = await tx.user.findFirst({
          where: { id: input.managerUserId, deletedAt: null },
          select: { id: true },
        });
        if (!manager) {
          throw new AppException(ErrorCode.WAREHOUSE_INVALID, 'Unknown manager', {
            field: 'managerUserId',
          });
        }
      }
      if (input.parentWarehouseId !== undefined) {
        await this.checkParent(tx, before, input.parentWarehouseId, user);
      }
      if (input.assignedUserId && before.type !== WarehouseType.VEHICLE) {
        throw new AppException(ErrorCode.WAREHOUSE_INVALID, 'Only a truck has a driver', {
          rule: 'driver_on_vehicle_only',
        });
      }
      await this.checkIdentity(tx, before.type, input, id);
      if (input.active === false && before.isDefault) {
        throw new AppException(ErrorCode.WAREHOUSE_INVALID, 'The main dépôt stays active', {
          rule: 'default_stays_active',
        });
      }
      await this.write(() =>
        tx.warehouse.update({
          where: { id },
          data: {
            name: input.name,
            active: input.active,
            managerUserId: input.managerUserId,
            parentWarehouseId: input.parentWarehouseId,
            code: input.code,
            vehicleTypeId: input.vehicleTypeId,
            wilayaCode: input.wilayaCode,
            plateNumber: input.plateNumber,
            capacityKg: input.capacityKg,
            ...(input.location === undefined
              ? {}
              : {
                  lat: input.location?.lat ?? null,
                  lng: input.location?.lng ?? null,
                  radiusM: input.location?.radiusM ?? null,
                }),
          },
        }),
      );
      // Switching a truck off frees its driver (refused while his day on it is open): the
      // history learns the truck stopped, like when it is archived (test-36 A-1).
      const driver =
        input.assignedUserId === undefined &&
        input.active === false &&
        before.type === WarehouseType.VEHICLE
          ? null
          : input.assignedUserId;
      if (driver !== undefined) {
        await this.vehicles.assignDriver(tx, { vehicleId: id, userId: driver, moveDriver: false });
      }
      await this.audit.log(tx, {
        action: 'WAREHOUSE_UPDATED',
        entity: 'Warehouse',
        entityId: id,
        before: {
          name: before.name,
          assignedUserId: before.assignedUserId,
          active: before.active,
          managerUserId: before.managerUserId,
          parentWarehouseId: before.parentWarehouseId,
          ...identityOf(before),
        },
        after: input,
      });
    });
    return this.get(id);
  }

  /** What a dépôt sells (phase 24): replaces its brands; none = every brand. */
  async setBrands(
    id: string,
    input: WarehouseBrandsInput,
    user: CurrentUserInfo,
  ): Promise<WarehouseDetailDto> {
    await this.assertMultiUnit();
    await this.prisma.db.$transaction(async (tx) => {
      const w = await this.live(tx, id);
      await this.assertReach(tx, user, id);
      this.assertSellingDepot(w);
      const found = await tx.brand.count({
        where: { id: { in: input.brandIds }, deletedAt: null },
      });
      if (found !== input.brandIds.length) {
        throw new AppException(ErrorCode.VALIDATION_FAILED, 'Unknown brand', { field: 'brandIds' });
      }
      const before = await tx.warehouseBrand.findMany({
        where: { warehouseId: id },
        select: { brandId: true },
      });
      await tx.warehouseBrand.deleteMany({ where: { warehouseId: id } });
      if (input.brandIds.length > 0) {
        await tx.warehouseBrand.createMany({
          data: input.brandIds.map((brandId) => ({
            tenantId: tenantContext.requireTenantId(),
            warehouseId: id,
            brandId,
          })),
        });
      }
      await this.audit.log(tx, {
        action: 'WAREHOUSE_BRANDS_SET',
        entity: 'Warehouse',
        entityId: id,
        before: { brandIds: before.map((b) => b.brandId) },
        after: input,
      });
    });
    return this.detail(id, user);
  }

  /** What a dépôt sells (phase 24): replaces its categories (sub-categories included). */
  async setCategories(
    id: string,
    input: WarehouseCategoriesInput,
    user: CurrentUserInfo,
  ): Promise<WarehouseDetailDto> {
    await this.assertMultiUnit();
    await this.prisma.db.$transaction(async (tx) => {
      const w = await this.live(tx, id);
      await this.assertReach(tx, user, id);
      this.assertSellingDepot(w);
      const found = await tx.category.count({
        where: { id: { in: input.categoryIds }, deletedAt: null },
      });
      if (found !== input.categoryIds.length) {
        throw new AppException(ErrorCode.VALIDATION_FAILED, 'Unknown category', {
          field: 'categoryIds',
        });
      }
      const before = await tx.warehouseCategory.findMany({
        where: { warehouseId: id },
        select: { categoryId: true },
      });
      await tx.warehouseCategory.deleteMany({ where: { warehouseId: id } });
      if (input.categoryIds.length > 0) {
        await tx.warehouseCategory.createMany({
          data: input.categoryIds.map((categoryId) => ({
            tenantId: tenantContext.requireTenantId(),
            warehouseId: id,
            categoryId,
          })),
        });
      }
      await this.audit.log(tx, {
        action: 'WAREHOUSE_CATEGORIES_SET',
        entity: 'Warehouse',
        entityId: id,
        before: { categoryIds: before.map((c) => c.categoryId) },
        after: input,
      });
    });
    return this.detail(id, user);
  }

  /**
   * The products of `productIds` a dépôt does not sell (phase 24): outside its brands or
   * its categories (with their sub-categories). A truck sells what its parent dépôt sells.
   * Empty brands and categories = it sells everything. Without MULTI_UNIT: nothing is refused.
   */
  async productsOutside(db: Db, warehouseId: string, productIds: string[]): Promise<string[]> {
    if (productIds.length === 0 || !(await this.multiUnitOn())) return [];
    const w = await db.warehouse.findFirst({
      where: { id: warehouseId },
      select: { id: true, parentWarehouseId: true },
    });
    const depotId = w?.parentWarehouseId ?? w?.id;
    if (!depotId) return [];
    const tenantId = tenantContext.requireTenantId();
    const rows = await db.$queryRaw<{ id: string }[]>`
      WITH RECURSIVE allowed_cats AS (
        SELECT "categoryId" AS id FROM warehouse_categories
        WHERE "tenantId" = ${tenantId}::uuid AND "warehouseId" = ${depotId}::uuid
        UNION
        SELECT c.id FROM categories c JOIN allowed_cats a ON c."parentId" = a.id
        WHERE c."tenantId" = ${tenantId}::uuid
      )
      SELECT p.id FROM products p
      WHERE p."tenantId" = ${tenantId}::uuid AND p.id = ANY(${productIds}::uuid[])
        AND (
          (EXISTS (SELECT 1 FROM warehouse_brands b
                   WHERE b."tenantId" = ${tenantId}::uuid AND b."warehouseId" = ${depotId}::uuid)
           AND (p."brandId" IS NULL OR p."brandId" NOT IN (
                 SELECT "brandId" FROM warehouse_brands
                 WHERE "tenantId" = ${tenantId}::uuid AND "warehouseId" = ${depotId}::uuid)))
          OR
          (EXISTS (SELECT 1 FROM warehouse_categories wc
                   WHERE wc."tenantId" = ${tenantId}::uuid AND wc."warehouseId" = ${depotId}::uuid)
           AND (p."categoryId" IS NULL OR p."categoryId" NOT IN (SELECT id FROM allowed_cats)))
        )`;
    return rows.map((r) => r.id);
  }

  /**
   * PRODUCT_NOT_IN_WAREHOUSE unless every product is sold by the dépôt (phase 24), or the
   * user may sell anything (SELL_ANY_PRODUCT).
   */
  async assertSells(
    db: Db,
    user: CurrentUserInfo,
    warehouseId: string,
    productIds: string[],
  ): Promise<void> {
    if (user.permissions.includes(Permission.SELL_ANY_PRODUCT)) return;
    const outside = await this.productsOutside(db, warehouseId, [...new Set(productIds)]);
    if (outside.length > 0) {
      throw new AppException(
        ErrorCode.PRODUCT_NOT_IN_WAREHOUSE,
        'This dépôt does not sell these products',
        { warehouseId, productIds: outside },
      );
    }
  }

  /** Product filter for a dépôt's searches (phase 24): what it sells. null = everything. */
  async sellsWhere(warehouseId: string): Promise<Prisma.ProductWhereInput | null> {
    if (!(await this.multiUnitOn())) return null;
    const w = await this.prisma.db.warehouse.findFirst({
      where: { id: warehouseId },
      select: { id: true, parentWarehouseId: true },
    });
    const depotId = w?.parentWarehouseId ?? w?.id;
    if (!depotId) return null;
    const [brands, cats] = await Promise.all([
      this.prisma.db.warehouseBrand.findMany({
        where: { warehouseId: depotId },
        select: { brandId: true },
      }),
      this.prisma.db.warehouseCategory.findMany({
        where: { warehouseId: depotId },
        select: { categoryId: true },
      }),
    ]);
    if (brands.length === 0 && cats.length === 0) return null;
    const and: Prisma.ProductWhereInput[] = [];
    if (brands.length > 0) and.push({ brandId: { in: brands.map((b) => b.brandId) } });
    if (cats.length > 0) {
      const tenantId = tenantContext.requireTenantId();
      const ids = cats.map((c) => c.categoryId);
      const tree = await this.prisma.db.$queryRaw<{ id: string }[]>`
        WITH RECURSIVE t AS (
          SELECT id FROM categories WHERE "tenantId" = ${tenantId}::uuid AND id = ANY(${ids}::uuid[])
          UNION
          SELECT c.id FROM categories c JOIN t ON c."parentId" = t.id
          WHERE c."tenantId" = ${tenantId}::uuid
        )
        SELECT id FROM t`;
      and.push({ categoryId: { in: tree.map((r) => r.id) } });
    }
    return { AND: and };
  }

  async multiUnitOn(tenantId: string = tenantContext.requireTenantId()): Promise<boolean> {
    return (await this.features.of(tenantId)).features.includes(Feature.MULTI_UNIT);
  }

  /** Archives an empty dépôt. Stock must be moved out first (a transfer), never dropped. */
  async archive(id: string, user?: CurrentUserInfo): Promise<void> {
    await this.prisma.db.$transaction(async (tx) => {
      const before = await this.live(tx, id);
      if (user) await this.assertReach(tx, user, id);
      if (before.isDefault) {
        throw new AppException(ErrorCode.WAREHOUSE_INVALID, 'The main dépôt cannot be archived', {
          rule: 'default_not_archived',
        });
      }
      // Same lock as any stock path on this dépôt: no movement can slip in after the check.
      const rows = await tx.$queryRaw<{ productId: string }[]>`
        SELECT "productId" FROM warehouse_stocks
        WHERE "tenantId" = ${tenantContext.requireTenantId()}::uuid AND "warehouseId" = ${id}::uuid
        ORDER BY "productId"
        FOR UPDATE`;
      const holding = await tx.warehouseStock.count({
        where: {
          warehouseId: id,
          productId: { in: rows.map((r) => r.productId) },
          qtyBase: { not: 0 },
        },
      });
      if (holding > 0) {
        throw new AppException(ErrorCode.WAREHOUSE_NOT_EMPTY, 'Move the stock out first', {
          products: holding,
        });
      }
      // The driver leaves through the one path that keeps the history (phase 36).
      await this.vehicles.assignDriver(tx, { vehicleId: id, userId: null, moveDriver: false });
      await tx.warehouse.update({ where: { id }, data: { deletedAt: new Date(), active: false } });
      await this.audit.log(tx, { action: 'WAREHOUSE_ARCHIVED', entity: 'Warehouse', entityId: id });
    });
  }

  private async live(tx: Tx, id: string) {
    const w = await tx.warehouse.findFirst({ where: { id, deletedAt: null } });
    if (!w) throw new AppException(ErrorCode.WAREHOUSE_NOT_FOUND, 'Warehouse not found');
    return w;
  }

  /** A dépôt outside the user's reach (OPERATE) is not there for him (phase 24). */
  private async assertReach(tx: Tx, user: CurrentUserInfo, id: string): Promise<void> {
    await this.scope.assertWarehouse(tx, user, id);
  }

  private async assertMultiUnit(): Promise<void> {
    if (await this.multiUnitOn()) return;
    throw new AppException(ErrorCode.FEATURE_NOT_IN_PLAN, 'This module is not in your plan', {
      feature: Feature.MULTI_UNIT,
    });
  }

  /** Brands and categories belong to dépôts; a truck sells what its parent sells. */
  private assertSellingDepot(w: { type: string }): void {
    if (w.type === WarehouseType.VEHICLE) {
      throw new AppException(ErrorCode.WAREHOUSE_INVALID, 'A truck sells what its dépôt sells', {
        rule: 'vehicle_follows_parent',
      });
    }
  }

  /** A truck's parent: a live dépôt (MAIN / SECONDARY) the user works in. Only trucks have one. */
  private async checkParent(
    tx: Tx,
    w: { id: string; type: string },
    parentId: string | null,
    user?: CurrentUserInfo,
  ): Promise<void> {
    if (w.type !== WarehouseType.VEHICLE) {
      if (parentId === null) return;
      throw new AppException(ErrorCode.WAREHOUSE_INVALID, 'Only a truck belongs to a dépôt', {
        rule: 'parent_on_vehicle_only',
      });
    }
    if (parentId === null) return;
    const parent = await tx.warehouse.findFirst({
      where: { id: parentId, deletedAt: null, type: { not: WarehouseType.VEHICLE } },
      select: { id: true },
    });
    if (!parent) {
      throw new AppException(ErrorCode.WAREHOUSE_INVALID, 'A truck belongs to a dépôt', {
        field: 'parentWarehouseId',
      });
    }
    if (user) await this.assertReach(tx, user, parentId);
  }

  /**
   * Identity fields (phase 36): type, wilaya, plate and capacity belong to trucks; the type
   * must be a live one of this company; a code is unique among the company's live dépôts
   * and trucks, whatever the case.
   */
  private async checkIdentity(
    tx: Tx,
    type: string,
    input: Pick<UpdateWarehouseInput, 'code' | (typeof VEHICLE_ONLY_FIELDS)[number]>,
    id: string | null,
  ): Promise<void> {
    if (type !== WarehouseType.VEHICLE) {
      const fields = VEHICLE_ONLY_FIELDS.filter((f) => input[f] != null);
      if (fields.length > 0) {
        throw new AppException(
          ErrorCode.VEHICLE_FIELDS_ON_DEPOT,
          'Type, wilaya, plate and capacity belong to trucks',
          { fields },
        );
      }
    }
    if (input.vehicleTypeId) await this.vehicleTypes.assertUsable(tx, input.vehicleTypeId);
    if (input.code) {
      const taken = await tx.warehouse.findFirst({
        where: {
          code: { equals: input.code, mode: 'insensitive' },
          deletedAt: null,
          ...(id ? { NOT: { id } } : {}),
        },
        select: { id: true },
      });
      if (taken) throw this.codeTaken();
    }
  }

  private codeTaken(): AppException {
    return new AppException(ErrorCode.VEHICLE_CODE_TAKEN, 'Code already used', { field: 'code' });
  }

  /** Maps the unique-name and unique-code violations to clear errors. */
  private async write<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        // The partial unique index on lower(code): two requests raced past the check.
        if (JSON.stringify(err.meta ?? {}).includes('code')) throw this.codeTaken();
        throw new AppException(ErrorCode.WAREHOUSE_NAME_TAKEN, 'Name already used', {
          field: 'name',
        });
      }
      throw err;
    }
  }

  private notInPlan(): AppException {
    return new AppException(ErrorCode.FEATURE_NOT_IN_PLAN, 'This module is not in your plan', {
      feature: Feature.WAREHOUSES,
    });
  }
}
