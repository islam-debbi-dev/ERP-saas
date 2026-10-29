import { randomUUID } from 'node:crypto';
import * as argon2 from 'argon2';
import {
  type AuthResponse,
  ErrorCode,
  type InventoryDto,
  type ReconcileReport,
  type StockLevelDto,
  type StockMovementPage,
  type StockOperationResult,
  type StockPage,
} from '@erp/shared';
import { StockService } from '../src/stock/stock.service';
import { WarehousesService } from '../src/stock/warehouses.service';
import {
  asTenant,
  bearer,
  catalogOf,
  createProduct,
  createTestApp,
  registerTenant,
  type RegisteredTenant,
  type TenantCatalog,
  type TestApp,
  uniqueEmail,
} from './helpers';

describe('stock', () => {
  let t: TestApp;
  let a: RegisteredTenant;
  let b: RegisteredTenant;
  let catA: TenantCatalog;
  let catB: TenantCatalog;

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

  const level = async (who: RegisteredTenant, productId: string) =>
    (await as(who).get(`/stock/${productId}`).expect(200)).body as StockLevelDto;

  const setMode = (who: RegisteredTenant, mode: 'ALLOW' | 'WARN' | 'BLOCK') =>
    as(who).patch('/tenant/settings', { negativeStockMode: mode }).expect(200);

  beforeAll(async () => {
    t = await createTestApp();
    a = await registerTenant(t, 'Stock A');
    b = await registerTenant(t, 'Stock B');
    catA = await catalogOf(t, a);
    catB = await catalogOf(t, b);
  });
  afterAll(() => t.close());

  it('opening stock in cartons sets the quantity and a per-piece CUMP; a second opening is refused', async () => {
    const p = await createProduct(t, a, catA);
    // 2 cartons of 24 at 1 100 DA the carton = 48 pieces at 45.8333
    const res = await as(a)
      .post('/stock/opening', {
        lines: [{ productId: p.id, unitId: p.cartonUnitId, qty: '2', unitCost: '1100' }],
      })
      .expect(201);
    expect((res.body as StockOperationResult).movements).toBe(1);
    const l = await level(a, p.id);
    expect(l).toMatchObject({
      qtyBase: '48.000',
      avgCost: '45.8333',
      value: '2200.00',
      hasOpening: true,
    });

    const again = await as(a)
      .post('/stock/opening', {
        lines: [{ productId: p.id, unitId: p.baseUnitId, qty: '1', unitCost: '10' }],
      })
      .expect(409);
    expect(again.body).toMatchObject({ code: ErrorCode.OPENING_ALREADY_SET });
  });

  it('adjustments update the ledger and the cache together; a positive one keeps the CUMP', async () => {
    const p = await createProduct(t, a, catA);
    await as(a)
      .post('/stock/opening', {
        lines: [{ productId: p.id, unitId: p.baseUnitId, qty: '10', unitCost: '100' }],
      })
      .expect(201);
    await as(a)
      .post('/stock/adjustments', {
        reason: 'CASSE',
        lines: [{ productId: p.id, unitId: p.baseUnitId, qty: '-3' }],
      })
      .expect(201);
    await as(a)
      .post('/stock/adjustments', {
        reason: 'ERREUR',
        lines: [{ productId: p.id, unitId: p.baseUnitId, qty: '5' }],
      })
      .expect(201);
    expect(await level(a, p.id)).toMatchObject({ qtyBase: '12.000', avgCost: '100.0000' });

    const page = (await as(a).get(`/stock/${p.id}/movements`).expect(200))
      .body as StockMovementPage;
    expect(page.items.map((m) => [m.type, m.qtyBase, m.balanceAfter, m.reason])).toEqual([
      ['ADJUSTMENT', '5.000', '12.000', 'ERREUR'],
      ['ADJUSTMENT', '-3.000', '7.000', 'CASSE'],
      ['OPENING', '10.000', '10.000', null],
    ]);
  });

  it('a failure inside the transaction leaves both ledger and cache unchanged', async () => {
    const p = await createProduct(t, a, catA);
    const stock = t.app.get(StockService);
    const warehouseId = await asTenant(a.tenantId, () => t.app.get(WarehousesService).defaultId());
    await expect(
      asTenant(a.tenantId, () =>
        t.prisma.db.$transaction(async (tx) => {
          await stock.applyMovements(tx, [
            { productId: p.id, warehouseId, type: 'ADJUSTMENT', qtyBase: '5', reason: 'AUTRE' },
          ]);
          throw new Error('crash after the movement');
        }),
      ),
    ).rejects.toThrow('crash');
    const movements = await asTenant(a.tenantId, () =>
      t.prisma.db.stockMovement.count({ where: { productId: p.id } }),
    );
    expect(movements).toBe(0);
    expect((await level(a, p.id)).qtyBase).toBe('0.000');
  });

  it('negative stock follows the tenant mode: BLOCK refuses, WARN warns, ALLOW goes negative', async () => {
    const c = await registerTenant(t, 'Modes');
    const cat = await catalogOf(t, c);
    const p = await createProduct(t, c, cat);
    const out = (n: string) =>
      as(c).post('/stock/adjustments', {
        reason: 'PERTE',
        lines: [{ productId: p.id, unitId: p.baseUnitId, qty: n }],
      });
    await as(c)
      .post('/stock/opening', {
        lines: [{ productId: p.id, unitId: p.baseUnitId, qty: '2', unitCost: '50' }],
      })
      .expect(201);

    await setMode(c, 'BLOCK');
    const blocked = await out('-5').expect(409);
    expect(blocked.body).toMatchObject({
      code: ErrorCode.STOCK_INSUFFICIENT,
      details: { productId: p.id, available: '2.000', requested: '5.000' },
    });

    await setMode(c, 'WARN');
    const warned = (await out('-3').expect(201)).body as StockOperationResult;
    expect(warned.warnings).toEqual([{ productId: p.id, available: '2.000', after: '-1.000' }]);

    await setMode(c, 'ALLOW');
    const allowed = (await out('-1').expect(201)).body as StockOperationResult;
    expect(allowed.warnings).toEqual([]);
    expect((await level(c, p.id)).qtyBase).toBe('-2.000');
  });

  it('two concurrent exits of the last unit in BLOCK mode: exactly one succeeds', async () => {
    const c = await registerTenant(t, 'Race');
    const cat = await catalogOf(t, c);
    const p = await createProduct(t, c, cat);
    await setMode(c, 'BLOCK');
    await as(c)
      .post('/stock/opening', {
        lines: [{ productId: p.id, unitId: p.baseUnitId, qty: '1', unitCost: '10' }],
      })
      .expect(201);

    const results = await Promise.all(
      [1, 2].map(() =>
        as(c).post('/stock/adjustments', {
          reason: 'PERTE',
          lines: [{ productId: p.id, unitId: p.baseUnitId, qty: '-1' }],
        }),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect((await level(c, p.id)).qtyBase).toBe('0.000');
  });

  it('CUMP after an entry following negative stock takes the entry cost', async () => {
    const c = await registerTenant(t, 'Cump');
    const cat = await catalogOf(t, c);
    const p = await createProduct(t, c, cat);
    await setMode(c, 'ALLOW');
    await as(c)
      .post('/stock/adjustments', {
        reason: 'AUTRE',
        lines: [{ productId: p.id, unitId: p.baseUnitId, qty: '-4' }],
      })
      .expect(201);
    const stock = t.app.get(StockService);
    const warehouseId = await asTenant(c.tenantId, () => t.app.get(WarehousesService).defaultId());
    await asTenant(c.tenantId, () =>
      t.prisma.db.$transaction((tx) =>
        stock.applyMovements(tx, [
          { productId: p.id, warehouseId, type: 'PURCHASE', qtyBase: '24', unitCost: '50' },
        ]),
      ),
    );
    expect(await level(c, p.id)).toMatchObject({ qtyBase: '20.000', avgCost: '50.0000' });
    await asTenant(c.tenantId, () =>
      t.prisma.db.$transaction((tx) =>
        stock.applyMovements(tx, [
          { productId: p.id, warehouseId, type: 'PURCHASE', qtyBase: '20', unitCost: '60' },
        ]),
      ),
    );
    // (20 x 50 + 20 x 60) / 40 = 55
    expect((await level(c, p.id)).avgCost).toBe('55.0000');
  });

  it('refuses fractional quantities for counted products and unknown units', async () => {
    const p = await createProduct(t, a, catA);
    const half = await as(a)
      .post('/stock/opening', {
        lines: [{ productId: p.id, unitId: p.baseUnitId, qty: '1.5', unitCost: '1' }],
      })
      .expect(400);
    expect(half.body).toMatchObject({ details: { rule: 'whole_quantity_required' } });
    const wrongUnit = await as(a)
      .post('/stock/opening', {
        lines: [{ productId: p.id, unitId: catA.units['KG']!.id, qty: '1', unitCost: '1' }],
      })
      .expect(400);
    expect(wrongUnit.body).toMatchObject({ details: { rule: 'unit_not_on_product' } });
  });

  it('an idempotent replay of an adjustment creates nothing new', async () => {
    const p = await createProduct(t, a, catA);
    const key = randomUUID();
    const body = { reason: 'ERREUR', lines: [{ productId: p.id, unitId: p.baseUnitId, qty: '7' }] };
    const first = await as(a).post('/stock/adjustments', body, key).expect(201);
    const replay = await as(a).post('/stock/adjustments', body, key).expect(201);
    expect(replay.body).toEqual(first.body);
    expect((await level(a, p.id)).qtyBase).toBe('7.000');
  });

  it('inventaire: validation writes movements for differences only, then the count is read-only', async () => {
    const same = await createProduct(t, a, catA, { designation: 'Inchangé' });
    const less = await createProduct(t, a, catA, { designation: 'Manquant' });
    const more = await createProduct(t, a, catA, { designation: 'Surplus' });
    await as(a)
      .post('/stock/opening', {
        lines: [same, less, more].map((p) => ({
          productId: p.id,
          unitId: p.baseUnitId,
          qty: '24',
          unitCost: '10',
        })),
      })
      .expect(201);

    const inv = (await as(a).post('/inventories', {}).expect(201)).body as InventoryDto;
    expect(inv.number).toMatch(/^INV-\d{4}-\d{6}$/);
    const counted = (
      await as(a)
        .put(`/inventories/${inv.id}/lines`, {
          lines: [
            { productId: same.id, unitId: same.cartonUnitId, qty: '1' },
            { productId: less.id, unitId: less.baseUnitId, qty: '20' },
            { productId: more.id, unitId: more.cartonUnitId, qty: '1.5' },
          ],
        })
        .expect(200)
    ).body as InventoryDto;
    expect(counted.lines.map((l) => l.diffQtyBase)).toEqual(['0.000', '-4.000', '12.000']);

    const done = (await as(a).post(`/inventories/${inv.id}/validate`).expect(200))
      .body as InventoryDto;
    expect(done.status).toBe('VALIDATED');
    const invMovements = await asTenant(a.tenantId, () =>
      t.prisma.db.stockMovement.findMany({ where: { refId: inv.id }, orderBy: { seq: 'asc' } }),
    );
    expect(invMovements.map((m) => [m.productId, m.qtyBase.toString()])).toEqual(
      expect.arrayContaining([
        [less.id, '-4'],
        [more.id, '12'],
      ]),
    );
    expect(invMovements).toHaveLength(2);
    expect((await level(a, more.id)).avgCost).toBe('10.0000');

    const closed = await as(a)
      .put(`/inventories/${inv.id}/lines`, {
        lines: [{ productId: same.id, unitId: same.baseUnitId, qty: '1' }],
      })
      .expect(409);
    expect(closed.body).toMatchObject({ code: ErrorCode.INVENTORY_CLOSED });
    await as(a).post(`/inventories/${inv.id}/cancel`).expect(409);
  });

  it('isolates tenants on levels, movements and inventories', async () => {
    const p = await createProduct(t, a, catA);
    await as(b).get(`/stock/${p.id}`).expect(404);
    await as(b).get(`/stock/${p.id}/movements`).expect(404);
    await as(b)
      .post('/stock/adjustments', {
        reason: 'AUTRE',
        lines: [{ productId: p.id, unitId: p.baseUnitId, qty: '1' }],
      })
      .expect(400);
    const inv = (await as(a).post('/inventories', {}).expect(201)).body as InventoryDto;
    await as(b).get(`/inventories/${inv.id}`).expect(404);
    await as(b).post(`/inventories/${inv.id}/validate`).expect(404);
    const listB = (await as(b).get('/stock').expect(200)).body as StockPage;
    expect(listB.items.find((i) => i.productId === p.id)).toBeUndefined();
    void catB;
  });

  it('lists levels with a low-stock filter, value and packaging', async () => {
    const c = await registerTenant(t, 'Levels');
    const cat = await catalogOf(t, c);
    const low = await createProduct(t, c, cat, { designation: 'A bas', minStock: '10' });
    const ok = await createProduct(t, c, cat, { designation: 'B ok', minStock: '10' });
    await as(c)
      .post('/stock/opening', {
        lines: [
          { productId: low.id, unitId: low.baseUnitId, qty: '5', unitCost: '2' },
          { productId: ok.id, unitId: ok.cartonUnitId, qty: '12', unitCost: '48' },
        ],
      })
      .expect(201);
    const all = (await as(c).get('/stock').expect(200)).body as StockPage;
    expect(all.summary).toEqual({ totalValue: '586.00', lowStockCount: 1, productCount: 2 });
    expect(all.items.find((i) => i.productId === ok.id)).toMatchObject({
      qtyBase: '288.000',
      lowStock: false,
      packaging: { unitCode: 'CARTON', factorToBase: '24.000' },
    });
    const lowOnly = (await as(c).get('/stock?lowStock=true').expect(200)).body as StockPage;
    expect(lowOnly.items.map((i) => i.productId)).toEqual([low.id]);
  });

  it('paginates the stock card with a cursor', async () => {
    const p = await createProduct(t, a, catA);
    for (let i = 1; i <= 5; i++) {
      await as(a)
        .post('/stock/adjustments', {
          reason: 'AUTRE',
          lines: [{ productId: p.id, unitId: p.baseUnitId, qty: String(i) }],
        })
        .expect(201);
    }
    const first = (await as(a).get(`/stock/${p.id}/movements?limit=2`).expect(200))
      .body as StockMovementPage;
    const second = (
      await as(a).get(`/stock/${p.id}/movements?limit=2&cursor=${first.nextCursor}`).expect(200)
    ).body as StockMovementPage;
    const third = (
      await as(a).get(`/stock/${p.id}/movements?limit=2&cursor=${second.nextCursor}`).expect(200)
    ).body as StockMovementPage;
    expect([...first.items, ...second.items, ...third.items].map((m) => m.balanceAfter)).toEqual([
      '15.000',
      '10.000',
      '6.000',
      '3.000',
      '1.000',
    ]);
    expect(third.nextCursor).toBeNull();
  });

  it('only managers adjust; a storekeeper can count but not validate', async () => {
    const email = uniqueEmail('magasinier');
    await asTenant(a.tenantId, async () =>
      t.prisma.db.user.create({
        data: {
          tenantId: a.tenantId,
          email,
          passwordHash: await argon2.hash('Password123!'),
          fullName: 'Mag',
          role: 'STOREKEEPER',
        },
      }),
    );
    const login = await t
      .http()
      .post('/auth/login')
      .send({ email, password: 'Password123!' })
      .expect(200);
    const keeper = { ...a, auth: login.body as AuthResponse & { refreshToken: string } };
    const p = await createProduct(t, a, catA);
    await as(keeper)
      .post('/stock/adjustments', {
        reason: 'AUTRE',
        lines: [{ productId: p.id, unitId: p.baseUnitId, qty: '1' }],
      })
      .expect(403);
    const inv = (await as(keeper).post('/inventories', {}).expect(201)).body as InventoryDto;
    await as(keeper)
      .put(`/inventories/${inv.id}/lines`, {
        lines: [{ productId: p.id, unitId: p.baseUnitId, qty: '3' }],
      })
      .expect(200);
    await as(keeper).post(`/inventories/${inv.id}/validate`).expect(403);
  });

  it('stock movements cannot be updated or deleted, even with raw SQL', async () => {
    await expect(
      asTenant(a.tenantId, () => t.prisma.db.stockMovement.deleteMany({})),
    ).rejects.toThrow(/append-only/);
    await expect(
      asTenant(a.tenantId, () => t.prisma.db.$executeRaw`UPDATE stock_movements SET note = 'x'`),
    ).rejects.toThrow(/append-only/);
  });

  // Last on purpose: everything above must leave the ledger and the cache in agreement.
  it('reconcile finds no difference between ledger and cache', async () => {
    for (const who of [a, b]) {
      const report = (await as(who).get('/stock/reconcile').expect(200)).body as ReconcileReport;
      expect(report.differences).toEqual([]);
    }
    const reportA = (await as(a).get('/stock/reconcile').expect(200)).body as ReconcileReport;
    expect(reportA.checkedProducts).toBeGreaterThan(5);
  });
});
