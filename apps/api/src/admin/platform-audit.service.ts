import { Injectable } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client';
import type { Tx } from '../prisma/prisma.service';

export interface PlatformAuditEntry {
  adminId: string | null;
  sessionId?: string | null;
  tenantId?: string | null;
  action: string;
  detail?: unknown;
  ip?: string | null;
}

/** Append-only log of super-admin actions, outside every tenant. */
@Injectable()
export class PlatformAuditService {
  async log(tx: Tx, entry: PlatformAuditEntry): Promise<void> {
    await tx.platformAuditLog.create({
      data: {
        adminId: entry.adminId,
        sessionId: entry.sessionId ?? null,
        tenantId: entry.tenantId ?? null,
        action: entry.action,
        detail:
          entry.detail === undefined
            ? undefined
            : (JSON.parse(JSON.stringify(entry.detail)) as Prisma.InputJsonValue),
        ip: entry.ip ?? null,
      },
    });
  }
}
