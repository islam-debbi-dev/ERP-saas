import { randomUUID } from 'node:crypto';
import {
  Activity,
  addDays,
  type ApiError,
  type AuthResponse,
  type ChargesReportDto,
  type ClientDto,
  type DashboardDto,
  ErrorCode,
  type ExpenseCategoryDto,
  type InviteResultDto,
  money,
  type OverviewDto,
  type OverviewFigures,
  Permission,
  type PurchaseDto,
  type ReportDto,
  type SaleResultDto,
  type SupplierPaymentDto,
  type WarehouseDto,
} from '@erp/shared';
import { tenantContext } from '../src/common/tenant-context';
import {
  bearer,
  catalogOf,
  createProduct,
  createTestApp,
  registerTenant,
  type RegisteredTenant,
  type TestApp,
  uniqueEmail,
  withoutGeoCheck,
} from './helpers';

// The Algiers day, as the API counts it.
const TODAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Algiers' }).format(new Date());
const MONTH_START = `${TODAY.slice(0, 7)}-01`;
type Who = { auth: { accessToken: string } };
interface Member {
  id: string;
  auth: AuthResponse;
}

/** Every amount of a card, so "the total is the sum of the cards" checks them all. */
const AMOUNTS: [string, (f: OverviewFigures) => string | null][] = [
  ['sales.ttc', (f) => f.sales.ttc],
  ['sales.previousTtc', (f) => f.sales.previousTtc],
  ['cashIn', (f) => f.cashIn],
  ['cashOut.supplierPayments', (f) => f.cashOut.supplierPayments],
  ['cashOut.expenses', (f) => f.cashOut.expenses],
  ['netCash', (f) => f.netCash],
  ['margin', (f) => f.margin],
  ['charges', (f) => f.charges],
  ['netResult', (f) => f.netResult],
  ['credit.total', (f) => f.credit.total],
  ['credit.over90', (f) => f.credit.over90],
  ['stock.value', (f) => f.stock.value],
];

/**
 * Phase 26: Vue d'ensemble. One card per dépôt the user sees figures of (a truck counts
 * for its dépôt); the total is the sum of the cards and equals the dashboard; a card
 * equals the dashboard and the reports filtered on its dépôt.
 */
