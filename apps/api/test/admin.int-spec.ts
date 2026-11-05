import { randomUUID } from 'node:crypto';
import * as argon2 from 'argon2';
import {
  type AdminAuthResponse,
  type AdminTenantDetail,
  type AdminTenantRow,
  addMonths,
  type AuditLogPage,
  type AuthUser,
  ErrorCode,
  type ImpersonationResponse,
  type SubscriptionSummary,
  type PayrollRateSetDto,
} from '@erp/shared';
import { newTotpSecret, totp } from '../src/admin/totp';
import { tenantContext } from '../src/common/tenant-context';
import {
  bearer,
  createTestApp,
  FakeClock,
  registerTenant,
  type RegisteredTenant,
  type TestApp,
} from './helpers';

const PASSWORD = 'Admin-Password-1!';

describe('super-admin: 2FA login, tenants, payments, read-only impersonation', () => {
  const clock = new FakeClock();
  let t: TestApp;
  let email: string;
  let secret: string;
  let admin: AdminAuthResponse;
  let seq = 0;

  /** Every login from its own address so the per-IP limiter stays out of the way. */
  const ip = () => `10.9.${Math.floor(++seq / 200)}.${seq % 200}`;

  const login = (body: object) =>
    t.http().post('/admin/auth/login').set('X-Forwarded-For', ip()).send(body);

  const as = (token: string) => ({
    get: (url: string) =>
      t
        .http()
        .get(url)
        .set(...bearer(token)),
    post: (url: string, body: object = {}, key: string | null = randomUUID()) => {
      const req = t
        .http()
        .post(url)
        .set(...bearer(token));
      if (key) req.set('Idempotency-Key', key);
      return req.send(body);
    },
    patch: (url: string, body: object) =>
      t
        .http()
        .patch(url)
        .set(...bearer(token))
        .send(body),
  });

  const system = <T>(fn: () => Promise<T>) => tenantContext.runAsSystem(fn);

  const newAdmin = async () => {
    const e = `admin-${randomUUID().slice(0, 8)}@platform.dz`;
    const s = newTotpSecret();
    const passwordHash = await argon2.hash(PASSWORD, { type: argon2.argon2id });
    await system(() =>
      t.prisma.db.platformAdmin.create({
        data: { email: e, fullName: 'Super Admin', passwordHash, totpSecret: s },
      }),
    );
    return { email: e, secret: s };
  };

  const loginAdmin = async (who: { email: string; secret: string }) =>
    (await login({ email: who.email, password: PASSWORD, code: totp(who.secret) }).expect(200))
      .body as AdminAuthResponse;

  beforeAll(async () => {
    t = await createTestApp([], { clock });
    ({ email, secret } = await newAdmin());
    admin = await loginAdmin({ email, secret });
  });
  afterAll(() => t.close());
  afterEach(() => clock.reset());

  describe('payroll rate sets (phase 31b)', () => {
    const body = {
      // Far ahead: rate sets are country-wide and append-only, so no month reads this one.
      effectiveFrom: '2099-01-01',
      cnasEmployeeRate: '0.09',
      cnasEmployerRate: '0.26',
      irgBrackets: [
        { upTo: '240000', rate: '0' },
        { upTo: null, rate: '0.23' },
      ],
      abattementRate: '0.40',
      abattementMin: '1000',
      abattementMax: '1500',
      exemptionThreshold: '30000',
      lissageCeiling: '35000',
      lissageNum: '137',
      lissageDen: '51',
      lissageOffsetNum: '27925',
      lissageOffsetDen: '8',
      snmg: '24000',
      toVerify: false,
      note: 'Vérifié',
    };

    it('lists the seeded set, to verify', async () => {
      const res = await as(admin.accessToken).get('/admin/payroll-rate-sets').expect(200);
      const seeded = (res.body as PayrollRateSetDto[]).find(
        (r) => r.effectiveFrom === '2026-01-01',
      );
      expect(seeded).toMatchObject({ toVerify: true, snmg: '24000' });
      expect(seeded?.irgBrackets).toHaveLength(6);
    });

    it('appends a set and logs it; a tenant cannot reach it', async () => {
      const res = await as(admin.accessToken).post('/admin/payroll-rate-sets', body).expect(201);
      expect(res.body).toMatchObject({ effectiveFrom: '2099-01-01', toVerify: false });
      const logged = await system(() =>
        t.prisma.db.platformAuditLog.count({ where: { action: 'PAYROLL_RATE_SET_ADDED' } }),
      );
      expect(logged).toBeGreaterThan(0);
      const tenant = await registerTenant(t, 'Pas admin');
      await as(tenant.auth.accessToken).get('/admin/payroll-rate-sets').expect(401);
    });

    it('needs a last bracket without a ceiling', async () => {
      await as(admin.accessToken)
        .post('/admin/payroll-rate-sets', {
          ...body,
          irgBrackets: [{ upTo: '240000', rate: '0' }],
        })
        .expect(400);
    });
  });

  describe('login', () => {
    it('needs the password and a valid code', async () => {
      const who = await newAdmin();
      const wrongPassword = await login({
        email: who.email,
        password: 'nope',
        code: totp(who.secret),
      });
      expect(wrongPassword.status).toBe(401);
      expect(wrongPassword.body).toMatchObject({ code: ErrorCode.INVALID_CREDENTIALS });

      const wrongCode = (Number(totp(who.secret)) + 500_000) % 1_000_000;
      const badCode = await login({
        email: who.email,
        password: PASSWORD,
        code: String(wrongCode).padStart(6, '0'),
      });
      expect(badCode.status).toBe(401);
      expect(badCode.body).toMatchObject({ code: ErrorCode.ADMIN_TOTP_INVALID });

      const noCode = await login({ email: who.email, password: PASSWORD });
      expect(noCode.status).toBe(400);

      const ok = await loginAdmin(who);
      expect(ok.admin.email).toBe(who.email);
      // Web: the refresh token goes in an httpOnly cookie scoped to /admin/auth.
      const res = await login({ email: who.email, password: PASSWORD, code: totp(who.secret) });
      expect(String(res.headers['set-cookie'])).toMatch(
        /erp_admin_rt=.*Path=\/admin\/auth.*HttpOnly/,
      );
    });

    it('locks the account after 5 failures', async () => {
      const who = await newAdmin();
      for (let i = 0; i < 5; i++) {
        await login({ email: who.email, password: 'wrong', code: '000000' }).expect(401);
      }
      const locked = await login({ email: who.email, password: PASSWORD, code: totp(who.secret) });
      expect(locked.status).toBe(423);
      expect(locked.body).toMatchObject({ code: ErrorCode.ACCOUNT_LOCKED });
    });

    it('rotates the refresh token and closes the session on reuse', async () => {
      const who = await newAdmin();
      const first = (
        await login({ email: who.email, password: PASSWORD, code: totp(who.secret) })
          .set('X-Client-Type', 'native')
          .expect(200)
      ).body as AdminAuthResponse & { refreshToken: string };
      const refresh = (token: string) =>
        t
          .http()
          .post('/admin/auth/refresh')
          .set('X-Client-Type', 'native')
          .send({ refreshToken: token });
      const second = (await refresh(first.refreshToken).expect(200)).body as {
        refreshToken: string;
        accessToken: string;
      };
      const reused = await refresh(first.refreshToken);
      expect(reused.body).toMatchObject({ code: ErrorCode.REFRESH_TOKEN_REUSED });
      await refresh(second.refreshToken).expect(401);
      await as(second.accessToken).get('/admin/tenants').expect(401);
    });
  });

  describe('separation of tenant and admin tokens', () => {
    let a: RegisteredTenant;
    beforeAll(async () => {
      a = await registerTenant(t, 'Séparation');
    });

    it('a tenant OWNER cannot reach any admin route', async () => {
      const id = a.tenantId;
      const calls = [
        as(a.auth.accessToken).get('/admin/tenants'),
        as(a.auth.accessToken).get(`/admin/tenants/${id}`),
        as(a.auth.accessToken).get('/admin/auth/me'),
        as(a.auth.accessToken).post(`/admin/tenants/${id}/payments`, {
          amount: '4500',
          method: 'ESPECES',
          months: 1,
        }),
        as(a.auth.accessToken).patch(`/admin/tenants/${id}/subscription`, { isFree: true }),
        as(a.auth.accessToken).post(`/admin/tenants/${id}/impersonate`),
      ];
      for (const res of await Promise.all(calls)) {
        expect(res.status).toBe(401);
        expect(res.body).toMatchObject({ code: ErrorCode.INVALID_TOKEN });
      }
      await t.http().get('/admin/tenants').expect(401);
    });

    it('an admin token is refused on tenant routes', async () => {
      const res = await as(admin.accessToken).get('/clients');
      expect(res.status).toBe(401);
      expect(res.body).toMatchObject({ code: ErrorCode.INVALID_TOKEN });
    });
  });

  describe('tenants and payments', () => {
    let a: RegisteredTenant;
    let b: RegisteredTenant;

    beforeAll(async () => {
      a = await registerTenant(t, `Paiement ${randomUUID().slice(0, 6)}`, { trial: true });
      b = await registerTenant(t, `Autre ${randomUUID().slice(0, 6)}`, { trial: true });
    });

    it('lists tenants with plan, status and usage, filtered by status and name', async () => {
      const all = (await as(admin.accessToken).get('/admin/tenants').expect(200))
        .body as AdminTenantRow[];
      expect(all.find((r) => r.id === a.tenantId)).toMatchObject({
        planName: 'Pro',
        status: 'TRIAL',
        isFree: false,
        usage: { users: 1, products: 0, documentsThisMonth: 0 },
      });
      const trials = (await as(admin.accessToken).get('/admin/tenants?status=TRIAL').expect(200))
        .body as AdminTenantRow[];
      expect(trials.every((r) => r.status === 'TRIAL')).toBe(true);
      const byName = (
        await as(admin.accessToken)
          .get(`/admin/tenants?q=${encodeURIComponent(a.auth.user.tenantName.slice(0, 12))}`)
          .expect(200)
      ).body as AdminTenantRow[];
      expect(byName.map((r) => r.id)).toEqual([a.tenantId]);

      const detail = (await as(admin.accessToken).get(`/admin/tenants/${a.tenantId}`).expect(200))
        .body as AdminTenantDetail;
      expect(detail.owner?.email).toBe(a.email);
      expect(detail.plans.map((p) => p.code)).toEqual(['STARTER', 'PRO', 'BUSINESS']);
    });

    it('records a payment once: period extended from the trial end, ACTIVE, audited twice', async () => {
      const before = (await as(admin.accessToken).get(`/admin/tenants/${a.tenantId}`).expect(200))
        .body as AdminTenantDetail;
      const key = randomUUID();
      const body = { amount: '13 500', method: 'BARIDIMOB', months: 3, reference: 'BM-123' };
      const first = await as(admin.accessToken)
        .post(`/admin/tenants/${a.tenantId}/payments`, body, key)
        .expect(201);
      const s = first.body as SubscriptionSummary;
      expect(s).toMatchObject({ status: 'ACTIVE', storedStatus: 'ACTIVE' });
      expect(s.currentPeriodEnd).toBe(
        addMonths(new Date(before.currentPeriodEnd), 3).toISOString(),
      );
      expect(s.payments).toHaveLength(1);
      expect(s.payments[0]).toMatchObject({
        amount: '13500.00',
        method: 'BARIDIMOB',
        months: 3,
        reference: 'BM-123',
        periodFrom: before.currentPeriodEnd,
      });

      // Replay: same answer, nothing new.
      const replay = await as(admin.accessToken)
        .post(`/admin/tenants/${a.tenantId}/payments`, body, key)
        .expect(201);
      expect(replay.headers['idempotent-replayed']).toBe('true');
      expect((replay.body as SubscriptionSummary).currentPeriodEnd).toBe(s.currentPeriodEnd);
      expect((replay.body as SubscriptionSummary).payments).toHaveLength(1);

      // The same key for another company is a conflict, not a payment.
      await as(admin.accessToken)
        .post(`/admin/tenants/${b.tenantId}/payments`, body, key)
        .expect(409);

      // Without a key: refused.
      const noKey = await as(admin.accessToken).post(
        `/admin/tenants/${a.tenantId}/payments`,
        body,
        null,
      );
      expect(noKey.body).toMatchObject({ code: ErrorCode.IDEMPOTENCY_KEY_REQUIRED });

      // Platform log, and the tenant's own journal (the owner sees who renewed).
      const platform = await system(() =>
        t.prisma.db.platformAuditLog.findMany({
          where: { tenantId: a.tenantId, action: 'SUBSCRIPTION_PAYMENT_RECORDED' },
        }),
      );
      expect(platform).toHaveLength(1);
      expect(platform[0]!.adminId).toBe(admin.admin.id);
      const journal = (
        await as(a.auth.accessToken)
          .get('/audit-logs?action=SUBSCRIPTION_PAYMENT_RECORDED&limit=10')
          .expect(200)
      ).body as AuditLogPage;
      expect(journal.items).toHaveLength(1);

      // The tenant sees its payment; the other company does not.
      expect(
        (
          (await as(a.auth.accessToken).get('/tenant/subscription').expect(200))
            .body as SubscriptionSummary
        ).payments,
      ).toHaveLength(1);
      expect(
        (
          (await as(b.auth.accessToken).get('/tenant/subscription').expect(200))
            .body as SubscriptionSummary
        ).payments,
      ).toHaveLength(0);
    });

    it('two concurrent requests with one key record one payment', async () => {
      const c = await registerTenant(t, 'Concurrence paiement', { trial: true });
      const key = randomUUID();
      const body = { amount: '4500', method: 'ESPECES', months: 1 };
      const results = await Promise.all(
        [1, 2].map(() =>
          as(admin.accessToken).post(`/admin/tenants/${c.tenantId}/payments`, body, key),
        ),
      );
      expect(results.map((r) => r.status)).toEqual([201, 201]);
      const rows = await system(() =>
        t.prisma.db.subscriptionPayment.count({ where: { tenantId: c.tenantId } }),
      );
      expect(rows).toBe(1);
    });

    it('a late payment starts from today, and lifts a suspension', async () => {
      const c = await registerTenant(t, 'Retard', { trial: true });
      clock.advanceDays(50);
      const susp = (await as(c.auth.accessToken).get('/tenant/subscription').expect(200))
        .body as SubscriptionSummary;
      expect(susp.status).toBe('SUSPENDED');
      await as(c.auth.accessToken).post('/clients', { code: 'X', name: 'X' }).expect(403);

      const s = (
        await as(admin.accessToken)
          .post(`/admin/tenants/${c.tenantId}/payments`, {
            amount: '4500',
            method: 'VIREMENT',
            months: 1,
          })
          .expect(201)
      ).body as SubscriptionSummary;
      expect(s.status).toBe('ACTIVE');
      expect(new Date(s.payments[0]!.periodFrom).getTime()).toBeGreaterThan(
        new Date(susp.currentPeriodEnd).getTime(),
      );
      await as(c.auth.accessToken).post('/clients', { code: 'X', name: 'X' }).expect(201);
    });

    it('changes plan, sets free, extends a trial only', async () => {
      const c = await registerTenant(t, 'Réglages', { trial: true });
      const url = `/admin/tenants/${c.tenantId}/subscription`;
      const detail = (await as(admin.accessToken).get(`/admin/tenants/${c.tenantId}`).expect(200))
        .body as AdminTenantDetail;
      const starter = detail.plans.find((p) => p.code === 'STARTER')!;

      const extended = (await as(admin.accessToken).patch(url, { extendTrialDays: 10 }).expect(200))
        .body as SubscriptionSummary;
      expect(extended.daysLeft).toBe(40);
      const changed = (await as(admin.accessToken).patch(url, { planId: starter.id }).expect(200))
        .body as SubscriptionSummary;
      expect(changed.plan.code).toBe('STARTER');
      const free = (await as(admin.accessToken).patch(url, { isFree: true }).expect(200))
        .body as SubscriptionSummary;
      expect(free.isFree).toBe(true);

      await as(admin.accessToken).patch(url, {}).expect(400);
      await as(admin.accessToken).patch(url, { planId: randomUUID() }).expect(404);
      await as(admin.accessToken)
        .post(`/admin/tenants/${c.tenantId}/payments`, {
          amount: '2500',
          method: 'ESPECES',
          months: 1,
        })
        .expect(201);
      const notTrial = await as(admin.accessToken).patch(url, { extendTrialDays: 5 });
      expect(notTrial.status).toBe(400);

      const journal = (
        await as(c.auth.accessToken)
          .get('/audit-logs?action=SUBSCRIPTION_UPDATED&limit=10')
          .expect(200)
      ).body as AuditLogPage;
      expect(journal.items).toHaveLength(3);
    });
  });

  describe('read-only impersonation', () => {
    let a: RegisteredTenant;
    let view: ImpersonationResponse;
    let session: AdminAuthResponse;

    beforeAll(async () => {
      a = await registerTenant(t, 'Vue support');
      session = await loginAdmin({ email, secret });
      view = (
        await as(session.accessToken).post(`/admin/tenants/${a.tenantId}/impersonate`).expect(200)
      ).body as ImpersonationResponse;
    });

    it('reads as the OWNER, flagged as a support view', async () => {
      expect(view.tenantName).toBe('Vue support');
      await as(view.accessToken).get('/clients').expect(200);
      const me = (await as(view.accessToken).get('/auth/me').expect(200)).body as AuthUser;
      expect(me).toMatchObject({ tenantId: a.tenantId, role: 'OWNER', impersonating: true });
    });

    it('refuses every write, even logout', async () => {
      const writes = [
        await as(view.accessToken).post('/clients', { code: 'IMP', name: 'Interdit' }),
        await as(view.accessToken).patch('/tenant/settings', { maxDiscountPct: '1' }),
        await as(view.accessToken).post('/auth/logout'),
      ];
      for (const res of writes) {
        expect(res.status).toBe(403);
        expect(res.body).toMatchObject({ code: ErrorCode.IMPERSONATION_READ_ONLY });
      }
    });

    it('is audited in the tenant journal and request by request on the platform', async () => {
      const journal = (
        await as(a.auth.accessToken)
          .get('/audit-logs?action=ADMIN_IMPERSONATION_STARTED&limit=10')
          .expect(200)
      ).body as AuditLogPage;
      expect(journal.items).toHaveLength(1);
      const requests = await system(() =>
        t.prisma.db.platformAuditLog.findMany({
          where: { tenantId: a.tenantId, action: 'IMPERSONATION_REQUEST' },
        }),
      );
      expect(requests.map((r) => (r.detail as { path: string }).path)).toContain('/clients');
    });

    it('ends when the admin session closes', async () => {
      await t
        .http()
        .post('/admin/auth/logout')
        .set(...bearer(session.accessToken))
        .expect(204);
      const res = await as(view.accessToken).get('/clients');
      expect(res.status).toBe(401);
      expect(res.body).toMatchObject({ code: ErrorCode.SESSION_REVOKED });
    });
  });
});
