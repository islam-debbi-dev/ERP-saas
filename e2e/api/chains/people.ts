/**
 * Chains 15 and 16 (audit 02): primes (a run approved, then a sale cancelled the month
 * after) and RH + paie (pointage, congé, avance, a payroll run approved and paid).
 * Rules: docs/domain.md, "Objectifs & primes" (phase 18), "DRH: personnel et pointage"
 * (phase 31) and "DRH: paie" (phase 31b).
 *
 * Two rows are dated in the past straight in the audit database (marked `backdate`): the
 * API has no way to validate a sale last month, and a closed month is what these rules
 * are about. Nothing else is written outside the API.
 */
import { area, assert, check } from '../../lib/harness.ts';
import {
  type Company,
  addDays,
  algiersToday,
  assertAuditDb,
  cashAccounts,
  client,
  company,
  D,
  dbRead,
  invite,
  monthDays,
  monthOf,
  openingStock,
  previousMonth,
  product,
  same,
  weekday,
} from '../../lib/audit.ts';
import { db, query } from '../../lib/db.ts';

interface Run {
  id: string;
  status: string;
  total: string;
  users: { user: { id: string }; total: string; lines: { ruleName: string; amount: string }[] }[];
}

// ------------------------------------------------------------------ 15. primes
export async function primesChain(): Promise<void> {
  area('15. Primes: un mois approuvé, puis une vente annulée le mois suivant');
  assertAuditDb();
  const c = await company('Primes');
  const t = c.tenantId;
  const today = algiersToday();
  const cur = monthOf(today);
  const prev = previousMonth(cur);
  const seller = await invite(c, 'SELLER');
  const p = await product(c, { priceHt: '1000' });
  await openingStock(c, p, '100', '500');
  const cl = await client(c, 'Client primes');

  // 10 pièces at 1 000 HT by the seller: CA HT 10 000.
  const sale = (
    await seller.api.post<{ sale: { id: string } }>('/sales/quick', {
      type: 'BL',
      clientId: cl,
      documentDate: today,
      warehouseId: c.mainWarehouseId,
      lines: [{ productId: p.id, unitId: p.unitId, qty: '10' }],
      paidAmount: '0',
    })
  ).sale;
  // backdate: the sale was validated one month ago.
  await db().query(
    `UPDATE sales SET "validatedAt" = "validatedAt" - interval '1 month', "documentDate" = "documentDate" - interval '1 month'
      WHERE id = $1::uuid AND "tenantId" = $2::uuid`,
    [sale.id, t],
  );

  let plan = await c.owner.post<{ id: string }>(
    '/incentive-plans',
    { name: 'Primes vendeurs', period: 'MONTH', validFrom: `${prev}-01` },
    null,
  );
  plan = await c.owner.post<{ id: string }>(
    `/incentive-plans/${plan.id}/rules`,
    {
      name: 'Commission CA',
      appliesTo: 'ROLE',
      roleOrUserId: 'SELLER',
      params: { type: 'COMMISSION', metric: 'CA_HT', ratePct: '2' },
    },
    null,
  );
  await c.owner.post(`/incentive-plans/${plan.id}/activate`, {}, null);

  const preview = await c.owner.post<Run>(
    '/incentive-runs',
    { planId: plan.id, period: prev },
    null,
  );
  const mine = (r: Run) => r.users.find((u) => u.user.id === seller.id);
  await check('last month: 2 % of 10 000 DA HT = 200 DA for the seller', async () => {
    assert(
      !!mine(preview),
      `the seller is not in the run: ${JSON.stringify(preview).slice(0, 300)}`,
    );
    same(mine(preview)!.total, '200', 'prime of the seller');
  });
  const approved = await c.owner.post<Run>(`/incentive-runs/${preview.id}/approve`, {}, null);
  await check('the owner approves: the run is frozen', async () => {
    assert(approved.status === 'APPROVED', `status=${approved.status}`);
    same(approved.total, '200', 'run total');
  });
  await check('approving twice is refused and adds nothing', async () => {
    const again = await c.owner.send('POST', `/incentive-runs/${preview.id}/approve`, {}, null);
    assert(again.status === 409, `second approval answered ${again.status}`);
  });

  await c.owner.post(`/sales/${sale.id}/cancel`, {
    reason: 'Audit: vente annulée le mois suivant',
  });
  await check('the approved month is not rewritten by the cancellation', async () => {
    const after = await c.owner.read<Run>(`/incentive-runs/${preview.id}`);
    same(after.total, '200', 'approved run total');
    same(mine(after)!.total, '200', "the seller's approved prime");
    // The sale counts for last month again when the month is previewed anew: the run is unique.
    const lines = await query<{ amount: string }>(
      `SELECT l.amount::text FROM incentive_lines l JOIN incentive_runs r ON r.id = l."runId"
        WHERE r.id = $1::uuid AND r."tenantId" = $2::uuid`,
      [preview.id, t],
    );
    assert(lines.length === 1, `frozen lines=${lines.length}`);
    same(lines[0]!.amount, '200', 'frozen line');
  });
  await check(
    'this month takes the cancelled sale back: CA HT -10 000, prime -200 or 0, never +',
    async () => {
      const now = await c.owner.post<Run>(
        '/incentive-runs',
        { planId: plan.id, period: cur },
        null,
      );
      const row = mine(now);
      const total = D(row?.total ?? '0');
      assert(total.lte(0), `this month's prime is ${total.toString()}`);
      const text = JSON.stringify(row ?? {});
      assert(
        text.includes('-10000'),
        `the month does not show the CA taken back (-10000.00): ${text.slice(0, 400)}`,
      );
    },
  );
  await check('a frozen run refuses any change in the database itself', async () => {
    const res = await db()
      .query(`UPDATE incentive_runs SET total = total + 1 WHERE id = $1::uuid`, [preview.id])
      .then(
        () => 'updated',
        (err: Error) => err.message,
      );
    assert(res !== 'updated', 'an approved incentive run was updated by plain SQL');
  });
  await check('stock and client account are back after the cancellation', async () => {
    same(await dbRead.stock(t, p.id), '100', 'stock');
    same(await dbRead.clientBalance(t, cl), '0', 'client balance');
  });
}

