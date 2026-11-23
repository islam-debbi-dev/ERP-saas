import { ErrorCode, Permission, Role } from '@erp/shared';
import { type CurrentUserInfo } from '../auth/auth.types';
import { AppException } from '../common/app-exception';
import { type Prisma } from '../generated/prisma/client';
import { type Tx } from '../prisma/prisma.service';
import { type ScopeService } from '../sales-force/scope.service';
import { type VehiclesService } from '../stock/vehicles.service';

/** Roles that plan routes and close sessions. A supervisor only for his team. */
export const PLANNERS = [Role.OWNER, Role.MANAGER, Role.SUPERVISOR];

/**
 * Whose routes, visits, orders and sessions a user sees: owner and manager everyone
 * (null), a supervisor his team, anyone else (seller, livreur) only himself.
 */
export async function tourneeSellerIds(
  scope: ScopeService,
  user: CurrentUserInfo,
  db?: Tx,
): Promise<string[] | null> {
  if (user.role === Role.OWNER || user.role === Role.MANAGER) return null;
  if (user.role === Role.SUPERVISOR) return scope.teamIds(user.id, db);
  return [user.id];
}

/**
 * The seller a planner may put on a route / record for: a live selling user, in the
 * supervisor's team. A SELLER always acts for himself.
 */
export async function resolveTourneeSeller(
  tx: Tx,
  scope: ScopeService,
  user: CurrentUserInfo,
  requested: string | undefined,
): Promise<string> {
  if (user.role === Role.SELLER) {
    if (requested !== undefined && requested !== user.id) {
      throw new AppException(ErrorCode.FORBIDDEN, 'A seller acts only in his own name', {
        field: 'sellerId',
      });
    }
    return user.id;
  }
  const sellerId = requested ?? user.id;
  await scope.assertSeller(tx, sellerId);
  await assertTeamMember(scope, user, sellerId, 'sellerId', tx);
  return sellerId;
}

/**
 * A supervisor names only people of his team (a seller to plan, a livreur to deliver).
 * Owner and manager name anyone. The one statement of the team rule for writes.
 */
export async function assertTeamMember(
  scope: ScopeService,
  user: CurrentUserInfo,
  userId: string,
  field: string,
  db?: Tx,
): Promise<void> {
  if (user.role !== Role.SUPERVISOR) return;
  if ((await scope.teamIds(user.id, db)).includes(userId)) return;
  throw new AppException(ErrorCode.FORBIDDEN, 'This user is not in your team', { field });
}

/** A row outside the user's reach answers "not found", like the phase 14 scope. */
export function assertVisible(
  ids: string[] | null,
  sellerIds: (string | null)[],
  code: ErrorCode,
): void {
  if (ids === null) return;
  if (!sellerIds.some((id) => id !== null && ids.includes(id))) {
    throw new AppException(code, 'Not found');
  }
}

/**
 * The trucks whose tournées (and drivers) a user reaches (phase 36); null = all of them.
 * The one statement of the rule:
 * - owner, and anyone with VIEW_ALL_WAREHOUSES: every truck;
 * - manager: the trucks of the dépôts he works in (every truck without MULTI_UNIT);
 * - supervisor: the trucks his team drives, and those of the dépôts he has OPERATE on;
 * - anyone else (seller, livreur): the truck he drives now.
 */
export async function tourneeVehicleIds(
  scope: ScopeService,
  vehicles: VehiclesService,
  user: CurrentUserInfo,
  db?: Tx,
): Promise<string[] | null> {
  if (user.role === Role.OWNER) return null;
  if (user.permissions.includes(Permission.VIEW_ALL_WAREHOUSES)) return null;
  const multiUnit = await scope.multiUnitOn(user.tenantId);
  if (user.role === Role.MANAGER) {
    return multiUnit ? (await scope.warehouses(user, db)).warehouseIds : null;
  }
  if (user.role === Role.SUPERVISOR) {
    const team = await scope.teamIds(user.id, db);
    const driven = [...(await vehicles.currentVehiclesOf(team, db)).values()].map((v) => v.id);
    const depots = multiUnit ? ((await scope.warehouses(user, db)).warehouseIds ?? []) : [];
    return [...new Set([...driven, ...depots])];
  }
  const own = await vehicles.currentVehicleOf(user.id, db);
  return own ? [own.id] : [];
}

/** Whose seller routes and which trucks' routes a user reaches. null = all. */
export interface RouteReach {
  sellerIds: string[] | null;
  vehicleIds: string[] | null;
}

export async function tourneeRouteReach(
  scope: ScopeService,
  vehicles: VehiclesService,
  user: CurrentUserInfo,
  db?: Tx,
): Promise<RouteReach> {
  return {
    sellerIds: await tourneeSellerIds(scope, user, db),
    vehicleIds: await tourneeVehicleIds(scope, vehicles, user, db),
  };
}

/** A vehicle route follows its truck, a seller route its seller. */
export function routeVisible(
  reach: RouteReach,
  route: { sellerId: string | null; vehicleId: string | null },
): boolean {
  if (route.vehicleId)
    return reach.vehicleIds === null || reach.vehicleIds.includes(route.vehicleId);
  return (
    reach.sellerIds === null ||
    (route.sellerId !== null && reach.sellerIds.includes(route.sellerId))
  );
}

/** The same rule as a filter. */
export function routeWhere(reach: RouteReach): Prisma.RouteWhereInput {
  if (reach.sellerIds === null && reach.vehicleIds === null) return {};
  return {
    OR: [
      { vehicleId: null, ...(reach.sellerIds ? { sellerId: { in: reach.sellerIds } } : {}) },
      { vehicleId: reach.vehicleIds ? { in: reach.vehicleIds } : { not: null } },
    ],
  };
}
