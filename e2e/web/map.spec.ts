/**
 * Test 35, part D: the client map in a real browser, on a phone first.
 *
 *   WEB=http://localhost:3005 API=http://localhost:3003 DB=…/erp_t35 pnpm test:map:web
 *
 * Projects (map.playwright.config.ts): 360 and 393 px in `ar` (RTL) and `fr`, 1280 px in
 * `fr`. Tiles are answered by a 1×1 PNG. Each project signs in once as tenant A's owner
 * and once as its own seller, and keeps those two sessions for the whole file.
 *
 * A failing `expect.soft` is a finding: the report names each of them.
 */
import { type BrowserContext, expect, type Locator, type Page, test as base } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { closeDb, query } from '../lib/db.ts';
import { request as api } from '../lib/http.ts';
import { expectNoHorizontalOverflow, overflowProblems } from './mobile-helpers.ts';
import { HERE, prepare, type UiData } from './map-data.ts';
import { API, fixture, langOf, mockGeolocation, open, signedIn, WEB } from './map-helpers.ts';

type Messages = Record<string, Record<string, string>>;
const messages = (lang: string): Messages =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`../../apps/web/src/messages/${lang}.json`, import.meta.url)), 'utf8')) as Messages;

const SHOTS = fileURLToPath(new URL('../artifacts/test-35/', import.meta.url));
mkdirSync(SHOTS, { recursive: true });

interface Worker {
  data: UiData;
  owner: { context: BrowserContext; page: Page };
  seller: { context: BrowserContext; page: Page };
}

const test = base.extend<{ m: Messages; shot: (page: Page, name: string) => Promise<void> }, { w: Worker }>({
  w: [
    async ({ browser }, use, info) => {
      const fake = { project: info.project } as Parameters<typeof signedIn>[1];
      const data = await prepare(info.project.name);
      const state = (who: string): string => fileURLToPath(new URL(`../.auth/map-state-${info.project.name}-${who}-${fixture.tag}.json`, import.meta.url));
      const owner = await signedIn(browser, fake, fixture.a.owner, { position: { ...HERE, accuracy: 15 }, stateFile: state('owner') });
      const seller = await signedIn(browser, fake, data.seller, { position: { ...HERE, accuracy: 15 }, stateFile: state('seller') });
      await use({ data, owner, seller });
      // Keep the live sessions (the refresh token rotates) for the next worker of this project.
      await owner.context.storageState({ path: state('owner') }).catch(() => undefined);
      await seller.context.storageState({ path: state('seller') }).catch(() => undefined);
      await owner.context.close();
      await seller.context.close();
      await closeDb();
    },
    { scope: 'worker', timeout: 300_000 },
  ],
  m: async ({}, use, info) => {
    await use(messages(langOf(info)));
  },
  shot: async ({}, use, info) => {
    await use(async (page, name) => {
      // CSS pixels, not device pixels: the proofs stay small in git.
      await page.screenshot({ path: `${SHOTS}${info.project.name}-${name}.png`, scale: 'css' });
    });
  },
});

const isPhone = (page: Page): boolean => (page.viewportSize()?.width ?? 0) < 768;
const nbsp = (s: string): string => s.replace(/[  ]/g, ' ');

/** A raw message key on screen (`clientMap.nearMe`) means a missing translation. */
async function rawKeys(page: Page): Promise<string[]> {
  const text = await page.evaluate(() => document.body.innerText);
  return [...new Set(text.match(/\b(?:clientMap|tournees|clients|common|geo|nav)\.[a-zA-Z][\w.]*/g) ?? [])];
}

/** Are sample points of the map box covered by loaded tiles? (grey holes = a wrong size) */
async function tileHoles(map: Locator): Promise<{ holes: number; size: string; leafletSize: string }> {
  return map.evaluate((el) => {
    const box = el.getBoundingClientRect();
    const tiles = Array.from(el.querySelectorAll<HTMLImageElement>('img.leaflet-tile-loaded')).map((t) => t.getBoundingClientRect());
    let holes = 0;
    for (let i = 1; i <= 5; i++) {
      for (let j = 1; j <= 5; j++) {
        const x = box.left + (box.width * i) / 6;
        const y = box.top + (box.height * j) / 6;
        if (!tiles.some((t) => x >= t.left && x <= t.right && y >= t.top && y <= t.bottom)) holes++;
      }
    }
    const pane = el.querySelector<HTMLElement>('.leaflet-map-pane');
    return { holes, size: `${Math.round(box.width)}×${Math.round(box.height)}`, leafletSize: pane ? `${el.clientWidth}×${el.clientHeight}` : 'no pane' };
  });
}

