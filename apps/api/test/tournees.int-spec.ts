import { randomUUID } from 'node:crypto';
import * as argon2 from 'argon2';
import {
  Activity,
  algiersDay,
  type ApiError,
  type AuthResponse,
  type ClientDto,
  type DelivererDto,
  type DeliverOrderResultDto,
  ErrorCode,
  type OrderDto,
  type OrderPage,
  type ProductDto,
  type Role,
  type RouteDto,
  type SaleDto,
  type SaleResultDto,
  type SellerDayDto,
  type SellerSessionCloseResultDto,
  type SellerSessionDto,
  type StockLevelDto,
  type TodayDto,
  type TourneeReportDto,
  type VisitDto,
  type VisitPage,
  type WarehouseDto,
  weekdayOf,
} from '@erp/shared';
import {
  asTenant,
  bearer,
  catalogOf,
  createTestApp,
  grantAllWarehouses,
  type RegisteredTenant,
  registerTenant,
  tamper,
  type TenantCatalog,
  type TestApp,
  uniqueEmail,
  withoutGeoCheck,
} from './helpers';

const errorOf = (res: { body: unknown }) => res.body as ApiError;
type Who = { auth: { accessToken: string } };
interface Member {
  id: string;
  auth: AuthResponse;
}
interface Item {
  id: string;
  piece: string;
  carton: string;
}

/**
 * Phase 16: tournées, visites, bons de commande and clôture. An order has no effect until
 * it is delivered; delivering creates exactly one BL through the sale path; the expected
 * cash of a closing is computed from the payments the seller collected that Algiers day.
 */
