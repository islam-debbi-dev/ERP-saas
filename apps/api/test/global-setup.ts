import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { loadTestEnv } from './load-test-env';

/**
 * Applies pending migrations to the test database once per run.
 * Deliberately not `migrate reset`: it never deletes data. Tests don't need an empty
 * database because each one creates its own tenants, and db_test lives in memory
 * (fresh on every container start, fresh service in CI).
 */
export default function globalSetup(): void {
  const url = loadTestEnv();
  const apiDir = path.join(__dirname, '..');
  execFileSync(path.join(apiDir, 'node_modules', '.bin', 'prisma'), ['migrate', 'deploy'], {
    cwd: apiDir,
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'inherit',
  });
}
