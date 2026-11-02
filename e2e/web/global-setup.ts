/**
 * One shared tenant for the whole web audit.
 *
 * The login limiter counts every attempt (successful ones included), so a suite
 * that logs in for every check trips it after ten logins per minute. The setup
 * therefore creates the tenant once, logs in once and hands the browser state
 * to the tests that do not test the login itself.
 */
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { buildFixture } from '../api/fixture.ts';
import { call } from '../lib/http.ts';
import { totp } from '../lib/totp.ts';

const WEB = process.env['WEB'] ?? 'http://localhost:3005';
const PASSWORD = 'Audit1234!';
const authDir = fileURLToPath(new URL('../.auth/', import.meta.url));

export default async function globalSetup(): Promise<void> {
  await mkdir(authDir, { recursive: true });

  // Distribution edition: every screen, the sales force ones included (phase 14), is swept.
  const fixture = await buildFixture('Web audit', 'DISTRIBUTEUR');
  await writeFile(`${authDir}fixture.json`, JSON.stringify(fixture, null, 2), 'utf8');
  const admin = createAdmin();
  await writeFile(`${authDir}admin.json`, JSON.stringify(admin, null, 2), 'utf8');
  // Phase 22: the dossiers d'importation screens are swept too (a module of the IMPORT edition).
  await grantFeature(admin, fixture.session.tenantId, 'IMPORT_COSTS');

  const browser = await chromium.launch();
  try {
    const context = await browser.newContext();
    await context.addCookies([{ name: 'NEXT_LOCALE', value: 'en', url: WEB }]);
    const page = await context.newPage();
    await page.goto(`${WEB}/login`);
    await page.locator('#identifier').fill(fixture.session.email);
    await page.locator('#password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Log in' }).click();
    // The dashboard, or the Vue d'ensemble for a user with several dépôts (phase 26).
    await page.waitForURL(/\/(tableau-de-bord|vue-ensemble)/);
    await page.waitForLoadState('networkidle');
    await context.storageState({ path: `${authDir}state.json` });
  } finally {
    await browser.close();
  }
}

/**
 * A super-admin for the admin screens, made by the real CLI against the API's database
 * (apps/api/.env). Its output gives the one-time password and the TOTP secret.
 */
function createAdmin(): { email: string; password: string; secret: string } {
  const email = `e2e-admin-${Date.now()}@platform.dz`;
  const out = execFileSync('pnpm', ['--filter', '@erp/api', 'admin:create', '--email', email], {
    cwd: fileURLToPath(new URL('../../', import.meta.url)),
    encoding: 'utf8',
  });
  const password = /Password \(shown once\):\s+(\S+)/.exec(out)?.[1];
  const secret = /TOTP secret:\s+(\S+)/.exec(out)?.[1];
  if (!password || !secret) throw new Error(`admin:create gave no credentials:\n${out}`);
  return { email, password, secret };
}

/**
 * Adds a module to the tenant through the super-admin API, which also drops the API's
 * features cache entry (a direct DB update would wait for its TTL).
 */
async function grantFeature(
  admin: { email: string; password: string; secret: string },
  tenantId: string,
  feature: string,
): Promise<void> {
  const login = await call<{ accessToken: string }>('/admin/auth/login', {
    method: 'POST',
    body: { email: admin.email, password: admin.password, code: totp(admin.secret) },
  });
  await call(`/admin/tenants/${tenantId}/subscription`, {
    method: 'PATCH',
    token: login.body.accessToken,
    body: { featureGrants: [feature] },
  });
}