/** Every control of an open dialog has a name a screen reader can say. */
async function unnamedControls(dialog: Locator): Promise<string[]> {
  return dialog.evaluate((el) => {
    const out: string[] = [];
    for (const c of Array.from(el.querySelectorAll<HTMLElement>('button, a[href], [role="radio"], [role="switch"], input, select'))) {
      if (c.offsetParent === null) continue;
      const id = c.getAttribute('id');
      const label = c.getAttribute('aria-label') ?? c.getAttribute('title') ?? (id ? document.querySelector(`label[for="${id}"]`)?.textContent : null) ?? c.closest('label')?.textContent ?? c.textContent;
      if (!label || label.trim() === '') out.push(c.outerHTML.slice(0, 120));
    }
    return out;
  });
}

/** Tab stays inside the open dialog. */
async function focusStaysIn(page: Page, dialog: Locator): Promise<boolean> {
  for (let i = 0; i < 25; i++) {
    await page.keyboard.press('Tab');
    const inside = await dialog.evaluate((el) => el.contains(document.activeElement));
    if (!inside) return false;
  }
  return true;
}

async function chooseSeller(page: Page, m: Messages, sellerId: string): Promise<void> {
  if (isPhone(page)) {
    await page.getByRole('button', { name: new RegExp(`^${m['clientMap']!['filters']}`) }).click();
    await page.locator('#sheet-seller').selectOption(sellerId);
    await page.getByRole('button', { name: m['clientMap']!['showResults'] }).click();
  } else {
    await page.locator('#side-seller').selectOption(sellerId);
  }
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(600);
}

const mapOf = (scope: Page | Locator): Locator => scope.locator('.leaflet-container').first();


test('/clients/carte: fits the phone, the two buttons are on the first screen, legend, banner, "sans position" link', async ({ w, m, shot }, info) => {
  const { page } = w.owner;
  const cm = m['clientMap']!;
  await open(page, '/clients/carte');
  await mapOf(page).waitFor();
  await page.waitForTimeout(800);
  await shot(page, 'carte');
  await expectNoHorizontalOverflow(page, { soft: true });
  expect.soft(await rawKeys(page), 'raw message keys on the page').toEqual([]);

  const vp = page.viewportSize()!;
  const nearMe = page.getByRole('button', { name: cm['nearMe'] });
  const inFirstScreen = async (l: Locator): Promise<boolean> => {
    const b = await l.boundingBox();
    return !!b && b.y >= 0 && b.y + b.height <= vp.height && b.x >= 0 && b.x + b.width <= vp.width;
  };
  expect(await page.evaluate(() => window.scrollY), 'the page opens unscrolled').toBe(0);
  expect.soft(await inFirstScreen(nearMe), '"Près de moi" is visible without scrolling').toBe(true);
  if (isPhone(page)) {
    expect.soft(await inFirstScreen(page.getByRole('button', { name: new RegExp(`^${cm['filters']}`) })), '"Filtres" is visible without scrolling').toBe(true);
  } else {
    await expect(page.locator('aside #side-search')).toBeVisible();
  }
  // Legend: the four states are written, colour is not the only clue.
  for (const k of ['normal', 'debt', 'over', 'inactive']) {
    await expect.soft(page.getByText((m['clientMap'] as unknown as { state: Record<string, string> }).state[k]!, { exact: true }).first()).toBeAttached();
  }
  // 4 050 clients match: the banner asks to zoom or filter.
  await expect(page.getByText(cm['truncated']!.replace('{max}', '2 000'))).toBeVisible();

  // Spec: "map takes the screen height minus the header on phone".
  const box = (await mapOf(page).boundingBox())!;
  info.annotations.push({ type: 'map box', description: `top ${Math.round(box.y)}, height ${Math.round(box.height)}, viewport ${vp.height}` });
  if (isPhone(page)) {
    const visible = Math.max(0, Math.min(vp.height, box.y + box.height) - box.y);
    expect.soft(Math.round((visible / vp.height) * 100), `share of the first screen the map gets, in % (map top ${Math.round(box.y)} px of ${vp.height})`).toBeGreaterThanOrEqual(50);
    expect.soft(box.y + box.height, 'the whole map fits the first screen (else one finger pans the map and cannot scroll the page)').toBeLessThanOrEqual(vp.height + 1);
  }

  // "N clients sans position →" opens the list filtered on them.
  const link = page.locator('a[href="/clients?hasLocation=false"]');
  expect(nbsp(await link.innerText()), 'the link gives the number of clients without a point').toMatch(/^5\d\d /);
  await link.click();
  await page.waitForURL(/\/clients\?hasLocation=false/);
  await page.waitForLoadState('networkidle');
  await expect(page.getByText(m['clients']!['withoutLocation']!).first()).toBeVisible();
  await expectNoHorizontalOverflow(page, { soft: true });
  await shot(page, 'clients-sans-position');
  // A deep link with other filters next to hasLocation still works (dashboard links, phase 33).
  const listed = page.waitForResponse((r) => /\/clients\?/.test(r.url()) && r.url().includes('hasLocation=true') && r.url().includes('hasDebt=true'));
  await page.goto(`${WEB}/clients?hasDebt=true&hasLocation=true&sort=balance_desc`);
  expect((await listed).status()).toBe(200);
});

