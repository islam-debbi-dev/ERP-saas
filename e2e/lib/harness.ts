import { writeFileSync, mkdirSync } from 'node:fs';
import { ARTIFACTS } from './config.ts';

export type Status = 'PASS' | 'FAIL' | 'BLOCKED' | 'INFO';

export interface CheckResult {
  area: string;
  name: string;
  status: Status;
  expected?: string;
  actual?: string;
  evidence?: string;
  durationMs: number;
}

const results: CheckResult[] = [];
let currentArea = 'general';

export function area(name: string): void {
  currentArea = name;
  console.log(`\n=== ${name} ===`);
}

export function record(r: Omit<CheckResult, 'area' | 'durationMs'> & { durationMs?: number }): void {
  const entry: CheckResult = { area: currentArea, durationMs: 0, ...r };
  results.push(entry);
  const mark = entry.status === 'PASS' ? '✓' : entry.status === 'FAIL' ? '✗' : entry.status === 'BLOCKED' ? '⊘' : '·';
  console.log(`  ${mark} ${entry.status.padEnd(7)} ${entry.name}`);
  if (entry.status === 'FAIL') {
    if (entry.expected !== undefined) console.log(`      expected: ${entry.expected}`);
    if (entry.actual !== undefined) console.log(`      actual:   ${entry.actual}`);
    if (entry.evidence) console.log(`      evidence: ${entry.evidence}`);
  }
}

/** Runs a check; a thrown error is a FAIL with the error message as evidence. */
export async function check(
  name: string,
  fn: () => Promise<void> | void,
  meta: { expected?: string; actual?: string; evidence?: string } = {},
): Promise<boolean> {
  const started = Date.now();
  try {
    await fn();
    record({ name, status: 'PASS', durationMs: Date.now() - started, ...meta });
    return true;
  } catch (err) {
    record({
      name,
      status: 'FAIL',
      durationMs: Date.now() - started,
      evidence: meta.evidence ?? (err instanceof Error ? err.message : String(err)),
      expected: meta.expected,
      actual: meta.actual,
    });
    return false;
  }
}

export function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

export function assertEqual(actual: unknown, expected: unknown, what: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${what}: expected ${e}, got ${a}`);
}

export function summary(): { total: number; passed: number; failed: number; blocked: number; info: number } {
  const t = { total: results.length, passed: 0, failed: 0, blocked: 0, info: 0 };
  for (const r of results) {
    if (r.status === 'PASS') t.passed++;
    else if (r.status === 'FAIL') t.failed++;
    else if (r.status === 'BLOCKED') t.blocked++;
    else t.info++;
  }
  return t;
}

/**
 * `AUDIT_RUN=audit-02` sends the summaries to artifacts/audit-02/, so a later audit does
 * not overwrite the proofs of an earlier one.
 */
const RUN_DIR = process.env['AUDIT_RUN'] ? `${ARTIFACTS}${process.env['AUDIT_RUN']}/` : ARTIFACTS;

export function writeSummary(file: string): void {
  mkdirSync(RUN_DIR, { recursive: true });
  const t = summary();
  writeFileSync(`${RUN_DIR}${file}.json`, JSON.stringify({ totals: t, results }, null, 2));
  const lines = [
    `# ${file}`,
    '',
    `Total ${t.total} · PASS ${t.passed} · FAIL ${t.failed} · BLOCKED ${t.blocked}`,
    '',
    '| Area | Check | Result | Expected | Actual |',
    '|---|---|---|---|---|',
    ...results.map(
      (r) =>
        `| ${r.area} | ${r.name} | ${r.status} | ${r.expected ?? ''} | ${(r.actual ?? r.evidence ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ')} |`,
    ),
  ];
  writeFileSync(`${RUN_DIR}${file}.md`, lines.join('\n'));
  console.log(`\n${file}: ${t.total} checks · ${t.passed} passed · ${t.failed} failed · ${t.blocked} blocked`);
  if (t.failed > 0) {
    console.log('\nFailures:');
    for (const r of results.filter((x) => x.status === 'FAIL')) {
      console.log(`  - [${r.area}] ${r.name}: ${r.evidence ?? ''}`);
    }
  }
}
