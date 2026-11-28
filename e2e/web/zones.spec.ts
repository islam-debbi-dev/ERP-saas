/**
 * Field teams on screen (phase 40b): the two new roles in the users form, the BY_ZONE
 * setting, the zones screen and its refusals, moving a seller, the clients without a
 * commune, and what a pre-seller's menu and screens leave out. In Arabic (RTL) and French,
 * at the width of the project (393 px on `mobile`, 360 px on `mobile-360`, 1280 px on
 * `desktop`). Nothing scrolls sideways, and what is saved is read back from the API.
 */
import { expect, test, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildFixture, uniq, type Fixture } from '../api/fixture.ts';
import { call, idemKey } from '../lib/http.ts';
import { totp } from '../lib/totp.ts';
import { expectNoHorizontalOverflow } from './mobile-helpers.ts';

const WEB = process.env['WEB'] ?? 'http://localhost:3005';
const PASSWORD = 'Audit1234!';
const SHOTS_DIR =
  process.env['SHOTS_DIR'] ?? fileURLToPath(new URL('../artifacts/mobile/', import.meta.url));
const MESSAGES_DIR = fileURLToPath(new URL('../../apps/web/src/messages/', import.meta.url));
const ADMIN_FILE = fileURLToPath(new URL('../.auth/admin.json', import.meta.url));

type Locale = 'ar' | 'fr';
type Labels = Record<string, Record<string, string>>;
const labels = (locale: Locale): Labels =>
  JSON.parse(readFileSync(join(MESSAGES_DIR, `${locale}.json`), 'utf8')) as Labels;

/** Wilaya 38 (Tissemsilt): the area and its city. Bou Saada (wilaya 68) lies outside. */
const WILAYA = 38;
const INSIDE = { code: 3809, fr: 'Bordj El Emir Abdelkader', ar: 'برج الامير عبد القادر' };

interface Staff {
  id: string;
  name: string;
  email: string;
}
interface Zone {
  id: string;
  name: string;
  kind: 'AREA' | 'CITY';
  parentZoneId: string | null;
  wilayaCodes: number[];
  communeCodes: number[];
  responsible: { id: string } | null;
  version: number;
}

let fixture: Fixture;
let context: BrowserContext;
let page: Page;
let chef: Staff;
let supervisor: Staff;
let seller: Staff;
let preSeller: Staff;
let area: Zone;
let city: Zone;

const token = () => fixture.session.token;
const api = async <T>(path: string, method = 'GET', body?: unknown) =>
  (
    await call<T>(path, {
      method: method as 'GET',
      token: token(),
      body,
      ...(method === 'POST' ? { idempotencyKey: idemKey('z') } : {}),
    })
  ).body;

/** The trial edition stops at five users: the super-admin of the global setup lifts it. */
async function liftLimits(tenantId: string): Promise<void> {
  const admin = JSON.parse(readFileSync(ADMIN_FILE, 'utf8')) as {
    email: string;
    password: string;
    secret: string;
  };
  for (let attempt = 0; ; attempt++) {
    try {
      const login = await call<{ accessToken: string }>('/admin/auth/login', {
        method: 'POST',
        body: { email: admin.email, password: admin.password, code: totp(admin.secret) },
      });
      await call(`/admin/tenants/${tenantId}/subscription`, {
        method: 'PATCH',
        token: login.body.accessToken,
        body: { isFree: true, edition: 'ENTREPRISE' },
      });
      return;
    } catch (err) {
      // A TOTP code is accepted once: wait for the next one.
      if (attempt >= 2) throw err;
      await new Promise((resolve) => setTimeout(resolve, 31_000));
    }
  }
}

