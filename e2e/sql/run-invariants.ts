/**
 * Runs every block of sql/invariants.sql against the dev database.
 * A block that returns rows is a violated invariant (FAIL).
 *
 *   pnpm --dir e2e test:db
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { db, query } from '../lib/db.ts';
import { area, check, writeSummary } from '../lib/harness.ts';

const SQL_FILE = fileURLToPath(new URL('./invariants.sql', import.meta.url));

function parseBlocks(sql: string): { name: string; sql: string }[] {
  const blocks: { name: string; sql: string }[] = [];
  const lines = sql.split('\n');
  let current: { name: string; sql: string[] } | null = null;
  for (const line of lines) {
    const m = /^--\s*name:\s*(\S+)/.exec(line);
    if (m) {
      if (current) blocks.push({ name: current.name, sql: current.sql.join('\n') });
      current = { name: m[1]!, sql: [] };
      continue;
    }
    if (current) current.sql.push(line);
  }
  if (current) blocks.push({ name: current.name, sql: current.sql.join('\n') });
  return blocks;
}

/** The ledgers whose rows must be impossible to rewrite (AGENTS.md 3.1). */
const LEDGERS = [
  'stock_movements',
  'client_ledger_entries',
  'supplier_ledger_entries',
  'employee_ledger_entries',
  'cash_movements',
  'leave_entries',
  'client_packaging_entries',
  'audit_logs',
  'attendance_events',
];

/**
 * Tries, for real, to UPDATE and to DELETE one row of every ledger, as the database owner
 * (the strongest role the app ever uses), inside a transaction that is rolled back. The
 * statement must be refused: the trigger is what proves no existing row was rewritten.
 */
async function appendOnlyProbes(): Promise<void> {
  area('append-only ledgers (live probe, rolled back)');
  for (const table of LEDGERS) {
    for (const verb of ['UPDATE', 'DELETE'] as const) {
      await check(`${table}: ${verb} of an existing row is refused`, async () => {
        const client = await db().connect();
        try {
          await client.query('BEGIN');
          const row = await client.query(`SELECT ctid::text AS ctid FROM ${table} LIMIT 1`);
          if (row.rowCount === 0) throw new Error(`${table} is empty: run the scenario first`);
          const where = `WHERE ctid = '${row.rows[0].ctid as string}'::tid`;
          const sql =
            verb === 'UPDATE' ? `UPDATE ${table} SET id = id ${where}` : `DELETE FROM ${table} ${where}`;
          const outcome = await client.query(sql).then(
            (r) => `accepted (${r.rowCount} row)`,
            (err: Error) => `refused: ${err.message}`,
          );
          if (!outcome.startsWith('refused')) throw new Error(`${verb} on ${table} was ${outcome}`);
        } finally {
          await client.query('ROLLBACK').catch(() => undefined);
          client.release();
        }
      });
    }
  }
}

async function main(): Promise<void> {
  const blocks = parseBlocks(readFileSync(SQL_FILE, 'utf8'));
  area('database invariants');
  console.log(`Running ${blocks.length} invariant checks against ${process.env['DB'] ?? 'the dev DB'}\n`);
  for (const block of blocks) {
    await check(block.name, async () => {
      const rows = await query(block.sql);
      if (rows.length > 0) {
        throw new Error(`${rows.length} violation(s): ${JSON.stringify(rows.slice(0, 5))}`);
      }
    });
  }
  await appendOnlyProbes();
  writeSummary('db-invariants');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
