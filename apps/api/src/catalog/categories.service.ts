import { Injectable } from '@nestjs/common';
import {
  type CategoryDto,
  type CreateCategoryInput,
  ErrorCode,
  type UpdateCategoryInput,
} from '@erp/shared';
import { AuditService } from '../audit/audit.service';
import { AppException } from '../common/app-exception';
import { tenantContext } from '../common/tenant-context';
import { PrismaService, type Tx } from '../prisma/prisma.service';

@Injectable()
export class CategoriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Live categories as a two-level tree, sorted by name. */
  async tree(): Promise<CategoryDto[]> {
    const rows = await this.prisma.db.category.findMany({
      where: { deletedAt: null },
      orderBy: { name: 'asc' },
    });
    const byParent = new Map<string | null, CategoryDto[]>();
    for (const c of rows) {
      const list = byParent.get(c.parentId) ?? [];
      list.push({ id: c.id, name: c.name, parentId: c.parentId, children: [] });
      byParent.set(c.parentId, list);
    }
    return (byParent.get(null) ?? []).map((c) => ({ ...c, children: byParent.get(c.id) ?? [] }));
  }

  async create(input: CreateCategoryInput): Promise<CategoryDto> {
    return this.prisma.db.$transaction(async (tx) => {
      await this.lockTenant(tx);
      await this.checkParent(tx, input.parentId, null);
      await this.checkNameFree(tx, input.name, input.parentId, null);
      const c = await tx.category.create({
        data: {
          tenantId: tenantContext.requireTenantId(),
          name: input.name,
          parentId: input.parentId,
        },
      });
      await this.audit.log(tx, {
        action: 'CATEGORY_CREATED',
        entity: 'Category',
        entityId: c.id,
        after: c,
      });
      return { id: c.id, name: c.name, parentId: c.parentId, children: [] };
    });
  }

  async update(id: string, input: UpdateCategoryInput): Promise<CategoryDto> {
    return this.prisma.db.$transaction(async (tx) => {
      await this.lockTenant(tx);
      const before = await this.findLive(tx, id);
      const name = input.name ?? before.name;
      const parentId = input.parentId === undefined ? before.parentId : input.parentId;
      if (parentId !== before.parentId) {
        await this.checkParent(tx, parentId, id);
        const hasChildren = await tx.category.count({ where: { parentId: id, deletedAt: null } });
        if (parentId && hasChildren > 0) {
          throw new AppException(
            ErrorCode.CATEGORY_TOO_DEEP,
            'A category with subcategories cannot be nested',
          );
        }
      }
      await this.checkNameFree(tx, name, parentId, id);
      const after = await tx.category.update({ where: { id }, data: { name, parentId } });
      await this.audit.log(tx, {
        action: 'CATEGORY_UPDATED',
        entity: 'Category',
        entityId: id,
        before,
        after,
      });
      return { id: after.id, name: after.name, parentId: after.parentId, children: [] };
    });
  }

  /** Soft delete, refused while live products or subcategories use it. */
  async remove(id: string): Promise<void> {
    await this.prisma.db.$transaction(async (tx) => {
      await this.lockTenant(tx);
      const before = await this.findLive(tx, id);
      const [children, products] = await Promise.all([
        tx.category.count({ where: { parentId: id, deletedAt: null } }),
        tx.product.count({ where: { categoryId: id, deletedAt: null } }),
      ]);
      if (children > 0 || products > 0) {
        throw new AppException(ErrorCode.CATEGORY_NOT_EMPTY, 'Category still in use', {
          children,
          products,
        });
      }
      await tx.category.update({ where: { id }, data: { deletedAt: new Date() } });
      await this.audit.log(tx, {
        action: 'CATEGORY_DELETED',
        entity: 'Category',
        entityId: id,
        before,
      });
    });
  }

  /** Live category ids to filter products by: the category and its subcategories. */
  async idsWithChildren(id: string): Promise<string[]> {
    const children = await this.prisma.db.category.findMany({
      where: { parentId: id, deletedAt: null },
      select: { id: true },
    });
    return [id, ...children.map((c) => c.id)];
  }

  /**
   * Category id per name (case-insensitive, any level), creating the missing
   * ones as top-level categories in the caller's transaction (Excel import).
   */
  async ensureByNames(tx: Tx, names: string[]): Promise<Map<string, string>> {
    const wanted = new Map(names.map((n) => [n.trim().toLowerCase(), n.trim()]));
    wanted.delete('');
    const out = new Map<string, string>();
    if (wanted.size === 0) return out;
    await this.lockTenant(tx);
    const live = await tx.category.findMany({
      where: { deletedAt: null },
      orderBy: [{ parentId: { sort: 'asc', nulls: 'first' } }, { name: 'asc' }],
    });
    for (const c of live) {
      const key = c.name.toLowerCase();
      if (wanted.has(key) && !out.has(key)) out.set(key, c.id);
    }
    for (const [key, name] of wanted) {
      if (out.has(key)) continue;
      const c = await tx.category.create({
        data: {
          tenantId: tenantContext.requireTenantId(),
          name: name.slice(0, 80),
          parentId: null,
        },
      });
      await this.audit.log(tx, {
        action: 'CATEGORY_CREATED',
        entity: 'Category',
        entityId: c.id,
        after: c,
      });
      out.set(key, c.id);
    }
    return out;
  }

  /**
   * Category writes are rare, so they are serialized per tenant: the name check
   * below then cannot race with a concurrent create.
   */
  private async lockTenant(tx: Tx): Promise<void> {
    await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${tenantContext.requireTenantId()}::uuid FOR UPDATE`;
  }

  private async findLive(tx: Tx, id: string) {
    const c = await tx.category.findFirst({ where: { id, deletedAt: null } });
    if (!c) throw new AppException(ErrorCode.NOT_FOUND, 'Category not found');
    return c;
  }

  private async checkParent(tx: Tx, parentId: string | null, selfId: string | null): Promise<void> {
    if (!parentId) return;
    if (parentId === selfId)
      throw new AppException(ErrorCode.CATEGORY_TOO_DEEP, 'A category cannot be its own parent');
    const parent = await this.findLive(tx, parentId);
    if (parent.parentId) {
      throw new AppException(
        ErrorCode.CATEGORY_TOO_DEEP,
        'Only one level of subcategories is allowed',
      );
    }
  }

  private async checkNameFree(
    tx: Tx,
    name: string,
    parentId: string | null,
    selfId: string | null,
  ): Promise<void> {
    const same = await tx.category.findFirst({
      where: {
        name: { equals: name, mode: 'insensitive' },
        parentId,
        deletedAt: null,
        ...(selfId ? { id: { not: selfId } } : {}),
      },
    });
    if (same) throw new AppException(ErrorCode.CATEGORY_NAME_TAKEN, 'Category name already used');
  }
}
