/**
 * Audit 02, part B.1: tenant isolation on every route.
 *
 * Input: the two recordings of record.ts (the same chains run on two disjoint sets of
 * companies) and the route list read from the controllers (audit-02/routes.ts).
 *
 * 1. Replay. Every request that succeeded in world 2 is sent again by the same user, with
 *    ONE id replaced by the id world 1 had at the same place: in the path (read, update,
 *    delete of a foreign row), in the query string, or anywhere in the body (a foreign key).
 *    The body is valid by construction, so validation cannot hide the answer.
 * 2. Brute force. Every route with an id in its path that the chains never call is called by
 *    a world 2 owner with one id of each table of world 1.
 * 3. Proof. No answer may be a 5xx or carry a row of world 1; a fingerprint of every row of
 *    world 1 is taken before and after; no foreign key in the database may join two tenants.
 *
 *   tsx api/security/record.ts && tsx api/security/isolation.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { area, assert, check, record, writeSummary } from '../../lib/harness.ts';
import { idemKey, request, type Recorded } from '../../lib/http.ts';
import { assertAuditDb, OUT } from '../../lib/audit.ts';
import { closeDb, query } from '../../lib/db.ts';
import { readRoutes } from '../../audit-02/routes.ts';
import { foreignKeyChecks } from './isolation-fk.ts';

assertAuditDb();
const RECORDING = fileURLToPath(new URL('../../.auth/audit02-recording.json', import.meta.url));
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
const isUuid = (v: unknown): v is string =>
  typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v);
const tenantOf = (token: string | null): string | null => {
  if (!token) return null;
  try {
    return (JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString()) as { tid?: string }).tid ?? null;
  } catch {
    return null;
  }
};
const template = (path: string): string => path.replace(/\?.*/, '').replace(UUID, ':id');

type World = Record<string, Recorded[]>;
const [w1, w2] = JSON.parse(readFileSync(RECORDING, 'utf8')) as [World, World];
const tenantRequests = (w: World, chain: string): Recorded[] =>
  (w[chain] ?? []).filter((r) => tenantOf(r.token) && !r.path.startsWith('/admin'));
const tenantsOf = (w: World): string[] => [
  ...new Set(Object.values(w).flat().map((r) => tenantOf(r.token)).filter((t): t is string => !!t)),
];
const T1 = tenantsOf(w1);
const T2 = tenantsOf(w2);

// ------------------------------------------------------------------ what world 1 owns

const tables = (
  await query<{ table_name: string; has_id: boolean }>(
    `SELECT c.table_name,
            EXISTS (SELECT 1 FROM information_schema.columns i
                     WHERE i.table_schema = 'public' AND i.table_name = c.table_name
                       AND i.column_name = 'id' AND i.data_type = 'uuid') AS has_id
       FROM information_schema.columns c
      WHERE c.table_schema = 'public' AND c.column_name = 'tenantId' ORDER BY 1`,
  )
).map((r) => ({ name: r.table_name, hasId: r.has_id }));

const owned = new Map<string, string>(); // id → table
const sampleByTable = new Map<string, string>();
for (const t of tables.filter((x) => x.hasId)) {
  const rows = await query<{ id: string }>(
    `SELECT id::text FROM "${t.name}" WHERE "tenantId" = ANY($1::uuid[])`,
    [T1],
  );
  for (const r of rows) owned.set(r.id, t.name);
  if (rows[0]) sampleByTable.set(t.name, rows[0].id);
}
for (const t of T1) owned.set(t, 'tenants');

async function fingerprint(): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const t of tables) {
    const [row] = await query<{ n: string; h: string | null }>(
      `SELECT COUNT(*)::text AS n, md5(COALESCE(string_agg(md5(x::text), '' ORDER BY md5(x::text)), '')) AS h
         FROM "${t.name}" x WHERE "tenantId" = ANY($1::uuid[])`,
      [T1],
    );
    out[t.name] = `${row!.n}:${row!.h}`;
  }
  return out;
}

// ------------------------------------------------------------------ probes

interface Probe {
  kind: 'path' | 'query' | 'body' | 'brute';
  route: string;
  where: string;
  table: string;
  status: number;
  code: string;
  leaked: string[];
  verdict: 'refused' | 'empty' | 'state-first' | 'LEAK' | 'ACCEPTED' | 'ERROR-5xx';
  sample: string;
}
const probes: Probe[] = [];

const REFUSED = /NOT_FOUND|FORBIDDEN|UNKNOWN|INVALID_|NOT_ALLOWED|OUT_OF_REACH|NO_ACCESS|NOT_IN_/;
/** `VALIDATION_FAILED "Unknown client"`: the id was looked up in the caller's tenant and not found. */
const UNKNOWN = /"message":"Unknown /;

