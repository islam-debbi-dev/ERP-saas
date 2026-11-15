/**
 * Part D of test-36: history written by the API **before phase 36** (main at `93afa56`, the
 * merge just before PR #72), for the vehicle backfill and the upgrade checks. Not the app seed.
 *
 * Run it against the pre-36 API on a pre-36 database (e2e/REPORT-36.md, section 12):
 *
 *   API=http://localhost:3003 DB=postgresql://erp:erp@localhost:5432/erp_t36_base \
 *     pnpm test:vehicles:backfill:seed
 *
 * Every user is invited with `POST /users/invite`. Every row the backfill will read is
 * written by the old code paths (quick sale from the seller's truck, order delivered from a
 * truck, order delivered from the dépôt principal, visits with neither), then the drivers are
 * moved so that **today's driver differs from the driver of the history**: a backfill that
 * guessed from today's driver would be caught.
 *
 * Writes `.auth/vehicles-backfill-fixture.json`: each row with the truck the facts give
 * (`facts`) and what the spec's rule gives (`spec`).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DB } from '../lib/config.ts';
import { closeDb, query } from '../lib/db.ts';
import {
  algiersToday,
  client,
  company,
  type Company,
  invite,
  openingStock,
  product,
} from '../lib/audit.ts';
import { assertT36Db } from '../lib/vehicles-fixture.ts';

assertT36Db();

export interface BackfillRow {
  table: 'visits' | 'orders';
  column: 'vehicleId' | 'deliveryVehicleId';
  kind: string;
  id: string;
  /** The truck the spec's rule must write (null = must stay null). */
  spec: string | null;
  /** The truck a human could prove from the rows (may differ from `spec`). */
  facts: string | null;
  /** The truck today's driver would give: a guessing backfill would write this. */
  todaysDriver: string | null;
  note: string;
}

export interface BackfillFixture {
  db: string;
  createdAt: string;
  tenants: string[];
  /** Owner of the first company (12 h token), for the upgrade probes of part-d.sh. */
  ownerToken: string;
  trucks: Record<string, string>;
  /** Trucks expected to get one 'backfill' row from the migration, with their driver. */
  expectedAssignments: { vehicleId: string; userId: string; label: string }[];
  /** Trucks that must get none (no driver, archived). */
  noAssignment: { vehicleId: string; label: string }[];
  rows: BackfillRow[];
}

const now = () => new Date().toISOString();

async function truck(c: Company, name: string, driver: string | null): Promise<string> {
  const w = await c.owner.post<{ id: string }>(
    '/warehouses',
    { name, type: 'VEHICLE', assignedUserId: driver },
    null,
  );
  return w.id;
}

async function companyP(): Promise<
  Omit<BackfillFixture, 'db' | 'createdAt' | 'tenants' | 'ownerToken'> & {
    tenantId: string;
    ownerToken: string;
  }
