import { randomUUID } from 'node:crypto';
import * as argon2 from 'argon2';
import {
  Activity,
  type ApiError,
  type AuthResponse,
  type ClientDto,
  type DeliverOrderResultDto,
  ErrorCode,
  type LatLng,
  type OrderDto,
  type ProductDto,
  type Role,
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
  type TestApp,
  uniqueEmail,
} from './helpers';

const errorOf = (res: { body: unknown }) => res.body as ApiError;
type Who = { auth: { accessToken: string } };
interface Member {
  id: string;
  auth: AuthResponse;
}

/** A shop in Alger centre, a point 1 km north, and Oran. */
const SHOP: LatLng = { lat: 36.7538, lng: 3.0588 };
const NORTH_1KM: LatLng = { lat: 36.7628, lng: 3.0588 };
const ORAN: LatLng = { lat: 35.6971, lng: -0.6308 };

/**
 * Phase 39, A3: GPS on delivery. `POST /orders/:id/deliver` takes the optional `geo` of a
 * van sale, and the BL of the delivery gets the same GeoCheck (field roles only, FLAG /
 * BLOCK per the tenant), inside the delivery's transaction: a refusal saves nothing.
 */
describe('GPS on order delivery (phase 39, A3)', () => {
  let t: TestApp;
  let d: RegisteredTenant;
  let other: RegisteredTenant;
  let livreur: Member;
  let productId = '';
  let carton = '';
  let seq = 0;

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
    patch: (url: string, body: object) =>
      t
        .http()
        .patch(url)
        .set(...bearer(who.auth.accessToken))
        .send(body),
  });

  const member = async (who: RegisteredTenant, role: Role): Promise<Member> => {
    const email = uniqueEmail(role.toLowerCase());
    const user = await asTenant(who.tenantId, async () =>
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
    await grantAllWarehouses(t, user.id);
    const login = await t
      .http()
      .post('/auth/login')
      .send({ email, password: 'Password123!' })
      .expect(200);
    return { id: user.id, auth: login.body as AuthResponse };
  };

  const geo = (p: LatLng, over: Record<string, unknown> = {}) => ({
    ...p,
    accuracyM: 15,
    isMocked: false,
    capturedAt: new Date().toISOString(),
    ...over,
  });

  const client = async (at: LatLng = SHOP) => {
    const c = (
      await as(d)
        .post('/clients', { code: `DG${++seq}`, name: `Client ${seq}` }, null)
        .expect(201)
    ).body as ClientDto;
    await as(d).patch(`/clients/${c.id}/location`, at).expect(200);
    return c;
  };

  /** A confirmed order of 2 cartons put on the livreur. */
  const orderFor = async (clientId: string) => {
    const draft = (
      await as(d)
        .post('/orders', { clientId, lines: [{ productId, unitId: carton, qty: '2' }] })
        .expect(201)
    ).body as OrderDto;
    await as(d).post(`/orders/${draft.id}/confirm`).expect(200);
    return (await as(d).patch(`/orders/${draft.id}/livreur`, { livreurId: livreur.id }).expect(200))
      .body as OrderDto;
  };

  const deliver = (by: Who, order: OrderDto, extra: object = {}, key = randomUUID()) =>
    as(by).post(
      `/orders/${order.id}/deliver`,
      { lines: [{ orderLineId: order.lines[0]!.id, qty: '2' }], ...extra },
      key,
    );

  const checksOf = (refId: string) =>
    asTenant(d.tenantId, () => t.prisma.db.geoCheck.findMany({ where: { refId } }));
  const setMode = (mode: 'FLAG' | 'BLOCK' | 'OFF') =>
    as(d).patch('/tenant/settings', { geoCheckMode: mode }).expect(200);
  const counts = () =>
    asTenant(d.tenantId, async () => ({
      sales: await t.prisma.db.sale.count(),
      checks: await t.prisma.db.geoCheck.count(),
      movements: await t.prisma.db.stockMovement.count(),
    }));

  beforeAll(async () => {
    t = await createTestApp();
    d = await registerTenant(t, 'Distrib Livraison GPS', { activity: Activity.DISTRIBUTEUR });
    other = await registerTenant(t, 'Autre Livraison GPS', { activity: Activity.DISTRIBUTEUR });
    livreur = await member(d, 'LIVREUR');

    const cat = await catalogOf(t, d);
    const piece = cat.units['PIECE']!.id;
    carton = cat.units['CARTON']!.id;
    const res = await as(d)
      .post(
        '/products',
        {
          reference: `DG-${Date.now()}`,
          designation: 'Article livraison',
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
          prices: cat.levels
            .slice(0, 3)
            .map((l) => ({ unitId: carton, priceLevelId: l.id, priceHt: '2400' })),
        },
        null,
      )
      .expect(201);
    productId = (res.body as ProductDto).id;
    await as(d)
      .post('/stock/opening', {
        lines: [{ productId, unitId: piece, qty: '24000', unitCost: '80' }],
      })
      .expect(201);
  });
  afterAll(() => t.close());

  it('at the client: OK, one check on the BL, returned with the delivery', async () => {
    const order = await orderFor((await client()).id);
    const res = (await deliver(livreur, order, { geo: geo(SHOP) }).expect(200))
      .body as DeliverOrderResultDto;
    expect(res.geoCheck).toMatchObject({ status: 'OK', flags: [] });
    const checks = await checksOf(res.sale.id);
    expect(checks).toHaveLength(1);
    expect(checks[0]).toMatchObject({
      refType: 'SALE',
      refNumber: res.sale.number,
      clientId: order.client.id,
      userId: livreur.id,
    });
  });

  it('far in FLAG mode: a note is required, nothing is saved, then the same key makes one BL', async () => {
    const order = await orderFor((await client()).id);
    const key = randomUUID();
    const before = await counts();
    const refused = await deliver(livreur, order, { geo: geo(NORTH_1KM) }, key).expect(409);
    expect(errorOf(refused)).toMatchObject({
      code: ErrorCode.GEO_NOTE_REQUIRED,
      details: { status: 'FAR' },
    });
    expect(await counts()).toEqual(before);
    const still = (await as(livreur).get(`/orders/${order.id}`).expect(200)).body as OrderDto;
    expect(still).toMatchObject({ status: 'CONFIRMED', sale: null });

    const body = { geo: geo(NORTH_1KM, { note: 'Livré à son entrepôt' }) };
    const ok = (await deliver(livreur, order, body, key).expect(200)).body as DeliverOrderResultDto;
    expect(ok.order.status).toBe('DELIVERED');
    expect(ok.geoCheck).toMatchObject({ status: 'FAR' });
    expect(ok.geoCheck!.distanceM).toBeGreaterThan(900);

    // A replay after a timeout returns the same BL and writes no second check.
    const replay = await deliver(livreur, order, body, key).expect(200);
    expect(replay.headers['idempotent-replayed']).toBe('true');
    expect((replay.body as DeliverOrderResultDto).sale.id).toBe(ok.sale.id);
    const checks = await checksOf(ok.sale.id);
    expect(checks).toHaveLength(1);
    expect(checks[0]!.note).toBe('Livré à son entrepôt');
    const after = await counts();
    expect(after.sales).toBe(before.sales + 1);
    expect(after.checks).toBe(before.checks + 1);
  });

  it('without a position: NO_SIGNAL asks for a note, then the note alone is enough', async () => {
    const order = await orderFor((await client()).id);
    const key = randomUUID();
    const refused = await deliver(livreur, order, {}, key).expect(409);
    expect(errorOf(refused)).toMatchObject({
      code: ErrorCode.GEO_NOTE_REQUIRED,
      details: { status: 'NO_SIGNAL' },
    });
    const ok = (
      await deliver(
        livreur,
        order,
        { geo: { isMocked: false, note: 'Pas de réseau' } },
        key,
      ).expect(200)
    ).body as DeliverOrderResultDto;
    expect(ok.geoCheck!.status).toBe('NO_SIGNAL');
  });

  it('BLOCK refuses a far delivery unless the livreur has GEO_OVERRIDE', async () => {
    const order = await orderFor((await client()).id);
    await setMode('BLOCK');
    try {
      const before = await counts();
      const far = await deliver(livreur, order, { geo: geo(ORAN, { note: 'Test' }) }).expect(409);
      expect(errorOf(far).code).toBe(ErrorCode.GEO_TOO_FAR);
      expect(await counts()).toEqual(before);

      await tamper(
        t,
      )`UPDATE users SET "permissionGrants" = ARRAY['GEO_OVERRIDE'] WHERE id = ${livreur.id}::uuid`;
      const forced = (
        await deliver(livreur, order, {
          geo: geo(ORAN, { note: 'Autorisé par le patron' }),
        }).expect(200)
      ).body as DeliverOrderResultDto;
      expect(forced.geoCheck!.status).toBe('FAR');
      expect(forced.order.status).toBe('DELIVERED');
    } finally {
      await tamper(t)`UPDATE users SET "permissionGrants" = '{}' WHERE id = ${livreur.id}::uuid`;
      await setMode('FLAG');
    }
  });

  it('OFF writes nothing, and office staff recording a delivery are not checked', async () => {
    await setMode('OFF');
    try {
      const order = await orderFor((await client()).id);
      const res = (await deliver(livreur, order, { geo: geo(ORAN) }).expect(200))
        .body as DeliverOrderResultDto;
      expect(res.geoCheck).toBeNull();
      expect(await checksOf(res.sale.id)).toHaveLength(0);
    } finally {
      await setMode('FLAG');
    }
    const byOffice = await orderFor((await client()).id);
    const res = (await deliver(d, byOffice).expect(200)).body as DeliverOrderResultDto;
    expect(res.geoCheck).toBeNull();
    expect(await checksOf(res.sale.id)).toHaveLength(0);
  });

  it('keeps tenants apart', async () => {
    const order = await orderFor((await client()).id);
    const res = (
      await deliver(livreur, order, { geo: geo(ORAN, { note: 'Test isolation' }) }).expect(200)
    ).body as DeliverOrderResultDto;
    const id = (await checksOf(res.sale.id))[0]!.id;
    await as(other).get(`/geo-checks/${id}`).expect(404);
    await as(other).post(`/orders/${order.id}/deliver`, { lines: [] }).expect(400);
    await deliver(other, order).expect(404);
    const theirs = await asTenant(other.tenantId, () =>
      t.prisma.db.geoCheck.count({ where: { refId: res.sale.id } }),
    );
    expect(theirs).toBe(0);
  });
});
