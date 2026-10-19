import { randomUUID } from 'node:crypto';
import {
  type ClientDto,
  ErrorCode,
  type PaymentDto,
  type PurchaseDto,
  type SaleDto,
  type SaleResultDto,
} from '@erp/shared';
import type { Response } from 'supertest';
import type { CurrentUserInfo } from '../src/auth/auth.types';
import { PdfRendererService } from '../src/printing/pdf-renderer.service';
import { PrintingService } from '../src/printing/printing.service';
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

const TODAY = '2026-10-19';

/** Collects a binary body (supertest only buffers text and JSON by itself). */
function binary(res: unknown, done: (err: Error | null, body: Buffer) => void) {
  // In node, superagent hands the raw response stream to custom parsers.
  const stream = res as NodeJS.ReadableStream;
  const chunks: Buffer[] = [];
  stream.on('data', (c: Buffer) => chunks.push(c));
  stream.on('end', () => done(null, Buffer.concat(chunks)));
}

describe('printing', () => {
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
    pdf: (url: string) =>
      t
        .http()
        .get(url)
        .set(...bearer(who.auth.accessToken))
        .buffer(true)
        .parse(binary),
    post: (url: string, body: object = {}) =>
      t
        .http()
        .post(url)
        .set(...bearer(who.auth.accessToken))
        .set('Idempotency-Key', randomUUID())
        .send(body),
    patch: (url: string, body: object) =>
      t
        .http()
        .patch(url)
        .set(...bearer(who.auth.accessToken))
        .send(body),
  });

  const expectPdf = (res: Response) => {
    expect(res.headers['content-type']).toBe('application/pdf');
    const body = res.body as Buffer;
    expect(body.subarray(0, 5).toString()).toBe('%PDF-');
    expect(body.length).toBeGreaterThan(1000);
  };

  const userOf = (who: RegisteredTenant): CurrentUserInfo => ({
    id: who.auth.user.id,
    tenantId: who.tenantId,
    sessionId: randomUUID(),
    role: who.auth.user.role,
    email: who.email,
    fullName: who.auth.user.fullName,
  });

  /** HTML of a document as the PDF gets it, minus the constant stylesheet. */
  const htmlOf = async (
    who: RegisteredTenant,
    type: 'BL' | 'FAC' | 'AV' | 'BR',
    id: string,
  ): Promise<string> => {
    const doc = await asTenant(who.tenantId, () =>
      t.app.get(PrintingService).document(type, id, undefined, userOf(who)),
    );
    return doc.html.replace(/<style>[\s\S]*?<\/style>/, '<style>…</style>');
  };

  let seq = 0;
  const client = async (who: RegisteredTenant, extra: object = {}) =>
    (
      await as(who)
        .post('/clients', { code: `P${++seq}`, name: `Client ${seq}`, ...extra })
        .expect(201)
    ).body as ClientDto;

  const sell = async (who: RegisteredTenant, cat: TenantCatalog, body: object) => {
    const p = await createProduct(t, who, cat, { designation: 'Huile Elio 5 L' });
    return (
      (
        await as(who)
          .post('/sales/quick', {
            documentDate: TODAY,
            lines: [{ productId: p.id, unitId: p.cartonUnitId, qty: '2', unitPriceHt: '2300' }],
            ...body,
          })
          .expect(201)
      ).body as SaleResultDto
    ).sale;
  };

  beforeAll(async () => {
    t = await createTestApp();
    a = await registerTenant(t, 'Impression A');
    b = await registerTenant(t, 'Impression B');
    catA = await catalogOf(t, a);
    await as(a)
      .patch('/tenant/settings', {
        raisonSociale: 'SARL Impression A',
        adresse: 'Oued Smar, Alger',
        rc: '16/00-1234567B21',
        nif: '000016001234567',
        documentFooter: 'Merci de votre confiance',
      })
      .expect(200);
  });
  afterAll(() => t.close());

  it('prints a BL and a facture as PDF in A4 and A5; a reprint is a DUPLICATA', async () => {
    const c = await client(a);
    const bl = await sell(a, catA, { clientId: c.id });
    expectPdf(await as(a).pdf(`/documents/BL/${bl.id}/pdf`).expect(200));
    expectPdf(await as(a).pdf(`/documents/BL/${bl.id}/pdf?format=A5`).expect(200));

    const fac = await sell(a, catA, { clientId: c.id, type: 'FACTURE' });
    const res = await as(a).pdf(`/documents/FAC/${fac.id}/pdf`).expect(200);
    expectPdf(res);
    expect(res.headers['content-disposition']).toBe(`inline; filename="${fac.number}.pdf"`);

    const prints = await asTenant(a.tenantId, () =>
      t.prisma.db.documentPrint.findMany({ where: { docId: bl.id }, orderBy: { seq: 'asc' } }),
    );
    expect(prints.map((p) => p.format)).toEqual(['A4', 'A5']);
    expect(await htmlOf(a, 'BL', bl.id)).toContain('DUPLICATA');
    expect(await htmlOf(a, 'FAC', fac.id)).toContain('DUPLICATA');
  });

  it('two simultaneous first prints make exactly one original', async () => {
    const bl = await sell(a, catA, {
      clientId: (await client(a)).id,
    });
    const docs = await Promise.all(
      [1, 2, 3].map(() =>
        asTenant(a.tenantId, () =>
          t.app.get(PrintingService).document('BL', bl.id, 'A4', userOf(a)),
        ),
      ),
    );
    expect(docs.filter((d) => !d.html.includes('DUPLICATA'))).toHaveLength(1);
  });

  it('a cancelled document prints with an ANNULÉ watermark', async () => {
    const bl = await sell(a, catA, { clientId: (await client(a)).id });
    expect(await htmlOf(a, 'BL', bl.id)).not.toContain('ANNULÉ');
    await as(a).post(`/sales/${bl.id}/cancel`, { reason: 'erreur' }).expect(200);
    expect(await htmlOf(a, 'BL', bl.id)).toContain('<div class="watermark">ANNULÉ</div>');
  });

  it('drafts are not printed; a wrong type is not found', async () => {
    const p = await createProduct(t, a, catA);
    const draft = (
      await as(a)
        .post('/sales', {
          documentDate: TODAY,
          note: null,
          lines: [{ productId: p.id, unitId: p.cartonUnitId, qty: '1', unitPriceHt: '100' }],
        })
        .expect(201)
    ).body as SaleDto;
    const res = await as(a).get(`/documents/BL/${draft.id}/pdf`).expect(409);
    expect(res.body).toMatchObject({ code: ErrorCode.SALE_NOT_VALIDATED });

    const bl = await sell(a, catA, { paidAmount: '5474', paymentMode: 'ESPECES' });
    await as(a).get(`/documents/FAC/${bl.id}/pdf`).expect(404);
    await as(a).get(`/documents/XX/${bl.id}/pdf`).expect(400);
    await as(a).get(`/documents/BL/${bl.id}/pdf?format=A3`).expect(400);
  });

  it('prints an avoir from its own frozen lines', async () => {
    const c = await client(a);
    const fac = await sell(a, catA, { clientId: c.id, type: 'FACTURE' });
    const sale = (
      (
        await as(a)
          .post(`/sales/${fac.id}/returns`, {
            disposition: 'RESTOCK',
            reason: 'carton abîmé',
            lines: [{ saleLineId: fac.lines[0]!.id, qty: '1' }],
          })
          .expect(201)
      ).body as SaleResultDto
    ).sale;
    const avoir = sale.returns[0]!;
    expectPdf(await as(a).pdf(`/documents/AV/${avoir.id}/pdf`).expect(200));
    const html = await htmlOf(a, 'AV', avoir.id);
    expect(html).toContain(avoir.number);
    expect(html).toContain('Huile Elio 5 L');
    expect(html).toContain(`Sur facture`);
    expect(html).toContain('Deux mille sept cent trente-sept dinars algériens');
  });

  it('prints a validated bon de réception, not a draft', async () => {
    const s = (await as(a).post('/suppliers', { name: 'Cevital' }).expect(201)).body as {
      id: string;
    };
    const p = await createProduct(t, a, catA);
    const draft = (
      await as(a)
        .post('/purchases', {
          supplierId: s.id,
          documentDate: TODAY,
          lines: [{ productId: p.id, unitId: p.cartonUnitId, qty: '3', unitCost: '1100' }],
        })
        .expect(201)
    ).body as PurchaseDto;
    const refused = await as(a).get(`/documents/BR/${draft.id}/pdf`).expect(409);
    expect(refused.body).toMatchObject({ code: ErrorCode.PURCHASE_NOT_VALIDATED });
    await as(a).post(`/purchases/${draft.id}/validate`).expect(200);
    expectPdf(await as(a).pdf(`/documents/BR/${draft.id}/pdf?format=A5`).expect(200));
  });

  it('prints a versement receipt and a relevé de compte', async () => {
    const c = await client(a);
    await sell(a, catA, { clientId: c.id });
    const payment = (
      await as(a).post('/payments', { clientId: c.id, amount: '1500', mode: 'ESPECES' }).expect(201)
    ).body as PaymentDto;
    expectPdf(await as(a).pdf(`/payments/${payment.id}/receipt.pdf`).expect(200));
    const res = await as(a)
      .pdf(`/clients/${c.id}/statement/pdf?from=2026-01-01&to=2099-12-31&format=A5`)
      .expect(200);
    expectPdf(res);
    expect(res.headers['content-disposition']).toContain(
      `releve-${c.code}-2026-01-01-2099-12-31.pdf`,
    );
    await as(a).get(`/clients/${c.id}/statement/pdf?from=2026-02-01&to=2026-01-01`).expect(400);
  });

  it('renders the facture HTML from frozen data (assujetti and non-assujetti)', async () => {
    const snap = async (name: string, assujettiTva: boolean) => {
      const who = await registerTenant(t, name);
      const cat = await catalogOf(t, who);
      await as(who)
        .patch('/tenant/settings', {
          raisonSociale: `SARL ${name}`,
          adresse: 'Zone d’activité, Oued Smar, Alger',
          telephone: '023 00 00 00',
          rc: '16/00-1234567B21',
          nif: '000016001234567',
          nis: '000116001234567',
          ai: '16012345678',
          assujettiTva,
          timbreEnabled: true,
          timbreTranches: [{ upTo: null, rate: '1' }],
        })
        .expect(200);
      const c = (
        await as(who)
          .post('/clients', {
            code: 'C001',
            name: 'Superette El Baraka',
            type: 'PROFESSIONNEL',
            address: '12 rue Larbi Ben M’hidi',
            wilaya: 'Alger',
            rc: '16/00-7654321A20',
            nif: '000216007654321',
          })
          .expect(201)
      ).body as ClientDto;
      const fac = (
        (
          await as(who)
            .post('/sales/quick', {
              type: 'FACTURE',
              documentDate: TODAY,
              clientId: c.id,
              paidAmount: '10000',
              paymentMode: 'ESPECES',
              lines: [
                {
                  productId: (await createProduct(t, who, cat, { designation: 'Huile Elio 5 L' }))
                    .id,
                  unitId: cat.units['PIECE']!.id,
                  qty: '12',
                  unitPriceHt: '650',
                },
                {
                  productId: (
                    await createProduct(t, who, cat, { designation: 'Sucre <blanc> & cristal' })
                  ).id,
                  unitId: cat.units['PIECE']!.id,
                  qty: '3',
                  unitPriceHt: '95.50',
                },
              ],
            })
            .expect(201)
        ).body as SaleResultDto
      ).sale;
      const html = (await htmlOf(who, 'FAC', fac.id)).replaceAll(fac.number ?? '', 'FAC-NUMBER');
      expect(html).toContain('Sucre &lt;blanc&gt; &amp; cristal');
      return html;
    };

    const assujetti = await snap('Snapshot TVA', true);
    expect(assujetti).toContain('TVA %');
    expect(assujetti).toContain('Timbre fiscal');
    expect(assujetti).toContain('Arrêtée la présente facture à la somme de');
    expect(assujetti).not.toContain('Non assujetti');
    expect(assujetti).toMatchSnapshot('facture assujetti');

    const forfait = await snap('Snapshot IFU', false);
    expect(forfait).not.toContain('TVA %');
    expect(forfait).not.toContain('TTC');
    expect(forfait).toContain('Non assujetti à la TVA');
    expect(forfait).toMatchSnapshot('facture non assujetti');
  });

  it('renders a facture in under 2 s with a warm browser', async () => {
    const fac = await sell(a, catA, { clientId: (await client(a)).id, type: 'FACTURE' });
    const doc = await asTenant(a.tenantId, () =>
      t.app.get(PrintingService).document('FAC', fac.id, 'A4', userOf(a)),
    );
    const renderer = t.app.get(PdfRendererService);
    await renderer.render(doc.html, 'A4', null); // warm-up (browser launch)
    const start = Date.now();
    await renderer.render(doc.html, 'A4', null);
    expect(Date.now() - start).toBeLessThan(2000);
  });

  it("tenant B cannot print tenant A's documents, receipts or statements", async () => {
    const c = await client(a);
    const bl = await sell(a, catA, { clientId: c.id });
    const payment = (
      await as(a).post('/payments', { clientId: c.id, amount: '100', mode: 'ESPECES' }).expect(201)
    ).body as PaymentDto;
    await as(b).get(`/documents/BL/${bl.id}/pdf`).expect(404);
    await as(b).get(`/payments/${payment.id}/receipt.pdf`).expect(404);
    await as(b).get(`/clients/${c.id}/statement/pdf?from=2026-01-01&to=2026-12-31`).expect(404);
    const prints = await asTenant(b.tenantId, () =>
      t.prisma.db.documentPrint.count({ where: { docId: { in: [bl.id, payment.id] } } }),
    );
    expect(prints).toBe(0);
  });
});
