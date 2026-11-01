import { Injectable } from '@nestjs/common';
import {
  ClientType,
  ErrorCode,
  money,
  qty,
  Role,
  SELL_OUT_COLUMNS,
  type SellOutDto,
  type SellOutQuery,
  type SellOutRowDto,
  toMoneyString,
  toQtyString,
} from '@erp/shared';
import ExcelJS from 'exceljs';
import type { CurrentUserInfo } from '../auth/auth.types';
import { algiersRange } from '../common/algiers';
import { AppException } from '../common/app-exception';
import { tenantContext } from '../common/tenant-context';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ScopeService } from '../sales-force/scope.service';
import { algiersMonthOf, countedSale, sellerOf } from './reports-sql';

/** Rows the screen shows; the export has them all. */
export const SELL_OUT_SCREEN_ROWS = 2000;

interface SqlRow {
  month: string;
  brandId: string | null;
  brand: string | null;
  productId: string;
  reference: string;
  designation: string;
  unit: string;
  sectorId: string | null;
  sector: string | null;
  sellerId: string | null;
  seller: string | null;
  clientType: ClientType | null;
  qtySold: Prisma.Decimal;
  qtyFree: Prisma.Decimal;
  qtyReturned: Prisma.Decimal;
  salesHt: Prisma.Decimal;
  returnsHt: Prisma.Decimal;
  freeValueHt: Prisma.Decimal;
}

const SUMMED = [
  'qtySold',
  'qtyFree',
  'qtyReturned',
  'qtyNet',
  'salesHt',
  'returnsHt',
  'netHt',
  'freeValueHt',
] as const;

/**
 * Sell-out par marque (phase 20): what went out to the clients, by month × brand ×
 * product × sector × seller × client type, in base units and HT. Same counting rules as
 * the sales report (reports-sql.ts): a sale counts in the month it is validated, an
 * avoir in the month it is made, a facture grouping BLs never counts. Free units (UG)
 * and returns have their own columns; free units brought back lower the free columns.
 */
@Injectable()
export class SellOutService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scopes: ScopeService,
  ) {}

  async run(query: SellOutQuery, user: CurrentUserInfo, limit?: number): Promise<SellOutDto> {
    if (![Role.OWNER, Role.MANAGER, Role.SUPERVISOR].includes(user.role as never)) {
      throw new AppException(ErrorCode.FORBIDDEN, 'This report is not available to your role', {
        report: 'sell-out',
      });
    }
    const units = await this.scopes.warehouses(user);
    const scope = {
      tenantId: tenantContext.requireTenantId(),
      sellerIds: await this.scopes.figuresSellerIds(user, { sellerId: query.sellerId }),
      brandId: query.brandId ?? null,
      // Phase 24: the dépôts whose figures he sees.
      warehouseIds: units.statsWarehouseIds,
      defaultWarehouseId: units.defaultWarehouseId,
    };
    const { start, end } = algiersRange(query.from, query.to);
    const filters: Prisma.Sql[] = [];
    if (query.brandId) filters.push(Prisma.sql`p."brandId" = ${query.brandId}::uuid`);
    if (query.sectorId) filters.push(Prisma.sql`c."sectorId" = ${query.sectorId}::uuid`);
    if (query.clientType) filters.push(Prisma.sql`f."clientType" = ${query.clientType}`);
    const where = filters.length
      ? Prisma.sql`WHERE ${Prisma.join(filters, ' AND ')}`
      : Prisma.empty;
    const take = limit === undefined ? Prisma.empty : Prisma.sql`LIMIT ${limit + 1}`;
    // The client type frozen at validation when there is one (phase 14), else today's.
    const clientType = Prisma.raw(`COALESCE(s."clientSnapshot"->>'type', c0.type::text)`);
    const rows = await this.prisma.db.$queryRaw<SqlRow[]>`
      WITH f AS (
        SELECT ${algiersMonthOf('s."validatedAt"')} AS month, l."productId", s."clientId",
               ${sellerOf()} AS seller, ${clientType} AS "clientType",
               CASE WHEN l."isFree" THEN 0 ELSE l."qtyBase" END AS "qtySold",
               CASE WHEN l."isFree" THEN l."qtyBase" ELSE 0 END AS "qtyFree",
               0::numeric AS "qtyReturned",
               l."lineHt" AS "salesHt", 0::numeric AS "returnsHt",
               CASE WHEN l."isFree" THEN ROUND(l.qty * COALESCE(l."listPriceHt", 0), 2) ELSE 0 END
                 AS "freeValueHt"
        FROM sale_lines l
        JOIN sales s ON s.id = l."saleId"
        LEFT JOIN clients c0 ON c0.id = s."clientId"
        WHERE l."tenantId" = ${scope.tenantId}::uuid AND ${countedSale(scope)}
          AND s."validatedAt" >= ${start} AND s."validatedAt" < ${end}
        UNION ALL
        SELECT ${algiersMonthOf('r."createdAt"')}, rl."productId", s."clientId", ${sellerOf()},
               ${clientType},
               0, CASE WHEN sl."isFree" THEN -rl."qtyBase" ELSE 0 END,
               CASE WHEN sl."isFree" THEN 0 ELSE rl."qtyBase" END,
               0, rl."lineHt",
               CASE WHEN sl."isFree" THEN -ROUND(rl.qty * COALESCE(sl."listPriceHt", 0), 2) ELSE 0 END
        FROM sale_return_lines rl
        JOIN sale_returns r ON r.id = rl."returnId"
        JOIN sale_lines sl ON sl.id = rl."saleLineId"
        JOIN sales s ON s.id = r."saleId"
        LEFT JOIN clients c0 ON c0.id = s."clientId"
        WHERE rl."tenantId" = ${scope.tenantId}::uuid AND ${countedSale(scope)}
          AND r."createdAt" >= ${start} AND r."createdAt" < ${end}
      )
      SELECT f.month, p."brandId"::text AS "brandId", b.name AS brand,
             p.id::text AS "productId", p.reference, p.designation,
             COALESCE(u.name, u.code) AS unit,
             c."sectorId"::text AS "sectorId", sec.name AS sector,
             f.seller::text AS "sellerId", us."fullName" AS seller,
             f."clientType" AS "clientType",
             SUM(f."qtySold") AS "qtySold", SUM(f."qtyFree") AS "qtyFree",
             SUM(f."qtyReturned") AS "qtyReturned", SUM(f."salesHt") AS "salesHt",
             SUM(f."returnsHt") AS "returnsHt", SUM(f."freeValueHt") AS "freeValueHt"
      FROM f
      JOIN products p ON p.id = f."productId"
      JOIN units u ON u.id = p."baseUnitId"
      LEFT JOIN brands b ON b.id = p."brandId"
      LEFT JOIN clients c ON c.id = f."clientId"
      LEFT JOIN sectors sec ON sec.id = c."sectorId"
      LEFT JOIN users us ON us.id = f.seller
      ${where}
      GROUP BY f.month, p."brandId", b.name, p.id, p.reference, p.designation, u.name, u.code,
               c."sectorId", sec.name, f.seller, us."fullName", f."clientType"
      ORDER BY f.month, b.name NULLS LAST, p.reference, sec.name NULLS LAST,
               us."fullName" NULLS LAST, f."clientType" NULLS LAST
      ${take}`;
    const truncated = limit !== undefined && rows.length > limit;
    const list = (truncated ? rows.slice(0, limit) : rows).map(toRow);
    const totals = Object.fromEntries(
      SUMMED.map((k) => {
        const sum = list.reduce((s, r) => s.plus(r[k]), money(0));
        return [k, k.startsWith('qty') ? toQtyString(sum) : toMoneyString(sum)];
      }),
    ) as SellOutDto['totals'];
    return { from: query.from, to: query.to, rows: list, totals, truncated };
  }
}

