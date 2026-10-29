import { Injectable } from '@nestjs/common';
import {
  ErrorCode,
  money,
  type Money,
  Permission,
  type ReportColumn,
  type ReportDto,
  type ReportGroupBy,
  type ReportName,
  type ReportQuery,
  type ReportRow,
  REPORTS_BY_ROLE,
  resolveGroupBy,
  toMoneyString,
  toQtyString,
} from '@erp/shared';
import type { CurrentUserInfo } from '../auth/auth.types';
import { requirePermission } from '../auth/permissions';
import { algiersRange } from '../common/algiers';
import { AppException } from '../common/app-exception';
import { tenantContext } from '../common/tenant-context';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ScopeService } from '../sales-force/scope.service';
import {
  algiersDayOf,
  algiersMonthOf,
  saleDocumentFacts,
  saleLineFacts,
  type Scope,
  teamOfCte,
  within,
} from './reports-sql';

type Cell = string | number | bigint | Prisma.Decimal | null;
type SqlRow = Record<string, Cell>;

interface Spec {
  columns: ReportColumn[];
  link: 'client' | 'product' | null;
  sql: Prisma.Sql;
}

const col = (key: ReportColumn['key'], kind: ReportColumn['kind']): ReportColumn => ({ key, kind });

const PRODUCT_COLUMNS = [col('reference', 'text'), col('designation', 'text'), col('unit', 'text')];

/** Product label columns for an aggregate `f` with a `productId`. */
const PRODUCT_JOIN = Prisma.sql`
  JOIN products p ON p.id = f."productId"
  JOIN units u ON u.id = p."baseUnitId"`;
const PRODUCT_SELECT = Prisma.sql`f."productId" AS key, p.reference, p.designation, COALESCE(u.name, u.code) AS unit`;
const PRODUCT_GROUP = Prisma.sql`f."productId", p.reference, p.designation, u.name, u.code`;

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scopes: ScopeService,
  ) {}

  async run(name: ReportName, query: ReportQuery, user: CurrentUserInfo): Promise<ReportDto> {
    if (!REPORTS_BY_ROLE[user.role].includes(name)) {
      throw new AppException(ErrorCode.FORBIDDEN, 'This report is not available to your role', {
        report: name,
      });
    }
    if (name === 'margin') {
      requirePermission(user, Permission.VIEW_COST_AND_MARGIN, {
        message: 'You may not see costs and margins',
      });
    }
    const groupBy = resolveGroupBy(name, query.groupBy);
    if (!groupBy) {
      throw new AppException(ErrorCode.VALIDATION_FAILED, 'Unknown grouping for this report', {
        field: 'groupBy',
        rule: 'invalid_group_by',
      });
    }
    // Sales force data stays readable when the module is off (phase 13b): no feature check.
    const scope: Scope = {
      tenantId: tenantContext.requireTenantId(),
      sellerIds: await this.scopes.figuresSellerIds(user, query),
      brandId: query.brandId ?? null,
    };
    const { start, end } = algiersRange(query.from, query.to);
    const spec = this.spec(name, groupBy, scope, start, end);
    const raw = await this.prisma.db.$queryRaw<SqlRow[]>(spec.sql);
    const rows = raw.map((r) => toRow(r, spec));
    return {
      name,
      groupBy,
      from: query.from,
      to: query.to,
      columns: spec.columns,
      rows,
      totals: totalsOf(spec.columns, rows),
    };
  }

  private spec(
    name: ReportName,
    groupBy: ReportGroupBy,
    scope: Scope,
    start: Date,
    end: Date,
  ): Spec {
    switch (name) {
      case 'sales':
        if (groupBy === 'product') return salesByProduct(scope, start, end);
        if (groupBy === 'brand') return salesByBrand(scope, start, end);
        return salesByDocument(groupBy, scope, start, end);
      case 'margin':
        return margin(groupBy, scope, start, end);
      case 'stock-movements':
        return stockMovements(groupBy, scope, start, end);
      case 'payments':
        return payments(groupBy, scope, start, end);
      case 'purchases':
        return purchases(groupBy, scope, start, end);
    }
  }
}

// ---------------------------------------------------------------- reports

