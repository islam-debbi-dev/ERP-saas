/** Runs chains alone while they are written: tsx audit-02/run-chain.ts money creditChain */
import { writeSummary } from '../lib/harness.ts';
import { closeDb } from '../lib/db.ts';
const [file, ...fns] = process.argv.slice(2);
const mod = (await import(`../api/chains/${file}.ts`)) as Record<string, () => Promise<void>>;
for (const [name, fn] of Object.entries(mod)) {
  if (typeof fn !== 'function' || !name.endsWith('Chain') || (fns.length && !fns.includes(name)))
    continue;
  try {
    await fn();
  } catch (err) {
    console.error(`${name} stopped:`, err instanceof Error ? err.message : err);
  }
}
writeSummary(`chain-${file}`);
await closeDb();
process.exit(0);