async function invite(role: string, name: string, managerId: string | null): Promise<Staff> {
  const email = `${uniq('z')}@audit.local`;
  const fullName = `${name} ${uniq('')}`;
  const invited = await api<{ user: { id: string }; inviteUrl: string }>('/users/invite', 'POST', {
    fullName,
    email,
    role,
    managerId,
    mode: 'LINK',
  });
  await call(`/auth/invitations/${invited.inviteUrl.split('/').pop()!}/accept`, {
    method: 'POST',
    body: { password: PASSWORD },
    headers: { 'X-Client-Type': 'native' },
  });
  return { id: invited.user.id, name: fullName, email };
}

async function signIn(browser: Browser, email: string, use: Record<string, unknown>) {
  const { viewport, userAgent, deviceScaleFactor, isMobile, hasTouch } = use as never;
  const ctx = await browser.newContext({
    viewport,
    userAgent,
    deviceScaleFactor,
    isMobile,
    hasTouch,
    baseURL: WEB,
    storageState: { cookies: [], origins: [] },
  });
  await ctx.addCookies([{ name: 'NEXT_LOCALE', value: 'fr', url: WEB }]);
  const tab = await ctx.newPage();
  await tab.goto('/login');
  await tab.waitForLoadState('networkidle');
  await tab.locator('#identifier').fill(email);
  await tab.locator('#password').fill(PASSWORD);
  await tab.getByRole('button', { name: labels('fr')['auth']!['login']! }).click();
  await tab.waitForURL(/\/(tableau-de-bord|vue-ensemble)/);
  return { context: ctx, page: tab };
}

test.beforeAll(async ({ browser }, info) => {
  test.setTimeout(180_000);
  mkdirSync(SHOTS_DIR, { recursive: true });
  fixture = await buildFixture('Zones audit', 'DISTRIBUTEUR');
  await liftLimits(fixture.session.tenantId);
  chef = await invite('AREA_MANAGER', 'Chef de zone', null);
  supervisor = await invite('SUPERVISOR', 'Superviseur', chef.id);
  seller = await invite('SELLER', 'Vendeur', supervisor.id);
  preSeller = await invite('PREVENDEUR', 'Prevendeur', supervisor.id);
  area = await api<Zone>('/field-zones', 'POST', {
    name: 'Zone Tissemsilt',
    kind: 'AREA',
    wilayaCodes: [WILAYA],
    responsibleUserId: chef.id,
  });
  city = await api<Zone>('/field-zones', 'POST', {
    name: 'Ville Bordj',
    kind: 'CITY',
    parentZoneId: area.id,
    communeCodes: [INSIDE.code],
    responsibleUserId: supervisor.id,
  });
  ({ context, page } = await signIn(browser, fixture.session.email, info.project.use));
});

test.afterAll(async () => {
  await context?.close();
});

const setLocale = (locale: Locale, on: BrowserContext = context) =>
  on.addCookies([{ name: 'NEXT_LOCALE', value: locale, url: WEB }]);

async function open(path: string, on: Page = page): Promise<void> {
  await on.goto(path);
  await on.locator('h1').first().waitFor();
  await on.waitForLoadState('networkidle');
}

