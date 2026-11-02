import { randomUUID } from 'node:crypto';
import {
  Activity,
  type ApiError,
  type AuthResponse,
  type ChargesReportDto,
  ErrorCode,
  type ExpenseCategoryDto,
  type ExpenseDto,
  type ExpensePage,
  type InviteResultDto,
  type RentContractDto,
  type RentScheduleDto,
  type WarehouseDto,
} from '@erp/shared';
import { FeaturesService } from '../src/billing/features.service';
import { tenantContext } from '../src/common/tenant-context';
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

/** The Algiers year, the one document numbers use. */
const YEAR = Number(
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Algiers', year: 'numeric' }).format(
    new Date(),
  ),
);

/** Dépenses, baux and the charges report (phase 25). */
describe('expenses and rent (phase 25)', () => {
  let t: TestApp;
  /** Essentiel edition: EXPENSES on, MULTI_UNIT off. */
  let e: RegisteredTenant;
  /** Distribution edition: MULTI_UNIT on. */
  let d: RegisteredTenant;
  let seq = 0;
  let categoriesE: ExpenseCategoryDto[];
  let depotA: WarehouseDto;
  let depotB: WarehouseDto;
  /** Manager who works in A and sees B's figures. */
  let managerA: Member;
  /** Seller who works in A, no expense permission. */
  let sellerA: Member;

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
    delete: (url: string) =>
      t
        .http()
        .delete(url)
        .set(...bearer(who.auth.accessToken)),
  });

  const read = <T>(sql: TemplateStringsArray, ...values: unknown[]) =>
    tenantContext.runAsSystem(() => t.prisma.db.$queryRaw<T>(sql, ...values));

  const invite = async (who: RegisteredTenant, role: 'SELLER' | 'MANAGER'): Promise<Member> => {
    const email = uniqueEmail(role.toLowerCase());
    const res = await as(who)
      .post(
        '/users/invite',
        { fullName: `${role} ${++seq}`, email, role, mode: 'PASSWORD', password: 'Password123!' },
        null,
      )
      .expect(201);
    const user = (res.body as InviteResultDto).user;
    const login = await t
      .http()
      .post('/auth/login')
      .send({ email, password: 'Password123!' })
      .expect(200);
    await t
      .http()
      .post('/auth/password')
      .set(...bearer((login.body as AuthResponse).accessToken))
      .send({ currentPassword: 'Password123!', newPassword: 'Password456!' })
      .expect((r) => {
        if (r.status >= 300) throw new Error(`password change: ${r.status}`);
      });
    const relog = await t
      .http()
      .post('/auth/login')
      .send({ email, password: 'Password456!' })
      .expect(200);
    return { id: user.id, auth: relog.body as AuthResponse };
  };

  const category = (key: string) => categoriesE.find((c) => c.key === key)!;
  const expense = (who: Who, body: object, key: string | null = randomUUID()) =>
    as(who).post('/expenses', { amount: '1000', mode: 'ESPECES', ...body }, key);
  const charges = async (who: Who, from: string, to: string, extra = '') =>
    (await as(who).get(`/reports/charges?from=${from}&to=${to}${extra}`).expect(200))
      .body as ChargesReportDto;

  beforeAll(async () => {
    t = await createTestApp();
    e = await registerTenant(t, 'Grossiste Charges');
    d = await registerTenant(t, 'Distrib Charges', { activity: Activity.DISTRIBUTEUR });
    await withoutGeoCheck(t, d);
    categoriesE = (await as(e).get('/expense-categories').expect(200)).body as ExpenseCategoryDto[];
    depotA = (
      await as(d).post('/warehouses', { name: 'Vaisselle', type: 'SECONDARY' }, null).expect(201)
    ).body as WarehouseDto;
    depotB = (
      await as(d).post('/warehouses', { name: 'Vêtements', type: 'SECONDARY' }, null).expect(201)
    ).body as WarehouseDto;
    managerA = await invite(d, 'MANAGER');
    sellerA = await invite(d, 'SELLER');
    for (const [m, access] of [
      [
        managerA,
        [
          { warehouseId: depotA.id, level: 'OPERATE' },
          { warehouseId: depotB.id, level: 'VIEW_STATS' },
        ],
      ],
      [sellerA, [{ warehouseId: depotA.id, level: 'OPERATE' }]],
    ] as const) {
      await as(d).put(`/users/${m.id}/access`, { access }).expect(200);
    }
  });

  afterAll(async () => {
    await t.close();
  });

  describe('categories', () => {
    it('seeds the six default categories at signup', () => {
      expect(categoriesE.map((c) => [c.key, c.name])).toEqual([
        ['RENT', 'Loyer'],
        ['UTILITIES', 'Électricité / eau'],
        ['SALARIES', 'Salaires'],
        ['TRANSPORT', 'Transport / carburant'],
        ['TELECOM', 'Téléphone / internet'],
        ['OTHER', 'Autre'],
      ]);
    });

    it('creates, renames, archives and restores; never archives Loyer', async () => {
      const c = (await as(e).post('/expense-categories', { name: 'Gardiennage' }, null).expect(201))
        .body as ExpenseCategoryDto;
      const dup = await as(e)
        .post('/expense-categories', { name: 'gardiennage' }, null)
        .expect(409);
      expect((dup.body as ApiError).code).toBe(ErrorCode.EXPENSE_CATEGORY_NAME_TAKEN);
      await as(e).put(`/expense-categories/${c.id}`, { name: 'Sécurité' }).expect(200);
      await as(e).delete(`/expense-categories/${c.id}`).expect(204);
      const live = (await as(e).get('/expense-categories').expect(200))
        .body as ExpenseCategoryDto[];
      expect(live.map((x) => x.id)).not.toContain(c.id);
      // An archived category takes no new expense.
      await expense(e, { categoryId: c.id }).expect(400);
      await as(e).post(`/expense-categories/${c.id}/restore`, {}, null).expect(200);

      const rent = await as(e)
        .delete(`/expense-categories/${category('RENT').id}`)
        .expect(409);
      expect((rent.body as ApiError).code).toBe(ErrorCode.EXPENSE_CATEGORY_PROTECTED);
    });

    it('lets only RENT_MANAGE change them', async () => {
      await as(sellerA).get('/expense-categories').expect(403);
      await as(managerA).post('/expense-categories', { name: 'Divers' }, null).expect(201);
    });
  });

  describe('expenses', () => {
    it('creates DEP-YYYY-000001, without dépôt when MULTI_UNIT is off; a replay creates nothing', async () => {
      const key = randomUUID();
      const body = {
        categoryId: category('TELECOM').id,
        amount: '4 500,50',
        payee: 'Djezzy',
        date: `${YEAR}-02-10`,
      };
      const first = (await expense(e, body, key).expect(201)).body as ExpenseDto;
      expect(first.number).toBe(`DEP-${YEAR}-000001`);
      expect(first.amount).toBe('4500.50');
      expect(first.warehouse).toBeNull();
      expect(first.status).toBe('VALID');
      const replay = (await expense(e, body, key).expect(201)).body as ExpenseDto;
      expect(replay.id).toBe(first.id);
      const [row] = await read<{ n: bigint }[]>`
        SELECT count(*) AS n FROM expenses WHERE "tenantId" = ${e.tenantId}::uuid`;
      expect(Number(row!.n)).toBe(1);
      const audit = await read<{ action: string }[]>`
        SELECT action FROM audit_logs WHERE "entityId" = ${first.id}`;
      expect(audit.map((a) => a.action)).toEqual(['EXPENSE_CREATED']);
    });

    it('needs an Idempotency-Key and validates the period', async () => {
      await expense(e, { categoryId: category('OTHER').id }, null).expect(400);
      await expense(e, {
        categoryId: category('OTHER').id,
        periodStart: `${YEAR}-03-01`,
      }).expect(400);
      await expense(e, {
        categoryId: category('OTHER').id,
        periodStart: `${YEAR}-03-31`,
        periodEnd: `${YEAR}-03-01`,
      }).expect(400);
      await expense(e, { categoryId: category('OTHER').id, amount: '0' }).expect(400);
    });

    it('cancels with a reason, once, with EXPENSE_CANCEL', async () => {
      const x = (await expense(e, { categoryId: category('OTHER').id }).expect(201))
        .body as ExpenseDto;
      await as(e).post(`/expenses/${x.id}/cancel`, { reason: 'x' }).expect(400);
      const cancelled = (
        await as(e).post(`/expenses/${x.id}/cancel`, { reason: 'Saisie en double' }).expect(200)
      ).body as ExpenseDto;
      expect(cancelled.status).toBe('CANCELLED');
      expect(cancelled.cancelReason).toBe('Saisie en double');
      const again = await as(e)
        .post(`/expenses/${x.id}/cancel`, { reason: 'Encore une fois' })
        .expect(409);
      expect((again.body as ApiError).code).toBe(ErrorCode.EXPENSE_NOT_VALID);
      // Still there: nothing is deleted.
      const page = (await as(e).get('/expenses?status=CANCELLED').expect(200)).body as ExpensePage;
      expect(page.items.map((i) => i.id)).toContain(x.id);
      // A seller has no expense rights by default.
      await expense(sellerA, { categoryId: category('OTHER').id }).expect(403);
    });

    it('numbers concurrent creates without gaps', async () => {
      const before = await read<{ n: bigint }[]>`
        SELECT count(*) AS n FROM expenses WHERE "tenantId" = ${e.tenantId}::uuid`;
      const results = await Promise.all(
        Array.from({ length: 12 }, () =>
          expense(e, { categoryId: category('TRANSPORT').id, amount: '100' }),
        ),
      );
      expect(results.map((r) => r.status)).toEqual(Array(12).fill(201));
      const numbers = results
        .map((r) => Number((r.body as ExpenseDto).number.slice(-6)))
        .sort((x, y) => x - y);
      const start = Number(before[0]!.n) + 1;
      expect(numbers).toEqual(Array.from({ length: 12 }, (_, i) => start + i));
    });

    it('lists with filters and a cursor', async () => {
      const first = (await as(e).get('/expenses?limit=5').expect(200)).body as ExpensePage;
      expect(first.items).toHaveLength(5);
      expect(first.nextCursor).not.toBeNull();
      const next = (await as(e).get(`/expenses?limit=5&cursor=${first.nextCursor}`).expect(200))
        .body as ExpensePage;
      expect(next.items.map((i) => i.id)).not.toContain(first.items[0]!.id);
      const telecom = (
        await as(e)
          .get(`/expenses?categoryId=${category('TELECOM').id}`)
          .expect(200)
      ).body as ExpensePage;
      expect(telecom.items.every((i) => i.category.key === 'TELECOM')).toBe(true);
      const feb = (
        await as(e)
          .get(`/expenses?from=${YEAR}-02-01&to=${YEAR}-02-28&categoryId=${category('TELECOM').id}`)
          .expect(200)
      ).body as ExpensePage;
      expect(feb.items.map((i) => i.payee)).toEqual(['Djezzy']);
    });
  });

  describe('rent contracts and the charges report', () => {
    let lease: RentContractDto;
    const Y = 2025; // 365 days

    it('creates a yearly contract on the dépôt principal', async () => {
      lease = (
        await as(e)
          .post(
            '/rent-contracts',
            {
              landlordName: 'M. Benali',
              landlordPhone: '0550 12 34 56',
              amount: '1200000',
              period: 'YEARLY',
              startDate: `${Y}-01-01`,
            },
            null,
          )
          .expect(201)
      ).body as RentContractDto;
      expect(lease.locked).toBe(false);
      expect(lease.paidUntil).toBeNull();
      expect(lease.nextDueDate).toBe(`${Y}-01-01`);
      expect(lease.alerts).toContain('UNPAID_DUE');
      // Editable before its first payment.
      lease = (
        await as(e)
          .patch(`/rent-contracts/${lease.id}`, {
            landlordName: 'M. Benali Ahmed',
            amount: '1200000',
            period: 'YEARLY',
            startDate: `${Y}-01-01`,
          })
          .expect(200)
      ).body as RentContractDto;
      expect(lease.landlordName).toBe('M. Benali Ahmed');
    });

    it('charges October 1 200 000 × 31 / 365, and an expense by its period', async () => {
      // Electricity for September + October (61 days), paid in November.
      await expense(e, {
        categoryId: category('UTILITIES').id,
        amount: '6100',
        date: `${Y}-11-05`,
        periodStart: `${Y}-09-01`,
        periodEnd: `${Y}-10-31`,
      }).expect(201);
      const oct = await charges(e, `${Y}-10-01`, `${Y}-10-31`);
      expect(oct.rent).toBe('101917.81');
      expect(oct.expenses).toBe('3100.00');
      expect(oct.total).toBe('105017.81');
      const loyer = oct.byCategory.find((r) => r.category.key === 'RENT')!;
      expect(loyer).toMatchObject({ rent: '101917.81', expenses: '0.00' });
      // Sorted by name, expenses without a dépôt last.
      expect(oct.byWarehouse).toEqual([
        expect.objectContaining({ rent: '101917.81', expenses: '0.00', total: '101917.81' }),
        { warehouse: null, rent: '0.00', expenses: '3100.00', total: '3100.00' },
      ]);
      const year = await charges(e, `${Y}-01-01`, `${Y}-12-31`);
      expect(year.rent).toBe('1200000.00');
    });

    it('refuses a payment off the contract periods', async () => {
      const bad = await expense(e, {
        rentContractId: lease.id,
        amount: '600000',
        periodStart: `${Y}-01-01`,
        periodEnd: `${Y}-06-30`,
      }).expect(400);
      expect((bad.body as ApiError).code).toBe(ErrorCode.RENT_PERIOD_INVALID);
      await expense(e, { rentContractId: lease.id, amount: '1200000' }).expect(400);
    });

    it('a Loyer payment is cash only: the charges do not double', async () => {
      const before = await charges(e, `${Y}-10-01`, `${Y}-10-31`);
      const paid = (
        await expense(e, {
          rentContractId: lease.id,
          amount: '1200000',
          date: `${Y}-10-05`,
          periodStart: `${Y}-01-01`,
          periodEnd: `${Y}-12-31`,
          payee: 'M. Benali',
        }).expect(201)
      ).body as ExpenseDto;
      expect(paid.category.key).toBe('RENT');
      expect(paid.warehouse).not.toBeNull(); // the contract's dépôt
      const after = await charges(e, `${Y}-10-01`, `${Y}-10-31`);
      expect(after.total).toBe(before.total);
      expect(after.rent).toBe('101917.81');
      expect(after.rentPaid).toBe('1200000.00');

      const again = await expense(e, {
        rentContractId: lease.id,
        amount: '1200000',
        periodStart: `${Y}-01-01`,
        periodEnd: `${Y}-12-31`,
      }).expect(400);
      expect((again.body as ApiError).details).toMatchObject({ rule: 'already_paid' });
    });

    it('shows paid until and the next due date; a paid contract is never edited', async () => {
      const s = (await as(e).get(`/rent-contracts/${lease.id}/schedule`).expect(200))
        .body as RentScheduleDto;
      expect(s.contract.locked).toBe(true);
      expect(s.contract.paidUntil).toBe(`${Y}-12-31`);
      expect(s.contract.nextDueDate).toBe(`${Y + 1}-01-01`);
      expect(s.slots[0]).toMatchObject({ start: `${Y}-01-01`, status: 'PAID' });
      expect(s.payments).toHaveLength(1);

      const edit = await as(e)
        .patch(`/rent-contracts/${lease.id}`, {
          landlordName: 'Autre',
          amount: '1500000',
          period: 'YEARLY',
          startDate: `${Y}-01-01`,
        })
        .expect(409);
      expect((edit.body as ApiError).code).toBe(ErrorCode.RENT_CONTRACT_LOCKED);
    });

    it('closes, never before what is paid, then a new contract takes over', async () => {
      const early = await as(e)
        .post(`/rent-contracts/${lease.id}/close`, { endDate: `${Y}-06-30` }, null)
        .expect(400);
      expect((early.body as ApiError).details).toMatchObject({ paidUntil: `${Y}-12-31` });
      const closed = (
        await as(e)
          .post(`/rent-contracts/${lease.id}/close`, { endDate: `${Y}-12-31` }, null)
          .expect(200)
      ).body as RentContractDto;
      expect(closed.endDate).toBe(`${Y}-12-31`);
      expect(closed.nextDueDate).toBeNull();
      await as(e)
        .post(`/rent-contracts/${lease.id}/close`, { endDate: `${Y}-12-31` }, null)
        .expect(409);
      await as(e)
        .post(
          '/rent-contracts',
          {
            landlordName: 'M. Benali',
            amount: '120000',
            period: 'MONTHLY',
            startDate: `${Y + 1}-01-01`,
          },
          null,
        )
        .expect(201);
      // 2025 keeps its cost; January 2026 is the new rent.
      expect((await charges(e, `${Y}-10-01`, `${Y}-10-31`)).rent).toBe('101917.81');
      expect((await charges(e, `${Y + 1}-01-01`, `${Y + 1}-01-31`)).rent).toBe('120000.00');
    });

    it('cancelling the payment brings the period due again', async () => {
      const page = (await as(e).get(`/expenses?rentContractId=${lease.id}`).expect(200))
        .body as ExpensePage;
      await as(e)
        .post(`/expenses/${page.items[0]!.id}/cancel`, { reason: 'Chèque refusé' })
        .expect(200);
      const c = (await as(e).get(`/rent-contracts/${lease.id}`).expect(200))
        .body as RentContractDto;
      expect(c.paidUntil).toBeNull();
      expect(c.amountDue).toBe('1200000.00');
      expect(c.locked).toBe(false);
    });

    it('exports to Excel behind EXPORT_DATA', async () => {
      const res = await as(e)
        .get(`/reports/charges/export.xlsx?from=${Y}-10-01&to=${Y}-10-31`)
        .expect(200);
      expect(res.headers['content-type']).toContain('spreadsheetml');
      await as(sellerA).get(`/reports/charges?from=${Y}-10-01&to=${Y}-10-31`).expect(403);
    });
  });

  describe('dépôts (MULTI_UNIT) and isolation', () => {
    let expenseB: ExpenseDto;
    let contractB: RentContractDto;

    beforeAll(async () => {
      const cats = (await as(d).get('/expense-categories').expect(200))
        .body as ExpenseCategoryDto[];
      const utilities = cats.find((c) => c.key === 'UTILITIES')!;
      expenseB = (
        await expense(d, {
          categoryId: utilities.id,
          amount: '2500',
          warehouseId: depotB.id,
          date: `${YEAR}-01-15`,
        }).expect(201)
      ).body as ExpenseDto;
      contractB = (
        await as(d)
          .post(
            '/rent-contracts',
            {
              warehouseId: depotB.id,
              landlordName: 'Propriétaire B',
              amount: '31000',
              period: 'MONTHLY',
              startDate: `${YEAR}-01-01`,
            },
            null,
          )
          .expect(201)
      ).body as RentContractDto;
    });

    it('a manager works in A: B documents are not there', async () => {
      await as(managerA).get(`/expenses/${expenseB.id}`).expect(404);
      const page = (await as(managerA).get('/expenses').expect(200)).body as ExpensePage;
      expect(page.items.map((i) => i.id)).not.toContain(expenseB.id);
      await as(managerA).get(`/rent-contracts/${contractB.id}`).expect(404);
      const list = (await as(managerA).get('/rent-contracts').expect(200))
        .body as RentContractDto[];
      expect(list.map((c) => c.id)).not.toContain(contractB.id);
      const write = await expense(managerA, {
        categoryId: expenseB.category.id,
        warehouseId: depotB.id,
      }).expect(404);
      expect((write.body as ApiError).code).toBe(ErrorCode.WAREHOUSE_NOT_FOUND);
      await as(managerA)
        .post(`/expenses/${expenseB.id}/cancel`, { reason: 'Pas à moi' })
        .expect(404);
    });

    it('defaults to the only dépôt the user works in', async () => {
      const mine = (await expense(managerA, { categoryId: expenseB.category.id }).expect(201))
        .body as ExpenseDto;
      expect(mine.warehouse?.id).toBe(depotA.id);
    });

    it('sees B in the charges report through VIEW_STATS, rolled up by dépôt', async () => {
      const r = await charges(managerA, `${YEAR}-01-01`, `${YEAR}-01-31`);
      const b = r.byWarehouse.find((w) => w.warehouse?.id === depotB.id)!;
      expect(b).toMatchObject({ rent: '31000.00', expenses: '2500.00', total: '33500.00' });
      const onlyB = await charges(
        managerA,
        `${YEAR}-01-01`,
        `${YEAR}-01-31`,
        `&warehouseId=${depotB.id}`,
      );
      expect(onlyB.byWarehouse.map((w) => w.warehouse?.id)).toEqual([depotB.id]);
      expect(onlyB.total).toBe('33500.00');
    });

    it("a truck has no rent; its charges are its dépôt's", async () => {
      const truck = (
        await as(d).post('/warehouses', { name: 'Camion 1', type: 'VEHICLE' }, null).expect(201)
      ).body as WarehouseDto;
      await as(d).patch(`/warehouses/${truck.id}`, { parentWarehouseId: depotA.id }).expect(200);
      await as(d)
        .post(
          '/rent-contracts',
          {
            warehouseId: truck.id,
            landlordName: 'X',
            amount: '1000',
            period: 'MONTHLY',
            startDate: `${YEAR}-01-01`,
          },
          null,
        )
        .expect(422);
      await expense(d, {
        categoryId: expenseB.category.id,
        amount: '700',
        warehouseId: truck.id,
        date: `${YEAR}-01-20`,
      }).expect(201);
      const r = await charges(
        managerA,
        `${YEAR}-01-01`,
        `${YEAR}-01-31`,
        `&warehouseId=${depotA.id}`,
      );
      expect(r.byWarehouse.map((w) => w.warehouse?.id)).toEqual([depotA.id]);
      expect(r.expenses).toBe('700.00');
    });

    it('tenant A never reads or writes tenant B rows', async () => {
      await as(e).get(`/expenses/${expenseB.id}`).expect(404);
      await as(e).get(`/rent-contracts/${contractB.id}`).expect(404);
      await as(e).post(`/expenses/${expenseB.id}/cancel`, { reason: 'Intrusion' }).expect(404);
      const report = await charges(e, `${YEAR}-01-01`, `${YEAR}-01-31`);
      expect(report.byWarehouse.map((w) => w.warehouse?.id)).not.toContain(depotB.id);
      // RLS: another tenant's context sees none of d's rows.
      const rows = await tenantContext.run({ tenantId: e.tenantId }, () =>
        t.prisma.db.expense.findMany({ where: { id: expenseB.id } }),
      );
      expect(rows).toEqual([]);
    });

    it('is refused when the module is taken away', async () => {
      const f = await registerTenant(t, 'Sans charges');
      await tamper(
        t,
      )`UPDATE tenants SET "featureRevokes" = ARRAY['EXPENSES'] WHERE id = ${f.tenantId}::uuid`;
      t.app.get(FeaturesService).invalidate(f.tenantId);
      await as(f).get('/expenses').expect(403);
      await expense(f, { categoryId: randomUUID() }).expect(403);
      await as(f).get(`/reports/charges?from=${YEAR}-01-01&to=${YEAR}-01-31`).expect(403);
    });
  });
});
