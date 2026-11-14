/**
 * Audit 02, part B: records every request of the business chains, so the isolation and
 * input sweeps replay real, valid requests instead of hand-written ones.
 *
 * The chains run twice, on two disjoint sets of companies ("world 1" and "world 2"). The two
 * recordings have the same shape, request for request, which lets a sweep take a request
 * of world 2 and put one id of world 1 in it.
 *
 *   tsx api/security/record.ts        → e2e/.auth/audit02-recording.json (tokens: git-ignored)
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { recorder, type Recorded } from '../../lib/http.ts';
import { assertAuditDb } from '../../lib/audit.ts';
import { closeDb } from '../../lib/db.ts';
import { importChain } from '../chains/import.ts';
import { depotsChain } from '../chains/depots.ts';
import { chargesChain, creditChain, treasuryChain } from '../chains/money.ts';
import { payrollChain, primesChain } from '../chains/people.ts';
import { coreChain } from './core-chain.ts';

assertAuditDb();
export const RECORDING = fileURLToPath(new URL('../../.auth/audit02-recording.json', import.meta.url));

const chains: [string, () => Promise<void>][] = [
  ['core', coreChain],
  ['import', importChain],
  ['depots', depotsChain],
  ['credit', creditChain],
  ['charges', chargesChain],
  ['treasury', treasuryChain],
  ['primes', primesChain],
  ['payroll', payrollChain],
];

const worlds: Record<string, Recorded[]>[] = [];
for (const world of [1, 2]) {
  const byChain: Record<string, Recorded[]> = {};
  for (const [name, fn] of chains) {
    const list: Recorded[] = [];
    recorder.sink = (r) => list.push(r);
    try {
      await fn();
    } catch (err) {
      console.error(`world ${world}, ${name} stopped:`, err instanceof Error ? err.message : err);
    }
    recorder.sink = null;
    byChain[name] = list;
    console.log(`world ${world} ${name}: ${list.length} requests`);
  }
  worlds.push(byChain);
}
mkdirSync(fileURLToPath(new URL('../../.auth/', import.meta.url)), { recursive: true });
writeFileSync(RECORDING, JSON.stringify(worlds));
await closeDb();
process.exit(0);
