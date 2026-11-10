import { randomUUID } from 'node:crypto';
import * as argon2 from 'argon2';
import ExcelJS from 'exceljs';
import {
  type AuthResponse,
  type ClientDto,
  type DashboardDto,
  money,
  type PaymentDto,
  type ProductDto,
  type PurchaseDto,
  type ReportDto,
  type SaleDto,
  type SaleResultDto,
} from '@erp/shared';
import {
  asTenant,
  bearer,
  catalogOf,
  createProduct,
  createTestApp,
  registerTenant,
  tamper,
  type RegisteredTenant,
  type TestApp,
  uniqueEmail,
} from './helpers';

/**
 * One fixture for the dashboard and the reports, as of 31 March 2026 (Algiers).
 * Product P: carton of 24 pièces at 2 300 HT (2 737 TTC), cost 80 × 24 = 1 920.
 * Dates are set by SQL after each operation; sales, avoirs and payments are not
 * append-only tables (the stock and client ledgers are, and are not touched).
 *
 *   sale  client  cartons  validated (UTC)         Algiers day   notes
 *   S1    C1      2        2026-03-31 08:00        31 Mar
 *   S2    C1      1        2026-03-30 23:30        31 Mar        00:30 local
 *   S3    C2      1        2026-03-30 22:30        30 Mar        23:30 local; DAMAGED avoir 31 Mar
 *   S4    —       1        2026-03-10 10:00        10 Mar        facture comptoir paid cash
 *   S5    C2      1        2026-03-05 10:00         5 Mar        grouped with S6 in a facture (not counted)
 *   S6    C2      1        2026-03-06 10:00         6 Mar
 *   S7    C1      3        2026-03-12 10:00        12 Mar        avoir 1, then cancelled: excluded
 *   S8    C2      2        2026-03-15 10:00        15 Mar        RESTOCK avoir of 1 on 16 Mar
 *   S9    C1      1        2026-02-28 22:30        28 Feb        23:30 local
 *   S10   C1      1        2026-02-27 10:00        27 Feb
 *   S11   C1      1        2026-01-31 23:30         1 Feb        00:30 local
 *   S12   C1      1        2026-03-31 10:00        31 Mar        made by the seller
 *   S13   C1      1        2026-01-31 22:30        31 Jan        outside both periods
 */
const DATE = '2026-03-31';
const at = (iso: string) => new Date(`${iso}Z`);

