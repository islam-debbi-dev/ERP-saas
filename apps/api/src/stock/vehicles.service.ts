import { Injectable } from '@nestjs/common';
import {
  type AssignDriverInput,
  type AssignDriverResultDto,
  DRIVING_ROLES,
  ErrorCode,
  Permission,
  Role,
  type VehicleAssignmentListQuery,
  type VehicleAssignmentPage,
  type VehicleRef,
  WarehouseType,
  type WorkerVehiclePage,
} from '@erp/shared';
import { AuditService } from '../audit/audit.service';
import type { CurrentUserInfo } from '../auth/auth.types';
import { ClockService } from '../clock/clock.service';
import { AppException } from '../common/app-exception';
import { tenantContext } from '../common/tenant-context';
import { Prisma } from '../generated/prisma/client';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import { ScopeService } from '../sales-force/scope.service';
import { tourneeVehicleIds } from '../tournees/tournee-scope';

type Db = PrismaService['db'] | Tx;

/** The truck a user drives now. */
export interface CurrentVehicle extends VehicleRef {
  wilayaCode: number | null;
}

/**
 * Called before a driver leaves a truck. The tournées module registers one that refuses
 * while his day on that truck is open: the stock module cannot read its tables, nor
 * import it (it imports us).
 */
export type DriverChangeGuard = (
  tx: Tx,
  leaving: { vehicleId: string; userId: string },
) => Promise<void>;

export interface AssignDriverArgs {
  vehicleId: string;
  /** null = the truck stays without a driver. */
  userId: string | null;
  reason?: string | null;
  /**
   * The driver already has another truck: true frees it in the same transaction (quick
   * re-assignment), false refuses with VEHICLE_ALREADY_ASSIGNED (the dépôt form).
   */
  moveDriver: boolean;
}

export interface AssignDriverOutcome {
  changed: boolean;
  previousUserId: string | null;
  /** The truck the new driver was taken off. */
  freedVehicleId: string | null;
}

/**
 * Trucks as the unit of distribution (phase 36): who drives which truck, now and at any
 * past moment. The one owner of `warehouses.assignedUserId` and of `vehicle_assignments`:
 * every other service asks here.
 */
