import { Injectable } from '@nestjs/common';
import {
  type ClientSegmentDto,
  type CreateClientSegmentInput,
  ErrorCode,
  type UpdateClientSegmentInput,
} from '@erp/shared';
import { AuditService } from '../audit/audit.service';
import { AppException } from '../common/app-exception';
import { tenantContext } from '../common/tenant-context';
import { Prisma } from '../generated/prisma/client';
import { PrismaService, type Tx } from '../prisma/prisma.service';

/**
 * Client segments (phase 37): the owner's own names for his kinds of clients (détaillant,
 * supérette, grossiste, café…). Master data with no behaviour attached: the statistics
 * group by it, nothing else reads it. Archived, never deleted; an archived segment stays
 * on the clients that have it. Code unique among the live segments, whatever the case.
 */
@Injectable()
export class ClientSegmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(includeArchived = false): Promise<ClientSegmentDto[]> {
    const rows = await this.prisma.db.clientSegment.findMany({
      where: includeArchived ? {} : { deletedAt: null },
      include: { _count: { select: { clients: { where: { deletedAt: null } } } } },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
    return rows.map(toDto);
  }

  async create(input: CreateClientSegmentInput): Promise<ClientSegmentDto> {
    const id = await this.prisma.db.$transaction(async (tx) => {
      await this.assertCodeFree(tx, input.code, null);
      const row = await this.write(() =>
        tx.clientSegment.create({
          data: { tenantId: tenantContext.requireTenantId(), ...input },
        }),
      );
      await this.audit.log(tx, {
        action: 'CLIENT_SEGMENT_CREATED',
        entity: 'ClientSegment',
        entityId: row.id,
        after: input,
      });
      return row.id;
    });
    return this.get(id);
  }

  async update(id: string, input: UpdateClientSegmentInput): Promise<ClientSegmentDto> {
    await this.prisma.db.$transaction(async (tx) => {
      const before = await this.lock(tx, id);
      if (input.code !== undefined) await this.assertCodeFree(tx, input.code, id);
      await this.write(() => tx.clientSegment.update({ where: { id }, data: input }));
      await this.audit.log(tx, {
        action: 'CLIENT_SEGMENT_UPDATED',
        entity: 'ClientSegment',
        entityId: id,
        before: { code: before.code, name: before.name },
        after: input,
      });
    });
    return this.get(id);
  }

  /** Archives a segment: it leaves the pickers and keeps its clients and its history. */
  async archive(id: string): Promise<void> {
    await this.prisma.db.$transaction(async (tx) => {
      const before = await this.lock(tx, id);
      await tx.clientSegment.update({ where: { id }, data: { deletedAt: new Date() } });
      await this.audit.log(tx, {
        action: 'CLIENT_SEGMENT_ARCHIVED',
        entity: 'ClientSegment',
        entityId: id,
        before: { code: before.code, name: before.name },
      });
    });
  }

  /** A live segment of this company, for a client being saved; else NOT_FOUND on the field. */
  async assertLive(tx: Tx, id: string): Promise<void> {
    const row = await tx.clientSegment.findFirst({
      where: { id, deletedAt: null },
      select: { id: true },
    });
    if (!row) throw this.notFound({ field: 'segmentId' });
  }

  /** The live segments by lower-case code and by lower-case name (the Excel import). */
  async lookup(tx: Tx): Promise<Map<string, string>> {
    const rows = await tx.clientSegment.findMany({
      where: { deletedAt: null },
      select: { id: true, code: true, name: true },
    });
    const out = new Map<string, string>();
    for (const r of rows) out.set(r.name.trim().toLowerCase(), r.id);
    // A code wins over another segment's name.
    for (const r of rows) out.set(r.code.trim().toLowerCase(), r.id);
    return out;
  }

  /**
   * The segments an import names: the live ones, plus the missing ones created now (the
   * owner confirmed it). The code is the name in capitals, cut to 20 characters and
   * numbered when taken. Returns ids by lower-case name.
   */
  async ensure(tx: Tx, names: string[]): Promise<Map<string, string>> {
    const known = await this.lookup(tx);
    const taken = new Set(
      (await tx.clientSegment.findMany({ where: { deletedAt: null }, select: { code: true } })).map(
        (s) => s.code.toLowerCase(),
      ),
    );
    for (const raw of names) {
      const name = raw.trim();
      const key = name.toLowerCase();
      if (name === '' || known.has(key)) continue;
      const base = name.toUpperCase().slice(0, 20);
      let code = base;
      for (let n = 2; taken.has(code.toLowerCase()); n++) {
        code = `${base.slice(0, 20 - String(n).length - 1)}-${n}`;
      }
      taken.add(code.toLowerCase());
      const row = await tx.clientSegment.create({
        data: { tenantId: tenantContext.requireTenantId(), code, name },
      });
      await this.audit.log(tx, {
        action: 'CLIENT_SEGMENT_CREATED',
        entity: 'ClientSegment',
        entityId: row.id,
        after: { code, name, source: 'import' },
      });
      known.set(key, row.id);
    }
    return known;
  }

  private async get(id: string): Promise<ClientSegmentDto> {
    const row = await this.prisma.db.clientSegment.findFirst({
      where: { id },
      include: { _count: { select: { clients: { where: { deletedAt: null } } } } },
    });
    if (!row) throw this.notFound();
    return toDto(row);
  }

  private async lock(tx: Tx, id: string) {
    await tx.$queryRaw`
      SELECT id FROM client_segments
      WHERE id = ${id}::uuid AND "tenantId" = ${tenantContext.requireTenantId()}::uuid
      FOR UPDATE`;
    const row = await tx.clientSegment.findFirst({ where: { id, deletedAt: null } });
    if (!row) throw this.notFound();
    return row;
  }

  private async assertCodeFree(tx: Tx, code: string, exceptId: string | null): Promise<void> {
    const taken = await tx.clientSegment.findFirst({
      where: {
        code: { equals: code, mode: 'insensitive' },
        deletedAt: null,
        ...(exceptId ? { NOT: { id: exceptId } } : {}),
      },
      select: { id: true },
    });
    if (taken) throw this.codeTaken();
  }

  /** The partial unique index is the last word when two requests race. */
  private async write<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw this.codeTaken();
      }
      throw err;
    }
  }

  private codeTaken(): AppException {
    return new AppException(ErrorCode.CLIENT_SEGMENT_CODE_TAKEN, 'Code already used', {
      field: 'code',
    });
  }

  private notFound(details?: Record<string, unknown>): AppException {
    return new AppException(ErrorCode.NOT_FOUND, 'Client segment not found', details);
  }
}

function toDto(row: {
  id: string;
  code: string;
  name: string;
  deletedAt: Date | null;
  _count: { clients: number };
}): ClientSegmentDto {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    archived: row.deletedAt !== null,
    clientCount: row._count.clients,
  };
}
