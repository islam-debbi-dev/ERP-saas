import { randomUUID } from 'node:crypto';
import {
  Activity,
  type ApiError,
  type AuthResponse,
  type AuthUser,
  type ClientDto,
  type ClientStatementDto,
  type DashboardDto,
  ErrorCode,
  type InviteResultDto,
  type PaymentDto,
  type PaymentPage,
  type ProductDto,
  type PurchaseDto,
  type PurchasePage,
  type SalePage,
  type SaleResultDto,
  type UserAccessDto,
  type WarehouseDetailDto,
  type WarehouseDto,
} from '@erp/shared';
import { tenantContext } from '../src/common/tenant-context';
import { UnitBackfillService } from '../src/stock/unit-backfill.service';
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
  withoutGeoCheck,
} from './helpers';

// The Algiers day, as the API counts it (a UTC date is the next day's from 23:00 UTC).
const TODAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Algiers' }).format(new Date());
const errorOf = (res: { body: unknown }) => res.body as ApiError;
type Who = { auth: { accessToken: string } };
interface Member {
  id: string;
  auth: AuthResponse;
}

/**
 * Phase 24: dépôts as business units. A user works in some dépôts (OPERATE) and sees the
 * figures of others (VIEW_STATS); everything outside is not there for him. One client
 * account across dépôts, split by dépôt. What a dépôt sells is its brands and categories.
 */
