/**
 * Test data of the phase 36 pass (test-36, vehicle-first distribution). Not the app seed.
 *
 * Everything goes through the real API, and every user is invited with `POST /users/invite`
 * and accepts his invitation (audit 02, A-1: users written straight into the database hide
 * bugs). Every run makes new companies and overwrites `.auth/vehicles-fixture.json`.
 *
 *   API=http://localhost:3003 DB=postgresql://erp:erp@localhost:5432/erp_t36 pnpm test:vehicles:seed
 *
 * Companies:
 *   A  Distribution: owner, manager, a supervisor with two sellers, a seller outside the
 *      team, two livreurs, a storekeeper; dépôt principal + "Dépôt Batna"; five trucks over
 *      the two dépôts (CASH_VAN, PRESALE, DELIVERY, MIXED, one without type); five vehicle
 *      types (with and without `codePrefix`), one of them archived; and a history for the
 *      backfill of part D (see `history` in the fixture).
 *   B  Distribution, with the very type codes and truck codes of A.
 *   E  Essentiel (no WAREHOUSES, no TOURNEES).
 */
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
  type Staff,
} from '../lib/audit.ts';
import {
  assertT36Db,
  saveFixture,
  type SeedCompany,
  type SeedHistory,
  type SeedTruck,
  type SeedUser,
} from '../lib/vehicles-fixture.ts';

assertT36Db();

/** The owner's own codes, taken from the field examples of the spec. Never ours. */
const TYPES = [
  { code: 'MXT', name: 'Gros + détail', codePrefix: 'VAN', activity: 'CASH_VAN' },
  { code: 'DD', name: 'Prévente détail', codePrefix: 'PRV', activity: 'PRESALE' },
  { code: 'MIX', name: 'Livreur mixte', codePrefix: 'LIV', activity: 'DELIVERY' },
  { code: 'SELF/MT', name: 'Self + moderne', codePrefix: null, activity: 'MIXED' },
  { code: 'HRC', name: 'Hôtels, restaurants, cafés', codePrefix: 'VAN', activity: 'CASH_VAN' },
] as const;
const ARCHIVED_TYPE = 'HRC';

interface TruckSpec {
  code: string | null;
  name: string;
  type: string | null;
  wilayaCode: number | null;
  plateNumber: string | null;
  capacityKg: number | null;
  parent: 'main' | 'secondary';
  driver: string | null;
}
const TRUCKS: TruckSpec[] = [
  {
    code: 'VAN-28 MXT 01',
    name: "Camion M'sila",
    type: 'MXT',
    wilayaCode: 28,
    plateNumber: '00123-119-28',
    capacityKg: 3500,
    parent: 'main',
    driver: 'seller1',
  },
  {
    code: 'PRV05-DD01',
    name: 'Prévente Batna',
    type: 'DD',
    wilayaCode: 5,
    plateNumber: '04567-120-05',
    capacityKg: null,
    parent: 'secondary',
    driver: 'seller2',
  },
  {
    code: 'LIV 28 MIX',
    name: 'Livraison M’sila',
    type: 'MIX',
    wilayaCode: 28,
    plateNumber: '08901-121-28',
    capacityKg: 7000,
    parent: 'main',
    driver: 'livreur1',
  },
  {
    code: 'VAN34-SELF/MT',
    name: 'Camion Bordj',
    type: 'SELF/MT',
    wilayaCode: 34,
    plateNumber: null,
    capacityKg: 1500,
    parent: 'secondary',
    driver: 'seller3',
  },
  {
    code: null,
    name: 'Camion sans type',
    type: null,
    wilayaCode: null,
    plateNumber: null,
    capacityKg: null,
    parent: 'main',
    driver: null,
  },
];

const user = (s: Staff): SeedUser => ({
  id: s.id,
  email: s.email,
  role: s.role,
  token: s.api.token,
});

async function types(c: Company): Promise<SeedCompany['types']> {
  const out: SeedCompany['types'] = {};
  for (const t of TYPES) {
    const row = await c.owner.post<{ id: string }>('/vehicle-types', t, null);
    out[t.code] = { id: row.id, activity: t.activity, codePrefix: t.codePrefix, archived: false };
  }
  await c.owner.post(`/vehicle-types/${out[ARCHIVED_TYPE]!.id}/archive`, {}, null);
  out[ARCHIVED_TYPE]!.archived = true;
  return out;
}

