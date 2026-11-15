/**
 * Part D of test-36: how long the phase 36 migration holds its locks on live tables.
 *
 *   DB=postgresql://erp:erp@localhost:5432/erp_t36_base pnpm exec tsx api/vehicles-migration-lock.ts
 *
 * Runs `20261114232622_vehicle_first_distribution/migration.sql` statement by statement
 * inside ONE transaction, as the owner role, on the pre-36 database with its 50 000 visits /
 * orders, then ROLLS BACK (the real apply is `prisma migrate deploy`, next step of part-d.sh).
 * One transaction is what Prisma does: it sends the file as one multi-statement query, which
 * PostgreSQL runs as one implicit transaction, so every lock is held until the end.
 *
 * Reports: the time of each statement, the lock modes held at the end on warehouses /
 * routes / visits / orders, and what a second connection (the running API) meets meanwhile:
 * a read and an insert on visits, each with a 300 ms lock_timeout.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { DB } from '../lib/config.ts';
import { assertT36Db } from '../lib/vehicles-fixture.ts';

assertT36Db();
const file = fileURLToPath(
  new URL(
    '../../apps/api/prisma/migrations/20261114232622_vehicle_first_distribution/migration.sql',
    import.meta.url,
  ),
);
const sql = readFileSync(file, 'utf8');

/** Splits on `;` at the end of a line, keeping the `$$ … $$` function body whole. */
function statements(text: string): string[] {
  const out: string[] = [];
  let buf = '';
  let inDollar = false;
  for (const line of text.split('\n')) {
    if (line.trim().startsWith('--') && buf.trim() === '') continue;
    buf += line + '\n';
    if ((line.match(/\$\$/g) ?? []).length % 2 === 1) inDollar = !inDollar;
    if (!inDollar && line.trimEnd().endsWith(';')) {
      out.push(buf.trim());
      buf = '';
    }
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

const mig = new pg.Client({ connectionString: DB });
const probe = new pg.Client({ connectionString: DB });
await mig.connect();
await probe.connect();

const sizes = await mig.query<{ t: string; n: string }>(
  `SELECT 'visits' t, count(*)::text n FROM visits UNION ALL SELECT 'orders', count(*)::text FROM orders
   UNION ALL SELECT 'routes', count(*)::text FROM routes UNION ALL SELECT 'warehouses', count(*)::text FROM warehouses`,
);
console.log('rows:', sizes.rows.map((r) => `${r.t} ${r.n}`).join(', '));

const list = statements(sql);
const timings: { ms: number; stmt: string }[] = [];
await mig.query('BEGIN');
const t0 = performance.now();
for (const s of list) {
  const t = performance.now();
  await mig.query(s);
  timings.push({ ms: performance.now() - t, stmt: s.replace(/\s+/g, ' ').slice(0, 110) });
}
const total = performance.now() - t0;

const pid = (await mig.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid;
const locks = await probe.query<{ rel: string; mode: string }>(
  `SELECT c.relname AS rel, l.mode FROM pg_locks l JOIN pg_class c ON c.oid = l.relation
   WHERE l.pid = $1 AND c.relname IN ('warehouses','routes','visits','orders') AND l.granted
   ORDER BY 1, 2`,
  [pid],
);
const tryProbe = async (what: string, q: string): Promise<string> => {
  await probe.query("SET lock_timeout = '300ms'");
  const t = performance.now();
  try {
    await probe.query('BEGIN');
    await probe.query(q);
    await probe.query('ROLLBACK');
    return `${what}: passed in ${(performance.now() - t).toFixed(0)} ms`;
  } catch (e) {
    await probe.query('ROLLBACK').catch(() => undefined);
    return `${what}: BLOCKED (${(e as Error).message}) after ${(performance.now() - t).toFixed(0)} ms`;
  }
};
const probes = [
  await tryProbe('read on visits while the migration is open', 'SELECT id FROM visits LIMIT 1'),
  await tryProbe(
    'insert on visits while the migration is open',
    `INSERT INTO visits (id, "tenantId", "sellerId", "clientId", "startedAt", outcome, reason)
     SELECT gen_random_uuid(), "tenantId", "sellerId", "clientId", now(), outcome, reason FROM visits LIMIT 1`,
  ),
];
await mig.query('ROLLBACK');
const still = await mig.query<{ n: string }>(
  `SELECT count(*)::text n FROM information_schema.tables WHERE table_name = 'vehicle_assignments'`,
);

console.log(
  `\n${list.length} statements, one transaction, ${total.toFixed(0)} ms in all (then rolled back).`,
);
console.log('\nslowest statements:');
for (const t of [...timings].sort((a, b) => b.ms - a.ms).slice(0, 10)) {
  console.log(`  ${t.ms.toFixed(1).padStart(8)} ms  ${t.stmt}`);
}
console.log('\nlocks held at the end, until COMMIT:');
for (const l of locks.rows) console.log(`  ${l.rel.padEnd(11)} ${l.mode}`);
console.log('\nwhat the running API meets meanwhile:');
for (const p of probes) console.log(`  ${p}`);
console.log(`\nrolled back: vehicle_assignments exists = ${still.rows[0]!.n !== '0'}`);
await mig.end();
await probe.end();
