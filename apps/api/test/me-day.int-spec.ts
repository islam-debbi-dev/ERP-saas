import { randomUUID } from 'node:crypto';
import * as argon2 from 'argon2';
import {
  Activity,
  algiersDay,
  type ApiError,
  type AuthResponse,
  type ClientDto,
  ErrorCode,
  type MeDayDto,
  type ProductDto,
  type Role,
  type SellerSessionDto,
  type WarehouseDto,
} from '@erp/shared';
import {
  asTenant,
  bearer,
  catalogOf,
  createTestApp,
  grantAllWarehouses,
  type RegisteredTenant,
  registerTenant,
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

/** Every key of a JSON value, nested objects and arrays included. */
function keysOf(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const v of value) keysOf(v, out);
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      out.push(k);
      keysOf(v, out);
    }
  }
  return out;
}

/**
 * Phase 39, A2: `GET /me/day` gives a road user his own day (truck, session, expected
 * cash, truck stock, today's validated chargements / déchargements) without the planner
 * routes or STOCK_TRANSFER. Quantities only, never a cost; nobody else's day.
 */
describe('my day on the road (phase 39, A2)', () => {
  let t: TestApp;
  let d: RegisteredTenant;
  let other: RegisteredTenant;
  let essentiel: RegisteredTenant;
  let cat: TenantCatalog;
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
      .set('X-Forwarded-For', `10.39.${Math.floor(seq / 250)}.${(seq % 250) + 1}`)
      .send({ email, password: 'Password123!' })
      .expect(200);
    return { id: user.id, auth: login.body as AuthResponse };
  };

  /** Carton of 24 pièces at 2 400 HT, 480 pièces opened in the main dépôt at 80. */
  async function product(who: RegisteredTenant = d): Promise<Item> {
    const c = who === d ? cat : await catalogOf(t, who);
    const piece = c.units['PIECE']!.id;
    const carton = c.units['CARTON']!.id;
    const res = await as(who)
      .post(
        '/products',
        {
          reference: `MD-${Date.now()}-${++seq}`,
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
        lines: [{ productId: id, unitId: piece, qty: '480', unitCost: '80' }],
      })
      .expect(201);
    return { id, piece, carton };
  }

  const client = async (who: RegisteredTenant = d) =>
    (
      await as(who)
        .post('/clients', { code: `MD${++seq}`, name: `Client ${seq}` }, null)
        .expect(201)
    ).body as ClientDto;

  const truck = async (who: RegisteredTenant = d) =>
    (
      await as(who)
        .post('/warehouses', { name: `Camion ${++seq}`, type: 'VEHICLE' }, null)
        .expect(201)
    ).body as WarehouseDto;

  const drive = (who: RegisteredTenant, vehicleId: string, userId: string) =>
    as(who).post(`/warehouses/${vehicleId}/driver`, { userId }).expect(200);

  const mainOf = async (who: RegisteredTenant) =>
    ((await as(who).get('/warehouses').expect(200)).body as WarehouseDto[]).find(
      (w) => w.isDefault,
    )!;

  /** A LOAD (or UNLOAD) of `cartons` cartons; validated unless `validate` is false. */
  const transfer = async (
    who: RegisteredTenant,
    type: 'LOAD' | 'UNLOAD',
    vehicleId: string,
    p: Item,
    cartons: string,
    validate = true,
  ) => {
    const main = await mainOf(who);
    const tr = (
      await as(who)
        .post('/stock-transfers', {
          type,
          fromWarehouseId: type === 'LOAD' ? main.id : vehicleId,
          toWarehouseId: type === 'LOAD' ? vehicleId : main.id,
          lines: [{ productId: p.id, unitId: p.carton, qty: cartons }],
        })
        .expect(201)
    ).body as { id: string };
    if (validate) await as(who).post(`/stock-transfers/${tr.id}/validate`).expect(200);
    return tr.id;
  };

  const dayOf = async (who: Who) => (await as(who).get('/me/day').expect(200)).body as MeDayDto;

  beforeAll(async () => {
    t = await createTestApp();
    d = await registerTenant(t, 'Distrib Mon Camion', { activity: Activity.DISTRIBUTEUR });
    other = await registerTenant(t, 'Autre Distrib A2', { activity: Activity.DISTRIBUTEUR });
    essentiel = await registerTenant(t, 'Grossiste Sans Tournées');
    await withoutGeoCheck(t, d);
    await withoutGeoCheck(t, other);
    cat = await catalogOf(t, d);
  });
  afterAll(() => t.close());

  it("gives a seller his truck, its stock, today's chargement and his live cash", async () => {
    const seller = await member(d, 'SELLER');
    const v = await truck();
    await drive(d, v.id, seller.id);
    const p = await product();
    const loadId = await transfer(d, 'LOAD', v.id, p, '5');

    const c = await client();
    // A cash van sale of 1 carton (2 400 HT + 19 % = 2 856 TTC), paid 2 000 in cash.
    await as(seller)
      .post('/sales/quick', {
        clientId: c.id,
        documentDate: algiersDay(),
        warehouseId: v.id,
        lines: [{ productId: p.id, unitId: p.carton, qty: '1' }],
        paidAmount: '2000',
        paymentMode: 'ESPECES',
      })
      .expect(201);
    // A cash versement of 500 and a cheque (cheques are not expected cash).
    await as(seller)
      .post('/payments', { clientId: c.id, amount: '500', mode: 'ESPECES' })
      .expect(201);
    await as(seller)
      .post('/payments', {
        clientId: c.id,
        amount: '300',
        mode: 'CHEQUE',
        reference: '123456',
        bank: 'BNA',
        dueDate: algiersDay(),
      })
      .expect(201);

    const day = await dayOf(seller);
    expect(day.day).toBe(algiersDay());
    expect(day.vehicle).toMatchObject({ id: v.id, name: v.name });
    expect(day.session).toBeNull();
    expect(day.expected).toEqual({
      fromSales: '2000.00',
      fromVersements: '500.00',
      total: '2500.00',
    });
    // 5 cartons loaded, 1 sold: 96 pièces left on the truck.
    expect(day.stock).toEqual([
      expect.objectContaining({ productId: p.id, unitId: p.piece, qtyBase: '96.000' }),
    ]);
    expect(day.transfers).toHaveLength(1);
    expect(day.transfers[0]).toMatchObject({
      id: loadId,
      type: 'LOAD',
      to: { id: v.id },
      lines: [
        expect.objectContaining({
          productId: p.id,
          unitId: p.carton,
          qty: '5.000',
          qtyBase: '120.000',
        }),
      ],
    });
    expect(day.transfers[0]!.number).toMatch(/^TR-\d{4}-\d{6}$/);
  });

  it('lists only validated LOAD / UNLOAD of his own truck', async () => {
    const seller = await member(d, 'SELLER');
    const otherSeller = await member(d, 'SELLER');
    const v = await truck();
    const v2 = await truck();
    await drive(d, v.id, seller.id);
    await drive(d, v2.id, otherSeller.id);
    const p = await product();
    const validated = await transfer(d, 'LOAD', v.id, p, '4');
    await transfer(d, 'LOAD', v.id, p, '1', false); // draft: no effect, not listed
    const cancelled = await transfer(d, 'LOAD', v.id, p, '1');
    await as(d)
      .post(`/stock-transfers/${cancelled}/cancel`, { reason: 'Erreur de saisie' })
      .expect(200);
    await transfer(d, 'LOAD', v2.id, p, '2'); // another truck
    const unload = await transfer(d, 'UNLOAD', v.id, p, '1');

    const day = await dayOf(seller);
    expect(day.transfers.map((tr) => tr.id)).toEqual([validated, unload]);
    expect(day.transfers.map((tr) => tr.type)).toEqual(['LOAD', 'UNLOAD']);
    // 4 loaded, 1 unloaded (the cancelled one moved back): 72 pièces.
    expect(day.stock).toEqual([expect.objectContaining({ productId: p.id, qtyBase: '72.000' })]);

    // The other seller sees his own truck only.
    const theirs = await dayOf(otherSeller);
    expect(theirs.vehicle!.id).toBe(v2.id);
    expect(theirs.transfers.every((tr) => tr.to.id === v2.id || tr.from.id === v2.id)).toBe(true);
    expect(theirs.transfers.map((tr) => tr.id)).not.toContain(validated);
  });

  it('carries no cost, CUMP, value, price or margin field', async () => {
    const seller = await member(d, 'SELLER');
    const v = await truck();
    await drive(d, v.id, seller.id);
    const p = await product();
    await transfer(d, 'LOAD', v.id, p, '2');
    const res = await as(seller).get('/me/day').expect(200);
    const forbidden = keysOf(res.body).filter((k) => /cost|cump|value|price|margin/i.test(k));
    expect(forbidden).toEqual([]);
  });

  it('gives a user without a truck an empty day, with his cash still counted', async () => {
    const livreur = await member(d, 'LIVREUR');
    const day = await dayOf(livreur);
    expect(day.vehicle).toBeNull();
    expect(day.stock).toEqual([]);
    expect(day.transfers).toEqual([]);
    expect(day.session).toBeNull();
    expect(day.expected).toEqual({ fromSales: '0.00', fromVersements: '0.00', total: '0.00' });

    const supervisor = await member(d, 'SUPERVISOR');
    expect((await dayOf(supervisor)).vehicle).toBeNull();
  });

  it('shows his session: live while open, frozen once closed', async () => {
    const seller = await member(d, 'SELLER');
    const c = await client();
    await as(seller)
      .post('/payments', { clientId: c.id, amount: '1000', mode: 'ESPECES' })
      .expect(201);
    const session = (await as(d).post('/seller-sessions', { sellerId: seller.id }).expect(201))
      .body as SellerSessionDto;

    let day = await dayOf(seller);
    expect(day.session).toMatchObject({ id: session.id, status: 'OPEN' });
    expect(day.expected.total).toBe('1000.00');

    await as(d).post(`/seller-sessions/${session.id}/close`, { handedCash: '900' }).expect(200);
    day = await dayOf(seller);
    expect(day.session).toMatchObject({ status: 'CLOSED', handedCash: '900.00', ecart: '-100.00' });
    expect(day.expected.total).toBe('1000.00');
  });

  it("never shows another tenant's truck or transfers", async () => {
    const theirSeller = await member(other, 'SELLER');
    const theirTruck = await truck(other);
    await drive(other, theirTruck.id, theirSeller.id);
    const p = await product(other);
    const theirLoad = await transfer(other, 'LOAD', theirTruck.id, p, '1');

    const mine = await member(d, 'SELLER');
    const day = await dayOf(mine);
    expect(day.vehicle).toBeNull();
    expect(day.transfers.map((tr) => tr.id)).not.toContain(theirLoad);

    const theirs = await dayOf(theirSeller);
    expect(theirs.vehicle!.id).toBe(theirTruck.id);
    expect(theirs.transfers.map((tr) => tr.id)).toEqual([theirLoad]);
  });

  it('is refused to office roles and the storekeeper, and without TOURNEES', async () => {
    const res = await as(d).get('/me/day').expect(403);
    expect(errorOf(res).code).toBe(ErrorCode.FORBIDDEN);
    const manager = await member(d, 'MANAGER');
    await as(manager).get('/me/day').expect(403);
    const storekeeper = await member(d, 'STOREKEEPER');
    await as(storekeeper).get('/me/day').expect(403);

    const noTournees = await member(essentiel, 'SELLER');
    const refused = await as(noTournees).get('/me/day').expect(403);
    expect(errorOf(refused).code).toBe(ErrorCode.FEATURE_NOT_IN_PLAN);
  });
});
