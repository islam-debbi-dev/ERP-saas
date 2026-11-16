import { type StatDimension, type StatGroupBy, type StatMeasure } from '@erp/shared';
import { Prisma } from '../generated/prisma/client';
import { countedSale, within } from '../reports/reports-sql';

/**
 * The registry of the distribution statistics (phase 37): base facts, measures and
 * dimensions. A new chart is a new entry here, not a new query: `StatsQueryService.run()`
 * turns a list of measures and dimensions into one SQL statement.
 *
 * - A **fact** is one kind of event (a counted sale, a versement, a visit…) as rows with the
 *   same first columns: `at` (instant), `wh` (the truck or dépôt it belongs to, see
 *   `vehicleOfSql`), `"clientId"`, `"productId"`. The tenant is applied inside it.
 * - A **measure** is an aggregate over the rows of one fact. Ratios are not here: they are
 *   derived from two measures after aggregation (`STAT_MEASURES[..].of` in @erp/shared).
 * - A **dimension** is a column the engine adds to every fact that can carry it.
 *
 * To be replaced one day by a daily summary table: only `FACTS[..].rows` reads the business
 * tables, so a summary can feed the same columns without touching a DTO.
 */

export type FactKey =
  | 'sales'
  | 'saleReturns'
  | 'saleLines'
  | 'saleLineRounding'
  | 'saleDuplicateLines'
  | 'returnLines'
  | 'returnLineRounding'
  | 'payments'
  | 'visits'
  | 'noSale'
  | 'planned'
  | 'orders'
  | 'openOrders'
  | 'deliveries'
  | 'loads'
  | 'damages'
  | 'sessions';

export interface FactCtx {
  tenantId: string;
  /** The period as instants `[start, end)` and as Algiers days, both included. */
  start: Date;
  end: Date;
  from: string;
  to: string;
  /** Today in Algiers: no stop is "planned and missed" on a day that has not come. */
  today: string;
  /**
   * The truck a versement belongs to, on the alias `py` (payments): the joins it needs and
   * the expression (`VehiclesService.vehicleOfPayment`, which reads the driver history).
   */
  vehicleOfPayment: { join: Prisma.Sql; vehicle: Prisma.Sql };
}

/** What the rows of a fact can be grouped or filtered by, besides trucks and time. */
export interface FactHas {
  client: boolean;
  product: boolean;
  reason?: boolean;
}

export interface FactDef {
  has: FactHas;
  rows: (ctx: FactCtx) => Prisma.Sql;
}

const uuid = (v: string) => Prisma.sql`${v}::uuid`;
const counted = (ctx: FactCtx, alias = 's') =>
  countedSale({ tenantId: ctx.tenantId, sellerIds: null, brandId: null }, alias);
const ALGIERS = Prisma.raw(`'Africa/Algiers'`);

/**
 * Which truck (or dépôt) a row of each fact belongs to: the one place that decides it.
 * The engine then reads the truck's type, wilaya and dépôt from this id; a dépôt or
 * nothing means "Sans véhicule / dépôt", never a dropped row.
 * - a sale, its avoirs and its avaries: the dépôt or truck the sale left from;
 * - a versement: its own truck, else the truck its collector drove when it was recorded
 *   (driver history), else its dépôt;
 * - a visit: the truck frozen on it (phase 36);
 * - an order taken: the prévendeur's truck, else the order's dépôt; an order to deliver:
 *   its delivery truck, else its dépôt;
 * - a chargement: the truck it loads; a clôture: the session's truck; a planned stop: the
 *   route's truck.
 */
