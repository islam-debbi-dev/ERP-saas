/**
 * Wilaya, daïra and commune on screen (phase 40a): the client form, the sector form and the
 * statistics filters, in Arabic (RTL) and French, at the width of the project (393 px on
 * `mobile`, 360 px on `mobile-360`, 1280 px on `desktop`). Nothing scrolls sideways, and
 * what is saved is read back from the API.
 */
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildFixture, makeSale, uniq, type Fixture } from '../api/fixture.ts';
import { call, idemKey } from '../lib/http.ts';
import { expectNoHorizontalOverflow } from './mobile-helpers.ts';

const WEB = process.env['WEB'] ?? 'http://localhost:3005';
const SHOTS_DIR =
  process.env['SHOTS_DIR'] ?? fileURLToPath(new URL('../artifacts/mobile/', import.meta.url));
const MESSAGES_DIR = fileURLToPath(new URL('../../apps/web/src/messages/', import.meta.url));
/** A word only the commune data holds: the chunk that carries it is the lazy one. */
const DATA_MARKER = 'Rouissat';
/** Bordj El Emir Abdelkader (wilaya 38): one of the longest Arabic commune names. */
const LONG = {
  code: 3809,
  wilaya: 38,
  fr: 'Bordj El Emir Abdelkader',
  ar: 'برج الامير عبد القادر',
};

type Locale = 'ar' | 'fr';
type Labels = Record<string, Record<string, string>>;
const labels = (locale: Locale): Labels =>
  JSON.parse(readFileSync(join(MESSAGES_DIR, `${locale}.json`), 'utf8')) as Labels;

interface ClientBody {
  id: string;
  wilaya: string | null;
  commune: string | null;
  wilayaCode: number | null;
  communeCode: number | null;
}

let fixture: Fixture;
let context: BrowserContext;
let page: Page;

test.beforeAll(async ({ browser }, info) => {
  mkdirSync(SHOTS_DIR, { recursive: true });
  fixture = await buildFixture('Locations audit', 'DISTRIBUTEUR');
  const { viewport, userAgent, deviceScaleFactor, isMobile, hasTouch } = info.project.use;
  context = await browser.newContext({
    viewport,
    userAgent,
    deviceScaleFactor,
    isMobile,
    hasTouch,
    baseURL: WEB,
    // Its own tenant: not the shared signed-in state of the global setup.
    storageState: { cookies: [], origins: [] },
  });
  await context.addCookies([{ name: 'NEXT_LOCALE', value: 'fr', url: WEB }]);
  page = await context.newPage();
  await page.goto('/login');
  await page.waitForLoadState('networkidle');
  await page.locator('#identifier').fill(fixture.session.email);
  await page.locator('#password').fill('Audit1234!');
  await page.getByRole('button', { name: labels('fr')['auth']!['login']! }).click();
  await page.waitForURL(/\/(tableau-de-bord|vue-ensemble)/);
});

test.afterAll(async () => {
  await context.close();
});

const token = () => fixture.session.token;
const createClient = async (body: Record<string, unknown>) =>
  (
    await call<ClientBody>('/clients', {
      method: 'POST',
      token: token(),
      idempotencyKey: idemKey('cli'),
      body: { code: uniq('L-'), type: 'PARTICULIER', ...body },
    })
  ).body;
const readClient = async (id: string) =>
  (await call<ClientBody>(`/clients/${id}`, { token: token() })).body;

const setLocale = (locale: Locale) =>
  context.addCookies([{ name: 'NEXT_LOCALE', value: locale, url: WEB }]);

async function open(path: string): Promise<void> {
  await page.goto(path);
  await page.locator('h1').first().waitFor();
  await page.waitForLoadState('networkidle');
}

async function check(name: string, locale: Locale): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  // The sheet and dialog entry animations.
  await page.waitForTimeout(600);
  await expectNoHorizontalOverflow(page, { soft: true });
  const width = page.viewportSize()!.width;
  await page.screenshot({ path: join(SHOTS_DIR, `locations-${name}-${locale}-${width}.png`) });
}

/** A closed picker field: its accessible name is "label value". */
const field = (label: string) =>
  page.getByRole('button', { name: new RegExp(`^${label.replace(/[()]/g, '\\$&')} `) }).last();
const dialog = () => page.getByRole('dialog').last();
const searchBox = () => dialog().getByRole('searchbox');
const row = (text: string) => dialog().getByRole('button', { name: text }).first();

async function pickWilaya(label: string, code: number): Promise<void> {
  await field(label).click();
  await searchBox().fill(String(code));
  await row(`${code} · `).click();
}

/** The main action is on screen without scrolling sideways. */
async function expectActionVisible(name: string): Promise<void> {
  const button = page.getByRole('button', { name, exact: true }).last();
  await expect(button).toBeVisible();
  const box = (await button.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width);
}

