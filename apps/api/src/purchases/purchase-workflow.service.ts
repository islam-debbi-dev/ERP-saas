import { Injectable } from '@nestjs/common';
import {
  computeTotals,
  DocType,
  ErrorCode,
  isWholeQuantity,
  money,
  type PurchaseDto,
  type PurchaseReturnInput,
  PurchaseStatus,
  qty,
  StockMovementType,
  SupplierLedgerType,
  toBase,
  toQtyString,
  type ValidatePurchaseInput,
} from '@erp/shared';
import { AuditService } from '../audit/audit.service';
import { CatalogService } from '../catalog/catalog.service';
import { AppException } from '../common/app-exception';
import { tenantContext } from '../common/tenant-context';
import { DocumentNumberingService } from '../documents/document-numbering.service';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import { StockService } from '../stock/stock.service';
import { baseUnitCost } from '../stock/unit-conversion';
import { WarehousesService } from '../stock/warehouses.service';
import { snapshotLines } from './purchase-lines';
import { lockPurchase, PurchasesService } from './purchases.service';
import { SupplierAccountService } from './supplier-account.service';

/**
 * The steps of a bon de réception that have effects: validation (stock in, CUMP),
 * cancellation (reversing movements) and supplier returns (retour fournisseur).
 * Every one runs in a single transaction with the purchase row locked.
 */
