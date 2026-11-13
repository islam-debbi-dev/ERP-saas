/**
 * Shared pieces of the phase 35 browser checks: sign-in with a seeded user, the tile
 * block, geolocation mocks.
 */
import { existsSync } from 'node:fs';
import { type Browser, type BrowserContext, type Page, type TestInfo } from '@playwright/test';
import { loadFixture, type SeedUser, PASSWORD } from '../lib/map-fixture.ts';

export const WEB = process.env['WEB'] ?? 'http://localhost:3005';
export const API = process.env['API'] ?? 'http://localhost:3003';
export const fixture = loadFixture();

/** A 1×1 transparent PNG for every map tile: no test ever hits a tile server. */
const TILE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);
export const tileRequests: string[] = [];
export async function blockTiles(context: BrowserContext): Promise<void> {
  const hosts = [/tile\.openstreetmap\.org/];
  const custom = process.env['NEXT_PUBLIC_MAP_TILE_URL'];
  if (custom) hosts.push(new RegExp(new URL(custom.replace(/[{}]/g, '')).host.replace(/\./g, '\\.')));
  for (const h of hosts) {
    await context.route(h, (r) => {
      tileRequests.push(r.request().url());
      return r.fulfill({ contentType: 'image/png', body: TILE_PNG });
    });
  }
}

export const langOf = (info: TestInfo): 'ar' | 'fr' => (info.project.metadata as { lang: 'ar' | 'fr' }).lang;

export interface Position {
  latitude: number;
  longitude: number;
  accuracy?: number;
}

/**
 * A context of the project's phone, signed in through the login screen, tiles blocked.
 * `position` null = the permission is not granted (the browser refuses at once).
 */
export async function signedIn(
  browser: Browser,
  info: TestInfo,
  user: SeedUser,
  opts: { position?: Position | null; lang?: 'ar' | 'fr' | 'en'; stateFile?: string } = {},
): Promise<{ context: BrowserContext; page: Page }> {
  const u = info.project.use;
  // A session saved when the previous worker of this project ended (Playwright starts a new
  // worker after every failed test): reuse it instead of logging in again, which would run
  // into the login limiter (ten logins a minute per address).
  if (opts.stateFile && existsSync(opts.stateFile)) {
    const context = await browser.newContext({
      viewport: u.viewport,
      screen: u.screen,
      userAgent: u.userAgent,
      deviceScaleFactor: u.deviceScaleFactor,
      isMobile: u.isMobile,
      hasTouch: u.hasTouch,
      baseURL: WEB,
      storageState: opts.stateFile,
      ...(opts.position ? { geolocation: opts.position, permissions: ['geolocation'] } : {}),
    });
    await blockTiles(context);
    await context.addCookies([{ name: 'NEXT_LOCALE', value: opts.lang ?? langOf(info), url: WEB }]);
    const page = await context.newPage();
    await page.goto(`${WEB}/clients`);
    await page.waitForLoadState('networkidle');
    if (!page.url().includes('/login')) return { context, page };
    await context.close(); // the saved session is dead: sign in below
  }
  const context = await browser.newContext({
    viewport: u.viewport,
    screen: u.screen,
    userAgent: u.userAgent,
    deviceScaleFactor: u.deviceScaleFactor,
    isMobile: u.isMobile,
    hasTouch: u.hasTouch,
    baseURL: WEB,
    ...(opts.position ? { geolocation: opts.position, permissions: ['geolocation'] } : {}),
  });
  await blockTiles(context);
  await context.addCookies([{ name: 'NEXT_LOCALE', value: opts.lang ?? langOf(info), url: WEB }]);
  const page = await context.newPage();
  for (let attempt = 0; ; attempt++) {
    await page.goto(`${WEB}/login`);
    await page.locator('#identifier').fill(user.email);
    await page.locator('#password').fill(PASSWORD);
    await page.locator('form button[type="submit"]').click();
    try {
      await page.waitForURL(/\/(tableau-de-bord|vue-ensemble|tournees|ventes|clients)/, { timeout: 15_000 });
      break;
    } catch (err) {
      // The login limiter (ten a minute per address) is the usual reason.
      if (attempt >= 2) throw err;
      await page.waitForTimeout(61_000);
    }
  }
  await page.waitForLoadState('networkidle');
  return { context, page };
}

/** Opens a page of the app and waits for it to settle. */
export async function open(page: Page, path: string): Promise<void> {
  await page.goto(`${WEB}${path}`);
  await page.waitForLoadState('networkidle');
}

/** Replaces the browser geolocation with one that behaves as told. */
export async function mockGeolocation(
  context: BrowserContext,
  mode: 'never' | 'timeout-error' | { latitude: number; longitude: number; accuracy: number },
): Promise<void> {
  await context.addInitScript((m) => {
    const geo = {
      getCurrentPosition(ok: PositionCallback, ko?: PositionErrorCallback, o?: PositionOptions) {
        if (m === 'never') {
          // A real browser gives up after `timeout`: honour it, as the platform does.
          if (o?.timeout && Number.isFinite(o.timeout)) {
            setTimeout(() => ko?.({ code: 3, message: 'timeout', PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 } as GeolocationPositionError), o.timeout);
          }
          return;
        }
        if (m === 'timeout-error') {
          setTimeout(() => ko?.({ code: 3, message: 'timeout', PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 } as GeolocationPositionError), 50);
          return;
        }
        setTimeout(() => ok({ coords: { latitude: m.latitude, longitude: m.longitude, accuracy: m.accuracy, altitude: null, altitudeAccuracy: null, heading: null, speed: null, toJSON() { return this; } }, timestamp: Date.now(), toJSON() { return this; } } as GeolocationPosition), 50);
      },
      watchPosition() { return 0; },
      clearWatch() {},
    };
    Object.defineProperty(navigator, 'geolocation', { value: geo, configurable: true });
  }, mode);
}
