import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService, TokenExpiredError } from '@nestjs/jwt';
import { ErrorCode } from '@erp/shared';
import { AppException } from '../common/app-exception';
import { tenantContext } from '../common/tenant-context';
import { PrismaService } from '../prisma/prisma.service';
import type { AdminRequest, AdminTokenPayload } from './admin.types';

export const ADMIN_PUBLIC_KEY = 'erp:adminPublic';

/**
 * Guards every /admin route: an admin access token whose session is still open. The
 * request then runs in the system context (no tenant filter); admin services always
 * name the tenant they act on.
 */
@Injectable()
export class AdminAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const ctx = tenantContext.get();
    if (!ctx) throw new Error('Request context missing: RequestContextMiddleware not applied');
    ctx.system = true;
    if (this.reflector.get<boolean>(ADMIN_PUBLIC_KEY, context.getHandler())) return true;

    const req = context.switchToHttp().getRequest<AdminRequest>();
    const header = req.get('authorization');
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    if (!token) throw new AppException(ErrorCode.UNAUTHENTICATED, 'Missing access token');

    let payload: AdminTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<AdminTokenPayload>(token);
    } catch (err) {
      if (err instanceof TokenExpiredError) {
        throw new AppException(ErrorCode.TOKEN_EXPIRED, 'Access token expired');
      }
      throw new AppException(ErrorCode.INVALID_TOKEN, 'Invalid access token');
    }
    if (payload.typ !== 'admin') {
      throw new AppException(ErrorCode.INVALID_TOKEN, 'Invalid access token');
    }

    const session = await this.prisma.db.platformAdminSession.findUnique({
      where: { id: payload.sid },
      include: { admin: true },
    });
    if (!session || session.adminId !== payload.sub || session.admin.deletedAt) {
      throw new AppException(ErrorCode.INVALID_TOKEN, 'Invalid access token');
    }
    if (session.revokedAt) throw new AppException(ErrorCode.SESSION_REVOKED, 'Session revoked');
    if (session.expiresAt <= new Date()) {
      throw new AppException(ErrorCode.SESSION_EXPIRED, 'Session expired');
    }
    req.admin = {
      id: session.admin.id,
      sessionId: session.id,
      email: session.admin.email,
      fullName: session.admin.fullName,
    };
    return true;
  }
}
