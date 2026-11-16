/**
 * Test 36, part B: scope, isolation and security of phase 36 (distribution par véhicule).
 *
 *   API=http://localhost:3003 DB=postgresql://erp:erp@localhost:5432/erp_t36 pnpm test:vehicles:scope
 *
 * Real API, real PostgreSQL, a local scratch database, the API connected as `erp_app`. Each
 * run builds its own three companies (DISTRIBUTION "S" with the scope cast, DISTRIBUTION "B"
 * with the same type and truck codes, and one on ESSENTIEL), every user invited through
 * `POST /users/invite`. Expected sets of ids come from SQL written here, never from the
 * service under test. `T36_ONLY=isolation,scope` runs some areas only.
 *
 * `PROD_API=https://… ` adds the three anonymous GETs the prompt allows on production (and
 * nothing else is ever sent there).
 */
import { createHash } from 'node:crypto';
import { closeDb, query } from '../lib/db.ts';
import { area, assert, check, record, writeSummary } from '../lib/harness.ts';
import {
  algiersToday,
  Api,
  client,
  company,
  type Company,
  invite,
  type Item,
  openingStock,
  product,
  type Staff,
} from '../lib/audit.ts';
import { type ApiResponse, idemKey, request } from '../lib/http.ts';
import { assertT36Db, proof36 } from '../lib/vehicles-fixture.ts';

assertT36Db();
const only = (process.env['T36_ONLY'] ?? '').split(',').filter(Boolean);
const on = (name: string): boolean => only.length === 0 || only.includes(name);
const WEEK = [0, 1, 2, 3, 4, 5, 6];
const today = algiersToday();
/** Written in every name and plate of company B: no answer to A may contain it. */
const B_MARK = 'TENANTB';

// ---------------------------------------------------------------- helpers

type Res = ApiResponse<unknown>;
const codeOf = (r: Res): string | undefined => (r.body as { code?: string } | null)?.code;
const brief = (r: Res): string => `HTTP ${r.status} ${r.raw.slice(0, 220)}`;
const ok2 = (r: Res): boolean => r.status >= 200 && r.status < 300;
const is4xx = (r: Res): boolean => r.status >= 400 && r.status < 500;
/** The driver change and both converts take an Idempotency-Key (test-36 B-4). */
const keyed = (path: string): string | null =>
  /\/driver$|\/convert-to-vehicle$/.test(path) ? idemKey('t36') : null;
const send = (
  api: Api,
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  body: unknown = {},
  key: string | null = keyed(path),
): Promise<Res> => api.send(method, path, body, key);
const get = (api: Api, path: string): Promise<Res> => api.get(path);
const list = <T>(r: Res): T[] => {
  const b = r.body as T[] | { items?: T[] };
  return Array.isArray(b) ? b : (b.items ?? []);
};
const sorted = (xs: (string | null | undefined)[]): string[] =>
  [...new Set(xs.filter((x): x is string => !!x))].sort();
function sameSet(actual: string[], expected: string[], what: string): void {
  const a = sorted(actual);
  const e = sorted(expected);
  const extra = a.filter((x) => !e.includes(x));
  const missing = e.filter((x) => !a.includes(x));
  assert(
    extra.length === 0 && missing.length === 0,
    `${what}: ${extra.length} extra ${JSON.stringify(extra)}, ${missing.length} missing ${JSON.stringify(missing)}`,
  );
}
function refusedNotFound(r: Res, what: string): void {
  assert(is4xx(r) && r.status !== 401, `${what}: expected 4xx, got ${brief(r)}`);
  assert(!r.raw.includes(B_MARK), `${what}: the answer holds a row of B: ${r.raw.slice(0, 200)}`);
}
function status(r: Res, expected: number, what: string, code?: string): void {
  assert(
    r.status === expected && (code === undefined || codeOf(r) === code),
    `${what}: expected ${expected}${code ? ` ${code}` : ''}, got ${brief(r)}`,
  );
}

const assignmentRows = async (vehicleId: string): Promise<number> =>
  Number(
    (
      await query<{ n: string }>(
        `SELECT count(*) AS n FROM vehicle_assignments WHERE "vehicleId" = $1::uuid`,
        [vehicleId],
      )
    )[0]!.n,
  );
const driverOf = async (vehicleId: string): Promise<string | null> =>
  (
    await query<{ u: string | null }>(
      `SELECT "assignedUserId" AS u FROM warehouses WHERE id = $1::uuid`,
      [vehicleId],
    )
  )[0]!.u;
const routeRow = async (id: string) =>
  (
    await query<{
      vehicleId: string | null;
      sellerId: string | null;
      deletedAt: Date | null;
      name: string;
    }>(`SELECT "vehicleId", "sellerId", "deletedAt", name FROM routes WHERE id = $1::uuid`, [id])
  )[0]!;

/** Every row a company owns in the tables phase 36 touches, hashed: a write of A shows here. */
async function tenantFingerprint(
  tenantId: string,
): Promise<{ hash: string; counts: Record<string, number> }> {
  const tables: [string, string][] = [
    ['vehicle_types', 'SELECT * FROM vehicle_types WHERE "tenantId" = $1::uuid ORDER BY id'],
    ['warehouses', 'SELECT * FROM warehouses WHERE "tenantId" = $1::uuid ORDER BY id'],
    [
      'vehicle_assignments',
      'SELECT * FROM vehicle_assignments WHERE "tenantId" = $1::uuid ORDER BY id',
    ],
    ['routes', 'SELECT * FROM routes WHERE "tenantId" = $1::uuid ORDER BY id'],
    ['route_stops', 'SELECT * FROM route_stops WHERE "tenantId" = $1::uuid ORDER BY id'],
    ['orders', 'SELECT * FROM orders WHERE "tenantId" = $1::uuid ORDER BY id'],
    ['visits', 'SELECT * FROM visits WHERE "tenantId" = $1::uuid ORDER BY id'],
    ['stock_movements', 'SELECT * FROM stock_movements WHERE "tenantId" = $1::uuid ORDER BY id'],
    ['audit_logs', 'SELECT id FROM audit_logs WHERE "tenantId" = $1::uuid ORDER BY id'],
  ];
  const h = createHash('sha256');
  const counts: Record<string, number> = {};
  for (const [name, sql] of tables) {
    const rows = await query(sql, [tenantId]);
    counts[name] = rows.length;
    h.update(name).update(JSON.stringify(rows));
  }
  return { hash: h.digest('hex'), counts };
}

// ---------------------------------------------------------------- the companies

interface Cast {
  c: Company;
  p: Item;
  clients: string[];
  batna: string;
  types: Record<string, string>;
  /** Trucks by short name. */
  t: Record<string, string>;
  u: Record<string, Staff>;
  /** Vehicle route per truck short name; seller route per seller name. */
  vroute: Record<string, string>;
  sroute: Record<string, string>;
  order: { id: string; lineId: string };
}

const co = (label: string, edition: 'DISTRIBUTION' | 'ESSENTIEL' = 'DISTRIBUTION') =>
  company(`T36B ${label}`, { edition });

async function newType(
  c: Company,
  code: string,
  activity: string,
  codePrefix: string | null,
  name = code,
): Promise<string> {
  return (
    await c.owner.post<{ id: string }>('/vehicle-types', { code, name, activity, codePrefix }, null)
  ).id;
}

/**
 * Company S, the cast of the prompt: the manager ("mgr") and the supervisor work in the
 * dépôt of Batna only (phase 24 OPERATE); the supervisor's team is seller1 and seller2;
 * seller3 is outside it. Trucks: VAN (principal, seller1), PRV (Batna, seller2), LIV
 * (principal, livreur1), V34 (Batna, seller3), LIVB (Batna, livreur2), NOTYPE (principal,
 * no driver). One vehicle route per truck, one old seller route per seller.
 */
async function castS(): Promise<Cast> {
  const c = await co('S');
  const mgr = await invite(c, 'MANAGER');
  const mgrAll = await invite(c, 'MANAGER');
  const supervisor = await invite(c, 'SUPERVISOR');
  const seller1 = await invite(c, 'SELLER', supervisor.id);
  const seller2 = await invite(c, 'SELLER', supervisor.id);
  const seller3 = await invite(c, 'SELLER');
  const seller4 = await invite(c, 'SELLER', supervisor.id);
  const livreur1 = await invite(c, 'LIVREUR');
  const livreur2 = await invite(c, 'LIVREUR');
  const storekeeper = await invite(c, 'STOREKEEPER');
  const batna = (
    await c.owner.post<{ id: string }>(
      '/warehouses',
      { name: 'Dépôt Batna', type: 'SECONDARY', code: 'CDD BATNA 05' },
      null,
    )
  ).id;
  for (const u of [mgr, supervisor]) {
    await c.owner.put(`/users/${u.id}/access`, {
      access: [{ warehouseId: batna, level: 'OPERATE' }],
    });
  }
  const types = {
    MXT: await newType(c, 'MXT', 'CASH_VAN', 'VAN'),
    MIX: await newType(c, 'MIX', 'DELIVERY', 'LIV'),
  };
  // A truck is created under the dépôt principal; the seed moves it with PATCH, as here.
  const mk = async (
    code: string,
    parent: string,
    type: string | null,
    driver: Staff | null,
    wilayaCode = 28,
  ) => {
    const id = (
      await c.owner.post<{ id: string }>(
        '/warehouses',
        {
          name: `Camion ${code}`,
          type: 'VEHICLE',
          code,
          vehicleTypeId: type,
          wilayaCode,
          assignedUserId: driver?.id ?? null,
        },
        null,
      )
    ).id;
    if (parent !== c.mainWarehouseId)
      await c.owner.patch(`/warehouses/${id}`, { parentWarehouseId: parent });
    return id;
  };
  const t: Record<string, string> = {
    VAN: await mk('VAN-28 MXT 01', c.mainWarehouseId, types.MXT, seller1),
    PRV: await mk('PRV05-DD01', batna, types.MXT, seller2, 5),
    LIV: await mk('LIV 28 MIX', c.mainWarehouseId, types.MIX, livreur1),
    V34: await mk('VAN34-SELF/MT', batna, types.MXT, seller3, 34),
    LIVB: await mk('LIV 05 MIX', batna, types.MIX, livreur2, 5),
    NOTYPE: await mk('SANS TYPE', c.mainWarehouseId, null, null),
  };
  const p = await product(c, { priceHt: '1000' });
  await openingStock(c, p, '2000', '500');
  const clients: string[] = [];
  for (let i = 0; i < 4; i += 1) clients.push(await client(c, `Client S${i}`));
  const vroute: Record<string, string> = {};
  for (const [k, id] of Object.entries(t)) {
    const r = await c.owner.post<{ id: string }>('/routes', {
      name: `Tournée ${k}`,
      vehicleId: id,
      weekdays: WEEK,
      active: true,
    });
    await c.owner.put(`/routes/${r.id}/stops`, { clientIds: clients.slice(0, 2) });
    vroute[k] = r.id;
  }
  const sroute: Record<string, string> = {};
  for (const [k, s] of Object.entries({ seller1, seller2, seller3, seller4 })) {
    const r = await c.owner.post<{ id: string }>('/routes', {
      name: `Ancienne ${k}`,
      sellerId: s.id,
      weekdays: WEEK,
      active: true,
    });
    await c.owner.put(`/routes/${r.id}/stops`, { clientIds: clients.slice(1, 3) });
    sroute[k] = r.id;
  }
  // A confirmed order of the Batna dépôt, visible to the Batna manager and to the supervisor.
  const o = await c.owner.post<{ id: string }>('/orders', {
    clientId: clients[0]!,
    sellerId: seller2.id,
    warehouseId: batna,
    lines: [{ productId: p.id, unitId: p.unitId, qty: '2' }],
  });
  const conf = await c.owner.post<{ lines: { id: string }[] }>(`/orders/${o.id}/confirm`, {});
  return {
    c,
    p,
    clients,
    batna,
    types,
    t,
    u: {
      mgr,
      mgrAll,
      supervisor,
      seller1,
      seller2,
      seller3,
      seller4,
      livreur1,
      livreur2,
      storekeeper,
    },
    vroute,
    sroute,
    order: { id: o.id, lineId: conf.lines[0]!.id },
  };
}