@Injectable()
export class VehiclesService {
  private readonly guards: DriverChangeGuard[] = [];

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly clock: ClockService,
    private readonly scope: ScopeService,
  ) {}

  /** See `DriverChangeGuard`. */
  registerDriverChangeGuard(guard: DriverChangeGuard): void {
    this.guards.push(guard);
  }

  // ---------------------------------------------------------------- who drives what

  /** The active truck this user drives now. */
  async currentVehicleOf(
    userId: string | null | undefined,
    db: Db = this.prisma.db,
  ): Promise<CurrentVehicle | null> {
    if (!userId) return null;
    return db.warehouse.findFirst({
      where: { assignedUserId: userId, type: WarehouseType.VEHICLE, active: true, deletedAt: null },
      select: { id: true, code: true, name: true, wilayaCode: true },
    });
  }

  /** The active trucks these users drive now, by user. */
  async currentVehiclesOf(
    userIds: string[],
    db: Db = this.prisma.db,
  ): Promise<Map<string, CurrentVehicle>> {
    if (userIds.length === 0) return new Map();
    const rows = await db.warehouse.findMany({
      where: {
        assignedUserId: { in: userIds },
        type: WarehouseType.VEHICLE,
        active: true,
        deletedAt: null,
      },
      select: { id: true, code: true, name: true, wilayaCode: true, assignedUserId: true },
    });
    return new Map(
      rows.map(({ assignedUserId, ...v }) => [assignedUserId!, v] as [string, CurrentVehicle]),
    );
  }

  /** Today's driver of each of these trucks (absent = none). */
  async driversOf(
    vehicleIds: string[],
    db: Db = this.prisma.db,
  ): Promise<Map<string, { id: string; fullName: string }>> {
    if (vehicleIds.length === 0) return new Map();
    const rows = await db.warehouse.findMany({
      where: { id: { in: vehicleIds }, assignedUserId: { not: null } },
      select: { id: true, assignedUser: { select: { id: true, fullName: true } } },
    });
    return new Map(rows.filter((r) => r.assignedUser).map((r) => [r.id, r.assignedUser!]));
  }

  /**
   * Where a truck's tournée starts ("Ordonner par proximité"): its dépôt when it has a
   * point, else the dépôt principal when it has one.
   */
  async startPoint(
    vehicleId: string,
    db: Db = this.prisma.db,
  ): Promise<{ lat: number; lng: number } | null> {
    const truck = await db.warehouse.findFirst({
      where: { id: vehicleId },
      select: { parent: { select: { lat: true, lng: true } } },
    });
    const point =
      truck?.parent?.lat && truck.parent.lng
        ? truck.parent
        : await db.warehouse.findFirst({
            where: { isDefault: true, deletedAt: null },
            select: { lat: true, lng: true },
          });
    return point?.lat && point.lng
      ? { lat: point.lat.toNumber(), lng: point.lng.toNumber() }
      : null;
  }

  /** A live truck of this company, or WAREHOUSE_NOT_FOUND / WAREHOUSE_INVALID. */
  async assertVehicle(
    db: Db,
    vehicleId: string,
  ): Promise<{ id: string; assignedUserId: string | null }> {
    const w = await db.warehouse.findFirst({
      where: { id: vehicleId, deletedAt: null },
      select: { id: true, type: true, assignedUserId: true },
    });
    if (!w) throw new AppException(ErrorCode.WAREHOUSE_NOT_FOUND, 'Vehicle not found');
    if (w.type !== WarehouseType.VEHICLE) {
      throw new AppException(ErrorCode.WAREHOUSE_INVALID, 'This dépôt is not a truck', {
        rule: 'not_a_vehicle',
        field: 'vehicleId',
      });
    }
    return { id: w.id, assignedUserId: w.assignedUserId };
  }

  /** The row of the history in force on a truck at `t`: its driver (or nobody) and since when. */
  async vehicleAt(
    vehicleId: string,
    t: Date,
    db: Db = this.prisma.db,
  ): Promise<{ userId: string | null; fromAt: Date } | null> {
    const row = await db.vehicleAssignment.findFirst({
      where: { vehicleId, fromAt: { lte: t } },
      orderBy: [{ fromAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
      select: { userId: true, fromAt: true },
    });
    return row;
  }

  /** Who had truck X at T: the last row with `fromAt <= T`. null = nobody, or not known. */
  async driverAt(vehicleId: string, t: Date, db: Db = this.prisma.db): Promise<string | null> {
    return (await this.vehicleAt(vehicleId, t, db))?.userId ?? null;
  }

  /**
   * The truck a user drove at `t`, from the history only (never from today's driver): what
   * a visit or an order freezes. null = he drove none, or it is not known.
   */
  async vehicleOfUserAt(
    userId: string | null | undefined,
    t: Date,
    db: Db = this.prisma.db,
  ): Promise<string | null> {
    if (!userId) return null;
    const tenantId = tenantContext.requireTenantId();
    const rows = await db.$queryRaw<{ vehicleId: string }[]>`
      SELECT a."vehicleId" FROM vehicle_assignments a
      WHERE a."tenantId" = ${tenantId}::uuid AND a."userId" = ${userId}::uuid
        AND a."fromAt" <= ${t}
        AND NOT EXISTS (
          SELECT 1 FROM vehicle_assignments n
          WHERE n."tenantId" = a."tenantId" AND n."vehicleId" = a."vehicleId"
            AND n."fromAt" <= ${t}
            AND (n."fromAt", n."createdAt", n.id) > (a."fromAt", a."createdAt", a.id))
      ORDER BY a."fromAt" DESC, a."createdAt" DESC, a.id DESC
      LIMIT 1`;
    return rows[0]?.vehicleId ?? null;
  }

  /**
   * SQL: the driver of the truck `vehicleCol` at the end of the Algiers day `dayCol` (a
   * `date`), for reports that plan a truck's tournée on the person who drove it that day.
   */
  driverOnDaySql(vehicleCol: string, dayCol: string): Prisma.Sql {
    return Prisma.sql`(
      SELECT va."userId" FROM vehicle_assignments va
      WHERE va."tenantId" = ${tenantContext.requireTenantId()}::uuid
        AND va."vehicleId" = ${Prisma.raw(vehicleCol)}
        AND va."fromAt" < ((${Prisma.raw(dayCol)} + 1)::timestamp AT TIME ZONE 'Africa/Algiers')
      ORDER BY va."fromAt" DESC, va."createdAt" DESC, va.id DESC
      LIMIT 1)`;
  }

  // ---------------------------------------------------------------- reach

  /** The trucks a user plans for; the rule is written once, in `tournee-scope.ts`. */
  plannedVehicleIds(user: CurrentUserInfo, db?: Tx): Promise<string[] | null> {
    return tourneeVehicleIds(this.scope, this, user, db);
  }

  /** A truck outside the planner's reach answers WAREHOUSE_NOT_FOUND, as if it were not there. */
  async assertPlanned(db: Tx | undefined, user: CurrentUserInfo, vehicleId: string): Promise<void> {
    const ids = await this.plannedVehicleIds(user, db);
    if (ids && !ids.includes(vehicleId)) {
      throw new AppException(ErrorCode.WAREHOUSE_NOT_FOUND, 'Vehicle not found');
    }
  }

  // ---------------------------------------------------------------- driver change

  /**
   * The only path that changes the driver of a truck. In the caller's transaction: locks
   * the truck and the driver's other truck (in id order), frees the other truck, writes
   * one `vehicle_assignments` row per truck that changed, and the audit.
   */
  async assignDriver(tx: Tx, args: AssignDriverArgs): Promise<AssignDriverOutcome> {
    const tenantId = tenantContext.requireTenantId();
    const { vehicleId, userId } = args;
    // Both trucks in one statement, in id order: two changes crossing the same pair of
    // trucks cannot deadlock.
    const locked = await tx.$queryRaw<
      { id: string; type: string; name: string; active: boolean; assignedUserId: string | null }[]
    >`
      SELECT id, type::text AS type, name, active, "assignedUserId" FROM warehouses
      WHERE "tenantId" = ${tenantId}::uuid AND "deletedAt" IS NULL
        AND (id = ${vehicleId}::uuid
             OR (${userId}::uuid IS NOT NULL AND "assignedUserId" = ${userId}::uuid))
      ORDER BY id
      FOR UPDATE`;
    const target = locked.find((w) => w.id === vehicleId);
    if (!target) throw new AppException(ErrorCode.WAREHOUSE_NOT_FOUND, 'Warehouse not found');
    if (target.assignedUserId === userId) {
      return { changed: false, previousUserId: userId, freedVehicleId: null };
    }
    if (userId && target.type !== WarehouseType.VEHICLE) {
      throw new AppException(ErrorCode.WAREHOUSE_INVALID, 'Only a truck has a driver', {
        rule: 'driver_on_vehicle_only',
      });
    }
    // A truck switched off is driven by nobody: sales, orders and "ma tournée" only know
    // the active truck of a user, and the history must say the same (test-36 A-1).
    if (userId && !target.active) {
      throw new AppException(ErrorCode.WAREHOUSE_INVALID, 'This truck is switched off', {
        rule: 'inactive',
        field: 'assignedUserId',
      });
    }
    const other = userId ? locked.find((w) => w.id !== vehicleId) : undefined;
    if (userId) {
      const driver = await tx.user.findFirst({
        where: { id: userId, deletedAt: null },
        select: { role: true },
      });
      if (!driver || !(DRIVING_ROLES as readonly string[]).includes(driver.role)) {
        throw new AppException(ErrorCode.SELLER_NOT_ALLOWED, 'This user cannot drive a truck', {
          field: 'assignedUserId',
        });
      }
      if (other && !args.moveDriver) {
        throw new AppException(ErrorCode.VEHICLE_ALREADY_ASSIGNED, 'This seller has a truck', {
          warehouseId: other.id,
          name: other.name,
        });
      }
    }
    // Money stays with one person: nobody leaves a truck while his day on it is open.
    for (const guard of this.guards) {
      if (target.assignedUserId) {
        await guard(tx, { vehicleId, userId: target.assignedUserId });
      }
      if (other && userId) await guard(tx, { vehicleId: other.id, userId });
    }

    const setBy = tenantContext.get()?.userId ?? null;
    const reason = args.reason ?? null;
    try {
      if (other) {
        await tx.warehouse.update({ where: { id: other.id }, data: { assignedUserId: null } });
        await this.append(tx, { vehicleId: other.id, userId: null, setBy, reason });
        await this.audit.log(tx, {
          action: 'VEHICLE_DRIVER_CHANGED',
          entity: 'Warehouse',
          entityId: other.id,
          before: { userId },
          after: { userId: null, movedToVehicleId: vehicleId, reason },
        });
      }
      await tx.warehouse.update({ where: { id: vehicleId }, data: { assignedUserId: userId } });
    } catch (err) {
      // Lost a race for the same driver (partial unique index: one live truck per user).
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new AppException(ErrorCode.VEHICLE_ALREADY_ASSIGNED, 'This seller has a truck');
      }
      throw err;
    }
    await this.append(tx, { vehicleId, userId, setBy, reason });
    await this.audit.log(tx, {
      action: 'VEHICLE_DRIVER_CHANGED',
      entity: 'Warehouse',
      entityId: vehicleId,
      before: { userId: target.assignedUserId },
      after: { userId, freedVehicleId: other?.id ?? null, reason },
    });
    return {
      changed: true,
      previousUserId: target.assignedUserId,
      freedVehicleId: other?.id ?? null,
    };
  }

  /**
   * A user stops driving (deactivated, or moved to a role that cannot drive): his truck is
   * left without a driver through `assignDriver`, so the history gets its row and the
   * guards apply (refused while his day on it is open). Returns the truck freed, if any.
   */
  async releaseDriver(tx: Tx, userId: string, reason?: string): Promise<string | null> {
    const truck = await tx.warehouse.findFirst({
      where: { assignedUserId: userId, deletedAt: null },
      select: { id: true },
    });
    if (!truck) return null;
    await this.assignDriver(tx, { vehicleId: truck.id, userId: null, reason, moveDriver: false });
    return truck.id;
  }

  /** `POST /warehouses/:id/driver`: today's driver, in two taps. */
  async changeDriver(
    vehicleId: string,
    input: AssignDriverInput,
    user: CurrentUserInfo,
  ): Promise<AssignDriverResultDto> {
    const outcome = await this.prisma.db.$transaction(async (tx) => {
      await this.assertVehicle(tx, vehicleId);
      await this.assertPlanned(tx, user, vehicleId);
      if (input.userId && user.role === Role.SUPERVISOR) {
        // A supervisor puts his own people on his trucks.
        if (!(await this.scope.teamIds(user.id, tx)).includes(input.userId)) {
          throw new AppException(ErrorCode.FORBIDDEN, 'This seller is not in your team', {
            field: 'userId',
          });
        }
      }
      return this.assignDriver(tx, {
        vehicleId,
        userId: input.userId,
        reason: input.reason,
        moveDriver: true,
      });
    });
    const ids = [input.userId, outcome.previousUserId].filter((x): x is string => !!x);
    const [users, freed] = await Promise.all([
      this.prisma.db.user.findMany({
        where: { id: { in: ids } },
        select: { id: true, fullName: true },
      }),
      outcome.freedVehicleId
        ? this.prisma.db.warehouse.findFirst({
            where: { id: outcome.freedVehicleId },
            select: { id: true, code: true, name: true },
          })
        : null,
    ]);
    const ref = (id: string | null) => users.find((u) => u.id === id) ?? null;
    return {
      vehicleId,
      driver: ref(input.userId),
      previousDriver: outcome.changed ? ref(outcome.previousUserId) : ref(input.userId),
      freedVehicle: freed,
    };
  }

  // ---------------------------------------------------------------- history

  /** A truck's driver history, newest first. */
  async assignments(
    vehicleId: string,
    query: VehicleAssignmentListQuery,
    user: CurrentUserInfo,
  ): Promise<VehicleAssignmentPage> {
    await this.assertVehicleVisible(vehicleId, user);
    const rows = await this.prisma.db.vehicleAssignment.findMany({
      where: { vehicleId },
      include: {
        user: { select: { id: true, fullName: true } },
        setter: { select: { id: true, fullName: true } },
      },
      orderBy: [{ fromAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const page = rows.slice(0, query.limit);
    return {
      items: page.map((a) => ({
        id: a.id,
        user: a.user,
        fromAt: a.fromAt.toISOString(),
        setBy: a.setter,
        reason: a.reason,
      })),
      nextCursor: rows.length > query.limit ? (page.at(-1)?.id ?? null) : null,
    };
  }

  /**
   * The trucks a worker drove, newest first, as periods. A period ends at the next row on
   * the same truck, whoever it names. Derived from `vehicle_assignments` only.
   */
  async vehiclesOf(
    userId: string,
    query: VehicleAssignmentListQuery,
    reader: CurrentUserInfo,
  ): Promise<WorkerVehiclePage> {
    await this.assertWorkerVisible(userId, reader);
    const tenantId = tenantContext.requireTenantId();
    const reach = (await this.scope.warehouses(reader)).statsWarehouseIds;
    const after = query.cursor
      ? Prisma.sql`AND (p."fromAt", p."createdAt", p.id) < (
          SELECT c."fromAt", c."createdAt", c.id FROM vehicle_assignments c
          WHERE c.id = ${query.cursor}::uuid AND c."tenantId" = ${tenantId}::uuid)`
      : Prisma.empty;
    const rows = await this.prisma.db.$queryRaw<
      {
        id: string;
        vehicleId: string;
        fromAt: Date;
        toAt: Date | null;
        code: string | null;
        name: string;
        typeCode: string | null;
        typeName: string | null;
        setById: string | null;
        setByName: string | null;
      }[]
    >`
      WITH periods AS (
        SELECT a.id, a."vehicleId", a."userId", a."fromAt", a."createdAt", a."setBy",
          LEAD(a."fromAt") OVER (
            PARTITION BY a."vehicleId" ORDER BY a."fromAt", a."createdAt", a.id) AS "toAt"
        FROM vehicle_assignments a
        WHERE a."tenantId" = ${tenantId}::uuid
          AND a."vehicleId" IN (
            SELECT "vehicleId" FROM vehicle_assignments
            WHERE "tenantId" = ${tenantId}::uuid AND "userId" = ${userId}::uuid)
      )
      SELECT p.id, p."vehicleId", p."fromAt", p."toAt", w.code, w.name,
        t.code AS "typeCode", t.name AS "typeName", s.id AS "setById", s."fullName" AS "setByName"
      FROM periods p
      JOIN warehouses w ON w.id = p."vehicleId"
      LEFT JOIN vehicle_types t ON t.id = w."vehicleTypeId"
      LEFT JOIN users s ON s.id = p."setBy"
      WHERE p."userId" = ${userId}::uuid ${after}
      ORDER BY p."fromAt" DESC, p."createdAt" DESC, p.id DESC
      LIMIT ${query.limit + 1}`;
    const page = rows.slice(0, query.limit);
    return {
      items: page.map((r) => ({
        id: r.id,
        vehicle: {
          id: r.vehicleId,
          code: r.code,
          name: r.name,
          type: r.typeCode && r.typeName ? { code: r.typeCode, name: r.typeName } : null,
          inReach: reach === null || reach.includes(r.vehicleId),
        },
        fromAt: r.fromAt.toISOString(),
        toAt: r.toAt?.toISOString() ?? null,
        setBy: r.setById && r.setByName ? { id: r.setById, fullName: r.setByName } : null,
      })),
      nextCursor: rows.length > query.limit ? (page.at(-1)?.id ?? null) : null,
    };
  }

  // ---------------------------------------------------------------- helpers

  /** One history row. `fromAt` never goes back on a truck, so "the last row" is the truth. */
  private async append(
    tx: Tx,
    row: { vehicleId: string; userId: string | null; setBy: string | null; reason: string | null },
  ): Promise<void> {
    const last = await tx.vehicleAssignment.findFirst({
      where: { vehicleId: row.vehicleId },
      orderBy: [{ fromAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
      select: { fromAt: true },
    });
    const now = this.clock.now();
    const fromAt = last && last.fromAt >= now ? new Date(last.fromAt.getTime() + 1) : now;
    await tx.vehicleAssignment.create({
      data: { tenantId: tenantContext.requireTenantId(), ...row, fromAt },
    });
  }

  /** The history of a truck is read by whoever sees the truck (dépôt reach). */
  private async assertVehicleVisible(vehicleId: string, user: CurrentUserInfo): Promise<void> {
    const reach = (await this.scope.warehouses(user)).statsWarehouseIds;
    const w = await this.prisma.db.warehouse.findFirst({
      where: { id: vehicleId, type: WarehouseType.VEHICLE },
      select: { id: true },
    });
    if (!w || (reach && !reach.includes(vehicleId))) {
      throw new AppException(ErrorCode.WAREHOUSE_NOT_FOUND, 'Vehicle not found');
    }
  }

  /**
   * A worker's trucks are read by himself and by the planners who see him: owner,
   * VIEW_ALL_WAREHOUSES and managers everyone, a supervisor his team.
   */
  private async assertWorkerVisible(userId: string, reader: CurrentUserInfo): Promise<void> {
    const forbidden = () =>
      new AppException(ErrorCode.FORBIDDEN, 'You cannot see the vehicles of this user');
    if (userId !== reader.id) {
      const all =
        reader.role === Role.OWNER ||
        reader.role === Role.MANAGER ||
        reader.permissions.includes(Permission.VIEW_ALL_WAREHOUSES);
      if (!all) {
        if (reader.role !== Role.SUPERVISOR) throw forbidden();
        if (!(await this.scope.teamIds(reader.id)).includes(userId)) throw forbidden();
      }
    }
    const found = await this.prisma.db.user.findFirst({
      where: { id: userId },
      select: { id: true },
    });
    if (!found) throw new AppException(ErrorCode.NOT_FOUND, 'User not found');
  }
}