describe('dashboard and reports', () => {
  let t: TestApp;
  let a: RegisteredTenant;
  let b: RegisteredTenant;
  let seller: RegisteredTenant;
  let storekeeper: RegisteredTenant;
  let productP: string;
  let carton: string;
  let c1: ClientDto;
  let c2: ClientDto;
  let seq = 0;

  const as = (who: RegisteredTenant) => ({
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
  });

  const loginAs = async (who: RegisteredTenant, role: 'SELLER' | 'STOREKEEPER' | 'MANAGER') => {
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

  const newClient = async (who: RegisteredTenant) =>
    (
      await as(who)
        .post('/clients', { code: `R${++seq}`, name: `Client ${seq}` })
        .expect(201)
    ).body as ClientDto;

  /** A validated sale of `cartons` of P, then dated `validatedAt` (UTC). */
  const sell = async (
    who: RegisteredTenant,
    clientId: string | null,
    cartons: string,
    validatedAt: string,
    extra: object = {},
  ): Promise<SaleDto> => {
    const res = await as(who)
      .post('/sales/quick', {
        documentDate: DATE,
        clientId,
        lines: [{ productId: productP, unitId: carton, qty: cartons }],
        ...extra,
      })
      .expect(201);
    const sale = (res.body as SaleResultDto).sale;
    await tamper(t)`
      UPDATE sales SET "validatedAt" = ${at(validatedAt)} WHERE id = ${sale.id}::uuid`;
    await tamper(t)`
      UPDATE payments SET "receivedAt" = ${at(validatedAt)} WHERE "saleId" = ${sale.id}::uuid`;
    return sale;
  };

  const avoir = async (sale: SaleDto, disposition: 'RESTOCK' | 'DAMAGED', createdAt: string) => {
    await as(a)
      .post(`/sales/${sale.id}/returns`, {
        disposition,
        reason: 'retour client',
        lines: [{ saleLineId: sale.lines[0]!.id, qty: '1' }],
      })
      .expect(201);
    await tamper(t)`
      UPDATE sale_returns SET "createdAt" = ${at(createdAt)} WHERE "saleId" = ${sale.id}::uuid`;
  };

  const pay = async (clientId: string, body: object, receivedAt: string) => {
    const p = (
      await as(a)
        .post('/payments', { clientId, ...body })
        .expect(201)
    ).body as PaymentDto;
    await tamper(t)`
      UPDATE payments SET "receivedAt" = ${at(receivedAt)} WHERE id = ${p.id}::uuid`;
    return p;
  };

  const report = async (who: RegisteredTenant, name: string, query: string) =>
    (await as(who).get(`/reports/${name}?${query}`).expect(200)).body as ReportDto;

  const row = (r: ReportDto, key: string | null) => r.rows.find((x) => x.key === key)?.values;

  beforeAll(async () => {
    t = await createTestApp();
    a = await registerTenant(t, 'Rapports A');
    b = await registerTenant(t, 'Rapports B');
    seller = await loginAs(a, 'SELLER');
    storekeeper = await loginAs(a, 'STOREKEEPER');

    let productA = '';
    for (const who of [a, b]) {
      const cat = await catalogOf(t, who);
      const piece = cat.units['PIECE']!.id;
      carton = cat.units['CARTON']!.id;
      const res = await as(who)
        .post('/products', {
          reference: `RAP-${Date.now()}-${++seq}`,
          designation: 'Article rapports',
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
          prices: [{ unitId: carton, priceLevelId: cat.levels[0]!.id, priceHt: '2300' }],
        })
        .expect(201);
      productP = (res.body as ProductDto).id;
      await as(who)
        .post('/stock/opening', {
          lines: [{ productId: productP, unitId: piece, qty: '24000', unitCost: '80' }],
        })
        .expect(201);
      if (who === a) productA = productP;
      if (who === b) {
        // Tenant B sells 5 cartons "today": none of it may show in A's figures.
        const cb = await newClient(b);
        await sell(b, cb.id, '5', '2026-03-31T09:00:00');
      }
    }
    // Tenant A from here on: P is A's product again.
    const catA = await catalogOf(t, a);
    const pieceA = catA.units['PIECE']!.id;
    carton = catA.units['CARTON']!.id;
    productP = productA;

    // Stock: Q is out of stock (min 10), R is low (3 ≤ 5), T comes from a purchase.
    await createProduct(t, a, catA, { minStock: '10', designation: 'Q rupture' });
    const r = await createProduct(t, a, catA, { minStock: '5', designation: 'R bas' });
    await as(a)
      .post('/stock/opening', {
        lines: [{ productId: r.id, unitId: pieceA, qty: '3', unitCost: '100' }],
      })
      .expect(201);
    const tp = await createProduct(t, a, catA, { designation: 'T achat' });
    const supplier = (await as(a).post('/suppliers', { name: 'Fournisseur R' }).expect(201))
      .body as { id: string };
    const draft = (
      await as(a)
        .post('/purchases', {
          supplierId: supplier.id,
          documentDate: '2026-03-02',
          lines: [{ productId: tp.id, unitId: pieceA, qty: '10', unitCost: '50' }],
        })
        .expect(201)
    ).body as PurchaseDto;
    const purchase = (await as(a).post(`/purchases/${draft.id}/validate`).expect(200))
      .body as PurchaseDto;
    await as(a)
      .post(`/purchases/${purchase.id}/returns`, {
        lines: [{ purchaseLineId: purchase.lines[0]!.id, qty: '2' }],
      })
      .expect(201);
    await tamper(t)`
      UPDATE purchases SET "validatedAt" = ${at('2026-03-02T09:00:00')} WHERE id = ${purchase.id}::uuid`;
    await tamper(t)`
      UPDATE purchase_returns SET "createdAt" = ${at('2026-03-03T09:00:00')} WHERE "purchaseId" = ${purchase.id}::uuid`;

    c1 = await newClient(a);
    c2 = await newClient(a);
    await sell(a, c1.id, '2', '2026-03-31T08:00:00'); // S1
    await sell(a, c1.id, '1', '2026-03-30T23:30:00'); // S2
    const s3 = await sell(a, c2.id, '1', '2026-03-30T22:30:00');
    await avoir(s3, 'DAMAGED', '2026-03-31T09:00:00');
    await sell(a, null, '1', '2026-03-10T10:00:00', {
      type: 'FACTURE',
      paidAmount: '2737',
      paymentMode: 'ESPECES',
    }); // S4
    const s5 = await sell(a, c2.id, '1', '2026-03-05T10:00:00');
    const s6 = await sell(a, c2.id, '1', '2026-03-06T10:00:00');
    const facture = (
      (
        await as(a)
          .post('/invoices/from-bls', { saleIds: [s5.id, s6.id], documentDate: '2026-03-07' })
          .expect(201)
      ).body as SaleResultDto
    ).sale;
    await tamper(t)`
      UPDATE sales SET "validatedAt" = ${at('2026-03-07T10:00:00')} WHERE id = ${facture.id}::uuid`;
    const s7 = await sell(a, c1.id, '3', '2026-03-12T10:00:00');
    await avoir(s7, 'RESTOCK', '2026-03-13T10:00:00');
    await as(a).post(`/sales/${s7.id}/cancel`, { reason: 'erreur de saisie' }).expect(200);
    const s8 = await sell(a, c2.id, '2', '2026-03-15T10:00:00');
    await avoir(s8, 'RESTOCK', '2026-03-16T10:00:00');
    await sell(a, c1.id, '1', '2026-02-28T22:30:00'); // S9
    await sell(a, c1.id, '1', '2026-02-27T10:00:00'); // S10
    await sell(a, c1.id, '1', '2026-01-31T23:30:00'); // S11
    await sell(seller, c1.id, '1', '2026-03-31T10:00:00'); // S12
    await sell(a, c1.id, '1', '2026-01-31T22:30:00'); // S13

    await pay(c1.id, { amount: '1000' }, '2026-03-31T09:00:00');
    await pay(
      c1.id,
      { amount: '2000', mode: 'CHEQUE', reference: '001', bank: 'BNA', dueDate: '2026-04-15' },
      '2026-03-31T10:00:00',
    );
    await pay(
      c2.id,
      { amount: '500', mode: 'VIREMENT', reference: 'VIR-1' },
      '2026-03-31T11:00:00',
    );
    const bounced = await pay(
      c2.id,
      { amount: '700', mode: 'CHEQUE', reference: '002', bank: 'CPA', dueDate: '2026-04-15' },
      '2026-03-31T12:00:00',
    );
    await as(a).post(`/payments/${bounced.id}/bounce`, { reason: 'sans provision' }).expect(200);

    // Plafond set after the sales so it never blocks them: C1 owes more than 10 000.
    await tamper(t)`
      UPDATE clients SET "creditLimit" = 10000 WHERE id = ${c1.id}::uuid`;
  });
  afterAll(() => t.close());

  describe('GET /dashboard', () => {
    it('gives the owner every figure, computed by hand', async () => {
      const d = (await as(a).get(`/dashboard?date=${DATE}`).expect(200)).body as DashboardDto;
      expect(d.date).toBe(DATE);
      // Today: S1 5 474 + S2 2 737 + S12 2 737 − DAMAGED avoir on S3 2 737.
      expect(d.sales?.today).toEqual({ ttc: '8211.00', count: 3 });
      // March: S1, S2, S3, S4, S5, S6, S8 (2), S12 = 10 cartons, minus 2 avoirs.
      expect(d.sales?.month).toEqual({ ttc: '21896.00', count: 8 });
      // 1–28 February: S9, S10 and S11 (00:30 on the 1st); S13 is 31 January.
      expect(d.sales?.previousMonth).toEqual({ ttc: '8211.00', count: 3 });
      expect(d.sales?.perDay).toHaveLength(31);
      const day = (date: string) => d.sales?.perDay.find((p) => p.date === date)?.ttc;
      expect(day('2026-03-30')).toBe('2737.00'); // S3 at 23:30 local
      expect(day('2026-03-31')).toBe('8211.00');
      expect(day('2026-03-07')).toBe('0.00'); // the grouping facture counts nothing
      expect(day('2026-03-12')).toBe('0.00'); // cancelled
      expect(day('2026-03-16')).toBe('-2737.00'); // the RESTOCK avoir
      // 10 cartons: 23 000 HT − 19 200 cost = 3 800; RESTOCK avoir −2 300 + 1 920;
      // DAMAGED avoir −2 300 (the goods are lost, their cost stays).
      expect(d.sales?.margin).toBe('1120.00');

      // Today's cash: the bounced cheque and S4's March 10 payment are out.
      expect(d.cash?.total).toBe('3500.00');
      expect(d.cash?.byMode).toEqual(
        expect.arrayContaining([
          { mode: 'ESPECES', count: 1, total: '1000.00' },
          { mode: 'CHEQUE', count: 1, total: '2000.00' },
          { mode: 'VIREMENT', count: 1, total: '500.00' },
        ]),
      );
      expect(d.cash?.byMode).toHaveLength(3);

      // C1: S1 (2) + S2 + S12 + S9 + S10 + S11 + S13 = 8 cartons (21 896) − 3 000 paid.
      // C2: S3 + S5 + S6 + S8 = 5 cartons (13 685) − 2 avoirs − 500 (the bounced 700 is back).
      expect(d.credit).toMatchObject({
        total: '26607.00',
        debtorCount: 2,
        overLimitCount: 1,
      });
      expect(d.credit?.topDebtors.map((x) => [x.id, x.balance])).toEqual([
        [c1.id, '18896.00'],
        [c2.id, '7711.00'],
      ]);
      expect(d.credit?.overLimit.map((x) => x.id)).toEqual([c1.id]);

      // P: 24 000 − 17 cartons sold + 4 back (S7 avoir and cancellation, S8 avoir;
      // the DAMAGED one is written off) = 23 688 × 80; R: 3 × 100; T: 8 × 50.
      expect(d.stock).toEqual({ outOfStock: 1, lowStock: 2, value: '1895740.00' });
    });

    it('shows a seller his own sales only, without margin', async () => {
      const d = (await as(seller).get(`/dashboard?date=${DATE}`).expect(200)).body as DashboardDto;
      expect(d.sales).toMatchObject({
        today: { ttc: '2737.00', count: 1 },
        month: { ttc: '2737.00', count: 1 },
        previousMonth: { ttc: '0.00', count: 0 },
        margin: null,
      });
      expect(d).toMatchObject({ cash: null, credit: null, stock: null });
    });

    it('shows a storekeeper the stock only', async () => {
      const d = (await as(storekeeper).get(`/dashboard?date=${DATE}`).expect(200))
        .body as DashboardDto;
      expect(d).toMatchObject({ sales: null, cash: null, credit: null });
      expect(d.stock?.lowStock).toBe(2);
    });

    it("keeps tenant B's figures apart", async () => {
      const d = (await as(b).get(`/dashboard?date=${DATE}`).expect(200)).body as DashboardDto;
      expect(d.sales?.today).toEqual({ ttc: '13685.00', count: 1 });
      expect(d.sales?.month.count).toBe(1);
      expect(d.credit?.topDebtors).toHaveLength(1);
      expect(d.stock).toEqual({ outOfStock: 0, lowStock: 0, value: '1910400.00' });
    });

    it('phase 33: a period, compared with the same length just before, and its chart', async () => {
      const get = async (who: RegisteredTenant, q: string) =>
        (await as(who).get(`/dashboard?date=${DATE}&${q}`).expect(200)).body as DashboardDto;

      // Last month: 1–28 February (S9, S10, S11) against the 28 days before (S13 on 31 Jan).
      const feb = await get(a, 'period=lastMonth');
      expect(feb.sales?.period).toEqual({
        period: 'lastMonth',
        from: '2026-02-01',
        to: '2026-02-28',
        previousFrom: '2026-01-04',
        previousTo: '2026-01-31',
        bucket: 'day',
      });
      expect(feb.sales?.current).toEqual({ ttc: '8211.00', count: 3 });
      expect(feb.sales?.previous).toEqual({ ttc: '2737.00', count: 1 });
      expect(feb.sales?.changePct).toBe('200.0');
      expect(feb.sales?.series).toHaveLength(28);
      expect(feb.sales?.series.at(-1)).toMatchObject({
        from: '2026-02-28',
        ttc: '2737.00',
        count: 1,
        previousTtc: '2737.00', // 31 January
      });
      // The cards of the day stay today's.
      expect(feb.sales?.today).toEqual({ ttc: '8211.00', count: 3 });

      // 7 days (25–31 March): S3 on the 30th, then S1, S2, S12 and the DAMAGED avoir.
      const week = await get(a, 'period=7d');
      expect(week.sales?.current).toEqual({ ttc: '10948.00', count: 4 });
      const last = week.sales?.series.at(-1);
      expect(last).toMatchObject({ from: DATE, ttc: '8211.00', cash: '3500.00' });
      expect(last?.margin).not.toBeNull();
      // The margin of the period is the sum of its bars.
      const sum = week.sales!.series.reduce((s, p) => s.plus(p.margin!), money(0));
      expect(sum.toFixed(2)).toBe(week.sales?.margin);

      // A custom quarter goes by week (90 days: 13 bars, the last one 6 days).
      const quarter = await get(a, 'period=custom&from=2026-01-01&to=2026-03-31');
      expect(quarter.sales?.period.bucket).toBe('week');
      expect(quarter.sales?.series).toHaveLength(13);
      expect(quarter.sales?.series.at(-1)).toMatchObject({ from: '2026-03-26', to: DATE });
      const total = quarter.sales!.series.reduce((s, p) => s.plus(p.ttc), money(0));
      expect(total.toFixed(2)).toBe(quarter.sales?.current.ttc);

      // A seller: his own sales, no margin and no cash on the chart.
      const his = await get(seller, 'period=7d');
      expect(his.sales?.current).toEqual({ ttc: '2737.00', count: 1 });
      expect(his.sales?.series.every((p) => p.cash === null && p.margin === null)).toBe(true);
      expect(his.top?.clients.map((c) => c.id)).toEqual([c1.id]);

      // Tenant B's period holds its own sale only.
      expect((await get(b, 'period=7d')).sales?.current).toEqual({ ttc: '13685.00', count: 1 });

      for (const bad of [
        'period=custom',
        'period=custom&from=2026-03-31&to=2026-03-01',
        'period=custom&from=2024-01-01&to=2026-03-31',
        'period=year',
      ]) {
        await as(a).get(`/dashboard?date=${DATE}&${bad}`).expect(400);
      }
    });

    it('phase 33: top products and clients of the period, and the clients who stopped', async () => {
      const d = (await as(a).get(`/dashboard?date=${DATE}`).expect(200)).body as DashboardDto;
      // March: 10 cartons sold − 2 back (DAMAGED and RESTOCK) = 192 pièces of P.
      expect(d.top?.products).toEqual([
        {
          id: productP,
          designation: 'Article rapports',
          unit: 'PIECE',
          qty: '192.000',
          ttc: '21896.00',
        },
      ]);
      // The comptoir sale (S4) has no client.
      expect(d.top?.clients).toEqual([
        { id: c1.id, name: c1.name, ttc: '10948.00', count: 3 },
        { id: c2.id, name: c2.name, ttc: '8211.00', count: 4 },
      ]);
      // As of 31 March both bought in the last 30 days.
      expect(d.top?.dormant).toEqual([]);

      // As of 15 May: nothing since 16 April, something in the 90 days before.
      const may = (await as(a).get('/dashboard?date=2026-05-15').expect(200)).body as DashboardDto;
      expect(may.top?.dormant).toEqual([
        // S1, S2, S12, S9, S10, S11, S13: 21 896 over 3 months.
        { id: c1.id, name: c1.name, monthly: '7298.67', lastSale: '2026-03-31' },
        // S3, S5, S6, S8 net of the 2 avoirs: 8 211.
        { id: c2.id, name: c2.name, monthly: '2737.00', lastSale: '2026-03-30' },
      ]);
      const sk = (await as(storekeeper).get(`/dashboard?date=${DATE}`).expect(200))
        .body as DashboardDto;
      expect(sk.top).toBeNull();
    });

    it('phase 33: the owner’s monthly goal, set by him only and audited; the greeting fact', async () => {
      const patch = (who: RegisteredTenant, body: object) =>
        t
          .http()
          .patch('/tenant/settings')
          .set(...bearer(who.auth.accessToken))
          .send(body);
      const manager = await loginAs(a, 'MANAGER');
      expect(
        ((await as(a).get(`/dashboard?date=${DATE}`).expect(200)).body as DashboardDto).target,
      ).toBeNull();

      await patch(manager, { monthlySalesTarget: '30000' }).expect(403);
      await patch(a, { monthlySalesTarget: '0' }).expect(400);
      await patch(a, { monthlySalesTarget: '30 000,00' }).expect(200);
      // The form sends every field: the same value from a manager is not a change.
      await patch(manager, { monthlySalesTarget: '30000.00', reminderDays: 30 }).expect(200);
      const audits = await asTenant(a.tenantId, () =>
        t.prisma.db.auditLog.findMany({ where: { action: 'TENANT_SALES_TARGET_CHANGED' } }),
      );
      expect(audits).toHaveLength(1);
      expect(audits[0]).toMatchObject({
        before: { monthlySalesTarget: null },
        after: { monthlySalesTarget: '30000.00' },
      });

      const d = (await as(a).get(`/dashboard?date=${DATE}`).expect(200)).body as DashboardDto;
      // March so far 21 896 of 30 000; 31 March is the last day.
      expect(d.target).toEqual({
        amount: '30000.00',
        achieved: '21896.00',
        pct: '73.0',
        remaining: '8104.00',
        daysLeft: 1,
      });
      // Narrowed to one seller, or seen by a seller: not the company's goal.
      const one = (
        await as(a).get(`/dashboard?date=${DATE}&sellerId=${seller.auth.user.id}`).expect(200)
      ).body as DashboardDto;
      expect(one.target).toBeNull();
      expect(
        ((await as(seller).get(`/dashboard?date=${DATE}`).expect(200)).body as DashboardDto).target,
      ).toBeNull();

      // No cheque due today, 30 March was not the best day: March against February.
      expect(d.greeting).toEqual({ key: 'salesUp', params: { pct: '167' } });
      await patch(a, { monthlySalesTarget: null }).expect(200);
    });

    it('defaults to today and rejects a bad date', async () => {
      const d = (await as(a).get('/dashboard').expect(200)).body as DashboardDto;
      expect(d.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      await as(a).get('/dashboard?date=31-03-2026').expect(400);
    });
  });

  describe('GET /reports/:name', () => {
    const MARCH = 'from=2026-03-01&to=2026-03-31';

    it('sales by day follow Algiers days', async () => {
      const r = await report(a, 'sales', `${MARCH}&groupBy=day`);
      expect(row(r, '2026-03-30')).toMatchObject({ count: '1', netTtc: '2737.00' });
      expect(row(r, '2026-03-31')).toMatchObject({
        count: '3',
        grossHt: '9200.00',
        returnsHt: '2300.00',
        netTtc: '8211.00',
      });
      expect(row(r, '2026-03-07')).toBeUndefined();
      expect(r.totals).toMatchObject({ count: '8', netHt: '18400.00', netTtc: '21896.00' });
    });

    it('sales by client, by month and by product', async () => {
      const byClient = await report(a, 'sales', `${MARCH}&groupBy=client`);
      expect(row(byClient, c1.id)).toMatchObject({ count: '3', netTtc: '10948.00' });
      expect(row(byClient, c2.id)).toMatchObject({ count: '4', netTtc: '8211.00' });
      expect(row(byClient, null)).toMatchObject({ count: '1', netTtc: '2737.00', name: null });
      expect(byClient.rows.find((x) => x.key === c1.id)?.link).toEqual({
        type: 'client',
        id: c1.id,
      });

      const byMonth = await report(a, 'sales', 'from=2026-01-01&to=2026-03-31&groupBy=month');
      expect(byMonth.rows.map((x) => [x.key, x.values.netTtc])).toEqual([
        ['2026-01', '2737.00'],
        ['2026-02', '8211.00'],
        ['2026-03', '21896.00'],
      ]);

      const byProduct = await report(a, 'sales', `${MARCH}&groupBy=product`);
      expect(byProduct.rows).toHaveLength(1);
      expect(byProduct.rows[0]?.values).toMatchObject({ qty: '192.000', netHt: '18400.00' });
    });

    it('margin by product and category', async () => {
      const byProduct = await report(a, 'margin', `${MARCH}&groupBy=product`);
      expect(byProduct.rows[0]?.values).toMatchObject({
        netHt: '18400.00',
        cost: '17280.00',
        margin: '1120.00',
        marginPct: '6.09',
      });
      const byCategory = await report(a, 'margin', `${MARCH}&groupBy=category`);
      expect(row(byCategory, null)).toMatchObject({ category: null, margin: '1120.00' });
    });

    it('payments by mode leave the bounced cheque out', async () => {
      const r = await report(a, 'payments', `${MARCH}&groupBy=mode`);
      expect(row(r, 'ESPECES')).toEqual({ mode: 'ESPECES', count: '2', total: '3737.00' });
      expect(row(r, 'CHEQUE')).toEqual({ mode: 'CHEQUE', count: '1', total: '2000.00' });
      expect(row(r, 'VIREMENT')).toEqual({ mode: 'VIREMENT', count: '1', total: '500.00' });
      expect(r.totals).toEqual({ count: '4', total: '6237.00' });
    });

    it('purchases by supplier net of returns', async () => {
      const r = await report(a, 'purchases', `${MARCH}&groupBy=supplier`);
      expect(r.rows).toHaveLength(1);
      expect(r.rows[0]?.values).toMatchObject({
        supplier: 'Fournisseur R',
        count: '1',
        grossHt: '500.00',
        returnsHt: '100.00',
        netHt: '400.00',
        netTtc: '476.00',
      });
    });

    it('stock movements of the real day the fixture ran', async () => {
      const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Algiers' }).format(
        new Date(),
      );
      const r = await report(
        storekeeper,
        'stock-movements',
        `from=${today}&to=${today}&groupBy=type`,
      );
      expect(row(r, 'OPENING')).toMatchObject({ count: '2', products: '2' });
      expect(row(r, 'PURCHASE_RETURN')).toMatchObject({ count: '1' });
      expect(r.totals.products).toBeUndefined();
    });

    it('a seller runs his own sales report only', async () => {
      const r = await report(seller, 'sales', `${MARCH}&groupBy=seller`);
      expect(r.rows).toHaveLength(1);
      expect(r.rows[0]?.values).toMatchObject({ count: '1', netTtc: '2737.00' });
      await as(seller).get(`/reports/margin?${MARCH}`).expect(403);
      await as(seller).get(`/reports/payments?${MARCH}`).expect(403);
      await as(storekeeper).get(`/reports/sales?${MARCH}`).expect(403);
    });

    it("tenant B sees none of A's documents", async () => {
      const r = await report(b, 'sales', `${MARCH}&groupBy=client`);
      expect(r.totals).toMatchObject({ count: '1', netTtc: '13685.00' });
      const p = await report(b, 'purchases', `${MARCH}&groupBy=supplier`);
      expect(p.rows).toHaveLength(0);
    });

    it('validates the name, the grouping and the period', async () => {
      await as(a).get(`/reports/unknown?${MARCH}`).expect(400);
      await as(a).get(`/reports/sales?${MARCH}&groupBy=supplier`).expect(400);
      await as(a).get('/reports/sales?from=2026-03-31&to=2026-03-01').expect(400);
      await as(a).get('/reports/sales?from=2025-01-01&to=2026-03-31').expect(400);
    });

    it('exports the same rows to .xlsx', async () => {
      const res = await as(a)
        .get(`/reports/sales/export.xlsx?${MARCH}&groupBy=client`)
        .buffer(true)
        .parse((response, done) => {
          const chunks: Buffer[] = [];
          response.on('data', (c: Buffer) => chunks.push(c));
          response.on('end', () => done(null, Buffer.concat(chunks)));
        })
        .expect(200);
      expect(res.headers['content-disposition']).toContain(
        'sales-client-2026-03-01-2026-03-31.xlsx',
      );
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(res.body as ExcelJS.Buffer);
      const sheet = workbook.worksheets[0]!;
      expect(sheet.getRow(3).values).toEqual([
        undefined,
        'Code',
        'Client',
        'Nombre',
        'Ventes HT',
        'Avoirs HT',
        'Net HT',
        'Net TTC',
      ]);
      const json = await report(a, 'sales', `${MARCH}&groupBy=client`);
      const netTtc = [4, 5, 6].map((n) => sheet.getRow(n).getCell(7).value);
      expect(netTtc).toEqual(json.rows.map((x) => Number(x.values.netTtc)));
      expect(sheet.getRow(7).getCell(1).value).toBe('Total');
      expect(sheet.getRow(7).getCell(7).value).toBe(21896);
    });
  });
});
