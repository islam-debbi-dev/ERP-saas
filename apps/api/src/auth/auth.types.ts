import type { Request } from 'express';
import type { Permission, Role } from '@erp/shared';

/** Claims inside the access token. */
export interface AccessTokenPayload {
  sub: string;
  tid: string;
  sid: string;
  role: Role;
}

export interface CurrentUserInfo {
  id: string;
  tenantId: string;
  sessionId: string;
  role: Role;
  email: string | null;
  phone: string | null;
  fullName: string;
  /** Effective permissions, read from the database on every request. */
  permissions: Permission[];
  mustChangePassword: boolean;
}

export interface AuthenticatedRequest extends Request {
  user: CurrentUserInfo;
}

/** Device/browser info captured at login, shown in the sessions list. */
export interface ClientMeta {
  deviceName?: string | null;
  userAgent?: string | null;
  ip?: string | null;
}
