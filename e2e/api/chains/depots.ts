/**
 * Chains 10 and 11 (audit 02): several dépôts, a truck, a tournée with an order delivered
 * in part, then the seller's session and returnable packaging.
 * Rules: docs/domain.md, "Dépôts et camions" (phase 15), "Sales force & distribution"
 * (phases 14-20) and "Promotions & emballages" (phase 20).
 */
import { area, assert, check } from '../../lib/harness.ts';
import {
  algiersToday,
  assertContiguous,
  cashAccounts,
  client,
  company,
  dbRead,
  invite,
  openingStock,
  product,
  same,
  setSetting,
} from '../../lib/audit.ts';
import { query } from '../../lib/db.ts';

interface Transfer {
  id: string;
  number: string | null;
  status: string;
  type: string;
}
interface SaleResult {
  sale: { id: string; number: string; totalTtc: string; warehouseId?: string | null };
}
interface Order {
  id: string;
  number: string | null;
  status: string;
  version: number;
  lines: { id: string; qty: string }[];
}

export async function depotsChain(): Promise<void> {
  area('10. Dépôts, camion, tournée');
  const c = await company('Depots');
  const t = c.tenantId;
  const today = algiersToday();
  const main = c.mainWarehouseId;

  const seller = await invite(c, 'SELLER');
  const livreur = await invite(c, 'LIVREUR');
  const depot2 = await c.owner.post<{ id: string }>(
    '/warehouses',
    { name: 'Dépôt Oran', type: 'SECONDARY' },
    null,
  );
  const truck = await c.owner.post<{ id: string }>(
    '/warehouses',
    { name: 'Camion 1', type: 'VEHICLE', assignedUserId: seller.id },
    null,
  );
  const p = await product(c, { priceHt: '1000' });
  await openingStock(c, p, '120', '500');
  const c1 = await client(c, 'Epicerie');
  const c2 = await client(c, 'Superette');

  const stock = (w: string) => dbRead.warehouseStock(t, p.id, w);
  const transfer = async (
    type: string,
    from: string,
    to: string,
    qty: string,
  ): Promise<Transfer> => {
    const draft = await c.owner.post<Transfer>('/stock-transfers', {
      type,
      fromWarehouseId: from,
      toWarehouseId: to,
      lines: [{ productId: p.id, unitId: p.unitId, qty }],
    });
    await c.owner.post(`/stock-transfers/${draft.id}/validate`, {});
    return c.owner.read<Transfer>(`/stock-transfers/${draft.id}`);
  };

  const tr1 = await transfer('TRANSFER', main, depot2.id, '30');
  const tr2 = await transfer('LOAD', main, truck.id, '24');
  await check(
    'a transfer and a chargement move the goods between dépôts, not the CUMP',
    async () => {
      assert(
        tr1.status === 'VALIDATED' && tr2.status === 'VALIDATED',
        `${tr1.status} / ${tr2.status}`,
      );
      same(await stock(main), '66', 'dépôt principal');
      same(await stock(depot2.id), '30', 'dépôt Oran');
      same(await stock(truck.id), '24', 'camion');
      same(await dbRead.stock(t, p.id), '120', 'product level');
      same(await dbRead.avgCost(t, p.id), '500', 'CUMP');
      assert(/^TR-\d{4}-000001$/.test(tr1.number ?? ''), `first transfer ${tr1.number}`);
      assert(/^TR-\d{4}-000002$/.test(tr2.number ?? ''), `second transfer ${tr2.number}`);
    },
  );

  // The seller sells 4 pièces: 4 760 DA TTC, 2 000 paid in cash. He names no dépôt, as the
  // web does when he leaves the picker alone (`warehouseId: null`).
  const truckSale = await seller.api.post<SaleResult>('/sales/quick', {
    type: 'BL',
    clientId: c1,
    documentDate: today,
    warehouseId: null,
    lines: [{ productId: p.id, unitId: p.unitId, qty: '4' }],
    paidAmount: '2000',
    paymentMode: 'ESPECES',
  });
  const soldFrom = (
    await query<{ w: string }>(
      `SELECT "warehouseId"::text AS w FROM stock_movements WHERE "tenantId" = $1::uuid AND "refId" = $2::uuid AND type = 'SALE'`,
      [t, truckSale.sale.id],
    )
  )[0]!.w;
  await check(
    "a seller's sale with no dépôt chosen leaves from his truck (domain.md, phase 15)",
    async () => {
      assert(
        soldFrom === truck.id,
        `the SALE movement is on ${soldFrom === main ? 'the dépôt principal' : soldFrom}, not on the truck: ` +
          `camion=${await stock(truck.id)} (4 pièces physically left it), dépôt principal=${await stock(main)}`,
      );
    },
    { expected: 'truck 20, dépôt principal 66' },
  );
  await check('the sale itself is right: total, credit, company stock', async () => {
    same(truckSale.sale.totalTtc, '4760', 'sale TTC');
    same(await dbRead.stock(t, p.id), '116', 'product level');
    same(await dbRead.clientBalance(t, c1), '2760', 'client balance');
  });
  // The rest of the chain follows what the API really did, so one finding does not hide the next.
  let mainQty = soldFrom === main ? 62 : 66;
  let truckQty = soldFrom === truck.id ? 20 : 24;
  await check(
    'stock is judged per dépôt: more than the truck holds is refused in BLOCK mode',
    async () => {
      await setSetting(c, { negativeStockMode: 'BLOCK' });
      const res = await seller.api.send<{ code?: string }>('POST', '/sales/quick', {
        type: 'BL',
        clientId: c1,
        documentDate: today,
        warehouseId: truck.id,
        lines: [{ productId: p.id, unitId: p.unitId, qty: String(truckQty + 1) }],
        paidAmount: '0',
      });
      assert(
        res.status === 409 || res.status === 422,
        `HTTP ${res.status} ${res.raw.slice(0, 200)}`,
      );
      assert(res.body.code === 'STOCK_INSUFFICIENT', `code=${res.body.code}`);
      same(await stock(truck.id), String(truckQty), 'camion after the refused sale');
    },
  );

  // Tournée: an order of 10 for the second client, delivered by the livreur: 7 taken, 3 back.
  const weekdays = [0, 1, 2, 3, 4, 5, 6];
  const route = await c.owner.post<{ id: string }>('/routes', {
    name: 'Tournée Est',
    sellerId: seller.id,
    weekdays,
    active: true,
  });
  await c.owner.put(`/routes/${route.id}/stops`, { clientIds: [c1, c2] });
  const draft = await seller.api.post<Order>('/orders', {
    clientId: c2,
    warehouseId: main,
    lines: [{ productId: p.id, unitId: p.unitId, qty: '10' }],
  });
  const order = await seller.api.post<Order>(`/orders/${draft.id}/confirm`, {});
  await check(
    'a confirmed order is numbered and touches neither stock nor the account',
    async () => {
      assert(/^BC-\d{4}-000001$/.test(order.number ?? ''), `order number ${order.number}`);
      same(await dbRead.stock(t, p.id), '116', 'product level');
      same(await dbRead.clientBalance(t, c2), '0', 'client balance');
    },
  );
  await c.owner.patch(`/orders/${order.id}/livreur`, { livreurId: livreur.id });
  const deliverKey = `a2-deliver-${order.id}`;
  const delivered = await livreur.api.send<{
    order?: Order;
    sale?: { id: string; number: string; totalTtc: string };
  }>(
    'POST',
    `/orders/${order.id}/deliver`,
    {
      lines: [{ orderLineId: order.lines[0]!.id, qty: '7' }],
      paidAmount: '3000',
      paymentMode: 'ESPECES',
    },
    deliverKey,
  );
  await check('delivering 7 of 10 creates one BL for 7, from the dépôt of the order', async () => {
    assert(delivered.status === 200, `HTTP ${delivered.status} ${delivered.raw.slice(0, 300)}`);
    const sales = await query<{ id: string; number: string; ttc: string; paid: string }>(
      `SELECT id, "number", "totalTtc"::text AS ttc, "paidAmount"::text AS paid FROM sales
        WHERE "tenantId" = $1::uuid AND "clientId" = $2::uuid AND status = 'VALIDATED'`,
      [t, c2],
    );
    assert(sales.length === 1, `BLs for the client: ${sales.length}`);
    same(sales[0]!.ttc, '8330', 'BL TTC (7 x 1 190)');
    mainQty -= 7;
    same(await stock(main), String(mainQty), 'dépôt principal after the delivery');
    same(await dbRead.clientBalance(t, c2), '5330', 'client balance (8 330 - 3 000)');
  });
  await check('the same delivery sent again replays and delivers nothing more', async () => {
    const again = await livreur.api.send(
      'POST',
      `/orders/${order.id}/deliver`,
      {
        lines: [{ orderLineId: order.lines[0]!.id, qty: '7' }],
        paidAmount: '3000',
        paymentMode: 'ESPECES',
      },
      deliverKey,
    );
    assert(again.status === 200, `replay HTTP ${again.status}`);
    same(await stock(main), String(mainQty), 'dépôt principal after the replay');
    same(await dbRead.clientBalance(t, c2), '5330', 'client balance after the replay');
  });
  await check('a déchargement brings the truck back to zero', async () => {
    const back = await transfer('UNLOAD', truck.id, main, String(truckQty));
    assert(back.status === 'VALIDATED', back.status);
    mainQty += truckQty;
    truckQty = 0;
    same(await stock(truck.id), '0', 'camion');
    same(await stock(main), String(mainQty), 'dépôt principal');
    same(await dbRead.stock(t, p.id), '109', 'product level');
  });

  // ------------------------------------------------------------ seller session, packaging
  area('11. Clôture de tournée, emballages consignés');
  const versement = await seller.api.post<{ id: string; number: string }>('/payments', {
    clientId: c1,
    amount: '500',
    mode: 'ESPECES',
  });
  await seller.api.post('/payments', {
    clientId: c1,
    amount: '300',
    mode: 'CHEQUE',
    reference: 'CHQ-1',
  });
  const session = await c.owner.post<{ id: string; expectedCash?: string }>('/seller-sessions', {
    sellerId: seller.id,
    date: today,
  });
  const closed = await c.owner.post<Record<string, unknown>>(
    `/seller-sessions/${session.id}/close`,
    { handedCash: '2400' },
  );
  await check(
    "the session expects the seller's cash (2 000 at the sale + 500) and stores the écart",
    async () => {
      void closed;
      const row = await query<{ expected: string; handed: string; ecart: string }>(
        `SELECT "expectedCash"::text AS expected, "handedCash"::text AS handed, ecart::text AS ecart
         FROM seller_sessions WHERE id = $1::uuid`,
        [session.id],
      );
      same(row[0]!.expected, '2500', 'expected cash');
      same(row[0]!.handed, '2400', 'handed cash');
      same(row[0]!.ecart, '-100', 'écart');
    },
  );
  await check('the client account holds the sale, the cash and the cheque', async () => {
    // 4 760 - 2 000 (at the sale) - 500 - 300 = 1 960.
    same(await dbRead.clientBalance(t, c1), '1960', 'client balance');
    same(await dbRead.clientLedger(t, c1), '1960', 'client ledger');
    assert(/^VER-\d{4}-\d{6}$/.test(versement.number), `versement number ${versement.number}`);
  });
  await check('cash went to the caisse and the cheque to the bank', async () => {
    const accounts = await cashAccounts(c);
    const caisse = accounts.find((a) => a.type === 'CAISSE' && a.isDefault)!;
    const banque = accounts.find((a) => a.type === 'BANQUE' && a.isDefault)!;
    // 2 000 (truck sale) + 3 000 (delivery) + 500 (versement).
    same(await dbRead.cashBalance(t, caisse.id), '5500', 'caisse');
    same(await dbRead.cashBalance(t, banque.id), '300', 'banque');
  });

  const casier = await c.owner.post<{ id: string }>(
    '/packaging-types',
    { name: 'Casier 24', depositValue: '300' },
    null,
  );
  const bottle = await product(c, { priceHt: '50', designation: 'Bouteille 1 L' });
  await openingStock(c, bottle, '500', '30');
  await c.owner.put(`/products/${bottle.id}/packaging`, [
    { packagingTypeId: casier.id, qtyBasePerPackaging: '24' },
  ]);
  const packBalance = async (): Promise<string> => {
    const r = await query<{ b: string }>(
      `SELECT balance::text AS b FROM client_packaging_balances WHERE "tenantId" = $1::uuid AND "clientId" = $2::uuid AND "packagingTypeId" = $3::uuid`,
      [t, c1, casier.id],
    );
    return r[0]?.b ?? '0';
  };
  const packLedger = async (): Promise<string> => {
    const r = await query<{ b: string }>(
      `SELECT COALESCE(SUM(qty), 0)::text AS b FROM client_packaging_entries WHERE "tenantId" = $1::uuid AND "clientId" = $2::uuid AND "packagingTypeId" = $3::uuid`,
      [t, c1, casier.id],
    );
    return r[0]!.b;
  };
  // 30 bouteilles = 2 casiers out; the client hands 1 empty back at the sale.
  const bottles = await c.owner.post<SaleResult>('/sales/quick', {
    type: 'BL',
    clientId: c1,
    documentDate: today,
    warehouseId: main,
    lines: [{ productId: bottle.id, unitId: bottle.unitId, qty: '30' }],
    paidAmount: '0',
    packagingReturned: [{ packagingTypeId: casier.id, qty: 1 }],
  });
  await check(
    '30 bouteilles leave 2 casiers with the client, 1 comes back at the sale',
    async () => {
      same(await packBalance(), '1', 'casiers at the client');
      same(await packLedger(), '1', 'packaging ledger');
    },
  );
  await c.owner.post('/packaging-movements', {
    clientId: c1,
    packagingTypeId: casier.id,
    type: 'RETURN',
    qty: 1,
    note: null,
  });
  await check('a return of empties brings the count to zero', async () => {
    same(await packBalance(), '0', 'casiers at the client');
  });
  await c.owner.post(`/sales/${bottles.sale.id}/cancel`, { reason: 'Audit: erreur de saisie' });
  await check(
    'cancelling the sale reverses exactly what it left (2 given - 1 returned)',
    async () => {
      same(await packBalance(), '-1', 'casiers at the client');
      same(await packLedger(), '-1', 'packaging ledger');
      same(await dbRead.stock(t, bottle.id), '500', 'bouteilles back in stock');
      same(await dbRead.clientBalance(t, c1), '1960', 'client balance back to before the sale');
    },
  );
  await check('document numbers of the company have no gap', async () => {
    await assertContiguous(t, 'sales', 'BL');
    await assertContiguous(t, 'payments', 'VER');
    await assertContiguous(t, 'stock_transfers', 'TR');
  });
}
