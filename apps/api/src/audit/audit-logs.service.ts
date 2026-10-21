import { Injectable } from '@nestjs/common';
import type { AuditLogDto, AuditLogPage, AuditLogQuery } from '@erp/shared';
import { algiersRange } from '../common/algiers';
import { type Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** Read side of the audit log. There is no write or delete path: rows are append-only. */
@Injectable()
export class AuditLogsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: AuditLogQuery): Promise<AuditLogPage> {
    const createdAt: Prisma.DateTimeFilter = {};
    if (query.from) createdAt.gte = algiersRange(query.from, query.from).start;
    if (query.to) createdAt.lt = algiersRange(query.to, query.to).end;
    const rows = await this.prisma.db.auditLog.findMany({
      where: {
        ...(query.userId ? { userId: query.userId } : {}),
        ...(query.entity ? { entity: query.entity } : {}),
        ...(query.action ? { action: query.action } : {}),
        ...(query.from || query.to ? { createdAt } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const page = rows.slice(0, query.limit);
    const ids = [...new Set(page.map((r) => r.userId).filter((u): u is string => Boolean(u)))];
    const users = await this.prisma.db.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, fullName: true },
    });
    const byId = new Map(users.map((u) => [u.id, u]));
    return {
      items: page.map((r): AuditLogDto => ({
        id: r.id,
        createdAt: r.createdAt.toISOString(),
        user: r.userId ? (byId.get(r.userId) ?? null) : null,
        deviceName: r.deviceName,
        ip: r.ip,
        action: r.action,
        entity: r.entity,
        entityId: r.entityId,
        before: r.before,
        after: r.after,
      })),
      nextCursor: rows.length > query.limit ? (page.at(-1)?.id ?? null) : null,
    };
  }

  /** Distinct entities and actions seen in this company, for the filters. */
  async facets(): Promise<{ entities: string[]; actions: string[] }> {
    const [entities, actions] = await Promise.all([
      this.prisma.db.auditLog.groupBy({ by: ['entity'], orderBy: { entity: 'asc' } }),
      this.prisma.db.auditLog.groupBy({ by: ['action'], orderBy: { action: 'asc' } }),
    ]);
    return { entities: entities.map((e) => e.entity), actions: actions.map((a) => a.action) };
  }
}
