import { randomUUID } from 'node:crypto';
import * as argon2 from 'argon2';
import {
  type AuthResponse,
  type ClientDto,
  type ClientReconcileReport,
  ErrorCode,
  type PricePreviewDto,
  type ProductDto,
  type ReconcileReport,
  type SaleDto,
  type SalePage,
  type SaleResultDto,
  type StockLevelDto,
} from '@erp/shared';
import {
  asTenant,
  bearer,
  catalogOf,
  createTestApp,
  registerTenant,
  type RegisteredTenant,
  type TenantCatalog,
  type TestApp,
  uniqueEmail,
} from './helpers';

const TODAY = '2026-10-19';

describe('sales', () => {
  let t: TestApp;
  let a: RegisteredTenant;
  let b: RegisteredTenant;
  let catA: TenantCatalog;
  let catB: TenantCatalog;
  let seq = 0;

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

  interface Item {
    id: string;
    piece: string;
    carton: string;
  }

  /**
   * Pièce + carton of 24, prices per level (gros, demi-gros, détail), TVA 19 %,
   * `stock` pieces in opening stock at 80 DA.
   */
  async function product(
    who: RegisteredTenant,
    cat: TenantCatalog,
    opts: { stock?: number; cartonPrices?: (string | null)[]; tvaRate?: string } = {},
  ): Promise<Item> {
    const piece = cat.units['PIECE']!.id;
    const carton = cat.units['CARTON']!.id;
    const cartonPrices = opts.cartonPrices ?? ['2300', '2500', '2700'];
    const res = await as(who)
      .post(
        '/products',
        {
          reference: `S-${Date.now()}-${++seq}`,
          designation: `Article ${seq}`,
          baseUnitId: piece,
          tvaRate: opts.tvaRate ?? '19',
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
          prices: [
            ...cat.levels.slice(0, 3).map((l, i) => ({
              unitId: piece,
              priceLevelId: l.id,
              priceHt: String(100 + 10 * i),
            })),
            ...cat.levels.slice(0, 3).flatMap((l, i) => {
              const p = cartonPrices[i];
              return p ? [{ unitId: carton, priceLevelId: l.id, priceHt: p }] : [];
            }),
          ],
        },
        null,
      )
      .expect(201);
    const id = (res.body as ProductDto).id;
    const stock = opts.stock ?? 48;
    if (stock > 0) {
      await as(who)
        .post('/stock/opening', {
          lines: [{ productId: id, unitId: piece, qty: String(stock), unitCost: '80' }],
        })
        .expect(201);
    }
    return { id, piece, carton };
  }

  const client = async (who: RegisteredTenant, extra: object = {}) =>
    (
      await as(who)
        .post('/clients', { code: `V${++seq}`, name: `Client ${seq}`, ...extra }, null)
        .expect(201)
    ).body as ClientDto;

  const balance = async (who: RegisteredTenant, clientId: string) =>
    ((await as(who).get(`/clients/${clientId}`).expect(200)).body as ClientDto).balance;

  const level = async (who: RegisteredTenant, productId: string) =>
    (await as(who).get(`/stock/${productId}`).expect(200)).body as StockLevelDto;

  const quick = (who: RegisteredTenant, body: object, key: string | null = randomUUID()) =>
    as(who).post('/sales/quick', { documentDate: TODAY, ...body }, key);

  const cartons = (p: Item, qty: string, extra: object = {}) => ({
    productId: p.id,
    unitId: p.carton,
    qty,
    ...extra,
  });

  const loginAs = async (who: RegisteredTenant, role: 'SELLER' | 'MANAGER') => {
    const email = uniqueEmail(role.toLowerCase());
    await asTenant(who.tenantId, async () =>
      t.prisma.db.user.create({
        data: {
          tenantId: who.tenantId,
          email,
          passwordHash: await argon2.hash('Password123!'),
          fullName: role,
          role,
        },
      }),
    );
    const login = await t
      .http()
      .post('/auth/login')
      .send({ email, password: 'Password123!' })
      .expect(200);
    return { ...who, auth: login.body as AuthResponse & { refreshToken: string } };
  };

  const setSettings = (who: RegisteredTenant, patch: object) =>
    as(who).patch('/tenant/settings', patch).expect(200);

  beforeAll(async () => {
    t = await createTestApp();
    a = await registerTenant(t, 'Ventes A');
    b = await registerTenant(t, 'Ventes B');
    catA = await catalogOf(t, a);
    catB = await catalogOf(t, b);
  });
  afterAll(() => t.close());

  it('a quick BL on credit moves stock out, puts TTC on the account and numbers in sequence', async () => {
    const p = await product(a, catA);
    const c = await client(a);
    const first = (await quick(a, { clientId: c.id, lines: [cartons(p, '1')] }).expect(201))
      .body as SaleResultDto;
    // 2 300 HT + 19 % = 2 737 TTC, all on credit
    expect(first.sale).toMatchObject({
      type: 'BL',
      status: 'VALIDATED',
      totalHt: '2300.00',
      totalTva: '437.00',
      totalTtc: '2737.00',
      paidAmount: '0.00',
    });
    expect(first.sale.number).toMatch(/^BL-\d{4}-\d{6}$/);
    expect(first.change).toBe('0.00');
    expect((await level(a, p.id)).qtyBase).toBe('24.000');
    expect(await balance(a, c.id)).toBe('2737.00');

    const second = (await quick(a, { clientId: c.id, lines: [cartons(p, '1')] }).expect(201))
      .body as SaleResultDto;
    const n = (s: SaleDto) => Number(s.number?.slice(-6));
    expect(n(second.sale)).toBe(n(first.sale) + 1);

    // CUMP frozen on the line for margins.
    const line = await asTenant(a.tenantId, () =>
      t.prisma.db.saleLine.findFirstOrThrow({ where: { saleId: first.sale.id } }),
    );
    expect(line.unitCostBase.toString()).toBe('80');
  });

  it('a partial payment puts only the remainder on credit and records a versement', async () => {
    const p = await product(a, catA);
    const c = await client(a);
    const r = (
      await quick(a, {
        clientId: c.id,
        lines: [cartons(p, '1')],
        paidAmount: '1 637',
        paymentMode: 'CHEQUE',
      }).expect(201)
    ).body as SaleResultDto;
    expect(r.sale.paidAmount).toBe('1637.00');
    expect(r.sale.payments).toEqual([
      expect.objectContaining({ amount: '1637.00', mode: 'CHEQUE', status: 'VALID' }),
    ]);
    expect(r.sale.payments[0]?.number).toMatch(/^VER-/);
    expect(await balance(a, c.id)).toBe('1100.00');
  });

  it('a comptoir sale must be paid in full; change above TTC is given back, not kept', async () => {
    const p = await product(a, catA);
    const short = await quick(a, { lines: [cartons(p, '1')], paidAmount: '2000' }).expect(400);
    expect(short.body).toMatchObject({ code: ErrorCode.CLIENT_REQUIRED_FOR_CREDIT });
    const r = (await quick(a, { lines: [cartons(p, '1')], paidAmount: '3000' }).expect(201))
      .body as SaleResultDto;
    expect(r.sale.client).toBeNull();
    expect(r.sale.paidAmount).toBe('2737.00');
    expect(r.change).toBe('263.00');
    expect(r.sale.payments[0]?.amount).toBe('2737.00');
  });

  it('two concurrent quick sales of the last carton in BLOCK mode: one sells, one gets STOCK_INSUFFICIENT', async () => {
    const c = await registerTenant(t, 'Ventes concurrence');
    const cat = await catalogOf(t, c);
    await setSettings(c, { negativeStockMode: 'BLOCK' });
    const p = await product(c, cat, { stock: 24 });
    const results = await Promise.all(
      [1, 2].map(() => quick(c, { lines: [cartons(p, '1')], paidAmount: '2737' })),
    );
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    const failed = results.find((r) => r.status === 409);
    expect(failed?.body).toMatchObject({ code: ErrorCode.STOCK_INSUFFICIENT });
    expect((await level(c, p.id)).qtyBase).toBe('0.000');
    // The refused quick sale left nothing behind: no draft, no payment.
    const page = (await as(c).get('/sales?limit=100').expect(200)).body as SalePage;
    expect(page.items).toHaveLength(1);
    const payments = await asTenant(c.tenantId, () => t.prisma.db.payment.count());
    expect(payments).toBe(1);
  });

  it('plafond: BLOCK refuses, a manager can force, WARN warns; only the credit part counts', async () => {
    const c = await registerTenant(t, 'Ventes plafond');
    const cat = await catalogOf(t, c);
    const p = await product(c, cat, { stock: 240 });
    const cl = await client(c, { creditLimit: '3000' });
    const seller = await loginAs(c, 'SELLER');
    await setSettings(c, { creditLimitMode: 'BLOCK' });

    // 2 cartons = 5 474 TTC on credit > 3 000
    const blocked = await quick(c, { clientId: cl.id, lines: [cartons(p, '2')] }).expect(409);
    expect(blocked.body).toMatchObject({
      code: ErrorCode.CREDIT_LIMIT_EXCEEDED,
      details: { status: 'BLOCK', limit: '3000.00', projected: '5474.00' },
    });
    await quick(seller, { clientId: cl.id, lines: [cartons(p, '2')], forceCredit: true }).expect(
      403,
    );
    // Paying 2 474 leaves 3 000 on credit: exactly the plafond, accepted without warning.
    const paid = (
      await quick(seller, { clientId: cl.id, lines: [cartons(p, '2')], paidAmount: '2474' }).expect(
        201,
      )
    ).body as SaleResultDto;
    expect(paid.warnings).toEqual([]);
    expect(await balance(c, cl.id)).toBe('3000.00');

    const forced = (
      await quick(c, { clientId: cl.id, lines: [cartons(p, '1')], forceCredit: true }).expect(201)
    ).body as SaleResultDto;
    expect(forced.sale.creditOverride).toBe(true);
    expect(forced.warnings).toEqual([
      expect.objectContaining({ kind: 'CREDIT_LIMIT', forced: true, projected: '5737.00' }),
    ]);

    await setSettings(c, { creditLimitMode: 'WARN' });
    const warned = (await quick(seller, { clientId: cl.id, lines: [cartons(p, '1')] }).expect(201))
      .body as SaleResultDto;
    expect(warned.sale.creditOverride).toBe(false);
    expect(warned.warnings).toEqual([
      expect.objectContaining({ kind: 'CREDIT_LIMIT', forced: false }),
    ]);
  });

  it('sellers sell at the level price; overrides and discounts need a manager; missing prices are refused', async () => {
    const p = await product(a, catA, { cartonPrices: ['2300', null, '2700'] });
    const seller = await loginAs(a, 'SELLER');
    const denied = await quick(seller, {
      lines: [cartons(p, '1', { unitPriceHt: '2000' })],
      paidAmount: '9999',
    }).expect(403);
    expect(denied.body).toMatchObject({ code: ErrorCode.PRICE_OVERRIDE_FORBIDDEN });
    await quick(seller, {
      lines: [cartons(p, '1', { discountPct: '5' })],
      paidAmount: '9999',
    }).expect(403);
    // Typing the list price itself is not an override.
    await quick(seller, {
      lines: [cartons(p, '1', { unitPriceHt: '2 300,00' })],
      paidAmount: '9999',
    }).expect(201);

    const owner = (
      await quick(a, {
        lines: [cartons(p, '1', { unitPriceHt: '2000', discountPct: '10' })],
        paidAmount: '9999',
      }).expect(201)
    ).body as SaleResultDto;
    // 2 000 - 10 % = 1 800 HT, TTC 2 142; the list price stays on the line.
    expect(owner.sale.totalTtc).toBe('2142.00');
    expect(owner.sale.lines[0]).toMatchObject({
      listPriceHt: '2300.00',
      unitPriceHt: '2000.00',
      discountPct: '10.00',
    });

    // Level 2 (demi-gros) has no carton price.
    const demi = await client(a, { priceLevelId: catA.levels[1]!.id });
    const missing = await quick(seller, { clientId: demi.id, lines: [cartons(p, '1')] }).expect(
      409,
    );
    expect(missing.body).toMatchObject({ code: ErrorCode.PRICE_MISSING });
  });

  it('price-preview gives the price of the client level', async () => {
    const p = await product(a, catA);
    const prod = (await as(a).get(`/products/${p.id}`).expect(200)).body as ProductDto;
    const cartonUnit = prod.units.find((u) => u.unitId === p.carton)!;
    const detail = await client(a, { priceLevelId: catA.levels[2]!.id });
    const preview = (url: string) =>
      as(a)
        .get(url)
        .expect(200)
        .then((r) => r.body as PricePreviewDto);
    expect((await preview(`/sales/price-preview?productUnitId=${cartonUnit.id}`)).priceHt).toBe(
      '2300.00',
    );
    expect(
      (await preview(`/sales/price-preview?productUnitId=${cartonUnit.id}&clientId=${detail.id}`))
        .priceHt,
    ).toBe('2700.00');
  });

  it('replaying /sales/quick returns the same sale and moves nothing new', async () => {
    const p = await product(a, catA);
    const key = randomUUID();
    const body = { lines: [cartons(p, '1')], paidAmount: '2737' };
    const first = await quick(a, body, key).expect(201);
    const replay = await quick(a, body, key).expect(201);
    expect(replay.body).toEqual(first.body);
    const moves = await asTenant(a.tenantId, () =>
      t.prisma.db.stockMovement.count({ where: { productId: p.id, type: 'SALE' } }),
    );
    expect(moves).toBe(1);
    await quick(a, { ...body, paidAmount: '3000' }, key).expect(409);
  });

  it('drafts: create, edit with version, validate once; empty drafts cannot be validated', async () => {
    const p = await product(a, catA);
    const c = await client(a);
    const draft = (
      await as(a)
        .post('/sales', { documentDate: TODAY, clientId: c.id, lines: [cartons(p, '1')] }, null)
        .expect(201)
    ).body as SaleDto;
    expect(draft).toMatchObject({ status: 'DRAFT', number: null, totalTtc: '2737.00' });
    expect((await level(a, p.id)).qtyBase).toBe('48.000');

    const body = { documentDate: TODAY, clientId: c.id, type: 'FACTURE', lines: [cartons(p, '2')] };
    const edited = (
      await as(a)
        .put(`/sales/${draft.id}`, { ...body, version: 1 })
        .expect(200)
    ).body as SaleDto;
    expect(edited).toMatchObject({ type: 'FACTURE', totalTtc: '5474.00', version: 2 });
    const stale = await as(a)
      .put(`/sales/${draft.id}`, { ...body, version: 1 })
      .expect(409);
    expect(stale.body).toMatchObject({ code: ErrorCode.SALE_MODIFIED });

    const v = (await as(a).post(`/sales/${draft.id}/validate`, { paidAmount: '474' }).expect(200))
      .body as SaleResultDto;
    expect(v.sale.number).toMatch(/^FAC-/);
    expect(await balance(a, c.id)).toBe('5000.00');
    const again = await as(a).post(`/sales/${draft.id}/validate`, {}).expect(409);
    expect(again.body).toMatchObject({ code: ErrorCode.SALE_NOT_DRAFT });

    const empty = (await as(a).post('/sales', { documentDate: TODAY, lines: [] }, null).expect(201))
      .body as SaleDto;
    const res = await as(a).post(`/sales/${empty.id}/validate`, {}).expect(400);
    expect(res.body).toMatchObject({ code: ErrorCode.SALE_EMPTY });
  });

  it('cancel restores stock, CUMP and balance exactly, even after a partial return', async () => {
    const p = await product(a, catA);
    const c = await client(a);
    const sale = (
      await quick(a, { clientId: c.id, lines: [cartons(p, '2')], paidAmount: '1000' }).expect(201)
    ).body as SaleResultDto;
    const line = sale.sale.lines[0]!;
    // 0.25 carton = 6 pieces back: 575 HT, 684.25 TTC
    await as(a)
      .post(`/sales/${sale.sale.id}/returns`, {
        disposition: 'RESTOCK',
        reason: 'invendus',
        lines: [{ saleLineId: line.id, qty: '0.25' }],
      })
      .expect(201);
    expect((await level(a, p.id)).qtyBase).toBe('6.000');
    expect(await balance(a, c.id)).toBe('3789.75'); // 5 474 - 1 000 - 684.25

    const seller = await loginAs(a, 'SELLER');
    await as(seller)
      .post(`/sales/${sale.sale.id}/cancel`, { reason: 'erreur de saisie' })
      .expect(403);
    const cancelled = (
      await as(a).post(`/sales/${sale.sale.id}/cancel`, { reason: 'erreur de saisie' }).expect(200)
    ).body as SaleResultDto;
    expect(cancelled.sale).toMatchObject({ status: 'CANCELLED', cancelReason: 'erreur de saisie' });
    expect(cancelled.sale.payments[0]?.status).toBe('CANCELLED');
    const after = await level(a, p.id);
    expect(after.qtyBase).toBe('48.000');
    expect(after.avgCost).toMatch(/^80(\.0+)?$/);
    expect(await balance(a, c.id)).toBe('0.00');

    const twice = await as(a)
      .post(`/sales/${sale.sale.id}/cancel`, { reason: 'encore' })
      .expect(409);
    expect(twice.body).toMatchObject({ code: ErrorCode.SALE_NOT_VALIDATED });
  });

  it('returns: never more than sold; damaged goods are written off; sellers cannot return', async () => {
    const p = await product(a, catA);
    const c = await client(a);
    const sale = (await quick(a, { clientId: c.id, lines: [cartons(p, '1')] }).expect(201))
      .body as SaleResultDto;
    const lineId = sale.sale.lines[0]!.id;
    const seller = await loginAs(a, 'SELLER');
    const ret = (who: RegisteredTenant, qty: string, disposition = 'RESTOCK') =>
      as(who).post(`/sales/${sale.sale.id}/returns`, {
        disposition,
        reason: 'retour client',
        lines: [{ saleLineId: lineId, qty }],
      });
    await ret(seller, '0.5').expect(403);
    const over = await ret(a, '1.5').expect(409);
    expect(over.body).toMatchObject({ code: ErrorCode.RETURN_EXCEEDS_SOLD });

    const damaged = (await ret(a, '0.5', 'DAMAGED').expect(201)).body as SaleResultDto;
    expect(damaged.sale.returns[0]).toMatchObject({ disposition: 'DAMAGED', totalTtc: '1368.50' });
    expect(damaged.sale.returns[0]?.number).toMatch(/^AV-/);
    expect(damaged.sale.lines[0]?.returnedQtyBase).toBe('12.000');
    expect((await level(a, p.id)).qtyBase).toBe('24.000'); // back in, then written off
    expect(await balance(a, c.id)).toBe('1368.50');

    await ret(a, '0.5').expect(201);
    expect((await level(a, p.id)).qtyBase).toBe('36.000');
    expect(await balance(a, c.id)).toBe('0.00');
    await ret(a, '0.25').expect(409);
  });

  it('a facture from 2 BLs adds no stock or ledger effect; invoiced BLs cannot be cancelled', async () => {
    const p = await product(a, catA);
    const c = await client(a);
    const other = await client(a);
    const bl = async (who: string) =>
      (
        (await quick(a, { clientId: who, lines: [cartons(p, '0.5')] }).expect(201))
          .body as SaleResultDto
      ).sale;
    const [bl1, bl2, foreign] = [await bl(c.id), await bl(c.id), await bl(other.id)];
    const stockBefore = (await level(a, p.id)).qtyBase;
    const balanceBefore = await balance(a, c.id);

    const mixed = await as(a)
      .post('/invoices/from-bls', { saleIds: [bl1.id, foreign.id], documentDate: TODAY })
      .expect(409);
    expect(mixed.body).toMatchObject({ code: ErrorCode.INVOICE_SOURCES_INVALID });

    const fac = (
      await as(a)
        .post('/invoices/from-bls', { saleIds: [bl1.id, bl2.id], documentDate: TODAY })
        .expect(201)
    ).body as SaleResultDto;
    expect(fac.sale).toMatchObject({ type: 'FACTURE', status: 'VALIDATED', totalTtc: '2737.00' });
    expect(fac.sale.number).toMatch(/^FAC-/);
    expect(fac.sale.sourceBls.map((s) => s.id).sort()).toEqual([bl1.id, bl2.id].sort());
    expect(fac.sale.lines).toHaveLength(2);
    expect((await level(a, p.id)).qtyBase).toBe(stockBefore);
    expect(await balance(a, c.id)).toBe(balanceBefore);

    const again = await as(a)
      .post('/invoices/from-bls', { saleIds: [bl1.id], documentDate: TODAY })
      .expect(409);
    expect(again.body).toMatchObject({ code: ErrorCode.INVOICE_SOURCES_INVALID });
    const blocked = await as(a).post(`/sales/${bl1.id}/cancel`, { reason: 'erreur' }).expect(409);
    expect(blocked.body).toMatchObject({ code: ErrorCode.SALE_INVOICED });
    // Returns go on the BL, not on the grouped facture.
    await as(a)
      .post(`/sales/${fac.sale.id}/returns`, {
        disposition: 'RESTOCK',
        reason: 'retour',
        lines: [{ saleLineId: fac.sale.lines[0]!.id, qty: '0.25' }],
      })
      .expect(400);

    // Cancelling the facture frees the BLs and changes nothing else.
    await as(a).post(`/sales/${fac.sale.id}/cancel`, { reason: 'refaire' }).expect(200);
    const freed = (await as(a).get(`/sales/${bl1.id}`).expect(200)).body as SaleDto;
    expect(freed.invoice).toBeNull();
    expect(await balance(a, c.id)).toBe(balanceBefore);
    await as(a)
      .post('/invoices/from-bls', { saleIds: [bl1.id, bl2.id], documentDate: TODAY })
      .expect(201);
  });

  it('a facture posts the TVA rounding difference so the account equals the documents', async () => {
    const p = await product(a, catA);
    const c = await client(a);
    // 0.03 HT at 19 %: each BL rounds its TVA to 0.01; the facture has 0.06 x 19 % = 0.0114 -> 0.01.
    const bl = async () =>
      (
        (
          await quick(a, {
            clientId: c.id,
            lines: [{ productId: p.id, unitId: p.piece, qty: '1', unitPriceHt: '0.03' }],
          }).expect(201)
        ).body as SaleResultDto
      ).sale;
    const [bl1, bl2] = [await bl(), await bl()];
    expect(bl1.totalTtc).toBe('0.04');
    expect(await balance(a, c.id)).toBe('0.08');
    const fac = (
      await as(a)
        .post('/invoices/from-bls', { saleIds: [bl1.id, bl2.id], documentDate: TODAY })
        .expect(201)
    ).body as SaleResultDto;
    expect(fac.sale.totalTtc).toBe('0.07');
    expect(await balance(a, c.id)).toBe('0.07');
    await as(a).post(`/sales/${fac.sale.id}/cancel`, { reason: 'refaire' }).expect(200);
    expect(await balance(a, c.id)).toBe('0.08');
  });

  it('a facture bills BLs net of the returns already made, without crediting them twice', async () => {
    const p = await product(a, catA);
    const c = await client(a);
    const bl = (
      (await quick(a, { clientId: c.id, lines: [cartons(p, '1')] }).expect(201))
        .body as SaleResultDto
    ).sale;
    await as(a)
      .post(`/sales/${bl.id}/returns`, {
        disposition: 'RESTOCK',
        reason: 'invendus',
        lines: [{ saleLineId: bl.lines[0]!.id, qty: '0.25' }],
      })
      .expect(201);
    expect(await balance(a, c.id)).toBe('2052.75'); // 2 737 - 684.25
    const fac = (
      await as(a)
        .post('/invoices/from-bls', { saleIds: [bl.id], documentDate: TODAY })
        .expect(201)
    ).body as SaleResultDto;
    expect(fac.sale.lines[0]).toMatchObject({ qty: '0.750', qtyBase: '18.000', lineHt: '1725.00' });
    expect(fac.sale.totalTtc).toBe('2052.75');
    expect(await balance(a, c.id)).toBe('2052.75');
  });

  it('changing the product after the sale never changes the sale', async () => {
    const p = await product(a, catA);
    const sale = (await quick(a, { lines: [cartons(p, '1')], paidAmount: '2737' }).expect(201))
      .body as SaleResultDto;
    await asTenant(a.tenantId, async () => {
      await t.prisma.db.productPrice.updateMany({
        where: { productId: p.id },
        data: { priceHt: '9999' },
      });
      await t.prisma.db.product.update({
        where: { id: p.id },
        data: { designation: 'Nouveau nom', tvaRate: '9' },
      });
    });
    const again = (await as(a).get(`/sales/${sale.sale.id}`).expect(200)).body as SaleDto;
    expect(again.lines[0]).toMatchObject({
      designation: sale.sale.lines[0]!.designation,
      unitPriceHt: '2300.00',
      tvaRate: '19.00',
    });
    expect(again.totalTtc).toBe('2737.00');
  });

  describe('timbre fiscal', () => {
    let tt: RegisteredTenant;
    let cat: TenantCatalog;

    beforeAll(async () => {
      tt = await registerTenant(t, 'Ventes timbre');
      cat = await catalogOf(t, tt);
      // Example values (README: verify them against the current loi de finances).
      await setSettings(tt, {
        timbreEnabled: true,
        timbreThreshold: '300',
        timbreTranches: [
          { upTo: '30000', rate: '1' },
          { upTo: '100000', rate: '1.5' },
          { upTo: null, rate: '2' },
        ],
        timbreMin: '5',
        timbreMax: '10000',
      });
    });

    const facture = (body: object) => quick(tt, { type: 'FACTURE', ...body });

    it('a facture paid in cash owes TTC + timbre: stored, on the ledger, fully paid', async () => {
      const p = await product(tt, cat);
      const c = await client(tt);
      // 2 cartons: 4 600 HT, 5 474 TTC, timbre 1 % = 54.74
      const r = (
        await facture({
          clientId: c.id,
          lines: [cartons(p, '2')],
          paidAmount: '6000',
          paymentMode: 'ESPECES',
        }).expect(201)
      ).body as SaleResultDto;
      expect(r.sale).toMatchObject({
        totalTtc: '5474.00',
        timbre: '54.74',
        paidAmount: '5528.74',
      });
      expect(r.change).toBe('471.26');
      const sale = await asTenant(tt.tenantId, () =>
        t.prisma.db.clientLedgerEntry.findFirstOrThrow({
          where: { refId: r.sale.id, type: 'SALE' },
        }),
      );
      expect(sale.amount.toString()).toBe('5528.74');
      expect(await balance(tt, c.id)).toBe('0.00');
    });

    it('a cash facture partly paid leaves TTC + timbre minus paid on credit', async () => {
      const p = await product(tt, cat);
      const c = await client(tt);
      const r = (
        await facture({
          clientId: c.id,
          lines: [cartons(p, '2')],
          paidAmount: '1000',
          paymentMode: 'ESPECES',
        }).expect(201)
      ).body as SaleResultDto;
      expect(r.sale.timbre).toBe('54.74');
      expect(await balance(tt, c.id)).toBe('4528.74');
      const unpaid = (await as(tt).get(`/clients/${c.id}/unpaid-documents`).expect(200)).body as {
        remaining: string;
      }[];
      expect(unpaid.map((u) => u.remaining)).toEqual(['4528.74']);
    });

    it('no timbre for a cheque, for credit, for a BL, or when the rule is off', async () => {
      const p = await product(tt, cat, { stock: 240 });
      const c = await client(tt);
      const cheque = (
        await facture({
          clientId: c.id,
          lines: [cartons(p, '1')],
          paidAmount: '2737',
          paymentMode: 'CHEQUE',
        }).expect(201)
      ).body as SaleResultDto;
      const credit = (await facture({ clientId: c.id, lines: [cartons(p, '1')] }).expect(201))
        .body as SaleResultDto;
      const bl = (
        await quick(tt, {
          clientId: c.id,
          lines: [cartons(p, '1')],
          paidAmount: '2737',
          paymentMode: 'ESPECES',
        }).expect(201)
      ).body as SaleResultDto;
      expect([cheque.sale.timbre, credit.sale.timbre, bl.sale.timbre]).toEqual([
        '0.00',
        '0.00',
        '0.00',
      ]);

      const off = await registerTenant(t, 'Ventes sans timbre');
      const offCat = await catalogOf(t, off);
      const q = await product(off, offCat);
      const r = (
        await quick(off, {
          type: 'FACTURE',
          lines: [cartons(q, '1')],
          paidAmount: '2737',
          paymentMode: 'ESPECES',
        }).expect(201)
      ).body as SaleResultDto;
      expect(r.sale.timbre).toBe('0.00');
    });

    it('cancelling a cash facture gives the timbre back with the rest', async () => {
      const p = await product(tt, cat);
      const c = await client(tt);
      const r = (
        await facture({
          clientId: c.id,
          lines: [cartons(p, '2')],
          paidAmount: '1000',
          paymentMode: 'ESPECES',
        }).expect(201)
      ).body as SaleResultDto;
      await as(tt).post(`/sales/${r.sale.id}/cancel`, { reason: 'Erreur' }).expect(200);
      expect(await balance(tt, c.id)).toBe('0.00');
    });
  });

  it('lists sales with filters', async () => {
    const p = await product(a, catA);
    const c = await client(a);
    await quick(a, { clientId: c.id, lines: [cartons(p, '0.5')] }).expect(201);
    await as(a)
      .post('/sales', { documentDate: TODAY, clientId: c.id, lines: [cartons(p, '0.5')] }, null)
      .expect(201);
    const list = async (q: string) =>
      ((await as(a).get(`/sales?clientId=${c.id}${q}`).expect(200)).body as SalePage).items;
    expect(await list('')).toHaveLength(2);
    expect((await list('&status=DRAFT')).map((s) => s.status)).toEqual(['DRAFT']);
    expect((await list('&notInvoiced=true&status=VALIDATED'))[0]).toMatchObject({
      type: 'BL',
      invoice: null,
    });
  });

  it('tenant B cannot see or touch tenant A sales', async () => {
    const p = await product(a, catA);
    const sale = (await quick(a, { lines: [cartons(p, '1')], paidAmount: '2737' }).expect(201))
      .body as SaleResultDto;
    await as(b).get(`/sales/${sale.sale.id}`).expect(404);
    await as(b).post(`/sales/${sale.sale.id}/cancel`, { reason: 'intrusion' }).expect(404);
    await as(b)
      .post(`/sales/${sale.sale.id}/returns`, {
        disposition: 'RESTOCK',
        reason: 'intrusion',
        lines: [{ saleLineId: sale.sale.lines[0]!.id, qty: '1' }],
      })
      .expect(404);
    const sold = await quick(b, { lines: [cartons(p, '1')], paidAmount: '9999' });
    expect(sold.status).toBeGreaterThanOrEqual(400);
    const page = (await as(b).get('/sales?limit=100').expect(200)).body as SalePage;
    expect(page.items.map((s) => s.id)).not.toContain(sale.sale.id);
    void catB;
  });

  // Last on purpose: every path above must leave stock and accounts reconcilable.
  it('stock and client reconcile find no difference', async () => {
    const stock = (await as(a).get('/stock/reconcile').expect(200)).body as ReconcileReport;
    expect(stock.differences).toEqual([]);
    const clients = (await as(a).get('/clients/reconcile').expect(200))
      .body as ClientReconcileReport;
    expect(clients.differences).toEqual([]);
  });
});
