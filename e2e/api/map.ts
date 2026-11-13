/**
 * Test 35, part A: API correctness of the client map (phase 35).
 *
 *   API=http://localhost:3003 DB=postgresql://erp:erp@localhost:5432/erp_t35 pnpm test:map:api
 *
 * Needs the fixture of `pnpm test:map:seed`. Every expectation comes from the spec
 * (docs/prompts/phase-35-client-map.md) or from SQL written here, never from the service.
 * A FAIL is a finding; the proofs are written to artifacts/test-35/.
 */
import { haversineM } from '../../packages/shared/src/geo.ts';
import { closeDb, query } from '../lib/db.ts';
import { area, assert, assertEqual, check, record, summary, writeSummary } from '../lib/harness.ts';
import { idemKey, request } from '../lib/http.ts';
import { assertAuditDb, inviteUser, loadFixture, proof, type SeedUser } from '../lib/map-fixture.ts';

assertAuditDb();
const f = loadFixture();
const A = f.a;
const run = Date.now().toString(36);

interface Point {
  id: string;
  code: string;
  name: string;
  lat: number;
  lng: number;
  active: boolean;
  balance: string;
  overLimit: boolean;
  sectorId: string | null;
  assignedSellerId: string | null;
  distanceM?: number;
}
interface MapBody {
  points: Point[];
  truncated: boolean;
  withoutLocation: number;
}

const qs = (o: Record<string, string | number | boolean | undefined>): string => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined) p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
};
const get = <T>(path: string, user: SeedUser | null) => request<T>(path, { token: user?.token ?? null });
const ids = (rows: { id: string }[]): string[] => rows.map((r) => r.id);
const sameSet = (a: Iterable<string>, b: Iterable<string>): { missing: string[]; extra: string[] } => {
  const sa = new Set(a);
  const sb = new Set(b);
  return { missing: [...sb].filter((x) => !sa.has(x)), extra: [...sa].filter((x) => !sb.has(x)) };
};
function assertSameSet(actual: Iterable<string>, expected: Iterable<string>, what: string): void {
  const d = sameSet(actual, expected);
  assert(
    d.missing.length === 0 && d.extra.length === 0,
    `${what}: ${d.missing.length} missing, ${d.extra.length} extra (e.g. missing ${d.missing.slice(0, 3).join(', ')} extra ${d.extra.slice(0, 3).join(', ')})`,
  );
}

/** Three boxes that cut tenant A's clients into Oran / Alger / Sétif, each under the cap. */
const SLICES = [
  { minLat: -90, maxLat: 90, minLng: -180, maxLng: 1.2 },
  { minLat: -90, maxLat: 90, minLng: 1.2000001, maxLng: 4.2 },
  { minLat: -90, maxLat: 90, minLng: 4.2000001, maxLng: 180 },
];

/** Every point the user gets, whatever the cap: the three slices added up. */
async function wholeMap(user: SeedUser, filters: Record<string, string | boolean> = {}): Promise<Point[]> {
  const all: Point[] = [];
  for (const box of SLICES) {
    const res = await get<MapBody>(`/clients/map${qs({ ...filters, ...box })}`, user);
    if (res.status !== 200) throw new Error(`/clients/map HTTP ${res.status} ${res.raw.slice(0, 200)}`);
    if (res.body.truncated) throw new Error('a slice is truncated: the slices are too wide');
    all.push(...res.body.points);
  }
  return all;
}

interface ListItem {
  id: string;
  active: boolean;
  location: { lat: number; lng: number } | null;
}
async function wholeList(user: SeedUser, filters: Record<string, string | boolean> = {}): Promise<ListItem[]> {
  const all: ListItem[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 200; page++) {
    const res = await get<{ items: ListItem[]; nextCursor: string | null }>(
      `/clients${qs({ ...filters, limit: 100, cursor })}`,
      user,
    );
    if (res.status !== 200) throw new Error(`/clients HTTP ${res.status} ${res.raw.slice(0, 200)}`);
    all.push(...res.body.items);
    if (!res.body.nextCursor) return all;
    cursor = res.body.nextCursor;
  }
  throw new Error('the client list never ends');
}

interface TruthRow {
  id: string;
  code: string;
  name: string;
  lat: number | null;
  lng: number | null;
  active: boolean;
  balance: string;
  creditLimit: string | null;
  sectorId: string | null;
  assignedSellerId: string | null;
}
/** Tenant A's live clients, straight from the tables; the balance is the ledger's sum. */
async function truthRows(tenantId: string = A.tenantId): Promise<TruthRow[]> {
  return query<TruthRow>(
    `SELECT c.id, c.code, c.name, c.lat::float8 AS lat, c.lng::float8 AS lng, c.active,
       COALESCE((SELECT SUM(l.amount) FROM client_ledger_entries l WHERE l."clientId" = c.id), 0)::text AS balance,
       c."creditLimit"::text AS "creditLimit", c."sectorId", c."assignedSellerId"
     FROM clients c
     WHERE c."tenantId" = $1 AND c."deletedAt" IS NULL
     ORDER BY c.name, c.id`,
    [tenantId],
  );
}

const located = (r: TruthRow): r is TruthRow & { lat: number; lng: number } => r.lat !== null && r.lng !== null;

interface Filters {
  search?: string;
  sectorId?: string;
  assignedSellerId?: string;
  hasDebt?: boolean;
  overLimit?: boolean;
  includeInactive?: boolean;
}
/** The filters of the spec, applied here in plain TypeScript on the truth rows. */
function applyFilters(rows: TruthRow[], q: Filters, sellerIds: string[] | null): TruthRow[] {
  const s = q.search?.trim().toLowerCase();
  return rows.filter((r) => {
    if (sellerIds && (r.assignedSellerId === null || !sellerIds.includes(r.assignedSellerId))) return false;
    if (!q.includeInactive && !r.active) return false;
    if (q.sectorId && r.sectorId !== q.sectorId) return false;
    if (q.assignedSellerId && r.assignedSellerId !== q.assignedSellerId) return false;
    if (q.hasDebt && !(Number(r.balance) > 0)) return false;
    if (q.overLimit && !(r.creditLimit !== null && Number(r.balance) > Number(r.creditLimit))) return false;
    if (s) {
      const hay = searchable.get(r.id) ?? '';
      if (!hay.includes(s)) return false;
    }
    return true;
  });
}
/** code, name, phone, phone2 of every client, lower-cased by Postgres (same rules as ILIKE). */
const searchable = new Map<string, string>();

const toQuery = (q: Filters): Record<string, string | boolean> => {
  const o: Record<string, string | boolean> = {};
  if (q.search !== undefined) o['search'] = q.search;
  if (q.sectorId) o['sectorId'] = q.sectorId;
  if (q.assignedSellerId) o['assignedSellerId'] = q.assignedSellerId;
  if (q.hasDebt) o['hasDebt'] = true;
  if (q.overLimit) o['overLimit'] = true;
  if (q.includeInactive) o['includeInactive'] = true;
  return o;
};

