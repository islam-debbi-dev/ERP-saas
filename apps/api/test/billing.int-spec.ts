import { randomUUID } from 'node:crypto';
import {
  type ClientDto,
  ErrorCode,
  type InviteResultDto,
  type SaleResultDto,
  type SubscriptionSummary,
} from '@erp/shared';
import {
  bearer,
  catalogOf,
  createProduct,
  createTestApp,
  FakeClock,
  registerTenant,
  type RegisteredTenant,
  tamper,
  type TestApp,
} from './helpers';

const TODAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Algiers' }).format(new Date());

/** Collects a binary body (supertest only buffers text and JSON by itself). */
function binary(res: unknown, done: (err: Error | null, body: Buffer) => void) {
  const stream = res as NodeJS.ReadableStream;
  const parts: Buffer[] = [];
  stream.on('data', (c: Buffer) => parts.push(c));
  stream.on('end', () => done(null, Buffer.concat(parts)));
}

describe('subscriptions: trial, grace, suspension and plan limits', () => {
  const clock = new FakeClock();
  let t: TestApp;

  const as = (who: { auth: { accessToken: string } }) => ({
    get: (url: string) =>
      t
        .http()
        .get(url)
        .set(...bearer(who.auth.accessToken)),
    file: (url: string) =>
      t
        .http()
        .get(url)
        .set(...bearer(who.auth.accessToken))
        .buffer(true)
        .parse(binary),
    post: (url: string, body: object = {}) =>
      t
        .http()
        .post(url)
        .set(...bearer(who.auth.accessToken))
        .set('Idempotency-Key', randomUUID())
        .send(body),
    patch: (url: string, body: object) =>
      t
        .http()
        .patch(url)
        .set(...bearer(who.auth.accessToken))
        .send(body),
  });

  const summary = async (who: RegisteredTenant) =>
    (await as(who).get('/tenant/subscription').expect(200)).body as SubscriptionSummary;

  /** A plan only this test uses, so the shared plans keep their real limits. */
  const tinyPlan = async (limits: { users: number; products: number; docs: number }) => {
    const code = `T${randomUUID().slice(0, 8)}`;
    await tamper(t)`
      INSERT INTO plans (id, code, name, "monthlyPrice", "maxUsers", "maxProducts", "maxDocumentsPerMonth", active, "updatedAt")
      VALUES (gen_random_uuid(), ${code}, 'Tiny', 1000, ${limits.users}, ${limits.products}, ${limits.docs}, false, now())`;
    return code;
  };
  const putOnPlan = (who: RegisteredTenant, code: string) =>
    tamper(t)`
      UPDATE subscriptions SET "planId" = (SELECT id FROM plans WHERE code = ${code})
      WHERE "tenantId" = ${who.tenantId}::uuid`;

  beforeAll(async () => {
    t = await createTestApp([], { clock });
  });
  afterAll(() => t.close());
  afterEach(() => clock.reset());

  describe('lifecycle', () => {
    let a: RegisteredTenant;
    let client: ClientDto;
    let product: { id: string; cartonUnitId: string; baseUnitId: string };
    let blId: string;

    beforeAll(async () => {
      a = await registerTenant(t, 'Abonnement A', { trial: true });
      const cat = await catalogOf(t, a);
      product = await createProduct(t, a, cat);
      await as(a)
        .post('/stock/opening', {
          lines: [
            { productId: product.id, unitId: product.baseUnitId, qty: '100', unitCost: '50' },
          ],
        })
        .expect(201);
      client = (await as(a).post('/clients', { code: 'S1', name: 'Client S' }).expect(201))
        .body as ClientDto;
      blId = (
        (
          await as(a)
            .post('/sales/quick', {
              documentDate: TODAY,
              clientId: client.id,
              lines: [
                {
                  productId: product.id,
                  unitId: product.baseUnitId,
                  qty: '1',
                  unitPriceHt: '100',
                },
              ],
            })
            .expect(201)
        ).body as SaleResultDto
      ).sale.id;
    });

    it('a new company starts a 30-day trial on the Pro plan', async () => {
      const s = await summary(a);
      expect(s).toMatchObject({
        status: 'TRIAL',
        storedStatus: 'TRIAL',
        isFree: false,
        daysLeft: 30,
        plan: { code: 'PRO', monthlyPrice: '4500.00', maxUsers: 5 },
        usage: { users: 1, products: 1, documentsThisMonth: 1 },
        docsOverLimit: false,
        payments: [],
      });
    });

    it('turns PAST_DUE after the trial, and writes still work during the grace', async () => {
      clock.advanceDays(31);
      const s = await summary(a);
      expect(s.status).toBe('PAST_DUE');
      expect(s.daysLeft).toBe(6);
      await as(a).post('/clients', { code: 'S2', name: 'Pendant la grâce' }).expect(201);
    });

    it('turns SUSPENDED after 7 days of grace: reads and exports work, writes are refused', async () => {
      clock.advanceDays(38);
      expect((await summary(a)).status).toBe('SUSPENDED');

      await as(a).get('/clients').expect(200);
      await as(a).get(`/sales/${blId}`).expect(200);
      await as(a).get(`/clients/${client.id}/statement?from=${TODAY}&to=${TODAY}`).expect(200);
      const pdf = await as(a).file(`/documents/BL/${blId}/pdf`).expect(200);
      expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
      const xlsx = await as(a)
        .file(`/reports/sales/export.xlsx?from=${TODAY}&to=${TODAY}&groupBy=client`)
        .expect(200);
      expect((xlsx.body as Buffer).subarray(0, 2).toString()).toBe('PK');

      const refused = [
        await as(a).post('/clients', { code: 'S3', name: 'Refusé' }),
        await as(a).post('/sales/quick', {
          documentDate: TODAY,
          clientId: client.id,
          lines: [{ productId: product.id, unitId: product.baseUnitId, qty: '1' }],
        }),
        await as(a).post('/payments', { clientId: client.id, amount: '10' }),
        await as(a).patch('/tenant/settings', { maxDiscountPct: '2' }),
        await as(a).post('/users/invite', {
          fullName: 'Refusé',
          email: `x-${randomUUID().slice(0, 6)}@test.dz`,
          role: 'SELLER',
          mode: 'LINK',
        }),
      ];
      for (const res of refused) {
        expect(res.status).toBe(403);
        expect(res.body).toMatchObject({ code: ErrorCode.SUBSCRIPTION_SUSPENDED });
      }
      // Nothing was written by the refused requests.
      const clients = (await as(a).get('/clients').expect(200)).body as { items: ClientDto[] };
      expect(clients.items.map((c) => c.code)).not.toContain('S3');
    });

    it('a free (pilot) tenant is never suspended', async () => {
      clock.advanceDays(400);
      expect((await summary(a)).status).toBe('SUSPENDED');
      await tamper(
        t,
      )`UPDATE subscriptions SET "isFree" = true WHERE "tenantId" = ${a.tenantId}::uuid`;
      expect((await summary(a)).status).toBe('ACTIVE');
      await as(a).post('/clients', { code: 'S4', name: 'Pilote' }).expect(201);
    });
    it('a suspended user can still log in, change the password and log out', async () => {
      await tamper(
        t,
      )`UPDATE subscriptions SET "isFree" = false WHERE "tenantId" = ${a.tenantId}::uuid`;
      clock.advanceDays(60);
      expect((await summary(a)).status).toBe('SUSPENDED');
      const login = await t
        .http()
        .post('/auth/login')
        .set('X-Client-Type', 'native')
        .send({ identifier: a.email, password: a.password })
        .expect(200);
      const token = (login.body as { accessToken: string }).accessToken;
      await t
        .http()
        .post('/auth/password')
        .set(...bearer(token))
        .send({ currentPassword: a.password, newPassword: 'Nouveau123!' })
        .expect(200);
      await t
        .http()
        .post('/auth/logout')
        .set(...bearer(token))
        .expect(204);
    });
  });

  describe('plan limits', () => {
    it('refuses a user over the limit; a deactivated user frees the slot', async () => {
      const a = await registerTenant(t, 'Limites users', { trial: true });
      await putOnPlan(a, await tinyPlan({ users: 2, products: 100, docs: 100 }));
      const invite = () =>
        as(a).post('/users/invite', {
          fullName: 'Vendeur',
          email: `seller-${randomUUID().slice(0, 8)}@test.dz`,
          role: 'SELLER',
          mode: 'LINK',
        });
      const second = (await invite().expect(201)).body as InviteResultDto;
      const over = await invite().expect(409);
      expect(over.body).toMatchObject({
        code: ErrorCode.PLAN_LIMIT_REACHED,
        details: { resource: 'users', limit: 2, current: 2 },
      });

      await as(a).post(`/users/${second.user.id}/deactivate`).expect(200);
      await invite().expect(201);
      // Reactivating would make three: refused too.
      const react = await as(a).post(`/users/${second.user.id}/reactivate`).expect(409);
      expect(react.body).toMatchObject({ code: ErrorCode.PLAN_LIMIT_REACHED });
    });

    it('two concurrent invites cannot both take the last slot', async () => {
      const a = await registerTenant(t, 'Limites concurrence', { trial: true });
      await putOnPlan(a, await tinyPlan({ users: 2, products: 100, docs: 100 }));
      const results = await Promise.all(
        [1, 2].map((i) =>
          as(a).post('/users/invite', {
            fullName: `Vendeur ${i}`,
            email: `race-${i}-${randomUUID().slice(0, 8)}@test.dz`,
            role: 'SELLER',
            mode: 'LINK',
          }),
        ),
      );
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    });

    it('refuses a product over the limit', async () => {
      const a = await registerTenant(t, 'Limites produits', { trial: true });
      await putOnPlan(a, await tinyPlan({ users: 5, products: 1, docs: 100 }));
      const cat = await catalogOf(t, a);
      await createProduct(t, a, cat);
      const res = await as(a).post('/products', {
        reference: `OVER-${Date.now()}`,
        designation: 'De trop',
        baseUnitId: cat.units['PIECE']!.id,
        tvaRate: '19',
        units: [
          {
            unitId: cat.units['PIECE']!.id,
            factorToBase: '1',
            barcode: null,
            isDefaultSale: true,
            isDefaultPurchase: true,
          },
        ],
      });
      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({
        code: ErrorCode.PLAN_LIMIT_REACHED,
        details: { resource: 'products', limit: 1 },
      });
    });

    it('documents over the monthly count only warn: sales are never blocked', async () => {
      const a = await registerTenant(t, 'Limites documents', { trial: true });
      await putOnPlan(a, await tinyPlan({ users: 5, products: 100, docs: 1 }));
      const cat = await catalogOf(t, a);
      const p = await createProduct(t, a, cat);
      await as(a)
        .post('/stock/opening', {
          lines: [{ productId: p.id, unitId: p.baseUnitId, qty: '10', unitCost: '50' }],
        })
        .expect(201);
      const client = (await as(a).post('/clients', { code: 'D1', name: 'Docs' }).expect(201))
        .body as ClientDto;
      const sale = () =>
        as(a)
          .post('/sales/quick', {
            documentDate: TODAY,
            clientId: client.id,
            lines: [{ productId: p.id, unitId: p.baseUnitId, qty: '1', unitPriceHt: '100' }],
          })
          .expect(201);
      await sale();
      expect((await summary(a)).docsOverLimit).toBe(false);
      await sale();
      const s = await summary(a);
      expect(s.usage.documentsThisMonth).toBe(2);
      expect(s.docsOverLimit).toBe(true);
    });
  });

  it('a tenant only sees its own subscription', async () => {
    const a = await registerTenant(t, 'Isolation A', { trial: true });
    const b = await registerTenant(t, 'Isolation B');
    expect((await summary(a)).isFree).toBe(false);
    expect((await summary(b)).isFree).toBe(true);
  });
});
