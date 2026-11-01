import { Injectable } from '@nestjs/common';
import {
  effectivePermissions,
  ErrorCode,
  Permission,
  Role,
  type UserAccessDto,
  type UserAccessInput,
  WarehouseAccessLevel,
  WarehouseType,
} from '@erp/shared';
import { AuditService } from '../audit/audit.service';
import type { CurrentUserInfo } from '../auth/auth.types';
import { AppException } from '../common/app-exception';
import { tenantContext } from '../common/tenant-context';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import { ScopeService } from '../sales-force/scope.service';

/**
 * Where a user works or looks (phase 24, MULTI_UNIT): one row per dépôt, OPERATE or
 * VIEW_STATS. The owner, or a user granted WAREHOUSE_ACCESS_MANAGE, sets them, never above
 * his own reach; dépôts outside the granter's reach are left as they are. Trucks are not
 * listed: they follow their parent dépôt. Every change is audited.
 */
@Injectable()
export class UserAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly scope: ScopeService,
  ) {}

  async get(userId: string): Promise<UserAccessDto> {
    const user = await this.prisma.db.user.findFirst({
      where: { id: userId },
      select: { id: true, role: true, permissionGrants: true, permissionRevokes: true },
    });
    if (!user) throw new AppException(ErrorCode.NOT_FOUND, 'User not found');
    const rows = await this.prisma.db.userWarehouseAccess.findMany({
      where: { userId, warehouse: { deletedAt: null } },
      include: { warehouse: { select: { name: true, isDefault: true } } },
      orderBy: [{ warehouse: { isDefault: 'desc' } }, { warehouse: { name: 'asc' } }],
    });
    const granters = await this.prisma.db.user.findMany({
      where: { id: { in: rows.map((r) => r.grantedBy).filter((g): g is string => !!g) } },
      select: { id: true, fullName: true },
    });
    const byId = new Map(granters.map((g) => [g.id, g]));
    return {
      userId,
      allWarehouses: effectivePermissions(
        user.role,
        user.permissionGrants,
        user.permissionRevokes,
      ).includes(Permission.VIEW_ALL_WAREHOUSES),
      access: rows.map((r) => ({
        warehouseId: r.warehouseId,
        warehouseName: r.warehouse.name,
        level: r.level,
        grantedAt: r.grantedAt.toISOString(),
        grantedBy: r.grantedBy ? (byId.get(r.grantedBy) ?? null) : null,
      })),
    };
  }

  async set(
    userId: string,
    input: UserAccessInput,
    actor: CurrentUserInfo,
  ): Promise<UserAccessDto> {
    await this.prisma.db.$transaction(async (tx) => {
      const user = await tx.user.findFirst({ where: { id: userId }, select: { role: true } });
      if (!user) throw new AppException(ErrorCode.NOT_FOUND, 'User not found');
      if (user.role === Role.OWNER) {
        throw new AppException(ErrorCode.FORBIDDEN, 'An owner works in every dépôt', {
          rule: 'owner_has_all',
        });
      }
      await this.checkWarehouses(
        tx,
        input.access.map((a) => a.warehouseId),
      );
      // The granter's reach: what he may give, and the only rows he may touch.
      const reach = await this.scope.warehouses(actor, tx);
      const manageable = reach.statsWarehouseIds;
      const before = await tx.userWarehouseAccess.findMany({
        where: { userId },
        select: { warehouseId: true, level: true },
      });
      const current = new Map(before.map((b) => [b.warehouseId, b.level]));
      const changed = input.access.filter((a) => current.get(a.warehouseId) !== a.level);
      const above = changed.filter((a) =>
        a.level === WarehouseAccessLevel.OPERATE
          ? reach.warehouseIds !== null && !reach.warehouseIds.includes(a.warehouseId)
          : manageable !== null && !manageable.includes(a.warehouseId),
      );
      if (above.length > 0) {
        throw new AppException(
          ErrorCode.ACCESS_ABOVE_GRANTER,
          'You cannot give access to a dépôt beyond your own',
          { warehouseIds: above.map((a) => a.warehouseId) },
        );
      }
      const wanted = new Set(input.access.map((a) => a.warehouseId));
      const removed = before
        .map((b) => b.warehouseId)
        .filter((w) => !wanted.has(w) && (manageable === null || manageable.includes(w)));
      if (removed.length > 0) {
        await tx.userWarehouseAccess.deleteMany({
          where: { userId, warehouseId: { in: removed } },
        });
      }
      const tenantId = tenantContext.requireTenantId();
      for (const a of changed) {
        await tx.userWarehouseAccess.upsert({
          where: { userId_warehouseId: { userId, warehouseId: a.warehouseId } },
          create: {
            tenantId,
            userId,
            warehouseId: a.warehouseId,
            level: a.level,
            grantedBy: actor.id,
          },
          update: { level: a.level, grantedBy: actor.id, grantedAt: new Date() },
        });
      }
      if (changed.length > 0 || removed.length > 0) {
        await this.audit.log(tx, {
          action: 'USER_WAREHOUSE_ACCESS_CHANGED',
          entity: 'User',
          entityId: userId,
          before: { access: before },
          after: {
            granted: changed,
            revoked: removed,
          },
        });
      }
    });
    return this.get(userId);
  }

  /**
   * Access of a new user (phase 24): the dépôts his inviter works in (every dépôt for the
   * owner), so a restricted manager's recruit lands in his own dépôts. The owner narrows
   * it on the user's page.
   */
  async grantDefaults(tx: Tx, userId: string, actor: CurrentUserInfo): Promise<void> {
    if (!(await this.scope.multiUnitOn(actor.tenantId))) return;
    const { warehouseIds } = await this.scope.warehouses(actor, tx);
    const depots = await tx.warehouse.findMany({
      where: {
        deletedAt: null,
        type: { in: [WarehouseType.MAIN, WarehouseType.SECONDARY] },
        ...(warehouseIds ? { id: { in: warehouseIds } } : {}),
      },
      select: { id: true },
    });
    if (depots.length === 0) return;
    await tx.userWarehouseAccess.createMany({
      data: depots.map((d) => ({
        tenantId: tenantContext.requireTenantId(),
        userId,
        warehouseId: d.id,
        level: WarehouseAccessLevel.OPERATE,
        grantedBy: actor.id,
      })),
      skipDuplicates: true,
    });
  }

  /** Access is given on live dépôts (MAIN / SECONDARY), never on a truck. */
  private async checkWarehouses(tx: Tx, ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const found = await tx.warehouse.findMany({
      where: { id: { in: ids }, deletedAt: null },
      select: { id: true, type: true },
    });
    const bad = ids.filter((id) => {
      const w = found.find((f) => f.id === id);
      return !w || w.type === WarehouseType.VEHICLE;
    });
    if (bad.length > 0) {
      throw new AppException(
        ErrorCode.WAREHOUSE_ACCESS_INVALID,
        'Access is given on a dépôt, not on a truck',
        { warehouseIds: bad },
      );
    }
  }
}