export function vehicleOfSql(fact: FactKey, ctx: FactCtx): Prisma.Sql {
  switch (fact) {
    case 'sales':
    case 'saleReturns':
    case 'saleLines':
    case 'saleLineRounding':
    case 'saleDuplicateLines':
    case 'returnLines':
    case 'returnLineRounding':
    case 'damages':
      return Prisma.sql`s."warehouseId"`;
    case 'payments':
      return ctx.vehicleOfPayment.vehicle;
    case 'visits':
    case 'noSale':
      return Prisma.sql`v."vehicleId"`;
    case 'planned':
      return Prisma.sql`r."vehicleId"`;
    case 'orders':
      return Prisma.sql`COALESCE(o."vehicleId", o."warehouseId")`;
    case 'openOrders':
    case 'deliveries':
      return Prisma.sql`COALESCE(o."deliveryVehicleId", o."warehouseId")`;
    case 'loads':
      return Prisma.sql`t."toWarehouseId"`;
    case 'sessions':
      return Prisma.sql`ss."warehouseId"`;
  }
}

/** TTC of a line from its HT and its frozen TVA rate (`sale` gives `assujettiTva`). */
const rawLineTtc = (line: string, sale: string) =>
  Prisma.raw(
    `CASE WHEN ${sale}."assujettiTva" THEN ROUND(${line}."lineHt" * (1 + ${line}."tvaRate" / 100), 2) ELSE ${line}."lineHt" END`,
  );

/**
 * What makes the CA by product, brand or family add up to the CA to the centime: the TTC of
 * a document is not always Σ of its lines' TTC (the TVA is rounded per document). The
 * difference of each document, one row for the documents that have one, counted for the
 * product of its last line (`order`: what sorts the lines). `lines` joins the lines (alias
 * `line`), their document (alias `doc`) and its sale `s`.
 */
function roundingRows(
  ctx: FactCtx,
  fact: FactKey,
  on: { lines: Prisma.Sql; line: string; doc: string; order: string; at: string },
  where: Prisma.Sql,
): Prisma.Sql {
  const l = Prisma.raw(on.line);
  const d = Prisma.raw(on.doc);
  const raw = rawLineTtc(on.line, 's');
  return Prisma.sql`
    SELECT x.at, x.wh, x."clientId", x."productId", x.ttc
    FROM (
      SELECT ${Prisma.raw(on.at)} AS at, ${vehicleOfSql(fact, ctx)} AS wh, s."clientId",
             (MAX(ARRAY[${Prisma.raw(on.order)}, ${l}."productId"::text]))[2]::uuid AS "productId",
             ${d}."totalTtc" - SUM(${raw}) AS ttc
      FROM ${on.lines}
      WHERE ${where}
      GROUP BY ${d}.id, s.id
    ) x
    WHERE x.ttc <> 0`;
}

/** A visit that counts: not replaced by a correction. */
const liveVisit = Prisma.sql`NOT EXISTS (SELECT 1 FROM visits c WHERE c."correctsVisitId" = v.id)`;
const algiersDate = (column: string) =>
  Prisma.sql`(${Prisma.raw(column)} AT TIME ZONE ${ALGIERS})::date`;

/** Distinct (truck, client, day) of the visits of the period, with "had a sale or an order". */
function visitedSql(ctx: FactCtx): Prisma.Sql {
  return Prisma.sql`
    SELECT MIN(v."startedAt") AS at, ${vehicleOfSql('visits', ctx)} AS wh, v."clientId",
           ${algiersDate('v."startedAt"')} AS vday,
           bool_or(v.outcome IN ('SALE', 'ORDER')) AS success
    FROM visits v
    WHERE v."tenantId" = ${uuid(ctx.tenantId)} AND ${within('v."startedAt"', ctx.start, ctx.end)}
      AND ${liveVisit}
    GROUP BY 2, 3, 4`;
}

