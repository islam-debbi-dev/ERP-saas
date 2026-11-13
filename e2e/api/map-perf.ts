/**
 * Test 35, part C (server side): how the map and nearby queries behave on real volumes.
 *
 *   DB=postgresql://erp:erp@localhost:5432/erp_t35_perf pnpm test:map:perf
 *
 * A database of its own: 20 tenants, one with 50 000 clients, the others with 5 000. The
 * script starts its own API on it (port 3023), turns Postgres statement logging on for the
 * API's role, sends one request per case, reads the SQL the API really ran from the
 * container log, and runs `EXPLAIN (ANALYZE, BUFFERS)` on it as the API's role (RLS on).
 * Then it times the routes and measures the payload.
 *
 * Local Postgres on the same machine is not Neon from Vercel: the times are a floor.
 */
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import pg from 'pg';
import { DB } from '../lib/config.ts';
import { closeDb, db, query } from '../lib/db.ts';
import { area, assert, check, record, summary, writeSummary } from '../lib/harness.ts';
import { assertAuditDb, PASSWORD, proof, sleep } from '../lib/map-fixture.ts';

assertAuditDb();
if (!new URL(DB).pathname.startsWith('/erp_t35_perf')) throw new Error('part C runs on erp_t35_perf only');

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const FIX = fileURLToPath(new URL('../.auth/map-perf-fixture.json', import.meta.url));
const PORT = 3023;
const BASE = `http://localhost:${PORT}`;
const CONTAINER = process.env['DB_CONTAINER'] ?? 'erp-saas-db-1';
const APP_URL = DB.replace('//erp:erp@', '//erp_app:erp_app@');
const BUDGET_MS = 400;

interface PerfTenant {
  tenantId: string;
  ownerId: string;
  token: string;
  email: string;
  clients: number;
  sellerId?: string;
  sellerToken?: string;
}
interface PerfFixture {
  big: PerfTenant;
  small: PerfTenant;
  others: number;
}

function startApi(): ChildProcess {
  return spawn('node', ['dist/main.js'], {
    cwd: `${ROOT}apps/api`,
    env: {
      ...process.env,
      DATABASE_URL: APP_URL,
      DATABASE_URL_MIGRATE: DB,
      PORT: String(PORT),
      WEB_ORIGIN: 'http://localhost:3005',
      LOG_LEVEL: 'warn',
      NODE_ENV: 'production',
      RATE_LIMIT_PER_MINUTE: '1000000',
      RATE_LIMIT_AUTH_PER_MINUTE: '100000',
      ACCESS_TOKEN_TTL_SECONDS: '43200',
      SENTRY_DSN: '',
    },
    stdio: 'ignore',
  });
}
async function waitUp(): Promise<void> {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${BASE}/health`)).status === 200) return;
    } catch {
      /* not yet */
    }
    await sleep(500);
  }
  throw new Error('the perf API did not start');
}

async function post<T>(path: string, body: unknown, token?: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Client-Type': 'native', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  if (res.status >= 300) throw new Error(`${path}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T;
}