async function trucks(
  c: Company,
  secondaryId: string,
  ty: SeedCompany['types'],
  users: Record<string, SeedUser>,
): Promise<SeedTruck[]> {
  const out: SeedTruck[] = [];
  for (const t of TRUCKS) {
    const driver = t.driver ? (users[t.driver]?.id ?? null) : null;
    const w = await c.owner.post<{ id: string }>(
      '/warehouses',
      {
        name: t.name,
        type: 'VEHICLE',
        assignedUserId: driver,
        ...(t.code ? { code: t.code } : {}),
        ...(t.type ? { vehicleTypeId: ty[t.type]!.id } : {}),
        ...(t.wilayaCode ? { wilayaCode: t.wilayaCode } : {}),
        ...(t.plateNumber ? { plateNumber: t.plateNumber } : {}),
        ...(t.capacityKg ? { capacityKg: t.capacityKg } : {}),
      },
      null,
    );
    if (t.parent === 'secondary') {
      await c.owner.patch(`/warehouses/${w.id}`, { parentWarehouseId: secondaryId });
    }
    out.push({
      id: w.id,
      code: t.code,
      name: t.name,
      type: t.type,
      parent: t.parent,
      driver: driver ? t.driver : null,
    });
  }
  return out;
}

async function companyA(): Promise<{ seed: SeedCompany; history: SeedHistory[] }> {
  const c = await company('T36 A', { edition: 'DISTRIBUTION' });
  const manager = await invite(c, 'MANAGER');
  const supervisor = await invite(c, 'SUPERVISOR');
  const seller1 = await invite(c, 'SELLER', supervisor.id);
  const seller2 = await invite(c, 'SELLER', supervisor.id);
  const seller3 = await invite(c, 'SELLER');
  const livreur1 = await invite(c, 'LIVREUR');
  const livreur2 = await invite(c, 'LIVREUR');
  const storekeeper = await invite(c, 'STOREKEEPER');
  const users = {
    manager: user(manager),
    supervisor: user(supervisor),
    seller1: user(seller1),
    seller2: user(seller2),
    seller3: user(seller3),
    livreur1: user(livreur1),
    livreur2: user(livreur2),
    storekeeper: user(storekeeper),
  };

  const secondary = await c.owner.post<{ id: string }>(
    '/warehouses',
    { name: 'Dépôt Batna', type: 'SECONDARY', code: 'CDD BATNA 05' },
    null,
  );
  const ty = await types(c);
  const tr = await trucks(c, secondary.id, ty, users);
  const truck = (code: string) => tr.find((t) => t.code === code)!;
  // Phase 24: the manager and the supervisor work in the dépôt of Batna only (part B).
  for (const u of [manager, supervisor]) {
    await c.owner.put(`/users/${u.id}/access`, {
      access: [{ warehouseId: secondary.id, level: 'OPERATE' }],
    });
  }

  const p = await product(c, { priceHt: '1000', designation: 'Article T36' });
  await openingStock(c, p, '2000', '500');
  const clients: string[] = [];
  for (const name of ['Epicerie', 'Superette', 'Kiosque', 'Café', 'Grossiste', 'Boulangerie']) {
    clients.push(await client(c, name));
  }
  const transfer = async (type: string, from: string, to: string, qty: string) => {
    const draft = await c.owner.post<{ id: string }>('/stock-transfers', {
      type,
      fromWarehouseId: from,
      toWarehouseId: to,
      lines: [{ productId: p.id, unitId: p.unitId, qty }],
    });
    await c.owner.post(`/stock-transfers/${draft.id}/validate`, {});
  };
  const van = truck('VAN-28 MXT 01');
  const liv = truck('LIV 28 MIX');
  const prv = truck('PRV05-DD01');
  await transfer('LOAD', c.mainWarehouseId, van.id, '200');
  await transfer('LOAD', c.mainWarehouseId, liv.id, '200');

  // ---------------------------------------------------------------- history for part D
  const history: SeedHistory[] = [];
  const today = algiersToday();
  const weekdays = [0, 1, 2, 3, 4, 5, 6];
  const now = () => new Date().toISOString();

  // Old seller routes (the shape every route had before phase 36) and one vehicle route.
  for (const [who, name] of [
    [seller1, 'Tournée vendeur 1 (ancienne)'],
    [seller3, 'Tournée vendeur 3 (ancienne)'],
  ] as const) {
    const r = await c.owner.post<{ id: string }>('/routes', {
      name,
      sellerId: who.id,
      weekdays,
      active: true,
    });
    await c.owner.put(`/routes/${r.id}/stops`, { clientIds: clients.slice(0, 3) });
    history.push({
      kind: 'seller_route',
      id: r.id,
      backfillVehicleId: null,
      note: `${name}, seller ${who.id}`,
    });
  }
  const vr = await c.owner.post<{ id: string }>('/routes', {
    name: "Tournée VAN-28 M'sila",
    vehicleId: van.id,
    weekdays,
    active: true,
  });
  await c.owner.put(`/routes/${vr.id}/stops`, { clientIds: clients.slice(2, 6) });
  history.push({
    kind: 'vehicle_route',
    id: vr.id,
    backfillVehicleId: van.id,
    note: 'planned for the truck',
  });

  // Visits linked to van sales: seller 1 sells from the truck he drives.
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
    const v = await seller1.api.post<{ id: string }>('/visits', {
      clientId,
      startedAt,
      endedAt: now(),
      outcome: 'SALE',
      saleId: sale.sale.id,
    });
    history.push({
      kind: 'visit_van_sale',
      id: v.id,
      backfillVehicleId: van.id,
      note: `sale ${sale.sale.id} left the truck`,
    });
  }

  // Orders taken by the prévendeur, one delivered by the delivery truck, one from the dépôt.
  const takeOrder = async (clientId: string, warehouseId: string | null) => {
    const startedAt = now();
    const draft = await seller2.api.post<{ id: string }>('/orders', {
      clientId,
      ...(warehouseId ? { warehouseId } : {}),
      lines: [{ productId: p.id, unitId: p.unitId, qty: '5' }],
    });
    const order = await seller2.api.post<{ id: string; lines: { id: string }[] }>(
      `/orders/${draft.id}/confirm`,
      {},
    );
    const v = await seller2.api.post<{ id: string }>('/visits', {
      clientId,
      startedAt,
      endedAt: now(),
      outcome: 'ORDER',
      orderId: order.id,
    });
    return { order, visitId: v.id };
  };
  const byTruck = await takeOrder(clients[2]!, null);
  await c.owner.patch(`/orders/${byTruck.order.id}/livreur`, { deliveryVehicleId: liv.id });
  await livreur1.api.post(`/orders/${byTruck.order.id}/deliver`, {
    lines: [{ orderLineId: byTruck.order.lines[0]!.id, qty: '5' }],
    paidAmount: '0',
    paymentMode: 'ESPECES',
  });
  // The seller works in one dépôt, so his order carries it (ScopeService.onlyWarehouse) and
  // the BL leaves the dépôt principal even though a truck delivered: the backfill, which
  // only reads the BL's dépôt, cannot know the truck (the live path stored it).
  history.push({
    kind: 'order_on_truck_bl_from_depot',
    id: byTruck.order.id,
    backfillVehicleId: null,
    note: `put on truck ${liv.id}, BL left the dépôt principal`,
  });
  history.push({
    kind: 'visit_order',
    id: byTruck.visitId,
    backfillVehicleId: prv.id,
    note: "the order's own truck (prévendeur)",
  });

  // An order whose dépôt is the delivery truck itself (taken by the office): its BL leaves the truck.
  const officeDraft = await c.owner.post<{ id: string }>('/orders', {
    clientId: clients[4]!,
    sellerId: seller2.id,
    warehouseId: liv.id,
    lines: [{ productId: p.id, unitId: p.unitId, qty: '5' }],
  });
  const office = await c.owner.post<{ id: string; lines: { id: string }[] }>(
    `/orders/${officeDraft.id}/confirm`,
    {},
  );
  await c.owner.patch(`/orders/${office.id}/livreur`, { deliveryVehicleId: liv.id });
  await livreur1.api.post(`/orders/${office.id}/deliver`, {
    lines: [{ orderLineId: office.lines[0]!.id, qty: '5' }],
    paidAmount: '0',
    paymentMode: 'ESPECES',
  });
  history.push({
    kind: 'order_delivered_by_truck',
    id: office.id,
    backfillVehicleId: liv.id,
    note: 'BL left the delivery truck',
  });

  const fromMain = await takeOrder(clients[3]!, c.mainWarehouseId);
  await c.owner.post(`/orders/${fromMain.order.id}/deliver`, {
    lines: [{ orderLineId: fromMain.order.lines[0]!.id, qty: '5' }],
    paidAmount: '0',
    paymentMode: 'ESPECES',
  });
  history.push({
    kind: 'order_delivered_from_main',
    id: fromMain.order.id,
    backfillVehicleId: null,
    note: 'BL left the dépôt principal: no delivery truck',
  });
  history.push({
    kind: 'visit_order',
    id: fromMain.visitId,
    backfillVehicleId: prv.id,
    note: "the order's own truck (prévendeur)",
  });

  // Visits with neither a sale nor an order: nothing tells the backfill which truck it was.
  for (const clientId of clients.slice(4, 6)) {
    const v = await seller3.api.post<{ id: string }>('/visits', {
      clientId,
      startedAt: now(),
      endedAt: now(),
      outcome: 'NO_SALE',
      reason: 'CLOSED',
    });
    history.push({
      kind: 'visit_neither',
      id: v.id,
      backfillVehicleId: null,
      note: 'no sale, no order: cannot be known',
    });
  }

  return {
    seed: {
      tenantId: c.tenantId,
      ownerToken: c.session.token,
      ownerId: c.session.userId,
      mainWarehouseId: c.mainWarehouseId,
      secondaryWarehouseId: secondary.id,
      users,
      types: ty,
      trucks: tr,
      productId: p.id,
      unitId: p.unitId,
      clientIds: clients,
    },
    history,
  };
}

