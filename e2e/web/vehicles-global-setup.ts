/**
 * Test 36, part E: one run id per `playwright test`, so every project makes its companies
 * once and a worker restarted after a failed test finds them again (vehicles-data.ts).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { assertT36Db } from '../lib/vehicles-fixture.ts';
import { RUN_FILE } from './vehicles-data.ts';

export default function globalSetup(): void {
  assertT36Db();
  mkdirSync(fileURLToPath(new URL('../.auth/', import.meta.url)), { recursive: true });
  mkdirSync(fileURLToPath(new URL('../artifacts/test-36/web/', import.meta.url)), { recursive: true });
  writeFileSync(RUN_FILE, JSON.stringify({ run: Date.now().toString(36) }));
}
