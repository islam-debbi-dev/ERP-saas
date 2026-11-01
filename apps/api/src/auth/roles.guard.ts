import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ErrorCode, type Permission, type Role } from '@erp/shared';
import { AppException } from '../common/app-exception';
import type { AuthenticatedRequest } from './auth.types';
import { IS_PUBLIC_KEY, PERMISSION_KEY, ROLES_KEY } from './decorators';

/**
 * Runs after JwtAuthGuard. Checks routes decorated with @Roles(...) and/or
 * @RequirePermission(...); a route with both needs both.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) return true;
    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, targets);
    const permission = this.reflector.getAllAndOverride<Permission | undefined>(
      PERMISSION_KEY,
      targets,
    );
    if ((!roles || roles.length === 0) && !permission) return true;

    const { user } = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (roles && roles.length > 0 && !roles.includes(user.role)) {
      throw new AppException(ErrorCode.FORBIDDEN, 'Your role does not allow this action', {
        required: roles,
      });
    }
    if (permission && !user.permissions.includes(permission)) {
      throw new AppException(
        ErrorCode.FORBIDDEN,
        'You do not have the permission for this action',
        {
          permission,
        },
      );
    }
    return true;
  }
}
