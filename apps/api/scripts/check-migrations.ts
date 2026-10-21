/**
 * Fails CI on a migration that could break the version still running during a deploy
 * (AGENTS.md §7: expand → migrate → contract). A destructive statement is allowed only
 * when the line right above it says why:
 *
 *   -- destructive-ok: column unused since release 2026-11 (contract step)
 *   ALTER TABLE "products" DROP COLUMN "oldName";
 *
 * Usage: pnpm --filter @erp/api db:check-migrations [migrations dir]
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

export interface Finding {
  line: number;
  rule: string;
  statement: string;
}

const MARKER = /^--\s*destructive-ok:\s*\S/i;

const RULES: { rule: string; test: (sql: string) => boolean }[] = [
  { rule: 'drop', test: (s) => /\bDROP\s+(TABLE|COLUMN|SCHEMA|TYPE|VIEW)\b/i.test(s) },
  {
    // ALTER TABLE … DROP "col" (COLUMN is optional in Postgres).
    rule: 'drop',
    test: (s) =>
      /^ALTER\s+TABLE\b/i.test(s) && /\bDROP\s+(?!CONSTRAINT|DEFAULT|NOT\b|INDEX)"?\w/i.test(s),
  },
  { rule: 'rename', test: (s) => /\bRENAME\b/i.test(s) },
  { rule: 'change-type', test: (s) => /\bALTER\s+COLUMN\b[^;]*\b(SET\s+DATA\s+)?TYPE\b/i.test(s) },
  { rule: 'set-not-null', test: (s) => /\bSET\s+NOT\s+NULL\b/i.test(s) },
  { rule: 'delete-data', test: (s) => /^(TRUNCATE|DELETE\s+FROM)\b/i.test(s) },
  {
    // The running version inserts without the new column: it needs a default.
    rule: 'add-required-column',
    test: (s) =>
      /\bADD\s+COLUMN\b[^,;]*\bNOT\s+NULL\b/i.test(s) &&
      !/\bADD\s+COLUMN\b[^,;]*\bDEFAULT\b/i.test(s),
  },
];

/** Splits on `;` outside quotes and $$ bodies; keeps each statement's first line number. */
function statements(sql: string): { text: string; line: number; marked: boolean }[] {
  const out: { text: string; line: number; marked: boolean }[] = [];
  const lines = sql.split('\n');
  let buf: string[] = [];
  let start = -1;
  let marked = false;
  let pendingMarker = false;
  let inDollar = false;
  lines.forEach((raw, i) => {
    const trimmed = raw.trim();
    if (start === -1) {
      if (trimmed === '') {
        pendingMarker = false;
        return;
      }
      if (trimmed.startsWith('--')) {
        pendingMarker = MARKER.test(trimmed);
        return;
      }
      start = i + 1;
      marked = pendingMarker;
      pendingMarker = false;
    }
    const code = raw.replace(/--.*$/, '');
    buf.push(code);
    if ((code.match(/\$\$/g) ?? []).length % 2 === 1) inDollar = !inDollar;
    if (!inDollar && /;\s*$/.test(code)) {
      out.push({ text: buf.join(' ').replace(/\s+/g, ' ').trim(), line: start, marked });
      buf = [];
      start = -1;
    }
  });
  if (buf.length > 0)
    out.push({ text: buf.join(' ').replace(/\s+/g, ' ').trim(), line: start, marked });
  return out;
}

export function findDestructive(sql: string): Finding[] {
  const findings: Finding[] = [];
  for (const st of statements(sql)) {
    if (st.marked) continue;
    // Function bodies (triggers) are code, not schema changes.
    const text = st.text.replace(/\$\$[\s\S]*?\$\$/g, '$$$$');
    const hit = RULES.find((r) => r.test(text));
    if (hit) findings.push({ line: st.line, rule: hit.rule, statement: st.text.slice(0, 160) });
  }
  return findings;
}

function main(): void {
  const dir = path.resolve(process.argv[2] ?? path.join(__dirname, '..', 'prisma', 'migrations'));
  let failed = 0;
  for (const name of readdirSync(dir).sort()) {
    const file = path.join(dir, name, 'migration.sql');
    let sql: string;
    try {
      sql = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    for (const f of findDestructive(sql)) {
      failed++;
      console.error(`${name}/migration.sql:${f.line} [${f.rule}] ${f.statement}`);
    }
  }
  if (failed > 0) {
    console.error(
      `\n${failed} destructive statement(s). Split into expand/contract releases, or add\n` +
        `"-- destructive-ok: <reason>" on the line above each one (AGENTS.md §7).`,
    );
    process.exit(1);
  }
  console.log('Migrations are backward compatible.');
}

if (require.main === module) main();