export const FACTS: Record<FactKey, FactDef> = {
  /**
   * Counted sales, one row per document. Sales and avoirs are two facts (not one UNION):
   * each is then a plain scan PostgreSQL can run in parallel.
   */
  sales: {
    has: { client: true, product: false },
    rows: (ctx) => Prisma.sql`
      SELECT s."validatedAt" AS at, ${vehicleOfSql('sales', ctx)} AS wh, s."clientId",
             NULL::uuid AS "productId", s."totalTtc" AS ttc
      FROM sales s
      WHERE ${counted(ctx)} AND ${within('s."validatedAt"', ctx.start, ctx.end)}`,
  },

  /** The avoirs made in the period on sales that still count, one row per avoir. */
  saleReturns: {
    has: { client: true, product: false },
    rows: (ctx) => Prisma.sql`
      SELECT r."createdAt" AS at, ${vehicleOfSql('saleReturns', ctx)} AS wh, s."clientId",
             NULL::uuid AS "productId", r."totalTtc" AS ttc
      FROM sale_returns r JOIN sales s ON s.id = r."saleId"
      WHERE r."tenantId" = ${uuid(ctx.tenantId)} AND ${counted(ctx)}
        AND ${within('r."createdAt"', ctx.start, ctx.end)}`,
  },

  /**
   * The lines of the counted sales: weights, distinct products, and the CA when it is asked
   * per product. `kg` is the frozen weight, else quantity × the product's current weight
   * (`est`), else unknown (`unk`). `ttc` is the line's own TTC: see `saleLineRounding`.
   */
  saleLines: {
    has: { client: true, product: true },
    rows: (ctx) => Prisma.sql`
      SELECT s."validatedAt" AS at, ${vehicleOfSql('saleLines', ctx)} AS wh, s."clientId",
             l."productId", s.id AS "saleId", ${rawLineTtc('l', 's')} AS ttc,
             COALESCE(l."weightKg", ROUND(l."qtyBase" * p0."weightKg", 3)) AS kg,
             (l."weightKg" IS NULL AND p0."weightKg" IS NOT NULL) AS est,
             (l."weightKg" IS NULL AND p0."weightKg" IS NULL) AS unk
      FROM sale_lines l
      JOIN sales s ON s.id = l."saleId"
      JOIN products p0 ON p0.id = l."productId"
      WHERE l."tenantId" = ${uuid(ctx.tenantId)} AND ${counted(ctx)}
        AND ${within('s."validatedAt"', ctx.start, ctx.end)}`,
  },

  /** The centimes between a sale's TTC and Σ of its lines' TTC (see `roundingRows`). */
  saleLineRounding: {
    has: { client: true, product: true },
    rows: (ctx) =>
      roundingRows(
        ctx,
        'saleLineRounding',
        {
          lines: Prisma.sql`sale_lines l JOIN sales s ON s.id = l."saleId"`,
          line: 'l',
          doc: 's',
          order: `lpad(l.position::text, 6, '0')`,
          at: 's."validatedAt"',
        },
        Prisma.sql`l."tenantId" = ${uuid(ctx.tenantId)} AND ${counted(ctx)}
          AND ${within('s."validatedAt"', ctx.start, ctx.end)}`,
      ),
  },

  /**
   * The lines that repeat a product already on the same BL (a free unit under its paid
   * line, a product typed twice): SKU / BL counts distinct products, so they are taken off
   * the number of lines.
   */
  saleDuplicateLines: {
    has: { client: true, product: true },
    rows: (ctx) => Prisma.sql`
      SELECT s."validatedAt" AS at, ${vehicleOfSql('saleDuplicateLines', ctx)} AS wh,
             s."clientId", l."productId"
      FROM sale_lines l
      JOIN sales s ON s.id = l."saleId"
      WHERE l."tenantId" = ${uuid(ctx.tenantId)} AND ${counted(ctx)}
        AND ${within('s."validatedAt"', ctx.start, ctx.end)}
        AND EXISTS (
          SELECT 1 FROM sale_lines e
          WHERE e."tenantId" = l."tenantId" AND e."saleId" = l."saleId"
            AND e."productId" = l."productId" AND (e.position, e.id) < (l.position, l.id))`,
  },

  /** The lines of those avoirs: the weight and (per product) the CA that came back. */
  returnLines: {
    has: { client: true, product: true },
    rows: (ctx) => Prisma.sql`
      SELECT r."createdAt" AS at, ${vehicleOfSql('returnLines', ctx)} AS wh, s."clientId",
             rl."productId", ${rawLineTtc('rl', 's')} AS ttc,
             COALESCE(rl."weightKg", ROUND(rl."qtyBase" * p0."weightKg", 3)) AS kg,
             (rl."weightKg" IS NULL AND p0."weightKg" IS NOT NULL) AS est
      FROM sale_return_lines rl
      JOIN sale_returns r ON r.id = rl."returnId"
      JOIN sales s ON s.id = r."saleId"
      JOIN products p0 ON p0.id = rl."productId"
      WHERE rl."tenantId" = ${uuid(ctx.tenantId)} AND ${counted(ctx)}
        AND ${within('r."createdAt"', ctx.start, ctx.end)}`,
  },

  /** The centimes between an avoir's TTC and Σ of its lines' TTC. */
  returnLineRounding: {
    has: { client: true, product: true },
    rows: (ctx) =>
      roundingRows(
        ctx,
        'returnLineRounding',
        {
          lines: Prisma.sql`sale_return_lines rl JOIN sale_returns d ON d.id = rl."returnId"
            JOIN sales s ON s.id = d."saleId"`,
          line: 'rl',
          doc: 'd',
          order: 'rl.id::text',
          at: 'd."createdAt"',
        },
        Prisma.sql`rl."tenantId" = ${uuid(ctx.tenantId)} AND ${counted(ctx)}
          AND ${within('d."createdAt"', ctx.start, ctx.end)}`,
      ),
  },

  /** Valid versements received in the period. */
  payments: {
    has: { client: true, product: false },
    rows: (ctx) => Prisma.sql`
      SELECT py."receivedAt" AS at, ${vehicleOfSql('payments', ctx)} AS wh, py."clientId",
             NULL::uuid AS "productId", py.amount
      FROM payments py
      ${ctx.vehicleOfPayment.join}
      WHERE py."tenantId" = ${uuid(ctx.tenantId)} AND py.status = 'VALID'
        AND ${within('py."receivedAt"', ctx.start, ctx.end)}`,
  },

  /** One row per (truck, client, day) visited. */
  visits: {
    has: { client: true, product: false },
    rows: (ctx) => Prisma.sql`
      SELECT x.at, x.wh, x."clientId", NULL::uuid AS "productId", x.success
      FROM (${visitedSql(ctx)}) x`,
  },

  /** Visits that ended without a purchase, with their reason. */
  noSale: {
    has: { client: true, product: false, reason: true },
    rows: (ctx) => Prisma.sql`
      SELECT v."startedAt" AS at, ${vehicleOfSql('noSale', ctx)} AS wh, v."clientId",
             NULL::uuid AS "productId", v.reason::text AS reason
      FROM visits v
      WHERE v."tenantId" = ${uuid(ctx.tenantId)} AND ${within('v."startedAt"', ctx.start, ctx.end)}
        AND v.outcome = 'NO_SALE' AND ${liveVisit}`,
  },

  /**
   * One row per (truck, day, client) planned: the stops of the truck's active routes that
   * run that weekday, for each day up to today. A route or a stop counts from the day it
   * was created (routes are not versioned: what was planned before is not known).
   */
  planned: {
    has: { client: true, product: false },
    rows: (ctx) => Prisma.sql`
      SELECT DISTINCT (d.day::timestamp AT TIME ZONE ${ALGIERS}) AS at,
             ${vehicleOfSql('planned', ctx)} AS wh, rs."clientId", NULL::uuid AS "productId",
             (vis."clientId" IS NOT NULL) AS visited, COALESCE(vis.success, FALSE) AS success
      FROM (
        SELECT g::date AS day,
               ((g::date + 1)::timestamp AT TIME ZONE ${ALGIERS}) AS day_end
        FROM generate_series(${ctx.from}::date, LEAST(${ctx.to}::date, ${ctx.today}::date),
                             interval '1 day') g
      ) d
      JOIN routes r ON EXTRACT(DOW FROM d.day)::int = ANY(r.weekdays)
        AND r."tenantId" = ${uuid(ctx.tenantId)} AND r."vehicleId" IS NOT NULL AND r.active
        AND r."createdAt" < d.day_end AND (r."deletedAt" IS NULL OR r."deletedAt" >= d.day_end)
      JOIN route_stops rs ON rs."routeId" = r.id AND rs."createdAt" < d.day_end
      LEFT JOIN (${visitedSql(ctx)}) vis
        ON vis.wh = r."vehicleId" AND vis."clientId" = rs."clientId" AND vis.vday = d.day`,
  },

  /** Bons de commande confirmed in the period and not cancelled, by the truck that took them. */
  orders: {
    has: { client: true, product: false },
    rows: (ctx) => Prisma.sql`
      SELECT o."confirmedAt" AS at, ${vehicleOfSql('orders', ctx)} AS wh, o."clientId",
             NULL::uuid AS "productId", o."totalTtc" AS ttc
      FROM orders o
      WHERE o."tenantId" = ${uuid(ctx.tenantId)} AND o.status IN ('CONFIRMED', 'DELIVERED')
        AND ${within('o."confirmedAt"', ctx.start, ctx.end)}`,
  },

  /** Orders confirmed in the period and still to deliver, by delivery truck. */
  openOrders: {
    has: { client: true, product: false },
    rows: (ctx) => Prisma.sql`
      SELECT o."confirmedAt" AS at, ${vehicleOfSql('openOrders', ctx)} AS wh, o."clientId",
             NULL::uuid AS "productId"
      FROM orders o
      WHERE o."tenantId" = ${uuid(ctx.tenantId)} AND o.status = 'CONFIRMED'
        AND ${within('o."confirmedAt"', ctx.start, ctx.end)}`,
  },

  /**
   * The lines of the orders confirmed in the period that are delivered or cancelled:
   * ordered and delivered quantities in base units, the delivered one capped at the
   * ordered one line by line (a cancelled order delivered nothing).
   */
  deliveries: {
    has: { client: true, product: true },
    rows: (ctx) => Prisma.sql`
      SELECT o."confirmedAt" AS at, ${vehicleOfSql('deliveries', ctx)} AS wh, o."clientId",
             ol."productId", ol."qtyBase" AS ordered,
             CASE WHEN o.status = 'DELIVERED'
               THEN ROUND(LEAST(GREATEST(COALESCE(ol."qtyDelivered", 0), 0), ol.qty) * ol."factorToBase", 3)
               ELSE 0 END AS delivered
      FROM order_lines ol JOIN orders o ON o.id = ol."orderId"
      WHERE ol."tenantId" = ${uuid(ctx.tenantId)} AND o.status IN ('DELIVERED', 'CANCELLED')
        AND ${within('o."confirmedAt"', ctx.start, ctx.end)}`,
  },

  /**
   * Validated chargements (LOAD) of the period, one row per transfer: weight (frozen, else
   * estimated), value at the CUMP of its movements, value in TTC at price level 1 (the
   * price of the base unit, else of the default sale unit brought back to the base unit; a
   * product without a level-1 price counts 0), and the truck's capacity.
   */
  loads: {
    has: { client: false, product: false },
    rows: (ctx) => Prisma.sql`
      SELECT t."validatedAt" AS at, ${vehicleOfSql('loads', ctx)} AS wh, NULL::uuid AS "clientId",
             NULL::uuid AS "productId", x.kg, x.est, x.cost, x.ttc, tw."capacityKg" AS cap
      FROM stock_transfers t
      JOIN warehouses tw ON tw.id = t."toWarehouseId"
      JOIN (
        SELECT l."transferId",
               COALESCE(SUM(COALESCE(l."weightKg", ROUND(l."qtyBase" * p0."weightKg", 3))), 0) AS kg,
               COALESCE(bool_or(l."weightKg" IS NULL AND p0."weightKg" IS NOT NULL), FALSE) AS est,
               ROUND(COALESCE(SUM(l."qtyBase" * COALESCE(m."unitCost", 0)), 0), 2) AS cost,
               COALESCE(SUM(ROUND(l."qtyBase" * COALESCE(pr."basePriceHt", 0)
                 * (1 + p0."tvaRate" / 100), 2)), 0) AS ttc
        FROM stock_transfer_lines l
        JOIN stock_transfers lt ON lt.id = l."transferId" AND lt.type = 'LOAD'
          AND lt.status = 'VALIDATED' AND ${within('lt."validatedAt"', ctx.start, ctx.end)}
        JOIN products p0 ON p0.id = l."productId"
        LEFT JOIN stock_movements m ON m."tenantId" = l."tenantId"
          AND m."refType" = 'StockTransfer' AND m."refId" = l."transferId"
          AND m."productId" = l."productId" AND m.type = 'TRANSFER_IN'
        LEFT JOIN (
          SELECT DISTINCT ON (pp."productId") pp."productId",
                 pp."priceHt" / pu."factorToBase" AS "basePriceHt"
          FROM product_prices pp
          JOIN product_units pu ON pu.id = pp."productUnitId" AND pu."deletedAt" IS NULL
          JOIN price_levels pl ON pl.id = pp."priceLevelId"
          JOIN products p1 ON p1.id = pp."productId"
          WHERE pp."tenantId" = ${uuid(ctx.tenantId)}
          ORDER BY pp."productId", pl.position, (pu."unitId" = p1."baseUnitId") DESC,
                   pu."isDefaultSale" DESC, pp.id
        ) pr ON pr."productId" = l."productId"
        WHERE l."tenantId" = ${uuid(ctx.tenantId)}
        GROUP BY l."transferId"
      ) x ON x."transferId" = t.id
      WHERE t."tenantId" = ${uuid(ctx.tenantId)} AND t.type = 'LOAD' AND t.status = 'VALIDATED'
        AND ${within('t."validatedAt"', ctx.start, ctx.end)}`,
  },

  /** Avaries: retours client  /** Avaries: retours client with disposition DAMAGED, on sales that still count. */
  damages: {
    has: { client: true, product: false },
    rows: (ctx) => Prisma.sql`
      SELECT r."createdAt" AS at, ${vehicleOfSql('damages', ctx)} AS wh, s."clientId",
             NULL::uuid AS "productId", r."totalTtc" AS ttc,
             (SELECT COALESCE(SUM(rl."qtyBase"), 0) FROM sale_return_lines rl
              WHERE rl."returnId" = r.id AND rl."tenantId" = r."tenantId") AS qty
      FROM sale_returns r JOIN sales s ON s.id = r."saleId"
      WHERE r."tenantId" = ${uuid(ctx.tenantId)} AND r.disposition = 'DAMAGED' AND ${counted(ctx)}
        AND ${within('r."createdAt"', ctx.start, ctx.end)}`,
  },

  /**
   * Closed sessions of the period: the écart of the clôture, replaced by the écart of its
   * latest correction (ADJUST) when one gave a new count.
   */
  sessions: {
    has: { client: false, product: false },
    rows: (ctx) => Prisma.sql`
      SELECT (ss.date::timestamp AT TIME ZONE ${ALGIERS}) AS at,
             ${vehicleOfSql('sessions', ctx)} AS wh, NULL::uuid AS "clientId",
             NULL::uuid AS "productId", COALESCE(a.ecart, ss.ecart, 0) AS ecart
      FROM seller_sessions ss
      LEFT JOIN (
        SELECT DISTINCT ON (x."adjustsSessionId") x."adjustsSessionId", x.ecart
        FROM seller_sessions x
        WHERE x."tenantId" = ${uuid(ctx.tenantId)} AND x."adjustsSessionId" IS NOT NULL
          AND x.ecart IS NOT NULL
        ORDER BY x."adjustsSessionId", x."createdAt" DESC, x.id DESC
      ) a ON a."adjustsSessionId" = ss.id
      WHERE ss."tenantId" = ${uuid(ctx.tenantId)} AND ss."adjustsSessionId" IS NULL
        AND ss.status = 'CLOSED' AND ss.date >= ${ctx.from}::date AND ss.date <= ${ctx.to}::date`,
  },
};

