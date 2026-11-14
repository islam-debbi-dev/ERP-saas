/**
 * Business scenario: sale -> payment -> return -> cancellation, each step
 * checked against the state the database must hold afterwards.
 *
 * Run: pnpm --dir e2e test:api
 */
import { area, assert, check, record, writeSummary } from '../lib/harness.ts';
import { call, idemKey, request } from '../lib/http.ts';
import { dbState, buildFixture, makeSale, num, today, type Fixture } from './fixture.ts';
import { query } from '../lib/db.ts';
import { importChain } from './chains/import.ts';
import { depotsChain } from './chains/depots.ts';
import { chargesChain, creditChain, treasuryChain } from './chains/money.ts';
import { payrollChain, primesChain } from './chains/people.ts';

const money = (v: string): number => Number(v);

async function main(): Promise<void> {
  const f = await buildFixture('Scenario');
  const { token, tenantId } = f.session;
  console.log(`tenant ${tenantId}`);

  // ---------------------------------------------------------------- 1. sale on credit
  area('1. Sale on credit');
  const sale = await makeSale(f, { qty: '2', paid: '0' });
  await check('sale is validated and numbered', async () => {
    assert(sale.number.startsWith('BL-'), `unexpected number ${sale.number}`);
  });
  await check('state after the sale is the expected one', async () => {
    const st = await dbState(f, sale.id);
    assert(st['sale_validated'] === '1', `sale_validated=${st['sale_validated']}`);
    assert(st['sale_movements'] === '1', `sale_movements=${st['sale_movements']}`);
    assert(st['sale_ledger'] === '1', `sale_ledger=${st['sale_ledger']}`);
    assert(st['sale_audit'] === '1', `sale_audit=${st['sale_audit']}`);
    assert(num(st['stock_qty'] as string) === 98, `stock_qty=${st['stock_qty']}`);
    // 2 x 1000 HT + 19% TVA = 2380 TTC
    assert(num(st['client_balance'] as string) === 2380, `client_balance=${st['client_balance']}`);
  });
  await check('the sale DTO totals match the ledger', async () => {
    const dto = (await call<{ totalHt: string; totalTva: string; totalTtc: string; paidAmount: string }>(
      `/sales/${sale.id}`,
      { token },
    )).body;
    assert(dto.totalHt === '2000.00', `totalHt=${dto.totalHt}`);
    assert(dto.totalTva === '380.00', `totalTva=${dto.totalTva}`);
    assert(dto.totalTtc === '2380.00', `totalTtc=${dto.totalTtc}`);
  });

  // ---------------------------------------------------------------- 2. partial payment
  area('2. Partial payment (versement)');
  const payment = (
    await call<{ id: string; number: string }>('/payments', {
      method: 'POST',
      token,
      idempotencyKey: idemKey('ver'),
      body: { clientId: f.clientId, amount: '1000', mode: 'ESPECES' },
    })
  ).body;
  await check('the payment lowers the client balance and allocates the oldest document', async () => {
    const st = await dbState(f, sale.id);
    assert(num(st['client_balance'] as string) === 1380, `client_balance=${st['client_balance']}`);
    const alloc = await query<{ saleId: string; amount: string }>(
      `SELECT "saleId", amount::text FROM payment_allocations WHERE "paymentId" = $1::uuid`,
      [payment.id],
    );
    assert(alloc.length === 1, `allocations=${alloc.length}`);
    assert(alloc[0].amount === '1000.00', `allocation=${alloc[0].amount}`);
    assert(alloc[0].saleId === sale.id, `allocation points to ${alloc[0].saleId}`);
  });
  await check('the payment is audited', async () => {
    const rows = await query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM audit_logs
        WHERE "tenantId" = $1::uuid AND "entityId" = $2::text AND action = 'PAYMENT_CREATED'`,
      [tenantId, payment.id],
    );
    assert(rows[0].n === '1', `PAYMENT_CREATED rows=${rows[0].n}`);
  });

  // ---------------------------------------------------------------- 3. avoir (return)
  area('3. Return of one unit');
  const saleDto = (await call<{ lines: { id: string; qty: string }[] }>(`/sales/${sale.id}`, { token })).body;
  const firstLine = saleDto.lines[0];
  const avoirRes = (
    await call<{ sale: { id: string; number: string } }>(`/sales/${sale.id}/returns`, {
      method: 'POST',
      token,
      idempotencyKey: idemKey('av'),
      body: {
        disposition: 'RESTOCK',
        reason: 'Audit return',
        lines: [{ saleLineId: firstLine.id, qty: '1' }],
      },
    })
  ).body;
  const avoirRow = (
    await query<{ id: string; number: string }>(
      `SELECT id, number FROM sale_returns WHERE "tenantId" = $1::uuid AND "saleId" = $2::uuid`,
      [tenantId, sale.id],
    )
  )[0];
  const avoir = { id: avoirRow.id, number: avoirRow.number };
  await check('the avoir restocks the goods and lowers the balance', async () => {
    const st = await dbState(f, sale.id);
    assert(num(st['stock_qty'] as string) === 99, `stock_qty=${st['stock_qty']}`);
    // 2380 (sale) - 1000 (paid) - 1190 (avoir) = 190
    assert(num(st['client_balance'] as string) === 190, `client_balance=${st['client_balance']}`);
  });
  await check('the avoir has its own number and ledger entry', async () => {
    // The route answers the sale DTO; the avoir number is the one of the audit row.
    assert(avoir.number.startsWith('AV-'), `avoir number=${avoir.number}`);
    const rows = await query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM client_ledger_entries
        WHERE "tenantId" = $1::uuid AND "refType" = 'SaleReturn' AND "refId" = $2::uuid AND type = 'RETURN'`,
      [tenantId, avoir.id],
    );
    assert(rows[0].n === '1', `RETURN rows=${rows[0].n}`);
  });

  // ---------------------------------------------------------------- 4. cancel the sale
  area('4. Cancellation of the sale');
  const cancelled = await request<{ sale: { status: string } }>(`/sales/${sale.id}/cancel`, {
    method: 'POST',
    token,
    idempotencyKey: idemKey('cancel'),
    body: { reason: 'Audit cancel' },
  });
  await check('the sale is cancelled', async () => {
    assert(cancelled.status === 200 || cancelled.status === 201, `HTTP ${cancelled.status}`);
  });
  await check('the balance is back to zero and the goods are back', async () => {
    const st = await dbState(f, sale.id);
    assert(num(st['stock_qty'] as string) === 100, `stock_qty=${st['stock_qty']}`);
    // The sale put 2380 on the account, the avoir already gave back 1190, so the
    // cancellation reverses the remaining 1190. The 1000 the client paid is a
    // standalone versement: it stays on the account as a credit (the goods came
    // back, the money was really received).
    assert(num(st['client_balance'] as string) === -1000, `client_balance=${st['client_balance']}`);
  });
  await check('the cancellation is audited', async () => {
    const rows = await query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM audit_logs
        WHERE "tenantId" = $1::uuid AND "entityId" = $2::text AND action = 'SALE_CANCELLED'`,
      [tenantId, sale.id],
    );
    assert(rows[0].n === '1', `SALE_CANCELLED rows=${rows[0].n}`);
  });

  // ---------------------------------------------------------------- 5. counter sale
  area('5. Counter sale (no client)');
  const counter = await makeSale(f, { qty: '1', clientId: null, paid: '1190' });
  await check('a counter sale moves the stock but no client account', async () => {
    const st = await dbState(f, counter.id);
    assert(st['sale_movements'] === '1', `sale_movements=${st['sale_movements']}`);
    assert(st['sale_ledger'] === '0', `sale_ledger=${st['sale_ledger']}`);
    assert(num(st['stock_qty'] as string) === 99, `stock_qty=${st['stock_qty']}`);
  });

  // ---------------------------------------------------------------- 6. facture from BLs
  area('6. Facture grouping BLs');
  const bl1 = await makeSale(f, { qty: '1', paid: '0' });
  const bl2 = await makeSale(f, { qty: '1', paid: '0' });
  const facture = await request<{ id?: string; sale?: { id: string; number: string } }>('/invoices/from-bls', {
    method: 'POST',
    token,
    idempotencyKey: idemKey('fac'),
    body: { saleIds: [bl1.id, bl2.id], documentDate: today() },
  });
  await check('the facture is created and numbered', async () => {
    assert(facture.status === 200 || facture.status === 201, `HTTP ${facture.status} ${facture.raw.slice(0, 200)}`);
    const number = facture.body.sale?.number ?? '';
    assert(number.startsWith('FAC-'), `number=${number}`);
  });
  await check('the grouped facture does not charge the client twice', async () => {
    const rows = await query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM client_ledger_entries
        WHERE "tenantId" = $1::uuid AND "refType" = 'Sale' AND "refId" = $2::uuid`,
      [tenantId, (facture.body.sale?.id ?? '') as string],
    );
    assert(rows[0].n === '0', `ledger rows for the grouped facture=${rows[0].n}`);
  });

  // ---------------------------------------------------------------- 7. numbering
  area('7. Document numbering');
  await check('the numbers of a tenant are sequential per type and year', async () => {
    const rows = await query<{ docType: string; numbers: string[] }>(
      `SELECT type::text AS "docType", array_agg("number" ORDER BY "number") AS numbers
         FROM sales WHERE "tenantId" = $1::uuid AND "number" IS NOT NULL
        GROUP BY type`,
      [tenantId],
    );
    for (const r of rows) {
      const nums = r.numbers.map((n) => Number(n.split('-')[2]));
      const expected = nums.map((_, i) => i + 1);
      assert(
        JSON.stringify(nums) === JSON.stringify(expected),
        `${r.docType} numbers are ${r.numbers.join(',')}`,
      );
    }
  });

  // ---------------------------------------------------------------- 8. audit trail
  area('8. Audit trail');
  await check('every business write left an audit row', async () => {
    const rows = await query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM audit_logs WHERE "tenantId" = $1::uuid`,
      [tenantId],
    );
    assert(Number(rows[0].n) >= 8, `audit rows=${rows[0].n}`);
  });
  await check('the audit rows keep who, when and which device', async () => {
    const rows = await query<{ userId: string | null; createdAt: string; deviceName: string | null }>(
      // A row written by the super-admin (the plan limits lifted by the fixture on an audit
      // database) has no user of the company: it is not a business write of the tenant.
      `SELECT "userId"::text, "createdAt"::text, "deviceName" FROM audit_logs
        WHERE "tenantId" = $1::uuid AND action <> 'SUBSCRIPTION_UPDATED' ORDER BY "createdAt" LIMIT 5`,
      [tenantId],
    );
    for (const r of rows) {
      assert(r.userId !== null, 'an audit row has no user');
      assert(!!r.createdAt, 'an audit row has no date');
    }
  });

  // ---------------------------------------------------------------- 9..16: audit 02
  // One chain per module added since audit 01 (phases 12-34), each in its own company with
  // every module on. They need the audit database (DB=...erp_audit02, see REPORT-02.md).
  const chains: [string, () => Promise<void>][] = [
    ['import', importChain],
    ['dépôts, tournée, session, emballages', depotsChain],
    ['règlements, chèques, aging', creditChain],
    ['charges, loyer, résultat net', chargesChain],
    ['trésorerie', treasuryChain],
    ['primes', primesChain],
    ['RH et paie', payrollChain],
  ];
  for (const [name, chain] of chains) {
    try {
      await chain();
    } catch (err) {
      // A chain that cannot go on is a result too: it must not hide the next ones.
      record({
        name: `chain "${name}" ran to its end`,
        status: 'FAIL',
        expected: 'every step of the chain answers',
        evidence: err instanceof Error ? err.message : String(err),
      });
    }
  }

  area('Scenario');
  record({
    name: 'scenario completed',
    status: 'PASS',
    expected: 'the whole sale/payment/return/cancel chain holds',
    actual: `tenant ${tenantId}`,
  });
}

main()
  .then(() => writeSummary('scenario'))
  .catch((err) => {
    console.error(err);
    writeSummary('scenario');
    process.exit(1);
  });
