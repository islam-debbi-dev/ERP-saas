/**
 * Test 36, part E: vehicle-first distribution in a real browser, on a phone first.
 *
 *   WEB=http://localhost:3005 API=http://localhost:3003 DB=…/erp_t36 pnpm test:vehicles:web
 *
 * Projects (vehicles.playwright.config.ts): 360 and 393 px in `ar` (RTL) and `fr`, 1280 px
 * in `fr`. Each project has its own company (vehicles-data.ts). The tests of one project run
 * in file order and build on each other (the driver moved in one test is the driver the
 * next one reads), so run the whole file.
 *
 * A failing `expect.soft` is a finding: REPORT-36.md, section 13, names each of them.
 * Screenshots of every state go to artifacts/test-36/web/.
 */
import { type Browser, type BrowserContext, expect, type Locator, type Page, test as base, type TestInfo } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { request as api } from '../lib/http.ts';
import { overflowProblems } from './mobile-helpers.ts';
import { CODES, PASSWORD, PLATE, prepare, runId, type UiData, type UiUser } from './vehicles-data.ts';

const WEB = process.env['WEB'] ?? 'http://localhost:3005';
type Lang = 'ar' | 'fr' | 'en';
type Messages = Record<string, Record<string, string>>;
const messages = (lang: string): Messages =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`../../apps/web/src/messages/${lang}.json`, import.meta.url)), 'utf8')) as Messages;
const SHOTS = fileURLToPath(new URL('../artifacts/test-36/web/', import.meta.url));
mkdirSync(SHOTS, { recursive: true });

const langOf = (info: TestInfo): 'ar' | 'fr' => (info.project.metadata as { lang: 'ar' | 'fr' }).lang;

/** `{count, plural, one {# x} other {# y}}` and `{name}` as next-intl would render them. */
function msg(text: string, values: Record<string, string | number> = {}, lang = 'fr'): string {
  const plural = /\{(\w+), plural,((?:\s*(?:=\d+|\w+) \{[^{}]*\})+)\s*\}/g;
  let out = text.replace(plural, (_all, name: string, body: string) => {
    const n = Number(values[name]);
    const forms = Object.fromEntries([...body.matchAll(/(=\d+|\w+) \{([^{}]*)\}/g)].map((m) => [m[1]!, m[2]!]));
    const picked = forms[`=${n}`] ?? forms[new Intl.PluralRules(lang).select(n)] ?? forms['other'] ?? '';
    return picked.replace(/#/g, String(n));
  });
  for (const [k, v] of Object.entries(values)) out = out.replaceAll(`{${k}}`, String(v));
  return out;
}

interface Session {
  context: BrowserContext;
  page: Page;
  /** Uncaught page errors and API answers of 500 and more, seen since the sign-in. */
  problems: string[];
  stateFile: string;
}

/**
 * A context of the project's screen, signed in through the login screen. The session is kept
 * in `.auth/` for the run: Playwright starts a new worker after every failed test, and the
 * login limiter allows ten logins a minute per address.
 */
async function signIn(browser: Browser, info: TestInfo | { project: TestInfo['project'] }, user: UiUser, lang: Lang): Promise<Session> {
  const u = info.project.use;
  const stateFile = fileURLToPath(new URL(`../.auth/vehicles-state-${info.project.name}-${lang}-${user.id}-${runId()}.json`, import.meta.url));
  const make = async (withState: boolean): Promise<Session> => {
    const context = await browser.newContext({
      viewport: u.viewport,
      screen: u.screen,
      userAgent: u.userAgent,
      deviceScaleFactor: u.deviceScaleFactor,
      isMobile: u.isMobile,
      hasTouch: u.hasTouch,
      baseURL: WEB,
      locale: lang,
      ...(withState ? { storageState: stateFile } : {}),
    });
    // No map tile ever leaves the machine (ground rules), as in test 35.
    await context.route(/tile\.openstreetmap\.org/, (r) => r.fulfill({ status: 204, body: '' }));
    await context.addCookies([{ name: 'NEXT_LOCALE', value: lang, url: WEB }]);
    const page = await context.newPage();
    const problems: string[] = [];
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
    page.on('response', (r) => {
      if (r.status() >= 500) problems.push(`HTTP ${r.status()} ${r.request().method()} ${r.url()}`);
    });
    return { context, page, problems, stateFile };
  };
  if (existsSync(stateFile)) {
    const s = await make(true);
    await s.page.goto(`${WEB}/stock`);
    await s.page.waitForLoadState('networkidle');
    if (!s.page.url().includes('/login')) return s;
    await s.context.close(); // the saved session is dead: sign in below
  }
  const s = await make(false);
  for (let attempt = 0; ; attempt++) {
    await s.page.goto(`${WEB}/login`);
    await s.page.locator('#identifier').fill(user.email);
    await s.page.locator('#password').fill(PASSWORD);
    await s.page.locator('form button[type="submit"]').click();
    try {
      await s.page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 15_000 });
      break;
    } catch (err) {
      // The login limiter (ten a minute per address) is the usual reason.
      if (attempt >= 2) throw err;
      await s.page.waitForTimeout(61_000);
    }
  }
  await s.page.waitForLoadState('networkidle');
  s.problems.length = 0;
  await s.context.storageState({ path: stateFile });
  return s;
}

/** Keeps the live session (the refresh token rotates) for the next worker, then closes. */
async function signOff(s: Session): Promise<void> {
  await s.context.storageState({ path: s.stateFile }).catch(() => undefined);
  await s.context.close();
}

interface Worker {
  data: UiData;
  owner: Session;
}

const test = base.extend<
  { m: Messages; lang: 'ar' | 'fr'; shot: (target: Page | Locator, name: string) => Promise<void>; as: (user: UiUser) => Promise<Session> },
  { w: Worker }
>({
  w: [
    async ({ browser }, use, info) => {
      const lang = (info.project.metadata as { lang: 'ar' | 'fr' }).lang;
      const data = await prepare(info.project.name);
      const owner = await signIn(browser, { project: info.project }, data.owner, lang);
      await use({ data, owner });
      await signOff(owner);
    },
    { scope: 'worker', timeout: 300_000 },
  ],
  lang: async ({}, use, info) => {
    await use(langOf(info));
  },
  m: async ({}, use, info) => {
    await use(messages(langOf(info)));
  },
  shot: async ({}, use, info) => {
    await use(async (target, name) => {
      // CSS pixels, not device pixels: the proofs stay small in git.
      await target.screenshot({ path: `${SHOTS}${info.project.name}-${name}.png`, scale: 'css', animations: 'disabled' });
    });
  },
  as: async ({ browser }, use, info) => {
    const opened: Session[] = [];
    await use(async (user) => {
      const s = await signIn(browser, info, user, langOf(info));
      opened.push(s);
      return s;
    });
    for (const s of opened) await signOff(s);
  },
});

// Room for the wait the login limiter can ask for.
test.setTimeout(300_000);

test.afterEach(async ({ w }) => {
  expect.soft(w.owner.problems.splice(0), 'page errors or HTTP 5xx during the test').toEqual([]);
});

const isPhone = (page: Page): boolean => (page.viewportSize()?.width ?? 0) < 768;

async function open(page: Page, path: string): Promise<void> {
  await page.goto(`${WEB}${path}`);
  await page.waitForLoadState('networkidle');
}

