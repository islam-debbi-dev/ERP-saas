/**
 * Web audit: the dashboard in a real browser against the real API.
 *
 * The data is seeded through the API (fast and precise), the behaviour is
 * checked in the browser. The UI is Arabic by default, so every page gets the
 * NEXT_LOCALE=en cookie first.
 *
 * The tenant, the catalog and the session come from the global setup (see
 * global-setup.ts): the login limiter counts successful logins, so the suite
 * logs in once and shares the session.
 */
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { makeSale, uniq, type Fixture } from '../api/fixture.ts';
import { call, idemKey } from '../lib/http.ts';

const WEB = process.env['WEB'] ?? 'http://localhost:3005';
const PASSWORD = 'Audit1234!';
const FIXTURE_FILE = fileURLToPath(new URL('../.auth/fixture.json', import.meta.url));
const STATE_FILE = fileURLToPath(new URL('../.auth/state.json', import.meta.url));

let cached: Fixture | null = null;
/** The tenant prepared by the global setup (written after the test files load). */
function shared(): Fixture {
  if (!cached) cached = JSON.parse(readFileSync(FIXTURE_FILE, 'utf8')) as Fixture;
  return cached;
}

async function useEnglish(page: Page): Promise<void> {
  await page.context().addCookies([{ name: 'NEXT_LOCALE', value: 'en', url: WEB }]);
}

/** Navigates and waits for the page to have finished its calls. */
async function open(page: Page, path: string): Promise<void> {
  await page.goto(`${WEB}${path}`);
  await page.waitForLoadState('networkidle');
}

async function login(page: Page, email: string, password = PASSWORD): Promise<void> {
  await page.goto(`${WEB}/login`);
  await page.locator('#identifier').fill(email);
  await page.locator('#password').fill(password);
  await page.getByRole('button', { name: 'Log in' }).click();
  // The dashboard, or the Vue d'ensemble for a user with several dépôts (phase 26).
  await page.waitForURL(/\/(tableau-de-bord|vue-ensemble)/);
  // The login page redirects on its own: wait for it, or the next navigation
  // is thrown back to the dashboard.
  await page.waitForLoadState('networkidle');
}

/** A client of its own, with a validated BL of 1190,00 DA to pay. */
async function clientWithDebt(name: string): Promise<string> {
  const f = shared();
  const client = (
    await call<{ id: string }>('/clients', {
      method: 'POST',
      token: f.session.token,
      idempotencyKey: idemKey('cli'),
      body: { code: uniq('C-'), name, type: 'PARTICULIER' },
    })
  ).body;
  await makeSale(f, { qty: '1', clientId: client.id });
  return client.id;
}

// The refresh cookie rotates on every call: the shared state must follow, or
// the next test replays an old token (the API answers 401 on a replay).
test.afterEach(async ({ page }) => {
  const cookies = await page.context().cookies();
  if (cookies.some((c) => c.name === 'erp_rt')) {
    await page.context().storageState({ path: STATE_FILE });
  }
});

test.describe('the login itself', () => {
  // These checks start from nothing: no cookie, no session.
  test.use({ storageState: { cookies: [], origins: [] } });

  test('an anonymous visitor is sent to the login page', async ({ page }) => {
    await useEnglish(page);
    await open(page, '/clients');
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByLabel(/Email|Phone/i)).toBeVisible();
  });

  test('a wrong password is refused and says nothing about the secret', async ({ page }) => {
    const f = shared();
    await useEnglish(page);
    await page.goto(`${WEB}/login`);
    await page.locator('#identifier').fill(f.session.email);
    await page.locator('#password').fill('Wrong1234!');
    await page.getByRole('button', { name: 'Log in' }).click();
    await expect(
      page.getByRole('alert').filter({ hasNotText: 'Notifications' }).first(),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
    await expect(page.locator('body')).not.toContainText('Wrong1234!');
    await expect(page.locator('body')).not.toContainText(f.session.email);
  });

  test('the right credentials open the dashboard', async ({ page }) => {
    const f = shared();
    await useEnglish(page);
    await login(page, f.session.email);
    await expect(page).toHaveURL(/\/(tableau-de-bord|vue-ensemble)/);
    if (!page.url().includes('/tableau-de-bord')) await open(page, '/tableau-de-bord');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Hello');
    // The dashboard loaded its numbers (the card is there, not a skeleton).
    await expect(page.getByText('Sales today')).toBeVisible();
  });
});

