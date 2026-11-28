import { randomUUID } from 'node:crypto';
import * as argon2 from 'argon2';
import {
  Activity,
  algiersDay,
  type ApiError,
  type AuthResponse,
  type ClientDto,
  type ClientPage,
  type ClientsWithoutCommunePage,
  type DelivererDto,
  type DeliverOrderResultDto,
  ErrorCode,
  type OrderDto,
  type ProductDto,
  type Role,
  type RouteDto,
  type SaleDto,
  type SalePage,
  type SaleResultDto,
  type SellerZoneAssignmentPage,
  type TodayDto,
  type UserDto,
  type WarehouseDto,
  type ZoneDto,
} from '@erp/shared';
import { communesOf } from '@erp/shared/communes';
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
  email: string;
  auth: AuthResponse;
}
interface Item {
  id: string;
  piece: string;
}

const BAB_EZZOUAR = 1621;
const EL_HARRACH = 1613;
const DAR_EL_BEIDA = 1620;
const ORAN = 3101;
/** Bou Saâda, wilaya 68 (one of 59 to 69). */
const BOU_SAADA = 2820;

/**
 * Phase 40b: field zones, the roles AREA_MANAGER and PREVENDEUR, dated seller zone
 * assignments and the BY_ZONE scope. One company: a chef de zone over two supervisors
 * (A and B), each with a seller, and a pré-vendeur and two livreurs.
 */
