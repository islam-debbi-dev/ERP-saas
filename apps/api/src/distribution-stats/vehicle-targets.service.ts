import { Injectable } from '@nestjs/common';
import {
  type CopyVehicleTargetsInput,
  ErrorCode,
  previousMonthStart,
  type PutVehicleTargetsInput,
  type VehicleTargetDto,
  type VehicleTargetMetric,
  type VehicleTargetsDto,
  WarehouseType,
} from '@erp/shared';
import { AuditService } from '../audit/audit.service';
import { type CurrentUserInfo } from '../auth/auth.types';
import { AppException } from '../common/app-exception';
import { tenantContext } from '../common/tenant-context';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import { fromIsoDate, toIsoDate } from '../sales/sale.mapper';
import { StatsScopeService } from './stats-scope.service';

/**
 * Monthly targets of the trucks (phase 37): one value per truck, month and metric, shown
 * against the truck's figures in the statistics. Master data with an audit trail.
 * NOT read by the incentives engine: objectifs & primes (phase 18) stay per user.
 */
@Injectable()
export class VehicleTargetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly scopes: StatsScopeService,
  ) {}

  /** The targets of a month, for the trucks whose figures the user sees. */
  async list(period: string, user: CurrentUserInfo): Promise<VehicleTargetsDto> {
    const reach = await this.scopes.reach(user);
    const rows = await this.prisma.db.vehicleTarget.findMany({
      where: {
        periodStart: fromIsoDate(period),
        ...(reach.warehouseIds ? { vehicleId: { in: reach.warehouseIds } } : {}),
      },
      orderBy: [{ vehicleId: 'asc' }, { metric: 'asc' }],
    });
    return { period, targets: rows.map(toDto) };
  }

  /**
   * Sets the targets of a month: each row replaces the truck's target for its metric, a
   * null value removes it. One transaction, one audit row per target that changes.
   */
  async put(input: PutVehicleTargetsInput, user: CurrentUserInfo): Promise<VehicleTargetsDto> {
    await this.prisma.db.$transaction(async (tx) => {
      await this.assertVehicles(tx, user, [...new Set(input.targets.map((t) => t.vehicleId))]);
      for (const t of input.targets) {
        await this.set(tx, input.period, t.vehicleId, t.metric, t.targetValue, user.id);
      }
    });
    return this.list(input.period, user);
  }

  /**
   * Copies last month's targets into `period`, for the trucks in reach, where the month
   * has none yet for that truck and metric (a target already typed is kept).
   */
  async copyPrevious(
    input: CopyVehicleTargetsInput,
    user: CurrentUserInfo,
  ): Promise<VehicleTargetsDto & { copied: number }> {
    const reach = await this.scopes.reach(user);
    const from = previousMonthStart(input.period);
    const copied = await this.prisma.db.$transaction(async (tx) => {
      const source = await tx.vehicleTarget.findMany({
        where: {
          periodStart: fromIsoDate(from),
          vehicle: { deletedAt: null, type: WarehouseType.VEHICLE },
          ...(reach.warehouseIds ? { vehicleId: { in: reach.warehouseIds } } : {}),
        },
        orderBy: [{ vehicleId: 'asc' }, { metric: 'asc' }],
      });
      const existing = await tx.vehicleTarget.findMany({
        where: { periodStart: fromIsoDate(input.period) },
        select: { vehicleId: true, metric: true },
      });
      const has = new Set(existing.map((e) => `${e.vehicleId}:${e.metric}`));
      let n = 0;
      for (const s of source) {
        if (has.has(`${s.vehicleId}:${s.metric}`)) continue;
        await this.set(
          tx,
          input.period,
          s.vehicleId,
          s.metric,
          s.targetValue.toString(),
          user.id,
          from,
        );
        n += 1;
      }
      return n;
    });
    return { ...(await this.list(input.period, user)), copied };
  }

  private async set(
    tx: Tx,
    period: string,
    vehicleId: string,
    metric: VehicleTargetMetric,
    value: string | null,
    userId: string,
    copiedFrom?: string,
  ): Promise<void> {
    const periodStart = fromIsoDate(period);
    const key = { tenantId: tenantContext.requireTenantId(), vehicleId, periodStart, metric };
    const before = await tx.vehicleTarget.findUnique({
      where: { tenantId_vehicleId_periodStart_metric: key },
    });
    const old = before?.targetValue.toString() ?? null;
    if (value === null) {
      if (!before) return;
      await tx.vehicleTarget.delete({ where: { id: before.id } });
    } else if (before) {
      if (before.targetValue.equals(value)) return;
      await tx.vehicleTarget.update({ where: { id: before.id }, data: { targetValue: value } });
    } else {
      await tx.vehicleTarget.create({ data: { ...key, targetValue: value, createdBy: userId } });
    }
    await this.audit.log(tx, {
      action: before
        ? value === null
          ? 'VEHICLE_TARGET_REMOVED'
          : 'VEHICLE_TARGET_CHANGED'
        : 'VEHICLE_TARGET_SET',
      entity: 'VehicleTarget',
      entityId: vehicleId,
      before: before ? { period, metric, targetValue: old } : undefined,
      after: { period, metric, targetValue: value, ...(copiedFrom ? { copiedFrom } : {}) },
    });
  }

  /** Live trucks of this company, in the user's reach; else WAREHOUSE_NOT_FOUND. */
  private async assertVehicles(tx: Tx, user: CurrentUserInfo, ids: string[]): Promise<void> {
    const reach = await this.scopes.reach(user);
    const found = await tx.warehouse.findMany({
      where: { id: { in: ids }, type: WarehouseType.VEHICLE, deletedAt: null },
      select: { id: true },
    });
    const ok = new Set(
      found.map((f) => f.id).filter((id) => !reach.warehouseIds || reach.warehouseIds.includes(id)),
    );
    const missing = ids.filter((id) => !ok.has(id));
    if (missing.length > 0) {
      throw new AppException(ErrorCode.WAREHOUSE_NOT_FOUND, 'Vehicle not found', {
        field: 'vehicleId',
        vehicleIds: missing,
      });
    }
  }
}

function toDto(row: {
  vehicleId: string;
  metric: string;
  periodStart: Date;
  targetValue: { toString(): string };
}): VehicleTargetDto {
  return {
    vehicleId: row.vehicleId,
    metric: row.metric as VehicleTargetMetric,
    periodStart: toIsoDate(row.periodStart),
    targetValue: row.targetValue.toString(),
  };
}