async function main(): Promise<void> {
  const truth = await truthRows();
  for (const r of await query<{ id: string; hay: string }>(
    `SELECT id, lower(concat_ws(E'\\n', code, name, phone, phone2)) AS hay FROM clients WHERE "tenantId" = $1`,
    [A.tenantId],
  )) {
    searchable.set(r.id, r.hay);
  }
  const team = [A.supervisor.id, A.seller1.id, A.seller2.id];
  const ALGER = { lat: 36.7538, lng: 3.0588 };

  /** Who the spec lets each user see ("Who sees which clients"). null = everything. */
  const roles: { label: string; user: SeedUser; sellerIds: string[] | null }[] = [
    { label: 'owner', user: A.owner, sellerIds: null },
    { label: 'manager', user: A.manager, sellerIds: null },
    { label: 'supervisor', user: A.supervisor, sellerIds: team },
    { label: 'seller1 (in the team)', user: A.seller1, sellerIds: [A.seller1.id] },
    { label: 'seller outside the team', user: A.sellerOut, sellerIds: [A.sellerOut.id] },
    { label: 'livreur', user: A.livreur, sellerIds: [A.livreur.id] },
  ];

  // ------------------------------------------------------------------ scope
  area('A1 scope — the map and the nearby list against the client list and the tables');
  for (const role of roles) {
    const expected = applyFilters(truth, { includeInactive: true }, role.sellerIds).filter(located);
    let mapPoints: Point[] = [];
    await check(`${role.label}: /clients/map (all slices, inactive included) = the spec's scope, as a set`, async () => {
      mapPoints = await wholeMap(role.user, { includeInactive: true });
      assert(new Set(ids(mapPoints)).size === mapPoints.length, 'a client is returned twice');
      const d = sameSet(ids(mapPoints), ids(expected));
      if (d.extra.length > 0 || d.missing.length > 0) {
        proof(
          `scope-${role.label.split(' ')[0]}.json`,
          JSON.stringify(
            {
              user: role.user.email,
              role: role.user.role,
              rule: 'phase-35 spec, "Who sees which clients": owner and manager all, supervisor his team\'s clients, seller and livreur only the clients assigned to them',
              request: 'GET /clients/map?includeInactive=true (three boxes that cover everything)',
              expected: expected.length,
              actual: mapPoints.length,
              outsideScope: d.extra.length,
              missing: d.missing.length,
              sampleOutsideScope: mapPoints.filter((p) => d.extra.includes(p.id)).slice(0, 5),
            },
            null,
            2,
          ),
        );
      }
      assert(
        d.extra.length === 0 && d.missing.length === 0,
        `${mapPoints.length} points for ${expected.length} expected: ${d.extra.length} outside the scope, ${d.missing.length} missing`,
      );
    }, { expected: `${expected.length} clients` });

    await check(`${role.label}: /clients/map = GET /clients?hasLocation=true for the same user, as a set`, async () => {
      const list = await wholeList(role.user, { hasLocation: true });
      assert(list.every((c) => c.location !== null), 'hasLocation=true returned a client without a point');
      assertSameSet(ids(mapPoints), ids(list), 'map vs list');
    });

    await check(`${role.label}: /clients/nearby (50 km around Alger, 100 nearest) stays in the same set`, async () => {
      const res = await get<Point[]>(`/clients/nearby${qs({ ...ALGER, radiusM: 50000, limit: 100, includeInactive: true })}`, role.user);
      assertEqual(res.status, 200, 'status');
      const allowed = new Set(ids(mapPoints));
      const outside = res.body.filter((p) => !allowed.has(p.id));
      assert(outside.length === 0, `${outside.length} nearby clients are not on this user's map, e.g. ${outside[0]?.code}`);
      const inScope = new Set(ids(expected));
      const leaked = res.body.filter((p) => !inScope.has(p.id));
      assert(leaked.length === 0, `${leaked.length} of ${res.body.length} nearby clients are outside the spec's scope, e.g. ${leaked[0]?.code} assigned to ${leaked[0]?.assignedSellerId}`);
    });
  }

  await check('supervisor: no client of the seller outside his team, on the map or nearby', async () => {
    const points = await wholeMap(A.supervisor, { includeInactive: true });
    assert(!points.some((p) => p.assignedSellerId === A.sellerOut.id), 'a client of the outside seller is on the map');
    const target = truth.find((r) => r.assignedSellerId === A.sellerOut.id && located(r) && r.active)!;
    const near = await get<Point[]>(`/clients/nearby${qs({ lat: target.lat!, lng: target.lng!, radiusM: 100, limit: 100 })}`, A.supervisor);
    assert(!near.body.some((p) => p.id === target.id), 'centred on it, the outside seller\'s client shows up');
    const filtered = await get<MapBody>(`/clients/map${qs({ assignedSellerId: A.sellerOut.id })}`, A.supervisor);
    assertEqual(filtered.body.points.length, 0, 'points with assignedSellerId = the outside seller');
    assertEqual(filtered.body.withoutLocation, 0, 'withoutLocation must not count out-of-scope clients');
  });

  await check('seller1: asking for another seller\'s clients (filter, search by exact code, centre on it) gives nothing', async () => {
    const other = truth.find((r) => r.assignedSellerId === A.seller2.id && located(r) && r.active)!;
    const byFilter = await get<MapBody>(`/clients/map${qs({ assignedSellerId: A.seller2.id, includeInactive: true })}`, A.seller1);
    assertEqual(byFilter.body.points.length, 0, 'assignedSellerId=seller2');
    assertEqual(byFilter.body.withoutLocation, 0, 'withoutLocation for seller2\'s clients');
    const byCode = await get<MapBody>(`/clients/map${qs({ search: other.code })}`, A.seller1);
    assertEqual(byCode.body.points.length, 0, 'search = the other client\'s code');
    const near = await get<Point[]>(`/clients/nearby${qs({ lat: other.lat!, lng: other.lng!, radiusM: 100 })}`, A.seller1);
    assert(!near.body.some((p) => p.id === other.id), 'nearby centred on the other client returns it');
  });

  await check('`withoutLocation` counts only the user\'s own clients, for each role', async () => {
    for (const role of roles) {
      const expected = applyFilters(truth, {}, role.sellerIds).filter((r) => !located(r)).length;
      const res = await get<MapBody>('/clients/map', role.user);
      assert(res.body.withoutLocation === expected, `${role.label}: withoutLocation ${res.body.withoutLocation}, expected ${expected}`);
    }
  });

  // ------------------------------------------------------------------ tenant isolation
  area('A2 tenant isolation — tenant B sits on the very same coordinates');
  const bRows = await truthRows(f.b.tenantId);
  const bIds = new Set(ids(bRows));
  await check('A\'s whole map holds no client of B, for every role', async () => {
    for (const role of roles) {
      const points = await wholeMap(role.user, { includeInactive: true });
      const foreign = points.filter((p) => bIds.has(p.id) || p.code.startsWith('B35'));
      assert(foreign.length === 0, `${role.label} sees ${foreign.length} clients of tenant B`);
    }
  });
  await check('nearby centred on 60 coordinates of B (100 m and 50 km) never returns a client of B', async () => {
    for (const b of bRows.filter(located).slice(0, 60)) {
      for (const radiusM of [100, 50000]) {
        const res = await get<Point[]>(`/clients/nearby${qs({ lat: b.lat, lng: b.lng, radiusM, limit: 100, includeInactive: true })}`, A.owner);
        assertEqual(res.status, 200, 'status');
        const foreign = res.body.filter((p) => bIds.has(p.id) || p.code.startsWith('B35'));
        assert(foreign.length === 0, `centre ${b.lat},${b.lng} r=${radiusM}: ${foreign.length} clients of B`);
        // Tenant A does have a client on that exact point: the query really ran there.
        if (radiusM === 100) assert(res.body.some((p) => p.distanceM === 0), `no client of A at ${b.lat},${b.lng}: the seed changed?`);
      }
    }
  });
  await check('B\'s sector id, seller id and client id as filters or search give nothing and no 500', async () => {
    const probes: Record<string, string>[] = [
      { sectorId: f.b.sectorId },
      { assignedSellerId: f.b.seller.id },
      { sectorId: f.b.sectorId, assignedSellerId: f.b.seller.id },
      { search: f.b.clientIds[0]! },
      { search: 'B35' },
      { search: 'B35 client 0000' },
    ];
    for (const p of probes) {
      for (const path of [`/clients/map${qs({ ...p, includeInactive: true })}`, `/clients/nearby${qs({ ...p, ...ALGER, radiusM: 50000, limit: 100 })}`, `/clients${qs(p)}`]) {
        const res = await get<MapBody | Point[] | { items: unknown[] }>(path, A.owner);
        assertEqual(res.status, 200, `${path} status`);
        const n = Array.isArray(res.body) ? res.body.length : 'points' in res.body ? res.body.points.length : res.body.items.length;
        assert(n === 0, `${path}: ${n} rows`);
        if (!Array.isArray(res.body) && 'withoutLocation' in res.body) assertEqual(res.body.withoutLocation, 0, `${path} withoutLocation`);
      }
    }
  });
  await check('B\'s owner sees his 300 clients and none of A\'s; B\'s seller only his own', async () => {
    const all = await get<MapBody>('/clients/map?includeInactive=true', f.b.owner);
    assertSameSet(ids(all.body.points), bIds, 'B owner');
    const mine = await get<MapBody>('/clients/map?includeInactive=true', f.b.seller);
    assertSameSet(ids(mine.body.points), ids(bRows.filter((r) => r.assignedSellerId === f.b.seller.id)), 'B seller');
  });
  await check('a route of B is not found by A; a client of B is refused as a stop of A\'s route', async () => {
    const bRoute = await request<{ id: string }>('/routes', {
      method: 'POST', token: f.b.owner.token, idempotencyKey: idemKey('r'),
      body: { name: `B route ${run}`, sellerId: f.b.seller.id, weekdays: [1], active: true },
    });
    assertEqual(bRoute.status, 201, 'B creates a route');
    const read = await get(`/routes/${bRoute.body.id}`, A.owner);
    assertEqual(read.status, 404, 'A reads B\'s route');
    const write = await request(`/routes/${bRoute.body.id}/stops`, { method: 'PUT', token: A.owner.token, body: { clientIds: [] } });
    assertEqual(write.status, 404, 'A writes B\'s route');
    const aRoute = await request<{ id: string }>('/routes', {
      method: 'POST', token: A.owner.token, idempotencyKey: idemKey('r'),
      body: { name: `A iso ${run}`, sellerId: A.seller1.id, weekdays: [1], active: true },
    });
    const mix = await request<{ code: string }>(`/routes/${aRoute.body.id}/stops`, { method: 'PUT', token: A.owner.token, body: { clientIds: [f.b.clientIds[0]] } });
    assertEqual(mix.status, 400, 'a client of B on A\'s route');
  });

  // ------------------------------------------------------------------ filters
  area('A3 filters — every combination against the tables');
  const combos: Filters[] = [];
  for (let m = 0; m < 64; m++) {
    combos.push({
      search: m & 1 ? 'café' : undefined,
      sectorId: m & 2 ? A.sectors.alger : undefined,
      assignedSellerId: m & 4 ? A.seller1.id : undefined,
      hasDebt: Boolean(m & 8),
      overLimit: Boolean(m & 16),
      includeInactive: Boolean(m & 32),
    });
  }
  await check('/clients/map: the 64 combinations of the six filters (ids in order, truncated, withoutLocation)', async () => {
    const bad: string[] = [];
    for (const q of combos) {
      const all = applyFilters(truth, q, null);
      const withPoint = all.filter(located);
      const res = await get<MapBody>(`/clients/map${qs(toQuery(q))}`, A.owner);
      if (res.status !== 200) {
        bad.push(`${JSON.stringify(q)} → HTTP ${res.status}`);
        continue;
      }
      const expectedIds = ids(withPoint.slice(0, 2000));
      if (JSON.stringify(ids(res.body.points)) !== JSON.stringify(expectedIds)) {
        const d = sameSet(ids(res.body.points), expectedIds);
        bad.push(`${JSON.stringify(q)} → ${res.body.points.length} points for ${expectedIds.length} (missing ${d.missing.length}, extra ${d.extra.length}${d.missing.length + d.extra.length === 0 ? ', same set in another order' : ''})`);
      }
      if (res.body.truncated !== withPoint.length > 2000) bad.push(`${JSON.stringify(q)} → truncated ${res.body.truncated}`);
      const without = all.filter((r) => !located(r)).length;
      if (res.body.withoutLocation !== without) bad.push(`${JSON.stringify(q)} → withoutLocation ${res.body.withoutLocation}, expected ${without}`);
    }
    if (bad.length) proof('filters-map.txt', bad.join('\n'));
    assert(bad.length === 0, `${bad.length} of 64 combinations differ: ${bad.slice(0, 3).join(' | ')}`);
  });
  await check('/clients/map: the same 64 combinations for the supervisor (scope and filters together)', async () => {
    const bad: string[] = [];
    for (const q of combos) {
      const all = applyFilters(truth, q, team);
      const res = await get<MapBody>(`/clients/map${qs(toQuery(q))}`, A.supervisor);
      const expectedIds = ids(all.filter(located).slice(0, 2000));
      if (res.status !== 200 || JSON.stringify(ids(res.body.points)) !== JSON.stringify(expectedIds)) bad.push(`${JSON.stringify(q)} → ${res.status} ${res.body.points?.length} for ${expectedIds.length}`);
      else if (res.body.withoutLocation !== all.filter((r) => !located(r)).length) bad.push(`${JSON.stringify(q)} → withoutLocation ${res.body.withoutLocation}`);
    }
    assert(bad.length === 0, `${bad.length} differ: ${bad.slice(0, 3).join(' | ')}`);
  });
  await check('/clients/nearby: the 64 combinations, 50 km around Alger, the 100 nearest', async () => {
    const bad: string[] = [];
    for (const q of combos) {
      const within = applyFilters(truth, q, null)
        .filter(located)
        .map((r) => ({ id: r.id, d: haversineM(ALGER, r) }))
        .filter((r) => r.d <= 50000)
        .sort((x, y) => x.d - y.d);
      const res = await get<Point[]>(`/clients/nearby${qs({ ...toQuery(q), ...ALGER, radiusM: 50000, limit: 100 })}`, A.owner);
      if (res.status !== 200) {
        bad.push(`${JSON.stringify(q)} → HTTP ${res.status}`);
        continue;
      }
      const cut = within[99]?.d ?? Infinity;
      const sure = within.filter((r) => r.d < cut - 0.01).map((r) => r.id);
      const maybe = new Set(within.filter((r) => r.d <= cut + 0.01).map((r) => r.id));
      const got = ids(res.body);
      if (got.length !== Math.min(100, within.length)) bad.push(`${JSON.stringify(q)} → ${got.length} rows for ${Math.min(100, within.length)}`);
      else if (sure.some((id) => !got.includes(id)) || got.some((id) => !maybe.has(id))) bad.push(`${JSON.stringify(q)} → not the nearest ones`);
    }
    if (bad.length) proof('filters-nearby.txt', bad.join('\n'));
    assert(bad.length === 0, `${bad.length} of 64 combinations differ: ${bad.slice(0, 3).join(' | ')}`);
  });
  await check('search treats %, _ and \\ as plain characters (map, nearby, list)', async () => {
    for (const s of ['%', '_', '\\', '100%', 'A_B', "O'Brien", 'مخبزة', '<b>', 'éléonore', '"Guillemets"']) {
      const expected = applyFilters(truth, { search: s }, null);
      const m = await get<MapBody>(`/clients/map${qs({ search: s })}`, A.owner);
      assertEqual(m.status, 200, `map search=${s}`);
      assertSameSet(ids(m.body.points), ids(expected.filter(located)), `map search=${s}`);
      const l = await wholeList(A.owner, { search: s });
      assertSameSet(ids(l.filter((c) => c.active)), ids(expected), `list search=${s}`);
    }
  });
  await check('GET /clients?hasLocation=true|false splits the list exactly, alone and with the other filters', async () => {
    for (const extra of [{}, { hasDebt: true }, { overLimit: true }, { sectorId: A.sectors.oran }, { assignedSellerId: A.seller2.id }, { sort: 'balance_desc' }, { unassigned: 'seller' }] as Record<string, string | boolean>[]) {
      const [all, withP, withoutP] = await Promise.all([
        wholeList(A.owner, extra),
        wholeList(A.owner, { ...extra, hasLocation: true }),
        wholeList(A.owner, { ...extra, hasLocation: false }),
      ]);
      assert(withP.every((c) => c.location !== null), `${JSON.stringify(extra)}: hasLocation=true has a client without a point`);
      assert(withoutP.every((c) => c.location === null), `${JSON.stringify(extra)}: hasLocation=false has a client with a point`);
      assertSameSet([...ids(withP), ...ids(withoutP)], ids(all), `${JSON.stringify(extra)}: with + without = all`);
      assert(withP.length + withoutP.length === all.length, `${JSON.stringify(extra)}: a client is in both halves`);
    }
    const bad = await get<{ code: string }>('/clients?hasLocation=maybe', A.owner);
    assertEqual(bad.status, 400, 'hasLocation=maybe');
  });

  // ------------------------------------------------------------------ cap
  area('A4 cap — 2 000 points, the edge at 1 999 / 2 000 / 2 001');
  const onMap = applyFilters(truth, {}, null).filter(located);
  await check(`${onMap.length} clients match: 2 000 points, truncated, ordered by name then id`, async () => {
    const res = await get<MapBody>('/clients/map', A.owner);
    assertEqual(res.body.points.length, 2000, 'points');
    assertEqual(res.body.truncated, true, 'truncated');
    assertEqual(ids(res.body.points), ids(onMap.slice(0, 2000)), 'the first 2 000 by name');
    assertEqual(res.headers.get('cache-control'), 'private, max-age=30', 'Cache-Control');
  });
  await check('a box holding exactly 1 999, 2 000 and 2 001 clients', async () => {
    const byLng = [...onMap].sort((x, y) => x.lng - y.lng);
    for (const k of [1999, 2000, 2001]) {
      // A longitude strictly between the k-th and the (k+1)-th client.
      let n = k;
      while (byLng[n - 1]!.lng === byLng[n]!.lng) n++;
      assert(n === k, `clients ${k} and ${k + 1} share a longitude: pick another seed`);
      const maxLng = Math.round(((byLng[k - 1]!.lng + byLng[k]!.lng) / 2) * 1e7) / 1e7;
      const res = await get<MapBody>(`/clients/map${qs({ minLat: -90, maxLat: 90, minLng: -180, maxLng })}`, A.owner);
      assertEqual(res.status, 200, `k=${k} status`);
      assertEqual(res.body.points.length, Math.min(k, 2000), `k=${k} points`);
      assertEqual(res.body.truncated, k > 2000, `k=${k} truncated`);
    }
  });
  await check('the box is inclusive on its four edges', async () => {
    const c = onMap[100]!;
    const res = await get<MapBody>(`/clients/map${qs({ minLat: c.lat - 0.000001, maxLat: c.lat, minLng: c.lng - 0.000001, maxLng: c.lng })}`, A.owner);
    assert(res.body.points.some((p) => p.id === c.id), 'a client on the max edge is left out');
    const res2 = await get<MapBody>(`/clients/map${qs({ minLat: c.lat, maxLat: c.lat + 0.000001, minLng: c.lng, maxLng: c.lng + 0.000001 })}`, A.owner);
    assert(res2.body.points.some((p) => p.id === c.id), 'a client on the min edge is left out');
  });
  await check('the point DTO is the compact one of the spec, nothing more', async () => {
    const res = await get<MapBody>('/clients/map?search=T35-00001', A.owner);
    const keys = Object.keys(res.body.points[0] ?? {}).sort();
    assertEqual(keys, ['active', 'assignedSellerId', 'balance', 'code', 'commune', 'id', 'lat', 'lng', 'name', 'overLimit', 'phone', 'sectorId'], 'keys');
    const near = await get<Point[]>(`/clients/nearby${qs({ ...ALGER, limit: 1 })}`, A.owner);
    assertEqual(Object.keys(near.body[0] ?? {}).sort(), [...keys, 'distanceM'].sort(), 'nearby keys');
    for (const p of res.body.points) assert(/^-?\d+\.\d{2}$/.test(p.balance), `balance "${p.balance}" is not a decimal string`);
  });

  // ------------------------------------------------------------------ hostile input
  area('A5 hostile input — 400 with a code, never 500');
  type Expect = 400 | 200 | 'no-500';
  const cases: { path: string; expect: Expect; why: string }[] = [];
  const box = { minLat: '36', minLng: '2', maxLat: '37', maxLng: '4' };
  const keys = Object.keys(box) as (keyof typeof box)[];
  for (let m = 1; m < 15; m++) {
    const part = Object.fromEntries(keys.filter((_, i) => m & (1 << i)).map((k) => [k, box[k]]));
    cases.push({ path: `/clients/map${qs(part)}`, expect: 400, why: `incomplete box (${Object.keys(part).join(', ')})` });
  }
  const mapWith = (o: Partial<typeof box>, why: string, expect: Expect = 400): void => {
    cases.push({ path: `/clients/map?${Object.entries({ ...box, ...o }).map(([k, v]) => `${k}=${v}`).join('&')}`, expect, why });
  };
  mapWith({ minLat: '37', maxLat: '36' }, 'minLat > maxLat');
  mapWith({ minLat: '36', maxLat: '36' }, 'minLat = maxLat');
  mapWith({ minLng: '4', maxLng: '2' }, 'minLng > maxLng');
  mapWith({ minLng: '179', maxLng: '-179' }, 'box across the antimeridian (minLng 179, maxLng -179)', 'no-500');
  mapWith({ maxLat: '90.0001' }, 'maxLat above 90');
  mapWith({ minLat: '-91' }, 'minLat below -90');
  mapWith({ maxLng: '180.5' }, 'maxLng above 180');
  mapWith({ minLng: '-181' }, 'minLng below -180');
  mapWith({ minLat: 'abc' }, 'a word');
  mapWith({ minLat: 'NaN' }, 'NaN');
  mapWith({ maxLat: 'Infinity' }, 'Infinity');
  mapWith({ minLat: '-Infinity' }, '-Infinity');
  mapWith({ maxLat: '1e2' }, 'exponent notation above the range (1e2 = 100)');
  mapWith({ minLat: '3.6e1', maxLat: '3.7e1' }, 'exponent notation inside the range', 'no-500');
  mapWith({ minLat: '0x24' }, 'hexadecimal (0x24 = 36)', 'no-500');
  mapWith({ minLat: '' }, 'empty value', 'no-500');
  mapWith({ minLat: '%20' }, 'a space', 'no-500');
  mapWith({ minLat: '36,5' }, 'decimal comma');
  mapWith({ minLat: '٣٦' }, 'Arabic digits');
  mapWith({ minLat: '1'.repeat(10000) }, '10 000 digits');
  mapWith({ minLat: `36.${'1'.repeat(10000)}` }, '10 000 decimals', 'no-500');
  mapWith({ minLat: '36%00' }, 'a NUL byte');
  mapWith({ minLat: 'null' }, 'the word null');
  mapWith({ minLat: 'true' }, 'the word true');
  cases.push({ path: '/clients/map?minLat=36&minLat=36.5&minLng=2&maxLat=37&maxLng=4', expect: 400, why: 'minLat sent twice' });
  cases.push({ path: '/clients/map?minLat[]=36&minLng=2&maxLat=37&maxLng=4', expect: 400, why: 'minLat as an array' });
  cases.push({ path: '/clients/map?minLat[a]=36&minLng=2&maxLat=37&maxLng=4', expect: 400, why: 'minLat as an object' });
  cases.push({ path: '/clients/map?sectorId=not-a-uuid', expect: 400, why: 'sectorId not a uuid' });
  cases.push({ path: "/clients/map?assignedSellerId=' OR 1=1 --", expect: 400, why: 'SQL in assignedSellerId' });
  cases.push({ path: '/clients/map?hasDebt=yes', expect: 400, why: 'hasDebt=yes' });
  cases.push({ path: '/clients/map?includeInactive=1', expect: 400, why: 'includeInactive=1' });
  cases.push({ path: `/clients/map?search=${'a'.repeat(101)}`, expect: 400, why: 'search of 101 characters' });
  cases.push({ path: '/clients/map?search=%00', expect: 'no-500', why: 'search with a NUL byte' });
  cases.push({ path: '/clients/map?search=abc%00def', expect: 'no-500', why: 'search with a NUL byte inside' });
  cases.push({ path: "/clients/map?search=');DROP TABLE clients;--", expect: 200, why: 'SQL in search' });
  cases.push({ path: '/clients/map?search=%5C', expect: 200, why: 'search = one backslash' });
  cases.push({ path: '/clients/map?search=%E0%A4%A', expect: 'no-500', why: 'broken percent-encoding in search' });
  cases.push({ path: '/clients/map?search[]=a&search[]=b', expect: 'no-500', why: 'search as an array' });
  cases.push({ path: '/clients/map?tenantId=' + f.b.tenantId, expect: 'no-500', why: 'a tenantId parameter' });
  const near = (o: Record<string, string>, why: string, expect: Expect = 400): void => {
    cases.push({ path: `/clients/nearby?${Object.entries(o).map(([k, v]) => `${k}=${v}`).join('&')}`, expect, why });
  };
  near({}, 'no position');
  near({ lat: '36.75' }, 'lat without lng');
  near({ lng: '3.06' }, 'lng without lat');
  near({ lat: '', lng: '' }, 'empty lat and lng', 'no-500');
  near({ lat: '90.1', lng: '3' }, 'lat above 90');
  near({ lat: '36', lng: '-180.1' }, 'lng below -180');
  near({ lat: 'NaN', lng: '3' }, 'NaN');
  near({ lat: 'Infinity', lng: '3' }, 'Infinity');
  near({ lat: '1e400', lng: '3' }, '1e400');
  near({ lat: '3.675e1', lng: '3.06e0' }, 'exponent notation inside the range', 'no-500');
  near({ lat: '36.75', lng: '3.06', radiusM: '99' }, 'radiusM 99');
  near({ lat: '36.75', lng: '3.06', radiusM: '100' }, 'radiusM 100', 200);
  near({ lat: '36.75', lng: '3.06', radiusM: '50000' }, 'radiusM 50 000', 200);
  near({ lat: '36.75', lng: '3.06', radiusM: '50001' }, 'radiusM 50 001');
  near({ lat: '36.75', lng: '3.06', radiusM: '-5' }, 'radiusM negative');
  near({ lat: '36.75', lng: '3.06', radiusM: '1000.5' }, 'radiusM with decimals', 'no-500');
  near({ lat: '36.75', lng: '3.06', radiusM: 'abc' }, 'radiusM a word');
  near({ lat: '36.75', lng: '3.06', limit: '0' }, 'limit 0');
  near({ lat: '36.75', lng: '3.06', limit: '1' }, 'limit 1', 200);
  near({ lat: '36.75', lng: '3.06', limit: '100' }, 'limit 100', 200);
  near({ lat: '36.75', lng: '3.06', limit: '101' }, 'limit 101');
  near({ lat: '36.75', lng: '3.06', limit: '1.5' }, 'limit 1.5');
  near({ lat: '36.75', lng: '3.06', limit: '-1' }, 'limit -1');
  near({ lat: '36.75', lng: '3.06', limit: '9'.repeat(400) }, 'limit of 400 digits');
  near({ lat: '90', lng: '0' }, 'the north pole', 200);
  near({ lat: '-90', lng: '180' }, 'the south pole at lng 180', 200);
  near({ lat: '0', lng: '0' }, 'lat 0, lng 0', 200);
  near({ lat: '36.75', lng: '180', radiusM: '50000' }, 'on the antimeridian', 200);
  near({ lat: '89.9999', lng: '-180', radiusM: '50000' }, 'next to the pole', 200);
  cases.push({ path: '/clients/nearby?lat=1&lat=2&lng=3', expect: 400, why: 'lat sent twice' });
  cases.push({ path: '/clients/nearby?lat=36.75&lng=3.06&search=%00', expect: 'no-500', why: 'nearby search with a NUL byte' });
  cases.push({ path: '/clients?hasLocation=true&search=%00', expect: 'no-500', why: 'list search with a NUL byte (older route, for comparison)' });

  const table: string[] = ['| Input | Why | Expected | HTTP | code |', '|---|---|---|---|---|'];
  const wrong: string[] = [];
  const fiveHundreds: string[] = [];
  const accepted: string[] = [];
  for (const c of cases) {
    const res = await request<{ code?: string }>(c.path, { token: A.owner.token });
    const code = typeof res.body === 'object' && res.body !== null ? ((res.body as { code?: string }).code ?? '') : '';
    const shown = c.path.length > 90 ? `${c.path.slice(0, 87)}…` : c.path;
    table.push(`| \`${shown.replace(/\|/g, '\\|')}\` | ${c.why} | ${c.expect} | ${res.status} | ${code} |`);
    if (res.status >= 500) fiveHundreds.push(`${c.why}: HTTP ${res.status} ${code} (${shown})`);
    else if (c.expect === 400 && (res.status !== 400 || !code)) wrong.push(`${c.why}: HTTP ${res.status} ${code}`);
    else if (c.expect === 200 && res.status !== 200) wrong.push(`${c.why}: HTTP ${res.status} ${code}`);
    if (c.expect === 'no-500' && res.status === 200) accepted.push(c.why);
  }
  proof('hostile-inputs.md', `# Hostile input on /clients/map and /clients/nearby\n\n${cases.length} requests as tenant A's owner.\n\n${table.join('\n')}\n`);
  await check(`${cases.length} hostile requests: none answers 500`, () => {
    assert(fiveHundreds.length === 0, `${fiveHundreds.join(' | ')} — table in artifacts/test-35/hostile-inputs.md`);
  }, { expected: '400 VALIDATION_FAILED (AGENTS.md §4: every input validated)' });
  await check('every input the spec forbids answers 400 with a `code`; every edge value it allows answers 200', () => {
    assert(wrong.length === 0, wrong.join(' | '));
  });
  record({ name: 'inputs the schema lets through although they are not plain decimal numbers', status: 'INFO', actual: accepted.join('; ') });
  await check('an empty `lat=&lng=` is not read as the position 0, 0', async () => {
    const res = await request<unknown>('/clients/nearby?lat=&lng=', { token: A.owner.token });
    assert(res.status === 400, `HTTP ${res.status}: the empty strings were coerced to 0 (z.coerce.number, packages/shared/src/schemas/clients.ts:105-106), so the route searched around 0°N 0°E`);
  }, { expected: '400 VALIDATION_FAILED' });
  await check('no token → 401 on both routes', async () => {
    for (const p of ['/clients/map', '/clients/nearby?lat=36.75&lng=3.06']) {
      const res = await request<{ code: string }>(p);
      assertEqual(res.status, 401, p);
    }
  });

  // ------------------------------------------------------------------ nearby edges
  area('A6 nearby — the radius edge, the poles, the equator, the antimeridian');
  const R = 6_371_008.8;
  const north = (c: { lat: number; lng: number }, m: number) => ({ lat: c.lat + (m / R) * (180 / Math.PI), lng: c.lng });
  const east = (c: { lat: number; lng: number }, m: number) => ({
    lat: c.lat,
    lng: c.lng + ((m / R) * (180 / Math.PI)) / Math.cos((c.lat * Math.PI) / 180),
  });
  const r6 = (p: { lat: number; lng: number }) => ({ lat: Math.round(p.lat * 1e6) / 1e6, lng: Math.round(p.lng * 1e6) / 1e6 });
  const SAHARA = { lat: 30, lng: 8 };
  const EQUATOR = { lat: 0, lng: 8 };
  const POLE = { lat: 89.95, lng: 0 };
  const DATELINE = { lat: -16.5, lng: 179.99 };
  const edge: { code: string; lat: number; lng: number }[] = [
    { code: 'EDGE-S-N4990', ...r6(north(SAHARA, 4990)) },
    { code: 'EDGE-S-N5010', ...r6(north(SAHARA, 5010)) },
    { code: 'EDGE-S-S4990', ...r6(north(SAHARA, -4990)) },
    { code: 'EDGE-S-S5010', ...r6(north(SAHARA, -5010)) },
    { code: 'EDGE-S-E4990', ...r6(east(SAHARA, 4990)) },
    { code: 'EDGE-S-E5010', ...r6(east(SAHARA, 5010)) },
    { code: 'EDGE-S-W4990', ...r6(east(SAHARA, -4990)) },
    { code: 'EDGE-S-W5010', ...r6(east(SAHARA, -5010)) },
    { code: 'EDGE-S-NE4990', ...r6(east(north(SAHARA, 3528), 3528.6)) },
    { code: 'EDGE-Q-N4990', ...r6(north(EQUATOR, 4990)) },
    { code: 'EDGE-Q-S4990', ...r6(north(EQUATOR, -4990)) },
    { code: 'EDGE-Q-E4990', ...r6(east(EQUATOR, 4990)) },
    { code: 'EDGE-Q-W5010', ...r6(east(EQUATOR, -5010)) },
    { code: 'EDGE-P-OPPOSITE', lat: 89.95, lng: 180 },
    { code: 'EDGE-P-SIDE', lat: 89.99, lng: 90 },
    { code: 'EDGE-P-TOP', lat: 90, lng: -120 },
    { code: 'EDGE-D-ACROSS', lat: -16.5, lng: -179.99 },
    { code: 'EDGE-D-SAME', lat: -16.51, lng: 179.98 },
    { code: 'EDGE-D-FAR', lat: -16.5, lng: -179.9 },
  ];
  await query(
    `INSERT INTO clients (id, "tenantId", code, name, lat, lng, "updatedAt")
     SELECT gen_random_uuid(), $1::uuid, t.code, 'Edge ' || t.code, t.lat, t.lng, now()
     FROM unnest($2::text[], $3::numeric[], $4::numeric[]) AS t(code, lat, lng)
     ON CONFLICT ("tenantId", code) DO UPDATE SET lat = EXCLUDED.lat, lng = EXCLUDED.lng, "deletedAt" = NULL, active = true`,
    [A.tenantId, edge.map((e) => e.code), edge.map((e) => e.lat), edge.map((e) => e.lng)],
  );
  const edgeCheck = async (label: string, centre: { lat: number; lng: number }, radiusM: number): Promise<void> => {
    await check(`${label}: r=${radiusM} m returns exactly the edge clients within the radius`, async () => {
      const res = await get<Point[]>(`/clients/nearby${qs({ ...centre, radiusM, limit: 100 })}`, A.owner);
      assertEqual(res.status, 200, 'status');
      const got = res.body.filter((p) => p.code.startsWith('EDGE-')).map((p) => p.code).sort();
      const expected = edge.filter((e) => haversineM(centre, e) <= radiusM).map((e) => e.code).sort();
      assertEqual(got, expected, `clients within ${radiusM} m (distances: ${edge.filter((e) => haversineM(centre, e) < radiusM * 3).map((e) => `${e.code}=${haversineM(centre, e).toFixed(1)}`).join(', ')})`);
      for (const p of res.body) {
        assert(Number.isInteger(p.distanceM), `distanceM ${p.distanceM} is not an integer`);
        const exact = haversineM(centre, p);
        assert(Math.abs(p.distanceM! - exact) <= 1, `${p.code}: distanceM ${p.distanceM} but haversineM says ${exact.toFixed(2)}`);
      }
    });
  };
  await edgeCheck('Sahara (30°N)', SAHARA, 5000);
  await edgeCheck('Sahara (30°N)', SAHARA, 5010);
  await edgeCheck('Sahara (30°N)', SAHARA, 4989);
  await edgeCheck('equator', EQUATOR, 5000);
  await edgeCheck('near the north pole (89.95°N)', POLE, 20000);
  await edgeCheck('near the north pole (89.95°N)', POLE, 5000);
  await edgeCheck('on the pole', { lat: 90, lng: 0 }, 6000);
  await edgeCheck('next to the antimeridian (179.99°E)', DATELINE, 5000);
  await edgeCheck('next to the antimeridian (179.99°E)', DATELINE, 50000);
  await edgeCheck('from the other side (-179.99°)', { lat: -16.5, lng: -179.99 }, 5000);
  await check('distanceM is sorted ascending; `limit` keeps the nearest', async () => {
    for (const c of [ALGER, { lat: 35.6971, lng: -0.6308 }, { lat: 36.1898, lng: 5.4108 }]) {
      const res = await get<Point[]>(`/clients/nearby${qs({ ...c, radiusM: 50000, limit: 100 })}`, A.owner);
      const d = res.body.map((p) => p.distanceM!);
      assert(d.every((x, i) => i === 0 || d[i - 1]! <= x), 'not ascending');
      const one = await get<Point[]>(`/clients/nearby${qs({ ...c, radiusM: 50000, limit: 1 })}`, A.owner);
      assertEqual(one.body[0]?.id, res.body[0]?.id, 'limit=1 is the nearest');
      const five = await get<Point[]>(`/clients/nearby${qs({ ...c, radiusM: 50000, limit: 5 })}`, A.owner);
      assertEqual(ids(five.body), ids(res.body).slice(0, 5), 'limit=5 is the head of limit=100');
    }
  });
  await check('five clients on one point: the tie is ordered by name then id, the same on 10 calls', async () => {
    const tied = truth.filter((r) => r.name.startsWith('Même point') && r.active && located(r));
    assert(tied.length >= 3, `only ${tied.length} tied clients are live: the seed changed?`);
    const first = await get<Point[]>(`/clients/nearby${qs({ ...ALGER, radiusM: 100, limit: 100 })}`, A.owner);
    const zero = first.body.filter((p) => p.distanceM === 0);
    assertEqual(ids(zero), ids(tied), 'the tied clients, in name then id order');
    for (let i = 0; i < 10; i++) {
      const again = await get<Point[]>(`/clients/nearby${qs({ ...ALGER, radiusM: 100, limit: 100 })}`, A.owner);
      assertEqual(ids(again.body), ids(first.body), `call ${i + 2}`);
    }
  });

  // The edge clients sit on the pole and the antimeridian: left live, they would stretch
  // the map of tenant A to the whole world for the browser checks (parts C and D).
  await query(`UPDATE clients SET "deletedAt" = now() WHERE "tenantId" = $1 AND code LIKE 'EDGE-%'`, [A.tenantId]);

  // ------------------------------------------------------------------ feature gates
  area('A7 feature gates');
  await check('Essentiel (no GEO_CHECK): map and nearby refused with FEATURE_NOT_IN_PLAN', async () => {
    for (const p of ['/clients/map', '/clients/nearby?lat=36.75&lng=3.06']) {
      const res = await get<{ code: string; details: { feature: string } }>(p, f.c.owner);
      assertEqual([res.status, res.body.code, res.body.details?.feature], [403, 'FEATURE_NOT_IN_PLAN', 'GEO_CHECK'], p);
    }
  });
  await check('Distribution with GEO_CHECK revoked and TOURNEES kept: map and nearby refused', async () => {
    for (const u of [f.d.owner, f.d.seller]) {
      for (const p of ['/clients/map', '/clients/nearby?lat=36.75&lng=3.06']) {
        const res = await get<{ code: string }>(p, u);
        assertEqual([res.status, res.body.code], [403, 'FEATURE_NOT_IN_PLAN'], `${u.role} ${p}`);
      }
    }
  });
  {
    // Where do coordinates still come out without GEO_CHECK? Proven either way, then judged in the report.
    const route = await get<{ start: unknown; stops: { client: { lat: number | null; lng: number | null } }[] }>(`/routes/${f.d.routeId}`, f.d.owner);
    const today = await get<{ stops: { client: { lat: number | null; lng: number | null } }[] }>('/me/today', f.d.seller);
    const list = await get<{ items: { location: unknown }[] }>('/clients?limit=5', f.d.owner);
    const one = await get<{ location: unknown }>(`/clients/${f.d.clientIds[0]}`, f.d.owner);
    const wh = await get<Record<string, unknown>[]>('/warehouses', f.d.owner);
    const facts = {
      tenant: 'D: edition DISTRIBUTION, featureRevokes [GEO_CHECK], TOURNEES on',
      'GET /clients/map': 403,
      'GET /routes/:id → stops[].client.lat/lng': route.body.stops?.filter((s) => s.client.lat !== null).length ?? route.status,
      'GET /routes/:id → start': route.body.start ?? null,
      'GET /me/today → stops[].client.lat/lng': today.body.stops?.filter((s) => s.client.lat !== null).length ?? today.status,
      'GET /clients → items[].location (phase 17 DTO)': list.body.items?.filter((c) => c.location !== null).length ?? list.status,
      'GET /clients/:id → location (phase 17 DTO)': one.body.location ?? null,
      'GET /warehouses → a dépôt with lat/lng or location': wh.body.filter?.((w) => JSON.stringify(w).includes('36.77')).length ?? wh.status,
    };
    proof('geo-check-off-coordinates.json', JSON.stringify(facts, null, 2));
    const routeLeaks = (route.body.stops ?? []).some((s) => s.client.lat !== null) || route.body.start !== null;
    const todayLeaks = (today.body.stops ?? []).some((s) => s.client.lat !== null);
    const olderLeak = (list.body.items ?? []).some((c) => c.location !== null);
    record({
      name: 'without GEO_CHECK: do GET /routes/:id and GET /me/today still hand out client lat/lng and the dépôt start point?',
      status: 'INFO',
      actual: `routes/:id ${routeLeaks ? 'YES' : 'no'}, me/today ${todayLeaks ? 'YES' : 'no'}; the phase 17 client DTO (GET /clients) ${olderLeak ? 'also carries `location` there' : 'hides `location` there'}`,
      evidence: 'artifacts/test-35/geo-check-off-coordinates.json',
    });
    await check('without GEO_CHECK the route DTO carries no coordinates (stops lat/lng null, start null)', () => {
      assert(!routeLeaks && !todayLeaks, `routes/:id leaks: ${routeLeaks}, me/today leaks: ${todayLeaks} (see geo-check-off-coordinates.json)`);
    }, { expected: 'no coordinates without GEO_CHECK (spec: "the map needs Feature.GEO_CHECK")' });
  }
  await check('permission CLIENTS_VIEW revoked from a user → map and nearby refused, given back → allowed', async () => {
    const u = await inviteUser(A.owner.token, 'SELLER', `noview-${run}`);
    const before = await get('/clients/map', u);
    assertEqual(before.status, 200, 'before the revoke');
    const put = await request(`/users/${u.id}/permissions`, { method: 'PUT', token: A.owner.token, body: { grants: [], revokes: ['CLIENTS_VIEW'] } });
    assert(put.status < 300, `revoke: HTTP ${put.status} ${put.raw.slice(0, 200)}`);
    for (const p of ['/clients/map', '/clients/nearby?lat=36.75&lng=3.06']) {
      const res = await get<{ code: string }>(p, u);
      assertEqual(res.status, 403, `${p} after the revoke (same token)`);
    }
    await request(`/users/${u.id}/permissions`, { method: 'PUT', token: A.owner.token, body: { grants: [], revokes: [] } });
    const after = await get('/clients/map', u);
    assertEqual(after.status, 200, 'after giving it back');
  });

  // ------------------------------------------------------------------ route stops
  area('A8 route stops picked from the map — PUT /routes/:id/stops');
  interface RouteBody {
    id: string;
    stopCount: number;
    start: { lat: number; lng: number } | null;
    stops: { position: number; client: { id: string; lat: number | null; lng: number | null } }[];
    code?: string;
    details?: unknown;
  }
  const newRoute = async (by: SeedUser, sellerId: string, name: string): Promise<string> => {
    const res = await request<RouteBody>('/routes', {
      method: 'POST', token: by.token, idempotencyKey: idemKey('r'),
      body: { name: `${name} ${run}`, sellerId, weekdays: [0, 1, 2, 3, 4, 5, 6], active: true },
    });
    if (res.status !== 201) throw new Error(`POST /routes HTTP ${res.status} ${res.raw.slice(0, 200)}`);
    return res.body.id;
  };
  const putStops = (by: SeedUser, routeId: string, clientIds: string[]) =>
    request<RouteBody>(`/routes/${routeId}/stops`, { method: 'PUT', token: by.token, body: { clientIds } });
  const s1Clients = truth.filter((r) => r.assignedSellerId === A.seller1.id && r.active);
  const s1Located = s1Clients.filter(located);
  const routeId = await newRoute(A.owner, A.seller1.id, 'Stops');

  await check('clients picked on the map are saved in the picked order, positions 1..n, with their points', async () => {
    const picked = (await get<MapBody>(`/clients/map${qs({ assignedSellerId: A.seller1.id })}`, A.owner)).body.points;
    const order = [picked[40]!, picked[3]!, picked[77]!, picked[12]!, picked[0]!].map((p) => p.id);
    const res = await putStops(A.owner, routeId, order);
    assertEqual(res.status, 200, 'status');
    assertEqual(res.body.stops.map((s) => s.client.id), order, 'order in the response');
    assertEqual(res.body.stops.map((s) => s.position), [1, 2, 3, 4, 5], 'positions');
    const read = await get<RouteBody>(`/routes/${routeId}`, A.owner);
    assertEqual(read.body.stops.map((s) => s.client.id), order, 'order after a fresh read');
    for (const s of read.body.stops) {
      const p = picked.find((x) => x.id === s.client.id)!;
      assertEqual([s.client.lat, s.client.lng], [p.lat, p.lng], 'the stop carries the client\'s point');
    }
  });
  await check('300 stops accepted and kept in order; 301 refused and nothing changed', async () => {
    const three = ids(s1Clients.slice(0, 300));
    const ok = await putStops(A.owner, routeId, three);
    assertEqual([ok.status, ok.body.stops?.length], [200, 300], '300 stops');
    assertEqual(ok.body.stops.map((s) => s.client.id), three, 'order of the 300');
    const over = await putStops(A.owner, routeId, ids(s1Clients.slice(0, 301)));
    assertEqual([over.status, over.body.code], [400, 'VALIDATION_FAILED'], '301 stops');
    const read = await get<RouteBody>(`/routes/${routeId}`, A.owner);
    assertEqual(read.body.stops.map((s) => s.client.id), three, 'still the 300');
  });
  await check('a client twice in the list is refused and nothing changed', async () => {
    const before = (await get<RouteBody>(`/routes/${routeId}`, A.owner)).body.stops.map((s) => s.client.id);
    const res = await putStops(A.owner, routeId, [s1Located[0]!.id, s1Located[1]!.id, s1Located[0]!.id]);
    assertEqual(res.status, 400, 'status');
    assertEqual((await get<RouteBody>(`/routes/${routeId}`, A.owner)).body.stops.map((s) => s.client.id), before, 'stops unchanged');
  });
  const archived = (await query<{ id: string }>(`SELECT id FROM clients WHERE "tenantId" = $1 AND "deletedAt" IS NOT NULL AND "assignedSellerId" = $2 LIMIT 1`, [A.tenantId, A.seller1.id]))[0]!;
  await check('an archived client is refused; an unknown id is refused; a malformed id is refused', async () => {
    for (const [what, id] of [['archived', archived.id], ['unknown', '00000000-0000-4000-8000-000000000000'], ['malformed', 'abc']] as const) {
      const res = await putStops(A.owner, routeId, [s1Located[0]!.id, id]);
      assertEqual(res.status, 400, what);
    }
  });
  {
    const noPoint = s1Clients.find((r) => !located(r))!;
    const res = await putStops(A.owner, routeId, [s1Located[0]!.id, noPoint.id, s1Located[1]!.id]);
    record({
      name: 'a client without a point as a stop',
      status: res.status === 200 ? 'PASS' : 'FAIL',
      expected: 'accepted: the spec keeps "stops without a point … at the end" of "Ordonner par proximité", so they are valid stops',
      actual: `HTTP ${res.status}; the stop comes back with lat ${JSON.stringify(res.body.stops?.[1]?.client.lat)}`,
    });
    const inactive = truth.find((r) => !r.active)!;
    const res2 = await putStops(A.owner, routeId, [inactive.id]);
    record({
      name: 'an inactive client (active = false) as a stop',
      status: 'INFO',
      actual: `HTTP ${res2.status}. The spec only says clients "must be live"; the map hides inactive clients by default but the API takes them.`,
    });
  }
  await check('the supervisor cannot add a client of the seller outside his team; the owner can', async () => {
    const supRoute = await newRoute(A.supervisor, A.seller1.id, 'Sup');
    const outside = truth.find((r) => r.assignedSellerId === A.sellerOut.id && r.active && located(r))!;
    const unassigned = truth.find((r) => r.assignedSellerId === null && r.active && located(r))!;
    const refused = await putStops(A.supervisor, supRoute, [s1Located[0]!.id, outside.id]);
    assertEqual(refused.status, 400, 'supervisor + outside client');
    const refused2 = await putStops(A.supervisor, supRoute, [unassigned.id]);
    assertEqual(refused2.status, 400, 'supervisor + unassigned client');
    assertEqual((await get<RouteBody>(`/routes/${supRoute}`, A.supervisor)).body.stops.length, 0, 'nothing saved');
    const ok = await putStops(A.owner, supRoute, [s1Located[0]!.id, outside.id]);
    assertEqual(ok.status, 200, 'owner + outside client');
  });
  await check('the supervisor cannot read or write a route of the seller outside his team', async () => {
    const outRoute = await newRoute(A.owner, A.sellerOut.id, 'Out');
    assertEqual((await get(`/routes/${outRoute}`, A.supervisor)).status, 404, 'read');
    assertEqual((await putStops(A.supervisor, outRoute, [])).status, 404, 'write');
    const create = await request('/routes', { method: 'POST', token: A.supervisor.token, idempotencyKey: idemKey('r'), body: { name: `x ${run}`, sellerId: A.sellerOut.id, weekdays: [1], active: true } });
    assertEqual(create.status, 403, 'create for the outside seller');
  });
  await check('a SELLER and a LIVREUR cannot call PUT /routes/:id/stops, even on the seller\'s own route', async () => {
    for (const u of [A.seller1, A.livreur]) {
      const res = await putStops(u, routeId, [s1Located[0]!.id]);
      assertEqual(res.status, 403, u.role);
    }
  });
  {
    // What a seller is shown when the owner plans a client that is not his.
    const leakRoute = await newRoute(A.owner, A.seller1.id, 'Hors scope');
    const outside = truth.find((r) => r.assignedSellerId === A.sellerOut.id && r.active && located(r) && Number(r.balance) > 0)!;
    await putStops(A.owner, leakRoute, [s1Located[0]!.id, outside.id]);
    const asSeller = await get<RouteBody>(`/routes/${leakRoute}`, A.seller1);
    const today = await get<{ stops: { client: { id: string; name: string; phone: string | null; lat: number | null }; balance: string }[] }>('/me/today', A.seller1);
    const onMap = await get<MapBody>(`/clients/map${qs({ search: outside.code })}`, A.seller1);
    const page = await get(`/clients/${outside.id}`, A.seller1);
    const inRoute = asSeller.body.stops?.find((s) => s.client.id === outside.id);
    const inToday = today.body.stops?.find((s) => s.client.id === outside.id);
    proof('seller-sees-planned-client-outside-scope.json', JSON.stringify({
      setup: `owner puts ${outside.code} (assigned to the seller outside the team) on a route of seller1; sellerScope = ASSIGNED_ONLY`,
      'GET /clients/map?search=code as seller1': onMap.body.points.length,
      'GET /clients/:id as seller1': page.status,
      'GET /routes/:id as seller1': inRoute ?? null,
      'GET /me/today as seller1': inToday ?? null,
    }, null, 2));
    record({
      name: 'a client outside the seller\'s scope, planned on his route by the owner: what the seller sees',
      status: 'INFO',
      actual: `map ${onMap.body.points.length} point, client page HTTP ${page.status}, but GET /routes/:id ${inRoute ? `shows it with lat ${inRoute.client.lat}` : 'hides it'} and GET /me/today ${inToday ? `shows it with name, phone, point and balance ${inToday.balance}` : 'hides it'}`,
      evidence: 'artifacts/test-35/seller-sees-planned-client-outside-scope.json',
    });
  }
  await check('two planners save the same route at the same time, 25 rounds: the list is one of the two, never a mix; two audit rows each round', async () => {
    const race = await newRoute(A.owner, A.seller1.id, 'Race');
    const listA = ids(s1Clients.slice(0, 150));
    const listB = ids(s1Clients.slice(100, 250)).reverse();
    for (let round = 0; round < 25; round++) {
      const auditBefore = (await query<{ n: number }>(`SELECT count(*)::int AS n FROM audit_logs WHERE action = 'ROUTE_STOPS_SET' AND "entityId" = $1`, [race]))[0]!.n;
      const [ra, rb] = await Promise.all([putStops(A.owner, race, listA), putStops(A.manager, race, listB)]);
      assertEqual([ra.status, rb.status], [200, 200], `round ${round} statuses`);
      const rows = await query<{ clientId: string; position: number }>(`SELECT "clientId", position FROM route_stops WHERE "routeId" = $1 ORDER BY position`, [race]);
      const final = rows.map((r) => r.clientId);
      const isA = JSON.stringify(final) === JSON.stringify(listA);
      const isB = JSON.stringify(final) === JSON.stringify(listB);
      assert(isA || isB, `round ${round}: ${final.length} stops, neither of the two lists`);
      assertEqual(rows.map((r) => r.position), final.map((_, i) => i + 1), `round ${round} positions`);
      const auditAfter = (await query<{ n: number }>(`SELECT count(*)::int AS n FROM audit_logs WHERE action = 'ROUTE_STOPS_SET' AND "entityId" = $1`, [race]))[0]!.n;
      assertEqual(auditAfter - auditBefore, 2, `round ${round} audit rows`);
      const last = (await query<{ after: string[]; before: string[] }>(`SELECT after, before FROM audit_logs WHERE action = 'ROUTE_STOPS_SET' AND "entityId" = $1 ORDER BY "createdAt" DESC, id DESC LIMIT 2`, [race]));
      assert(last.some((l) => JSON.stringify(l.after) === JSON.stringify(final)), `round ${round}: no audit row has the final list as "after"`);
    }
  });
  await check('five planners racing on one route with 300 stops each, 5 rounds: no 500, no deadlock, no lost position', async () => {
    const race = await newRoute(A.owner, A.seller1.id, 'Race5');
    const pool = ids(s1Clients.slice(0, 600));
    for (let round = 0; round < 5; round++) {
      const lists = [0, 1, 2, 3, 4].map((k) => pool.slice(k * 60, k * 60 + 300));
      const users = [A.owner, A.manager, A.supervisor, A.owner, A.manager];
      const res = await Promise.all(lists.map((l, i) => putStops(users[i]!, race, l)));
      assert(res.every((r) => r.status === 200), `round ${round}: statuses ${res.map((r) => r.status).join(',')}`);
      const final = (await query<{ clientId: string }>(`SELECT "clientId" FROM route_stops WHERE "routeId" = $1 ORDER BY position`, [race])).map((r) => r.clientId);
      assert(lists.some((l) => JSON.stringify(l) === JSON.stringify(final)), `round ${round}: the final list is none of the five`);
    }
  });
  await check('"Ajouter à une tournée…" from the map by two planners (each: GET the route, PUT the list plus one client): both clients end on the route', async () => {
    // Exactly what add-to-route-dialog.tsx does, for two planners whose dialogs are open at
    // the same time. No race is needed: B read the route before A saved.
    const shared = await newRoute(A.owner, A.seller1.id, 'Ajout');
    await putStops(A.owner, shared, ids(s1Located.slice(0, 3)));
    const x = s1Located[10]!.id;
    const y = s1Located[11]!.id;
    const readA = (await get<RouteBody>(`/routes/${shared}`, A.owner)).body.stops.map((s) => s.client.id);
    const readB = (await get<RouteBody>(`/routes/${shared}`, A.manager)).body.stops.map((s) => s.client.id);
    // Since the fix of A-7 the dialog says which list it read (baseClientIds); a 409
    // ROUTE_STOPS_CHANGED means "read again", which the dialog does by itself.
    const putFrom = (by: SeedUser, base: string[], add: string) =>
      request<RouteBody & { code?: string }>(`/routes/${shared}/stops`, { method: 'PUT', token: by.token, body: { clientIds: [...base, add], baseClientIds: base } });
    const saveA = await putFrom(A.owner, readA, x);
    const staleB = await putFrom(A.manager, readB, y);
    assertEqual([saveA.status, staleB.status, staleB.body.code], [200, 409, 'ROUTE_STOPS_CHANGED'], 'the first save is accepted, the one built on the stale read is refused');
    const afterRefusal = (await get<RouteBody>(`/routes/${shared}`, A.owner)).body.stops.map((s) => s.client.id);
    assertEqual(afterRefusal, [...readA, x], 'the refused save changed nothing');
    const rereadB = (await get<RouteBody>(`/routes/${shared}`, A.manager)).body.stops.map((s) => s.client.id);
    const saveB = await putFrom(A.manager, rereadB, y);
    assertEqual(saveB.status, 200, 'the retry from a fresh read is accepted');
    const final = (await get<RouteBody>(`/routes/${shared}`, A.owner)).body.stops.map((s) => s.client.id);
    proof('add-to-route-lost-update.json', JSON.stringify({ start: readA, ownerAdds: x, managerAdds: y, staleSave: staleB.status, retry: saveB.status, final, lost: [x, y].filter((id) => !final.includes(id)) }, null, 2));
    assert(final.includes(x) && final.includes(y), `the route has ${final.length} stops: one of the two additions was lost`);
  }, { expected: 'both clients on the route, or the second save refused (stale list)' });
  await check('PUT stops writes no client row and no position anywhere else (only route_stops and audit_logs change)', async () => {
    const snap = async () => (await query<{ h: string }>(`SELECT md5(string_agg(id::text || COALESCE(lat::text,'') || COALESCE(lng::text,'') || version::text || "updatedAt"::text, ',' ORDER BY id)) AS h FROM clients WHERE "tenantId" = $1`, [A.tenantId]))[0]!.h;
    const before = await snap();
    await putStops(A.owner, routeId, ids(s1Located.slice(0, 20)));
    assertEqual(await snap(), before, 'clients table hash');
  });

  // ------------------------------------------------------------------ RouteDto.start
  area('A9 RouteDto.start — the dépôt of the route\'s seller (sellerDepotPoint)');
  const ORAN = { lat: 35.7, lng: -0.62 };
  const MAIN = { lat: 36.7701, lng: 3.0552 };
  const setMainPoint = async (p: { lat: number; lng: number } | null): Promise<void> => {
    const res = await request(`/warehouses/${A.depots.main}`, { method: 'PATCH', token: A.owner.token, body: { location: p ? { ...p, radiusM: null } : null } });
    if (res.status >= 300) throw new Error(`PATCH main dépôt: HTTP ${res.status} ${res.raw.slice(0, 200)}`);
  };
  const access = async (userId: string, list: { warehouseId: string; level: 'OPERATE' | 'VIEW_STATS' }[]): Promise<void> => {
    const res = await request(`/users/${userId}/access`, { method: 'PUT', token: A.owner.token, body: { access: list } });
    if (res.status >= 300) throw new Error(`PUT access: HTTP ${res.status} ${res.raw.slice(0, 200)}`);
  };
  const startOf = async (rid: string): Promise<{ lat: number; lng: number } | null> => (await get<RouteBody>(`/routes/${rid}`, A.owner)).body.start;
  const mk = async (label: string): Promise<{ seller: SeedUser; route: string }> => {
    const seller = await inviteUser(A.owner.token, 'SELLER', `start-${label}-${run}`);
    return { seller, route: await newRoute(A.owner, seller.id, `Start ${label}`) };
  };
  const one = await mk('one');
  const two = await mk('two');
  const truck = await mk('truck');
  const none = await mk('none');
  const noPt = await mk('nopoint');
  const stats = await mk('stats');
  await access(one.seller.id, [{ warehouseId: A.depots.oran, level: 'OPERATE' }]);
  await access(two.seller.id, [{ warehouseId: A.depots.oran, level: 'OPERATE' }, { warehouseId: A.depots.setif, level: 'OPERATE' }]);
  await access(noPt.seller.id, [{ warehouseId: A.depots.setif, level: 'OPERATE' }]);
  await access(stats.seller.id, [{ warehouseId: A.depots.oran, level: 'VIEW_STATS' }]);
  const vehicle = await request<{ id: string }>('/warehouses', { method: 'POST', token: A.owner.token, idempotencyKey: idemKey('wh'), body: { name: `Camion ${run}`, type: 'VEHICLE', assignedUserId: truck.seller.id } });

  await setMainPoint(null);
  await check('dépôt principal without a point: one OPERATE dépôt with a point → that point; every other case → null', async () => {
    assertEqual(vehicle.status, 201, 'the truck was created');
    assertEqual(await startOf(one.route), ORAN, 'one OPERATE dépôt with a point');
    assertEqual(await startOf(two.route), null, 'two OPERATE dépôts');
    assertEqual(await startOf(truck.route), null, 'only a truck');
    assertEqual(await startOf(none.route), null, 'no access');
    assertEqual(await startOf(noPt.route), null, 'one OPERATE dépôt without a point');
    assertEqual(await startOf(stats.route), null, 'only VIEW_STATS on a dépôt with a point');
  });
  await setMainPoint(MAIN);
  await check('dépôt principal with a point: two dépôts, a truck only, no access, VIEW_STATS only → the dépôt principal', async () => {
    assertEqual(await startOf(one.route), ORAN, 'one OPERATE dépôt with a point keeps its own');
    assertEqual(await startOf(two.route), MAIN, 'two OPERATE dépôts');
    assertEqual(await startOf(truck.route), MAIN, 'only a truck');
    assertEqual(await startOf(none.route), MAIN, 'no access');
    assertEqual(await startOf(stats.route), MAIN, 'only VIEW_STATS');
  });
  await check('one OPERATE dépôt WITHOUT a point and a dépôt principal with one → the dépôt principal', async () => {
    assertEqual(await startOf(noPt.route), MAIN, 'start');
  }, {
    expected: 'scope.service.ts:146 doc: "the one dépôt he operates in when it has a point, else the dépôt principal when it has one, else null"',
  });
  await check('a deleted dépôt is never the start; another tenant\'s dépôt principal is never the start', async () => {
    // Tenant B's dépôt principal gets a point; A's loses its own: A must answer null, not B's point.
    const bMain = (await query<{ id: string }>(`SELECT id FROM warehouses WHERE "tenantId" = $1 AND "isDefault"`, [f.b.tenantId]))[0]!.id;
    await request(`/warehouses/${bMain}`, { method: 'PATCH', token: f.b.owner.token, body: { location: { lat: 12.3456, lng: 65.4321, radiusM: null } } });
    await setMainPoint(null);
    for (const r of [two.route, truck.route, none.route, stats.route, noPt.route]) assertEqual(await startOf(r), null, 'with no point in tenant A');
    // The Oran dépôt archived: its seller falls back, never the archived point.
    const del = await request(`/warehouses/${A.depots.oran}`, { method: 'DELETE', token: A.owner.token });
    if (del.status >= 300) {
      // The API keeps a dépôt that still has a team: archive it as the owner would see it archived.
      await query(`UPDATE warehouses SET "deletedAt" = now() WHERE id = $1`, [A.depots.oran]);
    }
    try {
      assertEqual(await startOf(one.route), null, `the seller of the archived dépôt (DELETE answered ${del.status})`);
    } finally {
      await query(`UPDATE warehouses SET "deletedAt" = NULL WHERE id = $1`, [A.depots.oran]);
    }
  });
  await check('a seller reads `start` of his own route; GET /routes (the list) carries no start and no stops', async () => {
    await setMainPoint(MAIN);
    const mine = await get<RouteBody>(`/routes/${routeId}`, A.seller1);
    assertEqual([mine.status, mine.body.start], [200, MAIN], 'seller1 reads his route');
    const list = await get<RouteBody[]>('/routes', A.owner);
    assert(list.body.every((r) => r.start === null || r.start === undefined), 'the list carries a start');
  });
  await setMainPoint(null);

  writeSummary('test-35/api-map');
  await closeDb();
  if (summary().failed > 0) process.exitCode = 1;
}

main().catch(async (err) => {
  console.error(err);
  writeSummary('test-35/api-map');
  await closeDb();
  process.exitCode = 1;
});
