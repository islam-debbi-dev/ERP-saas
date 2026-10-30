import { ErrorCode, Role } from '@erp/shared';
import { type CurrentUserInfo } from '../auth/auth.types';
import { AppException } from '../common/app-exception';
import { type Tx } from '../prisma/prisma.service';
import { type ScopeService } from '../sales-force/scope.service';

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
  if (user.role === Role.SUPERVISOR && !(await scope.teamIds(user.id, tx)).includes(sellerId)) {
    throw new AppException(ErrorCode.FORBIDDEN, 'This seller is not in your team', {
      field: 'sellerId',
    });
  }
  return sellerId;
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
