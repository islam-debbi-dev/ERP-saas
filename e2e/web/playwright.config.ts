import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';

/**
 * The web audit runs against a real browser (chromium) and a real API.
 * Override the targets with WEB and API when the ports differ.
 */
const stateFile = fileURLToPath(new URL('../.auth/state.json', import.meta.url));

export default defineConfig({
  testDir: '.',
  testMatch: /.*\.spec\.ts/,
  globalSetup: './global-setup.ts',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  // The checks share one API and one database: run them one after the other.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['json', { outputFile: '../artifacts/web.json' }]],
  use: {
    baseURL: process.env['WEB'] ?? 'http://localhost:3005',
    actionTimeout: 20_000,
    navigationTimeout: 30_000,
    trace: 'retain-on-failure',
    // The tenant and the session are prepared once by the global setup.
    storageState: stateFile,
  },
});
