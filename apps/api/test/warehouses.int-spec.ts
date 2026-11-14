import { randomUUID } from 'node:crypto';
import {
  Activity,
  type ApiError,
  type AuthResponse,
  ErrorCode,
  type InventoryDto,
  type InviteResultDto,
  type ProductDto,
  type PurchaseDto,
  type SaleResultDto,
  type StockLevelDto,
  type StockMovementPage,
  type StockOperationResult,
  type StockPage,
  type StockTransferDto,
  type StockTransferResultDto,
  type SupplierDto,
  type WarehouseDto,
} from '@erp/shared';
import { tenantContext } from '../src/common/tenant-context';
import { RECONCILE_CHECKS } from '../src/reconcile/reconcile-sql';
import {
  bearer,
  catalogOf,
  createTestApp,
  registerTenant,
  type RegisteredTenant,
  tamper,
  type TenantCatalog,
  type TestApp,
  uniqueEmail,
} from './helpers';

const TODAY = '2026-10-29';
const errorOf = (res: { body: unknown }) => res.body as ApiError;
type Who = { auth: { accessToken: string } };
interface Item {
  id: string;
  piece: string;
  carton: string;
}

/**
 * Phase 15: dépôts and trucks. The company stock and the CUMP stay per product; the split
 * per dépôt always sums to it, transfers move it without changing either, and negative
 * stock is judged on the dépôt the goods leave.
 */
