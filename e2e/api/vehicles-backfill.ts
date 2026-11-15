/**
 * Part D of test-36: the phase 36 migration's initial driver history and the vehicle
 * backfill, on the pre-36 copy after `prisma migrate deploy` (e2e/test-36/part-d.sh).
 *
 *   DB=postgresql://erp:erp@localhost:5432/erp_t36_base pnpm exec tsx api/vehicles-backfill.ts
 *
 * Runs the repo's own CLI (`apps/api/dist/stock/vehicle-backfill.cli.js`, the runbook's
 * `db:backfill-vehicles`) twice as the app role, checks each history row of
 * `.auth/vehicles-backfill-fixture.json`, every rule of `sql/vehicles-backfill.sql`, the
 * second run's 0 / 0 and unchanged columns, then `reconcile`.
 * Writes `artifacts/test-36/part-d/backfill.{md,json}`.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DB } from '../lib/config.ts';
import { closeDb, query } from '../lib/db.ts';
import { assertT36Db } from '../lib/vehicles-fixture.ts';
import type { BackfillFixture } from './vehicles-backfill-seed.ts';

assertT36Db();
const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const fx = JSON.parse(
  readFileSync(here('../.auth/vehicles-backfill-fixture.json'), 'utf8'),
) as BackfillFixture;
if (fx.db !== DB) throw new Error(`the fixture was made on ${fx.db}, not ${DB}`);
const OUT = here('../artifacts/test-36/part-d/');
mkdirSync(OUT, { recursive: true });

type Status = 'PASS' | 'FAIL' | 'INFO';
const checks: { status: Status; name: string; detail: string }[] = [];
const check = (ok: boolean | 'info', name: string, detail: string) => {
  const status: Status = ok === 'info' ? 'INFO' : ok ? 'PASS' : 'FAIL';
  checks.push({ status, name, detail });
  console.log(`${status.padEnd(4)} ${name}\n     ${detail}`);
};

const u = new URL(DB);
const appUrl = `postgresql://erp_app:erp_app@${u.host}${u.pathname}?schema=public`;
const cli = (script: string): { out: string; ms: number } => {
  const t = performance.now();
  const out = execFileSync('node', [script], {
    cwd: here('../../apps/api/'),
    encoding: 'utf8',
    env: {
      ...process.env,
      DATABASE_URL: appUrl,
      DATABASE_URL_MIGRATE: `${DB}?schema=public`,
      LOG_LEVEL: 'warn',
      SENTRY_DSN: '',
    },
  });
  // Nest's boot lines say nothing here; keep what the CLI prints.
  const kept = out.split('\n').filter((l) => !l.includes('[Nest]') || /reconcil/i.test(l));
  return { out: kept.join('\n').trim(), ms: performance.now() - t };
};
const parse = (out: string) => ({
  visits: Number(/Visits given their truck: (\d+)/.exec(out)?.[1] ?? NaN),
  orders: Number(/delivery truck: (\d+)/.exec(out)?.[1] ?? NaN),
});
const columns = async () =>
  (
    await query<{ h: string }>(
      `SELECT md5(string_agg(x, ',' ORDER BY x)) AS h FROM (
         SELECT id::text || ':' || coalesce("vehicleId"::text, '-') AS x FROM visits
         UNION ALL SELECT id::text || ':' || coalesce("vehicleId"::text, '-') || ':' || coalesce("deliveryVehicleId"::text, '-') FROM orders) t`,
    )
  )[0]!.h;

// ---------------------------------------------------------------- the migration's own rows
const mig = await query<{ migration_name: string; finished_at: string }>(
  `SELECT migration_name, finished_at FROM _prisma_migrations ORDER BY finished_at DESC LIMIT 1`,
);
check(
  mig[0]?.migration_name === '20261114232622_vehicle_first_distribution',
  'the phase 36 migration is applied on the pre-36 copy',
  `last migration: ${mig[0]?.migration_name}`,
);
for (const e of fx.expectedAssignments) {
  const rows = await query<{
    userId: string | null;
    reason: string;
    same: boolean;
    setBy: string | null;
  }>(
    `SELECT a."userId", a.reason, a."fromAt" = w."updatedAt" AS same, a."setBy"
     FROM vehicle_assignments a JOIN warehouses w ON w.id = a."vehicleId" WHERE a."vehicleId" = $1`,
    [e.vehicleId],
  );
  check(
    rows.length === 1 &&
      rows[0]!.userId === e.userId &&
      rows[0]!.reason === 'backfill' &&
      rows[0]!.same &&
      rows[0]!.setBy === null,
    `one 'backfill' row for ${e.label}`,
    JSON.stringify(rows),
  );
}
for (const n of fx.noAssignment) {
  const rows = await query(`SELECT id FROM vehicle_assignments WHERE "vehicleId" = $1`, [
    n.vehicleId,
  ]);
  check(rows.length === 0, `no row for ${n.label}`, `${rows.length} row(s)`);
}

// ---------------------------------------------------------------- backfill, run 1
const before = await query<{ v: string; o: string }>(
  `SELECT (SELECT count(*) FROM visits WHERE "vehicleId" IS NOT NULL)::text v,
          (SELECT count(*) FROM orders WHERE "deliveryVehicleId" IS NOT NULL)::text o`,
);
check(
  before[0]!.v === '0' && before[0]!.o === '0',
  'before the backfill no visit or order has a truck',
  JSON.stringify(before[0]),
);

const script = 'dist/stock/vehicle-backfill.cli.js';
const run1 = cli(script);
const r1 = parse(run1.out);
console.log(`\n--- run 1 (${run1.ms.toFixed(0)} ms)\n${run1.out}\n`);

const expectedVisits = await query<{ n: string }>(
  `SELECT count(*)::text n FROM visits v JOIN sales s ON s.id = v."saleId" JOIN warehouses w ON w.id = s."warehouseId" WHERE w.type = 'VEHICLE'`,
);
const expectedOrders = await query<{ n: string }>(
  `SELECT count(*)::text n FROM orders o JOIN sales s ON s.id = o."saleId" JOIN warehouses w ON w.id = s."warehouseId" WHERE w.type = 'VEHICLE'`,
);
check(
  r1.visits === Number(expectedVisits[0]!.n) && r1.orders === Number(expectedOrders[0]!.n),
  'run 1 counts: every visit of a van sale, every order whose BL left a truck, nothing else',
  `CLI: visits ${r1.visits}, orders ${r1.orders}; SQL facts: visits ${expectedVisits[0]!.n}, orders ${expectedOrders[0]!.n}; ${run1.ms.toFixed(0)} ms over ${fx.tenants.length}+ tenants`,
);

for (const row of fx.rows) {
  const got =
    (
      await query<{ v: string | null }>(
        `SELECT "${row.column}"::text AS v FROM ${row.table} WHERE id = $1`,
        [row.id],
      )
    )[0]?.v ?? null;
  const guessed = row.spec === null && got !== null && got === row.todaysDriver;
  check(
    got === row.spec,
    `${row.kind}: ${row.table}.${row.column} = ${row.spec ? 'the truck of the facts' : 'null'}`,
    `${row.note}; got ${got ?? 'null'}${guessed ? " (today's driver's truck: GUESSED)" : ''}${row.facts !== row.spec ? `; a human could prove ${row.facts ?? 'null'} from the rows` : ''}`,
  );
}

// ---------------------------------------------------------------- truth SQL
const truth = readFileSync(here('../sql/vehicles-backfill.sql'), 'utf8')
  .split(/^-- rule: /m)
  .slice(1)
  .map((block) => {
    const [name, ...rest] = block.split('\n');
    return { name: name!.trim(), sql: rest.join('\n').trim().replace(/;\s*$/, '') };
  });
const truthOut: string[] = [];
for (const r of truth) {
  const rows = await query(r.sql);
  truthOut.push(
    `-- ${r.name}: ${rows.length} row(s)\n${rows.map((x) => JSON.stringify(x)).join('\n')}`,
  );
  if (r.name.startsWith('info_')) check('info', `SQL ${r.name}`, JSON.stringify(rows));
  else
    check(
      rows.length === 0,
      `SQL ${r.name}`,
      rows.length ? JSON.stringify(rows.slice(0, 3)) : 'no row',
    );
}
writeFileSync(`${OUT}backfill-truth.txt`, truthOut.join('\n\n') + '\n');

// ---------------------------------------------------------------- backfill, run 2
const hash1 = await columns();
const run2 = cli(script);
const r2 = parse(run2.out);
console.log(`\n--- run 2 (${run2.ms.toFixed(0)} ms)\n${run2.out}\n`);
check(
  r2.visits === 0 && r2.orders === 0,
  'run 2 changes 0 and 0',
  `visits ${r2.visits}, orders ${r2.orders}`,
);
check(
  hash1 === (await columns()),
  'run 2 leaves every visit / order truck column as run 1 left it',
  `md5 ${hash1}`,
);

// ---------------------------------------------------------------- reconcile
const rec = cli('dist/reconcile/reconcile.cli.js');
writeFileSync(`${OUT}reconcile.txt`, rec.out + '\n');
check(
  /no difference/i.test(rec.out),
  'reconcile after migration and backfill',
  rec.out.split('\n').slice(-2).join(' | '),
);

const pass = checks.filter((c) => c.status === 'PASS').length;
const fail = checks.filter((c) => c.status === 'FAIL').length;
const info = checks.filter((c) => c.status === 'INFO').length;
writeFileSync(
  `${OUT}backfill.json`,
  JSON.stringify(
    { db: DB, run1: { ...r1, ms: run1.ms }, run2: { ...r2, ms: run2.ms }, checks },
    null,
    2,
  ),
);
writeFileSync(
  `${OUT}backfill.md`,
  `# test-36 part D, backfill\n\n${checks.map((c) => `- **${c.status}** ${c.name}  \n  ${c.detail}`).join('\n')}\n\n${checks.length} checks · ${pass} passed · ${fail} failed · ${info} info\n`,
);
console.log(`\n${checks.length} checks · ${pass} passed · ${fail} failed · ${info} info`);
await closeDb();
