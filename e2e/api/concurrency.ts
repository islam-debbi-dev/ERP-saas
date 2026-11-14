/**
 * Audit 02, part A.5: concurrency. Each race sends 20 requests at the same instant and then
 * reads what the database holds. Expected (AGENTS.md 3.6, 3.8, 3.10): no lost update, no
 * negative stock unless the tenant allows it, no duplicate effect, no gap in the numbers,
 * and never a 500 (a deadlock must not reach the client).
 *
 *   API=http://localhost:3003 DB=postgresql://erp:erp@localhost:5432/erp_audit02 \
 *     pnpm exec tsx api/concurrency.ts
 */
import { area, assert, check, writeSummary } from '../lib/harness.ts';
import {
  algiersToday,
  type Api,
  assertContiguous,
  cashAccounts,
  client,
  company,
  dbRead,
  invite,
  openingStock,
  product,
  proof,
  same,
  setSetting,
} from '../lib/audit.ts';
import { closeDb, query } from '../lib/db.ts';
import { idemKey, type ApiResponse } from '../lib/http.ts';
import { draftPayroll } from './chains/people.ts';

const N = 20;
const log: string[] = [];

interface Outcome {
  statuses: Record<string, number>;
  ok: ApiResponse<Record<string, unknown>>[];
  refused: ApiResponse<Record<string, unknown>>[];
  errors: ApiResponse<Record<string, unknown>>[];
}

/** Fires every request in the same tick and sorts the answers. */
async function race(
  name: string,
  calls: (() => Promise<ApiResponse<Record<string, unknown>>>)[],
): Promise<Outcome> {
  const res = await Promise.all(calls.map((c) => c()));
  const out: Outcome = { statuses: {}, ok: [], refused: [], errors: [] };
  for (const r of res) {
    const code = (r.body as { code?: string } | null)?.code;
    const k = code && r.status >= 400 ? `${r.status} ${code}` : String(r.status);
    out.statuses[k] = (out.statuses[k] ?? 0) + 1;
    if (r.status >= 500) out.errors.push(r);
    else if (r.status >= 400) out.refused.push(r);
    else out.ok.push(r);
  }
  log.push(`${name}: ${JSON.stringify(out.statuses)}`);
  console.log(`    ${name}: ${JSON.stringify(out.statuses)}`);
  return out;
}

const no500 = (o: Outcome): void =>
  assert(
    o.errors.length === 0,
    `${o.errors.length} answer(s) 5xx: ${o.errors[0]?.raw.slice(0, 200)}`,
  );

