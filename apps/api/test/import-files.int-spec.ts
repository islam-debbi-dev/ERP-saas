import { randomUUID } from 'node:crypto';
import {
  Activity,
  type ApiError,
  ErrorCode,
  type ImportFileDto,
  type LandedCostPreviewDto,
  type PurchaseDto,
  type ReconcileReport,
  type ReportDto,
  type StockLevelDto,
  type SupplierDto,
  type SupplierLedgerPage,
  type SupplierPaymentDto,
  type SupplierStatementDto,
} from '@erp/shared';
import { ReconcileService } from '../src/reconcile/reconcile.service';
import {
  asTenant,
  bearer,
  catalogOf,
  createProduct,
  createTestApp,
  registerTenant,
  type RegisteredTenant,
  tamper,
  type TenantCatalog,
  type TestApp,
} from './helpers';

const errorOf = (res: { body: unknown }) => res.body as ApiError;
type Item = { id: string; baseUnitId: string; cartonUnitId: string };

/**
 * Phase 22: dossiers d'importation. A BR in a dossier is on the supplier account from its
 * validation but enters the stock only when the dossier closes, at the coût de revient;
 * late costs move the CUMP for what is still on hand and leave the rest as an écart.
 */
describe('import files and landed cost (phase 22)', () => {
  let t: TestApp;
  let imp: RegisteredTenant;
  let other: RegisteredTenant;
  let ess: RegisteredTenant;
  let cat: TenantCatalog;

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

  const level = async (who: RegisteredTenant, productId: string) =>
    (await as(who).get(`/stock/${productId}`).expect(200)).body as StockLevelDto;
  const supplierOf = async (who: RegisteredTenant, id: string) =>
    (await as(who).get(`/suppliers/${id}`).expect(200)).body as SupplierDto;
  const movementCount = (who: RegisteredTenant, productId: string) =>
    asTenant(who.tenantId, () => t.prisma.db.stockMovement.count({ where: { productId } }));

  async function supplier(
    who: RegisteredTenant,
    currency = 'DZD',
    name = 'Supplier',
  ): Promise<SupplierDto> {
    return (await as(who).post('/suppliers', { name, currency }, null).expect(201))
      .body as SupplierDto;
  }

  async function newFile(who: RegisteredTenant, reference = 'BL-MSKU-1'): Promise<ImportFileDto> {
    return (
      await as(who).post('/import-files', { reference, containerNo: 'MSKU1234567' }).expect(201)
    ).body as ImportFileDto;
  }

  async function brInTransit(
    who: RegisteredTenant,
    supplierId: string,
    importFileId: string,
    lines: { productId: string; unitId: string; qty: string; unitCost: string }[],
    exchangeRate?: string,
  ): Promise<PurchaseDto> {
    const draft = (
      await as(who)
        .post('/purchases', {
          supplierId,
          documentDate: '2026-10-20',
          lines,
          importFileId,
          ...(exchangeRate ? { exchangeRate } : {}),
        })
        .expect(201)
    ).body as PurchaseDto;
    return (await as(who).post(`/purchases/${draft.id}/validate`, {}).expect(200))
      .body as PurchaseDto;
  }

  const product = (who: RegisteredTenant, catalog: TenantCatalog, opts = {}) =>
    createProduct(t, who, catalog, opts) as Promise<Item>;

  beforeAll(async () => {
    t = await createTestApp();
    imp = await registerTenant(t, 'Importateur Chine', { activity: Activity.IMPORTATEUR });
    other = await registerTenant(t, 'Autre Importateur', { activity: Activity.IMPORTATEUR });
    ess = await registerTenant(t, 'Grossiste Simple');
    cat = await catalogOf(t, imp);
  });

  afterAll(async () => {
    await t.close();
  });

  describe('a USD container (assujetti TVA)', () => {
    let usd: SupplierDto;
    let transitaire: SupplierDto;
    let file: ImportFileDto;
    let br: PurchaseDto;
    let p1: Item;
    let p2: Item;
    let closeKey: string;
    let closed: ImportFileDto;

    beforeAll(async () => {
      usd = await supplier(imp, 'USD', 'Yiwu Trading');
      transitaire = await supplier(imp, 'DZD', 'Transit Port Alger');
      p1 = await product(imp, cat);
      p2 = await product(imp, cat);
      file = await newFile(imp);
    });

    it('numbers the dossier DI-YYYY-000001 and opens it', () => {
      expect(file.number).toMatch(/^DI-\d{4}-000001$/);
      expect(file.status).toBe('OPEN');
    });

    it('a foreign supplier is paid by règlement, not at reception', async () => {
      const res = await as(imp)
        .post('/purchases', {
          supplierId: usd.id,
          documentDate: '2026-10-20',
          exchangeRate: '135',
          paidAmount: '10',
          lines: [{ productId: p1.id, unitId: p1.baseUnitId, qty: '1', unitCost: '10' }],
        })
        .expect(422);
      expect(errorOf(res).code).toBe(ErrorCode.CURRENCY_MISMATCH);
    });

    it('a foreign BR needs the bank rate', async () => {
      const res = await as(imp)
        .post('/purchases', {
          supplierId: usd.id,
          documentDate: '2026-10-20',
          lines: [{ productId: p1.id, unitId: p1.baseUnitId, qty: '1', unitCost: '10' }],
        })
        .expect(400);
      expect(errorOf(res).details).toMatchObject({ field: 'exchangeRate' });
    });

    it('validating a BR of the dossier puts it in transit: supplier owed, no stock', async () => {
      // 100 pièces at 10 USD + 10 cartons (24) at 120 USD = 2 200 USD at 135 = 297 000 DA.
      br = await brInTransit(
        imp,
        usd.id,
        file.id,
        [
          { productId: p1.id, unitId: p1.baseUnitId, qty: '100', unitCost: '10' },
          { productId: p2.id, unitId: p2.cartonUnitId, qty: '10', unitCost: '120' },
        ],
        '135',
      );
      expect(br.status).toBe('IN_TRANSIT');
      expect(br.currency).toBe('USD');
      expect(br.totalCurrency).toBe('2200.00');
      expect(br.totalTtc).toBe('297000.00');
      expect(br.totalTva).toBe('0.00');
      expect(br.lines.map((l) => [l.unitCostCurrency, l.unitCost])).toEqual([
        ['10.0000', '1350.0000'],
        ['120.0000', '16200.0000'],
      ]);
      expect((await level(imp, p1.id)).qtyBase).toBe('0.000');
      const s = await supplierOf(imp, usd.id);
      expect([s.balance, s.balanceCurrency]).toEqual(['297000.00', '2200.00']);
    });

    it('a BR in transit cannot be returned', async () => {
      const res = await as(imp)
        .post(`/purchases/${br.id}/returns`, {
          lines: [{ purchaseLineId: br.lines[0]!.id, qty: '1' }],
        })
        .expect(409);
      expect(errorOf(res).code).toBe(ErrorCode.PURCHASE_NOT_VALIDATED);
    });

    it('costs: a supplier cost posts its account now; preview writes nothing', async () => {
      // Fret 1 100 USD at 135 = 148 500 DA by value; douane 30 000 DA by quantity;
      // transitaire 23 800 TTC (3 800 TVA, recoverable) by value; import VAT not a cost.
      await as(imp)
        .post(`/import-files/${file.id}/costs`, {
          type: 'FRET',
          currency: 'USD',
          amount: '1100',
          exchangeRate: '135',
          method: 'VALUE',
        })
        .expect(201);
      await as(imp)
        .post(`/import-files/${file.id}/costs`, {
          type: 'DOUANE',
          amount: '30000',
          method: 'QUANTITY',
        })
        .expect(201);
      await as(imp)
        .post(`/import-files/${file.id}/costs`, {
          type: 'TRANSITAIRE',
          supplierId: transitaire.id,
          amount: '23800',
          tvaAmount: '3800',
          method: 'VALUE',
        })
        .expect(201);
      await as(imp)
        .post(`/import-files/${file.id}/costs`, { type: 'TVA_IMPORT', amount: '56430' })
        .expect(201);
      expect((await supplierOf(imp, transitaire.id)).balance).toBe('23800.00');

      const preview = (await as(imp).get(`/import-files/${file.id}/preview`).expect(200))
        .body as LandedCostPreviewDto;
      expect(preview.problems).toEqual([]);
      expect(preview.totalGoods).toBe('297000.00');
      expect(preview.totalCosts).toBe('198500.00');
      expect(preview.lines.map((l) => l.landedUnitCost)).toEqual(['2204.1444', '1146.1898']);
      expect((await level(imp, p1.id)).qtyBase).toBe('0.000');
    });

    it('a cost in another currency than its supplier is refused', async () => {
      const res = await as(imp)
        .post(`/import-files/${file.id}/costs`, {
          type: 'TRANSPORT',
          supplierId: transitaire.id,
          currency: 'USD',
          amount: '10',
          exchangeRate: '135',
        })
        .expect(422);
      expect(errorOf(res).code).toBe(ErrorCode.CURRENCY_MISMATCH);
    });

    it('closing posts the stock at the coût de revient, exactly once', async () => {
      closeKey = randomUUID();
      closed = (await as(imp).post(`/import-files/${file.id}/close`, {}, closeKey).expect(200))
        .body as ImportFileDto;
      expect(closed.status).toBe('CLOSED');
      expect(closed.totalCosts).toBe('198500.00');
      const l1 = await level(imp, p1.id);
      const l2 = await level(imp, p2.id);
      expect([l1.qtyBase, l1.avgCost]).toEqual(['100.000', '2204.1444']);
      expect([l2.qtyBase, l2.avgCost]).toEqual(['240.000', '1146.1898']);
      const brAfter = (await as(imp).get(`/purchases/${br.id}`).expect(200)).body as PurchaseDto;
      expect(brAfter.status).toBe('VALIDATED');
      expect(brAfter.lines.map((l) => l.landedUnitCostBase)).toEqual(['2204.1444', '1146.1898']);
    });

    it('a replay returns the same answer and moves nothing; a new close is refused', async () => {
      const before = await movementCount(imp, p1.id);
      expect(before).toBeGreaterThan(0);
      const replay = await as(imp).post(`/import-files/${file.id}/close`, {}, closeKey).expect(200);
      expect(replay.body).toEqual(closed);
      expect(await movementCount(imp, p1.id)).toBe(before);
      const again = await as(imp).post(`/import-files/${file.id}/close`).expect(409);
      expect(errorOf(again).code).toBe(ErrorCode.IMPORT_FILE_NOT_OPEN);
    });

    it('a BR of a closed dossier is corrected by a return, not cancelled', async () => {
      const res = await as(imp).post(`/purchases/${br.id}/cancel`).expect(409);
      expect(errorOf(res).code).toBe(ErrorCode.PURCHASE_IN_IMPORT_FILE);
    });

    it('a late cost goes to the CUMP for the units on hand, the rest is an écart', async () => {
      // 60 of the 100 pièces are gone: 1 000 DA on p1 → 400 into the CUMP, 600 écart.
      await as(imp)
        .post('/stock/adjustments', {
          reason: 'PERTE',
          lines: [{ productId: p1.id, unitId: p1.baseUnitId, qty: '-60' }],
        })
        .expect(201);
      const key = randomUUID();
      const body = {
        type: 'TRANSITAIRE',
        supplierId: transitaire.id,
        amount: '1000',
        method: 'MANUAL',
        manualSplit: { [br.lines[0]!.id]: '1000' },
      };
      const res = await as(imp).post(`/import-files/${file.id}/late-cost`, body, key).expect(201);
      await as(imp).post(`/import-files/${file.id}/late-cost`, body, key).expect(201);
      expect((res.body as ImportFileDto).costs.filter((c) => c.isLate)).toHaveLength(1);
      expect((await level(imp, p1.id)).avgCost).toBe('2214.1444');
      expect((await supplierOf(imp, transitaire.id)).balance).toBe('24800.00');
      const rows = await asTenant(
        imp.tenantId,
        () =>
          t.prisma.db.$queryRaw<{ amount: string; stock: string; ecart: string }[]>`
          SELECT SUM(a.amount)::text AS amount, SUM(a."stockValue")::text AS stock,
                 SUM(a.ecart)::text AS ecart
          FROM import_cost_allocations a JOIN import_costs c ON c.id = a."importCostId"
          WHERE c."importFileId" = ${file.id}::uuid AND c."isLate"`,
      );
      expect(rows[0]).toEqual({ amount: '1000.00', stock: '400.00', ecart: '600.00' });
    });

    it('a late cost with no stock left is all écart; the CUMP does not move', async () => {
      await as(imp)
        .post('/stock/adjustments', {
          reason: 'PERTE',
          lines: [{ productId: p2.id, unitId: p2.baseUnitId, qty: '-240' }],
        })
        .expect(201);
      const before = await movementCount(imp, p2.id);
      expect(before).toBeGreaterThan(0);
      await as(imp)
        .post(`/import-files/${file.id}/late-cost`, {
          type: 'MAGASINAGE',
          amount: '500',
          method: 'MANUAL',
          manualSplit: { [br.lines[1]!.id]: '500' },
        })
        .expect(201);
      expect((await level(imp, p2.id)).avgCost).toBe('1146.1898');
      expect(await movementCount(imp, p2.id)).toBe(before);
    });

    it('the margin report shows the écart de coût and takes it off the margin', async () => {
      const day = (offset: number) =>
        new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
      const range = `from=${day(-2)}&to=${day(2)}&groupBy=product`;
      const report = (await as(imp).get(`/reports/margin?${range}`).expect(200)).body as ReportDto;
      expect(report.columns.map((c) => c.key)).toContain('ecart');
      const row = (id: string) => report.rows.find((r) => r.key === id)?.values;
      expect(row(p1.id)).toMatchObject({ ecart: '600.00', margin: '-600.00' });
      expect(row(p2.id)).toMatchObject({ ecart: '500.00', margin: '-500.00' });
      const ess_ = (await as(ess).get(`/reports/margin?${range}`).expect(200)).body as ReportDto;
      expect(ess_.columns.map((c) => c.key)).not.toContain('ecart');
    });

    it('prints the fiche de coût de revient (A4 PDF)', async () => {
      const res = await as(imp).get(`/documents/DI/${file.id}/pdf`).expect(200);
      expect(res.headers['content-type']).toContain('application/pdf');
      expect(res.headers['content-disposition']).toContain(`${file.number}.pdf`);
    });

    it('the foreign supplier is paid in USD and the account keeps both currencies', async () => {
      const pay = (
        await as(imp)
          .post('/supplier-payments', { supplierId: usd.id, amount: '1000', exchangeRate: '140' })
          .expect(201)
      ).body as SupplierPaymentDto;
      expect([pay.amount, pay.amountCurrency, pay.currency]).toEqual([
        '140000.00',
        '1000.00',
        'USD',
      ]);
      let s = await supplierOf(imp, usd.id);
      expect([s.balance, s.balanceCurrency]).toEqual(['157000.00', '1200.00']);
      const ledger = (await as(imp).get(`/suppliers/${usd.id}/ledger`).expect(200))
        .body as SupplierLedgerPage;
      expect(ledger.items[0]).toMatchObject({
        amount: '-140000.00',
        amountCurrency: '-1000.00',
        runningBalance: '157000.00',
        runningBalanceCurrency: '1200.00',
      });
      const statement = (
        await as(imp)
          .get(`/suppliers/${usd.id}/statement?from=2026-01-01&to=2030-12-31`)
          .expect(200)
      ).body as SupplierStatementDto;
      expect([statement.closingBalance, statement.closingBalanceCurrency]).toEqual([
        '157000.00',
        '1200.00',
      ]);
      await as(imp)
        .post(`/supplier-payments/${pay.id}/cancel`, { reason: 'Erreur de saisie' })
        .expect(200);
      s = await supplierOf(imp, usd.id);
      expect([s.balance, s.balanceCurrency]).toEqual(['297000.00', '2200.00']);
    });

    it('a supplier with entries cannot change currency', async () => {
      const res = await as(imp).patch(`/suppliers/${usd.id}`, { currency: 'EUR' }).expect(409);
      expect(errorOf(res).code).toBe(ErrorCode.SUPPLIER_CURRENCY_LOCKED);
    });

    it('stock, ledgers and balances reconcile', async () => {
      const report = (await as(imp).get('/stock/reconcile').expect(200)).body as ReconcileReport;
      expect(report.differences).toEqual([]);
      const mismatches = (await t.app.get(ReconcileService).run()).mismatches.filter((m) =>
        [usd.id, transitaire.id].includes(m.entityId),
      );
      expect(mismatches).toEqual([]);
    });
  });

  it('cancelling a BR in transit gives back both balances and touches no stock', async () => {
    const eur = await supplier(imp, 'EUR', 'Hamburg GmbH');
    const p = await product(imp, cat);
    const file = await newFile(imp, 'EUR-1');
    const br = await brInTransit(
      imp,
      eur.id,
      file.id,
      [{ productId: p.id, unitId: p.baseUnitId, qty: '10', unitCost: '5.5' }],
      '150.25',
    );
    expect((await supplierOf(imp, eur.id)).balanceCurrency).toBe('55.00');
    const before = await movementCount(imp, p.id);
    await as(imp).post(`/purchases/${br.id}/cancel`).expect(200);
    const s = await supplierOf(imp, eur.id);
    expect([s.balance, s.balanceCurrency]).toEqual(['0.00', '0.00']);
    expect(await movementCount(imp, p.id)).toBe(before);
    // Nothing left in transit: closing is refused.
    const res = await as(imp).post(`/import-files/${file.id}/close`).expect(400);
    expect(errorOf(res).code).toBe(ErrorCode.IMPORT_FILE_EMPTY);
  });

  it('allocation by weight needs the weight of every product', async () => {
    const s = await supplier(imp, 'DZD', 'Local');
    const heavy = await product(imp, cat);
    const unknown = await product(imp, cat);
    await tamper(t)`UPDATE products SET "weightKg" = 2 WHERE id = ${heavy.id}::uuid`;
    const file = await newFile(imp, 'W-1');
    await brInTransit(imp, s.id, file.id, [
      { productId: heavy.id, unitId: heavy.baseUnitId, qty: '10', unitCost: '100' },
      { productId: unknown.id, unitId: unknown.baseUnitId, qty: '10', unitCost: '100' },
    ]);
    await as(imp)
      .post(`/import-files/${file.id}/costs`, { type: 'FRET', amount: '1000', method: 'WEIGHT' })
      .expect(201);
    const preview = (await as(imp).get(`/import-files/${file.id}/preview`).expect(200))
      .body as LandedCostPreviewDto;
    expect(preview.problems).toHaveLength(1);
    expect(preview.problems[0]?.code).toBe('ALLOCATION_BASIS_MISSING');
    expect(preview.problems[0]?.details['productIds']).toEqual([unknown.id]);
    const res = await as(imp).post(`/import-files/${file.id}/close`).expect(422);
    expect(errorOf(res).code).toBe(ErrorCode.ALLOCATION_BASIS_MISSING);
    expect((await level(imp, heavy.id)).qtyBase).toBe('0.000');
  });

  it('under IFU (non assujetti) the TVA of the BR and the import VAT are costs', async () => {
    const ifu = await registerTenant(t, 'Importateur IFU', { activity: Activity.IMPORTATEUR });
    await tamper(t)`UPDATE tenants SET "assujettiTva" = false WHERE id = ${ifu.tenantId}::uuid`;
    const c = await catalogOf(t, ifu);
    const s = (await as(ifu).post('/suppliers', { name: 'Local' }, null).expect(201))
      .body as SupplierDto;
    const p = await product(ifu, c);
    const file = await newFile(ifu, 'IFU-1');
    // 10 × 100 HT, TVA 19 % → 1 190 value; + import VAT 190 → 1 380 / 10.
    await brInTransit(ifu, s.id, file.id, [
      { productId: p.id, unitId: p.baseUnitId, qty: '10', unitCost: '100' },
    ]);
    await as(ifu)
      .post(`/import-files/${file.id}/costs`, { type: 'TVA_IMPORT', amount: '190' })
      .expect(201);
    await as(ifu).post(`/import-files/${file.id}/close`).expect(200);
    expect((await level(ifu, p.id)).avgCost).toBe('138.0000');
  });

  it('two dossiers closing at the same time on the same products keep the CUMP right', async () => {
    const s = await supplier(imp, 'DZD', 'Concurrent');
    const x = await product(imp, cat);
    const y = await product(imp, cat);
    const f1 = await newFile(imp, 'C-1');
    const f2 = await newFile(imp, 'C-2');
    await brInTransit(imp, s.id, f1.id, [
      { productId: x.id, unitId: x.baseUnitId, qty: '10', unitCost: '100' },
      { productId: y.id, unitId: y.baseUnitId, qty: '10', unitCost: '50' },
    ]);
    await brInTransit(imp, s.id, f2.id, [
      { productId: y.id, unitId: y.baseUnitId, qty: '30', unitCost: '70' },
      { productId: x.id, unitId: x.baseUnitId, qty: '30', unitCost: '140' },
    ]);
    const results = await Promise.all([
      as(imp).post(`/import-files/${f1.id}/close`),
      as(imp).post(`/import-files/${f2.id}/close`),
    ]);
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    // x: (10 × 100 + 30 × 140) / 40 = 130; y: (10 × 50 + 30 × 70) / 40 = 65, whatever the order.
    expect(await level(imp, x.id)).toMatchObject({ qtyBase: '40.000', avgCost: '130.0000' });
    expect(await level(imp, y.id)).toMatchObject({ qtyBase: '40.000', avgCost: '65.0000' });
  });

  it('a dossier of another tenant does not exist', async () => {
    const mine = await newFile(imp, 'ISO-1');
    const res = await as(other).get(`/import-files/${mine.id}`).expect(404);
    expect(errorOf(res).code).toBe(ErrorCode.NOT_FOUND);
    const s = (await as(other).post('/suppliers', { name: 'B' }, null).expect(201))
      .body as SupplierDto;
    const c = await catalogOf(t, other);
    const p = await product(other, c);
    await as(other)
      .post('/purchases', {
        supplierId: s.id,
        documentDate: '2026-10-20',
        importFileId: mine.id,
        lines: [{ productId: p.id, unitId: p.baseUnitId, qty: '1', unitCost: '1' }],
      })
      .expect(400);
    const list = (await as(other).get('/import-files').expect(200)).body as {
      items: { id: string }[];
    };
    expect(list.items.map((f) => f.id)).not.toContain(mine.id);
  });

  describe('module off (Essentiel)', () => {
    it('refuses dossiers and foreign currencies', async () => {
      expect(errorOf(await as(ess).get('/import-files').expect(403)).code).toBe(
        ErrorCode.FEATURE_NOT_IN_PLAN,
      );
      expect(
        errorOf(await as(ess).post('/suppliers', { name: 'X', currency: 'USD' }, null).expect(403))
          .code,
      ).toBe(ErrorCode.FEATURE_NOT_IN_PLAN);
    });

    it('a BR behaves as before: stock in at validation, at its cost', async () => {
      const c = await catalogOf(t, ess);
      const s = (await as(ess).post('/suppliers', { name: 'Local' }, null).expect(201))
        .body as SupplierDto;
      expect(s.currency).toBe('DZD');
      const p = await product(ess, c);
      const draft = (
        await as(ess)
          .post('/purchases', {
            supplierId: s.id,
            documentDate: '2026-10-20',
            lines: [{ productId: p.id, unitId: p.cartonUnitId, qty: '2', unitCost: '1200' }],
          })
          .expect(201)
      ).body as PurchaseDto;
      const done = (await as(ess).post(`/purchases/${draft.id}/validate`, {}).expect(200))
        .body as PurchaseDto;
      expect([done.status, done.currency, done.totalCurrency]).toEqual(['VALIDATED', 'DZD', null]);
      expect(await level(ess, p.id)).toMatchObject({ qtyBase: '48.000', avgCost: '50.0000' });
      expect((await supplierOf(ess, s.id)).balance).toBe('2856.00');
    });
  });
});
