import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ErrorCode } from '@erp/shared';
import { AppException } from '../common/app-exception';
import { tenantContext } from '../common/tenant-context';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export type BeginResult =
  { kind: 'new'; id: string } | { kind: 'replay'; status: number; body: unknown };

/** JSON with sorted keys, so `{a,b}` and `{b,a}` hash the same. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

export function requestHash(method: string, path: string, body: unknown): string {
  return createHash('sha256')
    .update(`${method} ${path}\n${canonicalJson(body ?? null)}`)
    .digest('hex');
}

@Injectable()
export class IdempotencyService {
  constructor(private readonly prisma: PrismaService) {}

  /** Claims the key, or tells the caller to replay / reject. Runs in the request's tenant context. */
  async begin(key: string, method: string, path: string, hash: string): Promise<BeginResult> {
    try {
      const row = await this.prisma.db.idempotencyKey.create({
        data: { tenantId: tenantContext.requireTenantId(), key, method, path, requestHash: hash },
        select: { id: true },
      });
      return { kind: 'new', id: row.id };
    } catch (err) {
      if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== 'P2002') throw err;
    }

    const existing = await this.prisma.db.idempotencyKey.findFirst({ where: { key } });
    if (!existing) {
      // The other request failed and released the key between our insert and read.
      return this.begin(key, method, path, hash);
    }
    if (existing.requestHash !== hash) {
      throw new AppException(
        ErrorCode.IDEMPOTENCY_KEY_REUSED,
        'This Idempotency-Key was already used with a different request',
      );
    }
    if (existing.status !== 'COMPLETED') {
      throw new AppException(
        ErrorCode.IDEMPOTENCY_REQUEST_IN_PROGRESS,
        'A request with this Idempotency-Key is still being processed',
      );
    }
    return { kind: 'replay', status: existing.responseStatus ?? 200, body: existing.responseBody };
  }

  async complete(id: string, status: number, body: unknown): Promise<void> {
    await this.prisma.db.idempotencyKey.update({
      where: { id },
      data: {
        status: 'COMPLETED',
        responseStatus: status,
        responseBody: (body ?? Prisma.JsonNull) as Prisma.InputJsonValue,
        completedAt: new Date(),
      },
    });
  }

  /** The handler failed: free the key so the client can retry with the same key. */
  async release(id: string): Promise<void> {
    await this.prisma.db.idempotencyKey.deleteMany({ where: { id, status: 'IN_PROGRESS' } });
  }
}
