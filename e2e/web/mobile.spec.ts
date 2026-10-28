/**
 * Phone checks (docs/ui.md): every screen of the web app, in Arabic (RTL) and
 * French, at the width of the project (393 px on `mobile`, 360 px on
 * `mobile-360`). Each screen must not scroll sideways, and a screenshot is
 * saved in e2e/artifacts/mobile/ for review.
 *
 * The routes are read from the app folders, not typed by hand, so a new page
 * is checked without touching this file. Dynamic segments get a real id from
 * the tenant of the global setup.
 */
import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeSale, today, uniq, type Fixture } from '../api/fixture.ts';
import { call, idemKey } from '../lib/http.ts';
import { expectNoHorizontalOverflow } from './mobile-helpers.ts';

const WEB = process.env['WEB'] ?? 'http://localhost:3005';
const PASSWORD = 'Audit1234!';
const APP_DIR = fileURLToPath(new URL('../../apps/web/src/app/', import.meta.url));
const FIXTURE_FILE = fileURLToPath(new URL('../.auth/fixture.json', import.meta.url));
const SHOTS_DIR = fileURLToPath(new URL('../artifacts/mobile/', import.meta.url));
const LOCALES = ['ar', 'fr'] as const;

/** Route groups whose pages need a session; the others are opened anonymous. */
const AUTH_GROUP = '(auth)';
/** Pages of the auth group that belong to a signed-in user. */
const SIGNED_IN_AUTH_PAGES = new Set(['/mot-de-passe']);

interface Route {
  /** The path with its dynamic segments, e.g. `/clients/[id]`. */
  pattern: string;
  anonymous: boolean;
}

/** Every `page.tsx` under (app) and (auth), as a URL pattern. */
function listRoutes(): Route[] {
  const routes: Route[] = [];
  for (const group of ['(app)', AUTH_GROUP]) {
    const walk = (dir: string, segments: string[]): void => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full, [...segments, entry]);
        else if (entry === 'page.tsx') {
          const pattern = `/${segments.join('/')}`;
          routes.push({
            pattern,
            anonymous: group === AUTH_GROUP && !SIGNED_IN_AUTH_PAGES.has(pattern),
          });
        }
      }
    };
    walk(join(APP_DIR, group), []);
  }
  return routes.sort((a, b) => a.pattern.localeCompare(b.pattern));
}

const ROUTES = listRoutes();

/** Ids for the dynamic segments, created once per project through the API. */
interface Ids {
  clientId: string;
  productId: string;
  saleId: string;
  purchaseId: string;
  inventoryId: string;
}

let ids: Ids | null = null;

function fixture(): Fixture {
  return JSON.parse(readFileSync(FIXTURE_FILE, 'utf8')) as Fixture;
}

async function prepareIds(f: Fixture): Promise<Ids> {
  const token = f.session.token;
  const client = (
    await call<{ id: string }>('/clients', {
      method: 'POST',
      token,
      idempotencyKey: idemKey('cli'),
      // A long name: it must truncate, never push the balance off the screen.
      body: { code: uniq('M-'), name: 'Établissements Benali et fils — Alimentation générale', type: 'PARTICULIER' },
    })
  ).body;
  const sale = await makeSale(f, { qty: '3', clientId: client.id });
  const supplier = (
    await call<{ id: string }>('/suppliers', {
      method: 'POST',
      token,
      idempotencyKey: idemKey('sup'),
      body: { name: 'Fournisseur mobile' },
    })
  ).body;
  const purchase = (
    await call<{ id: string }>('/purchases', {
      method: 'POST',
      token,
      idempotencyKey: idemKey('pur'),
      body: {
        supplierId: supplier.id,
        documentDate: today(),
        lines: [{ productId: f.productId, unitId: f.baseUnitId, qty: '5', unitCost: '480' }],
      },
    })
  ).body;
  const inventory = (
    await call<{ id: string }>('/inventories', {
      method: 'POST',
      token,
      idempotencyKey: idemKey('inv'),
      body: { note: 'mobile count' },
    })
  ).body;
  return {
    clientId: client.id,
    productId: f.productId,
    saleId: sale.id,
    purchaseId: purchase.id,
    inventoryId: inventory.id,
  };
}

function resolve(pattern: string, v: Ids): string {
  return pattern
    .replace('/achats/[id]', `/achats/${v.purchaseId}`)
    .replace('/clients/[id]', `/clients/${v.clientId}`)
    .replace('/produits/[id]', `/produits/${v.productId}`)
    .replace('/stock/inventaires/[id]', `/stock/inventaires/${v.inventoryId}`)
    .replace('/stock/[productId]', `/stock/${v.productId}`)
    .replace('/ventes/[id]', `/ventes/${v.saleId}`)
    // An unknown invitation: the page shows its "invalid link" state.
    .replace('/invitation/[token]', '/invitation/not-a-real-token');
}

