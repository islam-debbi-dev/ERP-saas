/**
 * Chains 12 to 14 (audit 02): supplier payments, cheques and aging; dépenses, loyer and
 * the résultat net of the Vue d'ensemble; trésorerie.
 * Rules: docs/domain.md, "Suppliers", "Aging" (phase 21), "Charges et loyers" (phase 25),
 * "Vue d'ensemble" (phase 26) and "Trésorerie" (phase 34).
 */
import Decimal from 'decimal.js';
import { area, assert, check } from '../../lib/harness.ts';
import {
  addDays,
  algiersToday,
  assertContiguous,
  cashAccounts,
  client,
  company,
  D,
  dbRead,
  monthDays,
  monthOf,
  openingStock,
  product,
  same,
  supplier,
} from '../../lib/audit.ts';
import { query } from '../../lib/db.ts';

interface Aging {
  rows: { party: { id: string }; balance: string; buckets: Record<string, string> }[];
  totals: { balance: string; buckets: Record<string, string> };
}
const sumBuckets = (b: Record<string, string>): Decimal =>
  Object.values(b).reduce((acc, v) => acc.plus(v), D(0));

// ------------------------------------------------------------------ 12. credit
export async function creditChain(): Promise<void> {
  area('12. Règlements fournisseur, chèques, balances âgées');
  const c = await company('Credit');
  const t = c.tenantId;
  const today = algiersToday();
  const accounts = await cashAccounts(c);
  const caisse = accounts.find((a) => a.type === 'CAISSE' && a.isDefault)!;
  const banque = accounts.find((a) => a.type === 'BANQUE' && a.isDefault)!;
  await c.owner.post(`/cash-accounts/${caisse.id}/opening`, {
    amount: '100000',
    date: addDays(today, -60),
  });
  await c.owner.post(`/cash-accounts/${banque.id}/opening`, {
    amount: '200000',
    date: addDays(today, -60),
  });

  const f = await supplier(c, 'Grossiste Sétif');
  const p = await product(c, { priceHt: '1000' });

  // BR: 50 pièces at 400 DA HT, TVA 19 % = 23 800 TTC, 3 800 paid in cash at reception.
  const draft = await c.owner.post<{ id: string }>('/purchases', {
    supplierId: f,
    documentDate: today,
    paidAmount: '3800',
    paidMode: 'ESPECES',
    lines: [{ productId: p.id, unitId: p.unitId, qty: '50', unitCost: '400' }],
  });
  await c.owner.post(`/purchases/${draft.id}/validate`, {});
  await check(
    'a BR paid in part at reception leaves the rest as a debt and takes the cash',
    async () => {
      same(await dbRead.stock(t, p.id), '50', 'stock');
      same(await dbRead.supplierBalance(t, f), '20000', 'supplier balance');
      same(await dbRead.supplierLedger(t, f), '20000', 'supplier ledger');
      same(await dbRead.cashBalance(t, caisse.id), '96200', 'caisse');
      const rgf = await query<{ number: string; purchaseId: string | null; amount: string }>(
        `SELECT "number", "purchaseId"::text, amount::text FROM supplier_payments WHERE "tenantId" = $1::uuid`,
        [t],
      );
      assert(
        rgf.length === 1 && rgf[0]!.purchaseId === draft.id,
        `RGF rows: ${JSON.stringify(rgf)}`,
      );
      assert(/^RGF-\d{4}-000001$/.test(rgf[0]!.number), `RGF number ${rgf[0]!.number}`);
    },
  );

  const cheque = await c.owner.post<{ id: string; number: string }>('/supplier-payments', {
    supplierId: f,
    amount: '5000',
    mode: 'CHEQUE',
    reference: 'CHQ-778',
    bank: 'BNA',
    dueDate: addDays(today, 3),
  });
  await check('a cheque to the supplier lowers the debt and leaves the bank', async () => {
    same(await dbRead.supplierBalance(t, f), '15000', 'supplier balance');
    same(await dbRead.cashBalance(t, banque.id), '195000', 'banque');
  });
  await check('the cheque is listed among the cheques due this week', async () => {
    const dash = await c.owner.read<{ cheques: unknown }>('/dashboard');
    const text = JSON.stringify(dash.cheques);
    assert(
      text.includes(cheque.number) || text.includes('CHQ-778'),
      `the dashboard cheques do not show ${cheque.number}: ${text.slice(0, 300)}`,
    );
  });
  await c.owner.post(`/supplier-payments/${cheque.id}/cancel`, { reason: 'Audit: chèque annulé' });
  await check(
    'cancelling the règlement brings the debt and the money back, nothing deleted',
    async () => {
      same(await dbRead.supplierBalance(t, f), '20000', 'supplier balance');
      same(await dbRead.cashBalance(t, banque.id), '200000', 'banque');
      const rows = await query<{ n: string }>(
        `SELECT COUNT(*)::text AS n FROM supplier_payments WHERE "tenantId" = $1::uuid`,
        [t],
      );
      assert(rows[0]!.n === '2', `supplier_payments rows=${rows[0]!.n}`);
    },
  );
  await check('the supplier aging sums to the balance, all in 0-30 days', async () => {
    const aging = await c.owner.read<Aging>('/reports/supplier-aging');
    const row = aging.rows.find((r) => r.party.id === f);
    assert(!!row, 'supplier missing from the aging');
    same(row!.balance, '20000', 'aged balance');
    same(sumBuckets(row!.buckets).toString(), '20000', 'sum of the buckets');
    same(row!.buckets['d0_30']!, '20000', '0-30 bucket');
  });

  // Client side: a BL dated 45 days ago (1 190), one today (2 380), then 500 paid.
  await openingStock(c, p, '10', '400').catch(() => undefined);
  const cl = await client(c, 'Client âgé');
  const sell = async (date: string, qty: string): Promise<string> =>
    (
      await c.owner.post<{ sale: { id: string } }>('/sales/quick', {
        type: 'BL',
        clientId: cl,
        documentDate: date,
        lines: [{ productId: p.id, unitId: p.unitId, qty, unitPriceHt: '1000' }],
        paidAmount: '0',
      })
    ).sale.id;
  await sell(addDays(today, -45), '1');
  await sell(today, '2');
  await c.owner.post('/payments', { clientId: cl, amount: '500', mode: 'ESPECES' });
  await check(
    'the client aging puts each debt in its bucket and a versement on the oldest',
    async () => {
      const aging = await c.owner.read<Aging>('/reports/aging');
      const row = aging.rows.find((r) => r.party.id === cl);
      assert(!!row, 'client missing from the aging');
      same(row!.balance, '3070', 'aged balance');
      same(sumBuckets(row!.buckets).toString(), '3070', 'sum of the buckets');
      same(row!.buckets['d31_60']!, '690', '31-60 bucket (1 190 - 500)');
      same(row!.buckets['d0_30']!, '2380', '0-30 bucket');
      same(aging.totals.balance, sumBuckets(aging.totals.buckets).toString(), 'totals');
    },
  );

  const chq = await c.owner.post<{ id: string }>('/payments', {
    clientId: cl,
    amount: '3000',
    mode: 'CHEQUE',
    reference: 'CHQ-CL-9',
    bank: 'CPA',
    dueDate: addDays(today, 2),
  });
  await check('a client cheque lowers his balance and goes to the bank', async () => {
    same(await dbRead.clientBalance(t, cl), '70', 'client balance');
    same(await dbRead.cashBalance(t, banque.id), '203000', 'banque');
  });
  await c.owner.post(`/payments/${chq.id}/bounce`, { reason: 'Sans provision', bankFees: '100' });
  await check(
    'a bounced cheque gives the debt back, plus the bank fees, and leaves the bank',
    async () => {
      same(await dbRead.clientBalance(t, cl), '3170', 'client balance');
      same(await dbRead.clientLedger(t, cl), '3170', 'client ledger');
      same(await dbRead.cashBalance(t, banque.id), '200000', 'banque');
      same(await dbRead.cashLedger(t, banque.id), '200000', 'bank ledger');
      const aging = await c.owner.read<Aging>('/reports/aging');
      const row = aging.rows.find((r) => r.party.id === cl)!;
      same(sumBuckets(row.buckets).toString(), '3170', 'aging after the bounce');
    },
  );
  await check('the relevé of the client ends on his balance', async () => {
    const st = await c.owner.read<Record<string, unknown>>(
      `/clients/${cl}/statement?from=${addDays(today, -60)}&to=${today}`,
    );
    const closing = (st['closingBalance'] ?? st['closing'] ?? st['balance']) as string | undefined;
    assert(
      closing !== undefined,
      `no closing balance in the statement: ${Object.keys(st).join(',')}`,
    );
    same(closing, '3170', 'statement closing balance');
  });
  await check('numbers: BR, RGF, VER, BL have no gap', async () => {
    await assertContiguous(t, 'purchases', 'BR');
    await assertContiguous(t, 'supplier_payments', 'RGF');
    await assertContiguous(t, 'payments', 'VER');
    await assertContiguous(t, 'sales', 'BL');
  });
}