describe('warehouses and vehicle stock (phase 15)', () => {
  let t: TestApp;
  /** Distribution edition: WAREHOUSES on. */
  let d: RegisteredTenant;
  /** Essentiel edition: WAREHOUSES off. */
  let e: RegisteredTenant;
  let catD: TenantCatalog;
  let catE: TenantCatalog;
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
    delete: (url: string) =>
      t
        .http()
        .delete(url)
        .set(...bearer(who.auth.accessToken)),
  });

  /** Carton of 24 pièces at 2 400 / 2 520 / 2 640 HT; `stock` pièces opened at 80 each. */
  async function product(who: RegisteredTenant, cat: TenantCatalog, stock = 0): Promise<Item> {
    const piece = cat.units['PIECE']!.id;
    const carton = cat.units['CARTON']!.id;
    const res = await as(who)
      .post(
        '/products',
        {
          reference: `W-${Date.now()}-${++seq}`,
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
          prices: cat.levels.slice(0, 3).map((l, i) => ({
            unitId: carton,
            priceLevelId: l.id,
            priceHt: String(2400 + 120 * i),
          })),
        },
        null,
      )
      .expect(201);
    const id = (res.body as ProductDto).id;
    if (stock > 0) {
      await as(who)
        .post('/stock/opening', {
          lines: [{ productId: id, unitId: piece, qty: String(stock), unitCost: '80' }],
        })
        .expect(201);
    }
    return { id, piece, carton };
  }

  /**
   * A seller as a company really gets one: invited by the owner through the API, so he has
   * the dépôt access an invitation gives (audit 02, A-1: a seller inserted in the database
   * has none, and hid that his sales left from the dépôt principal).
   */
  const seller = async (who: RegisteredTenant) => {
    const email = uniqueEmail('vendeur');
    const invited = (
      await as(who)
        .post(
          '/users/invite',
          {
            fullName: `Vendeur ${++seq}`,
            email,
            role: 'SELLER',
            mode: 'PASSWORD',
            password: 'Password123!',
          },
          null,
        )
        .expect(201)
    ).body as InviteResultDto;
    // One login only: the suite makes five sellers and the limiter allows ten logins a
    // minute. Changing the password keeps the session it is changed from.
    const login = (
      await t.http().post('/auth/login').send({ email, password: 'Password123!' }).expect(200)
    ).body as AuthResponse;
    await t
      .http()
      .post('/auth/password')
      .set(...bearer(login.accessToken))
      .send({ currentPassword: 'Password123!', newPassword: 'Password456!' })
      .expect(200);
    return { id: invited.user.id, auth: login };
  };

  const warehouses = async (who: Who) =>
    (await as(who).get('/warehouses').expect(200)).body as WarehouseDto[];
  const mainOf = async (who: Who) => (await warehouses(who)).find((w) => w.isDefault)!;

  const createWarehouse = async (
    who: RegisteredTenant,
    body: { name: string; type: 'SECONDARY' | 'VEHICLE'; assignedUserId?: string | null },
  ) => (await as(who).post('/warehouses', body, null).expect(201)).body as WarehouseDto;

  const level = async (who: Who, productId: string) =>
    (await as(who).get(`/stock/${productId}`).expect(200)).body as StockLevelDto;

  /** Quantity of `productId` per dépôt id, plus the company total and CUMP. */
  const split = async (who: Who, productId: string) => {
    const l = await level(who, productId);
    return {
      total: l.qtyBase,
      avgCost: l.avgCost,
      by: Object.fromEntries((l.byWarehouse ?? []).map((w) => [w.warehouseId, w.qtyBase])),
    };
  };

  const transfer = async (
    who: Who,
    body: {
      type: 'LOAD' | 'UNLOAD' | 'TRANSFER';
      fromWarehouseId: string;
      toWarehouseId: string;
      lines: { productId: string; unitId: string; qty: string }[];
    },
  ) => (await as(who).post('/stock-transfers', body).expect(201)).body as StockTransferDto;

  const validate = (who: Who, id: string, key: string | null = randomUUID()) =>
    as(who).post(`/stock-transfers/${id}/validate`, {}, key);

  const setMode = (who: RegisteredTenant, mode: 'ALLOW' | 'WARN' | 'BLOCK') =>
    as(who).patch('/tenant/settings', { negativeStockMode: mode }).expect(200);

  /** Cash sale at the comptoir (nothing on credit). */
  const sell = (who: Who, lines: object[], extra: object = {}, key: string | null = randomUUID()) =>
    as(who).post(
      '/sales/quick',
      { documentDate: TODAY, clientId: null, lines, paidAmount: '1000000', ...extra },
      key,
    );

  /** The phase 15 invariants for one tenant: empty = the split and the ledger agree. */
  const violations = async (tenantId: string) => {
    const out: { check: string; entityId: string }[] = [];
    for (const check of RECONCILE_CHECKS.filter((c) => c.entity === 'Product')) {
      const rows = await tenantContext.runAsSystem(() =>
        t.prisma.db.$queryRawUnsafe<{ tenantId: string; entityId: string }[]>(check.sql),
      );
      out.push(
        ...rows
          .filter((r) => r.tenantId === tenantId)
          .map((r) => ({ check: check.name, entityId: r.entityId })),
      );
    }
    return out;
  };

  beforeAll(async () => {
    t = await createTestApp();
    d = await registerTenant(t, 'Distrib Dépôts', { activity: Activity.DISTRIBUTEUR });
    e = await registerTenant(t, 'Grossiste Mono');
    catD = await catalogOf(t, d);
    catE = await catalogOf(t, e);
  });
  afterAll(() => t.close());

  it('every tenant has one default MAIN dépôt from signup', async () => {
    for (const who of [d, e]) {
      const list = await warehouses(who);
      expect(list).toHaveLength(1);
      expect(list[0]).toMatchObject({ type: 'MAIN', isDefault: true, active: true });
    }
  });

  describe('WAREHOUSES off: one implicit dépôt, nothing else changes', () => {
    it('refuses dépôt management, transfers and any other dépôt', async () => {
      const res = await as(e).post('/warehouses', { name: 'Annexe', type: 'SECONDARY' }, null);
      expect(res.status).toBe(403);
      expect(errorOf(res).code).toBe(ErrorCode.FEATURE_NOT_IN_PLAN);
      await as(e).get('/stock-transfers').expect(403);

      // A dépôt left over from when the module was on cannot be used any more.
      const p = await product(e, catE, 24);
      const otherId = randomUUID();
      await tamper(t)`
        INSERT INTO warehouses ("id", "tenantId", "name", "type", "updatedAt")
        VALUES (${otherId}::uuid, ${e.tenantId}::uuid, 'Ancien dépôt', 'SECONDARY', CURRENT_TIMESTAMP)`;
      const refused = await as(e).post('/stock/adjustments', {
        reason: 'AUTRE',
        warehouseId: otherId,
        lines: [{ productId: p.id, unitId: p.piece, qty: '1' }],
      });
      expect(refused.status).toBe(403);
      expect(errorOf(refused).code).toBe(ErrorCode.FEATURE_NOT_IN_PLAN);

      // The default dépôt (named or not) works, and the stock shows no split.
      const main = await mainOf(e);
      await as(e)
        .post('/stock/adjustments', {
          reason: 'AUTRE',
          warehouseId: main.id,
          lines: [{ productId: p.id, unitId: p.piece, qty: '1' }],
        })
        .expect(201);
      const l = await level(e, p.id);
      expect(l.qtyBase).toBe('25.000');
      expect(l.byWarehouse).toBeUndefined();
      const page = (await as(e).get('/stock').expect(200)).body as StockPage;
      expect(page.items.every((i) => i.byWarehouse === undefined)).toBe(true);
      expect(await violations(e.tenantId)).toEqual([]);
    });
  });

  describe('dépôts and trucks', () => {
    it('creates a truck for a seller, one truck per seller, names unique', async () => {
      const v = await seller(d);
      const truck = await createWarehouse(d, {
        name: 'Camion 1',
        type: 'VEHICLE',
        assignedUserId: v.id,
      });
      expect(truck.assignedUser?.id).toBe(v.id);

      const second = await as(d).post(
        '/warehouses',
        { name: 'Camion 2', type: 'VEHICLE', assignedUserId: v.id },
        null,
      );
      expect(errorOf(second).code).toBe(ErrorCode.VEHICLE_ALREADY_ASSIGNED);
      const same = await as(d).post('/warehouses', { name: 'Camion 1', type: 'VEHICLE' }, null);
      expect(errorOf(same).code).toBe(ErrorCode.WAREHOUSE_NAME_TAKEN);
      const driverOnDepot = await as(d).post(
        '/warehouses',
        { name: 'Annexe X', type: 'SECONDARY', assignedUserId: v.id },
        null,
      );
      expect(driverOnDepot.status).toBe(400);
      // A seller sees the dépôts but cannot create one.
      await as(v).post('/warehouses', { name: 'Mon camion', type: 'VEHICLE' }, null).expect(403);
      expect((await warehouses(v)).map((w) => w.id)).toContain(truck.id);
    });

    it('refuses to archive the main dépôt or a dépôt that still holds stock', async () => {
      const main = await mainOf(d);
      expect(errorOf(await as(d).delete(`/warehouses/${main.id}`)).code).toBe(
        ErrorCode.WAREHOUSE_INVALID,
      );
      const annexe = await createWarehouse(d, { name: `Annexe ${++seq}`, type: 'SECONDARY' });
      const p = await product(d, catD);
      await as(d)
        .post('/stock/opening', {
          warehouseId: annexe.id,
          lines: [{ productId: p.id, unitId: p.piece, qty: '5', unitCost: '80' }],
        })
        .expect(201);
      expect(errorOf(await as(d).delete(`/warehouses/${annexe.id}`)).code).toBe(
        ErrorCode.WAREHOUSE_NOT_EMPTY,
      );
      await as(d)
        .post('/stock/adjustments', {
          reason: 'PERTE',
          warehouseId: annexe.id,
          lines: [{ productId: p.id, unitId: p.piece, qty: '-5' }],
        })
        .expect(201);
      await as(d).delete(`/warehouses/${annexe.id}`).expect(204);
      expect((await warehouses(d)).map((w) => w.id)).not.toContain(annexe.id);
    });
  });

  describe('chargement / déchargement', () => {
    it('a validated load moves the goods, keeps the total and the CUMP, and numbers TR', async () => {
      const main = await mainOf(d);
      const v = await seller(d);
      const truck = await createWarehouse(d, {
        name: `Camion ${++seq}`,
        type: 'VEHICLE',
        assignedUserId: v.id,
      });
      const p = await product(d, catD, 240);
      const before = await split(d, p.id);
      expect(before).toMatchObject({ total: '240.000', avgCost: '80.0000' });

      const draft = await transfer(d, {
        type: 'LOAD',
        fromWarehouseId: main.id,
        toWarehouseId: truck.id,
        lines: [{ productId: p.id, unitId: p.carton, qty: '5' }],
      });
      expect(draft).toMatchObject({ status: 'DRAFT', number: null });
      expect(draft.lines[0]).toMatchObject({ qty: '5.000', qtyBase: '120.000' });
      // A draft changes nothing.
      expect((await split(d, p.id)).by[truck.id]).toBe('0.000');

      const key = randomUUID();
      const done = (await validate(d, draft.id, key).expect(200)).body as StockTransferResultDto;
      expect(done.transfer.status).toBe('VALIDATED');
      expect(done.transfer.number).toMatch(/^TR-\d{4}-\d{6}$/);
      expect(done.warnings).toEqual([]);

      const after = await split(d, p.id);
      expect(after).toMatchObject({ total: '240.000', avgCost: '80.0000' });
      expect(after.by[main.id]).toBe('120.000');
      expect(after.by[truck.id]).toBe('120.000');

      // Replay: same answer, nothing new. Another key: a validated transfer is closed.
      const replay = (await validate(d, draft.id, key).expect(200)).body as StockTransferResultDto;
      expect(replay.transfer.number).toBe(done.transfer.number);
      expect(errorOf(await validate(d, draft.id)).code).toBe(ErrorCode.TRANSFER_NOT_DRAFT);
      const card = (await as(d).get(`/stock/${p.id}/movements`).expect(200))
        .body as StockMovementPage;
      expect(card.items.map((m) => [m.type, m.qtyBase, m.unitCost])).toEqual([
        ['TRANSFER_IN', '120.000', '80.0000'],
        ['TRANSFER_OUT', '-120.000', '80.0000'],
        ['OPENING', '240.000', '80.0000'],
      ]);
      // The truck's own card, with its running balance.
      const truckCard = (
        await as(d).get(`/stock/${p.id}/movements?warehouseId=${truck.id}`).expect(200)
      ).body as StockMovementPage;
      expect(truckCard.items.map((m) => [m.type, m.warehouseBalanceAfter])).toEqual([
        ['TRANSFER_IN', '120.000'],
      ]);
      // The stock list of one dépôt.
      const list = (await as(d).get(`/stock?warehouseId=${truck.id}&limit=100`).expect(200))
        .body as StockPage;
      expect(list.items.find((i) => i.productId === p.id)?.qtyBase).toBe('120.000');
      expect(await violations(d.tenantId)).toEqual([]);
    });

    it('checks the type against the dépôts, and both dépôts are distinct', async () => {
      const main = await mainOf(d);
      const truck = await createWarehouse(d, { name: `Camion ${++seq}`, type: 'VEHICLE' });
      const p = await product(d, catD);
      const wrong = await as(d).post('/stock-transfers', {
        type: 'UNLOAD',
        fromWarehouseId: main.id,
        toWarehouseId: truck.id,
        lines: [{ productId: p.id, unitId: p.carton, qty: '1' }],
      });
      expect(errorOf(wrong).code).toBe(ErrorCode.WAREHOUSE_INVALID);
      expect((errorOf(wrong).details as { expected: string }).expected).toBe('LOAD');
      const same = await as(d).post('/stock-transfers', {
        type: 'TRANSFER',
        fromWarehouseId: main.id,
        toWarehouseId: main.id,
        lines: [],
      });
      expect(same.status).toBe(400);
      const empty = await transfer(d, {
        type: 'LOAD',
        fromWarehouseId: main.id,
        toWarehouseId: truck.id,
        lines: [],
      });
      expect(errorOf(await validate(d, empty.id)).code).toBe(ErrorCode.TRANSFER_EMPTY);
    });

    it('cancelling a validated transfer writes the reverse movements; the TR prints', async () => {
      const main = await mainOf(d);
      const truck = await createWarehouse(d, { name: `Camion ${++seq}`, type: 'VEHICLE' });
      const p = await product(d, catD, 48);
      const tr = await transfer(d, {
        type: 'LOAD',
        fromWarehouseId: main.id,
        toWarehouseId: truck.id,
        lines: [{ productId: p.id, unitId: p.carton, qty: '1' }],
      });
      // A draft is not printed.
      await as(d).get(`/documents/TR/${tr.id}/pdf`).expect(409);
      await validate(d, tr.id).expect(200);
      const pdf = await as(d).get(`/documents/TR/${tr.id}/pdf?format=A5`).expect(200);
      expect(pdf.headers['content-type']).toContain('application/pdf');

      const cancelled = (
        await as(d)
          .post(`/stock-transfers/${tr.id}/cancel`, { reason: 'Erreur de camion' })
          .expect(200)
      ).body as StockTransferResultDto;
      expect(cancelled.transfer.status).toBe('CANCELLED');
      const after = await split(d, p.id);
      expect(after).toMatchObject({ total: '48.000', avgCost: '80.0000' });
      expect(after.by[main.id]).toBe('48.000');
      expect(after.by[truck.id]).toBe('0.000');
      const types = (
        (await as(d).get(`/stock/${p.id}/movements`).expect(200)).body as StockMovementPage
      ).items.map((m) => m.type);
      expect(types).toEqual([
        'TRANSFER_IN',
        'TRANSFER_OUT',
        'TRANSFER_IN',
        'TRANSFER_OUT',
        'OPENING',
      ]);
      expect(
        errorOf(await as(d).post(`/stock-transfers/${tr.id}/cancel`, { reason: 'Encore' })).code,
      ).toBe(ErrorCode.TRANSFER_NOT_VALIDATED);
      expect(await violations(d.tenantId)).toEqual([]);
    });
  });

  describe('documents choose their dépôt', () => {
    it("a seller's sale leaves from his truck; a return goes back where it left", async () => {
      await setMode(d, 'BLOCK');
      const main = await mainOf(d);
      const v = await seller(d);
      const truck = await createWarehouse(d, {
        name: `Camion ${++seq}`,
        type: 'VEHICLE',
        assignedUserId: v.id,
      });
      const p = await product(d, catD, 96);
      const tr = await transfer(d, {
        type: 'LOAD',
        fromWarehouseId: main.id,
        toWarehouseId: truck.id,
        lines: [{ productId: p.id, unitId: p.carton, qty: '2' }],
      });
      await validate(d, tr.id).expect(200);

      const sale = (await sell(v, [{ productId: p.id, unitId: p.carton, qty: '1' }]).expect(201))
        .body as SaleResultDto;
      expect(sale.sale.warehouse?.id).toBe(truck.id);
      let s = await split(d, p.id);
      expect(s.by).toMatchObject({ [main.id]: '48.000', [truck.id]: '24.000' });

      // The office sells from MAIN by default, or from a chosen dépôt.
      await sell(d, [{ productId: p.id, unitId: p.carton, qty: '1' }]).expect(201);
      await sell(d, [{ productId: p.id, unitId: p.carton, qty: '1' }], {
        warehouseId: truck.id,
      }).expect(201);
      s = await split(d, p.id);
      expect(s.by).toMatchObject({ [main.id]: '24.000', [truck.id]: '0.000' });
      expect(s.total).toBe('24.000');

      // BLOCK is judged on the truck: MAIN still has 24, the empty truck cannot sell.
      const refused = await sell(v, [{ productId: p.id, unitId: p.carton, qty: '1' }]);
      expect(refused.status).toBe(409);
      expect(errorOf(refused).code).toBe(ErrorCode.STOCK_INSUFFICIENT);
      expect(errorOf(refused).details).toMatchObject({ warehouseId: truck.id, available: '0.000' });

      // Retour: back to the truck by default, or to MAIN when chosen.
      const lineId = sale.sale.lines[0]!.id;
      await as(d)
        .post(`/sales/${sale.sale.id}/returns`, {
          disposition: 'RESTOCK',
          reason: 'Client a refusé',
          lines: [{ saleLineId: lineId, qty: '0.5' }],
        })
        .expect(201);
      await as(d)
        .post(`/sales/${sale.sale.id}/returns`, {
          disposition: 'RESTOCK',
          reason: 'Retour au dépôt',
          warehouseId: main.id,
          lines: [{ saleLineId: lineId, qty: '0.25' }],
        })
        .expect(201);
      s = await split(d, p.id);
      expect(s.by).toMatchObject({ [main.id]: '30.000', [truck.id]: '12.000' });
      expect(await violations(d.tenantId)).toEqual([]);
      await setMode(d, 'WARN');
    });

    it('a BR is received into the chosen dépôt and cancelled out of it', async () => {
      const annexe = await createWarehouse(d, { name: `Annexe ${++seq}`, type: 'SECONDARY' });
      const p = await product(d, catD);
      const sup = (
        await as(d)
          .post('/suppliers', { name: `Fournisseur ${++seq}` }, null)
          .expect(201)
      ).body as SupplierDto;
      const br = (
        await as(d)
          .post('/purchases', {
            supplierId: sup.id,
            documentDate: TODAY,
            warehouseId: annexe.id,
            lines: [{ productId: p.id, unitId: p.carton, qty: '3', unitCost: '1920' }],
          })
          .expect(201)
      ).body as PurchaseDto;
      expect(br.warehouse?.id).toBe(annexe.id);
      await as(d).post(`/purchases/${br.id}/validate`, {}).expect(200);
      expect((await split(d, p.id)).by[annexe.id]).toBe('72.000');
      await as(d).post(`/purchases/${br.id}/cancel`, {}).expect(200);
      expect((await split(d, p.id)).by[annexe.id]).toBe('0.000');
      expect(await violations(d.tenantId)).toEqual([]);
    });

    it('an inventory counts one dépôt: expected and differences are that dépôt’s', async () => {
      const main = await mainOf(d);
      const truck = await createWarehouse(d, { name: `Camion ${++seq}`, type: 'VEHICLE' });
      const p = await product(d, catD, 48);
      await validate(
        d,
        (
          await transfer(d, {
            type: 'LOAD',
            fromWarehouseId: main.id,
            toWarehouseId: truck.id,
            lines: [{ productId: p.id, unitId: p.carton, qty: '1' }],
          })
        ).id,
      ).expect(200);

      const inv = (await as(d).post('/inventories', { warehouseId: truck.id }).expect(201))
        .body as InventoryDto;
      expect(inv.warehouseId).toBe(truck.id);
      const counted = (
        await as(d)
          .put(`/inventories/${inv.id}/lines`, {
            lines: [{ productId: p.id, unitId: p.piece, qty: '20' }],
          })
          .expect(200)
      ).body as InventoryDto;
      expect(counted.lines[0]).toMatchObject({ expectedQtyBase: '24.000', diffQtyBase: '-4.000' });
      await as(d).post(`/inventories/${inv.id}/validate`).expect(200);
      const s = await split(d, p.id);
      expect(s.by).toMatchObject({ [main.id]: '24.000', [truck.id]: '20.000' });
      expect(s.total).toBe('44.000');
      expect(await violations(d.tenantId)).toEqual([]);
    });
  });

  describe('concurrency', () => {
    it('two sales of the last carton from the same truck follow negativeStockMode', async () => {
      const main = await mainOf(d);
      for (const mode of ['BLOCK', 'ALLOW'] as const) {
        await setMode(d, mode);
        const v = await seller(d);
        const truck = await createWarehouse(d, {
          name: `Camion ${++seq}`,
          type: 'VEHICLE',
          assignedUserId: v.id,
        });
        const p = await product(d, catD, 48);
        await validate(
          d,
          (
            await transfer(d, {
              type: 'LOAD',
              fromWarehouseId: main.id,
              toWarehouseId: truck.id,
              lines: [{ productId: p.id, unitId: p.carton, qty: '1' }],
            })
          ).id,
        ).expect(200);
        const results = await Promise.all([
          sell(v, [{ productId: p.id, unitId: p.carton, qty: '1' }]),
          sell(v, [{ productId: p.id, unitId: p.carton, qty: '1' }]),
        ]);
        const statuses = results.map((r) => r.status).sort();
        const s = await split(d, p.id);
        if (mode === 'BLOCK') {
          expect(statuses).toEqual([201, 409]);
          expect(s.by[truck.id]).toBe('0.000');
        } else {
          expect(statuses).toEqual([201, 201]);
          expect(s.by[truck.id]).toBe('-24.000');
        }
        expect(s.by[main.id]).toBe('24.000');
      }
      await setMode(d, 'WARN');
      expect(await violations(d.tenantId)).toEqual([]);
    });

    it('a sale and a transfer touching the same products in opposite order do not deadlock', async () => {
      await setMode(d, 'ALLOW');
      const main = await mainOf(d);
      const v = await seller(d);
      const truck = await createWarehouse(d, {
        name: `Camion ${++seq}`,
        type: 'VEHICLE',
        assignedUserId: v.id,
      });
      const [p1, p2] = [await product(d, catD, 480), await product(d, catD, 480)];
      await validate(
        d,
        (
          await transfer(d, {
            type: 'LOAD',
            fromWarehouseId: main.id,
            toWarehouseId: truck.id,
            lines: [
              { productId: p1.id, unitId: p1.carton, qty: '10' },
              { productId: p2.id, unitId: p2.carton, qty: '10' },
            ],
          })
        ).id,
      ).expect(200);
      for (let i = 0; i < 5; i++) {
        const unload = await transfer(d, {
          type: 'UNLOAD',
          fromWarehouseId: truck.id,
          toWarehouseId: main.id,
          lines: [
            { productId: p2.id, unitId: p2.carton, qty: '1' },
            { productId: p1.id, unitId: p1.carton, qty: '1' },
          ],
        });
        const results = await Promise.all([
          sell(v, [
            { productId: p1.id, unitId: p1.carton, qty: '1' },
            { productId: p2.id, unitId: p2.carton, qty: '1' },
          ]),
          validate(d, unload.id),
        ]);
        expect(results.map((r) => r.status)).toEqual([201, 200]);
      }
      for (const p of [p1, p2]) {
        const s = await split(d, p.id);
        expect(s).toMatchObject({ total: '360.000', avgCost: '80.0000' });
        expect(s.by).toMatchObject({ [main.id]: '360.000', [truck.id]: '0.000' });
      }
      await setMode(d, 'WARN');
      expect(await violations(d.tenantId)).toEqual([]);
    });
  });

  describe('migration safety', () => {
    it('stock written before phase 15 is in the main dépôt on first use', async () => {
      // Pre-phase 15 rows: a movement without dépôt and a product level, no dépôt split.
      const p = await product(d, catD);
      await tamper(t)`
        INSERT INTO product_stocks ("id", "tenantId", "productId", "qtyBase", "avgCost", "hasOpening", "updatedAt")
        VALUES (gen_random_uuid(), ${d.tenantId}::uuid, ${p.id}::uuid, 30, 80, true, CURRENT_TIMESTAMP)`;
      await tamper(t)`
        INSERT INTO stock_movements ("id", "tenantId", "productId", "type", "qtyBase", "unitCost",
                                     "balanceAfter", "avgCostAfter")
        VALUES (gen_random_uuid(), ${d.tenantId}::uuid, ${p.id}::uuid, 'OPENING', 30, 80, 30, 80)`;
      const main = await mainOf(d);
      expect((await split(d, p.id)).by[main.id]).toBe('30.000');
      await setMode(d, 'BLOCK');
      await sell(d, [{ productId: p.id, unitId: p.carton, qty: '1' }]).expect(201);
      await setMode(d, 'WARN');
      expect((await split(d, p.id)).by[main.id]).toBe('6.000');
      expect(await violations(d.tenantId)).toEqual([]);
    });

    it('the ledger stays append-only: only a missing dépôt may be filled in', async () => {
      const p = await product(d, catD, 10);
      const main = await mainOf(d);
      await expect(
        tamper(t)`UPDATE stock_movements SET note = 'x' WHERE "productId" = ${p.id}::uuid`,
      ).rejects.toThrow(/append-only/);
      await expect(
        tamper(t)`
          UPDATE stock_movements SET "warehouseId" = ${main.id}::uuid WHERE "productId" = ${p.id}::uuid`,
      ).rejects.toThrow(/append-only/);
      await expect(
        tamper(t)`DELETE FROM stock_movements WHERE "productId" = ${p.id}::uuid`,
      ).rejects.toThrow(/append-only/);
    });
  });

  describe('tenant isolation', () => {
    it("a tenant cannot see or use another tenant's dépôts and transfers", async () => {
      const main = await mainOf(d);
      const truck = await createWarehouse(d, { name: `Camion ${++seq}`, type: 'VEHICLE' });
      const p = await product(d, catD, 24);
      const tr = await transfer(d, {
        type: 'LOAD',
        fromWarehouseId: main.id,
        toWarehouseId: truck.id,
        lines: [{ productId: p.id, unitId: p.carton, qty: '1' }],
      });
      const other = await registerTenant(t, 'Autre Distrib', { activity: Activity.DISTRIBUTEUR });
      const catO = await catalogOf(t, other);
      await as(other).get(`/stock-transfers/${tr.id}`).expect(404);
      await validate(other, tr.id).expect(404);
      await as(other).get(`/documents/TR/${tr.id}/pdf`).expect(404);
      expect((await warehouses(other)).map((w) => w.id)).not.toContain(truck.id);
      await as(other).patch(`/warehouses/${truck.id}`, { name: 'Volé' }).expect(404);

      const q = await product(other, catO, 24);
      const theirs = await as(other).post('/stock/adjustments', {
        reason: 'AUTRE',
        warehouseId: truck.id,
        lines: [{ productId: q.id, unitId: q.piece, qty: '1' }],
      });
      expect(errorOf(theirs).code).toBe(ErrorCode.WAREHOUSE_NOT_FOUND);
      const mainOther = await mainOf(other);
      const cross = await as(other).post('/stock-transfers', {
        type: 'LOAD',
        fromWarehouseId: mainOther.id,
        toWarehouseId: truck.id,
        lines: [{ productId: q.id, unitId: q.carton, qty: '1' }],
      });
      expect(errorOf(cross).code).toBe(ErrorCode.WAREHOUSE_NOT_FOUND);
      // D's stock is untouched.
      expect((await split(d, p.id)).by[main.id]).toBe('24.000');
    });
  });

  it('the stock list shows every dépôt and filters on one', async () => {
    const res = (await as(d).get('/stock?limit=100').expect(200)).body as StockPage;
    const all = await warehouses(d);
    for (const item of res.items) {
      expect(item.byWarehouse?.map((w) => w.warehouseId).sort()).toEqual(
        all.map((w) => w.id).sort(),
      );
      const sum = item.byWarehouse!.reduce((s, w) => s + Number(w.qtyBase) * 1000, 0);
      expect(sum).toBe(Number(item.qtyBase) * 1000);
    }
    const adj = (
      await as(d)
        .post('/stock/opening', {
          lines: [
            {
              productId: (await product(d, catD)).id,
              unitId: catD.units['PIECE']!.id,
              qty: '1',
              unitCost: '1',
            },
          ],
        })
        .expect(201)
    ).body as StockOperationResult;
    expect(adj.movements).toBe(1);
  });
});
