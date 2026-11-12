/**
 * Test 35, part E: what the phase 35 migration does to a live `clients` table.
 *
 *   DB=postgresql://erp:erp@localhost:5432/erp_t35_perf pnpm test:map:lock
 *
 * The migration is `CREATE INDEX "clients_tenant_geo_idx" …`, not `CONCURRENTLY`: while it
 * builds, Postgres holds a SHARE lock on the table, which lets reads through and makes every
 * INSERT / UPDATE / DELETE wait. This script measures that wait on the performance database
 * (145 000 clients; and on a 50 000-row copy): one connection writes a client every few
 * milliseconds and times each write, another drops and recreates the index with the exact
 * statement of the migration. Then the same with CONCURRENTLY, for comparison.
 * Local only. It leaves the index as the migration made it.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { DB } from '../lib/config.ts';
import { area, assert, check, record, summary, writeSummary } from '../lib/harness.ts';
import { assertAuditDb, proof, sleep } from '../lib/map-fixture.ts';

assertAuditDb();
if (!new URL(DB).pathname.startsWith('/erp_t35_perf')) throw new Error('part E runs on erp_t35_perf only');

const MIGRATION = fileURLToPath(new URL('../../apps/api/prisma/migrations/20261110140000_clients_geo_index/migration.sql', import.meta.url));
const createSql = readFileSync(MIGRATION, 'utf8').split('\n').filter((l) => !l.trim().startsWith('--')).join('\n').trim().replace(/;$/, '');

interface Run {
  buildMs: number;
  writes: number;
  worstWriteMs: number;
  writesOver100: number;
  worstReadMs: number;
  lockModes: string[];
}

async function measure(table: string, sql: string, dropSql: string): Promise<Run> {
  const writer = new pg.Client({ connectionString: DB });
  const reader = new pg.Client({ connectionString: DB });
  const ddl = new pg.Client({ connectionString: DB });
  const spy = new pg.Client({ connectionString: DB });
  await Promise.all([writer.connect(), reader.connect(), ddl.connect(), spy.connect()]);
  const ids = (await writer.query<{ id: string }>(`SELECT id FROM ${table} LIMIT 200`)).rows.map((r) => r.id);
  let on = true;
  const writeMs: number[] = [];
  const readMs: number[] = [];
  const modes = new Set<string>();
  const writing = (async () => {
    for (let i = 0; on; i++) {
      const t = performance.now();
      // What the app does all day: a client row changes (a seller saves a point, a balance moves).
      await writer.query(`UPDATE ${table} SET "updatedAt" = now() WHERE id = $1`, [ids[i % ids.length]]);
      writeMs.push(performance.now() - t);
      await sleep(3);
    }
  })();
  const reading = (async () => {
    while (on) {
      const t = performance.now();
      await reader.query(`SELECT count(*) FROM ${table} WHERE id = $1`, [ids[0]]);
      readMs.push(performance.now() - t);
      await sleep(3);
    }
  })();
  const spying = (async () => {
    while (on) {
      const r = await spy.query<{ mode: string }>(`SELECT DISTINCT mode FROM pg_locks WHERE relation = $1::regclass AND granted AND pid <> pg_backend_pid()`, [table]);
      r.rows.forEach((x) => modes.add(x.mode));
      await sleep(5);
    }
  })();
  await sleep(300);
  await ddl.query(dropSql);
  writeMs.length = 0;
  readMs.length = 0;
  modes.clear();
  const t0 = performance.now();
  await ddl.query(sql);
  const buildMs = performance.now() - t0;
  await sleep(150);
  on = false;
  await Promise.all([writing, reading, spying]);
  await Promise.all([writer.end(), reader.end(), ddl.end(), spy.end()]);
  return {
    buildMs: Math.round(buildMs),
    writes: writeMs.length,
    worstWriteMs: Math.round(Math.max(...writeMs)),
    writesOver100: writeMs.filter((m) => m > 100).length,
    worstReadMs: Math.round(Math.max(...readMs)),
    lockModes: [...modes].sort(),
  };
}

async function main(): Promise<void> {
  const c = new pg.Client({ connectionString: DB });
  await c.connect();
  const total = (await c.query<{ n: number; indexed: number }>(`SELECT count(*)::int AS n, count(*) FILTER (WHERE "deletedAt" IS NULL AND lat IS NOT NULL)::int AS indexed FROM clients`)).rows[0]!;
  // A 50 000-row copy (the big tenant), with the same columns: the size the prompt asks about.
  await c.query(`DROP TABLE IF EXISTS t35_clients_50k`);
  await c.query(`CREATE TABLE t35_clients_50k AS SELECT * FROM clients WHERE "tenantId" = (SELECT "tenantId" FROM clients GROUP BY 1 ORDER BY count(*) DESC LIMIT 1)`);
  await c.query(`ALTER TABLE t35_clients_50k ADD PRIMARY KEY (id)`);
  const copy = (await c.query<{ n: number }>(`SELECT count(*)::int AS n FROM t35_clients_50k`)).rows[0]!.n;

  const onCopy = (s: string): string => s.replace('"clients_tenant_geo_idx"', '"t35_geo_50k"').replace('ON "clients"', 'ON t35_clients_50k');
  const runs: Record<string, Run[]> = { plain50k: [], plain145k: [], concurrently145k: [] };
  for (let i = 0; i < 3; i++) {
    runs['plain50k']!.push(await measure('t35_clients_50k', onCopy(createSql), 'DROP INDEX IF EXISTS "t35_geo_50k"'));
    runs['plain145k']!.push(await measure('clients', createSql, 'DROP INDEX IF EXISTS "clients_tenant_geo_idx"'));
    runs['concurrently145k']!.push(await measure('clients', createSql.replace('CREATE INDEX', 'CREATE INDEX CONCURRENTLY'), 'DROP INDEX IF EXISTS "clients_tenant_geo_idx"'));
  }
  // Leave the database as the migration leaves it.
  await c.query('DROP INDEX IF EXISTS "clients_tenant_geo_idx"');
  await c.query(createSql);
  await c.query('DROP TABLE t35_clients_50k');
  const def = (await c.query<{ indexdef: string }>(`SELECT indexdef FROM pg_indexes WHERE indexname = 'clients_tenant_geo_idx'`)).rows[0]?.indexdef;
  await c.end();

  const med = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
  const line = (label: string, rs: Run[]): string =>
    `| ${label} | ${rs.map((r) => r.buildMs).join(', ')} | ${rs.map((r) => r.worstWriteMs).join(', ')} | ${rs.map((r) => r.worstReadMs).join(', ')} | ${[...new Set(rs.flatMap((r) => r.lockModes))].join(', ')} |`;
  const md = [
    '# Part E — the migration on a live table',
    '',
    `Statement of the migration: \`${createSql.replace(/\s+/g, ' ')}\``,
    '',
    `Local PostgreSQL 16, ${total.n} rows in \`clients\` (${total.indexed} in the partial index), and a copy of ${copy} rows. A writer updates one client every 3 ms and a reader reads one; three runs each.`,
    '',
    '| Case | Index build (ms) | Worst client write during the build (ms) | Worst read (ms) | Lock modes seen on the table |',
    '|---|---|---|---|---|',
    line(`CREATE INDEX, ${copy} rows`, runs['plain50k']!),
    line(`CREATE INDEX, ${total.n} rows`, runs['plain145k']!),
    line(`CREATE INDEX CONCURRENTLY, ${total.n} rows`, runs['concurrently145k']!),
    '',
  ].join('\n');
  proof('migration-lock.md', md);
  console.log(md);

  area('E1 the index migration on a live clients table');
  const p50 = runs['plain50k']!;
  const p145 = runs['plain145k']!;
  const cc = runs['concurrently145k']!;
  await check('the plain CREATE INDEX takes a SHARE lock: writes wait for the whole build, reads do not', () => {
    assert(p145.some((r) => r.lockModes.includes('ShareLock')), `lock modes seen: ${p145.flatMap((r) => r.lockModes).join(', ')}`);
    assert(med(p145.map((r) => r.worstWriteMs)) >= med(p145.map((r) => r.buildMs)) * 0.5, 'a write did not wait for the build: the measure is wrong');
    assert(med(p145.map((r) => r.worstReadMs)) < 50, `reads waited ${med(p145.map((r) => r.worstReadMs))} ms`);
  });
  await check('on 50 000 rows the writes are blocked for less than one second', () => {
    assert(med(p50.map((r) => r.worstWriteMs)) < 1000, `worst write ${p50.map((r) => r.worstWriteMs).join(', ')} ms`);
  }, { actual: `build ${med(p50.map((r) => r.buildMs))} ms, worst write ${med(p50.map((r) => r.worstWriteMs))} ms (medians of 3)` });
  record({ name: `on ${total.n} rows`, status: 'INFO', actual: `build ${med(p145.map((r) => r.buildMs))} ms, worst write ${med(p145.map((r) => r.worstWriteMs))} ms` });
  record({ name: 'with CONCURRENTLY, for comparison', status: 'INFO', actual: `build ${med(cc.map((r) => r.buildMs))} ms, worst write ${med(cc.map((r) => r.worstWriteMs))} ms, lock modes ${[...new Set(cc.flatMap((r) => r.lockModes))].join(', ')}` });
  await check('the index is back exactly as the migration made it', () => {
    assert(!!def && def.includes('"tenantId", lat, lng') && def.includes('"deletedAt" IS NULL') && def.includes('lat IS NOT NULL'), `indexdef: ${def}`);
  });
  writeSummary('test-35/migration-lock');
  if (summary().failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
