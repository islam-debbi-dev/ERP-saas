import { randomUUID } from 'node:crypto';
import * as argon2 from 'argon2';
import {
  Activity,
  type ApiError,
  type AuthResponse,
  type ClientDto,
  type ClientMapDto,
  type ClientNearbyPointDto,
  type ClientPage,
  ErrorCode,
  type LatLng,
  type Role,
  type RouteDto,
} from '@erp/shared';
import { mapLimits } from '../src/clients/client-map.service';
import {
  asTenant,
  bearer,
  createTestApp,
  grantAllWarehouses,
  type RegisteredTenant,
  registerTenant,
  tamper,
  type TestApp,
  uniqueEmail,
} from './helpers';

type Who = { auth: { accessToken: string } };
interface Member {
  id: string;
  auth: AuthResponse;
}

const ALGER: LatLng = { lat: 36.7538, lng: 3.0588 };
/** Degrees of latitude for a distance in metres (same Earth radius as the API). */
const degLat = (m: number) => m / ((6_371_008.8 * Math.PI) / 180);
const north = (m: number): LatLng => ({ lat: ALGER.lat + degLat(m), lng: ALGER.lng });

/**
 * Phase 35: the client map and "Clients proches". Read only, phase 14 scope, live clients
 * with a point, straight-line distances. Route stops picked on the map go through the
 * existing PUT /routes/:id/stops.
 */
