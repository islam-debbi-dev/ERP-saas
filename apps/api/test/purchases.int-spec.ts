import { randomUUID } from 'node:crypto';
import * as argon2 from 'argon2';
import {
  type AuthResponse,
  ErrorCode,
  type PriceLevelDto,
  type ProductDto,
  type PurchaseDto,
  type PurchasePage,
  type ReconcileReport,
  type StockLevelDto,
  type SupplierDto,
} from '@erp/shared';
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

describe('purchases', () => {
  let t: TestApp;
  let a: RegisteredTenant;
  let b: RegisteredTenant;
  let catA: TenantCatalog;

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

  async function supplier(
    who: RegisteredTenant,
    name = 'Cevital Distribution',
  ): Promise<SupplierDto> {
    return (await as(who).post('/suppliers', { name, phone: '0550 00 00 00' }, null).expect(201))
      .body as SupplierDto;
  }

  /** Draft BR: `cartons` cartons of `product` at `cost` HT the carton. */
  async function draft(
    who: RegisteredTenant,
    supplierId: string,
    lines: { productId: string; unitId: string; qty: string; unitCost: string }[],
  ): Promise<PurchaseDto> {
    return (
      await as(who)
        .post('/purchases', { supplierId, documentDate: '2026-10-20', lines })
        .expect(201)
    ).body as PurchaseDto;
  }

  beforeAll(async () => {
    t = await createTestApp();
    a = await registerTenant(t, 'Achats A');
    b = await registerTenant(t, 'Achats B');
    catA = await catalogOf(t, a);
  });
  afterAll(() => t.close());

  it('validating a BR raises stock, sets the CUMP per base unit and numbers BRs in sequence', async () => {
    const s = await supplier(a);
    const p = await createProduct(t, a, catA, { cartonFactor: '24' });
    const one = await draft(a, s.id, [
      { productId: p.id, unitId: p.cartonUnitId, qty: '2', unitCost: '1100' },
    ]);
    expect(one).toMatchObject({
      status: 'DRAFT',
      number: null,
      totalHt: '2200.00',
      totalTva: '418.00',
      totalTtc: '2618.00',
    });
    expect(one.lines[0]).toMatchObject({ qtyBase: '48.000', unitCode: 'CARTON', tvaRate: '19.00' });

    const v1 = (await as(a).post(`/purchases/${one.id}/validate`).expect(200)).body as PurchaseDto;
    expect(v1.status).toBe('VALIDATED');
    expect(v1.number).toMatch(/^BR-\d{4}-000001$/);
    expect(await level(a, p.id)).toMatchObject({ qtyBase: '48.000', avgCost: '45.8333' });

    // Second BR at a higher cost: (48 x 45.8333 + 24 x 50) / 72 = 47.2222
    const two = await draft(a, s.id, [
      { productId: p.id, unitId: p.cartonUnitId, qty: '1', unitCost: '1200' },
    ]);
    const v2 = (await as(a).post(`/purchases/${two.id}/validate`).expect(200)).body as PurchaseDto;
    expect(v2.number).toMatch(/^BR-\d{4}-000002$/);
    expect(await level(a, p.id)).toMatchObject({ qtyBase: '72.000', avgCost: '47.2222' });
  });

  it('a replayed validation has one effect; a new validation of the same BR is refused', async () => {
    const s = await supplier(a);
    const p = await createProduct(t, a, catA);
    const d = await draft(a, s.id, [
      { productId: p.id, unitId: p.baseUnitId, qty: '10', unitCost: '5' },
    ]);
    const key = randomUUID();
    const first = await as(a).post(`/purchases/${d.id}/validate`, {}, key).expect(200);
    const replay = await as(a).post(`/purchases/${d.id}/validate`, {}, key).expect(200);
    expect(replay.body).toEqual(first.body);
    const again = await as(a).post(`/purchases/${d.id}/validate`).expect(409);
    expect(again.body).toMatchObject({ code: ErrorCode.PURCHASE_NOT_DRAFT });
    expect((await level(a, p.id)).qtyBase).toBe('10.000');
  });

  it('cancelling a validated BR brings stock back and keeps the CUMP', async () => {
    const s = await supplier(a);
    const p = await createProduct(t, a, catA);
    const first = await draft(a, s.id, [
      { productId: p.id, unitId: p.baseUnitId, qty: '10', unitCost: '100' },
    ]);
    await as(a).post(`/purchases/${first.id}/validate`).expect(200);
    const second = await draft(a, s.id, [
      { productId: p.id, unitId: p.baseUnitId, qty: '10', unitCost: '200' },
    ]);
    await as(a).post(`/purchases/${second.id}/validate`).expect(200);
    expect((await level(a, p.id)).avgCost).toBe('150.0000');

    const cancelled = (await as(a).post(`/purchases/${second.id}/cancel`).expect(200))
      .body as PurchaseDto;
    expect(cancelled.status).toBe('CANCELLED');
    expect(await level(a, p.id)).toMatchObject({ qtyBase: '10.000', avgCost: '150.0000' });
    await as(a).post(`/purchases/${second.id}/cancel`).expect(409);
  });

  it('in BLOCK mode, cancelling is refused once the goods are gone', async () => {
    const c = await registerTenant(t, 'Achats Block');
    const cat = await catalogOf(t, c);
    await as(c).patch('/tenant/settings', { negativeStockMode: 'BLOCK' }).expect(200);
    const s = await supplier(c);
    const p = await createProduct(t, c, cat);
    const d = await draft(c, s.id, [
      { productId: p.id, unitId: p.baseUnitId, qty: '5', unitCost: '10' },
    ]);
    await as(c).post(`/purchases/${d.id}/validate`).expect(200);
    await as(c)
      .post('/stock/adjustments', {
        reason: 'PERTE',
        lines: [{ productId: p.id, unitId: p.baseUnitId, qty: '-4' }],
      })
      .expect(201);
    const res = await as(c).post(`/purchases/${d.id}/cancel`).expect(409);
    expect(res.body).toMatchObject({
      code: ErrorCode.STOCK_INSUFFICIENT,
      details: { available: '1.000' },
    });
    expect(((await as(c).get(`/purchases/${d.id}`).expect(200)).body as PurchaseDto).status).toBe(
      'VALIDATED',
    );
  });

  it('supplier returns are limited to what is left; a later cancel reverses only the rest', async () => {
    const s = await supplier(a);
    const p = await createProduct(t, a, catA, { cartonFactor: '12' });
    const d = await draft(a, s.id, [
      { productId: p.id, unitId: p.cartonUnitId, qty: '3', unitCost: '600' },
    ]);
    const v = (await as(a).post(`/purchases/${d.id}/validate`).expect(200)).body as PurchaseDto;
    const lineId = v.lines[0]!.id;

    const r1 = (
      await as(a)
        .post(`/purchases/${d.id}/returns`, { lines: [{ purchaseLineId: lineId, qty: '1' }] })
        .expect(201)
    ).body as PurchaseDto;
    expect(r1.returns[0]!.number).toMatch(/^RF-\d{4}-\d{6}$/);
    expect(r1.lines[0]!.returnedQtyBase).toBe('12.000');
    expect(await level(a, p.id)).toMatchObject({ qtyBase: '24.000', avgCost: '50.0000' });

    const tooMuch = await as(a)
      .post(`/purchases/${d.id}/returns`, { lines: [{ purchaseLineId: lineId, qty: '2.5' }] })
      .expect(409);
    expect(tooMuch.body).toMatchObject({
      code: ErrorCode.RETURN_EXCEEDS_RECEIVED,
      details: { availableQtyBase: '24.000' },
    });

    await as(a)
      .post(`/purchases/${d.id}/returns`, { lines: [{ purchaseLineId: lineId, qty: '0.5' }] })
      .expect(201);
    expect((await level(a, p.id)).qtyBase).toBe('18.000');

    await as(a).post(`/purchases/${d.id}/cancel`).expect(200);
    expect((await level(a, p.id)).qtyBase).toBe('0.000');
    await as(a)
      .post(`/purchases/${d.id}/returns`, { lines: [{ purchaseLineId: lineId, qty: '1' }] })
      .expect(409);
  });

  it('a tenant not subject to TVA puts the TVA into the CUMP', async () => {
    const c = await registerTenant(t, 'IFU');
    const cat = await catalogOf(t, c);
    await as(c).patch('/tenant/settings', { assujettiTva: false }).expect(200);
    const s = await supplier(c);
    const p = await createProduct(t, c, cat, { cartonFactor: '10' });
    const d = await draft(c, s.id, [
      { productId: p.id, unitId: p.cartonUnitId, qty: '1', unitCost: '1000' },
    ]);
    expect(d).toMatchObject({ totalHt: '1000.00', totalTva: '0.00', totalTtc: '1000.00' });
    await as(c).post(`/purchases/${d.id}/validate`).expect(200);
    // 1 000 HT at 19 % = 1 190 paid for 10 pieces
    expect((await level(c, p.id)).avgCost).toBe('119.0000');
  });

  it('applies only the selling prices chosen on validation, with an audit of old and new', async () => {
    const s = await supplier(a);
    const p = await createProduct(t, a, catA);
    const levels = (await as(a).get('/price-levels').expect(200)).body as PriceLevelDto[];
    const d = await draft(a, s.id, [
      { productId: p.id, unitId: p.baseUnitId, qty: '1', unitCost: '80' },
    ]);
    await as(a)
      .post(`/purchases/${d.id}/validate`, {
        priceUpdates: [
          { productId: p.id, unitId: p.baseUnitId, priceLevelId: levels[0]!.id, priceHt: '99.90' },
        ],
      })
      .expect(200);
    const product = (await as(a).get(`/products/${p.id}`).expect(200)).body as ProductDto;
    expect(product.prices).toEqual([
      { unitId: p.baseUnitId, priceLevelId: levels[0]!.id, priceHt: '99.90' },
    ]);
    const log = await asTenant(a.tenantId, () =>
      t.prisma.db.auditLog.findFirstOrThrow({
        where: { action: 'PRODUCT_PRICES_UPDATED', entityId: p.id },
      }),
    );
    expect(log.after).toMatchObject({ priceChanges: [{ from: null, to: '99.90' }] });

    const other = await createProduct(t, a, catA);
    const d2 = await draft(a, s.id, [
      { productId: other.id, unitId: other.baseUnitId, qty: '1', unitCost: '80' },
    ]);
    await as(a).post(`/purchases/${d2.id}/validate`).expect(200);
    expect(
      ((await as(a).get(`/products/${other.id}`).expect(200)).body as ProductDto).prices,
    ).toEqual([]);
  });

  it('draft edits need the current version; empty drafts cannot be validated', async () => {
    const s = await supplier(a);
    const p = await createProduct(t, a, catA);
    const d = await draft(a, s.id, []);
    const empty = await as(a).post(`/purchases/${d.id}/validate`).expect(400);
    expect(empty.body).toMatchObject({ code: ErrorCode.PURCHASE_EMPTY });
    const body = {
      supplierId: s.id,
      documentDate: '2026-10-21',
      lines: [{ productId: p.id, unitId: p.baseUnitId, qty: '3', unitCost: '10' }],
    };
    const edited = (
      await as(a)
        .put(`/purchases/${d.id}`, { ...body, version: 1 })
        .expect(200)
    ).body as PurchaseDto;
    expect(edited).toMatchObject({ version: 2, totalHt: '30.00', documentDate: '2026-10-21' });
    const stale = await as(a)
      .put(`/purchases/${d.id}`, { ...body, version: 1 })
      .expect(409);
    expect(stale.body).toMatchObject({ code: ErrorCode.PURCHASE_MODIFIED });
    const overpaid = await as(a)
      .put(`/purchases/${d.id}`, { ...body, version: 2, paidAmount: '1000' })
      .expect(400);
    expect(overpaid.body).toMatchObject({ details: { field: 'paidAmount' } });
  });

  it('isolates tenants on suppliers and purchases', async () => {
    const s = await supplier(a);
    const p = await createProduct(t, a, catA);
    const d = await draft(a, s.id, [
      { productId: p.id, unitId: p.baseUnitId, qty: '1', unitCost: '1' },
    ]);
    await as(b).get(`/suppliers/${s.id}`).expect(404);
    await as(b).get(`/purchases/${d.id}`).expect(404);
    await as(b).post(`/purchases/${d.id}/validate`).expect(404);
    // B cannot draft with A's supplier or product.
    await as(b)
      .post('/purchases', { supplierId: s.id, documentDate: '2026-10-20', lines: [] })
      .expect(400);
    const sb = await supplier(b);
    await as(b)
      .post('/purchases', {
        supplierId: sb.id,
        documentDate: '2026-10-20',
        lines: [{ productId: p.id, unitId: p.baseUnitId, qty: '1', unitCost: '1' }],
      })
      .expect(400);
    const listB = (await as(b).get('/purchases').expect(200)).body as PurchasePage;
    expect(listB.items.find((x) => x.id === d.id)).toBeUndefined();
  });

  it('a storekeeper drafts but cannot validate', async () => {
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
    const s = await supplier(a);
    const p = await createProduct(t, a, catA);
    const d = await draft(keeper, s.id, [
      { productId: p.id, unitId: p.baseUnitId, qty: '1', unitCost: '1' },
    ]);
    await as(keeper).post(`/purchases/${d.id}/validate`).expect(403);
    await as(keeper).post('/suppliers', { name: 'Non' }, null).expect(403);
  });

  it('filters the list by status and supplier', async () => {
    const s1 = await supplier(a, 'Filtre 1');
    const s2 = await supplier(a, 'Filtre 2');
    const p = await createProduct(t, a, catA);
    const d1 = await draft(a, s1.id, [
      { productId: p.id, unitId: p.baseUnitId, qty: '1', unitCost: '1' },
    ]);
    await draft(a, s2.id, [{ productId: p.id, unitId: p.baseUnitId, qty: '1', unitCost: '1' }]);
    await as(a).post(`/purchases/${d1.id}/validate`).expect(200);
    const bySupplier = (await as(a).get(`/purchases?supplierId=${s1.id}`).expect(200))
      .body as PurchasePage;
    expect(bySupplier.items.map((x) => x.id)).toEqual([d1.id]);
    const drafts = (await as(a).get(`/purchases?status=DRAFT&supplierId=${s2.id}`).expect(200))
      .body as PurchasePage;
    expect(drafts.items).toHaveLength(1);
  });

  it('reconcile stays clean after all purchase operations', async () => {
    for (const who of [a, b]) {
      const report = (await as(who).get('/stock/reconcile').expect(200)).body as ReconcileReport;
      expect(report.differences).toEqual([]);
    }
  });
});