/** One login per project (web.spec.ts logs out at its end, so it is not shared). */
async function signIn(page: Page, email: string): Promise<void> {
  await page.goto(`${WEB}/login`);
  await page.locator('#identifier').fill(email);
  await page.locator('#password').fill(PASSWORD);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL(/\/tableau-de-bord/);
  await page.waitForLoadState('networkidle');
}

test.beforeAll(async () => {
  mkdirSync(SHOTS_DIR, { recursive: true });
  ids = await prepareIds(fixture());
});

async function settle(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => document.fonts.ready);
  // The first paint of the client components after their data arrived.
  await page.waitForTimeout(150);
}

function shotName(pattern: string, locale: string, width: number): string {
  const slug =
    pattern
      .replace(/^\//, '')
      .replace(/\[(\w+)\]/g, '$1')
      .replace(/\//g, '-') || 'root';
  return `${slug}-${locale}-${width}.png`;
}

interface Result {
  route: string;
  locale: string;
  width: number;
  problems: string[];
}
/** What each screen of one test found, for BASELINE.md (a file per test: a failed test restarts the worker). */
function saveResults(project: string, name: string, results: Result[]): void {
  writeFileSync(join(SHOTS_DIR, `results-${project}-${name}.json`), `${JSON.stringify(results, null, 2)}\n`, 'utf8');
}

/** Screenshot + overflow check, soft so one broken screen does not hide the next ones. */
async function check(page: Page, pattern: string, locale: string, results: Result[]): Promise<void> {
  await expect.soft(page.locator('html')).toHaveAttribute('lang', locale);
  const width = page.viewportSize()?.width ?? 0;
  await page.screenshot({ path: join(SHOTS_DIR, shotName(pattern, locale, width)), fullPage: true });
  const problems = await expectNoHorizontalOverflow(page, { soft: true });
  results.push({ route: pattern, locale, width, problems });
}

for (const locale of LOCALES) {
  // One page for every signed-in screen: they are opened the way a user does,
  // through the app router, so the session is refreshed once and not on every
  // screen (the API limits /auth/refresh per minute).
  test(`every signed-in screen fits the phone (${locale})`, async ({ browser }, info) => {
    test.setTimeout(10 * 60_000);
    const v = ids;
    if (!v) throw new Error('ids not prepared');
    const results: Result[] = [];
    const context = await browser.newContext({
      ...info.project.use,
      storageState: { cookies: [], origins: [] },
    });
    try {
      await context.addCookies([{ name: 'NEXT_LOCALE', value: locale, url: WEB }]);
      const page = await context.newPage();
      await signIn(page, fixture().session.email);
      for (const route of ROUTES.filter((r) => !r.anonymous)) {
        await test.step(route.pattern, async () => {
          const path = resolve(route.pattern, v);
          await page.evaluate((to) => {
            (window as unknown as { next: { router: { push(href: string): void } } }).next.router.push(to);
          }, path);
          await page.waitForURL((url) => url.pathname === path);
          await settle(page);
          await check(page, route.pattern, locale, results);
        });
      }
    } finally {
      saveResults(info.project.name, `signed-in-${locale}`, results);
      await context.close();
    }
  });

  test(`every public screen fits the phone (${locale})`, async ({ browser }, info) => {
    const v = ids;
    if (!v) throw new Error('ids not prepared');
    const results: Result[] = [];
    for (const route of ROUTES.filter((r) => r.anonymous)) {
      await test.step(route.pattern, async () => {
        const context = await browser.newContext({
          ...info.project.use,
          storageState: { cookies: [], origins: [] },
        });
        try {
          await context.addCookies([{ name: 'NEXT_LOCALE', value: locale, url: WEB }]);
          const page = await context.newPage();
          const path = resolve(route.pattern, v);
          await page.goto(`${WEB}${path}`);
          await settle(page);
          expect.soft(new URL(page.url()).pathname).toBe(path);
          await check(page, route.pattern, locale, results);
        } finally {
          await context.close();
        }
      });
    }
    saveResults(info.project.name, `public-${locale}`, results);
  });
}

// The route list, so BASELINE.md names every screen.
test.afterAll(async ({}, info) => {
  writeFileSync(
    join(SHOTS_DIR, `routes-${info.project.name}.txt`),
    `${ROUTES.map((r) => r.pattern).join('\n')}\n`,
    'utf8',
  );
});
