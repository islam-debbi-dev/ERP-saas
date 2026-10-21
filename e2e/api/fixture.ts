/**
 * Reusable fixtures for the e2e audit: a fresh tenant with its catalog, stock
 * and clients, so every check starts from a known state.
 */
import { call, idemKey, register, request, type Session } from '../lib/http.ts';
import { query } from '../lib/db.ts';

export interface Fixture {
  session: Session;
  tenantId: string;
  units: { id: string; code: string }[];
  priceLevels: { id: string; position: number; name: string }[];
  baseUnitId: string;
  priceLevelId: string;
  productId: string;
  clientId: string;
  /** Product with stock 100 at 500 DA (CUMP 500). */
  stockQty: string;
}

export const today = (): string => new Date().toISOString().slice(0, 10);

/** Normalizes a numeric column ('98.000') to a plain number ('98'). */
export const num = (v: string | number | undefined | null): number =>
  v === undefined || v === null ? NaN : Number(String(v));

let seq = 0;
export const uniq = (prefix: string): string => `${prefix}${Date.now().toString(36)}${(seq += 1).toString(36)}`;

export async function makeTenant(label = 'Audit'): Promise<Session> {
  const tag = uniq('e2e');
  return register(`${label} ${tag}`, `Owner ${tag}`, `${tag}@audit.local`, 'Audit1234!');
}

export async function buildFixture(label = 'Audit'): Promise<Fixture> {
  const session = await makeTenant(label);
  const { token, tenantId } = session;

  const units = (await call<{ id: string; code: string }[]>('/units', { token })).body;
  const priceLevels = (await call<{ id: string; position: number; name: string }[]>('/price-levels', { token })).body;
  const baseUnit = units.find((u) => u.code === 'PIECE') ?? units[0];
  const level = priceLevels[0];

  const product = (
    await call<{ id: string }>('/products', {
      method: 'POST',
      token,
      idempotencyKey: idemKey('prod'),
      body: {
        reference: uniq('P-'),
        designation: 'Audit product',
        baseUnitId: baseUnit.id,
        tvaRate: '19',
        minStock: '0',
        units: [
          {
            unitId: baseUnit.id,
            factorToBase: '1',
            barcode: null,
            isDefaultSale: true,
            isDefaultPurchase: true,
          },
        ],
        prices: [{ unitId: baseUnit.id, priceLevelId: level.id, priceHt: '1000' }],
      },
    })
  ).body;

  const client = (
    await call<{ id: string }>('/clients', {
      method: 'POST',
      token,
      idempotencyKey: idemKey('cli'),
      body: { code: uniq('C-'), name: 'Audit client', type: 'PARTICULIER' },
    })
  ).body;

  await call('/stock/opening', {
    method: 'POST',
    token,
    idempotencyKey: idemKey('stock'),
    body: {
      note: 'audit opening',
      lines: [{ productId: product.id, unitId: baseUnit.id, qty: '100', unitCost: '500' }],
    },
  });

  return {
    session,
    tenantId,
    units,
    priceLevels,
    baseUnitId: baseUnit.id,
    priceLevelId: level.id,
    productId: product.id,
    clientId: client.id,
    stockQty: '100',
  };
}

/** Creates a validated BL of `qty` units at 1000 DA HT (unit), on credit. */
export async function makeSale(
  f: Fixture,
  opts: { qty?: string; paid?: string; clientId?: string | null } = {},
): Promise<{ id: string; number: string }> {
  const { token } = f.session;
  const qty = opts.qty ?? '2';
  const clientId = opts.clientId === undefined ? f.clientId : opts.clientId;
  const sale = (
    await call<{ id: string; number: string }>('/sales', {
      method: 'POST',
      token,
      idempotencyKey: idemKey('sale'),
      body: {
        type: 'BL',
        clientId,
        documentDate: today(),
        lines: [{ productId: f.productId, unitId: f.baseUnitId, qty, unitPriceHt: '1000' }],
      },
    })
  ).body;
  const validated = await call<{ sale: { number: string } }>(`/sales/${sale.id}/validate`, {
    method: 'POST',
    token,
    idempotencyKey: idemKey('val'),
    body: { paidAmount: opts.paid ?? '0', paymentMode: 'ESPECES', forceCredit: false },
  });
  return { id: sale.id, number: validated.body.sale.number };
}

/** The rows a business operation must leave in the database. */
export async function dbState(
  f: Fixture,
  saleId: string,
): Promise<Record<string, number | string>> {
  const [row] = await query<Record<string, string>>(
    `SELECT
       (SELECT COUNT(*) FROM sales s
         WHERE s.id = $2::uuid AND s."tenantId" = $1::uuid AND s.status = 'VALIDATED') AS sale_validated,
       (SELECT COUNT(*) FROM stock_movements sm
         WHERE sm."tenantId" = $1::uuid AND sm."refId" = $2::uuid AND sm.type = 'SALE') AS sale_movements,
       (SELECT COUNT(*) FROM client_ledger_entries le
         WHERE le."tenantId" = $1::uuid AND le."refId" = $2::uuid AND le.type = 'SALE') AS sale_ledger,
       (SELECT COUNT(*) FROM audit_logs a
         WHERE a."tenantId" = $1::uuid AND a."entityId" = $2::text AND a.action = 'SALE_VALIDATED') AS sale_audit,
       (SELECT COUNT(*) FROM audit_logs a
         WHERE a."tenantId" = $1::uuid AND a."entityId" = $2::text) AS audit_rows,
       (SELECT "qtyBase"::text FROM product_stocks ps
         WHERE ps."tenantId" = $1::uuid AND ps."productId" = $3::uuid) AS stock_qty,
       (SELECT balance::text FROM client_balances cb
         WHERE cb."tenantId" = $1::uuid AND cb."clientId" = $4::uuid) AS client_balance`,
    [f.tenantId, saleId, f.productId, f.clientId],
  );
  return row as Record<string, number | string>;
}

/** Raw request helper for negative tests (no throw). */
export async function raw(
  path: string,
  opts: Parameters<typeof request>[1],
): Promise<{ status: number; body: unknown; raw: string }> {
  const res = await request(path, opts);
  return { status: res.status, body: res.body, raw: res.raw };
}
