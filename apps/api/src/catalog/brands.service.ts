import { Injectable } from '@nestjs/common';
import {
  type BrandDto,
  type CreateBrandInput,
  ErrorCode,
  type UpdateBrandInput,
} from '@erp/shared';
import { AuditService } from '../audit/audit.service';
import { AppException } from '../common/app-exception';
import { tenantContext } from '../common/tenant-context';
import { PrismaService, type Tx } from '../prisma/prisma.service';

/** Marques (phase 14, core). Names are unique per tenant, case-insensitive. */
@Injectable()
export class BrandsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(): Promise<BrandDto[]> {
    const rows = await this.prisma.db.brand.findMany({
      where: { deletedAt: null },
      orderBy: { name: 'asc' },
      include: {
        supplier: { select: { name: true } },
        _count: { select: { products: { where: { deletedAt: null } } } },
      },
    });
    return rows.map((b) => ({
      id: b.id,
      name: b.name,
      supplierId: b.supplierId,
      supplierName: b.supplier?.name ?? null,
      productCount: b._count.products,
    }));
  }

  async create(input: CreateBrandInput): Promise<BrandDto> {
    const id = await this.prisma.db.$transaction(async (tx) => {
      await this.lockTenant(tx);
      await this.checkNameFree(tx, input.name, null);
      await this.checkSupplier(tx, input.supplierId);
      const b = await tx.brand.create({
        data: { tenantId: tenantContext.requireTenantId(), ...input },
      });
      await this.audit.log(tx, {
        action: 'BRAND_CREATED',
        entity: 'Brand',
        entityId: b.id,
        after: b,
      });
      return b.id;
    });
    return this.get(id);
  }

  async update(id: string, input: UpdateBrandInput): Promise<BrandDto> {
    await this.prisma.db.$transaction(async (tx) => {
      await this.lockTenant(tx);
      const before = await this.findLive(tx, id);
      if (input.name !== undefined) await this.checkNameFree(tx, input.name, id);
      if (input.supplierId !== undefined) await this.checkSupplier(tx, input.supplierId);
      const after = await tx.brand.update({ where: { id }, data: input });
      await this.audit.log(tx, {
        action: 'BRAND_UPDATED',
        entity: 'Brand',
        entityId: id,
        before,
        after,
      });
    });
    return this.get(id);
  }

  /** Soft delete; its products keep the brand (history and reports stay right). */
  async archive(id: string): Promise<void> {
    await this.prisma.db.$transaction(async (tx) => {
      await this.lockTenant(tx);
      const before = await this.findLive(tx, id);
      await tx.brand.update({ where: { id }, data: { deletedAt: new Date() } });
      await this.audit.log(tx, { action: 'BRAND_DELETED', entity: 'Brand', entityId: id, before });
    });
  }

  /**
   * Brand id per name (case-insensitive), creating the missing ones in the caller's
   * transaction (Excel import). A second run of the same file creates nothing.
   */
  async ensureByNames(tx: Tx, names: string[]): Promise<Map<string, string>> {
    const wanted = new Map(names.map((n) => [n.trim().toLowerCase(), n.trim()]));
    wanted.delete('');
    const out = new Map<string, string>();
    if (wanted.size === 0) return out;
    await this.lockTenant(tx);
    const live = await tx.brand.findMany({ where: { deletedAt: null }, orderBy: { name: 'asc' } });
    for (const b of live) {
      const key = b.name.toLowerCase();
      if (wanted.has(key) && !out.has(key)) out.set(key, b.id);
    }
    for (const [key, name] of wanted) {
      if (out.has(key)) continue;
      const b = await tx.brand.create({
        data: { tenantId: tenantContext.requireTenantId(), name: name.slice(0, 80) },
      });
      await this.audit.log(tx, {
        action: 'BRAND_CREATED',
        entity: 'Brand',
        entityId: b.id,
        after: b,
      });
      out.set(key, b.id);
    }
    return out;
  }

  private async get(id: string): Promise<BrandDto> {
    const b = (await this.list()).find((x) => x.id === id);
    if (!b) throw new AppException(ErrorCode.NOT_FOUND, 'Brand not found');
    return b;
  }

  /** Brand writes are rare: serialized per tenant so the name check cannot race. */
  private async lockTenant(tx: Tx): Promise<void> {
    await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${tenantContext.requireTenantId()}::uuid FOR UPDATE`;
  }

  private async findLive(tx: Tx, id: string) {
    const b = await tx.brand.findFirst({ where: { id, deletedAt: null } });
    if (!b) throw new AppException(ErrorCode.NOT_FOUND, 'Brand not found');
    return b;
  }

  private async checkSupplier(tx: Tx, supplierId: string | null): Promise<void> {
    if (!supplierId) return;
    const s = await tx.supplier.findFirst({ where: { id: supplierId, deletedAt: null } });
    if (!s) throw new AppException(ErrorCode.VALIDATION_FAILED, 'Unknown supplier');
  }

  private async checkNameFree(tx: Tx, name: string, selfId: string | null): Promise<void> {
    const same = await tx.brand.findFirst({
      where: {
        name: { equals: name, mode: 'insensitive' },
        deletedAt: null,
        ...(selfId ? { id: { not: selfId } } : {}),
      },
    });
    if (same) throw new AppException(ErrorCode.BRAND_NAME_TAKEN, 'Brand name already used');
  }
}
