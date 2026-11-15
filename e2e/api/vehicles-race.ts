/**
 * Test 36, part C: concurrency of phase 36 (distribution par véhicule).
 *
 *   API=http://localhost:3003 DB=postgresql://erp:erp@localhost:5432/erp_t36 pnpm test:vehicles:race
 *
 * Real API, real PostgreSQL, a local scratch database, the API connected as `erp_app`. Each
 * area makes its own company (DISTRIBUTION, users invited through `POST /users/invite`) and
 * fires the racing requests with `Promise.all`, 20 rounds each (`T36_ROUNDS=` to change it).
 * Every round is judged with SQL on the database, never with the answers alone.
 * `T36_ONLY=same,cross,sale,convert` runs some areas only.
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DB } from '../lib/config.ts';
import { closeDb, query } from '../lib/db.ts';
import { area, assert, check, record, writeSummary } from '../lib/harness.ts';
import {
  algiersToday,
  Api,
  client,
  company,
  type Company,
  dbRead,
  invite,
  type Item,
  openingStock,
  product,
  type Staff,
} from '../lib/audit.ts';
import { type ApiResponse } from '../lib/http.ts';
import { assertT36Db, proof36 } from '../lib/vehicles-fixture.ts';

assertT36Db();
const only = (process.env['T36_ONLY'] ?? '').split(',').filter(Boolean);
const on = (name: string): boolean => only.length === 0 || only.includes(name);
const ROUNDS = Number(process.env['T36_ROUNDS'] ?? 20);
const WEEK = [0, 1, 2, 3, 4, 5, 6];
const today = algiersToday();
const log: string[] = [];

// ---------------------------------------------------------------- helpers

type Res = ApiResponse<Record<string, unknown>>;
const codeOf = (r: ApiResponse<unknown>): string | undefined =>
  (r.body as { code?: string } | null)?.code;
const brief = (r: ApiResponse<unknown>): string => `HTTP ${r.status} ${r.raw.slice(0, 200)}`;
const ok2 = (r: ApiResponse<unknown>): boolean => r.status >= 200 && r.status < 300;
const post = (
  api: Api,
  path: string,
  body: unknown = {},
  key: string | null = null,
): Promise<Res> => api.send<Record<string, unknown>>('POST', path, body, key);
const patch = (api: Api, path: string, body: unknown): Promise<Res> =>
  api.send<Record<string, unknown>>('PATCH', path, body, null);
const driver = (api: Api, vehicleId: string, userId: string | null): Promise<Res> =>
  post(api, `/warehouses/${vehicleId}/driver`, { userId });
const co = (label: string): Promise<Company> =>
  company(`T36C ${label}`, { edition: 'DISTRIBUTION' });
async function truck(c: Company, code: string, assignedUserId?: string): Promise<string> {
  return (
    await c.owner.post<{ id: string }>(
      '/warehouses',
      {
        name: `Camion ${code}`,
        type: 'VEHICLE',
        code,
        ...(assignedUserId ? { assignedUserId } : {}),
      },
      null,
    )
  ).id;
}
const driversOf = async (ids: string[]): Promise<Record<string, string | null>> => {
  const rows = await query<{ id: string; u: string | null }>(
    `SELECT id::text, "assignedUserId"::text AS u FROM warehouses WHERE id = ANY($1::uuid[])`,
    [ids],
  );
  return Object.fromEntries(rows.map((r) => [r.id, r.u]));
};
const rowsOf = async (vehicleId: string): Promise<number> =>
  Number(
    (
      await query<{ n: string }>(
        `SELECT count(*) AS n FROM vehicle_assignments WHERE "vehicleId" = $1::uuid`,
        [vehicleId],
      )
    )[0]!.n,
  );
const statusSet = (rs: ApiResponse<unknown>[]): string =>
  rs.map((r) => `${r.status}${codeOf(r) ? ` ${codeOf(r)}` : ''}`).join(' / ');

/**
 * The three rules of a company's trucks, read with SQL: each truck's last history row names
 * its driver, no user drives two live trucks, and no truck has two rows in a row naming the
 * same person (a lost or doubled row).
 */