/** A raw message key on screen (`vehicles.noDriver`) means a missing translation. */
async function rawKeys(page: Page): Promise<string[]> {
  const text = await page.evaluate(() => document.body.innerText);
  return [...new Set(text.match(/\b(?:vehicles|vehicleTypes|tournees|orders|users|common|errors|nav|stock|units)\.[a-zA-Z][\w]*(?:\.[\w]+)*/g) ?? [])];
}

/** The page rules every screen is held to: no sideways scroll, no raw key. */
async function pageRules(page: Page, what: string): Promise<void> {
  expect.soft(await overflowProblems(page), `${what}: horizontal overflow`).toEqual([]);
  expect.soft(await rawKeys(page), `${what}: raw message keys`).toEqual([]);
}

/** Tab stays inside the open dialog. */
async function focusStaysIn(page: Page, dialog: Locator): Promise<boolean> {
  for (let i = 0; i < 25; i++) {
    await page.keyboard.press('Tab');
    if (!(await dialog.evaluate((el) => el.contains(document.activeElement)))) return false;
  }
  return true;
}

/** docs/ui.md rule 3 and 5 inside a sheet: fields 44 px tall with a 16 px font, the main action in view. */
async function sheetRules(page: Page, dialog: Locator, what: string): Promise<void> {
  expect.soft(await focusStaysIn(page, dialog), `${what}: Tab leaves the sheet`).toBe(true);
  if (!isPhone(page)) return;
  const small = await dialog.evaluate((el) => {
    const out: string[] = [];
    for (const f of Array.from(el.querySelectorAll<HTMLElement>('input:not([type=radio]):not([type=checkbox]), select, textarea, button'))) {
      const r = f.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const font = parseFloat(getComputedStyle(f).fontSize);
      const field = f.tagName !== 'BUTTON';
      const name = f.id || f.getAttribute('aria-label') || f.textContent?.trim().slice(0, 30) || f.tagName;
      if (r.height < 43.5) out.push(`${name}: ${Math.round(r.height)} px tall`);
      if (field && font < 16) out.push(`${name}: font ${font} px`);
    }
    return out;
  });
  expect.soft(small, `${what}: fields and buttons under 44 px or 16 px`).toEqual([]);
  const submit = dialog.locator('[data-slot="dialog-footer"] button[type="submit"]');
  if ((await submit.count()) > 0) {
    await expect.soft(submit, `${what}: the main action is not on screen while the sheet is open`).toBeInViewport({ ratio: 1, timeout: 3_000 });
  }
}

async function escapeCloses(page: Page, dialog: Locator, what: string): Promise<void> {
  await page.keyboard.press('Escape');
  await expect.soft(dialog, `${what}: Escape does not close`).toBeHidden({ timeout: 5_000 });
  if (await dialog.isVisible()) await dialog.getByRole('button', { name: /Annuler|إلغاء|Cancel/ }).first().click();
}

interface CodeLayout {
  where: string;
  parts: { text: string; left: number; top: number }[];
  /** Parts on one line, each to the right of the one typed before it. */
  ordered: boolean;
  wrapped: boolean;
  /** The box that truncates the code hides part of it. */
  clipped: boolean;
  /** Part of the code itself falls outside the box that truncates it: it cannot be read. */
  cut: boolean;
  isolated: boolean;
}

/** Where a code is drawn on the page, part by part (`VAN-28`, `MXT`, `01`), with real glyph positions. */
async function codeLayouts(scope: Page | Locator, code: string): Promise<CodeLayout[]> {
  const root = 'locator' in scope && 'goto' in scope ? scope.locator('body') : (scope as Locator);
  return root.evaluate((rootEl, c) => {
    const parts = [...c.matchAll(/[^\s\-/]+/g)].map((m) => ({ text: m[0], at: m.index }));
    const out: CodeLayout[] = [];
    const walker = document.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const text = n.nodeValue ?? '';
      const from = text.indexOf(c);
      const el = n.parentElement;
      if (from < 0 || !el || el.closest('option, script, style, [data-sonner-toaster]')) continue;
      const box = el.getBoundingClientRect();
      if (box.width <= 1 || box.height <= 1 || getComputedStyle(el).visibility === 'hidden') continue;
      const drawn = parts.map((p) => {
        const r = document.createRange();
        r.setStart(n, from + p.at);
        r.setEnd(n, from + p.at + p.text.length);
        const b = r.getBoundingClientRect();
        return { text: p.text, left: Math.round(b.left * 10) / 10, top: Math.round(b.top) };
      });
      const wrapped = drawn.some((d) => Math.abs(d.top - drawn[0]!.top) > 4);
      const ordered = wrapped || drawn.every((d, i) => i === 0 || d.left > drawn[i - 1]!.left);
      const truncating = el.closest<HTMLElement>('.truncate');
      const clipped = !!truncating && truncating.scrollWidth > truncating.clientWidth + 1;
      const whole = document.createRange();
      whole.setStart(n, from);
      whole.setEnd(n, from + c.length);
      const codeBox = whole.getBoundingClientRect();
      const frame = truncating?.getBoundingClientRect();
      const cut = !!frame && clipped && (codeBox.left < frame.left - 1 || codeBox.right > frame.right + 1);
      const before = text.charCodeAt(from - 1);
      const isolated = el.tagName === 'BDI' || getComputedStyle(el).unicodeBidi.includes('isolate') || before === 0x2066;
      const holder = el.closest('[data-testid], [role="dialog"], [role="alertdialog"], [role="alert"], h1, h2, li, p');
      const where = holder
        ? `${holder.getAttribute('data-testid') ?? holder.getAttribute('role') ?? holder.tagName.toLowerCase()} > ${el.tagName.toLowerCase()}`
        : el.tagName.toLowerCase();
      out.push({ where, parts: drawn, ordered, wrapped, clipped, cut, isolated });
    }
    return out;
  }, code) as Promise<CodeLayout[]>;
}

const toast = (page: Page, text: string): Locator => page.locator('[data-sonner-toast]', { hasText: text });
const card = (page: Page, code: string): Locator => page.locator('[data-testid="vehicle-cards"] > li', { hasText: code });
/** The isolates `vehicleLabel` puts around a code inside plain text. */
const iso = (code: string): string => `⁦${code}⁩`;

// ------------------------------------------------------------------ empty states

test('empty company: types, vehicles and tournées say what to do, with the field examples', async ({ w, m, as, shot }) => {
  const { page, problems } = await as(w.data.empty.owner);
  await open(page, '/parametres/types-vehicules');
  await expect(page.getByText(m['vehicleTypes']!['emptyTitle']!)).toBeVisible();
  const examples = await page.getByText(m['vehicleTypes']!['emptyDescription']!).innerText();
  for (const code of ['MXT', 'SELF/MT', 'MIX']) expect.soft(examples, `the empty state names ${code}`).toContain(code);
  await shot(page, 'types-vide');
  await pageRules(page, 'types, empty');

  await open(page, '/stock/vehicules');
  await expect(page.getByText(m['vehicles']!['emptyTitle']!)).toBeVisible();
  await expect.soft(page.getByText(m['vehicles']!['emptyDescription']!)).toBeVisible();
  for (const l of await codeLayouts(page, CODES.van)) expect.soft(l.ordered, `"${CODES.van}" inside the empty-state sentence: ${JSON.stringify(l.parts)}`).toBe(true);
  await shot(page, 'vehicules-vide');
  await pageRules(page, 'vehicles, empty');

  await open(page, '/tournees');
  await expect(page.getByText(m['tournees']!['emptyTitle']!)).toBeVisible();
  // With no truck the form still opens on "Véhicule" and says there is none.
  await page.getByRole('button', { name: m['tournees']!['newRoute']! }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.locator('#route-vehicle')).toBeVisible();
  await expect.soft(dialog.getByText(m['vehicles']!['noVehicles']!)).toBeVisible();
  await shot(page, 'tournee-nouvelle-sans-vehicule');
  await pageRules(page, 'tournées, empty, new route sheet');
  expect.soft(problems, 'page errors or HTTP 5xx').toEqual([]);
});

