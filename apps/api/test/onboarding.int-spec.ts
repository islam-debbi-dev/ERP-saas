import { randomUUID } from 'node:crypto';
import { type ClientDto, type OnboardingStatus } from '@erp/shared';
import {
  bearer,
  catalogOf,
  createProduct,
  createTestApp,
  registerTenant,
  type RegisteredTenant,
  type TestApp,
} from './helpers';

const TODAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Algiers' }).format(new Date());

describe('onboarding checklist', () => {
  let t: TestApp;
  let a: RegisteredTenant;

  const as = (who: { auth: { accessToken: string } }) => ({
    get: (url: string) =>
      t
        .http()
        .get(url)
        .set(...bearer(who.auth.accessToken)),
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

  const status = async () =>
    (await as(a).get('/dashboard/onboarding').expect(200)).body as OnboardingStatus;
  const done = async () => Object.fromEntries((await status()).steps.map((s) => [s.key, s.done]));

  beforeAll(async () => {
    t = await createTestApp();
    a = await registerTenant(t, 'Onboarding');
  });
  afterAll(() => t.close());

  it('ticks each step from the data, in any order', async () => {
    expect(await status()).toEqual({
      steps: [
        { key: 'companyInfo', done: false },
        { key: 'products', done: false },
        { key: 'clientBalances', done: false },
        { key: 'users', done: false },
        { key: 'firstSale', done: false },
      ],
      completed: false,
      dismissed: false,
    });

    await as(a)
      .patch('/tenant/settings', { adresse: 'Rue 1, Alger', nif: '000016001234567' })
      .expect(200);
    const cat = await catalogOf(t, a);
    const p = await createProduct(t, a, cat);
    const client = (await as(a).post('/clients', { code: 'O1', name: 'Ouverture' }).expect(201))
      .body as ClientDto;
    await as(a).post(`/clients/${client.id}/opening-balance`, { amount: '1500' }).expect(201);
    expect(await done()).toMatchObject({
      companyInfo: true,
      products: true,
      clientBalances: true,
      users: false,
      firstSale: false,
    });

    await as(a)
      .post('/users/invite', {
        fullName: 'Vendeur',
        email: `ob-${randomUUID().slice(0, 8)}@test.dz`,
        role: 'SELLER',
        mode: 'LINK',
      })
      .expect(201);
    await as(a)
      .post('/stock/opening', {
        lines: [{ productId: p.id, unitId: p.baseUnitId, qty: '5', unitCost: '10' }],
      })
      .expect(201);
    await as(a)
      .post('/sales/quick', {
        documentDate: TODAY,
        clientId: client.id,
        lines: [{ productId: p.id, unitId: p.baseUnitId, qty: '1', unitPriceHt: '20' }],
      })
      .expect(201);
    const s = await status();
    expect(s.completed).toBe(true);
  });

  it('the owner hides it for the company only', async () => {
    const b = await registerTenant(t, 'Onboarding B');
    await t
      .http()
      .post('/dashboard/onboarding/dismiss')
      .set(...bearer(b.auth.accessToken))
      .expect(204);
    const s = (await as(b).get('/dashboard/onboarding').expect(200)).body as OnboardingStatus;
    expect(s.dismissed).toBe(true);
    // Another company is untouched.
    expect((await status()).dismissed).toBe(false);
  });
});