async function probe(
  kind: Probe['kind'],
  r: Pick<Recorded, 'method' | 'path' | 'body' | 'token' | 'idempotent'>,
  where: string,
  injected: string,
): Promise<Probe> {
  const res = await request(r.path, {
    method: r.method as 'GET',
    token: r.token,
    ...(r.body !== undefined && r.method !== 'GET' ? { body: r.body } : {}),
    ...(r.idempotent ? { idempotencyKey: idemKey('iso') } : {}),
    raw: true,
  });
  const code = /"code":"([A-Z_0-9]+)"/.exec(res.raw)?.[1] ?? '';
  // Ids of world 1 in the answer, other than the one we sent (an error may echo it).
  const leaked = [...new Set(res.raw.match(UUID) ?? [])].filter((u) => owned.has(u) && u !== injected);
  let verdict: Probe['verdict'];
  if (res.status >= 500) verdict = 'ERROR-5xx';
  else if (leaked.length > 0) verdict = 'LEAK';
  else if (res.status === 404 || res.status === 403 || (res.status >= 400 && (REFUSED.test(code) || UNKNOWN.test(res.raw)))) verdict = 'refused';
  else if (res.status >= 400) verdict = 'state-first';
  else if (r.method === 'GET') verdict = 'empty';
  else verdict = 'ACCEPTED';
  const p: Probe = {
    kind,
    route: `${r.method} ${template(r.path)}`,
    where,
    table: owned.get(injected) ?? '?',
    status: res.status,
    code,
    leaked: leaked.map((u) => `${owned.get(u)}:${u}`).slice(0, 5),
    verdict,
    sample: res.raw.slice(0, 300),
  };
  probes.push(p);
  return p;
}

/** Every place of a JSON body that holds a uuid: [path, value]. */
function leaves(v: unknown, path = ''): [string, string][] {
  if (isUuid(v)) return [[path, v]];
  if (Array.isArray(v)) return v.flatMap((x, i) => leaves(x, `${path}[${i}]`));
  if (v && typeof v === 'object')
    return Object.entries(v).flatMap(([k, x]) => leaves(x, path ? `${path}.${k}` : k));
  return [];
}
function setLeaf(body: unknown, path: string, value: string): unknown {
  const clone = structuredClone(body) as Record<string, unknown>;
  const keys = path.replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean);
  let cur: Record<string, unknown> = clone;
  for (const k of keys.slice(0, -1)) cur = cur[k] as Record<string, unknown>;
  cur[keys.at(-1)!] = value;
  return clone;
}

const fpBefore = await fingerprint();

// ------------------------------------------------------------------ 1. replay
area('B1. Tenant isolation: replay of valid requests with one foreign id');
const done = new Set<string>();
let misaligned = 0;
for (const chain of Object.keys(w2)) {
  const a = tenantRequests(w1, chain);
  const b = tenantRequests(w2, chain);
  for (let i = 0; i < b.length; i += 1) {
    const r1 = a[i];
    const r2 = b[i]!;
    if (!r1 || r1.method !== r2.method || template(r1.path) !== template(r2.path)) {
      misaligned += 1;
      continue;
    }
    if (r2.status >= 400) continue;
    const [p1, q1 = ''] = r1.path.split('?');
    const [p2, q2 = ''] = r2.path.split('?');
    // Path ids.
    const ids1 = p1!.match(UUID) ?? [];
    const ids2 = p2!.match(UUID) ?? [];
    for (let k = 0; k < ids2.length; k += 1) {
      const foreign = ids1[k]!;
      const key = `${r2.method} ${template(r2.path)} path#${k}`;
      if (!owned.has(foreign) || foreign === ids2[k] || done.has(key)) continue;
      done.add(key);
      let n = -1;
      const path = p2!.replace(UUID, (m) => ((n += 1) === k ? foreign : m)) + (q2 ? `?${q2}` : '');
      await probe('path', { ...r2, path }, `path#${k}`, foreign);
    }
    // Query string.
    const qs1 = new URLSearchParams(q1);
    const qs2 = new URLSearchParams(q2);
    for (const [name, v2] of qs2) {
      const foreign = qs1.get(name);
      const key = `${r2.method} ${template(r2.path)} ?${name}`;
      if (!foreign || !isUuid(v2) || !owned.has(foreign) || foreign === v2 || done.has(key)) continue;
      done.add(key);
      const qs = new URLSearchParams(q2);
      qs.set(name, foreign);
      await probe('query', { ...r2, path: `${p2}?${qs.toString()}` }, `?${name}`, foreign);
    }
    // Body leaves.
    if (r2.body !== undefined && r2.method !== 'GET') {
      const l1 = new Map(leaves(r1.body));
      for (const [where, v2] of leaves(r2.body)) {
        const foreign = l1.get(where);
        const key = `${r2.method} ${template(r2.path)} body.${where.replace(/\[\d+\]/g, '[]')}`;
        if (!foreign || !owned.has(foreign) || foreign === v2 || done.has(key)) continue;
        done.add(key);
        await probe('body', { ...r2, body: setLeaf(r2.body, where, foreign) }, `body.${where}`, foreign);
      }
    }
  }
}

