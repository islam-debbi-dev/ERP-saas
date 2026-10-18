import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Role } from '@erp/shared';
import type { AuthenticatedRequest, CurrentUserInfo } from './auth.types';

export const IS_PUBLIC_KEY = 'erp:isPublic';
export const ROLES_KEY = 'erp:roles';

/** Route needs no access token (login, register, refresh, health). */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC_KEY, true);

/** Route is limited to these roles. Without @Roles, any authenticated user passes. */
export const Roles = (...roles: Role[]): MethodDecorator & ClassDecorator =>
  SetMetadata(ROLES_KEY, roles);

/** The authenticated user, as loaded by JwtAuthGuard. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): CurrentUserInfo =>
    ctx.switchToHttp().getRequest<AuthenticatedRequest>().user,
);
