import { Injectable } from '@nestjs/common';
import {
  AdjustmentReason,
  ClientLedgerType,
  computeTotals,
  DocType,
  ErrorCode,
  type InvoiceFromBlsInput,
  isWholeQuantity,
  money,
  type QuickSaleInput,
  qty,
  ReturnDisposition,
  type SaleResultDto,
  type SaleReturnInput,
  SaleStatus,
  SaleType,
  type SaleWarning,
  StockMovementType,
  toBase,
  toMoneyString,
  toQtyString,
  type ValidateSaleInput,
} from '@erp/shared';
import { AuditService } from '../audit/audit.service';
import type { CurrentUserInfo } from '../auth/auth.types';
import { ClientAccountService, type LedgerEntryInput } from '../clients/client-account.service';
import { AppException } from '../common/app-exception';
import { tenantContext } from '../common/tenant-context';
import { DocumentNumberingService } from '../documents/document-numbering.service';
import { Prisma } from '../generated/prisma/client';
import { PaymentsService } from '../payments/payments.service';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import { StockService } from '../stock/stock.service';
import { fromIsoDate } from './sale.mapper';
import { snapshotSaleLines } from './sale-lines';
import { canOverride, lockSale, SalesService } from './sales.service';

const MANAGER_ONLY = 'Only a manager can do this on a validated sale';

/**
 * The steps of a sale that have effects. Each runs in one transaction and takes
 * its locks in the same order everywhere: sale rows (by id), then stock rows (by
 * productId, inside StockService), then client balances (inside
 * ClientAccountService). Same order everywhere = no deadlock, and the second of
 * two concurrent sales waits for the first and sees its result.
 */