// ------------------------------------------------------------------ 13. charges
export async function chargesChain(): Promise<void> {
  area("13. Dépenses, loyer au prorata, résultat net de la Vue d'ensemble");
  const c = await company('Charges');
  const t = c.tenantId;
  const today = algiersToday();
  const month = monthOf(today);
  const first = `${month}-01`;
  const days = monthDays(month);
  const last = days[days.length - 1]!;
  const accounts = await cashAccounts(c);
  const caisse = accounts.find((a) => a.type === 'CAISSE' && a.isDefault)!;
  await c.owner.post(`/cash-accounts/${caisse.id}/opening`, { amount: '300000', date: first });

  const p = await product(c, { priceHt: '1000' });
  await openingStock(c, p, '100', '500');
  // One sale today: 10 pièces at 1 000 HT, cost 500: margin 5 000.
  await c.owner.post('/sales/quick', {
    type: 'BL',
    clientId: null,
    documentDate: today,
    lines: [{ productId: p.id, unitId: p.unitId, qty: '10', unitPriceHt: '1000' }],
    paidAmount: '11900',
    paymentMode: 'ESPECES',
  });

  const cats =
    await c.owner.read<{ id: string; key: string | null; name: string }[]>('/expense-categories');
  const elec =
    cats.find((k) => k.key === 'ELECTRICITY') ?? cats.find((k) => /lectri/i.test(k.name));
  const other = cats.find((k) => k.key === 'OTHER') ?? cats.find((k) => /Autre/i.test(k.name));
  assert(!!elec && !!other, `categories: ${cats.map((k) => `${k.key}:${k.name}`).join(', ')}`);

  // A monthly lease of 60 000 DA from the 1st: each day of the month costs 60 000 / days.
  const bail = await c.owner.post<{ id: string }>(
    '/rent-contracts',
    {
      landlordName: 'Bailleur Audit',
      amount: '60000',
      period: 'MONTHLY',
      startDate: first,
    },
    null,
  );
  // Electricity 9 000 today (no period); insurance 36 500 for the 365 days of the year: 100 a day.
  const year = today.slice(0, 4);
  await c.owner.post('/expenses', {
    categoryId: elec!.id,
    amount: '9000',
    date: today,
    mode: 'ESPECES',
    payee: 'Sonelgaz',
  });
  const leap = new Date(Date.UTC(Number(year), 1, 29)).getUTCMonth() === 1;
  const yearDays = leap ? 366 : 365;
  await c.owner.post('/expenses', {
    categoryId: other!.id,
    amount: String(yearDays * 100),
    date: today,
    mode: 'ESPECES',
    periodStart: `${year}-01-01`,
    periodEnd: `${year}-12-31`,
    payee: 'Assurance',
  });
  // The rent of the month is paid in cash: money out, not a second charge.
  const rentPayment = await c.owner.post<{ id: string; number: string }>('/expenses', {
    rentContractId: bail.id,
    amount: '60000',
    date: today,
    mode: 'ESPECES',
    periodStart: first,
    periodEnd: last,
  });

  const elapsed = days.indexOf(today) + 1;
  const rent = D(60000).times(elapsed).div(days.length).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  const insurance = D(100).times(elapsed);
  const expected = rent.plus(9000).plus(insurance);
  await check(
    `the charges of ${first}..${today} are the rent by day + the dépenses, the rent payment apart`,
    async () => {
      const r = await c.owner.read<{
        rent: string;
        expenses: string;
        total: string;
        rentPaid: string;
      }>(`/reports/charges?from=${first}&to=${today}`);
      same(r.rent, rent, `rent of ${elapsed} days out of ${days.length}`);
      same(r.expenses, insurance.plus(9000), 'other charges');
      same(r.total, expected, 'total charges');
      same(r.rentPaid, '60000', 'rent paid (cash)');
    },
  );
  await check('a whole month of a monthly lease costs exactly its amount', async () => {
    const r = await c.owner.read<{ rent: string }>(`/reports/charges?from=${first}&to=${last}`);
    same(r.rent, '60000', 'rent of the whole month');
  });
  await check(
    "the Vue d'ensemble: résultat net = marge - charges, cash out = every dépense paid",
    async () => {
      const o = await c.owner.read<{
        total: {
          margin: string | null;
          charges: string | null;
          netResult: string | null;
          cashIn: string;
          cashOut: { expenses: string; total: string };
          sales: { ttc: string };
        };
      }>(`/reports/overview?from=${first}&to=${today}`);
      same(o.total.sales.ttc, '11900', 'CA TTC');
      same(o.total.margin, '5000', 'marge');
      same(o.total.charges, expected, 'charges');
      same(o.total.netResult, D(5000).minus(expected), 'résultat net');
      same(o.total.cashIn, '11900', 'encaissements');
      same(
        o.total.cashOut.expenses,
        D(9000)
          .plus(yearDays * 100)
          .plus(60000),
        'décaissements (dépenses)',
      );
    },
  );
  await check('the caisse holds the sale minus the three dépenses', async () => {
    const want = D(300000)
      .plus(11900)
      .minus(9000)
      .minus(yearDays * 100)
      .minus(60000);
    same(await dbRead.cashBalance(t, caisse.id), want, 'caisse');
    same(await dbRead.cashLedger(t, caisse.id), want, 'caisse ledger');
  });
  await check('paying the same rent period twice is refused', async () => {
    const res = await c.owner.send<{ code?: string }>('POST', '/expenses', {
      rentContractId: bail.id,
      amount: '60000',
      date: today,
      mode: 'ESPECES',
      periodStart: first,
      periodEnd: last,
    });
    assert(res.status >= 400 && res.status < 500, `HTTP ${res.status}`);
    assert(res.body.code === 'RENT_PERIOD_INVALID', `code=${res.body.code}`);
  });
  await c.owner.post(`/expenses/${rentPayment.id}/cancel`, { reason: 'Audit: mauvais mode' });
  await check('cancelling the rent payment gives the cash back and changes no charge', async () => {
    const want = D(300000)
      .plus(11900)
      .minus(9000)
      .minus(yearDays * 100);
    same(await dbRead.cashBalance(t, caisse.id), want, 'caisse');
    const r = await c.owner.read<{ total: string; rentPaid: string }>(
      `/reports/charges?from=${first}&to=${today}`,
    );
    same(r.total, expected, 'total charges');
    same(r.rentPaid, '0', 'rent paid');
    await assertContiguous(t, 'expenses', 'DEP');
  });
}

