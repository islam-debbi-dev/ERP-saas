import { config as loadDotenv } from 'dotenv';
import path from 'node:path';

export interface TestDbUrls {
  /** Owner of the test database: migrations, the seed, and tests that tamper with rows. */
  owner: string;
  /** The RLS-bound runtime role the app connects as, like in production. */
  app: string;
}

/** Same server and database as `owner`, logged in as erp_app (created by global-setup). */
function appUrlOf(ownerUrl: string): string {
  const url = new URL(ownerUrl);
  url.username = 'erp_app';
  url.password = 'erp_app';
  return url.toString();
}

/**
 * Integration tests always run against DATABASE_URL_TEST, never the dev database.
 * Missing it is an error, not a skip (AGENTS.md §5: never skip a test to get green).
 */
export function loadTestEnv(): TestDbUrls {
  loadDotenv({ path: path.join(__dirname, '..', '.env'), quiet: true });
  const owner = process.env['DATABASE_URL_TEST'];
  if (!owner) {
    throw new Error(
      'DATABASE_URL_TEST is not set. Start the test DB (docker compose -f infra/docker-compose.yml up -d db_test) and copy apps/api/.env.example to apps/api/.env.',
    );
  }
  return { owner, app: process.env['DATABASE_URL_TEST_APP'] ?? appUrlOf(owner) };
}
