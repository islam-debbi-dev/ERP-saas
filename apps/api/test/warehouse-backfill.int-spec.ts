import { tenantContext } from '../src/common/tenant-context';
import {
  WarehouseBackfillMismatch,
  WarehouseBackfillService,
} from '../src/stock/warehouse-backfill.service';
import {
  catalogOf,
  createProduct,
  createTestApp,
  registerTenant,
  type RegisteredTenant,
  tamper,
  type TestApp,
} from './helpers';

/**
 * Phase 15, step 2: the one-off backfill of data written before warehouses existed.
 * Legacy rows are written by hand, the way the pre-phase 15 code left them: movements and
 * documents without dépôt, ProductStock without any split, no warehouse at all.
 */
describe('warehouse backfill (phase 15)', () => {
  let t: TestApp;
  let backfill: WarehouseBackfillService;

  /** A tenant as it was before the deploy: no dépôt row at all. */
  async function legacyTenant(name: string) {
    const who = await registerTenant(t, name);
    await tamper(t)`DELETE FROM warehouses WHERE "tenantId" = ${who.tenantId}::uuid`;
    const cat = await catalogOf(t, who);
    return { who, cat };
  }

  /** Pre-phase 15 stock: movements with no dépôt and the product level, nothing else. */
  async function legacyStock(
    who: RegisteredTenant,
    productId: string,
    moves: number[],
    cached?: number,
  ) {
    let balance = 0;
    for (const [i, q] of moves.entries()) {
      balance += q;
      await tamper(t)`
        INSERT INTO stock_movements ("id", "tenantId", "productId", "type", "qtyBase", "unitCost",
                                     "balanceAfter", "avgCostAfter")
        VALUES (gen_random_uuid(), ${who.tenantId}::uuid, ${productId}::uuid,
                ${i === 0 ? 'OPENING' : q > 0 ? 'PURCHASE' : 'SALE'}::"StockMovementType",
                ${q}, ${q > 0 ? 80 : null}, ${balance}, 80)`;
    }
    await tamper(t)`
      INSERT INTO product_stocks ("id", "tenantId", "productId", "qtyBase", "avgCost", "hasOpening", "updatedAt")
      VALUES (gen_random_uuid(), ${who.tenantId}::uuid, ${productId}::uuid, ${cached ?? balance}, 80, true,
              CURRENT_TIMESTAMP)`;
  }

  /** Everything the backfill touches for one tenant, to compare two runs. */
  const snapshot = (tenantId: string) =>
    tenantContext.runAsSystem(async () => ({
      warehouses: await t.prisma.db.warehouse.findMany({
        where: { tenantId },
        select: { id: true, type: true, isDefault: true },
      }),
      stocks: (
        await t.prisma.db.warehouseStock.findMany({
          where: { tenantId },
          select: { warehouseId: true, productId: true, qtyBase: true },
          orderBy: [{ productId: 'asc' }, { warehouseId: 'asc' }],
        })
      ).map((r) => ({ ...r, qtyBase: r.qtyBase.toFixed(3) })),
      movementsWithout: await t.prisma.db.stockMovement.count({
        where: { tenantId, warehouseId: null },
      }),
    }));

  beforeAll(async () => {
    t = await createTestApp();
    backfill = t.app.get(WarehouseBackfillService);
  });
  afterAll(() => t.close());

  it('puts legacy stock in the main dépôt, sums match, and a second run changes nothing', async () => {
    const { who, cat } = await legacyTenant('Avant Dépôts');
    const p1 = await createProduct(t, who, cat);
    const p2 = await createProduct(t, who, cat);
    await legacyStock(who, p1.id, [30, -6, 12]);
    await legacyStock(who, p2.id, [10]);

    const first = await backfill.run({ tenantIds: [who.tenantId] });
    expect(first).toMatchObject({
      tenants: 1,
      stockRows: 2,
      totalBefore: '46.000',
      totalAfter: '46.000',
    });
    expect(first.filled['stock_movements']).toBe(4);

    const after = await snapshot(who.tenantId);
    expect(after.warehouses.map((w) => [w.type, w.isDefault])).toEqual([['MAIN', true]]);
    const main = after.warehouses[0]!.id;
    expect(after.stocks).toEqual(
      [
        { warehouseId: main, productId: p1.id, qtyBase: '36.000' },
        { warehouseId: main, productId: p2.id, qtyBase: '10.000' },
      ].sort((a, b) => (a.productId < b.productId ? -1 : 1)),
    );
    expect(after.movementsWithout).toBe(0);

    const second = await backfill.run({ tenantIds: [who.tenantId] });
    expect(second.stockRows).toBe(0);
    expect(Object.values(second.filled).every((n) => n === 0)).toBe(true);
    expect(await snapshot(who.tenantId)).toEqual(after);
  });

  it('works after the first post-deploy writes created part of the split', async () => {
    const { who, cat } = await legacyTenant('Déjà Vendu');
    const p = await createProduct(t, who, cat);
    await legacyStock(who, p.id, [48]);
    // A sale after the deploy, before the backfill: creates the main dépôt and its row lazily.
    await t
      .http()
      .post('/stock/adjustments')
      .set('Authorization', `Bearer ${who.auth.accessToken}`)
      .set('Idempotency-Key', crypto.randomUUID())
      .send({ reason: 'CASSE', lines: [{ productId: p.id, unitId: p.baseUnitId, qty: '-3' }] })
      .expect(201);
    const r = await backfill.run({ tenantIds: [who.tenantId] });
    expect(r).toMatchObject({ stockRows: 0, totalBefore: '45.000', totalAfter: '45.000' });
    expect(r.filled['stock_movements']).toBe(1);
    const s = await snapshot(who.tenantId);
    expect(s.stocks.map((x) => x.qtyBase)).toEqual(['45.000']);
    expect(s.movementsWithout).toBe(0);
  });

  it('aborts and writes nothing for a tenant whose cache disagrees with its ledger', async () => {
    const { who, cat } = await legacyTenant('Cache Faux');
    const p = await createProduct(t, who, cat);
    // ProductStock says 11, the ledger says 10: the backfill must not paper over it.
    await legacyStock(who, p.id, [10], 11);
    const err = await backfill.run({ tenantIds: [who.tenantId] }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(WarehouseBackfillMismatch);
    expect((err as WarehouseBackfillMismatch).problems).toEqual([
      { check: 'warehouse_equals_ledger', productId: p.id, expected: '10.000', found: '11.000' },
    ]);
    const s = await snapshot(who.tenantId);
    expect(s).toEqual({ warehouses: [], stocks: [], movementsWithout: 1 });
  });
});