// ------------------------------------------------------------------ 14. treasury
export async function treasuryChain(): Promise<void> {
  area('14. Trésorerie: ouverture, virement interne, comptage, payé à la réception');
  const c = await company('Tresorerie');
  const t = c.tenantId;
  const today = algiersToday();
  const accounts = await cashAccounts(c);
  const caisse = accounts.find((a) => a.type === 'CAISSE' && a.isDefault)!;
  const banque = accounts.find((a) => a.type === 'BANQUE' && a.isDefault)!;
  const bal = (id: string) => dbRead.cashBalance(t, id);

  await c.owner.post(`/cash-accounts/${caisse.id}/opening`, { amount: '100000', date: today });
  await check('an opening sets the balance; a second one is refused', async () => {
    same(await bal(caisse.id), '100000', 'caisse');
    const again = await c.owner.send('POST', `/cash-accounts/${caisse.id}/opening`, {
      amount: '5',
      date: today,
    });
    assert(again.status >= 400 && again.status < 500, `second opening answered ${again.status}`);
    same(await bal(caisse.id), '100000', 'caisse after the refused opening');
  });

  const trf = await c.owner.post<{ id: string; number?: string }>('/treasury/transfers', {
    fromAccountId: caisse.id,
    toAccountId: banque.id,
    amount: '30000',
    note: 'Dépôt en banque',
  });
  await check('a transfer moves money between two accounts and sums to zero', async () => {
    same(await bal(caisse.id), '70000', 'caisse');
    same(await bal(banque.id), '30000', 'banque');
    const sum = await query<{ s: string }>(
      `SELECT COALESCE(SUM(amount), 0)::text AS s FROM cash_movements WHERE "tenantId" = $1::uuid AND "refId" = $2::uuid`,
      [t, trf.id],
    );
    same(sum[0]!.s, '0', 'the two movements of the transfer');
  });
  await check('a transfer above the balance is refused (CASH_INSUFFICIENT)', async () => {
    const res = await c.owner.send<{ code?: string }>('POST', '/treasury/transfers', {
      fromAccountId: caisse.id,
      toAccountId: banque.id,
      amount: '70000.01',
    });
    assert(res.status >= 400 && res.status < 500, `HTTP ${res.status}`);
    assert(res.body.code === 'CASH_INSUFFICIENT', `code=${res.body.code}`);
    same(await bal(caisse.id), '70000', 'caisse');
  });
  await check('a comptage needs a reason when it differs, then posts the écart', async () => {
    const noReason = await c.owner.send('POST', `/cash-accounts/${caisse.id}/counts`, {
      counted: '69500',
    });
    assert(
      noReason.status >= 400 && noReason.status < 500,
      `count without a reason answered ${noReason.status}`,
    );
    await c.owner.post(`/cash-accounts/${caisse.id}/counts`, {
      counted: '69500',
      reason: 'Erreur de rendu monnaie',
    });
    same(await bal(caisse.id), '69500', 'caisse after the count');
    const adj = await query<{ amount: string }>(
      `SELECT amount::text FROM cash_movements WHERE "tenantId" = $1::uuid AND type = 'COUNT_ADJUST'`,
      [t],
    );
    assert(adj.length === 1, `COUNT_ADJUST rows=${adj.length}`);
    same(adj[0]!.amount, '-500', 'COUNT_ADJUST');
  });

  const f = await supplier(c, 'Fournisseur local');
  const p = await product(c);
  const draft = await c.owner.post<{ id: string }>('/purchases', {
    supplierId: f,
    documentDate: today,
    paidAmount: '10000',
    paidMode: 'ESPECES',
    lines: [{ productId: p.id, unitId: p.unitId, qty: '20', unitCost: '500' }],
  });
  await c.owner.post(`/purchases/${draft.id}/validate`, {});
  const rgf = (
    await query<{ id: string }>(
      `SELECT id FROM supplier_payments WHERE "tenantId" = $1::uuid AND "purchaseId" = $2::uuid`,
      [t, draft.id],
    )
  )[0];
  await check('paid at reception is a real règlement, from the caisse', async () => {
    assert(!!rgf, 'no supplier payment linked to the BR');
    same(await bal(caisse.id), '59500', 'caisse');
    // 20 x 500 x 1.19 = 11 900 TTC, 10 000 paid.
    same(await dbRead.supplierBalance(t, f), '1900', 'supplier balance');
  });
  await check('that règlement cannot be cancelled alone', async () => {
    const res = await c.owner.send<{ code?: string }>(
      'POST',
      `/supplier-payments/${rgf!.id}/cancel`,
      { reason: 'Audit: seul' },
    );
    assert(
      res.body.code === 'SUPPLIER_PAYMENT_LINKED_TO_PURCHASE',
      `HTTP ${res.status} code=${res.body.code}`,
    );
    same(await bal(caisse.id), '59500', 'caisse');
  });
  await c.owner.post(`/purchases/${draft.id}/cancel`, { reason: 'Audit: BR en double' });
  await check(
    'cancelling the BR cancels its règlement: supplier at zero, cash and stock back',
    async () => {
      same(await dbRead.supplierBalance(t, f), '0', 'supplier balance');
      same(await dbRead.supplierLedger(t, f), '0', 'supplier ledger');
      same(await bal(caisse.id), '69500', 'caisse');
      same((await dbRead.stock(t, p.id)) ?? '0', '0', 'stock');
    },
  );
  await c.owner.post(`/treasury/transfers/${trf.id}/cancel`, { reason: 'Audit: mauvais compte' });
  await check('cancelling the transfer reverses both sides', async () => {
    same(await bal(caisse.id), '99500', 'caisse');
    same(await bal(banque.id), '0', 'banque');
    same(await dbRead.cashLedger(t, caisse.id), '99500', 'caisse ledger');
    same(await dbRead.cashLedger(t, banque.id), '0', 'bank ledger');
  });
  await check('GET /treasury/reconcile finds no difference', async () => {
    const r = await c.owner.read<Record<string, unknown>>('/treasury/reconcile');
    const text = JSON.stringify(r);
    const diffs = (r['differences'] ?? r['diffs'] ?? r['accounts']) as unknown[] | undefined;
    assert(
      r['ok'] === true || (Array.isArray(diffs) && diffs.length === 0),
      `reconcile: ${text.slice(0, 300)}`,
    );
  });
}