// ---------------------------------------------------------------- measures

/** What one fact brings to a measure. */
export interface MeasureSource {
  fact: FactKey;
  /**
   * - `sum`: `expr` is aggregated per finest group, then the groups are summed up to each
   *   grouping set (two levels: the first is a plain GROUP BY, which runs in parallel);
   * - `distinct`: `expr` is a COUNT(DISTINCT …) computed once per grouping set.
   */
  kind: 'sum' | 'distinct';
  /** Aggregate over the fact's rows (alias `f`). */
  expr: Prisma.Sql;
  /** True when the value used an estimated weight. */
  estimated?: Prisma.Sql;
}

const sum = (column: string, filter?: string) =>
  Prisma.raw(`COALESCE(SUM(f.${column})${filter ? ` FILTER (WHERE ${filter})` : ''}, 0)`);
const minus = (column: string) => Prisma.raw(`-COALESCE(SUM(f.${column}), 0)`);
const count = (filter?: string) =>
  Prisma.raw(`COUNT(*)${filter ? ` FILTER (WHERE ${filter})` : ''}`);
const distinct = (column: string) => Prisma.raw(`COUNT(DISTINCT f."${column}")`);
const anyEstimated = Prisma.raw(`COALESCE(bool_or(f.est), FALSE)`);
const add = (fact: FactKey, expr: Prisma.Sql, estimated?: Prisma.Sql): MeasureSource => ({
  fact,
  kind: 'sum',
  expr,
  ...(estimated ? { estimated } : {}),
});
const uniq = (fact: FactKey, column: string): MeasureSource => ({
  fact,
  kind: 'distinct',
  expr: distinct(column),
});