async function main(): Promise<void> {
  const today = algiersToday();

  // ------------------------------------------------------------ 1. the last unit
  area('C1. Two sellers, the last unit (20 at once)');
  {
    const c = await company('Race stock');
    const t = c.tenantId;
    const s1 = await invite(c, 'SELLER');
    const s2 = await invite(c, 'SELLER');
    const p = await product(c);
    const cl = await client(c);
    const quick =
      (who: Api, qty = '1') =>
      () =>
        who.send<Record<string, unknown>>('POST', '/sales/quick', {
          type: 'BL',
          clientId: cl,
          documentDate: today,
          warehouseId: c.mainWarehouseId,
          lines: [{ productId: p.id, unitId: p.unitId, qty }],
          paidAmount: '0',
        });

    await setSetting(c, { negativeStockMode: 'BLOCK' });
    await openingStock(c, p, '1', '500');
    const blocked = await race(
      'BLOCK, 1 in stock, 20 sales of 1',
      Array.from({ length: N }, (_, i) => quick(i % 2 ? s1.api : s2.api)),
    );
    await check('BLOCK: exactly one sale wins, the 19 others are refused cleanly', async () => {
      no500(blocked);
      assert(blocked.ok.length === 1, `${blocked.ok.length} sales went through`);
      assert(
        blocked.refused.every((r) => (r.body as { code?: string }).code === 'STOCK_INSUFFICIENT'),
        `refusals: ${JSON.stringify(blocked.statuses)}`,
      );
      same(await dbRead.stock(t, p.id), '0', 'stock');
      same(await dbRead.warehouseStock(t, p.id, c.mainWarehouseId), '0', 'dépôt principal');
      same(await dbRead.clientBalance(t, cl), '1190', 'client balance (one sale)');
    });
    await check('BLOCK: the refused sales burned no document number', async () => {
      await assertContiguous(t, 'sales', 'BL');
      const seq = await query<{ n: string }>(
        `SELECT "lastNumber"::text AS n FROM document_sequences WHERE "tenantId" = $1::uuid AND "docType" = 'BL'`,
        [t],
      );
      assert(seq[0]?.n === '1', `BL sequence is at ${seq[0]?.n}`);
    });

    await setSetting(c, { negativeStockMode: 'WARN' });
    const warned = await race(
      'WARN, 0 in stock, 20 sales of 1',
      Array.from({ length: N }, (_, i) => quick(i % 2 ? s1.api : s2.api)),
    );
    await check(
      'WARN: the 20 sales pass and the stock is exactly -20, equal to its ledger',
      async () => {
        no500(warned);
        assert(
          warned.ok.length === N,
          `${warned.ok.length} sales went through: ${JSON.stringify(warned.statuses)}`,
        );
        same(await dbRead.stock(t, p.id), '-20', 'stock');
        const ledger = await query<{ s: string }>(
          `SELECT SUM("qtyBase")::text AS s FROM stock_movements WHERE "tenantId" = $1::uuid AND "productId" = $2::uuid`,
          [t, p.id],
        );
        same(ledger[0]!.s, '-20', 'stock ledger');
        same(await dbRead.clientBalance(t, cl), String(1190 * 21), 'client balance (21 sales)');
        same(await dbRead.clientLedger(t, cl), String(1190 * 21), 'client ledger');
        await assertContiguous(t, 'sales', 'BL');
      },
    );

    // Two products sold in opposite orders: the classic deadlock.
    const a = await product(c);
    const b = await product(c);
    await openingStock(c, a, '1000', '500');
    await openingStock(c, b, '1000', '500');
    const two = (first: typeof a, second: typeof a) => () =>
      s1.api.send<Record<string, unknown>>('POST', '/sales/quick', {
        type: 'BL',
        clientId: cl,
        documentDate: today,
        warehouseId: c.mainWarehouseId,
        paidAmount: '0',
        lines: [
          { productId: first.id, unitId: first.unitId, qty: '1' },
          { productId: second.id, unitId: second.unitId, qty: '1' },
        ],
      });
    const dead = await race(
      'two products, opposite orders, 20 sales',
      Array.from({ length: N }, (_, i) => (i % 2 ? two(a, b) : two(b, a))),
    );
    await check(
      'sales locking two products in opposite orders never deadlock into a 500',
      async () => {
        no500(dead);
        assert(
          dead.ok.length === N,
          `${dead.ok.length} of ${N} went through: ${JSON.stringify(dead.statuses)}`,
        );
        same(await dbRead.stock(t, a.id), '980', 'product A');
        same(await dbRead.stock(t, b.id), '980', 'product B');
      },
    );

    // One draft validated 20 times, then the sale cancelled 20 times.
    const draft = await c.owner.post<{ id: string }>(
      '/sales',
      {
        type: 'BL',
        clientId: cl,
        documentDate: today,
        warehouseId: c.mainWarehouseId,
        lines: [{ productId: a.id, unitId: a.unitId, qty: '5' }],
      },
      null,
    );
    const validated = await race(
      'one draft validated 20 times',
      Array.from(
        { length: N },
        () => () =>
          c.owner.send<Record<string, unknown>>('POST', `/sales/${draft.id}/validate`, {
            paidAmount: '0',
            paymentMode: 'ESPECES',
            forceCredit: false,
          }),
      ),
    );
    await check('a draft validated 20 times at once is validated once', async () => {
      no500(validated);
      assert(validated.ok.length === 1, `${validated.ok.length} validations answered 2xx`);
      same(await dbRead.stock(t, a.id), '975', 'product A');
      const mv = await query<{ n: string }>(
        `SELECT COUNT(*)::text AS n FROM stock_movements WHERE "tenantId" = $1::uuid AND "refId" = $2::uuid`,
        [t, draft.id],
      );
      assert(mv[0]!.n === '1', `stock movements of the sale: ${mv[0]!.n}`);
    });
    const cancelled = await race(
      'one sale cancelled 20 times',
      Array.from(
        { length: N },
        () => () =>
          c.owner.send<Record<string, unknown>>('POST', `/sales/${draft.id}/cancel`, {
            reason: 'Audit: annulation concurrente',
          }),
      ),
    );
    await check('a sale cancelled 20 times at once is reversed once', async () => {
      no500(cancelled);
      assert(cancelled.ok.length === 1, `${cancelled.ok.length} cancellations answered 2xx`);
      same(await dbRead.stock(t, a.id), '980', 'product A back');
      const rev = await query<{ n: string }>(
        `SELECT COUNT(*)::text AS n FROM client_ledger_entries WHERE "tenantId" = $1::uuid AND "refId" = $2::uuid AND type = 'REVERSAL'`,
        [t, draft.id],
      );
      assert(rev[0]!.n === '1', `REVERSAL rows: ${rev[0]!.n}`);
      same(
        await dbRead.clientBalance(t, cl),
        await dbRead.clientLedger(t, cl),
        'client balance = ledger',
      );
    });
  }

  // ------------------------------------------------------------ 2. versements
  area('C2. Versements on one client (20 at once)');
  {
    const c = await company('Race versements');
    const t = c.tenantId;
    const p = await product(c);
    await openingStock(c, p, '100', '500');
    const cl = await client(c);
    await c.owner.post('/sales/quick', {
      type: 'BL',
      clientId: cl,
      documentDate: today,
      lines: [{ productId: p.id, unitId: p.unitId, qty: '10' }],
      paidAmount: '0',
    });
    const pays = await race(
      '20 versements of 100 DA',
      Array.from(
        { length: N },
        () => () =>
          c.owner.send<Record<string, unknown>>('POST', '/payments', {
            clientId: cl,
            amount: '100',
            mode: 'ESPECES',
          }),
      ),
    );
    await check(
      'no versement is lost: 11 900 - 20 x 100 = 9 900, ledger equal, numbers 1..20',
      async () => {
        no500(pays);
        assert(
          pays.ok.length === N,
          `${pays.ok.length} of ${N} versements went through: ${JSON.stringify(pays.statuses)}`,
        );
        same(await dbRead.clientBalance(t, cl), '9900', 'client balance');
        same(await dbRead.clientLedger(t, cl), '9900', 'client ledger');
        await assertContiguous(t, 'payments', 'VER');
        const alloc = await query<{ s: string }>(
          `SELECT COALESCE(SUM(amount), 0)::text AS s FROM payment_allocations WHERE "tenantId" = $1::uuid`,
          [t],
        );
        same(alloc[0]!.s, '2000', 'allocated on the sale');
        const caisse = (await cashAccounts(c)).find((a) => a.type === 'CAISSE' && a.isDefault)!;
        same(await dbRead.cashBalance(t, caisse.id), '2000', 'caisse');
        same(await dbRead.cashLedger(t, caisse.id), '2000', 'caisse ledger');
      },
    );

    // ---------------------------------------------------------- 4. the same key 20 times
    area('C4. The same Idempotency-Key sent 20 times');
    const key = idemKey('a2-same');
    const same20 = await race(
      'one key, 20 identical POST /payments',
      Array.from(
        { length: N },
        () => () =>
          c.owner.send<Record<string, unknown>>(
            'POST',
            '/payments',
            { clientId: cl, amount: '700', mode: 'ESPECES' },
            key,
          ),
      ),
    );
    await check(
      'one key creates one versement, whatever the number of copies in flight',
      async () => {
        no500(same20);
        const rows = await query<{ n: string }>(
          `SELECT COUNT(*)::text AS n FROM payments WHERE "tenantId" = $1::uuid AND amount = 700`,
          [t],
        );
        assert(rows[0]!.n === '1', `${rows[0]!.n} versements of 700 DA were created`);
        same(await dbRead.clientBalance(t, cl), '9200', 'client balance');
        await assertContiguous(t, 'payments', 'VER');
      },
    );
    await check(
      'every copy answers the original (2xx, same id) or "in progress" (409), nothing else',
      async () => {
        const ids = new Set(same20.ok.map((r) => (r.body as { id?: string }).id));
        assert(ids.size === 1, `the 2xx answers carry ${ids.size} different ids`);
        const odd = same20.refused.filter((r) => r.status !== 409);
        assert(odd.length === 0, `unexpected refusals: ${JSON.stringify(same20.statuses)}`);
      },
    );
    await check('the key replayed afterwards still answers the original', async () => {
      const again = await c.owner.send<{ id?: string }>(
        'POST',
        '/payments',
        { clientId: cl, amount: '700', mode: 'ESPECES' },
        key,
      );
      assert(again.status < 300, `replay answered ${again.status}`);
      assert(
        again.body.id === (same20.ok[0]!.body as { id?: string }).id,
        'the replay carries another id',
      );
      same(await dbRead.clientBalance(t, cl), '9200', 'client balance after the replay');
    });
  }

  // ------------------------------------------------------------ 3. cash transfers
  area('C3. Transfers out of one cash account (20 at once)');
  {
    const c = await company('Race caisse');
    const t = c.tenantId;
    const accounts = await cashAccounts(c);
    const caisse = accounts.find((a) => a.type === 'CAISSE' && a.isDefault)!;
    const banque = accounts.find((a) => a.type === 'BANQUE' && a.isDefault)!;
    await c.owner.post(`/cash-accounts/${caisse.id}/opening`, { amount: '1000', date: today });
    const out = await race(
      'caisse of 1 000 DA, 20 transfers of 100 DA',
      Array.from(
        { length: N },
        () => () =>
          c.owner.send<Record<string, unknown>>('POST', '/treasury/transfers', {
            fromAccountId: caisse.id,
            toAccountId: banque.id,
            amount: '100',
          }),
      ),
    );
    await check('exactly 10 transfers pass, the caisse ends at zero and never below', async () => {
      no500(out);
      assert(
        out.ok.length === 10,
        `${out.ok.length} transfers went through: ${JSON.stringify(out.statuses)}`,
      );
      assert(
        out.refused.every((r) => (r.body as { code?: string }).code === 'CASH_INSUFFICIENT'),
        JSON.stringify(out.statuses),
      );
      same(await dbRead.cashBalance(t, caisse.id), '0', 'caisse');
      same(await dbRead.cashLedger(t, caisse.id), '0', 'caisse ledger');
      same(await dbRead.cashBalance(t, banque.id), '1000', 'banque');
      await assertContiguous(t, 'cash_transfers', 'TRF');
    });
    // Both directions at once: the two balances are locked in id order, so no deadlock.
    const cross = await race(
      '20 transfers, both directions',
      Array.from(
        { length: N },
        (_, i) => () =>
          c.owner.send<Record<string, unknown>>(
            'POST',
            '/treasury/transfers',
            i % 2
              ? { fromAccountId: banque.id, toAccountId: caisse.id, amount: '10' }
              : { fromAccountId: caisse.id, toAccountId: banque.id, amount: '10' },
          ),
      ),
    );
    await check(
      'transfers in both directions never deadlock and the money stays 1 000 DA',
      async () => {
        no500(cross);
        const total =
          Number(await dbRead.cashBalance(t, caisse.id)) +
          Number(await dbRead.cashBalance(t, banque.id));
        assert(total === 1000, `caisse + banque = ${total}`);
        same(
          await dbRead.cashBalance(t, caisse.id),
          await dbRead.cashLedger(t, caisse.id),
          'caisse = ledger',
        );
        same(
          await dbRead.cashBalance(t, banque.id),
          await dbRead.cashLedger(t, banque.id),
          'banque = ledger',
        );
      },
    );
  }

  // ------------------------------------------------------------ 5. payroll approval
  area('C5. The same payroll run approved 20 times, then paid 20 times');
  {
    const c = await company('Race paie');
    const t = c.tenantId;
    const caisse = (await cashAccounts(c)).find((a) => a.type === 'CAISSE' && a.isDefault)!;
    await c.owner.post(`/cash-accounts/${caisse.id}/opening`, { amount: '500000', date: today });
    const { run, employeeId } = await draftPayroll(c);
    const net = run.payslips[0]!.netToPay;
    const approvals = await race(
      'one run approved 20 times',
      Array.from(
        { length: N },
        () => () =>
          c.owner.send<Record<string, unknown>>(
            'POST',
            `/payroll-runs/${run.id}/approve`,
            { version: run.version },
            null,
          ),
      ),
    );
    await check('one approval wins: one number, the salary posted once', async () => {
      no500(approvals);
      assert(
        approvals.ok.length === 1,
        `${approvals.ok.length} approvals answered 2xx: ${JSON.stringify(approvals.statuses)}`,
      );
      const due = await query<{ n: string; s: string }>(
        `SELECT COUNT(*)::text AS n, COALESCE(SUM(amount), 0)::text AS s FROM employee_ledger_entries
          WHERE "tenantId" = $1::uuid AND "employeeId" = $2::uuid AND type = 'SALARY_DUE'`,
        [t, employeeId],
      );
      assert(due[0]!.n === '1', `SALARY_DUE rows: ${due[0]!.n}`);
      const bal = await query<{ due: string }>(
        `SELECT "salaryDue"::text AS due FROM employee_balances WHERE "tenantId" = $1::uuid AND "employeeId" = $2::uuid`,
        [t, employeeId],
      );
      same(bal[0]!.due, net, 'salary due');
      const seq = await query<{ n: string }>(
        `SELECT "lastNumber"::text AS n FROM document_sequences WHERE "tenantId" = $1::uuid AND "docType" = 'PAIE'`,
        [t],
      );
      assert(seq[0]?.n === '1', `PAIE sequence is at ${seq[0]?.n}`);
    });
    const payments = await race(
      'the run paid 20 times (20 keys)',
      Array.from(
        { length: N },
        () => () =>
          c.owner.send<Record<string, unknown>>('POST', `/payroll-runs/${run.id}/payments`, {
            mode: 'ESPECES',
          }),
      ),
    );
    await check('a run paid 20 times at once is paid once', async () => {
      no500(payments);
      const paid = await query<{ n: string; s: string }>(
        `SELECT COUNT(*)::text AS n, COALESCE(SUM(amount), 0)::text AS s FROM expenses
          WHERE "tenantId" = $1::uuid AND "payrollRunId" = $2::uuid AND status = 'VALID'`,
        [t, run.id],
      );
      same(paid[0]!.s, net, 'paid for the run');
      assert(paid[0]!.n === '1', `salary dépenses: ${paid[0]!.n}`);
      same(await dbRead.cashBalance(t, caisse.id), String(500000 - Number(net)), 'caisse');
      same(
        await dbRead.cashBalance(t, caisse.id),
        await dbRead.cashLedger(t, caisse.id),
        'caisse = ledger',
      );
      await assertContiguous(t, 'expenses', 'DEP');
    });
  }

  proof('concurrency-statuses.txt', log.join('\n') + '\n');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    writeSummary('concurrency');
    await closeDb();
    process.exit(process.exitCode ?? 0);
  });
