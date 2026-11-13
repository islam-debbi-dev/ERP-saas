/**
 * Test 35, part B: is the user's position kept anywhere?
 *
 *   DB=postgresql://erp:erp@localhost:5432/erp_t35 pnpm test:map:privacy
 *
 * The spec: the position "is not stored, not audited, not logged (strip lat / lng query
 * params from the pino request log for this route)".
 *
 * This script starts its **own** API (the built one, port 3013, pino at `info` into a file,
 * Sentry pointed at a local sink) and a local copy of the Vercel rewrite, sends "près de moi"
 * requests in every spelling a client or a proxy may use, each with its own coordinates, then
 * reads the log file, the Sentry envelopes and every column of the database for them.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DB } from '../lib/config.ts';
import { closeDb, query } from '../lib/db.ts';
import { area, assert, check, record, summary, writeSummary } from '../lib/harness.ts';
import { assertAuditDb, loadFixture, proof, sleep } from '../lib/map-fixture.ts';
import { startRewriteProxy } from '../lib/rewrite-proxy.ts';
import { startSink } from '../lib/sentry-sink.ts';

assertAuditDb();
const f = loadFixture();
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const TMP = fileURLToPath(new URL('../.auth/privacy/', import.meta.url));
const API_PORT = 3013;
const SINK_PORT = 3098;
const PROXY_PORT = 3014;
const BASE = `http://localhost:${API_PORT}`;
const token = f.a.owner.token;

/** Each variant has coordinates nobody else uses, so a hit names the variant. */
interface Variant {
  key: string;
  what: string;
  /** Path with LAT / LNG placeholders, sent to the API (or to the proxy when `viaProxy`). */
  path: string;
  viaProxy?: boolean;
  /** The request a real client of this app can send: a leak here is the finding. */
  realistic: boolean;
  lat: string;
  lng: string;
  status?: number;
}
let n = 0;
const v = (key: string, what: string, path: string, realistic: boolean, viaProxy = false): Variant => {
  n += 1;
  return { key, what, path, realistic, viaProxy, lat: `36.7${String(10000 + n * 137).slice(-5)}`.slice(0, 9), lng: `3.0${String(20000 + n * 151).slice(-5)}`.slice(0, 8) };
};
const variants: Variant[] = [
  v('direct', 'the route as the web calls it', '/clients/nearby?lat=LAT&lng=LNG&radiusM=5000&limit=30', true),
  v('filters', 'with filters, position last', '/clients/nearby?hasDebt=true&search=caf%C3%A9&radiusM=10000&lat=LAT&lng=LNG', true),
  v('proxy', 'through the /api rewrite (apps/web/vercel.json)', '/api/clients/nearby?lat=LAT&lng=LNG&radiusM=5000', true, true),
  v('invalid', 'a valid position with an invalid radius (400)', '/clients/nearby?lat=LAT&lng=LNG&radiusM=abc', true),
  v('error500', 'a valid position on a request that answers 500 (finding A-2)', '/clients/nearby?lat=LAT&lng=LNG&search=%00', true),
  v('no-token', 'the position without a token (401)', '/clients/nearby?lat=LAT&lng=LNG', true),
  v('slash', 'a trailing slash', '/clients/nearby/?lat=LAT&lng=LNG', false),
  v('upper', 'an upper-case path', '/Clients/Nearby?lat=LAT&lng=LNG', false),
  v('double', 'a doubled slash', '//clients/nearby?lat=LAT&lng=LNG', false),
  v('encoded', 'an encoded slash', '/clients%2Fnearby?lat=LAT&lng=LNG', false),
  v('twice', 'lat sent twice', '/clients/nearby?lat=1&lat=LAT&lng=LNG', false),
  v('case-param', 'upper-case parameter names next to a real position (unknown parameters are logged like on any route)', '/clients/nearby?Lat=LAT&Lng=LNG&lat=1&lng=1', false),
  v('fragment', 'a semicolon path parameter', '/clients/nearby;x=1?lat=LAT&lng=LNG', false),
  v('map-box', 'for comparison: the view box of /clients/map (the screen around the user after "Près de moi")', '/clients/map?minLat=LAT&minLng=LNG&maxLat=36.9&maxLng=3.3', true),
];

