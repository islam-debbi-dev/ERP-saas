import { randomUUID } from 'node:crypto';
import * as argon2 from 'argon2';
import {
  Activity,
  addDays,
  algiersDay,
  type ApiError,
  type AuthResponse,
  type ClientDto,
  type ClientSegmentDto,
  type ImportPreviewDto,
  ErrorCode,
  monthStart,
  type OrderDto,
  type PaymentDto,
  previousMonthStart,
  type ProductDto,
  type Role,
  type RouteDto,
  type SalePage,
  type SaleResultDto,
  type SellerSessionDto,
  STAT_MEASURE_KEYS,
  STAT_MEASURES,
  type StatCell,
  type StatMeasure,
  type StatMeasureDef,
  type StatsByDimensionDto,
  type StatsByVehicleDto,
  type StatsDispersionDto,
  type StatsLostClientsDto,
  type StatsMyVehicleDto,
  type StatsOverviewDto,
  type StatsTimelineDto,
  type StatsVehicleDayDto,
  type StatsVisitsDto,
  type VehicleTargetsDto,
  type VehicleTypeDto,
  type WarehouseDto,
  weekdayOf,
} from '@erp/shared';
import ExcelJS from 'exceljs';
import {
  DIMENSIONS,
  type EngineDimension,
  factCarries,
  MEASURE_SOURCES,
} from '../src/distribution-stats/registry';
import { StatsQueryService } from '../src/distribution-stats/stats-query.service';
import { tenantContext } from '../src/common/tenant-context';
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

const value = (cells: StatCell[], measure: StatMeasure) =>
  cells.find((c) => c.measure === measure)?.value;
const cell = (cells: StatCell[], measure: StatMeasure) => cells.find((c) => c.measure === measure)!;

/**
 * Phase 37, statistiques distribution, on one fixed day of trading:
 *
 * 3 dépôts (principal, CDD Batna, CDD M'sila), 3 vehicle types, 6 trucks in 2 wilayas.
 * Product A weighs 0,5 kg a pièce (12 kg a carton), product B has no weight; a carton is
 * 2 400 HT = 2 856 TTC, bought 80 a pièce.
 *
 * | Truck | Sales (TTC)                       | Avoirs        | CA     | BL | kg |
 * | V1    | s1 8 568 (2A + 1B), s2 2 856 (1A) | 2 856 damaged | 8 568  | 2  | 24 |
 * | V2    | s3 5 712 (2A), s5 2 856 (1A)      | 2 856 restock | 5 712  | 2  | 24 |
 * | V4    | s6 5 712 (2A, delivery of o1)     |               | 5 712  | 1  | 24 |
 * | none  | s4 2 856 (1A, dépôt principal)    |               | 2 856  | 1  | 12 |
 * | total |                                   |               | 22 848 | 6  | 84 |
 */
