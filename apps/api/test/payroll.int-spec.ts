import { randomUUID } from 'node:crypto';
import ExcelJS from 'exceljs';
import {
  Activity,
  addDays,
  algiersDay,
  type AuthResponse,
  type ChargesReportDto,
  type EmployeeDto,
  type EmployeeLedgerPage,
  type ExpensePage,
  FIXED_PUBLIC_HOLIDAYS,
  type InviteResultDto,
  listDays,
  type MyPayslipDto,
  money,
  monthBounds,
  type PayItemTypeDto,
  type PayrollRunDetailDto,
  type PayrollRunPage,
  type PayslipDto,
  PERMISSIONS,
  previousMonth,
  type WarehouseDto,
  weekdayOf,
} from '@erp/shared';
import type { CurrentUserInfo } from '../src/auth/auth.types';
import { tenantContext } from '../src/common/tenant-context';
import { PayrollComputeService } from '../src/payroll/payroll-compute.service';
import {
  DAS_COLUMNS,
  ETAT_CNAS_COLUMNS,
  LIVRE_DE_PAIE_COLUMNS,
  RECAP_IRG_COLUMNS,
} from '../src/payroll/payroll-xlsx';
import { ReconcileService } from '../src/reconcile/reconcile.service';
import {
  bearer,
  createTestApp,
  registerTenant,
  type RegisteredTenant,
  tamper,
  type TestApp,
  uniqueEmail,
  withoutGeoCheck,
} from './helpers';

type Who = { auth: { accessToken: string } };
interface Member {
  id: string;
  auth: AuthResponse;
}

const TODAY = algiersDay();
const MONTH = previousMonth(TODAY.slice(0, 7));
const HIRED = addDays(`${MONTH}-01`, -400);
const { from: FROM, to: TO } = monthBounds(MONTH);

const isOff = (day: string) =>
  weekdayOf(day) === 5 || FIXED_PUBLIC_HOLIDAYS.some((h) => h.monthDay === day.slice(5));
const WORKING_DAYS = listDays(FROM, TO).filter((d) => !isOff(d));

