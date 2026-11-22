import { Inject, Injectable, Logger } from '@nestjs/common';
import * as argon2 from 'argon2';
import {
  ACTIVITY_EDITION,
  DEFAULT_EXPENSE_CATEGORIES,
  Edition,
  effectiveFeatures,
  type AcceptInvitationInput,
  type AuthResponse,
  type AuthUser,
  type ChangePasswordInput,
  effectivePermissions,
  ErrorCode,
  Feature,
  type InvitationInfoDto,
  isEmailIdentifier,
  type LoginInput,
  MOBILE_SEAT_ROLES,
  normalizePhone,
  type RegisterInput,
  Role,
  SessionClientType,
  type SessionInfo,
  type TenantSessionDto,
  WarehouseType,
} from '@erp/shared';
import { AuditService } from '../audit/audit.service';
import { BillingService } from '../billing/billing.service';
import { FeaturesService } from '../billing/features.service';
import { CatalogService } from '../catalog/catalog.service';
import { AppException } from '../common/app-exception';
import { tenantContext } from '../common/tenant-context';
import { ScopeService } from '../sales-force/scope.service';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { Prisma } from '../generated/prisma/client';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import { DEFAULT_WAREHOUSE_NAME } from '../stock/warehouses.service';
import type { ClientMeta, CurrentUserInfo } from './auth.types';
import { LoginLimiter } from './login-limiter';
import { TokenService } from './token.service';

/** Tokens issued by login/register/refresh. The controller decides where the refresh token goes. */
export interface IssuedTokens extends Omit<AuthResponse, 'refreshToken'> {
  refreshToken: string;
}

interface UserForToken {
  id: string;
  tenantId: string;
  email: string | null;
  phone: string | null;
  fullName: string;
  role: Role;
  permissionGrants: string[];
  permissionRevokes: string[];
  mustChangePassword: boolean;
  tenant: {
    name: string;
    featureGrants: string[];
    featureRevokes: string[];
    subscription: { edition: Edition } | null;
  };
}

/**
 * What a login response needs from the tenant. Read inside the caller's transaction, so a
 * company being registered already has its edition (the cache would not see it yet).
 */
const TENANT_FOR_TOKEN = {
  select: {
    name: true,
    featureGrants: true,
    featureRevokes: true,
    subscription: { select: { edition: true } },
  },
} as const;

/** Wrong passwords in a row before the account is locked, and for how long. */
export const MAX_FAILED_LOGINS = 5;
export const LOCK_MINUTES = 15;
/** How long an invitation link stays valid. */
export const INVITATION_HOURS = 72;

export function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, { type: argon2.argon2id });
}

