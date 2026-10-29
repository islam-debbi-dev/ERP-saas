import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { type AdminAuthResponse, type AdminLoginInput, ErrorCode } from '@erp/shared';
import { LOCK_MINUTES, MAX_FAILED_LOGINS } from '../auth/auth.service';
import type { ClientMeta } from '../auth/auth.types';
import { LoginLimiter } from '../auth/login-limiter';
import { TokenService } from '../auth/token.service';
import { AppException } from '../common/app-exception';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import type { PlatformAdmin } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PlatformAuditService } from './platform-audit.service';
import { verifyTotp } from './totp';
import type { AdminTokenPayload, CurrentAdminInfo } from './admin.types';

/** An admin session lasts a working day; then password and code again. */
export const ADMIN_SESSION_HOURS = 12;

export interface AdminIssuedTokens extends AdminAuthResponse {
  refreshToken: string;
}

const DUMMY_HASH_PROMISE = argon2.hash('not-a-real-password-just-for-timing');

/**
 * Super-admin login: password **and** a TOTP code, rate limited and locked after 5
 * failures like tenant logins. Refresh tokens rotate; presenting an old one closes the
 * session. Admin requests always run in the system context (AdminAuthGuard).
 */
@Injectable()
export class AdminAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly limiter: LoginLimiter,
    private readonly audit: PlatformAuditService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async login(input: AdminLoginInput, meta: ClientMeta): Promise<AdminIssuedTokens> {
    const keys = [`admin-ip:${meta.ip ?? 'unknown'}`, `admin-id:${input.email}`];
    if (!this.limiter.hit(keys)) {
      throw new AppException(ErrorCode.TOO_MANY_REQUESTS, 'Too many login attempts', {
        retryAfterSeconds: this.limiter.retryAfter(keys),
      });
    }
    const admin = await this.prisma.db.platformAdmin.findUnique({ where: { email: input.email } });
    const now = new Date();
    if (!admin || admin.deletedAt) {
      await argon2.verify(await DUMMY_HASH_PROMISE, input.password);
      throw new AppException(ErrorCode.INVALID_CREDENTIALS, 'Invalid email or password');
    }
    if (admin.lockedUntil && admin.lockedUntil > now) {
      await argon2.verify(await DUMMY_HASH_PROMISE, input.password);
      throw new AppException(ErrorCode.ACCOUNT_LOCKED, 'Too many failed attempts', {
        lockedUntil: admin.lockedUntil.toISOString(),
      });
    }
    if (!(await argon2.verify(admin.passwordHash, input.password))) {
      await this.recordFailure(admin, 'password', meta);
      throw new AppException(ErrorCode.INVALID_CREDENTIALS, 'Invalid email or password');
    }
    if (!verifyTotp(admin.totpSecret, input.code, now)) {
      await this.recordFailure(admin, 'totp', meta);
      throw new AppException(ErrorCode.ADMIN_TOTP_INVALID, 'Wrong or expired code');
    }

    return this.prisma.db.$transaction(async (tx) => {
      await tx.platformAdmin.update({
        where: { id: admin.id },
        data: { failedLoginCount: 0, lockedUntil: null },
      });
      const refresh = this.newRefresh();
      const session = await tx.platformAdminSession.create({
        data: {
          adminId: admin.id,
          refreshTokenHash: refresh.hash,
          userAgent: meta.userAgent?.slice(0, 255) ?? null,
          ip: meta.ip?.slice(0, 45) ?? null,
          expiresAt: new Date(now.getTime() + ADMIN_SESSION_HOURS * 3_600_000),
        },
      });
      await this.audit.log(tx, {
        adminId: admin.id,
        sessionId: session.id,
        action: 'ADMIN_LOGIN',
        ip: meta.ip ?? null,
      });
      return this.issue(admin, session.id, refresh.secret);
    });
  }

  /** Rotates the refresh token. A token that is not the current one closes the session. */
  async refresh(refreshToken: string | undefined): Promise<AdminIssuedTokens> {
    const parsed = refreshToken ? TokenService.parseRefreshToken(refreshToken) : null;
    if (!parsed) throw new AppException(ErrorCode.INVALID_TOKEN, 'Invalid refresh token');
    const session = await this.prisma.db.platformAdminSession.findUnique({
      where: { id: parsed.sessionId },
      include: { admin: true },
    });
    if (!session) throw new AppException(ErrorCode.INVALID_TOKEN, 'Invalid refresh token');
    if (session.revokedAt) throw new AppException(ErrorCode.SESSION_REVOKED, 'Session revoked');
    if (session.expiresAt <= new Date() || session.admin.deletedAt) {
      throw new AppException(ErrorCode.SESSION_EXPIRED, 'Session expired');
    }
    const presented = TokenService.hash(parsed.secret);
    const next = this.newRefresh();
    const now = new Date();
    const { count } = TokenService.sameHash(presented, session.refreshTokenHash)
      ? await this.prisma.db.platformAdminSession.updateMany({
          where: { id: session.id, refreshTokenHash: presented, revokedAt: null },
          data: {
            refreshTokenHash: next.hash,
            previousRefreshTokenHash: presented,
            rotatedAt: now,
            lastUsedAt: now,
          },
        })
      : { count: 0 };
    if (count === 0) {
      await this.prisma.db.platformAdminSession.updateMany({
        where: { id: session.id, revokedAt: null },
        data: { revokedAt: now },
      });
      throw new AppException(
        ErrorCode.REFRESH_TOKEN_REUSED,
        'Refresh token already used: the session was closed for safety',
      );
    }
    return this.issue(session.admin, session.id, next.secret);
  }

  /** Closes the admin session, and with it every read-only view it opened. */
  async logout(admin: CurrentAdminInfo): Promise<void> {
    await this.prisma.db.$transaction(async (tx) => {
      await tx.platformAdminSession.updateMany({
        where: { id: admin.sessionId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.audit.log(tx, {
        adminId: admin.id,
        sessionId: admin.sessionId,
        action: 'ADMIN_LOGOUT',
      });
    });
  }

  private async recordFailure(
    admin: PlatformAdmin,
    reason: 'password' | 'totp',
    meta: ClientMeta,
  ): Promise<void> {
    await this.prisma.db.$transaction(async (tx) => {
      const [row] = await tx.$queryRaw<{ failedLoginCount: number }[]>`
        UPDATE platform_admins SET "failedLoginCount" = "failedLoginCount" + 1
        WHERE id = ${admin.id}::uuid RETURNING "failedLoginCount"`;
      const failures = row?.failedLoginCount ?? 1;
      if (failures >= MAX_FAILED_LOGINS) {
        await tx.platformAdmin.update({
          where: { id: admin.id },
          data: {
            failedLoginCount: 0,
            lockedUntil: new Date(Date.now() + LOCK_MINUTES * 60_000),
          },
        });
      }
      await this.audit.log(tx, {
        adminId: admin.id,
        action: 'ADMIN_LOGIN_FAILED',
        detail: { reason, failures },
        ip: meta.ip ?? null,
      });
    });
  }

  private newRefresh(): { secret: string; hash: string } {
    const secret = TokenService.newSecret();
    return { secret, hash: TokenService.hash(secret) };
  }

  private async issue(
    admin: PlatformAdmin,
    sessionId: string,
    refreshSecret: string,
  ): Promise<AdminIssuedTokens> {
    const payload: AdminTokenPayload = { sub: admin.id, sid: sessionId, typ: 'admin' };
    return {
      accessToken: await this.jwt.signAsync(payload, {
        expiresIn: this.config.ACCESS_TOKEN_TTL_SECONDS,
      }),
      expiresIn: this.config.ACCESS_TOKEN_TTL_SECONDS,
      refreshToken: TokenService.formatRefreshToken(sessionId, refreshSecret),
      admin: { id: admin.id, email: admin.email, fullName: admin.fullName },
    };
  }
}