test('the commune data is only loaded by the screens that need it', async () => {
  const withData: string[] = [];
  const watch = await context.newPage();
  watch.on('response', (res) => {
    if (res.url().includes('/_next/static/') && res.url().endsWith('.js')) {
      void res.text().then(
        (body) => {
          if (body.includes(DATA_MARKER)) withData.push(res.url());
        },
        () => undefined,
      );
    }
  });
  for (const path of ['/tableau-de-bord', '/produits', '/ventes', '/clients']) {
    await watch.goto(path);
    await watch.waitForLoadState('networkidle');
    expect(withData, `${path} loads no commune data`).toEqual([]);
  }
  await watch.goto('/clients/nouveau');
  await expect.poll(() => withData.length).toBe(1);
  await watch.close();
});

test('the licence of the commune data is served', async () => {
  const res = await page.request.get('/licenses/algeria-communes-MIT.txt');
  expect(res.status()).toBe(200);
  const text = await res.text();
  expect(text).toContain('Copyright (c) 2026 syscli');
  expect(text).toContain('https://github.com/syscli/algeria');
});

for (const locale of ['ar', 'fr'] as const) {
  test(`client form: pick a commune, ${locale}`, async () => {
    const m = labels(locale);
    const t = m['locations']!;
    await setLocale(locale);
    await open('/clients/nouveau');
    const name = uniq('Client lieu ');
    await page.locator('#code').fill(uniq('F-'));
    await page.locator('#name').fill(name);

    await field(t['wilaya']!).click();
    await check('wilaya-picker', locale);
    await searchBox().fill(String(LONG.wilaya));
    await row(`${LONG.wilaya} · `).click();

    await expect(field(t['commune']!)).toBeEnabled();
    await field(t['commune']!).click();
    await check('commune-picker', locale);
    // Search in the other language than the screen.
    await searchBox().fill(locale === 'ar' ? 'bordj emir' : LONG.ar);
    await row(locale === 'ar' ? LONG.ar : LONG.fr).click();
    await expect(field(t['commune']!)).toContainText(locale === 'ar' ? LONG.ar : LONG.fr);
    await field(t['commune']!).scrollIntoViewIfNeeded();
    await check('client-form', locale);

    await expectActionVisible(m['common']!['save']!);
    await page.getByRole('button', { name: m['common']!['save']!, exact: true }).click();
    await page.waitForURL(/\/clients\/[0-9a-f-]{36}$/);
    const saved = await readClient(page.url().split('/').pop()!);
    expect(saved).toMatchObject({
      wilayaCode: LONG.wilaya,
      communeCode: LONG.code,
      commune: LONG.fr,
    });
    // The detail names the place in the screen's language.
    await expect(page.getByText(locale === 'ar' ? LONG.ar : LONG.fr).first()).toBeVisible();
    await check('client-detail', locale);
    await open('/clients');
    await page.getByRole('searchbox').first().fill(name);
    await expect(
      page.getByText(locale === 'ar' ? LONG.ar : LONG.fr, { exact: false }).first(),
    ).toBeVisible();
    await check('client-list', locale);
  });

  test(`client form: old text is kept until the user chooses, ${locale}`, async () => {
    const m = labels(locale);
    const t = m['locations']!;
    const old = await createClient({
      name: uniq('Ancien client '),
      wilaya: 'msila (ancien)',
      commune: 'bousaada centre ville, quartier des anciens moudjahidine',
    });
    expect(old).toMatchObject({ wilayaCode: null, communeCode: null });
    await setLocale(locale);
    await open(`/clients/${old.id}/modifier`);
    await expect(page.getByText('msila (ancien)', { exact: false }).first()).toBeVisible();
    await field(t['wilaya']!).scrollIntoViewIfNeeded();
    await check('client-old-text', locale);

    // Saving another field leaves the old text alone.
    await page.locator('#address').fill('Cité 5');
    await page.getByRole('button', { name: m['common']!['save']!, exact: true }).click();
    await page.waitForURL(new RegExp(`/clients/${old.id}$`));
    expect(await readClient(old.id)).toMatchObject({
      wilaya: old.wilaya,
      commune: old.commune,
      wilayaCode: null,
      communeCode: null,
    });

    // Wilaya alone keeps the typed commune.
    await open(`/clients/${old.id}/modifier`);
    await pickWilaya(t['wilaya']!, 28);
    await page.getByRole('button', { name: m['common']!['save']!, exact: true }).click();
    await page.waitForURL(new RegExp(`/clients/${old.id}$`));
    expect(await readClient(old.id)).toMatchObject({
      commune: old.commune,
      wilayaCode: 28,
      communeCode: null,
    });

    // Clearing empties codes and text.
    await open(`/clients/${old.id}/modifier`);
    await page.getByRole('button', { name: t['clear']! }).click();
    await page.getByRole('button', { name: m['common']!['save']!, exact: true }).click();
    await page.waitForURL(new RegExp(`/clients/${old.id}$`));
    expect(await readClient(old.id)).toMatchObject({
      wilaya: null,
      commune: null,
      wilayaCode: null,
      communeCode: null,
    });
  });

  test(`client form: communes under review cannot be chosen, ${locale}`, async () => {
    const t = labels(locale)['locations']!;
    await setLocale(locale);
    await open('/clients/nouveau');
    await pickWilaya(t['wilaya']!, 60);
    await expect(field(t['commune']!)).toBeEnabled();
    await field(t['commune']!).click();
    await expect(dialog().getByText(t['underReview']!).first()).toBeVisible();
    await expect(dialog().getByRole('button', { name: t['underReview']! }).first()).toBeDisabled();
    await check('commune-under-review', locale);
    await page.keyboard.press('Escape');
  });

  test(`sector form: several communes as chips, ${locale}`, async () => {
    const m = labels(locale);
    const t = m['locations']!;
    await setLocale(locale);
    await open('/clients/secteurs');
    await page.getByRole('button', { name: m['sectors']!['new']! }).first().click();
    const name = uniq('Secteur ');
    await page.locator('#sector-name').fill(name);
    await pickWilaya(t['wilaya']!, LONG.wilaya);
    await expect(field(t['communes']!)).toBeEnabled();
    await field(t['communes']!).click();
    await searchBox().fill(LONG.fr);
    await row(locale === 'ar' ? LONG.ar : LONG.fr).click();
    await searchBox().fill('');
    // A second one: the first other row of the list.
    await dialog().locator('li button[aria-pressed="false"]').first().click();
    await check('sector-communes-picker', locale);
    await dialog().locator('[data-slot="dialog-footer"] button').click();
    await expect(page.getByRole('button', { name: t['remove']!.split('{')[0]! })).toHaveCount(2);
    await check('sector-form', locale);

    await expectActionVisible(m['common']!['save']!);
    await page.getByRole('button', { name: m['common']!['save']!, exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const sectors = (
      await call<{ name: string; wilayaCode: number; communeCodes: number[] }[]>('/sectors', {
        token: token(),
      })
    ).body;
    const saved = sectors.find((s) => s.name === name)!;
    expect(saved.wilayaCode).toBe(LONG.wilaya);
    expect(saved.communeCodes).toHaveLength(2);
    expect(saved.communeCodes).toContain(LONG.code);
    await expect(
      page.getByText(locale === 'ar' ? LONG.ar : LONG.fr, { exact: true }).first(),
    ).toBeVisible();
    await check('sector-list', locale);
  });

  test(`statistics: an old link, the place filters and the commune rows, ${locale}`, async () => {
    const m = labels(locale);
    const t = m['locations']!;
    const s = m['stats']!;
    const client = await createClient({
      name: uniq('Client stats '),
      wilayaCode: LONG.wilaya,
      communeCode: LONG.code,
    });
    await makeSale(fixture, { qty: '1', clientId: client.id });
    await setLocale(locale);

    // A link saved before there were codes: a readable chip, and no error.
    await open(`/statistiques?view=clients&clientWilayas=${encodeURIComponent("M'Sila")}`);
    const msila = locale === 'ar' ? '28 · المسيلة' : "28 · M'Sila";
    const chip = page.getByRole('button', { name: new RegExp(msila) }).first();
    await expect(chip).toBeVisible();
    await expect(page.locator('section [role="alert"]')).toHaveCount(0);
    await check('stats-old-link', locale);
    await chip.click();
    await expect(page).not.toHaveURL(/clientWilayas/);

    // A drill-down by codes shows names, never the bare code.
    await open(`/statistiques?view=clients&clientCommunes=${LONG.code}`);
    await expect(
      page.getByRole('button', { name: locale === 'ar' ? LONG.ar : LONG.fr }).first(),
    ).toBeVisible();

    // The filter sheet.
    await open('/statistiques');
    await page
      .getByRole('button', { name: new RegExp(s['filters']!.split(/[({]/)[0]!.trim()) })
      .first()
      .click();
    for (const key of ['filter_clientWilayas', 'filter_clientDairas', 'filter_clientCommunes']) {
      await dialog().locator('summary').filter({ hasText: s[key]! }).click();
    }
    // The commune group is the last one open: its fields are the last of their name.
    await pickWilaya(t['lookIn']!, LONG.wilaya);
    const communesField = field(t['communes']!);
    await expect(communesField).toBeEnabled();
    await communesField.click();
    await searchBox().fill(LONG.fr);
    await row(locale === 'ar' ? LONG.ar : LONG.fr).click();
    await check('stats-commune-picker', locale);
    await dialog().locator('[data-slot="dialog-footer"] button').click();
    await communesField.scrollIntoViewIfNeeded();
    await check('stats-filters', locale);
    await expectActionVisible(s['apply']!);
    await page.getByRole('button', { name: s['apply']!, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`clientCommunes=${LONG.code}`));

    // The commune and daïra rows are named in the screen's language.
    await open('/statistiques?view=zones');
    for (const dimension of ['dim_clientDaira', 'dim_clientCommune']) {
      await page.getByRole('button', { name: s[dimension]!, exact: true }).click();
      await page.waitForLoadState('networkidle');
      await page.getByRole('button', { name: s['showTable']! }).first().click();
      const cell = page.locator('tbody th').filter({
        hasText: new RegExp(locale === 'ar' ? '[\\u0600-\\u06ff]' : 'Bordj'),
      });
      await expect(cell.first()).toBeVisible();
      await cell.first().scrollIntoViewIfNeeded();
      await check(`stats-${dimension.slice(4)}`, locale);
    }
  });
}