describe('field teams: zones, new roles and zone scope (phase 40b)', () => {
  let t: TestApp;
  let d: RegisteredTenant;
  let other: RegisteredTenant;
  let cat: TenantCatalog;
  let chef: Member;
  let chefWest: Member;
  let supA: Member;
  let supB: Member;
  let sellerA: Member;
  let sellerB: Member;
  let pre: Member;
  let livA: Member;
  let livB: Member;
  let manager: Member;
  let area: ZoneDto;
  let west: ZoneDto;
  let cityA: ZoneDto;
  let cityB: ZoneDto;
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
    del: (url: string) =>
      t
        .http()
        .delete(url)
        .set(...bearer(who.auth.accessToken)),
  });

  const member = async (who: RegisteredTenant, role: Role, managerId?: string): Promise<Member> => {
    const email = uniqueEmail(role.toLowerCase().replace('_', '-'));
    const n = ++seq;
    const user = await asTenant(who.tenantId, async () =>
      t.prisma.db.user.create({
        data: {
          tenantId: who.tenantId,
          email,
          passwordHash: await argon2.hash('Password123!'),
          fullName: `${role} ${n}`,
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
      .set('X-Forwarded-For', `10.40.${Math.floor(n / 250)}.${(n % 250) + 1}`)
      .send({ email, password: 'Password123!' })
      .expect(200);
    return { id: user.id, email, auth: login.body as AuthResponse };
  };

  const newClient = async (body: object = {}, by: Who = d): Promise<ClientDto> => {
    const n = ++seq;
    return (
      await as(by)
        .post('/clients', { code: `FT${n}`, name: `Client ${n}`, ...body }, null)
        .expect(201)
    ).body as ClientDto;
  };

  const zone = async (body: object, by: Who = d): Promise<ZoneDto> =>
    (
      await as(by)
        .post('/field-zones', { name: `Zone ${++seq}`, ...body }, null)
        .expect(201)
    ).body as ZoneDto;

  const assign = (by: Who, userId: string, body: object) =>
    as(by).post(`/users/${userId}/zone-assignment`, body, null);

  const history = async (by: Who, userId: string) =>
    (await as(by).get(`/users/${userId}/zone-assignments`).expect(200))
      .body as SellerZoneAssignmentPage;

  const clientIds = async (by: Who): Promise<string[]> => {
    const ids: string[] = [];
    let cursor: string | null = null;
    do {
      const page = (
        await as(by)
          .get(`/clients?limit=100${cursor ? `&cursor=${cursor}` : ''}`)
          .expect(200)
      ).body as ClientPage;
      ids.push(...page.items.map((c) => c.id));
      cursor = page.nextCursor;
    } while (cursor);
    return ids;
  };

  const settings = (body: object) => as(d).patch('/tenant/settings', body).expect(200);

  const auditOf = (entityId: string, who: RegisteredTenant = d) =>
    asTenant(who.tenantId, () =>
      t.prisma.db.auditLog.findMany({ where: { entityId }, orderBy: { createdAt: 'asc' } }),
    );

  /** A product at 1 000 HT the piece, with 500 pieces in stock. */
  async function product(): Promise<Item> {
    const piece = cat.units['PIECE']!.id;
    const n = ++seq;
    const res = await as(d)
      .post(
        '/products',
        {
          reference: `FT-${Date.now()}-${n}`,
          designation: `Article ${n}`,
          baseUnitId: piece,
          tvaRate: '19',
          units: [
            {
              unitId: piece,
              factorToBase: '1',
              barcode: null,
              isDefaultSale: true,
              isDefaultPurchase: true,
            },
          ],
          prices: cat.levels
            .slice(0, 3)
            .map((l) => ({ unitId: piece, priceLevelId: l.id, priceHt: '1000' })),
        },
        null,
      )
      .expect(201);
    const id = (res.body as ProductDto).id;
    await as(d)
      .post('/stock/opening', {
        lines: [{ productId: id, unitId: piece, qty: '500', unitCost: '700' }],
      })
      .expect(201);
    return { id, piece };
  }

  const lines = (p: Item, qty = '2') => [{ productId: p.id, unitId: p.piece, qty }];

  /** A validated BL typed by `by`, all on credit. */
  const sell = async (by: Who, clientId: string, p: Item): Promise<SaleDto> =>
    (
      (
        await as(by)
          .post('/sales/quick', {
            type: 'BL',
            clientId,
            documentDate: algiersDay(),
            lines: lines(p),
          })
          .expect(201)
      ).body as SaleResultDto
    ).sale;

  const confirmedOrder = async (by: Who, clientId: string, p: Item): Promise<OrderDto> => {
    const draft = (
      await as(by)
        .post('/orders', { clientId, lines: lines(p) })
        .expect(201)
    ).body as OrderDto;
    return (await as(by).post(`/orders/${draft.id}/confirm`).expect(200)).body as OrderDto;
  };

  beforeAll(async () => {
    t = await createTestApp();
    d = await registerTenant(t, 'Equipes Terrain', { activity: Activity.DISTRIBUTEUR });
    other = await registerTenant(t, 'Autre Terrain', { activity: Activity.DISTRIBUTEUR });
    await withoutGeoCheck(t, d);
    await withoutGeoCheck(t, other);
    cat = await catalogOf(t, d);
    manager = await member(d, 'MANAGER');
    chef = await member(d, 'AREA_MANAGER');
    chefWest = await member(d, 'AREA_MANAGER');
    supA = await member(d, 'SUPERVISOR', chef.id);
    supB = await member(d, 'SUPERVISOR', chef.id);
    sellerA = await member(d, 'SELLER', supA.id);
    sellerB = await member(d, 'SELLER', supB.id);
    pre = await member(d, 'PREVENDEUR', supA.id);
    livA = await member(d, 'LIVREUR', supA.id);
    livB = await member(d, 'LIVREUR', supB.id);
    area = await zone({
      name: 'Zone Est',
      kind: 'AREA',
      communeCodes: [BAB_EZZOUAR, EL_HARRACH, DAR_EL_BEIDA],
      responsibleUserId: chef.id,
    });
    west = await zone({
      name: 'Zone Ouest',
      kind: 'AREA',
      wilayaCodes: [31],
      responsibleUserId: chefWest.id,
    });
    cityA = await zone({
      name: 'Ville A',
      kind: 'CITY',
      parentZoneId: area.id,
      communeCodes: [BAB_EZZOUAR, DAR_EL_BEIDA],
      responsibleUserId: supA.id,
    });
    cityB = await zone({
      name: 'Ville B',
      kind: 'CITY',
      parentZoneId: area.id,
      communeCodes: [EL_HARRACH],
      responsibleUserId: supB.id,
    });
  }, 60_000);
  afterAll(() => t.close());

  // ------------------------------------------------------------------ 1. zones

  describe('zones', () => {
    const refused = async (body: object) =>
      errorOf(await as(d).post('/field-zones', { name: `Z${++seq}`, ...body }, null));

    it('keeps a city inside its area, on both sides', async () => {
      const outside = await refused({
        kind: 'CITY',
        parentZoneId: area.id,
        communeCodes: [communesOf(9)[0]!.code],
      });
      expect(outside.code).toBe(ErrorCode.ZONE_NOT_INSIDE_AREA);
      expect(outside.details).toMatchObject({ areaName: 'Zone Est' });
      // Shrinking the area under one of its cities is refused too, and changes nothing.
      const shrink = await as(d)
        .put(`/field-zones/${area.id}`, {
          name: area.name,
          kind: 'AREA',
          communeCodes: [BAB_EZZOUAR, DAR_EL_BEIDA],
          responsibleUserId: chef.id,
          version: area.version,
        })
        .expect(422);
      expect(errorOf(shrink).code).toBe(ErrorCode.ZONE_NOT_INSIDE_AREA);
      expect(errorOf(shrink).details).toMatchObject({ zoneName: 'Ville B' });
      const now = (await as(d).get(`/field-zones/${area.id}`).expect(200)).body as ZoneDto;
      expect(now).toEqual(area);
    });

    it('gives a commune to one zone of a kind, and names the other zone', async () => {
      const city = await refused({ kind: 'CITY', communeCodes: [EL_HARRACH] });
      expect(city.code).toBe(ErrorCode.ZONE_COMMUNE_TAKEN);
      expect(city.details).toMatchObject({
        zoneId: cityB.id,
        zoneName: 'Ville B',
        communeCodes: [EL_HARRACH],
      });
      // A whole wilaya counts as all its communes, on either side.
      const inWilaya = await refused({ kind: 'AREA', communeCodes: [ORAN] });
      expect(inWilaya).toMatchObject({ code: ErrorCode.ZONE_COMMUNE_TAKEN });
      expect(inWilaya.details).toMatchObject({ zoneName: 'Zone Ouest' });
      const overWilaya = await refused({ kind: 'AREA', wilayaCodes: [16] });
      expect(overWilaya.details).toMatchObject({ zoneName: 'Zone Est' });
    });

    it('lets one of two writes of the same commune at once through', async () => {
      const commune = communesOf(9)[1]!.code;
      const results = await Promise.all(
        [1, 2].map((n) =>
          as(d).post(
            '/field-zones',
            { name: `Course ${n}`, kind: 'CITY', communeCodes: [commune] },
            null,
          ),
        ),
      );
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    });

    it('checks the communes, the parent and who is responsible', async () => {
      expect((await refused({ kind: 'CITY', communeCodes: [99999] })).code).toBe(
        ErrorCode.COMMUNE_UNKNOWN,
      );
      const free = communesOf(9)[2]!.code;
      for (const bad of [
        { kind: 'CITY', communeCodes: [free], parentZoneId: cityA.id },
        { kind: 'AREA', communeCodes: [free], responsibleUserId: supA.id },
        { kind: 'CITY', communeCodes: [free], responsibleUserId: sellerA.id },
      ]) {
        expect((await refused(bad)).code).toBe(ErrorCode.VALIDATION_FAILED);
      }
    });

    it('updates with the version read, deletes softly, and audits every write', async () => {
      const commune = communesOf(9)[3]!.code;
      const z = await zone({ kind: 'CITY', communeCodes: [commune] });
      const body = { name: 'Renommée', kind: 'CITY', communeCodes: [commune], version: z.version };
      const updated = (await as(manager).put(`/field-zones/${z.id}`, body).expect(200))
        .body as ZoneDto;
      expect(updated).toMatchObject({ name: 'Renommée', version: z.version + 1 });
      const stale = await as(d).put(`/field-zones/${z.id}`, body).expect(409);
      expect(errorOf(stale).code).toBe(ErrorCode.CONFLICT);
      await as(d).del(`/field-zones/${z.id}`).expect(204);
      await as(d).get(`/field-zones/${z.id}`).expect(404);
      expect((await auditOf(z.id)).map((a) => a.action)).toEqual([
        'ZONE_CREATED',
        'ZONE_UPDATED',
        'ZONE_DELETED',
      ]);
      // Its communes are free again.
      await zone({ kind: 'CITY', communeCodes: [commune] });
    });

    it('refuses to delete an area with a city', async () => {
      const res = await as(d).del(`/field-zones/${area.id}`).expect(409);
      expect(errorOf(res).code).toBe(ErrorCode.ZONE_IN_USE);
      expect(errorOf(res).details).toMatchObject({ cities: 2 });
    });

    it('shows a lead only his zones, and lets only the office write', async () => {
      const ids = async (by: Who) =>
        ((await as(by).get('/field-zones').expect(200)).body as ZoneDto[]).map((z) => z.id).sort();
      expect(await ids(chef)).toEqual([area.id, cityA.id, cityB.id].sort());
      expect(await ids(chefWest)).toEqual([west.id]);
      expect(await ids(supA)).toEqual([cityA.id]);
      expect(await ids(manager)).toContain(west.id);
      await as(chef).get(`/field-zones/${west.id}`).expect(404);
      await as(supA).get(`/field-zones/${cityB.id}`).expect(404);
      for (const who of [chef, supA, sellerA, pre]) {
        const body = { name: 'Non', kind: 'CITY', communeCodes: [ORAN] };
        await as(who).post('/field-zones', body, null).expect(403);
        await as(who)
          .put(`/field-zones/${cityA.id}`, { ...body, version: 1 })
          .expect(403);
        await as(who).del(`/field-zones/${cityA.id}`).expect(403);
      }
      await as(sellerA).get('/field-zones').expect(403);
      await as(livA).get('/field-zones').expect(403);
    });

    it('keeps another company out', async () => {
      expect((await as(other).get('/field-zones').expect(200)).body).toEqual([]);
      await as(other).get(`/field-zones/${area.id}`).expect(404);
      await as(other)
        .put(`/field-zones/${cityA.id}`, {
          name: 'Pris',
          kind: 'CITY',
          communeCodes: [BAB_EZZOUAR],
          version: 1,
        })
        .expect(404);
      await as(other).del(`/field-zones/${cityA.id}`).expect(404);
      // The same communes are free there, and our user cannot be named responsible.
      await zone({ kind: 'CITY', communeCodes: [BAB_EZZOUAR] }, other);
      const foreign = await as(other).post(
        '/field-zones',
        { name: 'X', kind: 'AREA', communeCodes: [ORAN], responsibleUserId: chef.id },
        null,
      );
      expect(errorOf(foreign).code).toBe(ErrorCode.VALIDATION_FAILED);
      await expect(
        asTenant(other.tenantId, () => t.prisma.db.fieldZone.findFirst({ where: { id: area.id } })),
      ).resolves.toBeNull();
    });
  });

  // ------------------------------------------------------------------ 2. moves

  describe('seller moves', () => {
    let inA: ClientDto;
    let inB: ClientDto;

    beforeAll(async () => {
      await settings({ sellerScope: 'BY_ZONE', zoneIncludesAssigned: false });
      inA = await newClient({ communeCode: BAB_EZZOUAR });
      inB = await newClient({ communeCode: EL_HARRACH });
    });
    afterAll(() => settings({ sellerScope: 'ALL_CLIENTS', zoneIncludesAssigned: false }));

    it('shows nothing without an assignment', async () => {
      const lone = await member(d, 'SELLER', supA.id);
      expect(await clientIds(lone)).toEqual([]);
      await as(lone).get(`/clients/${inA.id}`).expect(404);
    });

    it('shows only the new commune right after a move, and keeps his past BL', async () => {
      const p = await product();
      await assign(d, sellerA.id, { zoneId: cityA.id }).expect(201);
      expect(await clientIds(sellerA)).toContain(inA.id);
      expect(await clientIds(sellerA)).not.toContain(inB.id);
      const bl = await sell(sellerA, inA.id, p);
      await as(sellerA)
        .post('/sales/quick', {
          type: 'BL',
          clientId: inB.id,
          documentDate: algiersDay(),
          lines: lines(p),
        })
        .expect(404);

      await assign(d, sellerA.id, { communeCodes: [EL_HARRACH] }).expect(201);
      const seen = await clientIds(sellerA);
      expect(seen).toContain(inB.id);
      expect(seen).not.toContain(inA.id);
      await as(sellerA).get(`/clients/${inA.id}`).expect(404);
      await as(sellerA).get(`/clients/${inB.id}`).expect(200);
      await as(sellerA)
        .get(`/clients/${inA.id}/statement?from=2026-01-01&to=2030-01-01`)
        .expect(404);
      // The BL he made stays his to read.
      await as(sellerA).get(`/sales/${bl.id}`).expect(200);
      const sales = (await as(sellerA).get('/sales?limit=100').expect(200)).body as SalePage;
      expect(sales.items.map((s) => s.id)).toContain(bl.id);
      // The map goes through the raw SQL path of the same scope.
      const map = (await as(sellerA).get('/clients/map').expect(200)).body as {
        withoutLocation: number;
      };
      expect(map.withoutLocation).toBe(seen.length);

      const h = await history(sellerA, sellerA.id);
      expect(h.items).toHaveLength(2);
      expect(h.current).toMatchObject({ zone: null, communeCodes: [EL_HARRACH], validTo: null });
      expect(h.items[1]).toMatchObject({
        zone: { id: cityA.id },
        assignedBy: { id: d.auth.user.id },
      });
      expect(h.items[1]!.validTo).toBe(h.current!.validFrom);
      const audit = await auditOf(h.current!.id);
      expect(audit.map((a) => a.action)).toEqual(['SELLER_ZONE_ASSIGNED']);
      expect(audit[0]!.before).toMatchObject({ zoneId: cityA.id });
    });

    it('does not offer a stop outside his zone in the tournée of today', async () => {
      const route = (
        await as(d)
          .post(
            '/routes',
            { name: 'Mixte', sellerId: sellerA.id, weekdays: [0, 1, 2, 3, 4, 5, 6] },
            null,
          )
          .expect(201)
      ).body as RouteDto;
      await as(d)
        .put(`/routes/${route.id}/stops`, { clientIds: [inA.id, inB.id] })
        .expect(200);
      const day = (await as(sellerA).get('/me/today').expect(200)).body as TodayDto;
      expect(day.stops.map((s) => s.client.id)).toEqual([inB.id]);
    });

    it('adds his assigned clients only when the owner turns that on', async () => {
      const assigned = await newClient({ communeCode: ORAN, assignedSellerId: sellerA.id });
      const noCommune = await newClient({ assignedSellerId: sellerA.id });
      expect(await clientIds(sellerA)).not.toContain(assigned.id);
      await settings({ zoneIncludesAssigned: true });
      const seen = await clientIds(sellerA);
      expect(seen).toContain(assigned.id);
      expect(seen).not.toContain(noCommune.id);
      await settings({ zoneIncludesAssigned: false });
    });

    it('follows the zone he was sent to when its communes change', async () => {
      const commune = communesOf(9)[4]!.code;
      const next = communesOf(9)[5]!.code;
      const z = await zone({ kind: 'CITY', communeCodes: [commune] });
      const [c1, c2] = [
        await newClient({ communeCode: commune }),
        await newClient({ communeCode: next }),
      ];
      const s = await member(d, 'SELLER', supA.id);
      await assign(d, s.id, { zoneId: z.id }).expect(201);
      expect(await clientIds(s)).toEqual([c1.id]);
      await as(d)
        .put(`/field-zones/${z.id}`, {
          name: z.name,
          kind: 'CITY',
          communeCodes: [next],
          version: z.version,
        })
        .expect(200);
      expect(await clientIds(s)).toEqual([c2.id]);
      const inUse = await as(d).del(`/field-zones/${z.id}`).expect(409);
      expect(errorOf(inUse).details).toMatchObject({ sellers: 1 });
    });

    it('leaves exactly one open row after two moves at once', async () => {
      const s = await member(d, 'SELLER', supA.id);
      await assign(d, s.id, { communeCodes: [BAB_EZZOUAR] }).expect(201);
      for (let round = 0; round < 3; round++) {
        const results = await Promise.all([
          assign(d, s.id, { communeCodes: [EL_HARRACH] }),
          assign(manager, s.id, { communeCodes: [DAR_EL_BEIDA] }),
        ]);
        expect(results.map((r) => r.status)).toEqual([201, 201]);
      }
      const rows = await asTenant(d.tenantId, () =>
        t.prisma.db.sellerZoneAssignment.findMany({ where: { userId: s.id } }),
      );
      expect(rows).toHaveLength(7);
      expect(rows.filter((r) => r.validTo === null)).toHaveLength(1);
    });

    it('never rewrites history: the database only lets a row be closed, once', async () => {
      const s = await member(d, 'SELLER', supA.id);
      await assign(d, s.id, { communeCodes: [BAB_EZZOUAR] }).expect(201);
      await assign(d, s.id, { communeCodes: [EL_HARRACH] }).expect(201);
      const [open, closed] = await asTenant(d.tenantId, () =>
        t.prisma.db.sellerZoneAssignment.findMany({
          where: { userId: s.id },
          orderBy: { validTo: { sort: 'desc', nulls: 'first' } },
        }),
      );
      const sql = tamper(t);
      await expect(
        sql`UPDATE seller_zone_assignments SET "communeCodes" = '{3101}' WHERE id = ${open!.id}::uuid`,
      ).rejects.toThrow(/append-only/);
      await expect(
        sql`UPDATE seller_zone_assignments SET "validTo" = now() WHERE id = ${closed!.id}::uuid`,
      ).rejects.toThrow(/append-only/);
      await expect(
        sql`UPDATE seller_zone_assignments SET "validTo" = NULL WHERE id = ${closed!.id}::uuid`,
      ).rejects.toThrow(/append-only/);
      await expect(
        sql`DELETE FROM seller_zone_assignments WHERE id = ${closed!.id}::uuid`,
      ).rejects.toThrow(/append-only/);
      // A second open row is refused by the partial unique index.
      await expect(
        sql`INSERT INTO seller_zone_assignments ("id","tenantId","userId","communeCodes","validFrom","assignedBy")
            VALUES (gen_random_uuid(), ${d.tenantId}::uuid, ${s.id}::uuid, '{1621}', now(), ${d.auth.user.id}::uuid)`,
      ).rejects.toThrow(/23505|unique/i);
    });
  });

  // ------------------------------------------------------------------ 3. no commune

  describe('clients without a commune', () => {
    let assignedToA: ClientDto;
    let createdByPre: ClientDto;
    let ofB: ClientDto;
    let nobodys: ClientDto;

    const listed = async (by: Who) => {
      const ids: string[] = [];
      let cursor: string | null = null;
      let total: number;
      do {
        const page = (
          await as(by)
            .get(`/clients/without-commune?limit=2${cursor ? `&cursor=${cursor}` : ''}`)
            .expect(200)
        ).body as ClientsWithoutCommunePage;
        total = page.total;
        ids.push(...page.items.map((c) => c.id));
        cursor = page.nextCursor;
      } while (cursor);
      expect(ids).toHaveLength(total);
      return ids;
    };

    beforeAll(async () => {
      await settings({ sellerScope: 'BY_ZONE', zoneIncludesAssigned: true });
      await assign(d, pre.id, { zoneId: cityA.id }).expect(201);
      assignedToA = await newClient({ assignedSellerId: sellerA.id });
      createdByPre = await newClient({}, pre);
      // Created by the pré-vendeur but assigned to nobody, whatever the default says.
      await tamper(
        t,
      )`UPDATE clients SET "assignedSellerId" = NULL WHERE id = ${createdByPre.id}::uuid`;
      ofB = await newClient({ assignedSellerId: sellerB.id });
      nobodys = await newClient();
    });
    afterAll(() => settings({ sellerScope: 'ALL_CLIENTS', zoneIncludesAssigned: false }));

    it('hides them from sellers, even their creator', async () => {
      for (const [who, c] of [
        [sellerA, assignedToA],
        [pre, createdByPre],
      ] as const) {
        expect(await clientIds(who)).not.toContain(c.id);
        await as(who).get(`/clients/${c.id}`).expect(404);
      }
    });

    it('lists them for their supervisor and chef de zone only', async () => {
      const a = await listed(supA);
      expect(a).toEqual(expect.arrayContaining([assignedToA.id, createdByPre.id]));
      expect(a).not.toContain(ofB.id);
      expect(a).not.toContain(nobodys.id);
      const b = await listed(supB);
      expect(b).toContain(ofB.id);
      expect(b).not.toContain(assignedToA.id);
      expect(b).not.toContain(createdByPre.id);
      const both = await listed(chef);
      expect(both).toEqual(expect.arrayContaining([assignedToA.id, createdByPre.id, ofB.id]));
      expect(both).not.toContain(nobodys.id);
      expect(await listed(chefWest)).toEqual([]);
      for (const who of [d, manager]) {
        expect(await listed(who)).toEqual(
          expect.arrayContaining([assignedToA.id, ofB.id, nobodys.id]),
        );
      }
      for (const who of [sellerA, pre, livA]) {
        await as(who).get('/clients/without-commune').expect(403);
      }
      const foreign = (await as(other).get('/clients/without-commune').expect(200))
        .body as ClientsWithoutCommunePage;
      expect(foreign).toMatchObject({ total: 0, items: [] });
    });

    it('lets the supervisor open and fix them, then the seller sees them', async () => {
      await as(supB).get(`/clients/${createdByPre.id}`).expect(404);
      const c = (await as(supA).get(`/clients/${createdByPre.id}`).expect(200)).body as ClientDto;
      await as(supA)
        .patch(`/clients/${c.id}`, {
          code: c.code,
          name: c.name,
          communeCode: BAB_EZZOUAR,
          version: c.version,
        })
        .expect(200);
      expect(await listed(supA)).not.toContain(c.id);
      expect(await clientIds(pre)).toContain(c.id);
    });

    it('also under ASSIGNED_ONLY: what is listed can be opened', async () => {
      await settings({ sellerScope: 'ASSIGNED_ONLY' });
      const made = await newClient({}, pre);
      await tamper(t)`UPDATE clients SET "assignedSellerId" = NULL WHERE id = ${made.id}::uuid`;
      expect(await listed(supA)).toContain(made.id);
      await as(supA).get(`/clients/${made.id}`).expect(200);
      await as(supB).get(`/clients/${made.id}`).expect(404);
      await settings({ sellerScope: 'BY_ZONE' });
    });
  });

  // ------------------------------------------------------------------ 4. who may assign

  describe('assigning outside one’s zone or team', () => {
    const forbidden = async (by: Who, userId: string, body: object, code: string) => {
      const res = await assign(by, userId, body).expect(403);
      expect(errorOf(res).code).toBe(code);
    };

    it('lets a supervisor assign his own people inside his zones only', async () => {
      await assign(supA, sellerA.id, { zoneId: cityA.id }).expect(201);
      await assign(supA, pre.id, { communeCodes: [DAR_EL_BEIDA] }).expect(201);
      await forbidden(
        supA,
        sellerA.id,
        { communeCodes: [EL_HARRACH] },
        ErrorCode.ZONE_OUTSIDE_SCOPE,
      );
      await forbidden(supA, sellerA.id, { zoneId: cityB.id }, ErrorCode.ZONE_OUTSIDE_SCOPE);
      await forbidden(supB, sellerA.id, { zoneId: cityB.id }, ErrorCode.FORBIDDEN);
      await forbidden(supA, sellerB.id, { zoneId: cityA.id }, ErrorCode.FORBIDDEN);
      await as(supB).get(`/users/${sellerA.id}/zone-assignments`).expect(403);
      await as(sellerB).get(`/users/${sellerA.id}/zone-assignments`).expect(403);
      await history(supA, sellerA.id);
    });

    it('lets the chef de zone assign inside his area only', async () => {
      await assign(chef, sellerA.id, { zoneId: cityB.id }).expect(201);
      await assign(chef, sellerB.id, { communeCodes: [BAB_EZZOUAR, EL_HARRACH] }).expect(201);
      await forbidden(chef, sellerA.id, { communeCodes: [ORAN] }, ErrorCode.ZONE_OUTSIDE_SCOPE);
      await forbidden(chef, sellerA.id, { zoneId: west.id }, ErrorCode.ZONE_OUTSIDE_SCOPE);
      await forbidden(chefWest, sellerA.id, { zoneId: west.id }, ErrorCode.FORBIDDEN);
      await assign(manager, sellerA.id, { zoneId: west.id }).expect(201);
    });

    it('refuses sellers, other roles as targets and unknown places', async () => {
      await assign(sellerA, sellerA.id, { zoneId: cityA.id }).expect(403);
      await assign(pre, pre.id, { zoneId: cityA.id }).expect(403);
      for (const target of [supA, livA, chef]) {
        const res = await assign(d, target.id, { zoneId: cityA.id }).expect(400);
        expect(errorOf(res).code).toBe(ErrorCode.VALIDATION_FAILED);
      }
      expect(errorOf(await assign(d, sellerA.id, { communeCodes: [99999] })).code).toBe(
        ErrorCode.COMMUNE_UNKNOWN,
      );
      await assign(d, sellerA.id, { zoneId: randomUUID() }).expect(404);
      await assign(d, randomUUID(), { zoneId: cityA.id }).expect(404);
    });

    it('keeps another company out', async () => {
      await assign(other, sellerA.id, { communeCodes: [ORAN] }).expect(404);
      await as(other).get(`/users/${sellerA.id}/zone-assignments`).expect(404);
      const theirs = await member(other, 'SELLER');
      await assign(other, theirs.id, { zoneId: cityA.id }).expect(404);
    });

    it('shows the chef de zone his area only, whatever the company setting', async () => {
      const inside = await newClient({ communeCode: DAR_EL_BEIDA });
      const outside = await newClient({ communeCode: ORAN });
      for (const sellerScope of ['ALL_CLIENTS', 'ASSIGNED_ONLY', 'BY_ZONE']) {
        await settings({ sellerScope });
        const seen = await clientIds(chef);
        expect(seen).toContain(inside.id);
        expect(seen).not.toContain(outside.id);
        await as(chef).get(`/clients/${outside.id}`).expect(404);
        expect(await clientIds(chefWest)).toContain(outside.id);
      }
      const noZone = await member(d, 'AREA_MANAGER');
      expect(await clientIds(noZone)).toEqual([]);
      // A supervisor under BY_ZONE: his zones and where his people are now.
      await settings({ sellerScope: 'BY_ZONE' });
      await assign(d, sellerA.id, { communeCodes: [ORAN] }).expect(201);
      expect(await clientIds(supA)).toEqual(expect.arrayContaining([inside.id, outside.id]));
      expect(await clientIds(supB)).not.toContain(outside.id);
      await settings({ sellerScope: 'ALL_CLIENTS' });
    });
  });

  // ------------------------------------------------------------------ 5. pré-vendeur

  describe('pré-vendeur', () => {
    const forbiddenPaths: [string, 'get' | 'post' | 'put' | 'patch', string][] = [
      ['van sale: draft', 'post', '/sales'],
      ['van sale: quick', 'post', '/sales/quick'],
      ['van sale: edit a draft', 'put', '/sales/:uuid'],
      ['van sale: validate', 'post', '/sales/:uuid/validate'],
      ['sale cancel', 'post', '/sales/:uuid/cancel'],
      ['sale return (avoir)', 'post', '/sales/:uuid/returns'],
      ['facture from BLs', 'post', '/invoices/from-bls'],
      ['seller of a sale', 'patch', '/sales/:uuid/seller'],
      ['versement', 'post', '/payments'],
      ['versement cancel', 'post', '/payments/:uuid/cancel'],
      ['cheque bounce', 'post', '/payments/:uuid/bounce'],
      ['versement collector', 'patch', '/payments/:uuid/collector'],
      ['deliver', 'post', '/orders/:uuid/deliver'],
      ['deliverers list', 'get', '/orders/deliverers'],
      ['change livreur', 'patch', '/orders/:uuid/livreur'],
      ['truck: chargement draft', 'post', '/stock-transfers'],
      ['truck: chargement validate', 'post', '/stock-transfers/:uuid/validate'],
      ['truck: chargement cancel', 'post', '/stock-transfers/:uuid/cancel'],
      ['truck: driver', 'post', '/warehouses/:uuid/driver'],
      ['truck: day list', 'get', '/seller-sessions?date=2026-11-28'],
      ['truck: open a day', 'post', '/seller-sessions'],
      ['truck: close a day', 'post', '/seller-sessions/:uuid/close'],
      ['truck: adjust a day', 'post', '/seller-sessions/:uuid/adjust'],
      ['truck: statistics', 'get', '/stats/distribution/overview?from=2026-11-01&to=2026-11-28'],
      ['empties movement', 'post', '/packaging-movements'],
      ['stock adjustment', 'post', '/stock/adjustments'],
    ];

    const call = (method: 'get' | 'post' | 'put' | 'patch', url: string, body: object = {}) => {
      const path = url.replace(':uuid', randomUUID());
      if (method === 'get') return as(pre).get(path);
      if (method === 'post') return as(pre).post(path, body);
      return as(pre)[method](path, body);
    };

    /** The routes of the table check their permission in the service, after the body. */
    const bodyFor = (url: string): object =>
      url === '/stock/adjustments'
        ? {
            reason: 'CASSE',
            lines: [
              {
                productId: randomUUID(),
                unitId: randomUUID(),
                qty: '-1',
              },
            ],
          }
        : {};

    it.each(forbiddenPaths)('is refused: %s', async (_name, method, url) => {
      const res = await call(method, url, bodyFor(url));
      expect(res.status).toBe(403);
      expect(errorOf(res).code).toBe(ErrorCode.FORBIDDEN);
    });

    it('stays refused when every selling permission is granted to him', async () => {
      const s = await member(d, 'PREVENDEUR', supA.id);
      const grants = ['SALES_CREATE', 'SALES_RETURN', 'PAYMENTS_CREATE', 'STOCK_TRANSFER'];
      const dto = (
        await as(d).put(`/users/${s.id}/permissions`, { grants, revokes: [] }).expect(200)
      ).body as UserDto;
      expect(dto.permissions.filter((p) => grants.includes(p))).toEqual([]);
      for (const url of ['/sales', '/sales/quick', '/payments', '/stock-transfers']) {
        await as(s).post(url, {}).expect(403);
      }
    });

    it('takes commandes and records visits in his own name', async () => {
      const c = await newClient({ communeCode: BAB_EZZOUAR });
      const p = await product();
      const order = await confirmedOrder(pre, c.id, p);
      expect(order.seller?.id).toBe(pre.id);
      expect(order.number).toMatch(/^BC-/);
      await as(pre)
        .post('/visits', {
          clientId: c.id,
          startedAt: new Date().toISOString(),
          outcome: 'ORDER',
          orderId: order.id,
        })
        .expect(201);
      await as(pre)
        .post('/orders', { clientId: c.id, sellerId: sellerA.id, lines: lines(p) })
        .expect(403);
      // His own day: no truck, no cash. His tournée report is his.
      const day = (await as(pre).get('/me/day').expect(200)).body as { vehicle: unknown };
      expect(day.vehicle).toBeNull();
      await as(pre).get('/me/today').expect(200);
    });

    it('under BY_ZONE takes no commande outside his zone', async () => {
      await settings({ sellerScope: 'BY_ZONE' });
      await assign(d, pre.id, { communeCodes: [BAB_EZZOUAR] }).expect(201);
      const [inside, outside] = [
        await newClient({ communeCode: BAB_EZZOUAR }),
        await newClient({ communeCode: ORAN }),
      ];
      const p = await product();
      await as(pre)
        .post('/orders', { clientId: inside.id, lines: lines(p) })
        .expect(201);
      await as(pre)
        .post('/orders', { clientId: outside.id, lines: lines(p) })
        .expect(404);
      await as(pre)
        .post('/visits', {
          clientId: outside.id,
          startedAt: new Date().toISOString(),
          outcome: 'NO_SALE',
          reason: 'CLOSED',
        })
        .expect(404);
      await settings({ sellerScope: 'ALL_CLIENTS' });
    });

    it('can be put on a route, a commande and a client, never on a sale or a truck', async () => {
      const c = await newClient({ communeCode: BAB_EZZOUAR, assignedSellerId: pre.id });
      expect(c.assignedSeller?.id).toBe(pre.id);
      await as(d)
        .post('/routes', { name: 'Pré', sellerId: pre.id, weekdays: [1] }, null)
        .expect(201);
      await as(supA)
        .post('/visits', {
          clientId: c.id,
          sellerId: pre.id,
          startedAt: new Date().toISOString(),
          outcome: 'NO_SALE',
          reason: 'CLOSED',
        })
        .expect(201);
      const p = await product();
      await as(supA)
        .post('/orders', { clientId: c.id, sellerId: pre.id, lines: lines(p) })
        .expect(201);

      const sale = await as(d).post('/sales/quick', {
        type: 'BL',
        clientId: c.id,
        documentDate: algiersDay(),
        sellerId: pre.id,
        lines: lines(p),
      });
      expect(errorOf(sale).code).toBe(ErrorCode.SELLER_NOT_ALLOWED);
      const versement = (
        await as(d).post('/payments', { clientId: c.id, amount: '100' }).expect(201)
      ).body as { id: string };
      const paid = await as(d).patch(`/payments/${versement.id}/collector`, {
        collectedBy: pre.id,
        reason: 'Essai',
      });
      expect(errorOf(paid).code).toBe(ErrorCode.SELLER_NOT_ALLOWED);
      const truck = (
        await as(d)
          .post('/warehouses', { name: `Camion ${++seq}`, type: 'VEHICLE' }, null)
          .expect(201)
      ).body as WarehouseDto;
      const drive = await as(d).post(`/warehouses/${truck.id}/driver`, { userId: pre.id });
      expect(errorOf(drive).code).toBe(ErrorCode.SELLER_NOT_ALLOWED);
      const session = await as(d).post('/seller-sessions', { sellerId: pre.id });
      expect(errorOf(session).code).toBe(ErrorCode.SELLER_NOT_ALLOWED);

      const sellers = async (query: string) =>
        ((await as(supA).get(`/users/sellers${query}`).expect(200)).body as { id: string }[]).map(
          (u) => u.id,
        );
      expect(await sellers('')).not.toContain(pre.id);
      expect(await sellers('?orderTakers=true')).toContain(pre.id);
    });

    it('keeps his name on the BL when a livreur delivers his commande, once', async () => {
      const c = await newClient({ communeCode: BAB_EZZOUAR });
      const p = await product();
      const order = await confirmedOrder(pre, c.id, p);
      await as(supA).patch(`/orders/${order.id}/livreur`, { livreurId: livA.id }).expect(200);
      const key = randomUUID();
      const body = { lines: [{ orderLineId: order.lines[0]!.id, qty: '2' }] };
      const first = (await as(livA).post(`/orders/${order.id}/deliver`, body, key).expect(200))
        .body as DeliverOrderResultDto;
      const replay = (await as(livA).post(`/orders/${order.id}/deliver`, body, key).expect(200))
        .body as DeliverOrderResultDto;
      expect(replay.sale.id).toBe(first.sale.id);
      const row = await asTenant(d.tenantId, () =>
        t.prisma.db.sale.findUniqueOrThrow({ where: { id: first.sale.id } }),
      );
      expect(row.sellerId).toBe(pre.id);
    });
  });

  // ------------------------------------------------------------------ 6. deliverers

  describe('deliverers and livreur change', () => {
    const deliverers = async (by: Who) =>
      ((await as(by).get('/orders/deliverers').expect(200)).body as DelivererDto[]).map(
        (u) => u.id,
      );

    it('lists the caller’s team, or every team of his area', async () => {
      const a = await deliverers(supA);
      expect(a).toEqual(expect.arrayContaining([livA.id, sellerA.id]));
      expect(a).not.toContain(livB.id);
      expect(a).not.toContain(pre.id);
      const both = await deliverers(chef);
      expect(both).toEqual(expect.arrayContaining([livA.id, livB.id, sellerA.id, sellerB.id]));
      expect(await deliverers(chefWest)).toEqual([]);
      expect(await deliverers(d)).toEqual(expect.arrayContaining([livA.id, livB.id]));
    });

    it('refuses a livreur or a truck of another team', async () => {
      const c = await newClient({ communeCode: BAB_EZZOUAR });
      const p = await product();
      const order = await confirmedOrder(pre, c.id, p);
      const put = (by: Who, body: object) => as(by).patch(`/orders/${order.id}/livreur`, body);
      expect(errorOf(await put(supA, { livreurId: livB.id }).expect(403)).code).toBe(
        ErrorCode.FORBIDDEN,
      );
      const truck = (
        await as(d)
          .post('/warehouses', { name: `Camion ${++seq}`, type: 'VEHICLE' }, null)
          .expect(201)
      ).body as WarehouseDto;
      await as(d).post(`/warehouses/${truck.id}/driver`, { userId: livB.id }).expect(200);
      await put(supA, { deliveryVehicleId: truck.id }).expect(403);
      await put(chefWest, { livreurId: livA.id }).expect(404);
      await put(supB, { livreurId: livB.id }).expect(404);
      await put(chef, { livreurId: livB.id }).expect(200);
      await put(chef, { deliveryVehicleId: truck.id }).expect(200);
      await put(other, { livreurId: livA.id }).expect(404);
    });
  });

  // ------------------------------------------------------------------ 7. attribution

  describe('a sale counts for the team that made it', () => {
    const total = async (by: Who, query: string) =>
      (
        (
          await as(by)
            .get(`/reports/sales?from=${algiersDay()}&to=${algiersDay()}&groupBy=seller${query}`)
            .expect(200)
        ).body as { rows: { cells: Record<string, string> | string[] }[] }
      ).rows;

    it('team A selling in team B’s commune is team A’s figure, not B’s', async () => {
      const c = await newClient({ communeCode: EL_HARRACH });
      const p = await product();
      const s = await member(d, 'SELLER', supA.id);
      const bl = await sell(s, c.id, p);
      const mine = await total(d, `&teamOf=${supA.id}&sellerId=${s.id}`);
      expect(mine).toHaveLength(1);
      expect(JSON.stringify(mine)).toContain(bl.totalHt);
      expect(await total(d, `&teamOf=${supB.id}&sellerId=${s.id}`)).toEqual([]);
      expect(await total(supA, `&sellerId=${s.id}`)).toHaveLength(1);
      expect(await total(supB, `&sellerId=${s.id}`)).toEqual([]);
      expect(await total(chef, `&sellerId=${s.id}`)).toHaveLength(1);
      expect(await total(chefWest, `&sellerId=${s.id}`)).toEqual([]);
      const sales = async (by: Who) =>
        ((await as(by).get('/sales?limit=100').expect(200)).body as SalePage).items.map(
          (x) => x.id,
        );
      expect(await sales(supA)).toContain(bl.id);
      expect(await sales(supB)).not.toContain(bl.id);
    });

    it('keeps a chef de zone’s location filter inside his area', async () => {
      const outside = await newClient({ communeCode: ORAN });
      const p = await product();
      const driver = await member(d, 'SELLER', supA.id);
      const truck = (
        await as(d)
          .post('/warehouses', { name: `Camion ${++seq}`, type: 'VEHICLE' }, null)
          .expect(201)
      ).body as WarehouseDto;
      await as(d).post(`/warehouses/${truck.id}/driver`, { userId: driver.id }).expect(200);
      await tamper(
        t,
      )`UPDATE tenants SET "negativeStockMode" = 'ALLOW' WHERE id = ${d.tenantId}::uuid`;
      await as(d)
        .post('/sales/quick', {
          type: 'BL',
          clientId: outside.id,
          documentDate: algiersDay(),
          warehouseId: truck.id,
          sellerId: driver.id,
          lines: lines(p),
        })
        .expect(201);
      const caTtc = async (by: Who, query: string) => {
        const res = await as(by)
          .get(`/stats/distribution/overview?from=${algiersDay()}&to=${algiersDay()}${query}`)
          .expect(200);
        const body = res.body as { tiles: { measure: string; value: string }[] };
        return body.tiles.find((x) => x.measure === 'caTtc')!.value;
      };
      const onTruck = `&vehicleIds=${truck.id}`;
      // 2 × 1 000 HT + 19 %. The sale counts in his figures: his team made it...
      expect(await caTtc(chef, onTruck)).toBe('2380.00');
      // ...but a filter on a place outside his area finds nothing for him.
      expect(await caTtc(chef, `${onTruck}&clientCommunes=${ORAN}`)).toBe('0.00');
      expect(await caTtc(chef, `${onTruck}&clientWilayas=31`)).toBe('0.00');
      expect(await caTtc(d, `${onTruck}&clientCommunes=${ORAN}`)).toBe('2380.00');
      expect(await caTtc(supA, `${onTruck}&clientCommunes=${ORAN}`)).toBe('2380.00');
    });
  });

  // ------------------------------------------------------------------ 8. hierarchy

  describe('hierarchy', () => {
    const body = (u: Member, role: Role, managerId: string | null) => ({
      fullName: `Maj ${++seq}`,
      email: u.email,
      phone: null,
      role,
      managerId,
    });
    const change = (u: Member, role: Role, managerId: string | null) =>
      as(d).put(`/users/${u.id}`, body(u, role, managerId));

    it('puts a chef de zone under the office or nobody only', async () => {
      const am = await member(d, 'AREA_MANAGER');
      for (const boss of [sellerB, supB, chef]) {
        const res = await change(am, 'AREA_MANAGER', boss.id);
        // A seller manages nobody; a supervisor or chef de zone is not the office.
        expect(errorOf(res).code).toBe(
          boss === sellerB ? ErrorCode.VALIDATION_FAILED : ErrorCode.MANAGER_ROLE_NOT_ALLOWED,
        );
      }
      await change(am, 'AREA_MANAGER', manager.id).expect(200);
      await change(am, 'AREA_MANAGER', d.auth.user.id).expect(200);
      await change(am, 'AREA_MANAGER', null).expect(200);
      const invited = await as(d).post(
        '/users/invite',
        {
          fullName: 'Nouveau Chef',
          email: uniqueEmail('chef'),
          role: 'AREA_MANAGER',
          managerId: supA.id,
          mode: 'LINK',
        },
        null,
      );
      expect(errorOf(invited).code).toBe(ErrorCode.MANAGER_ROLE_NOT_ALLOWED);
    });

    it('refuses a cycle through a chef de zone', async () => {
      const am = await member(d, 'AREA_MANAGER');
      const sup = await member(d, 'SUPERVISOR', am.id);
      const sub = await member(d, 'SUPERVISOR', sup.id);
      const res = await change(sup, 'SUPERVISOR', sub.id);
      expect(errorOf(res).code).toBe(ErrorCode.MANAGER_CYCLE);
    });

    it('checks a role change against the manager kept, and the chefs reporting to him', async () => {
      const sup = await member(d, 'SUPERVISOR', chef.id);
      const res = await change(sup, 'AREA_MANAGER', chef.id);
      expect(errorOf(res).code).toBe(ErrorCode.MANAGER_ROLE_NOT_ALLOWED);
      const boss = await member(d, 'MANAGER');
      const am = await member(d, 'AREA_MANAGER', boss.id);
      const demoted = await change(boss, 'SUPERVISOR', null);
      expect(errorOf(demoted).code).toBe(ErrorCode.MANAGER_ROLE_NOT_ALLOWED);
      await change(am, 'AREA_MANAGER', null).expect(200);
      await change(boss, 'SUPERVISOR', null).expect(200);
    });

    it('shows a chef de zone his subtree', async () => {
      const tree = (await as(chef).get('/users/team').expect(200)).body as {
        id: string;
        members: { id: string }[];
      }[];
      expect(tree).toHaveLength(1);
      expect(tree[0]!.id).toBe(chef.id);
      expect(tree[0]!.members.map((m) => m.id)).toEqual(expect.arrayContaining([supA.id, supB.id]));
    });
  });

  // ------------------------------------------------------------------ 9. wilayas 59 to 69

  describe('communes of wilayas 59 to 69', () => {
    it('scopes a client whose gated code was written straight in the database', async () => {
      await settings({ sellerScope: 'BY_ZONE' });
      const c = await newClient();
      await tamper(
        t,
      )`UPDATE clients SET "wilayaCode" = 68, "communeCode" = ${BOU_SAADA} WHERE id = ${c.id}::uuid`;
      const z = await zone({ kind: 'CITY', wilayaCodes: [68] });
      const s = await member(d, 'SELLER', supA.id);
      await assign(d, s.id, { zoneId: z.id }).expect(201);
      expect(await clientIds(s)).toContain(c.id);
      await as(s).get(`/clients/${c.id}`).expect(200);
      const map = (await as(s).get('/clients/map').expect(200)).body as { withoutLocation: number };
      expect(map.withoutLocation).toBe((await clientIds(s)).length);
      await assign(d, s.id, { communeCodes: [ORAN] }).expect(201);
      expect(await clientIds(s)).not.toContain(c.id);
      await settings({ sellerScope: 'ALL_CLIENTS' });
    });
  });
});
