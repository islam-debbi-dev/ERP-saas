import type { Request } from 'express';
import type { Role } from '@erp/shared';

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
  email: string;
  fullName: string;
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
