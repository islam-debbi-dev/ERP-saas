import { Injectable } from '@nestjs/common';
import {
  ErrorCode,
  money,
  type SupplierBalancesDto,
  type SupplierDto,
  type SupplierInput,
  type SupplierLedgerEntryDto,
  type SupplierLedgerPage,
  type SupplierLedgerQuery,
  type SupplierListQuery,
  type SupplierPage,
  type SupplierStatementDto,
  type SupplierStatementQuery,
  toMoneyString,
  type UpdateSupplierInput,
} from '@erp/shared';
import { AuditService } from '../audit/audit.service';
import { algiersRange } from '../common/algiers';
import { AppException } from '../common/app-exception';
import { tenantContext } from '../common/tenant-context';
import { Prisma, type Supplier, type SupplierBalance } from '../generated/prisma/client';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import { ImportCostsGate } from './import-costs-gate';

type SupplierRow = Supplier & { balance: SupplierBalance | null };

function toDto(s: SupplierRow): SupplierDto {
  return {
    id: s.id,
    code: s.code,
    name: s.name,
    phone: s.phone,
    address: s.address,
    rc: s.rc,
    nif: s.nif,
    nis: s.nis,
    ai: s.ai,
    notes: s.notes,
    archivedAt: s.deletedAt?.toISOString() ?? null,
    balance: toMoneyString(s.balance?.balance.toString() ?? '0'),
    currency: s.currency,
    balanceCurrency: toMoneyString(s.balance?.balanceCurrency.toString() ?? '0'),
    hasOpening: s.balance?.hasOpening ?? false,
  };
}

interface LedgerRow {
  id: string;
  type: SupplierLedgerEntryDto['type'];
  amount: Prisma.Decimal;
  currency: string;
  amountCurrency: Prisma.Decimal | null;
  label: string;
  reason: string | null;
  refType: string | null;
  refId: string | null;
  createdBy: string | null;
  createdAt: Date;
  running: Prisma.Decimal;
  runningCurrency: Prisma.Decimal;
}

const ledgerFields = (r: LedgerRow) => ({
  id: r.id,
  type: r.type,
  amount: toMoneyString(r.amount.toString()),
  currency: r.currency,
  amountCurrency: r.amountCurrency ? toMoneyString(r.amountCurrency.toString()) : null,
  label: r.label,
  reason: r.reason,
  refType: r.refType,
  refId: r.refId,
  createdAt: r.createdAt.toISOString(),
  runningBalance: toMoneyString(r.running.toString()),
  runningBalanceCurrency: toMoneyString(r.runningCurrency.toString()),
});