describe('tournées, orders and seller sessions (phase 16)', () => {
  let t: TestApp;
  let d: RegisteredTenant;
  let other: RegisteredTenant;
  let essentiel: RegisteredTenant;
  let cat: TenantCatalog;
  let sellerA: Member;
  let sellerB: Member;
  let livreur: Member;
  let livreur2: Member;
  let seq = 0;
  const today = () => algiersDay();

  const as = (who: Who) => ({
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
      if (key) void req.set('Idempotency-Key', key);
      return req.send(body);
    },
    put: (url: string, body: object) =>
      t
        .http()
        .put(url)
        .set(...bearer(who.auth.accessToken))
        .send(body),
    patch: (url: string, body: object) =>
      t
        .http()
        .patch(url)
        .set(...bearer(who.auth.accessToken))
        .send(body),
  });

  const member = async (who: RegisteredTenant, role: Role, managerId?: string): Promise<Member> => {
    const email = uniqueEmail(role.toLowerCase());
    const user = await asTenant(who.tenantId, async () =>
      t.prisma.db.user.create({
        data: {
          tenantId: who.tenantId,
          email,
          passwordHash: await argon2.hash('Password123!'),
          fullName: `${role} ${++seq}`,
          role,
          ...(managerId ? { managerId } : {}),
        },
      }),
    );
    await grantAllWarehouses(t, user.id);
    const login = await t
      .http()
      .post('/auth/login')
      // Each login from its own address: the login limiter is not what is tested here.
      .set('X-Forwarded-For', `10.16.${Math.floor(seq / 250)}.${(seq % 250) + 1}`)
      .send({ email, password: 'Password123!' })
      .expect(200);
    return { id: user.id, auth: login.body as AuthResponse };
  };

  /** Carton of 24 pièces at 2 400 HT (gros), 240 pièces opened at 80. */
  async function product(who: RegisteredTenant = d): Promise<Item> {
    const c = who === d ? cat : await catalogOf(t, who);
    const piece = c.units['PIECE']!.id;
    const carton = c.units['CARTON']!.id;
    const res = await as(who)
      .post(
        '/products',
        {
          reference: `T-${Date.now()}-${++seq}`,
          designation: `Article ${seq}`,
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
          prices: c.levels
            .slice(0, 3)
            .map((l) => ({ unitId: carton, priceLevelId: l.id, priceHt: '2400' })),
        },
        null,
      )
      .expect(201);
    const id = (res.body as ProductDto).id;
    await as(who)
      .post('/stock/opening', {
        lines: [{ productId: id, unitId: piece, qty: '240', unitCost: '80' }],
      })
      .expect(201);
    return { id, piece, carton };
  }

  const client = async (who: RegisteredTenant = d) =>
    (
      await as(who)
        .post('/clients', { code: `TC${++seq}`, name: `Client ${seq}` }, null)
        .expect(201)
    ).body as ClientDto;

  const stockOf = async (productId: string) =>
    ((await as(d).get(`/stock/${productId}`).expect(200)).body as StockLevelDto).qtyBase;
  const balanceOf = async (clientId: string) =>
    ((await as(d).get(`/clients/${clientId}`).expect(200)).body as ClientDto).balance;

  /** A confirmed order of `cartons` cartons for `clientId`, taken by `by`. */
  const confirmedOrder = async (by: Who, clientId: string, p: Item, cartons = '3') => {
    const draft = (
      await as(by)
        .post('/orders', { clientId, lines: [{ productId: p.id, unitId: p.carton, qty: cartons }] })
        .expect(201)
    ).body as OrderDto;
    return (await as(by).post(`/orders/${draft.id}/confirm`).expect(200)).body as OrderDto;
  };

  beforeAll(async () => {
    t = await createTestApp();
    d = await registerTenant(t, 'Distrib Tournées', { activity: Activity.DISTRIBUTEUR });
    other = await registerTenant(t, 'Autre Distrib', { activity: Activity.DISTRIBUTEUR });
    await withoutGeoCheck(t, d);
    await withoutGeoCheck(t, other);
    essentiel = await registerTenant(t, 'Grossiste Simple');
    cat = await catalogOf(t, d);
    sellerA = await member(d, 'SELLER');
    sellerB = await member(d, 'SELLER');
    livreur = await member(d, 'LIVREUR');
    livreur2 = await member(d, 'LIVREUR');
  });
  afterAll(() => t.close());

  it('is refused without the TOURNEES module', async () => {
    for (const url of ['/routes', '/orders', '/me/today', '/seller-sessions']) {
      const res = await as(essentiel).get(url).expect(403);
      expect(errorOf(res).code).toBe(ErrorCode.FEATURE_NOT_IN_PLAN);
    }
  });

  describe('routes and today', () => {
    it('plans a route, reorders its stops, and gives the seller his tournée of today', async () => {
      const [c1, c2, c3] = [await client(), await client(), await client()];
      const route = (
        await as(d)
          .post(
            '/routes',
            { name: 'Est', sellerId: sellerA.id, weekdays: [0, 1, 2, 3, 4, 5, 6] },
            null,
          )
          .expect(201)
      ).body as RouteDto;
      await as(d)
        .put(`/routes/${route.id}/stops`, { clientIds: [c1.id, c2.id, c3.id] })
        .expect(200);
      const reordered = (
        await as(d)
          .put(`/routes/${route.id}/stops`, { clientIds: [c3.id, c1.id] })
          .expect(200)
      ).body as RouteDto;
      expect(reordered.stops.map((s) => s.client.id)).toEqual([c3.id, c1.id]);

      // A route of another weekday set does not show today.
      const off = (weekdayOf(today()) + 3) % 7;
      const hidden = (
        await as(d)
          .post('/routes', { name: 'Off', sellerId: sellerA.id, weekdays: [off] }, null)
          .expect(201)
      ).body as RouteDto;
      await as(d)
        .put(`/routes/${hidden.id}/stops`, { clientIds: [c2.id] })
        .expect(200);

      const day = (await as(sellerA).get('/me/today').expect(200)).body as TodayDto;
      expect(day.day).toBe(today());
      const mine = day.stops.filter((s) => [c1.id, c2.id, c3.id].includes(s.client.id));
      expect(mine.map((s) => s.client.id)).toEqual([c3.id, c1.id]);
      expect(mine[0]).toMatchObject({ balance: '0.00', lastVisit: null, visitedToday: false });

      // Seller B neither sees nor edits seller A's route.
      await as(sellerB).get(`/routes/${route.id}`).expect(404);
      await as(sellerB).put(`/routes/${route.id}/stops`, { clientIds: [] }).expect(403);
      // Another tenant does not see it.
      await as(other).get(`/routes/${route.id}`).expect(404);
    });

    it('refuses a client of another tenant on a route', async () => {
      const foreign = await client(other);
      const route = (
        await as(d)
          .post('/routes', { name: 'X', sellerId: sellerA.id, weekdays: [1] }, null)
          .expect(201)
      ).body as RouteDto;
      await as(d)
        .put(`/routes/${route.id}/stops`, { clientIds: [foreign.id] })
        .expect(400);
    });
  });

  describe('visits', () => {
    it('records a visit once per key, corrects it with a new row, never twice', async () => {
      const c = await client();
      const key = randomUUID();
      const body = {
        clientId: c.id,
        startedAt: new Date().toISOString(),
        outcome: 'NO_SALE',
        reason: 'CLOSED',
      };
      const first = (await as(sellerA).post('/visits', body, key).expect(201)).body as VisitDto;
      const replay = (await as(sellerA).post('/visits', body, key).expect(201)).body as VisitDto;
      expect(replay.id).toBe(first.id);
      const count = () =>
        asTenant(d.tenantId, () => t.prisma.db.visit.count({ where: { clientId: c.id } }));
      expect(await count()).toBe(1);

      const fix = (
        await as(sellerA)
          .post('/visits', { ...body, reason: 'HAS_STOCK', correctsVisitId: first.id })
          .expect(201)
      ).body as VisitDto;
      expect(fix.correctsVisitId).toBe(first.id);
      const again = await as(sellerA)
        .post('/visits', { ...body, reason: 'REFUSED', correctsVisitId: first.id })
        .expect(422);
      expect(errorOf(again).code).toBe(ErrorCode.VISIT_INVALID);

      const page = (await as(sellerA).get(`/visits?clientId=${c.id}`).expect(200))
        .body as VisitPage;
      expect(page.items.find((v) => v.id === first.id)?.corrected).toBe(true);
      // Another seller does not see them; the row is never updated in place.
      await as(sellerB).get(`/visits/${first.id}`).expect(404);
      await expect(
        asTenant(d.tenantId, () =>
          t.prisma.db.visit.update({ where: { id: first.id }, data: { note: 'x' } }),
        ),
      ).rejects.toThrow();
    });

    it('a productive visit needs its document, of this client', async () => {
      const [c, c2] = [await client(), await client()];
      const res = await as(sellerA)
        .post('/visits', { clientId: c.id, startedAt: new Date().toISOString(), outcome: 'SALE' })
        .expect(400);
      expect(errorOf(res).code).toBe(ErrorCode.VALIDATION_FAILED);
      const p = await product();
      const order = await confirmedOrder(sellerA, c2.id, p, '1');
      const wrong = await as(sellerA)
        .post('/visits', {
          clientId: c.id,
          startedAt: new Date().toISOString(),
          outcome: 'ORDER',
          orderId: order.id,
        })
        .expect(422);
      expect(errorOf(wrong).code).toBe(ErrorCode.VISIT_INVALID);
    });
  });

  // REPORT-35, A-1: the owner decides which clients a livreur sees.
  describe('livreurScope', () => {
    const settings = (who: Parameters<typeof as>[0], livreurScope: string) =>
      as(who).patch('/tenant/settings', { livreurScope });
    const statusOf = async (path: string) => (await as(driver).get(path)).status;

    // His own livreur: the tests below count the commandes of the two others.
    let driver: Member;
    beforeAll(async () => {
      driver = await member(d, 'LIVREUR');
    });
    afterAll(async () => {
      await settings(d, 'ALL_CLIENTS').expect(200);
    });

    it('ALL_CLIENTS (default): a livreur sees every client, as since phase 14', async () => {
      const c = await client();
      expect(await statusOf(`/clients/${c.id}`)).toBe(200);
    });

    it('OWN_DELIVERIES: only the clients of the commandes given to him, everywhere', async () => {
      const [mine, other, p] = [await client(), await client(), await product()];
      const order = await confirmedOrder(d, mine.id, p, '1');
      await as(d).patch(`/orders/${order.id}/livreur`, { livreurId: driver.id }).expect(200);
      await settings(d, 'OWN_DELIVERIES').expect(200);

      expect(await statusOf(`/clients/${mine.id}`)).toBe(200);
      expect(await statusOf(`/clients/${other.id}`)).toBe(404);
      const list = (await as(driver).get('/clients?limit=100').expect(200)).body as {
        items: { id: string }[];
      };
      const ids = list.items.map((c) => c.id);
      expect(ids).toContain(mine.id);
      expect(ids).not.toContain(other.id);
      // Every client he sees has a commande of his: none slips in by another road.
      const mineOnly = await asTenant(d.tenantId, () =>
        t.prisma.db.order.findMany({
          where: { livreurId: driver.id },
          select: { clientId: true },
        }),
      );
      expect(new Set(ids)).toEqual(new Set(mineOnly.map((o) => o.clientId)));
      // The map and "Clients proches" follow the same scope (raw SQL path).
      const map = (await as(driver).get('/clients/map').expect(200)).body as {
        points: { id: string }[];
        withoutLocation: number;
      };
      expect(map.points.map((x) => x.id).filter((id) => !ids.includes(id))).toEqual([]);
      expect(map.withoutLocation).toBeLessThanOrEqual(ids.length);
      // The owner still sees both; another livreur sees neither of the two.
      expect((await as(d).get(`/clients/${other.id}`)).status).toBe(200);
      expect((await as(livreur).get(`/clients/${mine.id}`)).status).toBe(404);
    });

    it("is the owner's decision: a manager cannot change it", async () => {
      const manager = await member(d, 'MANAGER');
      const res = await settings(manager, 'ALL_CLIENTS');
      expect(res.status).toBe(403);
      expect(await statusOf('/clients?limit=1')).toBe(200);
    });
  });

  describe('bons de commande', () => {
    it('confirmation freezes the price; an order moves neither stock nor the account', async () => {
      const [c, p] = [await client(), await product()];
      const order = await confirmedOrder(sellerA, c.id, p, '3');
      expect(order.number).toMatch(/^BC-\d{4}-\d{6}$/);
      expect(order.lines[0]).toMatchObject({ unitPriceHt: '2400.00', qty: '3.000' });
      expect(await stockOf(p.id)).toBe('240.000');
      expect(await balanceOf(c.id)).toBe('0.00');

      // The list price changes after confirmation: the BL keeps the order's price.
      await tamper(t)`UPDATE product_prices SET "priceHt" = 3000 WHERE "productId" = ${p.id}::uuid`;
      await as(d).patch(`/orders/${order.id}/livreur`, { livreurId: livreur.id }).expect(200);
      const res = (
        await as(livreur)
          .post(`/orders/${order.id}/deliver`, {
            lines: [{ orderLineId: order.lines[0]!.id, qty: '3' }],
          })
          .expect(200)
      ).body as DeliverOrderResultDto;
      const sale = (await as(d).get(`/sales/${res.sale.id}`).expect(200)).body as SaleDto;
      expect(sale.lines[0]!.unitPriceHt).toBe('2400.00');
      expect(sale.number).toMatch(/^BL-/);
      // 3 cartons × 2 400 × 1.19 = 8 568.00, all on credit; the seller is the order's.
      expect(sale.totalTtc).toBe('8568.00');
      expect(sale.seller?.id).toBe(sellerA.id);
      expect(await stockOf(p.id)).toBe('168.000');
      expect(await balanceOf(c.id)).toBe('8568.00');
    });

    it('deliver creates exactly one BL; a replay returns it and creates nothing', async () => {
      const [c, p] = [await client(), await product()];
      const order = await confirmedOrder(d, c.id, p, '2');
      const key = randomUUID();
      const body = { lines: [{ orderLineId: order.lines[0]!.id, qty: '2' }] };
      const first = (await as(d).post(`/orders/${order.id}/deliver`, body, key).expect(200))
        .body as DeliverOrderResultDto;
      const replay = (await as(d).post(`/orders/${order.id}/deliver`, body, key).expect(200))
        .body as DeliverOrderResultDto;
      expect(replay.sale.id).toBe(first.sale.id);
      const sales = await asTenant(d.tenantId, () =>
        t.prisma.db.sale.count({ where: { note: order.number } }),
      );
      expect(sales).toBe(1);
      expect(await stockOf(p.id)).toBe('192.000');
      // Another key on a delivered order is refused.
      const again = await as(d).post(`/orders/${order.id}/deliver`, body).expect(409);
      expect(errorOf(again).code).toBe(ErrorCode.ORDER_ALREADY_DELIVERED);
    });

    it('a partial delivery keeps what was not delivered on the order', async () => {
      const [c, p] = [await client(), await product()];
      const order = await confirmedOrder(d, c.id, p, '3');
      const res = (
        await as(d)
          .post(`/orders/${order.id}/deliver`, {
            lines: [{ orderLineId: order.lines[0]!.id, qty: '2' }],
          })
          .expect(200)
      ).body as DeliverOrderResultDto;
      expect(res.order.status).toBe('DELIVERED');
      expect(res.order.lines[0]).toMatchObject({ qtyDelivered: '2.000', qtyNotDelivered: '1.000' });
      expect(await stockOf(p.id)).toBe('192.000');
      // More than ordered, or nothing, is refused.
      const o2 = await confirmedOrder(d, c.id, p, '1');
      const over = await as(d)
        .post(`/orders/${o2.id}/deliver`, { lines: [{ orderLineId: o2.lines[0]!.id, qty: '2' }] })
        .expect(422);
      expect(errorOf(over).code).toBe(ErrorCode.ORDER_DELIVERY_QTY_INVALID);
      await as(d)
        .post(`/orders/${o2.id}/deliver`, { lines: [{ orderLineId: o2.lines[0]!.id, qty: '0' }] })
        .expect(422);
    });

    it('two concurrent delivers of the same order give one BL', async () => {
      const [c, p] = [await client(), await product()];
      const order = await confirmedOrder(d, c.id, p, '1');
      const body = { lines: [{ orderLineId: order.lines[0]!.id, qty: '1' }] };
      const results = await Promise.all([
        as(d).post(`/orders/${order.id}/deliver`, body),
        as(d).post(`/orders/${order.id}/deliver`, body),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      const sales = await asTenant(d.tenantId, () =>
        t.prisma.db.sale.count({ where: { note: order.number } }),
      );
      expect(sales).toBe(1);
      expect(await stockOf(p.id)).toBe('216.000');
      expect(await balanceOf(c.id)).toBe('2856.00');
    });

    it('a livreur sees and delivers only his orders; the cash he takes is his', async () => {
      const [c, p] = [await client(), await product()];
      const mine = await confirmedOrder(d, c.id, p, '1');
      const notMine = await confirmedOrder(d, c.id, p, '1');
      await as(d).patch(`/orders/${mine.id}/livreur`, { livreurId: livreur2.id }).expect(200);
      const list = (await as(livreur2).get('/orders').expect(200)).body as OrderPage;
      expect(list.items.map((o) => o.id)).toEqual([mine.id]);
      await as(livreur2).get(`/orders/${notMine.id}`).expect(404);
      await as(livreur2)
        .post(`/orders/${notMine.id}/deliver`, {
          lines: [{ orderLineId: notMine.lines[0]!.id, qty: '1' }],
        })
        .expect(404);
      const res = (
        await as(livreur2)
          .post(`/orders/${mine.id}/deliver`, {
            lines: [{ orderLineId: mine.lines[0]!.id, qty: '1' }],
            paidAmount: '2856',
          })
          .expect(200)
      ).body as DeliverOrderResultDto;
      const payment = await asTenant(d.tenantId, () =>
        t.prisma.db.payment.findFirstOrThrow({ where: { saleId: res.sale.id } }),
      );
      expect(payment.collectedBy).toBe(livreur2.id);
      expect(await balanceOf(c.id)).toBe('0.00');
      // A seller does not see another seller's order; another tenant neither.
      await as(sellerB).get(`/orders/${mine.id}`).expect(404);
      await as(other).get(`/orders/${mine.id}`).expect(404);
    });

    it('prints a confirmed bon de commande, never a draft', async () => {
      const [c, p] = [await client(), await product()];
      const draft = (
        await as(d)
          .post('/orders', {
            clientId: c.id,
            lines: [{ productId: p.id, unitId: p.carton, qty: '1' }],
          })
          .expect(201)
      ).body as OrderDto;
      await as(d).get(`/documents/BC/${draft.id}/pdf`).expect(409);
      await as(d).post(`/orders/${draft.id}/confirm`).expect(200);
      const pdf = await as(d).get(`/documents/BC/${draft.id}/pdf?format=A5`).expect(200);
      expect(pdf.headers['content-type']).toContain('application/pdf');
      await as(other).get(`/documents/BC/${draft.id}/pdf`).expect(404);
    });

    it('a cancelled order cannot be delivered, and a delivered one cannot be cancelled', async () => {
      const [c, p] = [await client(), await product()];
      const o = await confirmedOrder(d, c.id, p, '1');
      await as(d).post(`/orders/${o.id}/cancel`, { reason: 'Client a annulé' }).expect(200);
      const res = await as(d)
        .post(`/orders/${o.id}/deliver`, { lines: [{ orderLineId: o.lines[0]!.id, qty: '1' }] })
        .expect(409);
      expect(errorOf(res).code).toBe(ErrorCode.ORDER_NOT_CONFIRMED);
      const o2 = await confirmedOrder(d, c.id, p, '1');
      await as(d)
        .post(`/orders/${o2.id}/deliver`, { lines: [{ orderLineId: o2.lines[0]!.id, qty: '1' }] })
        .expect(200);
      const cancel = await as(d)
        .post(`/orders/${o2.id}/cancel`, { reason: 'Trop tard' })
        .expect(409);
      expect(errorOf(cancel).code).toBe(ErrorCode.ORDER_ALREADY_DELIVERED);
    });
  });

  describe('a supervisor assigns only his team (phase 39 follow-up)', () => {
    let supA: Member;
    let supB: Member;
    let sellerOfA: Member;
    let livreurOfA: Member;
    let livreurOfB: Member;
    let foreignLivreur: Member;

    const livreurIdOf = async (orderId: string) =>
      asTenant(d.tenantId, () =>
        t.prisma.db.order.findUniqueOrThrow({
          where: { id: orderId },
          select: { livreurId: true, deliveryVehicleId: true, version: true },
        }),
      );

    beforeAll(async () => {
      supA = await member(d, 'SUPERVISOR');
      supB = await member(d, 'SUPERVISOR');
      sellerOfA = await member(d, 'SELLER', supA.id);
      livreurOfA = await member(d, 'LIVREUR', supA.id);
      livreurOfB = await member(d, 'LIVREUR', supB.id);
      foreignLivreur = await member(other, 'LIVREUR');
    });

    it('GET /orders/deliverers: a supervisor gets his team, the owner everyone', async () => {
      const ids = async (who: Who) =>
        ((await as(who).get('/orders/deliverers').expect(200)).body as DelivererDto[]).map(
          (u) => u.id,
        );
      expect((await ids(supA)).sort()).toEqual([sellerOfA.id, livreurOfA.id].sort());
      expect(await ids(supB)).toEqual([livreurOfB.id]);
      const all = await ids(d);
      for (const m of [sellerOfA, livreurOfA, livreurOfB, livreur, sellerA]) {
        expect(all).toContain(m.id);
      }
      expect(all).not.toContain(foreignLivreur.id);
    });

    it("PATCH /orders/:id/livreur: B's livreur is refused and nothing changes", async () => {
      const [c, p] = [await client(), await product()];
      const order = await confirmedOrder(sellerOfA, c.id, p, '1');
      const before = await livreurIdOf(order.id);

      const res = await as(supA)
        .patch(`/orders/${order.id}/livreur`, { livreurId: livreurOfB.id })
        .expect(403);
      expect(errorOf(res).code).toBe(ErrorCode.FORBIDDEN);
      expect(errorOf(res).details).toMatchObject({ field: 'livreurId' });
      expect(await livreurIdOf(order.id)).toEqual(before);

      // His own livreur is fine, and so is clearing it.
      await as(supA).patch(`/orders/${order.id}/livreur`, { livreurId: livreurOfA.id }).expect(200);
      expect((await livreurIdOf(order.id)).livreurId).toBe(livreurOfA.id);
      await as(supA).patch(`/orders/${order.id}/livreur`, { livreurId: null }).expect(200);

      // B cannot even see A's order (out of reach answers not found).
      await as(supB).patch(`/orders/${order.id}/livreur`, { livreurId: livreurOfB.id }).expect(404);

      // The owner names anyone.
      await as(d).patch(`/orders/${order.id}/livreur`, { livreurId: livreurOfB.id }).expect(200);
      expect((await livreurIdOf(order.id)).livreurId).toBe(livreurOfB.id);
    });

    it('a delivery truck in his reach stays allowed', async () => {
      const [c, p] = [await client(), await product()];
      const order = await confirmedOrder(sellerOfA, c.id, p, '1');
      const truck = (
        await as(d)
          .post('/warehouses', { name: `Camion ${++seq}`, type: 'VEHICLE' }, null)
          .expect(201)
      ).body as WarehouseDto;
      await as(supA)
        .patch(`/orders/${order.id}/livreur`, { deliveryVehicleId: truck.id })
        .expect(200);
      expect((await livreurIdOf(order.id)).deliveryVehicleId).toBe(truck.id);
    });

    it("another tenant's livreur cannot be named, and its users see none of ours", async () => {
      const [c, p] = [await client(), await product()];
      const order = await confirmedOrder(sellerOfA, c.id, p, '1');
      const before = await livreurIdOf(order.id);
      for (const who of [d, supA]) {
        const res = await as(who)
          .patch(`/orders/${order.id}/livreur`, { livreurId: foreignLivreur.id })
          .expect(422);
        expect(errorOf(res).code).toBe(ErrorCode.SELLER_NOT_ALLOWED);
      }
      expect(await livreurIdOf(order.id)).toEqual(before);
      const theirs = (await as(other).get('/orders/deliverers').expect(200)).body as DelivererDto[];
      expect(theirs.map((u) => u.id)).not.toContain(livreurOfA.id);
      await as(other).patch(`/orders/${order.id}/livreur`, { livreurId: null }).expect(404);
    });
  });

  describe('clôture de tournée', () => {
    it('expected cash counts only cash, only this seller, only this Algiers day', async () => {
      const seller = await member(d, 'SELLER');
      const [c, p] = [await client(), await product()];
      // Cash sale by the seller: 1 carton = 2 856.00 TTC, paid in full.
      const sale = (
        await as(seller)
          .post('/sales/quick', {
            documentDate: today(),
            clientId: c.id,
            lines: [{ productId: p.id, unitId: p.carton, qty: '1' }],
            paidAmount: '2856',
          })
          .expect(201)
      ).body as SaleResultDto;
      // Cash versement 500, cheque 300 (not cash).
      await as(seller).post('/payments', { clientId: c.id, amount: '500' }).expect(201);
      await as(seller)
        .post('/payments', { clientId: c.id, amount: '300', mode: 'CHEQUE', reference: 'CHQ1' })
        .expect(201);
      // A sale cancelled the same day drops out.
      const cancelled = (
        await as(seller)
          .post('/sales/quick', {
            documentDate: today(),
            clientId: c.id,
            lines: [{ productId: p.id, unitId: p.carton, qty: '1' }],
            paidAmount: '2856',
          })
          .expect(201)
      ).body as SaleResultDto;
      await as(d)
        .post(`/sales/${cancelled.sale.id}/cancel`, { reason: 'Erreur saisie' })
        .expect(200);
      // Another seller's cash is not his.
      await as(sellerB).post('/payments', { clientId: c.id, amount: '700' }).expect(201);
      // Day boundaries: 22:59 UTC the day before is yesterday in Algiers, 23:01 is today.
      const v1 = (await as(seller).post('/payments', { clientId: c.id, amount: '40' }).expect(201))
        .body as {
        id: string;
      };
      const v2 = (await as(seller).post('/payments', { clientId: c.id, amount: '60' }).expect(201))
        .body as {
        id: string;
      };
      const midnight = new Date(`${today()}T00:00:00.000Z`).getTime() - 3600_000;
      await tamper(
        t,
      )`UPDATE payments SET "receivedAt" = ${new Date(midnight - 60_000)} WHERE id = ${v1.id}::uuid`;
      await tamper(
        t,
      )`UPDATE payments SET "receivedAt" = ${new Date(midnight + 60_000)} WHERE id = ${v2.id}::uuid`;

      const days = (await as(d).get(`/seller-sessions?date=${today()}`).expect(200))
        .body as SellerDayDto[];
      const mine = days.find((x) => x.seller.id === seller.id)!;
      expect(mine.expected).toEqual({
        fromSales: '2856.00',
        fromVersements: '560.00',
        total: '3416.00',
      });
      expect(sale.sale.id).toBeDefined();

      const session = (
        await as(d).post('/seller-sessions', { sellerId: seller.id, date: today() }).expect(201)
      ).body as SellerSessionDto;
      const reopened = (
        await as(d).post('/seller-sessions', { sellerId: seller.id, date: today() }).expect(201)
      ).body as SellerSessionDto;
      expect(reopened.id).toBe(session.id);

      const key = randomUUID();
      const closed = (
        await as(d)
          .post(`/seller-sessions/${session.id}/close`, { handedCash: '3316' }, key)
          .expect(200)
      ).body as SellerSessionCloseResultDto;
      expect(closed.session).toMatchObject({
        status: 'CLOSED',
        handedCash: '3316.00',
        ecart: '-100.00',
      });
      expect(closed.session.expected.total).toBe('3416.00');
      // Same key: same answer; another key: refused. The closed figures never move.
      await as(d)
        .post(`/seller-sessions/${session.id}/close`, { handedCash: '3316' }, key)
        .expect(200);
      const again = await as(d)
        .post(`/seller-sessions/${session.id}/close`, { handedCash: '3416' })
        .expect(409);
      expect(errorOf(again).code).toBe(ErrorCode.SESSION_ALREADY_CLOSED);
      await as(seller).post('/payments', { clientId: c.id, amount: '1000' }).expect(201);
      const after = (await as(d).get(`/seller-sessions/${session.id}`).expect(200))
        .body as SellerSessionDto;
      expect(after.expected.total).toBe('3416.00');

      // A correction is a new row; the session stays as it was closed.
      const adjusted = (
        await as(d)
          .post(`/seller-sessions/${session.id}/adjust`, {
            handedCash: '3416',
            note: 'Billet retrouvé',
          })
          .expect(201)
      ).body as SellerSessionDto;
      expect(adjusted.ecart).toBe('-100.00');
      expect(adjusted.adjustments).toHaveLength(1);
      expect(adjusted.adjustments[0]).toMatchObject({ ecart: '0.00', note: 'Billet retrouvé' });

      // Only planners close; another tenant does not see the session.
      await as(seller)
        .post(`/seller-sessions/${session.id}/close`, { handedCash: '0' })
        .expect(403);
      await as(other).get(`/seller-sessions/${session.id}`).expect(404);
    });

    it('closing a seller with a truck returns what is left on it', async () => {
      const seller = await member(d, 'SELLER');
      const p = await product();
      const truck = (
        await as(d)
          .post(
            '/warehouses',
            { name: `Camion ${++seq}`, type: 'VEHICLE', assignedUserId: seller.id },
            null,
          )
          .expect(201)
      ).body as { id: string };
      const main = (
        (await as(d).get('/warehouses').expect(200)).body as { id: string; isDefault: boolean }[]
      ).find((w) => w.isDefault)!;
      const tr = (
        await as(d)
          .post('/stock-transfers', {
            type: 'LOAD',
            fromWarehouseId: main.id,
            toWarehouseId: truck.id,
            lines: [{ productId: p.id, unitId: p.carton, qty: '2' }],
          })
          .expect(201)
      ).body as { id: string };
      await as(d).post(`/stock-transfers/${tr.id}/validate`).expect(200);
      const s = (await as(d).post('/seller-sessions', { sellerId: seller.id }).expect(201))
        .body as SellerSessionDto;
      expect(s.warehouse?.id).toBe(truck.id);
      const closed = (
        await as(d).post(`/seller-sessions/${s.id}/close`, { handedCash: '0' }).expect(200)
      ).body as SellerSessionCloseResultDto;
      expect(closed.vehicleStock).toEqual([
        expect.objectContaining({ productId: p.id, qtyBase: '48.000' }),
      ]);
    });
  });

  it('reports visit rate, strike rate and orders delivered per seller', async () => {
    const seller = await member(d, 'SELLER');
    const [c1, c2, p] = [await client(), await client(), await product()];
    const route = (
      await as(d)
        .post('/routes', { name: 'R', sellerId: seller.id, weekdays: [0, 1, 2, 3, 4, 5, 6] }, null)
        .expect(201)
    ).body as RouteDto;
    await as(d)
      .put(`/routes/${route.id}/stops`, { clientIds: [c1.id, c2.id] })
      .expect(200);
    const order = await confirmedOrder(seller, c1.id, p, '2');
    // Today's screen offers that order to link the visit to.
    const day = (await as(seller).get('/me/today').expect(200)).body as TodayDto;
    expect(day.stops.find((s) => s.client.id === c1.id)?.today).toEqual({
      saleId: null,
      orderId: order.id,
      paymentId: null,
    });
    const now = new Date().toISOString();
    await as(seller)
      .post('/visits', {
        clientId: c1.id,
        routeId: route.id,
        startedAt: now,
        outcome: 'ORDER',
        orderId: order.id,
      })
      .expect(201);
    await as(d)
      .post(`/orders/${order.id}/deliver`, {
        lines: [{ orderLineId: order.lines[0]!.id, qty: '1' }],
      })
      .expect(200);
    const report = (
      await as(d)
        .get(`/tournees/reports?from=${today()}&to=${today()}&sellerId=${seller.id}`)
        .expect(200)
    ).body as TourneeReportDto;
    expect(report.rows).toHaveLength(1);
    expect(report.rows[0]).toMatchObject({
      plannedStops: 2,
      visitedStops: 1,
      visitRate: 0.5,
      visits: 1,
      productiveVisits: 1,
      strikeRate: 1,
      orders: 1,
      delivered: 1,
      shortLines: 1,
    });
    // A seller's report is his own, whatever filter he sends.
    const theirs = (
      await as(sellerB)
        .get(`/tournees/reports?from=${today()}&to=${today()}&sellerId=${seller.id}`)
        .expect(200)
    ).body as TourneeReportDto;
    expect(theirs.rows).toEqual([]);
  });
});