@Injectable()
export class SaleWorkflowService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sales: SalesService,
    private readonly stock: StockService,
    private readonly account: ClientAccountService,
    private readonly numbering: DocumentNumberingService,
    private readonly payments: PaymentsService,
    private readonly audit: AuditService,
  ) {}

  async validate(
    id: string,
    input: ValidateSaleInput,
    user: CurrentUserInfo,
  ): Promise<SaleResultDto> {
    const result = await this.prisma.db.$transaction((tx) =>
      this.validateInTx(tx, id, input, user),
    );
    return { sale: await this.sales.get(id), ...result };
  }

  /** Fast sale screen: create and validate in one transaction (refused = nothing saved). */
  async quick(input: QuickSaleInput, user: CurrentUserInfo): Promise<SaleResultDto> {
    const { id, result } = await this.prisma.db.$transaction(async (tx) => {
      const saleId = await this.sales.createDraftInTx(tx, input, user);
      return { id: saleId, result: await this.validateInTx(tx, saleId, input, user) };
    });
    return { sale: await this.sales.get(id), ...result };
  }

  private async validateInTx(
    tx: Tx,
    id: string,
    input: ValidateSaleInput,
    user: CurrentUserInfo,
  ): Promise<{ warnings: SaleWarning[]; change: string }> {
    const current = await lockSale(tx, id);
    if (current.status !== SaleStatus.DRAFT) {
      throw new AppException(ErrorCode.SALE_NOT_DRAFT, 'Only a draft can be validated', {
        status: current.status,
      });
    }
    const sale = await tx.sale.findUniqueOrThrow({
      where: { id },
      include: { lines: { orderBy: { position: 'asc' } } },
    });
    if (sale.lines.length === 0) throw new AppException(ErrorCode.SALE_EMPTY, 'No lines');
    const tenantId = tenantContext.requireTenantId();
    const tenant = await tx.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { assujettiTva: true },
    });
    const client = sale.clientId
      ? await tx.client.findFirst({ where: { id: sale.clientId, deletedAt: null } })
      : null;
    if (sale.clientId && !client) {
      throw new AppException(ErrorCode.VALIDATION_FAILED, 'Unknown client', { field: 'clientId' });
    }

    // Freeze the product as it is today; the price was decided (and checked) on the draft.
    const { lines, totals } = await snapshotSaleLines(
      tx,
      sale.lines.map((l) => ({
        productId: l.productId,
        unitId: l.unitId,
        qty: l.qty.toString(),
        unitPriceHt: l.unitPriceHt.toString(),
        discountPct: l.discountPct.toString(),
      })),
      sale.priceLevelId,
      tenant.assujettiTva,
    );
    // Locks the stock rows first (see the class comment) and gives the CUMP for margins.
    const levels = await this.stock.lockedLevels(
      tx,
      lines.map((l) => l.productId),
    );

    const ttc = totals.totalTtc;
    const handed = money(input.paidAmount);
    const paid = handed.gt(ttc) ? ttc : handed;
    const credit = ttc.minus(paid);
    if (credit.gt(0) && !client) {
      throw new AppException(
        ErrorCode.CLIENT_REQUIRED_FOR_CREDIT,
        'A client is required for a sale on credit',
        { credit: toMoneyString(credit) },
      );
    }

    const warnings: SaleWarning[] = [];
    let creditOverride = false;
    if (client && credit.gt(0)) {
      const check = await this.account.checkCreditLimit(tx, client.id, credit.toString());
      if (check.status !== 'OK') {
        const forced = check.status === 'BLOCK';
        if (forced && !input.forceCredit) {
          throw new AppException(ErrorCode.CREDIT_LIMIT_EXCEEDED, 'Over the credit limit', check);
        }
        if (forced && !canOverride(user)) {
          throw new AppException(ErrorCode.FORBIDDEN, 'Only a manager can sell over the plafond', {
            permission: 'CREDIT_OVERRIDE',
          });
        }
        creditOverride = forced;
        warnings.push({
          kind: 'CREDIT_LIMIT',
          balance: check.balance,
          limit: check.limit ?? '0',
          projected: check.projected,
          forced,
        });
      }
    }

    const number = await this.numbering.next(
      tx,
      tenantId,
      sale.type === SaleType.FACTURE ? DocType.FAC : DocType.BL,
    );
    await tx.saleLine.deleteMany({ where: { saleId: id } });
    await tx.saleLine.createMany({
      data: lines.map((l, i) => ({
        ...l,
        // Keep the list price seen when the line was entered (override audit).
        listPriceHt: sale.lines[i]?.listPriceHt?.toString() ?? l.listPriceHt,
        unitCostBase: levels.get(l.productId)?.avg.toString() ?? '0',
        tenantId,
        saleId: id,
      })),
    });
    const moved = await this.stock.applyMovements(
      tx,
      lines.map((l) => ({
        productId: l.productId,
        type: StockMovementType.SALE,
        qtyBase: qty(l.qtyBase).negated().toString(),
        refType: 'Sale',
        refId: id,
        note: number,
      })),
    );
    for (const w of moved.warnings) warnings.push({ kind: 'NEGATIVE_STOCK', ...w });

    if (client) {
      const entries: LedgerEntryInput[] = [];
      if (!ttc.isZero()) {
        entries.push({
          clientId: client.id,
          type: ClientLedgerType.SALE,
          amount: ttc.toString(),
          label: number,
          refType: 'Sale',
          refId: id,
        });
      }
      if (paid.gt(0)) {
        entries.push({
          clientId: client.id,
          type: ClientLedgerType.PAYMENT,
          amount: paid.negated().toString(),
          label: number,
          refType: 'Sale',
          refId: id,
        });
      }
      await this.account.post(tx, entries);
    }
    if (paid.gt(0)) {
      await this.payments.recordForSaleInTx(tx, {
        clientId: client?.id ?? null,
        saleId: id,
        amount: paid.toString(),
        mode: input.paymentMode,
        receivedBy: user.id,
      });
    }

    await tx.sale.update({
      where: { id },
      data: {
        number,
        status: SaleStatus.VALIDATED,
        assujettiTva: tenant.assujettiTva,
        totalHt: totals.totalHt.toString(),
        totalTva: totals.totalTva.toString(),
        totalTtc: ttc.toString(),
        paidAmount: paid.toString(),
        paymentMode: paid.gt(0) ? input.paymentMode : null,
        creditOverride,
        ...(client
          ? {
              clientSnapshot: {
                code: client.code,
                name: client.name,
                phone: client.phone,
                address: client.address,
                wilaya: client.wilaya,
                commune: client.commune,
                rc: client.rc,
                nif: client.nif,
                nis: client.nis,
                ai: client.ai,
              },
            }
          : {}),
        validatedAt: new Date(),
        validatedBy: user.id,
        version: { increment: 1 },
      },
    });
    await this.audit.log(tx, {
      action: 'SALE_VALIDATED',
      entity: 'Sale',
      entityId: id,
      after: {
        number,
        totalTtc: ttc.toString(),
        paid: paid.toString(),
        credit: credit.toString(),
        creditOverride,
      },
    });
    return { warnings, change: toMoneyString(handed.minus(paid)) };
  }

  /**
   * A draft is abandoned. A validated sale is reversed exactly: what is left of the
   * goods comes back (sold minus already returned), and the account gets back what
   * the sale and its payment put on it, so the balance is as before the sale.
   */
  async cancel(id: string, reason: string, user: CurrentUserInfo): Promise<SaleResultDto> {
    await this.prisma.db.$transaction(async (tx) => {
      const current = await lockSale(tx, id);
      if (current.status === SaleStatus.CANCELLED) {
        throw new AppException(ErrorCode.SALE_NOT_VALIDATED, 'Already cancelled');
      }
      const sale = await tx.sale.findUniqueOrThrow({
        where: { id },
        include: {
          lines: { include: { returnLines: { select: { qtyBase: true } } } },
          returns: { select: { id: true } },
          sourceBls: { select: { id: true } },
        },
      });
      if (current.status === SaleStatus.VALIDATED) {
        if (!canOverride(user)) {
          throw new AppException(ErrorCode.FORBIDDEN, MANAGER_ONLY, { permission: 'SALE_CANCEL' });
        }
        if (sale.invoiceId) {
          throw new AppException(ErrorCode.SALE_INVOICED, 'Cancel the facture first', {
            invoiceId: sale.invoiceId,
          });
        }
        const grouped = sale.sourceBls.length > 0;
        if (grouped) {
          // The BLs keep their own effects; they can be invoiced again.
          await tx.sale.updateMany({ where: { invoiceId: id }, data: { invoiceId: null } });
        } else {
          const back = sale.lines
            .map((l) => ({
              line: l,
              remaining: qty(l.qtyBase.toString()).minus(
                l.returnLines.reduce((s, r) => s.plus(r.qtyBase.toString()), qty(0)),
              ),
            }))
            .filter((r) => r.remaining.gt(0));
          await this.stock.applyMovements(
            tx,
            back.map((r) => ({
              productId: r.line.productId,
              type: StockMovementType.SALE_RETURN,
              qtyBase: r.remaining.toString(),
              // Back at the cost it left with, so the CUMP is as if it never left.
              unitCost: r.line.unitCostBase.toString(),
              refType: 'Sale',
              refId: id,
              note: sale.number,
            })),
          );
        }
        // Payments before the client balance (lock order). Only payments that still
        // count are reversed: a bounced cheque already gave its amount back.
        const paidBack = await this.payments.cancelForSaleInTx(tx, id, user, reason);
        if (sale.clientId) {
          const saleNet = (
            await this.account.netOf(tx, {
              refType: 'Sale',
              refIds: [id],
              types: [ClientLedgerType.SALE],
            })
          ).plus(
            await this.account.netOf(tx, {
              refType: 'SaleReturn',
              refIds: sale.returns.map((r) => r.id),
            }),
          );
          const entries: LedgerEntryInput[] = [saleNet, paidBack.negated()]
            .filter((net) => !net.isZero())
            .map((net) => ({
              clientId: sale.clientId ?? '',
              type: ClientLedgerType.REVERSAL,
              amount: net.negated().toString(),
              label: sale.number ?? '',
              reason,
              refType: 'Sale',
              refId: id,
            }));
          await this.account.post(tx, entries);
        }
      }
      await tx.sale.update({
        where: { id },
        data: {
          status: SaleStatus.CANCELLED,
          cancelReason: reason,
          cancelledAt: new Date(),
          cancelledBy: user.id,
          version: { increment: 1 },
        },
      });
      await this.audit.log(tx, {
        action: 'SALE_CANCELLED',
        entity: 'Sale',
        entityId: id,
        before: { status: current.status, number: sale.number },
        after: { reason },
      });
    });
    return { sale: await this.sales.get(id), warnings: [], change: '0.00' };
  }

  /** Retour client: an avoir for part of a validated sale, at the frozen price. */
  async createReturn(
    id: string,
    input: SaleReturnInput,
    user: CurrentUserInfo,
  ): Promise<SaleResultDto> {
    const warnings: SaleWarning[] = [];
    await this.prisma.db.$transaction(async (tx) => {
      const current = await lockSale(tx, id);
      if (current.status !== SaleStatus.VALIDATED) {
        throw new AppException(ErrorCode.SALE_NOT_VALIDATED, 'Only a validated sale has returns');
      }
      const sale = await tx.sale.findUniqueOrThrow({
        where: { id },
        include: {
          lines: {
            include: {
              returnLines: { select: { qtyBase: true } },
              product: { select: { baseUnit: { select: { allowsDecimal: true } } } },
            },
          },
          _count: { select: { sourceBls: true } },
        },
      });
      if (sale._count.sourceBls > 0) {
        throw new AppException(ErrorCode.VALIDATION_FAILED, 'Return the goods on the BL', {
          rule: 'return_on_source_bl',
        });
      }
      const tenantId = tenantContext.requireTenantId();
      const byId = new Map(sale.lines.map((l) => [l.id, l]));
      const seen = new Set<string>();
      const picked = input.lines.map((r) => {
        const line = byId.get(r.saleLineId);
        if (!line || seen.has(r.saleLineId)) {
          throw new AppException(ErrorCode.VALIDATION_FAILED, 'Unknown or repeated sale line', {
            saleLineId: r.saleLineId,
          });
        }
        seen.add(r.saleLineId);
        // The factor frozen on the line, not the product's current one.
        const qtyBase = toBase(r.qty, line.factorToBase.toString());
        if (!line.product.baseUnit.allowsDecimal && !isWholeQuantity(qtyBase)) {
          throw new AppException(
            ErrorCode.INVALID_PRODUCT_UNITS,
            'This product is counted in whole units',
            { rule: 'whole_quantity_required', productId: line.productId },
          );
        }
        const returned = line.returnLines.reduce((s, x) => s.plus(x.qtyBase.toString()), qty(0));
        const available = qty(line.qtyBase.toString()).minus(returned);
        if (qtyBase.gt(available)) {
          throw new AppException(
            ErrorCode.RETURN_EXCEEDS_SOLD,
            'More than what is left to return',
            {
              saleLineId: line.id,
              availableQtyBase: toQtyString(available),
            },
          );
        }
        return { line, qty: r.qty, qtyBase };
      });
      const totals = computeTotals(
        picked.map((p) => ({
          qty: p.qty,
          unitPrice: p.line.unitPriceHt.toString(),
          tvaRate: p.line.tvaRate.toString(),
          discountPct: p.line.discountPct.toString(),
        })),
        sale.assujettiTva,
      );
      const number = await this.numbering.next(tx, tenantId, DocType.AV);
      const avoir = await tx.saleReturn.create({
        data: {
          tenantId,
          number,
          saleId: id,
          clientId: sale.clientId,
          disposition: input.disposition,
          reason: input.reason,
          totalHt: totals.totalHt.toString(),
          totalTva: totals.totalTva.toString(),
          totalTtc: totals.totalTtc.toString(),
          createdBy: user.id,
        },
      });
      await tx.saleReturnLine.createMany({
        data: picked.map((p, i) => ({
          tenantId,
          returnId: avoir.id,
          saleLineId: p.line.id,
          productId: p.line.productId,
          qty: p.qty,
          qtyBase: p.qtyBase.toString(),
          unitPriceHt: p.line.unitPriceHt.toString(),
          discountPct: p.line.discountPct.toString(),
          tvaRate: p.line.tvaRate.toString(),
          lineHt: totals.lines[i]?.lineHt.toString() ?? '0',
        })),
      });
      // Goods come back at the cost they left with; damaged ones are then written off.
      const moved = await this.stock.applyMovements(
        tx,
        picked.flatMap((p) => [
          {
            productId: p.line.productId,
            type: StockMovementType.SALE_RETURN,
            qtyBase: p.qtyBase.toString(),
            unitCost: p.line.unitCostBase.toString(),
            refType: 'SaleReturn',
            refId: avoir.id,
            note: number,
          },
          ...(input.disposition === ReturnDisposition.DAMAGED
            ? [
                {
                  productId: p.line.productId,
                  type: StockMovementType.ADJUSTMENT,
                  qtyBase: p.qtyBase.negated().toString(),
                  reason: AdjustmentReason.CASSE,
                  refType: 'SaleReturn',
                  refId: avoir.id,
                  note: number,
                },
              ]
            : []),
        ]),
      );
      for (const w of moved.warnings) warnings.push({ kind: 'NEGATIVE_STOCK', ...w });
      if (sale.clientId && totals.totalTtc.gt(0)) {
        await this.account.post(tx, [
          {
            clientId: sale.clientId,
            type: ClientLedgerType.RETURN,
            amount: totals.totalTtc.negated().toString(),
            label: number,
            reason: input.reason,
            refType: 'SaleReturn',
            refId: avoir.id,
          },
        ]);
      }
      await this.audit.log(tx, {
        action: 'SALE_RETURN_CREATED',
        entity: 'Sale',
        entityId: id,
        after: {
          number,
          disposition: input.disposition,
          lines: input.lines,
          totalTtc: totals.totalTtc.toString(),
        },
      });
    });
    return { sale: await this.sales.get(id), warnings, change: '0.00' };
  }

  /**
   * Groups validated BLs of one client in a facture. The BLs already moved the
   * stock and the account, so the facture only adds the TVA rounding difference
   * (TVA is rounded per rate on the facture's summed HT), keeping the account
   * equal to the documents.
   */
  async invoiceFromBls(input: InvoiceFromBlsInput, user: CurrentUserInfo): Promise<SaleResultDto> {
    const id = await this.prisma.db.$transaction(async (tx) => {
      const tenantId = tenantContext.requireTenantId();
      const ids = [...input.saleIds].sort();
      await tx.$queryRaw`
        SELECT id FROM sales
        WHERE "tenantId" = ${tenantId}::uuid
          AND id IN (${Prisma.join(ids.map((x) => Prisma.sql`${x}::uuid`))})
        ORDER BY id
        FOR UPDATE`;
      const bls = await tx.sale.findMany({
        where: { id: { in: ids } },
        include: {
          lines: {
            orderBy: { position: 'asc' },
            include: { returnLines: { select: { qty: true } } },
          },
          returns: { select: { totalTtc: true } },
        },
        orderBy: [{ documentDate: 'asc' }, { number: 'asc' }],
      });
      const first = bls[0];
      const invalid =
        !first ||
        bls.length !== ids.length ||
        bls.some(
          (b) =>
            b.type !== SaleType.BL ||
            b.status !== SaleStatus.VALIDATED ||
            b.invoiceId !== null ||
            b.clientId === null ||
            b.clientId !== first.clientId ||
            b.assujettiTva !== first.assujettiTva,
        );
      if (invalid || !first.clientId) {
        throw new AppException(
          ErrorCode.INVOICE_SOURCES_INVALID,
          'BLs cannot be invoiced together',
          {
            saleIds: input.saleIds,
          },
        );
      }
      const clientId = first.clientId;
      const client = await tx.client.findUniqueOrThrow({ where: { id: clientId } });
      // Bill what the client kept: returns already made on a BL are left out. Return
      // quantities are in the line's unit, so the remainder is exact.
      const sourceLines = bls
        .flatMap((b) => b.lines)
        .map((l) => {
          const kept = qty(l.qty.toString()).minus(
            l.returnLines.reduce((sum, r) => sum.plus(r.qty.toString()), qty(0)),
          );
          return { line: l, kept, keptBase: toBase(kept, l.factorToBase.toString()) };
        })
        .filter((x) => x.kept.gt(0));
      if (sourceLines.length === 0) {
        throw new AppException(ErrorCode.INVOICE_SOURCES_INVALID, 'Everything was returned', {
          saleIds: input.saleIds,
          rule: 'nothing_left_to_invoice',
        });
      }
      const totals = computeTotals(
        sourceLines.map(({ line: l, kept }) => ({
          qty: kept.toString(),
          unitPrice: l.unitPriceHt.toString(),
          tvaRate: l.tvaRate.toString(),
          discountPct: l.discountPct.toString(),
        })),
        first.assujettiTva,
      );
      // What the BLs left on the account: their TTC minus the avoirs already made on them.
      const blTtc = bls.reduce(
        (s, b) =>
          b.returns.reduce(
            (acc, r) => acc.minus(r.totalTtc.toString()),
            s.plus(b.totalTtc.toString()),
          ),
        money(0),
      );
      const blPaid = bls.reduce((s, b) => s.plus(b.paidAmount.toString()), money(0));
      const diff = totals.totalTtc.minus(blTtc);
      const number = await this.numbering.next(tx, tenantId, DocType.FAC);
      const facture = await tx.sale.create({
        data: {
          tenantId,
          type: SaleType.FACTURE,
          number,
          status: SaleStatus.VALIDATED,
          clientId,
          clientSnapshot: {
            code: client.code,
            name: client.name,
            phone: client.phone,
            address: client.address,
            wilaya: client.wilaya,
            commune: client.commune,
            rc: client.rc,
            nif: client.nif,
            nis: client.nis,
            ai: client.ai,
          },
          documentDate: fromIsoDate(input.documentDate),
          priceLevelId: first.priceLevelId,
          assujettiTva: first.assujettiTva,
          totalHt: totals.totalHt.toString(),
          totalTva: totals.totalTva.toString(),
          totalTtc: totals.totalTtc.toString(),
          paidAmount: (blPaid.gt(totals.totalTtc) ? totals.totalTtc : blPaid).toString(),
          createdBy: user.id,
          validatedBy: user.id,
          validatedAt: new Date(),
        },
      });
      await tx.saleLine.createMany({
        data: sourceLines.map(({ line: l, kept, keptBase }, i) => ({
          tenantId,
          saleId: facture.id,
          position: i + 1,
          productId: l.productId,
          unitId: l.unitId,
          designation: l.designation,
          unitCode: l.unitCode,
          unitName: l.unitName,
          factorToBase: l.factorToBase,
          qty: kept.toString(),
          qtyBase: keptBase.toString(),
          listPriceHt: l.listPriceHt,
          unitPriceHt: l.unitPriceHt,
          discountPct: l.discountPct,
          tvaRate: l.tvaRate,
          lineHt: totals.lines[i]?.lineHt.toString() ?? l.lineHt,
          unitCostBase: l.unitCostBase,
          sourceLineId: l.id,
        })),
      });
      await tx.sale.updateMany({ where: { id: { in: ids } }, data: { invoiceId: facture.id } });
      if (!diff.isZero()) {
        await this.account.post(tx, [
          {
            clientId,
            type: ClientLedgerType.SALE,
            amount: diff.toString(),
            label: number,
            reason: 'TVA rounding',
            refType: 'Sale',
            refId: facture.id,
          },
        ]);
      }
      await this.audit.log(tx, {
        action: 'INVOICE_CREATED_FROM_BLS',
        entity: 'Sale',
        entityId: facture.id,
        after: {
          number,
          bls: bls.map((b) => b.number),
          totalTtc: totals.totalTtc.toString(),
          diff: diff.toString(),
        },
      });
      return facture.id;
    });
    return { sale: await this.sales.get(id), warnings: [], change: '0.00' };
  }
}
