import { Injectable } from '@nestjs/common';
import {
  type ClientPackagingDto,
  type ClientPackagingQuery,
  ErrorCode,
  PackagingEntryType,
  type PackagingEntryDto,
  type PackagingMovementInput,
  type PackagingMovementResultDto,
  type PackagingTypeDto,
  type PackagingTypeInput,
  type ProductPackagingDto,
  type ProductPackagingInput,
  Role,
  toMoneyString,
  toQtyString,
} from '@erp/shared';
import { AuditService } from '../audit/audit.service';
import type { CurrentUserInfo } from '../auth/auth.types';
import { AppException } from '../common/app-exception';
import { tenantContext } from '../common/tenant-context';
import { Prisma } from '../generated/prisma/client';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import { ScopeService } from '../sales-force/scope.service';
import { PackagingLedgerService } from './packaging-ledger.service';

/** Packaging types, the client relevé and manual movements (phase 20, PACKAGING). */
@Injectable()
export class PackagingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly ledger: PackagingLedgerService,
    private readonly scope: ScopeService,
  ) {}

  // ---------------------------------------------------------------- types

  async listTypes(): Promise<PackagingTypeDto[]> {
    const rows = await this.prisma.db.packagingType.findMany({
      where: { deletedAt: null },
      orderBy: { name: 'asc' },
      include: { _count: { select: { products: { where: { product: { deletedAt: null } } } } } },
    });
    return rows.map((t) => ({
      id: t.id,
      name: t.name,
      depositValue: t.depositValue ? toMoneyString(t.depositValue.toString()) : null,
      productCount: t._count.products,
    }));
  }

  async createType(input: PackagingTypeInput): Promise<PackagingTypeDto> {
    const id = await this.prisma.db.$transaction(async (tx) => {
      await this.lockTenant(tx);
      await this.checkNameFree(tx, input.name, null);
      const t = await tx.packagingType.create({
        data: { tenantId: tenantContext.requireTenantId(), ...input },
      });
      await this.audit.log(tx, {
        action: 'PACKAGING_TYPE_CREATED',
        entity: 'PackagingType',
        entityId: t.id,
        after: t,
      });
      return t.id;
    });
    return this.getType(id);
  }

  async updateType(id: string, input: PackagingTypeInput): Promise<PackagingTypeDto> {
    await this.prisma.db.$transaction(async (tx) => {
      await this.lockTenant(tx);
      const before = await this.findLive(tx, id);
      await this.checkNameFree(tx, input.name, id);
      const after = await tx.packagingType.update({ where: { id }, data: input });
      await this.audit.log(tx, {
        action: 'PACKAGING_TYPE_UPDATED',
        entity: 'PackagingType',
        entityId: id,
        before,
        after,
      });
    });
    return this.getType(id);
  }

  /** Soft delete: counts already with clients stay on their relevé. */
  async archiveType(id: string): Promise<void> {
    await this.prisma.db.$transaction(async (tx) => {
      const before = await this.findLive(tx, id);
      await tx.packagingType.update({ where: { id }, data: { deletedAt: new Date() } });
      await this.audit.log(tx, {
        action: 'PACKAGING_TYPE_ARCHIVED',
        entity: 'PackagingType',
        entityId: id,
        before,
      });
    });
  }

  private async getType(id: string): Promise<PackagingTypeDto> {
    const t = (await this.listTypes()).find((x) => x.id === id);
    if (!t) throw new AppException(ErrorCode.NOT_FOUND, 'Packaging type not found');
    return t;
  }

  // ---------------------------------------------------------------- products

  async ofProduct(productId: string): Promise<ProductPackagingDto[]> {
    const rows = await this.prisma.db.productPackaging.findMany({
      where: { productId, packagingType: { deletedAt: null } },
      include: { packagingType: { select: { name: true } } },
      orderBy: { packagingType: { name: 'asc' } },
    });
    return rows.map((r) => ({
      packagingTypeId: r.packagingTypeId,
      name: r.packagingType.name,
      qtyBasePerPackaging: toQtyString(r.qtyBasePerPackaging.toString()),
    }));
  }

  /** Replaces the product's packaging (master data; past sales keep their entries). */
  async setProduct(
    productId: string,
    input: ProductPackagingInput,
  ): Promise<ProductPackagingDto[]> {
    await this.prisma.db.$transaction(async (tx) => {
      const product = await tx.product.findFirst({
        where: { id: productId, deletedAt: null },
        select: { id: true },
      });
      if (!product) throw new AppException(ErrorCode.PRODUCT_NOT_FOUND, 'Product not found');
      await this.ledger.checkTypes(
        tx,
        input.map((p) => p.packagingTypeId),
      );
      const before = await tx.productPackaging.findMany({ where: { productId } });
      await tx.productPackaging.deleteMany({ where: { productId } });
      if (input.length > 0) {
        const tenantId = tenantContext.requireTenantId();
        await tx.productPackaging.createMany({
          data: input.map((p) => ({ tenantId, productId, ...p })),
        });
      }
      await this.audit.log(tx, {
        action: 'PRODUCT_PACKAGING_UPDATED',
        entity: 'Product',
        entityId: productId,
        before,
        after: input,
      });
    });
    return this.ofProduct(productId);
  }

  // ---------------------------------------------------------------- client side

  /** Counts per packaging and the entries, newest first, with the count after each. */
  async ofClient(
    clientId: string,
    query: ClientPackagingQuery,
    user: CurrentUserInfo,
  ): Promise<ClientPackagingDto> {
    const db = this.prisma.db;
    const client = await db.client.findFirst({ where: { id: clientId }, select: { id: true } });
    if (!client) throw new AppException(ErrorCode.NOT_FOUND, 'Client not found');
    await this.scope.assertClient(db, user, clientId);
    const balances = await db.clientPackagingBalance.findMany({
      where: { clientId },
      include: { packagingType: { select: { name: true, depositValue: true } } },
      orderBy: { packagingType: { name: 'asc' } },
    });
    const entries = await this.entriesWithBalance(db, clientId, {
      before: query.cursor ? BigInt(query.cursor) : null,
      limit: query.limit + 1,
    });
    const page = entries.slice(0, query.limit);
    return {
      clientId,
      balances: balances.map((b) => ({
        packagingTypeId: b.packagingTypeId,
        name: b.packagingType.name,
        balance: b.balance,
        depositValue: b.packagingType.depositValue
          ? toMoneyString(b.packagingType.depositValue.toString())
          : null,
      })),
      entries: page,
      nextCursor: entries.length > query.limit ? (page.at(-1)?.seq ?? null) : null,
    };
  }

  /** Every entry of a client, oldest first, for the printed relevé. */
  async statement(clientId: string, user: CurrentUserInfo): Promise<PackagingEntryDto[]> {
    await this.scope.assertClient(this.prisma.db, user, clientId);
    const rows = await this.entriesWithBalance(this.prisma.db, clientId, {
      before: null,
      limit: 10_000,
    });
    return rows.reverse();
  }

  /** Empties brought back (any role who sees the client) or a correction (managers). */
  async move(
    input: PackagingMovementInput,
    user: CurrentUserInfo,
  ): Promise<PackagingMovementResultDto> {
    await this.ledger.requireEnabled();
    if (
      input.type === PackagingEntryType.ADJUST &&
      user.role !== Role.OWNER &&
      user.role !== Role.MANAGER
    ) {
      throw new AppException(ErrorCode.FORBIDDEN, 'Only a manager corrects a count', {
        field: 'type',
      });
    }
    const seq = await this.prisma.db.$transaction(async (tx) => {
      const client = await tx.client.findFirst({
        where: { id: input.clientId, deletedAt: null },
        select: { code: true },
      });
      if (!client) throw new AppException(ErrorCode.NOT_FOUND, 'Client not found');
      await this.scope.assertClient(tx, user, input.clientId);
      await this.ledger.checkTypes(tx, [input.packagingTypeId]);
      const qty = input.type === PackagingEntryType.RETURN ? -input.qty : input.qty;
      await this.ledger.post(tx, [
        {
          clientId: input.clientId,
          packagingTypeId: input.packagingTypeId,
          type: input.type,
          qty,
          label: input.type === PackagingEntryType.RETURN ? 'Retour emballages' : 'Ajustement',
          note: input.note,
          refType: 'PackagingMovement',
        },
      ]);
      const entry = await tx.clientPackagingEntry.findFirstOrThrow({
        where: { clientId: input.clientId, packagingTypeId: input.packagingTypeId },
        orderBy: { seq: 'desc' },
        select: { id: true, seq: true },
      });
      await this.audit.log(tx, {
        action: 'PACKAGING_MOVEMENT_CREATED',
        entity: 'Client',
        entityId: input.clientId,
        after: { ...input, entryId: entry.id },
      });
      return entry.seq;
    });
    const [entry] = await this.entriesWithBalance(this.prisma.db, input.clientId, {
      before: seq + 1n,
      limit: 1,
    });
    if (!entry) throw new Error('movement not found after write');
    return { entry, balance: entry.balanceAfter, negative: entry.balanceAfter < 0 };
  }

  /** Entries newest first, each with the count of its packaging right after it. */
  private async entriesWithBalance(
    db: Tx,
    clientId: string,
    page: { before: bigint | null; limit: number },
  ): Promise<PackagingEntryDto[]> {
    const tenantId = tenantContext.requireTenantId();
    const rows = await db.$queryRaw<
      {
        id: string;
        seq: bigint;
        packagingTypeId: string;
        packagingName: string;
        type: PackagingEntryType;
        qty: number;
        balanceAfter: bigint;
        label: string;
        note: string | null;
        refType: string | null;
        refId: string | null;
        createdAt: Date;
      }[]
    >`
      SELECT * FROM (
        SELECT e.id::text AS id, e.seq, e."packagingTypeId"::text AS "packagingTypeId",
               t.name AS "packagingName", e.type, e.qty,
               SUM(e.qty) OVER (PARTITION BY e."packagingTypeId" ORDER BY e.seq) AS "balanceAfter",
               e.label, e.note, e."refType", e."refId"::text AS "refId", e."createdAt"
        FROM client_packaging_entries e
        JOIN packaging_types t ON t.id = e."packagingTypeId"
        WHERE e."tenantId" = ${tenantId}::uuid AND e."clientId" = ${clientId}::uuid
      ) x
      ${page.before !== null ? Prisma.sql`WHERE x.seq < ${page.before}` : Prisma.empty}
      ORDER BY x.seq DESC
      LIMIT ${page.limit}`;
    return rows.map((r) => ({
      id: r.id,
      seq: r.seq.toString(),
      packagingTypeId: r.packagingTypeId,
      packagingName: r.packagingName,
      type: r.type,
      qty: r.qty,
      balanceAfter: Number(r.balanceAfter),
      label: r.label,
      note: r.note,
      refType: r.refType,
      refId: r.refId,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  private async findLive(tx: Tx, id: string) {
    const t = await tx.packagingType.findFirst({ where: { id, deletedAt: null } });
    if (!t) throw new AppException(ErrorCode.NOT_FOUND, 'Packaging type not found');
    return t;
  }

  /** Serializes type creation per tenant so two equal names cannot both pass the check. */
  private async lockTenant(tx: Tx): Promise<void> {
    await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${tenantContext.requireTenantId()}::uuid FOR UPDATE`;
  }

  private async checkNameFree(tx: Tx, name: string, exceptId: string | null): Promise<void> {
    const taken = await tx.packagingType.findFirst({
      where: {
        name: { equals: name, mode: 'insensitive' },
        deletedAt: null,
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
    });
    if (taken) {
      throw new AppException(ErrorCode.PACKAGING_TYPE_NAME_TAKEN, 'Name already used', {
        field: 'name',
      });
    }
  }
}