/** DRH part 2 (phase 31b): paie, gel, paiements, charges. */
describe('payroll (phase 31b)', () => {
  let t: TestApp;
  let d: RegisteredTenant;
  let other: RegisteredTenant;
  let seq = 0;

  const as = (who: Who) => ({
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
      if (key) void req.set('Idempotency-Key', key);
      return req.send(body);
    },
    put: (url: string, body: object) =>
      t
        .http()
        .put(url)
        .set(...bearer(who.auth.accessToken))
        .send(body),
    patch: (url: string, body: object) =>
      t
        .http()
        .patch(url)
        .set(...bearer(who.auth.accessToken))
        .send(body),
  });

  const read = <T>(sql: TemplateStringsArray, ...values: unknown[]) =>
    tenantContext.runAsSystem(() => t.prisma.db.$queryRaw<T>(sql, ...values));

  const newUser = async (): Promise<{ id: string; email: string }> => {
    const email = uniqueEmail('manager');
    const res = await as(d)
      .post(
        '/users/invite',
        {
          fullName: `Manager ${++seq}`,
          email,
          role: 'MANAGER',
          mode: 'PASSWORD',
          password: 'Password123!',
        },
        null,
      )
      .expect(201);
    return { id: (res.body as InviteResultDto).user.id, email };
  };

  /** Two logins each, and the login route is rate limited: only for who really signs in. */
  const invite = async (): Promise<Member> => {
    const { id, email } = await newUser();
    const login = await t
      .http()
      .post('/auth/login')
      .send({ email, password: 'Password123!' })
      .expect(200);
    await t
      .http()
      .post('/auth/password')
      .set(...bearer((login.body as AuthResponse).accessToken))
      .send({ currentPassword: 'Password123!', newPassword: 'Password456!' });
    const relog = await t
      .http()
      .post('/auth/login')
      .send({ email, password: 'Password456!' })
      .expect(200);
    return { id, auth: relog.body as AuthResponse };
  };

  const depot = async (who: Who = d): Promise<WarehouseDto> =>
    (
      await as(who)
        .post('/warehouses', { name: `Dépôt ${++seq}`, type: 'SECONDARY' }, null)
        .expect(201)
    ).body as WarehouseDto;

  const employee = async (
    warehouseId: string | null,
    salary: string | null = '60000',
    over: object = {},
    who: Who = d,
  ): Promise<EmployeeDto> => {
    const e = (
      await as(who)
        .post(
          '/employees',
          {
            fullName: `Employé ${++seq}`,
            hireDate: HIRED,
            contract: 'CDI',
            declared: true,
            ...(warehouseId ? { warehouseId } : {}),
            ...over,
          },
          null,
        )
        .expect(201)
    ).body as EmployeeDto;
    if (salary) {
      await as(who)
        .post(`/employees/${e.id}/salaries`, {
          amount: salary,
          payType: 'MONTHLY',
          effectiveFrom: HIRED,
        })
        .expect(201);
    }
    return e;
  };

  const markMonth = async (ids: string[], skip: string[] = [], who: Who = d) => {
    for (const date of WORKING_DAYS.filter((x) => !skip.includes(x))) {
      await as(who)
        .post('/attendance/events', {
          date,
          marks: ids.map((employeeId) => ({ employeeId, kind: 'PRESENT' })),
        })
        .expect(201);
    }
  };

  const draft = async (warehouseId: string | null, who: Who = d, month = MONTH) =>
    (await as(who).post('/payroll-runs', { month, warehouseId }, null).expect(201))
      .body as PayrollRunDetailDto;

  const approve = async (run: PayrollRunDetailDto, who: Who = d) =>
    (
      await as(who)
        .post(`/payroll-runs/${run.id}/approve`, { version: run.version }, null)
        .expect(200)
    ).body as PayrollRunDetailDto;

  /** A dépôt with one employee whose month is fully marked, and its draft. */
  const ready = async (salary = '60000', over: object = {}) => {
    const w = await depot();
    const e = await employee(w.id, salary, over);
    await markMonth([e.id]);
    return { w, e };
  };

  const slipOf = (run: PayrollRunDetailDto, id: string): PayslipDto =>
    run.payslips.find((p) => p.employeeId === id)!;
  const ledgerOf = async (id: string, who: Who = d) =>
    (await as(who).get(`/employees/${id}/ledger?limit=50`).expect(200)).body as EmployeeLedgerPage;
  const advance = (id: string, amount: string) =>
    as(d).post(`/employees/${id}/advances`, { amount, mode: 'ESPECES' }).expect(201);
  const charges = async (warehouseId: string) =>
    (
      await as(d)
        .get(`/reports/charges?from=${FROM}&to=${TO}&warehouseId=${warehouseId}`)
        .expect(200)
    ).body as ChargesReportDto;

  beforeAll(async () => {
    t = await createTestApp();
    d = await registerTenant(t, 'Distrib Paie', { activity: Activity.DISTRIBUTEUR });
    other = await registerTenant(t, 'Autre Paie', { activity: Activity.DISTRIBUTEUR });
    await withoutGeoCheck(t, other);
  });

  afterAll(async () => {
    await t.close();
  });

  describe('draft and approval', () => {
    it('computes a declared worker from the pointage, and explains each line', async () => {
      const { w, e } = await ready();
      const run = await draft(w.id);
      expect(run.status).toBe('DRAFT');
      expect(run.number).toBeNull();
      expect(run.rateSetToVerify).toBe(true);
      const slip = slipOf(run, e.id);
      expect(slip).toMatchObject({
        gross: '60000.00',
        cnasEmployee: '5400.00',
        cnasEmployer: '15600.00',
        taxable: '54600.00',
        employerCost: '75600.00',
        issues: [],
      });
      expect(slip.lines.map((l) => l.code)).toEqual(['BASE_SALARY', 'CNAS_EMPLOYEE', 'IRG']);
      const total = slip.lines.reduce((n, l) => n.add(money(l.amount)), money(0));
      expect(total.toFixed(2)).toBe(slip.netToPay);
    });

    it('freezes payslips, locks the month and posts the ledger', async () => {
      const { w, e } = await ready();
      const run = await approve(await draft(w.id));
      expect(run.status).toBe('APPROVED');
      expect(run.number).toMatch(/^PAIE-\d{4}-\d{6}$/);
      const slip = slipOf(run, e.id);

      await expect(
        tamper(t)`UPDATE payslips SET "netToPay" = 1 WHERE id = ${slip.id}::uuid`,
      ).rejects.toThrow(/PERIOD_APPROVED/);
      await expect(tamper(t)`DELETE FROM payslips WHERE id = ${slip.id}::uuid`).rejects.toThrow(
        /PERIOD_APPROVED/,
      );
      await expect(
        tamper(t)`UPDATE payslip_lines SET amount = 1 WHERE "runId" = ${run.id}::uuid`,
      ).rejects.toThrow(/PERIOD_APPROVED/);
      await expect(
        tamper(t)`UPDATE payroll_runs SET month = '2020-01' WHERE id = ${run.id}::uuid`,
      ).rejects.toThrow(/PERIOD_APPROVED/);

      const corrected = await as(d)
        .post('/attendance/corrections', {
          employeeId: e.id,
          date: WORKING_DAYS[0],
          correctedTo: 'SICK',
          reason: 'Trop tard',
        })
        .expect(409);
      expect((corrected.body as { code: string }).code).toBe('PERIOD_APPROVED');

      const ledger = await ledgerOf(e.id);
      expect(ledger.salaryDue).toBe(slip.netToPay);
      expect(ledger.balance).toBe('0.00');
      expect(ledger.items[0]).toMatchObject({ type: 'SALARY_DUE' });

      const twice = await as(d)
        .post(`/payroll-runs/${run.id}/approve`, { version: run.version }, null)
        .expect(409);
      expect((twice.body as { code: string }).code).toBe('PAYROLL_RUN_STATUS');
    });

    it('refuses approval with unmarked days, and names them', async () => {
      const w = await depot();
      const e = await employee(w.id);
      await markMonth([e.id], [WORKING_DAYS[3]!]);
      const run = await draft(w.id);
      expect(slipOf(run, e.id).issues).toEqual([
        { code: 'UNMARKED_DAYS', days: [WORKING_DAYS[3]] },
      ]);
      const res = await as(d)
        .post(`/payroll-runs/${run.id}/approve`, { version: run.version }, null)
        .expect(422);
      expect(res.body).toMatchObject({
        code: 'PAYROLL_UNMARKED_DAYS',
        details: { employees: [{ employeeId: e.id, days: [WORKING_DAYS[3]] }] },
      });
    });

    it('refuses approval for an employee without a salary', async () => {
      const w = await depot();
      const e = await employee(w.id, null);
      await markMonth([e.id]);
      const run = await draft(w.id);
      const res = await as(d)
        .post(`/payroll-runs/${run.id}/approve`, { version: run.version }, null)
        .expect(422);
      expect((res.body as { code: string }).code).toBe('PAYROLL_NO_SALARY');
    });

    it('refuses to approve figures that moved since they were read', async () => {
      const { w, e } = await ready();
      const run = await draft(w.id);
      await as(d)
        .post('/attendance/corrections', {
          employeeId: e.id,
          date: WORKING_DAYS[2],
          correctedTo: 'ABSENT_UNJUSTIFIED',
          reason: 'Absent en fait',
        })
        .expect(201);
      const res = await as(d)
        .post(`/payroll-runs/${run.id}/approve`, { version: run.version }, null)
        .expect(409);
      expect((res.body as { code: string }).code).toBe('PAYROLL_STALE');

      const fresh = (await as(d).post(`/payroll-runs/${run.id}/recompute`, {}, null).expect(200))
        .body as PayrollRunDetailDto;
      expect(fresh.version).toBe(run.version + 1);
      expect(slipOf(fresh, e.id).gross).toBe('58000.00');
      await as(d)
        .post(`/payroll-runs/${run.id}/approve`, { version: run.version }, null)
        .expect(409);
      expect((await approve(fresh)).status).toBe('APPROVED');
    });

    it('refuses a second live run of a month, and a company run over a dépôt run', async () => {
      const company = await registerTenant(t, 'Overlap Paie', {
        activity: Activity.DISTRIBUTEUR,
      });
      await withoutGeoCheck(t, company);
      const w = await depot(company);
      await employee(w.id, '50000', {}, company);
      const run = await draft(w.id, company);
      const again = await as(company)
        .post('/payroll-runs', { month: MONTH, warehouseId: w.id }, null)
        .expect(409);
      expect((again.body as { code: string }).code).toBe('PAYROLL_RUN_EXISTS');
      await as(company)
        .post('/payroll-runs', { month: MONTH, warehouseId: null }, null)
        .expect(409);
      await as(company)
        .post(`/payroll-runs/${run.id}/cancel`, { reason: 'Mauvais mois' }, null)
        .expect(200);
      await draft(null, company);
      const dep = await as(company)
        .post('/payroll-runs', { month: MONTH, warehouseId: w.id }, null)
        .expect(409);
      expect((dep.body as { code: string }).code).toBe('PAYROLL_RUN_EXISTS');
    });

    it('holds under two concurrent creations of the same month', async () => {
      const w = await depot();
      await employee(w.id);
      const body = { month: MONTH, warehouseId: w.id };
      const results = await Promise.all([
        as(d).post('/payroll-runs', body, null),
        as(d).post('/payroll-runs', body, null),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    });

    it('refuses a month that has not started, or with no rate set', async () => {
      const w = await depot();
      const next = addDays(monthBounds(TODAY.slice(0, 7)).to, 1).slice(0, 7);
      await as(d).post('/payroll-runs', { month: next, warehouseId: w.id }, null).expect(400);
      const res = await as(d)
        .post('/payroll-runs', { month: '2025-12', warehouseId: w.id }, null)
        .expect(422);
      expect((res.body as { code: string }).code).toBe('PAYROLL_NO_RATE_SET');
    });

    it('numbers without gaps under concurrent approvals', async () => {
      const dépôts = await Promise.all([ready(), ready(), ready()]);
      const runs = [];
      for (const { w } of dépôts) runs.push(await draft(w.id));
      const done = await Promise.all(runs.map((r) => approve(r)));
      const numbers = done.map((r) => Number(r.number!.slice(-6))).sort((a, b) => a - b);
      expect(numbers[1]! - numbers[0]!).toBe(1);
      expect(numbers[2]! - numbers[1]!).toBe(1);
      const [seqRow] = await read<{ n: number; used: bigint }[]>`
        SELECT ds."lastNumber" AS n,
               (SELECT COUNT(*) FROM payroll_runs r
                WHERE r."tenantId" = ${d.tenantId}::uuid AND r.number IS NOT NULL) AS used
        FROM document_sequences ds
        WHERE ds."tenantId" = ${d.tenantId}::uuid AND ds."docType" = 'PAIE'`;
      expect(Number(seqRow!.used)).toBe(seqRow!.n);
    });
  });

  describe('pay items and manual lines', () => {
    it('applies a per-day item, one-off lines and retenues, and keeps them on recompute', async () => {
      const { w, e } = await ready();
      const types = (await as(d).get('/pay-item-types').expect(200)).body as PayItemTypeDto[];
      expect(types.map((x) => x.key).sort()).toEqual([
        'EXCEPTIONNELLE',
        'PANIER',
        'RENDEMENT',
        'TRANSPORT',
      ]);
      const panier = types.find((x) => x.key === 'PANIER')!;
      const prime = types.find((x) => x.key === 'EXCEPTIONNELLE')!;
      await as(d)
        .post(`/employees/${e.id}/pay-items`, {
          typeId: panier.id,
          amount: '200',
          effectiveFrom: HIRED,
        })
        .expect(201);

      const run = await draft(w.id);
      const days = WORKING_DAYS.length;
      expect(slipOf(run, e.id).lines.find((l) => l.label === 'Panier')?.amount).toBe(
        money(200).times(days).toFixed(2),
      );
      const patched = (
        await as(d)
          .patch(`/payroll-runs/${run.id}`, {
            add: [
              { kind: 'ITEM', employeeId: e.id, typeId: prime.id, amount: '5000', note: '' },
              { kind: 'RETENUE', employeeId: e.id, amount: '1000', note: 'Casse' },
              {
                kind: 'REGULARISATION',
                employeeId: e.id,
                amount: '-2000',
                cotisable: true,
                imposable: true,
                note: 'Trop payé en mars',
              },
            ],
          })
          .expect(200)
      ).body as PayrollRunDetailDto;
      const slip = slipOf(patched, e.id);
      expect(slip.cotisable).toBe('63000.00');
      expect(slip.retenues).toBe('1000.00');

      const again = (await as(d).post(`/payroll-runs/${run.id}/recompute`, {}, null).expect(200))
        .body as PayrollRunDetailDto;
      expect(slipOf(again, e.id).cotisable).toBe('63000.00');
      expect(again.manualLines).toHaveLength(3);

      const dropped = (
        await as(d)
          .patch(`/payroll-runs/${run.id}`, { remove: [again.manualLines[1]!.id] })
          .expect(200)
      ).body as PayrollRunDetailDto;
      expect(slipOf(dropped, e.id).retenues).toBe('0.00');
    });

    it('pays the days worked by someone hired during the month', async () => {
      const w = await depot();
      const hired = WORKING_DAYS.at(-1)!;
      const e = await employee(w.id, null, { hireDate: hired });
      await as(d)
        .post(`/employees/${e.id}/salaries`, {
          amount: '62000',
          payType: 'MONTHLY',
          effectiveFrom: hired,
        })
        .expect(201);
      await as(d)
        .post('/attendance/events', {
          date: hired,
          marks: [{ employeeId: e.id, kind: 'PRESENT' }],
        })
        .expect(201);
      const slip = slipOf(await draft(w.id), e.id);
      const left = listDays(hired, TO).length;
      const days = listDays(FROM, TO).length;
      expect(slip.gross).toBe(money('62000').times(left).div(days).toFixed(2));
      expect(slip.issues).toEqual([]);
    });

    it('refuses a line for someone not on the run', async () => {
      const { w } = await ready();
      const stranger = await employee((await depot()).id);
      const run = await draft(w.id);
      await as(d)
        .patch(`/payroll-runs/${run.id}`, {
          add: [{ kind: 'RETENUE', employeeId: stranger.id, amount: '10', note: 'Non' }],
        })
        .expect(404);
    });

    it('gives an undeclared worker no CNAS and no IRG', async () => {
      const { w, e } = await ready('30000', { declared: false });
      const slip = slipOf(await draft(w.id), e.id);
      expect(slip).toMatchObject({
        declared: false,
        cnasEmployee: '0.00',
        irg: '0.00',
        net: '30000.00',
        employerCost: '30000.00',
      });
    });

    it('refuses to edit a recurring item row', async () => {
      const e = await employee((await depot()).id);
      const types = (await as(d).get('/pay-item-types').expect(200)).body as PayItemTypeDto[];
      await as(d)
        .post(`/employees/${e.id}/pay-items`, {
          typeId: types[0]!.id,
          amount: '100',
          effectiveFrom: HIRED,
        })
        .expect(201);
      await expect(
        tamper(t)`UPDATE employee_pay_items SET amount = 1 WHERE "employeeId" = ${e.id}::uuid`,
      ).rejects.toThrow(/append-only/);
    });
  });

  describe('avances', () => {
    it('takes the avance from the payslip and carries what is left', async () => {
      const { w, e } = await ready('20000');
      await advance(e.id, '50000');
      const run = await approve(await draft(w.id));
      const slip = slipOf(run, e.id);
      expect(slip).toMatchObject({
        net: '18200.00',
        advanceDeducted: '18200.00',
        advanceCarried: '31800.00',
        netToPay: '0.00',
        remaining: '0.00',
      });
      const ledger = await ledgerOf(e.id);
      expect(ledger.balance).toBe('31800.00');
      expect(ledger.salaryDue).toBe('0.00');
    });

    it('does not let an unpaid salary hide an avance', async () => {
      const { w, e } = await ready('50000');
      const run = await approve(await draft(w.id));
      const due = slipOf(run, e.id).netToPay;
      await advance(e.id, '20000');
      const ledger = await ledgerOf(e.id);
      expect(ledger.balance).toBe('20000.00');
      expect(ledger.salaryDue).toBe(due);
    });
  });

  describe('payments', () => {
    it('pays once on a replay, and creates a dépense and a ledger row', async () => {
      const { w, e } = await ready();
      const run = await approve(await draft(w.id));
      const key = randomUUID();
      const first = await as(d)
        .post(`/payroll-runs/${run.id}/payments`, { mode: 'ESPECES' }, key)
        .expect(201);
      const second = await as(d)
        .post(`/payroll-runs/${run.id}/payments`, { mode: 'ESPECES' }, key)
        .expect(201);
      expect(second.body).toEqual(first.body);
      const paid = first.body as PayrollRunDetailDto;
      expect(paid.totals.remaining).toBe('0.00');
      expect(paid.totals.paid).toBe(paid.totals.netToPay);

      const [{ n } = { n: 0n }] = await read<{ n: bigint }[]>`
        SELECT COUNT(*) AS n FROM expenses
        WHERE "payrollRunId" = ${run.id}::uuid AND "employeeId" = ${e.id}::uuid`;
      expect(Number(n)).toBe(1);
      expect((await ledgerOf(e.id)).salaryDue).toBe('0.00');
    });

    it('allows a partial payment and refuses to go over', async () => {
      const w = await depot();
      const a = await employee(w.id);
      const b = await employee(w.id);
      await markMonth([a.id, b.id]);
      const run = await approve(await draft(w.id));
      const net = money(slipOf(run, a.id).netToPay);

      const part = (
        await as(d)
          .post(`/payroll-runs/${run.id}/payments`, {
            mode: 'VIREMENT',
            reference: 'V-1',
            items: [{ employeeId: a.id, amount: '10000' }],
          })
          .expect(201)
      ).body as PayrollRunDetailDto;
      expect(slipOf(part, a.id)).toMatchObject({
        paid: '10000.00',
        remaining: net.minus(10000).toFixed(2),
      });
      expect(slipOf(part, b.id).paid).toBe('0.00');

      const over = await as(d)
        .post(`/payroll-runs/${run.id}/payments`, {
          mode: 'ESPECES',
          items: [{ employeeId: a.id, amount: net.toFixed(2) }],
        })
        .expect(422);
      expect((over.body as { code: string }).code).toBe('PAYROLL_OVERPAYMENT');

      const rest = (
        await as(d).post(`/payroll-runs/${run.id}/payments`, { mode: 'ESPECES' }).expect(201)
      ).body as PayrollRunDetailDto;
      expect(rest.totals.remaining).toBe('0.00');
    });

    it('never pays twice under two concurrent payments', async () => {
      const { w } = await ready();
      const run = await approve(await draft(w.id));
      const results = await Promise.all([
        as(d).post(`/payroll-runs/${run.id}/payments`, {
          mode: 'ESPECES',
          items: [{ employeeId: run.payslips[0]!.employeeId }],
        }),
        as(d).post(`/payroll-runs/${run.id}/payments`, {
          mode: 'ESPECES',
          items: [{ employeeId: run.payslips[0]!.employeeId }],
        }),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 422]);
    });

    it('refuses to pay a draft', async () => {
      const { w } = await ready();
      const run = await draft(w.id);
      const res = await as(d)
        .post(`/payroll-runs/${run.id}/payments`, { mode: 'ESPECES' })
        .expect(409);
      expect((res.body as { code: string }).code).toBe('PAYROLL_RUN_STATUS');
    });

    it('makes a cancelled payment due again, without touching the avances', async () => {
      const { w, e } = await ready();
      const run = await approve(await draft(w.id));
      await as(d).post(`/payroll-runs/${run.id}/payments`, { mode: 'ESPECES' }).expect(201);
      const [expense] = await read<{ id: string }[]>`
        SELECT id FROM expenses WHERE "payrollRunId" = ${run.id}::uuid`;
      await as(d)
        .post(`/expenses/${expense!.id}/cancel`, { reason: 'Erreur de saisie' })
        .expect((r) => {
          if (r.status >= 300) throw new Error(`cancel: ${r.status} ${JSON.stringify(r.body)}`);
        });
      const after = (await as(d).get(`/payroll-runs/${run.id}`).expect(200))
        .body as PayrollRunDetailDto;
      expect(after.totals.paid).toBe('0.00');
      expect(after.totals.remaining).toBe(after.totals.netToPay);
      const ledger = await ledgerOf(e.id);
      expect(ledger.balance).toBe('0.00');
      expect(ledger.salaryDue).toBe(slipOf(run, e.id).netToPay);
      expect(ledger.items[0]?.type).toBe('SALARY_REVERSAL');
    });
  });

  describe('cancel', () => {
    it('undoes an unpaid run: ledgers reversed, month open, number kept', async () => {
      const { w, e } = await ready();
      await advance(e.id, '1000');
      const run = await approve(await draft(w.id));
      expect((await ledgerOf(e.id)).balance).toBe('0.00');

      const cancelled = (
        await as(d)
          .post(`/payroll-runs/${run.id}/cancel`, { reason: 'Mauvais pointage' }, null)
          .expect(200)
      ).body as PayrollRunDetailDto;
      expect(cancelled).toMatchObject({ status: 'CANCELLED', number: run.number });
      const ledger = await ledgerOf(e.id);
      expect(ledger.balance).toBe('1000.00');
      expect(ledger.salaryDue).toBe('0.00');

      await as(d)
        .post('/attendance/corrections', {
          employeeId: e.id,
          date: WORKING_DAYS[1],
          correctedTo: 'SICK',
          reason: 'Certificat reçu',
        })
        .expect(201);
      const next = await approve(await draft(w.id));
      expect(next.number).not.toBe(run.number);
      expect(slipOf(next, e.id).gross).toBe('58000.00');
    });

    it('refuses once something was paid', async () => {
      const { w } = await ready();
      const run = await approve(await draft(w.id));
      await as(d).post(`/payroll-runs/${run.id}/payments`, { mode: 'ESPECES' }).expect(201);
      const res = await as(d)
        .post(`/payroll-runs/${run.id}/cancel`, { reason: 'Trop tard' }, null)
        .expect(409);
      expect((res.body as { code: string }).code).toBe('PAYROLL_ALREADY_PAID');
    });
  });

  describe('month lock of a moved worker', () => {
    it('locks days kept in his old dépôt', async () => {
      const oldDepot = await depot();
      const newDepot = await depot();
      const e = await employee(oldDepot.id);
      await markMonth([e.id]);
      await as(d)
        .put(`/employees/${e.id}`, {
          fullName: e.fullName,
          hireDate: HIRED,
          contract: 'CDI',
          declared: true,
          warehouseId: newDepot.id,
        })
        .expect(200);
      await approve(await draft(newDepot.id));
      await expect(
        tamper(t)`
          UPDATE attendance_days SET "lateMinutes" = 5
          WHERE "employeeId" = ${e.id}::uuid AND "warehouseId" = ${oldDepot.id}::uuid`,
      ).rejects.toThrow(/PERIOD_APPROVED/);
      // The old dépôt itself stays open for its own workers, and he is not paid twice.
      const second = await draft(oldDepot.id);
      expect(second.payslips).toHaveLength(0);
    });
  });

  describe('charges', () => {
    it('counts gross + employer CNAS once; payments and avances are cash', async () => {
      const { w, e } = await ready();
      await advance(e.id, '3000');
      expect((await charges(w.id)).total).toBe('0.00');

      const run = await draft(w.id);
      expect((await charges(w.id)).total).toBe('0.00');

      const approved = await approve(run);
      const cost = slipOf(approved, e.id).employerCost;
      expect(cost).toBe('75600.00');
      const report = await charges(w.id);
      expect(report).toMatchObject({ total: cost, payroll: cost, expenses: cost });
      expect(report.byCategory.map((c) => [c.category.key, c.total])).toEqual([['SALARIES', cost]]);

      await as(d).post(`/payroll-runs/${approved.id}/payments`, { mode: 'ESPECES' }).expect(201);
      expect((await charges(w.id)).total).toBe(cost);
    });

    it('spreads the month by day on a part of it', async () => {
      const { w } = await ready();
      await approve(await draft(w.id));
      const res = await as(d)
        .get(`/reports/charges?from=${FROM}&to=${FROM}&warehouseId=${w.id}`)
        .expect(200);
      const days = listDays(FROM, TO).length;
      expect((res.body as ChargesReportDto).total).toBe(money('75600').div(days).toFixed(2));
    });

    it('stops counting a cancelled run', async () => {
      const { w } = await ready();
      const run = await approve(await draft(w.id));
      await as(d).post(`/payroll-runs/${run.id}/cancel`, { reason: 'Refaire' }, null).expect(200);
      expect((await charges(w.id)).total).toBe('0.00');
    });

    it('warns about Salaires dépenses entered by hand', async () => {
      const { w } = await ready();
      const before = await draft(w.id);
      expect(before.manualSalaryExpenses).toBe('0.00');
    });
  });

  describe('rate sets', () => {
    /** Rolled back at the end: rate sets are country-wide and append-only. */
    const ROLLBACK = new Error('rollback');

    it('leaves an approved run alone, and a draft takes the new set', async () => {
      const { w, e } = await ready();
      const approved = await approve(await draft(w.id));
      const later = await ready();
      const owner = {
        id: d.auth.user.id,
        tenantId: d.tenantId,
        role: 'OWNER',
        permissions: PERMISSIONS,
      } as unknown as CurrentUserInfo;
      await expect(
        tenantContext.run({ tenantId: d.tenantId }, () =>
          t.prisma.db.$transaction(async (tx) => {
            await tx.$executeRaw`
              INSERT INTO payroll_rate_sets (
                "id", "effectiveFrom", "cnasEmployeeRate", "cnasEmployerRate", "irgBrackets",
                "abattementRate", "abattementMin", "abattementMax", "exemptionThreshold",
                "lissageCeiling", "lissageNum", "lissageDen", "lissageOffsetNum",
                "lissageOffsetDen", "snmg", "toVerify")
              SELECT gen_random_uuid(), ${FROM}::date, 0.10, 0.30, "irgBrackets",
                "abattementRate", "abattementMin", "abattementMax", "exemptionThreshold",
                "lissageCeiling", "lissageNum", "lissageDen", "lissageOffsetNum",
                "lissageOffsetDen", "snmg", false
              FROM payroll_rate_sets ORDER BY seq ASC LIMIT 1`;
            const fresh = await t.app
              .get(PayrollComputeService)
              .compute(tx, MONTH, later.w.id, null, owner);
            expect(fresh.rateSetToVerify).toBe(false);
            expect(fresh.slips.find((s) => s.employee.id === later.e.id)?.result.cnasEmployee).toBe(
              '6000.00',
            );
            const frozen = await tx.payslip.findFirstOrThrow({
              where: { runId: approved.id, employeeId: e.id },
            });
            expect(frozen.cnasEmployee.toFixed(2)).toBe('5400.00');
            throw ROLLBACK;
          }),
        ),
      ).rejects.toBe(ROLLBACK);
      const same = (await as(d).get(`/payroll-runs/${approved.id}`).expect(200))
        .body as PayrollRunDetailDto;
      expect(slipOf(same, e.id).cnasEmployee).toBe('5400.00');
    });

    it('refuses to edit a rate set', async () => {
      await expect(tamper(t)`UPDATE payroll_rate_sets SET snmg = 1`).rejects.toThrow(/append-only/);
    });
  });

  describe('incentives', () => {
    const approvedBonus = async (userId: string, amount: string, status = 'APPROVED') => {
      const planId = randomUUID();
      const ruleId = randomUUID();
      const runId = randomUUID();
      await tamper(t)`
        INSERT INTO incentive_plans ("id", "tenantId", "familyId", "name", "validFrom", "status", "updatedAt")
        VALUES (${planId}::uuid, ${d.tenantId}::uuid, gen_random_uuid(), 'Plan', ${FROM}::date, 'ACTIVE', NOW())`;
      await tamper(t)`
        INSERT INTO incentive_rules ("id", "tenantId", "planId", "position", "name", "appliesTo", "roleOrUserId", "params")
        VALUES (${ruleId}::uuid, ${d.tenantId}::uuid, ${planId}::uuid, 1, 'Règle', 'USER', ${userId}, '{}'::jsonb)`;
      await tamper(t)`
        INSERT INTO incentive_runs ("id", "tenantId", "planId", "periodStart", "periodEnd", "status", "computedAt")
        VALUES (${runId}::uuid, ${d.tenantId}::uuid, ${planId}::uuid, ${FROM}::date, ${TO}::date, 'PREVIEW', NOW())`;
      await tamper(t)`
        INSERT INTO incentive_lines ("id", "tenantId", "runId", "userId", "ruleId", "metrics", "amount", "explanation")
        VALUES (gen_random_uuid(), ${d.tenantId}::uuid, ${runId}::uuid, ${userId}::uuid, ${ruleId}::uuid, '{}'::jsonb, ${amount}::numeric, '{}'::jsonb)`;
      await tamper(t)`
        UPDATE incentive_runs SET status = ${status}::"IncentiveRunStatus", "approvedAt" = NOW()
        WHERE id = ${runId}::uuid`;
      return runId;
    };

    it('pulls an approved bonus as a prime, once', async () => {
      const seller = await newUser();
      const w = await depot();
      const e = await employee(w.id, '60000', { userId: seller.id });
      await markMonth([e.id]);
      await approvedBonus(seller.id, '7000');
      await approvedBonus(seller.id, '500', 'EXPORTED');
      const run = await approve(await draft(w.id));
      const slip = slipOf(run, e.id);
      expect(
        slip.lines
          .filter((l) => l.code === 'INCENTIVE')
          .map((l) => l.amount)
          .sort(),
      ).toEqual(['500.00', '7000.00']);
      expect(slip.cotisable).toBe('67500.00');

      // The next month reads the same run again (it looks one month back): nothing more.
      const paid = await read<{ n: bigint }[]>`
        SELECT COUNT(*) AS n FROM payslip_lines WHERE "runId" = ${run.id}::uuid AND code = 'INCENTIVE'`;
      expect(Number(paid[0]!.n)).toBe(2);
      const nextMonth = TODAY.slice(0, 7);
      const next = await draft(w.id, d, nextMonth);
      expect(slipOf(next, e.id).lines.some((l) => l.code === 'INCENTIVE')).toBe(false);
      await as(d).post(`/payroll-runs/${next.id}/cancel`, { reason: 'Test' }, null).expect(200);
    });

    it('names a seller with a bonus and no employee file', async () => {
      const seller = await newUser();
      await approvedBonus(seller.id, '900');
      const { w } = await ready();
      const run = await draft(w.id);
      expect(run.incentivesWithoutEmployee).toContainEqual(
        expect.objectContaining({ userId: seller.id, amount: '900.00' }),
      );
    });
  });

  describe('documents', () => {
    const binary = (url: string, who: Who = d) =>
      as(who)
        .get(url)
        .buffer(true)
        .parse((res, done) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => done(null, Buffer.concat(chunks)));
        });
    const rowsOf = async (url: string) => {
      const res = await binary(url).expect(200);
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(res.body as never);
      const rows: unknown[][] = [];
      workbook.worksheets[0]!.eachRow((r) => rows.push((r.values as unknown[]).slice(1)));
      return rows;
    };

    it('exports the month with fixed titles, and leaves undeclared workers out of CNAS and IRG', async () => {
      const w = await depot();
      const declared = await employee(w.id, '60000', { nss: '123456789012' });
      const undeclared = await employee(w.id, '30000', { declared: false });
      await markMonth([declared.id, undeclared.id]);
      const run = await approve(await draft(w.id));

      const livre = await rowsOf(`/payroll-runs/${run.id}/livre-de-paie.xlsx`);
      expect(livre[1]).toEqual(LIVRE_DE_PAIE_COLUMNS);
      expect(livre).toHaveLength(5);
      const cnas = await rowsOf(`/payroll-runs/${run.id}/etat-cnas.xlsx`);
      expect(cnas[1]).toEqual(ETAT_CNAS_COLUMNS);
      expect(cnas[2]).toEqual(['123456789012', declared.fullName, 60000, 5400, 15600, 21000]);
      expect(cnas).toHaveLength(4);
      const irg = await rowsOf(`/payroll-runs/${run.id}/recap-irg.xlsx`);
      expect(irg[1]).toEqual(RECAP_IRG_COLUMNS);
      expect(irg).toHaveLength(4);

      const das = await rowsOf(`/payroll-runs/das.xlsx?year=${MONTH.slice(0, 4)}`);
      expect(das[1]).toEqual(DAS_COLUMNS);
      expect(das.some((r) => r[2] === declared.fullName)).toBe(true);
      expect(das.some((r) => r[2] === undeclared.fullName)).toBe(false);
    });

    it('prints an approved run, never a draft', async () => {
      const w = await depot();
      const a = await employee(w.id);
      const b = await employee(w.id, '30000', { declared: false });
      await markMonth([a.id, b.id]);
      const run = await draft(w.id);
      const refused = await as(d).get(`/payroll-runs/${run.id}/pdf`).expect(409);
      expect((refused.body as { code: string }).code).toBe('PAYROLL_RUN_STATUS');
      const approved = await approve(run);
      const bulk = await binary(`/payroll-runs/${run.id}/pdf`).expect(200);
      expect(bulk.headers['content-type']).toContain('application/pdf');
      const one = await binary(`/payroll-runs/payslips/${slipOf(approved, a.id).id}/pdf`).expect(
        200,
      );
      expect((one.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');
    }, 60_000);

    it('gives a worker his own payslips only, without SALARY_VIEW', async () => {
      const worker = await invite();
      const w = await depot();
      const e = await employee(w.id, '60000', { userId: worker.id });
      const colleague = await employee(w.id);
      await markMonth([e.id, colleague.id]);
      const unapproved = (await as(worker).get('/me/payslips').expect(200)).body as MyPayslipDto[];
      expect(unapproved).toEqual([]);
      const run = await approve(await draft(w.id));

      const mine = (await as(worker).get('/me/payslips').expect(200)).body as MyPayslipDto[];
      expect(mine.map((m) => m.id)).toEqual([slipOf(run, e.id).id]);
      await binary(`/me/payslips/${mine[0]!.id}/pdf`, worker).expect(200);
      await as(worker)
        .get(`/me/payslips/${slipOf(run, colleague.id).id}/pdf`)
        .expect(404);
      await as(worker).get(`/payroll-runs/payslips/${mine[0]!.id}/pdf`).expect(403);
    }, 60_000);
  });

  describe('who sees what', () => {
    it('hides everything without SALARY_VIEW', async () => {
      const { w } = await ready();
      const run = await approve(await draft(w.id));
      const manager = await invite();
      await as(manager).get('/payroll-runs').expect(403);
      await as(manager).get(`/payroll-runs/${run.id}`).expect(403);
      await as(manager).get('/payroll-settings').expect(403);
      await as(manager).get('/pay-item-types').expect(403);
      await as(manager).post('/payroll-runs', { month: MONTH }, null).expect(403);
      await as(manager).post(`/payroll-runs/${run.id}/payments`, { mode: 'ESPECES' }).expect(403);
      await as(d).post(`/payroll-runs/${run.id}/payments`, { mode: 'ESPECES' }).expect(201);
      const expenses = (await as(manager).get('/expenses?limit=100').expect(200))
        .body as ExpensePage;
      expect(expenses.items.filter((x) => x.payee?.startsWith('Employé'))).toEqual([]);
    });

    it('needs the owner for approval, by default', async () => {
      const { w } = await ready();
      const run = await draft(w.id);
      const manager = await invite();
      await as(d)
        .put(`/users/${manager.id}/permissions`, {
          grants: ['SALARY_VIEW', 'PAYROLL_MANAGE'],
          revokes: [],
        })
        .expect(200);
      const relogin = manager;
      await as(relogin)
        .post(`/payroll-runs/${run.id}/approve`, { version: run.version }, null)
        .expect(403);
    });

    it('scopes by dépôt: a run outside his reach is not there', async () => {
      const mine = await ready();
      const theirs = await ready();
      const runMine = await draft(mine.w.id);
      const runTheirs = await draft(theirs.w.id);
      const manager = await invite();
      await as(d)
        .put(`/users/${manager.id}/access`, {
          access: [{ warehouseId: mine.w.id, level: 'OPERATE' }],
        })
        .expect(200);
      await as(d)
        .put(`/users/${manager.id}/permissions`, { grants: ['SALARY_VIEW'], revokes: [] })
        .expect(200);
      await as(manager).get(`/payroll-runs/${runMine.id}`).expect(200);
      await as(manager).get(`/payroll-runs/${runTheirs.id}`).expect(404);
      const page = (await as(manager).get('/payroll-runs?limit=100').expect(200))
        .body as PayrollRunPage;
      expect(page.items.map((r) => r.id)).toEqual([runMine.id]);
    });

    it('keeps tenants apart', async () => {
      const { w } = await ready();
      const run = await draft(w.id);
      await as(other).get(`/payroll-runs/${run.id}`).expect(404);
      await as(other).post(`/payroll-runs/${run.id}/recompute`, {}, null).expect(404);
      await as(other)
        .post(`/payroll-runs/${run.id}/approve`, { version: run.version }, null)
        .expect(404);
      const page = (await as(other).get('/payroll-runs').expect(200)).body as PayrollRunPage;
      expect(page.items).toEqual([]);
    });

    it('needs the module', async () => {
      const small = await registerTenant(t, 'Petit Paie', { activity: Activity.GROSSISTE });
      await as(small).get('/payroll-runs').expect(403);
    });
  });

  it('leaves the ledgers reconciled', async () => {
    const result = await t.app.get(ReconcileService).run();
    expect(result.ran).toBe(true);
    expect(result.mismatches.filter((m) => m.tenantId === d.tenantId)).toEqual([]);
  });
});
