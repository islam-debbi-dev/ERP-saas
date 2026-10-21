import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { loadTestEnv } from './load-test-env';

/**
 * Applies pending migrations to the test database once per run, then makes sure the
 * runtime role erp_app exists with its grants, so the suite runs under RLS like
 * production does.
 * Deliberately not `migrate reset`: it never deletes data. Tests don't need an empty
 * database because each one creates its own tenants, and db_test lives in memory
 * (fresh on every container start, fresh service in CI).
 */
export default async function globalSetup(): Promise<void> {
  const urls = loadTestEnv();
  const apiDir = path.join(__dirname, '..');
  execFileSync(path.join(apiDir, 'node_modules', '.bin', 'prisma'), ['migrate', 'deploy'], {
    cwd: apiDir,
    env: { ...process.env, DATABASE_URL: urls.owner, DATABASE_URL_MIGRATE: urls.owner },
    stdio: 'inherit',
  });

  const app = new URL(urls.app);
  const owner = new pg.Client({ connectionString: urls.owner });
  await owner.connect();
  try {
    const exists = await owner.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [app.username]);
    if (exists.rowCount === 0) {
      const password = decodeURIComponent(app.password).replaceAll("'", "''");
      await owner.query(`CREATE ROLE erp_app LOGIN PASSWORD '${password}'`);
    }
    await owner.query(readFileSync(path.join(apiDir, 'prisma', 'app-role.sql'), 'utf8'));
  } finally {
    await owner.end();
  }
}
