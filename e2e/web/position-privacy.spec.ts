/**
 * Test 35, part B (browser side): after a "Près de moi" session, where is the position?
 *
 *   T35_MATCH=position-privacy playwright test --config web/map.playwright.config.ts --project m393-fr
 *
 * The web must be built with NEXT_PUBLIC_SENTRY_DSN=http://t35@localhost:3099/2 so that
 * the browser SDK is on, as in production; this spec runs the sink that receives it.
 */
import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { closeDb, query } from '../lib/db.ts';
import { assertAuditDb, proof } from '../lib/map-fixture.ts';
import { startSink } from '../lib/sentry-sink.ts';
import { API, fixture, open, signedIn, tileRequests, WEB } from './map-helpers.ts';

test('the position after a "Près de moi" session: storage, URL, third parties, Sentry, database', async ({ browser }, info) => {
  assertAuditDb();
  // Coordinates no stored point shares, even at four decimals.
  let here = { latitude: 0, longitude: 0 };
  for (let k = 0; k < 500 && here.latitude === 0; k++) {
    const lat = 36.731357 + k * 0.001009;
    const lng = 3.087913 + k * 0.001013;
    const used = await query<{ n: number }>(
      `SELECT ((SELECT count(*) FROM clients WHERE lat::text LIKE $1 OR lng::text LIKE $2)
             + (SELECT count(*) FROM warehouses WHERE lat::text LIKE $1 OR lng::text LIKE $2))::int AS n`,
      [`${lat.toFixed(6).slice(0, 7)}%`, `${lng.toFixed(6).slice(0, 6)}%`],
    );
    if (used[0]!.n === 0) here = { latitude: Number(lat.toFixed(6)), longitude: Number(lng.toFixed(6)) };
  }
  const needles = [String(here.latitude), String(here.longitude), String(here.latitude).slice(0, 7), String(here.longitude).slice(0, 6)];
  const has = (s: string | null | undefined): boolean => !!s && needles.some((n) => s.includes(n));

  const sink = await startSink(3099);
  const { context, page } = await signedIn(browser, info, fixture.a.owner, { position: { ...here, accuracy: 18 } });
  const requests: { url: string; body: string | null }[] = [];
  page.on('request', (r) => requests.push({ url: r.url(), body: r.postData() }));
  tileRequests.length = 0;

  await open(page, '/clients/carte');
  await page.locator('.leaflet-container').waitFor();
  const nearby = page.waitForRequest((r) => r.url().includes('/clients/nearby'));
  await page.getByRole('button', { name: 'Près de moi' }).click();
  const first = await nearby;
  // The one place the spec allows: the query of the nearby request.
  expect(has(first.url()), 'the nearby request carries the position').toBe(true);
  await expect(page.getByText('Clients proches')).toBeVisible();
  const again = page.waitForRequest((r) => r.url().includes('/clients/nearby') && r.url().includes('radiusM=10000'));
  await page.getByRole('radio', { name: /^10/ }).click();
  await again;
  await page.keyboard.press('Escape');
  // Pan the map a little, then leave the page and come back: a normal session.
  const box = (await page.locator('.leaflet-container').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 40, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(1500);
  // An unrelated browser error: Sentry sends it with the breadcrumbs of what came before.
  await page.evaluate(() => {
    setTimeout(() => {
      throw new Error('t35 probe error');
    }, 0);
  });
  await page.waitForTimeout(1500);
  const urlOnMap = page.url();
  await open(page, '/clients');
  await page.waitForTimeout(3000);

  const storage = await page.evaluate(async () => {
    const dump = (s: Storage): Record<string, string> => Object.fromEntries(Object.keys(s).map((k) => [k, s.getItem(k) ?? '']));
    const idb = 'databases' in indexedDB ? (await indexedDB.databases()).map((d) => d.name) : [];
    const cacheNames = 'caches' in window ? await caches.keys() : [];
    const cached: string[] = [];
    for (const n of cacheNames) for (const r of await (await caches.open(n)).keys()) cached.push(r.url);
    const sw = 'serviceWorker' in navigator ? (await navigator.serviceWorker.getRegistrations()).length : 0;
    return { local: dump(localStorage), session: dump(sessionStorage), idb, cacheNames, cached, sw };
  });
  const cookies = await context.cookies();
  const own = [new URL(WEB).host, new URL(API).host];
  const thirdParty = requests.filter((r) => !own.includes(new URL(r.url).host));
  const sentry = sink.bodies.join('\n');
  await sink.close();

  const sql = readFileSync(fileURLToPath(new URL('../sql/map-privacy.sql', import.meta.url)), 'utf8');
  const dbHits = await query(sql, [needles]);
  await closeDb();

  const sentryIdx = needles.map((n) => sentry.indexOf(n)).find((i) => i >= 0);
  const facts = {
    position: here,
    'nearby request (allowed by the spec)': first.url(),
    'page URL while on the map': urlOnMap,
    'localStorage keys': Object.keys(storage.local),
    'sessionStorage keys': Object.keys(storage.session),
    'position in localStorage': has(JSON.stringify(storage.local)),
    'position in sessionStorage': has(JSON.stringify(storage.session)),
    'IndexedDB databases': storage.idb,
    'Cache Storage': storage.cacheNames,
    'position in a cached URL': storage.cached.some(has),
    'service workers': storage.sw,
    'position in a cookie': cookies.some((c) => has(c.value)),
    'third-party hosts called': [...new Set(thirdParty.map((r) => new URL(r.url).host))],
    'third-party requests holding the position': thirdParty.filter((r) => has(r.url) || has(r.body)).map((r) => new URL(r.url).host),
    'Sentry envelopes received': sink.bodies.length,
    'position in a Sentry envelope': sentryIdx !== undefined,
    'Sentry sample': sentryIdx !== undefined ? sentry.slice(Math.max(0, sentryIdx - 350), sentryIdx + 150) : null,
    'tiles asked after "Près de moi" (z/x/y)': [...new Set(tileRequests.map((u) => new URL(u).pathname))].slice(-12),
    'database hits': dbHits,
  };
  proof('privacy-browser.json', JSON.stringify(facts, null, 2));

  expect.soft(has(urlOnMap), 'the position is in the page URL').toBe(false);
  expect.soft(facts['position in localStorage'], 'the position is in localStorage').toBe(false);
  expect.soft(facts['position in sessionStorage'], 'the position is in sessionStorage').toBe(false);
  expect.soft(storage.idb, 'an IndexedDB database exists (persisted query cache?)').toEqual([]);
  expect.soft(facts['position in a cached URL'], 'the position is in Cache Storage').toBe(false);
  expect.soft(facts['position in a cookie'], 'the position is in a cookie').toBe(false);
  expect.soft(dbHits, 'the position is in the database').toEqual([]);
  expect.soft(sink.bodies.length, 'Sentry was on in the browser (else nothing was tested)').toBeGreaterThan(0);
  expect.soft(facts['third-party requests holding the position'], 'the position was sent to a third party (Sentry envelope: see privacy-browser.json)').toEqual([]);
  await context.close();
});
