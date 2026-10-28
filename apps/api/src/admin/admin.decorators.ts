import {
  applyDecorators,
  Controller,
  createParamDecorator,
  type ExecutionContext,
  SetMetadata,
  UseGuards,
} from '@nestjs/common';
import { ADMIN_ROUTE_KEY } from '../auth/decorators';
import { ADMIN_PUBLIC_KEY, AdminAuthGuard } from './admin-auth.guard';
import type { AdminRequest, CurrentAdminInfo } from './admin.types';

/**
 * A super-admin controller under /admin. The tenant guard skips it and AdminAuthGuard
 * checks an admin token instead, so a tenant token can never reach these routes.
 */
export const AdminController = (path: string): ClassDecorator =>
  applyDecorators(
    Controller(`admin/${path}`),
    SetMetadata(ADMIN_ROUTE_KEY, true),
    UseGuards(AdminAuthGuard),
  );

/** Admin route without a token (login, refresh). */
export const AdminPublic = (): MethodDecorator => SetMetadata(ADMIN_PUBLIC_KEY, true);

export const CurrentAdmin = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): CurrentAdminInfo =>
    ctx.switchToHttp().getRequest<AdminRequest>().admin,
);
