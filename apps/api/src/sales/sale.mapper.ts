import {
  computeTotals,
  type SaleClientSnapshot,
  type SaleDto,
  toMoneyString,
  toQtyString,
} from '@erp/shared';
import { Prisma } from '../generated/prisma/client';

export const saleInclude = {
  client: { select: { id: true, code: true, name: true } },
  invoice: { select: { id: true, number: true } },
  sourceBls: { select: { id: true, number: true }, orderBy: { number: 'asc' } },
  lines: { orderBy: { position: 'asc' }, include: { returnLines: { select: { qtyBase: true } } } },
  returns: { orderBy: { createdAt: 'asc' }, include: { lines: true } },
  payments: { orderBy: { receivedAt: 'asc' } },
  warehouse: { select: { id: true, name: true } },
} satisfies Prisma.SaleInclude;

export type SaleWithRelations = Prisma.SaleGetPayload<{ include: typeof saleInclude }>;

export const toIsoDate = (d: Date): string => d.toISOString().slice(0, 10);
export const fromIsoDate = (s: string): Date => new Date(`${s}T00:00:00.000Z`);

const sumBase = (rows: { qtyBase: Prisma.Decimal }[]): string =>
  toQtyString(rows.reduce((sum, r) => sum.plus(r.qtyBase), new Prisma.Decimal(0)).toString());

export function toSaleDto(
  s: SaleWithRelations,
  seller: { id: string; fullName: string } | null,
): SaleDto {
  const totals = computeTotals(
    s.lines.map((l) => ({
      qty: l.qty.toString(),
      unitPrice: l.unitPriceHt.toString(),
      tvaRate: l.tvaRate.toString(),
      discountPct: l.discountPct.toString(),
    })),
    s.assujettiTva,
  );
  return {
    id: s.id,
    type: s.type,
    number: s.number,
    status: s.status,
    client: s.client,
    clientSnapshot: (s.clientSnapshot as SaleClientSnapshot | null) ?? null,
    documentDate: toIsoDate(s.documentDate),
    note: s.note,
    priceLevelId: s.priceLevelId,
    assujettiTva: s.assujettiTva,
    totalHt: toMoneyString(s.totalHt.toString()),
    totalTva: toMoneyString(s.totalTva.toString()),
    totalTtc: toMoneyString(s.totalTtc.toString()),
    tvaByRate: totals.tvaByRate.map((r) => ({
      rate: r.rate.toFixed(2),
      baseHt: toMoneyString(r.baseHt),
      tva: toMoneyString(r.tva),
    })),
    timbre: toMoneyString(s.timbre.toString()),
    paidAmount: toMoneyString(s.paidAmount.toString()),
    paymentMode: s.paymentMode,
    invoice: s.invoice,
    sourceBls: s.sourceBls,
    creditOverride: s.creditOverride,
    cancelReason: s.cancelReason,
    version: s.version,
    sellerId: s.sellerId,
    seller,
    warehouse: s.warehouse,
    createdAt: s.createdAt.toISOString(),
    validatedAt: s.validatedAt?.toISOString() ?? null,
    cancelledAt: s.cancelledAt?.toISOString() ?? null,
    lines: s.lines.map((l) => ({
      id: l.id,
      position: l.position,
      productId: l.productId,
      unitId: l.unitId,
      designation: l.designation,
      unitCode: l.unitCode,
      unitName: l.unitName,
      factorToBase: toQtyString(l.factorToBase.toString()),
      qty: toQtyString(l.qty.toString()),
      qtyBase: toQtyString(l.qtyBase.toString()),
      listPriceHt: l.listPriceHt ? toMoneyString(l.listPriceHt.toString()) : null,
      unitPriceHt: toMoneyString(l.unitPriceHt.toString()),
      discountPct: l.discountPct.toFixed(2),
      tvaRate: l.tvaRate.toFixed(2),
      lineHt: toMoneyString(l.lineHt.toString()),
      returnedQtyBase: sumBase(l.returnLines),
    })),
    returns: s.returns.map((r) => ({
      id: r.id,
      number: r.number,
      disposition: r.disposition,
      reason: r.reason,
      totalHt: toMoneyString(r.totalHt.toString()),
      totalTva: toMoneyString(r.totalTva.toString()),
      totalTtc: toMoneyString(r.totalTtc.toString()),
      createdAt: r.createdAt.toISOString(),
      lines: r.lines.map((rl) => ({
        saleLineId: rl.saleLineId,
        qty: toQtyString(rl.qty.toString()),
        qtyBase: toQtyString(rl.qtyBase.toString()),
        unitPriceHt: toMoneyString(rl.unitPriceHt.toString()),
        discountPct: rl.discountPct.toFixed(2),
        tvaRate: rl.tvaRate.toFixed(2),
        lineHt: toMoneyString(rl.lineHt.toString()),
      })),
    })),
    payments: s.payments.map((p) => ({
      id: p.id,
      number: p.number,
      amount: toMoneyString(p.amount.toString()),
      mode: p.mode,
      status: p.status,
      receivedAt: p.receivedAt.toISOString(),
    })),
  };
}
