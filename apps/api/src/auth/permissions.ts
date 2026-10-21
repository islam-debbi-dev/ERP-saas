import { ErrorCode, type Permission } from '@erp/shared';
import { AppException } from '../common/app-exception';
import type { CurrentUserInfo } from './auth.types';

/** Effective permissions come from JwtAuthGuard (role defaults + grants − revokes). */
export function can(user: Pick<CurrentUserInfo, 'permissions'>, permission: Permission): boolean {
  return user.permissions.includes(permission);
}

/**
 * Service-level check (AGENTS: guards are not enough). Throws FORBIDDEN, or
 * `code`, with the missing permission in the details so the web can explain it.
 */
export function requirePermission(
  user: Pick<CurrentUserInfo, 'permissions'>,
  permission: Permission,
  options: { message?: string; code?: ErrorCode; details?: Record<string, unknown> } = {},
): void {
  if (can(user, permission)) return;
  throw new AppException(
    options.code ?? ErrorCode.FORBIDDEN,
    options.message ?? 'You do not have the permission for this action',
    { permission, ...options.details },
  );
}
