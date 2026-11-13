import { defineConfig, devices } from '@playwright/test';

/**
 * Test 35 (client map): its own projects, so the three projects of playwright.config.ts
 * and their global setup stay as they are.
 *
 *   WEB=http://localhost:3005 API=http://localhost:3003 pnpm test:map:web
 *
 * 360 and 393 px in `ar` (RTL) and `fr`, 1280 px in `fr`. The specs sign in themselves
 * with the users of `pnpm test:map:seed` (.auth/map-fixture.json).
 */
const phone = (width: number, height: number, locale: string) => ({
  ...devices['Pixel 5'],
  viewport: { width, height },
  screen: { width, height },
  locale,
});

export default defineConfig({
  testDir: '.',
  // One spec per part: `map.spec.ts` (part D) unless T35_MATCH names another one.
  testMatch: new RegExp(`${process.env['T35_MATCH'] ?? 'web/map'}\\.spec\\.ts$`),
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['json', { outputFile: `../artifacts/test-35/web-${process.env['T35_MATCH'] ?? 'map'}.json` }]],
  outputDir: '../test-results/map',
  use: {
    baseURL: process.env['WEB'] ?? 'http://localhost:3005',
    actionTimeout: 20_000,
    navigationTimeout: 30_000,
    trace: 'off',
  },
  metadata: {},
  projects: [
    { name: 'm360-ar', use: { ...phone(360, 640, 'ar') }, metadata: { lang: 'ar' } },
    { name: 'm360-fr', use: { ...phone(360, 640, 'fr') }, metadata: { lang: 'fr' } },
    { name: 'm393-ar', use: { ...phone(393, 851, 'ar') }, metadata: { lang: 'ar' } },
    { name: 'm393-fr', use: { ...phone(393, 851, 'fr') }, metadata: { lang: 'fr' } },
    { name: 'd1280-fr', use: { viewport: { width: 1280, height: 800 }, locale: 'fr' }, metadata: { lang: 'fr' } },
  ],
});
