/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- API payloads are read loosely on purpose */
/**
 * Field demo data for the PRODUCTION "demo-volume" company: users of every role, trucks,
 * ~150 clients with GPS points around M'Sila, stock, chargements, tournées, today's sales /
 * versements / visits / orders, 30 days of history, targets and an inventory draft.
 *
 * It goes through the API (as the OWNER, and as each vendeur for what the GPS check and the
 * cash of the day need), never through SQL. Idempotent: fixed Idempotency-Keys and a check
 * before each create. See docs/seed-field.md.
 *
 *   read -s "SEED_OWNER_PASSWORD?Password demo-volume: "; export SEED_OWNER_PASSWORD
 *   read -s "SEED_USERS_PASSWORD?Password des nouveaux users: "; export SEED_USERS_PASSWORD
 *   pnpm --filter @erp/api db:seed:field -- --dry-run
 *   pnpm --filter @erp/api db:seed:field            # add --today for the day's part only
 */
import 'dotenv/config';
import { Api, newTally, type Obj } from '../scripts/seed-field/http.js';
import { USERS } from '../scripts/seed-field/data.js';
import { assertDemoVolumeTenant, preflightProblems } from '../scripts/seed-field/guard.js';
import { algiersToday, arr, type Ctx } from '../scripts/seed-field/util.js';
import {
  ensureClients, ensurePromotions, ensureProducts, ensureSectors, ensureStock, ensureTrucks, ensureUsers,
} from '../scripts/seed-field/setup.js';
import { ensureLoads, ensureOrders, ensureRoutes, runToday } from '../scripts/seed-field/field.js';
import { ensureClosedDays, ensureHistory, ensureInventory, ensureTargets } from '../scripts/seed-field/history.js';

const args = new Set(process.argv.slice(2));
const dry = args.has('--dry-run');
const onlyToday = args.has('--today');

const need = (name: string): string => {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing env ${name}.`);
    process.exit(1);
  }
  return v;
};

async function main(): Promise<void> {
  const base = (process.env['API_URL'] || 'https://erp-saas-pi.vercel.app').replace(/\/$/, '');
  const email = process.env['SEED_EMAIL'] || 'demo-volume@grossiste.dz';
  const ownerPassword = need('SEED_OWNER_PASSWORD');
  const usersPassword = need('SEED_USERS_PASSWORD');
  const tally = newTally();
  const owner = new Api(base, email, ownerPassword, dry, tally);
  console.log(`Seed field: ${dry ? 'DRY RUN (nothing is written) · ' : ''}${onlyToday ? "today's part only · " : ''}${base}`);
  await owner.login();

  // 1. The tenant guard, before any write.
  const me = await owner.get<Obj>('/auth/me');
  assertDemoVolumeTenant(
    { email: me['email'] ?? null, role: me['role'], tenantName: me['tenantName'], features: me['features'] ?? [] },
    email,
  );
  console.log(`Company "${me['tenantName']}", owner ${me['email']}: OK.`);

  // 2. What the company must have (feature flags, plan, geo mode).
  const [sub, settings, users] = await Promise.all([
    owner.get<Obj>('/tenant/subscription'),
    owner.get<Obj>('/tenant/settings'),
    owner.get<unknown>('/users'),
  ]);
  const existingEmails = new Set(arr<Obj>(users).map((u) => String(u['email']).toLowerCase()));
  const problems = preflightProblems({
    me: { email: me['email'], role: me['role'], tenantName: me['tenantName'], features: me['features'] ?? [] },
    maxMobileSellers: sub['plan']?.['maxMobileSellers'] ?? null,
    maxUsers: sub['plan']?.['maxUsers'] ?? null,
    userCount: existingEmails.size,
    usersToCreate: USERS.filter((u) => !existingEmails.has(u.email)).length,
    geoCheckMode: settings['geoCheckMode'],
    creditLimitMode: settings['creditLimitMode'],
  });
  if (problems.length > 0) {
    console.error('\nFix this in the super-admin, then run again:\n' + problems.map((p) => `  - ${p}`).join('\n'));
    process.exit(1);
  }

  const ctx: Ctx = {
    owner, base, today: algiersToday(), onlyToday, usersPassword, mainId: '',
    users: {}, trucks: {}, clients: [], sellable: [], levelIds: [], routes: {}, warnings: [],
  };

  const step = async (name: string, fn: () => Promise<unknown>) => {
    console.log(`• ${name}`);
    return fn();
  };
  await step('users', () => ensureUsers(ctx));
  await step('trucks and drivers', () => ensureTrucks(ctx));
  const sectors = await step('sectors', () => ensureSectors(ctx));
  await step('clients', () => ensureClients(ctx, sectors as Record<string, string>));
  await step('products', () => ensureProducts(ctx));
  if (!onlyToday) await step('promotions', () => ensurePromotions(ctx));
  const stock = (await step('dépôt stock', () => ensureStock(ctx))) as Map<string, number>;
  await step('chargements', () => ensureLoads(ctx));
  await step('tournées', () => ensureRoutes(ctx));
  await step("today's field activity", () => runToday(ctx));
  await step('orders', () => ensureOrders(ctx));
  if (!onlyToday) {
    await step('30 days of history', () => ensureHistory(ctx));
    await step('closed days', () => ensureClosedDays(ctx));
    await step('targets', () => ensureTargets(ctx));
    await step('inventory', () => ensureInventory(ctx, stock));
  }

  // The final report: who, then how much.
  console.log('\nRole           | Name                 | Email                              | Team | Truck');
  for (const u of USERS) {
    console.log(`${u.role.padEnd(14)} | ${u.fullName.padEnd(20)} | ${u.email.padEnd(34)} | ${u.team.padEnd(4)} | ${u.truck ?? '-'}`);
  }
  const labels = [...new Set([...Object.keys(tally.created), ...Object.keys(tally.existing)])];
  console.log(`\n${'What'.padEnd(34)} | ${dry ? 'would create' : 'created'} | already there`);
  for (const l of labels) {
    console.log(`${l.padEnd(34)} | ${String(tally.created[l] ?? 0).padStart(12)} | ${String(tally.existing[l] ?? 0).padStart(13)}`);
  }
  if (ctx.warnings.length > 0) {
    console.log(`\n${ctx.warnings.length} step(s) failed and were skipped (run again to complete them):`);
    for (const w of ctx.warnings) console.log(`  ! ${w}`);
    process.exitCode = 2;
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
