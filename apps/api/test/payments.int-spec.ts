import { randomUUID } from 'node:crypto';
import * as argon2 from 'argon2';
import {
  type AuthResponse,
  type CashSummaryDto,
  type ClientDto,
  type ClientReconcileReport,
  ErrorCode,
  type PaymentDto,
  type PaymentPage,
  type ProductDto,
  type SaleResultDto,
  type UnpaidDocumentDto,
} from '@erp/shared';
import {
  asTenant,
  bearer,
  catalogOf,
  createTestApp,
  registerTenant,
  type RegisteredTenant,
  type TenantCatalog,
  type TestApp,
  uniqueEmail,
} from './helpers';

const TODAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Algiers' }).format(new Date());

describe('versements', () => {
  let t: TestApp;
  let a: RegisteredTenant;
  let b: RegisteredTenant;
  let catA: TenantCatalog;
  let productId: string;
  let carton: string;
  let seq = 0;

  const as = (who: RegisteredTenant) => ({
    get: (url: string) =>
      t
        .http()
        .get(url)
        .set(...bearer(who.auth.accessToken)),
    post: (url: string, body: object = {}, key: string | null = randomUUID()) => {
      const req = t
        .http()
        .post(url)
        .set(...bearer(who.auth.accessToken));
      if (key) req.set('Idempotency-Key', key);
      return req.send(body);
    },
  });

  const client = async (who: RegisteredTenant = a) =>
    (
      await as(who)
        .post('/clients', { code: `P${++seq}`, name: `Client ${seq}` }, null)
        .expect(201)
    ).body as ClientDto;
  const balance = async (clientId: string, who: RegisteredTenant = a) =>
    ((await as(who).get(`/clients/${clientId}`).expect(200)).body as ClientDto).balance;
  const unpaid = async (clientId: string) =>
    (await as(a).get(`/clients/${clientId}/unpaid-documents`).expect(200))
      .body as UnpaidDocumentDto[];
  /** A BL of `cartons` × 2 300 HT (+19 % = 2 737 TTC each) on credit, minus `paid`. */
  const sell = async (clientId: string, cartons: string, extra: object = {}) =>
    (
      (
        await as(a)
          .post('/sales/quick', {
            documentDate: TODAY,
            clientId,
            lines: [{ productId, unitId: carton, qty: cartons }],
            ...extra,
          })
          .expect(201)
      ).body as SaleResultDto
    ).sale;
  const pay = (who: RegisteredTenant, body: object, key: string | null = randomUUID()) =>
    as(who).post('/payments', body, key);

  const loginAs = async (who: RegisteredTenant, role: 'SELLER' | 'MANAGER') => {
    const email = uniqueEmail(role.toLowerCase());
    await asTenant(who.tenantId, async () =>
      t.prisma.db.user.create({
        data: {
          tenantId: who.tenantId,
          email,
          passwordHash: await argon2.hash('Password123!'),
          fullName: `${role} ${++seq}`,
          role,
        },
      }),
    );
    const login = await t
      .http()
      .post('/auth/login')
      .send({ email, password: 'Password123!' })
      .expect(200);
    return { ...who, auth: login.body as AuthResponse & { refreshToken: string } };
  };

  beforeAll(async () => {
    t = await createTestApp();
    a = await registerTenant(t, 'Versements A');
    b = await registerTenant(t, 'Versements B');
    catA = await catalogOf(t, a);
    const piece = catA.units['PIECE']!.id;
    carton = catA.units['CARTON']!.id;
    const res = await as(a)
      .post(
        '/products',
        {
          reference: `VER-${Date.now()}`,
          designation: 'Article versements',
          baseUnitId: piece,
          tvaRate: '19',
          units: [
            {
              unitId: piece,
              factorToBase: '1',
              barcode: null,
              isDefaultSale: false,
              isDefaultPurchase: false,
            },
            {
              unitId: carton,
              factorToBase: '24',
              barcode: null,
              isDefaultSale: true,
              isDefaultPurchase: true,
            },
          ],
          prices: [{ unitId: carton, priceLevelId: catA.levels[0]!.id, priceHt: '2300' }],
        },
        null,
      )
      .expect(201);
    productId = (res.body as ProductDto).id;
    await as(a)
      .post('/stock/opening', {
        lines: [{ productId, unitId: piece, qty: '24000', unitCost: '80' }],
      })
      .expect(201);
  });
  afterAll(() => t.close());

  it('a versement lowers the balance and pays the oldest documents first', async () => {
    const c = await client();
    const first = await sell(c.id, '1'); // 2 737
    const second = await sell(c.id, '1'); // 2 737
    const p = (await pay(a, { clientId: c.id, amount: '3000' }).expect(201)).body as PaymentDto;
    expect(p).toMatchObject({ amount: '3000.00', mode: 'ESPECES', status: 'VALID' });
    expect(p.number).toMatch(/^VER-\d{4}-\d{6}$/);
    expect(p.allocations).toEqual([
      expect.objectContaining({ saleId: first.id, amount: '2737.00' }),
      expect.objectContaining({ saleId: second.id, amount: '263.00' }),
    ]);
    expect(await balance(c.id)).toBe('2474.00');
    expect(await unpaid(c.id)).toEqual([
      expect.objectContaining({ saleId: second.id, paid: '263.00', remaining: '2474.00' }),
    ]);
  });

  it('replaying a versement returns it and creates nothing new', async () => {
    const c = await client();
    const key = randomUUID();
    const first = await pay(a, { clientId: c.id, amount: '500' }, key).expect(201);
    const again = await pay(a, { clientId: c.id, amount: '500' }, key).expect(201);
    expect(again.body).toEqual(first.body);
    expect(await balance(c.id)).toBe('-500.00');
    await pay(a, { clientId: c.id, amount: '600' }, key).expect(409);
  });

  it('20 concurrent versements on one client: exact balance, no document over-allocated', async () => {
    const c = await client();
    await sell(c.id, '1'); // 2 737
    await sell(c.id, '1'); // 2 737 -> 5 474 owed
    await Promise.all(
      Array.from({ length: 20 }, () => pay(a, { clientId: c.id, amount: '300' }).expect(201)),
    );
    // 5 474 - 6 000 = -526 (credit in the client's favour)
    expect(await balance(c.id)).toBe('-526.00');
    expect(await unpaid(c.id)).toEqual([]);
    const allocated = await asTenant(a.tenantId, () =>
      t.prisma.db.paymentAllocation.aggregate({
        where: { sale: { clientId: c.id } },
        _sum: { amount: true },
      }),
    );
    expect(allocated._sum.amount?.toString()).toBe('5474');
  });

  it('manual allocation must name this client documents and stay within what is left', async () => {
    const c = await client();
    const other = await client();
    const mine = await sell(c.id, '1');
    const theirs = await sell(other.id, '1');
    const foreign = await pay(a, {
      clientId: c.id,
      amount: '100',
      allocations: [{ saleId: theirs.id, amount: '100' }],
    }).expect(409);
    expect(foreign.body).toMatchObject({ code: ErrorCode.ALLOCATION_INVALID });
    await pay(a, {
      clientId: c.id,
      amount: '5000',
      allocations: [{ saleId: mine.id, amount: '3000' }],
    }).expect(409);
    await pay(a, {
      clientId: c.id,
      amount: '100',
      allocations: [{ saleId: mine.id, amount: '200' }],
    }).expect(409);
    const ok = (
      await pay(a, {
        clientId: c.id,
        amount: '1000',
        allocations: [{ saleId: mine.id, amount: '400' }],
      }).expect(201)
    ).body as PaymentDto;
    expect(ok.allocations).toEqual([
      expect.objectContaining({ saleId: mine.id, amount: '400.00' }),
    ]);
    // Allocation never changes the balance: the whole 1 000 counts.
    expect(await balance(c.id)).toBe('1737.00');
  });

  it('a bounced cheque brings the debt back, with bank fees; cheques only, managers only', async () => {
    const c = await client();
    await sell(c.id, '1');
    const cash = (await pay(a, { clientId: c.id, amount: '100' }).expect(201)).body as PaymentDto;
    const cheque = (
      await pay(a, {
        clientId: c.id,
        amount: '2000',
        mode: 'CHEQUE',
        reference: '0001234',
        bank: 'BNA',
        dueDate: '2026-11-15',
      }).expect(201)
    ).body as PaymentDto;
    expect(cheque).toMatchObject({ reference: '0001234', bank: 'BNA', dueDate: '2026-11-15' });
    expect(await balance(c.id)).toBe('637.00');

    const seller = await loginAs(a, 'SELLER');
    await as(seller)
      .post(`/payments/${cheque.id}/bounce`, { reason: 'sans provision' })
      .expect(403);
    const notCheque = await as(a)
      .post(`/payments/${cash.id}/bounce`, { reason: 'x'.repeat(5) })
      .expect(409);
    expect(notCheque.body).toMatchObject({ code: ErrorCode.PAYMENT_NOT_CHEQUE });

    const bounced = (
      await as(a)
        .post(`/payments/${cheque.id}/bounce`, { reason: 'sans provision', bankFees: '200' })
        .expect(200)
    ).body as PaymentDto;
    expect(bounced).toMatchObject({ status: 'BOUNCED', bounceReason: 'sans provision' });
    expect(await balance(c.id)).toBe('2837.00'); // 637 + 2 000 + 200 fees
    const again = await as(a)
      .post(`/payments/${cheque.id}/bounce`, { reason: 'encore' })
      .expect(409);
    expect(again.body).toMatchObject({ code: ErrorCode.PAYMENT_NOT_VALID });
    // The bounced cheque no longer pays the document.
    expect((await unpaid(c.id))[0]?.paid).toBe('100.00');
  });

  it('a cheque taken at sale time can bounce; cancelling that sale then reverses nothing twice', async () => {
    const c = await client();
    const sale = await sell(c.id, '1', { paidAmount: '2737', paymentMode: 'CHEQUE' });
    expect(await balance(c.id)).toBe('0.00');
    const cheque = sale.payments[0]!;
    await as(a).post(`/payments/${cheque.id}/bounce`, { reason: 'impayé' }).expect(200);
    expect(await balance(c.id)).toBe('2737.00');
    await as(a).post(`/sales/${sale.id}/cancel`, { reason: 'marchandise reprise' }).expect(200);
    expect(await balance(c.id)).toBe('0.00');
  });

  it('cancel rules: sellers only their own versement the same day; payments of a sale go with the sale', async () => {
    const c = await client();
    await sell(c.id, '1');
    const seller = await loginAs(a, 'SELLER');
    const other = await loginAs(a, 'SELLER');
    const own = (await pay(seller, { clientId: c.id, amount: '100' }).expect(201))
      .body as PaymentDto;
    const old = (await pay(seller, { clientId: c.id, amount: '200' }).expect(201))
      .body as PaymentDto;
    const managers = (await pay(a, { clientId: c.id, amount: '300' }).expect(201))
      .body as PaymentDto;
    expect(await balance(c.id)).toBe('2137.00');

    await as(other).post(`/payments/${own.id}/cancel`, { reason: 'erreur' }).expect(403);
    await as(seller).post(`/payments/${managers.id}/cancel`, { reason: 'erreur' }).expect(403);
    const cancelled = (
      await as(seller)
        .post(`/payments/${own.id}/cancel`, { reason: 'erreur de saisie' })
        .expect(200)
    ).body as PaymentDto;
    expect(cancelled).toMatchObject({ status: 'CANCELLED', cancelReason: 'erreur de saisie' });
    expect(await balance(c.id)).toBe('2237.00');
    const twice = await as(a).post(`/payments/${own.id}/cancel`, { reason: 'encore' }).expect(409);
    expect(twice.body).toMatchObject({ code: ErrorCode.PAYMENT_NOT_VALID });

    // Yesterday's versement: the seller can no longer cancel it, a manager can.
    await asTenant(a.tenantId, () =>
      t.prisma.db.payment.update({
        where: { id: old.id },
        data: { receivedAt: new Date(Date.now() - 2 * 24 * 3600 * 1000) },
      }),
    );
    const late = await as(seller)
      .post(`/payments/${old.id}/cancel`, { reason: 'erreur' })
      .expect(403);
    expect(late.body).toMatchObject({ details: { rule: 'same_day_only' } });
    await as(a).post(`/payments/${old.id}/cancel`, { reason: 'erreur' }).expect(200);
    expect(await balance(c.id)).toBe('2437.00');

    const sale = await sell(c.id, '1', { paidAmount: '1000' });
    const linked = await as(a)
      .post(`/payments/${sale.payments[0]!.id}/cancel`, { reason: 'erreur' })
      .expect(409);
    expect(linked.body).toMatchObject({ code: ErrorCode.PAYMENT_LINKED_TO_SALE });
  });

  it('unpaid documents subtract avoirs and payments taken at sale time', async () => {
    const c = await client();
    const sale = await sell(c.id, '1', { paidAmount: '737' });
    await as(a)
      .post(`/sales/${sale.id}/returns`, {
        disposition: 'RESTOCK',
        reason: 'invendus',
        lines: [{ saleLineId: sale.lines[0]!.id, qty: '0.25' }],
      })
      .expect(201);
    expect(await unpaid(c.id)).toEqual([
      expect.objectContaining({
        saleId: sale.id,
        totalTtc: '2737.00',
        returned: '684.25',
        paid: '737.00',
        remaining: '1315.75',
      }),
    ]);
    expect(await balance(c.id)).toBe('1315.75');
  });

  it('the cash journal totals valid money of the day by mode and by user', async () => {
    const day = await registerTenant(t, 'Versements caisse');
    const cl = (await as(day).post('/clients', { code: 'J1', name: 'Journal' }, null).expect(201))
      .body as ClientDto;
    const seller = await loginAs(day, 'SELLER');
    await pay(day, { clientId: cl.id, amount: '1000' }).expect(201);
    await pay(seller, { clientId: cl.id, amount: '500' }).expect(201);
    await pay(seller, {
      clientId: cl.id,
      amount: '250.50',
      mode: 'CHEQUE',
      reference: 'C1',
    }).expect(201);
    const cancelled = (await pay(day, { clientId: cl.id, amount: '999' }).expect(201))
      .body as PaymentDto;
    await as(day).post(`/payments/${cancelled.id}/cancel`, { reason: 'doublon' }).expect(200);

    const s = (await as(day).get(`/payments/summary?date=${TODAY}`).expect(200))
      .body as CashSummaryDto;
    expect(s).toMatchObject({ date: TODAY, total: '1750.50', count: 3 });
    expect(s.byMode).toEqual(
      expect.arrayContaining([
        { mode: 'ESPECES', count: 2, total: '1500.00' },
        { mode: 'CHEQUE', count: 1, total: '250.50' },
      ]),
    );
    const sellerRow = s.byUser.find((u) => u.user?.fullName.startsWith('SELLER'));
    expect(sellerRow).toMatchObject({ count: 2, total: '750.50' });
    const empty = (await as(day).get('/payments/summary?date=2020-01-01').expect(200))
      .body as CashSummaryDto;
    expect(empty).toMatchObject({ total: '0.00', count: 0, byMode: [] });
  });

  it('lists versements with filters and cheques by due date', async () => {
    const c = await client();
    await pay(a, { clientId: c.id, amount: '10', mode: 'CHEQUE', dueDate: '2026-12-01' }).expect(
      201,
    );
    await pay(a, { clientId: c.id, amount: '20', mode: 'CHEQUE', dueDate: '2026-11-01' }).expect(
      201,
    );
    await pay(a, { clientId: c.id, amount: '30' }).expect(201);
    const list = async (q: string) =>
      ((await as(a).get(`/payments?clientId=${c.id}${q}`).expect(200)).body as PaymentPage).items;
    expect(await list('')).toHaveLength(3);
    expect((await list('&mode=CHEQUE&sort=dueDate')).map((p) => p.dueDate)).toEqual([
      '2026-11-01',
      '2026-12-01',
    ]);
    expect((await list(`&from=${TODAY}&to=${TODAY}`)).length).toBe(3);
    expect(await list('&from=2020-01-01&to=2020-01-02')).toEqual([]);
  });

  it('tenant B cannot see or touch tenant A versements', async () => {
    const c = await client();
    const p = (await pay(a, { clientId: c.id, amount: '10' }).expect(201)).body as PaymentDto;
    await as(b).get(`/payments/${p.id}`).expect(404);
    await as(b).post(`/payments/${p.id}/cancel`, { reason: 'intrusion' }).expect(404);
    await pay(b, { clientId: c.id, amount: '10' }).expect(400);
    await as(b).get(`/clients/${c.id}/unpaid-documents`).expect(404);
    const page = (await as(b).get('/payments?limit=100').expect(200)).body as PaymentPage;
    expect(page.items.map((x) => x.id)).not.toContain(p.id);
  });

  // Last on purpose: every path above must leave the accounts reconcilable.
  it('client reconcile finds no difference', async () => {
    const report = (await as(a).get('/clients/reconcile').expect(200))
      .body as ClientReconcileReport;
    expect(report.differences).toEqual([]);
    expect(report.checkedClients).toBeGreaterThan(5);
  });
});