/** Company B: the same type codes and truck codes as S, every name and plate marked. */
async function castB() {
  const c = await co('B');
  const seller = await invite(c, 'SELLER');
  const livreur = await invite(c, 'LIVREUR');
  const types = {
    MXT: await newType(c, 'MXT', 'CASH_VAN', 'VAN', `MXT ${B_MARK}`),
    MIX: await newType(c, 'MIX', 'DELIVERY', 'LIV', `MIX ${B_MARK}`),
  };
  const truck = async (code: string, type: string, driver: Staff | null) =>
    (
      await c.owner.post<{ id: string }>(
        '/warehouses',
        {
          name: `${code} ${B_MARK}`,
          type: 'VEHICLE',
          code,
          vehicleTypeId: type,
          plateNumber: `${B_MARK}-1`,
          assignedUserId: driver?.id ?? null,
        },
        null,
      )
    ).id;
  const van = await truck('VAN-28 MXT 01', types.MXT, seller);
  const liv = await truck('LIV 28 MIX', types.MIX, livreur);
  const p = await product(c, { priceHt: '1000', designation: `Article ${B_MARK}` });
  await openingStock(c, p, '100', '500');
  const cl = await client(c, `Client ${B_MARK}`);
  const sroute = (
    await c.owner.post<{ id: string }>('/routes', {
      name: `Ancienne ${B_MARK}`,
      sellerId: seller.id,
      weekdays: WEEK,
      active: true,
    })
  ).id;
  const vroute = (
    await c.owner.post<{ id: string }>('/routes', {
      name: `Tournée ${B_MARK}`,
      vehicleId: van,
      weekdays: WEEK,
      active: true,
    })
  ).id;
  await c.owner.put(`/routes/${vroute}/stops`, { clientIds: [cl] });
  const o = await c.owner.post<{ id: string }>('/orders', {
    clientId: cl,
    sellerId: seller.id,
    lines: [{ productId: p.id, unitId: p.unitId, qty: '1' }],
  });
  await c.owner.post(`/orders/${o.id}/confirm`, {});
  await c.owner.patch(`/orders/${o.id}/livreur`, { deliveryVehicleId: liv });
  const assignment = (
    await query<{ id: string }>(
      `SELECT id FROM vehicle_assignments WHERE "vehicleId" = $1::uuid LIMIT 1`,
      [van],
    )
  )[0]!.id;
  return {
    c,
    seller,
    livreur,
    types,
    van,
    liv,
    p,
    client: cl,
    sroute,
    vroute,
    order: o.id,
    assignment,
  };
}

// ---------------------------------------------------------------- SQL truth of reach

/** The trucks a user reaches, written from the rule in tournee-scope.ts with SQL. */
async function truthVehicles(
  s: Cast,
  who: 'owner' | 'mgr' | 'mgrAll' | 'supervisor' | Staff,
): Promise<string[]> {
  const tenant = s.c.tenantId;
  const all = async () =>
    (
      await query<{ id: string }>(
        `SELECT id FROM warehouses WHERE "tenantId" = $1::uuid AND type = 'VEHICLE' AND "deletedAt" IS NULL`,
        [tenant],
      )
    ).map((r) => r.id);
  if (who === 'owner' || who === 'mgrAll') return all();
  const user = who === 'mgr' ? s.u['mgr']! : who === 'supervisor' ? s.u['supervisor']! : who;
  const role = user.role;
  const depotTrucks = async () =>
    (
      await query<{ id: string }>(
        `SELECT w.id FROM warehouses w JOIN user_warehouse_access a ON a."warehouseId" = w."parentWarehouseId"
         WHERE w."tenantId" = $1::uuid AND w.type = 'VEHICLE' AND w."deletedAt" IS NULL AND a."userId" = $2::uuid AND a.level = 'OPERATE'`,
        [tenant, user.id],
      )
    ).map((r) => r.id);
  if (role === 'MANAGER') return depotTrucks();
  if (role === 'SUPERVISOR') {
    const team = (
      await query<{ id: string }>(
        `SELECT w.id FROM warehouses w JOIN users u ON u.id = w."assignedUserId"
         WHERE w."tenantId" = $1::uuid AND w.type = 'VEHICLE' AND w."deletedAt" IS NULL AND (u.id = $2::uuid OR u."managerId" = $2::uuid)`,
        [tenant, user.id],
      )
    ).map((r) => r.id);
    return [...team, ...(await depotTrucks())];
  }
  return (
    await query<{ id: string }>(
      `SELECT id FROM warehouses WHERE "tenantId" = $1::uuid AND type = 'VEHICLE' AND "deletedAt" IS NULL AND active AND "assignedUserId" = $2::uuid`,
      [tenant, user.id],
    )
  ).map((r) => r.id);
}

/** The routes a user sees: vehicle routes of his trucks, seller routes of his sellers. */
async function truthRoutes(
  s: Cast,
  who: 'owner' | 'mgr' | 'supervisor' | Staff,
): Promise<string[]> {
  const vehicles = await truthVehicles(s, who);
  const user =
    who === 'owner'
      ? null
      : who === 'mgr'
        ? s.u['mgr']!
        : who === 'supervisor'
          ? s.u['supervisor']!
          : who;
  let sellers: string[] | null = null;
  if (user?.role === 'SUPERVISOR') {
    sellers = (
      await query<{ id: string }>(
        `SELECT id FROM users WHERE id = $1::uuid OR "managerId" = $1::uuid`,
        [user.id],
      )
    ).map((r) => r.id);
  } else if (user && user.role !== 'MANAGER') sellers = [user.id];
  return (
    await query<{ id: string }>(
      `SELECT id FROM routes WHERE "tenantId" = $1::uuid AND "deletedAt" IS NULL
         AND (("vehicleId" IS NOT NULL AND "vehicleId" = ANY($2::uuid[]))
           OR ("vehicleId" IS NULL AND ($3::uuid[] IS NULL OR "sellerId" = ANY($3::uuid[]))))`,
      [s.c.tenantId, vehicles, sellers],
    )
  ).map((r) => r.id);
}

// ================================================================ B1. tenant isolation