describe('dépôts as business units (phase 24)', () => {
  let t: TestApp;
  /** Distribution edition: MULTI_UNIT on. */
  let d: RegisteredTenant;
  /** Essentiel edition: MULTI_UNIT off. */
  let e: RegisteredTenant;
  let cat: TenantCatalog;
  let seq = 0;

  let mainId: string;
  let depotA: WarehouseDto;
  let depotB: WarehouseDto;
  let brandA: string;
  let brandB: string;
  let productA: { id: string; carton: string };
  let productB: { id: string; carton: string };
  let clientX: ClientDto;
  /** Seller who works in A only. */
  let sellerA: Member;
  /** Manager who works in A and sees B's figures. */
  let managerA: Member;
  /** The owner's credit sale in B. */
  let saleB: SaleResultDto;
  let paymentB: PaymentDto;
  let purchaseB: PurchaseDto;

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

  const invite = async (who: RegisteredTenant, role: 'SELLER' | 'MANAGER'): Promise<Member> => {
    const email = uniqueEmail(role.toLowerCase());
    const res = await as(who)
      .post(
        '/users/invite',
        {
          fullName: `${role} ${++seq}`,
          email,
          role,
          mode: 'PASSWORD',
          password: 'Password123!',
        },
        null,
      )
      .expect(201);
    const user = (res.body as InviteResultDto).user;
    // A temporary password must be changed first: set a real one straight away.
    const login = await t
      .http()
      .post('/auth/login')
      .send({ email, password: 'Password123!' })
      .expect(200);
    const first = login.body as AuthResponse;
    await t
      .http()
      .post('/auth/password')
      .set(...bearer(first.accessToken))
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

  const setAccess = (
    who: Who,
    userId: string,
    access: { warehouseId: string; level: 'OPERATE' | 'VIEW_STATS' }[],
  ) => as(who).put(`/users/${userId}/access`, { access });

  const product = async (brandId: string) => {
    const piece = cat.units['PIECE']!.id;
    const carton = cat.units['CARTON']!.id;
    const res = await as(d)
      .post(
        '/products',
        {
          reference: `MU-${Date.now()}-${++seq}`,
          designation: `Article ${seq}`,
          baseUnitId: piece,
          brandId,
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
          prices: cat.levels.slice(0, 3).map((l) => ({
            unitId: carton,
            priceLevelId: l.id,
            priceHt: '2400',
          })),
        },
        null,
      )
      .expect(201);
    return { id: (res.body as ProductDto).id, carton };
  };

  /** A credit sale of one carton of `p` from `warehouseId` (omitted: the default). */
  const sell = (
    who: Who,
    p: { id: string; carton: string },
    warehouseId?: string,
    paidAmount = '0',
  ) =>
    as(who).post('/sales/quick', {
      type: 'BL',
      documentDate: TODAY,
      clientId: clientX.id,
      lines: [{ productId: p.id, unitId: p.carton, qty: '1' }],
      paidAmount,
      ...(warehouseId ? { warehouseId } : {}),
    });

  /** Reads past RLS, as a check script would. */
  const read = <T>(sql: TemplateStringsArray, ...values: unknown[]) =>
    tenantContext.runAsSystem(() => t.prisma.db.$queryRaw<T>(sql, ...values));

  const me = async (who: Who) => (await as(who).get('/auth/me').expect(200)).body as AuthUser;

  beforeAll(async () => {
    t = await createTestApp();
    d = await registerTenant(t, 'Distrib Unités', { activity: Activity.DISTRIBUTEUR });
    e = await registerTenant(t, 'Grossiste Unités');
    await withoutGeoCheck(t, d);
    cat = await catalogOf(t, d);
    // Stock levels are not what this suite is about.
    await as(d).patch('/tenant/settings', { negativeStockMode: 'ALLOW' }).expect(200);
    const list = (await as(d).get('/warehouses').expect(200)).body as WarehouseDto[];
    mainId = list.find((w) => w.isDefault)!.id;
    depotA = (
      await as(d).post('/warehouses', { name: 'Vaisselle', type: 'SECONDARY' }, null).expect(201)
    ).body as WarehouseDto;
    depotB = (
      await as(d).post('/warehouses', { name: 'Vêtements', type: 'SECONDARY' }, null).expect(201)
    ).body as WarehouseDto;
    brandA = (
      (await as(d).post('/brands', { name: 'Marque A' }, null).expect(201)).body as {
        id: string;
      }
    ).id;
    brandB = (
      (await as(d).post('/brands', { name: 'Marque B' }, null).expect(201)).body as {
        id: string;
      }
    ).id;
    productA = await product(brandA);
    productB = await product(brandB);
    clientX = (
      await as(d)
        .post('/clients', { code: `MU${++seq}`, name: 'Client commun' }, null)
        .expect(201)
    ).body as ClientDto;

    sellerA = await invite(d, 'SELLER');
    managerA = await invite(d, 'MANAGER');
    await setAccess(d, sellerA.id, [{ warehouseId: depotA.id, level: 'OPERATE' }]).expect(200);
    await setAccess(d, managerA.id, [
      { warehouseId: depotA.id, level: 'OPERATE' },
      { warehouseId: depotB.id, level: 'VIEW_STATS' },
    ]).expect(200);

    saleB = (await sell(d, productB, depotB.id).expect(201)).body as SaleResultDto;
    paymentB = (
      await as(d)
        .post('/payments', { clientId: clientX.id, amount: '1000', warehouseId: depotB.id })
        .expect(201)
    ).body as PaymentDto;
    const supplier = (
      await as(d)
        .post('/suppliers', { name: `Fournisseur ${++seq}` }, null)
        .expect(201)
    ).body as { id: string };
    purchaseB = (
      await as(d)
        .post('/purchases', {
          supplierId: supplier.id,
          documentDate: TODAY,
          warehouseId: depotB.id,
          lines: [{ productId: productB.id, unitId: productB.carton, qty: '2', unitCost: '1000' }],
        })
        .expect(201)
    ).body as PurchaseDto;
  });

  afterAll(async () => {
    await t.close();
  });

  describe('reach', () => {
    it('tells the web where the user works and what he sees', async () => {
      const seller = await me(sellerA);
      expect(seller.warehouseIds).toEqual([depotA.id]);
      expect(seller.statsWarehouseIds).toEqual([depotA.id]);
      const manager = await me(managerA);
      expect(manager.warehouseIds).toEqual([depotA.id]);
      expect([...(manager.statsWarehouseIds ?? [])].sort()).toEqual([depotA.id, depotB.id].sort());
      const owner = await me(d);
      expect(owner.warehouseIds).toBeNull();
    });

    it('lists only the dépôts in reach', async () => {
      const seen = (await as(sellerA).get('/warehouses').expect(200)).body as WarehouseDto[];
      expect(seen.map((w) => w.id)).toEqual([depotA.id]);
      await as(sellerA).get(`/warehouses/${depotB.id}`).expect(404);
    });

    it('changes nothing without the module', async () => {
      const owner = await me(e);
      expect(owner.features).not.toContain('MULTI_UNIT');
      expect(owner.warehouseIds).toBeNull();
      await as(e).get(`/users/${owner.id}/access`).expect(403);
    });
  });

  describe('a seller of dépôt A', () => {
    it('cannot list or read a sale of B', async () => {
      const page = (await as(sellerA).get('/sales').expect(200)).body as SalePage;
      expect(page.items.map((s) => s.id)).not.toContain(saleB.sale.id);
      await as(sellerA).get(`/sales/${saleB.sale.id}`).expect(404);
      const filtered = (await as(sellerA).get(`/sales?warehouseId=${depotB.id}`).expect(200))
        .body as SalePage;
      expect(filtered.items).toEqual([]);
    });

    it('cannot sell from B; without a choice he sells from A', async () => {
      const refused = await sell(sellerA, productA, depotB.id).expect(404);
      expect(errorOf(refused).code).toBe(ErrorCode.WAREHOUSE_NOT_FOUND);
      const ok = (await sell(sellerA, productA).expect(201)).body as SaleResultDto;
      expect(ok.sale.warehouse?.id).toBe(depotA.id);
    });

    it('cannot see, cancel or create a versement in B; his own go to A', async () => {
      const page = (await as(sellerA).get('/payments').expect(200)).body as PaymentPage;
      expect(page.items.map((p) => p.id)).not.toContain(paymentB.id);
      await as(sellerA).get(`/payments/${paymentB.id}`).expect(404);
      await as(sellerA)
        .post(`/payments/${paymentB.id}/cancel`, { reason: 'erreur de saisie' })
        .expect(404);
      await as(sellerA)
        .post('/payments', { clientId: clientX.id, amount: '10', warehouseId: depotB.id })
        .expect(404);
      const own = (
        await as(sellerA).post('/payments', { clientId: clientX.id, amount: '10' }).expect(201)
      ).body as PaymentDto & { warehouseId?: string };
      const row = await read<{ warehouseId: string }[]>`
        SELECT "warehouseId" FROM payments WHERE id = ${own.id}::uuid`;
      expect(row[0]?.warehouseId).toBe(depotA.id);
    });

    it('a replayed versement creates nothing new', async () => {
      const key = randomUUID();
      const body = { clientId: clientX.id, amount: '5' };
      const first = (await as(sellerA).post('/payments', body, key).expect(201)).body as PaymentDto;
      const again = (await as(sellerA).post('/payments', body, key).expect(201)).body as PaymentDto;
      expect(again.id).toBe(first.id);
    });
  });

  describe('a manager of A with the statistics of B', () => {
    it('cannot read or create a BR of B', async () => {
      await as(managerA).get(`/purchases/${purchaseB.id}`).expect(404);
      const page = (await as(managerA).get('/purchases').expect(200)).body as PurchasePage;
      expect(page.items.map((p) => p.id)).not.toContain(purchaseB.id);
      await as(managerA)
        .post('/purchases', {
          supplierId: purchaseB.supplier.id,
          documentDate: TODAY,
          warehouseId: depotB.id,
          lines: [],
        })
        .expect(404);
    });

    it("sees B's dashboard totals but no single document of B", async () => {
      const dash = (await as(managerA).get(`/dashboard?warehouseId=${depotB.id}`).expect(200))
        .body as DashboardDto;
      expect(dash.sales?.today.count).toBe(1);
      expect(dash.sales?.today.ttc).toBe(saleB.sale.totalTtc);
      await as(managerA).get(`/sales/${saleB.sale.id}`).expect(404);
      const docs = (await as(managerA).get(`/sales?warehouseId=${depotB.id}`).expect(200))
        .body as SalePage;
      expect(docs.items).toEqual([]);
    });

    it('a dépôt outside his reach gives empty figures, not an error', async () => {
      const dash = (await as(sellerA).get(`/dashboard?warehouseId=${depotB.id}`).expect(200))
        .body as DashboardDto;
      expect(dash.sales?.today.count).toBe(0);
    });

    it('cannot give more access than he has', async () => {
      await as(d)
        .put(`/users/${managerA.id}/permissions`, {
          grants: ['WAREHOUSE_ACCESS_MANAGE'],
          revokes: [],
        })
        .expect(200);
      const res = await setAccess(managerA, sellerA.id, [
        { warehouseId: depotA.id, level: 'OPERATE' },
        { warehouseId: depotB.id, level: 'OPERATE' },
      ]).expect(403);
      expect(errorOf(res).code).toBe(ErrorCode.ACCESS_ABOVE_GRANTER);
      // Statistics of B he has himself: that he may give.
      const ok = (
        await setAccess(managerA, sellerA.id, [
          { warehouseId: depotA.id, level: 'OPERATE' },
          { warehouseId: depotB.id, level: 'VIEW_STATS' },
        ]).expect(200)
      ).body as UserAccessDto;
      expect(ok.access).toHaveLength(2);
      await setAccess(d, sellerA.id, [{ warehouseId: depotA.id, level: 'OPERATE' }]).expect(200);
      const audit = await read<{ n: bigint }[]>`
        SELECT COUNT(*) AS n FROM audit_logs
        WHERE "entityId" = ${sellerA.id} AND action = 'USER_WAREHOUSE_ACCESS_CHANGED'`;
      expect(Number(audit[0]?.n)).toBeGreaterThanOrEqual(3);
    });
  });

  describe('what a dépôt sells', () => {
    it('refuses a product outside its brands, allows it with SELL_ANY_PRODUCT', async () => {
      const detail = (
        await as(d)
          .put(`/warehouses/${depotA.id}/brands`, { brandIds: [brandA] })
          .expect(200)
      ).body as WarehouseDetailDto;
      expect(detail.brands.map((b) => b.id)).toEqual([brandA]);
      const refused = await sell(sellerA, productB).expect(422);
      expect(errorOf(refused).code).toBe(ErrorCode.PRODUCT_NOT_IN_WAREHOUSE);
      await sell(sellerA, productA).expect(201);
      // The search of the sale screen lists what A sells.
      const search = (await as(sellerA).get(`/products?warehouseId=${depotA.id}`).expect(200))
        .body as { items: ProductDto[] };
      expect(search.items.map((p) => p.id)).toContain(productA.id);
      expect(search.items.map((p) => p.id)).not.toContain(productB.id);

      await as(d)
        .put(`/users/${sellerA.id}/permissions`, { grants: ['SELL_ANY_PRODUCT'], revokes: [] })
        .expect(200);
      await sell(sellerA, productB).expect(201);
      await as(d).put(`/users/${sellerA.id}/permissions`, { grants: [], revokes: [] }).expect(200);
      await as(d).put(`/warehouses/${depotA.id}/brands`, { brandIds: [] }).expect(200);
    });
  });

  describe('one client account across dépôts', () => {
    it('the debt per dépôt adds up to the balance, which equals the ledger', async () => {
      const c = (await as(d).get(`/clients/${clientX.id}`).expect(200)).body as ClientDto;
      const parts = c.debtByWarehouse ?? [];
      expect(parts.map((p) => p.warehouse?.id).sort()).toEqual([depotA.id, depotB.id].sort());
      const sum = parts.reduce((s, p) => s + Math.round(Number(p.balance) * 100), 0);
      expect(sum).toBe(Math.round(Number(c.balance) * 100));
      const [ledger] = await read<{ total: string }[]>`
        SELECT SUM(amount)::text AS total FROM client_ledger_entries
        WHERE "clientId" = ${clientX.id}::uuid`;
      expect(Number(ledger?.total)).toBeCloseTo(Number(c.balance), 2);
    });

    it("shows every line, B's reduced to date, type, number, amount and dépôt", async () => {
      const st = (
        await as(sellerA)
          .get(`/clients/${clientX.id}/statement?from=${TODAY}&to=${TODAY}`)
          .expect(200)
      ).body as ClientStatementDto;
      const fromB = st.entries.filter((x) => x.warehouse?.id === depotB.id);
      const fromA = st.entries.filter((x) => x.warehouse?.id === depotA.id);
      expect(fromB.length).toBeGreaterThan(0);
      expect(fromA.length).toBeGreaterThan(0);
      for (const x of fromB) {
        expect(x.reduced).toBe(true);
        expect(x.refId).toBeNull();
        expect(x.createdBy).toBeNull();
        expect(x.label).not.toBe('');
      }
      for (const x of fromA) expect(x.reduced).toBe(false);
      const ownerView = (
        await as(d).get(`/clients/${clientX.id}/statement?from=${TODAY}&to=${TODAY}`).expect(200)
      ).body as ClientStatementDto;
      expect(ownerView.entries.every((x) => !x.reduced)).toBe(true);
      expect(ownerView.closingBalance).toBe(st.closingBalance);
    });
  });

  describe('db:backfill-units', () => {
    it('fills old rows without moving a balance, and twice is the same as once', async () => {
      const backfill = t.app.get(UnitBackfillService);
      const l = await registerTenant(t, 'Avant phase 24', { activity: Activity.DISTRIBUTEUR });
      await withoutGeoCheck(t, l);
      const c = (await as(l).post('/clients', { code: 'OLD', name: 'Ancien' }, null).expect(201))
        .body as ClientDto;
      const lc = await catalogOf(t, l);
      await as(l).patch('/tenant/settings', { negativeStockMode: 'ALLOW' }).expect(200);
      const piece = lc.units['PIECE']!.id;
      const p = (
        await as(l)
          .post(
            '/products',
            {
              reference: `OLD-${Date.now()}`,
              designation: 'Ancien article',
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
              prices: [{ unitId: piece, priceLevelId: lc.levels[0]!.id, priceHt: '100' }],
            },
            null,
          )
          .expect(201)
      ).body as ProductDto;
      const sale = (
        await as(l)
          .post('/sales/quick', {
            type: 'BL',
            documentDate: TODAY,
            clientId: c.id,
            lines: [{ productId: p.id, unitId: piece, qty: '10' }],
            paidAmount: '200',
          })
          .expect(201)
      ).body as SaleResultDto;
      const main = ((await as(l).get('/warehouses').expect(200)).body as WarehouseDto[])[0]!;

      // As before the deploy: versements without a dépôt, legacy ledger entries without one.
      await tamper(
        t,
      )`UPDATE payments SET "warehouseId" = NULL WHERE "tenantId" = ${l.tenantId}::uuid`;
      await tamper(t)`
        INSERT INTO client_ledger_entries ("id", "tenantId", "clientId", type, amount, label, "refType", "refId")
        VALUES (gen_random_uuid(), ${l.tenantId}::uuid, ${c.id}::uuid, 'ADJUSTMENT', 50, 'ancien', 'Sale', ${sale.sale.id}::uuid),
               (gen_random_uuid(), ${l.tenantId}::uuid, ${c.id}::uuid, 'ADJUSTMENT', -20, 'ancien', NULL, NULL)`;
      await tamper(
        t,
      )`UPDATE client_balances SET balance = balance + 30 WHERE "clientId" = ${c.id}::uuid`;
      const balanceBefore = ((await as(l).get(`/clients/${c.id}`).expect(200)).body as ClientDto)
        .balance;

      const first = await backfill.run({ tenantIds: [l.tenantId] });
      expect(first.before.payments).toBe(1);
      expect(first.before.ledgerEntries).toBe(2);
      expect(first.after).toEqual({ payments: 0, ledgerEntries: 0, trucks: 0 });
      expect(first.balancesAfter).toBe(first.balancesBefore);

      const [payment] = await read<{ warehouseId: string }[]>`
        SELECT "warehouseId" FROM payments WHERE "saleId" = ${sale.sale.id}::uuid`;
      expect(payment?.warehouseId).toBe(sale.sale.warehouse?.id);

      const second = await backfill.run({ tenantIds: [l.tenantId] });
      expect(second.filled).toEqual({ payments: 0, ledgerEntries: 0, trucks: 0 });
      expect(second.accessRows).toBe(0);

      const after = (await as(l).get(`/clients/${c.id}`).expect(200)).body as ClientDto;
      expect(after.balance).toBe(balanceBefore);
      const parts = after.debtByWarehouse ?? [];
      expect(parts.map((x) => x.warehouse?.id)).toEqual([main.id]);
      expect(parts[0]?.balance).toBe(after.balance);
      expect(mainId).not.toBe(main.id);
    });

    it('cannot change a ledger entry beyond setting its missing dépôt', async () => {
      await expect(
        tamper(t)`UPDATE client_ledger_entries SET amount = amount + 1
                  WHERE "clientId" = ${clientX.id}::uuid`,
      ).rejects.toThrow(/append-only/);
    });
  });

  describe('tenant isolation', () => {
    it("never reaches another company's dépôts or users", async () => {
      await as(e).get(`/warehouses/${depotA.id}`).expect(403); // MULTI_UNIT off in e
      const other = await registerTenant(t, 'Autre distrib', { activity: Activity.DISTRIBUTEUR });
      await as(other).get(`/warehouses/${depotA.id}`).expect(404);
      await as(other).put(`/warehouses/${depotA.id}/brands`, { brandIds: [] }).expect(404);
      await as(other).get(`/users/${sellerA.id}/access`).expect(404);
      await setAccess(other, sellerA.id, []).expect(404);
      const ownWarehouses = (await as(other).get('/warehouses').expect(200)).body as WarehouseDto[];
      const res = await setAccess(other, other.auth.user.id, [
        { warehouseId: depotA.id, level: 'OPERATE' },
      ]);
      expect([403, 404, 422]).toContain(res.status);
      expect(ownWarehouses.map((w) => w.id)).not.toContain(depotA.id);
    });
  });
});