function startApi(logFile: string, extraEnv: Record<string, string> = {}): ChildProcess {
  const child = spawn('node', ['dist/main.js'], {
    cwd: `${ROOT}apps/api`,
    env: {
      ...process.env,
      DATABASE_URL: DB.replace('//erp:erp@', '//erp_app:erp_app@'),
      DATABASE_URL_MIGRATE: DB,
      PORT: String(API_PORT),
      WEB_ORIGIN: 'http://localhost:3005',
      LOG_LEVEL: 'info',
      NODE_ENV: 'production',
      RATE_LIMIT_PER_MINUTE: '1000000',
      ACCESS_TOKEN_TTL_SECONDS: '43200',
      SENTRY_DSN: `http://t35@localhost:${SINK_PORT}/1`,
      ...extraEnv,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  writeFileSync(logFile, '');
  const chunks: Buffer[] = [];
  const keep = (c: Buffer): void => {
    chunks.push(c);
  };
  child.stdout!.on('data', keep);
  child.stderr!.on('data', keep);
  child.on('exit', () => writeFileSync(logFile, Buffer.concat(chunks)));
  return child;
}

async function waitUp(): Promise<void> {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${BASE}/health`)).status === 200) return;
    } catch {
      /* not up yet */
    }
    await sleep(500);
  }
  throw new Error('the privacy API did not start');
}

async function stop(child: ChildProcess): Promise<void> {
  await new Promise<void>((done) => {
    child.on('exit', () => done());
    child.kill('SIGTERM');
    setTimeout(() => child.kill('SIGKILL'), 8000).unref();
  });
}

/** Every way a coordinate may be written in a log or a payload. */
const needles = (x: Variant): string[] => [x.lat, x.lng, x.lat.slice(0, 7), x.lng.slice(0, 6)];

async function main(): Promise<void> {
  mkdirSync(TMP, { recursive: true });
  const sink = await startSink(SINK_PORT);
  const proxy = await startRewriteProxy(PROXY_PORT, BASE);
  const logFile = `${TMP}api.log`;
  const api = startApi(logFile);
  await waitUp();

  // The Sentry SDK samples one request in ten: every variant is sent 40 times.
  for (const x of variants) {
    const path = x.path.replace('LAT', x.lat).replace('LNG', x.lng);
    const url = x.viaProxy ? `http://localhost:${PROXY_PORT}${path}` : `${BASE}${path}`;
    for (let i = 0; i < 40; i++) {
      const res = await fetch(url, {
        headers: x.key === 'no-token' ? {} : { Authorization: `Bearer ${token}` },
      });
      x.status = res.status;
      await res.arrayBuffer();
    }
  }
  // A full session, as the nearby sheet does it: four radius chips, twice. Its coordinates
  // are picked so that no stored point shares even their first four decimals: a hit in the
  // database scan can then only be the position itself, whole or rounded.
  const SESSION = { lat: '', lng: '' };
  for (let k = 0; k < 500 && !SESSION.lat; k++) {
    const lat = `36.${String(761357 + k * 1009).padStart(6, '0')}`;
    const lng = `3.${String(47913 + k * 1013).padStart(6, '0')}`;
    const used = await query<{ n: number }>(
      `SELECT ((SELECT count(*) FROM clients WHERE lat::text LIKE $1 OR lng::text LIKE $2)
             + (SELECT count(*) FROM warehouses WHERE lat::text LIKE $1 OR lng::text LIKE $2))::int AS n`,
      [`${lat.slice(0, 7)}%`, `${lng.slice(0, 6)}%`],
    );
    if (used[0]!.n === 0) Object.assign(SESSION, { lat, lng });
  }
  if (!SESSION.lat) throw new Error('no free coordinates for the session');
  // Since the fix of B-3 the sheet POSTs the position in a JSON body, through the /api
  // rewrite of the web project. Seven rounds, so the Sentry sampling (one in ten) keeps some.
  const sessionStatus = new Set<number>();
  for (let round = 0; round < 7; round++) {
    for (const radiusM of [1000, 5000, 10000, 25000, 1000, 5000]) {
      const res = await fetch(`http://localhost:${PROXY_PORT}/api/clients/nearby`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ lat: Number(SESSION.lat), lng: Number(SESSION.lng), radiusM, limit: 30 }),
      });
      sessionStatus.add(res.status);
      await res.arrayBuffer();
    }
  }
  await sleep(4000); // let the SDK flush its envelopes
  await stop(api);
  await sleep(500);
  await proxy.close();

  const log = readFileSync(logFile, 'utf8');
  const lines = log.split('\n');
  const envelopes = sink.bodies.join('\n');
  await sink.close();

  const inLog = (x: Variant): string[] => lines.filter((l) => needles(x).some((nd) => l.includes(nd)));
  // Not after a digit: a span timestamp such as 1794597993.020187 holds "3.0201", the first
  // decimals of a longitude sent in the same second, and is not a position.
  const holds = (text: string, nd: string): boolean => new RegExp(`(?<![\\d.])${nd.replace('.', '\\.')}`).test(text);
  const inSentry = (x: Variant): boolean => needles(x).some((nd) => holds(envelopes, nd));

  const table = ['| Variant | Request | HTTP | In the pino log | In a Sentry payload |', '|---|---|---|---|---|'];
  for (const x of variants) {
    table.push(`| ${x.key} | \`${x.path.replace('LAT', x.lat).replace('LNG', x.lng)}\`${x.viaProxy ? ' (via the rewrite)' : ''} | ${x.status} | ${inLog(x).length > 0 ? `**yes, ${inLog(x).length} lines**` : 'no'} | ${inSentry(x) ? '**yes**' : 'no'} |`);
  }
  const sample = (x: Variant): string => {
    const l = inLog(x)[0];
    if (!l) return '';
    const i = Math.max(0, l.indexOf(needles(x).find((nd) => l.includes(nd))!) - 160);
    return l.slice(i, i + 420);
  };
  const sentrySample = (x: Variant): string => {
    const nd = needles(x).find((s) => envelopes.includes(s));
    if (!nd) return '';
    const i = envelopes.indexOf(nd);
    return envelopes.slice(Math.max(0, i - 300), i + 200);
  };
  proof(
    'privacy-log-and-sentry.md',
    [
      '# The position in the API log and in the Sentry payloads',
      '',
      `API built from the audited commit, \`LOG_LEVEL=info\`, \`SENTRY_DSN\` → a local sink. ${lines.length} log lines, ${sink.bodies.length} Sentry envelopes. Each variant was sent 40 times with its own coordinates.`,
      '',
      ...table,
      '',
      '## Samples',
      '',
      ...variants.filter((x) => inLog(x).length > 0).flatMap((x) => [`### log — ${x.key}`, '', '```', sample(x), '```', '']),
      ...variants.filter(inSentry).flatMap((x) => [`### Sentry — ${x.key}`, '', '```', sentrySample(x), '```', '']),
    ].join('\n'),
  );

  area('B1 the pino request log (LOG_LEVEL=info)');
  await check(`the log was written and holds the nearby requests (${lines.length} lines)`, () => {
    assert(lines.filter((l) => l.includes('/clients/nearby')).length >= 100, 'no nearby request in the log: nothing was tested');
    assert(!log.includes(token.slice(-24)), 'the access token is in the log');
  });
  for (const x of variants.filter((q) => q.realistic && q.key !== 'map-box')) {
    await check(`${x.key}: ${x.what} (HTTP ${x.status}) → no coordinate in any log line`, () => {
      const hits = inLog(x);
      assert(hits.length === 0, `${hits.length} log lines hold ${x.lat} / ${x.lng}: …${sample(x)}…`);
    });
  }
  const sessionNeedles = [SESSION.lat, SESSION.lng, SESSION.lat.slice(0, 7), SESSION.lng.slice(0, 6)];
  await check('the full "près de moi" session (POST, position in the body, 42 calls) left no coordinate in the log', () => {
    assert([...sessionStatus].join() === '200', `the session calls answered ${[...sessionStatus].join(', ')}`);
    const hits = lines.filter((l) => sessionNeedles.some((nd) => l.includes(nd)));
    assert(hits.length === 0, `${hits.length} lines`);
  });
  for (const x of variants.filter((q) => !q.realistic)) {
    const hits = inLog(x);
    record({
      name: `spelling the web never sends — ${x.key}: ${x.what} (HTTP ${x.status})`,
      // A FAIL only when the route took these coordinates as the position and answered.
      status: hits.length === 0 ? 'PASS' : x.status === 200 && x.key !== 'case-param' ? 'FAIL' : 'INFO',
      expected: 'no coordinate in the log',
      actual: hits.length === 0 ? 'no coordinate in the log' : `${hits.length} log lines hold the coordinates; the route answered ${x.status}`,
      evidence: hits.length ? `log-privacy.ts:5 matches /^\\/clients\\/nearby(?:\\?|$)/ only: …${sample(x).slice(0, 200)}…` : undefined,
    });
  }
  {
    const x = variants.find((q) => q.key === 'map-box')!;
    record({
      name: 'for comparison — the view box of /clients/map is logged (the map is centred on the user after "Près de moi")',
      status: 'INFO',
      actual: `${inLog(x).length} log lines hold the box corner ${x.lat}, ${x.lng}`,
    });
  }

  area('B2 the Sentry payloads (fake DSN, local sink)');
  await check(`the sink received envelopes (${sink.bodies.length})`, () => {
    assert(sink.bodies.length > 0, 'no envelope: Sentry was not active, nothing was tested');
  });
  for (const x of variants.filter((q) => q.realistic && q.key !== 'map-box')) {
    await check(`${x.key}: ${x.what} → no coordinate in a Sentry payload`, () => {
      assert(!inSentry(x), `the payload holds the position: …${sentrySample(x).replace(/\s+/g, ' ').slice(0, 400)}…`);
    });
  }

  await check('the "près de moi" session (POST body) → no coordinate in a Sentry payload', () => {
    assert(!sessionNeedles.some((nd) => holds(envelopes, nd)), 'a Sentry payload holds the position sent in the body');
  });

  area('B3 the database after the session');
  await check('no table holds the coordinates that were sent (every text, numeric and json column)', async () => {
    const sql = readFileSync(fileURLToPath(new URL('../sql/map-privacy.sql', import.meta.url)), 'utf8');
    const all = [...variants.flatMap((x) => [x.lat, x.lng]), SESSION.lat, SESSION.lng, SESSION.lat.slice(0, 7), SESSION.lng.slice(0, 6)];
    const hits = await query<{ tbl: string; col: string; needle: string; hits: number }>(sql, [all]);
    proof('privacy-db-scan.json', JSON.stringify({ needles: all, hits }, null, 2));
    assert(hits.length === 0, `found in ${hits.map((h) => `${h.tbl}.${h.col} (${h.needle} ×${h.hits})`).join(', ')}`);
  });
  await check('the nearby calls wrote no audit row and no geo check', async () => {
    const rows = await query<{ n: number }>(
      `SELECT count(*)::int AS n FROM audit_logs WHERE "tenantId" = $1 AND "createdAt" > now() - interval '5 minutes' AND (action ILIKE '%NEARBY%' OR action ILIKE '%MAP%' OR entity ILIKE '%nearby%')`,
      [f.a.tenantId],
    );
    assert(rows[0]!.n === 0, `${rows[0]!.n} audit rows`);
  });

  area('B4 outside the app — what the proxy in front sees');
  // What a platform's request log keeps is the request line. The web's own calls must not
  // carry the position there (B-3); the older GET spelling still does, by construction.
  await check('the web\'s "près de moi" calls reach the proxy as `POST /api/clients/nearby`, no position in the request line', () => {
    const posts = proxy.seen.filter((s) => s.startsWith('POST '));
    assert(posts.length === 42, `${posts.length} POST request lines seen`);
    const odd = posts.filter((s) => s !== 'POST /api/clients/nearby');
    assert(odd.length === 0, `request lines with something more: ${odd.slice(0, 3).join(' | ')}`);
    assert(!proxy.seen.some((s) => sessionNeedles.some((nd) => s.includes(nd))), 'a request line holds the session position');
  });
  record({
    name: 'the GET spelling kept for one release still puts the position in the request line (the web no longer uses it)',
    status: 'INFO',
    actual: proxy.seen.find((s) => s.startsWith('GET /api/clients/nearby')) ?? 'not seen',
  });

  writeSummary('test-35/privacy');
  await closeDb();
  if (summary().failed > 0) process.exitCode = 1;
}

main().catch(async (err) => {
  console.error(err);
  await closeDb();
  process.exit(1);
});