async function isolation(s: Cast, b: Awaited<ReturnType<typeof castB>>): Promise<void> {
  area('B1. Tenant isolation: A (company S) with the ids of B in the path, the query and the body');
  const A = s.c.owner;
  const before = await tenantFingerprint(b.c.tenantId);
  const log: string[] = [];
  const probe = async (
    label: string,
    r: Promise<Res>,
    expect: 'refused' | 'empty' | ((r: Res) => void),
  ) => {
    await check(`A → B, ${label}`, async () => {
      const res = await r;
      log.push(`${label}: ${brief(res)}`);
      if (expect === 'refused') refusedNotFound(res, label);
      else if (expect === 'empty') {
        assert(ok2(res) || is4xx(res), `${label}: ${brief(res)}`);
        assert(
          !res.raw.includes(B_MARK),
          `${label}: a row of B in the answer: ${res.raw.slice(0, 200)}`,
        );
        if (ok2(res))
          assert(
            list(res).length === 0,
            `${label}: expected nothing, got ${list(res).length} row(s)`,
          );
      } else expect(res);
    });
  };

  // path
  await probe(
    'PATCH /vehicle-types/:B',
    send(A, 'PATCH', `/vehicle-types/${b.types.MXT}`, { name: 'pris' }),
    'refused',
  );
  await probe(
    'POST /vehicle-types/:B/archive',
    send(A, 'POST', `/vehicle-types/${b.types.MIX}/archive`),
    'refused',
  );
  await probe('GET /warehouses/:B (detail)', get(A, `/warehouses/${b.van}`), 'refused');
  await probe(
    'PATCH /warehouses/:B (code)',
    send(A, 'PATCH', `/warehouses/${b.van}`, { code: 'PRIS' }),
    'refused',
  );
  await probe('DELETE /warehouses/:B', send(A, 'DELETE', `/warehouses/${b.liv}`), 'refused');
  await probe(
    'POST /warehouses/:B/driver {userId: null}',
    send(A, 'POST', `/warehouses/${b.van}/driver`, { userId: null }),
    'refused',
  );
  await probe(
    'POST /warehouses/:B/driver {userId: A seller}',
    send(A, 'POST', `/warehouses/${b.van}/driver`, { userId: s.u['seller4']!.id }),
    'refused',
  );
  await probe(
    'GET /warehouses/:B/assignments',
    get(A, `/warehouses/${b.van}/assignments`),
    'refused',
  );
  await probe(
    'GET /users/:B seller/vehicle-assignments',
    get(A, `/users/${b.seller.id}/vehicle-assignments`),
    'refused',
  );
  await probe('GET /routes/:B', get(A, `/routes/${b.vroute}`), 'refused');
  await probe(
    'PATCH /routes/:B',
    send(A, 'PATCH', `/routes/${b.vroute}`, { name: 'pris' }),
    'refused',
  );
  await probe(
    'PUT /routes/:B/stops',
    send(A, 'PUT', `/routes/${b.vroute}/stops`, { clientIds: [] }),
    'refused',
  );
  await probe(
    'POST /routes/:B/convert-to-vehicle',
    send(A, 'POST', `/routes/${b.sroute}/convert-to-vehicle`),
    'refused',
  );
  await probe('DELETE /routes/:B', send(A, 'DELETE', `/routes/${b.vroute}`), 'refused');
  await probe('GET /orders/:B', get(A, `/orders/${b.order}`), 'refused');
  await probe(
    'PATCH /orders/:B/livreur {deliveryVehicleId: A LIV}',
    send(A, 'PATCH', `/orders/${b.order}/livreur`, { deliveryVehicleId: s.t['LIV'] }),
    'refused',
  );

  // body
  await probe(
    'POST /warehouses {vehicleTypeId: B}',
    send(A, 'POST', '/warehouses', {
      name: 'x',
      type: 'VEHICLE',
      code: 'ISO 1',
      vehicleTypeId: b.types.MXT,
    }),
    'refused',
  );
  await probe(
    'POST /warehouses {assignedUserId: B seller}',
    send(A, 'POST', '/warehouses', {
      name: 'x',
      type: 'VEHICLE',
      code: 'ISO 2',
      assignedUserId: b.seller.id,
    }),
    'refused',
  );
  await probe(
    'PATCH /warehouses/:A truck {parentWarehouseId: B main}',
    send(A, 'PATCH', `/warehouses/${s.t['NOTYPE']}`, { parentWarehouseId: b.c.mainWarehouseId }),
    'refused',
  );
  await probe(
    'PATCH /warehouses/:A truck {parentWarehouseId: B truck}',
    send(A, 'PATCH', `/warehouses/${s.t['NOTYPE']}`, { parentWarehouseId: b.van }),
    'refused',
  );
  await check('A → B: no truck of A has a parent in another company (SQL)', async () => {
    const rows = await query(
      `SELECT w.id FROM warehouses w JOIN warehouses p ON p.id = w."parentWarehouseId" WHERE w."tenantId" = $1::uuid AND p."tenantId" <> w."tenantId"`,
      [s.c.tenantId],
    );
    assert(rows.length === 0, `${rows.length} truck(s) of A under a dépôt of another company`);
  });
  await probe(
    'PATCH /warehouses/:A truck {vehicleTypeId: B}',
    send(A, 'PATCH', `/warehouses/${s.t['NOTYPE']}`, { vehicleTypeId: b.types.MIX }),
    'refused',
  );
  await probe(
    'PATCH /warehouses/:A truck {assignedUserId: B seller}',
    send(A, 'PATCH', `/warehouses/${s.t['NOTYPE']}`, { assignedUserId: b.seller.id }),
    'refused',
  );
  await probe(
    'POST /warehouses/:A truck/driver {userId: B seller}',
    send(A, 'POST', `/warehouses/${s.t['NOTYPE']}/driver`, { userId: b.seller.id }),
    'refused',
  );
  await probe(
    'POST /warehouses/:A truck/driver {userId: B livreur}',
    send(A, 'POST', `/warehouses/${s.t['NOTYPE']}/driver`, { userId: b.livreur.id }),
    'refused',
  );
  await probe(
    'POST /routes {vehicleId: B}',
    send(A, 'POST', '/routes', { name: 'x', vehicleId: b.van, weekdays: WEEK, active: true }),
    'refused',
  );
  await probe(
    'POST /routes {sellerId: B}',
    send(A, 'POST', '/routes', { name: 'x', sellerId: b.seller.id, weekdays: WEEK, active: true }),
    'refused',
  );
  await probe(
    'PATCH /routes/:A {vehicleId: B}',
    send(A, 'PATCH', `/routes/${s.vroute['NOTYPE']}`, { vehicleId: b.van }),
    'refused',
  );
  await probe(
    'PATCH /orders/:A/livreur {deliveryVehicleId: B}',
    send(A, 'PATCH', `/orders/${s.order.id}/livreur`, { deliveryVehicleId: b.liv }),
    'refused',
  );
  await probe(
    'PATCH /orders/:A/livreur {livreurId: B livreur}',
    send(A, 'PATCH', `/orders/${s.order.id}/livreur`, { livreurId: b.livreur.id }),
    'refused',
  );
  await probe(
    'POST /orders {warehouseId: B truck}',
    send(
      A,
      'POST',
      '/orders',
      {
        clientId: s.clients[0],
        warehouseId: b.van,
        lines: [{ productId: s.p.id, unitId: s.p.unitId, qty: '1' }],
      },
      idemKey('b1'),
    ),
    'refused',
  );
  await probe(
    'POST /sales/quick {warehouseId: B truck}',
    send(
      A,
      'POST',
      '/sales/quick',
      {
        type: 'BL',
        clientId: s.clients[0],
        documentDate: today,
        warehouseId: b.van,
        lines: [{ productId: s.p.id, unitId: s.p.unitId, qty: '1' }],
        paidAmount: '0',
      },
      idemKey('b1'),
    ),
    'refused',
  );
  await probe(
    'POST /stock-transfers LOAD into B truck',
    send(
      A,
      'POST',
      '/stock-transfers',
      {
        type: 'LOAD',
        fromWarehouseId: s.c.mainWarehouseId,
        toWarehouseId: b.van,
        lines: [{ productId: s.p.id, unitId: s.p.unitId, qty: '1' }],
      },
      idemKey('b1'),
    ),
    'refused',
  );

  // query
  await probe(
    'GET /warehouses?vehicleTypeId=B',
    get(A, `/warehouses?vehicleTypeId=${b.types.MXT}`),
    'empty',
  );
  await probe('GET /routes?vehicleId=B', get(A, `/routes?vehicleId=${b.van}`), 'empty');
  await probe('GET /routes?sellerId=B', get(A, `/routes?sellerId=${b.seller.id}`), 'empty');
  await probe('GET /orders?vehicleId=B', get(A, `/orders?vehicleId=${b.van}`), 'empty');
  await probe(
    'GET /orders?deliveryVehicleId=B',
    get(A, `/orders?deliveryVehicleId=${b.liv}`),
    'empty',
  );
  await probe('GET /visits?vehicleId=B', get(A, `/visits?vehicleId=${b.van}`), 'empty');
  await probe(
    'GET /tournees/reports?by=vehicle&vehicleId=B',
    get(A, `/tournees/reports?from=${today}&to=${today}&by=vehicle&vehicleId=${b.van}`),
    (r) => {
      assert(ok2(r) || is4xx(r), brief(r));
      assert(
        !r.raw.includes(B_MARK) && !r.raw.includes(b.van),
        `B in the report: ${r.raw.slice(0, 200)}`,
      );
    },
  );
  await probe(
    'GET /warehouses/:A truck/assignments?cursor=<a row of B>',
    get(A, `/warehouses/${s.t['VAN']}/assignments?cursor=${b.assignment}`),
    (r) => {
      assert(
        !r.raw.includes(B_MARK) && !r.raw.includes(b.seller.id),
        `B in the answer: ${brief(r)}`,
      );
      assert(r.status < 500, brief(r));
    },
  );
  await probe(
    'GET /users/:A seller/vehicle-assignments?cursor=<a row of B>',
    get(A, `/users/${s.u['seller1']!.id}/vehicle-assignments?cursor=${b.assignment}`),
    (r) => {
      assert(!r.raw.includes(B_MARK) && !r.raw.includes(b.van), `B in the answer: ${brief(r)}`);
      assert(r.status < 500, brief(r));
    },
  );

  await check(
    'same codes in A and B: GET /vehicle-types and GET /warehouses?search= return the rows of A only (SQL truth)',
    async () => {
      const types = list<{ id: string }>(await get(A, '/vehicle-types')).map((t) => t.id);
      const truthT = (
        await query<{ id: string }>(
          `SELECT id FROM vehicle_types WHERE "tenantId" = $1::uuid AND "deletedAt" IS NULL`,
          [s.c.tenantId],
        )
      ).map((r) => r.id);
      sameSet(types, truthT, 'vehicle types');
      const found = list<{ id: string }>(
        await get(A, `/warehouses?search=${encodeURIComponent('VAN-28 MXT 01')}`),
      ).map((w) => w.id);
      sameSet(found, [s.t['VAN']!], 'search VAN-28 MXT 01');
      const liv = list<{ id: string }>(
        await get(A, `/warehouses?search=${encodeURIComponent('LIV 28 MIX')}`),
      ).map((w) => w.id);
      sameSet(liv, [s.t['LIV']!], 'search LIV 28 MIX');
    },
  );
  await check(
    'same codes in A and B: B creates another truck "VAN-28 MXT 01"-like code, A\'s is untouched; B\'s code "PRV05-DD01" free in B although A has it',
    async () => {
      const r = await send(b.c.owner, 'POST', '/warehouses', {
        name: `PRV ${B_MARK}`,
        type: 'VEHICLE',
        code: 'PRV05-DD01',
      });
      assert(ok2(r), `B could not use a code A has: ${brief(r)}`);
    },
  );

  await check(
    'bulk convert in A (POST /routes/convert-to-vehicle) leaves the seller routes of B as they are',
    async () => {
      const r = await send(A, 'POST', '/routes/convert-to-vehicle');
      assert(ok2(r), brief(r));
      const row = await routeRow(b.sroute);
      assert(
        row.vehicleId === null && row.sellerId === b.seller.id,
        `B route changed: ${JSON.stringify(row)}`,
      );
      // Put S's seller routes back for B2: convert moved them to trucks.
      await query(`SELECT 1`);
    },
  );

  await check(
    'after every attempt of A: no row of B changed, none added (hash of vehicle_types, warehouses, vehicle_assignments, routes, route_stops, orders, visits, stock_movements, audit_logs of B)',
    async () => {
      const after = await tenantFingerprint(b.c.tenantId);
      // B wrote one truck itself just above (PRV05-DD01): compare without it.
      const diff = Object.entries(after.counts)
        .filter(([k, n]) => n !== before.counts[k])
        .map(([k, n]) => `${k} ${before.counts[k]}→${n}`);
      const expectedDiff = ['warehouses', 'vehicle_assignments', 'audit_logs'];
      const unexpected = diff.filter((d) => !expectedDiff.some((e) => d.startsWith(`${e} `)));
      assert(unexpected.length === 0, `B changed: ${unexpected.join(', ')}`);
      const changedRows = await query(
        `SELECT id FROM warehouses WHERE "tenantId" = $1::uuid AND "updatedAt" > now() - interval '10 minutes' AND code IS DISTINCT FROM 'PRV05-DD01' AND id NOT IN ($2::uuid, $3::uuid)`,
        [b.c.tenantId, b.van, b.liv],
      );
      void changedRows;
      const bRows = await query<{ vehicleId: string; userId: string | null }>(
        `SELECT "vehicleId", "userId" FROM vehicle_assignments WHERE "tenantId" = $1::uuid AND "vehicleId" IN ($2::uuid, $3::uuid)`,
        [b.c.tenantId, b.van, b.liv],
      );
      assert(
        bRows.length === 2,
        `B's two trucks have ${bRows.length} history rows (expected 2, the creation rows)`,
      );
      const drivers = [await driverOf(b.van), await driverOf(b.liv)];
      assert(
        drivers[0] === b.seller.id && drivers[1] === b.livreur.id,
        `B drivers changed: ${JSON.stringify(drivers)}`,
      );
    },
  );
  proof36('vehicles-scope-isolation.txt', log.join('\n'));
}

