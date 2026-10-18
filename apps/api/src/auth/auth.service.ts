import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import {
  type AuthResponse,
  type AuthUser,
  ErrorCode,
  type LoginInput,
  type RegisterInput,
  Role,
  type SessionInfo,
} from '@erp/shared';
import { AuditService } from '../audit/audit.service';
import { CatalogService } from '../catalog/catalog.service';
import { AppException } from '../common/app-exception';
import { tenantContext } from '../common/tenant-context';
import { Prisma } from '../generated/prisma/client';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import type { ClientMeta, CurrentUserInfo } from './auth.types';
import { TokenService } from './token.service';

/** Tokens issued by login/register/refresh. The controller decides where the refresh token goes. */
export interface IssuedTokens extends Omit<AuthResponse, 'refreshToken'> {
  refreshToken: string;
}

interface UserForToken {
  id: string;
  tenantId: string;
  email: string;
  fullName: string;
  role: Role;
  tenant: { name: string };
}

// Verified against when the email is unknown, so response time doesn't reveal which emails exist.
const DUMMY_HASH_PROMISE = argon2.hash('not-a-real-password-just-for-timing');

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly audit: AuditService,
    private readonly catalog: CatalogService,
  ) {}

  /** Creates the company (tenant) and its OWNER in one transaction, then logs them in. */
  async register(input: RegisterInput, meta: ClientMeta): Promise<IssuedTokens> {
    const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id });
    return tenantContext.runAsSystem(async () => {
      try {
        return await this.prisma.db.$transaction(async (tx) => {
          const tenant = await tx.tenant.create({
            data: { name: input.companyName, raisonSociale: input.companyName },
          });
          await this.catalog.initTenant(tx, tenant.id, tenant.priceLevelCount);
          const user = await tx.user.create({
            data: {
              tenantId: tenant.id,
              email: input.email,
              passwordHash,
              fullName: input.fullName,
              role: Role.OWNER,
            },
            include: { tenant: { select: { name: true } } },
          });
          const issued = await this.openSession(tx, user, {
            ...meta,
            deviceName: input.deviceName,
          });
          await this.audit.log(tx, {
            tenantId: tenant.id,
            userId: user.id,
            sessionId: issued.sessionId,
            action: 'TENANT_REGISTERED',
            entity: 'Tenant',
            entityId: tenant.id,
            after: { name: tenant.name, ownerEmail: user.email },
          });
          return issued.tokens;
        });
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          throw new AppException(ErrorCode.EMAIL_ALREADY_USED, 'This email is already used');
        }
        throw err;
      }
    });
  }

  async login(input: LoginInput, meta: ClientMeta): Promise<IssuedTokens> {
    return tenantContext.runAsSystem(async () => {
      const user = await this.prisma.db.user.findUnique({
        where: { email: input.email },
        include: { tenant: { select: { name: true } } },
      });
      const valid =
        user && !user.deletedAt
          ? await argon2.verify(user.passwordHash, input.password)
          : await argon2.verify(await DUMMY_HASH_PROMISE, input.password).then(() => false);
      if (!user || !valid) {
        throw new AppException(ErrorCode.INVALID_CREDENTIALS, 'Invalid email or password');
      }

      return this.prisma.db.$transaction(async (tx) => {
        const issued = await this.openSession(tx, user, { ...meta, deviceName: input.deviceName });
        await this.audit.log(tx, {
          tenantId: user.tenantId,
          userId: user.id,
          sessionId: issued.sessionId,
          action: 'LOGIN',
          entity: 'Session',
          entityId: issued.sessionId,
        });
        return issued.tokens;
      });
    });
  }

  /**
   * Rotates the refresh token. Presenting a token that is no longer the current one
   * for its session means it was stolen or replayed: the whole session is revoked.
   */
  async refresh(refreshToken: string | undefined): Promise<IssuedTokens> {
    const parsed = refreshToken ? TokenService.parseRefreshToken(refreshToken) : null;
    if (!parsed) throw new AppException(ErrorCode.INVALID_TOKEN, 'Invalid refresh token');

    return tenantContext.runAsSystem(async () => {
      const session = await this.prisma.db.session.findUnique({
        where: { id: parsed.sessionId },
        include: { user: { include: { tenant: { select: { name: true } } } } },
      });
      if (!session) throw new AppException(ErrorCode.INVALID_TOKEN, 'Invalid refresh token');
      if (session.revokedAt) throw new AppException(ErrorCode.SESSION_REVOKED, 'Session revoked');
      if (session.expiresAt <= new Date() || session.user.deletedAt) {
        throw new AppException(ErrorCode.SESSION_EXPIRED, 'Session expired');
      }

      const presentedHash = TokenService.hash(parsed.secret);
      const next = this.tokens.newRefreshSecret();
      const now = new Date();

      // Normal case. Compare-and-swap on the current hash, so two concurrent
      // refreshes with the same token cannot both rotate it.
      let swapped = { count: 0 };
      if (TokenService.sameHash(presentedHash, session.refreshTokenHash)) {
        swapped = await this.prisma.db.session.updateMany({
          where: { id: session.id, refreshTokenHash: presentedHash, revokedAt: null },
          data: {
            refreshTokenHash: next.hash,
            previousRefreshTokenHash: presentedHash,
            rotatedAt: now,
            lastUsedAt: now,
          },
        });
      }

      // Grace: the token replaced moments ago (a reload or a second tab whose
      // response was lost) is accepted once more. The window counts from the
      // original rotation, so repeating the old token does not extend it.
      if (swapped.count === 0) {
        const graceStart = new Date(now.getTime() - this.tokens.reuseGraceSeconds * 1000);
        swapped = await this.prisma.db.session.updateMany({
          where: {
            id: session.id,
            previousRefreshTokenHash: presentedHash,
            rotatedAt: { gte: graceStart },
            revokedAt: null,
          },
          data: { refreshTokenHash: next.hash, lastUsedAt: now },
        });
      }

      if (swapped.count === 0) {
        await this.revokeForReuse(session.id, session.tenantId, session.userId);
        throw new AppException(
          ErrorCode.REFRESH_TOKEN_REUSED,
          'Refresh token already used: the session was closed for safety',
        );
      }

      return this.buildTokens(session.user, session.id, next.secret);
    });
  }

  /** Revokes the current session (logout). */
  async logout(user: CurrentUserInfo): Promise<void> {
    await this.revokeSession(user, user.sessionId, 'LOGOUT');
  }

  async listSessions(user: CurrentUserInfo): Promise<SessionInfo[]> {
    const sessions = await this.prisma.db.session.findMany({
      where: { userId: user.id, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { lastUsedAt: 'desc' },
    });
    return sessions.map((s) => ({
      id: s.id,
      deviceName: s.deviceName,
      userAgent: s.userAgent,
      ip: s.ip,
      createdAt: s.createdAt.toISOString(),
      lastUsedAt: s.lastUsedAt.toISOString(),
      expiresAt: s.expiresAt.toISOString(),
      current: s.id === user.sessionId,
    }));
  }

  /**
   * Revokes one session. Users can revoke their own sessions; the OWNER can revoke any
   * session of the company (lost phone of an employee).
   */
  async revokeSession(
    user: CurrentUserInfo,
    sessionId: string,
    reason: 'LOGOUT' | 'REVOKED' = 'REVOKED',
  ): Promise<void> {
    await this.prisma.db.$transaction(async (tx) => {
      const session = await tx.session.findUnique({ where: { id: sessionId } });
      if (!session || (session.userId !== user.id && user.role !== Role.OWNER)) {
        throw new AppException(ErrorCode.NOT_FOUND, 'Session not found');
      }
      if (session.revokedAt) return;
      await tx.session.update({
        where: { id: sessionId },
        data: { revokedAt: new Date(), revokedReason: reason },
      });
      await this.audit.log(tx, {
        action: reason === 'LOGOUT' ? 'LOGOUT' : 'SESSION_REVOKED',
        entity: 'Session',
        entityId: sessionId,
        before: { userId: session.userId, deviceName: session.deviceName },
      });
    });
  }

  async me(user: CurrentUserInfo): Promise<AuthUser> {
    const tenant = await this.prisma.db.tenant.findUniqueOrThrow({
      where: { id: user.tenantId },
      select: { name: true },
    });
    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      tenantId: user.tenantId,
      tenantName: tenant.name,
    };
  }

  private async revokeForReuse(sessionId: string, tenantId: string, userId: string): Promise<void> {
    await this.prisma.db.$transaction(async (tx) => {
      const { count } = await tx.session.updateMany({
        where: { id: sessionId, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: 'REUSE_DETECTED' },
      });
      if (count > 0) {
        await this.audit.log(tx, {
          tenantId,
          userId,
          sessionId,
          action: 'REFRESH_TOKEN_REUSED',
          entity: 'Session',
          entityId: sessionId,
        });
      }
    });
  }

  private async openSession(
    tx: Tx,
    user: UserForToken,
    meta: ClientMeta,
  ): Promise<{ sessionId: string; tokens: IssuedTokens }> {
    const refresh = this.tokens.newRefreshSecret();
    const session = await tx.session.create({
      data: {
        tenantId: user.tenantId,
        userId: user.id,
        refreshTokenHash: refresh.hash,
        deviceName: meta.deviceName?.slice(0, 100) ?? null,
        userAgent: meta.userAgent?.slice(0, 255) ?? null,
        ip: meta.ip?.slice(0, 45) ?? null,
        expiresAt: this.tokens.refreshExpiry(),
      },
    });
    return {
      sessionId: session.id,
      tokens: await this.buildTokens(user, session.id, refresh.secret),
    };
  }

  private async buildTokens(
    user: UserForToken,
    sessionId: string,
    refreshSecret: string,
  ): Promise<IssuedTokens> {
    const accessToken = await this.tokens.signAccess({
      sub: user.id,
      tid: user.tenantId,
      sid: sessionId,
      role: user.role,
    });
    return {
      accessToken,
      expiresIn: this.tokens.accessTtlSeconds,
      refreshToken: TokenService.formatRefreshToken(sessionId, refreshSecret),
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        tenantId: user.tenantId,
        tenantName: user.tenant.name,
      },
    };
  }
}
