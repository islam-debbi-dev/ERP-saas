import * as argon2 from 'argon2';
import { type AuthResponse, ErrorCode, type Role } from '@erp/shared';
import {
  asTenant,
  bearer,
  createTestApp,
  registerTenant,
  type RegisteredTenant,
  tamper,
  type TestApp,
  uniqueEmail,
} from './helpers';

/**
 * Phase 39 A1: a phone login (X-Client-Type: native) of a SELLER, LIVREUR or SUPERVISOR
 * needs the MOBILE_APP module and takes one seat of the plan's maxMobileSellers. The same
 * user on a second phone keeps his seat, a closed session frees it, web logins and the
 * magasinier never count.
 */
describe('mobile access and seat limit (phase 39 A1)', () => {
  let t: TestApp;
  let seq = 0;
  const PASSWORD = 'Password123!';

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  /** A paying tenant (not free) on [plan] with [edition]. Starter allows 2 phones. */
  const tenant = async (
    name: string,
    { plan = 'STARTER', edition = 'DISTRIBUTION' } = {},
  ): Promise<RegisteredTenant> => {
    const who = await registerTenant(t, name, { trial: true });
    await tamper(t)`
      UPDATE subscriptions
      SET "planId" = (SELECT id FROM plans WHERE code = ${plan}),
          edition = ${edition}::"Edition",
          "isFree" = false
      WHERE "tenantId" = ${who.tenantId}::uuid`;
    return who;
  };

  const member = async (who: RegisteredTenant, role: Role): Promise<string> => {
    const email = uniqueEmail(role.toLowerCase());
    await asTenant(who.tenantId, async () =>
      t.prisma.db.user.create({
        data: {
          tenantId: who.tenantId,
          email,
          passwordHash: await argon2.hash(PASSWORD),
          fullName: `${role} ${++seq}`,
          role,
        },
      }),
    );
    return email;
  };

  /** Each attempt from its own address, so the login limiter stays out of the way. */
  const login = (email: string, { native = true } = {}) => {
    const req = t
      .http()
      .post('/auth/login')
      .set('X-Forwarded-For', `10.39.${Math.floor(++seq / 250)}.${(seq % 250) + 1}`);
    if (native) req.set('X-Client-Type', 'native');
    return req.send({ identifier: email, password: PASSWORD, deviceName: 'jest phone' });
  };

  const sessionsOf = (who: RegisteredTenant, email: string) =>
    asTenant(who.tenantId, () =>
      t.prisma.db.session.findMany({ where: { user: { email } }, orderBy: { createdAt: 'asc' } }),
    );

  it('refuses a phone login of a road role when the edition has no MOBILE_APP', async () => {
    const a = await tenant('Seats NoMobile', { edition: 'ESSENTIEL' });
    const seller = await member(a, 'SELLER');
    const livreur = await member(a, 'LIVREUR');
    const supervisor = await member(a, 'SUPERVISOR');

    for (const email of [seller, livreur, supervisor]) {
      const res = await login(email).expect(403);
      expect(res.body).toMatchObject({ code: ErrorCode.FEATURE_NOT_IN_PLAN });
    }
    // No session was opened for the refused logins.
    expect(await sessionsOf(a, seller)).toHaveLength(0);
    // The web is not gated by the mobile module.
    await login(seller, { native: false }).expect(200);
  });

  it('a granted MOBILE_APP module lets the phone in on any edition', async () => {
    const a = await tenant('Seats Granted', { edition: 'ESSENTIEL' });
    await tamper(t)`
      UPDATE tenants SET "featureGrants" = ARRAY['MOBILE_APP'] WHERE id = ${a.tenantId}::uuid`;
    await login(await member(a, 'SELLER')).expect(200);
  });

  it('refuses the third road user on Starter (2 phones) with MOBILE_SELLER_LIMIT', async () => {
    const a = await tenant('Seats Starter');
    const s1 = await member(a, 'SELLER');
    const s2 = await member(a, 'LIVREUR');
    const s3 = await member(a, 'SUPERVISOR');

    await login(s1).expect(200);
    await login(s2).expect(200);
    const refused = await login(s3).expect(409);
    expect(refused.body).toMatchObject({
      code: ErrorCode.MOBILE_SELLER_LIMIT,
      details: { limit: 2, current: 2 },
    });
    expect(await sessionsOf(a, s3)).toHaveLength(0);
  });

  it('the same user on a second phone keeps his seat', async () => {
    const a = await tenant('Seats SecondPhone');
    const s1 = await member(a, 'SELLER');
    const s2 = await member(a, 'SELLER');
    await login(s1).expect(200);
    await login(s2).expect(200);
    // s1 again, from another phone: still 2 users.
    await login(s1).expect(200);
    expect(await sessionsOf(a, s1)).toHaveLength(2);
  });

  it('a closed or expired session frees the seat', async () => {
    const a = await tenant('Seats Freed');
    const s1 = await member(a, 'SELLER');
    const s2 = await member(a, 'SELLER');
    const s3 = await member(a, 'SELLER');
    const first = (await login(s1).expect(200)).body as AuthResponse;
    await login(s2).expect(200);
    await login(s3).expect(409);

    // s1 logs out on his phone: his seat goes to s3.
    await t
      .http()
      .post('/auth/logout')
      .set(...bearer(first.accessToken))
      .expect(204);
    await login(s3).expect(200);

    // The owner revokes s2's phone from the sessions screen: a seat opens again.
    const s4 = await member(a, 'SELLER');
    await login(s4).expect(409);
    const [s2Session] = await sessionsOf(a, s2);
    await t
      .http()
      .delete(`/auth/sessions/${s2Session!.id}`)
      .set(...bearer(a.auth.accessToken))
      .expect(204);
    await login(s4).expect(200);

    // An expired session does not hold a seat either.
    const s5 = await member(a, 'SELLER');
    await login(s5).expect(409);
    await tamper(t)`
      UPDATE sessions SET "expiresAt" = now() - interval '1 minute'
      WHERE "userId" = (SELECT id FROM users WHERE email = ${s3})`;
    await login(s5).expect(200);
  });

  it('web logins never take a seat', async () => {
    const a = await tenant('Seats Web');
    const users = [
      await member(a, 'SELLER'),
      await member(a, 'SELLER'),
      await member(a, 'SUPERVISOR'),
    ];
    for (const email of users) await login(email, { native: false }).expect(200);
    await login(users[0]!).expect(200);
    await login(users[1]!).expect(200);
    await login(users[2]!).expect(409);
  });

  it('the magasinier and office roles are neither gated nor counted', async () => {
    const a = await tenant('Seats Storekeeper');
    await login(await member(a, 'STOREKEEPER')).expect(200);
    await login(await member(a, 'MANAGER')).expect(200);
    await login(await member(a, 'SELLER')).expect(200);
    await login(await member(a, 'SELLER')).expect(200);

    const noMobile = await tenant('Seats Storekeeper NoMobile', { edition: 'ESSENTIEL' });
    await login(await member(noMobile, 'STOREKEEPER')).expect(200);
  });

  it('counts per tenant: another company full does not block this one', async () => {
    const full = await tenant('Seats Tenant Full');
    await login(await member(full, 'SELLER')).expect(200);
    await login(await member(full, 'SELLER')).expect(200);
    await login(await member(full, 'SELLER')).expect(409);

    const other = await tenant('Seats Tenant Other');
    await login(await member(other, 'SELLER')).expect(200);
    await login(await member(other, 'SELLER')).expect(200);
  });

  it('an unlimited plan (Business) never refuses, a free (pilot) tenant either', async () => {
    const business = await tenant('Seats Business', { plan: 'BUSINESS' });
    for (let i = 0; i < 4; i++) await login(await member(business, 'SELLER')).expect(200);

    const pilot = await tenant('Seats Pilot');
    await tamper(
      t,
    )`UPDATE subscriptions SET "isFree" = true WHERE "tenantId" = ${pilot.tenantId}::uuid`;
    for (let i = 0; i < 3; i++) await login(await member(pilot, 'SELLER')).expect(200);
  });

  it('two phones racing for the last seat: exactly one gets in', async () => {
    const a = await tenant('Seats Race');
    await login(await member(a, 'SELLER')).expect(200);
    const [r1, r2] = await Promise.all([
      login(await member(a, 'SELLER')),
      login(await member(a, 'SELLER')),
    ]);
    expect([r1.status, r2.status].sort()).toEqual([200, 409]);
  });

  it('stores the client type at login and fills it at refresh, without enforcing the limit', async () => {
    const a = await tenant('Seats ClientType');
    const s1 = await member(a, 'SELLER');
    const s2 = await member(a, 'SELLER');
    const s3 = await member(a, 'SELLER');

    const phone = (await login(s1).expect(200)).body as AuthResponse & { refreshToken: string };
    await login(s1, { native: false }).expect(200);
    expect((await sessionsOf(a, s1)).map((s) => s.clientType)).toEqual(['NATIVE', 'WEB']);

    // s3's phone opened its session before phase 39 (no client type), s2 then takes
    // the second seat.
    const old = (await login(s3).expect(200)).body as AuthResponse & { refreshToken: string };
    await tamper(t)`
      UPDATE sessions SET "clientType" = NULL
      WHERE "userId" = (SELECT id FROM users WHERE email = ${s3})`;
    await login(s2).expect(200);

    // Its next refresh records NATIVE but does not log it out, although the plan is full.
    await t
      .http()
      .post('/auth/refresh')
      .set('X-Client-Type', 'native')
      .send({ refreshToken: old.refreshToken })
      .expect(200);
    expect((await sessionsOf(a, s3)).map((s) => s.clientType)).toEqual(['NATIVE']);

    // A known type is never changed by a refresh: the phone's session refreshed
    // without the native header stays NATIVE.
    await t.http().post('/auth/refresh').send({ refreshToken: phone.refreshToken }).expect(200);
    expect((await sessionsOf(a, s1)).map((s) => s.clientType)).toEqual(['NATIVE', 'WEB']);
  });
});
