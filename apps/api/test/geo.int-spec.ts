import { randomUUID } from 'node:crypto';
import * as argon2 from 'argon2';
import {
  Activity,
  algiersDay,
  type ApiError,
  type AuthResponse,
  type ClientDto,
  type ClientLocationDto,
  ErrorCode,
  type GeoCheckDto,
  type GeoCheckPage,
  type GeoReportDto,
  type LatLng,
  type LocationRequestDto,
  type PaymentDto,
  type ProductDto,
  type Role,
  type SaleDto,
  type SaleResultDto,
  type VisitDto,
} from '@erp/shared';
import {
  asTenant,
  bearer,
  catalogOf,
  createTestApp,
  registerTenant,
  type RegisteredTenant,
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
 * Phase 17: géolocalisation. The API compares the device position with the client's
 * point and writes one GeoCheck per document in the document's transaction. Flag by
 * default (note required), block only when the tenant says so.
 */
describe('géolocalisation (phase 17)', () => {
  let t: TestApp;
  let d: RegisteredTenant;
  let other: RegisteredTenant;
  let essentiel: RegisteredTenant;
  let supervisor: Member;
  let supervisor2: Member;
  let seller: Member;
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

  const client = async (who: RegisteredTenant = d, at?: LatLng) => {
    const c = (
      await as(who)
        .post('/clients', { code: `GEO${++seq}`, name: `Client ${seq}` }, null)
        .expect(201)
    ).body as ClientDto;
    if (at) await as(who).patch(`/clients/${c.id}/location`, at).expect(200);
    return c;
  };

  const quickSale = (by: Who, clientId: string, extra: object = {}, key = randomUUID()) =>
    as(by).post(
      '/sales/quick',
      {
        clientId,
        documentDate: algiersDay(),
        lines: [{ productId, unitId: carton, qty: '1' }],
        ...extra,
      },
      key,
    );

  const checksOf = (refId: string) =>
    asTenant(d.tenantId, () => t.prisma.db.geoCheck.findMany({ where: { refId } }));
  const setMode = (mode: 'FLAG' | 'BLOCK' | 'OFF') =>
    as(d).patch('/tenant/settings', { geoCheckMode: mode }).expect(200);

  beforeAll(async () => {
    t = await createTestApp();
    d = await registerTenant(t, 'Distrib GPS', { activity: Activity.DISTRIBUTEUR });
    other = await registerTenant(t, 'Autre GPS', { activity: Activity.DISTRIBUTEUR });
    essentiel = await registerTenant(t, 'Grossiste sans GPS');
    supervisor = await member(d, 'SUPERVISOR');
    supervisor2 = await member(d, 'SUPERVISOR');
    seller = await member(d, 'SELLER', supervisor.id);

    const cat = await catalogOf(t, d);
    const piece = cat.units['PIECE']!.id;
    carton = cat.units['CARTON']!.id;
    const res = await as(d)
      .post(
        '/products',
        {
          reference: `GEO-${Date.now()}`,
          designation: 'Article GPS',
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

  it('flags by default with a 150 m radius and 200 m accuracy', async () => {
    const s = (await as(d).get('/tenant/settings').expect(200)).body as Record<string, unknown>;
    expect(s).toMatchObject({ geoCheckMode: 'FLAG', geoRadiusM: 150, geoMaxAccuracyM: 200 });
  });

  it('ignores the position without the GEO_CHECK module', async () => {
    const c = await client(essentiel);
    await as(essentiel).get('/geo-checks').expect(403);
    await as(essentiel).patch(`/clients/${c.id}/location`, SHOP).expect(403);
    const n = await asTenant(essentiel.tenantId, () => t.prisma.db.geoCheck.count());
    expect(n).toBe(0);
  });

  describe('sales, versements and visits', () => {
    it('OK at the client: no note, one check', async () => {
      const c = await client(d, SHOP);
      const res = (
        await quickSale(seller, c.id, { geo: geo(NORTH_1KM, { lat: SHOP.lat + 0.0005 }) }).expect(
          201,
        )
      ).body as SaleResultDto;
      expect(res.geoCheck).toMatchObject({
        status: 'OK',
        flags: [],
        offerSaveClientLocation: false,
      });
      expect(res.geoCheck!.distanceM).toBeGreaterThan(50);
      const rows = await checksOf(res.sale.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        refType: 'SALE',
        refNumber: res.sale.number,
        userId: seller.id,
        status: 'OK',
        reviewStatus: 'NONE',
      });
      expect(rows[0]!.clientLat?.toNumber()).toBe(SHOP.lat);
    });

    it('FAR needs a note; without it nothing is saved', async () => {
      const c = await client(d, SHOP);
      const salesBefore = await asTenant(d.tenantId, () => t.prisma.db.sale.count());
      const refused = await quickSale(seller, c.id, { geo: geo(NORTH_1KM) }).expect(409);
      expect(errorOf(refused).code).toBe(ErrorCode.GEO_NOTE_REQUIRED);
      expect(errorOf(refused).details).toMatchObject({ status: 'FAR' });
      expect(await asTenant(d.tenantId, () => t.prisma.db.sale.count())).toBe(salesBefore);
      expect(((await as(d).get(`/clients/${c.id}`).expect(200)).body as ClientDto).balance).toBe(
        '0.00',
      );

      const ok = (
        await quickSale(seller, c.id, {
          geo: geo(NORTH_1KM, { note: 'Livré à son dépôt' }),
        }).expect(201)
      ).body as SaleResultDto;
      expect(ok.geoCheck).toMatchObject({ status: 'FAR' });
      expect(ok.geoCheck!.distanceM).toBeGreaterThan(900);
      expect((await checksOf(ok.sale.id))[0]!.note).toBe('Livré à son dépôt');
    });

    it.each([
      ['MOCKED', geo(SHOP, { isMocked: true })],
      ['LOW_ACCURACY', geo(SHOP, { accuracyM: 500 })],
      ['NO_SIGNAL', undefined],
    ] as const)('%s needs a note', async (status, position) => {
      const c = await client(d, SHOP);
      const refused = await quickSale(seller, c.id, position ? { geo: position } : {}).expect(409);
      expect(errorOf(refused)).toMatchObject({
        code: ErrorCode.GEO_NOTE_REQUIRED,
        details: { status },
      });
      const note = 'GPS du téléphone en panne';
      const body = position ? { geo: { ...position, note } } : { geo: { note } };
      const ok = (await quickSale(seller, c.id, body).expect(201)).body as SaleResultDto;
      expect(ok.geoCheck!.status).toBe(status);
    });

    it('NO_CLIENT_GPS needs no note and offers to save the point', async () => {
      const c = await client(d);
      const res = (await quickSale(seller, c.id, { geo: geo(SHOP) }).expect(201))
        .body as SaleResultDto;
      expect(res.geoCheck).toMatchObject({
        status: 'NO_CLIENT_GPS',
        distanceM: null,
        offerSaveClientLocation: true,
      });
    });

    it('checks a draft at validation, not at creation', async () => {
      const c = await client(d, SHOP);
      const draft = (
        await as(seller)
          .post(
            '/sales',
            {
              type: 'BL',
              clientId: c.id,
              documentDate: algiersDay(),
              lines: [{ productId, unitId: carton, qty: '1' }],
              geo: geo(ORAN),
            },
            null,
          )
          .expect(201)
      ).body as SaleDto;
      expect(await checksOf(draft.id)).toHaveLength(0);
      const res = (
        await as(seller)
          .post(`/sales/${draft.id}/validate`, { geo: geo(SHOP) })
          .expect(200)
      ).body as SaleResultDto;
      expect(res.geoCheck!.status).toBe('OK');
      expect(await checksOf(draft.id)).toHaveLength(1);
    });

    it('does not check office staff or the client comptoir', async () => {
      const c = await client(d, SHOP);
      const owner = (await quickSale(d, c.id, { geo: geo(ORAN) }).expect(201))
        .body as SaleResultDto;
      expect(owner.geoCheck).toBeNull();
      const comptoir = (
        await quickSale(seller, undefined as unknown as string, { paidAmount: '2856' }).expect(201)
      ).body as SaleResultDto;
      expect(comptoir.geoCheck).toBeNull();
      expect(await checksOf(owner.sale.id)).toHaveLength(0);
      expect(await checksOf(comptoir.sale.id)).toHaveLength(0);
    });

    it('checks versements and visits', async () => {
      const c = await client(d, SHOP);
      const p = (
        await as(seller)
          .post('/payments', {
            clientId: c.id,
            amount: '1000',
            geo: geo(NORTH_1KM, { note: 'Payé au marché' }),
          })
          .expect(201)
      ).body as PaymentDto;
      expect(p.geoCheck).toMatchObject({ status: 'FAR' });
      expect((await checksOf(p.id))[0]).toMatchObject({ refType: 'PAYMENT', refNumber: p.number });

      const v = (
        await as(seller)
          .post('/visits', {
            clientId: c.id,
            startedAt: new Date().toISOString(),
            outcome: 'NO_SALE',
            reason: 'CLOSED',
            geo: geo(SHOP),
          })
          .expect(201)
      ).body as VisitDto;
      expect(v.geoCheck).toMatchObject({ status: 'OK' });
      expect((await checksOf(v.id))[0]).toMatchObject({ refType: 'VISIT', refNumber: null });
    });

    it('marks an offline replay LATE_SYNC whatever the status', async () => {
      const c = await client(d, SHOP);
      const old = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
      const res = (
        await quickSale(seller, c.id, { geo: geo(SHOP, { capturedAt: old }) }).expect(201)
      ).body as SaleResultDto;
      expect(res.geoCheck).toMatchObject({ status: 'OK', flags: ['LATE_SYNC'] });
    });

    it('an idempotent replay creates no second check', async () => {
      const c = await client(d, SHOP);
      const key = randomUUID();
      const body = { geo: geo(NORTH_1KM, { note: 'Rencontré en route' }) };
      const first = (await quickSale(seller, c.id, body, key).expect(201)).body as SaleResultDto;
      const again = await quickSale(seller, c.id, body, key).expect(201);
      expect(again.headers['idempotent-replayed']).toBe('true');
      expect((again.body as SaleResultDto).geoCheck).toEqual(first.geoCheck);
      expect(await checksOf(first.sale.id)).toHaveLength(1);
    });

    it('BLOCK refuses FAR and MOCKED unless the user has GEO_OVERRIDE', async () => {
      const c = await client(d, SHOP);
      await setMode('BLOCK');
      try {
        const far = await quickSale(seller, c.id, { geo: geo(ORAN, { note: 'Test' }) }).expect(409);
        expect(errorOf(far).code).toBe(ErrorCode.GEO_TOO_FAR);
        const mocked = await quickSale(seller, c.id, {
          geo: geo(SHOP, { isMocked: true, note: 'Test' }),
        }).expect(409);
        expect(errorOf(mocked).code).toBe(ErrorCode.GEO_MOCKED);
        // Other statuses are still only flagged.
        const low = (
          await quickSale(seller, c.id, {
            geo: geo(SHOP, { accuracyM: 900, note: 'En sous-sol' }),
          }).expect(201)
        ).body as SaleResultDto;
        expect(low.geoCheck!.status).toBe('LOW_ACCURACY');

        await tamper(
          t,
        )`UPDATE users SET "permissionGrants" = ARRAY['GEO_OVERRIDE'] WHERE id = ${seller.id}::uuid`;
        const forced = (
          await quickSale(seller, c.id, {
            geo: geo(ORAN, { note: 'Autorisé par le patron' }),
          }).expect(201)
        ).body as SaleResultDto;
        expect(forced.geoCheck!.status).toBe('FAR');
      } finally {
        await tamper(t)`UPDATE users SET "permissionGrants" = '{}' WHERE id = ${seller.id}::uuid`;
        await setMode('FLAG');
      }
    });

    it('OFF writes nothing', async () => {
      const c = await client(d, SHOP);
      await setMode('OFF');
      try {
        const res = (await quickSale(seller, c.id, { geo: geo(ORAN) }).expect(201))
          .body as SaleResultDto;
        expect(res.geoCheck).toBeNull();
        expect(await checksOf(res.sale.id)).toHaveLength(0);
      } finally {
        await setMode('FLAG');
      }
    });
  });

  describe('client location', () => {
    it('is set once freely; a seller then asks, his supervisor approves, audited', async () => {
      const c = await client(d);
      const first = (
        await as(seller)
          .patch(`/clients/${c.id}/location`, { ...SHOP, accuracyM: 8.4 })
          .expect(200)
      ).body as ClientLocationDto;
      expect(first).toMatchObject({ ...SHOP, accuracyM: 8, setById: seller.id });

      const moved = await as(seller).patch(`/clients/${c.id}/location`, NORTH_1KM).expect(403);
      expect(errorOf(moved).code).toBe(ErrorCode.GEO_CHANGE_NEEDS_APPROVAL);

      const req = (
        await as(seller)
          .post(`/clients/${c.id}/location-requests`, { ...NORTH_1KM, note: 'Il a déménagé' }, null)
          .expect(201)
      ).body as LocationRequestDto;
      expect(req).toMatchObject({ status: 'PENDING', previous: SHOP, canDecide: false });

      // Another team's supervisor neither sees nor decides it.
      const theirs = (await as(supervisor2).get('/location-requests?status=PENDING').expect(200))
        .body as LocationRequestDto[];
      expect(theirs.map((r) => r.id)).not.toContain(req.id);
      await as(supervisor2).post(`/location-requests/${req.id}/approve`, {}, null).expect(403);
      await as(seller).post(`/location-requests/${req.id}/approve`, {}, null).expect(403);

      const mine = (await as(supervisor).get('/location-requests?status=PENDING').expect(200))
        .body as LocationRequestDto[];
      expect(mine.find((r) => r.id === req.id)?.canDecide).toBe(true);
      const approved = (
        await as(supervisor).post(`/location-requests/${req.id}/approve`, {}, null).expect(201)
      ).body as LocationRequestDto;
      expect(approved).toMatchObject({ status: 'APPROVED', decidedBy: { id: supervisor.id } });

      const after = (await as(d).get(`/clients/${c.id}`).expect(200)).body as ClientDto;
      expect(after.location).toMatchObject({ ...NORTH_1KM, setById: seller.id });

      const audit = await asTenant(d.tenantId, () =>
        t.prisma.db.auditLog.findFirst({
          where: { entityId: c.id, action: 'CLIENT_LOCATION_APPROVED' },
        }),
      );
      expect(audit?.before).toMatchObject(SHOP);
      expect(audit?.after).toMatchObject({
        ...NORTH_1KM,
        requestId: req.id,
        approvedBy: supervisor.id,
      });

      const twice = await as(d).post(`/location-requests/${req.id}/approve`, {}, null).expect(409);
      expect(errorOf(twice).code).toBe(ErrorCode.GEO_REQUEST_NOT_PENDING);
    });

    it('a manager rejects with a reason and moves the point directly', async () => {
      const c = await client(d, SHOP);
      const req = (
        await as(seller).post(`/clients/${c.id}/location-requests`, ORAN, null).expect(201)
      ).body as LocationRequestDto;
      const rejected = (
        await as(d)
          .post(`/location-requests/${req.id}/reject`, { reason: 'Point faux' }, null)
          .expect(201)
      ).body as LocationRequestDto;
      expect(rejected).toMatchObject({ status: 'REJECTED', rejectReason: 'Point faux' });
      expect(
        ((await as(d).get(`/clients/${c.id}`).expect(200)).body as ClientDto).location,
      ).toMatchObject(SHOP);

      await as(d).patch(`/clients/${c.id}/location`, NORTH_1KM).expect(200);
      expect(
        ((await as(d).get(`/clients/${c.id}`).expect(200)).body as ClientDto).location,
      ).toMatchObject(NORTH_1KM);
    });
  });

  describe('review and report', () => {
    let flagged: SaleResultDto;

    beforeAll(async () => {
      const c = await client(d, SHOP);
      flagged = (
        await quickSale(seller, c.id, { geo: geo(ORAN, { note: 'Foire de Oran' }) }).expect(201)
      ).body as SaleResultDto;
    });

    it('lists flagged operations to managers and to the seller’s supervisor only', async () => {
      const all = (await as(d).get('/geo-checks').expect(200)).body as GeoCheckPage;
      const item = all.items.find((i) => i.refId === flagged.sale.id);
      expect(item).toMatchObject({
        status: 'FAR',
        note: 'Foire de Oran',
        refNumber: flagged.sale.number,
        user: { id: seller.id },
        client: SHOP,
        lat: ORAN.lat,
        lng: ORAN.lng,
      });
      expect(all.items.every((i) => i.status !== 'OK')).toBe(true);

      const team = (await as(supervisor).get(`/geo-checks?status=FAR`).expect(200))
        .body as GeoCheckPage;
      expect(team.items.map((i) => i.id)).toContain(item!.id);
      const notTeam = (await as(supervisor2).get('/geo-checks').expect(200)).body as GeoCheckPage;
      expect(notTeam.items).toHaveLength(0);
      await as(supervisor2).get(`/geo-checks/${item!.id}`).expect(404);
      await as(seller).get('/geo-checks').expect(403);
    });

    it('a review is a new row; the latest verdict is cached; history is append-only', async () => {
      const id = (await checksOf(flagged.sale.id))[0]!.id;
      await as(supervisor)
        .post(`/geo-checks/${id}/review`, { verdict: 'JUSTIFIED' }, null)
        .expect(403);
      const first = (
        await as(d)
          .post(`/geo-checks/${id}/review`, { verdict: 'JUSTIFIED', note: 'Foire autorisée' }, null)
          .expect(200)
      ).body as GeoCheckDto;
      expect(first).toMatchObject({ reviewStatus: 'JUSTIFIED', reviewNote: 'Foire autorisée' });
      const second = (
        await as(d).post(`/geo-checks/${id}/review`, { verdict: 'NOT_JUSTIFIED' }, null).expect(200)
      ).body as GeoCheckDto;
      expect(second).toMatchObject({ reviewStatus: 'NOT_JUSTIFIED', reviewNote: null });

      const reviews = await asTenant(d.tenantId, () =>
        t.prisma.db.geoCheckReview.findMany({
          where: { geoCheckId: id },
          orderBy: { createdAt: 'asc' },
        }),
      );
      expect(reviews.map((r) => r.verdict)).toEqual(['JUSTIFIED', 'NOT_JUSTIFIED']);
      await expect(
        tamper(t)`UPDATE geo_check_reviews SET note = 'x' WHERE "geoCheckId" = ${id}::uuid`,
      ).rejects.toThrow(/append-only/);
      await expect(
        tamper(t)`DELETE FROM geo_check_reviews WHERE "geoCheckId" = ${id}::uuid`,
      ).rejects.toThrow(/append-only/);
      const audit = await asTenant(d.tenantId, () =>
        t.prisma.db.auditLog.findMany({ where: { entityId: id, action: 'GEO_CHECK_REVIEWED' } }),
      );
      expect(audit).toHaveLength(2);
    });

    it('reports flags per seller for the month', async () => {
      const month = algiersDay().slice(0, 7);
      const r = (await as(d).get(`/geo-checks/report?month=${month}`).expect(200))
        .body as GeoReportDto;
      const row = r.rows.find((x) => x.user.id === seller.id);
      expect(row).toBeDefined();
      expect(row!.total).toBeGreaterThan(row!.flagged);
      expect(row!.far).toBeGreaterThanOrEqual(2);
      expect(row!.mocked).toBeGreaterThanOrEqual(1);
      expect(row!.notJustified).toBe(1);
      const n = await asTenant(d.tenantId, () =>
        t.prisma.db.geoCheck.count({ where: { userId: seller.id } }),
      );
      expect(row!.total).toBe(n);
      await as(d).get('/geo-checks/report?month=2026-13').expect(400);
    });
  });

  it('keeps tenants apart', async () => {
    const c = await client(d, SHOP);
    const sale = (
      await quickSale(seller, c.id, { geo: geo(ORAN, { note: 'Test isolation' }) }).expect(201)
    ).body as SaleResultDto;
    const id = (await checksOf(sale.sale.id))[0]!.id;
    const req = (
      await as(seller).post(`/clients/${c.id}/location-requests`, ORAN, null).expect(201)
    ).body as LocationRequestDto;

    await as(other).get(`/geo-checks/${id}`).expect(404);
    await as(other).post(`/geo-checks/${id}/review`, { verdict: 'JUSTIFIED' }, null).expect(404);
    await as(other).post(`/location-requests/${req.id}/approve`, {}, null).expect(404);
    await as(other).patch(`/clients/${c.id}/location`, ORAN).expect(404);
    const theirs = (await as(other).get('/geo-checks?flaggedOnly=false').expect(200))
      .body as GeoCheckPage;
    expect(theirs.items).toHaveLength(0);
  });
});