// ------------------------------------------------------------------ types de véhicules

test('types de véhicules: list, form, archive refused while a truck uses the type', async ({ w, m, lang, shot }) => {
  const { page } = w.owner;
  const t = m['vehicleTypes']!;
  await open(page, '/parametres/types-vehicules');
  const rows = page.locator('main ul.divide-y > li');
  await expect(rows.filter({ hasText: 'SELF/MT' })).toBeVisible();
  // Five live types; HRC is archived and gone.
  await expect(rows).toHaveCount(5);
  await expect.soft(rows.filter({ hasText: 'HRC' })).toHaveCount(0);
  const mxt = rows.filter({ hasText: 'Gros + détail' });
  await expect.soft(mxt).toContainText(m['vehicles']!['activityCASH_VAN']!);
  await expect.soft(mxt).toContainText(msg(t['vehicleCount']!, { count: 3 }, lang));
  await expect.soft(mxt).toContainText('VAN');
  await expect.soft(rows.filter({ hasText: 'Type sans véhicule' })).toContainText(msg(t['vehicleCount']!, { count: 0 }, lang));
  await shot(page, 'types-liste');
  await pageRules(page, 'types, list');

  await page.getByRole('button', { name: t['new']!, exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.locator('#type-code')).toBeVisible();
  await shot(page, 'types-formulaire');
  await pageRules(page, 'types, form');
  await sheetRules(page, dialog, 'type form');
  await escapeCloses(page, dialog, 'type form');

  // Create one through the form.
  await page.getByRole('button', { name: t['new']!, exact: true }).click();
  await dialog.locator('#type-code').fill('E2E/36');
  await dialog.locator('#type-prefix').fill('E2E');
  await dialog.locator('#type-name').fill('Type créé par le test');
  await dialog.getByRole('radio').nth(2).check();
  await dialog.locator('button[type="submit"]').click();
  await expect(toast(page, t['created']!)).toBeVisible();
  await expect(rows.filter({ hasText: 'E2E/36' })).toContainText(m['vehicles']!['activityDELIVERY']!);

  // The same code in another case is refused with a sentence, not a code.
  await page.getByRole('button', { name: t['new']!, exact: true }).click();
  await dialog.locator('#type-code').fill('mxt');
  await dialog.locator('#type-name').fill('Doublon');
  await dialog.locator('button[type="submit"]').click();
  const refusedDuplicate = page.locator('[data-sonner-toast]').last();
  await expect(refusedDuplicate).toBeVisible();
  expect.soft(await refusedDuplicate.innerText(), 'the duplicate-code toast is a sentence').not.toMatch(/[A-Z]{3,}_[A-Z_]+/);
  await shot(page, 'types-code-pris');
  await dialog.getByRole('button', { name: m['common']!['cancel']! }).click();

  // Archive refused: MXT has trucks.
  await page.getByRole('button', { name: msg(t['archiveNamed']!, { name: 'MXT' }) }).click();
  const confirm = page.getByRole('alertdialog');
  await expect(confirm).toContainText(t['archiveBody']!);
  await shot(page, 'types-archiver-confirmation');
  await confirm.getByRole('button', { name: t['archive']! }).click();
  await expect(toast(page, m['errors']!['VEHICLE_TYPE_IN_USE']!)).toBeVisible();
  await shot(page, 'types-archivage-refuse');
  await expect(rows.filter({ hasText: 'Gros + détail' })).toBeVisible();

  // Archive accepted: no truck uses LIBRE.
  await page.getByRole('button', { name: msg(t['archiveNamed']!, { name: 'LIBRE' }) }).click();
  await confirm.getByRole('button', { name: t['archive']! }).click();
  await expect(toast(page, t['archived']!)).toBeVisible();
  await expect(rows.filter({ hasText: 'Type sans véhicule' })).toHaveCount(0);
});

// ------------------------------------------------------------------ véhicules

test('véhicules: cards (code big, type badge, wilaya, plate, driver of the day, "Changer") and filters', async ({ w, m, lang, shot }) => {
  const { page } = w.owner;
  const v = m['vehicles']!;
  await open(page, '/stock/vehicules');
  const cards = page.locator('[data-testid="vehicle-cards"] > li');
  await expect(cards).toHaveCount(8);
  await shot(page, 'vehicules-cartes');
  await page.screenshot({ path: `${SHOTS}${test.info().project.name}-vehicules-cartes-page.png`, fullPage: true, scale: 'css' });
  await pageRules(page, 'vehicles, cards');

  const van = card(page, CODES.van);
  const code = van.locator('bdi', { hasText: CODES.van }).first();
  const size = await code.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  const nameSize = await van.getByText("Camion M'sila").evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  expect.soft(size, 'the code is the biggest text of the card').toBeGreaterThanOrEqual(20);
  expect.soft(size).toBeGreaterThan(nameSize);
  await expect.soft(van).toContainText('MXT');
  await expect.soft(van).toContainText(v['activityCASH_VAN']!);
  await expect.soft(van).toContainText(lang === 'ar' ? 'المسيلة' : "M'Sila");
  await expect.soft(van).toContainText(PLATE);
  await expect.soft(van).toContainText(msg(v['capacityValue']!, { kg: 3500 }));
  await expect.soft(van.locator('[data-testid="vehicle-driver"]')).toHaveText('Karim Benali');
  await expect.soft(van.getByRole('button', { name: msg(v['changeDriverNamed']!, { name: CODES.van }) })).toHaveText(v['changeDriver']!);
  const plain = cards.filter({ hasText: 'Camion sans type' });
  await expect.soft(plain).toContainText(v['noType']!);
  await expect.soft(plain).toContainText(v['noWilaya']!);
  await expect.soft(plain.locator('[data-testid="vehicle-driver"]')).toHaveText(v['noDriver']!);

  // Filters: search by code, by plate; type; wilaya; dépôt.
  const search = page.getByRole('searchbox', { name: v['search']! });
  await search.fill('liv 28');
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toContainText(CODES.liv);
  await search.fill('00123-119');
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toContainText(CODES.van);
  await search.fill('zzz-aucun');
  await expect(page.getByText(v['noMatch']!)).toBeVisible();
  await shot(page, 'vehicules-filtre-aucun');
  await search.fill('');
  const typeFilter = page.getByRole('combobox', { name: v['filterType']! });
  const typeOptions = await typeFilter.locator('option').allInnerTexts();
  expect.soft(typeOptions.some((o) => o.includes('HRC')), 'the archived type is not offered as a filter').toBe(false);
  await typeFilter.selectOption(w.data.types['MIX']!);
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toContainText(CODES.liv);
  await shot(page, 'vehicules-filtre-type');
  await typeFilter.selectOption('');
  const wilayaFilter = page.getByRole('combobox', { name: v['filterWilaya']! });
  // Only the wilayas that have a truck: 05, 28, 34.
  expect.soft((await wilayaFilter.locator('option').allInnerTexts()).slice(1).map((o) => o.slice(0, 2))).toEqual(['05', '28', '34']);
  await wilayaFilter.selectOption('34');
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toContainText(CODES.self);
  await wilayaFilter.selectOption('');
  const depotFilter = page.getByRole('combobox', { name: v['filterDepot']! });
  await depotFilter.selectOption(w.data.depotBatnaId);
  await expect(cards).toHaveCount(3);
  await shot(page, 'vehicules-filtre-depot');
  await pageRules(page, 'vehicles, filtered');
});

test('véhicules: the form proposes the next code, keeps the archived type out, and saves', async ({ w, m, shot }) => {
  const { page } = w.owner;
  const v = m['vehicles']!;
  await open(page, '/stock/vehicules');
  await page.getByRole('button', { name: v['new']!, exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.locator('#vehicle-code')).toBeVisible();
  await pageRules(page, 'vehicle form');
  await sheetRules(page, dialog, 'vehicle form');

  const typeTexts = await dialog.locator('#vehicle-type option').allInnerTexts();
  expect.soft(typeTexts.some((o) => o.includes('HRC')), 'the archived type is not offered for a new truck').toBe(false);
  expect.soft(typeTexts.find((o) => o.includes('SELF/MT')), 'a type code inside an option is isolated').toContain(iso('SELF/MT'));
  const proposeButton = dialog.getByRole('button', { name: v['proposeCode']! });
  // Nothing chosen: only a number.
  await proposeButton.click();
  await expect.soft(dialog.locator('#vehicle-code')).toHaveValue('01');
  await dialog.locator('#vehicle-type').selectOption(w.data.types['MXT']!);
  await dialog.locator('#vehicle-wilaya').selectOption('28');
  await proposeButton.click();
  // VAN-28 MXT 01 is taken: the next free number.
  await expect(dialog.locator('#vehicle-code')).toHaveValue('VAN-28 MXT 02');
  await dialog.locator('#vehicle-type').selectOption(w.data.types['SELF/MT']!);
  await dialog.locator('#vehicle-wilaya').selectOption('34');
  await proposeButton.click();
  await expect.soft(dialog.locator('#vehicle-code')).toHaveValue('34 SELF/MT 01');
  await dialog.locator('#vehicle-type').selectOption(w.data.types['MXT']!);
  await dialog.locator('#vehicle-wilaya').selectOption('28');
  await proposeButton.click();
  await dialog.locator('#vehicle-name').fill('Camion créé par le test');
  await dialog.locator('#vehicle-plate').fill('11111-124-28');
  await dialog.locator('#vehicle-capacity').fill('1200');
  // The drivers offered are the ones without a truck.
  const driverTexts = await dialog.locator('#vehicle-driver option').allInnerTexts();
  expect.soft(driverTexts, 'a driver who already has a truck is not offered at creation').not.toContain('Karim Benali');
  expect.soft(driverTexts).toContain('Nadia Haddad');
  await shot(page, 'vehicule-formulaire');
  await page.keyboard.press('Escape');
  await expect.soft(dialog, 'vehicle form: Escape does not close').toBeHidden({ timeout: 5_000 });

  // Escape threw the typing away: fill again and save.
  await page.getByRole('button', { name: v['new']!, exact: true }).click();
  await dialog.locator('#vehicle-type').selectOption(w.data.types['MXT']!);
  await dialog.locator('#vehicle-wilaya').selectOption('28');
  await dialog.getByRole('button', { name: v['proposeCode']! }).click();
  await dialog.locator('#vehicle-name').fill('Camion créé par le test');
  await dialog.locator('#vehicle-plate').fill('11111-124-28');
  await dialog.locator('button[type="submit"]').click();
  await expect(toast(page, v['created']!)).toBeVisible();
  await expect(card(page, 'VAN-28 MXT 02')).toContainText('11111-124-28');

  // A code already used: a sentence, and the sheet stays open with the typing.
  await page.getByRole('button', { name: v['new']!, exact: true }).click();
  await dialog.locator('#vehicle-code').fill('van-28 mxt 01');
  await dialog.locator('#vehicle-name').fill('Doublon');
  await dialog.locator('button[type="submit"]').click();
  await expect(toast(page, m['errors']!['VEHICLE_CODE_TAKEN']!)).toBeVisible();
  await expect.soft(dialog.locator('#vehicle-name')).toHaveValue('Doublon');
  await shot(page, 'vehicule-code-pris');
  await dialog.getByRole('button', { name: m['common']!['cancel']! }).click();
});

test('véhicules: the driver sheet warns "already has a truck", moves the driver, and the history shows it', async ({ w, m, shot }) => {
  const { page } = w.owner;
  const v = m['vehicles']!;
  await open(page, '/stock/vehicules');
  await card(page, CODES.arabic).getByRole('button', { name: msg(v['changeDriverNamed']!, { name: CODES.arabic }) }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText(v['whoDrives']!);
  await expect(dialog).toContainText(CODES.arabic);
  await sheetRules(page, dialog, 'driver sheet');
  const submit = dialog.locator('button[type="submit"]');
  await expect.soft(submit, 'nothing to save until the driver changes').toBeDisabled();

  // Samir drives VAN34-SELF/MT: the sheet says so before anything is written.
  await dialog.locator('#driver-user').selectOption(w.data.samir.id);
  const warning = dialog.getByRole('alert');
  await expect(warning).toHaveText(msg(v['moveWarning']!, { driver: w.data.samir.fullName, vehicle: `${iso(CODES.self)} · Camion Bordj` }));
  await expect(submit).toHaveText(v['confirmMove']!);
  for (const l of await codeLayouts(page, CODES.self)) expect.soft(l.ordered, `"${CODES.self}" in the warning: ${JSON.stringify(l.parts)}`).toBe(true);
  await dialog.locator('#driver-reason').fill('Panne du VAN34');
  await shot(page, 'chauffeur-deja-un-camion');
  await pageRules(page, 'driver sheet');
  await submit.click();
  await expect(toast(page, v['driverSaved']!)).toBeVisible();
  await expect(dialog).toBeHidden();
  await expect(card(page, CODES.arabic).locator('[data-testid="vehicle-driver"]')).toHaveText(w.data.samir.fullName);
  await expect(card(page, CODES.self).locator('[data-testid="vehicle-driver"]')).toHaveText(v['noDriver']!);
  await shot(page, 'chauffeur-deplace');

  // The history of the truck he took, newest first.
  await card(page, CODES.arabic).getByRole('button', { name: v['history']! }).click();
  await expect(dialog).toContainText(msg(v['historyTitle']!, { name: `${iso(CODES.arabic)} · شاحنة الجملة` }));
  const lines = dialog.locator('ol > li');
  await expect(lines).toHaveCount(3);
  await expect.soft(lines.nth(0)).toContainText(w.data.samir.fullName);
  await expect.soft(lines.nth(0)).toContainText('Panne du VAN34');
  await expect.soft(lines.nth(0)).toContainText(msg(v['setBy']!, { name: w.data.owner.fullName }));
  await expect.soft(lines.nth(1)).toContainText(v['noDriver']!);
  await expect.soft(lines.nth(2)).toContainText('Farid Mansouri');
  await shot(page, 'vehicule-historique');
  await pageRules(page, 'history sheet');
  await sheetRules(page, dialog, 'history sheet');
  await escapeCloses(page, dialog, 'history sheet');

  // And the truck he left: he is closed, nobody after him.
  await card(page, CODES.self).getByRole('button', { name: v['history']! }).click();
  await expect(lines).toHaveCount(2);
  await expect.soft(lines.nth(0)).toContainText(v['noDriver']!);
  await expect.soft(lines.nth(1)).toContainText(w.data.samir.fullName);
  await escapeCloses(page, dialog, 'history sheet');
});

test('utilisateurs: "Véhicules conduits" follows the worker across trucks', async ({ w, m, shot }) => {
  const { page } = w.owner;
  const v = m['vehicles']!;
  await open(page, '/parametres/utilisateurs');
  await pageRules(page, 'users');
  await page.getByRole('button', { name: msg(m['users']!['actions']!, { name: w.data.samir.fullName }) }).filter({ visible: true }).first().click();
  await page.getByRole('menuitem', { name: m['users']!['vehiclesDriven']! }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText(msg(v['drivenNamed']!, { name: w.data.samir.fullName }));
  const periods = dialog.locator('[data-testid="driven-vehicles"] > li');
  await expect(periods).toHaveCount(2);
  // Newest first: the Arabic-code truck, still going; then VAN34-SELF/MT, closed.
  await expect.soft(periods.nth(0)).toContainText(CODES.arabic);
  await expect.soft(periods.nth(0)).toContainText(v['ongoing']!);
  await expect.soft(periods.nth(1)).toContainText(CODES.self);
  await expect.soft(periods.nth(1)).not.toContainText(v['ongoing']!);
  await expect.soft(periods.nth(1)).toContainText('Self + moderne');
  await expect.soft(periods.nth(1).getByRole('link')).toHaveAttribute('href', `/stock/vehicules?vehicle=${w.data.trucks.self.id}`);
  await shot(page, 'utilisateur-vehicules-conduits');
  await pageRules(page, 'driven vehicles sheet');
  await sheetRules(page, dialog, 'driven vehicles sheet');
  // The link lands on the truck, first and ringed.
  await periods.nth(1).getByRole('link').click();
  await page.waitForURL(/\/stock\/vehicules\?vehicle=/);
  await expect(page.locator('[data-testid="vehicle-cards"] > li').first()).toContainText(CODES.self);
  await shot(page, 'vehicule-ouvert-depuis-utilisateur');

  // A worker who never drove.
  await open(page, '/parametres/utilisateurs');
  await page.getByRole('button', { name: msg(m['users']!['actions']!, { name: w.data.nadia.fullName }) }).filter({ visible: true }).first().click();
  await page.getByRole('menuitem', { name: m['users']!['vehiclesDriven']! }).click();
  await expect(dialog).toContainText(v['drivenEmpty']!);
  await shot(page, 'utilisateur-aucun-vehicule');
  await escapeCloses(page, dialog, 'driven vehicles sheet');
});

// ------------------------------------------------------------------ tournées

test('tournées: grouped by vehicle, create asks "Véhicule" first, "Convertir" and the bulk banner with its count', async ({ w, m, lang, shot }) => {
  const { page } = w.owner;
  const v = m['vehicles']!;
  const t = m['tournees']!;
  await open(page, '/tournees');
  const groups = page.locator('[data-testid="vehicle-routes"]');
  await expect(groups).toHaveCount(2);
  // Sorted by code: LIV 28 MIX, then VAN-28 MXT 01.
  await expect.soft(groups.nth(0).locator('h2')).toContainText(CODES.liv);
  await expect.soft(groups.nth(0).locator('[data-testid="route-driver"]')).toHaveText('Yacine Livreur');
  await expect.soft(groups.nth(1).locator('h2')).toContainText(CODES.van);
  await expect.soft(groups.nth(1).locator('[data-testid="route-driver"]')).toHaveText('Karim Benali');
  await expect.soft(groups.nth(1)).toContainText("M'sila centre");
  const old = page.locator('[data-testid="seller-routes"]');
  await expect(old.locator('ul > li')).toHaveCount(3);
  await expect.soft(old.locator('h2')).toHaveText(v['sellerRoutes']!);
  // Karim drives VAN-28, Samir the truck he was just given: two routes can follow a truck. Nadia drives nothing.
  const banner = page.getByRole('status').filter({ hasText: v['convertBannerBody']! });
  await expect(banner).toContainText(msg(v['convertBannerTitle']!, { count: 2 }, lang));
  await expect.soft(old.locator('ul > li').filter({ hasText: 'Tournée Nadia' }).getByRole('button')).toHaveCount(0);
  await shot(page, 'tournees-par-vehicule');
  await page.screenshot({ path: `${SHOTS}${test.info().project.name}-tournees-par-vehicule-page.png`, fullPage: true, scale: 'css' });
  await pageRules(page, 'tournées, list');

  // Create: the vehicle is asked first; the seller is behind a link.
  await page.getByRole('button', { name: t['newRoute']! }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.locator('#route-vehicle')).toBeVisible();
  await expect(dialog.locator('#route-seller')).toHaveCount(0);
  const options = await dialog.locator('#route-vehicle option').allInnerTexts();
  expect.soft(options.find((o) => o.includes(CODES.van)), 'the truck option: code, type, driver, each code isolated').toBe(`${iso(CODES.van)} · ${iso('MXT')} · Karim Benali`);
  expect.soft(options.find((o) => o.includes(CODES.self))).toBe(`${iso(CODES.self)} · ${iso('SELF/MT')} · ${v['noDriver']}`);
  await shot(page, 'tournee-nouvelle-vehicule');
  await sheetRules(page, dialog, 'new route sheet');
  await dialog.getByRole('button', { name: v['forSeller']! }).click();
  await expect(dialog.locator('#route-seller')).toBeVisible();
  await expect(dialog.locator('#route-vehicle')).toHaveCount(0);
  await shot(page, 'tournee-nouvelle-vendeur');
  await pageRules(page, 'new route sheet, for a seller');
  await dialog.getByRole('button', { name: v['forVehicle']! }).click();
  await dialog.locator('#route-vehicle').selectOption(w.data.trucks.arabic.id);
  await shot(page, 'tournee-nouvelle-code-arabe-choisi');
  await dialog.locator('#route-vehicle').selectOption(w.data.trucks.van.id);
  await shot(page, 'tournee-nouvelle-vehicule-choisi');
  await dialog.locator('#route-name').fill('Créée par le test');
  // A day of the week is needed before the route can be created.
  await dialog.locator('button[aria-pressed]').first().click();
  await dialog.locator('button[type="submit"]').click();
  await page.waitForURL(/\/tournees\/[0-9a-f-]{36}/);
  await page.waitForLoadState('networkidle');
  // The route page of a vehicle route: the truck select, today's driver under it.
  await expect(page.locator('#route-vehicle')).toHaveValue(w.data.trucks.van.id);
  await expect.soft(page.getByText(`${v['driver']} : Karim Benali`)).toBeVisible();
  await expect(page.locator('#route-seller')).toHaveCount(0);
  await shot(page, 'tournee-vehicule-page');
  await pageRules(page, 'route page');

  // Convert one: Karim's old route joins the truck he drives.
  await open(page, '/tournees');
  await page.getByRole('button', { name: msg(v['convertNamed']!, { name: 'Tournée Karim (ancienne)' }) }).click();
  await expect(toast(page, v['converted']!)).toBeVisible();
  await expect(groups.filter({ hasText: CODES.van })).toContainText('Tournée Karim (ancienne)');
  await expect(banner).toContainText(msg(v['convertBannerTitle']!, { count: 1 }, lang));
  await shot(page, 'tournees-apres-convertir');

  // Convert all: the dialog says how many, the toast how many were done.
  await banner.getByRole('button', { name: v['convertAll']! }).click();
  const confirm = page.getByRole('alertdialog');
  await expect(confirm).toContainText(msg(v['convertAllTitle']!, { count: 1 }, lang));
  await expect(confirm).toContainText(v['convertAllBody']!);
  await shot(page, 'tournees-tout-convertir');
  await confirm.getByRole('button', { name: v['convertAll']! }).click();
  await expect(toast(page, msg(v['convertedCount']!, { count: 1 }, lang))).toBeVisible();
  await expect(banner).toHaveCount(0);
  await expect(groups).toHaveCount(3);
  await expect(groups.filter({ hasText: CODES.arabic })).toContainText('جولة سمير القديمة');
  await expect(old.locator('ul > li')).toHaveCount(1);
  await shot(page, 'tournees-toutes-converties');
  await page.screenshot({ path: `${SHOTS}${test.info().project.name}-tournees-toutes-converties-page.png`, fullPage: true, scale: 'css' });
  await pageRules(page, 'tournées, after convert');
});

// ------------------------------------------------------------------ aujourd'hui

test('aujourd’hui: the truck header for its driver; a seller without truck keeps his seller routes and the old message', async ({ w, m, lang, as, shot }) => {
  const t = m['tournees']!;
  const karim = await as(w.data.karim);
  await open(karim.page, '/tournees/aujourdhui');
  const header = karim.page.locator('[data-testid="today-vehicle"]');
  await expect(header).toHaveText(`${CODES.van} · ${lang === 'ar' ? 'المسيلة' : "M'Sila"}`);
  for (const l of await codeLayouts(karim.page, CODES.van)) expect.soft(l.ordered, `today header: ${JSON.stringify(l.parts)}`).toBe(true);
  // In Arabic the code comes first, at the right; the wilaya follows to its left.
  const sides = await header.evaluate((el) => {
    const code = el.querySelector('bdi')!.getBoundingClientRect();
    const wilaya = el.querySelector('span.text-muted-foreground')!.getBoundingClientRect();
    return { codeLeft: code.left, wilayaLeft: wilaya.left };
  });
  if (lang === 'ar') expect.soft(sides.codeLeft, 'ar: the code is to the right of the wilaya').toBeGreaterThan(sides.wilayaLeft);
  else expect.soft(sides.codeLeft).toBeLessThan(sides.wilayaLeft);
  // His truck's tournée and the routes converted to it: three stops of "M'sila centre".
  await expect(karim.page.locator('ol > li').first()).toBeVisible();
  await expect.soft(karim.page.getByText(w.data.clientNames[0]!).first()).toBeVisible();
  await shot(karim.page, 'aujourdhui-vehicule');
  await pageRules(karim.page, 'today, driver');
  expect.soft(karim.problems, 'today, driver: page errors or HTTP 5xx').toEqual([]);

  // Nadia drives nothing: no truck header, her seller route as before.
  const nadia = await as(w.data.nadia);
  await open(nadia.page, '/tournees/aujourdhui');
  await expect(nadia.page.locator('ol > li')).toHaveCount(2);
  await expect.soft(nadia.page.locator('[data-testid="today-vehicle"]')).toHaveCount(0);
  await expect.soft(nadia.page.getByText('Tournée Nadia')).toBeVisible();
  await shot(nadia.page, 'aujourdhui-vendeur-sans-vehicule');
  await pageRules(nadia.page, 'today, seller without truck');
  expect.soft(nadia.problems).toEqual([]);

  // Farid drives nothing and has no route: the message every seller had before phase 36.
  const farid = await as(w.data.farid);
  await open(farid.page, '/tournees/aujourdhui');
  await expect(farid.page.getByText(t['todayEmptyTitle']!)).toBeVisible();
  await expect.soft(farid.page.getByText(t['todayEmptyDescription']!)).toBeVisible();
  await expect.soft(farid.page.locator('[data-testid="today-vehicle"]')).toHaveCount(0);
  await shot(farid.page, 'aujourdhui-sans-tournee');
  await pageRules(farid.page, 'today, nothing');

  // Samir was moved to the Arabic-code truck: the header shows that code, in his order of typing.
  const samir = await as(w.data.samir);
  await open(samir.page, '/tournees/aujourdhui');
  await expect(samir.page.locator('[data-testid="today-vehicle"]')).toContainText(CODES.arabic);
  await shot(samir.page, 'aujourdhui-code-arabe');
  await pageRules(samir.page, 'today, Arabic code');
});

// ------------------------------------------------------------------ commandes, livraisons

test('commandes: filter by delivery truck, assign a delivery truck; the livreur of the truck sees the order', async ({ w, m, as, shot }) => {
  const { page } = w.owner;
  const v = m['vehicles']!;
  await open(page, '/commandes');
  const filter = page.getByRole('combobox', { name: v['deliveryVehicle']! });
  await expect(filter).toBeVisible();
  const offered = await filter.locator('option').allInnerTexts();
  // Delivery and mixed trucks only, each with its code isolated.
  expect.soft(offered.slice(1).sort()).toEqual([`${iso(CODES.liv)} · Livraison M’sila`, `${iso(CODES.self)} · Camion Bordj`].sort());
  await expect(page.getByText(w.data.orders.free.number)).toBeVisible();
  await shot(page, 'commandes');
  await pageRules(page, 'orders');
  await filter.selectOption(w.data.trucks.liv.id);
  await expect(page.getByText(w.data.orders.free.number)).toHaveCount(0);
  const row = page.locator('li, tr').filter({ hasText: w.data.orders.onLiv.number }).filter({ visible: true }).last();
  await expect(row).toContainText(CODES.liv);
  for (const l of await codeLayouts(page, CODES.liv)) expect.soft(l.ordered, `order row: ${JSON.stringify(l.parts)}`).toBe(true);
  await shot(page, 'commandes-filtre-vehicule');
  await pageRules(page, 'orders, filtered by truck');

  // Assign the other order to the same truck from its page.
  await open(page, `/commandes/${w.data.orders.free.id}`);
  const select = page.locator('#order-delivery-vehicle');
  await expect(select).toBeVisible();
  expect.soft((await select.locator('option').allInnerTexts()).find((o) => o.includes(CODES.liv))).toBe(`${iso(CODES.liv)} · Livraison M’sila · Yacine Livreur`);
  await expect.soft(page.getByText(v['deliveryVehicleHint']!)).toBeVisible();
  await shot(page, 'commande-avant-vehicule');
  await select.selectOption(w.data.trucks.liv.id);
  await expect(toast(page, v['deliveryVehicleSaved']!)).toBeVisible();
  await expect(select).toHaveValue(w.data.trucks.liv.id);
  await expect.soft(page.locator('#order-livreur'), 'the order follows the truck: no livreur to pick').toBeDisabled();
  await shot(page, 'commande-vehicule-de-livraison');
  await pageRules(page, 'order page');
  const saved = await api<{ deliveryVehicle: { id: string } | null }>(`/orders/${w.data.orders.free.id}`, { token: w.data.owner.token });
  expect(saved.body.deliveryVehicle?.id).toBe(w.data.trucks.liv.id);

  // The livreur who drives the truck today has both orders.
  const yacine = await as(w.data.yacine);
  await open(yacine.page, '/livraisons');
  await expect(yacine.page.getByText(w.data.orders.onLiv.number)).toBeVisible();
  await expect(yacine.page.getByText(w.data.orders.free.number)).toBeVisible();
  await shot(yacine.page, 'livraisons-du-livreur');
  await pageRules(yacine.page, 'deliveries of the livreur');
  await open(yacine.page, `/livraisons/${w.data.orders.onLiv.id}`);
  await shot(yacine.page, 'livraison-detail');
  await pageRules(yacine.page, 'delivery page');
  expect.soft(yacine.problems).toEqual([]);
});

// ------------------------------------------------------------------ bidi

/** Every screen that draws a truck code, and the codes it draws. */
const SCREENS: { path: string; name: string }[] = [
  { path: '/stock/vehicules', name: 'vehicules' },
  { path: '/stock/depots', name: 'depots' },
  { path: '/parametres/types-vehicules', name: 'types' },
  { path: '/tournees', name: 'tournees' },
  { path: '/commandes', name: 'commandes' },
];

test('bidi: VAN-28 MXT 01, VAN34-SELF/MT, LIV 28 MIX and the plate keep their order on every screen', async ({ w, shot }, info) => {
  const { page } = w.owner;
  const seen: Record<string, (CodeLayout & { code: string })[]> = {};
  for (const s of SCREENS) {
    await open(page, s.path);
    await shot(page, `bidi-${s.name}`);
    seen[s.name] = [];
    for (const code of [CODES.van, CODES.self, CODES.liv, PLATE, 'SELF/MT', 'CDD BATNA 05']) {
      for (const l of await codeLayouts(page, code)) {
        seen[s.name]!.push({ code, ...l });
        expect.soft(l.ordered, `${s.path}: "${code}" in ${l.where}: ${JSON.stringify(l.parts)}`).toBe(true);
        expect.soft(l.isolated, `${s.path}: "${code}" in ${l.where} is not isolated from the text around it`).toBe(true);
        expect.soft(l.cut, `${s.path}: "${code}" in ${l.where} is cut by the line that holds it`).toBe(false);
      }
    }
    await pageRules(page, s.path);
  }
  // Each code was really found where the screen should draw it.
  expect.soft(seen['vehicules']!.filter((l) => l.code === CODES.van).length, 'the card of VAN-28 MXT 01').toBeGreaterThan(0);
  expect.soft(seen['vehicules']!.filter((l) => l.code === PLATE).length, 'the plate on the card').toBeGreaterThan(0);
  expect.soft(seen['depots']!.filter((l) => l.code === CODES.self).length, 'the dépôts list shows the truck code').toBeGreaterThan(0);
  expect.soft(seen['tournees']!.filter((l) => l.code === CODES.liv).length, 'the tournée group of LIV 28 MIX').toBeGreaterThan(0);
  expect.soft(seen['commandes']!.filter((l) => l.code === CODES.liv).length, 'the order row').toBeGreaterThan(0);
  writeFileSync(`${SHOTS}${info.project.name}-bidi.json`, JSON.stringify(seen, null, 2));
});

test('bidi: a code with an Arabic word is drawn in the order it was typed, and two codes do not look the same', async ({ w, shot }, info) => {
  const { page } = w.owner;
  await open(page, '/stock/vehicules');
  const one = await codeLayouts(card(page, CODES.arabic).locator('p').first(), CODES.arabic);
  const two = await codeLayouts(card(page, CODES.arabicSwapped).locator('p').first(), CODES.arabicSwapped);
  expect(one.length, 'the card of the Arabic-word code').toBeGreaterThan(0);
  expect(two.length).toBeGreaterThan(0);
  await card(page, CODES.arabic).scrollIntoViewIfNeeded();
  await shot(page, 'bidi-code-arabe-cartes');
  await shot(card(page, CODES.arabic), 'bidi-code-arabe-carte-1');
  await shot(card(page, CODES.arabicSwapped), 'bidi-code-arabe-carte-2');
  // Left-to-right order of the three parts as drawn.
  const drawn = (l: CodeLayout): string => [...l.parts].sort((a, b) => a.left - b.left).map((p) => p.text).join(' ');
  writeFileSync(
    `${SHOTS}${info.project.name}-bidi-code-arabe.json`,
    JSON.stringify({ typed1: CODES.arabic, drawn1: drawn(one[0]!), typed2: CODES.arabicSwapped, drawn2: drawn(two[0]!), one, two }, null, 2),
  );
  expect.soft(drawn(one[0]!), `typed "VAN شاحنة 01" (VAN, the word, 01): drawn left to right as`).toBe('VAN شاحنة 01');
  expect.soft(drawn(one[0]!), 'two different codes are drawn the same').not.toBe(drawn(two[0]!));
  // The form shows the same text the card does: what the owner typed is what he reads back.
  await card(page, CODES.arabic).getByRole('button').first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.locator('#vehicle-code')).toHaveValue(CODES.arabic);
  await shot(page, 'bidi-code-arabe-formulaire');
  await dialog.getByRole('button', { name: /Annuler|إلغاء/ }).click();
});

test('long codes: two 30-character codes that differ by their last number can be told apart on a card', async ({ w, shot }, info) => {
  const { page } = w.owner;
  await open(page, '/stock/vehicules');
  const a = await codeLayouts(card(page, CODES.long1).locator('p').first(), CODES.long1);
  const b = await codeLayouts(card(page, CODES.long2).locator('p').first(), CODES.long2);
  await card(page, CODES.long1).scrollIntoViewIfNeeded();
  await shot(page, 'code-long-cartes');
  await shot(card(page, CODES.long1), 'code-long-carte-1');
  await shot(card(page, CODES.long2), 'code-long-carte-2');
  const full = await card(page, CODES.long1).locator('p.truncate').first().evaluate((p) => ({ title: p.getAttribute('title'), scroll: p.scrollWidth, client: p.clientWidth }));
  writeFileSync(`${SHOTS}${info.project.name}-code-long.json`, JSON.stringify({ a, b, full }, null, 2));
  expect.soft(a[0]!.cut || b[0]!.cut, `the code is cut (${full.client} px for ${full.scroll} px) and the end that tells the two trucks apart is hidden`).toBe(false);
  if (a[0]!.cut) expect.soft(full.title, 'a cut code has no way to be read in full (docs/ui.md rule 8)').toBe(CODES.long1);
  await pageRules(page, 'vehicles, long codes');
});

// ------------------------------------------------------------------ wilayas

/** 1–48: law 84-09; 49–58: law 19-12. Compared without accents, case, spaces or apostrophes. */
const OFFICIAL_58 = [
  'Adrar', 'Chlef', 'Laghouat', 'Oum El Bouaghi', 'Batna', 'Béjaïa', 'Biskra', 'Béchar', 'Blida', 'Bouira',
  'Tamanrasset', 'Tébessa', 'Tlemcen', 'Tiaret', 'Tizi Ouzou', 'Alger', 'Djelfa', 'Jijel', 'Sétif', 'Saïda',
  'Skikda', 'Sidi Bel Abbès', 'Annaba', 'Guelma', 'Constantine', 'Médéa', 'Mostaganem', "M'Sila", 'Mascara', 'Ouargla',
  'Oran', 'El Bayadh', 'Illizi', 'Bordj Bou Arréridj', 'Boumerdès', 'El Tarf', 'Tindouf', 'Tissemsilt', 'El Oued', 'Khenchela',
  'Souk Ahras', 'Tipaza', 'Mila', 'Aïn Defla', 'Naâma', 'Aïn Témouchent', 'Ghardaïa', 'Relizane',
  'Timimoun', 'Bordj Badji Mokhtar', 'Ouled Djellal', 'Béni Abbès', 'In Salah', 'In Guezzam', 'Touggourt', 'Djanet', "El M'Ghair", 'El Meniaa',
];
const OFFICIAL_58_AR = [
  'أدرار', 'الشلف', 'الأغواط', 'أم البواقي', 'باتنة', 'بجاية', 'بسكرة', 'بشار', 'البليدة', 'البويرة',
  'تمنراست', 'تبسة', 'تلمسان', 'تيارت', 'تيزي وزو', 'الجزائر', 'الجلفة', 'جيجل', 'سطيف', 'سعيدة',
  'سكيكدة', 'سيدي بلعباس', 'عنابة', 'قالمة', 'قسنطينة', 'المدية', 'مستغانم', 'المسيلة', 'معسكر', 'ورقلة',
  'وهران', 'البيض', 'إليزي', 'برج بوعريريج', 'بومرداس', 'الطارف', 'تندوف', 'تيسمسيلت', 'الوادي', 'خنشلة',
  'سوق أهراس', 'تيبازة', 'ميلة', 'عين الدفلى', 'النعامة', 'عين تموشنت', 'غرداية', 'غليزان',
  'تيميمون', 'برج باجي مختار', 'أولاد جلال', 'بني عباس', 'عين صالح', 'عين قزام', 'تقرت', 'جانت', 'المغير', 'المنيعة',
];
const plain = (s: string): string => s.normalize('NFD').replace(/[̀-ًͯ-ْ]/g, '').replace(/[\s'’-]/g, '').toLowerCase();

test('wilayas: the list has 69 unique numbers; 1–58 match the official list; 59–69 are written down for the owner', async ({ w, m, lang, shot }) => {
  const { page } = w.owner;
  await open(page, '/stock/vehicules');
  await page.getByRole('button', { name: m['vehicles']!['new']!, exact: true }).click();
  const select = page.getByRole('dialog').locator('#vehicle-wilaya');
  const options = await select.locator('option').evaluateAll((os) => os.map((o) => ({ value: (o as HTMLOptionElement).value, text: o.textContent ?? '' })));
  const rows = options.filter((o) => o.value !== '');
  expect(rows.map((o) => Number(o.value))).toEqual(Array.from({ length: 69 }, (_, i) => i + 1));
  expect(new Set(rows.map((o) => o.text)).size, 'no name is listed twice').toBe(69);
  const official = lang === 'ar' ? OFFICIAL_58_AR : OFFICIAL_58;
  const wrong: string[] = [];
  rows.slice(0, 58).forEach((o, i) => {
    const number = String(i + 1).padStart(2, '0');
    const [shownNumber, shownName] = o.text.split(' · ');
    if (shownNumber !== number || plain(shownName ?? '') !== plain(official[i]!)) wrong.push(`${number}: shows "${o.text}", official "${official[i]}"`);
  });
  expect.soft(wrong, 'names 1–58 against the official list').toEqual([]);
  writeFileSync(
    `${SHOTS}wilayas-59-69-${lang}.txt`,
    `Wilayas 59 to 69 as the vehicle form shows them (${lang}), to confirm by the owner.\n` +
      `Source cited by packages/shared/src/wilayas.ts: law 26-06 of 4 April 2026 (JO n° 25), names by presidential decree 26-206 (JO n° 40),\n` +
      `numbers as published with the vehicle registration arrêté of 17 June 2026 (JO n° 50 of 15 July 2026).\n\n` +
      rows.slice(58).map((o) => o.text).join('\n') + '\n',
  );
  await select.selectOption('69');
  await shot(page, 'wilaya-69-choisie');
  await select.selectOption('28');
  await shot(page, 'wilaya-28-choisie');
  await page.keyboard.press('Escape');
});

// ------------------------------------------------------------------ English, and what is left

test('en: no raw message key on the phase 36 screens and sheets', async ({ w, browser }, info) => {
  const en = await signIn(browser, info, w.data.owner, 'en');
  const { page } = en;
  const found: Record<string, string[]> = {};
  const check = async (name: string): Promise<void> => {
    const keys = await rawKeys(page);
    if (keys.length) found[name] = keys;
    const lang = await page.evaluate(() => document.documentElement.lang);
    expect.soft(lang, `${name} is served in English`).toBe('en');
  };
  await open(page, '/parametres/types-vehicules');
  await check('types');
  await page.getByRole('button', { name: 'New type', exact: true }).click();
  await check('type form');
  await page.keyboard.press('Escape');
  await open(page, '/stock/vehicules');
  await check('vehicles');
  await page.screenshot({ path: `${SHOTS}${info.project.name}-en-vehicules.png`, scale: 'css' });
  await page.getByRole('button', { name: 'New vehicle', exact: true }).click();
  await check('vehicle form');
  await page.keyboard.press('Escape');
  await page.locator('[data-testid="vehicle-cards"] > li').first().locator('button', { hasText: /.+/ }).first().click();
  await check('driver sheet');
  await page.keyboard.press('Escape');
  await open(page, '/tournees');
  await check('tournées');
  await page.screenshot({ path: `${SHOTS}${info.project.name}-en-tournees.png`, scale: 'css' });
  await open(page, '/commandes');
  await check('orders');
  await open(page, `/commandes/${w.data.orders.onLiv.id}`);
  await check('order page');
  await open(page, '/parametres/utilisateurs');
  await check('users');
  await open(page, '/stock/depots');
  await check('dépôts');
  expect.soft(found, 'raw keys in English').toEqual({});
  expect.soft(en.problems).toEqual([]);
  await signOff(en);
});

test('dépôts: the list still shows the trucks with their code', async ({ w, shot }) => {
  const { page } = w.owner;
  await open(page, '/stock/depots');
  await expect(page.getByText(CODES.van).first()).toBeVisible();
  await shot(page, 'depots');
  await page.screenshot({ path: `${SHOTS}${test.info().project.name}-depots-page.png`, fullPage: true, scale: 'css' });
  await pageRules(page, 'dépôts');
});
