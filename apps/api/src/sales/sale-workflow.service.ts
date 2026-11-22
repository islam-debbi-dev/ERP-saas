import { Injectable } from '@nestjs/common';
import {
  AdjustmentReason,
  type CreateSaleInput,
  ClientLedgerType,
  computeTotals,
  DocType,
  ErrorCode,
  type InvoiceFromBlsInput,
  isWholeQuantity,
  money,
  Permission,
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
  computeTimbre,
  freeToReturn,
  type GeoCheckResultDto,
  GeoRefType,
  Role,
  partWeightKg,
} from '@erp/shared';
import { AuditService } from '../audit/audit.service';
import type { CurrentUserInfo } from '../auth/auth.types';
import { requirePermission } from '../auth/permissions';
import { ClientAccountService, type LedgerEntryInput } from '../clients/client-account.service';
import { AppException } from '../common/app-exception';
import { freezeLineWeights } from '../common/line-weight';
import { tenantContext } from '../common/tenant-context';
import { DocumentNumberingService } from '../documents/document-numbering.service';
import { GeoCheckService } from '../geo/geo-check.service';
import { Prisma } from '../generated/prisma/client';
import { PaymentsService } from '../payments/payments.service';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import { ScopeService } from '../sales-force/scope.service';
import { StockService } from '../stock/stock.service';
import { timbreRuleOf } from '../tenants/timbre-rule';
import { fromIsoDate } from './sale.mapper';
import { PackagingLedgerService } from '../packaging/packaging-ledger.service';
import { carryPromotions, type PromotionFields, snapshotSaleLines } from './sale-lines';
import { lockSale, SalesService } from './sales.service';
import { WarehousesService } from '../stock/warehouses.service';

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
    private readonly warehouses: WarehousesService,
    private readonly geo: GeoCheckService,
    private readonly packaging: PackagingLedgerService,
    private readonly scope: ScopeService,
  ) {}

  async validate(
    id: string,
    input: ValidateSaleInput,
    user: CurrentUserInfo,
  ): Promise<SaleResultDto> {
    const result = await this.prisma.db.$transaction(async (tx) => {
      await this.sales.assertInScope(tx, user, id);
      const validated = await this.validateInTx(tx, id, input, user);
      return { ...validated, geoCheck: await this.checkGeoInTx(tx, id, input, user) };
    });
    return { sale: await this.sales.get(id), ...result };
  }

  /** Fast sale screen: create and validate in one transaction (refused = nothing saved). */
  async quick(input: QuickSaleInput, user: CurrentUserInfo): Promise<SaleResultDto> {
    const { id, result } = await this.prisma.db.$transaction(async (tx) => {
      const saleId = await this.sales.createDraftInTx(tx, input, user);
      const validated = await this.validateInTx(tx, saleId, input, user);
      const geoCheck = await this.checkGeoInTx(tx, saleId, input, user);
      return { id: saleId, result: { ...validated, geoCheck } };
    });
    return { sale: await this.sales.get(id), ...result };
  }

  /**
   * The seller's position at validation (phase 17), in the sale's transaction: a refused
   * check (note missing, BLOCK mode) undoes the whole validation.
   */
  private async checkGeoInTx(
    tx: Tx,
    saleId: string,
    input: ValidateSaleInput,
    user: CurrentUserInfo,
  ): Promise<GeoCheckResultDto | null> {
    const sale = await tx.sale.findUniqueOrThrow({
      where: { id: saleId },
      select: { number: true, clientId: true },
    });
    return this.geo.checkInTx(tx, {
      refType: GeoRefType.SALE,
      refId: saleId,
      refNumber: sale.number,
      clientId: sale.clientId,
      geo: input.geo,
      user,
    });
  }

  /**
   * The BL of a delivered bon de commande (phase 16), inside the order's transaction: a
   * draft at the order's frozen prices (checked at confirmation, so no override check
   * here) and with the order's seller, then the normal validation (stock, ledger, number, credit check, payment).
   * `collectedBy` is whoever hands over the goods and takes the cash. The deliverer's
   * position is checked on the BL like a van sale (phase 39, A3): a refusal undoes the
   * whole delivery.
   */
  async deliverOrderInTx(
    tx: Tx,
    draft: CreateSaleInput,
    payment: ValidateSaleInput,
    user: CurrentUserInfo,
    order: {
      sellerId: string | null;
      collectedBy: string;
      promotions: PromotionFields[];
    },
  ): Promise<{
    saleId: string;
    warnings: SaleWarning[];
    change: string;
    geoCheck: GeoCheckResultDto | null;
  }> {
    const saleId = await this.sales.createDraftInTx(tx, draft, user, {
      sellerId: order.sellerId,
      promotions: order.promotions,
    });
    const result = await this.validateInTx(tx, saleId, payment, user, {
      collectedBy: order.collectedBy,
    });
    const geoCheck = await this.checkGeoInTx(tx, saleId, payment, user);
    return { saleId, ...result, geoCheck };
  }

  private async validateInTx(
    tx: Tx,
    id: string,
    input: ValidateSaleInput,
    user: CurrentUserInfo,
    opts: { collectedBy?: string } = {},
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
      select: {
        assujettiTva: true,
        timbreEnabled: true,
        timbreThreshold: true,
        timbreTranches: true,
        timbreMin: true,
        timbreMax: true,
      },
    });
    const client = sale.clientId
      ? await tx.client.findFirst({ where: { id: sale.clientId, deletedAt: null } })
      : null;
    if (sale.clientId && !client) {
      throw new AppException(ErrorCode.VALIDATION_FAILED, 'Unknown client', { field: 'clientId' });
    }

    // Freeze the product as it is today; the price and the promotions were decided (and
    // checked) on the draft.
    const { lines: snapped, totals } = await snapshotSaleLines(
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
    const lines = carryPromotions(snapped, sale.lines);
    // The chosen dépôt, else the seller's truck, else MAIN (phase 15).
    const warehouseId = await this.warehouses.forSale(tx, sale.warehouseId, sale.sellerId);
    // Phase 24: only in a dépôt the user works in, and only what that dépôt sells.
    await this.scope.assertWarehouse(tx, user, warehouseId);
    await this.warehouses.assertSells(
      tx,
      user,
      warehouseId,
      sale.lines.map((l) => l.productId),
    );
    // Locks the stock rows first (see the class comment) and gives the CUMP for margins.
    const levels = await this.stock.lockedLevels(
      tx,
      lines.map((l) => l.productId),
    );

    const ttc = totals.totalTtc;
    const handed = money(input.paidAmount);
    // Timbre fiscal: a facture paid in cash owes TTC + timbre (phase 8 decisions).
    const timbre = computeTimbre({
      ttc,
      saleType: sale.type,
      paymentMode: handed.gt(0) ? input.paymentMode : null,
      rule: timbreRuleOf(tenant),
    });
    const due = ttc.plus(timbre);
    const paid = handed.gt(due) ? due : handed;
    const credit = due.minus(paid);
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
        if (forced) {
          requirePermission(user, Permission.CREDIT_OVERRIDE, {
            message: 'You may not sell over the plafond',
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
    await freezeLineWeights(tx, 'sale', id);
    const moved = await this.stock.applyMovements(
      tx,
      lines.map((l) => ({
        productId: l.productId,
        warehouseId,
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
      if (!due.isZero()) {
        entries.push({
          clientId: client.id,
          type: ClientLedgerType.SALE,
          amount: due.toString(),
          label: number,
          refType: 'Sale',
          refId: id,
          warehouseId,
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
          warehouseId,
        });
      }
      await this.account.post(tx, entries);
    }
    // Packaging after the client balance (lock order): given with the goods, empties back.
    warnings.push(
      ...(await this.packaging.postForSaleInTx(
        tx,
        { id, number, clientId: client?.id ?? null, lines },
        input.packagingReturned ?? [],
      )),
    );
    if (paid.gt(0)) {
      await this.payments.recordForSaleInTx(tx, {
        clientId: client?.id ?? null,
        saleId: id,
        amount: paid.toString(),
        mode: input.paymentMode,
        receivedBy: user.id,
        // The money is collected by the sale's seller when he takes it himself.
        collectedBy: opts.collectedBy ?? (user.role === Role.SELLER ? user.id : null),
        warehouseId,
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
        timbre: timbre.toString(),
        paidAmount: paid.toString(),
        paymentMode: paid.gt(0) ? input.paymentMode : null,
        creditOverride,
        ...(client
          ? {
              clientSnapshot: {
                code: client.code,
                name: client.name,
                type: client.type,
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
        warehouseId,
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
        timbre: timbre.toString(),
        paid: paid.toString(),
        credit: credit.toString(),
        creditOverride,
        warehouseId,
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
      await this.sales.assertInScope(tx, user, id);
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
        requirePermission(user, Permission.SALE_CANCEL, {
          message: 'You may not cancel a validated sale',
        });
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
          // Back into the dépôt it left from (sales before phase 15: the default one).
          const warehouseId = sale.warehouseId ?? (await this.warehouses.defaultId(tx));
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
              warehouseId,
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
        const { total: paidBack, ids: paymentIds } = await this.payments.cancelForSaleInTx(
          tx,
          id,
          user,
          reason,
        );
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
          const ledgerWarehouseId = sale.warehouseId ?? (await this.warehouses.defaultId(tx));
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
              warehouseId: ledgerWarehouseId,
            }));
          await this.account.post(tx, entries);
        }
        if (!grouped) await this.packaging.reverseForSaleInTx(tx, sale, reason);
        // Last: the cash balance comes after the client balance, as for a versement.
        await this.payments.reverseCashInTx(tx, paymentIds, reason);
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
      await this.sales.assertInScope(tx, user, id);
      const current = await lockSale(tx, id);
      if (current.status !== SaleStatus.VALIDATED) {
        throw new AppException(ErrorCode.SALE_NOT_VALIDATED, 'Only a validated sale has returns');
      }
      const sale = await tx.sale.findUniqueOrThrow({
        where: { id },
        include: {
          lines: {
            include: {
              returnLines: { select: { qtyBase: true, qty: true } },
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
        if (line.isFree) {
          throw new AppException(
            ErrorCode.FREE_LINE_NOT_EDITABLE,
            'Free units come back with their paid line',
            { saleLineId: line.id },
          );
        }
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
      picked.push(...(await this.freeUnitsBack(tx, sale.lines, picked)));
      const totals = computeTotals(
        picked.map((p) => ({
          qty: p.qty,
          unitPrice: p.line.unitPriceHt.toString(),
          tvaRate: p.line.tvaRate.toString(),
          discountPct: p.line.discountPct.toString(),
        })),
        sale.assujettiTva,
      );
      // Back where it left from unless another dépôt is chosen (the truck brings it back).
      const warehouseId = await this.warehouses.resolve(tx, input.warehouseId, () =>
        Promise.resolve(sale.warehouseId),
      );
      await this.scope.assertWarehouse(tx, user, warehouseId);
      const number = await this.numbering.next(tx, tenantId, DocType.AV);
      const avoir = await tx.saleReturn.create({
        data: {
          tenantId,
          number,
          warehouseId,
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
          // The share of the weight frozen on the sale line (phase 37).
          weightKg: partWeightKg(
            p.line.weightKg?.toString() ?? null,
            p.line.qtyBase.toString(),
            p.qtyBase.toString(),
          ),
        })),
      });
      // Goods come back at the cost they left with; damaged ones are then written off.
      const moved = await this.stock.applyMovements(
        tx,
        picked.flatMap((p) => [
          {
            productId: p.line.productId,
            warehouseId,
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
                  warehouseId,
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
            warehouseId,
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
   * The free units (UG) that come back with a return, in proportion to the paid units
   * returned so far (shared `freeToReturn`, docs/domain.md). Priced 0 like on the sale.
   */
  private async freeUnitsBack<
    L extends {
      id: string;
      position: number;
      isFree: boolean;
      freeOfPosition: number | null;
      unitId: string;
      qty: Prisma.Decimal;
      factorToBase: Prisma.Decimal;
      returnLines: { qty: Prisma.Decimal }[];
    },
  >(
    tx: Tx,
    lines: L[],
    picked: { line: L; qty: string }[],
  ): Promise<{ line: L; qty: string; qtyBase: ReturnType<typeof toBase> }[]> {
    const free = lines.filter((l) => l.isFree && l.freeOfPosition !== null);
    if (free.length === 0) return [];
    const units = await tx.unit.findMany({
      where: { id: { in: [...new Set(free.map((l) => l.unitId))] } },
      select: { id: true, allowsDecimal: true },
    });
    const decimalUnit = new Map(units.map((u) => [u.id, u.allowsDecimal]));
    const returned = (l: L) => l.returnLines.reduce((s, r) => s.plus(r.qty.toString()), qty(0));
    const out: { line: L; qty: string; qtyBase: ReturnType<typeof toBase> }[] = [];
    for (const p of picked) {
      for (const f of free.filter((x) => x.freeOfPosition === p.line.position)) {
        const back = freeToReturn({
          freeSold: f.qty.toString(),
          paidSold: p.line.qty.toString(),
          paidReturnedAfter: returned(p.line).plus(p.qty),
          freeReturnedBefore: returned(f),
          wholeUnits: !(decimalUnit.get(f.unitId) ?? false),
        });
        if (back.lte(0)) continue;
        out.push({
          line: f,
          qty: back.toString(),
          qtyBase: toBase(back, f.factorToBase.toString()),
        });
      }
    }
    return out;
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
      for (const blId of ids) await this.sales.assertInScope(tx, user, blId);
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
      const factureWarehouseId =
        new Set(bls.map((b) => b.warehouseId)).size === 1 && first.warehouseId
          ? first.warehouseId
          : await this.warehouses.defaultId(tx);
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
          // The BLs' seller when they share one; reports count the BLs, not the facture.
          sellerId: new Set(bls.map((b) => b.sellerId)).size === 1 ? first.sellerId : null,
          // No stock effect (the BLs moved it): their dépôt when they share one, else MAIN.
          warehouseId: factureWarehouseId,
          validatedBy: user.id,
          validatedAt: new Date(),
        },
      });
      // A free line points to its paid line by position: positions change on the facture.
      const newPosition = new Map(
        sourceLines.map(({ line: l }, i) => [`${l.saleId}:${l.position}`, i + 1]),
      );
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
          weightKg: partWeightKg(
            l.weightKg?.toString() ?? null,
            l.qtyBase.toString(),
            keptBase.toString(),
          ),
          sourceLineId: l.id,
          isFree: l.isFree,
          promotionId: l.promotionId,
          promotionName: l.promotionName,
          freeOfPosition:
            l.freeOfPosition === null
              ? null
              : (newPosition.get(`${l.saleId}:${l.freeOfPosition}`) ?? null),
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
            warehouseId: factureWarehouseId,
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
