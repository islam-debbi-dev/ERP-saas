import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { TokenExpiredError } from '@nestjs/jwt';
import { effectivePermissions, ErrorCode, Role } from '@erp/shared';
import { BillingService } from '../billing/billing.service';
import { AppException } from '../common/app-exception';
import { tenantContext } from '../common/tenant-context';
import { PrismaService } from '../prisma/prisma.service';
import type { AccessTokenPayload, AuthenticatedRequest } from './auth.types';
import {
  ADMIN_ROUTE_KEY,
  ALLOW_PASSWORD_CHANGE_KEY,
  ALLOW_WHEN_SUSPENDED_KEY,
  IS_PUBLIC_KEY,
} from './decorators';
import { TokenService } from './token.service';

/** Refresh `lastUsedAt` at most this often, to avoid a write on every request. */
const LAST_USED_THROTTLE_MS = 5 * 60 * 1000;
/** Requests that never change data: allowed while suspended or impersonating. */
const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Global guard: verifies the access token, then checks the session is still active
 * (so revoking a lost phone takes effect immediately) and fills the tenant context.
 * The role and permissions are read from the database, so a change applies on the
 * next request; so does a temporary password (only the password change is allowed).
 * Writes are refused for a SUSPENDED subscription and for a super-admin's read-only view.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    private readonly prisma: PrismaService,
    private readonly billing: BillingService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets);
    if (isPublic) return true;
    // Super-admin routes have their own guard (AdminAuthGuard) and token type.
    if (this.reflector.getAllAndOverride<boolean>(ADMIN_ROUTE_KEY, targets)) return true;

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
    if (!payload.tid) throw new AppException(ErrorCode.INVALID_TOKEN, 'Invalid access token');

    const ctx = tenantContext.get();
    if (!ctx) throw new Error('Request context missing: RequestContextMiddleware not applied');
    ctx.tenantId = payload.tid;
    ctx.userId = payload.sub;
    ctx.sessionId = payload.sid;

    if (payload.typ === 'imp') {
      await this.impersonation(req, payload);
      if (!READ_METHODS.has(req.method)) {
        throw new AppException(
          ErrorCode.IMPERSONATION_READ_ONLY,
          'Support view is read-only: no change can be made',
        );
      }
      return true;
    }

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

    if (
      !READ_METHODS.has(req.method) &&
      !this.reflector.getAllAndOverride<boolean>(ALLOW_WHEN_SUSPENDED_KEY, targets)
    ) {
      await this.billing.assertWritable(session.tenantId);
    }

    if (now.getTime() - session.lastUsedAt.getTime() > LAST_USED_THROTTLE_MS) {
      await this.prisma.db.session.update({ where: { id: session.id }, data: { lastUsedAt: now } });
    }
    return true;
  }

  /**
   * A super-admin's read-only view of the tenant, as its OWNER. Valid while the admin
   * session that issued it is active; every request is written to the platform audit log.
   */
  private async impersonation(req: AuthenticatedRequest, payload: AccessTokenPayload) {
    const invalid = () => new AppException(ErrorCode.INVALID_TOKEN, 'Invalid access token');
    if (!payload.adm) throw invalid();
    const adminSession = await tenantContext.runAsSystem(() =>
      this.prisma.db.platformAdminSession.findUnique({ where: { id: payload.sid } }),
    );
    if (
      !adminSession ||
      adminSession.adminId !== payload.adm ||
      adminSession.revokedAt ||
      adminSession.expiresAt <= new Date()
    ) {
      throw new AppException(ErrorCode.SESSION_REVOKED, 'Support session closed');
    }
    const user = await this.prisma.db.user.findUnique({ where: { id: payload.sub } });
    if (!user || user.role !== Role.OWNER) throw invalid();
    req.user = {
      id: user.id,
      tenantId: user.tenantId,
      sessionId: payload.sid,
      role: user.role,
      email: user.email,
      phone: user.phone,
      fullName: user.fullName,
      permissions: effectivePermissions(user.role, user.permissionGrants, user.permissionRevokes),
      mustChangePassword: false,
      impersonatedBy: { adminId: payload.adm, adminSessionId: payload.sid },
    };
    await tenantContext.runAsSystem(() =>
      this.prisma.db.platformAuditLog.create({
        data: {
          adminId: payload.adm,
          sessionId: payload.sid,
          tenantId: user.tenantId,
          action: 'IMPERSONATION_REQUEST',
          detail: { method: req.method, path: req.path },
          ip: req.ip ?? null,
        },
      }),
    );
  }
}
