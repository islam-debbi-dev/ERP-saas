import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  effectivePermissions,
  ErrorCode,
  type InviteResultDto,
  type InviteUserInput,
  type Permission,
  type ResetPasswordInput,
  Role,
  type UpdateUserInput,
  type UserDto,
  type UserPermissionsInput,
} from '@erp/shared';
import { AuditService } from '../audit/audit.service';
import { AuthService, hashPassword } from '../auth/auth.service';
import { BillingService } from '../billing/billing.service';
import type { CurrentUserInfo } from '../auth/auth.types';
import { AppException } from '../common/app-exception';
import { tenantContext } from '../common/tenant-context';
import { Prisma, type User } from '../generated/prisma/client';
import { PrismaService, type Tx } from '../prisma/prisma.service';

type UserRow = User & {
  sessions: { lastUsedAt: Date }[];
  invitations: { id: string }[];
};

function toDto(u: UserRow): UserDto {
  return {
    id: u.id,
    fullName: u.fullName,
    email: u.email,
    phone: u.phone,
    role: u.role,
    permissions: effectivePermissions(u.role, u.permissionGrants, u.permissionRevokes),
    grants: u.permissionGrants as Permission[],
    revokes: u.permissionRevokes as Permission[],
    active: u.deletedAt === null,
    mustChangePassword: u.mustChangePassword,
    invitationPending: u.invitations.length > 0,
    lockedUntil: u.lockedUntil && u.lockedUntil > new Date() ? u.lockedUntil.toISOString() : null,
    lastActivityAt: u.sessions[0]?.lastUsedAt.toISOString() ?? null,
    createdAt: u.createdAt.toISOString(),
  };
}

/** A password nobody knows, for a user who will set his own through the link. */
function unusablePassword(): Promise<string> {
  return hashPassword(randomBytes(32).toString('base64url'));
}

/**
 * Staff accounts of the company. Users are never deleted: a deactivated user keeps
 * his name on every document and audit row. Only the OWNER writes here.
 *
 * OWNER rules: there is always at least one active OWNER; an OWNER's role and
 * activation are his own business (other owners cannot demote or deactivate him);
 * nobody deactivates himself.
 */
