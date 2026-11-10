import { Injectable } from '@nestjs/common';
import {
  algiersDay,
  ErrorCode,
  Feature,
  Permission,
  Role,
  SELLING_ROLES,
  SellerScope,
  WarehouseAccessLevel,
  WarehouseType,
} from '@erp/shared';
import { type CurrentUserInfo } from '../auth/auth.types';
import { FeaturesService } from '../billing/features.service';
import { AppException } from '../common/app-exception';
import { tenantContext } from '../common/tenant-context';
import { Prisma } from '../generated/prisma/client';
import { PrismaService, type Tx } from '../prisma/prisma.service';

/**
 * What a user may see. null = no restriction.
 * - `clientSellerIds`: only clients assigned to one of these users (phase 14).
 * - `documentUserIds`: only sales / versements made by one of these users (phase 14).
 * - `warehouseIds`: only documents and stock of these dépôts, where he works (OPERATE,
 *   their trucks and his own truck; phase 24, MULTI_UNIT).
 * - `statsWarehouseIds`: the dépôts whose aggregated figures he sees (OPERATE ∪ VIEW_STATS).
 * - `userId` / `defaultWarehouseId`: a document without a dépôt (a draft, or a row written
 *   before the backfill) counts as the dépôt principal's, and its creator always sees it.
 */
export interface DataScope {
  clientSellerIds: string[] | null;
  documentUserIds: string[] | null;
  warehouseIds: string[] | null;
  statsWarehouseIds: string[] | null;
  userId?: string;
  defaultWarehouseId?: string | null;
}

/** Dépôts a user works in and sees figures of (phase 24). null = all of them. */
export interface WarehouseScope {
  warehouseIds: string[] | null;
  statsWarehouseIds: string[] | null;
  defaultWarehouseId: string | null;
}

const ALL_WAREHOUSES: WarehouseScope = {
  warehouseIds: null,
  statsWarehouseIds: null,
  defaultWarehouseId: null,
};

type Db = PrismaService['db'] | Tx;

/**
 * The one place that decides which clients, sales and versements a user sees.
 * Every service applies it; the web only mirrors it. Outside the SALES_FORCE module
 * nobody is restricted (old behaviour, and a module turned off hides nothing).
 *
 * - OWNER / MANAGER (and STOREKEEPER, LIVREUR, limited by their routes): everything.
 * - SELLER: everything under ALL_CLIENTS; under ASSIGNED_ONLY, his assigned clients and
 *   his own sales and versements (the client comptoir has no client, so it stays open).
 * - SUPERVISOR: the documents of his team (himself and everyone under him); under
 *   ASSIGNED_ONLY, only the clients assigned to his team.
 */