function salesByDocument(groupBy: ReportGroupBy, scope: Scope, start: Date, end: Date): Spec {
  const values = Prisma.sql`SUM(f.docs) AS count, SUM(f.ht) AS "grossHt", SUM(f."retHt") AS "returnsHt",
    SUM(f.ht - f."retHt") AS "netHt", SUM(f.ttc - f."retTtc") AS "netTtc"`;
  const valueColumns = [
    col('count', 'count'),
    col('grossHt', 'money'),
    col('returnsHt', 'money'),
    col('netHt', 'money'),
    col('netTtc', 'money'),
  ];
  const facts = saleDocumentFacts(scope, start, end);
  switch (groupBy) {
    case 'client':
      return {
        columns: [col('code', 'text'), col('name', 'text'), ...valueColumns],
        link: 'client',
        sql: Prisma.sql`
          SELECT f."clientId" AS key, c.code, c.name, ${values}
          FROM (${facts}) f LEFT JOIN clients c ON c.id = f."clientId"
          GROUP BY f."clientId", c.code, c.name
          ORDER BY "netTtc" DESC, c.name NULLS LAST`,
      };
    case 'seller':
      return {
        columns: [col('user', 'text'), ...valueColumns],
        link: null,
        sql: Prisma.sql`
          SELECT f.seller AS key, us."fullName" AS "user", ${values}
          FROM (${facts}) f LEFT JOIN users us ON us.id = f.seller
          GROUP BY f.seller, us."fullName"
          ORDER BY "netTtc" DESC, us."fullName" NULLS LAST`,
      };
    case 'sector':
      // The client's sector now; the comptoir and unassigned clients are the null row.
      return {
        columns: [col('sector', 'text'), ...valueColumns],
        link: null,
        sql: Prisma.sql`
          SELECT c."sectorId" AS key, se.name AS sector, ${values}
          FROM (${facts}) f LEFT JOIN clients c ON c.id = f."clientId"
          LEFT JOIN sectors se ON se.id = c."sectorId"
          GROUP BY c."sectorId", se.name
          ORDER BY "netTtc" DESC, se.name NULLS LAST`,
      };
    case 'team':
      // One row per supervisor's team (his nearest supervisor for a seller); null = no team.
      return {
        columns: [col('user', 'text'), ...valueColumns],
        link: null,
        sql: Prisma.sql`
          ${teamOfCte(scope.tenantId)}
          SELECT t."teamId" AS key, us."fullName" AS "user", ${values}
          FROM (${facts}) f LEFT JOIN team_of t ON t."userId" = f.seller
          LEFT JOIN users us ON us.id = t."teamId"
          GROUP BY t."teamId", us."fullName"
          ORDER BY "netTtc" DESC, us."fullName" NULLS LAST`,
      };
    default: {
      const month = groupBy === 'month';
      const bucket = month ? algiersMonthOf('f.at') : algiersDayOf('f.at');
      const key = month ? 'month' : 'day';
      return {
        columns: [col(key, month ? 'month' : 'day'), ...valueColumns],
        link: null,
        sql: Prisma.sql`
          SELECT ${bucket} AS key, ${bucket} AS ${Prisma.raw(`"${key}"`)}, ${values}
          FROM (${facts}) f GROUP BY 1 ORDER BY 1`,
      };
    }
  }
}

function salesByProduct(scope: Scope, start: Date, end: Date): Spec {
  return {
    columns: [
      ...PRODUCT_COLUMNS,
      col('count', 'count'),
      col('qty', 'qty'),
      col('grossHt', 'money'),
      col('returnsHt', 'money'),
      col('netHt', 'money'),
    ],
    link: 'product',
    sql: Prisma.sql`
      SELECT ${PRODUCT_SELECT}, COUNT(DISTINCT f."saleId") AS count, SUM(f.qty) AS qty,
             SUM(f.ht) AS "grossHt", SUM(f."retHt") AS "returnsHt", SUM(f.ht - f."retHt") AS "netHt"
      FROM (${saleLineFacts(scope, start, end)}) f ${PRODUCT_JOIN}
      GROUP BY ${PRODUCT_GROUP}
      ORDER BY "netHt" DESC, p.designation`,
  };
}

/** Line level: a document with several brands counts once in each. TTC per line. */
function salesByBrand(scope: Scope, start: Date, end: Date): Spec {
  return {
    columns: [
      col('brand', 'text'),
      col('count', 'count'),
      col('qty', 'qty'),
      col('grossHt', 'money'),
      col('returnsHt', 'money'),
      col('netHt', 'money'),
      col('netTtc', 'money'),
    ],
    link: null,
    sql: Prisma.sql`
      SELECT f."brandId" AS key, b.name AS brand, COUNT(DISTINCT f."saleId") AS count,
             SUM(f.qty) AS qty, SUM(f.ht) AS "grossHt", SUM(f."retHt") AS "returnsHt",
             SUM(f.ht - f."retHt") AS "netHt", SUM(f.ttc - f."retTtc") AS "netTtc"
      FROM (${saleLineFacts(scope, start, end)}) f LEFT JOIN brands b ON b.id = f."brandId"
      GROUP BY f."brandId", b.name
      ORDER BY "netHt" DESC, b.name NULLS LAST`,
  };
}

