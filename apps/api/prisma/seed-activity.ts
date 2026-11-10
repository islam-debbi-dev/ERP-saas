/**
 * Demo activity for the dashboard (phase 33), so "À faire aujourd'hui" has something on a
 * normal day of "Grossiste Demo": a client over his plafond, a product sold out after a
 * sale, and a client cheque due today.
 *
 * It goes through the running API as the demo owner, never through raw SQL: every money
 * and stock row is written by the real services (ledger, CUMP, numbering, caisse, audit).
 * Idempotent: fixed Idempotency-Keys (replays return the first response) and a check
 * before each step. The cheque is per day: a run on a day without one due adds one.
 *
 *   pnpm db:seed && pnpm dev   # then, in another terminal:
 *   pnpm db:seed:activity      # API_URL defaults to http://localhost:3001
 */
import 'dotenv/config';

const API = (process.env['API_URL'] ?? 'http://localhost:3001').replace(/\/$/, '');
const EMAIL = 'demo@grossiste.dz';
const PASSWORD = process.env['SEED_OWNER_PASSWORD'] ?? 'Demo1234!';
const PRODUCT_REF = 'DEMO-HUILE-5L';

const today = new Date(Date.now() + 3_600_000).toISOString().slice(0, 10);
const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

let token = '';

async function call<T>(
  method: 'GET' | 'POST',
  path: string,
  body?: object,
  key?: string,
): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Client-Type': 'native',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(key ? { 'Idempotency-Key': key } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${text}`);
  return (text ? JSON.parse(text) : undefined) as T;
}

interface Client {
  id: string;
  code: string;
  balance: string;
  creditLimit: string | null;
}

async function main(): Promise<void> {
  const auth = await call<{ accessToken: string }>('POST', '/auth/login', {
    identifier: EMAIL,
    password: PASSWORD,
  });
  token = auth.accessToken;

  const clients = (await call<{ items: Client[] }>('GET', '/clients?search=TRN-&limit=100')).items;
  const byCode = (code: string) => {
    const c = clients.find((x) => x.code === code);
    if (!c) throw new Error(`Demo client ${code} missing: run pnpm db:seed first`);
    return c;
  };

  // 1. Over his plafond (150 000, set by the seed): an old debt of 185 000 DA, once.
  const benali = byCode('TRN-002');
  if (Number(benali.balance) <= 0) {
    await call(
      'POST',
      `/clients/${benali.id}/opening-balance`,
      { amount: '185000.00', note: 'Démo : ancien crédit' },
      'seed33-opening-trn002',
    );
    console.log('Seed activity: TRN-002 owes 185 000 DA (over his plafond).');
  }

  // 2. A product that sold out: 2 cartons in, 2 cartons sold.
  const units = await call<{ id: string; code: string }[]>('GET', '/units');
  const levels = await call<{ id: string }[]>('GET', '/price-levels');
  const piece = units.find((u) => u.code === 'PIECE')!.id;
  const carton = units.find((u) => u.code === 'CARTON')!.id;
  const found = (
    await call<{ items: { id: string; reference: string }[] }>(
      'GET',
      `/products?search=${PRODUCT_REF}`,
    )
  ).items.find((p) => p.reference === PRODUCT_REF);
  const productId =
    found?.id ??
    (
      await call<{ id: string }>('POST', '/products', {
        reference: PRODUCT_REF,
        designation: 'Huile de table 5 L',
        baseUnitId: piece,
        tvaRate: '19',
        minStock: '4',
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
            factorToBase: '4',
            barcode: null,
            isDefaultSale: true,
            isDefaultPurchase: true,
          },
        ],
        prices: levels
          .slice(0, 1)
          .map((l) => ({ unitId: carton, priceLevelId: l.id, priceHt: '4600' })),
      })
    ).id;
  const stock = await call<{ qtyBase: string }>('GET', `/stock/${productId}`);
  if (!found) {
    await call(
      'POST',
      '/stock/opening',
      { lines: [{ productId, unitId: carton, qty: '2', unitCost: '4200' }] },
      'seed33-stock-huile',
    );
    await call(
      'POST',
      '/sales/quick',
      {
        documentDate: today,
        clientId: byCode('TRN-003').id,
        lines: [{ productId, unitId: carton, qty: '2', unitPriceHt: '4600' }],
      },
      'seed33-sale-huile',
    );
    console.log('Seed activity: "Huile de table 5 L" sold out.');
  } else if (Number(stock.qtyBase) > 0) {
    console.log('Seed activity: the demo oil is back in stock; left as it is.');
  }

  // 3. A client cheque due today, unless one is already due (or a few days late).
  const cheques = (
    await call<{ items: { dueDate: string | null }[] }>(
      'GET',
      '/payments?mode=CHEQUE&status=VALID&sort=dueDate&limit=100',
    )
  ).items;
  const due = cheques.some(
    (c) => c.dueDate && c.dueDate >= addDays(today, -7) && c.dueDate <= today,
  );
  if (!due) {
    const amel = byCode('TRN-001');
    await call(
      'POST',
      '/payments',
      {
        clientId: amel.id,
        amount: '38500.00',
        mode: 'CHEQUE',
        reference: `CH-${today.replaceAll('-', '')}`,
        bank: 'BNA',
        dueDate: today,
        note: 'Démo : chèque à encaisser',
      },
      `seed33-cheque-${today}`,
    );
    console.log('Seed activity: a cheque of 38 500 DA from TRN-001 is due today.');
  }
  console.log('Seed activity: done.');
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