async function seed(): Promise<PerfFixture> {
  const statements = readFileSync(fileURLToPath(new URL('../sql/map-perf-seed.sql', import.meta.url)), 'utf8')
    .split(/^-- @@ .*$/m)
    .slice(1);
  const tag = Date.now().toString(36);
  const make = async (label: string, n: number, withSeller: boolean): Promise<PerfTenant> => {
    const email = `t35-perf-${label}-${tag}@audit.local`;
    const r = await post<{ accessToken: string; user: { id: string; tenantId: string } }>('/auth/register', {
      companyName: `T35 perf ${label} ${tag}`, fullName: `Owner ${label}`, email, password: PASSWORD, activity: 'DISTRIBUTEUR',
    });
    const t: PerfTenant = { tenantId: r.user.tenantId, ownerId: r.user.id, token: r.accessToken, email, clients: n };
    if (withSeller) {
      await fetch(`${BASE}/tenant/settings`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t.token}` }, body: JSON.stringify({ sellerScope: 'ASSIGNED_ONLY' }) });
      const inv = await post<{ inviteUrl: string }>('/users/invite', { fullName: 'Perf seller', email: `t35-perf-seller-${label}-${tag}@audit.local`, role: 'SELLER', managerId: null, mode: 'LINK' }, t.token);
      const acc = await post<{ accessToken: string; user: { id: string } }>(`/auth/invitations/${inv.inviteUrl.split('/').pop()}/accept`, { password: PASSWORD });
      t.sellerId = acc.user.id;
      t.sellerToken = acc.accessToken;
    }
    for (const sql of statements) {
      const uses = (k: number): boolean => sql.includes(`$${k}`);
      const all = [t.tenantId, n, t.ownerId, t.sellerId ?? null, `P${label}`];
      // Each statement gets only the parameters it names, renumbered in order.
      let text = sql;
      const params: unknown[] = [];
      for (let k = 1; k <= 5; k++) {
        if (!uses(k)) continue;
        params.push(all[k - 1]);
        text = text.replaceAll(`$${k}`, `$__${params.length}`);
      }
      await db().query(text.replaceAll('$__', '$'), params as never[]);
    }
    return t;
  };
  const big = await make('big', 50_000, true);
  const small = await make('small', 5_000, true);
  for (let i = 0; i < 18; i++) await make(`o${i}`, 5_000, false);
  await db().query('VACUUM ANALYZE clients');
  await db().query('VACUUM ANALYZE client_balances');
  const fx: PerfFixture = { big, small, others: 18 };
  writeFileSync(FIX, JSON.stringify(fx, null, 2));
  return fx;
}

interface Logged {
  sql: string;
  params: string[];
}
/** The statements Postgres logged since `since`, with their parameters. */
function loggedSince(since: string): Logged[] {
  const raw = execFileSync('docker', ['logs', '--since', since, CONTAINER], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 256 * 1024 * 1024 });
  const err = execFileSync('sh', ['-c', `docker logs --since ${since} ${CONTAINER} 2>&1 >/dev/null`], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  const text = `${raw}\n${err}`;
  const entries = text.split(/\n(?=\d{4}-\d\d-\d\d \d\d:\d\d:\d\d\.\d+ \w+ \[\d+\] )/);
  const out: Logged[] = [];
  for (const e of entries) {
    const m = /\] LOG:\s+(?:execute [^:]+|statement): ([\s\S]*)$/.exec(e);
    if (m) {
      out.push({ sql: m[1]!.replace(/\n\t/g, '\n').trim(), params: [] });
      continue;
    }
    const d = /\] DETAIL:\s+[Pp]arameters: ([\s\S]*)$/.exec(e);
    if (d && out.length > 0) {
      const params: string[] = [];
      const re = /\$(\d+) = ('(?:[^']|'')*'|NULL)/g;
      let x: RegExpExecArray | null;
      while ((x = re.exec(d[1]!))) params[Number(x[1]) - 1] = x[2]!;
      out[out.length - 1]!.params = params;
    }
  }
  return out;
}
const inline = (l: Logged): string => {
  let s = l.sql;
  for (let i = l.params.length; i >= 1; i--) s = s.replaceAll(new RegExp(`\\$${i}(?!\\d)`, 'g'), l.params[i - 1] ?? 'NULL');
  return s;
};

/** `asOwner`: the table owner is not bound by row-level security (what `psql` as erp shows). */
async function explain(tenantId: string, sql: string, asOwner = false): Promise<{ plan: string; ms: number; usesGeo: boolean; index: string[]; buffers: number }> {
  const c = new pg.Client({ connectionString: asOwner ? DB : APP_URL });
  await c.connect();
  try {
    await c.query('BEGIN');
    await c.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
    await c.query(`EXPLAIN (ANALYZE, BUFFERS) ${sql}`); // warm the cache: the second run is the one kept
    const res = await c.query<{ 'QUERY PLAN': string }>(`EXPLAIN (ANALYZE, BUFFERS) ${sql}`);
    const plan = res.rows.map((r) => r['QUERY PLAN']).join('\n');
    const ms = Number(/Execution Time: ([\d.]+) ms/.exec(plan)?.[1] ?? NaN);
    const index = [...plan.matchAll(/(?:Index(?: Only)? Scan|Bitmap Index Scan)(?: Backward)? (?:using|on) (\S+)/g)].map((m) => m[1]!);
    const buffers = Number(/Buffers: shared hit=(\d+)/.exec(plan)?.[1] ?? NaN);
    return { plan, ms, usesGeo: index.some((i) => /^clients_tenant_geo(_f)?_idx$/.test(i)), index: [...new Set(index)], buffers };
  } finally {
    await c.query('ROLLBACK');
    await c.end();
  }
}

async function timed(path: string, token: string, runs = 30): Promise<{ p50: number; p95: number; max: number; bytes: number; gzip: number; status: number; points: number; encoding: string | null }> {
  const times: number[] = [];
  let bytes = 0;
  let gz = 0;
  let status = 0;
  let points = 0;
  let encoding: string | null = null;
  for (let i = 0; i < runs + 3; i++) {
    const t = performance.now();
    const res = await fetch(`${BASE}${path}`, { headers: { Authorization: `Bearer ${token}`, 'Accept-Encoding': 'identity' } });
    const buf = Buffer.from(await res.arrayBuffer());
    const ms = performance.now() - t;
    if (i >= 3) times.push(ms); // three warm-up calls
    status = res.status;
    bytes = buf.length;
    gz = gzipSync(buf).length;
    encoding = res.headers.get('content-encoding');
    try {
      const j = JSON.parse(buf.toString('utf8')) as { points?: unknown[] } | unknown[];
      points = Array.isArray(j) ? j.length : (j.points?.length ?? 0);
    } catch {
      /* not json */
    }
  }
  times.sort((a, b) => a - b);
  const q = (p: number): number => Math.round(times[Math.min(times.length - 1, Math.floor(times.length * p))]! * 10) / 10;
  return { p50: q(0.5), p95: q(0.95), max: Math.round(times[times.length - 1]! * 10) / 10, bytes, gzip: gz, status, points, encoding };
}

async function main(): Promise<void> {
  // Statement logging for the API's role in this database only; new connections pick it up.
  await db().query(`ALTER ROLE erp_app IN DATABASE ${new URL(DB).pathname.slice(1)} SET log_statement = 'all'`);
  const api = startApi();
  try {
    await waitUp();
    const fx: PerfFixture = existsSync(FIX) ? (JSON.parse(readFileSync(FIX, 'utf8')) as PerfFixture) : await seed();
    const counts = await query<{ tenants: number; clients: number; big: number }>(
      `SELECT count(DISTINCT "tenantId")::int AS tenants, count(*)::int AS clients, count(*) FILTER (WHERE "tenantId" = $1)::int AS big FROM clients`,
      [fx.big.tenantId],
    );
    console.log('perf database:', counts[0]);

    const ALGER = 'lat=36.7538&lng=3.0588';
    const cases: { key: string; tenant: PerfTenant; token: string; path: string; what: string }[] = [
      { key: 'map-5k', tenant: fx.small, token: fx.small.token, path: '/clients/map', what: '/clients/map, 5 000 clients, owner, no filter (2 000 points, truncated)' },
      { key: 'map-50k', tenant: fx.big, token: fx.big.token, path: '/clients/map', what: '/clients/map, 50 000 clients, owner, no filter (2 000 points, truncated)' },
      { key: 'map-50k-box', tenant: fx.big, token: fx.big.token, path: '/clients/map?minLat=36.70&minLng=3.00&maxLat=36.80&maxLng=3.12', what: '/clients/map, 50 000 clients, a city-sized box' },
      { key: 'map-50k-box-small', tenant: fx.big, token: fx.big.token, path: '/clients/map?minLat=36.75&minLng=3.05&maxLat=36.76&maxLng=3.06', what: '/clients/map, 50 000 clients, a 1 km box' },
      { key: 'map-50k-debt', tenant: fx.big, token: fx.big.token, path: '/clients/map?hasDebt=true', what: '/clients/map, 50 000 clients, hasDebt' },
      { key: 'map-50k-search', tenant: fx.big, token: fx.big.token, path: '/clients/map?search=caf', what: '/clients/map, 50 000 clients, search "caf"' },
      { key: 'map-50k-seller', tenant: fx.big, token: fx.big.sellerToken!, path: '/clients/map', what: '/clients/map, 50 000 clients, a seller (ASSIGNED_ONLY, one client in eight)' },
      { key: 'nearby-5k', tenant: fx.small, token: fx.small.token, path: `/clients/nearby?${ALGER}&radiusM=5000&limit=30`, what: '/clients/nearby, 5 000 clients, 5 km' },
      { key: 'nearby-50k', tenant: fx.big, token: fx.big.token, path: `/clients/nearby?${ALGER}&radiusM=5000&limit=30`, what: '/clients/nearby, 50 000 clients, 5 km' },
      { key: 'nearby-50k-wide', tenant: fx.big, token: fx.big.token, path: `/clients/nearby?${ALGER}&radiusM=50000&limit=100`, what: '/clients/nearby, 50 000 clients, 50 km, 100 rows' },
    ];

    const rows: string[] = ['| Case | SQL statements per request | on `clients` | Slowest statement, as the API role (RLS on) | Indexes used | `clients_tenant_geo_idx` as the API role | Same statement as the table owner (no RLS) | HTTP p50 / p95 / max (ms, 30 runs) | Body | gzip |', '|---|---|---|---|---|---|---|---|---|---|'];
    const plans: string[] = ['# EXPLAIN (ANALYZE, BUFFERS) of the SQL the API ran', '', 'Captured from the Postgres log (`log_statement = all` for role erp_app), parameters inlined, run as erp_app with `app.tenant_id` set (row-level security applies).', ''];
    const results: Record<string, { ms: number; usesGeo: boolean; ownerGeo: boolean; ownerMs: number; buffers: number; ownerBuffers: number; statements: number; p50: number; p95: number; bytes: number; gzip: number; points: number }> = {};

    for (const c of cases) {
      await sleep(1200);
      const since = new Date(Date.now() - 200).toISOString();
      const res = await fetch(`${BASE}${c.path}`, { headers: { Authorization: `Bearer ${c.token}` } });
      await res.arrayBuffer();
      await sleep(700);
      const logged = loggedSince(since);
      const onClients = logged.filter((l) => /FROM clients c/.test(l.sql));
      let worst = { plan: '', ms: 0, usesGeo: false, index: [] as string[], buffers: 0 };
      let owner = { plan: '', ms: 0, usesGeo: false, index: [] as string[], buffers: 0 };
      const idx = new Set<string>();
      let anyGeo = false;
      for (const l of onClients) {
        const e = await explain(c.tenant.tenantId, inline(l));
        e.index.forEach((i) => idx.add(i));
        anyGeo ||= e.usesGeo;
        const o = await explain(c.tenant.tenantId, inline(l), true);
        plans.push(`## ${c.key} — ${c.what}`, '', '```sql', inline(l), '```', '', 'As erp_app (row-level security on), what the API gets:', '', '```', e.plan, '```', '', 'As erp, the table owner (no row-level security):', '', '```', o.plan, '```', '');
        if (e.ms >= worst.ms) {
          worst = e;
          owner = o;
        }
      }
      const t = await timed(c.path, c.token);
      results[c.key] = { ms: worst.ms, usesGeo: anyGeo, ownerGeo: owner.usesGeo, ownerMs: owner.ms, buffers: worst.buffers, ownerBuffers: owner.buffers, statements: logged.length, p50: t.p50, p95: t.p95, bytes: t.bytes, gzip: t.gzip, points: t.points };
      rows.push(`| ${c.what} | ${logged.length} | ${onClients.length} | ${worst.ms} ms, ${worst.buffers} buffers | ${[...idx].join(', ') || 'none (seq scan)'} | ${anyGeo ? 'used' : '**not used**'} | ${owner.ms} ms, ${owner.buffers} buffers, geo index ${owner.usesGeo ? 'used' : 'not used'} | ${t.p50} / ${t.p95} / ${t.max} | ${(t.bytes / 1024).toFixed(0)} kB (${t.points} rows) | ${(t.gzip / 1024).toFixed(0)} kB |`);
      if (c.key === 'map-50k') {
        proof('perf-statements-per-request.txt', logged.map((l, i) => `-- ${i + 1}\n${l.sql}\n-- parameters: ${l.params.join(', ')}`).join('\n\n'));
        record({ name: 'does the API compress its answers itself?', status: 'INFO', actual: `Content-Encoding without asking for one: ${t.encoding ?? 'none'} (Vercel compresses at the edge)` });
      }
    }
    proof('perf-explain.md', plans.join('\n'));
    proof('perf-server.md', [`# Part C, server side`, '', `Database: ${counts[0]!.tenants} tenants, ${counts[0]!.clients} clients, ${counts[0]!.big} in the big tenant. Local Postgres 16, API built from the audited commit, connected as erp_app.`, '', ...rows, ''].join('\n'));
    console.log(rows.join('\n'));

    area('C1 the SQL of /clients/map and /clients/nearby');
    await check('no N+1: a request runs a fixed, small number of statements whatever the number of points', () => {
      const a = results['map-5k']!.statements;
      const b = results['map-50k']!.statements;
      assert(a === b, `5 000 clients: ${a} statements, 50 000: ${b}`);
      assert(b <= 12, `${b} statements for one /clients/map`);
    });
    for (const k of ['map-50k-box', 'map-50k-box-small', 'nearby-5k', 'nearby-50k', 'nearby-50k-wide']) {
      await check(`${k}: the lat/lng box is served by clients_tenant_geo_idx for the API's role`, () => {
        const r = results[k]!;
        assert(r.usesGeo, `not used as erp_app: ${r.ms} ms and ${r.buffers} buffers; as the owner it is ${r.ownerGeo ? 'used' : 'not used'}: ${r.ownerMs} ms and ${r.ownerBuffers} buffers (artifacts/test-35/perf-explain.md, "${k}")`);
      });
    }
    record({
      name: 'the unboxed map (first load) cannot use the geo index: it reads the tenant\'s clients by name',
      status: 'INFO',
      actual: `map-5k: slowest statement ${results['map-5k']!.ms} ms; map-50k: ${results['map-50k']!.ms} ms`,
    });

    area(`C2 the budget of the spec: /clients/map with 2 000 points under ${BUDGET_MS} ms`);
    for (const k of ['map-5k', 'map-50k', 'map-50k-seller', 'map-50k-debt', 'map-50k-search', 'map-50k-box']) {
      await check(`${k}: p95 under ${BUDGET_MS} ms (local floor)`, () => {
        const r = results[k]!;
        assert(r.p95 < BUDGET_MS, `p95 ${r.p95} ms, p50 ${r.p50} ms for ${r.points} points`);
      }, { actual: `p50 ${results[k]!.p50} ms, p95 ${results[k]!.p95} ms, ${results[k]!.points} points` });
    }
    for (const k of ['nearby-5k', 'nearby-50k', 'nearby-50k-wide']) {
      await check(`${k}: p95 under ${BUDGET_MS} ms`, () => {
        assert(results[k]!.p95 < BUDGET_MS, `p95 ${results[k]!.p95} ms`);
      }, { actual: `p50 ${results[k]!.p50} ms, p95 ${results[k]!.p95} ms` });
    }
    record({
      name: 'size of /clients/map with 2 000 points',
      status: 'INFO',
      actual: `${(results['map-50k']!.bytes / 1024).toFixed(0)} kB raw, ${(results['map-50k']!.gzip / 1024).toFixed(0)} kB gzip (${Math.round(results['map-50k']!.bytes / results['map-50k']!.points)} bytes a point)`,
    });
  } finally {
    api.kill('SIGTERM');
    await db().query(`ALTER ROLE erp_app IN DATABASE ${new URL(DB).pathname.slice(1)} RESET log_statement`);
  }
  writeSummary('test-35/perf-server');
  await closeDb();
  if (summary().failed > 0) process.exitCode = 1;
}

main().catch(async (err) => {
  console.error(err);
  await closeDb();
  process.exit(1);
});
