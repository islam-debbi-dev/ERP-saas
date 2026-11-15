/**
 * Part D of test-36: which API version works on which schema during the phase 36 deploy.
 * Sends the reads every screen makes, as the owner of the backfill fixture, to the API on
 * :3003 and prints the status of each (500 = that version cannot run on this schema).
 *
 *   LABEL="new API, pre-36 schema" API=http://localhost:3003 pnpm exec tsx test-36/api-schema-probe.ts
 *
 * Appends to `artifacts/test-36/part-d/api-schema-probe.txt`.
 */
import { appendFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const API = process.env['API'] ?? 'http://localhost:3003';
const LABEL = process.env['LABEL'] ?? API;
const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const fx = JSON.parse(readFileSync(here('../.auth/vehicles-backfill-fixture.json'), 'utf8')) as {
  ownerToken: string;
  trucks: Record<string, string>;
};

const paths = [
  '/clients?limit=5',
  '/products?limit=5',
  '/warehouses',
  `/warehouses/${fx.trucks['T1']}`,
  '/routes',
  '/me/today',
  '/orders?limit=5',
  '/visits?limit=5',
  '/sales?limit=5',
  '/stock/movements?limit=5',
  '/dashboard',
];
const lines = [`## ${LABEL} (${new Date().toISOString()})`];
let fives = 0;
for (const p of paths) {
  const res = await fetch(`${API}${p}`, { headers: { authorization: `Bearer ${fx.ownerToken}` } });
  const body = await res.text();
  if (res.status >= 500) fives += 1;
  lines.push(
    `${String(res.status).padEnd(4)} GET ${p}${res.status >= 400 ? `  ${body.slice(0, 140)}` : ''}`,
  );
}
lines.push(`${paths.length} reads, ${fives} answered 5xx`, '');
appendFileSync(here('../artifacts/test-36/part-d/api-schema-probe.txt'), lines.join('\n') + '\n');
console.log(lines.join('\n'));