// ------------------------------------------------------------------ 2. brute force
area('B1. Tenant isolation: routes the chains do not call');
const routes = readRoutes().filter((r) => !r.path.startsWith('/admin'));
const withId = routes.filter((r) => /:(id|productId|purchaseId|costId|ruleId)\b/.test(r.path));
const replayed = new Set(probes.filter((p) => p.kind === 'path').map((p) => p.route));
const norm = (p: string): string => p.replace(/:(productId|purchaseId|costId|ruleId)\b/g, ':id');
const owner2 = w2['core']!.find((r) => tenantOf(r.token) && r.path === '/units')!.token;
const brute = withId.filter((r) => !replayed.has(`${r.verb} ${norm(r.path)}`));
const TYPE: Record<string, string> = { ':type': 'BL', ':name': 'sales', ':code': 'x', ':token': 'x' };
const bruteRoute = new Map<string, string>();
for (const r of brute) {
  for (const [, id] of sampleByTable) {
    const path = r.path
      .replace(/:(id|productId|purchaseId|costId|ruleId)\b/g, id)
      .replace(/:(type|name|code|token)\b/g, (m) => TYPE[m]!);
    bruteRoute.set(`${r.verb} ${template(path)}`, `${r.verb} ${norm(r.path)}`);
    await probe(
      'brute',
      {
        method: r.verb,
        path,
        body: r.verb === 'GET' || r.verb === 'DELETE' ? undefined : {},
        token: owner2,
        idempotent: r.verb !== 'GET',
      },
      'path',
      id,
    );
  }
}

for (const p of probes) if (p.kind === 'brute') p.route = bruteRoute.get(p.route) ?? p.route;

// ------------------------------------------------------------------ 2b. foreign keys on fresh drafts
area('B1. Tenant isolation: a foreign key in the body of a fresh draft');
await foreignKeyChecks((table) => {
  const id = sampleByTable.get(table);
  if (!id) throw new Error(`world 1 has no row in ${table}`);
  return id;
});

// ------------------------------------------------------------------ 3. verdict
const fpAfter = await fingerprint();
const by = (v: Probe['verdict']): Probe[] => probes.filter((p) => p.verdict === v);
const replayProbes = probes.filter((p) => p.kind !== 'brute');
const routesReplayed = new Set(replayProbes.map((p) => p.route));
const routesBrute = new Set(probes.filter((p) => p.kind === 'brute').map((p) => p.route));

