import { defineConfig, devices } from '@playwright/test';

/**
 * Test 36, part E (vehicle-first distribution in a real browser): its own projects and its
 * own companies, so the three projects of playwright.config.ts stay as they are.
 *
 *   WEB=http://localhost:3005 API=http://localhost:3003 DB=…/erp_t36 pnpm test:vehicles:web
 *
 * 360 and 393 px in `ar` (RTL) and `fr`, 1280 px in `fr`. Each project makes its own company
 * through the API (web/vehicles-data.ts) and signs in through the login screen.
 */
const phone = (width: number, height: number, locale: string) => ({
  ...devices['Pixel 5'],
  viewport: { width, height },
  screen: { width, height },
  locale,
});

export default defineConfig({
  testDir: '.',
  testMatch: /web\/vehicles\.spec\.ts$/,
  globalSetup: './vehicles-global-setup.ts',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['json', { outputFile: '../artifacts/test-36/web/results.json' }]],
  outputDir: '../test-results/vehicles',
  use: {
    baseURL: process.env['WEB'] ?? 'http://localhost:3005',
    actionTimeout: 20_000,
    navigationTimeout: 30_000,
    trace: 'off',
  },
  projects: [
    { name: 'm360-ar', use: { ...phone(360, 640, 'ar') }, metadata: { lang: 'ar' } },
    { name: 'm360-fr', use: { ...phone(360, 640, 'fr') }, metadata: { lang: 'fr' } },
    { name: 'm393-ar', use: { ...phone(393, 851, 'ar') }, metadata: { lang: 'ar' } },
    { name: 'm393-fr', use: { ...phone(393, 851, 'fr') }, metadata: { lang: 'fr' } },
    { name: 'd1280-fr', use: { viewport: { width: 1280, height: 800 }, locale: 'fr' }, metadata: { lang: 'fr' } },
  ],
});
