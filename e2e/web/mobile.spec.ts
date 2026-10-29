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
import { totp } from '../lib/totp.ts';
import { expectNoHorizontalOverflow } from './mobile-helpers.ts';

const WEB = process.env['WEB'] ?? 'http://localhost:3005';
const PASSWORD = 'Audit1234!';
const APP_DIR = fileURLToPath(new URL('../../apps/web/src/app/', import.meta.url));
const FIXTURE_FILE = fileURLToPath(new URL('../.auth/fixture.json', import.meta.url));
const ADMIN_FILE = fileURLToPath(new URL('../.auth/admin.json', import.meta.url));
const SHOTS_DIR = fileURLToPath(new URL('../artifacts/mobile/', import.meta.url));
const LOCALES = ['ar', 'fr'] as const;
const MESSAGES_DIR = fileURLToPath(new URL('../../apps/web/src/messages/', import.meta.url));

/** The UI labels of a locale, so the checks click what a user reads. */
function messages(locale: string): Record<string, Record<string, string>> {
  return JSON.parse(readFileSync(join(MESSAGES_DIR, `${locale}.json`), 'utf8')) as Record<
    string,
    Record<string, string>
  >;
}

/** The element is fully on screen, without scrolling sideways (docs/ui.md: main action visible). */
async function expectOnScreen(page: Page, selector: string): Promise<void> {
  const box = await page.locator(selector).first().boundingBox();
  const vp = page.viewportSize();
  expect.soft(box, `${selector} is rendered`).not.toBeNull();
  if (!box || !vp) return;
  expect.soft(box.x >= 0 && box.x + box.width <= vp.width, `${selector} fits the width`).toBe(true);
  expect.soft(box.y >= 0 && box.y + box.height <= vp.height, `${selector} is above the fold`).toBe(true);
}

/** Route groups whose pages need a session; the others are opened anonymous. */
const AUTH_GROUP = '(auth)';
/** The super-admin area: its own login, checked by its own test. */
const ADMIN_GROUP = '(admin)';
/** Pages of the auth group that belong to a signed-in user. */
const SIGNED_IN_AUTH_PAGES = new Set(['/mot-de-passe']);

interface Route {
  /** The path with its dynamic segments, e.g. `/clients/[id]`. */
  pattern: string;
  anonymous: boolean;
  admin: boolean;
}