@Injectable()
export class SuppliersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly importCosts: ImportCostsGate,
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
                { code: { contains: search, mode: 'insensitive' } },
                { phone: { contains: search } },
              ],
            }
          : {}),
      },
      include: { balance: true },
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
    const s = await this.prisma.db.supplier.findUnique({
      where: { id },
      include: { balance: true },
    });
    if (!s) throw new AppException(ErrorCode.NOT_FOUND, 'Supplier not found');
    return toDto(s);
  }

  /** Suppliers matched by code for the import (archived ones included, to refuse them). */
  async byCodes(tx: Tx, codes: string[]): Promise<Map<string, SupplierDto>> {
    if (codes.length === 0) return new Map();
    const rows = await tx.supplier.findMany({
      where: { code: { in: codes } },
      include: { balance: true },
    });
    return new Map(rows.map((s) => [s.code ?? '', toDto(s)]));
  }

  async create(input: SupplierInput): Promise<SupplierDto> {
    return this.withCodeErrors(() =>
      this.prisma.db.$transaction(async (tx) => {
        const s = await this.createInTx(tx, input);
        return toDto({ ...s, balance: null });
      }),
    );
  }

  /** Inside the caller's transaction (import). */
  async createInTx(tx: Tx, input: SupplierInput): Promise<Supplier> {
    if (input.currency !== 'DZD') await this.importCosts.require();
    const s = await tx.supplier.create({
      data: { ...input, tenantId: tenantContext.requireTenantId() },
    });
    await this.audit.log(tx, {
      action: 'SUPPLIER_CREATED',
      entity: 'Supplier',
      entityId: s.id,
      after: s,
    });
    return s;
  }

  async update(id: string, input: UpdateSupplierInput): Promise<SupplierDto> {
    return this.withCodeErrors(() =>
      this.prisma.db.$transaction(async (tx) => {
        await this.updateInTx(tx, id, input);
        const after = await tx.supplier.findUniqueOrThrow({
          where: { id },
          include: { balance: true },
        });
        return toDto(after);
      }),
    );
  }

  async updateInTx(tx: Tx, id: string, input: UpdateSupplierInput): Promise<void> {
    const before = await tx.supplier.findFirst({ where: { id, deletedAt: null } });
    if (!before) throw new AppException(ErrorCode.NOT_FOUND, 'Supplier not found');
    if (input.currency !== undefined && input.currency !== before.currency) {
      if (input.currency !== 'DZD') await this.importCosts.require();
      // The two balances must never mix currencies: only a supplier with no account
      // entries and no BR in its old currency can change.
      const [entries, purchases] = await Promise.all([
        tx.supplierLedgerEntry.count({ where: { supplierId: id } }),
        tx.purchase.count({ where: { supplierId: id, status: { not: 'CANCELLED' } } }),
      ]);
      if (entries > 0 || purchases > 0) {
        throw new AppException(ErrorCode.SUPPLIER_CURRENCY_LOCKED, 'Supplier has entries', {
          field: 'currency',
        });
      }
    }
    const after = await tx.supplier.update({ where: { id }, data: input });
    await this.audit.log(tx, {
      action: 'SUPPLIER_UPDATED',
      entity: 'Supplier',
      entityId: id,
      before,
      after,
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

  // ---------------------------------------------------------------- account (phase 21)

  /** The supplier account, newest entry first, each with the balance right after it. */
  async ledger(id: string, query: SupplierLedgerQuery): Promise<SupplierLedgerPage> {
    const supplier = await this.get(id);
    const tenantId = tenantContext.requireTenantId();
    let before = Prisma.empty;
    if (query.cursor) {
      const cursor = await this.prisma.db.supplierLedgerEntry.findFirst({
        where: { id: query.cursor, supplierId: id },
        select: { seq: true },
      });
      if (!cursor) throw new AppException(ErrorCode.VALIDATION_FAILED, 'Unknown cursor');
      before = Prisma.sql`WHERE seq < ${cursor.seq}`;
    }
    const rows = await this.prisma.db.$queryRaw<(LedgerRow & { seq: bigint })[]>`
      SELECT * FROM (
        SELECT id, seq, type, amount, currency, "amountCurrency", label, reason, "refType",
               "refId", "createdBy", "createdAt",
               SUM(amount) OVER (ORDER BY seq) AS running,
               COALESCE(SUM("amountCurrency") OVER (ORDER BY seq), 0) AS "runningCurrency"
        FROM supplier_ledger_entries
        WHERE "tenantId" = ${tenantId}::uuid AND "supplierId" = ${id}::uuid
      ) l ${before}
      ORDER BY seq DESC
      LIMIT ${query.limit + 1}`;
    const page = rows.slice(0, query.limit);
    const users = await this.users(page.map((r) => r.createdBy));
    return {
      balance: supplier.balance,
      currency: supplier.currency,
      balanceCurrency: supplier.balanceCurrency,
      items: page.map((r) => ({
        ...ledgerFields(r),
        createdBy: r.createdBy ? (users.get(r.createdBy) ?? null) : null,
      })),
      nextCursor: rows.length > query.limit ? (page.at(-1)?.id ?? null) : null,
    };
  }

  /** Every supplier with a non-zero account, biggest debt first. */
  async balances(): Promise<SupplierBalancesDto> {
    const rows = await this.prisma.db.supplierBalance.findMany({
      where: { balance: { not: 0 }, supplier: { deletedAt: null } },
      include: { supplier: { select: { id: true, code: true, name: true, phone: true } } },
      orderBy: [{ balance: 'desc' }, { supplierId: 'asc' }],
    });
    const owed = rows.reduce(
      (s, r) => (r.balance.gt(0) ? s.plus(r.balance.toString()) : s),
      money(0),
    );
    return {
      totalOwed: toMoneyString(owed),
      items: rows.map((r) => ({
        supplier: r.supplier,
        balance: toMoneyString(r.balance.toString()),
      })),
    };
  }

  /** Relevé fournisseur: the entries of a period with the balance before and after. */
  async statement(id: string, query: SupplierStatementQuery): Promise<SupplierStatementDto> {
    const supplier = await this.prisma.db.supplier.findUnique({
      where: { id },
      select: { id: true, code: true, name: true, currency: true },
    });
    if (!supplier) throw new AppException(ErrorCode.NOT_FOUND, 'Supplier not found');
    const tenantId = tenantContext.requireTenantId();
    const { start, end } = algiersRange(query.from, query.to);
    const [opening] = await this.prisma.db.$queryRaw<
      { total: Prisma.Decimal | null; totalCurrency: Prisma.Decimal | null }[]
    >`
      SELECT SUM(amount) AS total, SUM("amountCurrency") AS "totalCurrency"
      FROM supplier_ledger_entries
      WHERE "tenantId" = ${tenantId}::uuid AND "supplierId" = ${id}::uuid AND "createdAt" < ${start}`;
    const openingBalance = money(opening?.total?.toString() ?? '0');
    const openingCurrency = money(opening?.totalCurrency?.toString() ?? '0');
    const rows = await this.prisma.db.$queryRaw<LedgerRow[]>`
      SELECT id, type, amount, currency, "amountCurrency", label, reason, "refType", "refId",
             "createdBy", "createdAt",
             ${openingBalance.toString()}::numeric + SUM(amount) OVER (ORDER BY "createdAt", seq) AS running,
             ${openingCurrency.toString()}::numeric
               + COALESCE(SUM("amountCurrency") OVER (ORDER BY "createdAt", seq), 0) AS "runningCurrency"
      FROM supplier_ledger_entries
      WHERE "tenantId" = ${tenantId}::uuid AND "supplierId" = ${id}::uuid
        AND "createdAt" >= ${start} AND "createdAt" < ${end}
      ORDER BY "createdAt", seq`;
    let debit = money(0);
    let credit = money(0);
    const closingCurrency = rows.reduce(
      (s, r) => s.plus(r.amountCurrency?.toString() ?? '0'),
      openingCurrency,
    );
    for (const r of rows) {
      const a = money(r.amount.toString());
      if (a.gt(0)) debit = debit.plus(a);
      else credit = credit.plus(a.abs());
    }
    return {
      supplier,
      from: query.from,
      to: query.to,
      openingBalance: toMoneyString(openingBalance),
      openingBalanceCurrency: toMoneyString(openingCurrency),
      entries: rows.map(ledgerFields),
      closingBalance: toMoneyString(openingBalance.plus(debit).minus(credit)),
      closingBalanceCurrency: toMoneyString(closingCurrency),
      totalDebit: toMoneyString(debit),
      totalCredit: toMoneyString(credit),
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

  private async withCodeErrors<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new AppException(ErrorCode.SUPPLIER_CODE_TAKEN, 'Supplier code already used');
      }
      throw err;
    }
  }
}
