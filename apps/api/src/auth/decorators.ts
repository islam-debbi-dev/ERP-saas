import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Feature, Role } from '@erp/shared';
import type { AuthenticatedRequest, CurrentUserInfo } from './auth.types';

export const IS_PUBLIC_KEY = 'erp:isPublic';
export const ROLES_KEY = 'erp:roles';
export const ALLOW_PASSWORD_CHANGE_KEY = 'erp:allowPasswordChange';
export const ALLOW_WHEN_SUSPENDED_KEY = 'erp:allowWhenSuspended';
export const FEATURE_KEY = 'erp:feature';
/** Super-admin routes: the tenant guard skips them, AdminAuthGuard checks them. */
export const ADMIN_ROUTE_KEY = 'erp:adminRoute';

/** Route needs no access token (login, register, refresh, health). */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC_KEY, true);

/** Route is limited to these roles. Without @Roles, any authenticated user passes. */
export const Roles = (...roles: Role[]): MethodDecorator & ClassDecorator =>
  SetMetadata(ROLES_KEY, roles);

/**
 * Reachable while the user must still change a temporary password (me, logout,
 * change password). Every other route answers PASSWORD_CHANGE_REQUIRED.
 */
export const AllowPendingPasswordChange = (): MethodDecorator & ClassDecorator =>
  SetMetadata(ALLOW_PASSWORD_CHANGE_KEY, true);

/**
 * A write a SUSPENDED tenant can still make (logout, password change, closing a
 * session): suspension is read-only, never a lock-out.
 */
export const AllowWhenSuspended = (): MethodDecorator & ClassDecorator =>
  SetMetadata(ALLOW_WHEN_SUSPENDED_KEY, true);

/**
 * Route of a module outside the core (phase 13b): a tenant whose edition and grants do not
 * include it gets FEATURE_NOT_IN_PLAN. Put it on the module's screens and writes, never on
 * the reports and Excel exports of its data: turning a module off must keep that data
 * readable.
 */
export const RequireFeature = (feature: Feature): MethodDecorator & ClassDecorator =>
  SetMetadata(FEATURE_KEY, feature);

/** The authenticated user, as loaded by JwtAuthGuard. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): CurrentUserInfo =>
    ctx.switchToHttp().getRequest<AuthenticatedRequest>().user,
);