/** Every `page.tsx` under (app), (auth) and (admin), as a URL pattern. */
function listRoutes(): Route[] {
  const routes: Route[] = [];
  for (const group of ['(app)', AUTH_GROUP, ADMIN_GROUP]) {
    const walk = (dir: string, segments: string[]): void => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full, [...segments, entry]);
        else if (entry === 'page.tsx') {
          const pattern = `/${segments.join('/')}`;
          routes.push({
            pattern,
            anonymous:
              (group === AUTH_GROUP && !SIGNED_IN_AUTH_PAGES.has(pattern)) ||
              pattern === '/admin/login',
            admin: group === ADMIN_GROUP && pattern !== '/admin/login',
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
  supplierId: string;
  inventoryId: string;
  productReference: string;
  tenantId: string;
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
  const product = (await call<{ reference: string }>(`/products/${f.productId}`, { token })).body;
  return {
    productReference: product.reference,
    clientId: client.id,
    productId: f.productId,
    saleId: sale.id,
    purchaseId: purchase.id,
    supplierId: supplier.id,
    inventoryId: inventory.id,
    tenantId: f.tenantId,
  };
}

function resolve(pattern: string, v: Ids): string {
  return pattern
    .replace('/achats/fournisseurs/[id]', `/achats/fournisseurs/${v.supplierId}`)
    .replace('/achats/[id]', `/achats/${v.purchaseId}`)
    .replace('/clients/[id]', `/clients/${v.clientId}`)
    .replace('/produits/[id]', `/produits/${v.productId}`)
    .replace('/stock/inventaires/[id]', `/stock/inventaires/${v.inventoryId}`)
    .replace('/stock/[productId]', `/stock/${v.productId}`)
    .replace('/ventes/[id]', `/ventes/${v.saleId}`)
    .replace('/admin/societes/[id]', `/admin/societes/${v.tenantId}`)
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
  await page.locator('h1').first().waitFor();
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
async function check(
  page: Page,
  pattern: string,
  locale: string,
  results: Result[],
  opts: { fullPage?: boolean } = {},
): Promise<void> {
  await expect.soft(page.locator('html')).toHaveAttribute('lang', locale);
  const width = page.viewportSize()?.width ?? 0;
  await page.screenshot({ path: join(SHOTS_DIR, shotName(pattern, locale, width)), fullPage: opts.fullPage ?? true });
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
      for (const route of ROUTES.filter((r) => !r.anonymous && !r.admin)) {
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

      const m = messages(locale);
      await test.step('new versement opens as a sheet with its save button on screen', async () => {
        const path = resolve('/clients/[id]', v);
        await page.evaluate((to) => {
          (window as unknown as { next: { router: { push(href: string): void } } }).next.router.push(to);
        }, path);
        await page.waitForURL((url) => url.pathname === path);
        await settle(page);
        await page.getByRole('button', { name: m['clients']?.['newPayment'] }).click();
        await page.locator('#pay-amount').waitFor();
        await page.waitForTimeout(400); // the sheet slides in
        await expectOnScreen(page, '[role="dialog"] button[type="submit"]');
        await check(page, '/clients/[id]/versement', locale, results, { fullPage: false });
        await page.keyboard.press('Escape');
      });

      await test.step('new règlement fournisseur opens as a sheet with its save button on screen', async () => {
        const path = resolve('/achats/fournisseurs/[id]', v);
        await page.evaluate((to) => {
          (window as unknown as { next: { router: { push(href: string): void } } }).next.router.push(to);
        }, path);
        await page.waitForURL((url) => url.pathname === path);
        await settle(page);
        await page.getByRole('button', { name: m['supplierAccount']?.['newPayment'] }).click();
        await page.locator('#rgf-amount').waitFor();
        await page.waitForTimeout(400); // the sheet slides in
        await expectOnScreen(page, '[role="dialog"] button[type="submit"]');
        await check(page, '/achats/fournisseurs/[id]/reglement', locale, results, { fullPage: false });
        await page.keyboard.press('Escape');
      });

      await test.step('share link of the relevé: the link and the WhatsApp button on screen', async () => {
        const path = resolve('/clients/[id]', v);
        await page.evaluate((to) => {
          (window as unknown as { next: { router: { push(href: string): void } } }).next.router.push(to);
        }, path);
        await page.waitForURL((url) => url.pathname === path);
        await settle(page);
        await page.getByRole('button', { name: m['share']?.['button'] }).click();
        await page.locator('#share-url').waitFor();
        await page.waitForTimeout(400);
        await expectOnScreen(page, '[role="dialog"] a[href^="https://wa.me/"]');
        await check(page, '/clients/[id]/partage', locale, results, { fullPage: false });
        await page.keyboard.press('Escape');
      });

      await test.step('dashboard: the onboarding checklist fits', async () => {
        const path = '/tableau-de-bord';
        await page.evaluate((to) => {
          (window as unknown as { next: { router: { push(href: string): void } } }).next.router.push(to);
        }, path);
        await page.waitForURL((url) => url.pathname === path);
        await settle(page);
        await page.locator('[data-testid="onboarding-card"]').waitFor();
        await check(page, '/tableau-de-bord/onboarding', locale, results);
      });

      await test.step('fast sale: a line, then the total and the validate button on screen', async () => {
        const path = '/ventes/nouvelle';
        await page.evaluate((to) => {
          (window as unknown as { next: { router: { push(href: string): void } } }).next.router.push(to);
        }, path);
        await page.waitForURL((url) => url.pathname === path);
        await settle(page);
        await page.locator('#scan').fill(v.productReference);
        await page.locator('#scan').press('Enter');
        // The line of the fixture product, as a card on a phone.
        await page.getByText('Audit product').first().waitFor();
        await page.locator('#scan').blur();
        await settle(page);
        await expectOnScreen(page, '[data-slot="sticky-actions"] button:not([disabled])');
        await check(page, '/ventes/nouvelle/ligne', locale, results, { fullPage: false });
      });
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

for (const locale of LOCALES) {
  // The super-admin area: password + TOTP once, then every admin screen through the
  // router (one admin session, so its refresh token is rotated once).
  test(`every admin screen fits the phone (${locale})`, async ({ browser }, info) => {
    const v = ids;
    if (!v) throw new Error('ids not prepared');
    const admin = JSON.parse(readFileSync(ADMIN_FILE, 'utf8')) as {
      email: string;
      password: string;
      secret: string;
    };
    const m = messages(locale);
    const results: Result[] = [];
    const context = await browser.newContext({
      ...info.project.use,
      storageState: { cookies: [], origins: [] },
    });
    try {
      await context.addCookies([{ name: 'NEXT_LOCALE', value: locale, url: WEB }]);
      const page = await context.newPage();
      await page.goto(`${WEB}/admin/login`);
      await page.locator('#admin-email').fill(admin.email);
      await page.locator('#admin-password').fill(admin.password);
      await page.locator('button[type="submit"]').click();
      await page.locator('#admin-code').fill(totp(admin.secret));
      await settle(page);
      await check(page, '/admin/login/code', locale, results);
      await page.locator('button[type="submit"]').click();
      await page.waitForURL((url) => url.pathname === '/admin');
      for (const route of ROUTES.filter((r) => r.admin)) {
        await test.step(route.pattern, async () => {
          const path = resolve(route.pattern, v);
          await page.evaluate((to) => {
            (window as unknown as { next: { router: { push(href: string): void } } }).next.router.push(to);
          }, path);
          await page.waitForURL((url) => url.pathname === path);
          await settle(page);
          await page.locator('[aria-busy]').first().waitFor({ state: 'detached' });
          await check(page, route.pattern, locale, results);
        });
      }
      await test.step('record payment opens as a sheet with its button on screen', async () => {
        await page.getByRole('button', { name: m['admin']?.['recordPayment'] }).first().click();
        await page.locator('#pay-amount').waitFor();
        await page.waitForTimeout(400); // the sheet slides in
        await expectOnScreen(page, '[role="dialog"] button[type="submit"]');
        await check(page, '/admin/societes/[id]/paiement', locale, results, { fullPage: false });
        await page.keyboard.press('Escape');
      });
    } finally {
      saveResults(info.project.name, `admin-${locale}`, results);
      await context.close();
    }
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
