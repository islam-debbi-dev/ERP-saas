/**
 * Runs every block of sql/invariants.sql against the dev database.
 * A block that returns rows is a violated invariant (FAIL).
 *
 *   pnpm --dir e2e test:db
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { query } from '../lib/db.ts';
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
  writeSummary('db-invariants');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
