import { z } from 'zod';
import { type Role } from '../enums';
import { type Permission } from '../permissions';

export const emailField = z.string().trim().toLowerCase().max(254).pipe(z.email());
const email = emailField;
// Argon2 has no length limit, but cap it so a huge body can't burn CPU.
export const passwordField = z.string().min(8).max(128);
const password = passwordField;

export const registerSchema = z.object({
  companyName: z.string().trim().min(2).max(120),
  fullName: z.string().trim().min(2).max(120),
  email,
  password,
  deviceName: z.string().trim().max(100).optional(),
});
export type RegisterInput = z.infer<typeof registerSchema>;

/**
 * Login with an email or a phone number. `email` is the field older clients send;
 * it is read as the identifier.
 */
export const loginSchema = z
  .object({
    identifier: z.string().trim().min(1).max(254).optional(),
    email: z.string().trim().min(1).max(254).optional(),
    password: z.string().min(1).max(128),
    deviceName: z.string().trim().max(100).optional(),
  })
  .refine((v) => v.identifier !== undefined || v.email !== undefined, {
    message: 'required',
    path: ['identifier'],
  })
  .transform(({ identifier, email: legacy, ...rest }) => ({
    ...rest,
    identifier: (identifier ?? legacy ?? '').toLowerCase(),
  }));
export type LoginInput = z.infer<typeof loginSchema>;

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: password,
});
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

/**
 * Native clients send the refresh token in the body; the web uses the httpOnly cookie
 * and may send no body at all.
 */
export const refreshSchema = z
  .object({
    refreshToken: z.string().min(1).max(512).optional(),
  })
  .optional();
export type RefreshInput = z.infer<typeof refreshSchema>;

export interface AuthUser {
  id: string;
  email: string | null;
  phone: string | null;
  fullName: string;
  role: Role;
  tenantId: string;
  tenantName: string;
  /** Role defaults plus grants minus revokes (the OWNER has them all). */
  permissions: Permission[];
  /** Set by a temporary password: every other route answers PASSWORD_CHANGE_REQUIRED. */
  mustChangePassword: boolean;
}

export interface AuthResponse {
  accessToken: string;
  /** Seconds until the access token expires. */
  expiresIn: number;
  user: AuthUser;
  /** Only for native clients (`X-Client-Type: native`); the web gets an httpOnly cookie. */
  refreshToken?: string;
}

export interface SessionInfo {
  id: string;
  deviceName: string | null;
  userAgent: string | null;
  ip: string | null;
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string;
  current: boolean;
}
