/**
 * Test 35, part C (browser side): the client map on a slow phone.
 *
 *   T35_MATCH=map-perf playwright test --config web/map.playwright.config.ts --project m360-fr
 *
 * 360 px wide, CPU slowed four times (CDP `Emulation.setCPUThrottlingRate`), tenant A's
 * owner: 4 050 clients match, so the API answers 2 000 points and `truncated`.
 * Measured: navigation → points drawn, a pan and a zoom, the JS heap after 20 pans, and
 * how many `/clients/map` requests ten quick pans send.
 */
import { expect, test, type Page } from '@playwright/test';
import { proof } from '../lib/map-fixture.ts';
import { fixture, signedIn, WEB } from './map-helpers.ts';

/** The slowdown; 4 is the prompt's. `T35_CPU=8` writes perf-browser-x8.json for a weaker phone. */
const CPU = Number(process.env['T35_CPU'] ?? 4);

/** Painted pixels of the Leaflet canvas (the points are canvas circles above 500). */
const painted = (page: Page): Promise<number> =>
  page.evaluate(() => {
    const c = document.querySelector<HTMLCanvasElement>('.leaflet-overlay-pane canvas');
    if (!c || c.width === 0) return 0;
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 16) if (d[i] !== 0) n++;
    return n;
  });

