import { Injectable } from '@nestjs/common';
import { ErrorCode, type PriceLevelDto, type RenamePriceLevelInput } from '@erp/shared';
import { AuditService } from '../audit/audit.service';
import { AppException } from '../common/app-exception';
import { tenantContext } from '../common/tenant-context';
import { PrismaService, type Tx } from '../prisma/prisma.service';

@Injectable()
export class PriceLevelsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Active levels: the first `priceLevelCount` of the tenant, in order. */
  async list(): Promise<PriceLevelDto[]> {
    return this.prisma.db.$transaction(async (tx) => {
      const count = await this.activeCount(tx);
      const levels = await tx.priceLevel.findMany({
        where: { position: { lte: count } },
        orderBy: { position: 'asc' },
      });
      return levels.map((l) => ({ id: l.id, position: l.position, name: l.name }));
    });
  }

  async rename(id: string, input: RenamePriceLevelInput): Promise<PriceLevelDto> {
    return this.prisma.db.$transaction(async (tx) => {
      const before = await tx.priceLevel.findUnique({ where: { id } });
      if (!before) throw new AppException(ErrorCode.NOT_FOUND, 'Price level not found');
      const after = await tx.priceLevel.update({ where: { id }, data: { name: input.name } });
      await this.audit.log(tx, {
        action: 'PRICE_LEVEL_RENAMED',
        entity: 'PriceLevel',
        entityId: id,
        before: { name: before.name },
        after: { name: after.name },
      });
      return { id: after.id, position: after.position, name: after.name };
    });
  }

  /** Ids of the active levels, for validating product prices. */
  async activeIds(tx: Tx): Promise<Set<string>> {
    const count = await this.activeCount(tx);
    const levels = await tx.priceLevel.findMany({
      where: { position: { lte: count } },
      select: { id: true },
    });
    return new Set(levels.map((l) => l.id));
  }

  private async activeCount(tx: Tx): Promise<number> {
    const tenant = await tx.tenant.findUniqueOrThrow({
      where: { id: tenantContext.requireTenantId() },
      select: { priceLevelCount: true },
    });
    return tenant.priceLevelCount;
  }
}
