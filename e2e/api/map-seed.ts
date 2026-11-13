/**
 * Test data of the phase 35 audit (test-35). Not the app seed.
 *
 * Structure (tenants, users, sectors, dépôts, features, routes) goes through the real API;
 * the clients are written in bulk as the database owner, with a fixed PRNG seed so two runs
 * draw the same points. Every run makes new tenants (a tag in their name) and overwrites
 * `.auth/map-fixture.json`.
 *
 *   API=http://localhost:3003 DB=postgresql://erp:erp@localhost:5432/erp_t35 pnpm test:map:seed
 *
 * Tenants:
 *   A  Distribution, sellerScope ASSIGNED_ONLY: owner, manager, supervisor with two sellers,
 *      a seller outside the team, a livreur; 5 000 clients around Alger, Oran and Sétif.
 *   B  Distribution: 300 clients at the very coordinates of A's.
 *   C  Essentiel (no GEO_CHECK).
 *   D  Distribution with GEO_CHECK revoked, TOURNEES kept, one route with located stops.
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { API, DB } from '../lib/config.ts';
import { closeDb, db, query } from '../lib/db.ts';
import { call, idemKey, register, type Session } from '../lib/http.ts';
import {
  assertAuditDb,
  inviteUser,
  type MapFixture,
  PASSWORD,
  prng,
  saveFixture,
  type SeedUser,
} from '../lib/map-fixture.ts';
import { totp } from '../lib/totp.ts';

assertAuditDb();

const tag = Date.now().toString(36);
const CITIES = [
  { key: 'alger', wilaya: 'Alger', commune: 'Alger Centre', lat: 36.7538, lng: 3.0588 },
  { key: 'oran', wilaya: 'Oran', commune: 'Oran', lat: 35.6971, lng: -0.6308 },
  { key: 'setif', wilaya: 'Sétif', commune: 'Sétif', lat: 36.1898, lng: 5.4108 },
] as const;
const NAMES = [
  'Alimentation', 'Superette', 'Épicerie', 'Grossiste', 'Mini market', 'Kiosque', 'Boulangerie',
  'Café', 'Restaurant', 'Dépôt', 'Bazar', 'Pâtisserie', 'Fast food', 'Librairie', 'Tabac',
  'Crèmerie', 'Zlabia', 'Hanout',
];
/** The first clients carry names that hurt a careless search or a careless renderer. */
const HOSTILE = [
  '100% Frais',
  'A_B Market',
  'Back\\slash Store',
  "O'Brien & fils",
  'مخبزة النور',
  '<b>Bold</b> <img src=x onerror=alert(1)>',
  '  Espaces devant',
  'ÉPICERIE Éléonore',
  'Nom très long '.repeat(9).trim(),
  '"Guillemets" SARL',
  '%',
  '_',
];

function createAdmin(): { email: string; password: string; secret: string } {
  const email = `t35-admin-${tag}@platform.dz`;
  const out = execFileSync('pnpm', ['--filter', '@erp/api', 'admin:create', '--email', email], {
    cwd: fileURLToPath(new URL('../../', import.meta.url)),
    encoding: 'utf8',
    // The CLI reads apps/api/.env (the dev database): point it at the audit database.
    env: { ...process.env, DATABASE_URL_MIGRATE: DB, DATABASE_URL: DB },
  });
  const password = /Password \(shown once\):\s+(\S+)/.exec(out)?.[1];
  const secret = /TOTP secret:\s+(\S+)/.exec(out)?.[1];
  if (!password || !secret) throw new Error(`admin:create gave no credentials:\n${out}`);
  return { email, password, secret };
}

async function adminToken(admin: { email: string; password: string; secret: string }): Promise<string> {
  const res = await call<{ accessToken: string }>('/admin/auth/login', {
    method: 'POST',
    body: { email: admin.email, password: admin.password, code: totp(admin.secret) },
  });
  return res.body.accessToken;
}

const invite = (owner: Session, role: string, label: string, managerId: string | null = null) =>
  inviteUser(owner.token, role, `${label}-${tag}`, managerId);

const asUser = (s: Session, role = 'OWNER'): SeedUser => ({
  id: s.userId,
  email: s.email,
  role,
  token: s.token,
});

async function makeTenant(
  label: string,
  activity: 'GROSSISTE' | 'DISTRIBUTEUR',
  adminTok: string,
): Promise<Session> {
  const s = await register(`T35 ${label} ${tag}`, `Owner ${label}`, `t35-owner-${label}-${tag}@audit.local`, PASSWORD, activity);
  // The trial plan allows 5 users; tenant A needs 7. `isFree` lifts the plan limits and
  // leaves the edition (the features) as it is.
  await call(`/admin/tenants/${s.tenantId}/subscription`, { method: 'PATCH', token: adminTok, body: { isFree: true } });
  return s;
}