test('filters sheet: the badge counts the active filters; the sheet traps focus, Escape closes it, controls are named', async ({ w, m, shot }) => {
  const { page } = w.owner;
  const cm = m['clientMap']!;
  await open(page, '/clients/carte');
  await mapOf(page).waitFor();
  if (!isPhone(page)) {
    await page.locator('#side-hasDebt').click();
    await page.locator('#side-includeInactive').click();
    await page.locator('#side-sector').selectOption(fixture.a.sectors.alger);
    await page.waitForLoadState('networkidle');
    await shot(page, 'filtres-panneau');
    await expectNoHorizontalOverflow(page, { soft: true });
    return;
  }
  const filters = page.getByRole('button', { name: new RegExp(`^${cm['filters']}`) });
  await filters.click();
  const sheet = page.getByRole('dialog').filter({ has: page.locator('#sheet-search') });
  await expect(sheet).toBeVisible();
  await shot(page, 'filtres');
  expect.soft(await unnamedControls(sheet), 'controls without a name in the filters sheet').toEqual([]);
  expect.soft(await focusStaysIn(page, sheet), 'Tab stays inside the filters sheet').toBe(true);
  await expectNoHorizontalOverflow(page, { soft: true });
  await page.locator('#sheet-hasDebt').click();
  await page.locator('#sheet-includeInactive').click();
  await page.locator('#sheet-sector').selectOption(fixture.a.sectors.alger);
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
  await expect(filters.locator('.num')).toHaveText('3');
  // The badge sits after the label in reading order (to its left in Arabic).
  const label = await filters.evaluate((b) => {
    const badge = b.querySelector('.num')!.getBoundingClientRect();
    const svg = b.querySelector('svg')!.getBoundingClientRect();
    return { rtl: getComputedStyle(b).direction === 'rtl', badgeX: badge.left, iconX: svg.left };
  });
  expect.soft(label.rtl ? label.badgeX < label.iconX : label.badgeX > label.iconX, 'the badge is at the end of the button').toBe(true);
  await shot(page, 'filtres-badge');
  // A search of one word, then clear: back to no badge.
  await filters.click();
  await page.locator('#sheet-search').fill('café');
  await page.getByRole('button', { name: cm['showResults'] }).click();
  await expect(filters.locator('.num')).toHaveText('4');
  await filters.click();
  await page.getByRole('button', { name: cm['clearFilters'] }).click();
  await page.getByRole('button', { name: cm['showResults'] }).click();
  await expect(filters.locator('.num')).toHaveCount(0);
});

test('position refused, never answered, vague (5 km): the map stays, the screen explains, no endless spinner', async ({ w, m, shot }) => {
  const { context } = w.owner;
  const cm = m['clientMap']!;
  // Refused.
  await context.clearPermissions();
  const denied = await context.newPage();
  await open(denied, '/clients/carte');
  await mapOf(denied).waitFor();
  const nearMe = denied.getByRole('button', { name: cm['nearMe'] });
  await nearMe.click();
  await expect(denied.getByText(cm['positionDenied']!)).toBeVisible();
  await expect(mapOf(denied)).toBeVisible();
  await expect(nearMe).toBeEnabled();
  await shot(denied, 'position-refusee');
  await expectNoHorizontalOverflow(denied, { soft: true });
  await denied.close();
  await context.grantPermissions(['geolocation']);

  // Never answered: the browser gives up at the 10 s the app asks for.
  const slow = await context.newPage();
  await mockGeolocation(context, 'never');
  await open(slow, '/clients/carte');
  await mapOf(slow).waitFor();
  const btn = slow.getByRole('button', { name: cm['nearMe'] });
  await btn.click();
  await expect(btn).toBeDisabled();
  await shot(slow, 'position-en-attente');
  await expect(slow.getByText(cm['positionUnavailable']!)).toBeVisible({ timeout: 14_000 });
  await expect(btn).toBeEnabled();
  await expect(mapOf(slow)).toBeVisible();
  await shot(slow, 'position-introuvable');
  await slow.close();

  // Vague: the phone only knows where it is within 5 km (no GPS fix, cell towers).
  const vague = await context.newPage();
  await mockGeolocation(context, { ...HERE, accuracy: 5000 });
  await open(vague, '/clients/carte');
  await mapOf(vague).waitFor();
  await vague.getByRole('button', { name: cm['nearMe'] }).click();
  const sheet = vague.getByRole('dialog').filter({ hasText: cm['nearbyTitle'] });
  await expect(sheet).toBeVisible();
  await shot(vague, 'position-imprecise');
  const text = nbsp(await vague.evaluate(() => document.body.innerText));
  // Something on screen must tell the seller the position is rough: the distances listed
  // to the metre are meaningless at ± 5 km.
  expect.soft(/précis|approximati|environ|±|دق|تقريب/i.test(text), 'the screen says the position is imprecise (± 5 km)').toBe(true);
  await vague.close();
  // Back to a precise position for the tests that follow (the init script stays on the
  // context, so it is replaced, not removed).
  await mockGeolocation(context, { ...HERE, accuracy: 15 });
});