/**
 * Where each measure comes from: a list of alternatives, in order of preference, each made
 * of the facts whose contributions are added up (the CA = sales − avoirs). The first
 * alternative whose facts can all carry the dimensions and filters of the question wins:
 * the CA is read per document, and per line only when it is asked by product. Weights are
 * in kg here; the DTO prints tonnes. Ratios have no entry: see `STAT_MEASURES[..].of`.
 */
export const MEASURE_SOURCES: Partial<Record<StatMeasure, readonly (readonly MeasureSource[])[]>> =
  {
    caTtc: [
      [add('sales', sum('ttc')), add('saleReturns', minus('ttc'))],
      [
        add('saleLines', sum('ttc')),
        add('saleLineRounding', sum('ttc')),
        add('returnLines', minus('ttc')),
        add('returnLineRounding', minus('ttc')),
      ],
    ],
    nbBl: [[add('sales', count())], [uniq('saleLines', 'saleId')]],
    activeClients: [[uniq('sales', 'clientId')], [uniq('saleLines', 'clientId')]],
    activeVehicles: [[uniq('sales', 'vehicleId')], [uniq('saleLines', 'vehicleId')]],
    skuLines: [[add('saleLines', count()), add('saleDuplicateLines', Prisma.raw('-COUNT(*)'))]],
    weightT: [
      [add('saleLines', sum('kg'), anyEstimated), add('returnLines', minus('kg'), anyEstimated)],
    ],
    weightUnknownLines: [[add('saleLines', count('f.unk'))]],
    versements: [[add('payments', sum('amount'))]],
    bcCount: [[add('orders', count())]],
    bcTtc: [[add('orders', sum('ttc'))]],
    openOrders: [[add('openOrders', count())]],
    orderedQty: [[add('deliveries', sum('ordered'))]],
    deliveredQty: [[add('deliveries', sum('delivered'))]],
    loadCount: [[add('loads', count())]],
    loadValueCost: [[add('loads', sum('cost'))]],
    loadValueTtc: [[add('loads', sum('ttc'))]],
    loadWeightT: [[add('loads', sum('kg'), anyEstimated)]],
    loadWeightCapT: [
      [
        add(
          'loads',
          sum('kg', 'f.cap IS NOT NULL'),
          Prisma.raw(`COALESCE(bool_or(f.est) FILTER (WHERE f.cap IS NOT NULL), FALSE)`),
        ),
      ],
    ],
    loadCapacityT: [[add('loads', sum('cap'))]],
    damagedQty: [[add('damages', sum('qty'))]],
    damagedTtc: [[add('damages', sum('ttc'))]],
    cashEcart: [[add('sessions', sum('ecart'))]],
    visitsPlanned: [[add('planned', count())]],
    plannedVisited: [[add('planned', count('f.visited'))]],
    plannedSuccess: [[add('planned', count('f.success'))]],
    visitsDone: [[add('visits', count())]],
    visitsSuccess: [[add('visits', count('f.success'))]],
    visitsNoSale: [[add('noSale', count())]],
  };