describe('statistiques distribution (phase 37)', () => {
  let t: TestApp;
  let d: RegisteredTenant;
  let other: RegisteredTenant;
  let essentiel: RegisteredTenant;
  let cat: TenantCatalog;
  let seq = 0;
  const today = algiersDay(new Date());
  const range = `from=${today}&to=${today}`;

  let main: WarehouseDto;
  let batna: WarehouseDto;
  let msila: WarehouseDto;
  let v1: WarehouseDto;
  let v2: WarehouseDto;
  let v3: WarehouseDto;
  let v4: WarehouseDto;
  let v5: WarehouseDto;
  let v6: WarehouseDto;
  let mxt: VehicleTypeDto;
  let prv: VehicleTypeDto;
  let liv: VehicleTypeDto;
  let s1: Member;
  let s2: Member;
  let s3: Member;
  let l4: Member;
  let s5: Member;
  let supervisor: Member;
  let batnaViewer: Member;
  let pa: Item;
  let pb: Item;
  let brand1: { id: string };
  let brand2: { id: string };
  let family1: { id: string };
  let sub1: { id: string };
  let family2: { id: string };
  let seg1: ClientSegmentDto;
  let seg2: ClientSegmentDto;
  let c1: ClientDto;
  let c2: ClientDto;
  let c3: ClientDto;
  let o1: OrderDto;

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
  const stats = async <T>(who: Who, path: string, query = range) =>
    (await as(who).get(`/stats/distribution/${path}?${query}`).expect(200)).body as T;

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
      .set('X-Forwarded-For', `10.37.${Math.floor(seq / 250)}.${(seq % 250) + 1}`)
      .send({ email, password: 'Password123!' })
      .expect(200);
    return { id: user.id, auth: login.body as AuthResponse };
  };

  const warehouse = async (who: RegisteredTenant, body: object) =>
    (await as(who).post('/warehouses', body, null).expect(201)).body as WarehouseDto;
  const drive = (vehicleId: string, userId: string | null) =>
    as(d).post(`/warehouses/${vehicleId}/driver`, { userId }, null).expect(200);

  async function product(body: object): Promise<Item> {
    const piece = cat.units['PIECE']!.id;
    const carton = cat.units['CARTON']!.id;
    const res = await as(d)
      .post(
        '/products',
        {
          reference: `S-${Date.now()}-${++seq}`,
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
          ...body,
        },
        null,
      )
      .expect(201);
    const id = (res.body as ProductDto).id;
    await as(d)
      .post('/stock/opening', {
        lines: [{ productId: id, unitId: piece, qty: '480', unitCost: '80' }],
      })
      .expect(201);
    return { id, piece, carton };
  }

  const load = async (vehicleId: string, lines: [Item, string][]) => {
    const tr = (
      await as(d)
        .post('/stock-transfers', {
          type: 'LOAD',
          fromWarehouseId: main.id,
          toWarehouseId: vehicleId,
          lines: lines.map(([p, qty]) => ({ productId: p.id, unitId: p.carton, qty })),
        })
        .expect(201)
    ).body as { id: string };
    await as(d).post(`/stock-transfers/${tr.id}/validate`).expect(200);
    return tr.id;
  };

  const sell = async (by: Who, clientId: string, lines: [Item, string][], extra: object = {}) =>
    (
      (
        await as(by)
          .post('/sales/quick', {
            documentDate: today,
            clientId,
            lines: lines.map(([p, qty]) => ({ productId: p.id, unitId: p.carton, qty })),
            ...extra,
          })
          .expect(201)
      ).body as SaleResultDto
    ).sale;

  const order = async (by: Who, clientId: string, cartons: string) => {
    const draft = (
      await as(by)
        .post('/orders', {
          clientId,
          lines: [{ productId: pa.id, unitId: pa.carton, qty: cartons }],
        })
        .expect(201)
    ).body as OrderDto;
    return (await as(by).post(`/orders/${draft.id}/confirm`).expect(200)).body as OrderDto;
  };

  beforeAll(async () => {
    t = await createTestApp();
    d = await registerTenant(t, 'Distrib Statistiques', { activity: Activity.DISTRIBUTEUR });
    other = await registerTenant(t, 'Autre Distrib', { activity: Activity.DISTRIBUTEUR });
    essentiel = await registerTenant(t, 'Grossiste Simple');
    await withoutGeoCheck(t, d);
    await withoutGeoCheck(t, other);
    cat = await catalogOf(t, d);

    // ---- dépôts, types, trucks
    main = ((await as(d).get('/warehouses').expect(200)).body as WarehouseDto[]).find(
      (w) => w.isDefault,
    )!;
    batna = await warehouse(d, { name: 'CDD Batna', type: 'SECONDARY', code: 'CDD BATNA 05' });
    msila = await warehouse(d, { name: "CDD M'sila", type: 'SECONDARY', code: 'CDD MSILA 28' });
    const type = async (code: string, activity: string) =>
      (await as(d).post('/vehicle-types', { code, name: code, activity }, null).expect(201))
        .body as VehicleTypeDto;
    mxt = await type('MXT', 'CASH_VAN');
    prv = await type('PRV', 'PRESALE');
    liv = await type('LIV', 'DELIVERY');
    const truck = async (
      code: string,
      typeId: string,
      wilayaCode: number,
      parent: string,
      extra = {},
    ) => {
      const created = await warehouse(d, {
        name: code,
        code,
        type: 'VEHICLE',
        vehicleTypeId: typeId,
        wilayaCode,
        ...extra,
      });
      // A truck belongs to a dépôt: set on the truck once it exists.
      return (
        await as(d).patch(`/warehouses/${created.id}`, { parentWarehouseId: parent }).expect(200)
      ).body as WarehouseDto;
    };
    v1 = await truck('VAN-28 MXT 01', mxt.id, 28, msila.id, { capacityKg: 100 });
    v2 = await truck('VAN-28 MXT 02', mxt.id, 28, msila.id);
    v3 = await truck('PRV05-DD01', prv.id, 5, batna.id);
    v4 = await truck('LIV 05 MIX', liv.id, 5, batna.id);
    v5 = await truck('VAN-05 MXT 03', mxt.id, 5, main.id);
    v6 = await truck('LIV 28 MIX', liv.id, 28, main.id);

    // ---- people
    supervisor = await member(d, 'SUPERVISOR', { depots: false });
    s1 = await member(d, 'SELLER', { managerId: supervisor.id });
    s2 = await member(d, 'SELLER');
    s3 = await member(d, 'SELLER');
    l4 = await member(d, 'LIVREUR');
    s5 = await member(d, 'SELLER');
    batnaViewer = await member(d, 'MANAGER', { depots: false });
    await as(d)
      .put(`/users/${batnaViewer.id}/access`, {
        access: [{ warehouseId: batna.id, level: 'VIEW_STATS' }],
      })
      .expect(200);
    await drive(v1.id, s1.id);
    await drive(v2.id, s2.id);
    await drive(v3.id, s3.id);
    await drive(v4.id, l4.id);

    // ---- catalog and clients
    brand1 = (await as(d).post('/brands', { name: 'Marque Une' }, null).expect(201)).body as {
      id: string;
    };
    brand2 = (await as(d).post('/brands', { name: 'Marque Deux' }, null).expect(201)).body as {
      id: string;
    };
    const category = async (name: string, parentId?: string) =>
      (await as(d).post('/categories', { name, parentId }, null).expect(201)).body as {
        id: string;
      };
    family1 = await category('Boissons');
    sub1 = await category('Jus', family1.id);
    family2 = await category('Biscuits');
    pa = await product({ weightKg: '0.5', brandId: brand1.id, categoryId: sub1.id });
    pb = await product({ brandId: brand2.id, categoryId: family2.id });
    const segment = async (code: string, name: string) =>
      (await as(d).post('/client-segments', { code, name }, null).expect(201))
        .body as ClientSegmentDto;
    seg1 = await segment('DET', 'Détaillant');
    seg2 = await segment('SUP', 'Supérette');
    const client = async (name: string, body: object) =>
      (
        await as(d)
          .post('/clients', { code: `SC${++seq}`, name, ...body }, null)
          .expect(201)
      ).body as ClientDto;
    c1 = await client('Épicerie Un', { segmentId: seg1.id, wilaya: "M'sila" });
    c2 = await client('Supérette Deux', { segmentId: seg2.id, wilaya: 'Batna' });
    c3 = await client('Sans Type', {});

    // ---- a tournée for V1 today: three stops
    const route = (
      await as(d)
        .post('/routes', { name: 'Est', vehicleId: v1.id, weekdays: [weekdayOf(today)] }, null)
        .expect(201)
    ).body as RouteDto;
    await as(d)
      .put(`/routes/${route.id}/stops`, { clientIds: [c1.id, c2.id, c3.id] })
      .expect(200);

    // ---- chargements
    await load(v1.id, [
      [pa, '4'],
      [pb, '2'],
    ]);
    await load(v2.id, [[pa, '4']]);
    await load(v4.id, [[pa, '3']]);

    // ---- sales and avoirs
    const sale1 = await sell(s1, c1.id, [
      [pa, '2'],
      [pb, '1'],
    ]);
    await sell(s1, c2.id, [[pa, '1']]);
    const sale3 = await sell(s2, c1.id, [[pa, '2']]);
    await sell(d, c3.id, [[pa, '1']], { warehouseId: main.id });
    const back = (saleId: string, saleLineId: string, disposition: string) =>
      as(d)
        .post(`/sales/${saleId}/returns`, {
          disposition,
          reason: 'retour du client',
          lines: [{ saleLineId, qty: '1' }],
        })
        .expect(201);
    await back(sale1.id, sale1.lines.find((l) => l.productId === pa.id)!.id, 'DAMAGED');
    await back(sale3.id, sale3.lines[0]!.id, 'RESTOCK');

    // ---- visits: S1 on his tournée, S2 off any tournée
    const visit = (by: Who, body: object) =>
      as(by)
        .post('/visits', { startedAt: new Date().toISOString(), ...body })
        .expect(201);
    await visit(s1, { clientId: c1.id, outcome: 'SALE', saleId: sale1.id });
    await visit(s1, { clientId: c2.id, outcome: 'NO_SALE', reason: 'CLOSED' });
    await visit(s2, { clientId: c3.id, outcome: 'NO_SALE', reason: 'NO_MONEY' });

    // ---- a driver change in the middle of the day: V2 goes from S2 to S5, who sells
    await drive(v2.id, s5.id);
    await sell(s5, c2.id, [[pa, '1']]);

    // ---- versements
    const pay = async (by: Who, body: object) =>
      (await as(by).post('/payments', body).expect(201)).body as PaymentDto;
    await pay(s1, { clientId: c1.id, amount: '3000' });
    await pay(d, { clientId: c3.id, amount: '1000', warehouseId: main.id });
    const cheque = await pay(s1, {
      clientId: c2.id,
      amount: '2000',
      mode: 'CHEQUE',
      reference: 'CHQ-1',
      bank: 'BNA',
      dueDate: today,
    });
    await as(d).post(`/payments/${cheque.id}/bounce`, { reason: 'sans provision' }).expect(200);
    // Recorded at the dépôt, collected by S5: it counts for the truck S5 drove then (V2).
    const collected = await pay(s5, { clientId: c2.id, amount: '500' });
    await tamper(t)`UPDATE payments SET "warehouseId" = ${msila.id}::uuid
      WHERE id = ${collected.id}::uuid`;

    // ---- prévente (V3) and livraison (V4)
    o1 = await order(s3, c2.id, '3');
    await order(s3, c1.id, '1');
    const cancelled = await order(s3, c3.id, '1');
    await as(d).post(`/orders/${cancelled.id}/cancel`, { reason: 'Client absent' }).expect(200);
    // Given to the livreur who drives V4: the BL leaves from his truck.
    await as(d).patch(`/orders/${o1.id}/livreur`, { livreurId: l4.id }).expect(200);
    await as(l4)
      .post(`/orders/${o1.id}/deliver`, {
        lines: [{ orderLineId: o1.lines[0]!.id, qty: '2' }],
      })
      .expect(200);

    // ---- clôture of S1's day: 100 DA short
    const session = (
      await as(d).post('/seller-sessions', { sellerId: s1.id, date: today }).expect(201)
    ).body as SellerSessionDto;
    const expected = (
      (await as(d).get(`/seller-sessions/${session.id}`).expect(200)).body as SellerSessionDto
    ).expected.total;
    await as(d)
      .post(`/seller-sessions/${session.id}/close`, {
        handedCash: (Number(expected) - 100).toFixed(2),
      })
      .expect(200);

    // ---- one sale of the day before, for comparisons and timelines
    const old = await sell(d, c3.id, [[pa, '1']], { warehouseId: main.id });
    await tamper(t)`UPDATE sales SET "validatedAt" = "validatedAt" - interval '1 day'
      WHERE id = ${old.id}::uuid`;
  }, 120_000);
  afterAll(() => t.close());

  describe('figures', () => {
    it('gives each tile its hand-computed value', async () => {
      const dto = await stats<StatsOverviewDto>(d, 'overview');
      const tiles = dto.tiles;
      expect(value(tiles, 'caTtc')).toBe('22848.00');
      expect(value(tiles, 'nbBl')).toBe('6');
      // 22 848 / 6
      expect(value(tiles, 'dropSize')).toBe('3808.00');
      // s1 has two products, the five others one: 7 / 6
      expect(value(tiles, 'skuPerBl')).toBe('1.17');
      // 84 kg
      expect(value(tiles, 'weightT')).toBe('0.084000');
      expect(cell(tiles, 'weightT').estimated).toBe(false);
      expect(value(tiles, 'activeClients')).toBe('3');
      // 3 000 + 1 000 + 500; the bounced cheque does not count
      expect(value(tiles, 'versements')).toBe('4500.00');
      // 4 500 / 22 848
      expect(value(tiles, 'recouvrement')).toBe('19.7');
      // o1 (3 cartons, delivered) and the open one; the cancelled order is left out
      expect(value(tiles, 'bcCount')).toBe('2');
      expect(value(tiles, 'bcTtc')).toBe('11424.00');
      // o1: 48 of 72 pièces; the cancelled order: 0 of 24
      expect(value(tiles, 'deliveryRate')).toBe('50.0');
      expect(value(tiles, 'openOrders')).toBe('1');
      expect(value(tiles, 'activeVehicles')).toBe('3');
      // The line of product B has no weight: counted apart, never as 0 kg.
      expect(dto.weightUnknownLines).toBe(1);
      expect(dto.notApplicable).toEqual({});
      expect(dto.bcPreviousDay).toMatchObject({ day: addDays(today, -1) });
      expect(dto.bcPreviousDay.count.value).toBe('0');
    });

    it('compares with the day before and draws a sum bucket by bucket', async () => {
      const dto = await stats<StatsOverviewDto>(d, 'overview', `${range}&compare=previous`);
      const ca = dto.tiles.find((x) => x.measure === 'caTtc')!;
      expect(dto.compare).toEqual({ from: addDays(today, -1), to: addDays(today, -1) });
      expect(ca.previous).toBe('2856.00');
      // (22 848 − 2 856) / 2 856
      expect(ca.changePct).toBe('700.0');
      expect(ca.trend).toBe('up');
      expect(ca.spark).toEqual([{ bucket: today, value: '22848.00' }]);
      // A rate is not summed bucket by bucket.
      expect(dto.tiles.find((x) => x.measure === 'dropSize')!.spark).toBeNull();
      expect(ca.link).toBe(`/ventes?status=VALIDATED&validatedFrom=${today}&validatedTo=${today}`);
    });

    it('gives one row per truck, and "Sans véhicule" for the rest', async () => {
      const dto = await stats<StatsByVehicleDto>(d, 'by-vehicle');
      const row = (id: string | null) => dto.rows.find((r) => (r.vehicle?.id ?? null) === id)!;
      // Every live truck is listed, even the two that did nothing.
      expect(dto.rows.map((r) => r.vehicle?.code ?? null)).toEqual([
        'LIV 05 MIX',
        'LIV 28 MIX',
        'PRV05-DD01',
        'VAN-05 MXT 03',
        'VAN-28 MXT 01',
        'VAN-28 MXT 02',
        null,
      ]);
      expect(row(v1.id).vehicle).toMatchObject({
        code: 'VAN-28 MXT 01',
        type: { code: 'MXT', activity: 'CASH_VAN' },
        wilayaCode: 28,
        capacityKg: 100,
        depot: { id: msila.id },
      });

      const a = row(v1.id).cells;
      expect(value(a, 'caTtc')).toBe('8568.00');
      expect(value(a, 'nbBl')).toBe('2');
      expect(value(a, 'dropSize')).toBe('4284.00');
      expect(value(a, 'skuPerBl')).toBe('1.50');
      expect(value(a, 'weightT')).toBe('0.024000');
      expect(value(a, 'weightUnknownLines')).toBe('1');
      expect(value(a, 'activeClients')).toBe('2');
      expect(value(a, 'versements')).toBe('3000.00');
      expect(value(a, 'recouvrement')).toBe('35.0');
      // 4 cartons of A (48 kg; B has no weight) on a truck of 100 kg
      expect(value(a, 'loadCount')).toBe('1');
      expect(value(a, 'loadWeightT')).toBe('0.048000');
      expect(value(a, 'fillRate')).toBe('48.0');
      // 144 pièces at 80
      expect(value(a, 'loadValueCost')).toBe('11520.00');
      // 6 cartons at 2 856 TTC
      expect(value(a, 'loadValueTtc')).toBe('17136.00');
      expect(value(a, 'damagedQty')).toBe('24.000');
      expect(value(a, 'damagedTtc')).toBe('2856.00');
      expect(value(a, 'cashEcart')).toBe('-100.00');
      expect(value(a, 'visitsPlanned')).toBe('3');
      expect(value(a, 'visitsDone')).toBe('2');
      expect(value(a, 'visitsSuccess')).toBe('1');
      expect(value(a, 'visitRate')).toBe('66.7');
      expect(value(a, 'successPlannedRate')).toBe('33.3');
      expect(value(a, 'successRate')).toBe('50.0');
      expect(row(v1.id).link).toBe(
        `/ventes?status=VALIDATED&validatedFrom=${today}&validatedTo=${today}&warehouseId=${v1.id}`,
      );

      const b = row(v2.id).cells;
      expect(value(b, 'caTtc')).toBe('5712.00');
      expect(value(b, 'weightT')).toBe('0.024000');
      // Collected by S5 while he drove V2, though recorded at the dépôt.
      expect(value(b, 'versements')).toBe('500.00');
      // No capacity on this truck: no rate, rather than a wrong one.
      expect(value(b, 'fillRate')).toBeNull();
      expect(value(b, 'visitsDone')).toBe('1');
      expect(value(b, 'visitRate')).toBeNull();

      // The prévente truck took the orders; the delivery truck delivered and sold.
      expect(value(row(v3.id).cells, 'bcCount')).toBe('2');
      expect(value(row(v3.id).cells, 'caTtc')).toBe('0.00');
      const livraison = row(v4.id).cells;
      expect(value(livraison, 'caTtc')).toBe('5712.00');
      expect(value(livraison, 'deliveryRate')).toBe('66.7');
      expect(value(row(v6.id).cells, 'caTtc')).toBe('0.00');
      expect(value(row(v5.id).cells, 'dropSize')).toBeNull();

      const none = row(null).cells;
      expect(value(none, 'caTtc')).toBe('2856.00');
      expect(value(none, 'versements')).toBe('1000.00');
      expect(row(null).link).toBeNull();
      expect(value(dto.totals, 'caTtc')).toBe('22848.00');
    });

    it('keeps a truck whole across a driver change and names both drivers', async () => {
      const dto = await stats<StatsByVehicleDto>(d, 'by-vehicle');
      const truck = dto.rows.find((r) => r.vehicle?.id === v2.id)!;
      expect(truck.drivers.map((x) => x.id)).toEqual([s2.id, s5.id]);
      // s3 by S2 (5 712 − 2 856 avoir) and s5 by S5 (2 856): one truck, one figure.
      expect(value(truck.cells, 'caTtc')).toBe('5712.00');
      expect(value(truck.cells, 'nbBl')).toBe('2');
      expect(dto.rows.find((r) => r.vehicle?.id === v1.id)!.drivers.map((x) => x.id)).toEqual([
        s1.id,
      ]);
    });

    it('adds up: Σ trucks and Σ of every dimension equal the overview', async () => {
      const overview = await stats<StatsOverviewDto>(d, 'overview');
      const byVehicle = await stats<StatsByVehicleDto>(d, 'by-vehicle');
      const sumOf = (rows: { cells: StatCell[] }[], measure: StatMeasure, digits: number) =>
        rows.reduce((acc, r) => acc + Number(value(r.cells, measure) ?? 0), 0).toFixed(digits);
      for (const [measure, digits] of [
        ['caTtc', 2],
        ['nbBl', 0],
        ['weightT', 6],
        ['versements', 2],
      ] as const) {
        const total = value(overview.tiles, measure);
        expect(sumOf(byVehicle.rows, measure, digits)).toBe(total);
        // The same figure in two tabs is the same figure.
        expect(value(byVehicle.totals, measure)).toBe(total);
      }
      for (const dimension of [
        'vehicleType',
        'activity',
        'depot',
        'vehicleWilaya',
        'clientWilaya',
        'segment',
        'sector',
        'client',
        'brand',
        'category',
        'subCategory',
        'product',
      ]) {
        const dto = await stats<StatsByDimensionDto>(
          d,
          'by-dimension',
          `${range}&dimension=${dimension}`,
        );
        expect(value(dto.totals, 'caTtc')).toBe('22848.00');
        expect(sumOf(dto.rows, 'caTtc', 2)).toBe('22848.00');
        expect(sumOf(dto.rows, 'weightT', 6)).toBe('0.084000');
      }
    });

    it('groups by type, dépôt, wilaya, segment, brand and family', async () => {
      const by = async (dimension: string) => {
        const dto = await stats<StatsByDimensionDto>(
          d,
          'by-dimension',
          `${range}&dimension=${dimension}`,
        );
        return Object.fromEntries(dto.rows.map((r) => [r.key ?? 'none', value(r.cells, 'caTtc')]));
      };
      expect(await by('vehicleType')).toEqual({
        [mxt.id]: '14280.00',
        [liv.id]: '5712.00',
        [prv.id]: '0.00',
        none: '2856.00',
      });
      expect(await by('activity')).toEqual({
        CASH_VAN: '14280.00',
        DELIVERY: '5712.00',
        PRESALE: '0.00',
        none: '2856.00',
      });
      expect(await by('depot')).toEqual({
        [msila.id]: '14280.00',
        [batna.id]: '5712.00',
        [main.id]: '2856.00',
      });
      expect(await by('vehicleWilaya')).toEqual({ 28: '14280.00', 5: '5712.00', none: '2856.00' });
      expect(await by('clientWilaya')).toEqual({
        "m'sila": '8568.00',
        batna: '11424.00',
        none: '2856.00',
      });
      expect(await by('segment')).toEqual({
        [seg1.id]: '8568.00',
        [seg2.id]: '11424.00',
        none: '2856.00',
      });
      // Per line, to the centime: B is the one carton of s1.
      expect(await by('brand')).toEqual({ [brand1.id]: '19992.00', [brand2.id]: '2856.00' });
      expect(await by('category')).toEqual({ [family1.id]: '19992.00', [family2.id]: '2856.00' });
      expect(await by('subCategory')).toEqual({ [sub1.id]: '19992.00', none: '2856.00' });

      const segments = await stats<StatsByDimensionDto>(
        d,
        'by-dimension',
        `${range}&dimension=segment`,
      );
      const row = segments.rows.find((r) => r.key === seg1.id)!;
      expect(row.label).toBe('Détaillant');
      expect(row.link).toContain(`segmentId=${seg1.id}`);
      // A dimension shows the figures it can carry: a chargement has no client.
      expect(segments.totals.map((x) => x.measure)).not.toContain('loadCount');
      expect(segments.totals.map((x) => x.measure)).toContain('versements');
      const brands = await stats<StatsByDimensionDto>(
        d,
        'by-dimension',
        `${range}&dimension=brand`,
      );
      expect(brands.totals.map((x) => x.measure)).not.toContain('versements');
      // A BL with two brands counts once in each: 6 BL in all, 6 + 1 across brands.
      expect(value(brands.totals, 'nbBl')).toBe('6');
      expect(brands.rows.map((r) => value(r.cells, 'nbBl')).sort()).toEqual(['1', '6']);
    });

    it('applies every filter inside the facts', async () => {
      const ca = async (filter: string) =>
        value((await stats<StatsOverviewDto>(d, 'overview', `${range}&${filter}`)).tiles, 'caTtc');
      expect(await ca(`vehicleIds=${v1.id},${v4.id}`)).toBe('14280.00');
      expect(await ca(`warehouseIds=${msila.id}`)).toBe('14280.00');
      expect(await ca(`warehouseIds=${main.id}`)).toBe('2856.00');
      expect(await ca(`vehicleTypeIds=${liv.id}`)).toBe('5712.00');
      expect(await ca('activities=CASH_VAN')).toBe('14280.00');
      expect(await ca('vehicleWilayas=5')).toBe('5712.00');
      expect(await ca('clientWilayas=batna')).toBe('11424.00');
      expect(await ca(`segmentIds=${seg1.id}`)).toBe('8568.00');
      expect(await ca(`clientIds=${c3.id}`)).toBe('2856.00');
      expect(await ca(`brandIds=${brand2.id}`)).toBe('2856.00');
      // A family includes its sub-families.
      expect(await ca(`categoryIds=${family1.id}`)).toBe('19992.00');
      expect(await ca(`productIds=${pb.id}`)).toBe('2856.00');
      expect(await ca(`vehicleIds=${v1.id}&brandIds=${brand2.id}`)).toBe('2856.00');
    });

    it('marks a weight estimated when the line has no frozen weight', async () => {
      // A line written before phase 37.
      await tamper(t)`UPDATE sale_lines l SET "weightKg" = NULL FROM sales s
        WHERE s.id = l."saleId" AND s."tenantId" = ${d.tenantId}::uuid
          AND s."warehouseId" = ${main.id}::uuid`;
      try {
        const dto = await stats<StatsByVehicleDto>(d, 'by-vehicle');
        const none = dto.rows.find((r) => r.vehicle === null)!;
        // The product's weight today gives the same 12 kg, flagged.
        expect(cell(none.cells, 'weightT')).toMatchObject({ value: '0.012000', estimated: true });
        expect(
          cell(dto.rows.find((r) => r.vehicle?.id === v1.id)!.cells, 'weightT').estimated,
        ).toBe(false);
        expect(cell(dto.totals, 'weightT')).toMatchObject({ value: '0.084000', estimated: true });
      } finally {
        await tamper(t)`UPDATE sale_lines l SET "weightKg" = 12 FROM sales s
          WHERE s.id = l."saleId" AND s."tenantId" = ${d.tenantId}::uuid
            AND s."warehouseId" = ${main.id}::uuid`;
      }
    });

    it('freezes the weight on the line: a product change does not move history', async () => {
      await tamper(t)`UPDATE products SET "weightKg" = 9 WHERE id = ${pa.id}::uuid`;
      try {
        const dto = await stats<StatsOverviewDto>(d, 'overview');
        expect(value(dto.tiles, 'weightT')).toBe('0.084000');
        expect(cell(dto.tiles, 'weightT').estimated).toBe(false);
      } finally {
        await tamper(t)`UPDATE products SET "weightKg" = 0.5 WHERE id = ${pa.id}::uuid`;
      }
    });

    it('never lets the taux de livraison exceed 100 %', async () => {
      // An over-delivery (5 cartons on a line of 3) cannot even be stored: the split
      // delivered + not delivered = ordered is a CHECK of the table. The statistics cap
      // each line all the same (`cappedDelivered`, unit-tested in @erp/shared).
      await expect(
        tamper(t)`UPDATE order_lines SET "qtyDelivered" = 5 WHERE "orderId" = ${o1.id}::uuid`,
      ).rejects.toThrow(/order_lines_delivery_split/);
      // The most a line can say: everything delivered.
      await tamper(t)`UPDATE order_lines SET "qtyDelivered" = 3, "qtyNotDelivered" = 0
        WHERE "orderId" = ${o1.id}::uuid`;
      try {
        const dto = await stats<StatsByVehicleDto>(d, 'by-vehicle');
        const truck = dto.rows.find((r) => r.vehicle?.id === v4.id)!;
        expect(value(truck.cells, 'deliveryRate')).toBe('100.0');
        // Line by line: the cancelled order still weighs on the total (72 of 96).
        expect(value(dto.totals, 'deliveryRate')).toBe('75.0');
        for (const row of dto.rows) {
          const rate = value(row.cells, 'deliveryRate');
          if (rate != null) expect(Number(rate)).toBeLessThanOrEqual(100);
        }
      } finally {
        await tamper(t)`UPDATE order_lines SET "qtyDelivered" = 2, "qtyNotDelivered" = 1
          WHERE "orderId" = ${o1.id}::uuid`;
      }
    });

    it('counts visits and the causes of non-achat', async () => {
      const dto = await stats<StatsVisitsDto>(d, 'visits');
      expect(value(dto.totals, 'visitsPlanned')).toBe('3');
      expect(value(dto.totals, 'plannedVisited')).toBe('2');
      expect(value(dto.totals, 'visitsDone')).toBe('3');
      expect(value(dto.totals, 'visitsSuccess')).toBe('1');
      expect(value(dto.totals, 'visitsNoSale')).toBe('2');
      expect(value(dto.totals, 'visitRate')).toBe('66.7');
      expect(value(dto.totals, 'successRate')).toBe('33.3');
      expect(dto.reasons).toEqual([
        { reason: 'CLOSED', count: 1 },
        { reason: 'NO_MONEY', count: 1 },
      ]);
      expect(dto.rows.map((r) => r.vehicle?.id)).toEqual([v1.id, v2.id]);
      expect(dto.planningKnownFrom).toBe(today);
    });

    it('draws a timeline with its comparison and a split by truck', async () => {
      const yesterday = addDays(today, -1);
      const dto = await stats<StatsTimelineDto>(
        d,
        'timeline',
        `from=${yesterday}&to=${today}&measure=caTtc&compare=previous&splitBy=vehicle&vehicleIds=${v1.id},${v2.id}`,
      );
      // The filter keeps the two trucks: yesterday's dépôt sale is not theirs.
      expect(dto.buckets.map((b) => [b.bucket, b.value])).toEqual([
        [yesterday, '0.00'],
        [today, '14280.00'],
      ]);
      expect(dto.series.map((s) => [s.key, s.values])).toEqual([
        [v1.id, ['0.00', '8568.00']],
        [v2.id, ['0.00', '5712.00']],
      ]);
      expect(dto.series[0]!.label).toBe('VAN-28 MXT 01 · VAN-28 MXT 01');
      const all = await stats<StatsTimelineDto>(
        d,
        'timeline',
        `from=${yesterday}&to=${today}&measure=caTtc`,
      );
      expect(all.buckets.map((b) => b.value)).toEqual(['2856.00', '22848.00']);
      const month = await stats<StatsTimelineDto>(
        d,
        'timeline',
        `from=${yesterday}&to=${today}&measure=nbBl&groupBy=month`,
      );
      expect(month.buckets.reduce((acc, b) => acc + Number(b.value), 0)).toBe(7);
    });

    it('spreads the CA of each truck over the days', async () => {
      const yesterday = addDays(today, -1);
      const dto = await stats<StatsDispersionDto>(d, 'dispersion', `from=${yesterday}&to=${today}`);
      expect(dto.days).toEqual([yesterday, today]);
      const truck = dto.rows.find((r) => r.vehicle?.id === v1.id)!;
      expect(truck.cells).toEqual([
        { caTtc: '0.00', nbBl: 0 },
        { caTtc: '8568.00', nbBl: 2 },
      ]);
      expect(dto.rows.find((r) => r.vehicle === null)!.cells).toEqual([
        { caTtc: '2856.00', nbBl: 1 },
        { caTtc: '2856.00', nbBl: 1 },
      ]);
      expect(dto.maxCaTtc).toBe('8568.00');
    });

    it('lists the clients lost since the comparison period', async () => {
      // C3 bought yesterday and today; make yesterday's sale another client's only one.
      const lonely = (
        await as(d)
          .post('/clients', { code: `SC${++seq}`, name: 'Client Perdu' }, null)
          .expect(201)
      ).body as ClientDto;
      const old = await sell(d, lonely.id, [[pa, '1']], { warehouseId: main.id });
      await tamper(t)`UPDATE sales SET "validatedAt" = "validatedAt" - interval '1 day'
        WHERE id = ${old.id}::uuid`;
      try {
        const dto = await stats<StatsLostClientsDto>(d, 'lost-clients');
        expect(dto.compare).toEqual({ from: addDays(today, -1), to: addDays(today, -1) });
        expect(dto).toMatchObject({ active: 3, previousActive: 2, count: 1 });
        expect(dto.clients).toEqual([
          {
            id: lonely.id,
            name: 'Client Perdu',
            previousCaTtc: '2856.00',
            link: `/clients/${lonely.id}`,
          },
        ]);
      } finally {
        // Out of the other tests' figures.
        await tamper(t)`UPDATE sales SET "validatedAt" = "validatedAt" - interval '40 days'
          WHERE id = ${old.id}::uuid`;
      }
    });

    it('recaps the day of a truck with its documents', async () => {
      const dto = await stats<StatsVehicleDayDto>(
        d,
        'vehicle-day',
        `vehicleId=${v1.id}&date=${today}`,
      );
      expect(dto.vehicle.code).toBe('VAN-28 MXT 01');
      expect(dto.drivers.map((x) => x.id)).toEqual([s1.id]);
      expect(dto.loads).toHaveLength(1);
      expect(dto.loads[0]).toMatchObject({ weightKg: '48.000', party: main.name });
      expect(dto.loads[0]!.link).toMatch(/^\/stock\/transferts\//);
      expect(dto.sales.map((s) => s.amount)).toEqual(['8568.00', '2856.00']);
      expect(dto.sales[0]!.link).toMatch(/^\/ventes\//);
      expect(dto.returns).toHaveLength(1);
      expect(dto.returns[0]).toMatchObject({
        damaged: true,
        amount: '2856.00',
        weightKg: '12.000',
      });
      expect(dto.unloads).toEqual([]);
      expect(dto.payments.map((p) => p.amount)).toEqual(['3000.00']);
      expect(dto.cash).toMatchObject({ closed: true, ecart: '-100.00' });
      expect(Number(dto.cash.handed)).toBe(Number(dto.cash.expected) - 100);
      expect(value(dto.cells, 'caTtc')).toBe('8568.00');
      expect(value(dto.cells, 'versements')).toBe('3000.00');
      expect(value(dto.cells, 'visitsDone')).toBe('2');
    });
  });

  describe('contract: every measure on every dimension', () => {
    /** The dimensions on which a distinct count still adds up: those of its own subject. */
    const ADDITIVE_DISTINCT: Partial<Record<StatMeasure, EngineDimension[]>> = {
      // A document is on one truck, one day, one client.
      nbBl: [
        'vehicle',
        'vehicleType',
        'activity',
        'depot',
        'vehicleWilaya',
        'clientWilaya',
        'segment',
        'sector',
        'client',
        'day',
        'week',
        'month',
      ],
      activeClients: ['clientWilaya', 'segment', 'sector', 'client'],
      activeVehicles: ['vehicle', 'vehicleType', 'activity', 'depot', 'vehicleWilaya'],
    };

    it('Σ of the grouped rows equals the ungrouped total', async () => {
      const engine = t.app.get(StatsQueryService);
      const yesterday = addDays(today, -1);
      const base = STAT_MEASURE_KEYS.filter((m) => MEASURE_SOURCES[m]);
      // Every non-ratio measure has a source; every ratio is made of two of them.
      expect(
        base.length +
          STAT_MEASURE_KEYS.filter((m) => STAT_MEASURES[m].additivity === 'ratio').length,
      ).toBe(STAT_MEASURE_KEYS.length);
      const dimensions = Object.keys(DIMENSIONS) as EngineDimension[];
      let checked = 0;
      for (const dimension of dimensions) {
        const measures = base.filter((m) =>
          MEASURE_SOURCES[m]!.some((parts) =>
            parts.every((s) => factCarries(s.fact, DIMENSIONS[dimension].needs)),
          ),
        );
        expect(measures.length).toBeGreaterThan(0);
        const result = await tenantContext.run({ tenantId: d.tenantId }, () =>
          engine.run({
            range: { from: yesterday, to: today },
            measures,
            sets: [[], [dimension]],
            filters: {},
            reach: { warehouseIds: null, defaultWarehouseId: main.id },
            finance: true,
          }),
        );
        const total = result.sets[0]![0]!.cells;
        for (const measure of measures) {
          const def: StatMeasureDef = STAT_MEASURES[measure];
          const sum = result.sets[1]!.reduce(
            (acc, r) => acc + Number(value(r.cells, measure) ?? 0),
            0,
          );
          const whole = Number(value(total, measure));
          const exact =
            def.additivity === 'sum' || ADDITIVE_DISTINCT[measure]?.includes(dimension) === true;
          const label = `${measure} by ${dimension}`;
          if (exact) expect([label, sum.toFixed(6)]).toEqual([label, whole.toFixed(6)]);
          else expect([label, sum >= whole]).toEqual([label, true]);
          checked += 1;
        }
      }
      // 29 measures over 17 dimensions, less the pairs a fact cannot carry.
      expect(checked).toBeGreaterThan(250);
    });
  });

  describe('scope', () => {
    it('shows a dépôt viewer only his dépôt and its trucks, also in the totals', async () => {
      const dto = await stats<StatsByVehicleDto>(batnaViewer, 'by-vehicle');
      expect(dto.rows.map((r) => r.vehicle?.id)).toEqual([v4.id, v3.id]);
      expect(value(dto.totals, 'caTtc')).toBe('5712.00');
      expect(value(dto.totals, 'versements')).toBe('0.00');
      const overview = await stats<StatsOverviewDto>(batnaViewer, 'overview');
      expect(value(overview.tiles, 'caTtc')).toBe('5712.00');
      expect(value(overview.tiles, 'bcCount')).toBe('2');
      // A filter on a truck outside his reach gives nothing, never more.
      const outside = await stats<StatsOverviewDto>(
        batnaViewer,
        'overview',
        `${range}&vehicleIds=${v1.id}`,
      );
      expect(value(outside.tiles, 'caTtc')).toBe('0.00');
      const depots = await stats<StatsByDimensionDto>(
        batnaViewer,
        'by-dimension',
        `${range}&dimension=depot`,
      );
      expect(depots.rows.map((r) => r.key)).toEqual([batna.id]);
      await as(batnaViewer)
        .get(`/stats/distribution/vehicle-day?vehicleId=${v1.id}&date=${today}`)
        .expect(404);
    });

    it("shows a supervisor his team's trucks, without cost values", async () => {
      const dto = await stats<StatsByVehicleDto>(supervisor, 'by-vehicle');
      expect(dto.rows.map((r) => r.vehicle?.id)).toEqual([v1.id]);
      expect(value(dto.totals, 'caTtc')).toBe('8568.00');
      // REPORTS_FINANCE off: cost values are null, the TTC basis stays.
      expect(dto.finance).toBe(false);
      expect(value(dto.totals, 'loadValueCost')).toBeNull();
      expect(value(dto.totals, 'loadValueTtc')).toBe('17136.00');
      const owner = await stats<StatsByVehicleDto>(d, 'by-vehicle');
      expect(owner.finance).toBe(true);
      // 11 520 + 7 680 + 5 760
      expect(value(owner.totals, 'loadValueCost')).toBe('24960.00');
    });

    it('gives a seller only "Mon véhicule"', async () => {
      for (const path of ['overview', 'by-vehicle', 'visits', 'dispersion']) {
        const res = await as(s1).get(`/stats/distribution/${path}?${range}`).expect(403);
        expect(errorOf(res).code).toBe(ErrorCode.FORBIDDEN);
      }
      await as(s1).get(`/stats/distribution/by-dimension?${range}&dimension=depot`).expect(403);
      await as(s1).get(`/stats/distribution/timeline?${range}&measure=caTtc`).expect(403);
      await as(s1)
        .get(`/stats/distribution/vehicle-day?vehicleId=${v2.id}&date=${today}`)
        .expect(403);
      await as(l4).get(`/stats/distribution/overview?${range}`).expect(403);
      await as(s1)
        .get(`/vehicle-targets?period=${monthStart(today)}`)
        .expect(403);

      const mine = (await as(s1).get('/stats/distribution/my-vehicle').expect(200))
        .body as StatsMyVehicleDto;
      expect(mine.vehicle?.id).toBe(v1.id);
      expect(value(mine.today, 'caTtc')).toBe('8568.00');
      expect(value(mine.today, 'nbBl')).toBe('2');
      expect(value(mine.today, 'versements')).toBe('3000.00');
      expect(value(mine.today, 'visitsDone')).toBe('2');
      expect(value(mine.today, 'visitsPlanned')).toBe('3');
      // S2 no longer drives a truck: no card, and nothing of the truck he left.
      const none = (await as(s2).get('/stats/distribution/my-vehicle').expect(200))
        .body as StatsMyVehicleDto;
      expect(none).toMatchObject({ vehicle: null, today: [] });
    });

    it('keeps companies apart on every endpoint', async () => {
      const paths: [string, string][] = [
        ['overview', range],
        ['by-vehicle', range],
        ['by-dimension', `${range}&dimension=depot`],
        ['timeline', `${range}&measure=caTtc`],
        ['visits', range],
        ['dispersion', range],
      ];
      for (const [path, query] of paths) {
        // B asks with A's ids in every filter: nothing of A comes back.
        const foreign = `${query}&vehicleIds=${v1.id}&warehouseIds=${msila.id}&clientIds=${c1.id}&segmentIds=${seg1.id}`;
        const res = await as(other)
          .get(
            `/stats/distribution/${path}?${path === 'visits' ? `${query}&vehicleIds=${v1.id}` : foreign}`,
          )
          .expect(200);
        // (Links echo the caller's own filters; no row, name or amount of A does.)
        const text = JSON.stringify(res.body);
        expect(text).not.toContain(c1.name);
        expect(text).not.toContain('8568.00');
        expect(text).not.toContain('14280.00');
        expect(text).not.toContain('VAN-28 MXT 01');
      }
      const own = await stats<StatsOverviewDto>(other, 'overview');
      expect(value(own.tiles, 'caTtc')).toBe('0.00');
      expect(value(own.tiles, 'nbBl')).toBe('0');
      await as(other)
        .get(`/stats/distribution/vehicle-day?vehicleId=${v1.id}&date=${today}`)
        .expect(404);
      const targets = (
        await as(other)
          .get(`/vehicle-targets?period=${monthStart(today)}`)
          .expect(200)
      ).body as VehicleTargetsDto;
      expect(targets.targets).toEqual([]);
      const refused = await as(other)
        .put('/vehicle-targets', {
          period: monthStart(today),
          targets: [{ vehicleId: v1.id, metric: 'CA_TTC', targetValue: '1' }],
        })
        .expect(404);
      expect(errorOf(refused).code).toBe(ErrorCode.WAREHOUSE_NOT_FOUND);
      expect((await as(other).get('/client-segments').expect(200)).body).toEqual([]);
      await as(other).patch(`/client-segments/${seg1.id}`, { name: 'Volé' }).expect(404);
      const stolen = await as(other)
        .post('/clients', { code: 'X1', name: 'Client B', segmentId: seg1.id }, null)
        .expect(404);
      expect(errorOf(stolen).details).toMatchObject({ field: 'segmentId' });
    });

    it('is refused without the module', async () => {
      for (const url of [
        `/stats/distribution/overview?${range}`,
        `/stats/distribution/by-vehicle?${range}`,
        '/stats/distribution/my-vehicle',
        `/stats/distribution/export.xlsx?view=overview&${range}`,
        `/vehicle-targets?period=${monthStart(today)}`,
        '/client-segments',
      ]) {
        const res = await as(essentiel).get(url).expect(403);
        expect(errorOf(res).code).toBe(ErrorCode.FEATURE_NOT_IN_PLAN);
      }
    });
  });

  describe('filters a view cannot apply', () => {
    it('refuses them, never ignores them', async () => {
      const refused = await as(d)
        .get(`/stats/distribution/visits?${range}&brandIds=${brand1.id}`)
        .expect(400);
      expect(errorOf(refused)).toMatchObject({
        code: ErrorCode.STATS_FILTER_NOT_APPLICABLE,
        details: { filters: ['brandIds'] },
      });
      const split = await as(d)
        .get(`/stats/distribution/timeline?${range}&measure=versements&splitBy=brand`)
        .expect(400);
      expect(errorOf(split).code).toBe(ErrorCode.STATS_FILTER_NOT_APPLICABLE);
      await as(d)
        .get(`/stats/distribution/timeline?${range}&measure=cashEcart&clientIds=${c1.id}`)
        .expect(400);
    });

    it('nulls the figures that cannot follow a filter the view accepts, and says so', async () => {
      const dto = await stats<StatsOverviewDto>(d, 'overview', `${range}&brandIds=${brand1.id}`);
      expect(value(dto.tiles, 'caTtc')).toBe('19992.00');
      // A versement has no brand: no figure rather than the unfiltered one.
      expect(value(dto.tiles, 'versements')).toBeNull();
      expect(value(dto.tiles, 'recouvrement')).toBeNull();
      expect(dto.notApplicable).toMatchObject({
        versements: ['brandIds'],
        recouvrement: ['brandIds'],
        bcCount: ['brandIds'],
      });
      // An order line has a product: the delivery rate follows the filter.
      expect(value(dto.tiles, 'deliveryRate')).toBe('50.0');
    });

    it('validates the query', async () => {
      await as(d).get('/stats/distribution/overview').expect(400);
      await as(d)
        .get(`/stats/distribution/overview?from=${today}&to=${addDays(today, -1)}`)
        .expect(400);
      await as(d)
        .get(`/stats/distribution/overview?from=${addDays(today, -400)}&to=${today}`)
        .expect(400);
      await as(d).get(`/stats/distribution/by-dimension?${range}&dimension=vehicle`).expect(400);
      await as(d).get(`/stats/distribution/overview?${range}&vehicleIds=nope`).expect(400);
    });
  });

  describe('drill-down', () => {
    it('opens a sales list with the same total as the figure', async () => {
      const byVehicle = await stats<StatsByVehicleDto>(d, 'by-vehicle');
      for (const id of [v1.id, v2.id, v4.id]) {
        const row = byVehicle.rows.find((r) => r.vehicle?.id === id)!;
        const page = (
          await as(d)
            .get(`${row.link!.replace('/ventes', '/sales')}&summary=true`)
            .expect(200)
        ).body as SalePage;
        expect(page.summary!.netTtc).toBe(value(row.cells, 'caTtc'));
        expect(String(page.summary!.count)).toBe(value(row.cells, 'nbBl'));
      }
      const depots = await stats<StatsByDimensionDto>(
        d,
        'by-dimension',
        `${range}&dimension=depot`,
      );
      for (const row of depots.rows) {
        const page = (
          await as(d)
            .get(`${row.link!.replace('/ventes', '/sales')}&summary=true`)
            .expect(200)
        ).body as SalePage;
        expect(page.summary!.netTtc).toBe(value(row.cells, 'caTtc'));
      }
      const segment = (
        await as(d)
          .get(
            `/sales?status=VALIDATED&validatedFrom=${today}&validatedTo=${today}&segmentId=${seg2.id}&summary=true`,
          )
          .expect(200)
      ).body as SalePage;
      expect(segment.summary).toEqual({
        count: 3,
        totalTtc: '11424.00',
        returnsTtc: '0.00',
        netTtc: '11424.00',
      });
      // Without `summary=true` the page is what it was.
      const plain = (await as(d).get('/sales').expect(200)).body as SalePage;
      expect(plain.summary).toBeUndefined();
    });

    it('lists the versements of a truck as the statistics count them', async () => {
      const list = (
        await as(d)
          .get(`/payments?status=VALID&from=${today}&to=${today}&vehicleId=${v2.id}`)
          .expect(200)
      ).body as { items: PaymentDto[] };
      expect(list.items.map((p) => p.amount)).toEqual(['500.00']);
      const clients = (await as(d).get(`/clients?segmentId=${seg1.id}`).expect(200)).body as {
        items: ClientDto[];
      };
      expect(clients.items.map((c) => c.id)).toEqual([c1.id]);
      const orders = (
        await as(d)
          .get(`/orders?confirmedFrom=${today}&confirmedTo=${today}&vehicleId=${v3.id}`)
          .expect(200)
      ).body as { items: OrderDto[] };
      expect(orders.items).toHaveLength(3);
      const before = (
        await as(d)
          .get(`/orders?confirmedTo=${addDays(today, -1)}&vehicleId=${v3.id}`)
          .expect(200)
      ).body as { items: OrderDto[] };
      expect(before.items).toHaveLength(0);
      const loads = (
        await as(d)
          .get(`/stock-transfers?type=LOAD&toWarehouseId=${v1.id}&from=${today}&to=${today}`)
          .expect(200)
      ).body as { items: unknown[] };
      expect(loads.items).toHaveLength(1);
    });
  });

  describe('export', () => {
    it('writes the rows of a view as one sheet, numbers as numbers', async () => {
      const res = await as(d)
        .get(`/stats/distribution/export.xlsx?view=by-vehicle&${range}`)
        .buffer()
        .parse((r, done) => {
          const chunks: Buffer[] = [];
          r.on('data', (c: Buffer) => chunks.push(c));
          r.on('end', () => done(null, Buffer.concat(chunks)));
        })
        .expect(200);
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(res.body as ArrayBuffer);
      const sheet = workbook.worksheets[0]!;
      expect(sheet.name).toBe('Véhicules');
      const header = (sheet.getRow(3).values as unknown[]).slice(1);
      expect(header.slice(0, 6)).toEqual([
        'Véhicule',
        'Type',
        'Wilaya',
        'Dépôt',
        'Chauffeur(s)',
        'CA TTC',
      ]);
      const rows = sheet.getSheetValues().slice(4) as unknown[][];
      const truck = rows.find((r) => r?.[1] === 'VAN-28 MXT 01 · VAN-28 MXT 01')!;
      expect(truck[6]).toBe(8568);
      expect(rows.at(-1)![1]).toBe('Total');
      expect(rows.at(-1)![6]).toBe(22848);
      for (const view of [
        `view=overview&${range}`,
        `view=by-dimension&dimension=brand&${range}`,
        `view=timeline&measure=caTtc&${range}`,
        `view=visits&${range}`,
        `view=dispersion&${range}`,
        `view=vehicle-day&vehicleId=${v1.id}&date=${today}`,
      ]) {
        await as(d).get(`/stats/distribution/export.xlsx?${view}`).expect(200);
      }
      await as(d).get(`/stats/distribution/export.xlsx?view=by-dimension&${range}`).expect(400);
      // Exporting is its own permission.
      await as(supervisor)
        .get(`/stats/distribution/export.xlsx?view=overview&${range}`)
        .expect(403);
    });
  });

  describe('vehicle targets', () => {
    const period = monthStart(today);

    it('sets a month of targets, audited, one per truck and metric', async () => {
      const put = (targets: object[]) => as(d).put('/vehicle-targets', { period, targets });
      const first = (
        await put([
          { vehicleId: v1.id, metric: 'CA_TTC', targetValue: '10000' },
          { vehicleId: v1.id, metric: 'POIDS_KG', targetValue: '48' },
          { vehicleId: v2.id, metric: 'NB_BL', targetValue: '4' },
        ]).expect(200)
      ).body as VehicleTargetsDto;
      expect(first.targets).toHaveLength(3);
      // The same month again: the value is replaced, not doubled.
      await put([{ vehicleId: v1.id, metric: 'CA_TTC', targetValue: '12000' }]).expect(200);
      await put([{ vehicleId: v1.id, metric: 'CA_TTC', targetValue: '12000' }]).expect(200);
      const rows = await asTenant(d.tenantId, () =>
        t.prisma.db.vehicleTarget.findMany({ where: { vehicleId: v1.id, metric: 'CA_TTC' } }),
      );
      expect(rows.map((r) => r.targetValue.toString())).toEqual(['12000']);
      const audits = await asTenant(d.tenantId, () =>
        t.prisma.db.auditLog.findMany({
          where: { entity: 'VehicleTarget', entityId: v1.id },
          orderBy: { createdAt: 'asc' },
          select: { action: true, after: true },
        }),
      );
      // Set twice, changed once; the identical third write wrote nothing.
      expect(audits.map((a) => a.action)).toEqual([
        'VEHICLE_TARGET_SET',
        'VEHICLE_TARGET_SET',
        'VEHICLE_TARGET_CHANGED',
      ]);
      expect(audits[2]!.after).toMatchObject({ metric: 'CA_TTC', targetValue: '12000' });

      // The unique index is the last word.
      await expect(
        tamper(t)`INSERT INTO vehicle_targets
          ("id", "tenantId", "vehicleId", "periodStart", "metric", "targetValue", "updatedAt")
          VALUES (gen_random_uuid(), ${d.tenantId}::uuid, ${v1.id}::uuid, ${period}::date,
                  'CA_TTC', 5, now())`,
      ).rejects.toThrow();

      const bad = (body: object) => as(d).put('/vehicle-targets', body).expect(400);
      await bad({ period: addDays(period, 1), targets: [] });
      await bad({ period, targets: [{ vehicleId: v1.id, metric: 'CA_TTC', targetValue: '-1' }] });
      // A dépôt is not a truck.
      const depot = await put([{ vehicleId: main.id, metric: 'CA_TTC', targetValue: '1' }]).expect(
        404,
      );
      expect(errorOf(depot).code).toBe(ErrorCode.WAREHOUSE_NOT_FOUND);
      // Reading needs the reports, editing the settings.
      await as(supervisor)
        .put('/vehicle-targets', {
          period,
          targets: [{ vehicleId: v1.id, metric: 'CA_TTC', targetValue: '1' }],
        })
        .expect(403);
    });

    it('shows the réalisation of the month against the target', async () => {
      const month = `from=${period}&to=${today}`;
      const dto = await stats<StatsByVehicleDto>(d, 'by-vehicle', month);
      const truck = dto.rows.find((r) => r.vehicle?.id === v1.id)!;
      expect(truck.objectives).toEqual([
        // 8 568 of 12 000
        {
          metric: 'CA_TTC',
          periodStart: period,
          target: '12000.00',
          achieved: '8568.00',
          pct: '71.4',
        },
        // 24 kg of 48
        {
          metric: 'POIDS_KG',
          periodStart: period,
          target: '48.000',
          achieved: '24.000',
          pct: '50.0',
        },
      ]);
      expect(dto.rows.find((r) => r.vehicle?.id === v2.id)!.objectives).toEqual([
        { metric: 'NB_BL', periodStart: period, target: '4', achieved: '2', pct: '50.0' },
      ]);
      expect(dto.rows.find((r) => r.vehicle?.id === v4.id)!.objectives).toEqual([]);
      const mine = (await as(s1).get('/stats/distribution/my-vehicle').expect(200))
        .body as StatsMyVehicleDto;
      expect(mine.objectives.map((o) => o.metric)).toEqual(['CA_TTC', 'POIDS_KG']);
    });

    it('removes a target and copies last month in one action', async () => {
      const cleared = (
        await as(d)
          .put('/vehicle-targets', {
            period,
            targets: [{ vehicleId: v2.id, metric: 'NB_BL', targetValue: null }],
          })
          .expect(200)
      ).body as VehicleTargetsDto;
      expect(cleared.targets.map((x) => x.metric).sort()).toEqual(['CA_TTC', 'POIDS_KG']);

      const next = monthStart(addDays(period, 40));
      expect(previousMonthStart(next)).toBe(period);
      // The month already has one target typed by hand: the copy keeps it.
      await as(d)
        .put('/vehicle-targets', {
          period: next,
          targets: [{ vehicleId: v1.id, metric: 'CA_TTC', targetValue: '15000' }],
        })
        .expect(200);
      const copy = (
        await as(d).post('/vehicle-targets/copy-previous', { period: next }, null).expect(200)
      ).body as VehicleTargetsDto & { copied: number };
      expect(copy.copied).toBe(1);
      expect(Object.fromEntries(copy.targets.map((x) => [x.metric, x.targetValue]))).toEqual({
        CA_TTC: '15000',
        POIDS_KG: '48',
      });
      const again = (
        await as(d).post('/vehicle-targets/copy-previous', { period: next }, null).expect(200)
      ).body as { copied: number };
      expect(again.copied).toBe(0);
      const audit = await asTenant(d.tenantId, () =>
        t.prisma.db.auditLog.findFirst({
          where: { entity: 'VehicleTarget', action: 'VEHICLE_TARGET_SET' },
          orderBy: { createdAt: 'desc' },
          select: { after: true },
        }),
      );
      expect(audit!.after).toMatchObject({ period: next, copiedFrom: period, metric: 'POIDS_KG' });
    });
  });

  describe('client segments', () => {
    it('creates, renames and archives the segments the owner names', async () => {
      const created = (
        await as(d).post('/client-segments', { code: 'CAF', name: 'Café' }, null).expect(201)
      ).body as ClientSegmentDto;
      expect(created).toMatchObject({ code: 'CAF', name: 'Café', archived: false, clientCount: 0 });
      const dup = await as(d)
        .post('/client-segments', { code: 'caf', name: 'Autre' }, null)
        .expect(409);
      expect(errorOf(dup).code).toBe(ErrorCode.CLIENT_SEGMENT_CODE_TAKEN);
      const renamed = (
        await as(d).patch(`/client-segments/${created.id}`, { name: 'Café / salon' }).expect(200)
      ).body as ClientSegmentDto;
      expect(renamed.name).toBe('Café / salon');

      const client = (
        await as(d)
          .post('/clients', { code: `SC${++seq}`, name: 'Le Café', segmentId: created.id }, null)
          .expect(201)
      ).body as ClientDto;
      expect(client.segment).toEqual({ id: created.id, code: 'CAF', name: 'Café / salon' });
      const list = (await as(d).get('/client-segments').expect(200)).body as ClientSegmentDto[];
      expect(list.find((s) => s.id === created.id)!.clientCount).toBe(1);

      await as(d).post(`/client-segments/${created.id}/archive`, {}, null).expect(204);
      const live = (await as(d).get('/client-segments').expect(200)).body as ClientSegmentDto[];
      expect(live.map((s) => s.id)).not.toContain(created.id);
      const all = (await as(d).get('/client-segments?archived=true').expect(200))
        .body as ClientSegmentDto[];
      expect(all.find((s) => s.id === created.id)!.archived).toBe(true);
      // The client keeps it; a new client cannot take an archived segment; the code is free.
      const kept = (await as(d).get(`/clients/${client.id}`).expect(200)).body as ClientDto;
      expect(kept.segment?.id).toBe(created.id);
      await as(d)
        .patch(`/clients/${client.id}`, { ...clientBody(kept), name: 'Le Café 2' })
        .expect(200);
      await as(d)
        .post('/clients', { code: `SC${++seq}`, name: 'Autre', segmentId: created.id }, null)
        .expect(404);
      await as(d).post('/client-segments', { code: 'CAF', name: 'Cafétéria' }, null).expect(201);
      const audits = await asTenant(d.tenantId, () =>
        t.prisma.db.auditLog.findMany({
          where: { entity: 'ClientSegment', entityId: created.id },
          orderBy: { createdAt: 'asc' },
          select: { action: true },
        }),
      );
      expect(audits.map((a) => a.action)).toEqual([
        'CLIENT_SEGMENT_CREATED',
        'CLIENT_SEGMENT_UPDATED',
        'CLIENT_SEGMENT_ARCHIVED',
      ]);
      // Editing segments is a settings right.
      await as(supervisor).post('/client-segments', { code: 'Z', name: 'Z' }, null).expect(403);
      // Clearing the segment of a client.
      const cleared = (
        await as(d)
          .patch(`/clients/${client.id}`, {
            ...clientBody((await as(d).get(`/clients/${client.id}`).expect(200)).body as ClientDto),
            segmentId: null,
          })
          .expect(200)
      ).body as ClientDto;
      expect(cleared.segment).toBeNull();
    });
  });

  describe('client import: the "Type" column', () => {
    const file = async (rows: (string | null)[][]) => {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Feuil1');
      for (const r of rows) ws.addRow(r);
      return Buffer.from(await wb.xlsx.writeBuffer());
    };
    const preview = async (buffer: Buffer) =>
      (
        await t
          .http()
          .post('/imports/CLIENTS/preview')
          .set(...bearer(d.auth.accessToken))
          .attach('file', buffer, 'clients.xlsx')
          .expect(200)
      ).body as ImportPreviewDto;
    const confirm = (jobId: string, body: object = {}) =>
      as(d).post(`/imports/${jobId}/confirm`, body).expect(200);
    const byCode = async (code: string) =>
      (
        (await as(d).get(`/clients?search=${code}`).expect(200)).body as { items: ClientDto[] }
      ).items.find((c) => c.code === code)!;

    it('maps known segments by code or name and lists the unknown ones', async () => {
      const job = await preview(
        await file([
          ['Code', 'Nom', 'Type'],
          ['IMP-1', 'Par code', 'det'],
          ['IMP-2', 'Par nom', 'Supérette'],
          ['IMP-3', 'Inconnu', 'Grossiste'],
          ['IMP-4', 'Sans type', null],
        ]),
      );
      expect(job.mapping['segment']).toBe(2);
      expect(job.counts).toMatchObject({ total: 4, valid: 4, errors: 0, creates: 4 });
      // The unknown value is listed in the preview, on its row.
      expect(job.rows.map((r) => r.warnings.map((w) => [w.code, w.params?.['name']]))).toEqual([
        [],
        [],
        [['segment_unknown', 'Grossiste']],
        [],
      ]);
      // Confirmed without asking for it: nothing is created, that client has no segment.
      const before = (await as(d).get('/client-segments').expect(200)).body as ClientSegmentDto[];
      await confirm(job.jobId);
      const after = (await as(d).get('/client-segments').expect(200)).body as ClientSegmentDto[];
      expect(after.map((x) => x.name)).toEqual(before.map((x) => x.name));
      expect((await byCode('IMP-1')).segment?.id).toBe(seg1.id);
      expect((await byCode('IMP-2')).segment?.id).toBe(seg2.id);
      expect((await byCode('IMP-3')).segment).toBeNull();
      expect((await byCode('IMP-4')).segment).toBeNull();
    });

    it('creates the unknown segments only when the confirm says so', async () => {
      const job = await preview(
        await file([
          ['Code', 'Nom', 'Type'],
          ['IMP-3', 'Inconnu', 'Grossiste'],
          ['IMP-5', 'Nouveau', 'grossiste'],
          ['IMP-4', 'Sans type', 'DET'],
        ]),
      );
      expect(job.counts).toMatchObject({ creates: 1, updates: 2, errors: 0 });
      await confirm(job.jobId, { createSegments: true });
      const segments = (await as(d).get('/client-segments').expect(200)).body as ClientSegmentDto[];
      // One segment for the two spellings.
      const created = segments.filter((x) => x.name.toLowerCase() === 'grossiste');
      expect(created).toHaveLength(1);
      expect(created[0]).toMatchObject({ code: 'GROSSISTE', clientCount: 2 });
      expect((await byCode('IMP-3')).segment?.id).toBe(created[0]!.id);
      expect((await byCode('IMP-5')).segment?.id).toBe(created[0]!.id);
      expect((await byCode('IMP-4')).segment?.id).toBe(seg1.id);
      // The same file again changes nothing and names no unknown segment.
      const again = await preview(
        await file([
          ['Code', 'Nom', 'Type'],
          ['IMP-3', 'Inconnu', 'Grossiste'],
        ]),
      );
      expect(again.rows[0]!.warnings.map((w) => w.code)).toEqual(['no_changes']);
    });
  });

  /** The body `PATCH /clients/:id` expects, from what `GET` returned. */
  function clientBody(c: ClientDto): object {
    return {
      code: c.code,
      name: c.name,
      type: c.type,
      phone: c.phone,
      phone2: c.phone2,
      address: c.address,
      wilaya: c.wilaya,
      commune: c.commune,
      rc: c.rc,
      nif: c.nif,
      nis: c.nis,
      ai: c.ai,
      priceLevelId: c.priceLevelId,
      creditLimit: c.creditLimit,
      notes: c.notes,
      active: c.active,
      version: c.version,
    };
  }
});
