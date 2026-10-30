import { randomUUID } from 'node:crypto';
import * as argon2 from 'argon2';
import ExcelJS from 'exceljs';
import {
  Activity,
  algiersDay,
  type ApiError,
  type AuthResponse,
  type ClientDto,
  type ClientPackagingDto,
  type DeliverOrderResultDto,
  ErrorCode,
  type ImportPreviewDto,
  type OrderDto,
  type PackagingMovementResultDto,
  type PackagingTypeDto,
  type PricingPreviewDto,
  type ProductDto,
  type PromotionDto,
  type Role,
  type SaleDto,
  type SaleResultDto,
  SELL_OUT_COLUMNS,
  type SellOutDto,
  type StockLevelDto,
} from '@erp/shared';
import { tenantContext } from '../src/common/tenant-context';
import { RECONCILE_CHECKS } from '../src/reconcile/reconcile-sql';
import {
  asTenant,
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

const errorOf = (res: { body: unknown }) => res.body as ApiError;
type Who = { auth: { accessToken: string } };
interface Item {
  id: string;
  piece: string;
  carton: string;
}

/**
 * Phase 20: promotions (UG, remises) applied by the API, emballages consignés counted per
 * client, and the sell-out report par marque.
 */
describe('distribution mode: promotions, packaging, sell-out (phase 20)', () => {
  let t: TestApp;
  let d: RegisteredTenant;
  let other: RegisteredTenant;
  let essentiel: RegisteredTenant;
  let cat: TenantCatalog;
  let seller: { id: string; auth: AuthResponse };
  let seq = 0;
  const today = () => algiersDay();

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
  });

  const member = async (who: RegisteredTenant, role: Role) => {
    const email = uniqueEmail(role.toLowerCase());
    const user = await asTenant(who.tenantId, async () =>
      t.prisma.db.user.create({
        data: {
          tenantId: who.tenantId,
          email,
          passwordHash: await argon2.hash('Password123!'),
          fullName: `${role} ${++seq}`,
          role,
        },
      }),
    );
    const login = await t
      .http()
      .post('/auth/login')
      .send({ email, password: 'Password123!' })
      .expect(200);
    return { id: user.id, auth: login.body as AuthResponse };
  };

  /** Carton of 24 pièces at 2 400 HT, 2 400 pièces (100 cartons) opened at 80. */
  async function product(who: RegisteredTenant = d, brandId?: string): Promise<Item> {
    const c = who === d ? cat : await catalogOf(t, who);
    const piece = c.units['PIECE']!.id;
    const carton = c.units['CARTON']!.id;
    const res = await as(who)
      .post(
        '/products',
        {
          reference: `D-${Date.now()}-${++seq}`,
          designation: `Boisson ${seq}`,
          baseUnitId: piece,
          tvaRate: '19',
          ...(brandId ? { brandId } : {}),
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
          prices: c.levels
            .slice(0, 3)
            .map((l) => ({ unitId: carton, priceLevelId: l.id, priceHt: '2400' })),
        },
        null,
      )
      .expect(201);
    const id = (res.body as ProductDto).id;
    await as(who)
      .post('/stock/opening', {
        lines: [{ productId: id, unitId: piece, qty: '2400', unitCost: '80' }],
      })
      .expect(201);
    return { id, piece, carton };
  }

  const client = async (who: RegisteredTenant = d) =>
    (
      await as(who)
        .post('/clients', { code: `DC${++seq}`, name: `Client ${seq}` }, null)
        .expect(201)
    ).body as ClientDto;

  const stockOf = async (productId: string) =>
    ((await as(d).get(`/stock/${productId}`).expect(200)).body as StockLevelDto).qtyBase;
  const balanceOf = async (clientId: string) =>
    ((await as(d).get(`/clients/${clientId}`).expect(200)).body as ClientDto).balance;
  const packagingOf = async (clientId: string, who: Who = d) =>
    (await as(who).get(`/clients/${clientId}/packaging`).expect(200)).body as ClientPackagingDto;
  const countOf = async (clientId: string, typeId: string) =>
    (await packagingOf(clientId)).balances.find((b) => b.packagingTypeId === typeId)?.balance ?? 0;

  /** 10 cartons bought, 1 carton free, repeatable. */
  const tenPlusOne = async (p: Item, extra: object = {}) =>
    (
      await as(d)
        .post(
          '/promotions',
          {
            name: `10+1 ${++seq}`,
            type: 'FREE_UNITS',
            validFrom: today(),
            validTo: today(),
            buyProductId: p.id,
            buyUnitId: p.carton,
            buyQty: '10',
            freeUnitId: p.carton,
            freeQty: '1',
            ...extra,
          },
          null,
        )
        .expect(201)
    ).body as PromotionDto;

  const quick = (who: Who, body: object, key: string = randomUUID()) =>
    as(who).post(
      '/sales/quick',
      { type: 'BL', documentDate: today(), paidAmount: '0', ...body },
      key,
    );

  beforeAll(async () => {
    t = await createTestApp();
    d = await registerTenant(t, 'Distrib Boissons', { activity: Activity.DISTRIBUTEUR });
    other = await registerTenant(t, 'Autre Distrib', { activity: Activity.DISTRIBUTEUR });
    await withoutGeoCheck(t, d);
    await withoutGeoCheck(t, other);
    essentiel = await registerTenant(t, 'Grossiste Simple');
    cat = await catalogOf(t, d);
    seller = await member(d, 'SELLER');
  });

  afterAll(() => t.close());

  // ---------------------------------------------------------------- promotions

  describe('promotions', () => {
    it('gives 2 free cartons on 25 with 10+1, posts stock for 27 and the account for 25', async () => {
      const p = await product();
      const promo = await tenPlusOne(p);
      const c = await client();
      const key = randomUUID();
      const res = await quick(
        d,
        {
          clientId: c.id,
          lines: [{ productId: p.id, unitId: p.carton, qty: '25' }],
        },
        key,
      ).expect(201);
      const sale = (res.body as SaleResultDto).sale;
      expect(sale.lines).toHaveLength(2);
      const [paid, free] = sale.lines;
      expect(paid).toMatchObject({ qty: '25.000', isFree: false, promotion: { id: promo.id } });
      expect(free).toMatchObject({
        qty: '2.000',
        unitPriceHt: '0.00',
        lineHt: '0.00',
        isFree: true,
        freeOfPosition: 1,
        promotion: { id: promo.id, name: promo.name },
      });
      // 25 × 2 400 = 60 000 HT, TTC 71 400; the free cartons are not charged.
      expect(sale.totalTtc).toBe('71400.00');
      expect(await balanceOf(c.id)).toBe('71400.00');
      expect(await stockOf(p.id)).toBe(String(2400 - 27 * 24) + '.000');

      // Idempotent replay: same sale, nothing moves again.
      const replay = await quick(
        d,
        {
          clientId: c.id,
          lines: [{ productId: p.id, unitId: p.carton, qty: '25' }],
        },
        key,
      ).expect(201);
      expect((replay.body as SaleResultDto).sale.id).toBe(sale.id);
      expect(await stockOf(p.id)).toBe(String(2400 - 27 * 24) + '.000');
      expect(await balanceOf(c.id)).toBe('71400.00');
    });

    it('keeps a past sale as it was when the promotion is edited or archived', async () => {
      const p = await product();
      const promo = await tenPlusOne(p);
      const sale = (
        (
          await quick(d, {
            lines: [{ productId: p.id, unitId: p.carton, qty: '10' }],
            paidAmount: '28560',
          }).expect(201)
        ).body as SaleResultDto
      ).sale;
      await as(d)
        .put(`/promotions/${promo.id}`, {
          version: promo.version,
          promotion: {
            name: 'Renamed',
            type: 'FREE_UNITS',
            validFrom: today(),
            validTo: today(),
            buyProductId: p.id,
            buyUnitId: p.carton,
            buyQty: '5',
            freeUnitId: p.carton,
            freeQty: '3',
          },
        })
        .expect(200);
      await t
        .http()
        .delete(`/promotions/${promo.id}`)
        .set(...bearer(d.auth.accessToken))
        .expect(204);
      const after = (await as(d).get(`/sales/${sale.id}`).expect(200)).body as SaleDto;
      expect(after.lines.map((l) => [l.qty, l.isFree, l.promotion?.name])).toEqual([
        ['10.000', false, promo.name],
        ['1.000', true, promo.name],
      ]);
      expect(after.totalTtc).toBe(sale.totalTtc);
    });

    it('applies the highest priority, then the best for the client, and a brand remise in Decimal', async () => {
      const brand = (
        await as(d)
          .post('/brands', { name: `Marque ${++seq}` }, null)
          .expect(201)
      ).body as { id: string };
      const p = await product(d, brand.id);
      await as(d)
        .post(
          '/promotions',
          {
            name: 'Remise 7,5 %',
            type: 'PERCENT_DISCOUNT',
            validFrom: today(),
            validTo: today(),
            target: 'BRAND',
            brandId: brand.id,
            discountPct: '7.5',
            priority: 1,
          },
          null,
        )
        .expect(201);
      // Same priority 1: 10+1 on 10 cartons gives 1 carton (2 400) > 7.5 % of 24 000 (1 800).
      await tenPlusOne(p, { priority: 1 });
      const pricedTen = (
        await as(d)
          .post(
            '/pricing/preview',
            { lines: [{ productId: p.id, unitId: p.carton, qty: '10' }] },
            null,
          )
          .expect(200)
      ).body as PricingPreviewDto;
      expect(pricedTen.lines.map((l) => [l.isFree, l.qty])).toEqual([
        [false, '10.000'],
        [true, '1.000'],
      ]);
      // On 3 cartons only the remise matches: 3 × 2 400 × 0.925 = 6 660.
      const pricedThree = (
        await as(d)
          .post(
            '/pricing/preview',
            { lines: [{ productId: p.id, unitId: p.carton, qty: '3' }] },
            null,
          )
          .expect(200)
      ).body as PricingPreviewDto;
      expect(pricedThree.lines).toHaveLength(1);
      expect(pricedThree.lines[0]).toMatchObject({ discountPct: '7.5', lineHt: '6660.00' });
      expect(pricedThree.totalTtc).toBe('7925.40');
      // A higher priority wins over the better gift.
      await as(d)
        .post(
          '/promotions',
          {
            name: 'Remise prioritaire',
            type: 'PERCENT_DISCOUNT',
            validFrom: today(),
            validTo: today(),
            target: 'PRODUCTS',
            productIds: [p.id],
            discountPct: '1',
            priority: 5,
          },
          null,
        )
        .expect(201);
      const priority = (
        await as(d)
          .post(
            '/pricing/preview',
            { lines: [{ productId: p.id, unitId: p.carton, qty: '10' }] },
            null,
          )
          .expect(200)
      ).body as PricingPreviewDto;
      expect(priority.lines).toHaveLength(1);
      expect(priority.lines[0]?.promotion?.name).toBe('Remise prioritaire');
    });

    it('needs PROMO_OVERRIDE to change the free units, and audits it', async () => {
      const p = await product();
      await tenPlusOne(p);
      const c = await client();
      const lines = [{ productId: p.id, unitId: p.carton, qty: '20', freeQty: '3' }];
      const refused = await quick(seller, { clientId: c.id, lines }).expect(403);
      expect(errorOf(refused).code).toBe(ErrorCode.PROMO_OVERRIDE_FORBIDDEN);
      expect(await stockOf(p.id)).toBe('2400.000');
      // A seller taking what the promotion gives is fine.
      await quick(seller, { clientId: c.id, lines: [{ ...lines[0], freeQty: '2' }] }).expect(201);
      const ok = await quick(d, { clientId: c.id, lines }).expect(201);
      const sale = (ok.body as SaleResultDto).sale;
      expect(sale.lines.find((l) => l.isFree)?.qty).toBe('3.000');
      const audit = await asTenant(d.tenantId, () =>
        t.prisma.db.auditLog.findMany({
          where: { entityId: sale.id, action: 'PROMO_OVERRIDE_USED' },
        }),
      );
      expect(audit).toHaveLength(1);
    });

    it('refuses free units without a promotion', async () => {
      const p = await product();
      const res = await quick(d, {
        lines: [{ productId: p.id, unitId: p.carton, qty: '5', freeQty: '1' }],
        paidAmount: '14280',
      }).expect(400);
      expect(errorOf(res).code).toBe(ErrorCode.FREE_LINE_NOT_EDITABLE);
    });

    it('returns the free units in proportion with an avoir, and refuses returning them alone', async () => {
      const p = await product();
      await tenPlusOne(p);
      const c = await client();
      const sale = (
        (
          await quick(d, {
            clientId: c.id,
            lines: [{ productId: p.id, unitId: p.carton, qty: '25' }],
          }).expect(201)
        ).body as SaleResultDto
      ).sale;
      const [paid, free] = sale.lines;
      const alone = await as(d)
        .post(`/sales/${sale.id}/returns`, {
          disposition: 'RESTOCK',
          reason: 'retour UG',
          lines: [{ saleLineId: free!.id, qty: '1' }],
        })
        .expect(400);
      expect(errorOf(alone).code).toBe(ErrorCode.FREE_LINE_NOT_EDITABLE);
      const before = await stockOf(p.id);
      const returned = (
        await as(d)
          .post(`/sales/${sale.id}/returns`, {
            disposition: 'RESTOCK',
            reason: 'trop commandé',
            lines: [{ saleLineId: paid!.id, qty: '10' }],
          })
          .expect(201)
      ).body as SaleResultDto;
      const avoir = returned.sale.returns[0]!;
      // 10 of 25 back: 2 × 10 / 25 = 0.8 → 1 free carton back, priced 0.
      expect(avoir.lines.map((l) => [l.saleLineId, l.qty, l.lineHt])).toEqual([
        [paid!.id, '10.000', '24000.00'],
        [free!.id, '1.000', '0.00'],
      ]);
      expect(avoir.totalTtc).toBe('28560.00');
      expect(Number(await stockOf(p.id)) - Number(before)).toBe(11 * 24);
      // The other 15: the last free carton comes back.
      const all = (
        await as(d)
          .post(`/sales/${sale.id}/returns`, {
            disposition: 'RESTOCK',
            reason: 'tout',
            lines: [{ saleLineId: paid!.id, qty: '15' }],
          })
          .expect(201)
      ).body as SaleResultDto;
      expect(all.sale.lines.find((l) => l.isFree)?.returnedQtyBase).toBe('48.000');
    });

    it('keeps free lines on a facture made from BLs', async () => {
      const p = await product();
      await tenPlusOne(p);
      const c = await client();
      const bl = (
        (
          await quick(d, {
            clientId: c.id,
            lines: [{ productId: p.id, unitId: p.carton, qty: '11' }],
          }).expect(201)
        ).body as SaleResultDto
      ).sale;
      const fac = (
        await as(d)
          .post('/invoices/from-bls', { saleIds: [bl.id], documentDate: today() })
          .expect(201)
      ).body as SaleResultDto;
      expect(fac.sale.lines.map((l) => [l.position, l.isFree, l.freeOfPosition])).toEqual([
        [1, false, null],
        [2, true, 1],
      ]);
      expect(fac.sale.totalTtc).toBe(bl.totalTtc);
    });

    it('freezes free lines on an order and delivers them in proportion', async () => {
      const p = await product();
      await tenPlusOne(p);
      const c = await client();
      const draft = (
        await as(d)
          .post('/orders', {
            clientId: c.id,
            lines: [{ productId: p.id, unitId: p.carton, qty: '20' }],
          })
          .expect(201)
      ).body as OrderDto;
      expect(draft.lines.filter((l) => l.isFree).map((l) => l.qty)).toEqual(['2.000']);
      const order = (await as(d).post(`/orders/${draft.id}/confirm`).expect(200)).body as OrderDto;
      const paidLine = order.lines.find((l) => !l.isFree)!;
      // 10 of 20 delivered: half of the 2 free cartons go with them.
      const res = (
        await as(d)
          .post(`/orders/${order.id}/deliver`, {
            lines: [{ orderLineId: paidLine.id, qty: '10' }],
            paidAmount: '0',
          })
          .expect(200)
      ).body as DeliverOrderResultDto;
      const bl = (await as(d).get(`/sales/${res.sale.id}`).expect(200)).body as SaleDto;
      expect(bl.lines.map((l) => [l.qty, l.isFree, l.freeOfPosition])).toEqual([
        ['10.000', false, null],
        ['1.000', true, 1],
      ]);
    });
  });

  // ---------------------------------------------------------------- packaging

  describe('packaging', () => {
    let casier: PackagingTypeDto;

    beforeAll(async () => {
      casier = (
        await as(d)
          .post('/packaging-types', { name: `Casier ${++seq}`, depositValue: '300' }, null)
          .expect(201)
      ).body as PackagingTypeDto;
    });

    const withCasier = async () => {
      const p = await product();
      await as(d)
        .put(`/products/${p.id}/packaging`, [
          { packagingTypeId: casier.id, qtyBasePerPackaging: '24' },
        ])
        .expect(200);
      return p;
    };

    it('posts packaging given and returned with a sale, a manual return, and reverses on cancel', async () => {
      const p = await withCasier();
      const c = await client();
      const sale = (
        (
          await quick(d, {
            clientId: c.id,
            // 30 pièces = 2 casiers (the second one started), + 2 cartons = 2 casiers.
            lines: [
              { productId: p.id, unitId: p.piece, qty: '30', unitPriceHt: '100' },
              { productId: p.id, unitId: p.carton, qty: '2' },
            ],
            packagingReturned: [{ packagingTypeId: casier.id, qty: 1 }],
          }).expect(201)
        ).body as SaleResultDto
      ).sale;
      expect(sale.packaging).toEqual([
        { packagingTypeId: casier.id, name: casier.name, given: 4, returned: 1 },
      ]);
      expect(await countOf(c.id, casier.id)).toBe(3);

      const key = randomUUID();
      const moved = (
        await as(d)
          .post(
            '/packaging-movements',
            { clientId: c.id, packagingTypeId: casier.id, type: 'RETURN', qty: 2 },
            key,
          )
          .expect(201)
      ).body as PackagingMovementResultDto;
      expect(moved).toMatchObject({ balance: 1, negative: false });
      // Replay: same answer, nothing posted twice.
      await as(d)
        .post(
          '/packaging-movements',
          { clientId: c.id, packagingTypeId: casier.id, type: 'RETURN', qty: 2 },
          key,
        )
        .expect(201);
      expect(await countOf(c.id, casier.id)).toBe(1);

      await as(d).post(`/sales/${sale.id}/cancel`, { reason: 'erreur de saisie' }).expect(200);
      // The sale's net (+3) is reversed; the manual return stays.
      expect(await countOf(c.id, casier.id)).toBe(-2);
      const relevé = await packagingOf(c.id);
      expect(relevé.entries.map((e) => [e.type, e.qty, e.balanceAfter])).toEqual([
        ['REVERSAL', -3, -2],
        ['RETURN', -2, 1],
        ['RETURN', -1, 3],
        ['DELIVERY', 4, 4],
      ]);
      const pdf = await as(d).get(`/clients/${c.id}/packaging/pdf`).expect(200);
      expect(pdf.headers['content-type']).toContain('application/pdf');
    });

    it('lets only managers adjust, warns on a negative count, and refuses a ledger update', async () => {
      const c = await client();
      const res = await as(seller)
        .post('/packaging-movements', {
          clientId: c.id,
          packagingTypeId: casier.id,
          type: 'ADJUST',
          qty: 5,
          note: 'x',
        })
        .expect(403);
      expect(errorOf(res).code).toBe(ErrorCode.FORBIDDEN);
      const neg = (
        await as(seller)
          .post('/packaging-movements', {
            clientId: c.id,
            packagingTypeId: casier.id,
            type: 'RETURN',
            qty: 1,
          })
          .expect(201)
      ).body as PackagingMovementResultDto;
      expect(neg).toMatchObject({ balance: -1, negative: true });
      await expect(
        tamper(t)`UPDATE client_packaging_entries SET qty = 5 WHERE "clientId" = ${c.id}::uuid`,
      ).rejects.toThrow(/append-only/);
    });

    it('keeps the count right when two sales to the same client run at once', async () => {
      const p = await withCasier();
      const c = await client();
      const results = await Promise.all(
        [1, 2, 3].map(() =>
          quick(d, { clientId: c.id, lines: [{ productId: p.id, unitId: p.carton, qty: '2' }] }),
        ),
      );
      expect(results.map((r) => r.status)).toEqual([201, 201, 201]);
      expect(await countOf(c.id, casier.id)).toBe(6);
      const mismatches = await tenantRows(
        RECONCILE_CHECKS.filter((ch) => ch.name.startsWith('packaging_')),
      );
      expect(mismatches).toEqual([]);
    });

    it('imports opening counts once', async () => {
      const c = await client();
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Feuil1');
      ws.addRow(['Code client', 'Emballage', 'Quantité']);
      ws.addRow([c.code, casier.name, 12]);
      const file = Buffer.from(await wb.xlsx.writeBuffer());
      const preview = async () =>
        (
          await t
            .http()
            .post('/imports/PACKAGING_OPENING/preview')
            .set(...bearer(d.auth.accessToken))
            .attach('file', file, 'emballages.xlsx')
            .expect(200)
        ).body as ImportPreviewDto;
      const first = await preview();
      expect(first.counts.errors).toBe(0);
      await t
        .http()
        .post(`/imports/${first.jobId}/confirm`)
        .set(...bearer(d.auth.accessToken))
        .set('Idempotency-Key', randomUUID())
        .expect(200);
      expect(await countOf(c.id, casier.id)).toBe(12);
      const second = await preview();
      expect(second.counts.errors).toBe(1);
      expect(JSON.stringify(second.rows)).toContain('opening_already_set');
    });

    const tenantRows = async (checks: typeof RECONCILE_CHECKS) => {
      const out: unknown[] = [];
      for (const ch of checks) {
        const rows = await tenantContext.runAsSystem(() =>
          t.prisma.db.$queryRawUnsafe<{ tenantId: string }[]>(ch.sql),
        );
        out.push(...rows.filter((r) => r.tenantId === d.tenantId));
      }
      return out;
    };
  });

  // ---------------------------------------------------------------- sell-out

  it('reports the sell-out by brand with free units and returns apart, with fixed columns', async () => {
    const brand = (
      await as(d)
        .post('/brands', { name: `SellOut ${++seq}` }, null)
        .expect(201)
    ).body as { id: string };
    const p = await product(d, brand.id);
    await tenPlusOne(p);
    const c = await client();
    const sale = (
      (
        await quick(d, {
          clientId: c.id,
          lines: [{ productId: p.id, unitId: p.carton, qty: '20' }],
        }).expect(201)
      ).body as SaleResultDto
    ).sale;
    await as(d)
      .post(`/sales/${sale.id}/returns`, {
        disposition: 'RESTOCK',
        reason: 'retour',
        lines: [{ saleLineId: sale.lines[0]!.id, qty: '5' }],
      })
      .expect(201);
    const q = `from=${today()}&to=${today()}&brandId=${brand.id}`;
    const report = (await as(d).get(`/reports/sell-out?${q}`).expect(200)).body as SellOutDto;
    expect(report.rows).toHaveLength(1);
    // 20 cartons = 480 pièces sold, 2 free = 48, 5 back = 120; the 5 bring 0.5 → 1 free back.
    expect(report.rows[0]).toMatchObject({
      brandId: brand.id,
      qtySold: '480.000',
      qtyFree: '24.000',
      qtyReturned: '120.000',
      qtyNet: '360.000',
      salesHt: '48000.00',
      returnsHt: '12000.00',
      netHt: '36000.00',
      freeValueHt: '2400.00',
    });
    const xlsx = await as(d)
      .get(`/reports/sell-out/export.xlsx?${q}`)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (ch: Buffer) => chunks.push(ch));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      })
      .expect(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(xlsx.body as ExcelJS.Buffer);
    const header = (wb.worksheets[0]!.getRow(1).values as unknown[]).slice(1);
    expect(header).toEqual(SELL_OUT_COLUMNS.map((col) => col.title));
    // A seller does not get the brand report.
    await as(seller).get(`/reports/sell-out?${q}`).expect(403);
  });

  // ---------------------------------------------------------------- flags and tenants

  it('refuses promotions and packaging writes without the module, and prices plainly', async () => {
    const res = await as(essentiel)
      .post(
        '/promotions',
        {
          name: 'x',
          type: 'PERCENT_DISCOUNT',
          validFrom: today(),
          validTo: today(),
          target: 'PRODUCTS',
          productIds: [randomUUID()],
          discountPct: '5',
        },
        null,
      )
      .expect(403);
    expect(errorOf(res).code).toBe(ErrorCode.FEATURE_NOT_IN_PLAN);
    await as(essentiel).post('/packaging-types', { name: 'Casier' }, null).expect(403);
    const p = await product(essentiel);
    const priced = (
      await as(essentiel)
        .post(
          '/pricing/preview',
          { lines: [{ productId: p.id, unitId: p.carton, qty: '20' }] },
          null,
        )
        .expect(200)
    ).body as PricingPreviewDto;
    expect(priced.lines).toHaveLength(1);
    const withPackaging = await quick(essentiel, {
      lines: [{ productId: p.id, unitId: p.carton, qty: '1' }],
      paidAmount: '2856',
      packagingReturned: [{ packagingTypeId: randomUUID(), qty: 1 }],
    }).expect(403);
    expect(errorOf(withPackaging).code).toBe(ErrorCode.FEATURE_NOT_IN_PLAN);
  });

  it("keeps each tenant's promotions and packaging to itself", async () => {
    const p = await product();
    const promo = await tenPlusOne(p);
    const c = await client();
    await as(other).get(`/promotions/${promo.id}`).expect(404);
    await as(other).get(`/clients/${c.id}/packaging`).expect(404);
    const theirs = (await as(other).get('/promotions?status=active').expect(200))
      .body as PromotionDto[];
    expect(theirs.map((x) => x.id)).not.toContain(promo.id);
    // Their sale of our product id is refused, never priced with our promotion.
    const res = await quick(other, { lines: [{ productId: p.id, unitId: p.carton, qty: '10' }] });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});