function margin(groupBy: ReportGroupBy, scope: Scope, start: Date, end: Date): Spec {
  const values = Prisma.sql`SUM(f.ht - f."retHt") AS "netHt", SUM(f.cost) AS cost,
    SUM(f.ht - f."retHt") - SUM(f.cost) AS margin`;
  const valueColumns = [
    col('netHt', 'money'),
    col('cost', 'money'),
    col('margin', 'money'),
    col('marginPct', 'percent'),
  ];
  const facts = saleLineFacts(scope, start, end);
  if (groupBy === 'category') {
    return {
      columns: [col('category', 'text'), ...valueColumns],
      link: null,
      sql: Prisma.sql`
        SELECT p."categoryId" AS key, c.name AS category, ${values}
        FROM (${facts}) f JOIN products p ON p.id = f."productId"
        LEFT JOIN categories c ON c.id = p."categoryId"
        GROUP BY p."categoryId", c.name
        ORDER BY margin DESC, c.name NULLS LAST`,
    };
  }
  return {
    columns: [...PRODUCT_COLUMNS, col('qty', 'qty'), ...valueColumns],
    link: 'product',
    sql: Prisma.sql`
      SELECT ${PRODUCT_SELECT}, SUM(f.qty) AS qty, ${values}
      FROM (${facts}) f ${PRODUCT_JOIN}
      GROUP BY ${PRODUCT_GROUP}
      ORDER BY margin DESC, p.designation`,
  };
}

function stockMovements(groupBy: ReportGroupBy, scope: Scope, start: Date, end: Date): Spec {
  const where = Prisma.sql`m."tenantId" = ${scope.tenantId}::uuid AND ${within('m."createdAt"', start, end)}`;
  if (groupBy === 'product') {
    return {
      columns: [
        ...PRODUCT_COLUMNS,
        col('count', 'count'),
        col('qtyIn', 'qty'),
        col('qtyOut', 'qty'),
        col('qtyNet', 'qty'),
      ],
      link: 'product',
      sql: Prisma.sql`
        SELECT ${PRODUCT_SELECT}, COUNT(*) AS count,
               COALESCE(SUM(f."qtyBase") FILTER (WHERE f."qtyBase" > 0), 0) AS "qtyIn",
               COALESCE(-SUM(f."qtyBase") FILTER (WHERE f."qtyBase" < 0), 0) AS "qtyOut",
               SUM(f."qtyBase") AS "qtyNet"
        FROM stock_movements f ${PRODUCT_JOIN}
        WHERE ${Prisma.sql`f."tenantId" = ${scope.tenantId}::uuid AND ${within('f."createdAt"', start, end)}`}
        GROUP BY ${PRODUCT_GROUP}
        ORDER BY count DESC, p.designation`,
    };
  }
  const bucket = groupBy === 'type' ? Prisma.sql`m.type::text` : algiersDayOf('m."createdAt"');
  const key = groupBy === 'type' ? 'type' : 'day';
  return {
    columns: [
      col(key, groupBy === 'type' ? 'enum' : 'day'),
      col('count', 'count'),
      col('products', 'count'),
    ],
    link: null,
    sql: Prisma.sql`
      SELECT ${bucket} AS key, ${bucket} AS ${Prisma.raw(`"${key}"`)}, COUNT(*) AS count,
             COUNT(DISTINCT m."productId") AS products
      FROM stock_movements m WHERE ${where}
      GROUP BY 1 ORDER BY ${groupBy === 'type' ? Prisma.sql`count DESC` : Prisma.sql`1`}`,
  };
}

function payments(groupBy: ReportGroupBy, scope: Scope, start: Date, end: Date): Spec {
  // Who collected the money (phase 14), or who received it for older versements.
  const collector = Prisma.raw('COALESCE(py."collectedBy", py."receivedBy")');
  const where = Prisma.sql`py."tenantId" = ${scope.tenantId}::uuid AND py.status = 'VALID'
    AND ${within('py."receivedAt"', start, end)}
    ${scope.sellerIds ? Prisma.sql`AND ${collector} = ANY(${scope.sellerIds}::uuid[])` : Prisma.empty}`;
  const values = Prisma.sql`COUNT(*) AS count, SUM(py.amount) AS total`;
  const valueColumns = [col('count', 'count'), col('total', 'money')];
  if (groupBy === 'user') {
    return {
      columns: [col('user', 'text'), ...valueColumns],
      link: null,
      sql: Prisma.sql`
        SELECT ${collector} AS key, us."fullName" AS "user", ${values}
        FROM payments py LEFT JOIN users us ON us.id = ${collector}
        WHERE ${where}
        GROUP BY ${collector}, us."fullName"
        ORDER BY total DESC, us."fullName" NULLS LAST`,
    };
  }
  const bucket = groupBy === 'mode' ? Prisma.sql`py.mode::text` : algiersDayOf('py."receivedAt"');
  const key = groupBy === 'mode' ? 'mode' : 'day';
  return {
    columns: [col(key, groupBy === 'mode' ? 'enum' : 'day'), ...valueColumns],
    link: null,
    sql: Prisma.sql`
      SELECT ${bucket} AS key, ${bucket} AS ${Prisma.raw(`"${key}"`)}, ${values}
      FROM payments py WHERE ${where}
      GROUP BY 1 ORDER BY ${groupBy === 'mode' ? Prisma.sql`total DESC` : Prisma.sql`1`}`,
  };
}

