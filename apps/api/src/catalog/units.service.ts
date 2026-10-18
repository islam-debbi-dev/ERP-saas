import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { type CreateUnitInput, ErrorCode, type UnitDto } from '@erp/shared';
import { AuditService } from '../audit/audit.service';
import { AppException } from '../common/app-exception';
import { tenantContext } from '../common/tenant-context';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class UnitsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(): Promise<UnitDto[]> {
    const units = await this.prisma.db.unit.findMany({ orderBy: { createdAt: 'asc' } });
    return units.map((u) => ({
      id: u.id,
      code: u.code,
      name: u.name,
      allowsDecimal: u.allowsDecimal,
    }));
  }

  /** A tenant-specific unit (e.g. "Palette"). Default units cannot be renamed. */
  async create(input: CreateUnitInput): Promise<UnitDto> {
    return this.prisma.db.$transaction(async (tx) => {
      const same = await tx.unit.findFirst({
        where: { name: { equals: input.name, mode: 'insensitive' } },
      });
      if (same) throw new AppException(ErrorCode.CONFLICT, 'A unit with this name exists');
      const unit = await tx.unit.create({
        data: {
          tenantId: tenantContext.requireTenantId(),
          code: `CUSTOM-${randomBytes(4).toString('hex').toUpperCase()}`,
          name: input.name,
          allowsDecimal: input.allowsDecimal,
        },
      });
      await this.audit.log(tx, {
        action: 'UNIT_CREATED',
        entity: 'Unit',
        entityId: unit.id,
        after: unit,
      });
      return { id: unit.id, code: unit.code, name: unit.name, allowsDecimal: unit.allowsDecimal };
    });
  }
}
