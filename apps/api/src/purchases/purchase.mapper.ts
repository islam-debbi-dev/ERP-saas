import { computeTotals, type PurchaseDto, toMoneyString, toQtyString } from '@erp/shared';
import { Prisma } from '../generated/prisma/client';

export const purchaseInclude = {
  supplier: { select: { id: true, name: true } },
  lines: { orderBy: { position: 'asc' }, include: { returnLines: { select: { qtyBase: true } } } },
  returns: { orderBy: { createdAt: 'asc' }, include: { lines: true } },
} satisfies Prisma.PurchaseInclude;

export type PurchaseWithRelations = Prisma.PurchaseGetPayload<{ include: typeof purchaseInclude }>;

export const toIsoDate = (d: Date): string => d.toISOString().slice(0, 10);
export const fromIsoDate = (s: string): Date => new Date(`${s}T00:00:00.000Z`);

export function toPurchaseDto(p: PurchaseWithRelations, assujettiTva: boolean): PurchaseDto {
  const totals = computeTotals(
    p.lines.map((l) => ({
      qty: l.qty.toString(),
      unitPrice: l.unitCost.toString(),
      tvaRate: l.tvaRate.toString(),
    })),
    assujettiTva,
  );
  return {
    id: p.id,
    number: p.number,
    status: p.status,
    supplier: p.supplier,
    documentDate: toIsoDate(p.documentDate),
    supplierRef: p.supplierRef,
    note: p.note,
    totalHt: toMoneyString(p.totalHt.toString()),
    totalTva: toMoneyString(p.totalTva.toString()),
    totalTtc: toMoneyString(p.totalTtc.toString()),
    tvaByRate: totals.tvaByRate.map((r) => ({
      rate: r.rate.toFixed(2),
      baseHt: toMoneyString(r.baseHt),
      tva: toMoneyString(r.tva),
    })),
    paidAmount: toMoneyString(p.paidAmount.toString()),
    version: p.version,
    createdAt: p.createdAt.toISOString(),
    validatedAt: p.validatedAt?.toISOString() ?? null,
    cancelledAt: p.cancelledAt?.toISOString() ?? null,
    lines: p.lines.map((l) => ({
      id: l.id,
      position: l.position,
      productId: l.productId,
      unitId: l.unitId,
      designation: l.designation,
      unitCode: l.unitCode,
      unitName: l.unitName,
      factorToBase: toQtyString(l.factorToBase.toString()),
      tvaRate: l.tvaRate.toFixed(2),
      qty: toQtyString(l.qty.toString()),
      qtyBase: toQtyString(l.qtyBase.toString()),
      unitCost: l.unitCost.toFixed(4),
      lineHt: toMoneyString(l.lineHt.toString()),
      returnedQtyBase: toQtyString(
        l.returnLines.reduce((sum, r) => sum.plus(r.qtyBase), new Prisma.Decimal(0)).toString(),
      ),
    })),
    returns: p.returns.map((r) => ({
      id: r.id,
      number: r.number,
      note: r.note,
      totalHt: toMoneyString(r.totalHt.toString()),
      totalTva: toMoneyString(r.totalTva.toString()),
      totalTtc: toMoneyString(r.totalTtc.toString()),
      createdAt: r.createdAt.toISOString(),
      lines: r.lines.map((rl) => ({
        purchaseLineId: rl.purchaseLineId,
        qty: toQtyString(rl.qty.toString()),
        qtyBase: toQtyString(rl.qtyBase.toString()),
        lineHt: toMoneyString(rl.lineHt.toString()),
      })),
    })),
  };
}