> {
  const c = await company('T36 D pre36', { edition: 'DISTRIBUTION' });
  const seller1 = await invite(c, 'SELLER');
  const seller2 = await invite(c, 'SELLER');
  const seller3 = await invite(c, 'SELLER');
  const seller4 = await invite(c, 'SELLER');
  const seller5 = await invite(c, 'SELLER');

  const T1 = await truck(c, 'Camion 1 (seller1, puis seller3)', seller1.id);
  const T2 = await truck(c, 'Camion 2 prévente (seller2)', seller2.id);
  const T3 = await truck(c, 'Camion 3 (personne, puis seller1)', null);
  const T4 = await truck(c, 'Camion 4 archivé (seller4)', seller4.id);
  const T5 = await truck(c, 'Camion 5 désactivé (seller5)', seller5.id);

  const p = await product(c, { priceHt: '1000', designation: 'Article T36 D' });
  await openingStock(c, p, '2000', '500');
  const clients: string[] = [];
  for (const name of [
    'Epicerie',
    'Superette',
    'Kiosque',
    'Café',
    'Grossiste',
    'Boulangerie',
    'Hanout',
  ]) {
    clients.push(await client(c, name));
  }
  const load = async (to: string, qty: string) => {
    const draft = await c.owner.post<{ id: string }>('/stock-transfers', {
      type: 'LOAD',
      fromWarehouseId: c.mainWarehouseId,
      toWarehouseId: to,
      lines: [{ productId: p.id, unitId: p.unitId, qty }],
    });
    await c.owner.post(`/stock-transfers/${draft.id}/validate`, {});
  };
  await load(T1, '200');
  await load(T2, '200');

  const rows: BackfillRow[] = [];
  const today = algiersToday();

  // Old seller routes: the only shape a route had before phase 36.
  for (const who of [seller1, seller3]) {
    const r = await c.owner.post<{ id: string }>('/routes', {
      name: `Tournée ${who.role} ${who.id.slice(0, 4)}`,
      sellerId: who.id,
      weekdays: [0, 1, 2, 3, 4, 5, 6],
      active: true,
    });
    await c.owner.put(`/routes/${r.id}/stops`, { clientIds: clients.slice(0, 3) });
  }

  // 1. Visits linked to van sales: seller1 sells from T1 (no dépôt named → his truck).
  const vanSales: string[] = [];
  for (const clientId of clients.slice(0, 2)) {
    const startedAt = now();
    const sale = await seller1.api.post<{ sale: { id: string } }>('/sales/quick', {
      type: 'BL',
      clientId,
      documentDate: today,
      warehouseId: null,
      lines: [{ productId: p.id, unitId: p.unitId, qty: '3' }],
      paidAmount: '1000',
      paymentMode: 'ESPECES',
    });
    vanSales.push(sale.sale.id);
    const v = await seller1.api.post<{ id: string }>('/visits', {
      clientId,
      startedAt,
      endedAt: now(),
      outcome: 'SALE',
      saleId: sale.sale.id,
    });
    rows.push({
      table: 'visits',
      column: 'vehicleId',
      kind: 'visit_van_sale',
      id: v.id,
      spec: T1,
      facts: T1,
      todaysDriver: T3,
      note: `sale ${sale.sale.id} left T1; seller1 drives T3 today`,
    });
  }

  // 2. A visit linked to a sale from the dépôt principal (seller3 drives nothing yet).
  {
    const startedAt = now();
    const sale = await seller3.api.post<{ sale: { id: string } }>('/sales/quick', {
      type: 'BL',
      clientId: clients[2]!,
      documentDate: today,
      warehouseId: null,
      lines: [{ productId: p.id, unitId: p.unitId, qty: '2' }],
      paidAmount: '0',
      paymentMode: 'ESPECES',
    });
    const v = await seller3.api.post<{ id: string }>('/visits', {
      clientId: clients[2]!,
      startedAt,
      endedAt: now(),
      outcome: 'SALE',
      saleId: sale.sale.id,
    });
    rows.push({
      table: 'visits',
      column: 'vehicleId',
      kind: 'visit_sale_from_main',
      id: v.id,
      spec: null,
      facts: null,
      todaysDriver: T1,
      note: 'the sale left the dépôt principal; seller3 drives T1 today',
    });
  }

  // 3. An order of the office on truck T1, delivered: the BL leaves T1.
  const order = async (
    by: 'owner' | 'seller2',
    clientId: string,
    warehouseId: string | null,
    sellerId: string = seller2.id,
  ): Promise<{ id: string; lines: { id: string }[]; visitId: string | null }> => {
    const startedAt = now();
    const api = by === 'owner' ? c.owner : seller2.api;
    const draft = await api.post<{ id: string }>('/orders', {
      clientId,
      ...(by === 'owner' ? { sellerId } : {}),
      ...(warehouseId ? { warehouseId } : {}),
      lines: [{ productId: p.id, unitId: p.unitId, qty: '5' }],
    });
    const o = await api.post<{ id: string; lines: { id: string }[] }>(
      `/orders/${draft.id}/confirm`,
      {},
    );
    let visitId: string | null = null;
    if (by === 'seller2') {
      const v = await seller2.api.post<{ id: string }>('/visits', {
        clientId,
        startedAt,
        endedAt: now(),
        outcome: 'ORDER',
        orderId: o.id,
      });
      visitId = v.id;
    }
    return { ...o, visitId };
  };
  const deliver = (api: Company['owner'], o: { id: string; lines: { id: string }[] }) =>
    api.post(`/orders/${o.id}/deliver`, {
      lines: [{ orderLineId: o.lines[0]!.id, qty: '5' }],
      paidAmount: '0',
      paymentMode: 'ESPECES',
    });

  const onT1 = await order('owner', clients[3]!, T1);
  await deliver(c.owner, onT1);
  rows.push({
    table: 'orders',
    column: 'deliveryVehicleId',
    kind: 'order_bl_from_truck',
    id: onT1.id,
    spec: T1,
    facts: T1,
    todaysDriver: null,
    note: 'order dépôt T1, BL left T1',
  });

  // 4. An order with no dépôt, delivered by the driver of T1: the BL leaves his truck
  //    (old rule: "the order's dépôt, else the deliverer's truck, else MAIN"). seller1 is
  //    the order's seller, so he may open it.
  const noWh = await order('owner', clients[4]!, null, seller1.id);
  const noWhRow = await query<{ w: string | null }>(
    `SELECT "warehouseId" AS w FROM orders WHERE id = $1`,
    [noWh.id],
  );
  await deliver(seller1.api, noWh).catch(async (e: unknown) => {
    // A seller may not be allowed to deliver: the owner then delivers from MAIN.
    console.log(`seller1 could not deliver (${String(e).slice(0, 160)}); the owner delivers`);
    await deliver(c.owner, noWh);
  });
  const blOfNoWh = await query<{ w: string; type: string }>(
    `SELECT s."warehouseId" AS w, w.type FROM orders o JOIN sales s ON s.id = o."saleId"
     JOIN warehouses w ON w.id = s."warehouseId" WHERE o.id = $1`,
    [noWh.id],
  );
  const blTruck = blOfNoWh[0]?.type === 'VEHICLE' ? blOfNoWh[0].w : null;
  rows.push({
    table: 'orders',
    column: 'deliveryVehicleId',
    kind: 'order_no_depot_delivered_by_driver',
    id: noWh.id,
    spec: blTruck,
    facts: blTruck,
    todaysDriver: null,
    note: `order dépôt ${noWhRow[0]?.w ?? 'none'}; BL left ${blOfNoWh[0]?.type ?? '?'} ${blOfNoWh[0]?.w ?? ''}`,
  });

  // 5. Orders taken by the prévendeur (seller2 drives T2), with their visits: one on his
  //    truck T2 (delivered from it), one on the dépôt principal (delivered from it).
  const onT2 = await order('seller2', clients[5]!, T2);
  await deliver(c.owner, onT2);
  rows.push({
    table: 'orders',
    column: 'deliveryVehicleId',
    kind: 'order_prevente_bl_from_his_truck',
    id: onT2.id,
    spec: T2,
    facts: T2,
    todaysDriver: null,
    note: 'order dépôt T2, BL left T2',
  });
  rows.push({
    table: 'visits',
    column: 'vehicleId',
    kind: 'visit_order_on_his_truck',
    id: onT2.visitId!,
    // Spec: "else from the order's" truck. Before phase 36 an order has no `vehicleId`;
    // the only fact is its dépôt / its BL's dépôt, T2.
    spec: null,
    facts: T2,
    todaysDriver: T2,
    note: 'order dépôt T2, BL left T2; orders.vehicleId is null on every pre-36 row',
  });

  const onMain = await order('seller2', clients[6]!, c.mainWarehouseId);
  await deliver(c.owner, onMain);
  rows.push({
    table: 'orders',
    column: 'deliveryVehicleId',
    kind: 'order_bl_from_main',
    id: onMain.id,
    spec: null,
    facts: null,
    todaysDriver: null,
    note: 'BL left the dépôt principal',
  });
  rows.push({
    table: 'visits',
    column: 'vehicleId',
    kind: 'visit_order_on_main',
    id: onMain.visitId!,
    spec: null,
    facts: null,
    todaysDriver: T2,
    note: 'order on the dépôt principal; seller2 drives T2 today',
  });

  // 6. A confirmed order never delivered: no BL, nothing to know.
  const open = await order('owner', clients[0]!, T1);
  rows.push({
    table: 'orders',
    column: 'deliveryVehicleId',
    kind: 'order_not_delivered',
    id: open.id,
    spec: null,
    facts: null,
    todaysDriver: null,
    note: 'confirmed, not delivered',
  });

  // 7. Visits with neither a sale nor an order, by seller1 (who drives T3 today).
  for (const clientId of clients.slice(4, 6)) {
    const v = await seller1.api.post<{ id: string }>('/visits', {
      clientId,
      startedAt: now(),
      endedAt: now(),
      outcome: 'NO_SALE',
      reason: 'CLOSED',
    });
    rows.push({
      table: 'visits',
      column: 'vehicleId',
      kind: 'visit_neither',
      id: v.id,
      spec: null,
      facts: T1,
      todaysDriver: T3,
      note: 'no sale, no order; seller1 drove T1 then, drives T3 today',
    });
  }

  // Today's crew differs from the history: T1 → seller3, seller1 → T3. T4 archived, T5 off.
  await c.owner.patch(`/warehouses/${T1}`, { assignedUserId: null });
  await c.owner.patch(`/warehouses/${T3}`, { assignedUserId: seller1.id });
  await c.owner.patch(`/warehouses/${T1}`, { assignedUserId: seller3.id });
  await c.owner.ok('DELETE', `/warehouses/${T4}`, {}, null);
  await c.owner.patch(`/warehouses/${T5}`, { active: false });

  return {
    tenantId: c.tenantId,
    ownerToken: c.session.token,
    trucks: { T1, T2, T3, T4, T5, main: c.mainWarehouseId },
    expectedAssignments: [
      { vehicleId: T1, userId: seller3.id, label: 'T1, seller3 today' },
      { vehicleId: T2, userId: seller2.id, label: 'T2, seller2' },
      { vehicleId: T3, userId: seller1.id, label: 'T3, seller1 today' },
      { vehicleId: T5, userId: seller5.id, label: 'T5 switched off, driver kept' },
    ],
    noAssignment: [{ vehicleId: T4, label: 'T4 archived' }],
    rows,
  };
}

