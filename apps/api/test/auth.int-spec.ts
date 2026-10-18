import { ErrorCode, type AuthResponse, type SessionInfo } from '@erp/shared';
import { asTenant, bearer, createTestApp, registerTenant, type TestApp } from './helpers';

describe('auth', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  it('registers a tenant with its OWNER and writes an audit row', async () => {
    const reg = await registerTenant(t, 'Grossiste Test');
    expect(reg.auth.user).toMatchObject({
      role: 'OWNER',
      tenantName: 'Grossiste Test',
      email: reg.email,
    });
    expect(reg.auth.accessToken).toBeTruthy();
    expect(reg.auth.refreshToken).toMatch(/^[0-9a-f-]{36}\./);

    const logs = await asTenant(reg.tenantId, () =>
      t.prisma.db.auditLog.findMany({ where: { action: 'TENANT_REGISTERED' } }),
    );
    expect(logs).toHaveLength(1);
    const user = await asTenant(reg.tenantId, () =>
      t.prisma.db.user.findUniqueOrThrow({ where: { id: reg.auth.user.id } }),
    );
    expect(user.passwordHash).toMatch(/^\$argon2id\$/);
  });

  it('rejects a duplicate email and invalid input', async () => {
    const reg = await registerTenant(t);
    const dup = await t
      .http()
      .post('/auth/register')
      .send({
        companyName: 'Other',
        fullName: 'X Y',
        email: reg.email.toUpperCase(),
        password: 'Password123!',
      })
      .expect(409);
    expect(dup.body).toMatchObject({ code: ErrorCode.EMAIL_ALREADY_USED });

    const bad = await t.http().post('/auth/register').send({ email: 'nope' }).expect(400);
    expect(bad.body).toMatchObject({ code: ErrorCode.VALIDATION_FAILED });
    expect((bad.body as { details: { issues: unknown[] } }).details.issues.length).toBeGreaterThan(
      0,
    );
  });

  it('logs in with the right password only', async () => {
    const reg = await registerTenant(t);
    await t
      .http()
      .post('/auth/login')
      .send({ email: reg.email, password: reg.password })
      .expect(200);
    const wrong = await t
      .http()
      .post('/auth/login')
      .send({ email: reg.email, password: 'wrong-password' })
      .expect(401);
    expect(wrong.body).toMatchObject({ code: ErrorCode.INVALID_CREDENTIALS });
    const unknown = await t
      .http()
      .post('/auth/login')
      .send({ email: 'nobody@test.dz', password: 'whatever1' })
      .expect(401);
    expect(unknown.body).toMatchObject({ code: ErrorCode.INVALID_CREDENTIALS });
  });

  it('web login sets an httpOnly refresh cookie and keeps the token out of the body', async () => {
    const reg = await registerTenant(t);
    const res = await t
      .http()
      .post('/auth/login')
      .send({ email: reg.email, password: reg.password })
      .expect(200);
    expect((res.body as AuthResponse).refreshToken).toBeUndefined();
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toMatch(/erp_rt=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Path=\/auth/);
    expect(cookie).toMatch(/SameSite=Lax/i);

    const rt = /erp_rt=([^;]+)/.exec(cookie)?.[1];
    const refreshed = await t
      .http()
      .post('/auth/refresh')
      .set('Cookie', `erp_rt=${rt}`)
      .expect(200);
    expect((refreshed.body as AuthResponse).accessToken).toBeTruthy();
  });

  const refreshNative = (refreshToken: string) =>
    t.http().post('/auth/refresh').set('X-Client-Type', 'native').send({ refreshToken });

  /** Pretends the last rotation of this session happened `seconds` ago. */
  const ageRotation = (tenantId: string, sessionId: string, seconds: number) =>
    asTenant(tenantId, () =>
      t.prisma.db.session.update({
        where: { id: sessionId },
        data: { rotatedAt: new Date(Date.now() - seconds * 1000) },
      }),
    );

  it('rotates the refresh token; reusing an old one after the grace window revokes the session', async () => {
    const reg = await registerTenant(t);
    const first = reg.auth.refreshToken;
    const sessionId = first.split('.')[0]!;

    const r1 = await refreshNative(first).expect(200);
    const second = (r1.body as AuthResponse).refreshToken!;
    expect(second).not.toBe(first);
    const access2 = (r1.body as AuthResponse).accessToken;
    await t
      .http()
      .get('/auth/me')
      .set(...bearer(access2))
      .expect(200);

    // Replay of the old token long after the rotation: theft signal.
    await ageRotation(reg.tenantId, sessionId, 120);
    const reuse = await refreshNative(first).expect(401);
    expect(reuse.body).toMatchObject({ code: ErrorCode.REFRESH_TOKEN_REUSED });

    // The legitimate latest token and access token are now dead too.
    const after = await refreshNative(second).expect(401);
    expect(after.body).toMatchObject({ code: ErrorCode.SESSION_REVOKED });
    const me = await t
      .http()
      .get('/auth/me')
      .set(...bearer(access2))
      .expect(401);
    expect(me.body).toMatchObject({ code: ErrorCode.SESSION_REVOKED });

    const audit = await asTenant(reg.tenantId, () =>
      t.prisma.db.auditLog.count({ where: { action: 'REFRESH_TOKEN_REUSED' } }),
    );
    expect(audit).toBe(1);
  });

  it('a reload that lost the refresh response keeps the session (grace window)', async () => {
    const reg = await registerTenant(t);
    const first = reg.auth.refreshToken;

    // The browser sent `first`, the server rotated, but the response never arrived.
    await refreshNative(first).expect(200);
    // The next page load still holds `first`: accepted once more, with a new token.
    const retry = await refreshNative(first).expect(200);
    const latest = (retry.body as AuthResponse).refreshToken!;
    await refreshNative(latest).expect(200);
  });

  it('a token from two rotations ago is reuse even inside the grace window', async () => {
    const reg = await registerTenant(t);
    const first = reg.auth.refreshToken;
    const second = (await refreshNative(first).expect(200)).body as AuthResponse;
    await refreshNative(second.refreshToken!).expect(200);
    const res = await refreshNative(first).expect(401);
    expect(res.body).toMatchObject({ code: ErrorCode.REFRESH_TOKEN_REUSED });
  });

  it('two concurrent refreshes with the same token both succeed (second uses the grace window)', async () => {
    const reg = await registerTenant(t);
    const results = await Promise.all([1, 2].map(() => refreshNative(reg.auth.refreshToken)));
    expect(results.map((r) => r.status)).toEqual([200, 200]);
  });

  it('rejects malformed and unknown refresh tokens', async () => {
    const res = await t.http().post('/auth/refresh').send({ refreshToken: 'garbage' }).expect(401);
    expect(res.body).toMatchObject({ code: ErrorCode.INVALID_TOKEN });
    await t
      .http()
      .post('/auth/refresh')
      .send({ refreshToken: `00000000-0000-4000-8000-000000000000.${'x'.repeat(43)}` })
      .expect(401);
    await t.http().post('/auth/refresh').expect(401);
  });

  it('logout revokes the session; the access token stops working immediately', async () => {
    const reg = await registerTenant(t);
    await t
      .http()
      .post('/auth/logout')
      .set(...bearer(reg.auth.accessToken))
      .expect(204);
    const me = await t
      .http()
      .get('/auth/me')
      .set(...bearer(reg.auth.accessToken))
      .expect(401);
    expect(me.body).toMatchObject({ code: ErrorCode.SESSION_REVOKED });
    await t.http().post('/auth/refresh').send({ refreshToken: reg.auth.refreshToken }).expect(401);
  });

  it('lists sessions and revokes another device', async () => {
    const reg = await registerTenant(t);
    const phone = await t
      .http()
      .post('/auth/login')
      .set('X-Client-Type', 'native')
      .send({ email: reg.email, password: reg.password, deviceName: 'Téléphone' })
      .expect(200);
    const phoneAuth = phone.body as AuthResponse;

    const list = await t
      .http()
      .get('/auth/sessions')
      .set(...bearer(reg.auth.accessToken))
      .expect(200);
    const sessions = list.body as SessionInfo[];
    expect(sessions).toHaveLength(2);
    const phoneSession = sessions.find((s) => s.deviceName === 'Téléphone');
    expect(phoneSession?.current).toBe(false);
    expect(sessions.find((s) => s.current)?.deviceName).toBe('jest');

    await t
      .http()
      .delete(`/auth/sessions/${phoneSession?.id}`)
      .set(...bearer(reg.auth.accessToken))
      .expect(204);
    await t
      .http()
      .get('/auth/me')
      .set(...bearer(phoneAuth.accessToken))
      .expect(401);
    await t
      .http()
      .get('/auth/me')
      .set(...bearer(reg.auth.accessToken))
      .expect(200);
  });

  it('requires a valid access token on protected routes', async () => {
    const none = await t.http().get('/auth/me').expect(401);
    expect(none.body).toMatchObject({ code: ErrorCode.UNAUTHENTICATED });
    const bad = await t
      .http()
      .get('/auth/me')
      .set('Authorization', 'Bearer abc.def.ghi')
      .expect(401);
    expect(bad.body).toMatchObject({ code: ErrorCode.INVALID_TOKEN });
  });
});