@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly audit: AuditService,
    private readonly billing: BillingService,
  ) {}

  async list(): Promise<UserDto[]> {
    const users = await this.prisma.db.user.findMany({
      orderBy: [{ deletedAt: { sort: 'desc', nulls: 'first' } }, { fullName: 'asc' }],
      include: this.include(),
    });
    return users.map(toDto);
  }

  async get(id: string): Promise<UserDto> {
    const u = await this.prisma.db.user.findUnique({ where: { id }, include: this.include() });
    if (!u) throw new AppException(ErrorCode.NOT_FOUND, 'User not found');
    return toDto(u);
  }

  async invite(input: InviteUserInput): Promise<InviteResultDto> {
    const passwordHash =
      input.mode === 'PASSWORD' && input.password
        ? await hashPassword(input.password)
        : await unusablePassword();
    const { id, link } = await this.uniqueGuard(() =>
      this.prisma.db.$transaction(async (tx) => {
        await this.assertUserSlot(tx);
        const user = await tx.user.create({
          data: {
            tenantId: tenantContext.requireTenantId(),
            fullName: input.fullName,
            email: input.email,
            phone: input.phone,
            role: input.role,
            passwordHash,
            mustChangePassword: input.mode === 'PASSWORD',
            createdBy: tenantContext.get()?.userId ?? null,
          },
        });
        const link = input.mode === 'LINK' ? await this.auth.createInvitation(tx, user.id) : null;
        await this.audit.log(tx, {
          action: 'USER_INVITED',
          entity: 'User',
          entityId: user.id,
          after: {
            fullName: user.fullName,
            email: user.email,
            phone: user.phone,
            role: user.role,
            mode: input.mode,
          },
        });
        return { id: user.id, link };
      }),
    );
    return {
      user: await this.get(id),
      inviteUrl: link?.url ?? null,
      inviteExpiresAt: link?.expiresAt.toISOString() ?? null,
    };
  }

  async update(id: string, input: UpdateUserInput, actor: CurrentUserInfo): Promise<UserDto> {
    await this.uniqueGuard(() =>
      this.prisma.db.$transaction(async (tx) => {
        const before = await this.lockUser(tx, id);
        if (input.role !== before.role) await this.checkRoleChange(tx, before, actor);
        const after = await tx.user.update({
          where: { id },
          data: {
            fullName: input.fullName,
            email: input.email,
            phone: input.phone,
            role: input.role,
          },
        });
        await this.audit.log(tx, {
          action: 'USER_UPDATED',
          entity: 'User',
          entityId: id,
          before: pick(before),
          after: pick(after),
        });
      }),
    );
    return this.get(id);
  }

  async setPermissions(id: string, input: UserPermissionsInput): Promise<UserDto> {
    await this.prisma.db.$transaction(async (tx) => {
      const before = await this.lockUser(tx, id);
      if (before.role === Role.OWNER) {
        throw new AppException(ErrorCode.FORBIDDEN, 'An owner always has every permission', {
          rule: 'owner_has_all',
        });
      }
      await tx.user.update({
        where: { id },
        data: { permissionGrants: input.grants, permissionRevokes: input.revokes },
      });
      await this.audit.log(tx, {
        action: 'USER_PERMISSIONS_CHANGED',
        entity: 'User',
        entityId: id,
        before: { grants: before.permissionGrants, revokes: before.permissionRevokes },
        after: { grants: input.grants, revokes: input.revokes },
      });
    });
    return this.get(id);
  }

  /** Revokes every session at once: a fired employee's phone is logged out now. */
  async deactivate(id: string, actor: CurrentUserInfo): Promise<UserDto> {
    await this.prisma.db.$transaction(async (tx) => {
      const user = await this.lockUser(tx, id);
      if (user.id === actor.id) {
        throw new AppException(ErrorCode.FORBIDDEN, 'You cannot deactivate yourself', {
          rule: 'not_self',
        });
      }
      if (user.role === Role.OWNER) {
        throw new AppException(ErrorCode.FORBIDDEN, 'An owner cannot be deactivated by others', {
          rule: 'owner_protected',
        });
      }
      if (user.deletedAt) return;
      const now = new Date();
      await tx.user.update({ where: { id }, data: { deletedAt: now } });
      const { count } = await tx.session.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: now, revokedReason: 'USER_DEACTIVATED' },
      });
      await tx.userInvitation.updateMany({
        where: { userId: id, usedAt: null },
        data: { usedAt: now },
      });
      await this.audit.log(tx, {
        action: 'USER_DEACTIVATED',
        entity: 'User',
        entityId: id,
        before: { active: true },
        after: { active: false, revokedSessions: count },
      });
    });
    return this.get(id);
  }

  async reactivate(id: string): Promise<UserDto> {
    await this.prisma.db.$transaction(async (tx) => {
      const user = await this.lockUser(tx, id);
      if (!user.deletedAt) return;
      await this.assertUserSlot(tx);
      await tx.user.update({
        where: { id },
        data: { deletedAt: null, failedLoginCount: 0, lockedUntil: null },
      });
      await this.audit.log(tx, {
        action: 'USER_REACTIVATED',
        entity: 'User',
        entityId: id,
        before: { active: false },
        after: { active: true },
      });
    });
    return this.get(id);
  }

  /**
   * Forgotten password: a new temporary password or a new link. Unlocks the account
   * and closes its sessions (whoever had the old password is out).
   */
  async resetPassword(
    id: string,
    input: ResetPasswordInput,
    actor: CurrentUserInfo,
  ): Promise<InviteResultDto> {
    const passwordHash =
      input.mode === 'PASSWORD' && input.password
        ? await hashPassword(input.password)
        : await unusablePassword();
    const link = await this.prisma.db.$transaction(async (tx) => {
      const user = await this.lockUser(tx, id);
      if (user.deletedAt) {
        throw new AppException(ErrorCode.USER_DEACTIVATED, 'Reactivate this user first');
      }
      if (user.role === Role.OWNER && user.id !== actor.id) {
        throw new AppException(ErrorCode.FORBIDDEN, 'Only an owner resets his own password', {
          rule: 'owner_protected',
        });
      }
      const now = new Date();
      await tx.user.update({
        where: { id },
        data: {
          passwordHash,
          mustChangePassword: input.mode === 'PASSWORD',
          failedLoginCount: 0,
          lockedUntil: null,
        },
      });
      await tx.session.updateMany({
        where: { userId: id, revokedAt: null, id: { not: actor.sessionId } },
        data: { revokedAt: now, revokedReason: 'PASSWORD_RESET' },
      });
      const link = input.mode === 'LINK' ? await this.auth.createInvitation(tx, id) : null;
      await this.audit.log(tx, {
        action: 'USER_PASSWORD_RESET',
        entity: 'User',
        entityId: id,
        after: { mode: input.mode },
      });
      return link;
    });
    return {
      user: await this.get(id),
      inviteUrl: link?.url ?? null,
      inviteExpiresAt: link?.expiresAt.toISOString() ?? null,
    };
  }

  // ---------------------------------------------------------------- internals

  private include() {
    const now = new Date();
    return {
      sessions: {
        orderBy: { lastUsedAt: 'desc' as const },
        take: 1,
        select: { lastUsedAt: true },
      },
      invitations: {
        where: { usedAt: null, expiresAt: { gt: now } },
        take: 1,
        select: { id: true },
      },
    };
  }

  /**
   * Locks the tenant row first, then the user: every change that could leave the
   * company without an owner is serialized on the tenant.
   */
  private async lockUser(tx: Tx, id: string): Promise<User> {
    const tenantId = tenantContext.requireTenantId();
    await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${tenantId}::uuid FOR UPDATE`;
    const user = await tx.user.findUnique({ where: { id } });
    if (!user) throw new AppException(ErrorCode.NOT_FOUND, 'User not found');
    return user;
  }

  private async checkRoleChange(tx: Tx, user: User, actor: CurrentUserInfo): Promise<void> {
    if (user.role !== Role.OWNER) {
      if (user.id === actor.id) {
        throw new AppException(ErrorCode.FORBIDDEN, 'You cannot change your own role', {
          rule: 'not_self',
        });
      }
      return;
    }
    // Demoting an owner: only himself, and never the last active one.
    if (user.id !== actor.id) {
      throw new AppException(ErrorCode.FORBIDDEN, 'Only an owner can step down himself', {
        rule: 'owner_protected',
      });
    }
    const owners = await tx.user.count({
      where: { role: Role.OWNER, deletedAt: null, id: { not: user.id } },
    });
    if (owners === 0) {
      throw new AppException(ErrorCode.LAST_OWNER, 'The company needs at least one owner');
    }
  }

  /** Email and phone are unique across the platform. */
  private async uniqueGuard<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const target = JSON.stringify(err.meta ?? {});
        throw new AppException(
          target.includes('phone') ? ErrorCode.PHONE_ALREADY_USED : ErrorCode.EMAIL_ALREADY_USED,
          target.includes('phone') ? 'This phone is already used' : 'This email is already used',
        );
      }
      throw err;
    }
  }

  /** The plan's user limit counts active accounts (deactivated ones free their slot). */
  private assertUserSlot(tx: Tx): Promise<void> {
    return this.billing.assertCanAdd(tx, 'users', 1, () =>
      tx.user.count({ where: { deletedAt: null } }),
    );
  }
}

function pick(u: User) {
  return { fullName: u.fullName, email: u.email, phone: u.phone, role: u.role };
}