test('"Près de moi": the list is sorted by distance, has call and directions links, radius chips; an API error is not shown as "no client"', async ({ w, m, shot }) => {
  const { page } = w.owner;
  const cm = m['clientMap']!;
  await open(page, '/clients/carte');
  await mapOf(page).waitFor();
  const nearby = page.waitForResponse((r) => r.url().includes('/clients/nearby'));
  await page.getByRole('button', { name: cm['nearMe'] }).click();
  const body = (await (await nearby).json()) as { id: string; name: string; distanceM: number; phone: string | null; lat: number; lng: number }[];
  const sheet = page.getByRole('dialog').filter({ hasText: cm['nearbyTitle'] });
  await expect(sheet.getByTestId('nearby-list')).toBeVisible();
  await page.waitForTimeout(700); // the sheet finishes sliding in
  await shot(page, 'proches');
  // The name must stay readable next to the balance and the two buttons.
  const nameWidth = await sheet.getByTestId('nearby-list').locator('li button span').first().evaluate((e) => Math.round(e.getBoundingClientRect().width));
  expect.soft(nameWidth, 'width left to the client name in the nearby list (px)').toBeGreaterThanOrEqual(90);
  await expectNoHorizontalOverflow(page, { soft: true });
  expect.soft(await rawKeys(page), 'raw message keys').toEqual([]);

  const rows = sheet.getByTestId('nearby-list').locator('li');
  expect(await rows.count()).toBe(body.length);
  const shown = (await rows.getByTestId('nearby-distance').allTextContents()).map(nbsp);
  const metres = shown.map((s) => (s.includes('km') ? Number(s.replace(' km', '').replace(',', '.')) * 1000 : Number(s.replace(' m', ''))));
  expect(metres.every((v, i) => i === 0 || metres[i - 1]! <= v), `distances ascending: ${shown.slice(0, 8).join(', ')}`).toBe(true);
  // First row: its links.
  const first = body[0]!;
  const row = rows.first();
  await expect(row.locator(`a[href="https://www.google.com/maps/dir/?api=1&destination=${first.lat},${first.lng}"]`)).toHaveCount(1);
  if (first.phone) await expect(row.locator(`a[href="tel:${first.phone}"]`)).toHaveCount(1);
  await expect(sheet.getByText(cm['straightLineNote']!)).toBeVisible();
  // Radius chips: 1, 5, 10, 25 km; 5 km is the one checked.
  const chips = sheet.getByRole('radio');
  expect((await chips.allTextContents()).map(nbsp)).toEqual(['1 km', '5 km', '10 km', '25 km']);
  await expect(chips.nth(1)).toHaveAttribute('aria-checked', 'true');
  const wider = page.waitForRequest((r) => r.url().includes('/clients/nearby') && (r.postData() ?? '').includes('"radiusM":1000,'));
  await chips.first().click();
  await wider;
  expect.soft(await unnamedControls(sheet), 'controls without a name in the nearby sheet').toEqual([]);
  expect.soft(await focusStaysIn(page, sheet), 'Tab stays inside the nearby sheet').toBe(true);

  // The API fails: the sheet must say so, not "Aucun client dans ce rayon".
  await page.route(/\/clients\/nearby/, (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{"code":"INTERNAL_ERROR","message":"x"}' }));
  await chips.nth(3).click();
  await page.waitForTimeout(6000); // the query retries before it gives up
  await shot(page, 'proches-erreur');
  const emptyShown = await sheet.getByText(cm['nearbyEmpty']!).isVisible();
  expect.soft(emptyShown, 'a failed nearby request is shown as "Aucun client dans ce rayon"').toBe(false);
  await page.unroute(/\/clients\/nearby/);
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
});

test('bubble of a client: fiche, tel, itinéraire (lat,lng), balance 1 234 567,89 DA, "Ajouter à une tournée…" adds at the end and the toast opens the route', async ({ w, m, shot }) => {
  const { page } = w.owner;
  const cm = m['clientMap']!;
  const c = w.data.clients[0]!;
  await open(page, '/clients/carte');
  await mapOf(page).waitFor();
  await chooseSeller(page, m, w.data.seller.id);
  await page.locator(`path.cp-${c.id}`).click();
  const bubble = page.getByRole('dialog', { name: c.name });
  await expect(bubble).toBeVisible();
  await shot(page, 'bulle');
  await expectNoHorizontalOverflow(page, { soft: true });
  await expect(bubble.getByRole('link', { name: cm['openClient'] })).toHaveAttribute('href', `/clients/${c.id}`);
  await expect(bubble.getByRole('link', { name: cm['call'] })).toHaveAttribute('href', `tel:${c.phone}`);
  const directions = bubble.getByRole('link', { name: cm['directions'] });
  await expect(directions).toHaveAttribute('href', `https://www.google.com/maps/dir/?api=1&destination=${c.lat},${c.lng}`);
  await expect(directions).toHaveAttribute('target', '_blank');
  expect(nbsp(await bubble.innerText())).toContain('1 234 567,89 DA');
  // The state is written, not only coloured: this client is over its plafond.
  await expect(bubble.getByText((m['clientMap'] as unknown as { state: Record<string, string> }).state['over']!)).toBeVisible();
  // The bubble must not hide under the map controls nor leave the map box.
  const bb = (await bubble.boundingBox())!;
  const mb = (await mapOf(page).boundingBox())!;
  expect.soft(bb.x >= mb.x - 1 && bb.x + bb.width <= mb.x + mb.width + 1, 'the bubble stays inside the map').toBe(true);
  expect.soft(await unnamedControls(bubble), 'controls without a name in the bubble').toEqual([]);

  // Add to a tournée: the route of today gets it at the end.
  const before = (await api<{ stops: { client: { id: string } }[] }>(`/routes/${w.data.todayRoute.id}`, { token: fixture.a.owner.token })).body.stops.map((s) => s.client.id);
  await bubble.getByRole('button', { name: cm['addToRoute'] }).click();
  const dialog = page.getByRole('dialog').filter({ hasText: cm['addToRouteTitle'] });
  await expect(dialog).toBeVisible();
  await shot(page, 'ajouter-a-une-tournee');
  // Only the routes of the client's seller are offered.
  // The list loads after the dialog opens (a skeleton first): wait for it before reading.
  await expect(dialog.locator('ul li').first()).toBeVisible();
  const offered = await dialog.locator('ul li').allTextContents();
  const sellerLabel = w.data.seller.email.replace('t35-', '').replace('@audit.local', '');
  expect(offered.length, `routes offered: ${offered.join(' | ')}`).toBeGreaterThanOrEqual(2);
  expect(offered.filter((o) => !o.includes(sellerLabel)), 'routes of another seller offered for this client').toEqual([]);
  await dialog.getByRole('button', { name: new RegExp(w.data.todayRoute.name) }).click();
  const toast = page.locator('[data-sonner-toast]').filter({ hasText: w.data.todayRoute.name });
  await expect(toast).toBeVisible();
  await shot(page, 'ajoute-toast');
  const after = (await api<{ stops: { client: { id: string } }[] }>(`/routes/${w.data.todayRoute.id}`, { token: fixture.a.owner.token })).body.stops.map((s) => s.client.id);
  expect(after, 'the client is added at the end, the other stops untouched').toEqual([...before.filter((id) => id !== c.id), c.id]);
  await toast.getByRole('button', { name: cm['openRoute'] }).click();
  await page.waitForURL(new RegExp(`/tournees/${w.data.todayRoute.id}$`));
});

test('route editor: new tournée → "Choisir sur la carte" → tap 3 → numbered in tap order → retirer → close → 2 in the list → guard → save → reload', async ({ w, m, shot }) => {
  const { page } = w.owner;
  const cm = m['clientMap']!;
  const tt = m['tournees']!;
  const [a, b, c] = [w.data.clients[1]!, w.data.clients[5]!, w.data.clients[3]!];
  const dialogs: string[] = [];
  const onDialog = (d: import('@playwright/test').Dialog): void => {
    dialogs.push(d.type());
    void d.accept();
  };
  page.on('dialog', onDialog);
  await open(page, '/tournees');
  await page.getByRole('button', { name: tt['newRoute'] }).first().click();
  const name = `Carte ${Date.now().toString(36)}`;
  await page.locator('#route-name').fill(name);
  await page.locator('#route-seller').selectOption(w.data.seller.id);
  await page.locator('[role="dialog"] button[aria-pressed]').first().click();
  await page.getByRole('button', { name: tt['createRoute'] }).click();
  await page.waitForURL(/\/tournees\/[0-9a-f-]{36}$/);
  const routeId = page.url().split('/').pop()!;
  await expect(page.getByText(tt['pickOnMapHint']!)).toBeVisible();
  await shot(page, 'tournee-vide');
  await expectNoHorizontalOverflow(page, { soft: true });

  await page.getByRole('button', { name: tt['pickOnMap'] }).first().click();
  const sheet = page.getByRole('dialog').filter({ has: page.locator('.leaflet-container') });
  await expect(sheet).toBeVisible();
  const map = mapOf(sheet);
  // After the sheet has slid in, the map must be drawn over its whole box.
  await page.waitForTimeout(1200);
  const holes = await tileHoles(map);
  expect.soft(holes.holes, `grey holes in the map of the sheet (${holes.size})`).toBe(0);
  if (isPhone(page)) {
    const sb = (await sheet.boundingBox())!;
    expect.soft(Math.round(sb.height), 'the picker is full height on a phone').toBeGreaterThanOrEqual(page.viewportSize()!.height - 2);
    const mb = (await map.boundingBox())!;
    expect.soft(Math.round(mb.height), 'height left to the map inside the sheet (px)').toBeGreaterThanOrEqual(240);
  }
  await shot(page, 'choisir-sur-la-carte');
  expect.soft(await rawKeys(page), 'raw message keys').toEqual([]);
  expect.soft(await overflowProblems(page), 'sideways scroll with the sheet open').toEqual([]);

  for (const x of [a, b, c]) {
    await sheet.locator(`path.cp-${x.id}`).click();
    const bubble = sheet.getByRole('dialog', { name: x.name });
    await bubble.getByRole('button', { name: cm['addToThisRoute'] }).click();
    await bubble.getByRole('button', { name: cm['closeBubble'], exact: true }).click();
  }
  const markers = sheet.locator('.leaflet-marker-icon span');
  await expect(markers).toHaveCount(3);
  // Each numbered marker sits on the client tapped at that rank.
  const titles = await sheet.locator('.leaflet-marker-icon').evaluateAll((els) => els.map((e) => e.getAttribute('title')));
  expect(titles.sort(), 'numbered markers in tap order').toEqual([`1. ${a.name}`, `2. ${b.name}`, `3. ${c.name}`]);
  expect((await markers.evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')))).sort()).toEqual([1, 2, 3].map((n) => `${cm['stop']} ${n}`));
  // The dashed path is drawn on the canvas (no DOM element to count): its note is checked, the screenshot shows it.
  await expect(sheet.getByText(cm['pathNote']!)).toBeVisible();
  await shot(page, 'trois-arrets');

  // Remove the second one.
  await sheet.locator(`.leaflet-marker-icon[title="2. ${b.name}"]`).click();
  const bubbleB = sheet.getByRole('dialog', { name: b.name });
  await expect(bubbleB.getByText(cm['stopNumber']!.replace('{n}', '2'))).toBeVisible();
  await bubbleB.getByRole('button', { name: cm['removeFromRoute'] }).click();
  await expect(markers).toHaveCount(2);
  expect.soft(await focusStaysIn(page, sheet), 'Tab stays inside the picker').toBe(true);
  expect.soft(await unnamedControls(sheet), 'controls without a name in the picker').toEqual([]);

  // Rotate the phone: the map must follow its box.
  if (isPhone(page)) {
    const vp = page.viewportSize()!;
    await page.setViewportSize({ width: vp.height, height: vp.width });
    await page.waitForTimeout(1200);
    const rotated = await tileHoles(map);
    await shot(page, 'paysage');
    expect.soft(rotated.holes, `grey holes after rotating (${rotated.size})`).toBe(0);
    const rb = await map.boundingBox();
    expect.soft(Math.round(rb?.height ?? 0), 'height of the map in landscape (px)').toBeGreaterThanOrEqual(120);
    await page.setViewportSize(vp);
    await page.waitForTimeout(800);
  }

  await sheet.getByRole('button', { name: new RegExp(`^${cm['donePicking']}`) }).click();
  await expect(sheet).toBeHidden();
  const stopNames = (): Promise<string[]> => page.locator('ol > li p.font-medium').allTextContents();
  expect(await stopNames()).toEqual([a.name, c.name]);
  await shot(page, 'deux-arrets-liste');

  // Not saved yet: leaving the page asks first.
  dialogs.length = 0;
  await page.reload();
  expect(dialogs, 'a beforeunload prompt when leaving with unsaved stops').toContain('beforeunload');
  await page.waitForLoadState('networkidle');
  expect(await stopNames(), 'after leaving without saving nothing was saved').toEqual([]);

  // Again, then an in-app link: is the work lost without a word?
  await page.getByRole('button', { name: tt['pickOnMap'] }).first().click();
  for (const x of [a, c]) {
    await sheet.locator(`path.cp-${x.id}`).click();
    const bubble = sheet.getByRole('dialog', { name: x.name });
    await bubble.getByRole('button', { name: cm['addToThisRoute'] }).click();
    await bubble.getByRole('button', { name: cm['closeBubble'], exact: true }).click();
  }
  await sheet.getByRole('button', { name: new RegExp(`^${cm['donePicking']}`) }).click();
  dialogs.length = 0;
  await page.goBack(); // the browser's back button: an in-app navigation, no page unload
  await page.waitForTimeout(1200);
  const left = !page.url().endsWith(routeId);
  expect.soft(left && dialogs.length === 0, 'the back button leaves the editor and drops the unsaved stops without asking').toBe(false);
  await open(page, `/tournees/${routeId}`);

  // Pick again and save for good.
  await page.getByRole('button', { name: tt['pickOnMap'] }).first().click();
  for (const x of [a, c]) {
    await sheet.locator(`path.cp-${x.id}`).click();
    const bubble = sheet.getByRole('dialog', { name: x.name });
    await bubble.getByRole('button', { name: cm['addToThisRoute'] }).click();
    await bubble.getByRole('button', { name: cm['closeBubble'], exact: true }).click();
  }
  await sheet.getByRole('button', { name: new RegExp(`^${cm['donePicking']}`) }).click();
  await page.getByRole('button', { name: tt['saveRoute'] }).click();
  await expect(page.getByText(tt['saved']!).first()).toBeVisible();
  dialogs.length = 0;
  await page.reload();
  await page.waitForLoadState('networkidle');
  expect(dialogs, 'no prompt once saved').toEqual([]);
  expect(await stopNames()).toEqual([a.name, c.name]);
  const saved = (await api<{ stops: { client: { id: string } }[] }>(`/routes/${routeId}`, { token: fixture.a.owner.token })).body.stops.map((s) => s.client.id);
  expect(saved).toEqual([a.id, c.id]);
  page.off('dialog', onDialog);
});

test('"Ajouter les clients visibles (N)": refused above the 300 limit with the API\'s message, confirmed with N below it; the picker above 2 000 clients', async ({ w, m, shot }) => {
  const { page } = w.owner;
  const cm = m['clientMap']!;
  const tt = m['tournees']!;
  const dialogs: string[] = [];
  const onDialog = (d: import('@playwright/test').Dialog): void => {
    dialogs.push(d.message());
    void d.accept();
  };
  page.on('dialog', onDialog);
  await open(page, `/tournees/${w.data.fullRoute.id}`);
  await page.getByRole('button', { name: tt['pickOnMap'] }).first().click();
  const sheet = page.getByRole('dialog').filter({ has: page.locator('.leaflet-container') });
  await expect(sheet).toBeVisible();
  await page.waitForTimeout(1500);
  const addVisible = sheet.getByRole('button', { name: /\(\d+\)/ }).first();
  const label = nbsp(await addVisible.innerText());
  const n = Number(/\((\d+)\)/.exec(label)?.[1]);
  // 296 stops of another seller are on the route; this seller's 8 located clients are visible.
  expect(n, `"${label}"`).toBe(8);
  await addVisible.click();
  await expect(page.locator('[data-sonner-toast]').filter({ hasText: cm['tooManyStops']!.replace('{max}', '300') })).toBeVisible();
  expect(dialogs, 'no confirm when the limit refuses').toEqual([]);
  await shot(page, 'visibles-refuses');
  await expect(sheet.locator('.leaflet-marker-icon')).toHaveCount(296);

  // "Tous mes clients" for the owner: 4 050 match, the API answers the first 2 000 by name.
  const requests: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/clients/map')) requests.push(r.url());
  });
  await sheet.locator('#pick-all').click();
  await expect(sheet.getByText(cm['truncated']!.replace('{max}', '2 000'))).toBeVisible();
  await shot(page, 'tous-mes-clients-tronque');
  requests.length = 0;
  for (let i = 0; i < 4; i++) {
    await sheet.locator('.leaflet-control-zoom-in').click();
    await page.waitForTimeout(700);
  }
  await page.waitForTimeout(1200);
  // The banner says "zoomez ou filtrez pour tous les voir": zooming must then load the view.
  expect.soft(requests.filter((u) => u.includes('minLat=')).length, 'requests for the zoomed view in the picker (the banner tells the user to zoom)').toBeGreaterThan(0);
  await sheet.locator('#pick-all').click();
  await sheet.getByRole('button', { name: new RegExp(`^${cm['donePicking']}`) }).click();
  page.off('dialog', onDialog);
});

test('/tournees/aujourdhui: "Carte" shows numbered stops, the visited one checked; "Près de moi" lists only the seller\'s own clients', async ({ w, m, shot }) => {
  const { page } = w.seller;
  const cm = m['clientMap']!;
  const tt = m['tournees']!;
  await open(page, '/tournees/aujourdhui');
  await page.getByRole('radio', { name: tt['viewMap'], exact: true }).click();
  await mapOf(page).waitFor();
  await page.waitForTimeout(800);
  await shot(page, 'aujourdhui-carte');
  await expectNoHorizontalOverflow(page, { soft: true });
  expect.soft(await rawKeys(page), 'raw message keys').toEqual([]);
  const today = (await api<{ stops: { client: { id: string; name: string; lat: number | null }; visitedToday: boolean }[] }>('/me/today', { token: w.data.seller.token })).body.stops;
  const located = today.filter((s) => s.client.lat !== null);
  const icons = page.locator('.leaflet-marker-icon span');
  await expect(icons).toHaveCount(located.length);
  const texts = await icons.allTextContents();
  const visited = today.filter((s) => s.visitedToday && s.client.lat !== null).length;
  expect(visited, 'the seed made one visit today').toBeGreaterThanOrEqual(1);
  expect(texts.filter((x) => x === '✓').length, `markers: ${texts.join(' ')}`).toBe(visited);
  // The numbers are the positions in the day's list (the stop without a point keeps its number).
  const expected = today.map((s, i) => (s.client.lat === null ? null : s.visitedToday ? '✓' : String(i + 1))).filter((x) => x !== null);
  expect(texts.sort()).toEqual([...expected].sort());
  await expect(page.getByText(new RegExp(cm['stopsWithoutPoint']!.split('{')[0]!.trim() || '1')).first()).toBeAttached();
  // A visited stop says so in words in its bubble.
  await page.locator('.leaflet-marker-icon', { hasText: '✓' }).first().click();
  await expect(page.getByText(tt['visitedToday']!).first()).toBeVisible();
  await shot(page, 'aujourdhui-bulle');

  // Near me: hundreds of other sellers' clients are within 5 km of this spot.
  const res = page.waitForResponse((r) => r.url().includes('/clients/nearby'));
  await page.getByRole('button', { name: cm['nearMe'] }).click();
  const near = (await (await res).json()) as { id: string; assignedSellerId: string | null }[];
  const others = await query<{ n: number }>(
    `SELECT count(*)::int AS n FROM clients WHERE "tenantId" = $1 AND "deletedAt" IS NULL AND active AND lat BETWEEN $2 - 0.04 AND $2 + 0.04 AND lng BETWEEN $3 - 0.05 AND $3 + 0.05 AND "assignedSellerId" IS DISTINCT FROM $4`,
    [fixture.a.tenantId, HERE.latitude, HERE.longitude, w.data.seller.id],
  );
  expect(others[0]!.n, 'other sellers have clients around here').toBeGreaterThan(20);
  expect(near.length).toBeGreaterThan(0);
  expect(near.filter((c) => c.assignedSellerId !== w.data.seller.id), 'clients of someone else in the seller\'s nearby list').toEqual([]);
  const sheet = page.getByRole('dialog').filter({ hasText: cm['nearbyTitle'] });
  await expect(sheet.getByTestId('nearby-list').locator('li')).toHaveCount(near.length);
  await shot(page, 'aujourdhui-proches');
  await page.keyboard.press('Escape');
  // A seller has no "Ajouter à une tournée…" on the clients map.
  await open(page, '/clients/carte');
  await mapOf(page).waitFor();
  await page.locator(`path.cp-${w.data.clients[1]!.id}`).click();
  const bubble = page.getByRole('dialog', { name: w.data.clients[1]!.name });
  await expect(bubble).toBeVisible();
  await expect(bubble.getByRole('button', { name: cm['addToRoute'] })).toHaveCount(0);
  await shot(page, 'vendeur-carte');
});

test('English: no raw message key on the three screens', async ({ w }, info) => {
  const { context, page } = w.owner;
  await context.addCookies([{ name: 'NEXT_LOCALE', value: 'en', url: WEB }]);
  try {
    for (const path of ['/clients/carte', `/tournees/${w.data.fullRoute.id}`, '/clients?hasLocation=false']) {
      await open(page, path);
      expect.soft(await rawKeys(page), `raw keys on ${path}`).toEqual([]);
    }
  } finally {
    await context.addCookies([{ name: 'NEXT_LOCALE', value: langOf(info), url: WEB }]);
  }
});

void API;
