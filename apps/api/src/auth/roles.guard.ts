import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ErrorCode, type Role } from '@erp/shared';
import { AppException } from '../common/app-exception';
import type { AuthenticatedRequest } from './auth.types';
import { IS_PUBLIC_KEY, ROLES_KEY } from './decorators';

/** Runs after JwtAuthGuard. Only checks routes decorated with @Roles(...). */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) return true;
    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, targets);
    if (!roles || roles.length === 0) return true;

    const { user } = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!roles.includes(user.role)) {
      throw new AppException(ErrorCode.FORBIDDEN, 'Your role does not allow this action', {
        required: roles,
      });
    }
    return true;
  }
}