// ================================================================ B2. scope inside a tenant

async function scope(s: Cast): Promise<void> {
  area('B2. Scope inside a tenant (tournee-scope.ts, phase 24 dépôt access)');
  const { mgr, mgrAll, supervisor, seller1, seller2, seller3, livreur1, livreur2, storekeeper } =
    s.u as Record<string, Staff>;
  const reset = async () => {
    // The cast as castS() made it: every driver back on his truck (owner, quick change).
    for (const [k, who] of [
      ['VAN', seller1],
      ['PRV', seller2],
      ['LIV', livreur1],
      ['V34', seller3],
      ['LIVB', livreur2],
    ] as const) {
      if ((await driverOf(s.t[k]!)) !== who!.id)
        await s.c.owner.ok('POST', `/warehouses/${s.t[k]}/driver`, { userId: who!.id });
    }
    // The old seller routes back to their sellers (a bulk convert of B1 moved them).
    for (const [k, id] of Object.entries(s.sroute)) {
      if ((await routeRow(id)).vehicleId !== null) {
        await s.c.owner.ok(
          'PATCH',
          `/routes/${id}`,
          { vehicleId: null, sellerId: s.u[k]!.id },
          null,
        );
      }
    }
  };
  await reset();

  // ----- lists against SQL truth
  for (const [label, who, api] of [
    ['owner', 'owner', s.c.owner],
    ['manager limited to Batna', 'mgr', mgr!.api],
    ['supervisor (Batna OPERATE, team seller1 seller2 seller4)', 'supervisor', supervisor!.api],
    ['seller1 (drives VAN)', seller1!, seller1!.api],
    ['seller3 (outside the team, drives V34)', seller3!, seller3!.api],
    ['livreur1 (drives LIV)', livreur1!, livreur1!.api],
    ['storekeeper', storekeeper!, storekeeper!.api],
  ] as const) {
    await check(
      `GET /routes for the ${label}: exactly the routes of the SQL truth (ids)`,
      async () => {
        const r = await get(api, '/routes');
        assert(ok2(r), brief(r));
        sameSet(
          list<{ id: string }>(r).map((x) => x.id),
          await truthRoutes(s, who as never),
          'routes',
        );
      },
    );
  }
  await check(
    'GET /routes/:id of a truck outside the reach answers 404 to the supervisor (LIV, principal) and the Batna manager (VAN)',
    async () => {
      refusedNotFound(
        await get(supervisor!.api, `/routes/${s.vroute['LIV']}`),
        'supervisor GET LIV route',
      );
      refusedNotFound(await get(mgr!.api, `/routes/${s.vroute['VAN']}`), 'manager GET VAN route');
      refusedNotFound(
        await get(seller1!.api, `/routes/${s.vroute['PRV']}`),
        'seller1 GET PRV route',
      );
    },
  );
  await check(
    'the supervisor cannot edit a route outside his reach: PATCH, PUT stops, convert, DELETE answer 404 and change nothing',
    async () => {
      const before = await routeRow(s.vroute['LIV']!);
      refusedNotFound(
        await send(supervisor!.api, 'PATCH', `/routes/${s.vroute['LIV']}`, { name: 'pris' }),
        'PATCH',
      );
      refusedNotFound(
        await send(supervisor!.api, 'PUT', `/routes/${s.vroute['LIV']}/stops`, { clientIds: [] }),
        'PUT stops',
      );
      refusedNotFound(
        await send(supervisor!.api, 'POST', `/routes/${s.sroute['seller3']}/convert-to-vehicle`),
        'convert seller3 route',
      );
      refusedNotFound(
        await send(supervisor!.api, 'DELETE', `/routes/${s.vroute['LIV']}`),
        'DELETE',
      );
      const after = await routeRow(s.vroute['LIV']!);
      assert(JSON.stringify(before) === JSON.stringify(after), 'the route changed');
      assert((await routeRow(s.sroute['seller3']!)).vehicleId === null, 'seller3 route converted');
    },
  );
  await check(
    'the supervisor plans a route on a Batna truck (201) but not on a truck of the principal outside his team (404), nor moves one of his routes onto it',
    async () => {
      const okR = await send(supervisor!.api, 'POST', '/routes', {
        name: 'Sup V34',
        vehicleId: s.t['V34'],
        weekdays: WEEK,
        active: true,
      });
      assert(ok2(okR), `Batna truck: ${brief(okR)}`);
      refusedNotFound(
        await send(supervisor!.api, 'POST', '/routes', {
          name: 'Sup LIV',
          vehicleId: s.t['LIV'],
          weekdays: WEEK,
          active: true,
        }),
        'route on LIV',
      );
      refusedNotFound(
        await send(supervisor!.api, 'PATCH', `/routes/${s.vroute['PRV']}`, {
          vehicleId: s.t['NOTYPE'],
        }),
        'move PRV route onto NOTYPE',
      );
      assert((await routeRow(s.vroute['PRV']!)).vehicleId === s.t['PRV'], 'PRV route moved');
    },
  );

  // ----- driver change
  await check(
    'the supervisor: driver change on a truck outside his reach (LIV, NOTYPE) → 404, nothing written',
    async () => {
      const n = await assignmentRows(s.t['LIV']!);
      refusedNotFound(
        await send(supervisor!.api, 'POST', `/warehouses/${s.t['LIV']}/driver`, { userId: null }),
        'LIV',
      );
      refusedNotFound(
        await send(supervisor!.api, 'POST', `/warehouses/${s.t['NOTYPE']}/driver`, {
          userId: seller1!.id,
        }),
        'NOTYPE',
      );
      assert(
        (await assignmentRows(s.t['LIV']!)) === n && (await driverOf(s.t['LIV']!)) === livreur1!.id,
        'LIV changed',
      );
      assert((await driverOf(s.t['NOTYPE']!)) === null, 'NOTYPE got a driver');
    },
  );
  await check(
    'the supervisor cannot put someone outside his team on a truck, even a Batna one (FORBIDDEN)',
    async () => {
      const r1 = await send(supervisor!.api, 'POST', `/warehouses/${s.t['PRV']}/driver`, {
        userId: seller3!.id,
      });
      const r2 = await send(supervisor!.api, 'POST', `/warehouses/${s.t['LIVB']}/driver`, {
        userId: livreur1!.id,
      });
      status(r1, 403, 'seller3 on PRV', 'FORBIDDEN');
      status(r2, 403, 'livreur1 on LIVB', 'FORBIDDEN');
      assert(
        (await driverOf(s.t['PRV']!)) === seller2!.id &&
          (await driverOf(s.t['LIV']!)) === livreur1!.id,
        'a driver changed',
      );
    },
  );
  await check(
    'INFO the supervisor may take seller3 (not in his team) off a Batna truck: the rule gives him the trucks of the dépôts he OPERATEs',
    async () => {
      const r = await send(supervisor!.api, 'POST', `/warehouses/${s.t['V34']}/driver`, {
        userId: null,
      });
      record({
        name: `INFO supervisor POST /warehouses/V34/driver {userId:null} (driver seller3, outside his team) -> ${r.status}`,
        status: 'INFO',
      });
    },
  );
  await reset();
  await check(
    'the Batna manager: driver change on a truck of the principal (VAN) → 404, nothing written',
    async () => {
      const n = await assignmentRows(s.t['VAN']!);
      refusedNotFound(
        await send(mgr!.api, 'POST', `/warehouses/${s.t['VAN']}/driver`, { userId: null }),
        'VAN',
      );
      assert(
        (await assignmentRows(s.t['VAN']!)) === n && (await driverOf(s.t['VAN']!)) === seller1!.id,
        'VAN changed',
      );
    },
  );
  await check(
    'the Batna manager edits a truck of the principal through the dépôt form (PATCH code / assignedUserId, DELETE): refused, nothing written',
    async () => {
      const n = await assignmentRows(s.t['VAN']!);
      const r1 = await send(mgr!.api, 'PATCH', `/warehouses/${s.t['VAN']}`, {
        code: 'PRIS PAR BATNA',
      });
      const r2 = await send(mgr!.api, 'PATCH', `/warehouses/${s.t['NOTYPE']}`, {
        assignedUserId: seller4Id(s),
      });
      const r3 = await send(mgr!.api, 'DELETE', `/warehouses/${s.t['NOTYPE']}`);
      const code = (
        await query<{ code: string | null }>(`SELECT code FROM warehouses WHERE id = $1::uuid`, [
          s.t['VAN'],
        ])
      )[0]!.code;
      const live = (
        await query<{ d: Date | null }>(
          `SELECT "deletedAt" AS d FROM warehouses WHERE id = $1::uuid`,
          [s.t['NOTYPE']],
        )
      )[0]!.d;
      const notypeDriver = await driverOf(s.t['NOTYPE']!);
      record({
        name: `INFO Batna manager on principal trucks: PATCH code -> ${r1.status}, PATCH assignedUserId -> ${r2.status}, DELETE -> ${r3.status}`,
        status: 'INFO',
      });
      assert(code === 'VAN-28 MXT 01', `VAN code is now ${code} (${brief(r1)})`);
      assert(notypeDriver === null, `NOTYPE driver is now ${notypeDriver} (${brief(r2)})`);
      assert(live === null, `NOTYPE archived (${brief(r3)})`);
      assert((await assignmentRows(s.t['VAN']!)) === n, 'VAN history grew');
    },
  );
  if (
    (
      await query(`SELECT 1 FROM warehouses WHERE id = $1::uuid AND "deletedAt" IS NOT NULL`, [
        s.t['NOTYPE'],
      ])
    ).length
  ) {
    // Recreate the cast's driverless principal truck so the next checks keep their meaning.
    s.t['NOTYPE'] = (
      await s.c.owner.post<{ id: string }>(
        '/warehouses',
        { name: 'Camion SANS TYPE 2', type: 'VEHICLE', code: 'SANS TYPE 2' },
        null,
      )
    ).id;
  }
  await reset();
  await check(
    'the Batna manager puts seller1 (who drives VAN, a truck of the principal) on a Batna truck: refused, VAN keeps its driver (he must not write on a truck outside his dépôt)',
    async () => {
      const nVan = await assignmentRows(s.t['VAN']!);
      const r = await send(mgr!.api, 'POST', `/warehouses/${s.t['LIVB']}/driver`, {
        userId: seller1!.id,
      });
      const vanDriver = await driverOf(s.t['VAN']!);
      const vanRows = await assignmentRows(s.t['VAN']!);
      assert(
        is4xx(r) && vanDriver === seller1!.id && vanRows === nVan,
        `${brief(r)}; VAN driver now ${vanDriver === null ? 'nobody' : vanDriver}, VAN history ${nVan}→${vanRows} rows`,
      );
    },
    {
      expected:
        'tournee-scope.ts: a manager reaches "the trucks of the dépôts he works in"; POST /warehouses/VAN/driver by the same manager is 404',
    },
  );
  await reset();
  await check(
    "the Batna manager converts seller1's old route (POST /routes/:id/convert-to-vehicle): refused, the route must not land on VAN, a truck outside his dépôt",
    async () => {
      const r = await send(mgr!.api, 'POST', `/routes/${s.sroute['seller1']}/convert-to-vehicle`);
      const row = await routeRow(s.sroute['seller1']!);
      const audit = await query(
        `SELECT 1 FROM audit_logs WHERE "entityId" = $1 AND action = 'ROUTE_CONVERTED' AND "userId" = $2::uuid`,
        [s.sroute['seller1'], mgr!.id],
      );
      assert(
        row.vehicleId === null && audit.length === 0,
        `answer ${brief(r)}; yet the route is now on ${row.vehicleId === s.t['VAN'] ? 'VAN (principal)' : row.vehicleId} and ${audit.length} ROUTE_CONVERTED row(s) name this manager`,
      );
    },
    {
      expected:
        'the same manager gets 404 for PATCH /routes/:id {vehicleId: VAN} (resolveOwner → assertPlanned)',
    },
  );
  await check(
    'control: the Batna manager PATCH /routes/:seller2 route {vehicleId: VAN} → 404 (the reach check on the edit path)',
    async () => {
      refusedNotFound(
        await send(mgr!.api, 'PATCH', `/routes/${s.sroute['seller2']}`, { vehicleId: s.t['VAN'] }),
        'PATCH onto VAN',
      );
    },
  );
  await check(
    'the Batna manager bulk-converts (POST /routes/convert-to-vehicle): only seller routes whose truck is in his reach move',
    async () => {
      await reset();
      const reach = await truthVehicles(s, 'mgr');
      const started = new Date();
      const r = await send(mgr!.api, 'POST', '/routes/convert-to-vehicle');
      assert(ok2(r), brief(r));
      const outside = await query<{ id: string; name: string; vehicleId: string }>(
        `SELECT r.id, r.name, r."vehicleId" FROM routes r JOIN audit_logs a ON a."entityId" = r.id::text AND a.action = 'ROUTE_CONVERTED' AND a."userId" = $2::uuid
         WHERE r."tenantId" = $1::uuid AND a."createdAt" >= $4 AND NOT (r."vehicleId" = ANY($3::uuid[]))`,
        [s.c.tenantId, mgr!.id, reach, started],
      );
      assert(
        outside.length === 0,
        `${outside.length} route(s) converted onto a truck outside his reach: ${outside.map((o) => o.name).join(', ')} (answer ${r.raw})`,
      );
    },
  );
  await check(
    'INFO the Batna manager reads the worker history of a seller of the principal (GET /users/:seller1/vehicle-assignments)',
    async () => {
      const r = await get(mgr!.api, `/users/${seller1!.id}/vehicle-assignments`);
      const items = list<{ vehicle: { id: string; inReach: boolean } }>(r);
      record({
        name: `INFO Batna manager GET /users/seller1/vehicle-assignments -> ${r.status}, ${items.length} period(s), inReach ${JSON.stringify(items.map((i) => i.vehicle.inReach))}`,
        status: 'INFO',
      });
    },
  );
  await check('the Batna manager: GET /warehouses/:VAN/assignments → 404; :PRV → 200', async () => {
    refusedNotFound(await get(mgr!.api, `/warehouses/${s.t['VAN']}/assignments`), 'VAN history');
    assert(ok2(await get(mgr!.api, `/warehouses/${s.t['PRV']}/assignments`)), 'PRV history');
  });

  // ----- orders on delivery trucks
  await check(
    'assigning an order to a delivery truck outside the reach: supervisor and Batna manager → 4xx (LIV, principal), the order unchanged',
    async () => {
      const r1 = await send(supervisor!.api, 'PATCH', `/orders/${s.order.id}/livreur`, {
        deliveryVehicleId: s.t['LIV'],
      });
      const r2 = await send(mgr!.api, 'PATCH', `/orders/${s.order.id}/livreur`, {
        deliveryVehicleId: s.t['LIV'],
      });
      assert(is4xx(r1) && is4xx(r2), `${brief(r1)} / ${brief(r2)}`);
      const o = (
        await query<{ d: string | null }>(
          `SELECT "deliveryVehicleId"::text AS d FROM orders WHERE id = $1::uuid`,
          [s.order.id],
        )
      )[0]!.d;
      assert(o === null, `order now on ${o}`);
    },
  );
  await check(
    'INFO the supervisor assigns an order to VAN, the truck his own team drives (in his driver-change reach)',
    async () => {
      const r = await send(supervisor!.api, 'PATCH', `/orders/${s.order.id}/livreur`, {
        deliveryVehicleId: s.t['VAN'],
      });
      const h = await get(supervisor!.api, `/warehouses/${s.t['VAN']}/assignments`);
      record({
        name: `INFO supervisor and VAN (team truck of the principal): driver change allowed; PATCH /orders/:id/livreur {deliveryVehicleId: VAN} -> ${r.status} ${codeOf(r) ?? ''}; GET /warehouses/VAN/assignments -> ${h.status} ${codeOf(h) ?? ''}`,
        status: 'INFO',
      });
      if (ok2(r))
        await s.c.owner.ok(
          'PATCH',
          `/orders/${s.order.id}/livreur`,
          { livreurId: null, deliveryVehicleId: null },
          null,
        );
    },
  );

  // ----- histories
  await check(
    "worker history: a seller reads his own (200), not another seller's (403); a livreur the same; the supervisor his team (200), not seller3 (403)",
    async () => {
      status(
        await get(seller1!.api, `/users/${seller1!.id}/vehicle-assignments`),
        200,
        'seller1 own',
      );
      status(
        await get(seller1!.api, `/users/${seller2!.id}/vehicle-assignments`),
        403,
        'seller1 → seller2',
        'FORBIDDEN',
      );
      status(
        await get(livreur1!.api, `/users/${livreur2!.id}/vehicle-assignments`),
        403,
        'livreur1 → livreur2',
        'FORBIDDEN',
      );
      status(
        await get(livreur1!.api, `/users/${livreur1!.id}/vehicle-assignments`),
        200,
        'livreur1 own',
      );
      status(
        await get(storekeeper!.api, `/users/${seller1!.id}/vehicle-assignments`),
        403,
        'storekeeper → seller1',
        'FORBIDDEN',
      );
      status(
        await get(supervisor!.api, `/users/${seller1!.id}/vehicle-assignments`),
        200,
        'supervisor → seller1',
      );
      status(
        await get(supervisor!.api, `/users/${seller3!.id}/vehicle-assignments`),
        403,
        'supervisor → seller3',
        'FORBIDDEN',
      );
      status(
        await get(mgrAll!.api, `/users/${seller3!.id}/vehicle-assignments`),
        200,
        'second manager → seller3',
      );
    },
  );
  await check(
    "truck history: a seller reads his own truck's (200), not another truck's (404); a livreur and the storekeeper the same",
    async () => {
      status(await get(seller1!.api, `/warehouses/${s.t['VAN']}/assignments`), 200, 'seller1 VAN');
      const leaks: string[] = [];
      for (const [who, api, k] of [
        ['seller1', seller1!.api, 'PRV'],
        ['seller1', seller1!.api, 'LIV'],
        ['seller1', seller1!.api, 'NOTYPE'],
        ['seller3', seller3!.api, 'VAN'],
        ['livreur1', livreur1!.api, 'VAN'],
        ['storekeeper', storekeeper!.api, 'VAN'],
      ] as const) {
        const r = await get(api, `/warehouses/${s.t[k]}/assignments`);
        if (r.status === 200)
          leaks.push(
            `${who} reads ${k} (${list(r).length} row(s), names ${JSON.stringify(list<{ user: { fullName: string } | null }>(r).map((x) => x.user?.fullName ?? null))})`,
          );
      }
      assert(leaks.length === 0, leaks.join('; '));
    },
  );

  // ----- report by vehicle
  for (const [label, who, api] of [
    ['supervisor', 'supervisor', supervisor!.api],
    ['Batna manager', 'mgr', mgr!.api],
    ['seller1', seller1!, seller1!.api],
  ] as const) {
    await check(
      `GET /tournees/reports?by=vehicle for the ${label}: only trucks of his reach (SQL truth), and ?vehicleId= of another truck gives nothing`,
      async () => {
        const r = await get(api, `/tournees/reports?from=${today}&to=${today}&by=vehicle`);
        assert(ok2(r), brief(r));
        const rows =
          (r.body as { vehicleRows?: { vehicle: { id: string } | null }[] }).vehicleRows ?? [];
        const reach = await truthVehicles(s, who as never);
        const outside = rows
          .map((x) => x.vehicle?.id)
          .filter((id): id is string => !!id && !reach.includes(id));
        assert(
          outside.length === 0,
          `${outside.length} truck(s) outside the reach: ${JSON.stringify(outside)}`,
        );
        const other = await get(
          api,
          `/tournees/reports?from=${today}&to=${today}&by=vehicle&vehicleId=${s.t['LIV']}`,
        );
        const otherRows = (
          (other.body as { vehicleRows?: { vehicle: { id: string } | null }[] }).vehicleRows ?? []
        ).filter((x) => x.vehicle?.id === s.t['LIV']);
        assert(is4xx(other) || otherRows.length === 0, `LIV rows given: ${brief(other)}`);
      },
    );
  }
  await reset();
}
const seller4Id = (s: Cast): string => s.u['seller4']!.id;

