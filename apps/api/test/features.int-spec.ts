import { randomUUID } from 'node:crypto';
import { Controller, Get, Module, Post } from '@nestjs/common';
import * as argon2 from 'argon2';
import {
  Activity,
  type AdminAuthResponse,
  type AdminTenantDetail,
  type AuthUser,
  Edition,
  ErrorCode,
  Feature,
  type SubscriptionSummary,
} from '@erp/shared';
import { newTotpSecret, totp } from '../src/admin/totp';
import { RequireFeature } from '../src/auth/decorators';
import { tenantContext } from '../src/common/tenant-context';
import {
  bearer,
  createTestApp,
  FakeClock,
  registerTenant,
  type RegisteredTenant,
  tamper,
  type TestApp,
} from './helpers';

/** Test-only routes of a module outside the core, standing in for a GEO_CHECK screen. */
@Controller('test-geo')
@RequireFeature(Feature.GEO_CHECK)
class GeoTestController {
  @Get()
  read(): { ok: true } {
    return { ok: true };
  }

  @Post()
  write(): { ok: true } {
    return { ok: true };
  }
}

@Module({ controllers: [GeoTestController] })
class GeoTestModule {}

const PASSWORD = 'Admin-Password-1!';

describe('editions and feature flags (phase 13b)', () => {
  const clock = new FakeClock();
  let t: TestApp;
  let admin: AdminAuthResponse;
  let seq = 0;

  const getGeo = (who: RegisteredTenant) =>
    t
      .http()
      .get('/test-geo')
      .set(...bearer(who.auth.accessToken));
  const postGeo = (who: RegisteredTenant) =>
    t
      .http()
      .post('/test-geo')
      .set(...bearer(who.auth.accessToken))
      .send({});
  const me = async (who: RegisteredTenant) =>
    (
      await t
        .http()
        .get('/auth/me')
        .set(...bearer(who.auth.accessToken))
        .expect(200)
    ).body as AuthUser;
  const patchSubscription = (tenantId: string, body: object, token = admin.accessToken) =>
    t
      .http()
      .patch(`/admin/tenants/${tenantId}/subscription`)
      .set(...bearer(token))
      .send(body);

  beforeAll(async () => {
    t = await createTestApp([GeoTestModule], { clock });
    const email = `admin-${randomUUID().slice(0, 8)}@platform.dz`;
    const secret = newTotpSecret();
    const passwordHash = await argon2.hash(PASSWORD, { type: argon2.argon2id });
    await tenantContext.runAsSystem(() =>
      t.prisma.db.platformAdmin.create({
        data: { email, fullName: 'Super Admin', passwordHash, totpSecret: secret },
      }),
    );
    admin = (
      await t
        .http()
        .post('/admin/auth/login')
        .set('X-Forwarded-For', `10.13.0.${++seq}`)
        .send({ email, password: PASSWORD, code: totp(secret) })
        .expect(200)
    ).body as AdminAuthResponse;
  });
  afterAll(() => t.close());
  afterEach(() => clock.reset());

  it('picks the edition from the activity at signup and returns the features', async () => {
    const grossiste = await registerTenant(t, 'Edition Grossiste', { trial: true });
    expect(grossiste.auth.user).toMatchObject({ edition: Edition.ESSENTIEL, features: [] });

    const importer = await registerTenant(t, 'Edition Import', {
      trial: true,
      activity: Activity.IMPORTATEUR,
    });
    expect(importer.auth.user.edition).toBe(Edition.IMPORT);
    expect(importer.auth.user.features).toEqual([Feature.WAREHOUSES, Feature.IMPORT_COSTS]);

    const distributor = await registerTenant(t, 'Edition Distribution', {
      trial: true,
      activity: Activity.DISTRIBUTEUR,
    });
    const sub = await tenantContext.runAsSystem(() =>
      t.prisma.db.subscription.findUniqueOrThrow({
        where: { tenantId: distributor.tenantId },
        include: { plan: true },
      }),
    );
    // The trial runs on the trial plan with the chosen edition.
    expect(sub).toMatchObject({ edition: 'DISTRIBUTION', status: 'TRIAL' });
    expect(sub.plan.code).toBe('PRO');
    expect((await me(distributor)).features).toContain(Feature.MOBILE_APP);
    await getGeo(distributor).expect(200);

    await t
      .http()
      .post('/auth/register')
      .send({
        companyName: 'Bad',
        fullName: 'Bad',
        email: `bad-${randomUUID().slice(0, 6)}@test.dz`,
        password: 'Password123!',
        activity: 'PIRATE',
      })
      .expect(400);
  });

  it('refuses a module outside the plan, reads and writes, and opens it after a grant', async () => {
    const a = await registerTenant(t, 'Flags A');
    for (const res of [await getGeo(a), await postGeo(a)]) {
      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({
        code: ErrorCode.FEATURE_NOT_IN_PLAN,
        details: {
          feature: Feature.GEO_CHECK,
          edition: Edition.ESSENTIEL,
          editions: [Edition.DISTRIBUTION, Edition.ENTREPRISE],
        },
      });
    }

    // Prime the cache, then grant: the change applies on the next request, same token.
    expect((await me(a)).features).toEqual([]);
    const granted = await patchSubscription(a.tenantId, {
      featureGrants: [Feature.GEO_CHECK],
    }).expect(200);
    expect((granted.body as SubscriptionSummary).features).toEqual([Feature.GEO_CHECK]);
    await getGeo(a).expect(200);
    await postGeo(a).expect(201);
    expect((await me(a)).features).toEqual([Feature.GEO_CHECK]);

    // A revoke wins over the edition: DISTRIBUTION minus GEO_CHECK.
    await patchSubscription(a.tenantId, {
      edition: Edition.DISTRIBUTION,
      featureGrants: [],
      featureRevokes: [Feature.GEO_CHECK],
    }).expect(200);
    await getGeo(a).expect(403);
    const after = await me(a);
    expect(after.edition).toBe(Edition.DISTRIBUTION);
    expect(after.features).toContain(Feature.SALES_FORCE);
    expect(after.features).not.toContain(Feature.GEO_CHECK);

    await patchSubscription(a.tenantId, { featureRevokes: [] }).expect(200);
    await getGeo(a).expect(200);
  });

  it('serves the cached modules for 60 s, then reads the database again', async () => {
    const a = await registerTenant(t, 'Flags Cache');
    await getGeo(a).expect(403);
    // A change made outside the super-admin flow does not clear the cache…
    await tamper(
      t,
    )`UPDATE subscriptions SET edition = 'ENTREPRISE' WHERE "tenantId" = ${a.tenantId}::uuid`;
    await getGeo(a).expect(403);
    // …so it shows once the entry expires.
    clock.advanceDays(1);
    await getGeo(a).expect(200);
  });

  it('keeps each tenant to its own modules', async () => {
    const a = await registerTenant(t, 'Flags Iso A');
    const b = await registerTenant(t, 'Flags Iso B');
    await patchSubscription(a.tenantId, { edition: Edition.ENTREPRISE }).expect(200);
    await getGeo(a).expect(200);
    await getGeo(b).expect(403);
    expect((await me(b)).features).toEqual([]);
  });

  it('only the super-admin changes modules, and every change is audited', async () => {
    const a = await registerTenant(t, 'Flags Audit');
    // A tenant owner's token is not an admin token.
    const own = await patchSubscription(
      a.tenantId,
      { featureGrants: [Feature.GEO_CHECK] },
      a.auth.accessToken,
    );
    expect(own.status).toBe(401);
    await getGeo(a).expect(403);

    const bad = await patchSubscription(a.tenantId, {
      featureGrants: [Feature.GEO_CHECK],
      featureRevokes: [Feature.GEO_CHECK],
    });
    expect(bad.status).toBe(400);
    await patchSubscription(a.tenantId, { featureGrants: ['TELEPORT'] }).expect(400);
    await patchSubscription(a.tenantId, { edition: 'GOLD' }).expect(400);

    await patchSubscription(a.tenantId, {
      edition: Edition.IMPORT,
      featureGrants: [Feature.GEO_CHECK],
    }).expect(200);

    const [platform, journal] = await tenantContext.runAsSystem(() =>
      Promise.all([
        t.prisma.db.platformAuditLog.findFirstOrThrow({
          where: { tenantId: a.tenantId, action: 'SUBSCRIPTION_UPDATED' },
          orderBy: { createdAt: 'desc' },
        }),
        t.prisma.db.auditLog.findFirstOrThrow({
          where: { tenantId: a.tenantId, action: 'SUBSCRIPTION_UPDATED' },
          orderBy: { createdAt: 'desc' },
        }),
      ]),
    );
    expect(platform.detail).toMatchObject({
      before: { edition: 'ESSENTIEL', featureGrants: [], featureRevokes: [] },
      after: { edition: 'IMPORT', featureGrants: [Feature.GEO_CHECK], featureRevokes: [] },
    });
    expect(journal.before).toMatchObject({ edition: 'ESSENTIEL', featureGrants: [] });
    expect(journal.after).toMatchObject({ edition: 'IMPORT', featureGrants: [Feature.GEO_CHECK] });
  });

  it('shows the edition, the overrides and the edition list to the super-admin', async () => {
    const a = await registerTenant(t, 'Flags Detail', { activity: Activity.DISTRIBUTEUR });
    const detail = (
      await t
        .http()
        .get(`/admin/tenants/${a.tenantId}`)
        .set(...bearer(admin.accessToken))
        .expect(200)
    ).body as AdminTenantDetail;
    expect(detail.edition).toMatchObject({
      edition: Edition.DISTRIBUTION,
      monthlySupplement: '2500.00',
    });
    expect(detail.featureGrants).toEqual([]);
    expect(detail.editions.map((e) => e.edition)).toEqual([
      Edition.ESSENTIEL,
      Edition.IMPORT,
      Edition.DISTRIBUTION,
      Edition.ENTREPRISE,
    ]);
    expect(detail.plan.maxMobileSellers).toBe(5);

    const rows = (
      await t
        .http()
        .get('/admin/tenants')
        .query({ q: 'Flags Detail' })
        .set(...bearer(admin.accessToken))
        .expect(200)
    ).body as { id: string; edition: Edition }[];
    expect(rows.find((r) => r.id === a.tenantId)?.edition).toBe(Edition.DISTRIBUTION);
  });
});
