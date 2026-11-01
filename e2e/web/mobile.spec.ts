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
  expect
    .soft(box.y >= 0 && box.y + box.height <= vp.height, `${selector} is above the fold`)
    .toBe(true);
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
  transferId: string;
  routeId: string;
  orderId: string;
  planId: string;
  draftPlanId: string;
  runId: string;
  importFileId: string;
  /** A dépôt (SECONDARY) for its page (phase 24, MULTI_UNIT). */
  warehouseId: string;
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
      body: {
        code: uniq('M-'),
        name: 'Établissements Benali et fils — Alimentation générale',
        type: 'PARTICULIER',
      },
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
  // Phase 15 (WAREHOUSES is on for the distributor fixture): a truck and a draft chargement.
  const warehouses = (await call<{ id: string; isDefault: boolean }[]>('/warehouses', { token }))
    .body;
  const truck = (
    await call<{ id: string }>('/warehouses', {
      method: 'POST',
      token,
      body: { name: uniq('Camion '), type: 'VEHICLE' },
    })
  ).body;
  const transfer = (
    await call<{ id: string }>('/stock-transfers', {
      method: 'POST',
      token,
      idempotencyKey: idemKey('tr'),
      body: {
        type: 'LOAD',
        fromWarehouseId: warehouses.find((w) => w.isDefault)!.id,
        toWarehouseId: truck.id,
        lines: [{ productId: f.productId, unitId: f.baseUnitId, qty: '2' }],
      },
    })
  ).body;
  // Phase 24 (MULTI_UNIT): a second dépôt, so the header switcher shows and the dépôt
  // page has something to open.
  const depot = (
    await call<{ id: string }>('/warehouses', {
      method: 'POST',
      token,
      body: { name: uniq('Dépôt Vaisselle '), type: 'SECONDARY' },
    })
  ).body;
  // Phase 16 (TOURNEES): a route of the owner running every day with the long-named client,
  // so "Ma tournée" has a stop, and a confirmed bon de commande to deliver.
  const route = (
    await call<{ id: string }>('/routes', {
      method: 'POST',
      token,
      body: { name: 'Tournée mobile', sellerId: f.session.userId, weekdays: [0, 1, 2, 3, 4, 5, 6] },
    })
  ).body;
  await call(`/routes/${route.id}/stops`, {
    method: 'PUT',
    token,
    body: { clientIds: [client.id, f.clientId] },
  });
  const order = (
    await call<{ id: string }>('/orders', {
      method: 'POST',
      token,
      idempotencyKey: idemKey('bc'),
      body: {
        clientId: client.id,
        lines: [{ productId: f.productId, unitId: f.baseUnitId, qty: '4' }],
      },
    })
  ).body;
  await call(`/orders/${order.id}/confirm`, {
    method: 'POST',
    token,
    idempotencyKey: idemKey('bcc'),
    body: {},
  });
  // A seller on the road, so "Clôture de caisse" has a day to close.
  const invite = (
    await call<{ inviteUrl: string }>('/users/invite', {
      method: 'POST',
      token,
      body: {
        fullName: 'Vendeur mobile',
        email: `vendeur-${idemKey('u')}@example.com`,
        role: 'SELLER',
        mode: 'LINK',
      },
    })
  ).body;
  // Phase 17 (GEO_CHECK): the long-named client gets a GPS point, and the seller makes a
  // sale 1 km away with a note, so "Opérations signalées" has an item with a map.
  await call(`/clients/${client.id}/location`, {
    method: 'PATCH',
    token,
    body: { lat: 36.7538, lng: 3.0588, accuracyM: 10 },
  });
  const inviteToken = invite.inviteUrl.split('/').pop()!;
  const seller = (
    await call<{ accessToken: string }>(`/auth/invitations/${inviteToken}/accept`, {
      method: 'POST',
      body: { password: PASSWORD },
    })
  ).body;
  await call('/sales/quick', {
    method: 'POST',
    token: seller.accessToken,
    idempotencyKey: idemKey('geo'),
    body: {
      clientId: client.id,
      documentDate: new Date().toISOString().slice(0, 10),
      lines: [{ productId: f.productId, unitId: f.baseUnitId, qty: '1' }],
      geo: {
        lat: 36.7628,
        lng: 3.0588,
        accuracyM: 20,
        capturedAt: new Date().toISOString(),
        note: 'Livré au dépôt du client, à la sortie de la ville',
      },
    },
  });
  // Phase 18 (INCENTIVES): an active plan with tiers and a gate, a draft to edit, this
  // month's targets (the owner's own, so the dashboard shows "Mes objectifs") and a preview.
  const month = today().slice(0, 7);
  const tiers = {
    name: 'Paliers chiffre d’affaires du mois',
    appliesTo: 'ROLE',
    roleOrUserId: 'OWNER',
    params: {
      type: 'TIERS',
      metric: 'CA_HT',
      mode: 'HIGHEST_REACHED',
      tiers: [
        { fromPct: '80', amount: '10000' },
        { fromPct: '100', amount: '25000' },
        { fromPct: '120', amount: '40000' },
      ],
      gates: [{ metric: 'RECOUVREMENT_PCT', min: '70' }],
      cap: '50000',
    },
  };
  const plan = (
    await call<{ id: string }>('/incentive-plans', {
      method: 'POST',
      token,
      body: { name: 'Primes vendeurs et superviseurs', period: 'MONTH', validFrom: `${month}-01` },
    })
  ).body;
  await call(`/incentive-plans/${plan.id}/rules`, { method: 'POST', token, body: tiers });
  await call(`/incentive-plans/${plan.id}/activate`, { method: 'POST', token });
  const draftPlan = (
    await call<{ id: string }>('/incentive-plans', {
      method: 'POST',
      token,
      body: { name: 'Brouillon', period: 'MONTH', validFrom: `${month}-01` },
    })
  ).body;
  await call(`/incentive-plans/${draftPlan.id}/rules`, { method: 'POST', token, body: tiers });
  await call('/sales-targets/bulk', {
    method: 'PUT',
    token,
    body: {
      period: month,
      metric: 'CA_HT',
      rows: [{ userId: f.session.userId, value: '1500000' }],
    },
  });
  const run = (
    await call<{ id: string }>('/incentive-runs', {
      method: 'POST',
      token,
      body: { planId: plan.id, period: month },
    })
  ).body;
  // Phase 22 (IMPORT_COSTS, granted in global-setup): an open dossier with a USD BR in
  // transit and a cost, so its allocation table is on screen.
  const usdSupplier = (
    await call<{ id: string }>('/suppliers', {
      method: 'POST',
      token,
      idempotencyKey: idemKey('sup'),
      body: { name: 'Shenzhen Trading Co., Ltd', currency: 'USD' },
    })
  ).body;
  const importFile = (
    await call<{ id: string }>('/import-files', {
      method: 'POST',
      token,
      idempotencyKey: idemKey('di'),
      body: { reference: 'MSCU-BL-2026-118', containerNo: 'MSCU1234567' },
    })
  ).body;
  const inTransit = (
    await call<{ id: string }>('/purchases', {
      method: 'POST',
      token,
      idempotencyKey: idemKey('pur'),
      body: {
        supplierId: usdSupplier.id,
        documentDate: today(),
        exchangeRate: '135.5',
        importFileId: importFile.id,
        lines: [{ productId: f.productId, unitId: f.baseUnitId, qty: '200', unitCost: '2.35' }],
      },
    })
  ).body;
  await call(`/purchases/${inTransit.id}/validate`, {
    method: 'POST',
    token,
    idempotencyKey: idemKey('val'),
    body: {},
  });
  await call(`/import-files/${importFile.id}/costs`, {
    method: 'POST',
    token,
    idempotencyKey: idemKey('cost'),
    body: { type: 'FRET', amount: '18000', method: 'VALUE' },
  });
  // Phase 20: a packaging type, so the sale screen shows its "emballages rendus" card.
  await call('/packaging-types', {
    method: 'POST',
    token,
    body: { name: uniq('Casier ') },
  });
  const product = (await call<{ reference: string }>(`/products/${f.productId}`, { token })).body;
  return {
    importFileId: importFile.id,
    productReference: product.reference,
    clientId: client.id,
    productId: f.productId,
    saleId: sale.id,
    purchaseId: purchase.id,
    supplierId: supplier.id,
    inventoryId: inventory.id,
    transferId: transfer.id,
    warehouseId: depot.id,
    routeId: route.id,
    orderId: order.id,
    planId: plan.id,
    draftPlanId: draftPlan.id,
    runId: run.id,
    tenantId: f.tenantId,
  };
}