async function truckRules(tenantId: string): Promise<string[]> {
  const bad: string[] = [];
  const last = await query<{ code: string; driver: string | null; last: string | null }>(
    `SELECT w.code, w."assignedUserId"::text AS driver,
            (SELECT a."userId"::text FROM vehicle_assignments a WHERE a."vehicleId" = w.id
             ORDER BY a."fromAt" DESC, a."createdAt" DESC, a.id DESC LIMIT 1) AS last
     FROM warehouses w WHERE w."tenantId" = $1::uuid AND w.type = 'VEHICLE' AND w."deletedAt" IS NULL`,
    [tenantId],
  );
  for (const r of last) {
    if ((r.driver ?? null) !== (r.last ?? null)) {
      bad.push(`last row of ${r.code} names ${r.last}, assignedUserId ${r.driver}`);
    }
  }
  const two = await query<{ u: string; n: string }>(
    `SELECT "assignedUserId"::text AS u, count(*) AS n FROM warehouses
     WHERE "tenantId" = $1::uuid AND type = 'VEHICLE' AND "deletedAt" IS NULL AND "assignedUserId" IS NOT NULL
     GROUP BY 1 HAVING count(*) > 1`,
    [tenantId],
  );
  for (const r of two) bad.push(`user ${r.u} drives ${r.n} trucks`);
  const dup = await query<{ code: string; u: string | null }>(
    `SELECT w.code, x.u FROM (
       SELECT a."vehicleId", a."userId"::text AS u,
              lag(a."userId"::text, 1, 'start') OVER (PARTITION BY a."vehicleId"
                ORDER BY a."fromAt", a."createdAt", a.id) AS prev
       FROM vehicle_assignments a WHERE a."tenantId" = $1::uuid) x
     JOIN warehouses w ON w.id = x."vehicleId"
     WHERE x.prev IS NOT DISTINCT FROM x.u`,
    [tenantId],
  );
  for (const r of dup) bad.push(`${r.code}: two rows in a row naming ${r.u}`);
  return bad;
}