// ---------------------------------------------------------------- dimensions

/** Everything `run()` can group by: the public dimensions, time buckets, and the reason. */
export type EngineDimension = StatDimension | StatGroupBy | 'noSaleReason';

/** The join a dimension needs on a fact: `vehicle` and `time` are on every fact. */
export type DimensionNeed = 'vehicle' | 'time' | 'client' | 'product' | 'reason';

export interface DimensionDef {
  needs: DimensionNeed;
  /** The key, over the fact's rows (alias `f`); a null key is "none" on this dimension. */
  key: Prisma.Sql;
}

const col = (name: string) => Prisma.raw(`f."${name}"::text`);
const day = Prisma.raw(`(f.at AT TIME ZONE 'Africa/Algiers')::date`);

export const DIMENSIONS: Record<EngineDimension, DimensionDef> = {
  vehicle: { needs: 'vehicle', key: col('vehicleId') },
  vehicleType: { needs: 'vehicle', key: col('vehicleTypeId') },
  activity: { needs: 'vehicle', key: col('activity') },
  depot: { needs: 'vehicle', key: col('depotId') },
  vehicleWilaya: { needs: 'vehicle', key: col('vehicleWilaya') },
  clientWilaya: { needs: 'client', key: col('clientWilaya') },
  segment: { needs: 'client', key: col('segmentId') },
  sector: { needs: 'client', key: col('sectorId') },
  client: { needs: 'client', key: col('clientId') },
  brand: { needs: 'product', key: col('brandId') },
  /** A family: the top of the two-level category tree. */
  category: { needs: 'product', key: col('familyId') },
  subCategory: { needs: 'product', key: col('subCategoryId') },
  product: { needs: 'product', key: col('productId') },
  day: { needs: 'time', key: Prisma.sql`to_char(${day}, 'YYYY-MM-DD')` },
  /** Weeks start on Sunday, like `bucketStart` in @erp/shared. */
  week: {
    needs: 'time',
    key: Prisma.sql`to_char(${day} - EXTRACT(DOW FROM ${day})::int, 'YYYY-MM-DD')`,
  },
  month: { needs: 'time', key: Prisma.sql`to_char(${day}, 'YYYY-MM-01')` },
  noSaleReason: { needs: 'reason', key: col('reason') },
};

/** Whether a fact's rows can carry a dimension (or a filter of that kind). */
export function factCarries(fact: FactKey, need: DimensionNeed): boolean {
  if (need === 'vehicle' || need === 'time') return true;
  return FACTS[fact].has[need] === true;
}