// ================================================================ B3. permissions

async function permissions(s: Cast): Promise<void> {
  area('B3. Permissions');
  const { mgr, supervisor, seller1, livreur1, storekeeper } = s.u as Record<string, Staff>;
  await check(
    'SETTINGS_EDIT for vehicle types: supervisor, seller, livreur, storekeeper → 403 on create, update, archive; GET is open to pickers',
    async () => {
      for (const [who, api] of [
        ['supervisor', supervisor!.api],
        ['seller', seller1!.api],
        ['livreur', livreur1!.api],
        ['storekeeper', storekeeper!.api],
      ] as const) {
        status(
          await send(api, 'POST', '/vehicle-types', {
            code: `X${who.slice(0, 3)}`,
            name: 'x',
            activity: 'MIXED',
          }),
          403,
          `${who} create`,
        );
        status(
          await send(api, 'PATCH', `/vehicle-types/${s.types['MXT']}`, { name: 'x' }),
          403,
          `${who} update`,
        );
        status(
          await send(api, 'POST', `/vehicle-types/${s.types['MIX']}/archive`),
          403,
          `${who} archive`,
        );
        status(await get(api, '/vehicle-types'), 200, `${who} list`);
      }
    },
  );
  await check(
    'INFO a manager (SETTINGS_EDIT) edits vehicle types, which are company-wide, even when he works in one dépôt',
    async () => {
      const r = await send(mgr!.api, 'POST', '/vehicle-types', {
        code: 'MGRB',
        name: 'Par le gérant Batna',
        activity: 'MIXED',
      });
      record({ name: `INFO Batna manager POST /vehicle-types -> ${r.status}`, status: 'INFO' });
    },
  );
  await check(
    'POST /warehouses/:id/driver: seller, livreur, storekeeper → 403, nothing written',
    async () => {
      const n = await assignmentRows(s.t['VAN']!);
      for (const [who, api] of [
        ['seller', seller1!.api],
        ['livreur', livreur1!.api],
        ['storekeeper', storekeeper!.api],
      ] as const) {
        status(
          await send(api, 'POST', `/warehouses/${s.t['VAN']}/driver`, { userId: null }),
          403,
          who,
        );
      }
      assert((await assignmentRows(s.t['VAN']!)) === n, 'history grew');
    },
  );
  await check(
    'POST /routes/convert-to-vehicle and /routes/:id/convert-to-vehicle: seller, livreur, storekeeper → 403',
    async () => {
      for (const [who, api] of [
        ['seller', seller1!.api],
        ['livreur', livreur1!.api],
        ['storekeeper', storekeeper!.api],
      ] as const) {
        status(await send(api, 'POST', '/routes/convert-to-vehicle'), 403, `${who} bulk`);
        status(
          await send(api, 'POST', `/routes/${s.sroute['seller1']}/convert-to-vehicle`),
          403,
          `${who} one`,
        );
      }
    },
  );
  await check(
    'truck identity (POST / PATCH /warehouses) needs SETTINGS_EDIT: supervisor and seller → 403',
    async () => {
      status(
        await send(supervisor!.api, 'POST', '/warehouses', {
          name: 'x',
          type: 'VEHICLE',
          code: 'SUP 1',
        }),
        403,
        'supervisor create',
      );
      status(
        await send(seller1!.api, 'PATCH', `/warehouses/${s.t['VAN']}`, {
          plateNumber: '00000-128-28',
        }),
        403,
        'seller patch own truck',
      );
    },
  );
}

