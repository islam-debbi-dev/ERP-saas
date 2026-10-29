import { Injectable } from '@nestjs/common';
import {
  type CreateSectorInput,
  ErrorCode,
  type SectorDto,
  type UpdateSectorInput,
} from '@erp/shared';
import { AuditService } from '../audit/audit.service';
import { AppException } from '../common/app-exception';
import { tenantContext } from '../common/tenant-context';
import { PrismaService, type Tx } from '../prisma/prisma.service';

/** Secteurs (SALES_FORCE): a zone, wilaya + communes, clients belong to. */
@Injectable()
export class SectorsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(): Promise<SectorDto[]> {
    const rows = await this.prisma.db.sector.findMany({
      where: { deletedAt: null },
      orderBy: { name: 'asc' },
      include: { _count: { select: { clients: { where: { deletedAt: null } } } } },
    });
    return rows.map((s) => ({
      id: s.id,
      name: s.name,
      wilaya: s.wilaya,
      communes: s.communes,
      clientCount: s._count.clients,
    }));
  }

  async create(input: CreateSectorInput): Promise<SectorDto> {
    return this.prisma.db.$transaction(async (tx) => {
      await this.lockTenant(tx);
      await this.checkNameFree(tx, input.name, null);
      const s = await tx.sector.create({
        data: { tenantId: tenantContext.requireTenantId(), ...input },
      });
      await this.audit.log(tx, {
        action: 'SECTOR_CREATED',
        entity: 'Sector',
        entityId: s.id,
        after: s,
      });
      return { id: s.id, name: s.name, wilaya: s.wilaya, communes: s.communes, clientCount: 0 };
    });
  }

  async update(id: string, input: UpdateSectorInput): Promise<SectorDto> {
    await this.prisma.db.$transaction(async (tx) => {
      await this.lockTenant(tx);
      const before = await this.findLive(tx, id);
      if (input.name !== undefined) await this.checkNameFree(tx, input.name, id);
      const after = await tx.sector.update({ where: { id }, data: input });
      await this.audit.log(tx, {
        action: 'SECTOR_UPDATED',
        entity: 'Sector',
        entityId: id,
        before,
        after,
      });
    });
    const all = await this.list();
    return all.find((s) => s.id === id)!;
  }

  /** Soft delete; its clients keep the sector id in history but are taken out of it. */
  async archive(id: string): Promise<void> {
    await this.prisma.db.$transaction(async (tx) => {
      await this.lockTenant(tx);
      const before = await this.findLive(tx, id);
      const freed = await tx.client.updateMany({
        where: { sectorId: id },
        data: { sectorId: null, version: { increment: 1 } },
      });
      await tx.sector.update({ where: { id }, data: { deletedAt: new Date() } });
      await this.audit.log(tx, {
        action: 'SECTOR_DELETED',
        entity: 'Sector',
        entityId: id,
        before,
        after: { clientsUnassigned: freed.count },
      });
    });
  }

  /** Throws NOT_FOUND unless the sector is live in this tenant. */
  async findLive(tx: Tx, id: string) {
    const s = await tx.sector.findFirst({ where: { id, deletedAt: null } });
    if (!s) throw new AppException(ErrorCode.NOT_FOUND, 'Sector not found');
    return s;
  }

  /** Sector writes are rare: serialized per tenant so the name check cannot race. */
  private async lockTenant(tx: Tx): Promise<void> {
    await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${tenantContext.requireTenantId()}::uuid FOR UPDATE`;
  }

  private async checkNameFree(tx: Tx, name: string, selfId: string | null): Promise<void> {
    const same = await tx.sector.findFirst({
      where: {
        name: { equals: name, mode: 'insensitive' },
        deletedAt: null,
        ...(selfId ? { id: { not: selfId } } : {}),
      },
    });
    if (same) throw new AppException(ErrorCode.SECTOR_NAME_TAKEN, 'Sector name already used');
  }
}