function purchases(groupBy: ReportGroupBy, scope: Scope, start: Date, end: Date): Spec {
  const facts = Prisma.sql`
    SELECT p."validatedAt" AS at, p."supplierId", 1 AS docs, p."totalHt" AS ht, p."totalTtc" AS ttc,
           0::numeric AS "retHt", 0::numeric AS "retTtc"
    FROM purchases p
    WHERE p."tenantId" = ${scope.tenantId}::uuid AND p.status = 'VALIDATED'
      AND ${within('p."validatedAt"', start, end)}
    UNION ALL
    SELECT r."createdAt", r."supplierId", 0, 0, 0, r."totalHt", r."totalTtc"
    FROM purchase_returns r JOIN purchases p ON p.id = r."purchaseId"
    WHERE r."tenantId" = ${scope.tenantId}::uuid AND p.status = 'VALIDATED'
      AND ${within('r."createdAt"', start, end)}`;
  const values = Prisma.sql`SUM(f.docs) AS count, SUM(f.ht) AS "grossHt", SUM(f."retHt") AS "returnsHt",
    SUM(f.ht - f."retHt") AS "netHt", SUM(f.ttc - f."retTtc") AS "netTtc"`;
  const valueColumns = [
    col('count', 'count'),
    col('grossHt', 'money'),
    col('returnsHt', 'money'),
    col('netHt', 'money'),
    col('netTtc', 'money'),
  ];
  if (groupBy === 'supplier') {
    return {
      columns: [col('supplier', 'text'), ...valueColumns],
      link: null,
      sql: Prisma.sql`
        SELECT f."supplierId" AS key, su.name AS supplier, ${values}
        FROM (${facts}) f JOIN suppliers su ON su.id = f."supplierId"
        GROUP BY f."supplierId", su.name
        ORDER BY "netTtc" DESC, su.name`,
    };
  }
  const bucket = algiersDayOf('f.at');
  return {
    columns: [col('day', 'day'), ...valueColumns],
    link: null,
    sql: Prisma.sql`
      SELECT ${bucket} AS key, ${bucket} AS day, ${values}
      FROM (${facts}) f GROUP BY 1 ORDER BY 1`,
  };
}

// ---------------------------------------------------------------- formatting

function asString(v: Cell): string {
  return v === null ? '0' : v.toString();
}

function percent(part: Money, whole: Money): string | null {
  return whole.isZero() ? null : toMoneyString(part.div(whole).times(100));
}

function toRow(r: SqlRow, spec: Spec): ReportRow {
  const key = r.key === null || r.key === undefined ? null : r.key.toString();
  const values: Record<string, string | null> = {};
  for (const c of spec.columns) {
    const v = r[c.key] ?? null;
    switch (c.kind) {
      case 'money':
        values[c.key] = toMoneyString(asString(v));
        break;
      case 'qty':
        values[c.key] = toQtyString(asString(v));
        break;
      case 'count':
        values[c.key] = asString(v);
        break;
      case 'percent':
        values[c.key] = percent(
          money(asString(r.margin ?? null)),
          money(asString(r.netHt ?? null)),
        );
        break;
      default:
        values[c.key] = v === null ? null : v.toString();
    }
  }
  return { key, link: spec.link && key ? { type: spec.link, id: key } : null, values };
}

/** Distinct counts per group do not add up across groups. */
const NOT_SUMMED = new Set(['products']);

/** Money and count columns add up; quantities of different products do not. */
function totalsOf(columns: ReportColumn[], rows: ReportRow[]): Record<string, string> {
  const totals: Record<string, string> = {};
  for (const c of columns) {
    if (NOT_SUMMED.has(c.key)) continue;
    if (c.kind === 'money') {
      totals[c.key] = toMoneyString(
        rows.reduce((s, r) => s.plus(r.values[c.key] ?? '0'), money(0)),
      );
    } else if (c.kind === 'count') {
      totals[c.key] = String(rows.reduce((s, r) => s + Number(r.values[c.key] ?? 0), 0));
    }
  }
  if (columns.some((c) => c.kind === 'percent')) {
    const pct = percent(money(totals.margin ?? '0'), money(totals.netHt ?? '0'));
    if (pct !== null) totals.marginPct = pct;
  }
  return totals;
}
