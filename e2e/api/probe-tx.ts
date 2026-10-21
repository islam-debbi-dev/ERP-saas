/**
 * Probe: are the writes of one business operation committed in one transaction?
 * PostgreSQL's CURRENT_TIMESTAMP is the transaction start time, so every row
 * written by the same transaction shares the same createdAt.
 */
import { call, idemKey, register } from '../lib/http.ts';
import { query } from '../lib/db.ts';

const ts = Date.now();

async function main(): Promise<void> {
  const s = await register(`Probe ${ts}`, 'Probe Owner', `probe${ts}@t.dz`, 'Probe1234!');
  const token = s.token;
  const tenantId = s.tenantId;

  const units = await call<{ id: string; code: string }[]>('/units', { token });
  const baseUnit = units.body.find((u) => u.code === 'PIECE') ?? units.body[0];
  const levels = await call<{ id: string }[]>('/price-levels', { token });
  const level = levels.body[0];

  const product = await call<{ id: string }>('/products', {
    method: 'POST',
    token,
    idempotencyKey: idemKey('prod'),
    body: {
      reference: `P-${ts}`,
      designation: 'Probe product',
      baseUnitId: baseUnit.id,
      tvaRate: '19',
      minStock: '0',
      units: [
        { unitId: baseUnit.id, factorToBase: '1', barcode: null, isDefaultSale: true, isDefaultPurchase: true },
      ],
      prices: [{ unitId: baseUnit.id, priceLevelId: level.id, priceHt: '1000' }],
    },
  });

  const client = await call<{ id: string }>('/clients', {
    method: 'POST',
    token,
    idempotencyKey: idemKey('cli'),
    body: { code: `C-${ts}`, name: 'Probe client', type: 'PARTICULIER' },
  });

  // opening stock so the sale can move stock
  await call('/stock/opening', {
    method: 'POST',
    token,
    idempotencyKey: idemKey('stock'),
    body: {
      note: 'probe opening',
      lines: [{ productId: product.body.id, unitId: baseUnit.id, qty: '100', unitCost: '500' }],
    },
  });

  const sale = await call<{ id: string }>('/sales', {
    method: 'POST',
    token,
    idempotencyKey: idemKey('sale'),
    body: {
      type: 'BL',
      clientId: client.body.id,
      documentDate: new Date().toISOString().slice(0, 10),
      lines: [{ productId: product.body.id, unitId: baseUnit.id, qty: '2', unitPriceHt: '1000' }],
    },
  });

  await call(`/sales/${sale.body.id}/validate`, {
    method: 'POST',
    token,
    idempotencyKey: idemKey('val'),
    body: { paidAmount: '0', paymentMode: 'ESPECES', forceCredit: false },
  });

  const rows = await query<{ k: string; detail: string; ts: string; xmin: string }>(
    `select 'SALE' as k, status::text as detail, "createdAt"::text as ts, xmin::text as xmin from sales where id = $1::uuid
     union all select 'SALE_LINE', qty::text, "createdAt"::text, xmin::text from sale_lines where "saleId" = $1::uuid
     union all select 'STOCKMOV', type::text || ' ' || "qtyBase"::text, "createdAt"::text, xmin::text from stock_movements where "refId" = $1::uuid
     union all select 'LEDGER', type::text || ' ' || amount::text, "createdAt"::text, xmin::text from client_ledger_entries where "refId" = $1::uuid
     union all select 'AUDIT', action, "createdAt"::text, xmin::text from audit_logs where "entityId" = $1::text
     order by 3`,
    [sale.body.id],
  );
  console.log('tenant', tenantId, 'sale', sale.body.id);
  for (const r of rows) console.log(r.ts, 'xmin=' + r.xmin, r.k, r.detail);

  const distinct = new Set(rows.map((r) => r.ts));
  console.log('\ndistinct createdAt values:', distinct.size, [...distinct]);
  console.log('distinct xmin values:', new Set(rows.map((r) => r.xmin)).size);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
