/**
 * Data of the phase 35 browser checks (part D), made once per Playwright project inside
 * tenant A: a seller with a handful of clients in the middle of Alger (few enough for the
 * map to draw them as SVG elements a test can tap), one of them with a balance that shows
 * the money format, one route for today and one almost full route.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { query } from '../lib/db.ts';
import { call, idemKey } from '../lib/http.ts';
import { assertAuditDb, inviteUser, type SeedUser } from '../lib/map-fixture.ts';
import { fixture } from './map-helpers.ts';

export const HERE = { latitude: 36.76, longitude: 3.05 };

export interface UiClient {
  id: string;
  code: string;
  name: string;
  phone: string | null;
  lat: number | null;
  lng: number | null;
  balance: string;
}
export interface UiData {
  seller: SeedUser;
  /** Live, active, located, nearest first. */
  clients: UiClient[];
  noPoint: UiClient;
  /** Runs today: stops clients[2], [3], [4] and the client without a point; [2] visited. */
  todayRoute: { id: string; name: string };
  /** 296 stops: four places left. */
  fullRoute: { id: string; name: string };
}

export async function prepare(project: string): Promise<UiData> {
  const file = fileURLToPath(new URL(`../.auth/map-ui-${project}-${fixture.tag}.json`, import.meta.url));
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8')) as UiData;
  assertAuditDb();
  const A = fixture.a;
  const owner = A.owner.token;
  const tag = `${project}-${Date.now().toString(36)}`;
  const seller = await inviteUser(owner, 'SELLER', `ui-${tag}`);

  // Offsets in metres (north, east) from HERE; the first is the one with the big balance.
  const spots: [number, number, string, string | null][] = [
    [120, 60, '1234567.89', '5000.00'],
    [-200, 150, '2500.00', null],
    [300, -250, '0', null],
    [-420, -380, '0', null],
    [560, 420, '0', null],
    [-650, 600, '0', null],
    [800, -700, '0', null],
    [-900, -850, '0', null],
  ];
  const rows = spots.map(([n, e, balance, limit], i) => ({
    code: `UI-${tag}-${i}`,
    name: i === 0 ? `Épicerie du Port ${tag}` : `Client carte ${i} ${tag}`,
    phone: i === 3 ? null : `0555${String(100000 + i)}`,
    lat: Math.round((HERE.latitude + n / 111_195) * 1e6) / 1e6,
    lng: Math.round((HERE.longitude + e / (111_195 * Math.cos((HERE.latitude * Math.PI) / 180))) * 1e6) / 1e6,
    balance,
    limit,
  }));
  const all = [
    ...rows.map((r) => ({ ...r, active: true })),
    { code: `UI-${tag}-nopoint`, name: `Sans position ${tag}`, phone: '0555999999', lat: null, lng: null, balance: '0', limit: null, active: true },
    { code: `UI-${tag}-inactive`, name: `Inactif ${tag}`, phone: null, lat: HERE.latitude + 0.002, lng: HERE.longitude + 0.002, balance: '0', limit: null, active: false },
  ];
  const inserted = await query<{ id: string; code: string }>(
    `INSERT INTO clients (id, "tenantId", code, name, phone, wilaya, commune, lat, lng, active, "assignedSellerId", "creditLimit", "updatedAt")
     SELECT gen_random_uuid(), $1::uuid, t.code, t.name, t.phone, 'Alger', 'Alger Centre', t.lat, t.lng, t.active, $2::uuid, t.lim, now()
     FROM unnest($3::text[], $4::text[], $5::text[], $6::numeric[], $7::numeric[], $8::bool[], $9::numeric[]) AS t(code, name, phone, lat, lng, active, lim)
     RETURNING id, code`,
    [A.tenantId, seller.id, all.map((r) => r.code), all.map((r) => r.name), all.map((r) => r.phone), all.map((r) => r.lat), all.map((r) => r.lng), all.map((r) => r.active), all.map((r) => r.limit)],
  );
  const idOf = (code: string): string => inserted.find((r) => r.code === code)!.id;
  for (const r of rows.filter((x) => Number(x.balance) > 0)) {
    await query(
      `INSERT INTO client_ledger_entries (id, "tenantId", "clientId", type, amount, label, "createdBy", "warehouseId") VALUES (gen_random_uuid(), $1, $2, 'OPENING', $3, 'Solde initial (test 35)', $4, $5)`,
      [A.tenantId, idOf(r.code), r.balance, A.owner.id, A.depots.main],
    );
    await query(
      `INSERT INTO client_balances (id, "tenantId", "clientId", balance, "hasOpening", "updatedAt") VALUES (gen_random_uuid(), $1, $2, $3, true, now())`,
      [A.tenantId, idOf(r.code), r.balance],
    );
  }
  const clients: UiClient[] = rows.map((r) => ({ id: idOf(r.code), code: r.code, name: r.name, phone: r.phone, lat: r.lat, lng: r.lng, balance: r.balance }));
  const noPoint: UiClient = { id: idOf(`UI-${tag}-nopoint`), code: `UI-${tag}-nopoint`, name: `Sans position ${tag}`, phone: '0555999999', lat: null, lng: null, balance: '0' };

  const route = async (name: string, weekdays: number[], clientIds: string[]): Promise<{ id: string; name: string }> => {
    const r = await call<{ id: string }>('/routes', { method: 'POST', token: owner, idempotencyKey: idemKey('r'), body: { name, sellerId: seller.id, weekdays, active: true } });
    await call(`/routes/${r.body.id}/stops`, { method: 'PUT', token: owner, body: { clientIds } });
    return { id: r.body.id, name };
  };
  const today = (await call<{ weekday: number }>('/me/today', { token: seller.token })).body.weekday;
  const todayRoute = await route(`Tournée du jour ${tag}`, [today], [clients[2]!.id, clients[3]!.id, noPoint.id, clients[4]!.id]);
  const filler = await query<{ id: string }>(
    `SELECT id FROM clients WHERE "tenantId" = $1 AND "deletedAt" IS NULL AND active AND "assignedSellerId" = $2 AND lat IS NOT NULL ORDER BY code LIMIT 296`,
    [A.tenantId, A.seller1.id],
  );
  const fullRoute = await route(`Tournée pleine ${tag}`, [(today + 3) % 7], filler.map((r) => r.id));
  // One stop already visited today: its marker must carry a check mark.
  await call('/visits', {
    method: 'POST',
    token: seller.token,
    idempotencyKey: idemKey('visit'),
    body: { clientId: clients[2]!.id, routeId: todayRoute.id, startedAt: new Date().toISOString(), outcome: 'NO_SALE', reason: 'CLOSED', geo: { lat: clients[2]!.lat, lng: clients[2]!.lng, accuracyM: 10, capturedAt: new Date().toISOString() } },
  });
  const data: UiData = { seller, clients, noPoint, todayRoute, fullRoute };
  writeFileSync(file, JSON.stringify(data, null, 2));
  return data;
}
