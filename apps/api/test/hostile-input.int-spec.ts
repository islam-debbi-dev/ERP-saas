import { randomUUID } from 'node:crypto';
import { Activity, type ClientDto, ErrorCode } from '@erp/shared';
import {
  bearer,
  catalogOf,
  createProduct,
  createTestApp,
  registerTenant,
  type RegisteredTenant,
  type TenantCatalog,
  type TestApp,
} from './helpers';

const TODAY = '2026-11-14';
/** Does not fit `Decimal(14,2)` at all. */
const SIXTEEN = '9999999999999999.99';
/** Fits the column; the total or the balance computed from it does not. */
const TWELVE = '999999999999.99';
/** A string JSON can carry and UTF-8 cannot. */
const SURROGATE = 'bad\uD800end';

/**
 * Audit 01 #2 and audit 02, B-4: an amount the columns cannot hold, a text that is not valid
 * Unicode and an empty unit factor answered 500 on 19 routes. Each is the user's mistake: 400.
 */
describe('hostile input answers 400, never 500', () => {
  let t: TestApp;
  let a: RegisteredTenant;
  let cat: TenantCatalog;
  let product: { id: string; baseUnitId: string; cartonUnitId: string };
  let client: ClientDto;

  const send = async (method: 'post' | 'put' | 'patch', url: string, body: object) => {
    const res = await t
      .http()
      [method](url)
      .set(...bearer(a.auth.accessToken))
      .set('Idempotency-Key', randomUUID())
      .send(body);
    return { status: res.status, code: (res.body as { code?: string }).code };
  };
  const refused = { status: 400, code: ErrorCode.VALIDATION_FAILED };

  beforeAll(async () => {
    t = await createTestApp();
    a = await registerTenant(t, 'Entrées hostiles', { activity: Activity.DISTRIBUTEUR });
    cat = await catalogOf(t, a);
    product = await createProduct(t, a, cat);
    client = (
      await t
        .http()
        .post('/clients')
        .set(...bearer(a.auth.accessToken))
        .send({ code: 'H1', name: 'Client H' })
        .expect(201)
    ).body as ClientDto;
  });
  afterAll(() => t.close());

  describe.each([SIXTEEN, TWELVE])('an amount of %s', (amount) => {
    it('a versement', async () => {
      expect(
        await send('post', '/payments', { clientId: client.id, mode: 'ESPECES', amount }),
      ).toEqual(refused);
    });

    it('a sale line price, on a draft and on a quick sale', async () => {
      const body = {
        documentDate: TODAY,
        clientId: client.id,
        lines: [
          { productId: product.id, unitId: product.baseUnitId, qty: '1', unitPriceHt: amount },
        ],
      };
      expect(await send('post', '/sales', { ...body, type: 'BL' })).toEqual(refused);
      expect(await send('post', '/sales/quick', { ...body, paidAmount: '0' })).toEqual(refused);
    });

    it('a client balance adjustment', async () => {
      expect(
        await send('post', `/clients/${client.id}/adjustments`, { amount, reason: 'Erreur' }),
      ).toEqual(refused);
    });

    it('the alert threshold of the cash count, in the settings', async () => {
      expect(await send('patch', '/tenant/settings', { cashCountAlertThreshold: amount })).toEqual(
        refused,
      );
    });
  });

  it('amounts whose product overflows (price × quantity) answer 400 too', async () => {
    const res = await send('post', '/sales/quick', {
      documentDate: TODAY,
      clientId: client.id,
      paidAmount: '0',
      lines: [
        {
          productId: product.id,
          unitId: product.baseUnitId,
          qty: '99999999',
          unitPriceHt: '9999999999.99',
        },
      ],
    });
    expect(res).toEqual(refused);
  });

  it('a unit factor that is empty or in Arabic digits', async () => {
    for (const factorToBase of ['', '١٢٣']) {
      const res = await send('post', '/products', {
        reference: `H-${randomUUID().slice(0, 8)}`,
        designation: 'Article H',
        baseUnitId: product.baseUnitId,
        tvaRate: '19',
        minStock: '0',
        units: [
          {
            unitId: product.baseUnitId,
            factorToBase,
            barcode: null,
            isDefaultSale: true,
            isDefaultPurchase: true,
          },
        ],
        prices: [],
      });
      expect(res).toEqual(refused);
    }
  });

  it('a text with a lone surrogate, wherever it is in the body', async () => {
    expect(await send('post', '/warehouses', { name: SURROGATE, type: 'SECONDARY' })).toEqual(
      refused,
    );
    expect(
      await send('post', `/clients/${client.id}/adjustments`, { amount: '10', reason: SURROGATE }),
    ).toEqual(refused);
    expect(await send('post', '/clients', { code: 'H2', name: 'ok', note: SURROGATE })).toEqual(
      refused,
    );
    // Nested, and as a key.
    expect(
      await send('post', '/clients', { code: 'H3', name: 'ok', extra: [{ [SURROGATE]: 1 }] }),
    ).toEqual(refused);
  });

  it('the same routes still take ordinary values, and the largest amount allowed', async () => {
    expect(
      (await send('post', '/payments', { clientId: client.id, mode: 'ESPECES', amount: '1500,50' }))
        .status,
    ).toBe(201);
    expect(
      (
        await send('post', `/clients/${client.id}/adjustments`, {
          amount: '9999999999.99',
          reason: 'Plafond',
        })
      ).status,
    ).toBe(201);
    expect(
      (await send('post', '/warehouses', { name: 'Dépôt « été » 😀 مخزن', type: 'SECONDARY' }))
        .status,
    ).not.toBe(400);
  });
});
