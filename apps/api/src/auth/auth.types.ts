import type { Request } from 'express';
import type { Permission, Role } from '@erp/shared';

/** Claims inside the access token. */
export interface AccessTokenPayload {
  sub: string;
  tid: string;
  sid: string;
  role: Role;
  /**
   * `imp`: read-only token a super-admin got to view this tenant (sid is then the admin
   * session, adm the admin). Admin-area tokens carry `typ: 'admin'` and no tid; the
   * tenant guard refuses them.
   */
  typ?: 'imp';
  adm?: string;
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
  /** Set when a super-admin views the tenant (read-only, phase 13). */
  impersonatedBy?: { adminId: string; adminSessionId: string };
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