async function companyB(): Promise<SeedCompany> {
  const c = await company('T36 B', { edition: 'DISTRIBUTION' });
  const seller = await invite(c, 'SELLER');
  const livreur = await invite(c, 'LIVREUR');
  const users = { seller1: user(seller), livreur1: user(livreur) };
  const secondary = await c.owner.post<{ id: string }>(
    '/warehouses',
    { name: 'Dépôt Batna', type: 'SECONDARY', code: 'CDD BATNA 05' },
    null,
  );
  const ty = await types(c);
  // The same codes as A; the drivers B does not have are left out.
  const tr = await trucks(c, secondary.id, ty, users);
  const p = await product(c, { priceHt: '1000', designation: 'Article T36 B' });
  await openingStock(c, p, '500', '500');
  const clients = [await client(c, 'Client B1'), await client(c, 'Client B2')];
  const r = await c.owner.post<{ id: string }>('/routes', {
    name: 'Tournée B',
    vehicleId: tr[0]!.id,
    weekdays: [0, 1, 2, 3, 4, 5, 6],
    active: true,
  });
  await c.owner.put(`/routes/${r.id}/stops`, { clientIds: clients });
  return {
    tenantId: c.tenantId,
    ownerToken: c.session.token,
    ownerId: c.session.userId,
    mainWarehouseId: c.mainWarehouseId,
    secondaryWarehouseId: secondary.id,
    users,
    types: ty,
    trucks: tr,
    productId: p.id,
    unitId: p.unitId,
    clientIds: clients,
  };
}