// ------------------------------------------------------------------ 16. RH + paie
interface Payslip {
  employeeId: string;
  gross: string;
  cotisable: string;
  cnasEmployee: string;
  taxable: string;
  irg: string;
  net: string;
  retenues: string;
  advanceDeducted: string;
  netToPay: string;
  issues: { code: string }[];
}
interface PayrollRun {
  id: string;
  number: string | null;
  status: string;
  version: number;
  payslips: Payslip[];
}

export async function payrollChain(): Promise<void> {
  area('16. RH et paie: pointage, congé, avance, paie approuvée et payée');
  const c = await company('Paie');
  const t = c.tenantId;
  const today = algiersToday();
  const month = previousMonth(monthOf(today));
  const days = monthDays(month);
  const accounts = await cashAccounts(c);
  const caisse = accounts.find((a) => a.type === 'CAISSE' && a.isDefault)!;
  await c.owner.post(`/cash-accounts/${caisse.id}/opening`, {
    amount: '200000',
    date: `${month}-01`,
  });

  const hired = addDays(`${month}-01`, -400);
  const e = await c.owner.post<{ id: string; matricule: string }>(
    '/employees',
    {
      fullName: 'Karim Audit',
      hireDate: hired,
      contract: 'CDI',
      declared: true,
      warehouseId: c.mainWarehouseId,
    },
    null,
  );
  await c.owner.post(`/employees/${e.id}/salaries`, {
    amount: '60000',
    payType: 'MONTHLY',
    effectiveFrom: hired,
  });
  await check('the employee gets matricule EMP-000001', () => {
    assert(e.matricule === 'EMP-000001', `matricule=${e.matricule}`);
  });

  // Congé: 10 days brought in, 2 working days taken (paid) last month.
  await c.owner.post(`/employees/${e.id}/leave-entries`, {
    type: 'OPENING',
    days: '10',
    note: 'Solde repris',
  });
  const holidays = new Set(
    (
      await c.owner.read<{ items: { date: string }[] }>(
        `/public-holidays?year=${month.slice(0, 4)}`,
      )
    ).items.map((h) => h.date.slice(0, 10)),
  );
  const working = days.filter((d) => weekday(d) !== 5 && !holidays.has(d));
  const leaveDays = working.slice(5, 7);
  const absent = working[10]!;
  const leave = await c.owner.post<{ id: string }>('/leave-requests', {
    employeeId: e.id,
    startDate: leaveDays[0],
    endDate: leaveDays[1],
    type: 'PAID',
    note: null,
  });
  await c.owner.post(`/leave-requests/${leave.id}/approve`, {});
  await check('an approved paid leave of 2 working days takes 2 days off the balance', async () => {
    const b = await c.owner.read<{ balance?: string; days?: string }>(
      `/employees/${e.id}/leave-balance`,
    );
    same(b.balance ?? b.days, '8', 'leave balance');
    const ledger = await query<{ s: string }>(
      `SELECT COALESCE(SUM(days), 0)::text AS s FROM leave_entries WHERE "tenantId" = $1::uuid AND "employeeId" = $2::uuid`,
      [t, e.id],
    );
    same(ledger[0]!.s, '8', 'leave ledger');
  });

  // Pointage: present every working day, one unjustified absence, the leave days untouched.
  for (const date of working) {
    if (leaveDays.includes(date)) continue;
    const mark =
      date === absent
        ? { employeeId: e.id, kind: 'ABSENT', absenceReason: 'UNJUSTIFIED' }
        : { employeeId: e.id, kind: 'PRESENT' };
    await c.owner.post('/attendance/events', { date, marks: [mark] });
  }
  await check('a second mark on a marked day is refused (corrections only)', async () => {
    const res = await c.owner.send<{ code?: string }>('POST', '/attendance/events', {
      date: absent,
      marks: [{ employeeId: e.id, kind: 'PRESENT' }],
    });
    assert(res.status >= 400 && res.status < 500, `HTTP ${res.status}`);
    assert(res.body.code === 'ATTENDANCE_ALREADY_MARKED', `code=${res.body.code}`);
  });

  // Avance: 5 000 DA in cash.
  await c.owner.post(`/employees/${e.id}/advances`, { amount: '5000', mode: 'ESPECES' });
  const balances = async (): Promise<{ advance: string; due: string }> => {
    const r = await query<{ advance: string; due: string }>(
      `SELECT "advanceBalance"::text AS advance, "salaryDue"::text AS due FROM employee_balances
        WHERE "tenantId" = $1::uuid AND "employeeId" = $2::uuid`,
      [t, e.id],
    );
    return r[0] ?? { advance: '0', due: '0' };
  };
  await check(
    'an avance is a dépense, an employee ledger row and cash out, in one go',
    async () => {
      same((await balances()).advance, '5000', 'advance balance');
      same(await dbRead.cashBalance(t, caisse.id), '195000', 'caisse');
      const exp = await query<{ n: string }>(
        `SELECT COUNT(*)::text AS n FROM expenses WHERE "tenantId" = $1::uuid AND "employeeId" = $2::uuid AND status = 'VALID'`,
        [t, e.id],
      );
      assert(exp[0]!.n === '1', `avance dépenses=${exp[0]!.n}`);
    },
  );
  await check('the avance is cash, not a charge', async () => {
    const r = await c.owner.read<{ total: string }>(`/reports/charges?from=${today}&to=${today}`);
    same(r.total, '0', 'charges of today');
  });

  // Payroll of last month.
  const rates = await c.owner.read<{ platform: { id: string }[] }>('/payroll-rates');
  for (const set of rates.platform)
    await c.owner.post(`/payroll-rates/${set.id}/accept`, { locale: 'fr' }, null);
  const draft = await c.owner.post<PayrollRun>('/payroll-runs', { month, warehouseId: null }, null);
  const slip = draft.payslips.find((s) => s.employeeId === e.id);
  await check(
    'the draft payslip: 60 000 - one absent day (2 000), CNAS 9 %, IRG of the barème',
    async () => {
      assert(!!slip, 'no payslip for the employee');
      assert(slip!.issues.length === 0, `issues: ${JSON.stringify(slip!.issues)}`);
      same(slip!.gross, '58000', 'brut');
      same(slip!.cnasEmployee, '5220', 'CNAS 9 %');
      same(slip!.taxable, '52780', 'imposable');
      // Barème 2022 by month: 20 000 x 0 + 20 000 x 23 % + 12 780 x 27 % = 8 050.60;
      // abattement 40 % capped at 1 500; rounded down to the dinar: 6 550.
      same(slip!.irg, '6550', 'IRG');
      same(slip!.net, '46230', 'net');
      same(slip!.advanceDeducted, '5000', 'avance taken back');
      same(slip!.netToPay, '41230', 'net à payer');
    },
  );
  await check('a draft has no number and posts nothing', async () => {
    assert(draft.number === null, `draft number=${draft.number}`);
    same((await balances()).due, '0', 'salary due');
  });

  const approved = await c.owner.post<PayrollRun>(
    `/payroll-runs/${draft.id}/approve`,
    { version: draft.version },
    null,
  );
  await check('approval numbers the run PAIE-YYYY-000001 and posts the ledgers', async () => {
    assert(/^PAIE-\d{4}-000001$/.test(approved.number ?? ''), `number=${approved.number}`);
    const b = await balances();
    same(b.due, '41230', 'salary due (net - avance)');
    same(b.advance, '0', 'advance balance');
  });
  await check('the approved month is locked: no new mark', async () => {
    const res = await c.owner.send<{ code?: string }>('POST', '/attendance/corrections', {
      employeeId: e.id,
      date: absent,
      correctedTo: 'PRESENT',
      reason: 'Audit: après approbation',
    });
    assert(res.body.code === 'PERIOD_APPROVED', `HTTP ${res.status} code=${res.body.code}`);
  });
  await check('the approved run costs brut + employer CNAS in its month (charges)', async () => {
    const r = await c.owner.read<{ payroll: string }>(
      `/reports/charges?from=${days[0]}&to=${days[days.length - 1]}`,
    );
    const cnasEmployer = await query<{ v: string }>(
      `SELECT "cnasEmployer"::text AS v FROM payslips WHERE "runId" = $1::uuid`,
      [draft.id],
    );
    same(r.payroll, D(58000).plus(cnasEmployer[0]!.v), 'payroll charge of the month');
  });

  const payKey = `a2-pay-${draft.id}`;
  await c.owner.post(`/payroll-runs/${draft.id}/payments`, { mode: 'ESPECES' }, payKey);
  await check(
    'paying the run: one dépense per employee, salary due at zero, cash out',
    async () => {
      same((await balances()).due, '0', 'salary due');
      same(await dbRead.cashBalance(t, caisse.id), '153770', 'caisse (195 000 - 41 230)');
      same(await dbRead.cashLedger(t, caisse.id), '153770', 'caisse ledger');
    },
  );
  await check('the same payment sent again pays nothing more', async () => {
    const again = await c.owner.send(
      'POST',
      `/payroll-runs/${draft.id}/payments`,
      { mode: 'ESPECES' },
      payKey,
    );
    assert(again.status < 300, `replay answered ${again.status}`);
    same(await dbRead.cashBalance(t, caisse.id), '153770', 'caisse after the replay');
  });
  await check(
    'paying a run that is already paid, with a new key, pays nothing and says so',
    async () => {
      const second = await c.owner.send('POST', `/payroll-runs/${draft.id}/payments`, {
        mode: 'ESPECES',
      });
      same(await dbRead.cashBalance(t, caisse.id), '153770', 'caisse after a second payment');
      assert(
        second.status >= 400 && second.status < 500,
        `nothing was left to pay, no dépense was written, and the API answered ${second.status} as if it had paid`,
      );
    },
    { expected: '409 or 422: nothing left to pay' },
  );
  await check('a paid run cannot be cancelled', async () => {
    const res = await c.owner.send(
      'POST',
      `/payroll-runs/${draft.id}/cancel`,
      { reason: 'Audit: trop tard' },
      null,
    );
    assert(res.status >= 400 && res.status < 500, `HTTP ${res.status}`);
  });
  await check('the employee ledger adds up to both balances', async () => {
    const rows = await query<{ advance: string; due: string }>(
      `SELECT
         COALESCE(SUM(amount) FILTER (WHERE type NOT IN ('SALARY_DUE','SALARY_PAID','SALARY_REVERSAL')), 0)::text AS advance,
         COALESCE(SUM(CASE WHEN type = 'ADVANCE_DEDUCTION' THEN amount ELSE -amount END)
           FILTER (WHERE type IN ('SALARY_DUE','SALARY_PAID','SALARY_REVERSAL','ADVANCE_DEDUCTION')), 0)::text AS due
       FROM employee_ledger_entries WHERE "tenantId" = $1::uuid AND "employeeId" = $2::uuid`,
      [t, e.id],
    );
    const b = await balances();
    same(rows[0]!.advance, b.advance, 'advance ledger');
    same(rows[0]!.due, b.due, 'salary ledger');
  });
}

