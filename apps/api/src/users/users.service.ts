import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  type DashboardLayout,
  type DashboardLayoutInput,
  effectivePermissions,
  normalizeDashboardLayout,
  DRIVING_ROLES,
  ErrorCode,
  type InviteResultDto,
  type InviteUserInput,
  type Permission,
  type ResetPasswordInput,
  Role,
  SELLING_ROLES,
  type TeamNodeDto,
  type UpdateUserInput,
  type UserDto,
  type UserPermissionsInput,
  isTeamLead,
  ORDERING_ROLES,
  TEAM_LEAD_ROLES,
} from '@erp/shared';
import { AuditService } from '../audit/audit.service';
import { AuthService, hashPassword } from '../auth/auth.service';
import { BillingService } from '../billing/billing.service';
import type { CurrentUserInfo } from '../auth/auth.types';
import { AppException } from '../common/app-exception';
import { tenantContext } from '../common/tenant-context';
import { Prisma, type User } from '../generated/prisma/client';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import { ScopeService } from '../sales-force/scope.service';
import { VehiclesService } from '../stock/vehicles.service';
import { UserAccessService } from './user-access.service';

type UserRow = User & {
  sessions: { lastUsedAt: Date }[];
  invitations: { id: string }[];
  manager: { fullName: string } | null;
};

/** Who can have a team under him (phase 14). */
const MANAGER_ROLES = new Set<string>([Role.OWNER, Role.MANAGER, ...TEAM_LEAD_ROLES]);
/** Whom a chef de zone may report to (phase 40b): the office, or nobody. */
const AREA_MANAGER_BOSSES = new Set<string>([Role.OWNER, Role.MANAGER]);

