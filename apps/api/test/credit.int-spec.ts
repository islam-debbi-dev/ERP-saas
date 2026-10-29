import { randomUUID } from 'node:crypto';
import {
  addDays,
  AGING_BUCKETS,
  type AgingReportDto,
  type ApiError,
  type ClientDto,
  type ClientsToRemindDto,
  type DashboardDto,
  ErrorCode,
  money,
  type PurchaseDto,
  type SaleResultDto,
  type ShareLinkDto,
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
  tamper,
  type TenantCatalog,
  type TestApp,
} from './helpers';

const TODAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Algiers' }).format(new Date());

/** Collects a binary body (supertest only buffers text and JSON by itself). */
function binary(res: unknown, done: (err: Error | null, body: Buffer) => void) {
  const stream = res as NodeJS.ReadableStream;
  const chunks: Buffer[] = [];
  stream.on('data', (c: Buffer) => chunks.push(c));
  stream.on('end', () => done(null, Buffer.concat(chunks)));
}

/** Aging, reminders, share links and cheques à échéance (phase 21). */
describe('crédit avancé', () => {
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
  const open = (url: string) => {
    const path = new URL(url).pathname;
    return t.http().get(path).buffer(true).parse(binary);
  };

  const client = async (who: RegisteredTenant = a, extra: object = {}) =>
    (
      await as(who)
        .post('/clients', { code: `CR${++seq}`, name: `Client crédit ${seq}`, ...extra }, null)
        .expect(201)
    ).body as ClientDto;

  /** A sale of 2 cartons at 2 300 HT (5 474 TTC), dated `daysAgo` days back. */
  const sell = async (
    who: RegisteredTenant,
    cat: TenantCatalog,
    clientId: string,
    daysAgo: number,
    extra: object = {},
  ) => {
    const p = await createProduct(t, who, cat);
    return (
      (
        await as(who)
          .post('/sales/quick', {
            documentDate: addDays(TODAY, -daysAgo),
            clientId,
            lines: [{ productId: p.id, unitId: p.cartonUnitId, qty: '2', unitPriceHt: '2300' }],
            ...extra,
          })
          .expect(201)
      ).body as SaleResultDto
    ).sale;
  };

  const sumOfBuckets = (buckets: Record<string, string>) =>
    AGING_BUCKETS.reduce((s, k) => s.plus(buckets[k] ?? '0'), money(0)).toFixed(2);

  beforeAll(async () => {
    t = await createTestApp();
    a = await registerTenant(t, 'Crédit A');
    b = await registerTenant(t, 'Crédit B');
    catA = await catalogOf(t, a);
    catB = await catalogOf(t, b);
  });
  afterAll(() => t.close());

  it('client aging spreads the ledger balance over the unpaid documents and sums to it', async () => {
    const c = await client();
    await sell(a, catA, c.id, 100); // 5 474, 90+
    await sell(a, catA, c.id, 45, { paidAmount: '2474' }); // 3 000 left, 31–60
    const recent = await sell(a, catA, c.id, 5); // 5 474, 0–30
    // An avoir on the recent BL: 0.5 carton back = 1 368.50 TTC.
    await as(a)
      .post(`/sales/${recent.id}/returns`, {
        disposition: 'RESTOCK',
        reason: 'invendus',
        lines: [{ saleLineId: recent.lines[0]!.id, qty: '0.5' }],
      })
      .expect(201);
    // A versement with no allocation given: the oldest BL first (phase 7).
    await as(a).post('/payments', { clientId: c.id, amount: '4000' }).expect(201);

    const balance = ((await as(a).get(`/clients/${c.id}`).expect(200)).body as ClientDto).balance;
    expect(balance).toBe('8579.50'); // 5 474 + 3 000 + 5 474 − 1 368.50 − 4 000

    const report = (await as(a).get('/reports/aging').expect(200)).body as AgingReportDto;
    const row = report.rows.find((r) => r.party.id === c.id)!;
    expect(row.balance).toBe(balance);
    expect(row.buckets).toEqual({
      d0_30: '4105.50',
      d31_60: '3000.00',
      d61_90: '0.00',
      d90: '1474.00',
    });
    expect(row.oldestDays).toBe(100);
    expect(sumOfBuckets(row.buckets)).toBe(row.balance);
    // Every row and the totals add up.
    for (const r of report.rows) expect(sumOfBuckets(r.buckets)).toBe(r.balance);
    expect(sumOfBuckets(report.totals.buckets)).toBe(report.totals.balance);
  });

  it('ages an account as of a past day from what was known then', async () => {
    const c = await client();
    await sell(a, catA, c.id, 10);
    const before = (
      await as(a)
        .get(`/reports/aging?asOf=${addDays(TODAY, -1)}`)
        .expect(200)
    ).body as AgingReportDto;
    // The sale was validated today: the day before, the client owed nothing.
    expect(before.rows.find((r) => r.party.id === c.id)).toBeUndefined();
  });

  it('supplier aging pays the oldest BR first with unallocated règlements', async () => {
    const s = (
      await as(a)
        .post('/suppliers', { name: `Aging F ${++seq}` }, null)
        .expect(201)
    ).body as SupplierDto;
    const receive = async (daysAgo: number) => {
      const p = await createProduct(t, a, catA);
      const draft = (
        await as(a)
          .post('/purchases', {
            supplierId: s.id,
            documentDate: addDays(TODAY, -daysAgo),
            lines: [{ productId: p.id, unitId: p.cartonUnitId, qty: '1', unitCost: '1000' }],
          })
          .expect(201)
      ).body as PurchaseDto;
      await as(a).post(`/purchases/${draft.id}/validate`).expect(200);
    };
    await receive(70); // 1 190
    await receive(20); // 1 190
    await as(a).post('/supplier-payments', { supplierId: s.id, amount: '1500' }).expect(201);

    const report = (await as(a).get('/reports/supplier-aging').expect(200)).body as AgingReportDto;
    const row = report.rows.find((r) => r.party.id === s.id)!;
    expect(row).toMatchObject({
      balance: '880.00',
      buckets: { d0_30: '880.00', d31_60: '0.00', d61_90: '0.00', d90: '0.00' },
      oldestDays: 20,
    });

    const xlsx = await as(a)
      .get('/reports/supplier-aging/export.xlsx')
      .buffer(true)
      .parse(binary)
      .expect(200);
    expect(xlsx.headers['content-disposition']).toContain('balance-agee-fournisseurs-');
  });

  it('lists the clients to remind with the tenant threshold', async () => {
    const old = await client(a, { phone: '0550 12 34 56' });
    const fresh = await client();
    await sell(a, catA, old.id, 40);
    await sell(a, catA, fresh.id, 10);

    let list = (await as(a).get('/clients/to-remind').expect(200)).body as ClientsToRemindDto;
    expect(list.reminderDays).toBe(30);
    expect(list.items.find((i) => i.client.id === old.id)).toMatchObject({
      balance: '5474.00',
      oldestDays: 40,
      oldestDate: addDays(TODAY, -40),
    });
    expect(list.items.some((i) => i.client.id === fresh.id)).toBe(false);

    await as(a).patch('/tenant/settings', { reminderDays: 7 }).expect(200);
    list = (await as(a).get('/clients/to-remind').expect(200)).body as ClientsToRemindDto;
    expect(list.reminderDays).toBe(7);
    expect(list.items.some((i) => i.client.id === fresh.id)).toBe(true);
    await as(a).patch('/tenant/settings', { reminderDays: 30 }).expect(200);
    await as(a).patch('/tenant/settings', { reminderDays: 0 }).expect(400);
  });

  it('a share link opens the relevé without login, is counted, and stops when revoked', async () => {
    const c = await client();
    await sell(a, catA, c.id, 3);
    const link = (
      await as(a)
        .post('/share-links', {
          docType: 'RELEVE',
          docId: c.id,
          from: addDays(TODAY, -30),
          to: TODAY,
        })
        .expect(201)
    ).body as ShareLinkDto;
    expect(link.url).toMatch(/\/s\/[A-Za-z0-9_-]{43}$/);
    expect(new Date(link.expiresAt).getTime() - Date.now()).toBeGreaterThan(6.9 * 86_400_000);

    const res = await open(link.url).expect(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect((res.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');

    const stored = await asTenant(a.tenantId, () =>
      t.prisma.db.shareLink.findUniqueOrThrow({ where: { id: link.id } }),
    );
    expect(stored.openCount).toBe(1);
    expect(stored.tokenHash).not.toContain(link.url.split('/s/')[1]);
    const opened = await asTenant(a.tenantId, () =>
      t.prisma.db.auditLog.count({ where: { action: 'SHARE_LINK_OPENED', entityId: link.id } }),
    );
    expect(opened).toBe(1);

    await as(a).delete(`/share-links/${link.id}`).expect(204);
    const revoked = await open(link.url).expect(410);
    expect((JSON.parse((revoked.body as Buffer).toString()) as ApiError).code).toBe(
      ErrorCode.SHARE_LINK_INVALID,
    );
  });

  it('refuses an expired link and an unknown token alike', async () => {
    const c = await client();
    const fac = await sell(a, catA, c.id, 1, { type: 'FACTURE' });
    const link = (
      await as(a).post('/share-links', { docType: 'FACTURE', docId: fac.id }).expect(201)
    ).body as ShareLinkDto;
    await open(link.url).expect(200);
    await tamper(
      t,
    )`UPDATE share_links SET "expiresAt" = now() - interval '1 minute' WHERE id = ${link.id}::uuid`;
    await open(link.url).expect(410);
    await t.http().get('/s/not-a-real-token-at-all-0000000000').expect(410);
    await t
      .http()
      .get(`/s/${'x'.repeat(43)}`)
      .expect(410);
  });

  it('keeps share links inside their tenant', async () => {
    const cA = await client();
    const facA = await sell(a, catA, cA.id, 1, { type: 'FACTURE' });
    const cB = await client(b);
    const facB = await sell(b, catB, cB.id, 1, { type: 'FACTURE' });

    // B cannot share or revoke A's documents.
    await as(b).post('/share-links', { docType: 'FACTURE', docId: facA.id }).expect(404);
    await as(b)
      .post('/share-links', { docType: 'RELEVE', docId: cA.id, from: TODAY, to: TODAY })
      .expect(404);
    const linkA = (
      await as(a).post('/share-links', { docType: 'FACTURE', docId: facA.id }).expect(201)
    ).body as ShareLinkDto;
    await as(b).delete(`/share-links/${linkA.id}`).expect(404);

    // Each token opens its own tenant's facture, nothing else.
    const linkB = (
      await as(b).post('/share-links', { docType: 'FACTURE', docId: facB.id }).expect(201)
    ).body as ShareLinkDto;
    const pdfA = (await open(linkA.url).expect(200)).body as Buffer;
    const pdfB = (await open(linkB.url).expect(200)).body as Buffer;
    expect(pdfA.equals(pdfB)).toBe(false);
    const opensOfA = await asTenant(b.tenantId, () =>
      t.prisma.db.auditLog.count({ where: { action: 'SHARE_LINK_OPENED', entityId: linkA.id } }),
    );
    expect(opensOfA).toBe(0);
    // A BL is not shareable as a facture.
    const bl = await sell(a, catA, cA.id, 1);
    await as(a).post('/share-links', { docType: 'FACTURE', docId: bl.id }).expect(404);
  });

  it('shows client and supplier cheques due in the next 7 days on the dashboard', async () => {
    const c = await client();
    await sell(a, catA, c.id, 1);
    await as(a)
      .post('/payments', {
        clientId: c.id,
        amount: '1200',
        mode: 'CHEQUE',
        reference: 'CL-1',
        dueDate: addDays(TODAY, 3),
      })
      .expect(201);
    await as(a)
      .post('/payments', {
        clientId: c.id,
        amount: '50',
        mode: 'CHEQUE',
        dueDate: addDays(TODAY, 9),
      })
      .expect(201);
    const s = (
      await as(a)
        .post('/suppliers', { name: `Chèques F ${++seq}` }, null)
        .expect(201)
    ).body as SupplierDto;
    await as(a)
      .post('/supplier-payments', {
        supplierId: s.id,
        amount: '800',
        mode: 'CHEQUE',
        reference: 'FR-1',
        dueDate: TODAY,
      })
      .expect(201);

    const dash = (await as(a).get('/dashboard').expect(200)).body as DashboardDto;
    expect(dash.cheques).toMatchObject({ from: TODAY, to: addDays(TODAY, 6) });
    expect(dash.cheques?.client.items.find((i) => i.reference === 'CL-1')).toMatchObject({
      amount: '1200.00',
      dueDate: addDays(TODAY, 3),
      party: { id: c.id },
    });
    expect(dash.cheques?.client.items.some((i) => i.amount === '50.00')).toBe(false);
    expect(dash.cheques?.supplier.items.find((i) => i.reference === 'FR-1')).toMatchObject({
      amount: '800.00',
      party: { id: s.id },
    });

    const dashB = (await as(b).get('/dashboard').expect(200)).body as DashboardDto;
    expect(dashB.cheques?.client.items.some((i) => i.reference === 'CL-1')).toBe(false);
  });
});
