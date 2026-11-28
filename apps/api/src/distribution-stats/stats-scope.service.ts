import { Injectable } from '@nestjs/common';
import { ErrorCode, Permission, Role, FIELD_SELLER_ROLES, isTeamLead } from '@erp/shared';
import { type CurrentUserInfo } from '../auth/auth.types';
import { AppException } from '../common/app-exception';
import { PrismaService } from '../prisma/prisma.service';
import { ScopeService } from '../sales-force/scope.service';
import { VehiclesService } from '../stock/vehicles.service';
import { type StatsReach } from './stats-query.service';

/** Roles that only get the "Mon véhicule" card: no other truck, no ranking. */
const ROAD_ROLES: readonly Role[] = [...FIELD_SELLER_ROLES, Role.LIVREUR];

/**
 * Whose figures a user sees in the distribution statistics: exactly the phase 14 / 24
 * rules, written once.
 * - owner, and anyone with VIEW_ALL_WAREHOUSES: everything;
 * - a supervisor or chef de zone: the trucks his team(s) drive, plus the dépôts he has
 *   access to (and their trucks) when the company uses MULTI_UNIT. A chef de zone's
 *   location filters also stay inside his area (phase 40b): a sale of his team to a client
 *   outside it still counts in his figures;
 * - anyone else at the office (manager, storekeeper…): the dépôts where he has OPERATE or
 *   VIEW_STATS and their trucks; everything without MULTI_UNIT;
 * - a seller or a livreur: the statistics are refused; `own()` gives the truck he drives
 *   today for the "Mon véhicule" card.
 * A truck outside the reach never appears, not even in a total: the engine applies the
 * reach inside each fact.
 */
@Injectable()
export class StatsScopeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly vehicles: VehiclesService,
  ) {}

  /** The statistics screens are for the office: a road role gets FORBIDDEN. */
  assertOffice(user: CurrentUserInfo): void {
    if (ROAD_ROLES.includes(user.role)) {
      throw new AppException(ErrorCode.FORBIDDEN, 'The statistics are for the office roles');
    }
  }

  async reach(user: CurrentUserInfo): Promise<StatsReach> {
    this.assertOffice(user);
    const defaultWarehouseId = await this.mainWarehouseId();
    if (user.role === Role.OWNER || user.permissions.includes(Permission.VIEW_ALL_WAREHOUSES)) {
      return { warehouseIds: null, defaultWarehouseId };
    }
    const units = await this.scope.warehouses(user);
    if (!isTeamLead(user.role)) {
      return { warehouseIds: units.statsWarehouseIds, defaultWarehouseId };
    }
    const team = await this.scope.teamIds(user.id);
    const driven = [...(await this.vehicles.currentVehiclesOf(team)).values()].map((v) => v.id);
    const multiUnit = await this.scope.multiUnitOn(user.tenantId);
    const depots = multiUnit ? (units.statsWarehouseIds ?? []) : [];
    const area =
      user.role === Role.AREA_MANAGER ? (await this.scope.of(user)).clientCommuneCodes : null;
    return {
      warehouseIds: [...new Set([...driven, ...depots])],
      defaultWarehouseId,
      ...(area ? { clientCommuneCodes: area } : {}),
    };
  }

  /** The reach of "Mon véhicule": the one truck the user drives now, or nothing. */
  async own(user: CurrentUserInfo): Promise<{ vehicleId: string | null; reach: StatsReach }> {
    const truck = await this.vehicles.currentVehicleOf(user.id);
    return {
      vehicleId: truck?.id ?? null,
      reach: { warehouseIds: truck ? [truck.id] : [], defaultWarehouseId: null },
    };
  }

  private async mainWarehouseId(): Promise<string | null> {
    const main = await this.prisma.db.warehouse.findFirst({
      where: { isDefault: true },
      select: { id: true },
    });
    return main?.id ?? null;
  }
}