area('B1. Tenant isolation: verdict');
await check('no probe is answered with a row of the other tenant', () => {
  const l = by('LEAK');
  assert(l.length === 0, `${l.length} leak(s): ${[...new Set(l.map((p) => `${p.route} ${p.where} → ${p.leaked[0]}`))].slice(0, 12).join(' ; ')}`);
});
await check('no write with a foreign id is accepted', () => {
  const l = by('ACCEPTED');
  assert(l.length === 0, `${l.length} accepted: ${[...new Set(l.map((p) => `${p.route} ${p.where} (${p.table}) → ${p.status}`))].slice(0, 20).join(' ; ')}`);
});
await check('no probe answers 5xx', () => {
  const l = by('ERROR-5xx');
  assert(l.length === 0, `${l.length} 5xx: ${[...new Set(l.map((p) => `${p.route} ${p.where} (${p.table})`))].slice(0, 12).join(' ; ')}`);
});
await check('every row of world 1 is unchanged after the sweep (fingerprint of each tenant table)', () => {
  const changed = Object.keys(fpBefore).filter((t) => fpBefore[t] !== fpAfter[t]);
  assert(changed.length === 0, `changed: ${changed.map((t) => `${t} ${fpBefore[t]!.split(':')[0]}→${fpAfter[t]!.split(':')[0]}`).join(', ')}`);
});
await check('no foreign key of the database joins two tenants', async () => {
  const fks = await query<{ child: string; col: string; parent: string }>(
    `SELECT c.conrelid::regclass::text AS child, a.attname AS col, c.confrelid::regclass::text AS parent
       FROM pg_constraint c
       JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
      WHERE c.contype = 'f' AND array_length(c.conkey, 1) = 1
        AND EXISTS (SELECT 1 FROM pg_attribute x WHERE x.attrelid = c.conrelid AND x.attname = 'tenantId')
        AND EXISTS (SELECT 1 FROM pg_attribute x WHERE x.attrelid = c.confrelid AND x.attname = 'tenantId')`,
  );
  const bad: string[] = [];
  for (const f of fks) {
    const [row] = await query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM ${f.child} ch JOIN ${f.parent} pa ON pa.id = ch."${f.col}" WHERE ch."tenantId" <> pa."tenantId"`,
    );
    if (row!.n !== '0') bad.push(`${f.child}.${f.col} → ${f.parent}: ${row!.n}`);
  }
  record({ name: `foreign keys between tenant tables checked: ${fks.length}`, status: 'INFO' });
  assert(bad.length === 0, bad.join(' ; '));
});

const count = (list: Probe[]): Record<string, number> =>
  list.reduce<Record<string, number>>((acc, p) => ((acc[p.verdict] = (acc[p.verdict] ?? 0) + 1), acc), {});
const allIdRoutes = withId.map((r) => `${r.verb} ${norm(r.path)}`);
const neverProbed = allIdRoutes.filter((r) => !routesReplayed.has(r) && !routesBrute.has(r));
record({
  name: `replay: ${replayProbes.length} probes on ${routesReplayed.size} routes (${JSON.stringify(count(replayProbes))}); ${misaligned} recorded requests not aligned`,
  status: 'INFO',
});
record({
  name: `brute force: ${probes.length - replayProbes.length} probes on ${routesBrute.size} routes (${JSON.stringify(count(probes.filter((p) => p.kind === 'brute')))})`,
  status: 'INFO',
});
record({
  name: `routes with an id in the path: ${withId.length}; replayed with a valid body: ${withId.filter((r) => routesReplayed.has(`${r.verb} ${norm(r.path)}`)).length}; brute force only: ${routesBrute.size}; not covered: ${neverProbed.length} ${neverProbed.join(', ')}`,
  status: 'INFO',
});

// A write route reached only by brute force with an empty body proves little when the
// body is validated first: list them, they are the honest limit of this sweep.
const bruteWrites = [...routesBrute].filter((r) => !r.startsWith('GET'));
const stateFirst = [...new Set(by('state-first').filter((p) => p.kind !== 'brute').map((p) => `${p.route} ${p.where} → ${p.status} ${p.code}`))];
writeFileSync(
  `${OUT}isolation-detail.json`,
  // Every replay probe; the 7 000 brute-force probes as counts per route and answer.
  JSON.stringify(
    {
      worlds: { T1, T2 },
      tables: tables.length,
      ownedIds: owned.size,
      probes: replayProbes,
      brute: Object.fromEntries(
        [...routesBrute].sort().map((r) => [
          r,
          probes
            .filter((p) => p.kind === 'brute' && p.route === r)
            .reduce<Record<string, number>>((acc, p) => ((acc[`${p.status} ${p.code} ${p.verdict}`] = (acc[`${p.status} ${p.code} ${p.verdict}`] ?? 0) + 1), acc), {}),
        ]),
      ),
    },
    null,
    1,
  ),
);
writeFileSync(
  `${OUT}isolation-coverage.md`,
  [
    '# Tenant isolation: coverage',
    '',
    `World 1: ${T1.length} companies, ${owned.size} rows with an id in ${tables.length} tenant tables. World 2: ${T2.length} companies.`,
    '',
    `## Replayed with a valid request and one foreign id (${routesReplayed.size} routes, ${replayProbes.length} probes)`,
    '',
    ...[...new Set(replayProbes.map((p) => `- \`${p.route}\` ${p.where.replace(/\[\d+\]/g, '[]')} (${p.table}) → ${p.status} ${p.code} **${p.verdict}**`))].sort(),
    '',
    `## Answered by a state or validation check before the foreign id was looked at (${stateFirst.length})`,
    '',
    ...stateFirst.map((s) => `- ${s}`),
    '',
    `## Write routes reached only by brute force with an empty body (${bruteWrites.length})`,
    '',
    'The route answered 4xx to one id of each table of world 1 and no row of world 1 changed; where the body is validated before the id is read, this does not prove the lookup itself.',
    '',
    ...bruteWrites.sort().map((r) => {
      const ps = probes.filter((p) => p.kind === 'brute' && p.route === r);
      const st = [...new Set(ps.map((p) => `${p.status} ${p.code}`))].join(', ');
      return `- \`${r}\` → ${st}`;
    }),
    '',
    `## GET routes reached by brute force (${[...routesBrute].filter((r) => r.startsWith('GET')).length})`,
    '',
    ...[...routesBrute].filter((r) => r.startsWith('GET')).sort().map((r) => {
      const ps = probes.filter((p) => p.kind === 'brute' && p.route === r);
      return `- \`${r}\` → ${[...new Set(ps.map((p) => `${p.status} ${p.code}`))].join(', ')}`;
    }),
    '',
    `## Not covered (${neverProbed.length})`,
    '',
    ...neverProbed.map((r) => `- \`${r}\``),
  ].join('\n'),
);
writeSummary('isolation');
await closeDb();
process.exit(0);