// ================================================================ B4. feature gate

async function featureGate(): Promise<void> {
  area('B4. Feature gate: a company on ESSENTIEL (no WAREHOUSES, no TOURNEES)');
  const e = await co('E', 'ESSENTIEL');
  const seller = await invite(e, 'SELLER');
  const zero = '00000000-0000-4000-8000-000000000000';
  const calls: [string, Promise<Res>][] = [
    ['GET /vehicle-types', get(e.owner, '/vehicle-types')],
    [
      'POST /vehicle-types',
      send(e.owner, 'POST', '/vehicle-types', { code: 'MXT', name: 'x', activity: 'CASH_VAN' }),
    ],
    ['PATCH /vehicle-types/:id', send(e.owner, 'PATCH', `/vehicle-types/${zero}`, { name: 'x' })],
    ['POST /vehicle-types/:id/archive', send(e.owner, 'POST', `/vehicle-types/${zero}/archive`)],
    [
      'POST /warehouses (truck with identity)',
      send(e.owner, 'POST', '/warehouses', {
        name: 'x',
        type: 'VEHICLE',
        code: 'VAN 01',
        wilayaCode: 16,
      }),
    ],
    [
      'PATCH /warehouses/:main {code}',
      send(e.owner, 'PATCH', `/warehouses/${e.mainWarehouseId}`, { code: 'DEPOT 01' }),
    ],
    [
      'POST /warehouses/:main/driver',
      send(e.owner, 'POST', `/warehouses/${e.mainWarehouseId}/driver`, { userId: seller.id }),
    ],
    [
      'GET /warehouses/:main/assignments',
      get(e.owner, `/warehouses/${e.mainWarehouseId}/assignments`),
    ],
    [
      'GET /users/:seller/vehicle-assignments',
      get(e.owner, `/users/${seller.id}/vehicle-assignments`),
    ],
    [
      'GET /users/:self/vehicle-assignments (seller)',
      get(seller.api, `/users/${seller.id}/vehicle-assignments`),
    ],
    ['GET /routes?vehicleId=', get(e.owner, `/routes?vehicleId=${zero}`)],
    [
      'POST /routes {vehicleId}',
      send(e.owner, 'POST', '/routes', {
        name: 'x',
        vehicleId: zero,
        weekdays: WEEK,
        active: true,
      }),
    ],
    ['POST /routes/convert-to-vehicle', send(e.owner, 'POST', '/routes/convert-to-vehicle')],
    [
      'POST /routes/:id/convert-to-vehicle',
      send(e.owner, 'POST', `/routes/${zero}/convert-to-vehicle`),
    ],
    [
      'GET /tournees/reports?by=vehicle',
      get(e.owner, `/tournees/reports?from=${today}&to=${today}&by=vehicle`),
    ],
    ['GET /orders?deliveryVehicleId=', get(e.owner, `/orders?deliveryVehicleId=${zero}`)],
    ['GET /visits?vehicleId=', get(e.owner, `/visits?vehicleId=${zero}`)],
  ];
  const lines: string[] = [];
  for (const [label, p] of calls) {
    await check(`ESSENTIEL: ${label} → 403 (refused by the gate, before any lookup)`, async () => {
      const r = await p;
      lines.push(`${label}: ${brief(r)}`);
      assert(r.status === 403, brief(r));
    });
  }
  await check(
    'ESSENTIEL: GET /warehouses still answers (main dépôt only) and nothing was written: no type, no truck, no history row, no code',
    async () => {
      const r = await get(e.owner, '/warehouses');
      assert(ok2(r), brief(r));
      const rows = await query<{ n: string }>(
        `SELECT (SELECT count(*) FROM vehicle_types WHERE "tenantId" = $1::uuid)
            + (SELECT count(*) FROM vehicle_assignments WHERE "tenantId" = $1::uuid)
            + (SELECT count(*) FROM warehouses WHERE "tenantId" = $1::uuid AND (type = 'VEHICLE' OR code IS NOT NULL)) AS n`,
        [e.tenantId],
      );
      assert(Number(rows[0]!.n) === 0, `${rows[0]!.n} phase 36 row(s) written`);
    },
  );
  proof36('vehicles-scope-gate.txt', lines.join('\n'));
}

// ================================================================ B5. hostile input