/** A second company: one truck with a driver, one without. Its rows stay its own. */
async function companyQ(): Promise<{
  tenantId: string;
  withDriver: string;
  userId: string;
  without: string;
}> {
  const c = await company('T36 D pre36 Q', { edition: 'DISTRIBUTION' });
  const s = await invite(c, 'SELLER');
  const withDriver = await truck(c, 'Camion Q (vendeur)', s.id);
  const without = await truck(c, 'Camion Q vide', null);
  return { tenantId: c.tenantId, withDriver, userId: s.id, without };
}

const started = Date.now();
const p = await companyP();
const q = await companyQ();
const fixture: BackfillFixture = {
  db: DB,
  createdAt: new Date().toISOString(),
  tenants: [p.tenantId, q.tenantId],
  ownerToken: p.ownerToken,
  trucks: { ...p.trucks, Q1: q.withDriver, Q2: q.without },
  expectedAssignments: [
    ...p.expectedAssignments,
    { vehicleId: q.withDriver, userId: q.userId, label: 'Q1, company Q' },
  ],
  noAssignment: [
    ...p.noAssignment,
    { vehicleId: q.without, label: 'Q2 no driver' },
    { vehicleId: p.trucks.main, label: 'dépôt principal' },
  ],
  rows: p.rows,
};
const file = fileURLToPath(new URL('../.auth/vehicles-backfill-fixture.json', import.meta.url));
mkdirSync(fileURLToPath(new URL('../.auth/', import.meta.url)), { recursive: true });
writeFileSync(file, JSON.stringify(fixture, null, 2));
console.table(
  fixture.rows.map((r) => ({
    kind: r.kind,
    spec: r.spec?.slice(0, 8) ?? null,
    facts: r.facts?.slice(0, 8) ?? null,
    note: r.note,
  })),
);
console.log(
  `vehicles-backfill-seed: done in ${((Date.now() - started) / 1000).toFixed(1)} s, fixture in ${file}`,
);
await closeDb();