describe('client map (phase 35)', () => {
  let t: TestApp;
  let d: RegisteredTenant;
  let other: RegisteredTenant;
  let essentiel: RegisteredTenant;
  let supervisor: Member;
  let supervisor2: Member;
  let seller: Member;
  let seller2: Member;
  let sectorId = '';
  let seq = 0;
  /** Unique search prefix of this run: the test DB keeps older runs' clients. */
  const tag = `M${randomUUID().slice(0, 6)}`;

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
    delete: (url: string) =>
      t
        .http()
        .delete(url)
        .set(...bearer(who.auth.accessToken)),
    put: (url: string, body: object) =>
      t
        .http()
        .put(url)
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
      .send({ email, password: 'Password123!' })
      .expect(200);
    return { id: user.id, auth: login.body as AuthResponse };
  };

  /** A client of this run; `at` saves its point straight in the table (phase 17 flow tested there). */
  const client = async (
    opts: {
      who?: RegisteredTenant;
      at?: LatLng;
      sellerId?: string;
      sectorId?: string;
      creditLimit?: string;
      debt?: string;
      active?: boolean;
    } = {},
  ) => {
    const who = opts.who ?? d;
    const c = (
      await as(who)
        .post(
          '/clients',
          {
            code: `${tag}${++seq}`,
            name: `${tag} Client ${String(seq).padStart(3, '0')}`,
            ...(opts.sellerId ? { assignedSellerId: opts.sellerId } : {}),
            ...(opts.sectorId ? { sectorId: opts.sectorId } : {}),
            ...(opts.creditLimit ? { creditLimit: opts.creditLimit } : {}),
            ...(opts.active === false ? { active: false } : {}),
          },
          null,
        )
        .expect(201)
    ).body as ClientDto;
    if (opts.at) {
      await tamper(t)`UPDATE clients SET lat = ${opts.at.lat}, lng = ${opts.at.lng}
        WHERE id = ${c.id}::uuid`;
    }
    if (opts.debt) {
      await as(who).post(`/clients/${c.id}/opening-balance`, { amount: opts.debt }).expect(201);
    }
    return c;
  };

  const map = async (who: Who, qs = '') =>
    (await as(who).get(`/clients/map?search=${tag}${qs}`).expect(200)).body as ClientMapDto;
  const ids = (points: { id: string }[]) => points.map((p) => p.id).sort();
  const nearby = async (who: Who, at: LatLng, qs = '') =>
    (
      await as(who)
        .get(`/clients/nearby?search=${tag}&lat=${at.lat}&lng=${at.lng}${qs}`)
        .expect(200)
    ).body as ClientNearbyPointDto[];

  // The fixture: clients around Alger, of two teams.
  let plain: ClientDto;
  let indebted: ClientDto;
  let over: ClientDto;
  let inactive: ClientDto;
  let noPoint: ClientDto;
  let archived: ClientDto;
  let ofSeller2: ClientDto;
  let in49: ClientDto;
  let out51: ClientDto;

  beforeAll(async () => {
    t = await createTestApp();
    d = await registerTenant(t, 'Distrib Carte', { activity: Activity.DISTRIBUTEUR });
    other = await registerTenant(t, 'Autre Carte', { activity: Activity.DISTRIBUTEUR });
    essentiel = await registerTenant(t, 'Grossiste sans carte');
    supervisor = await member(d, 'SUPERVISOR');
    supervisor2 = await member(d, 'SUPERVISOR');
    seller = await member(d, 'SELLER', supervisor.id);
    seller2 = await member(d, 'SELLER', supervisor2.id);
    await as(d).patch('/tenant/settings', { sellerScope: 'ASSIGNED_ONLY' }).expect(200);
    sectorId = (
      (
        await as(d)
          .post('/sectors', { name: `Centre ${tag}` }, null)
          .expect(201)
      ).body as {
        id: string;
      }
    ).id;

    plain = await client({ at: north(100), sellerId: seller.id, sectorId });
    indebted = await client({ at: north(300), sellerId: seller.id, debt: '5000' });
    over = await client({
      at: north(600),
      sellerId: seller.id,
      creditLimit: '1000',
      debt: '2500',
    });
    inactive = await client({ at: north(800), sellerId: seller.id, active: false });
    noPoint = await client({ sellerId: seller.id });
    archived = await client({ at: north(900), sellerId: seller.id });
    await as(d).delete(`/clients/${archived.id}`).expect(204);
    ofSeller2 = await client({ at: north(200), sellerId: seller2.id });
    in49 = await client({ at: north(4900), sellerId: seller.id });
    out51 = await client({ at: north(5100), sellerId: seller.id });
    // Tenant B has a client on the very same point as A's.
    await client({ who: other, at: north(100) });
  });
  afterAll(async () => {
    mapLimits.pointsMax = 2000;
    await t.close();
  });

  describe('GET /clients/map', () => {
    it('returns live, active clients with a point, compact, ordered by name', async () => {
      const res = await as(d).get(`/clients/map?search=${tag}`).expect(200);
      expect(res.headers['cache-control']).toBe('private, max-age=30');
      const body = res.body as ClientMapDto;
      expect(ids(body.points)).toEqual(ids([plain, indebted, over, ofSeller2, in49, out51]));
      expect(body.points.map((p) => p.name)).toEqual([...body.points.map((p) => p.name)].sort());
      expect(body.truncated).toBe(false);
      expect(body.withoutLocation).toBe(1);
      const p = body.points.find((x) => x.id === over.id)!;
      expect(p).toEqual({
        id: over.id,
        code: over.code,
        name: over.name,
        commune: null,
        phone: null,
        lat: expect.closeTo(north(600).lat, 5) as number,
        lng: ALGER.lng,
        active: true,
        balance: '2500.00',
        overLimit: true,
        sectorId: null,
        assignedSellerId: seller.id,
      });
    });

    it('shows inactive clients only when asked', async () => {
      const body = await map(d, '&includeInactive=true');
      expect(ids(body.points)).toContain(inactive.id);
      expect(body.points.find((p) => p.id === inactive.id)?.active).toBe(false);
      expect(ids(body.points)).not.toContain(archived.id);
    });

    it('applies every filter of the client list', async () => {
      expect(ids((await map(d, '&hasDebt=true')).points)).toEqual(ids([indebted, over]));
      expect(ids((await map(d, '&overLimit=true')).points)).toEqual([over.id]);
      expect(ids((await map(d, `&sectorId=${sectorId}`)).points)).toEqual([plain.id]);
      expect(ids((await map(d, `&assignedSellerId=${seller2.id}`)).points)).toEqual([ofSeller2.id]);
      const one = await map(d, `${plain.code.slice(tag.length)}`);
      expect(ids(one.points)).toContain(plain.id);
      // withoutLocation follows the same filters.
      expect((await map(d, '&hasDebt=true')).withoutLocation).toBe(0);
      expect((await map(d, `&assignedSellerId=${seller.id}`)).withoutLocation).toBe(1);
    });

    it('keeps to the view box', async () => {
      const box = `&minLat=${ALGER.lat}&minLng=${ALGER.lng - 0.01}&maxLat=${north(450).lat}&maxLng=${ALGER.lng + 0.01}`;
      expect(ids((await map(d, box)).points)).toEqual(ids([plain, indebted, ofSeller2]));
    });

    it('refuses an incomplete or inverted box', async () => {
      await as(d).get('/clients/map?minLat=36&maxLat=37').expect(400);
      await as(d).get('/clients/map?minLat=37&minLng=3&maxLat=36&maxLng=4').expect(400);
      await as(d).get('/clients/map?minLat=36&minLng=3&maxLat=91&maxLng=4').expect(400);
    });

    it('flips truncated at the cap', async () => {
      mapLimits.pointsMax = 6;
      expect(await map(d)).toMatchObject({ truncated: false });
      mapLimits.pointsMax = 5;
      const body = await map(d);
      expect(body.truncated).toBe(true);
      expect(body.points).toHaveLength(5);
      mapLimits.pointsMax = 2000;
    });
  });

  describe('scope', () => {
    it('a seller sees only his assigned clients, a supervisor his team, the owner all', async () => {
      const mine = ids([plain, indebted, over, in49, out51]);
      expect(ids((await map(seller)).points)).toEqual(mine);
      expect(ids((await map(supervisor)).points)).toEqual(mine);
      expect(ids((await map(supervisor2)).points)).toEqual([ofSeller2.id]);
      expect((await map(d)).points).toHaveLength(6);
    });

    it("never shows another seller's client, not on the map, not nearby", async () => {
      expect(ids((await map(seller, `&assignedSellerId=${seller2.id}`)).points)).toEqual([]);
      const near = await nearby(seller, north(200), '&radiusM=1000');
      expect(near.map((p) => p.id)).not.toContain(ofSeller2.id);
      expect(near.length).toBeGreaterThan(0);
      expect((await map(seller2)).withoutLocation).toBe(0);
    });
  });

  describe('GET /clients/nearby', () => {
    it('orders by distance with whole metres', async () => {
      const near = await nearby(d, ALGER, '&radiusM=1000');
      expect(near.map((p) => p.id)).toEqual([plain.id, ofSeller2.id, indebted.id, over.id]);
      expect(near[0]!.distanceM).toBeGreaterThanOrEqual(99);
      expect(near[0]!.distanceM).toBeLessThanOrEqual(101);
      expect(Number.isInteger(near[0]!.distanceM)).toBe(true);
    });

    it('respects the radius: 4.9 km in, 5.1 km out at 5 km', async () => {
      const near = (await nearby(d, ALGER)).map((p) => p.id);
      expect(near).toContain(in49.id);
      expect(near).not.toContain(out51.id);
    });

    it('applies the filters, the limit and the scope', async () => {
      expect((await nearby(d, ALGER, '&hasDebt=true')).map((p) => p.id)).toEqual([
        indebted.id,
        over.id,
      ]);
      expect(await nearby(d, ALGER, '&limit=2')).toHaveLength(2);
      expect((await nearby(supervisor2, ALGER)).map((p) => p.id)).toEqual([ofSeller2.id]);
      await as(d).get(`/clients/nearby?lat=36.7&lng=3&radiusM=60000`).expect(400);
      await as(d).get(`/clients/nearby?lng=3`).expect(400);
    });
  });

  // REPORT-35, A-2 and A-6: hostile values are a 400 with a code, never a 500 or a guess.
  describe('hostile input', () => {
    const refused = async (url: string) => {
      const res = await as(d).get(url).expect(400);
      expect((res.body as ApiError).code).toBe(ErrorCode.VALIDATION_FAILED);
    };

    it('refuses a NUL byte in search on the map, nearby and the list', async () => {
      await refused('/clients/map?search=%00');
      await refused('/clients/map?search=abc%00def');
      await refused('/clients/nearby?lat=36.75&lng=3.06&search=%00');
      await refused('/clients?search=%00');
    });

    it('does not read an empty position as 0, 0', async () => {
      await refused('/clients/nearby?lat=&lng=');
      await refused('/clients/nearby?lat=%20&lng=3');
      await refused('/clients/nearby?lat=0x24&lng=3');
      await refused('/clients/map?minLat=&minLng=2&maxLat=37&maxLng=4');
    });

    it('answers 400 when a NUL byte reaches the database through another field', async () => {
      const res = await as(d).post('/clients', { name: `${tag} nul\u0000name` });
      expect(res.status).toBe(400);
      expect((res.body as ApiError).code).toBe(ErrorCode.VALIDATION_FAILED);
    });
  });

  describe('GET /clients?hasLocation', () => {
    it('lists clients with or without a point', async () => {
      const page = async (v: string) =>
        ids(
          (
            (await as(d).get(`/clients?search=${tag}&hasLocation=${v}`).expect(200))
              .body as ClientPage
          ).items,
        );
      expect(await page('false')).toEqual([noPoint.id]);
      expect(await page('true')).toEqual(
        ids([plain, indebted, over, inactive, ofSeller2, in49, out51]),
      );
    });
  });

  describe('tenant isolation', () => {
    it("never returns tenant B's clients, even centred on B's point", async () => {
      const body = (await as(d).get('/clients/map').expect(200)).body as ClientMapDto;
      const owned = await asTenant(d.tenantId, () =>
        t.prisma.db.client.findMany({ where: { tenantId: d.tenantId }, select: { id: true } }),
      );
      const mine = new Set(owned.map((c) => c.id));
      expect(body.points.every((p) => mine.has(p.id))).toBe(true);
      const near = await as(other)
        .get(`/clients/nearby?search=${tag}&lat=${north(100).lat}&lng=${ALGER.lng}`)
        .expect(200);
      const theirs = near.body as ClientNearbyPointDto[];
      expect(theirs).toHaveLength(1);
      expect(theirs[0]!.id).not.toBe(plain.id);
    });
  });

  describe('feature off', () => {
    it('refuses both routes without GEO_CHECK (Essentiel)', async () => {
      const a = await as(essentiel).get('/clients/map').expect(403);
      expect((a.body as ApiError).code).toBe(ErrorCode.FEATURE_NOT_IN_PLAN);
      await as(essentiel).get('/clients/nearby?lat=36.7&lng=3').expect(403);
    });
  });

  describe('route stops picked on the map', () => {
    let route: RouteDto;
    beforeAll(async () => {
      route = (
        await as(supervisor)
          .post('/routes', { name: `Carte ${tag}`, sellerId: seller.id, weekdays: [1] }, null)
          .expect(201)
      ).body as RouteDto;
    });

    it("gives the stops' points and the start of the route", async () => {
      const r = (
        await as(supervisor)
          .put(`/routes/${route.id}/stops`, { clientIds: [indebted.id, noPoint.id] })
          .expect(200)
      ).body as RouteDto;
      expect(r.stops[0]!.client.lat).toBeCloseTo(north(300).lat, 5);
      expect(r.stops[1]!.client.lat).toBeNull();
      expect(r).toHaveProperty('start');
    });

    it("refuses a client outside the planner's scope", async () => {
      const res = await as(supervisor)
        .put(`/routes/${route.id}/stops`, { clientIds: [plain.id, ofSeller2.id] })
        .expect(400);
      expect((res.body as ApiError).code).toBe(ErrorCode.VALIDATION_FAILED);
    });

    // REPORT-35, A-7: "Ajouter à une tournée…" reads the route then replaces its stops.
    describe('a save built on a stale read', () => {
      const put = (who: Who, body: object) => as(who).put(`/routes/${route.id}/stops`, body);
      const stopIds = async () =>
        ((await as(supervisor).get(`/routes/${route.id}`).expect(200)).body as RouteDto).stops.map(
          (s) => s.client.id,
        );

      it('is refused, and nothing the other planner saved is lost', async () => {
        const read = await stopIds();
        await put(supervisor, { clientIds: [...read, plain.id], baseClientIds: read }).expect(200);
        const res = await put(d, { clientIds: [...read, over.id], baseClientIds: read }).expect(
          409,
        );
        expect((res.body as ApiError).code).toBe(ErrorCode.ROUTE_STOPS_CHANGED);
        const now = await stopIds();
        expect(now).toEqual([...read, plain.id]);
        // Read again, add again: both clients are on the route.
        await put(d, { clientIds: [...now, over.id], baseClientIds: now }).expect(200);
        expect(await stopIds()).toEqual([...read, plain.id, over.id]);
      });

      it('compares the order too, and still replaces blindly without a base', async () => {
        const now = await stopIds();
        await put(d, { clientIds: [], baseClientIds: [...now].reverse() }).expect(409);
        await put(d, { clientIds: [indebted.id, noPoint.id] }).expect(200);
        expect(await stopIds()).toEqual([indebted.id, noPoint.id]);
      });

      it('lets exactly one of two simultaneous saves from the same read through', async () => {
        const read = await stopIds();
        const [a, b] = await Promise.all([
          put(supervisor, { clientIds: [...read, plain.id], baseClientIds: read }),
          put(d, { clientIds: [...read, over.id], baseClientIds: read }),
        ]);
        expect([a.status, b.status].sort()).toEqual([200, 409]);
        const winner = a.status === 200 ? plain.id : over.id;
        expect(await stopIds()).toEqual([...read, winner]);
        await put(d, { clientIds: read }).expect(200);
      });
    });

    it('takes 300 stops and refuses 301', async () => {
      const made = await tamper(t)`
        INSERT INTO clients (id, "tenantId", code, name, "assignedSellerId", "updatedAt")
        SELECT gen_random_uuid(), ${d.tenantId}::uuid, ${`${tag}B`} || g, ${`${tag}Bulk `} || g,
          ${seller.id}::uuid, CURRENT_TIMESTAMP
        FROM generate_series(1, 301) g`;
      expect(made).toBe(301);
      const bulk = await asTenant(d.tenantId, () =>
        t.prisma.db.client.findMany({
          where: { code: { startsWith: `${tag}B` } },
          select: { id: true },
          orderBy: { code: 'asc' },
        }),
      );
      const all = bulk.map((c) => c.id);
      const ok = (
        await as(supervisor)
          .put(`/routes/${route.id}/stops`, { clientIds: all.slice(0, 300) })
          .expect(200)
      ).body as RouteDto;
      expect(ok.stops).toHaveLength(300);
      await as(supervisor).put(`/routes/${route.id}/stops`, { clientIds: all }).expect(400);
    });
  });
});
