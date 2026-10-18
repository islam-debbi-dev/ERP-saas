import { z } from 'zod';
import { type Role } from '../enums';

const email = z.string().trim().toLowerCase().max(254).pipe(z.email());
// Argon2 has no length limit, but cap it so a huge body can't burn CPU.
const password = z.string().min(8).max(128);

export const registerSchema = z.object({
  companyName: z.string().trim().min(2).max(120),
  fullName: z.string().trim().min(2).max(120),
  email,
  password,
  deviceName: z.string().trim().max(100).optional(),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email,
  password: z.string().min(1).max(128),
  deviceName: z.string().trim().max(100).optional(),
});
export type LoginInput = z.infer<typeof loginSchema>;

/** Native clients send the refresh token in the body; the web uses the httpOnly cookie. */
export const refreshSchema = z.object({
  refreshToken: z.string().min(1).max(512).optional(),
});
export type RefreshInput = z.infer<typeof refreshSchema>;

export interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  tenantId: string;
  tenantName: string;
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