// Verified against when the email is unknown, so response time doesn't reveal which emails exist.
const DUMMY_HASH_PROMISE = argon2.hash('not-a-real-password-just-for-timing');

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly audit: AuditService,
    private readonly catalog: CatalogService,
    private readonly limiter: LoginLimiter,
    private readonly billing: BillingService,
    private readonly features: FeaturesService,
    private readonly scope: ScopeService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Creates the company (tenant) and its OWNER in one transaction, then logs them in. */
  async register(input: RegisterInput, meta: ClientMeta): Promise<IssuedTokens> {
    const passwordHash = await hashPassword(input.password);
    return tenantContext.runAsSystem(async () => {
      try {
        return await this.prisma.db.$transaction(async (tx) => {
          const tenant = await tx.tenant.create({
            data: { name: input.companyName, raisonSociale: input.companyName },
          });
          await this.catalog.initTenant(tx, tenant.id, tenant.priceLevelCount);
          // The implicit dépôt every tenant has (phase 15).
          await tx.warehouse.create({
            data: {
              tenantId: tenant.id,
              name: DEFAULT_WAREHOUSE_NAME,
              type: WarehouseType.MAIN,
              isDefault: true,
            },
          });
          // The default charge categories (phase 25): Loyer, Électricité / eau...
          await tx.expenseCategory.createMany({
            data: DEFAULT_EXPENSE_CATEGORIES.map((c) => ({ tenantId: tenant.id, ...c })),
          });
          await this.billing.createTrial(tx, tenant.id, ACTIVITY_EDITION[input.activity]);
          const user = await tx.user.create({
            data: {
              tenantId: tenant.id,
              email: input.email,
              passwordHash,
              fullName: input.fullName,
              role: Role.OWNER,
            },
            include: { tenant: TENANT_FOR_TOKEN },
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
            after: { name: tenant.name, ownerEmail: user.email, activity: input.activity },
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

  /**
   * Email or phone + password. Rate limited per IP and per identifier; 5 wrong
   * passwords in a row lock the account for 15 minutes. Failures on a known
   * account are audited in its company; unknown identifiers only go to the logs.
   */
  async login(input: LoginInput, meta: ClientMeta): Promise<IssuedTokens> {
    const keys = [`ip:${meta.ip ?? 'unknown'}`, `id:${input.identifier}`];
    if (!this.limiter.hit(keys)) {
      throw new AppException(ErrorCode.TOO_MANY_REQUESTS, 'Too many login attempts', {
        retryAfterSeconds: this.limiter.retryAfter(keys),
      });
    }
    return tenantContext.runAsSystem(async () => {
      const where = isEmailIdentifier(input.identifier)
        ? { email: input.identifier }
        : { phone: normalizePhone(input.identifier) ?? '' };
      const user = await this.prisma.db.user.findFirst({
        where,
        include: { tenant: TENANT_FOR_TOKEN },
      });
      const now = new Date();
      if (!user || user.deletedAt) {
        await argon2.verify(await DUMMY_HASH_PROMISE, input.password);
        this.logger.warn({ ip: meta.ip }, 'Login failed for an unknown or deactivated account');
        throw new AppException(ErrorCode.INVALID_CREDENTIALS, 'Invalid email or password');
      }
      if (user.lockedUntil && user.lockedUntil > now) {
        await argon2.verify(await DUMMY_HASH_PROMISE, input.password);
        throw new AppException(ErrorCode.ACCOUNT_LOCKED, 'Too many wrong passwords', {
          lockedUntil: user.lockedUntil.toISOString(),
        });
      }
      if (!(await argon2.verify(user.passwordHash, input.password))) {
        await this.recordFailure(user, meta, now);
        throw new AppException(ErrorCode.INVALID_CREDENTIALS, 'Invalid email or password');
      }
      const takesMobileSeat = this.takesMobileSeat(user, meta);
      if (takesMobileSeat) this.assertMobileApp(user);

      return this.prisma.db.$transaction(async (tx) => {
        if (user.failedLoginCount > 0 || user.lockedUntil) {
          await tx.user.update({
            where: { id: user.id },
            data: { failedLoginCount: 0, lockedUntil: null },
          });
        }
        if (takesMobileSeat) {
          await this.billing.assertMobileSeat(tx, user.tenantId, () =>
            this.countOtherMobileSeats(tx, user.tenantId, user.id, now),
          );
        }
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

  /** One more wrong password: counted atomically, the fifth locks the account. */
  private async recordFailure(
    user: { id: string; tenantId: string },
    meta: ClientMeta,
    now: Date,
  ): Promise<void> {
    await this.prisma.db.$transaction(async (tx) => {
      const [row] = await tx.$queryRaw<{ failedLoginCount: number }[]>`
        UPDATE users SET "failedLoginCount" = "failedLoginCount" + 1
        WHERE id = ${user.id}::uuid RETURNING "failedLoginCount"`;
      const failures = row?.failedLoginCount ?? 1;
      const locks = failures >= MAX_FAILED_LOGINS;
      const lockedUntil = new Date(now.getTime() + LOCK_MINUTES * 60_000);
      if (locks) {
        await tx.user.update({
          where: { id: user.id },
          data: { failedLoginCount: 0, lockedUntil },
        });
      }
      await this.audit.log(tx, {
        tenantId: user.tenantId,
        userId: user.id,
        action: 'LOGIN_FAILED',
        entity: 'User',
        entityId: user.id,
        after: { failures, ip: meta.ip ?? null },
      });
      if (locks) {
        await this.audit.log(tx, {
          tenantId: user.tenantId,
          userId: user.id,
          action: 'ACCOUNT_LOCKED',
          entity: 'User',
          entityId: user.id,
          after: { lockedUntil: lockedUntil.toISOString() },
        });
      }
    });
  }

  /**
   * Changes the user's own password. Clears a temporary password and closes the
   * user's other sessions (whoever knew the old password is logged out).
   */
  async changePassword(user: CurrentUserInfo, input: ChangePasswordInput): Promise<AuthUser> {
    const row = await this.prisma.db.user.findUniqueOrThrow({ where: { id: user.id } });
    if (!(await argon2.verify(row.passwordHash, input.currentPassword))) {
      throw new AppException(ErrorCode.INVALID_CREDENTIALS, 'Current password is wrong');
    }
    if (input.currentPassword === input.newPassword) {
      throw new AppException(ErrorCode.VALIDATION_FAILED, 'Choose a new password', {
        field: 'newPassword',
        rule: 'same_as_current',
      });
    }
    const passwordHash = await hashPassword(input.newPassword);
    await this.prisma.db.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: { passwordHash, mustChangePassword: false, passwordChangedAt: new Date() },
      });
      await tx.session.updateMany({
        where: { userId: user.id, revokedAt: null, id: { not: user.sessionId } },
        data: { revokedAt: new Date(), revokedReason: 'PASSWORD_CHANGED' },
      });
      await this.audit.log(tx, { action: 'PASSWORD_CHANGED', entity: 'User', entityId: user.id });
    });
    return this.me({ ...user, mustChangePassword: false });
  }

  /**
   * A one-time link for `userId` to set his password, valid 72 h. Earlier links
   * of the same user stop working. Returns the URL to send (shown once).
   */
  async createInvitation(tx: Tx, userId: string): Promise<{ url: string; expiresAt: Date }> {
    const token = this.tokens.newRefreshSecret();
    const expiresAt = new Date(Date.now() + INVITATION_HOURS * 3_600_000);
    const now = new Date();
    await tx.userInvitation.updateMany({
      where: { userId, usedAt: null },
      data: { usedAt: now },
    });
    await tx.userInvitation.create({
      data: {
        tenantId: tenantContext.requireTenantId(),
        userId,
        tokenHash: token.hash,
        expiresAt,
        createdBy: tenantContext.get()?.userId ?? null,
      },
    });
    const origin = this.config.WEB_ORIGIN.split(',')[0]?.trim() ?? '';
    return { url: `${origin}/invitation/${token.secret}`, expiresAt };
  }

  async invitationInfo(token: string): Promise<InvitationInfoDto> {
    const inv = await this.validInvitation(token);
    return {
      fullName: inv.user.fullName,
      tenantName: inv.user.tenant.name,
      expiresAt: inv.expiresAt.toISOString(),
    };
  }

  /** The user picks his password through the link, then is logged in. */
  async acceptInvitation(
    token: string,
    input: AcceptInvitationInput,
    meta: ClientMeta,
  ): Promise<IssuedTokens> {
    const passwordHash = await hashPassword(input.password);
    return tenantContext.runAsSystem(async () => {
      const inv = await this.validInvitation(token);
      return this.prisma.db.$transaction(async (tx) => {
        // Compare-and-swap: two clicks on the same link cannot both use it.
        const { count } = await tx.userInvitation.updateMany({
          where: { id: inv.id, usedAt: null },
          data: { usedAt: new Date() },
        });
        if (count === 0) {
          throw new AppException(ErrorCode.INVITATION_INVALID, 'This link was already used');
        }
        const user = await tx.user.update({
          where: { id: inv.userId },
          data: {
            passwordHash,
            mustChangePassword: false,
            passwordChangedAt: new Date(),
            failedLoginCount: 0,
            lockedUntil: null,
          },
          include: { tenant: TENANT_FOR_TOKEN },
        });
        const issued = await this.openSession(tx, user, { ...meta, deviceName: input.deviceName });
        await this.audit.log(tx, {
          tenantId: user.tenantId,
          userId: user.id,
          sessionId: issued.sessionId,
          action: 'INVITATION_ACCEPTED',
          entity: 'User',
          entityId: user.id,
        });
        return issued.tokens;
      });
    });
  }

  private validInvitation(token: string) {
    return tenantContext.runAsSystem(async () => {
      const inv = await this.prisma.db.userInvitation.findUnique({
        where: { tokenHash: TokenService.hash(token) },
        include: { user: { include: { tenant: TENANT_FOR_TOKEN } } },
      });
      if (!inv || inv.usedAt || inv.expiresAt <= new Date() || inv.user.deletedAt) {
        throw new AppException(ErrorCode.INVITATION_INVALID, 'This link is invalid or expired');
      }
      return inv;
    });
  }

  /**
   * Rotates the refresh token. Presenting a token that is no longer the current one
   * for its session means it was stolen or replayed: the whole session is revoked.
   */
  /**
   * [clientType] fills the session's client type when it has none (sessions opened
   * before phase 39). It never changes a known type, and the seat limit is checked at
   * login only: a plan downgrade does not log phones out in the middle of the day.
   */
  async refresh(
    refreshToken: string | undefined,
    clientType?: SessionClientType,
  ): Promise<IssuedTokens> {
    const parsed = refreshToken ? TokenService.parseRefreshToken(refreshToken) : null;
    if (!parsed) throw new AppException(ErrorCode.INVALID_TOKEN, 'Invalid refresh token');

    return tenantContext.runAsSystem(async () => {
      const session = await this.prisma.db.session.findUnique({
        where: { id: parsed.sessionId },
        include: { user: { include: { tenant: TENANT_FOR_TOKEN } } },
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
            ...(session.clientType === null && clientType ? { clientType } : {}),
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

  /** The OWNER sees every active session of the company; anyone else only his own. */
  async tenantSessions(user: CurrentUserInfo): Promise<TenantSessionDto[]> {
    const sessions = await this.prisma.db.session.findMany({
      where: {
        revokedAt: null,
        expiresAt: { gt: new Date() },
        ...(user.role === Role.OWNER ? {} : { userId: user.id }),
      },
      include: { user: { select: { id: true, fullName: true, role: true } } },
      orderBy: { lastUsedAt: 'desc' },
    });
    return sessions.map((s) => ({
      id: s.id,
      user: s.user,
      deviceName: s.deviceName,
      userAgent: s.userAgent,
      ip: s.ip,
      createdAt: s.createdAt.toISOString(),
      lastUsedAt: s.lastUsedAt.toISOString(),
      current: s.id === user.sessionId,
    }));
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
    const [tenant, { edition, features }, units, employeeId] = await Promise.all([
      this.prisma.db.tenant.findUniqueOrThrow({
        where: { id: user.tenantId },
        select: { name: true },
      }),
      this.features.of(user.tenantId),
      this.scope.warehouses(user),
      this.employeeIdOf(user),
    ]);
    return {
      id: user.id,
      email: user.email,
      phone: user.phone,
      fullName: user.fullName,
      role: user.role,
      tenantId: user.tenantId,
      tenantName: tenant.name,
      permissions: user.permissions,
      edition,
      features,
      warehouseIds: units.warehouseIds,
      statsWarehouseIds: units.statsWarehouseIds,
      employeeId,
      mustChangePassword: user.mustChangePassword,
      ...(user.impersonatedBy ? { impersonating: true } : {}),
    };
  }

  /** tenantId explicit: login reads this outside a tenant context. */
  private async employeeIdOf(user: { id: string; tenantId: string }): Promise<string | null> {
    const employee = await this.prisma.db.employee.findFirst({
      where: { tenantId: user.tenantId, userId: user.id, deletedAt: null },
      select: { id: true },
    });
    return employee?.id ?? null;
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

  /** A phone login of a road role: needs MOBILE_APP and takes a seat (phase 39 A1). */
  private takesMobileSeat(user: UserForToken, meta: ClientMeta): boolean {
    return meta.clientType === SessionClientType.NATIVE && MOBILE_SEAT_ROLES.includes(user.role);
  }

  /** Same features as /auth/me returns, read from the user loaded for the token. */
  private assertMobileApp(user: UserForToken): void {
    const edition = user.tenant.subscription?.edition ?? Edition.ESSENTIEL;
    const features = effectiveFeatures(
      edition,
      user.tenant.featureGrants,
      user.tenant.featureRevokes,
    );
    if (!features.includes(Feature.MOBILE_APP)) {
      throw new AppException(
        ErrorCode.FEATURE_NOT_IN_PLAN,
        'Your edition does not include the mobile app',
        { feature: Feature.MOBILE_APP },
      );
    }
  }

  /**
   * Distinct OTHER users of the tenant holding a live native session (not revoked, not
   * expired) with a seat role and an active account. Sessions belong to this module, so
   * the count is here; billing only compares it to the plan.
   */
  private async countOtherMobileSeats(
    tx: Tx,
    tenantId: string,
    userId: string,
    now: Date,
  ): Promise<number> {
    const rows = await tx.session.findMany({
      where: {
        tenantId,
        clientType: SessionClientType.NATIVE,
        revokedAt: null,
        expiresAt: { gt: now },
        userId: { not: userId },
        user: { deletedAt: null, role: { in: [...MOBILE_SEAT_ROLES] } },
      },
      distinct: ['userId'],
      select: { userId: true },
    });
    return rows.length;
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
        clientType: meta.clientType ?? SessionClientType.WEB,
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
    const edition = user.tenant.subscription?.edition ?? Edition.ESSENTIEL;
    const permissions = effectivePermissions(
      user.role,
      user.permissionGrants,
      user.permissionRevokes,
    );
    const units = await this.scope.warehouses({
      id: user.id,
      tenantId: user.tenantId,
      role: user.role,
      permissions,
    });
    return {
      accessToken,
      expiresIn: this.tokens.accessTtlSeconds,
      refreshToken: TokenService.formatRefreshToken(sessionId, refreshSecret),
      user: {
        id: user.id,
        email: user.email,
        phone: user.phone,
        fullName: user.fullName,
        role: user.role,
        tenantId: user.tenantId,
        tenantName: user.tenant.name,
        permissions,
        edition,
        features: effectiveFeatures(edition, user.tenant.featureGrants, user.tenant.featureRevokes),
        warehouseIds: units.warehouseIds,
        statsWarehouseIds: units.statsWarehouseIds,
        employeeId: await this.employeeIdOf(user),
        mustChangePassword: user.mustChangePassword,
      },
    };
  }
}