function toRow(r: SqlRow): SellOutRowDto {
  const sold = qty(r.qtySold.toString());
  const returned = qty(r.qtyReturned.toString());
  const sales = money(r.salesHt.toString());
  const returns = money(r.returnsHt.toString());
  return {
    month: r.month,
    brandId: r.brandId,
    brand: r.brand,
    productId: r.productId,
    reference: r.reference,
    designation: r.designation,
    unit: r.unit,
    sectorId: r.sectorId,
    sector: r.sector,
    sellerId: r.sellerId,
    seller: r.seller,
    clientType: r.clientType,
    qtySold: toQtyString(sold),
    qtyFree: toQtyString(r.qtyFree.toString()),
    qtyReturned: toQtyString(returned),
    qtyNet: toQtyString(sold.minus(returned)),
    salesHt: toMoneyString(sales),
    returnsHt: toMoneyString(returns),
    netHt: toMoneyString(sales.minus(returns)),
    freeValueHt: toMoneyString(r.freeValueHt.toString()),
  };
}

const CLIENT_TYPE_LABELS: Record<ClientType, string> = {
  [ClientType.PARTICULIER]: 'Particulier',
  [ClientType.PROFESSIONNEL]: 'Professionnel',
};

export function sellOutFileName(report: SellOutDto): string {
  return `sell-out-${report.from}-${report.to}.xlsx`;
}

/**
 * One sheet, the fixed headers of SELL_OUT_COLUMNS on the first row and one line per
 * row: no title line and no totals line, so a brand's own tools can read it every month.
 */
export async function buildSellOutXlsx(report: SellOutDto): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Sell-out');
  sheet.addRow(SELL_OUT_COLUMNS.map((c) => c.title)).font = { bold: true };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  for (const r of report.rows) {
    sheet.addRow(
      SELL_OUT_COLUMNS.map((c) => {
        switch (c.key) {
          case 'clientType':
            return r.clientType ? CLIENT_TYPE_LABELS[r.clientType] : 'Comptoir';
          case 'brand':
            return r.brand ?? 'Sans marque';
          case 'sector':
            return r.sector ?? '';
          case 'seller':
            return r.seller ?? '';
          case 'month':
          case 'reference':
          case 'designation':
          case 'unit':
            return r[c.key];
          // Excel cells are floats; the exact values are in the API.
          default:
            return Number(r[c.key]);
        }
      }),
    );
  }
  SELL_OUT_COLUMNS.forEach((c, i) => {
    const column = sheet.getColumn(i + 1);
    column.width = c.key === 'designation' ? 36 : Math.max(12, c.title.length + 2);
    if (c.key.startsWith('qty')) column.numFmt = '#,##0.###';
    else if (c.key.endsWith('Ht')) column.numFmt = '#,##0.00';
  });
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
