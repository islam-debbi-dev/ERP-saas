import { randomUUID } from 'node:crypto';
import type { INestApplication, Type } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import type { Activity, AuthResponse } from '@erp/shared';
import { AppModule } from '../src/app.module';
import { ClockService } from '../src/clock/clock.service';
import { tenantContext } from '../src/common/tenant-context';
import { APP_CONFIG, type AppConfig } from '../src/config/app-config';
import { PrismaService } from '../src/prisma/prisma.service';
import { setupApp } from '../src/setup-app';

export interface TestApp {
  app: INestApplication<App>;
  prisma: PrismaService;
  http: () => ReturnType<typeof request>;
  close: () => Promise<void>;
}

/** A clock tests move by hand (subscription expiry), instead of fake timers. */
export class FakeClock extends ClockService {
  private offsetMs = 0;

  override now(): Date {
    return new Date(Date.now() + this.offsetMs);
  }

  advanceDays(days: number): void {
    this.offsetMs += days * 24 * 3600 * 1000;
  }

  reset(): void {
    this.offsetMs = 0;
  }
}

/** Boots the real AppModule (plus optional test-only modules) against the test database. */
export async function createTestApp(
  extraModules: Type[] = [],
  options: { clock?: ClockService } = {},
): Promise<TestApp> {
  let builder = Test.createTestingModule({ imports: [AppModule, ...extraModules] });
  if (options.clock) builder = builder.overrideProvider(ClockService).useValue(options.clock);
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication<INestApplication<App>>({ bufferLogs: true });
  setupApp(app, app.get<AppConfig>(APP_CONFIG));
  await app.init();
  return {
    app,
    prisma: app.get(PrismaService),
    http: () => request(app.getHttpServer()),
    close: () => app.close(),
  };
}

export function uniqueEmail(prefix = 'user'): string {
  return `${prefix}-${randomUUID().slice(0, 8)}@test.dz`;
}

export interface RegisteredTenant {
  auth: AuthResponse & { refreshToken: string };
  email: string;
  password: string;
  tenantId: string;
}

/**
 * Registers a new company + owner as a native client (refresh token in the body).
 * The tenant is made free (pilot) so plan limits stay out of unrelated tests; pass
 * `{ trial: true }` to keep the 30-day trial a real signup gets. `activity` picks the
 * edition (phase 13b); none means grossiste (ESSENTIEL).
 */
export async function registerTenant(
  t: TestApp,
  companyName = 'Test SARL',
  options: { trial?: boolean; activity?: Activity } = {},
): Promise<RegisteredTenant> {
  const email = uniqueEmail('owner');
  const password = 'Password123!';
  const res = await t
    .http()
    .post('/auth/register')
    .set('X-Client-Type', 'native')
    .send({
      companyName,
      fullName: 'Owner Test',
      email,
      password,
      deviceName: 'jest',
      ...(options.activity ? { activity: options.activity } : {}),
    })
    .expect(201);
  const auth = res.body as AuthResponse & { refreshToken: string };
  if (!options.trial) {
    await tamper(
      t,
    )`UPDATE subscriptions SET "isFree" = true WHERE "tenantId" = ${auth.user.tenantId}::uuid`;
  }
  return { auth, email, password, tenantId: auth.user.tenantId };
}

/**
 * Turns the position check off (phase 17) for a DISTRIBUTION tenant whose tests are about
 * something else: without it every seller operation sent without a position needs a note.
 */
export async function withoutGeoCheck(t: TestApp, who: RegisteredTenant): Promise<void> {
  await tamper(t)`UPDATE tenants SET "geoCheckMode" = 'OFF' WHERE id = ${who.tenantId}::uuid`;
}

/** Runs `fn` as if inside an authenticated request of `tenantId`. */
export function asTenant<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
  return tenantContext.run({ tenantId }, fn);
}

/**
 * Test-only raw SQL that tampers with rows (backdating, corrupting): runs in the
 * system context, past the RLS policies, like a script run by the owner would.
 */
export function tamper(t: TestApp) {
  return (sql: TemplateStringsArray, ...values: unknown[]): Promise<number> =>
    tenantContext.runAsSystem(() => t.prisma.db.$executeRaw(sql, ...values));
}

export function bearer(token: string): [string, string] {
  return ['Authorization', `Bearer ${token}`];
}

// ---------------------------------------------------------------- catalog helpers

export interface TenantCatalog {
  units: Record<string, { id: string }>;
  levels: { id: string }[];
}

export async function catalogOf(t: TestApp, who: RegisteredTenant): Promise<TenantCatalog> {
  const units = (
    await t
      .http()
      .get('/units')
      .set(...bearer(who.auth.accessToken))
      .expect(200)
  ).body as {
    id: string;
    code: string;
  }[];
  const levels = (
    await t
      .http()
      .get('/price-levels')
      .set(...bearer(who.auth.accessToken))
      .expect(200)
  ).body as { id: string }[];
  return { units: Object.fromEntries(units.map((u) => [u.code, u])), levels };
}

let productSeq = 0;

/** Creates a pièce product with a carton of `cartonFactor` and returns its ids. */
export async function createProduct(
  t: TestApp,
  who: RegisteredTenant,
  catalog: TenantCatalog,
  opts: {
    cartonFactor?: string;
    minStock?: string;
    designation?: string;
    base?: 'PIECE' | 'KG';
  } = {},
): Promise<{ id: string; baseUnitId: string; cartonUnitId: string }> {
  const base = catalog.units[opts.base ?? 'PIECE']!.id;
  const carton = catalog.units[opts.base === 'KG' ? 'SAC' : 'CARTON']!.id;
  const res = await t
    .http()
    .post('/products')
    .set(...bearer(who.auth.accessToken))
    .send({
      reference: `P-${Date.now()}-${productSeq++}`,
      designation: opts.designation ?? `Produit ${productSeq}`,
      baseUnitId: base,
      tvaRate: '19',
      minStock: opts.minStock ?? '0',
      units: [
        {
          unitId: base,
          factorToBase: '1',
          barcode: null,
          isDefaultSale: true,
          isDefaultPurchase: false,
        },
        {
          unitId: carton,
          factorToBase: opts.cartonFactor ?? '24',
          barcode: null,
          isDefaultSale: false,
          isDefaultPurchase: true,
        },
      ],
    })
    .expect(201);
  return { id: (res.body as { id: string }).id, baseUnitId: base, cartonUnitId: carton };
}