function toDto(u: UserRow): UserDto {
  return {
    id: u.id,
    fullName: u.fullName,
    email: u.email,
    phone: u.phone,
    role: u.role,
    managerId: u.managerId,
    managerName: u.manager?.fullName ?? null,
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
 * his name on every document and audit row. The OWNER writes here, and anyone he granted
 * USERS_MANAGE (phase 24), who never touches an owner nor gives more than he has.
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
    private readonly scope: ScopeService,
    private readonly access: UserAccessService,
    private readonly vehicles: VehiclesService,
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

  async invite(input: InviteUserInput, actor: CurrentUserInfo): Promise<InviteResultDto> {
    if (input.role === Role.OWNER) assertOwnerActor(actor);
    assertBelowActor(actor, { id: null, role: input.role });
    const passwordHash =
      input.mode === 'PASSWORD' && input.password
        ? await hashPassword(input.password)
        : await unusablePassword();
    const { id, link } = await this.uniqueGuard(() =>
      this.prisma.db.$transaction(async (tx) => {
        await this.assertUserSlot(tx);
        // Serialized on the tenant like every hierarchy change (see lockUser).
        await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${tenantContext.requireTenantId()}::uuid FOR UPDATE`;
        if (input.managerId) await this.checkManager(tx, null, input.managerId, input.role);
        const user = await tx.user.create({
          data: {
            tenantId: tenantContext.requireTenantId(),
            fullName: input.fullName,
            email: input.email,
            phone: input.phone,
            role: input.role,
            managerId: input.managerId,
            passwordHash,
            mustChangePassword: input.mode === 'PASSWORD',
            createdBy: tenantContext.get()?.userId ?? null,
          },
        });
        const link = input.mode === 'LINK' ? await this.auth.createInvitation(tx, user.id) : null;
        await this.access.grantDefaults(tx, user.id, actor);
        await this.audit.log(tx, {
          action: 'USER_INVITED',
          entity: 'User',
          entityId: user.id,
          after: {
            fullName: user.fullName,
            email: user.email,
            phone: user.phone,
            role: user.role,
            managerId: user.managerId,
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
        if (before.role === Role.OWNER || input.role === Role.OWNER) assertOwnerActor(actor);
        // Neither the account as it is nor the account as it would be (audit 02, B-3).
        assertBelowActor(actor, before);
        if (input.role !== before.role) {
          await this.checkRoleChange(tx, before, actor);
          assertBelowActor(actor, { ...before, role: input.role });
        }
        const managerId = input.managerId === undefined ? before.managerId : input.managerId;
        if (managerId && managerId !== before.managerId) {
          await this.checkManager(tx, id, managerId, input.role);
        } else if (managerId && input.role !== before.role) {
          // A new role is checked against the manager he keeps (phase 40b).
          await this.checkBoss(tx, input.role, managerId);
        }
        if (input.role !== before.role) await this.checkReportsKeepBoss(tx, id, input.role);
        // A role that cannot drive leaves its truck, with a history row (test-36 A-3).
        if (input.role !== before.role && !DRIVING_ROLES.includes(input.role)) {
          await this.vehicles.releaseDriver(tx, id);
        }
        const after = await tx.user.update({
          where: { id },
          data: {
            fullName: input.fullName,
            email: input.email,
            phone: input.phone,
            role: input.role,
            ...(input.managerId !== undefined ? { managerId: input.managerId } : {}),
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

  async setPermissions(
    id: string,
    input: UserPermissionsInput,
    actor: CurrentUserInfo,
  ): Promise<UserDto> {
    await this.prisma.db.$transaction(async (tx) => {
      const before = await this.lockUser(tx, id);
      if (before.role === Role.OWNER) {
        throw new AppException(ErrorCode.FORBIDDEN, 'An owner always has every permission', {
          rule: 'owner_has_all',
        });
      }
      assertBelowActor(actor, before);
      // A new grant must be a right the actor has himself (the owner has them all).
      const above = input.grants.filter(
        (g) => !before.permissionGrants.includes(g) && !actor.permissions.includes(g),
      );
      if (above.length > 0) {
        throw new AppException(
          ErrorCode.ACCESS_ABOVE_GRANTER,
          'You cannot grant a permission you do not have',
          { permissions: above },
        );
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
      assertBelowActor(actor, user);
      if (user.deletedAt) return;
      // He drives nothing from now on: the truck is freed with its history row, and the
      // deactivation is refused while his day on it is open (test-36 A-3).
      await this.vehicles.releaseDriver(tx, id);
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

  async reactivate(id: string, actor: CurrentUserInfo): Promise<UserDto> {
    await this.prisma.db.$transaction(async (tx) => {
      const user = await this.lockUser(tx, id);
      if (user.role === Role.OWNER) assertOwnerActor(actor);
      assertBelowActor(actor, user);
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
        assertOwnerActor(actor);
        throw new AppException(ErrorCode.FORBIDDEN, 'Only an owner resets his own password', {
          rule: 'owner_protected',
        });
      }
      // Choosing someone's password is taking his account (audit 02, B-3).
      assertBelowActor(actor, user);
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
      manager: { select: { fullName: true } },
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
   * The company's hierarchy as a tree (phase 14): users without a manager at the top.
   * A supervisor gets his own subtree. Deactivated users stay in it, flagged.
   */
  async team(actor: CurrentUserInfo): Promise<TeamNodeDto[]> {
    const users = await this.prisma.db.user.findMany({
      orderBy: { fullName: 'asc' },
      select: { id: true, fullName: true, role: true, managerId: true, deletedAt: true },
    });
    const byManager = new Map<string | null, typeof users>();
    const ids = new Set(users.map((u) => u.id));
    for (const u of users) {
      // A manager outside the list cannot happen (same tenant); guard anyway.
      const key = u.managerId && ids.has(u.managerId) ? u.managerId : null;
      byManager.set(key, [...(byManager.get(key) ?? []), u]);
    }
    const node = (u: (typeof users)[number], seen: Set<string>): TeamNodeDto => {
      seen.add(u.id);
      return {
        id: u.id,
        fullName: u.fullName,
        role: u.role,
        active: u.deletedAt === null,
        members: (byManager.get(u.id) ?? [])
          .filter((m) => !seen.has(m.id))
          .map((m) => node(m, seen)),
      };
    };
    if (isTeamLead(actor.role)) {
      const self = users.find((u) => u.id === actor.id);
      return self ? [node(self, new Set())] : [];
    }
    return (byManager.get(null) ?? []).map((u) => node(u, new Set()));
  }

  /**
   * Active users who can be put on a sale or a versement (phase 14), for the pickers of
   * office roles. With `orderTakers`, those who can be put on a route, a commande, a visit
   * or a client: the pré-vendeurs too (phase 40b). A team lead gets his team(s) only.
   */
  async sellers(
    actor: CurrentUserInfo,
    orderTakers = false,
  ): Promise<{ id: string; fullName: string; role: Role }[]> {
    const team = isTeamLead(actor.role) ? await this.scope.teamIds(actor.id) : null;
    return this.prisma.db.user.findMany({
      where: {
        deletedAt: null,
        role: { in: [...(orderTakers ? ORDERING_ROLES : SELLING_ROLES)] },
        ...(team ? { id: { in: team } } : {}),
      },
      orderBy: { fullName: 'asc' },
      select: { id: true, fullName: true, role: true },
    });
  }

  /**
   * A manager must be a live OWNER, MANAGER, SUPERVISOR or AREA_MANAGER of the tenant
   * (for a chef de zone: OWNER or MANAGER only), and not the
   * user himself or anyone under him (MANAGER_CYCLE). Called with the tenant row locked,
   * so two concurrent edits cannot build a cycle between them.
   */
  private async checkManager(
    tx: Tx,
    userId: string | null,
    managerId: string,
    role: Role,
  ): Promise<void> {
    if (userId === managerId) {
      throw new AppException(ErrorCode.MANAGER_CYCLE, 'A user cannot be his own manager');
    }
    const manager = await tx.user.findFirst({ where: { id: managerId, deletedAt: null } });
    if (!manager || !MANAGER_ROLES.has(manager.role)) {
      throw new AppException(ErrorCode.VALIDATION_FAILED, 'This user cannot manage a team', {
        field: 'managerId',
      });
    }
    assertBossAllowed(role, manager.role);
    if (!userId) return;
    const tenantId = tenantContext.requireTenantId();
    const [hit] = await tx.$queryRaw<{ found: boolean }[]>`
      WITH RECURSIVE subtree AS (
        SELECT id FROM users WHERE "managerId" = ${userId}::uuid AND "tenantId" = ${tenantId}::uuid
        UNION
        SELECT u.id FROM users u JOIN subtree s ON u."managerId" = s.id
        WHERE u."tenantId" = ${tenantId}::uuid
      )
      SELECT EXISTS (SELECT 1 FROM subtree WHERE id = ${managerId}::uuid) AS found`;
    if (hit?.found) {
      throw new AppException(ErrorCode.MANAGER_CYCLE, "This manager is in the user's own team", {
        managerId,
      });
    }
  }

  /** The role rule alone, on a link that stays (active or not). */
  private async checkBoss(tx: Tx, role: Role, managerId: string): Promise<void> {
    const manager = await tx.user.findFirst({
      where: { id: managerId },
      select: { role: true },
    });
    if (manager) assertBossAllowed(role, manager.role);
  }

  /** Nobody leaves the office while an active chef de zone reports to him. */
  private async checkReportsKeepBoss(tx: Tx, id: string, role: Role): Promise<void> {
    if (AREA_MANAGER_BOSSES.has(role)) return;
    const reports = await tx.user.count({
      where: { managerId: id, deletedAt: null, role: Role.AREA_MANAGER },
    });
    if (reports > 0) assertBossAllowed(Role.AREA_MANAGER, role);
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

  /** His dashboard (phase 33.5): saved order and hidden cards, normalized for his role. */
  async dashboardLayout(user: CurrentUserInfo): Promise<DashboardLayout> {
    const row = await this.prisma.db.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { dashboardLayout: true },
    });
    return normalizeDashboardLayout(row.dashboardLayout, user.role);
  }

  /** Saves his own layout only; audited without before/after (it is a preference). */
  async saveDashboardLayout(
    user: CurrentUserInfo,
    input: DashboardLayoutInput,
  ): Promise<DashboardLayout> {
    const layout = normalizeDashboardLayout(input, user.role);
    await this.prisma.db.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: { dashboardLayout: { order: layout.order, hidden: layout.hidden } },
      });
      await this.audit.log(tx, {
        action: 'USER_DASHBOARD_LAYOUT_CHANGED',
        entity: 'User',
        entityId: user.id,
      });
    });
    return layout;
  }
}

function pick(u: User) {
  return {
    fullName: u.fullName,
    email: u.email,
    phone: u.phone,
    role: u.role,
    managerId: u.managerId,
  };
}

function assertBossAllowed(role: Role, bossRole: Role): void {
  if (role !== Role.AREA_MANAGER || AREA_MANAGER_BOSSES.has(bossRole)) return;
  throw new AppException(
    ErrorCode.MANAGER_ROLE_NOT_ALLOWED,
    'A chef de zone reports to the owner, a manager or nobody',
    { field: 'managerId', role, managerRole: bossRole },
  );
}

/** Owner accounts and the OWNER role are the owner's business only (phase 24). */
/**
 * A user who manages users never touches an account at or above his own (audit 02, B-3;
 * docs/domain.md, phase 24): not one of his own role, and not one that holds a permission
 * he does not hold. Without it a SUPERVISOR granted USERS_MANAGE invited a MANAGER with a
 * password of his choice, promoted a livreur, or reset a manager's password and logged in
 * as him. The owner is above everyone; anyone may still edit his own account (his role and
 * his own grants have their own rules).
 */
function assertBelowActor(
  actor: CurrentUserInfo,
  target: {
    id: string | null;
    role: Role;
    permissionGrants?: readonly string[];
    permissionRevokes?: readonly string[];
  },
): void {
  if (actor.role === Role.OWNER || target.id === actor.id) return;
  const held = effectivePermissions(target.role, target.permissionGrants, target.permissionRevokes);
  if (target.role !== actor.role && held.every((p) => actor.permissions.includes(p))) return;
  throw new AppException(
    ErrorCode.ACCESS_ABOVE_GRANTER,
    'This account is not below your own: only an owner can do this',
    { rule: 'account_not_below' },
  );
}

function assertOwnerActor(actor: CurrentUserInfo): void {
  if (actor.role === Role.OWNER) return;
  throw new AppException(ErrorCode.FORBIDDEN, 'Only an owner can do this to an owner account', {
    rule: 'owner_protected',
  });
}