/** Records the gaps between animation frames while `during` runs, then until calm. */
async function frames(page: Page, during: () => Promise<void>): Promise<{ worstMs: number; over50: number; over100: number; busyMs: number }> {
  await page.evaluate(() => {
    const w = window as unknown as { __gaps: number[]; __on: boolean };
    w.__gaps = [];
    w.__on = true;
    let last = performance.now();
    const tick = (t: number): void => {
      w.__gaps.push(t - last);
      last = t;
      if (w.__on) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await during();
  await page.waitForTimeout(1500);
  const gaps = await page.evaluate(() => {
    const w = window as unknown as { __gaps: number[]; __on: boolean };
    w.__on = false;
    return w.__gaps;
  });
  const over = gaps.filter((g) => g > 50);
  return {
    worstMs: Math.round(Math.max(0, ...gaps)),
    over50: over.length,
    over100: gaps.filter((g) => g > 100).length,
    busyMs: Math.round(over.reduce((a, g) => a + g, 0)),
  };
}

async function drag(page: Page, dx: number, dy: number, steps = 6): Promise<void> {
  const box = (await page.locator('.leaflet-container').boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps });
  await page.mouse.up();
}

test('2 000 points on a 360 px phone with the CPU slowed four times', async ({ browser }, info) => {
  test.setTimeout(300_000);
  const { context, page } = await signedIn(browser, info, fixture.a.owner);
  const cdp = await context.newCDPSession(page);
  await cdp.send('Performance.enable');
  const heap = async (): Promise<number> => {
    await cdp.send('HeapProfiler.collectGarbage');
    const m = await cdp.send('Performance.getMetrics');
    return Math.round((m.metrics.find((x) => x.name === 'JSHeapUsedSize')!.value / 1024 / 1024) * 10) / 10;
  };
  const mapRequests: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/clients/map')) mapRequests.push(r.url());
  });

  let unthrottled: { navToDrawnMs: number; responseToDrawnMs: number; apiMs: number; points: number } | null = null;
  const runs: { navToDrawnMs: number; responseToDrawnMs: number; apiMs: number; points: number }[] = [];
  for (const rate of [1, CPU, CPU, CPU]) {
    await cdp.send('Emulation.setCPUThrottlingRate', { rate });
    const response = page.waitForResponse((r) => r.url().includes('/clients/map') && r.status() === 200);
    const t0 = Date.now();
    await page.goto(`${WEB}/clients/carte`);
    const res = await response;
    const tResponse = Date.now();
    const points = ((await res.json()) as { points: unknown[] }).points.length;
    await page.waitForFunction(() => {
      const c = document.querySelector<HTMLCanvasElement>('.leaflet-overlay-pane canvas');
      if (!c || c.width === 0) return false;
      const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
      let n = 0;
      for (let i = 3; i < d.length; i += 16) if (d[i] !== 0) n++;
      return n > 200;
    }, undefined, { polling: 50, timeout: 120_000 });
    const tDrawn = Date.now();
    const timing = res.request().timing();
    runs.push({ navToDrawnMs: tDrawn - t0, responseToDrawnMs: tDrawn - tResponse, apiMs: Math.round(timing.responseEnd), points });
    if (rate === 1) unthrottled = runs.pop()!; // the first load warms the browser cache; kept for comparison
    await page.waitForTimeout(500);
  }
  const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
  const navToDrawn = median(runs.map((r) => r.navToDrawnMs));
  const responseToDrawn = median(runs.map((r) => r.responseToDrawnMs));
  expect(runs[0]!.points, 'the cap is reached: 2 000 points').toBe(2000);
  await expect(page.getByText(/Plus de 2\s000 clients/)).toBeVisible();
  if (CPU === 4) await page.screenshot({ path: `${info.config.rootDir}/../artifacts/test-35/perf-360-2000-points.png`, scale: 'css' });

  // A pan and a zoom, with 2 000 points on screen.
  await page.waitForTimeout(1500);
  const pan = await frames(page, () => drag(page, 120, 80, 10));
  const zoom = await frames(page, async () => {
    await page.locator('.leaflet-control-zoom-in').click();
  });
  const zoomOut = await frames(page, async () => {
    await page.locator('.leaflet-control-zoom-out').click();
  });

  // Debounce: ten quick pans in about two seconds.
  await page.waitForTimeout(1500);
  mapRequests.length = 0;
  const tPans = Date.now();
  for (let i = 0; i < 10; i++) {
    await drag(page, i % 2 === 0 ? 40 : -40, i % 2 === 0 ? 25 : -25, 2);
    await page.waitForTimeout(120);
  }
  const pansMs = Date.now() - tPans;
  await page.waitForTimeout(2500);
  const requestsForTenPans = mapRequests.length;

  // Memory: 20 pans, each followed by its refetch.
  const heapBefore = await heap();
  for (let i = 0; i < 20; i++) {
    await drag(page, i % 2 === 0 ? 90 : -90, i % 2 === 0 ? 60 : -60, 3);
    await page.waitForTimeout(900);
  }
  const heapAfter = await heap();
  if (CPU === 4) await page.screenshot({ path: `${info.config.rootDir}/../artifacts/test-35/perf-360-after-pans.png`, scale: 'css' });

  const facts = {
    setup: `360 × 640, CPU ×${CPU}, tenant A owner, 2 000 points (canvas), tiles answered locally by a 1×1 PNG`,
    'first load without throttling (cold cache)': unthrottled,
    runs,
    'navigation → points drawn, median of 3 (ms)': navToDrawn,
    '/clients/map response → points drawn, median of 3 (ms)': responseToDrawn,
    'pan 120 px: worst frame / frames over 50 ms / over 100 ms / busy ms': pan,
    'zoom in': zoom,
    'zoom out': zoomOut,
    'ten pans': { tookMs: pansMs, mapRequests: requestsForTenPans, urls: mapRequests.map((u) => u.split('?')[1]) },
    'JS heap before / after 20 pans (MB)': [heapBefore, heapAfter],
  };
  proof(CPU === 4 ? 'perf-browser.json' : `perf-browser-x${CPU}.json`, JSON.stringify(facts, null, 2));
  console.log(JSON.stringify({ ...facts, runs: undefined, 'ten pans': { tookMs: pansMs, mapRequests: requestsForTenPans } }, null, 2));

  // Prompt: high = "more than 2 s to show 2 000 points".
  expect.soft(navToDrawn, 'navigation → 2 000 points drawn, CPU ×4').toBeLessThan(2000);
  expect.soft(responseToDrawn, 'answer received → 2 000 points drawn, CPU ×4').toBeLessThan(2000);
  // Spec: debounced 400 ms on moveend: ten pans in two seconds are a few requests, not ten.
  expect.soft(requestsForTenPans, '/clients/map requests for ten quick pans').toBeLessThanOrEqual(4);
  expect.soft(pan.worstMs, 'worst frame during a pan (ms)').toBeLessThan(500);
  expect.soft(zoom.worstMs, 'worst frame during a zoom (ms)').toBeLessThan(1000);
  expect.soft(heapAfter - heapBefore, 'heap growth after 20 pans (MB)').toBeLessThan(30);
  await context.close();
});