async function sector(token: string, name: string, wilaya: string): Promise<string> {
  const res = await call<{ id: string }>('/sectors', {
    method: 'POST',
    token,
    idempotencyKey: idemKey('sec'),
    body: { name, wilaya, communes: [] },
  });
  return res.body.id;
}

async function mainDepot(token: string): Promise<string> {
  const list = (await call<{ id: string; isDefault: boolean }[]>('/warehouses', { token })).body;
  const main = list.find((w) => w.isDefault);
  if (!main) throw new Error('no default dépôt');
  return main.id;
}

async function depot(
  token: string,
  name: string,
  point: { lat: number; lng: number } | null,
): Promise<string> {
  const res = await call<{ id: string }>('/warehouses', {
    method: 'POST',
    token,
    idempotencyKey: idemKey('wh'),
    body: { name, type: 'SECONDARY' },
  });
  if (point) {
    await call(`/warehouses/${res.body.id}`, {
      method: 'PATCH',
      token,
      body: { location: { lat: point.lat, lng: point.lng, radiusM: null } },
    });
  }
  return res.body.id;
}

interface Row {
  code: string;
  name: string;
  phone: string | null;
  phone2: string | null;
  wilaya: string;
  commune: string;
  lat: number | null;
  lng: number | null;
  active: boolean;
  archived: boolean;
  sectorId: string | null;
  sellerId: string | null;
  creditLimit: string | null;
  balance: string | null;
}

