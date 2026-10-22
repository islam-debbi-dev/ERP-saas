/**
 * One shared tenant for the whole web audit.
 *
 * The login limiter counts every attempt (successful ones included), so a suite
 * that logs in for every check trips it after ten logins per minute. The setup
 * therefore creates the tenant once, logs in once and hands the browser state
 * to the tests that do not test the login itself.
 */
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { buildFixture } from '../api/fixture.ts';

const WEB = process.env['WEB'] ?? 'http://localhost:3005';
const PASSWORD = 'Audit1234!';
const authDir = fileURLToPath(new URL('../.auth/', import.meta.url));

export default async function globalSetup(): Promise<void> {
  await mkdir(authDir, { recursive: true });

  const fixture = await buildFixture('Web audit');
  await writeFile(`${authDir}fixture.json`, JSON.stringify(fixture, null, 2), 'utf8');

  const browser = await chromium.launch();
  try {
    const context = await browser.newContext();
    await context.addCookies([{ name: 'NEXT_LOCALE', value: 'en', url: WEB }]);
    const page = await context.newPage();
    await page.goto(`${WEB}/login`);
    await page.locator('#identifier').fill(fixture.session.email);
    await page.locator('#password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Log in' }).click();
    await page.waitForURL(/\/tableau-de-bord/);
    await page.waitForLoadState('networkidle');
    await context.storageState({ path: `${authDir}state.json` });
  } finally {
    await browser.close();
  }
}
