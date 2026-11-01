import { Injectable } from '@nestjs/common';
import {
  allocate,
  allocatedAmount,
  AllocationError,
  type AllocationLine,
  AllocationMethod,
  type AttachPurchaseInput,
  type CreateImportFileInput,
  DocType,
  ErrorCode,
  type ImportCostDto,
  type ImportCostInput,
  ImportCostType,
  type ImportFileDto,
  type ImportFileListQuery,
  type ImportFilePage,
  ImportFileStatus,
  type ImportFileSummaryDto,
  landedUnitCost,
  type LandedCostPreviewDto,
  type LandedCostPreviewLineDto,
  money,
  type Money,
  prorate,
  PurchaseStatus,
  qty,
  type Qty,
  spreadLateCost,
  StockMovementType,
  SupplierLedgerType,
  sum,
  toMoneyString,
  toQtyString,
  type UpdateImportFileInput,
} from '@erp/shared';
import { AuditService } from '../audit/audit.service';
import { AppException } from '../common/app-exception';
import { tenantContext } from '../common/tenant-context';
import { DocumentNumberingService } from '../documents/document-numbering.service';
import { Prisma } from '../generated/prisma/client';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import { convert } from '../purchases/currency';
import { lockImportFile, lockImportFileOpen } from '../purchases/import-file-lock';
import { lockPurchase } from '../purchases/purchases.service';
import { SupplierAccountService } from '../purchases/supplier-account.service';
import { StockService } from '../stock/stock.service';
import { WarehousesService } from '../stock/warehouses.service';

type Db = PrismaService['db'] | Tx;