async function insertClients(tenantId: string, ownerId: string, warehouseId: string | null, rows: Row[]): Promise<string[]> {
  const client = await db().connect();
  try {
    await client.query('BEGIN');
    const col = <K extends keyof Row>(k: K): Row[K][] => rows.map((r) => r[k]);
    const res = await client.query<{ id: string; code: string }>(
      `INSERT INTO clients (id, "tenantId", code, name, phone, phone2, wilaya, commune, lat, lng,
         "geoAccuracyM", "geoSetAt", "geoSetBy", active, "deletedAt", "sectorId", "assignedSellerId",
         "creditLimit", "updatedAt")
       SELECT gen_random_uuid(), $1::uuid, t.code, t.name, t.phone, t.phone2, t.wilaya, t.commune,
         t.lat, t.lng,
         CASE WHEN t.lat IS NULL THEN NULL ELSE 12 END,
         CASE WHEN t.lat IS NULL THEN NULL ELSE now() END,
         CASE WHEN t.lat IS NULL THEN NULL ELSE $2::uuid END,
         t.active, CASE WHEN t.archived THEN now() ELSE NULL END,
         t.sector, t.seller, t.credit, now()
       FROM unnest($3::text[], $4::text[], $5::text[], $6::text[], $7::text[], $8::text[],
         $9::numeric[], $10::numeric[], $11::bool[], $12::bool[], $13::uuid[], $14::uuid[],
         $15::numeric[])
         AS t(code, name, phone, phone2, wilaya, commune, lat, lng, active, archived, sector, seller, credit)
       RETURNING id, code`,
      [
        tenantId, ownerId, col('code'), col('name'), col('phone'), col('phone2'), col('wilaya'),
        col('commune'), col('lat'), col('lng'), col('active'), col('archived'), col('sectorId'),
        col('sellerId'), col('creditLimit'),
      ],
    );
    const idByCode = new Map(res.rows.map((r) => [r.code, r.id]));
    const owing = rows.filter((r) => r.balance !== null);
    if (owing.length > 0) {
      const ids = owing.map((r) => idByCode.get(r.code)!);
      const amounts = owing.map((r) => r.balance);
      // The ledger is the truth, the balance its cache: both, in one transaction (AGENTS.md §3.1).
      await client.query(
        `INSERT INTO client_ledger_entries (id, "tenantId", "clientId", type, amount, label, "createdBy", "warehouseId")
         SELECT gen_random_uuid(), $1::uuid, t.id, 'OPENING', t.amount, 'Solde initial (test 35)', $2::uuid, $3::uuid
         FROM unnest($4::uuid[], $5::numeric[]) AS t(id, amount)`,
        [tenantId, ownerId, warehouseId, ids, amounts],
      );
      await client.query(
        `INSERT INTO client_balances (id, "tenantId", "clientId", balance, "hasOpening", "updatedAt")
         SELECT gen_random_uuid(), $1::uuid, t.id, t.amount, true, now()
         FROM unnest($2::uuid[], $3::numeric[]) AS t(id, amount)`,
        [tenantId, ids, amounts],
      );
    }
    await client.query('COMMIT');
    return rows.map((r) => idByCode.get(r.code)!);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

const round6 = (n: number): number => Math.round(n * 1e6) / 1e6;

function rowsOfA(
  sectors: { alger: string; oran: string; setif: string },
  sellers: { s1: string; s2: string; out: string; sup: string },
): Row[] {
  const rnd = prng(35);
  const sellerCycle = [sellers.s1, sellers.s1, sellers.s2, sellers.s2, sellers.out, sellers.sup, null, null];
  const rows: Row[] = [];
  for (let i = 0; i < 5000; i++) {
    const city = CITIES[i % 3]!;
    // Always drawn, so the stream does not depend on the flags below.
    const dLat = (rnd() - 0.5) * 0.3;
    const dLng = (rnd() - 0.5) * 0.36;
    const tie = i >= 15 && i <= 19;
    const noPoint = i % 10 === 9;
    const sectorOfCity = sectors[city.key];
    const otherSector = sectors[CITIES[(i + 1) % 3]!.key];
    const name =
      i < HOSTILE.length
        ? HOSTILE[i]!
        : i >= 12 && i <= 14
          ? 'Doublon'
          : tie
            ? `Même point ${i}`
            : `${NAMES[(i * 7) % NAMES.length]} ${city.commune} ${String(i).padStart(4, '0')}`;
    rows.push({
      code: `T35-${String(i).padStart(5, '0')}`,
      name,
      phone: i % 17 === 5 ? null : `05${50 + (i % 30)}${String(100000 + i).slice(-6)}`,
      phone2: i % 11 === 0 ? `0770${String(100000 + i).slice(-6)}` : null,
      wilaya: city.wilaya,
      commune: city.commune,
      lat: noPoint ? null : tie ? CITIES[0].lat : round6(city.lat + dLat),
      lng: noPoint ? null : tie ? CITIES[0].lng : round6(city.lng + dLng),
      active: i % 20 !== 3,
      archived: i % 25 === 7,
      sectorId: i % 4 === 3 ? null : i % 13 === 0 ? otherSector : sectorOfCity,
      sellerId: sellerCycle[i % 8]!,
      creditLimit: i % 70 === 3 ? '0.00' : i % 7 === 2 ? '5000.00' : null,
      balance: i % 50 === 10 ? '-2000.00' : i % 5 === 1 ? `${((i % 9) + 1) * 1500}.00` : null,
    });
  }
  return rows;
}

function plainRows(prefix: string, n: number, points: { lat: number; lng: number }[], sellerId: string | null, sectorId: string | null): Row[] {
  return Array.from({ length: n }, (_, i) => ({
    code: `${prefix}-${String(i).padStart(5, '0')}`,
    name: `${prefix} client ${String(i).padStart(4, '0')}`,
    phone: `0661${String(100000 + i).slice(-6)}`,
    phone2: null,
    wilaya: 'Alger',
    commune: 'Alger Centre',
    lat: points[i % points.length]!.lat,
    lng: points[i % points.length]!.lng,
    active: true,
    archived: false,
    sectorId: i % 2 === 0 ? sectorId : null,
    sellerId: i % 2 === 0 ? sellerId : null,
    creditLimit: null,
    balance: i % 3 === 0 ? '9999.00' : null,
  }));
}

async function main(): Promise<void> {
  console.log(`map seed ${tag} → ${API}, ${new URL(DB).pathname}`);
  const admin = createAdmin();
  const adminTok = await adminToken(admin);

  // ---- tenant A
  const aOwner = await makeTenant('A', 'DISTRIBUTEUR', adminTok);
  // livreurScope: the owner of A chose "seulement ses livraisons" (the setting added for A-1).
  await call('/tenant/settings', { method: 'PATCH', token: aOwner.token, body: { sellerScope: 'ASSIGNED_ONLY', livreurScope: 'OWN_DELIVERIES' } });
  const manager = await invite(aOwner, 'MANAGER', 'manager');
  const supervisor = await invite(aOwner, 'SUPERVISOR', 'supervisor');
  const seller1 = await invite(aOwner, 'SELLER', 'seller1', supervisor.id);
  const seller2 = await invite(aOwner, 'SELLER', 'seller2', supervisor.id);
  const sellerOut = await invite(aOwner, 'SELLER', 'sellerout');
  const livreur = await invite(aOwner, 'LIVREUR', 'livreur');
  const sectors = {
    alger: await sector(aOwner.token, 'Secteur Alger', 'Alger'),
    oran: await sector(aOwner.token, 'Secteur Oran', 'Oran'),
    setif: await sector(aOwner.token, 'Secteur Sétif', 'Sétif'),
  };
  const depots = {
    main: await mainDepot(aOwner.token),
    oran: await depot(aOwner.token, 'Dépôt Oran', { lat: 35.70, lng: -0.62 }),
    setif: await depot(aOwner.token, 'Dépôt Sétif (sans point)', null),
  };
  const aRows = rowsOfA(sectors, { s1: seller1.id, s2: seller2.id, out: sellerOut.id, sup: supervisor.id });
  await insertClients(aOwner.tenantId, aOwner.userId, depots.main, aRows);

  // ---- tenant B: the same coordinates
  const bOwner = await makeTenant('B', 'DISTRIBUTEUR', adminTok);
  await call('/tenant/settings', { method: 'PATCH', token: bOwner.token, body: { sellerScope: 'ASSIGNED_ONLY' } });
  const bSeller = await invite(bOwner, 'SELLER', 'b-seller');
  const bSector = await sector(bOwner.token, 'Secteur B', 'Alger');
  const aPoints = aRows
    .filter((r) => r.lat !== null && !r.archived && r.active)
    .slice(0, 300)
    .map((r) => ({ lat: r.lat!, lng: r.lng! }));
  const bClientIds = await insertClients(
    bOwner.tenantId, bOwner.userId, await mainDepot(bOwner.token),
    plainRows('B35', 300, aPoints, bSeller.id, bSector),
  );

  // ---- tenant C: Essentiel
  const cOwner = await makeTenant('C', 'GROSSISTE', adminTok);
  await insertClients(cOwner.tenantId, cOwner.userId, null, plainRows('C35', 5, aPoints, null, null));

  // ---- tenant D: Distribution, GEO_CHECK revoked, TOURNEES kept
  const dOwner = await makeTenant('D', 'DISTRIBUTEUR', adminTok);
  const dSeller = await invite(dOwner, 'SELLER', 'd-seller');
  const dMain = await mainDepot(dOwner.token);
  await call(`/warehouses/${dMain}`, {
    method: 'PATCH',
    token: dOwner.token,
    body: { location: { lat: 36.7701, lng: 3.0552, radiusM: null } },
  });
  const dClientIds = await insertClients(dOwner.tenantId, dOwner.userId, dMain, plainRows('D35', 5, aPoints, dSeller.id, null));
  const route = await call<{ id: string }>('/routes', {
    method: 'POST',
    token: dOwner.token,
    idempotencyKey: idemKey('route'),
    body: { name: 'Tournée D', sellerId: dSeller.id, weekdays: [0, 1, 2, 3, 4, 5, 6], active: true },
  });
  await call(`/routes/${route.body.id}/stops`, { method: 'PUT', token: dOwner.token, body: { clientIds: dClientIds } });
  await call(`/admin/tenants/${dOwner.tenantId}/subscription`, {
    method: 'PATCH',
    token: adminTok,
    body: { featureRevokes: ['GEO_CHECK'] },
  });

  const fixture: MapFixture = {
    tag,
    createdAt: new Date().toISOString(),
    admin,
    a: {
      tenantId: aOwner.tenantId, name: `T35 A ${tag}`, owner: asUser(aOwner),
      manager, supervisor, seller1, seller2, sellerOut, livreur, sectors, depots, clients: aRows.length,
    },
    b: { tenantId: bOwner.tenantId, name: `T35 B ${tag}`, owner: asUser(bOwner), seller: bSeller, sectorId: bSector, clientIds: bClientIds },
    c: { tenantId: cOwner.tenantId, name: `T35 C ${tag}`, owner: asUser(cOwner) },
    d: { tenantId: dOwner.tenantId, name: `T35 D ${tag}`, owner: asUser(dOwner), seller: dSeller, routeId: route.body.id, clientIds: dClientIds },
  };
  saveFixture(fixture);

  const counts = await query(
    `SELECT count(*)::int AS total,
       count(*) FILTER (WHERE "deletedAt" IS NULL)::int AS live,
       count(*) FILTER (WHERE "deletedAt" IS NULL AND lat IS NOT NULL)::int AS "liveWithPoint",
       count(*) FILTER (WHERE "deletedAt" IS NULL AND lat IS NOT NULL AND active)::int AS "onMapByDefault",
       count(*) FILTER (WHERE "deletedAt" IS NULL AND lat IS NULL)::int AS "liveWithoutPoint",
       count(*) FILTER (WHERE NOT active)::int AS inactive,
       count(*) FILTER (WHERE "deletedAt" IS NOT NULL)::int AS archived
     FROM clients WHERE "tenantId" = $1`,
    [aOwner.tenantId],
  );
  console.log('tenant A clients:', counts[0]);
  console.log('fixture written: e2e/.auth/map-fixture.json');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
