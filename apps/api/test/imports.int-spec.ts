import { randomUUID } from 'node:crypto';
import ExcelJS from 'exceljs';
import {
  type ApiError,
  type ClientDto,
  ErrorCode,
  type ImportJobDto,
  type ImportJobPage,
  type ImportPreviewDto,
  type ProductDto,
  type StockLevelDto,
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
} from './helpers';

type Row = (string | number | null)[];

const errorOf = (res: { body: unknown }) => res.body as ApiError;

async function xlsx(rows: Row[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Feuil1');
  for (const r of rows) ws.addRow(r);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe('imports', () => {
  let t: TestApp;
  let a: RegisteredTenant;
  let b: RegisteredTenant;
  let catA: TenantCatalog;

  const token = (who: RegisteredTenant) => bearer(who.auth.accessToken);
  const get = (who: RegisteredTenant, url: string) =>
    t
      .http()
      .get(url)
      .set(...token(who));

  const preview = (
    who: RegisteredTenant,
    type: string,
    file: Buffer | null,
    opts: { name?: string; mapping?: object; jobId?: string } = {},
  ) => {
    const req = t
      .http()
      .post(`/imports/${type}/preview`)
      .set(...token(who));
    if (opts.mapping) void req.field('mapping', JSON.stringify(opts.mapping));
    if (opts.jobId) void req.field('jobId', opts.jobId);
    if (file) void req.attach('file', file, opts.name ?? 'import.xlsx');
    return req;
  };

  const confirm = (who: RegisteredTenant, jobId: string, key: string = randomUUID()) =>
    t
      .http()
      .post(`/imports/${jobId}/confirm`)
      .set(...token(who))
      .set('Idempotency-Key', key);

  const counts = (tenantId: string) =>
    asTenant(tenantId, async () => ({
      products: await t.prisma.db.product.count(),
      clients: await t.prisma.db.client.count(),
      ledger: await t.prisma.db.clientLedgerEntry.count(),
      movements: await t.prisma.db.stockMovement.count(),
    }));

  const clientByCode = async (who: RegisteredTenant, code: string) => {
    const page = (await get(who, `/clients?search=${encodeURIComponent(code)}`).expect(200))
      .body as { items: ClientDto[] };
    const client = page.items.find((c) => c.code === code);
    if (!client) throw new Error(`client ${code} not found`);
    return client;
  };

  beforeAll(async () => {
    t = await createTestApp();
    a = await registerTenant(t, 'Import A');
    b = await registerTenant(t, 'Import B');
    catA = await catalogOf(t, a);
  });
  afterAll(() => t.close());

  it('preview validates every row, maps French headers and writes no business data', async () => {
    const existing = await createProduct(t, a, catA);
    const file = await xlsx([
      ['Référence', 'Désignation', 'Catégorie', 'Unité', 'Colisage', 'Colis', 'Prix gros', 'TVA'],
      ['PV-1', 'Huile 1 L', 'Huiles', 'Pièce', 12, 'Carton', '1 234,50', 9],
      ['PV-2', '', null, 'Pièce', null, null, '12a', 19],
      ['PV-1', 'Doublon', null, 'Pièce', null, null, null, 19],
      ['PV-3', 'Sans unité connue', null, 'Bidon', null, null, null, 19],
      ['PV-4', 'Sans TVA', null, 'kg', null, null, '1.234,50', null],
    ]);
    const before = await counts(a.tenantId);
    const res = await preview(a, 'PRODUCTS', file).expect(200);
    const body = res.body as ImportPreviewDto;

    expect(body.mapping).toMatchObject({
      reference: 0,
      designation: 1,
      category: 2,
      baseUnit: 3,
      pack1Factor: 4,
      pack1Unit: 5,
      'price.1': 6,
      tvaRate: 7,
    });
    expect(body.counts).toMatchObject({ total: 5, valid: 2, errors: 3, creates: 2 });
    const [r1, r2, r3, r4, r5] = body.rows;
    expect(r1).toMatchObject({ rowNumber: 2, action: 'CREATE', errors: [] });
    expect(r1?.warnings.map((w) => w.code)).toEqual(['category_created']);
    expect(r2?.errors.map((e) => [e.field, e.code])).toEqual([
      ['designation', 'required'],
      ['price.1', 'invalid_number'],
    ]);
    expect(r3?.errors).toEqual([
      { field: 'reference', code: 'duplicate_in_file', params: { row: '2' } },
    ]);
    expect(r4?.errors).toEqual([
      { field: 'baseUnit', code: 'unknown_unit', params: { value: 'Bidon' } },
    ]);
    expect(r5).toMatchObject({ action: 'CREATE', values: { 'price.1': '1.234,50' } });
    expect(r5?.warnings.map((w) => w.code)).toEqual(['tva_defaulted']);

    expect(await counts(a.tenantId)).toEqual(before);
    const job = await asTenant(a.tenantId, () =>
      t.prisma.db.importJob.findUniqueOrThrow({ where: { id: body.jobId } }),
    );
    expect(job).toMatchObject({ status: 'PREVIEWED', totalRows: 5, errorRows: 3 });
    expect(job.fileData?.length).toBe(file.length);
    expect(existing.id).toBeDefined();

    // A preview with errors cannot be confirmed; nothing is written.
    const refused = await confirm(a, body.jobId).expect(422);
    expect(errorOf(refused).code).toBe(ErrorCode.IMPORT_HAS_ERRORS);
    expect(await counts(a.tenantId)).toEqual(before);
  });

  it('remaps the stored file by job id without uploading it again', async () => {
    const file = await xlsx([
      ['Code', 'Libellé', 'Mesure'],
      ['RM-1', 'Riz 5 kg', 'Pièce'],
    ]);
    const first = (await preview(a, 'PRODUCTS', file).expect(200)).body as ImportPreviewDto;
    expect(first.mapping).toMatchObject({ reference: 0, designation: 1, baseUnit: null });
    expect(first.fileErrors).toEqual([{ field: 'baseUnit', code: 'required_column_missing' }]);

    const second = (
      await preview(a, 'PRODUCTS', null, {
        jobId: first.jobId,
        mapping: { ...first.mapping, baseUnit: 2 },
      }).expect(200)
    ).body as ImportPreviewDto;
    expect(second.jobId).toBe(first.jobId);
    expect(second.fileErrors).toEqual([]);
    expect(second.counts).toMatchObject({ total: 1, valid: 1, errors: 0 });
  });

  it('confirms 1 000 products in one transaction, then 1 000 opening stock lines', async () => {
    const levels = (await get(a, '/price-levels').expect(200)).body as { name: string }[];
    const header = ['Référence', 'Désignation', 'Unité de base', 'Colis 1', 'Colisage 1'];
    header.push(`Prix ${levels[0]!.name}`, `Prix ${levels[0]!.name} colis 1`, 'Code-barres');
    const rows: Row[] = [header];
    for (let i = 0; i < 1000; i++) {
      rows.push([`BULK-${i}`, `Produit ${i}`, 'Pièce', 'Carton', 24, '100,50', '2 400', `BC${i}`]);
    }
    const before = await counts(a.tenantId);
    const job = (await preview(a, 'PRODUCTS', await xlsx(rows)).expect(200))
      .body as ImportPreviewDto;
    expect(job.counts).toMatchObject({ total: 1000, valid: 1000, creates: 1000 });

    const done = (await confirm(a, job.jobId).expect(200)).body as ImportJobDto;
    expect(done).toMatchObject({ status: 'COMPLETED', createdRows: 1000, updatedRows: 0 });
    const after = await counts(a.tenantId);
    expect(after.products - before.products).toBe(1000);
    expect(after.movements).toBe(before.movements);

    const page = (await get(a, '/products?search=BULK-7&limit=100').expect(200)).body as {
      items: ProductDto[];
    };
    const p7 = page.items.find((p) => p.reference === 'BULK-7')!;
    expect(p7.units.map((u) => [u.unitCode, u.factorToBase, u.barcode])).toEqual([
      ['PIECE', '1.000', 'BC7'],
      ['CARTON', '24.000', null],
    ]);
    expect(p7.prices.map((p) => p.priceHt).sort()).toEqual(['100.50', '2400.00']);

    const stockRows: Row[] = [['Référence', 'Quantité', 'Unité', 'Coût unitaire']];
    for (let i = 0; i < 1000; i++) stockRows.push([`BULK-${i}`, 2, 'Carton', '1 100,00']);
    const stockJob = (await preview(a, 'OPENING_STOCK', await xlsx(stockRows)).expect(200))
      .body as ImportPreviewDto;
    expect(stockJob.counts).toMatchObject({ total: 1000, valid: 1000 });
    const stockDone = (await confirm(a, stockJob.jobId).expect(200)).body as ImportJobDto;
    expect(stockDone).toMatchObject({ status: 'COMPLETED', openingRows: 1000 });
    expect((await counts(a.tenantId)).movements - after.movements).toBe(1000);
    const level = (await get(a, `/stock/${p7.id}`).expect(200)).body as StockLevelDto;
    expect(level).toMatchObject({ qtyBase: '48.000', avgCost: '45.8333' });

    // Same stock file again: every row already has an opening, nothing doubles.
    const again = (await preview(a, 'OPENING_STOCK', await xlsx(stockRows)).expect(200))
      .body as ImportPreviewDto;
    expect(again.counts.errors).toBe(1000);
    expect(again.rows[0]?.errors[0]?.code).toBe('opening_already_set');
  }, 120_000);

  it('updates existing products by reference without touching stock (blank cell keeps the value)', async () => {
    const file = await xlsx([
      ['Référence', 'Désignation', 'Unité', 'Stock min'],
      ['BULK-1', 'Produit 1 renommé', null, 6],
      ['BULK-2', null, null, null],
    ]);
    const job = (await preview(a, 'PRODUCTS', file).expect(200)).body as ImportPreviewDto;
    expect(job.rows.map((r) => r.action)).toEqual(['UPDATE', 'UPDATE']);
    expect(job.rows[1]?.warnings.map((w) => w.code)).toEqual(['no_changes']);
    const movementsBefore = (await counts(a.tenantId)).movements;
    const done = (await confirm(a, job.jobId).expect(200)).body as ImportJobDto;
    expect(done).toMatchObject({ createdRows: 0, updatedRows: 1 });
    const page = (await get(a, '/products?search=BULK-1&limit=100').expect(200)).body as {
      items: ProductDto[];
    };
    const p1 = page.items.find((p) => p.reference === 'BULK-1')!;
    expect(p1).toMatchObject({ designation: 'Produit 1 renommé', minStock: '6.000', version: 2 });
    expect(p1.prices).toHaveLength(2);
    expect((await counts(a.tenantId)).movements).toBe(movementsBefore);
  });

  it('imports clients with opening balances; re-importing the same file never doubles them', async () => {
    const file = await xlsx([
      ['Code client', 'Nom', 'Téléphone', 'Plafond', 'Solde initial'],
      ['CL-1', 'Épicerie Baraka', '0550 12 34 56', '200 000', '45 300,00'],
      ['CL-2', 'Superette Nour', null, null, '-2 000'],
      ['CL-3', 'Sans dette', null, null, null],
    ]);
    const job = (await preview(a, 'CLIENTS', file).expect(200)).body as ImportPreviewDto;
    expect(job.counts).toMatchObject({ total: 3, valid: 3, creates: 3 });
    const done = (await confirm(a, job.jobId).expect(200)).body as ImportJobDto;
    expect(done).toMatchObject({ createdRows: 3, openingRows: 2 });

    const c1 = await clientByCode(a, 'CL-1');
    expect(c1).toMatchObject({ balance: '45300.00', hasOpening: true, creditLimit: '200000.00' });
    expect((await clientByCode(a, 'CL-2')).balance).toBe('-2000.00');
    expect(await clientByCode(a, 'CL-3')).toMatchObject({ balance: '0.00', hasOpening: false });

    const ledgerBefore = (await counts(a.tenantId)).ledger;
    const again = (await preview(a, 'CLIENTS', file).expect(200)).body as ImportPreviewDto;
    expect(again.rows.map((r) => r.errors.map((e) => e.code))).toEqual([
      ['opening_already_set'],
      ['opening_already_set'],
      [],
    ]);
    const refused = await confirm(a, again.jobId).expect(422);
    expect(errorOf(refused).code).toBe(ErrorCode.IMPORT_HAS_ERRORS);
    expect((await counts(a.tenantId)).ledger).toBe(ledgerBefore);
    expect((await clientByCode(a, 'CL-1')).balance).toBe('45300.00');
  });

  it('rolls everything back when a row became invalid between preview and confirm', async () => {
    const existing = (
      await t
        .http()
        .post('/clients')
        .set(...token(a))
        .send({ code: 'RB-0', name: 'Déjà là' })
        .expect(201)
    ).body as ClientDto;
    const file = await xlsx([
      ['Code', 'Nom', 'Solde initial'],
      ['RB-1', 'Nouveau 1', '1 000'],
      ['RB-2', 'Nouveau 2', '2 000'],
      ['RB-0', null, '500'],
    ]);
    const job = (await preview(a, 'CLIENTS', file).expect(200)).body as ImportPreviewDto;
    expect(job.counts).toMatchObject({ valid: 3, creates: 2, updates: 1 });

    // Someone sets RB-0's opening balance before the import is confirmed.
    await t
      .http()
      .post(`/clients/${existing.id}/opening-balance`)
      .set(...token(a))
      .set('Idempotency-Key', randomUUID())
      .send({ amount: '700' })
      .expect(201);
    const before = await counts(a.tenantId);
    const res = await confirm(a, job.jobId).expect(422);
    expect(errorOf(res).code).toBe(ErrorCode.IMPORT_HAS_ERRORS);
    expect((errorOf(res).details as { rows: unknown[] }).rows).toEqual([
      { rowNumber: 4, errors: [{ field: 'openingBalance', code: 'opening_already_set' }] },
    ]);
    expect(await counts(a.tenantId)).toEqual(before);
    const list = (await get(a, '/imports').expect(200)).body as ImportJobPage;
    expect(list.items.find((j) => j.id === job.jobId)).toMatchObject({
      status: 'FAILED',
      errorRows: 1,
    });
    await confirm(a, job.jobId).expect(409);
  });

  it('confirm is idempotent: a replay returns the same result and writes nothing', async () => {
    const file = await xlsx([
      ['Code', 'Nom', 'Solde'],
      ['ID-1', 'Client idempotent', '3 000'],
    ]);
    const job = (await preview(a, 'CLIENTS', file).expect(200)).body as ImportPreviewDto;
    const key = randomUUID();
    const first = await confirm(a, job.jobId, key).expect(200);
    const before = await counts(a.tenantId);
    const replay = await confirm(a, job.jobId, key).expect(200);
    expect(replay.headers['idempotent-replayed']).toBe('true');
    expect(replay.body).toEqual(first.body);
    expect(await counts(a.tenantId)).toEqual(before);

    const other = await confirm(a, job.jobId).expect(409);
    expect(errorOf(other).code).toBe(ErrorCode.IMPORT_NOT_PENDING);
    expect((await clientByCode(a, 'ID-1')).balance).toBe('3000.00');
  });

  it('reads semicolon CSV files with French numbers in Windows-1252', async () => {
    const csv = Buffer.from(
      'Code;Nom;Solde initial\r\nCSV-1;Café Tlemcen;"1 234,56"\r\nCSV-2;Hôtel;1.000,00 DA\r\n',
      'latin1',
    );
    const job = (await preview(a, 'CLIENTS', csv, { name: 'clients.csv' }).expect(200))
      .body as ImportPreviewDto;
    expect(job.rows.map((r) => [r.values['name'], r.errors])).toEqual([
      ['Café Tlemcen', []],
      ['Hôtel', []],
    ]);
    await confirm(a, job.jobId).expect(200);
    expect((await clientByCode(a, 'CSV-1')).balance).toBe('1234.56');
    expect((await clientByCode(a, 'CSV-2')).balance).toBe('1000.00');
  });

  it('serves an xlsx template per type and refuses unknown types', async () => {
    const res = await get(a, '/imports/templates/CLIENTS')
      .buffer(true)
      .parse((r, cb) => {
        const parts: Buffer[] = [];
        r.on('data', (c: Buffer) => parts.push(c));
        r.on('end', () => cb(null, Buffer.concat(parts)));
      })
      .expect(200);
    expect(res.headers['content-type']).toContain('spreadsheetml');
    const job = (await preview(a, 'CLIENTS', res.body as Buffer).expect(200))
      .body as ImportPreviewDto;
    expect(job.fileErrors).toEqual([]);
    expect(job.counts.total).toBe(2);
    await get(a, '/imports/templates/OTHER').expect(400);
  });

  it('refuses files that are not spreadsheets', async () => {
    const res = await preview(a, 'CLIENTS', Buffer.from('%PDF-1.7'), { name: 'x.pdf' }).expect(400);
    expect(errorOf(res).code).toBe(ErrorCode.IMPORT_FILE_INVALID);
  });

  it('keeps tenants apart', async () => {
    const file = await xlsx([
      ['Code', 'Nom'],
      ['ISO-1', 'Client A'],
    ]);
    const job = (await preview(a, 'CLIENTS', file).expect(200)).body as ImportPreviewDto;
    await confirm(b, job.jobId).expect(404);
    await preview(b, 'CLIENTS', null, { jobId: job.jobId, mapping: {} }).expect(404);
    const listB = (await get(b, '/imports').expect(200)).body as ImportJobPage;
    expect(listB.items.find((j) => j.id === job.jobId)).toBeUndefined();

    // B's opening stock file cannot reach A's products.
    const stock = await xlsx([
      ['Référence', 'Quantité', 'Coût unitaire'],
      ['BULK-1', 1, 10],
    ]);
    const bJob = (await preview(b, 'OPENING_STOCK', stock).expect(200)).body as ImportPreviewDto;
    expect(bJob.rows[0]?.errors.map((e) => e.code)).toEqual(['product_not_found']);
    await confirm(a, job.jobId).expect(200);
  });
});
