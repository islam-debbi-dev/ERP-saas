import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { TokenExpiredError } from '@nestjs/jwt';
import { effectivePermissions, ErrorCode } from '@erp/shared';
import { AppException } from '../common/app-exception';
import { tenantContext } from '../common/tenant-context';
import { PrismaService } from '../prisma/prisma.service';
import type { AccessTokenPayload, AuthenticatedRequest } from './auth.types';
import { ALLOW_PASSWORD_CHANGE_KEY, IS_PUBLIC_KEY } from './decorators';
import { TokenService } from './token.service';

/** Refresh `lastUsedAt` at most this often, to avoid a write on every request. */
const LAST_USED_THROTTLE_MS = 5 * 60 * 1000;

/**
 * Global guard: verifies the access token, then checks the session is still active
 * (so revoking a lost phone takes effect immediately) and fills the tenant context.
 * The role and permissions are read from the database, so a change applies on the
 * next request; so does a temporary password (only the password change is allowed).
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = req.get('authorization');
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    if (!token) throw new AppException(ErrorCode.UNAUTHENTICATED, 'Missing access token');

    let payload: AccessTokenPayload;
    try {
      payload = await this.tokens.verifyAccess(token);
    } catch (err) {
      if (err instanceof TokenExpiredError) {
        throw new AppException(ErrorCode.TOKEN_EXPIRED, 'Access token expired');
      }
      throw new AppException(ErrorCode.INVALID_TOKEN, 'Invalid access token');
    }

    const ctx = tenantContext.get();
    if (!ctx) throw new Error('Request context missing: RequestContextMiddleware not applied');
    ctx.tenantId = payload.tid;
    ctx.userId = payload.sub;
    ctx.sessionId = payload.sid;

    const session = await this.prisma.db.session.findUnique({
      where: { id: payload.sid },
      include: { user: true },
    });
    const now = new Date();
    if (!session || session.userId !== payload.sub || session.user.deletedAt) {
      throw new AppException(ErrorCode.INVALID_TOKEN, 'Invalid access token');
    }
    if (session.revokedAt) throw new AppException(ErrorCode.SESSION_REVOKED, 'Session revoked');
    if (session.expiresAt <= now)
      throw new AppException(ErrorCode.SESSION_EXPIRED, 'Session expired');

    ctx.deviceName = session.deviceName;
    const user = session.user;
    req.user = {
      id: user.id,
      tenantId: session.tenantId,
      sessionId: session.id,
      role: user.role,
      email: user.email,
      phone: user.phone,
      fullName: user.fullName,
      permissions: effectivePermissions(user.role, user.permissionGrants, user.permissionRevokes),
      mustChangePassword: user.mustChangePassword,
    };
    if (
      user.mustChangePassword &&
      !this.reflector.getAllAndOverride<boolean>(ALLOW_PASSWORD_CHANGE_KEY, targets)
    ) {
      throw new AppException(
        ErrorCode.PASSWORD_CHANGE_REQUIRED,
        'Change your temporary password first',
      );
    }

    if (now.getTime() - session.lastUsedAt.getTime() > LAST_USED_THROTTLE_MS) {
      await this.prisma.db.session.update({ where: { id: session.id }, data: { lastUsedAt: now } });
    }
    return true;
  }
}