@Injectable()
export class PurchaseWorkflowService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly purchases: PurchasesService,
    private readonly stock: StockService,
    private readonly catalog: CatalogService,
    private readonly numbering: DocumentNumberingService,
    private readonly audit: AuditService,
    private readonly account: SupplierAccountService,
    private readonly warehouses: WarehousesService,
  ) {}

  async validate(id: string, input: ValidatePurchaseInput): Promise<PurchaseDto> {
    await this.prisma.db.$transaction(async (tx) => {
      const current = await lockPurchase(tx, id);
      if (current.status !== PurchaseStatus.DRAFT) {
        throw new AppException(ErrorCode.PURCHASE_NOT_DRAFT, 'Only a draft can be validated', {
          status: current.status,
        });
      }
      const purchase = await tx.purchase.findUniqueOrThrow({
        where: { id },
        include: { lines: true },
      });
      if (purchase.lines.length === 0) throw new AppException(ErrorCode.PURCHASE_EMPTY, 'No lines');
      const tenantId = tenantContext.requireTenantId();
      const assujetti = await this.assujettiTva(tx);

      // Freeze the lines as the products are today.
      const { lines, totals } = await snapshotLines(
        tx,
        purchase.lines.map((l) => ({
          productId: l.productId,
          unitId: l.unitId,
          qty: l.qty.toString(),
          unitCost: l.unitCost.toString(),
        })),
      );
      await tx.purchaseLine.deleteMany({ where: { purchaseId: id } });
      await tx.purchaseLine.createMany({
        data: lines.map((l) => ({ ...l, tenantId, purchaseId: id })),
      });

      // The dépôt chosen on the BR, else the default one.
      const warehouseId = await this.warehouses.resolve(tx, purchase.warehouseId);
      const number = await this.numbering.next(tx, tenantId, DocType.BR);
      await this.stock.applyMovements(
        tx,
        lines.map((l) => ({
          productId: l.productId,
          warehouseId,
          type: StockMovementType.PURCHASE,
          qtyBase: l.qtyBase,
          // Under IFU (not assujetti) purchase TVA cannot be recovered: it is part of the cost.
          unitCost: baseUnitCost(
            assujetti
              ? l.unitCost
              : money(l.unitCost).times(money(l.tvaRate).div(100).plus(1)).toString(),
            l.factorToBase,
          ),
          refType: 'Purchase',
          refId: id,
          note: number,
        })),
      );
      await this.catalog.updatePrices(tx, input.priceUpdates);
      await tx.purchase.update({
        where: { id },
        data: {
          number,
          status: PurchaseStatus.VALIDATED,
          warehouseId,
          totalHt: totals.totalHt.toString(),
          totalTva: totals.totalTva.toString(),
          totalTtc: totals.totalTtc.toString(),
          validatedAt: new Date(),
          validatedBy: tenantContext.get()?.userId ?? null,
          version: { increment: 1 },
        },
      });
      // Dettes fournisseurs (phase 21): the BR as it stores it, minus what was paid on the spot.
      const paid = money(purchase.paidAmount.toString());
      await this.account.post(tx, [
        ...(totals.totalTtc.gt(0)
          ? [
              {
                supplierId: purchase.supplierId,
                type: SupplierLedgerType.PURCHASE,
                amount: totals.totalTtc.toString(),
                label: number,
                refType: 'Purchase',
                refId: id,
              },
            ]
          : []),
        ...(paid.gt(0)
          ? [
              {
                supplierId: purchase.supplierId,
                type: SupplierLedgerType.PAYMENT,
                amount: paid.negated().toString(),
                label: number,
                reason: 'paid_at_reception',
                refType: 'Purchase',
                refId: id,
              },
            ]
          : []),
      ]);
      await this.audit.log(tx, {
        action: 'PURCHASE_VALIDATED',
        entity: 'Purchase',
        entityId: id,
        after: {
          number,
          totalTtc: totals.totalTtc.toString(),
          priceUpdates: input.priceUpdates.length,
        },
      });
    });
    return this.purchases.get(id);
  }

  /**
   * A draft is simply abandoned. A validated BR is reversed with PURCHASE_RETURN
   * movements for what is still received (received minus already returned).
   */
  async cancel(id: string): Promise<PurchaseDto> {
    await this.prisma.db.$transaction(async (tx) => {
      const current = await lockPurchase(tx, id);
      if (current.status === PurchaseStatus.CANCELLED) {
        throw new AppException(ErrorCode.PURCHASE_NOT_VALIDATED, 'Already cancelled');
      }
      if (current.status === PurchaseStatus.VALIDATED) {
        const purchase = await tx.purchase.findUniqueOrThrow({
          where: { id },
          include: { lines: { include: { returnLines: { select: { qtyBase: true } } } } },
        });
        const reversals = purchase.lines
          .map((l) => ({
            productId: l.productId,
            remaining: qty(l.qtyBase.toString()).minus(
              l.returnLines.reduce((sum, r) => sum.plus(r.qtyBase.toString()), qty(0)),
            ),
          }))
          .filter((r) => r.remaining.gt(0));
        // Out of the dépôt that received it (BR before phase 15: the default one).
        const warehouseId = purchase.warehouseId ?? (await this.warehouses.defaultId(tx));
        await this.stock.applyMovements(
          tx,
          reversals.map((r) => ({
            productId: r.productId,
            warehouseId,
            type: StockMovementType.PURCHASE_RETURN,
            qtyBase: r.remaining.negated().toString(),
            refType: 'Purchase',
            refId: id,
            // Language-neutral: the stock card shows notes as-is in every UI language.
            note: purchase.number,
          })),
        );
        // Take back exactly what the BR and its retours still leave on the account.
        const returnIds = (
          await tx.purchaseReturn.findMany({ where: { purchaseId: id }, select: { id: true } })
        ).map((r) => r.id);
        const net = (await this.account.netOf(tx, { refType: 'Purchase', refIds: [id] })).plus(
          await this.account.netOf(tx, { refType: 'PurchaseReturn', refIds: returnIds }),
        );
        if (!net.isZero()) {
          await this.account.post(tx, [
            {
              supplierId: purchase.supplierId,
              type: SupplierLedgerType.REVERSAL,
              amount: net.negated().toString(),
              label: purchase.number ?? '',
              refType: 'Purchase',
              refId: id,
            },
          ]);
        }
      }
      await tx.purchase.update({
        where: { id },
        data: {
          status: PurchaseStatus.CANCELLED,
          cancelledAt: new Date(),
          cancelledBy: tenantContext.get()?.userId ?? null,
          version: { increment: 1 },
        },
      });
      await this.audit.log(tx, {
        action: 'PURCHASE_CANCELLED',
        entity: 'Purchase',
        entityId: id,
        before: { status: current.status },
      });
    });
    return this.purchases.get(id);
  }

  /** Retour fournisseur: returns part of a validated BR, never more than what is left. */
  async createReturn(id: string, input: PurchaseReturnInput): Promise<PurchaseDto> {
    await this.prisma.db.$transaction(async (tx) => {
      const current = await lockPurchase(tx, id);
      if (current.status !== PurchaseStatus.VALIDATED) {
        throw new AppException(
          ErrorCode.PURCHASE_NOT_VALIDATED,
          'Only a validated BR can be returned',
        );
      }
      const purchase = await tx.purchase.findUniqueOrThrow({
        where: { id },
        include: {
          lines: {
            include: {
              returnLines: { select: { qtyBase: true } },
              product: { select: { baseUnit: { select: { allowsDecimal: true } } } },
            },
          },
        },
      });
      const byId = new Map(purchase.lines.map((l) => [l.id, l]));
      const tenantId = tenantContext.requireTenantId();
      const seen = new Set<string>();

      const returnLines = input.lines.map((r) => {
        const line = byId.get(r.purchaseLineId);
        if (!line || seen.has(r.purchaseLineId)) {
          throw new AppException(ErrorCode.VALIDATION_FAILED, 'Unknown or repeated purchase line', {
            purchaseLineId: r.purchaseLineId,
          });
        }
        seen.add(r.purchaseLineId);
        // The factor frozen on the line, not the product's current one.
        const qtyBase = toBase(r.qty, line.factorToBase.toString());
        if (!line.product.baseUnit.allowsDecimal && !isWholeQuantity(qtyBase)) {
          throw new AppException(
            ErrorCode.INVALID_PRODUCT_UNITS,
            'This product is counted in whole units',
            {
              rule: 'whole_quantity_required',
              productId: line.productId,
            },
          );
        }
        const returned = line.returnLines.reduce(
          (sum, x) => sum.plus(x.qtyBase.toString()),
          qty(0),
        );
        const available = qty(line.qtyBase.toString()).minus(returned);
        if (qtyBase.gt(available)) {
          throw new AppException(
            ErrorCode.RETURN_EXCEEDS_RECEIVED,
            'More than what is left to return',
            {
              purchaseLineId: line.id,
              availableQtyBase: toQtyString(available),
            },
          );
        }
        return { line, qty: r.qty, qtyBase };
      });
      const totals = computeTotals(
        returnLines.map((r) => ({
          qty: r.qty,
          unitPrice: r.line.unitCost.toString(),
          tvaRate: r.line.tvaRate.toString(),
        })),
        true,
      );
      const warehouseId = await this.warehouses.resolve(tx, input.warehouseId, () =>
        Promise.resolve(purchase.warehouseId),
      );
      const number = await this.numbering.next(tx, tenantId, DocType.RF);
      const created = await tx.purchaseReturn.create({
        data: {
          tenantId,
          number,
          warehouseId,
          purchaseId: id,
          supplierId: purchase.supplierId,
          note: input.note,
          totalHt: totals.totalHt.toString(),
          totalTva: totals.totalTva.toString(),
          totalTtc: totals.totalTtc.toString(),
          createdBy: tenantContext.get()?.userId ?? null,
        },
      });
      await tx.purchaseReturnLine.createMany({
        data: returnLines.map((r, i) => ({
          tenantId,
          returnId: created.id,
          purchaseLineId: r.line.id,
          productId: r.line.productId,
          qty: r.qty,
          qtyBase: r.qtyBase.toString(),
          unitCost: r.line.unitCost.toString(),
          tvaRate: r.line.tvaRate.toString(),
          lineHt: totals.lines[i]?.lineHt.toString() ?? '0',
        })),
      });
      // Exits never change the CUMP.
      await this.stock.applyMovements(
        tx,
        returnLines.map((r) => ({
          productId: r.line.productId,
          warehouseId,
          type: StockMovementType.PURCHASE_RETURN,
          qtyBase: r.qtyBase.negated().toString(),
          refType: 'PurchaseReturn',
          refId: created.id,
          note: number,
        })),
      );
      if (totals.totalTtc.gt(0)) {
        await this.account.post(tx, [
          {
            supplierId: purchase.supplierId,
            type: SupplierLedgerType.RETURN,
            amount: totals.totalTtc.negated().toString(),
            label: number,
            refType: 'PurchaseReturn',
            refId: created.id,
          },
        ]);
      }
      await this.audit.log(tx, {
        action: 'PURCHASE_RETURN_CREATED',
        entity: 'Purchase',
        entityId: id,
        after: { number, lines: input.lines, totalTtc: totals.totalTtc.toString() },
      });
    });
    return this.purchases.get(id);
  }

  private async assujettiTva(tx: Tx): Promise<boolean> {
    const t = await tx.tenant.findUniqueOrThrow({
      where: { id: tenantContext.requireTenantId() },
      select: { assujettiTva: true },
    });
    return t.assujettiTva;
  }
}
