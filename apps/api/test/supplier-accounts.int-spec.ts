import { randomUUID } from 'node:crypto';
import * as argon2 from 'argon2';
import ExcelJS from 'exceljs';
import {
  type ApiError,
  type AuthResponse,
  ErrorCode,
  type ImportPreviewDto,
  type PurchaseDto,
  type SupplierBalancesDto,
  type SupplierDto,
  type SupplierLedgerPage,
  type SupplierPage,
  type SupplierPaymentDto,
  type SupplierStatementDto,
} from '@erp/shared';
import { SupplierBackfillService } from '../src/purchases/supplier-backfill.service';
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
  uniqueEmail,
} from './helpers';

const TODAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Algiers' }).format(new Date());

/** Dettes fournisseurs and règlements (phase 21). */
describe('supplier accounts', () => {
  let t: TestApp;
  let a: RegisteredTenant;
  let b: RegisteredTenant;
  let catA: TenantCatalog;
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
    patch: (url: string, body: object) =>
      t
        .http()
        .patch(url)
        .set(...bearer(who.auth.accessToken))
        .send(body),
  });

  const supplier = async (who: RegisteredTenant = a, extra: object = {}) =>
    (
      await as(who)
        .post(
          '/suppliers',
          { name: `Fournisseur ${++seq}`, phone: '0550 00 00 00', ...extra },
          null,
        )
        .expect(201)
    ).body as SupplierDto;
  const balance = async (id: string, who: RegisteredTenant = a) =>
    ((await as(who).get(`/suppliers/${id}`).expect(200)).body as SupplierDto).balance;
  const ledger = async (id: string, query = '') =>
    (await as(a).get(`/suppliers/${id}/ledger${query}`).expect(200)).body as SupplierLedgerPage;

  /** A validated BR of `cartons` cartons at 1 000 HT (+19 % = 1 190 TTC each). */
  const receive = async (supplierId: string, cartons: string, paidAmount = '0') => {
    const p = await createProduct(t, a, catA);
    const draft = (
      await as(a)
        .post('/purchases', {
          supplierId,
          documentDate: TODAY,
          paidAmount,
          lines: [{ productId: p.id, unitId: p.cartonUnitId, qty: cartons, unitCost: '1000' }],
        })
        .expect(201)
    ).body as PurchaseDto;
    return (await as(a).post(`/purchases/${draft.id}/validate`).expect(200)).body as PurchaseDto;
  };
  const pay = (body: object, key: string | null = randomUUID(), who: RegisteredTenant = a) =>
    as(who).post('/supplier-payments', body, key);

  const loginAs = async (who: RegisteredTenant, role: 'SELLER' | 'MANAGER') => {
    const email = uniqueEmail(role.toLowerCase());
    await asTenant(who.tenantId, async () =>
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
    return { ...who, auth: login.body as AuthResponse & { refreshToken: string } };
  };

  const supplierMismatches = async (supplierId: string) =>
    (await t.app.get(ReconcileService).run()).mismatches.filter((m) => m.entityId === supplierId);

  beforeAll(async () => {
    t = await createTestApp();
    a = await registerTenant(t, 'Fournisseurs A');
    b = await registerTenant(t, 'Fournisseurs B');
    catA = await catalogOf(t, a);
  });
  afterAll(() => t.close());

  it('a validated BR puts its TTC on the account, minus what was paid at reception', async () => {
    const s = await supplier();
    expect(s.balance).toBe('0.00');
    const br = await receive(s.id, '10', '4000');
    expect(br.totalTtc).toBe('11900.00');
    expect(await balance(s.id)).toBe('7900.00');

    const page = await ledger(s.id);
    expect(page.balance).toBe('7900.00');
    // Newest first, each with the balance right after it.
    expect(page.items.map((e) => [e.type, e.amount, e.runningBalance, e.label])).toEqual([
      ['PAYMENT', '-4000.00', '7900.00', br.number],
      ['PURCHASE', '11900.00', '11900.00', br.number],
    ]);
    expect(page.items[0]?.refType).toBe('Purchase');
  });

  it('a retour fournisseur lowers the debt and a cancel takes back exactly what is left', async () => {
    const s = await supplier();
    const br = await receive(s.id, '10');
    const line = br.lines[0]!;
    await as(a)
      .post(`/purchases/${br.id}/returns`, { lines: [{ purchaseLineId: line.id, qty: '2' }] })
      .expect(201);
    expect(await balance(s.id)).toBe('9520.00'); // 11 900 − 2 × 1 190

    await as(a).post(`/purchases/${br.id}/cancel`).expect(200);
    expect(await balance(s.id)).toBe('0.00');
    const page = await ledger(s.id);
    expect(page.items[0]).toMatchObject({ type: 'REVERSAL', amount: '-9520.00' });
    expect(await supplierMismatches(s.id)).toEqual([]);
  });

  it('a règlement is numbered RGF, lowers the debt, and its cancel brings it back', async () => {
    const s = await supplier();
    await receive(s.id, '5'); // 5 950
    const res = await pay({
      supplierId: s.id,
      amount: '2 000,00',
      mode: 'CHEQUE',
      reference: 'CHQ-889',
      bank: 'BNA',
      dueDate: TODAY,
    }).expect(201);
    const p = res.body as SupplierPaymentDto;
    expect(p).toMatchObject({
      amount: '2000.00',
      mode: 'CHEQUE',
      status: 'VALID',
      dueDate: TODAY,
      supplier: { id: s.id },
    });
    expect(p.number).toMatch(/^RGF-\d{4}-\d{6}$/);
    expect(await balance(s.id)).toBe('3950.00');

    const cancelled = (
      await as(a)
        .post(`/supplier-payments/${p.id}/cancel`, { reason: 'Chèque non remis' })
        .expect(200)
    ).body as SupplierPaymentDto;
    expect(cancelled).toMatchObject({ status: 'CANCELLED', cancelReason: 'Chèque non remis' });
    expect(await balance(s.id)).toBe('5950.00');
    expect((await ledger(s.id)).items[0]).toMatchObject({
      type: 'REVERSAL',
      amount: '2000.00',
      reason: 'Chèque non remis',
    });

    const again = await as(a)
      .post(`/supplier-payments/${p.id}/cancel`, { reason: 'Encore une fois' })
      .expect(409);
    expect((again.body as ApiError).code).toBe(ErrorCode.SUPPLIER_PAYMENT_NOT_VALID);

    const list = (await as(a).get(`/supplier-payments?supplierId=${s.id}`).expect(200)).body as {
      items: SupplierPaymentDto[];
    };
    expect(list.items.map((x) => x.id)).toEqual([p.id]);
  });

  it('replaying a règlement returns the same payment and posts nothing new', async () => {
    const s = await supplier();
    const key = randomUUID();
    const body = { supplierId: s.id, amount: '1500' };
    const first = await pay(body, key).expect(201);
    const replay = await pay(body, key).expect(201);
    expect(replay.body).toEqual(first.body);
    expect(await balance(s.id)).toBe('-1500.00');
    const entries = await asTenant(a.tenantId, () =>
      t.prisma.db.supplierLedgerEntry.count({ where: { supplierId: s.id } }),
    );
    expect(entries).toBe(1);
    await pay({ ...body, amount: '1600' }, key).expect(409);
  });

  it('concurrent règlements on one supplier all count', async () => {
    const s = await supplier();
    await receive(s.id, '10'); // 11 900
    const results = await Promise.all(
      Array.from({ length: 6 }, () => pay({ supplierId: s.id, amount: '1000' })),
    );
    expect(results.map((r) => r.status)).toEqual([201, 201, 201, 201, 201, 201]);
    expect(await balance(s.id)).toBe('5900.00');
    const numbers = new Set(results.map((r) => (r.body as SupplierPaymentDto).number));
    expect(numbers.size).toBe(6);
    expect(await supplierMismatches(s.id)).toEqual([]);
  });

  it('lists balances and prints the relevé fournisseur of a period', async () => {
    const s = await supplier();
    await receive(s.id, '2'); // 2 380
    await pay({ supplierId: s.id, amount: '380' }).expect(201);

    const balances = (await as(a).get('/suppliers/balances').expect(200))
      .body as SupplierBalancesDto;
    expect(balances.items.find((i) => i.supplier.id === s.id)?.balance).toBe('2000.00');

    const st = (
      await as(a).get(`/suppliers/${s.id}/statement?from=${TODAY}&to=${TODAY}`).expect(200)
    ).body as SupplierStatementDto;
    expect(st).toMatchObject({
      openingBalance: '0.00',
      totalDebit: '2380.00',
      totalCredit: '380.00',
      closingBalance: '2000.00',
    });
    expect(st.entries.at(-1)?.runningBalance).toBe('2000.00');
  });

  it('paginates the ledger with a cursor', async () => {
    const s = await supplier();
    for (let i = 0; i < 5; i++) await pay({ supplierId: s.id, amount: '10' }).expect(201);
    const first = await ledger(s.id, '?limit=2');
    expect(first.items).toHaveLength(2);
    expect(first.items[0]?.runningBalance).toBe('-50.00');
    const second = await ledger(s.id, `?limit=2&cursor=${first.nextCursor}`);
    expect(second.items.map((e) => e.runningBalance)).toEqual(['-30.00', '-20.00']);
    const third = await ledger(s.id, `?limit=2&cursor=${second.nextCursor}`);
    expect(third.items.map((e) => e.runningBalance)).toEqual(['-10.00']);
    expect(third.nextCursor).toBeNull();
  });

  it('keeps supplier codes unique and a PATCH changes only what it sends', async () => {
    const s = await supplier(a, { code: `F-${Date.now()}`, address: 'Rouiba', nif: '0001' });
    const dup = await as(a).post('/suppliers', { name: 'Autre', code: s.code }, null).expect(409);
    expect((dup.body as ApiError).code).toBe(ErrorCode.SUPPLIER_CODE_TAKEN);
    const patched = (await as(a).patch(`/suppliers/${s.id}`, { name: 'Nouveau nom' }).expect(200))
      .body as SupplierDto;
    expect(patched).toMatchObject({
      name: 'Nouveau nom',
      code: s.code,
      address: 'Rouiba',
      nif: '0001',
    });
  });

  it('the backfill posts the BRs made before supplier accounts, and running it twice changes nothing', async () => {
    const s = await supplier();
    const purchaseId = randomUUID();
    const returnId = randomUUID();
    // A BR and a retour validated before phase 21: no ledger entries.
    const sql = tamper(t);
    await sql`
      INSERT INTO purchases (id, "tenantId", number, "supplierId", status, "documentDate",
        "totalHt", "totalTva", "totalTtc", "paidAmount", "validatedAt", "createdAt", "updatedAt")
      VALUES (${purchaseId}::uuid, ${a.tenantId}::uuid, ${`BR-OLD-${seq}`}, ${s.id}::uuid, 'VALIDATED',
        '2026-03-01', 10000, 1900, 11900, 2000, '2026-03-01T09:00:00Z', '2026-03-01T09:00:00Z', now())`;
    await sql`
      INSERT INTO purchase_returns (id, "tenantId", number, "purchaseId", "supplierId",
        "totalHt", "totalTva", "totalTtc", "createdAt")
      VALUES (${returnId}::uuid, ${a.tenantId}::uuid, ${`RF-OLD-${seq}`}, ${purchaseId}::uuid,
        ${s.id}::uuid, 1000, 190, 1190, '2026-03-05T09:00:00Z')`;
    expect(await balance(s.id)).toBe('0.00');

    const backfill = t.app.get(SupplierBackfillService);
    const first = await backfill.run();
    expect(first.purchases).toBeGreaterThanOrEqual(1);
    expect(await balance(s.id)).toBe('8710.00'); // 11 900 − 2 000 − 1 190
    const entries = () =>
      asTenant(a.tenantId, () =>
        t.prisma.db.supplierLedgerEntry.findMany({
          where: { supplierId: s.id },
          orderBy: { seq: 'asc' },
          select: { type: true, amount: true, createdAt: true },
        }),
      );
    const after = await entries();
    expect(after.map((e) => [e.type, e.amount.toString()])).toEqual([
      ['PURCHASE', '11900'],
      ['PAYMENT', '-2000'],
      ['RETURN', '-1190'],
    ]);
    expect(after[0]?.createdAt.toISOString()).toBe('2026-03-01T09:00:00.000Z');

    await backfill.run();
    expect(await balance(s.id)).toBe('8710.00');
    expect(await entries()).toHaveLength(3);
    expect(await supplierMismatches(s.id)).toEqual([]);
  });

  it('reconcile reports a cached supplier balance that no longer equals its ledger', async () => {
    const s = await supplier();
    await pay({ supplierId: s.id, amount: '100' }).expect(201);
    await tamper(t)`UPDATE supplier_balances SET balance = 42 WHERE "supplierId" = ${s.id}::uuid`;
    const found = await supplierMismatches(s.id);
    expect(found).toEqual([
      expect.objectContaining({
        check: 'supplier_balance_equals_ledger',
        entity: 'Supplier',
        cached: '42.00',
        ledger: '-100.00',
      }),
    ]);
    await tamper(t)`UPDATE supplier_balances SET balance = -100 WHERE "supplierId" = ${s.id}::uuid`;
  });

  it('imports "Fournisseurs et soldes" and refuses a second solde initial', async () => {
    const code = `IMP-${Date.now()}`;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Feuil1');
    ws.addRow(['Code', 'Nom', 'Téléphone', 'Solde initial']);
    ws.addRow([code, 'Atlas Distribution', '0770 11 22 33', '320 000,00']);
    const file = Buffer.from(await wb.xlsx.writeBuffer());
    const preview = (buf: Buffer) =>
      t
        .http()
        .post('/imports/SUPPLIERS/preview')
        .set(...bearer(a.auth.accessToken))
        .attach('file', buf, 'fournisseurs.xlsx');

    const p1 = (await preview(file).expect(200)).body as ImportPreviewDto;
    expect(p1.counts).toMatchObject({ errors: 0 });
    await t
      .http()
      .post(`/imports/${p1.jobId}/confirm`)
      .set(...bearer(a.auth.accessToken))
      .set('Idempotency-Key', randomUUID())
      .expect(200);
    const page = (await as(a).get(`/suppliers?search=${code}`).expect(200)).body as SupplierPage;
    expect(page.items[0]).toMatchObject({ code, balance: '320000.00', hasOpening: true });

    const p2 = (await preview(file).expect(200)).body as ImportPreviewDto;
    expect(p2.rows[0]?.errors).toEqual([
      expect.objectContaining({ field: 'openingBalance', code: 'opening_already_set' }),
    ]);
  });

  it('keeps supplier accounts to managers and to their tenant', async () => {
    const s = await supplier();
    const p = (await pay({ supplierId: s.id, amount: '50' }).expect(201))
      .body as SupplierPaymentDto;

    await as(b).get(`/suppliers/${s.id}/ledger`).expect(404);
    await as(b).get(`/supplier-payments/${p.id}`).expect(404);
    await as(b).post(`/supplier-payments/${p.id}/cancel`, { reason: 'Pas à moi' }).expect(404);
    const foreign = await pay({ supplierId: s.id, amount: '10' }, randomUUID(), b).expect(400);
    expect((foreign.body as ApiError).code).toBe(ErrorCode.VALIDATION_FAILED);
    const balancesB = (await as(b).get('/suppliers/balances').expect(200))
      .body as SupplierBalancesDto;
    expect(balancesB.items.some((i) => i.supplier.id === s.id)).toBe(false);

    const seller = await loginAs(a, 'SELLER');
    await pay({ supplierId: s.id, amount: '10' }, randomUUID(), seller).expect(403);
    await as(seller).get(`/suppliers/${s.id}/ledger`).expect(403);
    expect(await balance(s.id)).toBe('-50.00');
  });
});
