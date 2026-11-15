/**
 * Part D of test-36: the web of main before PR #72 (the "old web") against the phase 36 API,
 * on the screens the old Playwright suite does not open, with phase 36 rows in the data:
 * a truck with a code, a vehicle route (`sellerId` null) with stops, an order on a delivery truck.
 *
 * Needs the new API on :3003 (erp_t36_base), the old web on :3005 and the old suite's
 * `.auth/fixture.json` (written by the old desktop suite, step 6 of part-d.sh):
 *
 *   OLD=../erp-main API=http://localhost:3003 WEB=http://localhost:3005 \
 *     pnpm exec tsx test-36/old-web-vehicle-route.ts
 *
 * Writes `artifacts/test-36/part-d/old-web-*.png` and `old-web-screens.txt`.
 */
import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const OLD = resolve(process.env['OLD'] ?? '../erp-main');
const API = process.env['API'] ?? 'http://localhost:3003';
const WEB = process.env['WEB'] ?? 'http://localhost:3005';
const OUT = fileURLToPath(new URL('../artifacts/test-36/part-d/', import.meta.url));
const fx = JSON.parse(readFileSync(`${OLD}/e2e/.auth/fixture.json`, 'utf8')) as {
  session: { token: string; email: string };
};
const token = fx.session.token;

const api = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'idempotency-key': crypto.randomUUID(),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text.slice(0, 300)}`);
  return (text ? JSON.parse(text) : null) as T;
};

// Phase 36 rows, written through the new API.
const truck = await api<{ id: string }>('POST', '/warehouses', {
  name: `Camion v36 ${Date.now().toString(36)}`,
  type: 'VEHICLE',
  code: `VAN-28 MXT ${String(Date.now() % 100).padStart(2, '0')}`,
  wilayaCode: 28,
  plateNumber: '00123-119-28',
});
const clients = await api<{ items?: { id: string }[] } | { id: string }[]>(
  'GET',
  '/clients?limit=3',
);
const clientIds = (Array.isArray(clients) ? clients : (clients.items ?? []))
  .map((c) => c.id)
  .slice(0, 2);
const route = await api<{ id: string; sellerId?: string | null }>('POST', '/routes', {
  name: 'Tournée du camion (v36)',
  vehicleId: truck.id,
  weekdays: [0, 1, 2, 3, 4, 5, 6],
  active: true,
});
if (clientIds.length) await api('PUT', `/routes/${route.id}/stops`, { clientIds });
console.log(
  `vehicle route ${route.id}, sellerId ${route.sellerId ?? null}, ${clientIds.length} stops`,
);

const screens: [string, string][] = [
  ['tournees', '/tournees'],
  ['tournee-vehicule', `/tournees/${route.id}`],
  ['aujourdhui', '/tournees/aujourdhui'],
  ['tournees-rapports', '/tournees/rapports'],
  ['commandes', '/commandes'],
  ['livraisons', '/livraisons'],
  ['stock-depots', '/stock/depots'],
];
const browser = await chromium.launch();
const lines: string[] = [
  `old web ${WEB}, new API ${API}, vehicle route ${route.id} (sellerId ${route.sellerId ?? null})`,
];
let broken = 0;
try {
  // The old suite's saved session ends with its logout test: log in through the form.
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addCookies([{ name: 'NEXT_LOCALE', value: 'en', url: WEB }]);
  const login = await ctx.newPage();
  await login.goto(`${WEB}/login`);
  await login.locator('#identifier').fill(fx.session.email);
  await login.locator('#password').fill('Audit1234!');
  await login.getByRole('button', { name: 'Log in' }).click();
  await login.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30_000 });
  await login.close();
  for (const [name, path] of screens) {
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(`console: ${m.text().slice(0, 200)}`);
    });
    const res = await page.goto(`${WEB}${path}`);
    await page.waitForLoadState('networkidle').catch(() => undefined);
    await page.waitForTimeout(800);
    const body = await page.locator('body').innerText();
    const crashed =
      /Application error|Something went wrong|Une erreur|Unhandled Runtime Error|couldn.t load/i.test(
        body,
      );
    const showsRoute = body.includes('Tournée du camion (v36)');
    await page.screenshot({ path: `${OUT}old-web-${name}.png`, fullPage: true });
    if (crashed || errors.some((e) => e.startsWith('pageerror'))) broken += 1;
    lines.push(
      `${crashed ? 'BROKEN' : 'ok    '} ${path}  HTTP ${res?.status()}  shows the vehicle route: ${showsRoute}` +
        (errors.length ? `\n         ${errors.slice(0, 4).join('\n         ')}` : ''),
    );
    await page.close();
  }
} finally {
  await browser.close();
}
lines.push(`${screens.length} screens, ${broken} broken`);
writeFileSync(`${OUT}old-web-screens.txt`, lines.join('\n') + '\n');
console.log(lines.join('\n'));
