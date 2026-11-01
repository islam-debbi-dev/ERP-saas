import { z } from 'zod';
import { Role, ROLES, WAREHOUSE_ACCESS_LEVELS, type WarehouseAccessLevel } from '../enums';
import { type Permission, PERMISSIONS } from '../permissions';
import { normalizePhone } from '../phone';
import { emailField, passwordField } from './auth';

const id = z.uuid();
const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'invalid_date');

/** Empty = none. Otherwise an Algerian number, stored as `+213…`. */
const phoneField = z
  .string()
  .trim()
  .max(30)
  .transform((v, ctx) => {
    if (v === '') return null;
    const phone = normalizePhone(v);
    if (!phone) {
      ctx.addIssue({ code: 'custom', message: 'invalid_phone' });
      return z.NEVER;
    }
    return phone;
  })
  .nullable()
  .default(null);

const optionalEmail = z
  .union([z.literal(''), emailField])
  .transform((v) => (v === '' ? null : v))
  .nullable()
  .default(null);

const contact = {
  fullName: z.string().trim().min(2).max(120),
  email: optionalEmail,
  phone: phoneField,
};

const hasLogin = (v: { email: string | null; phone: string | null }) =>
  v.email !== null || v.phone !== null;

export const INVITE_MODES = ['PASSWORD', 'LINK'] as const;
export type InviteMode = (typeof INVITE_MODES)[number];

/**
 * PASSWORD: the owner sets a temporary password, changed at first login.
 * LINK: a one-time link (72 h) the owner sends; the user picks his password.
 */
export const inviteUserSchema = z
  .object({
    ...contact,
    role: z.enum([
      Role.MANAGER,
      Role.SELLER,
      Role.STOREKEEPER,
      Role.OWNER,
      Role.SUPERVISOR,
      Role.LIVREUR,
    ]),
    /** The supervisor or manager this user reports to (phase 14). */
    managerId: id.nullable().default(null),
    mode: z.enum(INVITE_MODES),
    password: passwordField.optional(),
  })
  .refine(hasLogin, { message: 'email_or_phone_required', path: ['email'] })
  .refine((v) => v.mode !== 'PASSWORD' || v.password !== undefined, {
    message: 'required',
    path: ['password'],
  });
export type InviteUserInput = z.infer<typeof inviteUserSchema>;

export const updateUserSchema = z
  .object({
    ...contact,
    role: z.enum(ROLES as [Role, ...Role[]]),
    /** Omitted = unchanged; null = no manager. A cycle is refused (MANAGER_CYCLE). */
    managerId: id.nullable().optional(),
  })
  .refine(hasLogin, { message: 'email_or_phone_required', path: ['email'] });
export type UpdateUserInput = z.infer<typeof updateUserSchema>;

const permissionList = z
  .array(z.enum(PERMISSIONS as [Permission, ...Permission[]]))
  .max(PERMISSIONS.length)
  .transform((v) => [...new Set(v)]);

/** Exceptions to the role defaults; the same permission cannot be in both lists. */
export const userPermissionsSchema = z
  .object({ grants: permissionList, revokes: permissionList })
  .refine((v) => !v.grants.some((g) => v.revokes.includes(g)), {
    message: 'grant_and_revoke',
    path: ['revokes'],
  });
export type UserPermissionsInput = z.infer<typeof userPermissionsSchema>;

/**
 * A user's dépôts (phase 24). Replaces the whole list; a dépôt left out = no access.
 * Trucks are not listed: they follow their parent dépôt.
 */
export const userAccessSchema = z.object({
  access: z
    .array(
      z.object({
        warehouseId: id,
        level: z.enum(WAREHOUSE_ACCESS_LEVELS as [WarehouseAccessLevel, ...WarehouseAccessLevel[]]),
      }),
    )
    .max(200)
    .refine((v) => new Set(v.map((a) => a.warehouseId)).size === v.length, {
      message: 'duplicate_warehouse',
    }),
});
export type UserAccessInput = z.infer<typeof userAccessSchema>;

export interface UserAccessDto {
  userId: string;
  /** Owner or VIEW_ALL_WAREHOUSES: every dépôt, the list below does not matter. */
  allWarehouses: boolean;
  access: {
    warehouseId: string;
    warehouseName: string;
    level: WarehouseAccessLevel;
    grantedAt: string;
    grantedBy: { id: string; fullName: string } | null;
  }[];
}

export const resetPasswordSchema = z
  .object({ mode: z.enum(INVITE_MODES), password: passwordField.optional() })
  .refine((v) => v.mode !== 'PASSWORD' || v.password !== undefined, {
    message: 'required',
    path: ['password'],
  });
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

export const acceptInvitationSchema = z.object({
  password: passwordField,
  deviceName: z.string().trim().max(100).optional(),
});
export type AcceptInvitationInput = z.infer<typeof acceptInvitationSchema>;

export const auditLogQuerySchema = z.object({
  userId: id.optional(),
  entity: z.string().trim().max(60).optional(),
  action: z.string().trim().max(60).optional(),
  /** Algiers days, both included. */
  from: dateString.optional(),
  to: dateString.optional(),
  cursor: id.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type AuditLogQuery = z.infer<typeof auditLogQuerySchema>;

// ---------------------------------------------------------------- responses

export interface UserDto {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  role: Role;
  /** Who this user reports to (phase 14). */
  managerId: string | null;
  managerName: string | null;
  /** Effective permissions, and the exceptions to the role that produce them. */
  permissions: Permission[];
  grants: Permission[];
  revokes: Permission[];
  active: boolean;
  mustChangePassword: boolean;
  /** A link invitation not used yet. */
  invitationPending: boolean;
  lockedUntil: string | null;
  lastActivityAt: string | null;
  createdAt: string;
}

/** `inviteUrl` is shown once: only its hash is stored. */
export interface InviteResultDto {
  user: UserDto;
  inviteUrl: string | null;
  inviteExpiresAt: string | null;
}

export interface InvitationInfoDto {
  fullName: string;
  tenantName: string;
  expiresAt: string;
}

export interface TenantSessionDto {
  id: string;
  user: { id: string; fullName: string; role: Role };
  deviceName: string | null;
  userAgent: string | null;
  ip: string | null;
  createdAt: string;
  lastUsedAt: string;
  current: boolean;
}

export interface AuditLogDto {
  id: string;
  createdAt: string;
  user: { id: string; fullName: string } | null;
  deviceName: string | null;
  ip: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  before: unknown;
  after: unknown;
}

export interface AuditLogPage {
  items: AuditLogDto[];
  nextCursor: string | null;
}