async function check(name: string, locale: Locale, on: Page = page): Promise<void> {
  await on.evaluate(() => document.fonts.ready);
  // The sheet and dialog entry animations.
  await on.waitForTimeout(600);
  await expectNoHorizontalOverflow(on, { soft: true });
  const width = on.viewportSize()!.width;
  await on.screenshot({ path: join(SHOTS_DIR, `zones-${name}-${locale}-${width}.png`) });
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** A closed picker field: its accessible name is "label value". */
const field = (label: string, on: Page = page) =>
  on.getByRole('button', { name: new RegExp(`^${escape(label)} `) }).last();
const dialog = (on: Page = page) => on.getByRole('dialog').last();

/** Picks one row in a picker that is open. */
async function pickRow(search: string, text: string, on: Page = page): Promise<void> {
  await dialog(on).getByRole('searchbox').fill(search);
  await dialog(on).getByRole('button', { name: text }).first().click();
}

/** The main action is on screen without scrolling sideways. */
async function expectActionVisible(name: string, on: Page = page): Promise<void> {
  const button = on.getByRole('button', { name, exact: true }).last();
  await expect(button).toBeVisible();
  const box = (await button.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(on.viewportSize()!.width);
}

/** The whole refusal is on screen: not partly under the dialog's sticky footer. */
async function expectAboveFooter(refusal: Locator, on: Page = page): Promise<void> {
  await expect(refusal).toBeInViewport({ ratio: 1 });
  const footer = dialog(on).locator('[data-slot="dialog-footer"]');
  await expect
    .poll(async () => {
      const [box, bar] = [await refusal.boundingBox(), await footer.boundingBox()];
      return Math.round(box!.y + box!.height - bar!.y);
    })
    .toBeLessThanOrEqual(1);
}

const options = (selector: string) => page.locator(`${selector} option`).allTextContents();

for (const locale of ['ar', 'fr'] as const) {
  test(`users form: the two new roles and who they report to, ${locale}`, async () => {
    const m = labels(locale);
    const u = m['users']!;
    const r = m['roles']!;
    await setLocale(locale);
    await open('/parametres/utilisateurs');
    await page.getByRole('button', { name: u['invite']!, exact: true }).first().click();
    await expect(page.locator('#invite-role')).toBeVisible();
    expect(await options('#invite-role')).toEqual(
      expect.arrayContaining([r['AREA_MANAGER']!, r['PREVENDEUR']!]),
    );

    // A pre-seller may report to a supervisor or a chef de zone.
    await page.locator('#invite-role').selectOption('PREVENDEUR');
    await expect(page.getByText(u['roleHelp_PREVENDEUR']!)).toBeVisible();
    await page.locator('#invite-manager').selectOption(supervisor.id);
    await check('users-invite-prevendeur', locale);

    // A chef de zone reports to the office only: the supervisor is dropped and not offered.
    await page.locator('#invite-role').selectOption('AREA_MANAGER');
    await expect(page.locator('#invite-manager')).toHaveValue('');
    const bosses = await options('#invite-manager');
    expect(bosses.join()).not.toContain(supervisor.name);
    expect(bosses.join()).not.toContain(chef.name);
    const office = (await api<{ role: string }[]>('/users')).filter(
      (x) => x.role === 'OWNER' || x.role === 'MANAGER',
    );
    // Those, and "nobody".
    expect(bosses).toHaveLength(office.length + 1);
    await check('users-invite-area-manager', locale);

    const name = uniq(`Invite ${locale} `);
    await page.locator('#invite-name').fill(name);
    await page.locator('#invite-email').fill(`${uniq('i')}@audit.local`);
    await expectActionVisible(u['invite']!);
    await page.getByRole('button', { name: u['invite']!, exact: true }).last().click();
    await expect(dialog().getByText(u['linkOnce']!)).toBeVisible();
    const users = await api<{ fullName: string; role: string }[]>('/users');
    expect(users.find((x) => x.fullName === name)?.role).toBe('AREA_MANAGER');
    await page.keyboard.press('Escape');

    await expect(page.getByRole('link', { name: new RegExp(escape(seller.name)) }).first())
      .toBeVisible();
    await check('users-list', locale);
  });

  test(`users edit: MANAGER_ROLE_NOT_ALLOWED in words, ${locale}`, async () => {
    const m = labels(locale);
    const u = m['users']!;
    const boss = await invite('MANAGER', `Gerant ${locale}`, null);
    await invite('AREA_MANAGER', `Chef sous gerant ${locale}`, boss.id);
    await setLocale(locale);
    await open('/parametres/utilisateurs');
    await page
      .getByRole('button', { name: u['actions']!.replace('{name}', boss.name) })
      .click();
    await page.getByRole('menuitem', { name: u['edit']!, exact: true }).click();
    // He cannot leave the office while a chef de zone reports to him.
    await page.locator('#edit-role').selectOption('SELLER');
    await page.getByRole('button', { name: u['save']!, exact: true }).click();
    await expect(dialog().getByRole('alert')).toContainText(
      m['errors']!['MANAGER_ROLE_NOT_ALLOWED']!,
    );
    await check('users-edit-refused', locale);
    await page.keyboard.press('Escape');
  });

  test(`settings: visibility by zone and its switch, ${locale}`, async () => {
    const m = labels(locale);
    const s = m['settings']!;
    const read = () =>
      api<{ sellerScope: string; zoneIncludesAssigned: boolean }>('/tenant/settings');
    await setLocale(locale);
    await open('/parametres');
    const scope = page.locator('#sellerScope');
    await scope.selectOption('ASSIGNED_ONLY');
    await expect(page.getByText(s['sellerScopeHelp_ASSIGNED_ONLY']!)).toBeVisible();
    await expect(page.locator('#zoneIncludesAssigned')).toHaveCount(0);
    await scope.selectOption('BY_ZONE');
    await expect(page.getByText(s['sellerScopeHelp_BY_ZONE']!)).toBeVisible();
    const toggle = page.locator('#zoneIncludesAssigned');
    await expect(toggle).toBeVisible();
    const was = await toggle.getAttribute('aria-checked');
    await toggle.click();
    await scope.scrollIntoViewIfNeeded();
    await check('settings-by-zone', locale);
    await page.locator('form button[type="submit"]').last().click();
    // Both together: the scope alone may already be BY_ZONE from the other language.
    await expect
      .poll(read)
      .toMatchObject({ sellerScope: 'BY_ZONE', zoneIncludesAssigned: was !== 'true' });
  });

  test(`zones: create, edit, refusals and delete, ${locale}`, async () => {
    const m = labels(locale);
    const z = m['zones']!;
    const tl = m['locations']!;
    const save = m['common']!['save']!;
    await setLocale(locale);
    await open('/zones');
    // By its title: a city's row names its area too.
    const zoneRow = (title: string) =>
      page
        .getByTestId('zone-row')
        .filter({ has: page.getByRole('heading', { name: title, exact: true }) });
    await expect(zoneRow(area.name)).toBeVisible();
    await check('zones-list', locale);

    const openNew = () => page.getByRole('button', { name: z['new']!, exact: true }).first().click();
    const pickCommune = async (wilaya: number, french: string, arabic: string) => {
      await field(z['communesOfWilaya']!).click();
      await pickRow(String(wilaya), `${wilaya} · `);
      await expect(field(tl['communes']!)).toBeEnabled();
      await field(tl['communes']!).click();
      await pickRow(french, locale === 'ar' ? arabic : french);
      await dialog().locator('[data-slot="dialog-footer"] button').click();
    };

    // A commune already in another city: the other zone and the commune are named.
    await openNew();
    await page.locator('#zone-name').fill(`Doublon ${locale}`);
    await pickCommune(WILAYA, INSIDE.fr, INSIDE.ar);
    await expectActionVisible(save);
    await page.getByRole('button', { name: save, exact: true }).click();
    const refusal = dialog().getByRole('alert');
    await expect(refusal).toContainText(city.name);
    await expect(refusal).toContainText(locale === 'ar' ? INSIDE.ar : INSIDE.fr);
    await expectAboveFooter(refusal);
    await check('zones-commune-taken', locale);

    // A city inside the area with a commune the area does not cover.
    await dialog()
      .getByRole('button', { name: new RegExp(escape(locale === 'ar' ? INSIDE.ar : INSIDE.fr)) })
      .last()
      .click();
    await pickCommune(68, 'Bou Saada', 'بوسعادة');
    await page.locator('#zone-parent').selectOption(area.id);
    await page.getByRole('button', { name: save, exact: true }).click();
    await expect(dialog().getByRole('alert')).toContainText(area.name);
    await expectAboveFooter(dialog().getByRole('alert'));
    await check('zones-not-inside-area', locale);

    // Without the parent it is a free city.
    await page.locator('#zone-parent').selectOption('');
    const name = `Ville ${locale} ${uniq('')}`;
    await page.locator('#zone-name').fill(name);
    await page.locator('#zone-responsible').selectOption(supervisor.id);
    await page.locator('#zone-name').scrollIntoViewIfNeeded();
    await check('zones-form', locale);
    await page.getByRole('button', { name: save, exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const created = (await api<Zone[]>('/field-zones')).find((x) => x.name === name)!;
    expect(created).toMatchObject({ kind: 'CITY', parentZoneId: null });
    expect(created.responsible?.id).toBe(supervisor.id);

    // Someone else saves while the form is open: conflict, then reload.
    await page.getByRole('button', { name: z['editNamed']!.replace('{name}', name) }).click();
    await expect(page.locator('#zone-name')).toHaveValue(name);
    const theirs = `${name} bis`;
    await api(`/field-zones/${created.id}`, 'PUT', {
      name: theirs,
      kind: 'CITY',
      parentZoneId: null,
      wilayaCodes: [],
      communeCodes: created.communeCodes,
      responsibleUserId: supervisor.id,
      version: created.version,
    });
    await page.getByRole('button', { name: save, exact: true }).click();
    await expect(dialog().getByRole('alert')).toContainText(z['conflict']!);
    await expectAboveFooter(dialog().getByRole('alert'));
    await check('zones-conflict', locale);
    await page.getByRole('button', { name: z['reload']!, exact: true }).click();
    await expect(page.locator('#zone-name')).toHaveValue(theirs);
    await page.getByRole('button', { name: save, exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    // An area with a city cannot be deleted; a free city can.
    const remove = async (target: string) => {
      await page.getByRole('button', { name: z['deleteNamed']!.replace('{name}', target) }).click();
      await page.getByRole('alertdialog').getByRole('button', { name: z['delete']! }).click();
    };
    await remove(area.name);
    const inUse = page.getByRole('alert').filter({ hasText: m['errors']!['ZONE_IN_USE']! });
    await expect(inUse).toBeInViewport();
    await check('zones-in-use', locale);
    await remove(theirs);
    await expect(zoneRow(theirs)).toHaveCount(0);
    expect((await api<Zone[]>('/field-zones')).some((x) => x.id === created.id)).toBe(false);
  });

  test(`seller zone: current, move and history, ${locale}`, async () => {
    const m = labels(locale);
    const t = m['memberZone']!;
    const tl = m['locations']!;
    const history = () =>
      api<{ current: { zone: { id: string } | null; communeCodes: number[] } | null; items: [] }>(
        `/users/${seller.id}/zone-assignments`,
      );
    const before = (await history()).items.length;
    await setLocale(locale);
    await open(`/equipe/${seller.id}`);
    await expect(page.locator('h1')).toContainText(seller.name);
    const move = () => page.getByRole('button', { name: t['move']!, exact: true }).click();

    await move();
    await page.locator('#move-zone').selectOption(city.id);
    await expectActionVisible(t['confirmMove']!);
    await check('member-move-zone', locale);
    await page.getByRole('button', { name: t['confirmMove']!, exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByTestId('current-zone')).toContainText(city.name);
    expect((await history()).current?.zone?.id).toBe(city.id);

    await move();
    await dialog().getByRole('radio', { name: t['mode_communes']! }).check();
    await field(m['zones']!['communesOfWilaya']!).click();
    await pickRow('68', '68 · ');
    await field(tl['communes']!).click();
    await pickRow('Bou Saada', locale === 'ar' ? 'بوسعادة' : 'Bou Saada');
    await dialog().locator('[data-slot="dialog-footer"] button').click();
    await check('member-move-communes', locale);
    await page.getByRole('button', { name: t['confirmMove']!, exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByTestId('current-zone')).toContainText(t['communesOnly']!);
    await expect(page.getByTestId('zone-history').locator('ol > li')).toHaveCount(
      before + 2,
    );
    await check('member-history', locale);
    expect((await history()).items).toHaveLength(before + 2);
  });

  test(`chef de zone: reads his zones, moves inside them only, ${locale}`, async ({
    browser,
  }, info) => {
    const m = labels(locale);
    const t = m['memberZone']!;
    const free = await api<Zone>('/field-zones', 'POST', {
      name: `Hors zone ${locale} ${uniq('')}`,
      kind: 'CITY',
      communeCodes: [locale === 'ar' ? 1601 : 1602],
    });
    const lead = await signIn(browser, chef.email, info.project.use);
    try {
      await setLocale(locale, lead.context);
      await open('/zones', lead.page);
      await expect(lead.page.getByTestId('zone-row')).toHaveCount(2);
      await expect(
        lead.page.getByRole('button', { name: m['zones']!['new']!, exact: true }),
      ).toHaveCount(0);
      await expect(lead.page.getByText(free.name)).toHaveCount(0);
      await check('lead-zones', locale, lead.page);

      await open(`/equipe/${seller.id}`, lead.page);
      await lead.page.getByRole('button', { name: t['move']!, exact: true }).click();
      await expect(dialog(lead.page).getByText(t['ownOnly']!)).toBeVisible();
      const offered = await lead.page.locator('#move-zone option').allTextContents();
      expect(offered).toContain(city.name);
      expect(offered).not.toContain(free.name);
      await lead.page.locator('#move-zone').selectOption(city.id);
      await check('lead-move', locale, lead.page);

      // The office takes the area away while the dialog is open: the API refuses.
      const now = (await api<Zone[]>('/field-zones')).find((x) => x.id === area.id)!;
      const give = (version: number, responsibleUserId: string | null) =>
        api<Zone>(`/field-zones/${area.id}`, 'PUT', {
          name: now.name,
          kind: 'AREA',
          wilayaCodes: now.wilayaCodes,
          communeCodes: now.communeCodes,
          responsibleUserId,
          version,
        });
      const without = await give(now.version, null);
      try {
        await lead.page.getByRole('button', { name: t['confirmMove']!, exact: true }).click();
        const refusal = dialog(lead.page).getByRole('alert').last();
        await expect(refusal).toContainText(m['errors']!['ZONE_OUTSIDE_SCOPE']!);
        await expectAboveFooter(refusal, lead.page);
        await check('lead-outside-scope', locale, lead.page);
      } finally {
        await give(without.version, chef.id);
      }
    } finally {
      await lead.context.close();
    }
  });

  test(`clients without a commune: count, list and fix, ${locale}`, async () => {
    const m = labels(locale);
    const w = m['withoutCommune']!;
    const name = `AAA sans commune ${locale} ${uniq('')}`;
    const created = await api<{ id: string }>('/clients', 'POST', {
      code: uniq('S-'),
      name,
      type: 'PARTICULIER',
      commune: 'texte ancien non reconnu, quartier des anciens moudjahidine',
      assignedSellerId: seller.id,
    });
    const total = async () => (await api<{ total: number }>('/clients/without-commune')).total;
    const before = await total();
    await setLocale(locale);
    await open('/clients');
    const card = page.locator('a[href="/clients/sans-commune"]');
    await expect(card).toContainText(String(before));
    await check('clients-card', locale);
    await card.click();
    await page.waitForURL(/\/clients\/sans-commune$/);
    const row = page.getByTestId('without-commune-row').filter({ hasText: name });
    await expect(row).toBeVisible();
    await check('without-commune-list', locale);

    await row.getByRole('link', { name: w['fixNamed']!.replace('{name}', name) }).click();
    await page.waitForURL(new RegExp(`/clients/${created.id}/modifier\\?champ=commune$`));
    const fields = page.getByTestId('client-location-fields');
    await expect(fields.getByRole('button').first()).toBeFocused();
    await expect(fields.getByRole('button').first()).toBeInViewport();
    await check('without-commune-form', locale);

    await field(m['locations']!['wilaya']!).click();
    await pickRow(String(WILAYA), `${WILAYA} · `);
    await field(m['locations']!['commune']!).click();
    await pickRow(INSIDE.fr, locale === 'ar' ? INSIDE.ar : INSIDE.fr);
    await page.getByRole('button', { name: m['common']!['save']!, exact: true }).click();
    await page.waitForURL(new RegExp(`/clients/${created.id}$`));
    expect(await total()).toBe(before - 1);
  });

  test(`pre-seller: commandes only, ${locale}`, async ({ browser }, info) => {
    const m = labels(locale);
    const tt = m['tournees']!;
    await api(`/users/${preSeller.id}/zone-assignment`, 'POST', { zoneId: city.id });
    const client = await api<{ id: string; name: string }>('/clients', 'POST', {
      code: uniq('PV-'),
      name: `Client prevente ${locale} ${uniq('')}`,
      type: 'PARTICULIER',
      wilayaCode: WILAYA,
      communeCode: INSIDE.code,
    });
    const route = await api<{ id: string }>('/routes', 'POST', {
      name: `Prevente ${locale} ${uniq('')}`,
      sellerId: preSeller.id,
      weekdays: [0, 1, 2, 3, 4, 5, 6],
    });
    await api(`/routes/${route.id}/stops`, 'PUT', { clientIds: [client.id] });

    const pv = await signIn(browser, preSeller.email, info.project.use);
    const tab = pv.page;
    try {
      await setLocale(locale, pv.context);
      await open('/tableau-de-bord', tab);
      const forbidden = ['/ventes', '/versements', '/livraisons', '/stock', '/achats'];
      for (const path of forbidden) {
        await expect(tab.locator(`a[href^="${path}"]`), path).toHaveCount(0);
      }
      await check('prevendeur-dashboard', locale, tab);
      if (tab.viewportSize()!.width < 768) {
        await tab.getByRole('button', { name: m['nav']!['toggleSidebar']! }).first().click();
      }
      const menu = tab.getByRole('navigation').or(tab.getByRole('dialog')).first();
      await expect(menu.locator('a[href="/tournees/aujourdhui"]').first()).toBeVisible();
      await expect(tab.locator('a[href="/commandes"]').first()).toBeVisible();
      await expect(tab.locator('a[href="/clients"]').first()).toBeVisible();
      for (const path of [...forbidden, '/zones', '/tresorerie']) {
        await expect(tab.locator(`a[href^="${path}"]`), path).toHaveCount(0);
      }
      await check('prevendeur-menu', locale, tab);

      await open('/tournees/aujourdhui', tab);
      // This run's stop: the other language's route is there too.
      const stop = tab.locator('ol > li').filter({ hasText: client.name });
      await expect(stop).toBeVisible();
      await expect(stop.getByRole('button', { name: tt['actionOrder']! })).toBeVisible();
      await expect(stop.getByRole('button', { name: tt['actionVisit']! })).toBeVisible();
      await expect(tab.getByRole('link', { name: tt['actionSale']!, exact: true })).toHaveCount(0);
      await expect(tab.getByRole('button', { name: tt['actionPayment']!, exact: true })).toHaveCount(
        0,
      );
      await check('prevendeur-today', locale, tab);
      await stop.getByRole('button', { name: tt['actionVisit']! }).click();
      await expect(dialog(tab).getByRole('radio')).toHaveCount(2);
      await check('prevendeur-visit', locale, tab);
      await tab.keyboard.press('Escape');

      await open(`/clients/${client.id}`, tab);
      await expect(
        tab.getByRole('button', { name: m['clients']!['newPayment']!, exact: true }),
      ).toHaveCount(0);
      await expect(tab.locator('a[href^="/ventes"], a[href^="/versements"]')).toHaveCount(0);
      await check('prevendeur-client', locale, tab);

      await tab.goto('/ventes');
      await expect(tab.getByText(m['nav']!['forbiddenTitle']!)).toBeVisible();
      await check('prevendeur-forbidden', locale, tab);
    } finally {
      await pv.context.close();
    }
  });
}
