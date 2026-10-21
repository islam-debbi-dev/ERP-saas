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
  await page.waitForURL(/\/tableau-de-bord/);
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
    await expect(page.getByRole('alert').filter({ hasNotText: 'Notifications' }).first()).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
    await expect(page.locator('body')).not.toContainText('Wrong1234!');
    await expect(page.locator('body')).not.toContainText(f.session.email);
  });

  test('the right credentials open the dashboard', async ({ page }) => {
    const f = shared();
    await useEnglish(page);
    await login(page, f.session.email);
    await expect(page).toHaveURL(/\/tableau-de-bord/);
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
  const pwned = await page.evaluate(() => (window as unknown as Record<string, unknown>)['__pwned']);
  expect(pwned).toBeUndefined();
});

test('a hostile id in the URL gives a message, not a crash', async ({ page }) => {
  await useEnglish(page);
  await open(page, "/clients/'; DROP TABLE clients;--");
  // The API refuses the id, the screen says so and the app is still alive.
  await expect(page.getByRole('alert').filter({ hasNotText: 'Notifications' }).first()).toBeVisible();
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
test('logging out ends the session for good', async ({ page }) => {
  await useEnglish(page);
  await open(page, '/tableau-de-bord');
  await page.getByRole('button', { name: /Owner/ }).first().click();
  await page.getByRole('menuitem', { name: 'Log out' }).click();
  await expect(page).toHaveURL(/\/login/);
  await open(page, '/clients');
  await expect(page).toHaveURL(/\/login/);
});

