import { randomUUID } from 'node:crypto';
import type { INestApplication, Type } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import type { AuthResponse } from '@erp/shared';
import { AppModule } from '../src/app.module';
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

/** Boots the real AppModule (plus optional test-only modules) against the test database. */
export async function createTestApp(extraModules: Type[] = []): Promise<TestApp> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule, ...extraModules],
  }).compile();
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

/** Registers a new company + owner as a native client (refresh token in the body). */
export async function registerTenant(
  t: TestApp,
  companyName = 'Test SARL',
): Promise<RegisteredTenant> {
  const email = uniqueEmail('owner');
  const password = 'Password123!';
  const res = await t
    .http()
    .post('/auth/register')
    .set('X-Client-Type', 'native')
    .send({ companyName, fullName: 'Owner Test', email, password, deviceName: 'jest' })
    .expect(201);
  const auth = res.body as AuthResponse & { refreshToken: string };
  return { auth, email, password, tenantId: auth.user.tenantId };
}

/** Runs `fn` as if inside an authenticated request of `tenantId`. */
export function asTenant<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
  return tenantContext.run({ tenantId }, fn);
}

export function bearer(token: string): [string, string] {
  return ['Authorization', `Bearer ${token}`];
}