/** Deadlocks and serialization failures PostgreSQL logged since `since` (docker logs). */
function pgDeadlocks(since: Date): string[] {
  try {
    const out = execFileSync('docker', ['logs', '--since', since.toISOString(), 'erp-saas-db-1'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return out.split('\n').filter((l) => /deadlock detected|could not serialize/i.test(l));
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string };
    return `${err.stdout ?? ''}\n${err.stderr ?? ''}`
      .split('\n')
      .filter((l) => /deadlock detected|could not serialize/i.test(l));
  }
}

// ================================================================ C1. same truck

async function sameTruck(): Promise<void> {
  area('C1. Two driver changes on the same truck at once');
  const c = await co('same');
  const users = [
    await invite(c, 'SELLER'),
    await invite(c, 'SELLER'),
    await invite(c, 'SELLER'),
    await invite(c, 'SELLER'),
  ];
  const t = await truck(c, 'RACE 01');
  const t3 = await truck(c, 'RACE 03', users[2]!.id);
  const t4 = await truck(c, 'RACE 04', users[3]!.id);
  const since = new Date();

  await check(
    `${ROUNDS} rounds, two people with no truck put on the same truck at once: one end state, the last row names the driver, one row per change`,
    async () => {
      const issues: string[] = [];
      for (let i = 0; i < ROUNDS; i += 1) {
        const before = await rowsOf(t);
        const [x, y] = i % 2 === 0 ? [users[0]!, users[1]!] : [users[1]!, users[0]!];
        // Both are free each round: the truck goes to nobody first.
        if ((await driversOf([t]))[t] !== null) {
          const free = await driver(c.owner, t, null);
          if (!ok2(free)) issues.push(`round ${i}: freeing ${brief(free)}`);
        }
        const start = await rowsOf(t);
        const rs = await Promise.all([driver(c.owner, t, x.id), driver(c.owner, t, y.id)]);
        const end = await rowsOf(t);
        const now = (await driversOf([t]))[t];
        log.push(
          `C1a round ${i}: ${statusSet(rs)} -> driver ${now}, rows ${before}->${start}->${end}`,
        );
        if (rs.some((r) => r.status >= 500)) issues.push(`round ${i}: ${statusSet(rs)}`);
        if (now !== x.id && now !== y.id) issues.push(`round ${i}: driver is ${now}`);
        const changed = rs.filter(ok2).length;
        if (end - start !== changed) {
          issues.push(`round ${i}: ${changed} accepted changes wrote ${end - start} rows`);
        }
        issues.push(...(await truckRules(c.tenantId)).map((b) => `round ${i}: ${b}`));
      }
      assert(issues.length === 0, issues.slice(0, 6).join(' | '));
    },
  );

  await check(
    `${ROUNDS} rounds, two drivers who each have a truck moved onto the same truck at once: no driver on two trucks, the freed trucks have their rows`,
    async () => {
      const issues: string[] = [];
      for (let i = 0; i < ROUNDS; i += 1) {
        // Each round: user 2 on RACE 03, user 3 on RACE 04, nobody on RACE 01.
        for (const [w, u] of [
          [t, null],
          [t3, users[2]!.id],
          [t4, users[3]!.id],
        ] as [string, string | null][]) {
          if ((await driversOf([w]))[w] !== u) {
            const r = await driver(c.owner, w, u);
            if (!ok2(r)) issues.push(`round ${i} reset: ${brief(r)}`);
          }
        }
        const rs = await Promise.all([
          driver(c.owner, t, users[2]!.id),
          driver(c.owner, t, users[3]!.id),
        ]);
        const d = await driversOf([t, t3, t4]);
        log.push(`C1b round ${i}: ${statusSet(rs)} -> ${JSON.stringify(d)}`);
        if (rs.some((r) => r.status >= 500)) issues.push(`round ${i}: ${statusSet(rs)}`);
        // Whoever ends on RACE 01 must have left his own truck.
        const winner = d[t];
        if (winner === users[2]!.id && d[t3] !== null)
          issues.push(`round ${i}: user 2 on two trucks`);
        if (winner === users[3]!.id && d[t4] !== null)
          issues.push(`round ${i}: user 3 on two trucks`);
        issues.push(...(await truckRules(c.tenantId)).map((b) => `round ${i}: ${b}`));
      }
      assert(issues.length === 0, issues.slice(0, 6).join(' | '));
    },
  );

  await check(
    `${ROUNDS} rounds, one person put on two different trucks at once: one wins, the other is refused (VEHICLE_ALREADY_ASSIGNED), never 500`,
    async () => {
      const issues: string[] = [];
      const u = users[0]!;
      const ta = await truck(c, 'RACE 0A');
      const tb = await truck(c, 'RACE 0B');
      for (let i = 0; i < ROUNDS; i += 1) {
        for (const w of [ta, tb, t]) {
          if ((await driversOf([w]))[w] !== null) await driver(c.owner, w, null);
        }
        // Half the rounds he starts on RACE 01 (both changes then also free it).
        if (i % 2 === 1) await driver(c.owner, t, u.id);
        const rs = await Promise.all([driver(c.owner, ta, u.id), driver(c.owner, tb, u.id)]);
        const d = await driversOf([ta, tb, t]);
        log.push(`C1c round ${i}: ${statusSet(rs)} -> ${JSON.stringify(d)}`);
        if (rs.some((r) => r.status >= 500)) issues.push(`round ${i}: ${statusSet(rs)}`);
        const on = [ta, tb, t].filter((w) => d[w] === u.id).length;
        if (on !== 1) issues.push(`round ${i}: he drives ${on} trucks`);
        const refused = rs.filter((r) => !ok2(r));
        if (refused.some((r) => codeOf(r) !== 'VEHICLE_ALREADY_ASSIGNED')) {
          issues.push(`round ${i}: refused with ${statusSet(refused)}`);
        }
        issues.push(...(await truckRules(c.tenantId)).map((b) => `round ${i}: ${b}`));
      }
      assert(issues.length === 0, issues.slice(0, 6).join(' | '));
    },
  );

  await check('PostgreSQL logged no deadlock during C1', async () => {
    const lines = pgDeadlocks(since);
    assert(lines.length === 0, lines.slice(0, 3).join(' | '));
  });
}

// ================================================================ C2. cross moves

async function crossMoves(): Promise<void> {
  area('C2. Cross moves: A to truck 2 and B to truck 1 at once');
  const c = await co('cross');
  const a = await invite(c, 'SELLER');
  const b = await invite(c, 'SELLER');
  const d3 = await invite(c, 'SELLER');
  const t1 = await truck(c, 'CROSS 01', a.id);
  const t2 = await truck(c, 'CROSS 02', b.id);
  const t3 = await truck(c, 'CROSS 03', d3.id);
  const since = new Date();

  await check(
    `${ROUNDS} rounds of A (truck 1) to truck 2 and B (truck 2) to truck 1 at once: both pass, no deadlock, the trucks swap, no row lost`,
    async () => {
      const issues: string[] = [];
      let swapped = 0;
      for (let i = 0; i < ROUNDS; i += 1) {
        const d0 = await driversOf([t1, t2]);
        const onT1 = d0[t1]!;
        const onT2 = d0[t2]!;
        const r0 = (await rowsOf(t1)) + (await rowsOf(t2));
        const rs = await Promise.all([driver(c.owner, t2, onT1), driver(c.owner, t1, onT2)]);
        const d = await driversOf([t1, t2]);
        const r1 = (await rowsOf(t1)) + (await rowsOf(t2));
        log.push(`C2a round ${i}: ${statusSet(rs)} -> ${JSON.stringify(d)}, rows ${r0}->${r1}`);
        if (rs.some((r) => !ok2(r))) issues.push(`round ${i}: ${statusSet(rs)}`);
        if (d[t1] === onT2 && d[t2] === onT1) swapped += 1;
        else issues.push(`round ${i}: end ${JSON.stringify(d)} (expected a swap)`);
        // Each accepted change writes a row for its target, plus one for the freed truck when
        // the driver still had it: 3 or 4 rows per round, never fewer.
        if (r1 - r0 < 3) issues.push(`round ${i}: only ${r1 - r0} rows for two moves`);
        issues.push(...(await truckRules(c.tenantId)).map((x) => `round ${i}: ${x}`));
      }
      record({ name: `INFO C2: ${swapped}/${ROUNDS} rounds ended swapped`, status: 'INFO' });
      assert(issues.length === 0, issues.slice(0, 6).join(' | '));
    },
  );

  await check(
    `${ROUNDS} rounds of a three-way rotation at once (A→2, B→3, C→1): no deadlock, no 500, the rules hold`,
    async () => {
      const issues: string[] = [];
      for (let i = 0; i < ROUNDS; i += 1) {
        const d0 = await driversOf([t1, t2, t3]);
        const rs = await Promise.all([
          driver(c.owner, t2, d0[t1]!),
          driver(c.owner, t3, d0[t2]!),
          driver(c.owner, t1, d0[t3]!),
        ]);
        const d = await driversOf([t1, t2, t3]);
        log.push(`C2b round ${i}: ${statusSet(rs)} -> ${JSON.stringify(d)}`);
        if (rs.some((r) => !ok2(r))) issues.push(`round ${i}: ${statusSet(rs)}`);
        // Everybody still drives one of the three after a rotation (or, if the moves raced,
        // nobody is on two). Reset to a full set of drivers for the next round.
        issues.push(...(await truckRules(c.tenantId)).map((x) => `round ${i}: ${x}`));
        for (const [w, u] of [
          [t1, a.id],
          [t2, b.id],
          [t3, d3.id],
        ] as [string, string][]) {
          const now = await driversOf([t1, t2, t3]);
          if (now[w] !== u) {
            const r = await driver(c.owner, w, u);
            if (!ok2(r)) issues.push(`round ${i} reset: ${brief(r)}`);
          }
        }
      }
      assert(issues.length === 0, issues.slice(0, 6).join(' | '));
    },
  );

  await check('PostgreSQL logged no deadlock during C2', async () => {
    const lines = pgDeadlocks(since);
    assert(lines.length === 0, lines.slice(0, 3).join(' | '));
  });
}

// ================================================================ C3. sale and visit vs driver change

interface Shop {
  c: Company;
  p: Item;
  clients: string[];
  stock: (w: string) => Promise<string>;
}
async function shop(label: string): Promise<Shop> {
  const c = await co(label);
  const p = await product(c, { priceHt: '1000' });
  await openingStock(c, p, '5000', '500');
  const clients = [await client(c, 'Client 1'), await client(c, 'Client 2')];
  return { c, p, clients, stock: (w) => dbRead.warehouseStock(c.tenantId, p.id, w) };
}
async function load(s: Shop, to: string, qty: string): Promise<void> {
  const draft = await s.c.owner.post<{ id: string }>('/stock-transfers', {
    type: 'LOAD',
    fromWarehouseId: s.c.mainWarehouseId,
    toWarehouseId: to,
    lines: [{ productId: s.p.id, unitId: s.p.unitId, qty }],
  });
  await s.c.owner.post(`/stock-transfers/${draft.id}/validate`, {});
}
const sell = (s: Shop, who: Staff, qty: string): Promise<Res> =>
  post(
    who.api,
    '/sales/quick',
    {
      type: 'BL',
      clientId: s.clients[0]!,
      documentDate: today,
      warehouseId: null,
      lines: [{ productId: s.p.id, unitId: s.p.unitId, qty }],
      paidAmount: '0',
    },
    `t36c-${Math.random().toString(36).slice(2)}`,
  );
interface SaleTruth {
  saleWarehouse: string | null;
  movedFrom: string[];
}
const saleTruth = async (id: string): Promise<SaleTruth> => {
  const s = (
    await query<{ w: string | null }>(
      `SELECT "warehouseId"::text AS w FROM sales WHERE id = $1::uuid`,
      [id],
    )
  )[0]!;
  const m = await query<{ w: string }>(
    `SELECT DISTINCT "warehouseId"::text AS w FROM stock_movements WHERE "refId" = $1::uuid AND type = 'SALE'`,
    [id],
  );
  return { saleWarehouse: s.w, movedFrom: m.map((r) => r.w) };
};
const visitTruck = async (id: string): Promise<string | null> =>
  (
    await query<{ v: string | null }>(
      `SELECT "vehicleId"::text AS v FROM visits WHERE id = $1::uuid`,
      [id],
    )
  )[0]!.v;

async function saleAndVisit(): Promise<void> {
  area('C3. A driver change racing a sale or a visit by the old driver');
  const s = await shop('sale');
  const { c } = s;
  const x = await invite(c, 'SELLER');
  const t1 = await truck(c, 'SALE 01', x.id);
  const t2 = await truck(c, 'SALE 02');
  await load(s, t1, '200');
  await load(s, t2, '200');
  const cases: string[] = [];

  await check(
    `${ROUNDS} rounds of a quick sale by X racing his move to the other truck: the sale names and empties one truck, one of his two`,
    async () => {
      const issues: string[] = [];
      let fromOld = 0;
      let fromNew = 0;
      for (let i = 0; i < ROUNDS; i += 1) {
        const old = (await driversOf([t1, t2]))[t1] === x.id ? t1 : t2;
        const next = old === t1 ? t2 : t1;
        const [sale, move] = await Promise.all([sell(s, x, '1'), driver(c.owner, next, x.id)]);
        if (!ok2(sale) || !ok2(move)) {
          issues.push(`round ${i}: sale ${brief(sale)} move ${brief(move)}`);
          continue;
        }
        const id = (sale.body as { sale: { id: string } }).sale.id;
        const t = await saleTruth(id);
        cases.push(
          `C3a round ${i}: old ${old.slice(0, 8)} new ${next.slice(0, 8)} -> sale.warehouseId ${t.saleWarehouse?.slice(0, 8)}, moved from ${t.movedFrom.map((w) => w.slice(0, 8)).join(',')}`,
        );
        if (t.movedFrom.length !== 1 || t.movedFrom[0] !== t.saleWarehouse) {
          issues.push(
            `round ${i}: Sale.warehouseId ${t.saleWarehouse} but stock left ${t.movedFrom.join(',')}`,
          );
        }
        if (t.saleWarehouse === old) fromOld += 1;
        else if (t.saleWarehouse === next) fromNew += 1;
        else issues.push(`round ${i}: the sale left ${t.saleWarehouse}, neither of his trucks`);
      }
      record({
        name: `INFO C3a: the racing sale left the old truck ${fromOld} times, the new one ${fromNew} times`,
        status: 'INFO',
      });
      assert(issues.length === 0, issues.slice(0, 6).join(' | '));
    },
  );

  await check(
    `${ROUNDS} rounds of a visit started by X racing his move: the visit freezes one of his two trucks, the one the history gives at startedAt`,
    async () => {
      const issues: string[] = [];
      for (let i = 0; i < ROUNDS; i += 1) {
        const old = (await driversOf([t1, t2]))[t1] === x.id ? t1 : t2;
        const next = old === t1 ? t2 : t1;
        const startedAt = new Date().toISOString();
        const [visit, move] = await Promise.all([
          post(
            x.api,
            '/visits',
            { clientId: s.clients[1]!, startedAt, outcome: 'NO_SALE', reason: 'CLOSED' },
            `t36c-${Math.random().toString(36).slice(2)}`,
          ),
          driver(c.owner, next, x.id),
        ]);
        if (!ok2(visit) || !ok2(move)) {
          issues.push(`round ${i}: visit ${brief(visit)} move ${brief(move)}`);
          continue;
        }
        const v = await visitTruck(String(visit.body['id']));
        const truth =
          (
            await query<{ v: string | null }>(
              `SELECT a."vehicleId"::text AS v FROM vehicle_assignments a
             WHERE a."userId" = $1::uuid AND a."fromAt" <= $2::timestamptz
               AND NOT EXISTS (SELECT 1 FROM vehicle_assignments n WHERE n."vehicleId" = a."vehicleId"
                 AND n."fromAt" <= $2::timestamptz AND (n."fromAt", n."createdAt", n.id) > (a."fromAt", a."createdAt", a.id))
             ORDER BY a."fromAt" DESC LIMIT 1`,
              [x.id, startedAt],
            )
          )[0]?.v ?? null;
        cases.push(
          `C3b round ${i}: old ${old.slice(0, 8)} new ${next.slice(0, 8)} -> visit ${v?.slice(0, 8)}, history at startedAt ${truth?.slice(0, 8)}`,
        );
        if (v !== old && v !== next) issues.push(`round ${i}: the visit froze ${v}`);
        if (v !== truth)
          issues.push(`round ${i}: the visit froze ${v}, the history at startedAt gives ${truth}`);
      }
      assert(issues.length === 0, issues.slice(0, 6).join(' | '));
    },
  );

  await check(
    `${ROUNDS} rounds of the field flow (visit opened on the phone, then the sale, then the visit sent with the sale) racing his move: the visit and the stock name the same truck`,
    async () => {
      const issues: string[] = [];
      let split = 0;
      for (let i = 0; i < ROUNDS; i += 1) {
        const old = (await driversOf([t1, t2]))[t1] === x.id ? t1 : t2;
        const next = old === t1 ? t2 : t1;
        // The phone stamps startedAt when the seller opens the client, before anything is sent.
        const startedAt = new Date().toISOString();
        const flow = async (): Promise<{ sale: Res; visit: Res | null }> => {
          const sale = await sell(s, x, '1');
          if (!ok2(sale)) return { sale, visit: null };
          const visit = await post(
            x.api,
            '/visits',
            {
              clientId: s.clients[0]!,
              startedAt,
              outcome: 'SALE',
              saleId: (sale.body as { sale: { id: string } }).sale.id,
            },
            `t36c-${Math.random().toString(36).slice(2)}`,
          );
          return { sale, visit };
        };
        const [{ sale, visit }, move] = await Promise.all([flow(), driver(c.owner, next, x.id)]);
        if (!ok2(sale) || !visit || !ok2(visit) || !ok2(move)) {
          issues.push(
            `round ${i}: sale ${brief(sale)} visit ${visit ? brief(visit) : '-'} move ${brief(move)}`,
          );
          continue;
        }
        const t = await saleTruth((sale.body as { sale: { id: string } }).sale.id);
        const v = await visitTruck(String(visit.body['id']));
        cases.push(
          `C3c round ${i}: old ${old.slice(0, 8)} new ${next.slice(0, 8)} -> stock left ${t.movedFrom.map((w) => w.slice(0, 8)).join(',')}, visit ${v?.slice(0, 8)}`,
        );
        if (t.movedFrom[0] !== v) {
          split += 1;
          issues.push(
            `round ${i}: stock left ${t.movedFrom[0] === old ? 'the old truck' : 'the new truck'}, the visit names ${v === old ? 'the old truck' : v === next ? 'the new truck' : v}`,
          );
        }
      }
      record({
        name: `INFO C3c: ${split}/${ROUNDS} rounds split the sale and its visit over two trucks`,
        status: 'INFO',
      });
      assert(issues.length === 0, issues.slice(0, 6).join(' | '));
    },
  );

  await check(
    'after C3: each truck and the dépôt principal equal their movements; no negative stock',
    async () => {
      const issues: string[] = [];
      for (const w of [c.mainWarehouseId, t1, t2]) {
        const cached = await s.stock(w);
        const sum = (
          await query<{ q: string }>(
            `SELECT COALESCE(sum("qtyBase"), 0)::text AS q FROM stock_movements
           WHERE "productId" = $2::uuid AND ("warehouseId" = $1::uuid OR ($1::uuid = $3::uuid AND "warehouseId" IS NULL))`,
            [w, s.p.id, c.mainWarehouseId],
          )
        )[0]!.q;
        if (Number(cached) !== Number(sum)) issues.push(`${w}: stock ${cached}, movements ${sum}`);
        if (Number(cached) < 0) issues.push(`${w}: negative ${cached}`);
      }
      assert(issues.length === 0, issues.join(' | '));
    },
  );
  proof36('vehicles-race-sale.txt', cases.join('\n'));
}

// ================================================================ C4. bulk convert vs route edit

async function convertVsEdit(): Promise<void> {
  area('C4. Bulk convert racing a route edit');
  const c = await co('convert');
  const s1 = await invite(c, 'SELLER');
  const s2 = await invite(c, 'SELLER');
  const t1 = await truck(c, 'CONV 01', s1.id);
  const cases: string[] = [];

  const newSellerRoute = async (i: number): Promise<string> =>
    (
      await c.owner.post<{ id: string }>(
        '/routes',
        { name: `Tournée vendeur ${i}`, sellerId: s1.id, weekdays: WEEK },
        null,
      )
    ).id;
  const route = async (id: string) =>
    (
      await query<{ vehicleId: string | null; sellerId: string | null; name: string }>(
        `SELECT "vehicleId"::text, "sellerId"::text, name FROM routes WHERE id = $1::uuid`,
        [id],
      )
    )[0]!;
  const auditsOf = (id: string) =>
    query<{
      action: string;
      before: { vehicleId?: string | null; sellerId?: string | null } | null;
    }>(
      `SELECT action, before FROM audit_logs WHERE "tenantId" = $1::uuid AND "entityId" = $2 AND action IN ('ROUTE_CONVERTED','ROUTE_UPDATED')`,
      [c.tenantId, id],
    );

  await check(
    `${ROUNDS} rounds of a bulk convert racing a rename of the same seller route: the route ends on the truck with the new name, never with neither owner`,
    async () => {
      const issues: string[] = [];
      for (let i = 0; i < ROUNDS; i += 1) {
        const id = await newSellerRoute(i);
        const [conv, edit] = await Promise.all([
          post(c.owner, '/routes/convert-to-vehicle'),
          patch(c.owner, `/routes/${id}`, { name: `Renommée ${i}` }),
        ]);
        const r = await route(id);
        cases.push(
          `C4a round ${i}: convert ${conv.status} ${conv.raw.slice(0, 40)}, rename ${edit.status} -> ${JSON.stringify(r)}`,
        );
        if (!ok2(conv) || !ok2(edit)) issues.push(`round ${i}: ${statusSet([conv, edit])}`);
        if (r.vehicleId !== t1 || r.sellerId !== null)
          issues.push(`round ${i}: route ${JSON.stringify(r)}`);
        if (r.name !== `Renommée ${i}`) issues.push(`round ${i}: name lost (${r.name})`);
      }
      assert(issues.length === 0, issues.slice(0, 6).join(' | '));
    },
  );

  await check(
    `${ROUNDS} rounds of a bulk convert racing a move of the same seller route to seller2 (who drives no truck): one decision wins and its audit "before" is the state it replaced`,
    async () => {
      const issues: string[] = [];
      let editWon = 0;
      let convertWon = 0;
      let staleBefore = 0;
      for (let i = 0; i < ROUNDS; i += 1) {
        const id = await newSellerRoute(100 + i);
        const [conv, edit] = await Promise.all([
          post(c.owner, '/routes/convert-to-vehicle'),
          patch(c.owner, `/routes/${id}`, { sellerId: s2.id }),
        ]);
        const r = await route(id);
        const a = await auditsOf(id);
        const converted = a.some((x) => x.action === 'ROUTE_CONVERTED');
        const upd = a.find((x) => x.action === 'ROUTE_UPDATED');
        cases.push(
          `C4b round ${i}: convert ${conv.status} ${conv.raw.slice(0, 40)}, edit ${edit.status} -> ${JSON.stringify(r)}; converted=${converted}, ROUTE_UPDATED.before=${JSON.stringify(upd?.before)}`,
        );
        if (conv.status >= 500 || edit.status >= 500)
          issues.push(`round ${i}: ${statusSet([conv, edit])}`);
        if (!r.vehicleId && !r.sellerId) issues.push(`round ${i}: route with neither owner`);
        if (r.vehicleId === t1) convertWon += 1;
        else if (r.sellerId === s2.id) editWon += 1;
        // The convert committed, then the edit wrote over it from what it had read before.
        if (converted && r.sellerId === s2.id && upd && (upd.before?.vehicleId ?? null) === null) {
          staleBefore += 1;
          issues.push(
            `round ${i}: ROUTE_CONVERTED put it on the truck, then ROUTE_UPDATED moved it to seller2 with before = ${JSON.stringify(upd.before)} (it was on the truck)`,
          );
        }
      }
      record({
        name: `INFO C4b: convert won ${convertWon}, the edit won ${editWon}, the edit overwrote a committed convert from a stale read ${staleBefore} times`,
        status: 'INFO',
      });
      assert(issues.length === 0, issues.slice(0, 4).join(' | '));
    },
  );
  proof36('vehicles-race-convert.txt', cases.join('\n'));
}

// ================================================================ run

const AREAS: [string, () => Promise<void>][] = [
  ['same', sameTruck],
  ['cross', crossMoves],
  ['sale', saleAndVisit],
  ['convert', convertVsEdit],
];
for (const [name, fn] of AREAS) {
  if (!on(name)) continue;
  try {
    await fn();
  } catch (e) {
    record({
      name: `${name}: the area stopped`,
      status: 'FAIL',
      evidence: e instanceof Error ? (e.stack ?? e.message) : String(e),
    });
  }
}
await check('reconcile on the same database after part C: no difference', async () => {
  const apiDir = fileURLToPath(new URL('../../apps/api/', import.meta.url));
  let out = '';
  let code = 0;
  try {
    out = execFileSync('node', ['dist/reconcile/reconcile.cli.js'], {
      cwd: apiDir,
      encoding: 'utf8',
      env: { ...process.env, DATABASE_URL: DB, DATABASE_URL_MIGRATE: DB },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    code = err.status ?? 1;
    out = `${err.stdout ?? ''}\n${err.stderr ?? ''}`;
  }
  proof36('reconcile-race.txt', out);
  assert(code === 0, `exit ${code}: ${out.trim().split('\n').slice(-3).join(' | ')}`);
});
proof36('vehicles-race-drivers.txt', log.join('\n'));
writeSummary('vehicles-race');
await closeDb();
