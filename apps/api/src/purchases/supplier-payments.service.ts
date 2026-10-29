import { Injectable } from '@nestjs/common';
import {
  type CreateSupplierPaymentInput,
  DocType,
  ErrorCode,
  money,
  type PaymentMode,
  SupplierLedgerType,
  type SupplierPaymentDto,
  SupplierPaymentStatus,
  toMoneyString,
} from '@erp/shared';
import { AuditService } from '../audit/audit.service';
import type { CurrentUserInfo } from '../auth/auth.types';
import { AppException } from '../common/app-exception';
import { tenantContext } from '../common/tenant-context';
import { DocumentNumberingService } from '../documents/document-numbering.service';
import { type Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SupplierAccountService } from './supplier-account.service';

const paymentInclude = {
  supplier: { select: { id: true, code: true, name: true } },
} satisfies Prisma.SupplierPaymentInclude;
type PaymentWithSupplier = Prisma.SupplierPaymentGetPayload<{ include: typeof paymentInclude }>;

function toDto(
  p: PaymentWithSupplier,
  users: Map<string, { id: string; fullName: string }>,
): SupplierPaymentDto {
  return {
    id: p.id,
    number: p.number,
    supplier: p.supplier,
    amount: toMoneyString(p.amount.toString()),
    mode: p.mode,
    status: p.status,
    reference: p.reference,
    bank: p.bank,
    dueDate: p.dueDate?.toISOString().slice(0, 10) ?? null,
    note: p.note,
    paidBy: p.paidBy ? (users.get(p.paidBy) ?? null) : null,
    paidAt: p.paidAt.toISOString(),
    cancelReason: p.cancelReason,
    cancelledAt: p.cancelledAt?.toISOString() ?? null,
  };
}

/**
 * Règlements fournisseur (RGF, phase 21): the only writer of supplier_payments. The
 * money side goes through SupplierAccountService. Lock order: payment row, then the
 * supplier balance.
 */
@Injectable()
export class SupplierPaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly account: SupplierAccountService,
    private readonly numbering: DocumentNumberingService,
    private readonly audit: AuditService,
  ) {}

  async create(
    input: CreateSupplierPaymentInput,
    user: CurrentUserInfo,
  ): Promise<SupplierPaymentDto> {
    const id = await this.prisma.db.$transaction(async (tx) => {
      const tenantId = tenantContext.requireTenantId();
      const supplier = await tx.supplier.findFirst({
        where: { id: input.supplierId, deletedAt: null },
        select: { id: true },
      });
      if (!supplier) {
        throw new AppException(ErrorCode.VALIDATION_FAILED, 'Unknown supplier', {
          field: 'supplierId',
        });
      }
      const number = await this.numbering.next(tx, tenantId, DocType.RGF);
      const payment = await tx.supplierPayment.create({
        data: {
          tenantId,
          number,
          supplierId: supplier.id,
          amount: input.amount,
          mode: input.mode,
          reference: input.reference,
          bank: input.bank,
          dueDate: input.dueDate ? new Date(`${input.dueDate}T00:00:00.000Z`) : null,
          note: input.note,
          paidBy: user.id,
        },
      });
      await this.account.post(tx, [
        {
          supplierId: supplier.id,
          type: SupplierLedgerType.PAYMENT,
          amount: money(input.amount).negated().toString(),
          label: number,
          refType: 'SupplierPayment',
          refId: payment.id,
        },
      ]);
      await this.audit.log(tx, {
        action: 'SUPPLIER_PAYMENT_CREATED',
        entity: 'SupplierPayment',
        entityId: payment.id,
        after: { number, supplierId: supplier.id, amount: input.amount, mode: input.mode },
      });
      return payment.id;
    });
    return this.get(id);
  }

  /** Input mistake or a cheque that never left: the debt comes back. Never deleted. */
  async cancel(id: string, reason: string, user: CurrentUserInfo): Promise<SupplierPaymentDto> {
    await this.prisma.db.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<
        {
          id: string;
          number: string;
          status: SupplierPaymentStatus;
          amount: Prisma.Decimal;
          supplierId: string;
          mode: PaymentMode;
        }[]
      >`
        SELECT id, number, status, amount, "supplierId", mode FROM supplier_payments
        WHERE id = ${id}::uuid AND "tenantId" = ${tenantContext.requireTenantId()}::uuid
        FOR UPDATE`;
      const p = rows[0];
      if (!p) throw new AppException(ErrorCode.NOT_FOUND, 'Supplier payment not found');
      if (p.status !== SupplierPaymentStatus.VALID) {
        throw new AppException(ErrorCode.SUPPLIER_PAYMENT_NOT_VALID, 'Already cancelled', {
          status: p.status,
        });
      }
      await tx.supplierPayment.update({
        where: { id },
        data: {
          status: SupplierPaymentStatus.CANCELLED,
          cancelReason: reason,
          cancelledBy: user.id,
          cancelledAt: new Date(),
          version: { increment: 1 },
        },
      });
      await this.account.post(tx, [
        {
          supplierId: p.supplierId,
          type: SupplierLedgerType.REVERSAL,
          amount: p.amount.toString(),
          label: p.number,
          reason,
          refType: 'SupplierPayment',
          refId: id,
        },
      ]);
      await this.audit.log(tx, {
        action: 'SUPPLIER_PAYMENT_CANCELLED',
        entity: 'SupplierPayment',
        entityId: id,
        before: { status: p.status },
        after: { reason },
      });
    });
    return this.get(id);
  }

  async get(id: string): Promise<SupplierPaymentDto> {
    const p = await this.prisma.db.supplierPayment.findUnique({
      where: { id },
      include: paymentInclude,
    });
    if (!p) throw new AppException(ErrorCode.NOT_FOUND, 'Supplier payment not found');
    return toDto(p, await this.users([p.paidBy]));
  }

  async list(query: {
    supplierId?: string;
    cursor?: string;
    limit: number;
  }): Promise<{ items: SupplierPaymentDto[]; nextCursor: string | null }> {
    const rows = await this.prisma.db.supplierPayment.findMany({
      where: query.supplierId ? { supplierId: query.supplierId } : {},
      include: paymentInclude,
      orderBy: [{ paidAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const page = rows.slice(0, query.limit);
    const users = await this.users(page.map((p) => p.paidBy));
    return {
      items: page.map((p) => toDto(p, users)),
      nextCursor: rows.length > query.limit ? (page.at(-1)?.id ?? null) : null,
    };
  }

  private async users(
    ids: (string | null)[],
  ): Promise<Map<string, { id: string; fullName: string }>> {
    const unique = [...new Set(ids.filter((u): u is string => !!u))];
    if (unique.length === 0) return new Map();
    const rows = await this.prisma.db.user.findMany({
      where: { id: { in: unique } },
      select: { id: true, fullName: true },
    });
    return new Map(rows.map((u) => [u.id, u]));
  }
}
