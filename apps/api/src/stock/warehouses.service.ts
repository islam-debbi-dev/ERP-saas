import { Injectable } from '@nestjs/common';
import {
  type CreateWarehouseInput,
  ErrorCode,
  Feature,
  SELLING_ROLES,
  type UpdateWarehouseInput,
  type WarehouseDto,
  WarehouseType,
} from '@erp/shared';
import { AuditService } from '../audit/audit.service';
import { FeaturesService } from '../billing/features.service';
import { AppException } from '../common/app-exception';
import { tenantContext } from '../common/tenant-context';
import { Prisma } from '../generated/prisma/client';
import { PrismaService, type Tx } from '../prisma/prisma.service';

/** Name of the dépôt every tenant has (shown in French on printed documents too). */
export const DEFAULT_WAREHOUSE_NAME = 'Dépôt principal';

type Db = PrismaService['db'] | Tx;

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
    const truck = await tx.warehouse.findFirst({
      where: { assignedUserId: userId, type: WarehouseType.VEHICLE, active: true, deletedAt: null },
      select: { id: true },
    });
    return truck?.id ?? null;
  }

  /** Where a sale leaves from: the chosen dépôt, else the seller's truck, else MAIN. */
  async forSale(
    tx: Tx,
    requested: string | null | undefined,
    sellerId: string | null,
  ): Promise<string> {
    return this.resolve(tx, requested, () => this.vehicleOf(tx, sellerId));
  }

  async list(): Promise<WarehouseDto[]> {
    await this.defaultId();
    const rows = await this.prisma.db.warehouse.findMany({
      where: { deletedAt: null },
      orderBy: [{ isDefault: 'desc' }, { type: 'asc' }, { name: 'asc' }],
      include: {
        assignedUser: { select: { id: true, fullName: true } },
        _count: { select: { stocks: { where: { qtyBase: { not: 0 } } } } },
      },
    });
    return rows.map((w) => ({
      id: w.id,
      name: w.name,
      type: w.type,
      isDefault: w.isDefault,
      active: w.active,
      assignedUser: w.assignedUser,
      productCount: w._count.stocks,
    }));
  }

  async get(id: string): Promise<WarehouseDto> {
    const found = (await this.list()).find((w) => w.id === id);
    if (!found) throw new AppException(ErrorCode.WAREHOUSE_NOT_FOUND, 'Warehouse not found');
    return found;
  }

  async create(input: CreateWarehouseInput): Promise<WarehouseDto> {
    const id = await this.prisma.db.$transaction(async (tx) => {
      await this.defaultId(tx);
      if (input.assignedUserId) await this.checkDriver(tx, input.assignedUserId, null);
      const w = await this.write(() =>
        tx.warehouse.create({
          data: {
            tenantId: tenantContext.requireTenantId(),
            name: input.name,
            type: input.type,
            assignedUserId: input.assignedUserId,
          },
        }),
      );
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

  async update(id: string, input: UpdateWarehouseInput): Promise<WarehouseDto> {
    await this.prisma.db.$transaction(async (tx) => {
      const before = await this.live(tx, id);
      if (input.assignedUserId && before.type !== WarehouseType.VEHICLE) {
        throw new AppException(ErrorCode.WAREHOUSE_INVALID, 'Only a truck has a driver', {
          rule: 'driver_on_vehicle_only',
        });
      }
      if (input.assignedUserId) await this.checkDriver(tx, input.assignedUserId, id);
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
            assignedUserId: input.assignedUserId,
            active: input.active,
          },
        }),
      );
      await this.audit.log(tx, {
        action: 'WAREHOUSE_UPDATED',
        entity: 'Warehouse',
        entityId: id,
        before: { name: before.name, assignedUserId: before.assignedUserId, active: before.active },
        after: input,
      });
    });
    return this.get(id);
  }

  /** Archives an empty dépôt. Stock must be moved out first (a transfer), never dropped. */
  async archive(id: string): Promise<void> {
    await this.prisma.db.$transaction(async (tx) => {
      const before = await this.live(tx, id);
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
      await tx.warehouse.update({
        where: { id },
        data: { deletedAt: new Date(), active: false, assignedUserId: null },
      });
      await this.audit.log(tx, { action: 'WAREHOUSE_ARCHIVED', entity: 'Warehouse', entityId: id });
    });
  }

  private async live(tx: Tx, id: string) {
    const w = await tx.warehouse.findFirst({ where: { id, deletedAt: null } });
    if (!w) throw new AppException(ErrorCode.WAREHOUSE_NOT_FOUND, 'Warehouse not found');
    return w;
  }

  /** A driver is an active user who sells, and drives one truck only. */
  private async checkDriver(tx: Tx, userId: string, warehouseId: string | null): Promise<void> {
    const user = await tx.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { role: true },
    });
    if (!user || !(SELLING_ROLES as readonly string[]).includes(user.role)) {
      throw new AppException(ErrorCode.SELLER_NOT_ALLOWED, 'This user cannot drive a truck', {
        field: 'assignedUserId',
      });
    }
    const other = await tx.warehouse.findFirst({
      where: {
        assignedUserId: userId,
        deletedAt: null,
        NOT: warehouseId ? { id: warehouseId } : {},
      },
      select: { id: true, name: true },
    });
    if (other) {
      throw new AppException(ErrorCode.VEHICLE_ALREADY_ASSIGNED, 'This seller has a truck', {
        warehouseId: other.id,
        name: other.name,
      });
    }
  }

  /** Maps the unique-name violation to a clear error. */
  private async write<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
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