/**
 * A payroll draft ready to approve, for the concurrency suite: one declared employee at
 * `salary`, present every working day of last month, the platform rates accepted.
 */
export async function draftPayroll(
  c: Company,
  salary = '60000',
): Promise<{ run: PayrollRun; employeeId: string; month: string }> {
  const month = previousMonth(monthOf(algiersToday()));
  const hired = addDays(`${month}-01`, -400);
  const e = await c.owner.post<{ id: string }>(
    '/employees',
    {
      fullName: 'Employé concurrence',
      hireDate: hired,
      contract: 'CDI',
      declared: true,
      warehouseId: c.mainWarehouseId,
    },
    null,
  );
  await c.owner.post(`/employees/${e.id}/salaries`, {
    amount: salary,
    payType: 'MONTHLY',
    effectiveFrom: hired,
  });
  const holidays = new Set(
    (
      await c.owner.read<{ items: { date: string }[] }>(
        `/public-holidays?year=${month.slice(0, 4)}`,
      )
    ).items.map((h) => h.date.slice(0, 10)),
  );
  for (const date of monthDays(month).filter((d) => weekday(d) !== 5 && !holidays.has(d))) {
    await c.owner.post('/attendance/events', {
      date,
      marks: [{ employeeId: e.id, kind: 'PRESENT' }],
    });
  }
  const rates = await c.owner.read<{ platform: { id: string }[] }>('/payroll-rates');
  for (const set of rates.platform)
    await c.owner.post(`/payroll-rates/${set.id}/accept`, { locale: 'fr' }, null);
  const run = await c.owner.post<PayrollRun>('/payroll-runs', { month, warehouseId: null }, null);
  return { run, employeeId: e.id, month };
}