@Injectable()
export class ScopeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly features: FeaturesService,
  ) {}

  async of(user: CurrentUserInfo, db: Db = this.prisma.db): Promise<DataScope> {
    const w = await this.warehouses(user, db);
    const units = { ...w, userId: user.id };
    if (user.role !== Role.SELLER && user.role !== Role.SUPERVISOR) {
      return { clientSellerIds: null, documentUserIds: null, ...units };
    }
    if (!(await this.salesForceOn(user.tenantId))) {
      return { clientSellerIds: null, documentUserIds: null, ...units };
    }
    const tenant = await db.tenant.findUniqueOrThrow({
      where: { id: user.tenantId },
      select: { sellerScope: true },
    });
    const assignedOnly = tenant.sellerScope === SellerScope.ASSIGNED_ONLY;
    if (user.role === Role.SELLER) {
      return assignedOnly
        ? { clientSellerIds: [user.id], documentUserIds: [user.id], ...units }
        : { clientSellerIds: null, documentUserIds: null, ...units };
    }
    const team = await this.teamIds(user.id, db);
    return { clientSellerIds: assignedOnly ? team : null, documentUserIds: team, ...units };
  }

  /**
   * The dépôts a user works in and sees figures of (phase 24). Everything without the
   * MULTI_UNIT module, for the owner and for VIEW_ALL_WAREHOUSES. Otherwise his
   * UserWarehouseAccess rows, the trucks of those dépôts, and the truck he drives.
   */
  async warehouses(
    user: Pick<CurrentUserInfo, 'id' | 'tenantId' | 'role' | 'permissions'>,
    db: Db = this.prisma.db,
  ): Promise<WarehouseScope> {
    if (user.role === Role.OWNER) return ALL_WAREHOUSES;
    if (user.permissions.includes(Permission.VIEW_ALL_WAREHOUSES)) return ALL_WAREHOUSES;
    if (!(await this.multiUnitOn(user.tenantId))) return ALL_WAREHOUSES;
    // tenantId explicit: login reads this outside a tenant context.
    const tenantId = user.tenantId;
    const rows = await db.userWarehouseAccess.findMany({
      where: { tenantId, userId: user.id },
      select: { warehouseId: true, level: true },
    });
    const operate = rows
      .filter((r) => r.level === WarehouseAccessLevel.OPERATE)
      .map((r) => r.warehouseId);
    const all = rows.map((r) => r.warehouseId);
    const trucks = await db.warehouse.findMany({
      where: {
        tenantId,
        type: WarehouseType.VEHICLE,
        OR: [{ parentWarehouseId: { in: all } }, { assignedUserId: user.id }],
      },
      select: { id: true, parentWarehouseId: true, assignedUserId: true },
    });
    const truckIds = (parents: string[]) =>
      trucks
        .filter(
          (t) =>
            t.assignedUserId === user.id ||
            (t.parentWarehouseId !== null && parents.includes(t.parentWarehouseId)),
        )
        .map((t) => t.id);
    const main = await db.warehouse.findFirst({
      where: { tenantId, isDefault: true },
      select: { id: true },
    });
    return {
      warehouseIds: [...new Set([...operate, ...truckIds(operate)])],
      statsWarehouseIds: [...new Set([...all, ...truckIds(all)])],
      defaultWarehouseId: main?.id ?? null,
    };
  }

  /**
   * Where a seller's tournée starts (phase 35, "Ordonner par proximité"): the one dépôt he
   * operates in when it has a point, else the dépôt principal when it has one, else null.
   */
  async sellerDepotPoint(
    sellerId: string,
    db: Db = this.prisma.db,
  ): Promise<{ lat: number; lng: number } | null> {
    const access = await db.userWarehouseAccess.findMany({
      where: { userId: sellerId, level: WarehouseAccessLevel.OPERATE },
      select: { warehouseId: true },
    });
    const depots = access.length
      ? await db.warehouse.findMany({
          where: {
            id: { in: access.map((a) => a.warehouseId) },
            type: { not: WarehouseType.VEHICLE },
            deletedAt: null,
          },
          select: { lat: true, lng: true },
        })
      : [];
    const own = depots.length === 1 ? depots[0]! : null;
    const point =
      own ??
      (await db.warehouse.findFirst({
        where: { isDefault: true, deletedAt: null },
        select: { lat: true, lng: true },
      }));
    return point?.lat && point.lng
      ? { lat: point.lat.toNumber(), lng: point.lng.toNumber() }
      : null;
  }

  /** The one dépôt (not a truck) a user works in, when he works in exactly one (phase 24). */
  async onlyWarehouse(user: CurrentUserInfo, db: Db = this.prisma.db): Promise<string | null> {
    const { warehouseIds } = await this.warehouses(user, db);
    if (!warehouseIds) return null;
    const depots = await db.warehouse.findMany({
      where: { id: { in: warehouseIds }, type: { not: WarehouseType.VEHICLE }, deletedAt: null },
      select: { id: true },
    });
    return depots.length === 1 ? depots[0]!.id : null;
  }

  /**
   * An operation in a dépôt outside the user's reach (OPERATE) answers WAREHOUSE_NOT_FOUND,
   * as if it did not exist. Called with the dépôt the operation resolved to.
   */
  async assertWarehouse(db: Db, user: CurrentUserInfo, warehouseId: string): Promise<void> {
    const { warehouseIds } = await this.warehouses(user, db);
    if (warehouseIds && !warehouseIds.includes(warehouseId)) {
      throw new AppException(ErrorCode.WAREHOUSE_NOT_FOUND, 'Warehouse not found');
    }
  }

  /**
   * The dépôts a list or a report covers: the user's reach, narrowed by `?warehouseId=`.
   * A filter outside the reach gives nothing ([]), never more and never an error.
   */
  narrowWarehouses(ids: string[] | null, filter: string | undefined): string[] | null {
    if (!filter) return ids;
    return ids === null || ids.includes(filter) ? [filter] : [];
  }

  /**
   * The dépôts a figure covers (dashboard, reports, overview): `narrowWarehouses`, plus the
   * trucks of the dépôts it keeps (phase 26). A truck is part of its dépôt's business unit,
   * as in the charges report. null = every dépôt.
   */
  async figureWarehouses(
    ids: string[] | null,
    filter: string | undefined,
    db: Db = this.prisma.db,
  ): Promise<string[] | null> {
    const narrowed = this.narrowWarehouses(ids, filter);
    if (!narrowed || narrowed.length === 0) return narrowed;
    const trucks = await db.warehouse.findMany({
      where: { type: WarehouseType.VEHICLE, parentWarehouseId: { in: narrowed } },
      select: { id: true },
    });
    return [...new Set([...narrowed, ...trucks.map((t) => t.id)])];
  }

  async multiUnitOn(tenantId: string): Promise<boolean> {
    return (await this.features.of(tenantId)).features.includes(Feature.MULTI_UNIT);
  }

  /**
   * Whose sales a user's figures (reports, dashboard) cover, whatever the module: a seller
   * always his own (as before phase 14), a supervisor his team, the others everyone.
   * Narrowed by the `sellerId` / `teamOf` filters an office user picks; a filter outside
   * the user's own reach gives nobody ([]), never more.
   */
  async figuresSellerIds(
    user: CurrentUserInfo,
    filters: { sellerId?: string; teamOf?: string } = {},
  ): Promise<string[] | null> {
    let ids: string[] | null =
      user.role === Role.SELLER
        ? [user.id]
        : user.role === Role.SUPERVISOR
          ? await this.teamIds(user.id)
          : null;
    const narrow = (wanted: string[]) => {
      ids = ids === null ? wanted : ids.filter((id) => wanted.includes(id));
    };
    if (filters.teamOf) narrow(await this.teamIds(filters.teamOf));
    if (filters.sellerId) narrow([filters.sellerId]);
    return ids;
  }

  async expensesOn(tenantId: string): Promise<boolean> {
    return (await this.features.of(tenantId)).features.includes(Feature.EXPENSES);
  }

  async treasuryOn(tenantId: string): Promise<boolean> {
    return (await this.features.of(tenantId)).features.includes(Feature.TREASURY);
  }

  async tourneesOn(tenantId: string): Promise<boolean> {
    return (await this.features.of(tenantId)).features.includes(Feature.TOURNEES);
  }

  async salesForceOn(tenantId: string): Promise<boolean> {
    return (await this.features.of(tenantId)).features.includes(Feature.SALES_FORCE);
  }

  /** The user and everyone under him, any depth (live or not: history stays visible). */
  async teamIds(userId: string, db: Db = this.prisma.db): Promise<string[]> {
    const tenantId = tenantContext.requireTenantId();
    const rows = await db.$queryRaw<{ id: string }[]>`
      WITH RECURSIVE team AS (
        SELECT id FROM users WHERE id = ${userId}::uuid AND "tenantId" = ${tenantId}::uuid
        UNION
        SELECT u.id FROM users u JOIN team t ON u."managerId" = t.id
        WHERE u."tenantId" = ${tenantId}::uuid
      )
      SELECT id FROM team`;
    return rows.map((r) => r.id);
  }

  clientWhere(scope: DataScope): Prisma.ClientWhereInput {
    return scope.clientSellerIds ? { assignedSellerId: { in: scope.clientSellerIds } } : {};
  }

  /**
   * Legacy sales (no sellerId, before phase 14) belong to their creator. A sale of a dépôt
   * outside the user's reach is not there (phase 24).
   */
  saleWhere(scope: DataScope): Prisma.SaleWhereInput {
    const ids = scope.documentUserIds;
    const and: Prisma.SaleWhereInput[] = [];
    if (ids)
      and.push({ OR: [{ sellerId: { in: ids } }, { sellerId: null, createdBy: { in: ids } }] });
    const w = this.warehouseWhere(scope, scope.warehouseIds, 'createdBy');
    if (w) and.push(w);
    return and.length ? { AND: and } : {};
  }

  /** Legacy versements (no collectedBy) belong to whoever received them. */
  paymentWhere(scope: DataScope): Prisma.PaymentWhereInput {
    const ids = scope.documentUserIds;
    const and: Prisma.PaymentWhereInput[] = [];
    if (ids) {
      and.push({
        OR: [{ collectedBy: { in: ids } }, { collectedBy: null, receivedBy: { in: ids } }],
      });
    }
    const w = this.warehouseWhere(scope, scope.warehouseIds, 'receivedBy');
    if (w) and.push(w);
    return and.length ? { AND: and } : {};
  }

  /**
   * Documents of these dépôts (phase 24); null = no restriction. A document without a
   * dépôt counts as the dépôt principal's, and its creator always sees it.
   */
  warehouseWhere<F extends string>(
    scope: Pick<DataScope, 'userId' | 'defaultWarehouseId'>,
    ids: string[] | null,
    creatorField: F,
  ): { OR: Record<string, unknown>[] } | null {
    if (!ids) return null;
    const or: Record<string, unknown>[] = [{ warehouseId: { in: ids } }];
    if (scope.defaultWarehouseId && ids.includes(scope.defaultWarehouseId)) {
      or.push({ warehouseId: null });
    } else if (scope.userId) {
      or.push({ warehouseId: null, [creatorField]: scope.userId });
    }
    return { OR: or };
  }

  /** Same as `warehouseWhere` for raw SQL, on an alias with a `warehouseId` column. */
  warehouseSql(
    scope: Pick<DataScope, 'userId' | 'defaultWarehouseId'>,
    ids: string[] | null,
    alias: string,
    creatorColumn?: string,
  ): Prisma.Sql {
    if (!ids) return Prisma.sql`TRUE`;
    const col = Prisma.raw(`${alias}."warehouseId"`);
    if (scope.defaultWarehouseId && ids.includes(scope.defaultWarehouseId)) {
      return Prisma.sql`(${col} IS NULL OR ${col} = ANY(${ids}::uuid[]))`;
    }
    if (creatorColumn && scope.userId) {
      const creator = Prisma.raw(`${alias}."${creatorColumn}"`);
      return Prisma.sql`(${col} = ANY(${ids}::uuid[]) OR (${col} IS NULL AND ${creator} = ${scope.userId}::uuid))`;
    }
    return Prisma.sql`${col} = ANY(${ids}::uuid[])`;
  }

  /** Same as `clientWhere` for raw SQL, on a clients alias. */
  clientSql(scope: DataScope, alias: string): Prisma.Sql {
    if (!scope.clientSellerIds) return Prisma.sql`TRUE`;
    return Prisma.sql`${Prisma.raw(`${alias}."assignedSellerId"`)} = ANY(${scope.clientSellerIds}::uuid[])`;
  }

  /** Same as `saleWhere` for raw SQL, on a sales alias. */
  saleSql(scope: DataScope, alias: string): Prisma.Sql {
    const w = this.warehouseSql(scope, scope.warehouseIds, alias, 'createdBy');
    if (!scope.documentUserIds) return w;
    return Prisma.sql`COALESCE(${Prisma.raw(`${alias}."sellerId"`)}, ${Prisma.raw(`${alias}."createdBy"`)}) = ANY(${scope.documentUserIds}::uuid[]) AND ${w}`;
  }

  /** Same as `paymentWhere` for raw SQL, on a payments alias. */
  paymentSql(scope: DataScope, alias: string): Prisma.Sql {
    const w = this.warehouseSql(scope, scope.warehouseIds, alias, 'receivedBy');
    if (!scope.documentUserIds) return w;
    return Prisma.sql`COALESCE(${Prisma.raw(`${alias}."collectedBy"`)}, ${Prisma.raw(`${alias}."receivedBy"`)}) = ANY(${scope.documentUserIds}::uuid[]) AND ${w}`;
  }

  /**
   * A client outside the user's scope answers 404, so its existence is not revealed.
   * null (client comptoir) is always allowed.
   */
  async assertClient(db: Db, user: CurrentUserInfo, clientId: string | null): Promise<void> {
    if (!clientId) return;
    const scope = await this.of(user, db);
    if (!scope.clientSellerIds) return;
    const c = await db.client.findFirst({
      where: { id: clientId, ...this.clientWhere(scope) },
      select: { id: true },
    });
    if (!c) throw new AppException(ErrorCode.NOT_FOUND, 'Client not found');
  }

  /**
   * A user who can be put on a sale as its seller, on a versement as its collector, or
   * on a client as his assigned seller: live, of this tenant, with a selling role.
   */
  async assertSeller(db: Db, userId: string): Promise<void> {
    const u = await db.user.findFirst({
      where: { id: userId, deletedAt: null, role: { in: [...SELLING_ROLES] } },
      select: { id: true },
    });
    if (!u) {
      throw new AppException(ErrorCode.SELLER_NOT_ALLOWED, 'This user cannot be the seller', {
        userId,
      });
    }
  }

  /**
   * Whether the seller of a validated sale (or the collector of a versement) may still
   * change: not once the bonuses of its period are approved (phase 18), since they were
   * computed on that seller. Called inside the reassign transaction.
   */
  async assertSellerChangeAllowed(
    db: Db,
    doc: { kind: 'SALE' | 'PAYMENT'; at: Date },
  ): Promise<void> {
    const day = algiersDay(doc.at);
    const rows = await db.$queryRaw<{ id: string; periodStart: Date }[]>`
      SELECT id, "periodStart" FROM incentive_runs
      WHERE "tenantId" = ${tenantContext.requireTenantId()}::uuid
        AND status IN ('APPROVED', 'EXPORTED')
        AND "periodStart" <= ${day}::date AND "periodEnd" >= ${day}::date
      LIMIT 1`;
    const run = rows[0];
    if (run) {
      throw new AppException(
        ErrorCode.PERIOD_APPROVED,
        'The bonuses of this period are approved: the seller can no longer change',
        { runId: run.id, kind: doc.kind, period: run.periodStart.toISOString().slice(0, 7) },
      );
    }
  }
}
