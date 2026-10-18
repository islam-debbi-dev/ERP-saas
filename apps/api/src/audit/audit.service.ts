import { Injectable } from '@nestjs/common';
import { tenantContext } from '../common/tenant-context';
import { type Prisma } from '../generated/prisma/client';
import { type Tx } from '../prisma/prisma.service';

export interface AuditEntry {
  action: string;
  entity: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  /** Only in system context (registration, login), where there is no tenant in context yet. */
  tenantId?: string;
  userId?: string | null;
  sessionId?: string | null;
}

/** JSON-safe copy (Decimal → string, Date → ISO) for the before/after columns. */
function toJson(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined || value === null) return undefined;
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

@Injectable()
export class AuditService {
  /**
   * Appends an audit row inside the caller's transaction, so the audit entry
   * commits or rolls back with the business write. Who/which device come from
   * the request context.
   */
  async log(tx: Tx, entry: AuditEntry): Promise<void> {
    const ctx = tenantContext.get();
    const tenantId = entry.tenantId ?? tenantContext.requireTenantId();
    await tx.auditLog.create({
      data: {
        tenantId,
        userId: entry.userId ?? ctx?.userId ?? null,
        sessionId: entry.sessionId ?? ctx?.sessionId ?? null,
        deviceName: ctx?.deviceName ?? null,
        ip: ctx?.ip ?? null,
        action: entry.action,
        entity: entry.entity,
        entityId: entry.entityId ?? null,
        before: toJson(entry.before),
        after: toJson(entry.after),
      },
    });
  }
}