test('the session survives a reload (the refresh cookie is used)', async ({ page }) => {
  await useEnglish(page);
  await open(page, '/tableau-de-bord');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Hello');
  await page.reload();
  await page.waitForLoadState('networkidle');
  await expect(page).toHaveURL(/\/tableau-de-bord/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Hello');
});

test('the token stays out of the browser storage and the cookie is httpOnly', async ({ page }) => {
  await useEnglish(page);
  await open(page, '/tableau-de-bord');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Hello');
  const stored = await page.evaluate(() => ({
    local: Object.entries(localStorage),
    session: Object.entries(sessionStorage),
  }));
  expect(JSON.stringify(stored)).not.toContain('eyJ');
  const cookies = await page.context().cookies();
  const refresh = cookies.find((c) => c.name === 'erp_rt');
  expect(refresh).toBeDefined();
  expect(refresh?.httpOnly).toBe(true);
  expect(refresh?.path).toBe('/auth');
});

test('the balance of a client is shown exactly, in DA', async ({ page }) => {
  await useEnglish(page);
  await clientWithDebt('Web money');
  await open(page, '/clients');
  await expect(page.getByText(/1\s*190,00\s*DA/).first()).toBeVisible();
  // No float noise, no second decimal place.
  await expect(page.getByText(/1190,\d{3}/)).toHaveCount(0);
});

test('a hostile client name is shown as text, not executed', async ({ page }) => {
  const f = shared();
  const name = '<img src=x onerror="window.__pwned=1">';
  await call('/clients', {
    method: 'POST',
    token: f.session.token,
    idempotencyKey: idemKey('xss'),
    body: { code: uniq('X-'), name, type: 'PARTICULIER' },
  });
  await useEnglish(page);
  await open(page, '/clients');
  await expect(page.getByText(name)).toBeVisible();
  const pwned = await page.evaluate(
    () => (window as unknown as Record<string, unknown>)['__pwned'],
  );
  expect(pwned).toBeUndefined();
});

test('a hostile id in the URL gives a message, not a crash', async ({ page }) => {
  await useEnglish(page);
  await open(page, "/clients/'; DROP TABLE clients;--");
  // The API refuses the id, the screen says so and the app is still alive.
  await expect(
    page.getByRole('alert').filter({ hasNotText: 'Notifications' }).first(),
  ).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Main menu' })).toBeVisible();
  await expect(page.locator('body')).not.toContainText('Application error');
});

test('a payment made from the screen carries an idempotency key', async ({ page }) => {
  const clientId = await clientWithDebt('Web payment');
  await useEnglish(page);
  await open(page, `/clients/${clientId}`);
  await page.getByRole('button', { name: /New payment/i }).click();
  await page.locator('#pay-amount').fill('100');
  const [response] = await Promise.all([
    page.waitForResponse((r) => r.url().includes('/payments') && r.request().method() === 'POST'),
    page.getByRole('button', { name: /^Save payment$/ }).click(),
  ]);
  expect(response.status()).toBe(201);
  expect(response.request().headers()['idempotency-key']).toBeTruthy();
  await expect(page.locator('#pay-amount')).toBeHidden();
});

// The log out ends the shared session: it stays the last check.
test.describe('client map and tournée stops from the map (phase 35)', () => {
  const tiles = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
    'base64',
  );
  test.beforeEach(async ({ context }) => {
    // CI never hits the tile server.
    await context.route(/tile\.openstreetmap\.org/, (r) =>
      r.fulfill({ contentType: 'image/png', body: tiles }),
    );
  });

  /** Three clients of the owner around Oran, west to east: A, B (2 km), C (4 km). */
  async function oranClients(): Promise<{ id: string; name: string }[]> {
    const f = shared();
    const out: { id: string; name: string }[] = [];
    for (const [i, lng] of [-0.6308, -0.6088, -0.5868].entries()) {
      const name = uniq(`Carte ${'ABC'[i]} `);
      const c = (
        await call<{ id: string }>('/clients', {
          method: 'POST',
          token: f.session.token,
          body: { code: uniq('MAP-'), name, assignedSellerId: f.session.userId },
        })
      ).body;
      await call(`/clients/${c.id}/location`, {
        method: 'PATCH',
        token: f.session.token,
        body: { lat: 35.6971, lng },
      });
      out.push({ id: c.id, name });
    }
    return out;
  }

  const stopNames = (page: Page) => page.locator('ol > li p.font-medium').allTextContents();

  test('picks stops on the map, saves them in tap order, orders them by distance', async ({
    page,
  }) => {
    const [a, b, c] = await oranClients();
    page.on('dialog', (d) => void d.accept());
    await useEnglish(page);
    await open(page, '/tournees');
    await page.getByRole('button', { name: 'New route' }).first().click();
    await page.locator('#route-name').fill(uniq('Oran '));
    await page.locator('#route-seller').selectOption(shared().session.userId);
    await page.locator('[role="dialog"] button[aria-pressed]').first().click();
    await page.getByRole('button', { name: 'Create route' }).click();
    await page.waitForURL(/\/tournees\/[0-9a-f-]{36}$/);
    await expect(page.getByText('Pick the clients on the map.')).toBeVisible();

    await page.getByRole('button', { name: 'Pick on the map' }).first().click();
    const sheet = page
      .locator('[role="dialog"]')
      .filter({ has: page.locator('.leaflet-container') });
    for (const x of [a!, c!]) {
      await sheet.locator(`path.cp-${x.id}`).click();
      const bubble = sheet.getByRole('dialog', { name: x.name });
      await bubble.getByRole('button', { name: 'Add to the route' }).click();
      await bubble.getByRole('button', { name: 'Close', exact: true }).click();
    }
    // The added clients are numbered markers now: 1 and 2.
    await expect(sheet.locator('.leaflet-marker-icon')).toHaveCount(2);
    await sheet.getByRole('button', { name: 'Done' }).click();
    expect(await stopNames(page)).toEqual([a!.name, c!.name]);

    await page.getByRole('button', { name: 'Save route' }).click();
    await expect(page.getByText('Route saved').first()).toBeVisible();
    await page.reload();
    await page.waitForLoadState('networkidle');
    expect(await stopNames(page)).toEqual([a!.name, c!.name]);

    // B lies between A and C: ordering by distance from the first stop puts it second.
    await page.getByRole('button', { name: 'Pick on the map' }).first().click();
    await sheet.locator(`path.cp-${b!.id}`).click();
    await sheet.getByRole('button', { name: 'Add to the route' }).click();
    await sheet.getByRole('button', { name: 'Done' }).click();
    expect(await stopNames(page)).toEqual([a!.name, c!.name, b!.name]);
    await page.getByRole('button', { name: 'Order by distance' }).click();
    expect(await stopNames(page)).toEqual([a!.name, b!.name, c!.name]);
  });

  test('refused location explains itself and the map still loads', async ({ page, context }) => {
    await context.clearPermissions();
    await useEnglish(page);
    await open(page, '/clients/carte');
    await page.locator('.leaflet-container').waitFor();
    await page.getByRole('button', { name: 'Near me' }).click();
    await expect(page.getByText(/Location refused/)).toBeVisible();
    await expect(page.locator('.leaflet-container')).toBeVisible();
  });
});

test('logging out ends the session for good', async ({ page }) => {
  await useEnglish(page);
  await open(page, '/tableau-de-bord');
  await page.getByRole('button', { name: /Owner/ }).first().click();
  await page.getByRole('menuitem', { name: 'Log out' }).click();
  await expect(page).toHaveURL(/\/login/);
  await open(page, '/clients');
  await expect(page).toHaveURL(/\/login/);
});
