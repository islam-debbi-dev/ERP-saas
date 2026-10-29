import type { Request } from 'express';

/** Claims inside a super-admin access token. Tenant tokens never carry `typ: 'admin'`. */
export interface AdminTokenPayload {
  sub: string;
  sid: string;
  typ: 'admin';
}

export interface CurrentAdminInfo {
  id: string;
  sessionId: string;
  email: string;
  fullName: string;
}

export interface AdminRequest extends Request {
  admin: CurrentAdminInfo;
}
