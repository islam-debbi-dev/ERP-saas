import { Injectable } from '@nestjs/common';
import {
  type CreateSaleInput,
  ErrorCode,
  money,
  Permission,
  type PricePreviewDto,
  type PricePreviewQuery,
  type SaleDto,
  type SaleListQuery,
  type SalePage,
  SaleStatus,
  SaleType,
  toMoneyString,
  type UpdateSaleInput,
} from '@erp/shared';
import { AuditService } from '../audit/audit.service';
import type { CurrentUserInfo } from '../auth/auth.types';
import { can } from '../auth/permissions';
import { AppException } from '../common/app-exception';
import { tenantContext } from '../common/tenant-context';
import { type Prisma } from '../generated/prisma/client';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import { fromIsoDate, saleInclude, toIsoDate, toSaleDto } from './sale.mapper';
import { type PriceOverride, resolvePriceLevel, snapshotSaleLines } from './sale-lines';

/** Sale drafts and reads. Effects (stock, account, payments) live in SaleWorkflowService. */
@Injectable()
export class SalesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(input: CreateSaleInput, user: CurrentUserInfo): Promise<SaleDto> {
    const id = await this.prisma.db.$transaction((tx) => this.createDraftInTx(tx, input, user));
    return this.get(id);
  }

  /** Also used by the quick sale, which validates in the same transaction. */
  async createDraftInTx(tx: Tx, input: CreateSaleInput, user: CurrentUserInfo): Promise<string> {
    const tenantId = tenantContext.requireTenantId();
    await this.checkClient(tx, input.clientId);
    const priceLevelId = await resolvePriceLevel(tx, input.clientId);
    const assujetti = await this.assujettiTva(tx);
    const { lines, totals, overrides } = await snapshotSaleLines(
      tx,
      input.lines,
      priceLevelId,
      assujetti,
    );
    await this.checkOverrides(tx, overrides, user);
    const sale = await tx.sale.create({
      data: {
        tenantId,
        type: input.type,
        clientId: input.clientId,
        documentDate: fromIsoDate(input.documentDate),
        priceLevelId,
        note: input.note,
        assujettiTva: assujetti,
        totalHt: totals.totalHt.toString(),
        totalTva: totals.totalTva.toString(),
        totalTtc: totals.totalTtc.toString(),
        createdBy: user.id,
      },
    });
    if (lines.length > 0) {
      await tx.saleLine.createMany({
        data: lines.map((l) => ({ ...l, tenantId, saleId: sale.id })),
      });
    }
    await this.audit.log(tx, {
      action: 'SALE_DRAFT_CREATED',
      entity: 'Sale',
      entityId: sale.id,
      after: { type: input.type, clientId: input.clientId, lines: input.lines, overrides },
    });
    return sale.id;
  }

  /** Replaces the draft (header and lines). `version` guards against concurrent edits. */
  async update(id: string, input: UpdateSaleInput, user: CurrentUserInfo): Promise<SaleDto> {
    await this.prisma.db.$transaction(async (tx) => {
      const current = await lockSale(tx, id);
      if (current.status !== SaleStatus.DRAFT) {
        throw new AppException(ErrorCode.SALE_NOT_DRAFT, 'Only a draft can be edited', {
          status: current.status,
        });
      }
      if (current.version !== input.version) {
        throw new AppException(ErrorCode.SALE_MODIFIED, 'Sale changed since it was read', {
          currentVersion: current.version,
        });
      }
      await this.checkClient(tx, input.clientId);
      const priceLevelId = await resolvePriceLevel(tx, input.clientId);
      const assujetti = await this.assujettiTva(tx);
      const { lines, totals, overrides } = await snapshotSaleLines(
        tx,
        input.lines,
        priceLevelId,
        assujetti,
      );
      await this.checkOverrides(tx, overrides, user);
      // Draft lines have no effect anywhere, so they are simply replaced.
      await tx.saleLine.deleteMany({ where: { saleId: id } });
      if (lines.length > 0) {
        const tenantId = tenantContext.requireTenantId();
        await tx.saleLine.createMany({ data: lines.map((l) => ({ ...l, tenantId, saleId: id })) });
      }
      await tx.sale.update({
        where: { id },
        data: {
          type: input.type,
          clientId: input.clientId,
          documentDate: fromIsoDate(input.documentDate),
          priceLevelId,
          note: input.note,
          assujettiTva: assujetti,
          totalHt: totals.totalHt.toString(),
          totalTva: totals.totalTva.toString(),
          totalTtc: totals.totalTtc.toString(),
          version: { increment: 1 },
        },
      });
      await this.audit.log(tx, {
        action: 'SALE_DRAFT_UPDATED',
        entity: 'Sale',
        entityId: id,
        after: { type: input.type, clientId: input.clientId, lines: input.lines, overrides },
      });
    });
    return this.get(id);
  }

  async get(id: string): Promise<SaleDto> {
    const s = await this.prisma.db.sale.findUnique({ where: { id }, include: saleInclude });
    if (!s) throw new AppException(ErrorCode.NOT_FOUND, 'Sale not found');
    const seller = s.createdBy
      ? await this.prisma.db.user.findUnique({
          where: { id: s.createdBy },
          select: { id: true, fullName: true },
        })
      : null;
    return toSaleDto(s, seller);
  }

  /** The sale an avoir was made on (printing an avoir starts from its id). */
  async saleIdOfReturn(returnId: string): Promise<string> {
    const r = await this.prisma.db.saleReturn.findUnique({
      where: { id: returnId },
      select: { saleId: true },
    });
    if (!r) throw new AppException(ErrorCode.NOT_FOUND, 'Avoir not found');
    return r.saleId;
  }

  async list(query: SaleListQuery): Promise<SalePage> {
    const where: Prisma.SaleWhereInput = {
      ...(query.type ? { type: query.type } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.clientId ? { clientId: query.clientId } : {}),
      ...(query.sellerId ? { createdBy: query.sellerId } : {}),
      ...(query.notInvoiced ? { type: SaleType.BL, invoiceId: null } : {}),
      ...(query.from || query.to
        ? {
            documentDate: {
              ...(query.from ? { gte: fromIsoDate(query.from) } : {}),
              ...(query.to ? { lte: fromIsoDate(query.to) } : {}),
            },
          }
        : {}),
    };
    const rows = await this.prisma.db.sale.findMany({
      where,
      include: {
        client: { select: { id: true, code: true, name: true } },
        invoice: { select: { id: true, number: true } },
        _count: { select: { lines: true } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const page = rows.slice(0, query.limit);
    const sellerIds = [...new Set(page.map((s) => s.createdBy).filter((u): u is string => !!u))];
    const sellers = await this.prisma.db.user.findMany({
      where: { id: { in: sellerIds } },
      select: { id: true, fullName: true },
    });
    const sellerById = new Map(sellers.map((u) => [u.id, u]));
    return {
      items: page.map((s) => ({
        id: s.id,
        type: s.type,
        number: s.number,
        status: s.status,
        client: s.client,
        documentDate: toIsoDate(s.documentDate),
        totalTtc: toMoneyString(s.totalTtc.toString()),
        paidAmount: toMoneyString(s.paidAmount.toString()),
        invoice: s.invoice,
        seller: s.createdBy ? (sellerById.get(s.createdBy) ?? null) : null,
        lineCount: s._count.lines,
      })),
      nextCursor: rows.length > query.limit ? (page.at(-1)?.id ?? null) : null,
    };
  }

  /** The price the client would get for one product unit. */
  async pricePreview(query: PricePreviewQuery): Promise<PricePreviewDto> {
    const db = this.prisma.db;
    const unit = await db.productUnit.findFirst({
      where: { id: query.productUnitId, deletedAt: null },
      select: { id: true },
    });
    if (!unit) throw new AppException(ErrorCode.NOT_FOUND, 'Product unit not found');
    if (query.clientId) {
      const client = await db.client.findUnique({ where: { id: query.clientId } });
      if (!client) throw new AppException(ErrorCode.NOT_FOUND, 'Client not found');
    }
    const priceLevelId = await db.$transaction((tx) =>
      resolvePriceLevel(tx, query.clientId ?? null),
    );
    const price = priceLevelId
      ? await db.productPrice.findUnique({
          where: { productUnitId_priceLevelId: { productUnitId: unit.id, priceLevelId } },
        })
      : null;
    return {
      productUnitId: unit.id,
      priceLevelId,
      priceHt: price ? toMoneyString(price.priceHt.toString()) : null,
    };
  }

  /**
   * A changed unit price needs PRICE_OVERRIDE. A remise up to the tenant's
   * `maxDiscountPct` is free; above it needs DISCOUNT_ABOVE_X.
   */
  private async checkOverrides(
    tx: Tx,
    overrides: PriceOverride[],
    user: CurrentUserInfo,
  ): Promise<void> {
    if (overrides.length === 0) return;
    const priced = overrides.filter((o) => o.priceChanged);
    if (priced.length > 0 && !can(user, Permission.PRICE_OVERRIDE)) {
      throw new AppException(
        ErrorCode.PRICE_OVERRIDE_FORBIDDEN,
        'You may not change the price of a line',
        { permission: Permission.PRICE_OVERRIDE, lines: priced },
      );
    }
    if (can(user, Permission.DISCOUNT_ABOVE_X)) return;
    const { maxDiscountPct } = await tx.tenant.findUniqueOrThrow({
      where: { id: tenantContext.requireTenantId() },
      select: { maxDiscountPct: true },
    });
    const above = overrides.filter((o) => money(o.discountPct).gt(maxDiscountPct.toString()));
    if (above.length > 0) {
      throw new AppException(
        ErrorCode.PRICE_OVERRIDE_FORBIDDEN,
        'This discount is above what you may give',
        {
          permission: Permission.DISCOUNT_ABOVE_X,
          maxDiscountPct: maxDiscountPct.toString(),
          lines: above,
        },
      );
    }
  }

  private async checkClient(tx: Tx, clientId: string | null): Promise<void> {
    if (!clientId) return;
    const c = await tx.client.findFirst({ where: { id: clientId, deletedAt: null } });
    if (!c) {
      throw new AppException(ErrorCode.VALIDATION_FAILED, 'Unknown client', { field: 'clientId' });
    }
  }

  private async assujettiTva(tx: Tx): Promise<boolean> {
    const t = await tx.tenant.findUniqueOrThrow({
      where: { id: tenantContext.requireTenantId() },
      select: { assujettiTva: true },
    });
    return t.assujettiTva;
  }
}

/** Locks the sale row for the rest of the transaction. */
export async function lockSale(
  tx: Tx,
  id: string,
): Promise<{ status: SaleStatus; version: number }> {
  const rows = await tx.$queryRaw<{ status: SaleStatus; version: number }[]>`
    SELECT status, version FROM sales
    WHERE id = ${id}::uuid AND "tenantId" = ${tenantContext.requireTenantId()}::uuid
    FOR UPDATE`;
  const row = rows[0];
  if (!row) throw new AppException(ErrorCode.NOT_FOUND, 'Sale not found');
  return row;
}
