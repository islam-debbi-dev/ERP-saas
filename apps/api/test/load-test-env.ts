import { config as loadDotenv } from 'dotenv';
import path from 'node:path';

/**
 * Integration tests always run against DATABASE_URL_TEST, never the dev database.
 * Missing it is an error, not a skip (AGENTS.md §5: never skip a test to get green).
 */
export function loadTestEnv(): string {
  loadDotenv({ path: path.join(__dirname, '..', '.env'), quiet: true });
  const url = process.env['DATABASE_URL_TEST'];
  if (!url) {
    throw new Error(
      'DATABASE_URL_TEST is not set. Start the test DB (docker compose -f infra/docker-compose.yml up -d db_test) and copy apps/api/.env.example to apps/api/.env.',
    );
  }
  return url;
}