const fileInclude = {
  purchases: {
    where: { status: { not: 'CANCELLED' } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    include: {
      supplier: { select: { id: true, name: true } },
      _count: { select: { lines: true } },
    },
  },
  costs: {
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    include: {
      supplier: { select: { id: true, name: true } },
      allocations: { select: { amount: true } },
    },
  },
} satisfies Prisma.ImportFileInclude;
type FileWithRelations = Prisma.ImportFileGetPayload<{ include: typeof fileInclude }>;
type CostRow = FileWithRelations['costs'][number];

/** A BR line of the dossier, as the allocation and the stock entry see it. */
interface DossierLine extends AllocationLine {
  purchaseId: string;
  purchaseNumber: string | null;
  warehouseId: string | null;
  reference: string;
  designation: string;
  baseUnitCode: string;
  currency: string;
  valueCurrency: Money | null;
  /** Received minus returned, base unit (late costs). */
  remainingQtyBase: Qty;
  landedUnitCostBase: string | null;
  value: Money;
}

const toIsoDate = (d: Date): string => d.toISOString().slice(0, 10);
const fromIsoDate = (s: string): Date => new Date(`${s}T00:00:00.000Z`);

/**
 * Dossiers d'importation (phase 22, IMPORT_COSTS). A dossier groups the BRs of one
 * shipment and its costs. Its BRs are on the supplier accounts from their validation
 * (IN_TRANSIT) but enter the stock only when the dossier is closed, at the coût de
 * revient: FOB × rate + the allocated costs. Costs that arrive after closing are late
 * costs (COST_ADJUST): the units still on hand take them into the CUMP, the sold part is
 * an écart de coût. Lock order: dossier, its BRs, stock rows, supplier balances.
 */
@Injectable()
export class ImportFilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: DocumentNumberingService,
    private readonly audit: AuditService,
    private readonly stock: StockService,
    private readonly warehouses: WarehousesService,
    private readonly accounts: SupplierAccountService,
  ) {}

  // ---------------------------------------------------------------- reads

  async list(query: ImportFileListQuery): Promise<ImportFilePage> {
    const search = query.search?.trim();
    const rows = await this.prisma.db.importFile.findMany({
      where: {
        ...(query.status ? { status: query.status } : {}),
        ...(search
          ? {
              OR: [
                { number: { contains: search, mode: 'insensitive' } },
                { reference: { contains: search, mode: 'insensitive' } },
                { containerNo: { contains: search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      include: fileInclude,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const page = rows.slice(0, query.limit);
    const assujetti = await this.assujettiTva(this.prisma.db);
    return {
      items: page.map((f) => this.summary(f, assujetti, this.goodsOf(f))),
      nextCursor: rows.length > query.limit ? (page.at(-1)?.id ?? null) : null,
    };
  }

  async get(id: string): Promise<ImportFileDto> {
    return this.read(this.prisma.db, id);
  }

  /**
   * The allocation table: nothing is written. An open dossier is computed with today's
   * costs and regime; a closed one shows what was frozen at closing plus its late costs.
   */
  async preview(id: string): Promise<LandedCostPreviewDto> {
    const db = this.prisma.db;
    const file = await this.load(db, id);
    const assujetti = await this.assujettiTva(db);
    const lines = await this.lines(db, id, file.status === ImportFileStatus.OPEN);
    const costs = file.costs.filter((c) => !c.cancelledAt);
    const problems: LandedCostPreviewDto['problems'] = [];

    const shares = new Map<string, Map<string, Money>>();
    for (const c of costs) {
      if (file.status !== ImportFileStatus.OPEN) {
        const frozen = await db.importCostAllocation.findMany({
          where: { importCostId: c.id },
          select: { purchaseLineId: true, amount: true },
        });
        shares.set(
          c.id,
          new Map(frozen.map((a) => [a.purchaseLineId, money(a.amount.toString())])),
        );
        continue;
      }
      try {
        shares.set(c.id, this.allocateCost(lines, c, assujetti));
      } catch (e) {
        if (!(e instanceof AllocationError)) throw e;
        problems.push({ costId: c.id, code: e.code, details: e.details });
      }
    }

    const cumps = await this.cumps(
      db,
      lines.map((l) => l.productId),
    );
    const previewLines: LandedCostPreviewLineDto[] = lines.map((l) => {
      const lineShares = costs.map((c) => shares.get(c.id)?.get(l.key) ?? money(0));
      // Late costs are not part of the coût de revient at closing (they went to the CUMP).
      const atClosing = costs
        .map((c, i) => (c.isLate ? money(0) : (lineShares[i] ?? money(0))))
        .filter((s) => !s.isZero());
      const landedTotal = l.value.plus(sum(lineShares));
      return {
        purchaseLineId: l.key,
        purchaseNumber: l.purchaseNumber,
        productId: l.productId,
        reference: l.reference,
        designation: l.designation,
        qtyBase: toQtyString(l.qtyBase),
        baseUnitCode: l.baseUnitCode,
        currency: l.currency,
        valueCurrency: l.valueCurrency ? toMoneyString(l.valueCurrency) : null,
        value: toMoneyString(l.value),
        shares: lineShares.map((s) => toMoneyString(s)),
        landedTotal: toMoneyString(landedTotal),
        landedUnitCost:
          l.landedUnitCostBase ??
          (qty(l.qtyBase).gt(0) ? landedUnitCost(l.value, atClosing, l.qtyBase).toFixed(4) : null),
        currentCump: cumps.get(l.productId) ?? '0.0000',
      };
    });
    const totalGoods = sum(lines.map((l) => l.value));
    const totalCosts = sum(costs.map((c) => sum([...(shares.get(c.id)?.values() ?? [])])));
    return {
      status: file.status,
      costs: costs.map((c) => ({
        id: c.id,
        type: c.type,
        label: c.label,
        method: c.method,
        allocated: toMoneyString(
          file.status === ImportFileStatus.OPEN
            ? allocatedAmount(c.amount.toString(), c.tvaAmount.toString(), assujetti)
            : sum([...(shares.get(c.id)?.values() ?? [])]),
        ),
        isLate: c.isLate,
      })),
      lines: previewLines,
      problems,
      totalGoods: toMoneyString(totalGoods),
      totalCosts: toMoneyString(totalCosts),
      totalLanded: toMoneyString(totalGoods.plus(totalCosts)),
    };
  }

  // ---------------------------------------------------------------- dossier

  async create(input: CreateImportFileInput): Promise<ImportFileDto> {
    const id = await this.prisma.db.$transaction(async (tx) => {
      const tenantId = tenantContext.requireTenantId();
      const number = await this.numbering.next(tx, tenantId, DocType.DI);
      const file = await tx.importFile.create({
        data: {
          tenantId,
          number,
          reference: input.reference,
          containerNo: input.containerNo,
          arrivalDate: input.arrivalDate ? fromIsoDate(input.arrivalDate) : null,
          note: input.note,
          createdBy: tenantContext.get()?.userId ?? null,
        },
      });
      await this.audit.log(tx, {
        action: 'IMPORT_FILE_CREATED',
        entity: 'ImportFile',
        entityId: file.id,
        after: { number, ...input },
      });
      return file.id;
    });
    return this.get(id);
  }

  /** Header fields only (reference, container, arrival, note), while OPEN. */
  async update(id: string, input: UpdateImportFileInput): Promise<ImportFileDto> {
    await this.prisma.db.$transaction(async (tx) => {
      const current = await lockImportFileOpen(tx, id);
      if (current.version !== input.version) {
        throw new AppException(ErrorCode.CONFLICT, 'Import file changed since it was read', {
          currentVersion: current.version,
        });
      }
      const before = await tx.importFile.findUniqueOrThrow({ where: { id } });
      await tx.importFile.update({
        where: { id },
        data: {
          reference: input.reference,
          containerNo: input.containerNo,
          arrivalDate: input.arrivalDate ? fromIsoDate(input.arrivalDate) : null,
          note: input.note,
          version: { increment: 1 },
        },
      });
      await this.audit.log(tx, {
        action: 'IMPORT_FILE_UPDATED',
        entity: 'ImportFile',
        entityId: id,
        before: {
          reference: before.reference,
          containerNo: before.containerNo,
          arrivalDate: before.arrivalDate,
          note: before.note,
        },
        after: input,
      });
    });
    return this.get(id);
  }

  /**
   * An open dossier that is abandoned: its draft BRs leave it, its costs are cancelled
   * (their supplier entries reversed). Refused while it has BRs in transit: cancel or
   * keep them first. A closed dossier is never cancelled (returns, adjustments, late costs).
   */
  async cancel(id: string, reason: string): Promise<ImportFileDto> {
    await this.prisma.db.$transaction(async (tx) => {
      const current = await lockImportFileOpen(tx, id);
      const inTransit = await tx.purchase.count({
        where: { importFileId: id, status: PurchaseStatus.IN_TRANSIT },
      });
      if (inTransit > 0) {
        throw new AppException(ErrorCode.PURCHASE_IN_IMPORT_FILE, 'BRs in transit', {
          inTransit,
        });
      }
      await tx.purchase.updateMany({
        where: { importFileId: id, status: PurchaseStatus.DRAFT },
        data: { importFileId: null, version: { increment: 1 } },
      });
      const costs = await tx.importCost.findMany({
        where: { importFileId: id, cancelledAt: null },
      });
      for (const c of costs) await this.reverseCost(tx, c, current.number, reason);
      await tx.importFile.update({
        where: { id },
        data: {
          status: ImportFileStatus.CANCELLED,
          cancelledAt: new Date(),
          cancelledBy: tenantContext.get()?.userId ?? null,
          version: { increment: 1 },
        },
      });
      await this.audit.log(tx, {
        action: 'IMPORT_FILE_CANCELLED',
        entity: 'ImportFile',
        entityId: id,
        before: { status: current.status },
        after: { reason, costsCancelled: costs.length },
      });
    });
    return this.get(id);
  }

  /** A draft BR joins the open dossier (lock order: dossier, then the BR). */
  async attach(id: string, input: AttachPurchaseInput): Promise<ImportFileDto> {
    await this.prisma.db.$transaction(async (tx) => {
      await lockImportFileOpen(tx, id);
      const p = await lockPurchase(tx, input.purchaseId);
      if (p.status !== PurchaseStatus.DRAFT) {
        throw new AppException(ErrorCode.PURCHASE_NOT_DRAFT, 'Only a draft BR can join a dossier', {
          status: p.status,
        });
      }
      if (p.importFileId && p.importFileId !== id) {
        throw new AppException(ErrorCode.PURCHASE_IN_IMPORT_FILE, 'Already in another dossier', {
          importFileId: p.importFileId,
        });
      }
      await tx.purchase.update({
        where: { id: input.purchaseId },
        data: { importFileId: id, version: { increment: 1 } },
      });
      await this.audit.log(tx, {
        action: 'IMPORT_FILE_PURCHASE_ATTACHED',
        entity: 'ImportFile',
        entityId: id,
        after: { purchaseId: input.purchaseId },
      });
    });
    return this.get(id);
  }

  /** Only a draft leaves: a BR in transit is on the supplier account (cancel it instead). */
  async detach(id: string, purchaseId: string): Promise<ImportFileDto> {
    await this.prisma.db.$transaction(async (tx) => {
      await lockImportFileOpen(tx, id);
      const p = await lockPurchase(tx, purchaseId);
      if (p.importFileId !== id) throw new AppException(ErrorCode.NOT_FOUND, 'Not in this dossier');
      if (p.status !== PurchaseStatus.DRAFT) {
        throw new AppException(ErrorCode.PURCHASE_IN_IMPORT_FILE, 'Only a draft BR can leave', {
          status: p.status,
        });
      }
      await tx.purchase.update({
        where: { id: purchaseId },
        data: { importFileId: null, version: { increment: 1 } },
      });
      await this.audit.log(tx, {
        action: 'IMPORT_FILE_PURCHASE_DETACHED',
        entity: 'ImportFile',
        entityId: id,
        after: { purchaseId },
      });
    });
    return this.get(id);
  }

  // ---------------------------------------------------------------- costs

  /** A cost of an open dossier; the transitaire's (or any supplier's) account is posted now. */
  async addCost(id: string, input: ImportCostInput): Promise<ImportFileDto> {
    await this.prisma.db.$transaction(async (tx) => {
      const file = await lockImportFileOpen(tx, id);
      const cost = await this.createCost(tx, id, file.number, input, false);
      await this.audit.log(tx, {
        action: 'IMPORT_COST_ADDED',
        entity: 'ImportFile',
        entityId: id,
        after: { costId: cost.id, ...input },
      });
    });
    return this.get(id);
  }

  /** Cancels a cost of an open dossier and gives its supplier entry back. Never deleted. */
  async cancelCost(id: string, costId: string, reason: string): Promise<ImportFileDto> {
    await this.prisma.db.$transaction(async (tx) => {
      const file = await lockImportFileOpen(tx, id);
      const cost = await tx.importCost.findFirst({ where: { id: costId, importFileId: id } });
      if (!cost) throw new AppException(ErrorCode.NOT_FOUND, 'Cost not found');
      if (cost.cancelledAt) {
        throw new AppException(ErrorCode.IMPORT_COST_NOT_ACTIVE, 'Cost already cancelled');
      }
      await this.reverseCost(tx, cost, file.number, reason);
      await this.audit.log(tx, {
        action: 'IMPORT_COST_CANCELLED',
        entity: 'ImportFile',
        entityId: id,
        after: { costId, reason },
      });
    });
    return this.get(id);
  }

  // ---------------------------------------------------------------- close

  /**
   * Computes the coût de revient of every line and posts the PURCHASE movements at that
   * cost, all in one transaction: the BRs become VALIDATED and the goods sellable.
   * Replays are safe: the Idempotency-Key returns the first answer, and a second close
   * finds the dossier CLOSED (IMPORT_FILE_NOT_OPEN).
   */
  async close(id: string): Promise<ImportFileDto> {
    await this.prisma.db.$transaction(async (tx) => {
      const file = await lockImportFileOpen(tx, id);
      const purchases = await tx.purchase.findMany({
        where: { importFileId: id, status: { not: PurchaseStatus.CANCELLED } },
        select: { id: true },
        orderBy: { id: 'asc' },
      });
      // The dossier's BRs, in id order (the dossier lock already serialises closers).
      const states = [];
      for (const p of purchases) states.push({ id: p.id, ...(await lockPurchase(tx, p.id)) });
      const drafts = states.filter((p) => p.status === PurchaseStatus.DRAFT).map((p) => p.id);
      if (drafts.length > 0) {
        throw new AppException(ErrorCode.PURCHASE_NOT_VALIDATED, 'Validate or detach the drafts', {
          purchaseIds: drafts,
        });
      }
      if (states.length === 0) {
        throw new AppException(ErrorCode.IMPORT_FILE_EMPTY, 'No BR in transit');
      }

      const assujetti = await this.assujettiTva(tx);
      const lines = await this.lines(tx, id, true);
      const costs = await tx.importCost.findMany({
        where: { importFileId: id, cancelledAt: null },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      });
      const tenantId = tenantContext.requireTenantId();
      const sharesByLine = new Map<string, Money[]>();
      for (const c of costs) {
        const shares = this.allocateOrThrow(lines, c, assujetti);
        await tx.importCostAllocation.createMany({
          data: lines.map((l) => {
            const amount = shares.get(l.key) ?? money(0);
            sharesByLine.set(l.key, [...(sharesByLine.get(l.key) ?? []), amount]);
            return {
              tenantId,
              importCostId: c.id,
              purchaseLineId: l.key,
              productId: l.productId,
              amount: amount.toString(),
              stockValue: amount.toString(),
            };
          }),
        });
      }

      const defaultWarehouse = await this.warehouses.defaultId(tx);
      const movements = [];
      for (const l of lines) {
        const unitCost = landedUnitCost(l.value, sharesByLine.get(l.key) ?? [], l.qtyBase);
        await tx.purchaseLine.update({
          where: { id: l.key },
          data: { landedUnitCostBase: unitCost.toString() },
        });
        movements.push({
          productId: l.productId,
          warehouseId: l.warehouseId ?? defaultWarehouse,
          type: StockMovementType.PURCHASE,
          qtyBase: toQtyString(l.qtyBase),
          unitCost: unitCost.toString(),
          refType: 'Purchase',
          refId: l.purchaseId,
          note: l.purchaseNumber,
        });
      }
      await this.stock.applyMovements(tx, movements);
      await tx.purchase.updateMany({
        where: { id: { in: states.map((p) => p.id) } },
        data: { status: PurchaseStatus.VALIDATED, version: { increment: 1 } },
      });
      // A BR before phase 15 has no dépôt; it entered the default one.
      await tx.purchase.updateMany({
        where: { id: { in: states.map((p) => p.id) }, warehouseId: null },
        data: { warehouseId: defaultWarehouse },
      });
      await tx.importFile.update({
        where: { id },
        data: {
          status: ImportFileStatus.CLOSED,
          closedAt: new Date(),
          closedBy: tenantContext.get()?.userId ?? null,
          version: { increment: 1 },
        },
      });
      await this.audit.log(tx, {
        action: 'IMPORT_FILE_CLOSED',
        entity: 'ImportFile',
        entityId: id,
        before: { status: file.status },
        after: {
          purchases: states.length,
          lines: lines.length,
          costs: costs.length,
          totalGoods: toMoneyString(sum(lines.map((l) => l.value))),
          totalCosts: toMoneyString(sum([...sharesByLine.values()].flat())),
        },
      });
    });
    return this.get(id);
  }

  /**
   * A cost that arrives after closing. Its share per product goes into the CUMP for the
   * units still on hand (COST_ADJUST) and the rest is an écart de coût (units already
   * sold: their sales are never changed, AGENTS.md rule 9).
   */
  async lateCost(id: string, input: ImportCostInput): Promise<ImportFileDto> {
    await this.prisma.db.$transaction(async (tx) => {
      const file = await lockImportFile(tx, id);
      if (file.status !== ImportFileStatus.CLOSED) {
        throw new AppException(ErrorCode.IMPORT_FILE_NOT_CLOSED, 'Close the dossier first', {
          status: file.status,
        });
      }
      const assujetti = await this.assujettiTva(tx);
      const lines = await this.lines(tx, id, false);
      if (lines.length === 0) throw new AppException(ErrorCode.IMPORT_FILE_EMPTY, 'No lines');
      const cost = await this.createCost(tx, id, file.number, input, true);
      const shares = this.allocateOrThrow(lines, cost, assujetti);

      // Per product: its share V, what the dossier still accounts for R, stock now Q.
      const byProduct = new Map<string, { lines: DossierLine[]; value: Money; received: Qty }>();
      for (const l of lines) {
        const g = byProduct.get(l.productId) ?? { lines: [], value: money(0), received: qty(0) };
        g.lines.push(l);
        g.value = g.value.plus(shares.get(l.key) ?? money(0));
        g.received = g.received.plus(l.remainingQtyBase);
        byProduct.set(l.productId, g);
      }
      const levels = await this.stock.lockedLevels(tx, [...byProduct.keys()]);
      const tenantId = tenantContext.requireTenantId();
      const defaultWarehouse = await this.warehouses.defaultId(tx);
      const adjustments = [];
      const allocations: Prisma.ImportCostAllocationCreateManyInput[] = [];
      let totalEcart = money(0);
      for (const [productId, g] of byProduct) {
        const level = levels.get(productId);
        const spread = spreadLateCost(g.value, level?.qty ?? qty(0), g.received, level?.avg ?? 0);
        totalEcart = totalEcart.plus(spread.ecart);
        // Each line of the product keeps its share; the stock part is split like the shares.
        const lineStock =
          spread.stockValue.isZero() || g.value.isZero()
            ? new Map<string, Money>()
            : prorate(
                spread.stockValue,
                g.lines.map((l) => ({ key: l.key, basis: (shares.get(l.key) ?? money(0)).abs() })),
              );
        for (const l of g.lines) {
          const amount = shares.get(l.key) ?? money(0);
          const stockValue = lineStock.get(l.key) ?? money(0);
          allocations.push({
            tenantId,
            importCostId: cost.id,
            purchaseLineId: l.key,
            productId,
            amount: amount.toString(),
            stockValue: stockValue.toString(),
            ecart: amount.minus(stockValue).toString(),
          });
        }
        if (!spread.stockValue.isZero()) {
          adjustments.push({
            productId,
            warehouseId: defaultWarehouse,
            type: StockMovementType.COST_ADJUST,
            qtyBase: '0',
            valueDelta: spread.stockValue.toString(),
            refType: 'ImportCost',
            refId: cost.id,
            note: file.number,
          });
        }
      }
      await tx.importCostAllocation.createMany({ data: allocations });
      await this.stock.applyMovements(tx, adjustments);
      await this.audit.log(tx, {
        action: 'IMPORT_LATE_COST_ADDED',
        entity: 'ImportFile',
        entityId: id,
        after: {
          costId: cost.id,
          ...input,
          ecart: toMoneyString(totalEcart),
          adjustedProducts: adjustments.length,
        },
      });
    });
    return this.get(id);
  }

  // ---------------------------------------------------------------- helpers

  private async createCost(
    tx: Tx,
    importFileId: string,
    fileNumber: string,
    input: ImportCostInput,
    isLate: boolean,
  ) {
    if (input.supplierId) {
      const supplier = await tx.supplier.findFirst({
        where: { id: input.supplierId, deletedAt: null },
        select: { currency: true },
      });
      if (!supplier) {
        throw new AppException(ErrorCode.VALIDATION_FAILED, 'Unknown supplier', {
          field: 'supplierId',
        });
      }
      if (supplier.currency !== input.currency) {
        throw new AppException(ErrorCode.CURRENCY_MISMATCH, 'Not the supplier currency', {
          field: 'currency',
          supplierCurrency: supplier.currency,
        });
      }
    }
    const converted = convert(input.currency, input.amount, input.exchangeRate);
    // Import VAT is all TVA; any other cost carries the TVA the user typed.
    const tva = input.type === ImportCostType.TVA_IMPORT ? converted.dzd : money(input.tvaAmount);
    if (tva.gt(converted.dzd)) {
      throw new AppException(ErrorCode.VALIDATION_FAILED, 'TVA above the amount', {
        field: 'tvaAmount',
      });
    }
    const tenantId = tenantContext.requireTenantId();
    const cost = await tx.importCost.create({
      data: {
        tenantId,
        importFileId,
        type: input.type,
        label: input.label,
        supplierId: input.supplierId,
        currency: input.currency,
        amountCurrency: converted.foreign?.toString() ?? null,
        exchangeRate: converted.rate,
        amount: converted.dzd.toString(),
        tvaAmount: tva.toString(),
        method: input.method,
        manualSplit: input.manualSplit ?? Prisma.DbNull,
        isLate,
        createdBy: tenantContext.get()?.userId ?? null,
      },
    });
    if (input.supplierId) {
      await this.accounts.post(tx, [
        {
          supplierId: input.supplierId,
          type: SupplierLedgerType.IMPORT_COST,
          amount: converted.dzd.toString(),
          amountCurrency: converted.foreign?.toString() ?? null,
          label: `${fileNumber} ${input.label ?? input.type}`,
          refType: 'ImportCost',
          refId: cost.id,
        },
      ]);
    }
    return cost;
  }

  private async reverseCost(
    tx: Tx,
    cost: { id: string; supplierId: string | null },
    fileNumber: string,
    reason: string,
  ): Promise<void> {
    await tx.importCost.update({
      where: { id: cost.id },
      data: { cancelledAt: new Date(), cancelledBy: tenantContext.get()?.userId ?? null },
    });
    if (!cost.supplierId) return;
    const net = await this.accounts.netWithCurrency(tx, {
      refType: 'ImportCost',
      refIds: [cost.id],
    });
    if (net.amount.isZero()) return;
    const foreign = (await this.accounts.currencyOf(tx, cost.supplierId)) !== 'DZD';
    await this.accounts.post(tx, [
      {
        supplierId: cost.supplierId,
        type: SupplierLedgerType.REVERSAL,
        amount: net.amount.negated().toString(),
        amountCurrency: foreign ? net.amountCurrency.negated().toString() : null,
        label: fileNumber,
        reason,
        refType: 'ImportCost',
        refId: cost.id,
      },
    ]);
  }

  /** The lines of the dossier's BRs (IN_TRANSIT before closing, VALIDATED after). */
  private async lines(db: Db, importFileId: string, beforeClose: boolean): Promise<DossierLine[]> {
    const assujetti = await this.assujettiTva(db);
    const rows = await db.purchaseLine.findMany({
      where: {
        purchase: {
          importFileId,
          status: beforeClose
            ? { in: [PurchaseStatus.IN_TRANSIT] }
            : { in: [PurchaseStatus.VALIDATED] },
        },
      },
      include: {
        purchase: {
          select: { id: true, number: true, warehouseId: true, currency: true, createdAt: true },
        },
        product: {
          select: {
            reference: true,
            weightKg: true,
            volumeM3: true,
            baseUnit: { select: { code: true } },
          },
        },
        returnLines: { select: { qtyBase: true } },
      },
      orderBy: [{ purchase: { createdAt: 'asc' } }, { purchaseId: 'asc' }, { position: 'asc' }],
    });
    return rows.map((l) => {
      const ht = money(l.lineHt.toString());
      // Under IFU the supplier's TVA is part of the cost, as for any BR (foreign lines have none).
      const value = assujetti ? ht : ht.times(money(l.tvaRate.toString()).div(100).plus(1));
      const returned = l.returnLines.reduce((s, r) => s.plus(r.qtyBase.toString()), qty(0));
      return {
        key: l.id,
        productId: l.productId,
        value,
        qtyBase: l.qtyBase.toString(),
        weightKg: l.product.weightKg?.toString() ?? null,
        volumeM3: l.product.volumeM3?.toString() ?? null,
        purchaseId: l.purchase.id,
        purchaseNumber: l.purchase.number,
        warehouseId: l.purchase.warehouseId,
        reference: l.product.reference,
        designation: l.designation,
        baseUnitCode: l.product.baseUnit.code,
        currency: l.purchase.currency,
        valueCurrency: l.unitCostCurrency
          ? money(l.unitCostCurrency.toString()).times(l.qty.toString())
          : null,
        remainingQtyBase: qty(l.qtyBase.toString()).minus(returned),
        landedUnitCostBase: l.landedUnitCostBase?.toFixed(4) ?? null,
      };
    });
  }

  private allocateCost(
    lines: DossierLine[],
    c: {
      amount: Prisma.Decimal;
      tvaAmount: Prisma.Decimal;
      method: string;
      manualSplit: Prisma.JsonValue;
    },
    assujetti: boolean,
  ): Map<string, Money> {
    const amount = allocatedAmount(c.amount.toString(), c.tvaAmount.toString(), assujetti);
    if (amount.isZero()) return new Map(lines.map((l) => [l.key, money(0)]));
    return allocate(
      lines,
      amount,
      c.method as AllocationMethod,
      c.method === AllocationMethod.MANUAL
        ? (c.manualSplit as Record<string, string> | null)
        : null,
    );
  }

  private allocateOrThrow(
    lines: DossierLine[],
    c: Parameters<ImportFilesService['allocateCost']>[1] & { id: string },
    assujetti: boolean,
  ): Map<string, Money> {
    try {
      return this.allocateCost(lines, c, assujetti);
    } catch (e) {
      if (!(e instanceof AllocationError)) throw e;
      throw new AppException(ErrorCode[e.code], e.message, { costId: c.id, ...e.details });
    }
  }

  private async cumps(db: Db, productIds: string[]): Promise<Map<string, string>> {
    const rows = await db.productStock.findMany({
      where: { productId: { in: [...new Set(productIds)] } },
      select: { productId: true, avgCost: true },
    });
    return new Map(rows.map((r) => [r.productId, r.avgCost.toFixed(4)]));
  }

  private async assujettiTva(db: Db): Promise<boolean> {
    const t = await db.tenant.findUniqueOrThrow({
      where: { id: tenantContext.requireTenantId() },
      select: { assujettiTva: true },
    });
    return t.assujettiTva;
  }

  private async load(db: Db, id: string): Promise<FileWithRelations> {
    const f = await db.importFile.findUnique({ where: { id }, include: fileInclude });
    if (!f) throw new AppException(ErrorCode.NOT_FOUND, 'Import file not found');
    return f;
  }

  private async read(db: Db, id: string): Promise<ImportFileDto> {
    const f = await this.load(db, id);
    const assujetti = await this.assujettiTva(db);
    const goods = await this.goodsValue(db, id);
    const costs = f.costs.map((c) => this.costDto(c, assujetti, f.status));
    const summary = this.summary(f, assujetti, goods);
    return {
      ...summary,
      note: f.note,
      version: f.version,
      purchases: f.purchases.map((p) => ({
        id: p.id,
        number: p.number,
        status: p.status,
        supplier: p.supplier,
        documentDate: toIsoDate(p.documentDate),
        currency: p.currency,
        exchangeRate: p.exchangeRate.toString(),
        totalCurrency: p.totalCurrency ? toMoneyString(p.totalCurrency.toString()) : null,
        totalTtc: toMoneyString(p.totalTtc.toString()),
        lineCount: p._count.lines,
      })),
      costs,
      totalGoods: toMoneyString(goods),
      totalCosts: toMoneyString(sum(costs.filter((c) => !c.cancelledAt).map((c) => c.allocated))),
    };
  }

  private summary(f: FileWithRelations, assujetti: boolean, goods: Money): ImportFileSummaryDto {
    const costs = sum(
      f.costs
        .filter((c) => !c.cancelledAt)
        .map((c) => this.costDto(c, assujetti, f.status).allocated),
    );
    return {
      id: f.id,
      number: f.number,
      status: f.status,
      reference: f.reference,
      containerNo: f.containerNo,
      arrivalDate: f.arrivalDate ? toIsoDate(f.arrivalDate) : null,
      purchaseCount: f.purchases.length,
      totalLanded: toMoneyString(goods.plus(costs)),
      createdAt: f.createdAt.toISOString(),
      closedAt: f.closedAt?.toISOString() ?? null,
    };
  }

  /** Goods value without reading lines (list): the BR totals, HT or TTC by regime. */
  private goodsOf(f: FileWithRelations): Money {
    return sum(f.purchases.map((p) => p.totalHt.toString()));
  }

  private async goodsValue(db: Db, id: string): Promise<Money> {
    const lines = await this.lines(db, id, false);
    const open = lines.length === 0 ? await this.lines(db, id, true) : lines;
    return sum(open.map((l) => l.value));
  }

  private costDto(c: CostRow, assujetti: boolean, status: ImportFileStatus): ImportCostDto {
    // Once allocated (closed dossier, late cost) the frozen shares are the truth.
    const allocated =
      c.allocations.length > 0 || status !== ImportFileStatus.OPEN
        ? sum(c.allocations.map((a) => a.amount.toString()))
        : allocatedAmount(c.amount.toString(), c.tvaAmount.toString(), assujetti);
    return {
      id: c.id,
      type: c.type,
      label: c.label,
      supplier: c.supplier,
      currency: c.currency,
      amountCurrency: c.amountCurrency ? toMoneyString(c.amountCurrency.toString()) : null,
      exchangeRate: c.exchangeRate.toString(),
      amount: toMoneyString(c.amount.toString()),
      tvaAmount: toMoneyString(c.tvaAmount.toString()),
      allocated: toMoneyString(allocated),
      method: c.method,
      manualSplit: (c.manualSplit as Record<string, string> | null) ?? null,
      isLate: c.isLate,
      createdAt: c.createdAt.toISOString(),
      cancelledAt: c.cancelledAt?.toISOString() ?? null,
    };
  }
}
