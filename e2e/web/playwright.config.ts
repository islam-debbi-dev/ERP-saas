import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';

/**
 * The web audit runs against a real browser (chromium) and a real API.
 * Override the targets with WEB and API when the ports differ.
 *
 * Three projects:
 * - `desktop`: the behaviour checks of web.spec.ts at 1280 px;
 * - `mobile`: the phone checks of mobile.spec.ts on a Pixel 5 (393 × 851);
 * - `mobile-360`: the same phone checks on the smallest phone we support.
 * locations.spec.ts (phase 40a) and zones.spec.ts (phase 40b) run in all three.
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
  projects: [
    {
      name: 'desktop',
      testMatch: /(web|locations|zones)\.spec\.ts/,
      use: { viewport: { width: 1280, height: 800 } },
    },
    {
      name: 'mobile',
      testMatch: /(mobile|locations|zones)\.spec\.ts/,
      use: { ...devices['Pixel 5'] },
    },
    {
      name: 'mobile-360',
      testMatch: /(mobile|locations|zones)\.spec\.ts/,
      use: {
        ...devices['Pixel 5'],
        viewport: { width: 360, height: 640 },
        screen: { width: 360, height: 640 },
      },
    },
  ],
});