async function companyE(): Promise<SeedCompany> {
  const c = await company('T36 Essentiel', { edition: 'ESSENTIEL' });
  const seller = await invite(c, 'SELLER');
  return {
    tenantId: c.tenantId,
    ownerToken: c.session.token,
    ownerId: c.session.userId,
    mainWarehouseId: c.mainWarehouseId,
    secondaryWarehouseId: null,
    users: { seller1: user(seller) },
    types: {},
    trucks: [],
    productId: null,
    unitId: null,
    clientIds: [],
  };
}

const started = Date.now();
const a = await companyA();
const b = await companyB();
const essentiel = await companyE();
saveFixture({
  db: DB,
  createdAt: new Date().toISOString(),
  a: a.seed,
  b,
  essentiel,
  history: a.history,
});

// What the database holds, read as the owner role: the seed states its own result.
const rows = await query<{
  tenant: string;
  users: string;
  invited: string;
  types: string;
  trucks: string;
  assignments: string;
  routes: string;
  visits: string;
  orders: string;
}>(
  `SELECT t.name AS tenant,
     (SELECT count(*) FROM users u WHERE u."tenantId" = t.id) AS users,
     (SELECT count(*) FROM user_invitations i WHERE i."tenantId" = t.id AND i."usedAt" IS NOT NULL) AS invited,
     (SELECT count(*) FROM vehicle_types v WHERE v."tenantId" = t.id) AS types,
     (SELECT count(*) FROM warehouses w WHERE w."tenantId" = t.id AND w.type = 'VEHICLE') AS trucks,
     (SELECT count(*) FROM vehicle_assignments a WHERE a."tenantId" = t.id) AS assignments,
     (SELECT count(*) FROM routes r WHERE r."tenantId" = t.id) AS routes,
     (SELECT count(*) FROM visits v WHERE v."tenantId" = t.id) AS visits,
     (SELECT count(*) FROM orders o WHERE o."tenantId" = t.id) AS orders
   FROM tenants t WHERE t.id = ANY($1::uuid[]) ORDER BY t."createdAt"`,
  [[a.seed.tenantId, b.tenantId, essentiel.tenantId]],
);
console.table(rows);
const same = await query<{ code: string; n: string }>(
  `SELECT lower(w.code) AS code, count(DISTINCT w."tenantId") AS n FROM warehouses w
   WHERE w."tenantId" = ANY($1::uuid[]) AND w.code IS NOT NULL GROUP BY 1 ORDER BY 1`,
  [[a.seed.tenantId, b.tenantId]],
);
console.log(
  'codes held by both A and B:',
  same
    .filter((r) => r.n === '2')
    .map((r) => r.code)
    .join(', '),
);
console.log(
  `vehicles-seed: done in ${((Date.now() - started) / 1000).toFixed(1)} s, fixture in e2e/.auth/vehicles-fixture.json`,
);
await closeDb();
