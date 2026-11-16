import { randomUUID } from 'node:crypto';
import * as argon2 from 'argon2';
import {
  Activity,
  algiersDay,
  type ApiError,
  type AssignDriverResultDto,
  type AuthResponse,
  type ClientDto,
  type ConvertRoutesResultDto,
  type DeliverOrderResultDto,
  ErrorCode,
  type OrderDto,
  type OrderPage,
  type ProductDto,
  type Role,
  type RouteDto,
  type SaleResultDto,
  type SellerSessionDto,
  type TodayDto,
  type TourneeReportDto,
  type VehicleAssignmentPage,
  type VehicleTypeDto,
  type VisitDto,
  type VisitPage,
  type WarehouseDto,
  weekdayOf,
  type WorkerVehiclePage,
} from '@erp/shared';
import { VehicleBackfillService } from '../src/stock/vehicle-backfill.service';
import { VehiclesService } from '../src/stock/vehicles.service';
import {
  asTenant,
  bearer,
  catalogOf,
  createTestApp,
  FakeClock,
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
 * Phase 36: the truck is the unit of distribution. Types and codes are the company's own;
 * the driver history is append-only and written with every driver change; a tournée
 * planned for a truck follows its driver of the day; visits and orders freeze the truck.
 */
describe('distribution par véhicule (phase 36)', () => {
  let t: TestApp;
  let clock: FakeClock;
  let d: RegisteredTenant;
  let other: RegisteredTenant;
  let essentiel: RegisteredTenant;
  let cat: TenantCatalog;
  let vehicles: VehiclesService;
  let seq = 0;
  const today = () => algiersDay(clock.now());

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
    put: (url: string, body: object) =>
      t
        .http()
        .put(url)
        .set(...bearer(who.auth.accessToken))
        .send(body),
  });

  /** A user created in the database. `depots: false` = he works in no dépôt (phase 24). */
  const member = async (
    who: RegisteredTenant,
    role: Role,
    options: { managerId?: string; depots?: boolean } = {},
  ): Promise<Member> => {
    const email = uniqueEmail(role.toLowerCase());
    const user = await asTenant(who.tenantId, async () =>
      t.prisma.db.user.create({
        data: {
          tenantId: who.tenantId,
          email,
          passwordHash: await argon2.hash('Password123!'),
          fullName: `${role} ${++seq}`,
          role,
          ...(options.managerId ? { managerId: options.managerId } : {}),
        },
      }),
    );
    if (options.depots !== false) await grantAllWarehouses(t, user.id);
    const login = await t
      .http()
      .post('/auth/login')
      // Each login from its own address: the login limiter is not what is tested here.
      .set('X-Forwarded-For', `10.36.${Math.floor(seq / 250)}.${(seq % 250) + 1}`)
      .send({ email, password: 'Password123!' })
      .expect(200);
    return { id: user.id, auth: login.body as AuthResponse };
  };

  const vehicleType = async (who: RegisteredTenant = d, body: object = {}) =>
    (
      await as(who)
        .post(
          '/vehicle-types',
          { code: `T${++seq}`, name: `Type ${seq}`, activity: 'CASH_VAN', ...body },
          null,
        )
        .expect(201)
    ).body as VehicleTypeDto;

  const truck = async (who: RegisteredTenant = d, body: object = {}) =>
    (
      await as(who)
        .post('/warehouses', { name: `Camion ${++seq}`, type: 'VEHICLE', ...body }, null)
        .expect(201)
    ).body as WarehouseDto;

  const drive = (by: Who, vehicleId: string, userId: string | null, reason?: string) =>
    as(by).post(`/warehouses/${vehicleId}/driver`, { userId, ...(reason ? { reason } : {}) });

  const warehouseOf = async (id: string, who: RegisteredTenant = d) =>
    ((await as(who).get('/warehouses').expect(200)).body as WarehouseDto[]).find(
      (w) => w.id === id,
    )!;

  const historyOf = async (vehicleId: string) =>
    (
      (await as(d).get(`/warehouses/${vehicleId}/assignments`).expect(200))
        .body as VehicleAssignmentPage
    ).items;

  const client = async (who: RegisteredTenant = d) =>
    (
      await as(who)
        .post('/clients', { code: `VC${++seq}`, name: `Client ${seq}` }, null)
        .expect(201)
    ).body as ClientDto;

  /** Carton of 24 pièces at 2 400 HT, 240 pièces opened in the main dépôt. */
  async function product(): Promise<Item> {
    const piece = cat.units['PIECE']!.id;
    const carton = cat.units['CARTON']!.id;
    const res = await as(d)
      .post(
        '/products',
        {
          reference: `V-${Date.now()}-${++seq}`,
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
          prices: cat.levels
            .slice(0, 3)
            .map((l) => ({ unitId: carton, priceLevelId: l.id, priceHt: '2400' })),
        },
        null,
      )
      .expect(201);
    const id = (res.body as ProductDto).id;
    await as(d)
      .post('/stock/opening', {
        lines: [{ productId: id, unitId: piece, qty: '240', unitCost: '80' }],
      })
      .expect(201);
    return { id, piece, carton };
  }

  const load = async (vehicleId: string, p: Item, cartons: string) => {
    const main = ((await as(d).get('/warehouses').expect(200)).body as WarehouseDto[]).find(
      (w) => w.isDefault,
    )!;
    const tr = (
      await as(d)
        .post('/stock-transfers', {
          type: 'LOAD',
          fromWarehouseId: main.id,
          toWarehouseId: vehicleId,
          lines: [{ productId: p.id, unitId: p.carton, qty: cartons }],
        })
        .expect(201)
    ).body as { id: string };
    await as(d).post(`/stock-transfers/${tr.id}/validate`).expect(200);
  };

  const noSaleVisit = (by: Who, clientId: string, extra: object = {}) =>
    as(by).post('/visits', {
      clientId,
      startedAt: clock.now().toISOString(),
      outcome: 'NO_SALE',
      reason: 'CLOSED',
      ...extra,
    });

  const vehicleRoute = async (vehicleId: string, clientIds: string[], by: Who = d) => {
    const route = (
      await as(by)
        .post(
          '/routes',
          { name: `Tournée ${++seq}`, vehicleId, weekdays: [weekdayOf(today())] },
          null,
        )
        .expect(201)
    ).body as RouteDto;
    await as(by).put(`/routes/${route.id}/stops`, { clientIds }).expect(200);
    return route;
  };

  const todayOf = async (who: Who) => (await as(who).get('/me/today').expect(200)).body as TodayDto;

  beforeAll(async () => {
    clock = new FakeClock();
    t = await createTestApp([], { clock });
    vehicles = t.app.get(VehiclesService);
    d = await registerTenant(t, 'Distrib Véhicules', { activity: Activity.DISTRIBUTEUR });
    other = await registerTenant(t, 'Autre Distrib', { activity: Activity.DISTRIBUTEUR });
    essentiel = await registerTenant(t, 'Grossiste Simple');
    await withoutGeoCheck(t, d);
    await withoutGeoCheck(t, other);
    cat = await catalogOf(t, d);
  });
  afterAll(() => t.close());

  describe('vehicle types', () => {
    it('creates, lists, updates and archives the types the company names itself', async () => {
      const created = await vehicleType(d, {
        code: 'SELF/MT',
        name: 'Self modern trade',
        codePrefix: 'VAN',
        activity: 'MIXED',
      });
      expect(created).toMatchObject({
        code: 'SELF/MT',
        codePrefix: 'VAN',
        activity: 'MIXED',
        active: true,
        vehicleCount: 0,
      });
      const updated = (
        await as(d)
          .patch(`/vehicle-types/${created.id}`, { name: 'Self MT', codePrefix: '' })
          .expect(200)
      ).body as VehicleTypeDto;
      expect(updated).toMatchObject({ name: 'Self MT', codePrefix: null, code: 'SELF/MT' });
      const list = (await as(d).get('/vehicle-types').expect(200)).body as VehicleTypeDto[];
      expect(list.map((x) => x.id)).toContain(created.id);

      await as(d).post(`/vehicle-types/${created.id}/archive`, {}, null).expect(204);
      const after = (await as(d).get('/vehicle-types').expect(200)).body as VehicleTypeDto[];
      expect(after.map((x) => x.id)).not.toContain(created.id);
      // Archived, never deleted.
      const row = await asTenant(d.tenantId, () =>
        t.prisma.db.vehicleType.findUniqueOrThrow({ where: { id: created.id } }),
      );
      expect(row.deletedAt).not.toBeNull();
      const audits = await asTenant(d.tenantId, () =>
        t.prisma.db.auditLog.findMany({
          where: { entity: 'VehicleType', entityId: created.id },
          select: { action: true },
          orderBy: { createdAt: 'asc' },
        }),
      );
      expect(audits.map((a) => a.action)).toEqual([
        'VEHICLE_TYPE_CREATED',
        'VEHICLE_TYPE_UPDATED',
        'VEHICLE_TYPE_ARCHIVED',
      ]);
    });

    it('keeps a code unique per company whatever the case; another company may reuse it', async () => {
      await vehicleType(d, { code: 'MXT' });
      const dup = await as(d)
        .post('/vehicle-types', { code: 'mxt', name: 'Autre', activity: 'PRESALE' }, null)
        .expect(409);
      expect(errorOf(dup).code).toBe(ErrorCode.VEHICLE_CODE_TAKEN);
      const hrc = await vehicleType(d, { code: 'HRC' });
      const renamed = await as(d).patch(`/vehicle-types/${hrc.id}`, { code: 'Mxt' }).expect(409);
      expect(errorOf(renamed).code).toBe(ErrorCode.VEHICLE_CODE_TAKEN);
      // Its own code in another case is not a clash.
      await as(d).patch(`/vehicle-types/${hrc.id}`, { code: 'hrc' }).expect(200);
      await vehicleType(other, { code: 'MXT' });
      // An archived type frees its code.
      await as(d).post(`/vehicle-types/${hrc.id}/archive`, {}, null).expect(204);
      await vehicleType(d, { code: 'HRC' });
    });

    it('refuses to archive a type a live truck has', async () => {
      const type = await vehicleType();
      const v = await truck(d, { vehicleTypeId: type.id });
      const res = await as(d).post(`/vehicle-types/${type.id}/archive`, {}, null).expect(409);
      expect(errorOf(res).code).toBe(ErrorCode.VEHICLE_TYPE_IN_USE);
      await as(d).patch(`/warehouses/${v.id}`, { vehicleTypeId: null }).expect(200);
      await as(d).post(`/vehicle-types/${type.id}/archive`, {}, null).expect(204);
      // An archived type can no longer be given to a truck.
      const gone = await as(d).patch(`/warehouses/${v.id}`, { vehicleTypeId: type.id }).expect(404);
      expect(errorOf(gone).code).toBe(ErrorCode.VEHICLE_TYPE_NOT_FOUND);
    });
  });

  describe('vehicle identity', () => {
    it('stores code, type, wilaya, plate and capacity, and filters the list on them', async () => {
      const type = await vehicleType(d, { code: `MX${++seq}`, activity: 'CASH_VAN' });
      const code = `VAN-28 MXT ${++seq}`;
      const v = await truck(d, {
        code,
        vehicleTypeId: type.id,
        wilayaCode: 28,
        plateNumber: `00${seq} 120 28`,
        capacityKg: 3500,
      });
      expect(v).toMatchObject({
        code,
        wilayaCode: 28,
        capacityKg: 3500,
        vehicleType: { id: type.id, code: type.code, activity: 'CASH_VAN' },
      });
      await truck(d, { wilayaCode: 5 });
      const list = async (query: string) =>
        ((await as(d).get(`/warehouses?${query}`).expect(200)).body as WarehouseDto[]).map(
          (w) => w.id,
        );
      expect(await list(`type=VEHICLE&vehicleTypeId=${type.id}`)).toEqual([v.id]);
      expect(await list('type=VEHICLE&wilayaCode=28')).toContain(v.id);
      expect(await list('wilayaCode=5')).not.toContain(v.id);
      expect(await list(`search=${encodeURIComponent(code.toLowerCase())}`)).toEqual([v.id]);
      expect(await list(`search=${encodeURIComponent(v.plateNumber!)}`)).toEqual([v.id]);
      expect(await list('type=MAIN')).not.toContain(v.id);
    });

    it('keeps a code unique among the live dépôts and trucks of a company, any case', async () => {
      const code = `LIV 28 MIX ${++seq}`;
      const first = await truck(d, { code });
      const dup = await as(d)
        .post(
          '/warehouses',
          { name: `Camion ${++seq}`, type: 'VEHICLE', code: code.toLowerCase() },
          null,
        )
        .expect(409);
      expect(errorOf(dup).code).toBe(ErrorCode.VEHICLE_CODE_TAKEN);
      const depot = (
        await as(d)
          .post('/warehouses', { name: `Dépôt ${++seq}`, type: 'SECONDARY' }, null)
          .expect(201)
      ).body as WarehouseDto;
      const clash = await as(d).patch(`/warehouses/${depot.id}`, { code }).expect(409);
      expect(errorOf(clash).code).toBe(ErrorCode.VEHICLE_CODE_TAKEN);
      await truck(other, { code });
      // The database holds the rule too (partial unique index on lower(code)).
      await expect(
        tamper(t)`UPDATE warehouses SET code = ${code.toUpperCase()} WHERE id = ${depot.id}::uuid`,
      ).rejects.toThrow();
      expect(first.code).toBe(code);
    });

    it('lets a dépôt have a code, and refuses the truck fields on it', async () => {
      const depot = (
        await as(d)
          .post(
            '/warehouses',
            { name: `Dépôt ${++seq}`, type: 'SECONDARY', code: `CDD BATNA ${seq}` },
            null,
          )
          .expect(201)
      ).body as WarehouseDto;
      expect(depot.code).toBe(`CDD BATNA ${seq}`);
      for (const body of [{ wilayaCode: 5 }, { plateNumber: '1 120 05' }, { capacityKg: 900 }]) {
        const res = await as(d).patch(`/warehouses/${depot.id}`, body).expect(400);
        expect(errorOf(res).code).toBe(ErrorCode.VEHICLE_FIELDS_ON_DEPOT);
      }
      await as(d)
        .post('/warehouses', { name: `Dépôt ${++seq}`, type: 'SECONDARY', wilayaCode: 5 }, null)
        .expect(400);
      // The database refuses them as well.
      await expect(
        tamper(t)`UPDATE warehouses SET "wilayaCode" = 5 WHERE id = ${depot.id}::uuid`,
      ).rejects.toThrow();
      const v = await truck();
      await expect(
        tamper(t)`UPDATE warehouses SET "wilayaCode" = 70 WHERE id = ${v.id}::uuid`,
      ).rejects.toThrow();
      await expect(
        tamper(t)`UPDATE warehouses SET "capacityKg" = 0 WHERE id = ${v.id}::uuid`,
      ).rejects.toThrow();
    });
  });

  describe('drivers and their history', () => {
    it('writes a history row with every change of driver: create, update, quick change, archive', async () => {
      const [a, b] = [await member(d, 'SELLER'), await member(d, 'SELLER')];
      const v = await truck(d, { assignedUserId: a.id });
      expect((await historyOf(v.id)).map((h) => h.user?.id ?? null)).toEqual([a.id]);

      await as(d).patch(`/warehouses/${v.id}`, { assignedUserId: null }).expect(200);
      await as(d)
        .patch(`/warehouses/${v.id}`, { name: `Renommé ${++seq}` })
        .expect(200);
      expect((await historyOf(v.id)).map((h) => h.user?.id ?? null)).toEqual([null, a.id]);

      const res = (await drive(d, v.id, b.id, 'Remplacement').expect(200))
        .body as AssignDriverResultDto;
      expect(res).toMatchObject({ driver: { id: b.id }, previousDriver: null, freedVehicle: null });
      // The same driver again changes nothing and writes nothing.
      await drive(d, v.id, b.id).expect(200);
      const history = await historyOf(v.id);
      expect(history.map((h) => h.user?.id ?? null)).toEqual([b.id, null, a.id]);
      expect(history[0]).toMatchObject({ reason: 'Remplacement', setBy: { id: d.auth.user.id } });
      expect((await warehouseOf(v.id)).assignedUser?.id).toBe(b.id);

      await as(d).get(`/warehouses`).expect(200);
      await t
        .http()
        .delete(`/warehouses/${v.id}`)
        .set(...bearer(d.auth.accessToken))
        .expect(204);
      const rows = await asTenant(d.tenantId, () =>
        t.prisma.db.vehicleAssignment.findMany({
          where: { vehicleId: v.id },
          orderBy: [{ fromAt: 'asc' }, { createdAt: 'asc' }],
          select: { userId: true },
        }),
      );
      expect(rows.map((r) => r.userId)).toEqual([a.id, null, b.id, null]);
      const audits = await asTenant(d.tenantId, () =>
        t.prisma.db.auditLog.count({
          where: { action: 'VEHICLE_DRIVER_CHANGED', entityId: v.id },
        }),
      );
      expect(audits).toBe(4);
    });

    it('never updates or deletes a history row (database trigger)', async () => {
      const a = await member(d, 'SELLER');
      const v = await truck(d, { assignedUserId: a.id });
      await expect(
        tamper(t)`UPDATE vehicle_assignments SET reason = 'x' WHERE "vehicleId" = ${v.id}::uuid`,
      ).rejects.toThrow(/append-only/);
      await expect(
        tamper(t)`DELETE FROM vehicle_assignments WHERE "vehicleId" = ${v.id}::uuid`,
      ).rejects.toThrow(/append-only/);
      await expect(
        asTenant(d.tenantId, () =>
          t.prisma.db.vehicleAssignment.updateMany({
            where: { vehicleId: v.id },
            data: { reason: 'x' },
          }),
        ),
      ).rejects.toThrow();
    });

    it('writes the row in the same transaction as the change: a rollback leaves none', async () => {
      const a = await member(d, 'SELLER');
      const v = await truck();
      await expect(
        asTenant(d.tenantId, () =>
          t.prisma.db.$transaction(async (tx) => {
            await vehicles.assignDriver(tx, { vehicleId: v.id, userId: a.id, moveDriver: true });
            throw new Error('the business operation failed after the driver change');
          }),
        ),
      ).rejects.toThrow('the business operation failed');
      expect(await historyOf(v.id)).toEqual([]);
      expect((await warehouseOf(v.id)).assignedUser).toBeNull();
    });

    it('moves a driver who has another truck and frees it, two rows in one go', async () => {
      const a = await member(d, 'SELLER');
      const v1 = await truck(d, { assignedUserId: a.id, code: `OLD ${++seq}` });
      const v2 = await truck();
      // The dépôt form still refuses to take a driver off another truck silently.
      const refused = await as(d)
        .patch(`/warehouses/${v2.id}`, { assignedUserId: a.id })
        .expect(409);
      expect(errorOf(refused).code).toBe(ErrorCode.VEHICLE_ALREADY_ASSIGNED);

      const res = (await drive(d, v2.id, a.id).expect(200)).body as AssignDriverResultDto;
      expect(res.freedVehicle).toMatchObject({ id: v1.id, code: v1.code });
      expect((await warehouseOf(v1.id)).assignedUser).toBeNull();
      expect((await warehouseOf(v2.id)).assignedUser?.id).toBe(a.id);
      expect((await historyOf(v1.id)).map((h) => h.user?.id ?? null)).toEqual([null, a.id]);
      expect((await historyOf(v2.id)).map((h) => h.user?.id ?? null)).toEqual([a.id]);
    });

    it('refuses a user who cannot drive, and a dépôt as a truck', async () => {
      const keeper = await member(d, 'STOREKEEPER');
      const v = await truck();
      const res = await drive(d, v.id, keeper.id).expect(422);
      expect(errorOf(res).code).toBe(ErrorCode.SELLER_NOT_ALLOWED);
      // A livreur drives a delivery truck.
      const livreur = await member(d, 'LIVREUR');
      await drive(d, v.id, livreur.id).expect(200);
      const depot = (
        await as(d)
          .post('/warehouses', { name: `Dépôt ${++seq}`, type: 'SECONDARY' }, null)
          .expect(201)
      ).body as WarehouseDto;
      const notTruck = await drive(d, depot.id, livreur.id).expect(422);
      expect(errorOf(notTruck).code).toBe(ErrorCode.WAREHOUSE_INVALID);
    });

    it('blocks the change while the day of the old driver on that truck is open', async () => {
      const [a, b] = [await member(d, 'SELLER'), await member(d, 'SELLER')];
      const v = await truck(d, { assignedUserId: a.id });
      const spare = await truck();
      const session = (await as(d).post('/seller-sessions', { sellerId: a.id }).expect(201))
        .body as SellerSessionDto;
      expect(session.warehouse?.id).toBe(v.id);

      for (const res of [
        await drive(d, v.id, b.id).expect(409),
        await drive(d, v.id, null).expect(409),
        // Moving him to another truck would leave this one too.
        await drive(d, spare.id, a.id).expect(409),
        await as(d).patch(`/warehouses/${v.id}`, { assignedUserId: null }).expect(409),
      ]) {
        expect(errorOf(res).code).toBe(ErrorCode.SESSION_OPEN_ON_VEHICLE);
      }
      expect((await warehouseOf(v.id)).assignedUser?.id).toBe(a.id);
      expect(await historyOf(v.id)).toHaveLength(1);

      await as(d).post(`/seller-sessions/${session.id}/close`, { handedCash: '0' }).expect(200);
      await drive(d, v.id, b.id).expect(200);
      expect((await warehouseOf(v.id)).assignedUser?.id).toBe(b.id);
    });

    // The two SQL rules of test-36 (e2e/sql/vehicles-history.sql), on this company.
    const driversWhoCannotDrive = () =>
      asTenant(d.tenantId, () =>
        t.prisma.db.$queryRaw<{ id: string }[]>`
          SELECT w.id FROM warehouses w JOIN users u ON u.id = w."assignedUserId"
          WHERE w."tenantId" = ${d.tenantId}::uuid AND w.type = 'VEHICLE' AND w."deletedAt" IS NULL
            AND (u."deletedAt" IS NOT NULL
              OR u.role NOT IN ('OWNER', 'MANAGER', 'SUPERVISOR', 'SELLER', 'LIVREUR'))`,
      );
    const visitsOffTheirSaleTruck = () =>
      asTenant(d.tenantId, () =>
        t.prisma.db.$queryRaw<{ id: string }[]>`
          SELECT v.id FROM visits v
          JOIN sales s ON s.id = v."saleId"
          JOIN warehouses sw ON sw.id = s."warehouseId"
          WHERE v."tenantId" = ${d.tenantId}::uuid AND s."sellerId" = v."sellerId"
            AND ((sw.type = 'VEHICLE' AND v."vehicleId" IS DISTINCT FROM s."warehouseId")
              OR (sw.type <> 'VEHICLE' AND v."vehicleId" IS NOT NULL))`,
      );

    it('a truck switched off frees its driver: the sale, the visit and the order agree', async () => {
      // Test-36 A-1.
      const x = await member(d, 'SELLER');
      const v = await truck(d, { assignedUserId: x.id });
      const [c, p] = [await client(), await product()];
      await load(v.id, p, '2');

      // Refused while his day on it is open; nothing is written.
      const session = (await as(d).post('/seller-sessions', { sellerId: x.id }).expect(201))
        .body as SellerSessionDto;
      const refused = await as(d).patch(`/warehouses/${v.id}`, { active: false }).expect(409);
      expect(errorOf(refused).code).toBe(ErrorCode.SESSION_OPEN_ON_VEHICLE);
      expect(await warehouseOf(v.id)).toMatchObject({ active: true, assignedUser: { id: x.id } });
      await as(d).post(`/seller-sessions/${session.id}/close`, { handedCash: '0' }).expect(200);

      await as(d).patch(`/warehouses/${v.id}`, { active: false }).expect(200);
      expect(await warehouseOf(v.id)).toMatchObject({ active: false, assignedUser: null });
      const history = await historyOf(v.id);
      expect(history.map((h) => h.user?.id ?? null)).toEqual([null, x.id]);
      // Switching it off again writes nothing.
      await as(d).patch(`/warehouses/${v.id}`, { active: false }).expect(200);
      expect(await historyOf(v.id)).toHaveLength(2);

      // One answer to "which truck was he on": none.
      const sale = (
        await as(x)
          .post('/sales/quick', {
            documentDate: today(),
            clientId: c.id,
            lines: [{ productId: p.id, unitId: p.carton, qty: '1' }],
            paidAmount: '2856',
          })
          .expect(201)
      ).body as SaleResultDto;
      const visit = (
        await as(x)
          .post('/visits', {
            clientId: c.id,
            startedAt: clock.now().toISOString(),
            outcome: 'SALE',
            saleId: sale.sale.id,
          })
          .expect(201)
      ).body as VisitDto;
      const order = (
        await as(x)
          .post('/orders', {
            clientId: c.id,
            lines: [{ productId: p.id, unitId: p.carton, qty: '1' }],
          })
          .expect(201)
      ).body as OrderDto;
      const soldFrom = await asTenant(d.tenantId, () =>
        t.prisma.db.sale.findUniqueOrThrow({
          where: { id: sale.sale.id },
          select: { warehouse: { select: { isDefault: true } } },
        }),
      );
      expect(soldFrom.warehouse?.isDefault).toBe(true);
      expect(visit.vehicle).toBeNull();
      expect(order.vehicle).toBeNull();
      expect((await todayOf(x)).vehicle).toBeNull();
      expect(await visitsOffTheirSaleTruck()).toEqual([]);

      // A truck that is off takes no driver, by either path; switched on again it does.
      for (const res of [
        await drive(d, v.id, x.id).expect(422),
        await as(d).patch(`/warehouses/${v.id}`, { assignedUserId: x.id }).expect(422),
        await as(d)
          .patch(`/warehouses/${v.id}`, { active: false, assignedUserId: x.id })
          .expect(422),
      ]) {
        expect(errorOf(res)).toMatchObject({
          code: ErrorCode.WAREHOUSE_INVALID,
          details: { rule: 'inactive' },
        });
      }
      await as(d).patch(`/warehouses/${v.id}`, { active: true, assignedUserId: x.id }).expect(200);
      expect(await warehouseOf(v.id)).toMatchObject({ active: true, assignedUser: { id: x.id } });
    });

    it('a user deactivated, or moved to a role that cannot drive, leaves his truck', async () => {
      // Test-36 A-3.
      const [gone, demoted, busy] = [
        await member(d, 'SELLER'),
        await member(d, 'SELLER'),
        await member(d, 'SELLER'),
      ];
      const [v1, v2, v3] = [
        await truck(d, { assignedUserId: gone.id }),
        await truck(d, { assignedUserId: demoted.id }),
        await truck(d, { assignedUserId: busy.id }),
      ];

      await as(d).post(`/users/${gone.id}/deactivate`, {}, null).expect(200);
      expect((await warehouseOf(v1.id)).assignedUser).toBeNull();
      expect((await historyOf(v1.id)).map((h) => h.user?.id ?? null)).toEqual([null, gone.id]);

      const profile = async (id: string) => {
        const u = (await as(d).get(`/users/${id}`).expect(200)).body as {
          fullName: string;
          email: string | null;
          phone: string | null;
        };
        return { fullName: u.fullName, email: u.email, phone: u.phone };
      };
      // A role that still drives keeps the truck, and writes no row.
      await as(d)
        .put(`/users/${demoted.id}`, { ...(await profile(demoted.id)), role: 'LIVREUR' })
        .expect(200);
      expect((await warehouseOf(v2.id)).assignedUser?.id).toBe(demoted.id);
      expect(await historyOf(v2.id)).toHaveLength(1);
      await as(d)
        .put(`/users/${demoted.id}`, { ...(await profile(demoted.id)), role: 'STOREKEEPER' })
        .expect(200);
      expect((await warehouseOf(v2.id)).assignedUser).toBeNull();
      expect((await historyOf(v2.id)).map((h) => h.user?.id ?? null)).toEqual([null, demoted.id]);

      // Refused while his day on the truck is open: the money is counted first.
      const session = (await as(d).post('/seller-sessions', { sellerId: busy.id }).expect(201))
        .body as SellerSessionDto;
      for (const res of [
        await as(d).post(`/users/${busy.id}/deactivate`, {}, null).expect(409),
        await as(d)
          .put(`/users/${busy.id}`, { ...(await profile(busy.id)), role: 'STOREKEEPER' })
          .expect(409),
      ]) {
        expect(errorOf(res).code).toBe(ErrorCode.SESSION_OPEN_ON_VEHICLE);
      }
      const still = (await as(d).get(`/users/${busy.id}`).expect(200)).body as {
        active: boolean;
        role: Role;
      };
      expect(still).toMatchObject({ active: true, role: 'SELLER' });
      expect((await warehouseOf(v3.id)).assignedUser?.id).toBe(busy.id);
      await as(d).post(`/seller-sessions/${session.id}/close`, { handedCash: '0' }).expect(200);
      await as(d).post(`/users/${busy.id}/deactivate`, {}, null).expect(200);
      expect((await warehouseOf(v3.id)).assignedUser).toBeNull();

      expect(await driversWhoCannotDrive()).toEqual([]);
    });

    it('a driver change replayed after a later change returns the first answer and writes nothing', async () => {
      // Test-36 B-4: a phone retrying after a lost answer must not undo a later decision.
      const [x, y] = [await member(d, 'SELLER'), await member(d, 'SELLER')];
      const v = await truck();
      const key = randomUUID();
      const send = (userId: string, k: string | null) =>
        as(d).post(`/warehouses/${v.id}/driver`, { userId }, k);
      const first = await send(x.id, key).expect(200);
      await send(y.id, randomUUID()).expect(200);
      const replay = await send(x.id, key).expect(200);
      expect(replay.headers['idempotent-replayed']).toBe('true');
      expect(replay.body).toEqual(first.body);
      expect((await warehouseOf(v.id)).assignedUser?.id).toBe(y.id);
      expect((await historyOf(v.id)).map((h) => h.user?.id)).toEqual([y.id, x.id]);
      // The key is required, and names one request.
      expect(errorOf(await send(x.id, null).expect(400)).code).toBe(
        ErrorCode.IDEMPOTENCY_KEY_REQUIRED,
      );
      expect((await send(y.id, key)).status).toBeGreaterThanOrEqual(400);
      expect(await historyOf(v.id)).toHaveLength(2);

      // Both converts take the key too: a replay is the same answer, one audit row.
      const route = (
        await as(d)
          .post('/routes', { name: `Rejouée ${++seq}`, sellerId: y.id, weekdays: [4] }, null)
          .expect(201)
      ).body as RouteDto;
      const k2 = randomUUID();
      const c1 = await as(d).post(`/routes/${route.id}/convert-to-vehicle`, {}, k2).expect(200);
      const c2 = await as(d).post(`/routes/${route.id}/convert-to-vehicle`, {}, k2).expect(200);
      expect(c2.headers['idempotent-replayed']).toBe('true');
      expect(c2.body).toEqual(c1.body);
      const k3 = randomUUID();
      const b1 = await as(d).post('/routes/convert-to-vehicle', {}, k3).expect(200);
      const b2 = await as(d).post('/routes/convert-to-vehicle', {}, k3).expect(200);
      expect(b2.headers['idempotent-replayed']).toBe('true');
      expect(b2.body).toEqual(b1.body);
      expect(
        await asTenant(d.tenantId, () =>
          t.prisma.db.auditLog.count({
            where: { action: 'ROUTE_CONVERTED', entityId: route.id },
          }),
        ),
      ).toBe(1);
      for (const url of [`/routes/${route.id}/convert-to-vehicle`, '/routes/convert-to-vehicle']) {
        expect(errorOf(await as(d).post(url, {}, null).expect(400)).code).toBe(
          ErrorCode.IDEMPOTENCY_KEY_REQUIRED,
        );
      }
    });

    it('refuses the change while the driver holds cash no clôture counted, whatever truck his day names', async () => {
      // Test-36 A-4: one clôture per seller per day, so the cash of a second truck (or of a
      // day opened before he had a truck) was in no count and nothing asked for it.
      const a = await member(d, 'SELLER');
      const [s1, s2] = [await truck(d, { assignedUserId: a.id }), await truck()];
      const [c, p] = [await client(), await product()];
      await load(s1.id, p, '2');
      await load(s2.id, p, '2');
      const sellCash = () =>
        as(a)
          .post('/sales/quick', {
            documentDate: today(),
            clientId: c.id,
            lines: [{ productId: p.id, unitId: p.carton, qty: '1' }],
            paidAmount: '2856',
            paymentMode: 'ESPECES',
          })
          .expect(201);

      await sellCash();
      const session = (await as(d).post('/seller-sessions', { sellerId: a.id }).expect(201))
        .body as SellerSessionDto;
      await as(d).post(`/seller-sessions/${session.id}/close`, { handedCash: '2856' }).expect(200);
      // Closed and counted: he moves to the second truck.
      await drive(d, s2.id, a.id).expect(200);
      await sellCash();
      // The same closed session comes back: the afternoon has no clôture of its own.
      const again = (await as(d).post('/seller-sessions', { sellerId: a.id })).body as {
        id: string;
        status: string;
      };
      expect(again).toMatchObject({ id: session.id, status: 'CLOSED' });

      for (const res of [
        await drive(d, s2.id, null).expect(409),
        await drive(d, s1.id, a.id).expect(409),
        await as(d).patch(`/warehouses/${s2.id}`, { assignedUserId: null }).expect(409),
        await as(d).patch(`/warehouses/${s2.id}`, { active: false }).expect(409),
        await as(d).post(`/users/${a.id}/deactivate`, {}, null).expect(409),
      ]) {
        expect(errorOf(res)).toMatchObject({
          code: ErrorCode.CASH_AFTER_CLOSING,
          details: { sessionId: session.id, date: today(), amount: '2856.00', userId: a.id },
        });
      }
      expect((await warehouseOf(s2.id)).assignedUser?.id).toBe(a.id);
      // The new count is a correction of the clôture; then nothing is left uncounted.
      await as(d)
        .post(`/seller-sessions/${session.id}/adjust`, {
          handedCash: '5712',
          note: 'Encaissé sur le second camion',
        })
        .expect(201);
      await drive(d, s2.id, null).expect(200);

      // A day opened before he had a truck names no truck: it blocks all the same.
      const b = await member(d, 'SELLER');
      const early = (await as(d).post('/seller-sessions', { sellerId: b.id }).expect(201))
        .body as SellerSessionDto;
      expect(early.warehouse).toBeNull();
      // Getting a truck is not leaving one.
      await drive(d, s1.id, b.id).expect(200);
      const blocked = await drive(d, s1.id, null).expect(409);
      expect(errorOf(blocked).code).toBe(ErrorCode.SESSION_OPEN_ON_VEHICLE);
      await as(d).post(`/seller-sessions/${early.id}/close`, { handedCash: '0' }).expect(200);
      await drive(d, s1.id, null).expect(200);

      // A company that never does a clôture is not held by its cash.
      const free = await member(d, 'SELLER');
      await drive(d, s1.id, free.id).expect(200);
      await as(free)
        .post('/sales/quick', {
          documentDate: today(),
          clientId: c.id,
          lines: [{ productId: p.id, unitId: p.carton, qty: '1' }],
          paidAmount: '2856',
          paymentMode: 'ESPECES',
        })
        .expect(201);
      await drive(d, s1.id, null).expect(200);
    });

    it('two changes of the same truck at once end in one consistent state', async () => {
      const [a, b] = [await member(d, 'SELLER'), await member(d, 'SELLER')];
      const v = await truck();
      const results = await Promise.all([drive(d, v.id, a.id), drive(d, v.id, b.id)]);
      expect(results.map((r) => r.status)).toEqual([200, 200]);
      const history = await historyOf(v.id);
      expect(history.map((h) => h.user?.id).sort()).toEqual([a.id, b.id].sort());
      // The truck's driver is the one the last row names.
      expect((await warehouseOf(v.id)).assignedUser?.id).toBe(history[0]!.user!.id);
      expect(new Set(history.map((h) => h.fromAt)).size).toBe(2);
    });

    it('one driver given two trucks at once ends with exactly one truck', async () => {
      const a = await member(d, 'SELLER');
      const [v1, v2] = [await truck(), await truck()];
      const results = await Promise.all([drive(d, v1.id, a.id), drive(d, v2.id, a.id)]);
      for (const r of results) expect([200, 409]).toContain(r.status);
      const mine = (
        (await as(d).get('/warehouses?type=VEHICLE').expect(200)).body as WarehouseDto[]
      ).filter((w) => w.assignedUser?.id === a.id);
      expect(mine).toHaveLength(1);
      // The history agrees with the trucks: the last row of each names its driver.
      for (const v of [v1, v2]) {
        const last = (await historyOf(v.id))[0];
        expect(last?.user?.id ?? null).toBe((await warehouseOf(v.id)).assignedUser?.id ?? null);
      }
    });

    it('lets a supervisor change the drivers of his trucks only, and never a seller', async () => {
      const sup = await member(d, 'SUPERVISOR', { depots: false });
      const mine = await member(d, 'SELLER', { managerId: sup.id });
      const stranger = await member(d, 'SELLER');
      const myTruck = await truck(d, { assignedUserId: mine.id });
      const farTruck = await truck(d, { assignedUserId: stranger.id });

      const denied = await drive(mine, myTruck.id, null).expect(403);
      expect(errorOf(denied).code).toBe(ErrorCode.FORBIDDEN);
      // A truck outside his reach is not there for him.
      const far = await drive(sup, farTruck.id, mine.id).expect(404);
      expect(errorOf(far).code).toBe(ErrorCode.WAREHOUSE_NOT_FOUND);
      // He puts his own people on his trucks, nobody else.
      const notMine = await drive(sup, myTruck.id, stranger.id).expect(403);
      expect(errorOf(notMine).code).toBe(ErrorCode.FORBIDDEN);
      await drive(sup, myTruck.id, sup.id).expect(200);
      expect((await warehouseOf(farTruck.id)).assignedUser?.id).toBe(stranger.id);
    });

    it("gives a worker's vehicle history as periods, to himself and to who sees him", async () => {
      const sup = await member(d, 'SUPERVISOR', { depots: false });
      const a = await member(d, 'SELLER', { managerId: sup.id });
      const b = await member(d, 'SELLER');
      const outsider = await member(d, 'SUPERVISOR', { depots: false });
      const type = await vehicleType();
      const v1 = await truck(d, {
        assignedUserId: a.id,
        code: `H1 ${++seq}`,
        vehicleTypeId: type.id,
      });
      const v2 = await truck(d, { code: `H2 ${++seq}` });
      await drive(d, v2.id, a.id).expect(200); // a leaves truck 1 for truck 2
      await drive(d, v2.id, b.id).expect(200); // truck 2 goes to b

      const of = async (who: Who, userId: string, query = '') =>
        (await as(who).get(`/users/${userId}/vehicle-assignments${query}`).expect(200))
          .body as WorkerVehiclePage;
      const mine = await of(a, a.id);
      expect(mine.items.map((p) => p.vehicle.id)).toEqual([v2.id, v1.id]);
      const [onV2, onV1] = mine.items;
      expect(onV1!.toAt).not.toBeNull();
      expect(onV2!.toAt).not.toBeNull();
      // Truck 1 ends when he was taken off it, truck 2 when b got it.
      expect(onV1!.toAt).toBe((await historyOf(v1.id))[0]!.fromAt);
      expect(onV2!.toAt).toBe((await historyOf(v2.id))[0]!.fromAt);
      expect(new Date(onV1!.fromAt).getTime()).toBeLessThan(new Date(onV1!.toAt!).getTime());
      expect(new Date(onV2!.fromAt).getTime()).toBeLessThanOrEqual(new Date(onV2!.toAt!).getTime());
      expect(onV1!.vehicle).toMatchObject({
        code: v1.code,
        type: { code: type.code, name: type.name },
        inReach: true,
      });
      expect(onV2!.setBy?.id).toBe(d.auth.user.id);

      const theirs = await of(d, b.id);
      expect(theirs.items).toHaveLength(1);
      expect(theirs.items[0]).toMatchObject({ vehicle: { id: v2.id }, toAt: null });

      // Cursor pagination, newest first.
      const page1 = await of(d, a.id, '?limit=1');
      expect(page1.items.map((p) => p.vehicle.id)).toEqual([v2.id]);
      const page2 = await of(d, a.id, `?limit=1&cursor=${page1.nextCursor}`);
      expect(page2.items.map((p) => p.vehicle.id)).toEqual([v1.id]);
      expect(page2.nextCursor).toBeNull();

      // His supervisor reads it; trucks outside the reader's dépôts come without a link.
      const bySup = await of(sup, a.id);
      expect(bySup.items.map((p) => p.vehicle.code)).toEqual([v2.code, v1.code]);
      expect(bySup.items.every((p) => !p.vehicle.inReach)).toBe(true);
      // A supervisor who does not manage him, and another seller, do not.
      for (const who of [outsider, b]) {
        const res = await as(who).get(`/users/${a.id}/vehicle-assignments`).expect(403);
        expect(errorOf(res).code).toBe(ErrorCode.FORBIDDEN);
      }
      // Never drove one: an empty list.
      expect((await of(outsider, outsider.id)).items).toEqual([]);
    });
  });

  describe('tournées per vehicle', () => {
    it('plans a tournée for a truck: its driver of the day sees it, the previous one no longer', async () => {
      const [a, b] = [await member(d, 'SELLER'), await member(d, 'SELLER')];
      const v = await truck(d, {
        assignedUserId: a.id,
        code: `VAN-28 MXT ${++seq}`,
        wilayaCode: 28,
      });
      const [c1, c2] = [await client(), await client()];
      const route = await vehicleRoute(v.id, [c1.id, c2.id]);
      expect(route).toMatchObject({ seller: null, vehicle: { id: v.id, code: v.code } });
      const read = (await as(d).get(`/routes/${route.id}`).expect(200)).body as RouteDto;
      expect(read.vehicle?.driver?.id).toBe(a.id);
      // An old seller route of a still works.
      const c3 = await client();
      const old = (
        await as(d)
          .post(
            '/routes',
            { name: `Ancienne ${++seq}`, sellerId: a.id, weekdays: [weekdayOf(today())] },
            null,
          )
          .expect(201)
      ).body as RouteDto;
      await as(d)
        .put(`/routes/${old.id}/stops`, { clientIds: [c3.id] })
        .expect(200);

      const before = await todayOf(a);
      expect(before.vehicle).toMatchObject({ id: v.id, code: v.code, wilayaCode: 28 });
      expect(before.stops.map((s) => s.client.id).sort()).toEqual([c1.id, c2.id, c3.id].sort());
      expect((await todayOf(b)).stops).toEqual([]);

      // The driver changes: no route is edited.
      await drive(d, v.id, b.id).expect(200);
      const forB = await todayOf(b);
      expect(forB.vehicle?.id).toBe(v.id);
      expect(forB.stops.map((s) => s.client.id)).toEqual([c1.id, c2.id]);
      expect(forB.routes.map((r) => r.id)).toEqual([route.id]);
      const forA = await todayOf(a);
      expect(forA.vehicle).toBeNull();
      expect(forA.stops.map((s) => s.client.id)).toEqual([c3.id]);
      // b reads the route of his truck, a no longer does.
      await as(b).get(`/routes/${route.id}`).expect(200);
      await as(a).get(`/routes/${route.id}`).expect(404);
      const unchanged = await asTenant(d.tenantId, () =>
        t.prisma.db.auditLog.count({
          where: { entity: 'Route', entityId: route.id, action: 'ROUTE_UPDATED' },
        }),
      );
      expect(unchanged).toBe(0);
    });

    it('a route has a vehicle or a seller, a vehicle wins, and the database refuses neither', async () => {
      const a = await member(d, 'SELLER');
      const v = await truck();
      const none = await as(d)
        .post('/routes', { name: 'Sans rien', weekdays: [1] }, null)
        .expect(400);
      expect(errorOf(none).code).toBe(ErrorCode.ROUTE_NEEDS_OWNER);
      const both = (
        await as(d)
          .post(
            '/routes',
            { name: `Deux ${++seq}`, vehicleId: v.id, sellerId: a.id, weekdays: [1] },
            null,
          )
          .expect(201)
      ).body as RouteDto;
      expect(both).toMatchObject({ seller: null, vehicle: { id: v.id } });
      // Back to a seller route, then to nobody: refused.
      const back = (
        await as(d).patch(`/routes/${both.id}`, { vehicleId: null, sellerId: a.id }).expect(200)
      ).body as RouteDto;
      expect(back).toMatchObject({ seller: { id: a.id }, vehicle: null });
      const orphan = await as(d).patch(`/routes/${both.id}`, { sellerId: null }).expect(400);
      expect(errorOf(orphan).code).toBe(ErrorCode.ROUTE_NEEDS_OWNER);
      await expect(
        tamper(t)`UPDATE routes SET "sellerId" = NULL WHERE id = ${both.id}::uuid`,
      ).rejects.toThrow();
      // Not a truck.
      const main = ((await as(d).get('/warehouses').expect(200)).body as WarehouseDto[]).find(
        (w) => w.isDefault,
      )!;
      const depot = await as(d)
        .post('/routes', { name: 'Dépôt', vehicleId: main.id, weekdays: [1] }, null)
        .expect(422);
      expect(errorOf(depot).code).toBe(ErrorCode.WAREHOUSE_INVALID);
      const list = (await as(d).get(`/routes?vehicleId=${v.id}`).expect(200)).body as RouteDto[];
      expect(list).toEqual([]);
    });

    it('scope: a supervisor sees and edits the routes of his trucks only', async () => {
      const sup = await member(d, 'SUPERVISOR', { depots: false });
      const mine = await member(d, 'SELLER', { managerId: sup.id });
      const stranger = await member(d, 'SELLER');
      const myTruck = await truck(d, { assignedUserId: mine.id });
      const farTruck = await truck(d, { assignedUserId: stranger.id });
      const c = await client();
      const myRoute = await vehicleRoute(myTruck.id, [c.id]);
      const farRoute = await vehicleRoute(farTruck.id, [c.id]);

      const seen = ((await as(sup).get('/routes').expect(200)).body as RouteDto[]).map((r) => r.id);
      expect(seen).toContain(myRoute.id);
      expect(seen).not.toContain(farRoute.id);
      expect((await as(sup).get(`/routes?vehicleId=${farTruck.id}`).expect(200)).body).toEqual([]);
      await as(sup).get(`/routes/${farRoute.id}`).expect(404);
      await as(sup).patch(`/routes/${farRoute.id}`, { name: 'Pris' }).expect(404);
      await as(sup).put(`/routes/${farRoute.id}/stops`, { clientIds: [] }).expect(404);
      const taken = await as(sup)
        .post('/routes', { name: 'Chez les autres', vehicleId: farTruck.id, weekdays: [1] }, null)
        .expect(404);
      expect(errorOf(taken).code).toBe(ErrorCode.WAREHOUSE_NOT_FOUND);
      const moved = await as(sup)
        .patch(`/routes/${myRoute.id}`, { vehicleId: farTruck.id })
        .expect(404);
      expect(errorOf(moved).code).toBe(ErrorCode.WAREHOUSE_NOT_FOUND);
      await as(sup)
        .patch(`/routes/${myRoute.id}`, { name: `Renommée ${++seq}` })
        .expect(200);
      // A supervisor with OPERATE on the dépôt reaches all its trucks.
      const wide = await member(d, 'SUPERVISOR');
      await as(wide).get(`/routes/${farRoute.id}`).expect(200);
      // A seller plans nothing.
      await as(mine)
        .post('/routes', { name: 'Moi', vehicleId: myTruck.id, weekdays: [1] }, null)
        .expect(403);
    });

    it('a manager of one dépôt never writes on a truck of another: driver move, convert one, convert all', async () => {
      // Test-36 B-1, B-2.
      const batna = (
        await as(d)
          .post('/warehouses', { name: `Batna ${++seq}`, type: 'SECONDARY' }, null)
          .expect(201)
      ).body as WarehouseDto;
      const mgr = await member(d, 'MANAGER', { depots: false });
      await as(d)
        .put(`/users/${mgr.id}/access`, { access: [{ warehouseId: batna.id, level: 'OPERATE' }] })
        .expect(200);
      const [far, near] = [await member(d, 'SELLER'), await member(d, 'SELLER')];
      // A truck starts under the dépôt principal; two are moved to Batna.
      const van = await truck(d, { assignedUserId: far.id });
      const local = await truck(d, { assignedUserId: near.id });
      const spare = await truck();
      for (const w of [local, spare]) {
        await as(d).patch(`/warehouses/${w.id}`, { parentWarehouseId: batna.id }).expect(200);
      }
      const sellerRoute = async (sellerId: string) =>
        (
          await as(d)
            .post('/routes', { name: `Vendeur ${++seq}`, sellerId, weekdays: [3] }, null)
            .expect(201)
        ).body as RouteDto;
      const [farRoute, nearRoute] = [await sellerRoute(far.id), await sellerRoute(near.id)];
      const audits = (action: string, entityId: string) =>
        asTenant(d.tenantId, () =>
          t.prisma.db.auditLog.count({ where: { action, entityId, userId: mgr.id } }),
        );

      // B-1: putting a driver of the principal on a Batna truck would free VAN.
      await drive(mgr, van.id, null).expect(404);
      const moved = await drive(mgr, spare.id, far.id).expect(409);
      expect(errorOf(moved)).toMatchObject({
        code: ErrorCode.VEHICLE_ALREADY_ASSIGNED,
        details: { rule: 'other_truck_out_of_reach' },
      });
      expect((await warehouseOf(van.id)).assignedUser?.id).toBe(far.id);
      expect((await warehouseOf(spare.id)).assignedUser).toBeNull();
      expect(await historyOf(van.id)).toHaveLength(1);
      expect(await historyOf(spare.id)).toHaveLength(0);
      // Within his dépôt he moves a driver as before.
      const ok = (await drive(mgr, spare.id, near.id).expect(200)).body as AssignDriverResultDto;
      expect(ok.freedVehicle?.id).toBe(local.id);
      await drive(mgr, local.id, near.id).expect(200);

      // B-2, one route: refused before anything is written, never a 404 after a save.
      const one = await as(mgr).post(`/routes/${farRoute.id}/convert-to-vehicle`);
      expect(one.status).toBe(404);
      expect(errorOf(one).code).toBe(ErrorCode.WAREHOUSE_NOT_FOUND);
      const kept = (await as(d).get(`/routes/${farRoute.id}`).expect(200)).body as RouteDto;
      expect(kept).toMatchObject({ seller: { id: far.id }, vehicle: null });
      expect(await audits('ROUTE_CONVERTED', farRoute.id)).toBe(0);

      // B-2, all: the route of the truck he reaches moves, the other is skipped.
      const all = (await as(mgr).post('/routes/convert-to-vehicle').expect(200))
        .body as ConvertRoutesResultDto;
      expect(all.converted).toBeGreaterThanOrEqual(1);
      expect(all.skipped).toBeGreaterThanOrEqual(1);
      expect((await as(d).get(`/routes/${nearRoute.id}`).expect(200)).body).toMatchObject({
        seller: null,
        vehicle: { id: local.id },
      });
      expect((await as(d).get(`/routes/${farRoute.id}`).expect(200)).body).toMatchObject({
        seller: { id: far.id },
        vehicle: null,
      });
      expect(await audits('ROUTE_CONVERTED', farRoute.id)).toBe(0);
      // The route he converted stays his to read: the answer and the state agree.
      await as(mgr).get(`/routes/${nearRoute.id}`).expect(200);
      // The owner converts the one left.
      await as(d).post(`/routes/${farRoute.id}/convert-to-vehicle`).expect(200);
    });

    it('converts a seller route to the truck its seller drives; twice changes nothing', async () => {
      const a = await member(d, 'SELLER');
      const route = (
        await as(d)
          .post('/routes', { name: `À convertir ${++seq}`, sellerId: a.id, weekdays: [2] }, null)
          .expect(201)
      ).body as RouteDto;
      const refused = await as(d)
        .post(`/routes/${route.id}/convert-to-vehicle`)
        .expect(409);
      expect(errorOf(refused).code).toBe(ErrorCode.SELLER_HAS_NO_VEHICLE);

      const v = await truck(d, { assignedUserId: a.id });
      const done = (
        await as(d).post(`/routes/${route.id}/convert-to-vehicle`).expect(200)
      ).body as RouteDto;
      expect(done).toMatchObject({ seller: null, vehicle: { id: v.id } });
      await as(d).post(`/routes/${route.id}/convert-to-vehicle`).expect(200);
      const audits = await asTenant(d.tenantId, () =>
        t.prisma.db.auditLog.findMany({
          where: { action: 'ROUTE_CONVERTED', entityId: route.id },
          select: { before: true, after: true },
        }),
      );
      expect(audits).toHaveLength(1);
      expect(audits[0]).toMatchObject({
        before: { sellerId: a.id, vehicleId: null },
        after: { sellerId: null, vehicleId: v.id },
      });
      await as(a).post(`/routes/${route.id}/convert-to-vehicle`).expect(403);
    });

    it('converts every seller route whose seller drives a truck; a second run converts 0', async () => {
      const [withTruck, without] = [await member(d, 'SELLER'), await member(d, 'SELLER')];
      const v = await truck(d, { assignedUserId: withTruck.id });
      const make = async (sellerId: string) =>
        (
          await as(d)
            .post('/routes', { name: `Lot ${++seq}`, sellerId, weekdays: [3] }, null)
            .expect(201)
        ).body as RouteDto;
      const [r1, r2, r3] = [
        await make(withTruck.id),
        await make(withTruck.id),
        await make(without.id),
      ];
      const first = (await as(d).post('/routes/convert-to-vehicle').expect(200))
        .body as ConvertRoutesResultDto;
      expect(first.converted).toBeGreaterThanOrEqual(2);
      expect(first.skipped).toBeGreaterThanOrEqual(1);
      const read = async (id: string) =>
        (await as(d).get(`/routes/${id}`).expect(200)).body as RouteDto;
      expect((await read(r1.id)).vehicle?.id).toBe(v.id);
      expect((await read(r2.id)).vehicle?.id).toBe(v.id);
      expect(await read(r3.id)).toMatchObject({ vehicle: null, seller: { id: without.id } });
      const second = (await as(d).post('/routes/convert-to-vehicle').expect(200))
        .body as ConvertRoutesResultDto;
      expect(second.converted).toBe(0);
      expect(second.skipped).toBe(first.skipped);
      const audits = await asTenant(d.tenantId, () =>
        t.prisma.db.auditLog.count({
          where: { action: 'ROUTE_CONVERTED', entityId: { in: [r1.id, r2.id, r3.id] } },
        }),
      );
      expect(audits).toBe(2);
    });
  });

  describe('the truck frozen on visits and orders', () => {
    it('stores the truck at creation; a later driver change does not rewrite it', async () => {
      const [a, b] = [await member(d, 'SELLER'), await member(d, 'SELLER')];
      const v = await truck(d, { assignedUserId: a.id, code: `FRZ ${++seq}` });
      const [c, p] = [await client(), await product()];
      const route = await vehicleRoute(v.id, [c.id]);
      const visit = (await noSaleVisit(a, c.id, { routeId: route.id }).expect(201))
        .body as VisitDto;
      expect(visit.vehicle).toMatchObject({ id: v.id, code: v.code });
      const order = (
        await as(a)
          .post('/orders', {
            clientId: c.id,
            lines: [{ productId: p.id, unitId: p.carton, qty: '1' }],
          })
          .expect(201)
      ).body as OrderDto;
      expect(order.vehicle?.id).toBe(v.id);
      expect(order.deliveryVehicle).toBeNull();

      await drive(d, v.id, b.id).expect(200);
      expect(
        ((await as(d).get(`/visits/${visit.id}`).expect(200)).body as VisitDto).vehicle?.id,
      ).toBe(v.id);
      expect(
        ((await as(d).get(`/orders/${order.id}`).expect(200)).body as OrderDto).vehicle?.id,
      ).toBe(v.id);
      // What a does now has no truck; what b does has this one.
      const later = (await noSaleVisit(a, c.id).expect(201)).body as VisitDto;
      expect(later.vehicle).toBeNull();
      const byB = (await noSaleVisit(b, c.id, { routeId: route.id }).expect(201)).body as VisitDto;
      expect(byB.vehicle?.id).toBe(v.id);
      // a can no longer record on the route of a truck he does not drive.
      const stale = await noSaleVisit(a, c.id, { routeId: route.id }).expect(422);
      expect(errorOf(stale).details).toMatchObject({ rule: 'route_not_of_seller' });
      // A correction keeps the truck of the visit it replaces.
      const fixed = (
        await noSaleVisit(a, c.id, { reason: 'REFUSED', correctsVisitId: visit.id }).expect(201)
      ).body as VisitDto;
      expect(fixed.vehicle?.id).toBe(v.id);

      const byTruck = (await as(d).get(`/visits?vehicleId=${v.id}`).expect(200)).body as VisitPage;
      expect(byTruck.items.map((x) => x.id).sort()).toEqual([visit.id, byB.id, fixed.id].sort());
      const orders = (await as(d).get(`/orders?vehicleId=${v.id}`).expect(200)).body as OrderPage;
      expect(orders.items.map((o) => o.id)).toEqual([order.id]);
    });

    it('a visit linked to a sale names the truck the sale left, whatever the history says', async () => {
      // Test-36 C-1: the driver changes between the door (startedAt) and the sale.
      const x = await member(d, 'SELLER');
      const [t1, t2] = [await truck(d, { assignedUserId: x.id }), await truck()];
      const [c, p] = [await client(), await product()];
      await load(t1.id, p, '2');
      await load(t2.id, p, '2');
      const main = ((await as(d).get('/warehouses').expect(200)).body as WarehouseDto[]).find(
        (w) => w.isDefault,
      )!;
      const atTheDoor = clock.now().toISOString();
      await drive(d, t2.id, x.id).expect(200);
      const sell = async (extra: object = {}) =>
        (
          await as(x)
            .post('/sales/quick', {
              documentDate: today(),
              clientId: c.id,
              lines: [{ productId: p.id, unitId: p.carton, qty: '1' }],
              paidAmount: '2856',
              ...extra,
            })
            .expect(201)
        ).body as SaleResultDto;
      const visit = async (body: object) =>
        (
          await as(x)
            .post('/visits', { clientId: c.id, startedAt: atTheDoor, ...body })
            .expect(201)
        ).body as VisitDto;
      const leftFrom = async (saleId: string) =>
        (
          await asTenant(d.tenantId, () =>
            t.prisma.db.sale.findUniqueOrThrow({
              where: { id: saleId },
              select: { warehouseId: true },
            }),
          )
        ).warehouseId;

      // The goods leave the truck he drives when he sells: the visit names that truck,
      // not the one he drove when it started.
      const sale = await sell();
      expect(await leftFrom(sale.sale.id)).toBe(t2.id);
      const withSale = await visit({ outcome: 'SALE', saleId: sale.sale.id });
      expect(withSale.vehicle?.id).toBe(t2.id);
      // Without a sale the history at startedAt still answers.
      const without = await visit({ outcome: 'NO_SALE', reason: 'CLOSED' });
      expect(without.vehicle?.id).toBe(t1.id);
      // A sale of his that left a dépôt: the visit names no truck.
      const fromDepot = await sell({ warehouseId: main.id });
      expect(await leftFrom(fromDepot.sale.id)).toBe(main.id);
      const depotVisit = await visit({ outcome: 'SALE', saleId: fromDepot.sale.id });
      expect(depotVisit.vehicle).toBeNull();
      // A correction that carries the sale keeps the sale's truck.
      const fixed = await visit({
        outcome: 'SALE',
        saleId: sale.sale.id,
        correctsVisitId: without.id,
      });
      expect(fixed.vehicle?.id).toBe(t2.id);

      // The SQL rule of test-36 (visit_sale_left_the_truck_frozen_on_the_visit).
      const split = await asTenant(d.tenantId, () =>
        t.prisma.db.$queryRaw<{ id: string }[]>`
          SELECT v.id FROM visits v
          JOIN sales s ON s.id = v."saleId"
          JOIN warehouses sw ON sw.id = s."warehouseId"
          WHERE v."tenantId" = ${d.tenantId}::uuid AND s."sellerId" = v."sellerId"
            AND ((sw.type = 'VEHICLE' AND v."vehicleId" IS DISTINCT FROM s."warehouseId")
              OR (sw.type <> 'VEHICLE' AND v."vehicleId" IS NOT NULL))`,
      );
      expect(split).toEqual([]);
    });

    it('an order on a delivery truck follows the truck, and freezes it at delivery', async () => {
      const [l1, l2] = [await member(d, 'LIVREUR'), await member(d, 'LIVREUR')];
      const type = await vehicleType(d, { activity: 'DELIVERY' });
      const v = await truck(d, {
        assignedUserId: l1.id,
        vehicleTypeId: type.id,
        code: `LIV ${++seq}`,
      });
      const [c, p] = [await client(), await product()];
      await load(v.id, p, '4');
      const draft = (
        await as(d)
          .post('/orders', {
            clientId: c.id,
            lines: [{ productId: p.id, unitId: p.carton, qty: '2' }],
          })
          .expect(201)
      ).body as OrderDto;
      const order = (await as(d).post(`/orders/${draft.id}/confirm`).expect(200)).body as OrderDto;
      const assigned = (
        await as(d).patch(`/orders/${order.id}/livreur`, { deliveryVehicleId: v.id }).expect(200)
      ).body as OrderDto;
      expect(assigned).toMatchObject({ livreur: { id: l1.id }, deliveryVehicle: { id: v.id } });
      await as(l1).get(`/orders/${order.id}`).expect(200);
      await as(l2).get(`/orders/${order.id}`).expect(404);
      const list = (await as(d).get(`/orders?deliveryVehicleId=${v.id}`).expect(200))
        .body as OrderPage;
      expect(list.items.map((o) => o.id)).toEqual([order.id]);
      expect(list.items[0]).toMatchObject({
        livreur: { id: l1.id },
        deliveryVehicle: { id: v.id },
      });

      // The driver changes before delivery: the order follows the truck.
      await drive(d, v.id, l2.id).expect(200);
      await as(l1).get(`/orders/${order.id}`).expect(404);
      const seen = (await as(l2).get(`/orders/${order.id}`).expect(200)).body as OrderDto;
      expect(seen.livreur?.id).toBe(l2.id);
      // "Mes livraisons" (the livreur filter) follows the truck too.
      const deliveriesOf = async (who: Member) =>
        (
          (await as(d).get(`/orders?status=CONFIRMED&livreurId=${who.id}`).expect(200))
            .body as OrderPage
        ).items.map((o) => o.id);
      expect(await deliveriesOf(l2)).toEqual([order.id]);
      expect(await deliveriesOf(l1)).toEqual([]);
      const body = { lines: [{ orderLineId: order.lines[0]!.id, qty: '2' }] };
      const key = randomUUID();
      const res = (await as(l2).post(`/orders/${order.id}/deliver`, body, key).expect(200))
        .body as DeliverOrderResultDto;
      expect(res.order).toMatchObject({
        status: 'DELIVERED',
        livreur: { id: l2.id },
        deliveryVehicle: { id: v.id },
        warehouse: { id: v.id },
      });
      // One BL per order, replay included.
      const replay = (await as(l2).post(`/orders/${order.id}/deliver`, body, key).expect(200))
        .body as DeliverOrderResultDto;
      expect(replay.sale.id).toBe(res.sale.id);
      await as(l2).post(`/orders/${order.id}/deliver`, body).expect(409);
      // Delivered: it stays with who delivered it, whoever drives the truck next.
      await drive(d, v.id, l1.id).expect(200);
      const after = (await as(d).get(`/orders/${order.id}`).expect(200)).body as OrderDto;
      expect(after).toMatchObject({ livreur: { id: l2.id }, deliveryVehicle: { id: v.id } });
      await as(l2).get(`/orders/${order.id}`).expect(200);
      await as(l1).get(`/orders/${order.id}`).expect(404);
    });

    it('the BL of an order put on a delivery truck leaves the truck, not the dépôt the order names', async () => {
      // Test-36 A-2: load, deliver, unload. The truck ends empty and the dépôt is short of
      // exactly what was delivered.
      const liv = await member(d, 'LIVREUR');
      const v = await truck(d, { assignedUserId: liv.id, code: `LIV ${++seq}` });
      const main = ((await as(d).get('/warehouses').expect(200)).body as WarehouseDto[]).find(
        (w) => w.isDefault,
      )!;
      const [c, p] = [await client(), await product()];
      const levels = async () => {
        const rows = await asTenant(d.tenantId, () =>
          t.prisma.db.warehouseStock.findMany({
            where: { productId: p.id, warehouseId: { in: [v.id, main.id] } },
            select: { warehouseId: true, qtyBase: true },
          }),
        );
        const of = (id: string) => Number(rows.find((r) => r.warehouseId === id)?.qtyBase ?? 0);
        return { truck: of(v.id), main: of(main.id) };
      };
      await load(v.id, p, '5');
      expect(await levels()).toEqual({ truck: 120, main: 120 });
      // The order names the dépôt principal, as a seller who works there gets on every order.
      const order = async (cartons: string, on = { truckId: v.id, clientId: c.id, item: p }) => {
        const draft = (
          await as(d)
            .post('/orders', {
              clientId: on.clientId,
              warehouseId: main.id,
              lines: [{ productId: on.item.id, unitId: on.item.carton, qty: cartons }],
            })
            .expect(201)
        ).body as OrderDto;
        await as(d).post(`/orders/${draft.id}/confirm`).expect(200);
        return (
          await as(d)
            .patch(`/orders/${draft.id}/livreur`, { deliveryVehicleId: on.truckId })
            .expect(200)
        ).body as OrderDto;
      };
      const first = await order('2');
      expect(first.warehouse?.id).toBe(main.id);
      // The availability shown on the order is the truck's: 5 cartons, not the dépôt's.
      expect(first.lines[0]!.availableBase).toBe('120.000');
      const res = (
        await as(liv)
          .post(`/orders/${first.id}/deliver`, {
            lines: [{ orderLineId: first.lines[0]!.id, qty: '2' }],
          })
          .expect(200)
      ).body as DeliverOrderResultDto;
      expect(res.order).toMatchObject({ warehouse: { id: v.id }, deliveryVehicle: { id: v.id } });
      expect(await levels()).toEqual({ truck: 72, main: 120 });
      const sale = await asTenant(d.tenantId, () =>
        t.prisma.db.sale.findUniqueOrThrow({
          where: { id: res.sale.id },
          select: { warehouseId: true },
        }),
      );
      expect(sale.warehouseId).toBe(v.id);

      // More than the truck carries: the company's setting decides, for the truck. BLOCK
      // refuses although the dépôt has the goods; nothing leaves either place.
      const big = await order('4');
      await as(d).patch('/tenant/settings', { negativeStockMode: 'BLOCK' }).expect(200);
      try {
        const refused = await as(liv).post(`/orders/${big.id}/deliver`, {
          lines: [{ orderLineId: big.lines[0]!.id, qty: '4' }],
        });
        expect(refused.status).toBe(409);
        expect(errorOf(refused).code).toBe(ErrorCode.STOCK_INSUFFICIENT);
        expect(await levels()).toEqual({ truck: 72, main: 120 });
      } finally {
        await as(d).patch('/tenant/settings', { negativeStockMode: 'WARN' }).expect(200);
      }
      // WARN (the default): it goes, with a warning that names the truck, and the truck
      // goes negative. The dépôt is not touched.
      const warned = (
        await as(liv)
          .post(`/orders/${big.id}/deliver`, {
            lines: [{ orderLineId: big.lines[0]!.id, qty: '4' }],
          })
          .expect(200)
      ).body as DeliverOrderResultDto;
      expect(warned.warnings).toHaveLength(1);
      expect(warned.warnings[0]).toMatchObject({ warehouseId: v.id });
      expect(await levels()).toEqual({ truck: -24, main: 120 });

      // A second truck for the clean cycle: load 5, deliver 2, unload the 3 left.
      const v2 = await truck(d, { assignedUserId: null, code: `LIV ${++seq}` });
      await drive(d, v2.id, liv.id).expect(200);
      const [c2, p2] = [await client(), await product()];
      await load(v2.id, p2, '5');
      const clean = await order('2', { truckId: v2.id, clientId: c2.id, item: p2 });
      await as(liv)
        .post(`/orders/${clean.id}/deliver`, {
          lines: [{ orderLineId: clean.lines[0]!.id, qty: '2' }],
        })
        .expect(200);
      const back = (
        await as(d)
          .post('/stock-transfers', {
            type: 'UNLOAD',
            fromWarehouseId: v2.id,
            toWarehouseId: main.id,
            lines: [{ productId: p2.id, unitId: p2.carton, qty: '3' }],
          })
          .expect(201)
      ).body as { id: string };
      await as(d).post(`/stock-transfers/${back.id}/validate`).expect(200);
      const end = await asTenant(d.tenantId, () =>
        t.prisma.db.warehouseStock.findMany({
          where: { productId: p2.id, warehouseId: { in: [v2.id, main.id] } },
          select: { warehouseId: true, qtyBase: true },
        }),
      );
      expect(Number(end.find((r) => r.warehouseId === v2.id)?.qtyBase ?? 0)).toBe(0);
      // 240 at the start, minus the 2 cartons (48 pièces) delivered.
      expect(Number(end.find((r) => r.warehouseId === main.id)?.qtyBase ?? 0)).toBe(192);
    });

    it('a person named alone takes the order off its truck; a truck out of reach is refused', async () => {
      const [l1, l2] = [await member(d, 'LIVREUR'), await member(d, 'LIVREUR')];
      const v = await truck(d, { assignedUserId: l1.id });
      const [c, p] = [await client(), await product()];
      const draft = (
        await as(d)
          .post('/orders', {
            clientId: c.id,
            lines: [{ productId: p.id, unitId: p.carton, qty: '1' }],
          })
          .expect(201)
      ).body as OrderDto;
      await as(d).post(`/orders/${draft.id}/confirm`).expect(200);
      await as(d).patch(`/orders/${draft.id}/livreur`, { deliveryVehicleId: v.id }).expect(200);
      const person = (
        await as(d).patch(`/orders/${draft.id}/livreur`, { livreurId: l2.id }).expect(200)
      ).body as OrderDto;
      expect(person).toMatchObject({ livreur: { id: l2.id }, deliveryVehicle: null });
      await as(l1).get(`/orders/${draft.id}`).expect(404);
      await as(d).patch(`/orders/${draft.id}/livreur`, {}).expect(400);
      const foreign = await truck(other);
      await as(d)
        .patch(`/orders/${draft.id}/livreur`, { deliveryVehicleId: foreign.id })
        .expect(404);
    });

    it('reports the same figures per truck, from the frozen truck', async () => {
      const a = await member(d, 'SELLER');
      const v = await truck(d, { assignedUserId: a.id, code: `RPT ${++seq}` });
      const [c1, c2] = [await client(), await client()];
      await vehicleRoute(v.id, [c1.id, c2.id]);
      await noSaleVisit(a, c1.id).expect(201);
      const url = `/tournees/reports?from=${today()}&to=${today()}`;
      const report = (await as(d).get(`${url}&by=vehicle&vehicleId=${v.id}`).expect(200))
        .body as TourneeReportDto;
      expect(report.rows).toEqual([]);
      expect(report.vehicleRows).toHaveLength(1);
      expect(report.vehicleRows[0]).toMatchObject({
        vehicle: { id: v.id, code: v.code },
        plannedStops: 2,
        visitedStops: 1,
        visitRate: 0.5,
        visits: 1,
      });
      // Per seller, the stops of the truck's tournée are planned for its driver of the day.
      const bySeller = (await as(d).get(`${url}&sellerId=${a.id}`).expect(200))
        .body as TourneeReportDto;
      expect(bySeller.vehicleRows).toEqual([]);
      expect(bySeller.rows[0]).toMatchObject({
        seller: { id: a.id },
        plannedStops: 2,
        visitedStops: 1,
      });
      // A seller reads his own truck only.
      const b = await member(d, 'SELLER');
      const hidden = (await as(b).get(`${url}&by=vehicle&vehicleId=${v.id}`).expect(200))
        .body as TourneeReportDto;
      expect(hidden.vehicleRows).toEqual([]);
      const own = (await as(a).get(`${url}&by=vehicle`).expect(200)).body as TourneeReportDto;
      expect(own.vehicleRows.map((r) => r.vehicle?.id)).toEqual([v.id]);
    });
  });

  describe('backfill', () => {
    it('fills from sales and orders, leaves the unknown null, and a second run changes 0', async () => {
      const backfill = t.app.get(VehicleBackfillService);
      const a = await member(d, 'SELLER');
      const walker = await member(d, 'SELLER');
      const v = await truck(d, { assignedUserId: a.id });
      const [c, p] = [await client(), await product()];
      await load(v.id, p, '6');
      // A van sale and its visit.
      const sale = (
        await as(a)
          .post('/sales/quick', {
            documentDate: today(),
            clientId: c.id,
            lines: [{ productId: p.id, unitId: p.carton, qty: '1' }],
            paidAmount: '2856',
          })
          .expect(201)
      ).body as SaleResultDto;
      const fromSale = (
        await as(a)
          .post('/visits', {
            clientId: c.id,
            startedAt: clock.now().toISOString(),
            outcome: 'SALE',
            saleId: sale.sale.id,
          })
          .expect(201)
      ).body as VisitDto;
      // An order taken from the truck, its visit, and its delivery from the truck.
      const draft = (
        await as(a)
          .post('/orders', {
            clientId: c.id,
            lines: [{ productId: p.id, unitId: p.carton, qty: '2' }],
          })
          .expect(201)
      ).body as OrderDto;
      const order = (await as(a).post(`/orders/${draft.id}/confirm`).expect(200)).body as OrderDto;
      const fromOrder = (
        await as(a)
          .post('/visits', {
            clientId: c.id,
            startedAt: clock.now().toISOString(),
            outcome: 'ORDER',
            orderId: order.id,
          })
          .expect(201)
      ).body as VisitDto;
      await as(a)
        .post(`/orders/${order.id}/deliver`, {
          lines: [{ orderLineId: order.lines[0]!.id, qty: '2' }],
        })
        .expect(200);
      // A seller on foot: nothing says which truck, so it stays unknown.
      const unknown = (await noSaleVisit(walker, c.id).expect(201)).body as VisitDto;
      const officeDraft = (
        await as(d)
          .post('/orders', {
            clientId: c.id,
            lines: [{ productId: p.id, unitId: p.carton, qty: '1' }],
          })
          .expect(201)
      ).body as OrderDto;
      const office = (await as(d).post(`/orders/${officeDraft.id}/confirm`).expect(200))
        .body as OrderDto;
      await as(d)
        .post(`/orders/${office.id}/deliver`, {
          lines: [{ orderLineId: office.lines[0]!.id, qty: '1' }],
        })
        .expect(200);

      // As written before phase 36: the columns did not exist.
      await tamper(t)`
        UPDATE visits SET "vehicleId" = NULL
        WHERE id IN (${fromSale.id}::uuid, ${fromOrder.id}::uuid)`;
      await tamper(t)`UPDATE orders SET "deliveryVehicleId" = NULL WHERE id = ${order.id}::uuid`;
      // Today's driver must not be used: give the walker a truck now.
      await truck(d, { assignedUserId: walker.id });

      const first = await backfill.run({ tenantIds: [d.tenantId] });
      expect(first).toMatchObject({ tenants: 1, visits: 2, orders: 1 });
      const visitTruck = async (id: string) =>
        ((await as(d).get(`/visits/${id}`).expect(200)).body as VisitDto).vehicle?.id ?? null;
      expect(await visitTruck(fromSale.id)).toBe(v.id);
      expect(await visitTruck(fromOrder.id)).toBe(v.id);
      expect(await visitTruck(unknown.id)).toBeNull();
      const read = async (id: string) =>
        (await as(d).get(`/orders/${id}`).expect(200)).body as OrderDto;
      expect((await read(order.id)).deliveryVehicle?.id).toBe(v.id);
      expect((await read(office.id)).deliveryVehicle).toBeNull();

      const second = await backfill.run({ tenantIds: [d.tenantId] });
      expect(second).toMatchObject({ visits: 0, orders: 0 });
    });
  });

  describe('tenant isolation and plan', () => {
    it("never reads or uses another company's types, trucks, history or vehicle routes", async () => {
      const type = await vehicleType(other);
      const seller = await member(other, 'SELLER');
      const v = await truck(other, { assignedUserId: seller.id, vehicleTypeId: type.id });
      const c = await client(other);
      const route = (
        await as(other)
          .post('/routes', { name: `Chez eux ${++seq}`, vehicleId: v.id, weekdays: [1] }, null)
          .expect(201)
      ).body as RouteDto;
      const mine = await member(d, 'SELLER');
      const myTruck = await truck();

      // Reads.
      const types = (await as(d).get('/vehicle-types').expect(200)).body as VehicleTypeDto[];
      expect(types.map((x) => x.id)).not.toContain(type.id);
      const trucks = (await as(d).get('/warehouses?type=VEHICLE').expect(200))
        .body as WarehouseDto[];
      expect(trucks.map((w) => w.id)).not.toContain(v.id);
      await as(d).get(`/warehouses/${v.id}/assignments`).expect(404);
      await as(d).get(`/users/${seller.id}/vehicle-assignments`).expect(404);
      await as(d).get(`/routes/${route.id}`).expect(404);
      expect((await as(d).get(`/routes?vehicleId=${v.id}`).expect(200)).body).toEqual([]);
      expect(
        ((await as(d).get(`/visits?vehicleId=${v.id}`).expect(200)).body as VisitPage).items,
      ).toEqual([]);

      // Writes on their rows.
      await as(d).patch(`/vehicle-types/${type.id}`, { name: 'Pris' }).expect(404);
      await as(d).post(`/vehicle-types/${type.id}/archive`, {}, null).expect(404);
      await drive(d, v.id, mine.id).expect(404);
      await as(d).post(`/routes/${route.id}/convert-to-vehicle`).expect(404);

      // Their ids in a body.
      const badType = await as(d)
        .patch(`/warehouses/${myTruck.id}`, { vehicleTypeId: type.id })
        .expect(404);
      expect(errorOf(badType).code).toBe(ErrorCode.VEHICLE_TYPE_NOT_FOUND);
      await as(d)
        .post(
          '/warehouses',
          { name: `Camion ${++seq}`, type: 'VEHICLE', vehicleTypeId: type.id },
          null,
        )
        .expect(404);
      await as(d)
        .post('/routes', { name: 'Volée', vehicleId: v.id, weekdays: [1] }, null)
        .expect(404);
      await drive(d, myTruck.id, seller.id).expect(422);
      void c;

      const theirs = await asTenant(other.tenantId, () =>
        t.prisma.db.warehouse.findUniqueOrThrow({ where: { id: v.id } }),
      );
      expect(theirs).toMatchObject({ assignedUserId: seller.id, vehicleTypeId: type.id });
      expect(
        await asTenant(other.tenantId, () =>
          t.prisma.db.vehicleAssignment.count({ where: { vehicleId: v.id } }),
        ),
      ).toBe(1);
    });

    it('is refused without the module (Essentiel)', async () => {
      for (const res of [
        await as(essentiel).get('/vehicle-types').expect(403),
        await as(essentiel)
          .post('/vehicle-types', { code: 'MXT', name: 'Gros', activity: 'CASH_VAN' }, null)
          .expect(403),
        await drive(essentiel, randomUUID(), null).expect(403),
        await as(essentiel).get(`/warehouses/${randomUUID()}/assignments`).expect(403),
        await as(essentiel).get(`/users/${essentiel.auth.user.id}/vehicle-assignments`).expect(403),
        await as(essentiel).post('/routes/convert-to-vehicle').expect(403),
        await as(essentiel)
          .post(`/routes/${randomUUID()}/convert-to-vehicle`)
          .expect(403),
      ]) {
        expect(errorOf(res).code).toBe(ErrorCode.FEATURE_NOT_IN_PLAN);
      }
    });
  });

  // Last: it moves the clock.
  describe('who had truck X at T', () => {
    it('answers from the history across three changes', async () => {
      const [a, b] = [await member(d, 'SELLER'), await member(d, 'SELLER')];
      const v = await truck();
      const before = clock.now();
      clock.advanceDays(1);
      await drive(d, v.id, a.id).expect(200);
      const withA = new Date(clock.now().getTime() + 3600_000);
      clock.advanceDays(1);
      await drive(d, v.id, b.id).expect(200);
      const withB = new Date(clock.now().getTime() + 3600_000);
      clock.advanceDays(1);
      await drive(d, v.id, null).expect(200);
      const empty = new Date(clock.now().getTime() + 3600_000);
      clock.advanceDays(1);
      await drive(d, v.id, a.id).expect(200);
      const again = new Date(clock.now().getTime() + 3600_000);

      const at = (when: Date) => asTenant(d.tenantId, () => vehicles.driverAt(v.id, when));
      expect(await at(before)).toBeNull();
      expect(await at(withA)).toBe(a.id);
      expect(await at(withB)).toBe(b.id);
      expect(await at(empty)).toBeNull();
      expect(await at(again)).toBe(a.id);
      // And the other way round: the truck a user drove at T.
      const of = (userId: string, when: Date) =>
        asTenant(d.tenantId, () => vehicles.vehicleOfUserAt(userId, when));
      expect(await of(a.id, withA)).toBe(v.id);
      expect(await of(a.id, withB)).toBeNull();
      expect(await of(b.id, withB)).toBe(v.id);
      expect(await of(b.id, empty)).toBeNull();
      expect(await of(a.id, again)).toBe(v.id);
      const state = await asTenant(d.tenantId, () => vehicles.vehicleAt(v.id, withB));
      expect(state?.userId).toBe(b.id);
    });
  });
});