async function hostile(s: Cast): Promise<void> {
  area(
    'B5. Hostile input: 400, never 500; nothing invisible or reordering stored in a code or a plate',
  );
  const A = s.c.owner;
  const strings: [string, string][] = [
    ['10 000 chars', 'V'.repeat(10_000)],
    ['NUL', 'VAN\u0000 01'],
    ['BEL / ESC control', 'VAN\u0007\u001b 01'],
    ['line feed', 'VAN\n01'],
    ['lone high surrogate', 'VAN \uD800 01'],
    ['lone low surrogate', 'VAN \uDFFF 01'],
    ['RTL override U+202E', 'VAN-28 ‮10 TXM'],
    ['RLI / PDI isolates', '⁧VAN-28⁩ 01'],
    ['RLM U+200F', 'VAN-28‏ MXT 01'],
    ['zero-width space', 'VAN-28 MXT 01​'],
    ['BOM U+FEFF', '﻿VAN 02'],
    ['only spaces', '   '],
  ];
  const out: string[] = [];
  const fives: string[] = [];
  const stored: string[] = [];
  const note = (label: string, r: Res) => {
    out.push(`${label}: ${brief(r)}`);
    if (r.status >= 500) fives.push(`${label}: ${brief(r)}`);
  };
  let n = 0;
  for (const [label, v] of strings) {
    n += 1;
    const t = await send(A, 'POST', '/vehicle-types', {
      code: v.slice(0, 20),
      name: v,
      activity: 'MIXED',
      codePrefix: v.slice(0, 10),
    });
    note(`POST /vehicle-types code/name/prefix = ${label}`, t);
    const w = await send(A, 'POST', '/warehouses', {
      name: `H${n}`,
      type: 'VEHICLE',
      code: v.slice(0, 30),
      plateNumber: v.slice(0, 20),
    });
    note(`POST /warehouses code/plate = ${label}`, w);
    if (ok2(w))
      stored.push(
        `truck code ${JSON.stringify((w.body as { code: string | null }).code)} plate ${JSON.stringify((w.body as { plateNumber: string | null }).plateNumber)} (${label})`,
      );
    if (ok2(t))
      stored.push(`type code ${JSON.stringify((t.body as { code: string }).code)} (${label})`);
    const p = await send(A, 'PATCH', `/warehouses/${s.t['NOTYPE']}`, {
      code: v.slice(0, 30),
      plateNumber: v.slice(0, 20),
    });
    note(`PATCH /warehouses code/plate = ${label}`, p);
    const d = await send(A, 'POST', `/warehouses/${s.t['NOTYPE']}/driver`, {
      userId: n % 2 ? s.u['seller4']!.id : null,
      reason: v.slice(0, 120),
    });
    note(`POST /warehouses/:id/driver reason = ${label}`, d);
    let enc: string;
    try {
      enc = encodeURIComponent(v.slice(0, 60));
    } catch {
      // A lone surrogate has no UTF-8 form: send the bytes a broken client would (CESU-8).
      enc = v.includes('\uD800') ? 'VAN%20%ED%A0%80%2001' : 'VAN%20%ED%BF%BF%2001';
    }
    const q = await get(A, `/warehouses?search=${enc}`);
    note(`GET /warehouses?search = ${label}`, q);
  }
  // Put NOTYPE back to its cast state.
  await send(A, 'PATCH', `/warehouses/${s.t['NOTYPE']}`, { code: 'SANS TYPE', plateNumber: null });
  await send(A, 'POST', `/warehouses/${s.t['NOTYPE']}/driver`, { userId: null });

  const numbers: [string, unknown][] = [
    ['"16" (string)', '16'],
    ['16.5', 16.5],
    ['1e20', 1e20],
    ['-1', -1],
    ['true', true],
    ['[16]', [16]],
    ['{"n":16}', { n: 16 }],
    ['2^53+1', 9007199254740993],
  ];
  for (const [label, v] of numbers) {
    note(
      `POST /warehouses wilayaCode = ${label}`,
      await send(A, 'POST', '/warehouses', { name: 'N', type: 'VEHICLE', wilayaCode: v }),
    );
    note(
      `PATCH /warehouses capacityKg = ${label}`,
      await send(A, 'PATCH', `/warehouses/${s.t['NOTYPE']}`, { capacityKg: v }),
    );
  }
  for (const [label, q] of [
    ['wilayaCode=abc', '/warehouses?wilayaCode=abc'],
    ['wilayaCode=1e3', '/warehouses?wilayaCode=1e3'],
    ['vehicleTypeId=not-a-uuid', '/warehouses?vehicleTypeId=not-a-uuid'],
    ['search 61 chars', `/warehouses?search=${'a'.repeat(61)}`],
    ['search=%00', '/warehouses?search=%00'],
    ['routes vehicleId=x', '/routes?vehicleId=x'],
    ['orders deliveryVehicleId=1', '/orders?deliveryVehicleId=1'],
    ['assignments cursor=x', `/warehouses/${s.t['VAN']}/assignments?cursor=x`],
    ['assignments limit=0', `/warehouses/${s.t['VAN']}/assignments?limit=0`],
    ['assignments limit=101', `/warehouses/${s.t['VAN']}/assignments?limit=101`],
    ['assignments limit=1e999', `/warehouses/${s.t['VAN']}/assignments?limit=1e999`],
    [
      'history cursor=uuid of nothing',
      `/users/${s.u['seller1']!.id}/vehicle-assignments?cursor=00000000-0000-4000-8000-000000000000`,
    ],
    ['report by=truck', `/tournees/reports?from=${today}&to=${today}&by=truck`],
    ['report vehicleId=x', `/tournees/reports?from=${today}&to=${today}&by=vehicle&vehicleId=x`],
    ['warehouses/:id not a uuid', '/warehouses/abc/assignments'],
    ['users/:id not a uuid', '/users/abc/vehicle-assignments'],
  ] as const) {
    note(`GET ${label}`, await get(A, q));
  }
  for (const [label, body] of [
    ['userId not a uuid', { userId: 'abc' }],
    ['userId array', { userId: [s.u['seller4']!.id] }],
    ['userId missing', {}],
    ['body array', [{ userId: null }]],
    ['body null', null],
    ['reason 121 chars', { userId: null, reason: 'r'.repeat(121) }],
    ['reason number', { userId: null, reason: 12 }],
  ] as const) {
    note(
      `POST /warehouses/:id/driver ${label}`,
      await send(A, 'POST', `/warehouses/${s.t['NOTYPE']}/driver`, body),
    );
  }
  const raw = await request(`/warehouses/${s.t['NOTYPE']}/driver`, {
    method: 'POST',
    token: A.token,
    headers: { 'Content-Type': 'application/json' },
    body: undefined,
  });
  note('POST /warehouses/:id/driver no body', raw);
  const broken = await fetch(`${process.env['API'] ?? 'http://localhost:3001'}/vehicle-types`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${A.token}`, 'Content-Type': 'application/json' },
    body: '{"code": "X", "name": ',
  });
  out.push(`POST /vehicle-types broken JSON: HTTP ${broken.status}`);
  if (broken.status >= 500) fives.push(`broken JSON: ${broken.status}`);

  await check(
    'no 500 on any hostile input (long, control, surrogate, bidi text; wrong number types; bad query; bad body)',
    async () => {
      assert(fives.length === 0, `${fives.length} answer(s) 5xx:\n${fives.join('\n')}`);
    },
  );
  await check(
    'nothing invisible or reordering (C0 controls, bidi overrides / isolates / marks, zero-width, BOM, lone surrogate) is stored in a truck code, a type code or a plate',
    async () => {
      const bad = await query<{ t: string; v: string }>(
        `SELECT 'warehouse.code' AS t, code AS v FROM warehouses WHERE "tenantId" = $1::uuid AND code ~ $2
         UNION ALL SELECT 'warehouse.plate', "plateNumber" FROM warehouses WHERE "tenantId" = $1::uuid AND "plateNumber" ~ $2
         UNION ALL SELECT 'vehicle_type.code', code FROM vehicle_types WHERE "tenantId" = $1::uuid AND code ~ $2
         UNION ALL SELECT 'vehicle_type.codePrefix', "codePrefix" FROM vehicle_types WHERE "tenantId" = $1::uuid AND "codePrefix" ~ $2
         UNION ALL SELECT 'vehicle_assignment.reason', reason FROM vehicle_assignments WHERE "tenantId" = $1::uuid AND reason ~ $2`,
        [
          s.c.tenantId,
          '[\\u0001-\\u001f\\u007f\\u200b-\\u200f\\u202a-\\u202e\\u2066-\\u2069\\ufeff\\ufffd]',
        ],
      );
      assert(
        bad.length === 0,
        `${bad.length} stored: ${bad.map((b) => `${b.t} ${JSON.stringify(b.v)}`).join('; ')}`,
      );
    },
    {
      expected:
        'prompt part B: "control characters, lone surrogates, RTL override characters (U+202E) in a code or plate … 400"',
    },
  );
  await check(
    'two trucks that look the same: "VAN-28 MXT 01" plus a zero-width space or an RLM is refused as VEHICLE_CODE_TAKEN (or 400)',
    async () => {
      const lookalikes = await query<{ code: string }>(
        `SELECT code FROM warehouses WHERE "tenantId" = $1::uuid AND "deletedAt" IS NULL
           AND code <> 'VAN-28 MXT 01' AND regexp_replace(code, '[\\u200b-\\u200f\\u202a-\\u202e\\u2066-\\u2069\\ufeff]', '', 'g') = 'VAN-28 MXT 01'`,
        [s.c.tenantId],
      );
      assert(
        lookalikes.length === 0,
        `${lookalikes.length} live truck(s) whose code reads "VAN-28 MXT 01" on screen: ${lookalikes.map((l) => JSON.stringify(l.code)).join(', ')}`,
      );
    },
  );
  record({
    name: `INFO stored from the hostile set: ${stored.length ? stored.join(' | ') : 'nothing'}`,
    status: 'INFO',
  });
  proof36('vehicles-scope-hostile.txt', out.join('\n'));
}

// ================================================================ B6. idempotency and audit

async function idempotencyAndAudit(s: Cast): Promise<void> {
  area('B6. Idempotency and audit');
  const A = s.c.owner;
  const truck = (
    await A.post<{ id: string }>(
      '/warehouses',
      { name: 'Idem', type: 'VEHICLE', code: 'IDEM 01', vehicleTypeId: s.types['MXT'] },
      null,
    )
  ).id;
  const x = await invite(s.c, 'SELLER');
  const y = await invite(s.c, 'SELLER');
  await check(
    'the same driver change sent twice with the same Idempotency-Key: one history row',
    async () => {
      const key = idemKey('b6-same');
      const n0 = await assignmentRows(truck);
      const r1 = await send(A, 'POST', `/warehouses/${truck}/driver`, { userId: x.id }, key);
      const r2 = await send(A, 'POST', `/warehouses/${truck}/driver`, { userId: x.id }, key);
      assert(ok2(r1) && ok2(r2), `${brief(r1)} / ${brief(r2)}`);
      assert(
        (await assignmentRows(truck)) === n0 + 1,
        `rows ${n0} → ${await assignmentRows(truck)}`,
      );
    },
  );
  await check(
    'a driver change replayed with its Idempotency-Key after a later change: the original answer comes back, no row is written, the later driver stays',
    async () => {
      const key = idemKey('b6-late');
      await send(A, 'POST', `/warehouses/${truck}/driver`, { userId: null }, idemKey('b6'));
      const r1 = await send(A, 'POST', `/warehouses/${truck}/driver`, { userId: x.id }, key);
      assert(ok2(r1), brief(r1));
      await send(A, 'POST', `/warehouses/${truck}/driver`, { userId: y.id }, idemKey('b6'));
      const n = await assignmentRows(truck);
      const replay = await send(A, 'POST', `/warehouses/${truck}/driver`, { userId: x.id }, key);
      const after = await assignmentRows(truck);
      const drv = await driverOf(truck);
      assert(
        after === n && drv === y.id,
        `replay ${brief(replay)} (Idempotent-Replayed: ${replay.headers.get('idempotent-replayed') ?? 'absent'}); rows ${n} → ${after}; driver now ${drv === x.id ? 'X (the replayed one)' : drv === y.id ? 'Y' : drv}`,
      );
    },
    {
      expected:
        'prompt part B: "a replayed driver change or convert does not write a second row"; AGENTS §3.6 (a replay returns the original response)',
    },
  );
  await check(
    'convert one replayed (same key, twice) and bulk convert run twice: no second ROUTE_CONVERTED row, second bulk = 0',
    async () => {
      const r = await A.post<{ id: string }>('/routes', {
        name: 'Idem seller',
        sellerId: x.id,
        weekdays: WEEK,
        active: true,
      });
      // Since the fix of B-4 the replay above no longer puts x back on the truck (y drives
      // it): x gets it here, so that there is a route to convert.
      const back = await send(A, 'POST', `/warehouses/${truck}/driver`, { userId: x.id });
      assert(ok2(back), `x back on the truck: ${brief(back)}`);
      const key = idemKey('b6-conv');
      const c1 = await send(A, 'POST', `/routes/${r.id}/convert-to-vehicle`, {}, key);
      const c2 = await send(A, 'POST', `/routes/${r.id}/convert-to-vehicle`, {}, key);
      const rows = await query(
        `SELECT 1 FROM audit_logs WHERE "entityId" = $1 AND action = 'ROUTE_CONVERTED'`,
        [r.id],
      );
      assert(
        ok2(c1) && rows.length <= 1,
        `${brief(c1)} / ${brief(c2)}; ${rows.length} ROUTE_CONVERTED rows`,
      );
      assert(
        c2.status === c1.status && c2.headers.get('idempotent-replayed') === 'true',
        `the replay is not the first answer: ${brief(c2)} (Idempotent-Replayed: ${c2.headers.get('idempotent-replayed') ?? 'absent'})`,
      );
      record({
        name: `INFO convert one: ${c1.status} ${codeOf(c1) ?? ''}, replay ${c2.status} ${codeOf(c2) ?? ''}`,
        status: 'INFO',
      });
      await send(A, 'POST', '/routes/convert-to-vehicle', {}, idemKey('b6'));
      const second = await send(A, 'POST', '/routes/convert-to-vehicle', {}, idemKey('b6'));
      assert(
        ok2(second) && (second.body as { converted: number }).converted === 0,
        `second bulk: ${brief(second)}`,
      );
    },
  );

  await check(
    'every phase 36 write has its audit row, with who, and before / after where it changes something',
    async () => {
      const tenant = s.c.tenantId;
      const t = (
        await A.post<{ id: string }>(
          '/vehicle-types',
          { code: 'AUD', name: 'Audit', activity: 'MIXED', codePrefix: 'AU' },
          null,
        )
      ).id;
      await A.patch(`/vehicle-types/${t}`, { name: 'Audit 2' });
      await A.ok('POST', `/vehicle-types/${t}/archive`, {}, null);
      const w = (
        await A.post<{ id: string }>(
          '/warehouses',
          {
            name: 'Aud',
            type: 'VEHICLE',
            code: 'AUD 01',
            wilayaCode: 16,
            plateNumber: '12345-116-16',
            capacityKg: 1500,
          },
          null,
        )
      ).id;
      await A.patch(`/warehouses/${w}`, { code: 'AUD 02', wilayaCode: 28 });
      await A.ok('POST', `/warehouses/${w}/driver`, { userId: x.id, reason: 'audit' });
      const r = await A.post<{ id: string }>('/routes', {
        name: 'Aud',
        sellerId: x.id,
        weekdays: WEEK,
        active: true,
      });
      await A.ok('POST', `/routes/${r.id}/convert-to-vehicle`, {});
      await A.ok(
        'PATCH',
        `/orders/${s.order.id}/livreur`,
        { deliveryVehicleId: s.t['LIVB'] },
        null,
      );
      const missing: string[] = [];
      const want: [string, string, 'after' | 'both'][] = [
        ['VEHICLE_TYPE_CREATED', t, 'after'],
        ['VEHICLE_TYPE_UPDATED', t, 'both'],
        ['VEHICLE_TYPE_ARCHIVED', t, 'after'],
        ['WAREHOUSE_CREATED', w, 'after'],
        ['WAREHOUSE_UPDATED', w, 'both'],
        ['VEHICLE_DRIVER_CHANGED', w, 'both'],
        ['ROUTE_CONVERTED', r.id, 'both'],
        ['ORDER_LIVREUR_ASSIGNED', s.order.id, 'both'],
      ];
      for (const [action, id, need] of want) {
        const rows = await query<{ before: unknown; after: unknown; userId: string | null }>(
          `SELECT before, after, "userId" FROM audit_logs WHERE "tenantId" = $1::uuid AND action = $2 AND "entityId" = $3 ORDER BY "createdAt" DESC LIMIT 1`,
          [tenant, action, id],
        );
        const row = rows[0];
        if (!row) missing.push(`${action}: no row`);
        else if (row.userId !== s.c.session.userId) missing.push(`${action}: userId ${row.userId}`);
        else if (need === 'both' && (row.before === null || row.after === null))
          missing.push(
            `${action}: before ${JSON.stringify(row.before)} after ${JSON.stringify(row.after)}`,
          );
        else if (need === 'after' && row.after === null && action !== 'VEHICLE_TYPE_ARCHIVED')
          missing.push(`${action}: no after`);
      }
      const created = (
        await query<{ after: Record<string, unknown> | null }>(
          `SELECT after FROM audit_logs WHERE action = 'WAREHOUSE_CREATED' AND "entityId" = $1`,
          [w],
        )
      )[0]?.after;
      const updated = (
        await query<{
          before: Record<string, unknown> | null;
          after: Record<string, unknown> | null;
        }>(
          `SELECT before, after FROM audit_logs WHERE action = 'WAREHOUSE_UPDATED' AND "entityId" = $1`,
          [w],
        )
      )[0];
      record({
        name: `INFO audit WAREHOUSE_CREATED after = ${JSON.stringify(created)}; WAREHOUSE_UPDATED before = ${JSON.stringify(updated?.before)} after = ${JSON.stringify(updated?.after)}`,
        status: 'INFO',
      });
      if (created && !('code' in created || 'plateNumber' in created))
        missing.push('WAREHOUSE_CREATED: the identity is not in after');
      if (updated && updated.before && !('code' in updated.before))
        missing.push('WAREHOUSE_UPDATED: the old code is not in before');
      if (updated && updated.before && !('wilayaCode' in updated.before))
        missing.push('WAREHOUSE_UPDATED: the old wilaya is not in before');
      assert(missing.length === 0, missing.join('; '));
    },
  );
  await check('VEHICLE_TYPE_ARCHIVED keeps what was archived (before not null)', async () => {
    const row = (
      await query<{ before: unknown }>(
        `SELECT before FROM audit_logs WHERE "tenantId" = $1::uuid AND action = 'VEHICLE_TYPE_ARCHIVED' ORDER BY "createdAt" DESC LIMIT 1`,
        [s.c.tenantId],
      )
    )[0];
    record({
      name: `INFO VEHICLE_TYPE_ARCHIVED before = ${JSON.stringify(row?.before ?? null)}`,
      status: 'INFO',
    });
  });
}

// ================================================================ production (anonymous GET only)

async function production(): Promise<void> {
  const prod = process.env['PROD_API'];
  if (!prod) return;
  area('B7. Production: the three anonymous GETs the prompt allows');
  const zero = '00000000-0000-4000-8000-000000000000';
  for (const path of [
    '/vehicle-types',
    `/warehouses/${zero}/assignments`,
    `/users/${zero}/vehicle-assignments`,
  ]) {
    await check(`${prod} GET ${path} without a token → 401`, async () => {
      const r = await fetch(`${prod}${path}`, { method: 'GET', redirect: 'manual' });
      assert(r.status === 401, `HTTP ${r.status}`);
    });
  }
}

// ================================================================ run

const s = await castS();
const b = await castB();
console.log(`company S ${s.c.tenantId}, company B ${b.c.tenantId}`);
const AREAS: [string, () => Promise<void>][] = [
  ['isolation', () => isolation(s, b)],
  ['scope', () => scope(s)],
  ['permissions', () => permissions(s)],
  ['gate', featureGate],
  ['hostile', () => hostile(s)],
  ['idempotency', () => idempotencyAndAudit(s)],
  ['production', production],
];
for (const [name, fn] of AREAS) {
  if (!on(name)) continue;
  try {
    await fn();
  } catch (e) {
    record({
      name: `${name}: the area stopped`,
      status: 'FAIL',
      evidence: e instanceof Error ? e.message : String(e),
    });
  }
}
writeSummary('vehicles-scope');
await closeDb();