function resolve(pattern: string, v: Ids): string {
  return (
    pattern
      .replace('/achats/fournisseurs/[id]', `/achats/fournisseurs/${v.supplierId}`)
      .replace('/achats/dossiers/[id]', `/achats/dossiers/${v.importFileId}`)
      .replace('/achats/[id]', `/achats/${v.purchaseId}`)
      .replace('/clients/[id]', `/clients/${v.clientId}`)
      .replace('/produits/[id]', `/produits/${v.productId}`)
      .replace('/stock/depots/[id]', `/stock/depots/${v.warehouseId}`)
      .replace('/stock/inventaires/[id]', `/stock/inventaires/${v.inventoryId}`)
      .replace('/stock/transferts/[id]', `/stock/transferts/${v.transferId}`)
      .replace('/stock/[productId]', `/stock/${v.productId}`)
      .replace('/ventes/[id]', `/ventes/${v.saleId}`)
      .replace('/tournees/[id]', `/tournees/${v.routeId}`)
      .replace('/commandes/[id]', `/commandes/${v.orderId}`)
      .replace('/livraisons/[id]', `/livraisons/${v.orderId}`)
      .replace('/primes/plans/[id]', `/primes/plans/${v.planId}`)
      .replace('/primes/calculs/[id]', `/primes/calculs/${v.runId}`)
      .replace('/admin/societes/[id]', `/admin/societes/${v.tenantId}`)
      // An unknown invitation: the page shows its "invalid link" state.
      .replace('/invitation/[token]', '/invitation/not-a-real-token')
  );
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
  writeFileSync(
    join(SHOTS_DIR, `results-${project}-${name}.json`),
    `${JSON.stringify(results, null, 2)}\n`,
    'utf8',
  );
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
  await page.screenshot({
    path: join(SHOTS_DIR, shotName(pattern, locale, width)),
    fullPage: opts.fullPage ?? true,
  });
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
            (
              window as unknown as { next: { router: { push(href: string): void } } }
            ).next.router.push(to);
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
          (
            window as unknown as { next: { router: { push(href: string): void } } }
          ).next.router.push(to);
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

      await test.step('what a dépôt sells opens as a sheet with its save button on screen', async () => {
        const path = resolve('/stock/depots/[id]', v);
        await page.evaluate((to) => {
          (
            window as unknown as { next: { router: { push(href: string): void } } }
          ).next.router.push(to);
        }, path);
        await page.waitForURL((url) => url.pathname === path);
        await settle(page);
        await page.getByRole('button', { name: m['multiUnit']?.['editBrands'] }).click();
        await page.locator('[role="dialog"]').waitFor();
        await page.waitForTimeout(400); // the sheet slides in
        await expectOnScreen(page, '[role="dialog"] button:last-of-type');
        await check(page, '/stock/depots/[id]/marques', locale, results, { fullPage: false });
        await page.keyboard.press('Escape');
      });

      await test.step('new règlement fournisseur opens as a sheet with its save button on screen', async () => {
        const path = resolve('/achats/fournisseurs/[id]', v);
        await page.evaluate((to) => {
          (
            window as unknown as { next: { router: { push(href: string): void } } }
          ).next.router.push(to);
        }, path);
        await page.waitForURL((url) => url.pathname === path);
        await settle(page);
        await page.getByRole('button', { name: m['supplierAccount']?.['newPayment'] }).click();
        await page.locator('#rgf-amount').waitFor();
        await page.waitForTimeout(400); // the sheet slides in
        await expectOnScreen(page, '[role="dialog"] button[type="submit"]');
        await check(page, '/achats/fournisseurs/[id]/reglement', locale, results, {
          fullPage: false,
        });
        await page.keyboard.press('Escape');
      });

      await test.step('dossier d\'importation: Close on screen, the cost sheet and its submit', async () => {
        const path = resolve('/achats/dossiers/[id]', v);
        await page.evaluate((to) => {
          (
            window as unknown as { next: { router: { push(href: string): void } } }
          ).next.router.push(to);
        }, path);
        await page.waitForURL((url) => url.pathname === path);
        await settle(page);
        await expectOnScreen(page, `button:has-text("${m['importFiles']?.['close']}")`);
        await page.getByRole('button', { name: m['importFiles']?.['addCost'] }).first().click();
        await page.locator('#cost-amount').waitFor();
        await page.waitForTimeout(400); // the sheet slides in
        await expectOnScreen(page, '[role="dialog"] button[type="submit"]');
        await check(page, '/achats/dossiers/[id]/frais', locale, results, { fullPage: false });
        await page.keyboard.press('Escape');

        await page.evaluate((to) => {
          (
            window as unknown as { next: { router: { push(href: string): void } } }
          ).next.router.push(to);
        }, '/achats/dossiers');
        await page.waitForURL((url) => url.pathname === '/achats/dossiers');
        await settle(page);
        await page.getByRole('button', { name: m['importFiles']?.['new'] }).first().click();
        await page.locator('#di-reference').waitFor();
        await page.waitForTimeout(400);
        await expectOnScreen(page, '[role="dialog"] button[type="submit"]');
        await check(page, '/achats/dossiers/nouveau', locale, results, { fullPage: false });
        await page.keyboard.press('Escape');
      });

      await test.step('chargement: new transfer sheet, then the entry screen and its Validate', async () => {
        const go = async (path: string) => {
          await page.evaluate((to) => {
            (
              window as unknown as { next: { router: { push(href: string): void } } }
            ).next.router.push(to);
          }, path);
          await page.waitForURL((url) => url.pathname === path);
          await settle(page);
        };
        await go('/stock/transferts');
        await page.getByRole('button', { name: m['transfers']?.['new'] }).first().click();
        await page.locator('#transfer-from').waitFor();
        await page.waitForTimeout(400); // the sheet slides in
        await expectOnScreen(page, '[role="dialog"] button[type="submit"]');
        await check(page, '/stock/transferts/nouveau', locale, results, { fullPage: false });
        await page.keyboard.press('Escape');

        await go(resolve('/stock/transferts/[id]', v));
        await expectOnScreen(page, '#transfer-scan');
        await expectOnScreen(page, `button:has-text("${m['transfers']?.['validate']}")`);

        await go('/stock/depots');
        await page.getByRole('button', { name: m['warehouses']?.['new'] }).first().click();
        await page.locator('#warehouse-name').waitFor();
        await page.waitForTimeout(400);
        await expectOnScreen(page, '[role="dialog"] button[type="submit"]');
        await check(page, '/stock/depots/nouveau', locale, results, { fullPage: false });
        await page.keyboard.press('Escape');
      });

      await test.step('share link of the relevé: the link and the WhatsApp button on screen', async () => {
        const path = resolve('/clients/[id]', v);
        await page.evaluate((to) => {
          (
            window as unknown as { next: { router: { push(href: string): void } } }
          ).next.router.push(to);
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

      await test.step('bulk assign: select a client, the assign sheet and its button on screen', async () => {
        const path = '/clients';
        await page.evaluate((to) => {
          (
            window as unknown as { next: { router: { push(href: string): void } } }
          ).next.router.push(to);
        }, path);
        await page.waitForURL((url) => url.pathname === path);
        await settle(page);
        await page.locator('input[type="checkbox"]').first().check();
        // The selection bar is sticky at the bottom of a phone.
        await expectOnScreen(page, '[data-slot="sticky-actions"] button:last-child');
        await check(page, '/clients/selection', locale, results, { fullPage: false });
        await page.getByRole('button', { name: m['clients']?.['assign'], exact: true }).click();
        await page.locator('#assign-sector').waitFor();
        await page.waitForTimeout(400); // the sheet slides in
        await expectOnScreen(page, '[role="dialog"] button[type="submit"]');
        await check(page, '/clients/affecter', locale, results, { fullPage: false });
        await page.keyboard.press('Escape');
      });

      await test.step('team tree: the users page with the manager column and the teams', async () => {
        const path = '/parametres/utilisateurs';
        await page.evaluate((to) => {
          (
            window as unknown as { next: { router: { push(href: string): void } } }
          ).next.router.push(to);
        }, path);
        await page.waitForURL((url) => url.pathname === path);
        await settle(page);
        await page.getByRole('heading', { name: m['team']?.['title'] }).waitFor();
        await check(page, '/parametres/utilisateurs/equipes', locale, results);
      });

      await test.step('dashboard: the onboarding checklist fits', async () => {
        const path = '/tableau-de-bord';
        await page.evaluate((to) => {
          (
            window as unknown as { next: { router: { push(href: string): void } } }
          ).next.router.push(to);
        }, path);
        await page.waitForURL((url) => url.pathname === path);
        await settle(page);
        await page.locator('[data-testid="onboarding-card"]').waitFor();
        await check(page, '/tableau-de-bord/onboarding', locale, results);
      });

      await test.step('tournées: visit sheet, deliver dialog and cash closing on screen', async () => {
        const go = async (path: string) => {
          await page.evaluate((to) => {
            (
              window as unknown as { next: { router: { push(href: string): void } } }
            ).next.router.push(to);
          }, path);
          await page.waitForURL((url) => url.pathname === path);
          await settle(page);
        };
        // The seller's day: each stop's actions fit, the visit sheet keeps its save on screen.
        await go('/tournees/aujourdhui');
        await expectOnScreen(page, `button:has-text("${m['tournees']?.['actionVisit']}")`);
        await page.getByRole('button', { name: m['tournees']?.['actionVisit'] }).first().click();
        await page.locator('#visit-note').waitFor();
        await page.waitForTimeout(400); // the sheet slides in
        await page.getByRole('button', { name: m['tournees']?.['reasonCLOSED'] }).click();
        await expectOnScreen(page, '[role="dialog"] button[type="submit"]');
        await check(page, '/tournees/aujourdhui/visite', locale, results, { fullPage: false });
        await page.keyboard.press('Escape');

        // A confirmed order: Livrer is the sticky action; its dialog keeps the submit on screen.
        await go(resolve('/commandes/[id]', v));
        await expectOnScreen(
          page,
          `[data-slot="sticky-actions"] button:has-text("${m['orders']?.['deliver']}")`,
        );
        await page.getByRole('button', { name: m['orders']?.['deliver'], exact: true }).click();
        await page.locator('#deliver-paid').waitFor();
        await page.waitForTimeout(400);
        await expectOnScreen(page, '[role="dialog"] button[type="submit"]');
        await check(page, '/commandes/[id]/livrer', locale, results, { fullPage: false });
        await page.keyboard.press('Escape');

        // Clôture: the fixture seller's day, its close dialog keeps the submit on screen.
        await go('/tournees/cloture');
        await page.getByRole('button', { name: m['tournees']?.['closeDay'] }).first().click();
        await page.locator('#close-handed').waitFor();
        await page.waitForTimeout(400);
        await expectOnScreen(page, '[role="dialog"] button[type="submit"]');
        await check(page, '/tournees/cloture/cloturer', locale, results, { fullPage: false });
        await page.keyboard.press('Escape');
      });

      await test.step('flagged operations: the detail sheet, its map and the review buttons', async () => {
        const path = '/operations-signalees';
        await page.evaluate((to) => {
          (
            window as unknown as { next: { router: { push(href: string): void } } }
          ).next.router.push(to);
        }, path);
        await page.waitForURL((url) => url.pathname === path);
        await settle(page);
        await page.getByText('Établissements Benali').first().click();
        await page.locator('[role="dialog"] .leaflet-container').waitFor();
        await page.waitForTimeout(400); // the sheet slides in
        await expectOnScreen(page, `[role="dialog"] button:has-text("${m['geo']?.['justified']}")`);
        await check(page, '/operations-signalees/detail', locale, results, { fullPage: false });
        await page.keyboard.press('Escape');
      });

      await test.step('incentives: rule sheet and approve dialog with their buttons on screen', async () => {
        const go = async (path: string) => {
          await page.evaluate((to) => {
            (
              window as unknown as { next: { router: { push(href: string): void } } }
            ).next.router.push(to);
          }, path);
          await page.waitForURL((url) => url.pathname === path);
          await settle(page);
        };
        await go(`/primes/plans/${v.draftPlanId}`);
        await expectOnScreen(page, '[data-slot="sticky-actions"] button:not([disabled])');
        await page.getByRole('button', { name: m['incentives']?.['addRule'] }).click();
        await page.locator('#rule-name').waitFor();
        await page.waitForTimeout(400); // the sheet slides in
        await check(page, '/primes/plans/[id]/regle', locale, results, { fullPage: false });
        await page.locator('[role="dialog"] button[type="submit"]').scrollIntoViewIfNeeded();
        await expectOnScreen(page, '[role="dialog"] button[type="submit"]');
        await page.keyboard.press('Escape');

        await go(`/primes/calculs/${v.runId}`);
        await page.locator('button[aria-controls^="run-user-"]').first().click();
        await check(page, '/primes/calculs/[id]/detail', locale, results);
        await page.getByRole('button', { name: m['incentives']?.['approve'], exact: true }).click();
        await page.waitForTimeout(400);
        await expectOnScreen(page, `[role="dialog"] button:has-text("${m['incentives']?.['approveConfirm']}")`);
        await check(page, '/primes/calculs/[id]/valider', locale, results, { fullPage: false });
        await page.keyboard.press('Escape');
      });

      await test.step('distribution: promotion sheet, packaging return and sale packaging card', async () => {
        const go = async (path: string) => {
          await page.evaluate((to) => {
            (
              window as unknown as { next: { router: { push(href: string): void } } }
            ).next.router.push(to);
          }, path);
          await page.waitForURL((url) => url.pathname === path.split('?')[0]);
          await settle(page);
        };
        await go('/promotions');
        await page.getByRole('button', { name: m['promotions']?.['new'] }).click();
        await page.locator('#promo-name').waitFor();
        await page.waitForTimeout(400); // the sheet slides in
        await check(page, '/promotions/nouvelle', locale, results, { fullPage: false });
        await page.locator('[role="dialog"] button[type="submit"]').scrollIntoViewIfNeeded();
        await expectOnScreen(page, '[role="dialog"] button[type="submit"]');
        await page.keyboard.press('Escape');

        await go(resolve('/clients/[id]', v));
        await page.getByRole('button', { name: m['packaging']?.['newMovement'] }).click();
        await page.locator('#pm-qty').waitFor();
        await page.waitForTimeout(400);
        await expectOnScreen(page, '[role="dialog"] button[type="submit"]');
        await check(page, '/clients/[id]/emballages', locale, results, { fullPage: false });
        await page.keyboard.press('Escape');

        await go(`/ventes/nouvelle?client=${v.clientId}`);
        await page.locator('[id^="returned-"]').first().waitFor();
        await page.locator('[id^="returned-"]').first().scrollIntoViewIfNeeded();
        await check(page, '/ventes/nouvelle/emballages', locale, results, { fullPage: false });
      });

      await test.step('fast sale: a line, then the total and the validate button on screen', async () => {
        const path = '/ventes/nouvelle';
        await page.evaluate((to) => {
          (
            window as unknown as { next: { router: { push(href: string): void } } }
          ).next.router.push(to);
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
            (
              window as unknown as { next: { router: { push(href: string): void } } }
            ).next.router.push(to);
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