describe("vue d'ensemble (phase 26)", () => {
  let t: TestApp;
  /** Distribution edition: MULTI_UNIT on. */
  let d: RegisteredTenant;
  /** Another company with the module. */
  let other: RegisteredTenant;
  /** Essentiel edition: MULTI_UNIT off. */
  let e: RegisteredTenant;
  let seq = 0;

  let mainId: string;
  let depotA: WarehouseDto;
  let depotB: WarehouseDto;
  let truckA: WarehouseDto;
  let otherDepot: WarehouseDto;
  let client: ClientDto;
  let saleB: SaleResultDto;
  let supplierId: string;
  /** Works in A, sees B's figures. */
  let managerA: Member;
  /** Works in A only. */
  let managerOnlyA: Member;
  /** Works in A and B, without VIEW_COST_AND_MARGIN and EXPORT_DATA. */
  let managerNoCost: Member;

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
  });

  const invite = async (who: RegisteredTenant): Promise<Member> => {
    const email = uniqueEmail('manager');
    const res = await as(who)
      .post(
        '/users/invite',
        {
          fullName: `Gérant ${++seq}`,
          email,
          role: 'MANAGER',
          mode: 'PASSWORD',
          password: 'Password123!',
        },
        null,
      )
      .expect(201);
    const user = (res.body as InviteResultDto).user;
    const login = await t
      .http()
      .post('/auth/login')
      .send({ email, password: 'Password123!' })
      .expect(200);
    await t
      .http()
      .post('/auth/password')
      .set(...bearer((login.body as AuthResponse).accessToken))
      .send({ currentPassword: 'Password123!', newPassword: 'Password456!' })
      .expect((r) => {
        if (r.status >= 300) throw new Error(`password change: ${r.status}`);
      });
    const relog = await t
      .http()
      .post('/auth/login')
      .send({ email, password: 'Password456!' })
      .expect(200);
    return { id: user.id, auth: relog.body as AuthResponse };
  };

  /** Logs in again so the token carries the permissions just changed. */
  const relogin = async (m: Member): Promise<Member> => {
    const res = await t
      .http()
      .post('/auth/login')
      .send({ email: m.auth.user.email, password: 'Password456!' })
      .expect(200);
    return { id: m.id, auth: res.body as AuthResponse };
  };

  const overview = async (who: Who, from = MONTH_START, to = TODAY) =>
    (await as(who).get(`/reports/overview?from=${from}&to=${to}`).expect(200)).body as OverviewDto;
  const dashboard = async (who: Who, warehouseId?: string) =>
    (
      await as(who)
        .get(`/dashboard${warehouseId ? `?warehouseId=${warehouseId}` : ''}`)
        .expect(200)
    ).body as DashboardDto;
  const card = (o: OverviewDto, id: string) => o.warehouses.find((w) => w.warehouse.id === id)!;

  /** A credit sale of `qty` cartons of a fresh product from `warehouseId`. */
  const sell = async (
    warehouseId: string | undefined,
    qty: string,
    extra: { paidAmount?: string; documentDate?: string } = {},
  ) => {
    const p = await createProduct(t, d, await catalogOf(t, d));
    return (
      await as(d)
        .post('/sales/quick', {
          type: 'BL',
          documentDate: extra.documentDate ?? TODAY,
          clientId: client.id,
          lines: [{ productId: p.id, unitId: p.cartonUnitId, qty, unitPriceHt: '2000' }],
          paidAmount: extra.paidAmount ?? '0',
          ...(warehouseId ? { warehouseId } : {}),
        })
        .expect(201)
    ).body as SaleResultDto;
  };

  beforeAll(async () => {
    t = await createTestApp();
    d = await registerTenant(t, 'Distrib Vue', { activity: Activity.DISTRIBUTEUR });
    other = await registerTenant(t, 'Autre Distrib', { activity: Activity.DISTRIBUTEUR });
    e = await registerTenant(t, 'Grossiste Vue');
    await withoutGeoCheck(t, d);
    await as(d).patch('/tenant/settings', { negativeStockMode: 'ALLOW' }).expect(200);
    const list = (await as(d).get('/warehouses').expect(200)).body as WarehouseDto[];
    mainId = list.find((w) => w.isDefault)!.id;
    depotA = (
      await as(d).post('/warehouses', { name: 'Vaisselle', type: 'SECONDARY' }, null).expect(201)
    ).body as WarehouseDto;
    depotB = (
      await as(d).post('/warehouses', { name: 'Vêtements', type: 'SECONDARY' }, null).expect(201)
    ).body as WarehouseDto;
    truckA = (
      await as(d).post('/warehouses', { name: 'Camion A', type: 'VEHICLE' }, null).expect(201)
    ).body as WarehouseDto;
    await as(d).patch(`/warehouses/${truckA.id}`, { parentWarehouseId: depotA.id }).expect(200);
    otherDepot = (
      await as(other).post('/warehouses', { name: 'Secret', type: 'SECONDARY' }, null).expect(201)
    ).body as WarehouseDto;
    client = (
      await as(d)
        .post('/clients', { code: `OV${++seq}`, name: 'Client Vue' }, null)
        .expect(201)
    ).body as ClientDto;

    // Stock with a cost in A: 3 cartons at 1 200.
    const cat = await catalogOf(t, d);
    const stocked = await createProduct(t, d, cat, { minStock: '1000' });
    supplierId = (
      (await as(d).post('/suppliers', { name: 'Fournisseur Vue' }, null).expect(201)).body as {
        id: string;
      }
    ).id;
    const purchase = (
      await as(d)
        .post('/purchases', {
          supplierId,
          documentDate: TODAY,
          warehouseId: depotA.id,
          lines: [
            { productId: stocked.id, unitId: stocked.cartonUnitId, qty: '3', unitCost: '1200' },
          ],
        })
        .expect(201)
    ).body as PurchaseDto;
    await as(d).post(`/purchases/${purchase.id}/validate`).expect(200);

    // Sales: A (100 days old, on credit), A's truck (paid), B (on credit), the dépôt principal.
    await sell(depotA.id, '1', { documentDate: addDays(TODAY, -100) });
    await sell(truckA.id, '1', { paidAmount: '2380' });
    saleB = await sell(depotB.id, '2');
    await sell(undefined, '1');
    // An avoir on B's sale: one carton back.
    await as(d)
      .post(`/sales/${saleB.sale.id}/returns`, {
        disposition: 'RESTOCK',
        reason: 'invendu',
        lines: [{ saleLineId: saleB.sale.lines[0]!.id, qty: '1' }],
      })
      .expect(201);
    // Versements, règlements, a dépense.
    await as(d)
      .post('/payments', { clientId: client.id, amount: '500', warehouseId: depotB.id })
      .expect(201);
    await as(d)
      .post('/supplier-payments', { supplierId, amount: '300', warehouseId: depotB.id })
      .expect(201);
    await as(d).post('/supplier-payments', { supplierId, amount: '200' }).expect(201);
    const categories = (await as(d).get('/expense-categories').expect(200))
      .body as ExpenseCategoryDto[];
    await as(d)
      .post('/expenses', {
        categoryId: categories.find((c) => c.key === 'OTHER')!.id,
        amount: '700',
        mode: 'ESPECES',
        date: TODAY,
        warehouseId: depotA.id,
      })
      .expect(201);

    managerA = await invite(d);
    managerOnlyA = await invite(d);
    managerNoCost = await invite(d);
    await as(d)
      .put(`/users/${managerA.id}/access`, {
        access: [
          { warehouseId: depotA.id, level: 'OPERATE' },
          { warehouseId: depotB.id, level: 'VIEW_STATS' },
        ],
      })
      .expect(200);
    await as(d)
      .put(`/users/${managerOnlyA.id}/access`, {
        access: [{ warehouseId: depotA.id, level: 'OPERATE' }],
      })
      .expect(200);
    await as(d)
      .put(`/users/${managerNoCost.id}/access`, {
        access: [
          { warehouseId: depotA.id, level: 'OPERATE' },
          { warehouseId: depotB.id, level: 'OPERATE' },
        ],
      })
      .expect(200);
    await as(d)
      .put(`/users/${managerNoCost.id}/permissions`, {
        grants: [],
        revokes: [Permission.VIEW_COST_AND_MARGIN, Permission.EXPORT_DATA],
      })
      .expect(200);
    managerNoCost = await relogin(managerNoCost);
  });

  afterAll(async () => {
    await t.close();
  });

  describe('the owner', () => {
    it('sees one card per dépôt (trucks fold into theirs), principal first', async () => {
      const o = await overview(d);
      expect(o.warehouses.map((w) => w.warehouse.id)).toEqual([mainId, depotA.id, depotB.id]);
      expect(o).toMatchObject({ from: MONTH_START, to: TODAY });
      expect(card(o, depotA.id).sales.count).toBe(2);
      expect(card(o, depotA.id).sales.perDay).toHaveLength(o.total.sales.perDay.length);
    });

    it('the total is the sum of the cards', async () => {
      const o = await overview(d);
      for (const [name, get] of AMOUNTS) {
        const parts = o.warehouses.reduce((s, w) => s.plus(get(w) ?? '0'), money(0));
        expect([name, get(o.total)]).toEqual([name, parts.toFixed(2)]);
      }
      expect(o.total.sales.count).toBe(o.warehouses.reduce((s, w) => s + w.sales.count, 0));
      const days = o.total.sales.perDay.map((x) => x.ttc);
      expect(days.reduce((s, v) => s.plus(v), money(0)).toFixed(2)).toBe(o.total.sales.ttc);
    });

    it('the total equals the dashboard with no filter', async () => {
      const o = await overview(d);
      const dash = await dashboard(d);
      expect(o.total.sales.ttc).toBe(dash.sales!.month.ttc);
      expect(o.total.sales.count).toBe(dash.sales!.month.count);
      expect(o.total.margin).toBe(dash.sales!.margin);
      expect(o.total.credit.total).toBe(dash.credit!.total);
      expect(o.total.credit.debtorCount).toBe(dash.credit!.debtorCount);
      expect(o.total.stock.value).toBe(dash.stock!.value);
      expect(o.total.stock.lowStock).toBe(dash.stock!.lowStock);
      expect(dash.net).toEqual({
        margin: o.total.margin,
        charges: o.total.charges,
        result: o.total.netResult,
      });
      const today = await overview(d, TODAY, TODAY);
      expect(today.total.cashIn).toBe(dash.cash!.total);
    });

    it("a dépôt's card equals the dashboard and the reports filtered on it", async () => {
      const o = await overview(d);
      for (const id of [mainId, depotA.id, depotB.id]) {
        const c = card(o, id);
        const dash = await dashboard(d, id);
        expect(c.sales.ttc).toBe(dash.sales!.month.ttc);
        expect(c.sales.count).toBe(dash.sales!.month.count);
        expect(c.margin).toBe(dash.sales!.margin);
        expect(c.credit.total).toBe(dash.credit!.total);
        expect(c.stock.value).toBe(dash.stock!.value);
        expect(dash.net?.result).toBe(c.netResult);
        const q = `from=${MONTH_START}&to=${TODAY}&warehouseId=${id}`;
        const sales = (await as(d).get(`/reports/sales?${q}&groupBy=day`).expect(200))
          .body as ReportDto;
        expect(sales.totals['netTtc'] ?? '0.00').toBe(c.sales.ttc);
        const margin = (await as(d).get(`/reports/margin?${q}`).expect(200)).body as ReportDto;
        expect(margin.totals['margin'] ?? '0.00').toBe(c.margin);
        const charges = (await as(d).get(`/reports/charges?${q}`).expect(200))
          .body as ChargesReportDto;
        expect(charges.total).toBe(c.charges);
      }
    });

    it('splits cash, credit and stock by dépôt', async () => {
      const o = await overview(d);
      const a = card(o, depotA.id);
      const b = card(o, depotB.id);
      // A's truck sale was paid at the sale: a versement of A.
      expect(a.cashIn).toBe('2380.00');
      expect(a.cashOut).toEqual({ supplierPayments: '0.00', expenses: '700.00', total: '700.00' });
      expect(a.netCash).toBe('1680.00');
      expect(b.cashIn).toBe('500.00');
      expect(b.cashOut.supplierPayments).toBe('300.00');
      // A règlement without a dépôt is the dépôt principal's.
      expect(card(o, mainId).cashOut.supplierPayments).toBe('200.00');
      // A's credit sale is 100 days old: all of A's debt is over 90 days.
      expect(a.credit.total).toBe('2380.00');
      expect(a.credit).toMatchObject({ over90: '2380.00', over90Pct: '100.0', debtorCount: 1 });
      // B: 2 cartons, 1 returned, 500 paid.
      expect(b.credit).toMatchObject({ total: '1880.00', over90: '0.00', over90Pct: '0.0' });
      expect(a.stock.value).toBe('3600.00');
      expect(b.stock.value).toBe('0.00');
      expect(a.charges).toBe('700.00');
      expect(a.netResult).toBe(money(a.margin!).minus('700').toFixed(2));
      expect(a.topSeller).toMatchObject({ id: d.auth.user.id, ttc: a.sales.ttc });
    });

    it('compares with the same number of days just before', async () => {
      const o = await overview(d, TODAY, TODAY);
      expect(o.previousTo).toBe(addDays(TODAY, -1));
      expect(o.total.sales.previousTtc).toBe('0.00');
      expect(o.total.sales.changePct).toBeNull();
      const tomorrow = await overview(d, addDays(TODAY, 1), addDays(TODAY, 1));
      expect(tomorrow.total.sales.previousTtc).toBe(o.total.sales.ttc);
      expect(tomorrow.total.sales.changePct).toBe('-100.0');
    });

    it('exports the comparison as Excel', async () => {
      const res = await as(d)
        .get(`/reports/overview/export.xlsx?from=${MONTH_START}&to=${TODAY}`)
        .expect(200);
      expect(res.headers['content-type']).toContain('spreadsheetml');
      expect(res.headers['content-disposition']).toContain(`vue-ensemble-${MONTH_START}`);
    });
  });

  describe('a manager of A with the statistics of B', () => {
    it("sees A's and B's cards, never the dépôt principal's", async () => {
      const o = await overview(managerA);
      expect(o.warehouses.map((w) => w.warehouse.id)).toEqual([depotA.id, depotB.id]);
      const owner = await overview(d);
      for (const id of [depotA.id, depotB.id]) {
        expect(card(o, id).sales).toEqual(card(owner, id).sales);
        expect(card(o, id).credit).toEqual(card(owner, id).credit);
      }
      expect(JSON.stringify(o)).not.toContain(mainId);
    });

    it('cannot open a document of B', async () => {
      await as(managerA).get(`/sales/${saleB.sale.id}`).expect(404);
    });

    it('cannot pay a supplier from B, where he only sees figures', async () => {
      const res = await as(managerA)
        .post('/supplier-payments', { supplierId, amount: '10', warehouseId: depotB.id })
        .expect(404);
      expect((res.body as ApiError).code).toBe(ErrorCode.WAREHOUSE_NOT_FOUND);
    });
  });

  describe('a manager of one dépôt', () => {
    it('sees one card, and his règlements go to his dépôt', async () => {
      const key = randomUUID();
      const first = (
        await as(managerOnlyA)
          .post('/supplier-payments', { supplierId, amount: '50' }, key)
          .expect(201)
      ).body as SupplierPaymentDto;
      const replay = (
        await as(managerOnlyA)
          .post('/supplier-payments', { supplierId, amount: '50' }, key)
          .expect(201)
      ).body as SupplierPaymentDto;
      expect(replay.id).toBe(first.id);
      const rows = await tenantContext.runAsSystem(
        () =>
          t.prisma.db.$queryRaw<{ n: bigint; warehouseId: string | null }[]>`
          SELECT COUNT(*) OVER () AS n, "warehouseId" FROM supplier_payments
          WHERE "tenantId" = ${d.tenantId}::uuid AND amount = 50`,
      );
      expect(rows.map((r) => [Number(r.n), r.warehouseId])).toEqual([[1, depotA.id]]);

      const o = await overview(managerOnlyA);
      expect(o.warehouses.map((w) => w.warehouse.id)).toEqual([depotA.id]);
      expect(o.total.cashOut.supplierPayments).toBe('50.00');
      expect(JSON.stringify(o)).not.toContain('Vêtements');
    });
  });

  describe('without VIEW_COST_AND_MARGIN', () => {
    it('hides the margin, the stock value and the net result', async () => {
      const o = await overview(managerNoCost);
      for (const f of [o.total, ...o.warehouses]) {
        expect(f.margin).toBeNull();
        expect(f.stock.value).toBeNull();
        expect(f.netResult).toBeNull();
        expect(f.charges).not.toBeNull();
      }
      expect((await dashboard(managerNoCost)).net).toBeNull();
    });

    it('cannot export without EXPORT_DATA', async () => {
      await as(managerNoCost)
        .get(`/reports/overview/export.xlsx?from=${MONTH_START}&to=${TODAY}`)
        .expect(403);
    });
  });

  describe('access', () => {
    it('needs the MULTI_UNIT module', async () => {
      await as(e).get(`/reports/overview?from=${TODAY}&to=${TODAY}`).expect(403);
    });

    it('the dashboard of a company without the module still gets the net result', async () => {
      expect((await dashboard(e)).net).toEqual({
        margin: '0.00',
        charges: '0.00',
        result: '0.00',
      });
    });

    it('refuses a reversed or too long period', async () => {
      await as(d)
        .get(`/reports/overview?from=${TODAY}&to=${addDays(TODAY, -1)}`)
        .expect(400);
      await as(d)
        .get(`/reports/overview?from=${addDays(TODAY, -400)}&to=${TODAY}`)
        .expect(400);
    });
  });

  describe('tenant isolation', () => {
    it("never shows another company's dépôts or figures", async () => {
      const mine = await overview(d);
      const theirs = await overview(other);
      expect(JSON.stringify(mine)).not.toContain(otherDepot.id);
      expect(theirs.warehouses.map((w) => w.warehouse.id)).not.toContain(depotA.id);
      expect(theirs.total.sales.ttc).toBe('0.00');
      expect(theirs.total.credit.total).toBe('0.00');
    });
  });
});
