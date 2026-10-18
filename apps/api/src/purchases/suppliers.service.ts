import { Injectable } from '@nestjs/common';
import {
  ErrorCode,
  type SupplierDto,
  type SupplierInput,
  type SupplierListQuery,
  type SupplierPage,
  type UpdateSupplierInput,
} from '@erp/shared';
import { AuditService } from '../audit/audit.service';
import { AppException } from '../common/app-exception';
import { tenantContext } from '../common/tenant-context';
import { type Supplier } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

function toDto(s: Supplier): SupplierDto {
  return {
    id: s.id,
    name: s.name,
    phone: s.phone,
    address: s.address,
    rc: s.rc,
    nif: s.nif,
    nis: s.nis,
    ai: s.ai,
    notes: s.notes,
    archivedAt: s.deletedAt?.toISOString() ?? null,
  };
}

@Injectable()
export class SuppliersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(query: SupplierListQuery): Promise<SupplierPage> {
    const search = query.search?.trim();
    const rows = await this.prisma.db.supplier.findMany({
      where: {
        deletedAt: null,
        ...(search
          ? {
              OR: [
                { name: { contains: search, mode: 'insensitive' } },
                { phone: { contains: search } },
              ],
            }
          : {}),
      },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const page = rows.slice(0, query.limit);
    return {
      items: page.map(toDto),
      nextCursor: rows.length > query.limit ? (page.at(-1)?.id ?? null) : null,
    };
  }

  async get(id: string): Promise<SupplierDto> {
    const s = await this.prisma.db.supplier.findUnique({ where: { id } });
    if (!s) throw new AppException(ErrorCode.NOT_FOUND, 'Supplier not found');
    return toDto(s);
  }

  async create(input: SupplierInput): Promise<SupplierDto> {
    return this.prisma.db.$transaction(async (tx) => {
      const s = await tx.supplier.create({
        data: { ...input, tenantId: tenantContext.requireTenantId() },
      });
      await this.audit.log(tx, {
        action: 'SUPPLIER_CREATED',
        entity: 'Supplier',
        entityId: s.id,
        after: s,
      });
      return toDto(s);
    });
  }

  async update(id: string, input: UpdateSupplierInput): Promise<SupplierDto> {
    return this.prisma.db.$transaction(async (tx) => {
      const before = await tx.supplier.findFirst({ where: { id, deletedAt: null } });
      if (!before) throw new AppException(ErrorCode.NOT_FOUND, 'Supplier not found');
      const after = await tx.supplier.update({ where: { id }, data: input });
      await this.audit.log(tx, {
        action: 'SUPPLIER_UPDATED',
        entity: 'Supplier',
        entityId: id,
        before,
        after,
      });
      return toDto(after);
    });
  }

  /** Soft delete: past bons de réception keep pointing to the supplier. */
  async archive(id: string): Promise<void> {
    await this.prisma.db.$transaction(async (tx) => {
      const before = await tx.supplier.findFirst({ where: { id, deletedAt: null } });
      if (!before) throw new AppException(ErrorCode.NOT_FOUND, 'Supplier not found');
      await tx.supplier.update({ where: { id }, data: { deletedAt: new Date() } });
      await this.audit.log(tx, {
        action: 'SUPPLIER_ARCHIVED',
        entity: 'Supplier',
        entityId: id,
        before,
      });
    });
  }
}
