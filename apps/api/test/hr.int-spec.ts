import { randomUUID } from 'node:crypto';
import ExcelJS from 'exceljs';
import {
  Activity,
  addDays,
  algiersDay,
  type AttendanceDayDto,
  type AttendanceMonthDto,
  type AttendanceTodayDto,
  type AuditLogPage,
  type AuthResponse,
  type ChargesReportDto,
  type EmployeeDto,
  type EmployeeLedgerEntryDto,
  type EmployeeLedgerPage,
  type EmployeePage,
  type EmployeeSalaryDto,
  type ExpensePage,
  FIXED_PUBLIC_HOLIDAYS,
  type ImportPreviewDto,
  type InviteResultDto,
  type LeaveBalanceDto,
  type LeaveRequestDto,
  type MarkAttendanceResult,
  monthBounds,
  type MyAttendanceDto,
  previousMonth,
  salaryOn,
  type WarehouseDto,
  weekdayOf,
} from '@erp/shared';
import { FeaturesService } from '../src/billing/features.service';
import { tenantContext } from '../src/common/tenant-context';
import { MonthCloseService } from '../src/hr/month-close.service';
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
const HIRED = addDays(TODAY, -800);

/** The last day before `from` that falls on `weekday` (2 = Tuesday: never a rest day here). */
function lastWeekday(weekday: number, from = addDays(TODAY, -1)): string {
  let d = from;
  while (weekdayOf(d) !== weekday || isFixedHoliday(d)) d = addDays(d, -1);
  return d;
}
function isFixedHoliday(day: string): boolean {
  return FIXED_PUBLIC_HOLIDAYS.some((h) => h.monthDay === day.slice(5));
}
/** A Sunday-to-Saturday week after `from` with no fixed fête in it. */
function cleanWeek(from: string): { sunday: string; saturday: string } {
  let d = addDays(from, 1);
  for (;;) {
    while (weekdayOf(d) !== 0) d = addDays(d, 1);
    const saturday = addDays(d, 6);
    const days = Array.from({ length: 7 }, (_, i) => addDays(d, i));
    if (!days.some(isFixedHoliday)) return { sunday: d, saturday };
    d = addDays(d, 7);
  }
}

/** DRH part 1 (phase 31): personnel, pointage, congés, avances. */
describe('hr attendance (phase 31)', () => {
  let t: TestApp;
  /** Distribution edition: HR, MULTI_UNIT and GEO_CHECK on. */
  let d: RegisteredTenant;
  let other: RegisteredTenant;
  let depotA: WarehouseDto;
  let depotB: WarehouseDto;
  /** MANAGER who works in A and sees B's figures: no SALARY_VIEW by default. */
  let managerA: Member;
  /** SELLER who works in A: no HR permission. */
  let sellerA: Member;
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

  const employee = async (over: object = {}, who: Who = d): Promise<EmployeeDto> =>
    (
      await as(who)
        .post(
          '/employees',
          {
            fullName: `Employé ${++seq}`,
            hireDate: HIRED,
            contract: 'CDI',
            warehouseId: depotA.id,
            ...over,
          },
          null,
        )
        .expect(201)
    ).body as EmployeeDto;

  const mark = (who: Who, date: string, marks: object[], extra: object = {}, key?: string) =>
    as(who).post('/attendance/events', { date, marks, ...extra }, key ?? randomUUID());

  const dayOf = async (who: Who, date: string, employeeId: string) => {
    const res = await as(who).get(`/attendance/day?date=${date}`).expect(200);
    return (res.body as AttendanceDayDto).rows.find((r) => r.employee.id === employeeId);
  };

  const balance = async (id: string) =>
    ((await as(d).get(`/employees/${id}/leave-balance`).expect(200)).body as LeaveBalanceDto)
      .balance;

  const mismatches = async () => {
    const result = await t.app.get(ReconcileService).run();
    expect(result.ran).toBe(true);
    return result.mismatches.filter((m) => m.tenantId === d.tenantId);
  };

  beforeAll(async () => {
    t = await createTestApp();
    d = await registerTenant(t, 'Distrib RH', { activity: Activity.DISTRIBUTEUR });
    other = await registerTenant(t, 'Autre RH', { activity: Activity.DISTRIBUTEUR });
    await withoutGeoCheck(t, other);
    depotA = (await as(d).post('/warehouses', { name: 'A', type: 'SECONDARY' }, null).expect(201))
      .body as WarehouseDto;
    depotB = (await as(d).post('/warehouses', { name: 'B', type: 'SECONDARY' }, null).expect(201))
      .body as WarehouseDto;
    managerA = await invite(d, 'MANAGER');
    sellerA = await invite(d, 'SELLER');
    await as(d)
      .put(`/users/${managerA.id}/access`, {
        access: [
          { warehouseId: depotA.id, level: 'OPERATE' },
          { warehouseId: depotB.id, level: 'VIEW_STATS' },
        ],
      })
      .expect(200);
    await as(d)
      .put(`/users/${sellerA.id}/access`, {
        access: [{ warehouseId: depotA.id, level: 'OPERATE' }],
      })
      .expect(200);
  });

  afterAll(async () => {
    await t.close();
  });

  describe('employees', () => {
    it('numbers per tenant, not per year, and accepts an undeclared worker', async () => {
      const fresh = await registerTenant(t, 'Matricules', { activity: Activity.DISTRIBUTEUR });
      const main = ((await as(fresh).get('/warehouses').expect(200)).body as WarehouseDto[])[0]!;
      const first = await employee({ warehouseId: main.id, declared: false }, fresh);
      const second = await employee({ warehouseId: main.id }, fresh);
      expect(first.matricule).toBe('EMP-000001');
      expect(second.matricule).toBe('EMP-000002');
      expect(first.declared).toBe(false);
    });

    it('needs a dépôt with MULTI_UNIT, and refuses a truck', async () => {
      await as(d)
        .post(
          '/employees',
          { fullName: 'Sans dépôt', hireDate: HIRED, contract: 'CDI', warehouseId: null },
          null,
        )
        .expect(400);
    });

    it('needs an end date on a CDD', async () => {
      await as(d)
        .post(
          '/employees',
          { fullName: 'CDD', hireDate: HIRED, contract: 'CDD', warehouseId: depotA.id },
          null,
        )
        .expect(400);
    });

    it('links one employee per user', async () => {
      const seller = await invite(d, 'SELLER');
      await employee({ userId: seller.id });
      const res = await as(d)
        .post(
          '/employees',
          {
            fullName: 'Doublon',
            hireDate: HIRED,
            contract: 'CDI',
            warehouseId: depotA.id,
            userId: seller.id,
          },
          null,
        )
        .expect(409);
      expect((res.body as { code: string }).code).toBe('EMPLOYEE_USER_TAKEN');
    });

    it('archives softly', async () => {
      const e = await employee();
      await as(d).delete(`/employees/${e.id}`).expect(204);
      const list = (await as(d).get('/employees').expect(200)).body as EmployeePage;
      expect(list.items.map((i) => i.id)).not.toContain(e.id);
      const restored = (await as(d).post(`/employees/${e.id}/restore`, {}, null).expect(200))
        .body as EmployeeDto;
      expect(restored.archived).toBe(false);
    });
  });

  describe('salaries', () => {
    it('appends: a raise never changes what a past day was paid', async () => {
      const e = await employee({
        salary: { amount: '40000', payType: 'MONTHLY', effectiveFrom: HIRED, reason: 'Embauche' },
      });
      const raise = addDays(TODAY, -30);
      const rows = (
        await as(d)
          .post(`/employees/${e.id}/salaries`, {
            amount: '50000',
            payType: 'MONTHLY',
            effectiveFrom: raise,
            reason: 'Augmentation',
          })
          .expect(201)
      ).body as EmployeeSalaryDto[];
      expect(rows).toHaveLength(2);
      expect(salaryOn(rows, addDays(raise, -1))?.amount).toBe('40000.00');
      expect(salaryOn(rows, raise)?.amount).toBe('50000.00');
    });

    it('refuses to edit a salary row, even with raw SQL', async () => {
      const e = await employee({
        salary: { amount: '40000', payType: 'MONTHLY', effectiveFrom: HIRED, reason: null },
      });
      await expect(
        tamper(t)`UPDATE employee_salaries SET amount = 1 WHERE "employeeId" = ${e.id}::uuid`,
      ).rejects.toThrow(/append-only/);
    });

    it('gives a manager without SALARY_VIEW no pay field at all', async () => {
      const e = await employee({
        bankAccount: '00799999000123456789',
        salary: { amount: '40000', payType: 'MONTHLY', effectiveFrom: HIRED, reason: null },
      });
      const owner = (await as(d).get(`/employees/${e.id}`).expect(200)).body as EmployeeDto;
      expect(owner.pay?.salary).toBe('40000.00');

      const seen = await as(managerA).get(`/employees/${e.id}`).expect(200);
      expect(seen.body).not.toHaveProperty('pay');
      expect(JSON.stringify(seen.body)).not.toContain('40000');
      expect(JSON.stringify(seen.body)).not.toContain('00799999000123456789');
      const list = await as(managerA).get('/employees').expect(200);
      expect(JSON.stringify(list.body)).not.toContain('40000');
      await as(managerA).get(`/employees/${e.id}/salaries`).expect(403);
      await as(managerA).get(`/employees/${e.id}/ledger`).expect(403);
    });

    it('does not let a manager set pay, or wipe the RIB he cannot see', async () => {
      const res = await as(managerA)
        .post(
          '/employees',
          {
            fullName: 'Payé',
            hireDate: HIRED,
            contract: 'CDI',
            warehouseId: depotA.id,
            salary: { amount: '1', payType: 'DAILY', effectiveFrom: HIRED, reason: null },
          },
          null,
        )
        .expect(403);
      expect((res.body as { code: string }).code).toBe('FORBIDDEN');

      const e = await employee({ bankAccount: 'RIB-GARDE' });
      await as(managerA)
        .put(`/employees/${e.id}`, {
          fullName: e.fullName,
          hireDate: HIRED,
          contract: 'CDI',
          warehouseId: depotA.id,
          position: 'Chef',
        })
        .expect(200);
      const after = (await as(d).get(`/employees/${e.id}`).expect(200)).body as EmployeeDto;
      expect(after.pay?.bankAccount).toBe('RIB-GARDE');
      expect(after.position).toBe('Chef');
    });
  });

  describe('pointage', () => {
    const DAY = lastWeekday(2);

    it('marks a day, and an idempotent replay creates nothing', async () => {
      const e = await employee();
      const key = randomUUID();
      const first = await mark(d, DAY, [{ employeeId: e.id, kind: 'PRESENT' }], {}, key).expect(
        201,
      );
      const replay = await mark(d, DAY, [{ employeeId: e.id, kind: 'PRESENT' }], {}, key).expect(
        201,
      );
      expect(replay.body).toEqual(first.body);
      const row = await dayOf(d, DAY, e.id);
      expect(row?.status).toBe('PRESENT');
      expect(row?.events).toHaveLength(1);
    });

    it('leaves a day nobody marked as UNMARKED', async () => {
      const e = await employee();
      expect((await dayOf(d, DAY, e.id))?.status).toBe('UNMARKED');
    });

    it('never counts a day that has not happened as unmarked', async () => {
      const e = await employee();
      const next = addDays(monthBounds(TODAY.slice(0, 7)).to, 1).slice(0, 7);
      const future = (
        await as(d).get(`/attendance/month?month=${next}&employeeId=${e.id}`).expect(200)
      ).body as AttendanceMonthDto;
      expect(future.rows[0]?.counts.unmarked).toBe(0);
      expect(future.totals.unmarked).toBe(0);

      const now = (
        await as(d)
          .get(`/attendance/month?month=${TODAY.slice(0, 7)}&employeeId=${e.id}`)
          .expect(200)
      ).body as AttendanceMonthDto;
      const row = now.rows[0]!;
      expect(row.counts.unmarked).toBe(
        row.days.filter((x) => x.date <= TODAY && x.status === 'UNMARKED').length,
      );
    });

    it('gives the dashboard card its counts, within the reach of the user', async () => {
      const fresh = await registerTenant(t, 'Carte RH', { activity: Activity.DISTRIBUTEUR });
      const main = ((await as(fresh).get('/warehouses').expect(200)).body as WarehouseDto[])[0]!;
      const [a, b, c] = [
        await employee({ warehouseId: main.id }, fresh),
        await employee({ warehouseId: main.id }, fresh),
        await employee({ warehouseId: main.id }, fresh),
      ];
      await mark(fresh, DAY, [{ employeeId: a.id, kind: 'PRESENT' }]).expect(201);
      expect(c.id).toBeTruthy();
      const today = async () =>
        (await as(fresh).get('/attendance/today').expect(200)).body as AttendanceTodayDto;
      const before = await today();
      await mark(fresh, TODAY, [
        { employeeId: a.id, kind: 'HALF_DAY' },
        { employeeId: b.id, kind: 'ABSENT', absenceReason: 'SICK' },
      ]).expect(201);
      const after = await today();
      // Today may be a rest day or a fête: the marks count either way, an absence only on a
      // working day, and nothing here depends on which.
      expect(after.present).toBe(before.present + 1);
      expect(after.unmarked).toBeLessThanOrEqual(before.unmarked);
    });

    it('refuses a second mark and a future day', async () => {
      const e = await employee();
      await mark(d, DAY, [{ employeeId: e.id, kind: 'PRESENT' }]).expect(201);
      const res = await mark(d, DAY, [
        { employeeId: e.id, kind: 'ABSENT', absenceReason: 'SICK' },
      ]).expect(409);
      expect((res.body as { code: string }).code).toBe('ATTENDANCE_ALREADY_MARKED');
      await mark(d, addDays(TODAY, 1), [{ employeeId: e.id, kind: 'PRESENT' }]).expect(422);
    });

    it('refuses a day outside employment', async () => {
      const e = await employee({ hireDate: TODAY });
      const res = await mark(d, DAY, [{ employeeId: e.id, kind: 'PRESENT' }]).expect(422);
      expect((res.body as { code: string }).code).toBe('EMPLOYEE_NOT_EMPLOYED');
    });

    it('adds overtime to a marked day and adds up the month', async () => {
      const e = await employee();
      await mark(d, DAY, [
        { employeeId: e.id, kind: 'LATE', lateMinutes: 20 },
        { employeeId: e.id, kind: 'OVERTIME', overtimeHours: '1.5' },
      ]).expect(201);
      await mark(d, DAY, [{ employeeId: e.id, kind: 'OVERTIME', overtimeHours: '1' }]).expect(201);
      const row = await dayOf(d, DAY, e.id);
      expect(row).toMatchObject({ status: 'PRESENT', lateMinutes: 20, overtimeHours: '2.5' });
      const month = (
        await as(d)
          .get(`/attendance/month?month=${DAY.slice(0, 7)}&employeeId=${e.id}`)
          .expect(200)
      ).body as AttendanceMonthDto;
      expect(month.rows[0]?.counts).toMatchObject({
        present: '1.0',
        lateMinutes: 20,
        overtimeHours: '2.50',
      });
    });

    it('corrects with a new event and keeps the history', async () => {
      const e = await employee();
      await mark(d, DAY, [
        { employeeId: e.id, kind: 'ABSENT', absenceReason: 'UNJUSTIFIED' },
      ]).expect(201);
      const body = { employeeId: e.id, date: DAY, correctedTo: 'SICK', reason: 'Arrêt reçu' };
      await as(d)
        .post('/attendance/corrections', { ...body, reason: '' })
        .expect(400);
      await as(d).post('/attendance/corrections', body).expect(201);
      const row = await dayOf(d, DAY, e.id);
      expect(row?.status).toBe('SICK');
      expect(row?.events.map((ev) => ev.kind)).toEqual(['ABSENT', 'CORRECTION']);
      expect(row?.events[1]?.note).toBe('Arrêt reçu');
    });

    it('undoes a wrong tap, after which the day can be marked again', async () => {
      const e = await employee();
      await mark(d, DAY, [{ employeeId: e.id, kind: 'PRESENT' }]).expect(201);
      await as(d)
        .post('/attendance/corrections', {
          employeeId: e.id,
          date: DAY,
          correctedTo: 'UNMARKED',
          reason: 'Mauvais employé',
        })
        .expect(201);
      expect((await dayOf(d, DAY, e.id))?.status).toBe('UNMARKED');
      await mark(d, DAY, [{ employeeId: e.id, kind: 'HALF_DAY' }]).expect(201);
      expect((await dayOf(d, DAY, e.id))?.status).toBe('HALF_DAY');
    });

    it('needs ATTENDANCE_CORRECT to correct', async () => {
      const e = await employee();
      await as(sellerA)
        .post('/attendance/corrections', {
          employeeId: e.id,
          date: DAY,
          correctedTo: 'PRESENT',
          reason: 'Non autorisé',
        })
        .expect(403);
    });

    it('never lets an event be changed, even with raw SQL', async () => {
      const e = await employee();
      await mark(d, DAY, [{ employeeId: e.id, kind: 'PRESENT' }]).expect(201);
      await expect(
        tamper(t)`DELETE FROM attendance_events WHERE "employeeId" = ${e.id}::uuid`,
      ).rejects.toThrow(/append-only/);
    });

    it('"tous présents": 50 employees in one transaction, an absence stays', async () => {
      const fresh = await registerTenant(t, 'Tous présents', { activity: Activity.DISTRIBUTEUR });
      const main = ((await as(fresh).get('/warehouses').expect(200)).body as WarehouseDto[])[0]!;
      const people: EmployeeDto[] = [];
      for (let i = 0; i < 50; i++) people.push(await employee({ warehouseId: main.id }, fresh));
      const absent = people[0]!;
      await mark(fresh, DAY, [
        { employeeId: absent.id, kind: 'ABSENT', absenceReason: 'JUSTIFIED' },
      ]).expect(201);

      const marks = people.map((p) => ({ employeeId: p.id, kind: 'PRESENT' }));
      const key = randomUUID();
      const res = await mark(fresh, DAY, marks, { skipMarked: true }, key).expect(201);
      expect(res.body as MarkAttendanceResult).toMatchObject({ created: 49, skipped: 1 });
      await mark(fresh, DAY, marks, { skipMarked: true }, key).expect(201);

      const day = (await as(fresh).get(`/attendance/day?date=${DAY}`).expect(200))
        .body as AttendanceDayDto;
      expect(day.counts).toEqual({ PRESENT: 49, ABSENT_JUSTIFIED: 1 });
    });

    it('is all or nothing: one bad employee saves no mark', async () => {
      const e = await employee();
      const late = await employee({ hireDate: TODAY });
      await mark(d, DAY, [
        { employeeId: e.id, kind: 'PRESENT' },
        { employeeId: late.id, kind: 'PRESENT' },
      ]).expect(422);
      expect((await dayOf(d, DAY, e.id))?.status).toBe('UNMARKED');
    });

    it('does not double-mark when two managers tap at once', async () => {
      const e = await employee();
      const results = await Promise.all([
        mark(d, DAY, [{ employeeId: e.id, kind: 'PRESENT' }]),
        mark(d, DAY, [{ employeeId: e.id, kind: 'ABSENT', absenceReason: 'SICK' }]),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
      expect((await dayOf(d, DAY, e.id))?.events).toHaveLength(1);
    });
  });

  describe('month lock', () => {
    const DAY = lastWeekday(2, addDays(TODAY, -40));

    it('refuses new events in an approved month, by service and by trigger', async () => {
      const e = await employee();
      const fresh = await employee();
      await mark(d, DAY, [{ employeeId: e.id, kind: 'PRESENT' }]).expect(201);
      const month = DAY.slice(0, 7);
      await tamper(t)`
        INSERT INTO attendance_month_locks ("id", "tenantId", "month", "warehouseId")
        VALUES (gen_random_uuid(), ${d.tenantId}::uuid, ${month}, ${depotA.id}::uuid)`;

      const res = await mark(d, DAY, [{ employeeId: fresh.id, kind: 'PRESENT' }]).expect(409);
      expect((res.body as { code: string }).code).toBe('PERIOD_APPROVED');
      const corrected = await as(d)
        .post('/attendance/corrections', {
          employeeId: e.id,
          date: DAY,
          correctedTo: 'SICK',
          reason: 'Trop tard',
        })
        .expect(409);
      expect((corrected.body as { code: string }).code).toBe('PERIOD_APPROVED');
      await expect(
        tamper(t)`
          INSERT INTO attendance_events
            ("id", "tenantId", "employeeId", "warehouseId", "day", "kind", "source")
          VALUES (gen_random_uuid(), ${d.tenantId}::uuid, ${fresh.id}::uuid, ${depotA.id}::uuid,
                  ${DAY}::date, 'PRESENT', 'MANAGER')`,
      ).rejects.toThrow(/PERIOD_APPROVED/);
      await expect(
        tamper(t)`UPDATE attendance_days SET status = 'SICK' WHERE "employeeId" = ${e.id}::uuid`,
      ).rejects.toThrow(/PERIOD_APPROVED/);

      // Another dépôt's month stays open.
      const elsewhere = await employee({ warehouseId: depotB.id });
      await mark(d, DAY, [{ employeeId: elsewhere.id, kind: 'PRESENT' }]).expect(201);
    });
  });

  describe('congés', () => {
    const week = cleanWeek(TODAY);
    const later = cleanWeek(addDays(week.saturday, 7));
    const request = async (id: string, over: object = {}) =>
      (
        await as(d)
          .post('/leave-requests', {
            employeeId: id,
            startDate: week.sunday,
            endDate: week.saturday,
            type: 'PAID',
            ...over,
          })
          .expect(201)
      ).body as LeaveRequestDto;
    const opening = (id: string, days: string) =>
      tamper(t)`UPDATE employee_balances SET "leaveDays" = "leaveDays" + ${days}::numeric
                WHERE "employeeId" = ${id}::uuid`;
    const seed = async (id: string, days: string) => {
      await tamper(t)`
        INSERT INTO leave_entries ("id", "tenantId", "employeeId", "type", "days")
        VALUES (gen_random_uuid(), ${d.tenantId}::uuid, ${id}::uuid, 'OPENING', ${days}::numeric)`;
      await opening(id, days);
    };

    it('posts the working days only, and the balance matches the ledger', async () => {
      const e = await employee();
      await seed(e.id, '10');
      const leave = await request(e.id);
      expect(leave).toMatchObject({ status: 'PENDING', days: '6.0' });
      expect(await balance(e.id)).toBe('10.0');

      const approved = (await as(d).post(`/leave-requests/${leave.id}/approve`).expect(200))
        .body as LeaveRequestDto;
      expect(approved).toMatchObject({ status: 'APPROVED', days: '6.0', overBalance: false });
      const ledger = (await as(d).get(`/employees/${e.id}/leave-balance`).expect(200))
        .body as LeaveBalanceDto;
      expect(ledger.balance).toBe('4.0');
      expect(ledger.entries.map((x) => [x.type, x.days])).toEqual([
        ['TAKEN', '-6.0'],
        ['OPENING', '10.0'],
      ]);
      expect(await mismatches()).toEqual([]);
    });

    it('does not take sick or unpaid leave out of the balance', async () => {
      for (const type of ['SICK', 'UNPAID', 'OTHER']) {
        const e = await employee();
        await seed(e.id, '5');
        const leave = await request(e.id, { type });
        await as(d).post(`/leave-requests/${leave.id}/approve`).expect(200);
        expect(await balance(e.id)).toBe('5.0');
      }
    });

    it('warns, never refuses, beyond the balance', async () => {
      const e = await employee();
      const leave = await request(e.id);
      const res = (await as(d).post(`/leave-requests/${leave.id}/approve`).expect(200))
        .body as LeaveRequestDto;
      expect(res.overBalance).toBe(true);
      expect(await balance(e.id)).toBe('-6.0');
    });

    it('gives the days back with a reverse entry when an approved leave is cancelled', async () => {
      const e = await employee();
      await seed(e.id, '10');
      const leave = await request(e.id);
      await as(d).post(`/leave-requests/${leave.id}/approve`).expect(200);
      await as(d).post(`/leave-requests/${leave.id}/cancel`, { reason: 'Annulé' }).expect(200);
      const ledger = (await as(d).get(`/employees/${e.id}/leave-balance`).expect(200))
        .body as LeaveBalanceDto;
      expect(ledger.balance).toBe('10.0');
      expect(ledger.entries.map((x) => x.type)).toEqual(['ADJUST', 'TAKEN', 'OPENING']);
      await as(d).post(`/leave-requests/${leave.id}/cancel`, { reason: 'Encore' }).expect(409);
      expect(await mismatches()).toEqual([]);
    });

    it('refuses overlaps and a range with no working day', async () => {
      const e = await employee();
      await request(e.id);
      const res = await as(d)
        .post('/leave-requests', {
          employeeId: e.id,
          startDate: week.saturday,
          endDate: week.saturday,
          type: 'PAID',
        })
        .expect(409);
      expect((res.body as { code: string }).code).toBe('LEAVE_OVERLAP');
      const friday = addDays(later.sunday, 5);
      await as(d)
        .post('/leave-requests', {
          employeeId: e.id,
          startDate: friday,
          endDate: friday,
          type: 'PAID',
        })
        .expect(422);
    });

    it('approves once when two managers click together', async () => {
      const e = await employee();
      await seed(e.id, '10');
      const leave = await request(e.id);
      const results = await Promise.all([
        as(d).post(`/leave-requests/${leave.id}/approve`),
        as(managerA).post(`/leave-requests/${leave.id}/approve`),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(await balance(e.id)).toBe('4.0');
    });

    it('gives a day back when a fête is entered late, and takes it again if removed', async () => {
      const e = await employee();
      await seed(e.id, '10');
      const leave = await request(e.id, { startDate: later.sunday, endDate: later.saturday });
      await as(d).post(`/leave-requests/${leave.id}/approve`).expect(200);
      expect(await balance(e.id)).toBe('4.0');

      const monday = addDays(later.sunday, 1);
      const holiday = (
        await as(d)
          .post('/public-holidays', { date: monday, name: 'Aïd', key: 'AID_EL_FITR' }, null)
          .expect(201)
      ).body as { id: string };
      expect(await balance(e.id)).toBe('5.0');
      expect(await mismatches()).toEqual([]);

      await as(d).delete(`/public-holidays/${holiday.id}`).expect(204);
      expect(await balance(e.id)).toBe('4.0');
      expect(await mismatches()).toEqual([]);
    });
  });

  describe('avances', () => {
    const pay = (who: Who, id: string, over: object = {}, key: string = randomUUID()) =>
      as(who).post(`/employees/${id}/advances`, { amount: '5000', mode: 'ESPECES', ...over }, key);
    const ledgerOf = async (id: string) =>
      (await as(d).get(`/employees/${id}/ledger`).expect(200)).body as EmployeeLedgerPage;

    it('writes the dépense, the ledger entry and the audit row together', async () => {
      const e = await employee();
      const entry = (await pay(d, e.id).expect(201)).body as EmployeeLedgerEntryDto;
      expect(entry).toMatchObject({ type: 'ADVANCE', amount: '5000.00', balanceAfter: '5000.00' });
      expect(entry.expenseNumber).toMatch(/^DEP-\d{4}-\d{6}$/);

      const expenses = (await as(d).get('/expenses?limit=100').expect(200)).body as ExpensePage;
      const expense = expenses.items.find((x) => x.id === entry.expenseId);
      expect(expense).toMatchObject({ amount: '5000.00', payee: e.fullName });
      expect(expense?.category.key).toBe('SALARIES');
      expect(expense?.warehouse?.id).toBe(depotA.id);

      const audit = await read<{ action: string }[]>`
        SELECT action FROM audit_logs WHERE "entityId" = ${entry.expenseId}`;
      expect(audit.map((a) => a.action)).toEqual(['ADVANCE_PAID']);
    });

    it('creates nothing on a replay', async () => {
      const e = await employee();
      const key = randomUUID();
      const first = await pay(d, e.id, {}, key).expect(201);
      const replay = await pay(d, e.id, {}, key).expect(201);
      expect(replay.body).toEqual(first.body);
      const ledger = await ledgerOf(e.id);
      expect(ledger.items).toHaveLength(1);
      expect(ledger.balance).toBe('5000.00');
    });

    it('adds up two avances paid at the same moment', async () => {
      const e = await employee();
      await Promise.all([pay(d, e.id).expect(201), pay(d, e.id).expect(201)]);
      const ledger = await ledgerOf(e.id);
      expect(ledger.balance).toBe('10000.00');
      expect(ledger.items.map((i) => i.balanceAfter).sort()).toEqual(['10000.00', '5000.00']);
      expect(await mismatches()).toEqual([]);
    });

    it('is cancelled with its dépense: a reversing entry, nothing edited', async () => {
      const e = await employee();
      const entry = (await pay(d, e.id).expect(201)).body as EmployeeLedgerEntryDto;
      await as(d).post(`/expenses/${entry.expenseId}/cancel`, { reason: 'Erreur' }).expect(200);
      const ledger = await ledgerOf(e.id);
      expect(ledger.balance).toBe('0.00');
      expect(ledger.items.map((i) => [i.type, i.amount])).toEqual([
        ['REVERSAL', '-5000.00'],
        ['ADVANCE', '5000.00'],
      ]);
      await as(d).post(`/expenses/${entry.expenseId}/cancel`, { reason: 'Encore' }).expect(409);
      expect((await ledgerOf(e.id)).items).toHaveLength(2);
    });

    it('is not counted by the charges report', async () => {
      const fresh = await registerTenant(t, 'Charges RH', { activity: Activity.DISTRIBUTEUR });
      const main = ((await as(fresh).get('/warehouses').expect(200)).body as WarehouseDto[])[0]!;
      const e = await employee({ warehouseId: main.id }, fresh);
      await pay(fresh, e.id, { amount: '7000' }).expect(201);
      const report = (await as(fresh).get(`/reports/charges?from=${TODAY}&to=${TODAY}`).expect(200))
        .body as ChargesReportDto;
      expect(report.total).toBe('0.00');
    });

    it('is out of reach without ADVANCE_PAY, and hidden without SALARY_VIEW', async () => {
      const e = await employee();
      await pay(managerA, e.id).expect(403);
      const entry = (await pay(d, e.id).expect(201)).body as EmployeeLedgerEntryDto;

      const seen = (await as(managerA).get('/expenses?limit=100').expect(200)).body as ExpensePage;
      expect(seen.items.map((x) => x.id)).not.toContain(entry.expenseId);
      await as(managerA).get(`/expenses/${entry.expenseId}`).expect(404);
      await as(managerA).post(`/expenses/${entry.expenseId}/cancel`, { reason: 'Non' }).expect(404);

      const journal = (await as(managerA).get('/audit-logs?limit=100').expect(200))
        .body as AuditLogPage;
      expect(journal.items.map((l) => l.entity)).not.toContain('EmployeeAdvance');
      const facets = (await as(managerA).get('/audit-logs/facets').expect(200)).body as {
        entities: string[];
      };
      expect(facets.entities).not.toContain('EmployeeAdvance');
      expect(facets.entities).not.toContain('EmployeeSalary');
      const owner = (await as(d).get('/audit-logs/facets').expect(200)).body as {
        entities: string[];
      };
      expect(owner.entities).toContain('EmployeeAdvance');
    });
  });

  describe('scope', () => {
    it('shows a manager his dépôt, and counts only for a dépôt he just sees', async () => {
      const here = await employee();
      const there = await employee({ warehouseId: depotB.id });
      const day = (await as(managerA).get(`/attendance/day?date=${TODAY}`).expect(200))
        .body as AttendanceDayDto;
      const ids = day.rows.map((r) => r.employee.id);
      expect(ids).toContain(here.id);
      expect(ids).not.toContain(there.id);

      const stats = (
        await as(managerA).get(`/attendance/day?date=${TODAY}&warehouseId=${depotB.id}`).expect(200)
      ).body as AttendanceDayDto;
      expect(stats.rows).toEqual([]);
      expect(stats.countsOnly).toBe(true);
      expect(Object.values(stats.counts).reduce((a, b) => a + b, 0)).toBeGreaterThan(0);

      const month = (
        await as(managerA)
          .get(`/attendance/month?month=${TODAY.slice(0, 7)}&warehouseId=${depotB.id}`)
          .expect(200)
      ).body as AttendanceMonthDto;
      expect(month.rows).toEqual([]);
      expect(month.countsOnly).toBe(true);
    });

    it('answers 404 outside his dépôts, on reads and on writes', async () => {
      const there = await employee({ warehouseId: depotB.id });
      await as(managerA).get(`/employees/${there.id}`).expect(404);
      await mark(managerA, TODAY, [{ employeeId: there.id, kind: 'PRESENT' }]).expect(404);
    });

    it('needs the permissions and the module', async () => {
      await as(sellerA).get('/employees').expect(403);
      await as(sellerA).get(`/attendance/day`).expect(403);
      const small = await registerTenant(t, 'Essentiel RH');
      const res = await as(small).get('/employees').expect(403);
      expect((res.body as { code: string }).code).toBe('FEATURE_NOT_IN_PLAN');
    });

    it('keeps tenants apart', async () => {
      const e = await employee();
      await as(other).get(`/employees/${e.id}`).expect(404);
      await mark(other, TODAY, [{ employeeId: e.id, kind: 'PRESENT' }]).expect(404);
      await as(other)
        .post(`/employees/${e.id}/advances`, { amount: '100', mode: 'ESPECES' })
        .expect(404);
      const list = (await as(other).get('/employees').expect(200)).body as EmployeePage;
      expect(list.items.map((i) => i.id)).not.toContain(e.id);
      const holidays = await read<{ n: bigint }[]>`
        SELECT COUNT(*) AS n FROM public_holidays WHERE "tenantId" = ${other.tenantId}::uuid`;
      expect(Number(holidays[0]?.n)).toBe(0);
    });
  });

  describe('self check-in', () => {
    const AT_DEPOT = { lat: 36.75, lng: 3.05 };
    const position = (lat: number, lng: number, over: object = {}) => ({
      geo: { lat, lng, accuracyM: 10, capturedAt: new Date().toISOString(), ...over },
    });
    let worker: Member;

    beforeAll(async () => {
      worker = await invite(d, 'SELLER');
      await employee({ userId: worker.id });
      const saved = (
        await t
          .http()
          .patch(`/warehouses/${depotA.id}`)
          .set(...bearer(d.auth.accessToken))
          .send({ location: { ...AT_DEPOT, radiusM: 100 } })
          .expect(200)
      ).body as WarehouseDto;
      expect(saved.location).toEqual({ ...AT_DEPOT, radiusM: 100 });
    });

    it('is off until the company turns it on', async () => {
      const res = await as(worker).post('/attendance/check-in', position(36.75, 3.05)).expect(403);
      expect((res.body as { code: string }).code).toBe('SELF_CHECK_IN_DISABLED');
      await as(d)
        .put('/hr-settings', {
          restDays: [5],
          dailyHours: 8,
          leaveAccrualDays: '2.5',
          selfCheckIn: true,
        })
        .expect(200);
    });

    it('checks in at the dépôt, once; then checks out', async () => {
      await as(worker).post('/attendance/check-out', position(36.75, 3.05)).expect(409);
      const me = (await as(worker).post('/attendance/check-in', position(36.75, 3.05)).expect(200))
        .body as MyAttendanceDto;
      expect(me.today.checkedInAt).not.toBeNull();
      await as(worker).post('/attendance/check-in', position(36.75, 3.05)).expect(409);
      const out = (
        await as(worker).post('/attendance/check-out', position(36.75, 3.05)).expect(200)
      ).body as MyAttendanceDto;
      expect(out.today.checkedOutAt).not.toBeNull();
      const checks = await read<{ status: string; refType: string }[]>`
        SELECT status, "refType" FROM geo_checks
        WHERE "tenantId" = ${d.tenantId}::uuid AND "userId" = ${worker.id}::uuid`;
      expect(checks).toEqual([
        { status: 'OK', refType: 'ATTENDANCE' },
        { status: 'OK', refType: 'ATTENDANCE' },
      ]);
    });

    it('flags a far check-in instead of blocking: a note saves it', async () => {
      const far = await invite(d, 'SELLER');
      await employee({ userId: far.id });
      const res = await as(far).post('/attendance/check-in', position(35.7, -0.6)).expect(409);
      expect((res.body as { code: string }).code).toBe('GEO_NOTE_REQUIRED');
      const me = (
        await as(far)
          .post('/attendance/check-in', position(35.7, -0.6, { note: 'Chez un client' }))
          .expect(200)
      ).body as MyAttendanceDto;
      expect(me.today.status).toBe('PRESENT');
      const checks = await read<{ status: string }[]>`
        SELECT status FROM geo_checks WHERE "userId" = ${far.id}::uuid`;
      expect(checks).toEqual([{ status: 'FAR' }]);
    });

    it('does not let a tap overrule a manager who marked the worker absent', async () => {
      // The manager has a file too: inviting one more user would hit the login limiter.
      const e = await employee({ userId: managerA.id });
      await mark(d, TODAY, [{ employeeId: e.id, kind: 'ABSENT', absenceReason: 'SICK' }]).expect(
        201,
      );
      await as(managerA).post('/attendance/check-in', position(36.75, 3.05)).expect(409);
    });

    it('answers 404 for a user with no employee file', async () => {
      const res = await as(sellerA).get('/attendance/me').expect(404);
      expect((res.body as { code: string }).code).toBe('EMPLOYEE_NOT_LINKED');
    });

    it("lets a worker ask for his own leave, not someone else's", async () => {
      const week = cleanWeek(TODAY);
      const leave = (
        await as(worker)
          .post('/leave-requests', {
            startDate: week.sunday,
            endDate: week.saturday,
            type: 'UNPAID',
          })
          .expect(201)
      ).body as LeaveRequestDto;
      await as(worker).post(`/leave-requests/${leave.id}/approve`).expect(403);
      const someone = await employee();
      await as(worker)
        .post('/leave-requests', {
          employeeId: someone.id,
          startDate: week.sunday,
          endDate: week.saturday,
          type: 'PAID',
        })
        .expect(403);
    });
  });

  describe('reconcile', () => {
    it('finds a tampered day, a tampered balance and a missing cache row', async () => {
      const DAY = lastWeekday(2);
      const e = await employee();
      await mark(d, DAY, [{ employeeId: e.id, kind: 'PRESENT' }]).expect(201);
      expect(await mismatches()).toEqual([]);

      await tamper(t)`
        UPDATE attendance_days SET status = 'SICK' WHERE "employeeId" = ${e.id}::uuid`;
      await tamper(t)`
        UPDATE employee_balances SET "advanceBalance" = 99 WHERE "employeeId" = ${e.id}::uuid`;
      const found = await mismatches();
      expect(found.map((m) => m.check).sort()).toEqual([
        'attendance_day_equals_events',
        'employee_advance_equals_ledger',
      ]);
      expect(found.find((m) => m.check === 'attendance_day_equals_events')).toMatchObject({
        entityId: e.id,
        cached: `${DAY} SICK`,
        ledger: `${DAY} PRESENT`,
      });

      await tamper(t)`
        UPDATE employee_balances SET "advanceBalance" = 0 WHERE "employeeId" = ${e.id}::uuid`;
      await tamper(t)`DELETE FROM attendance_days WHERE "employeeId" = ${e.id}::uuid`;
      const missing = await mismatches();
      expect(missing).toHaveLength(1);
      expect(missing[0]).toMatchObject({ cached: null, ledger: `${DAY} PRESENT` });

      // Put it back, so the other suites see a clean tenant.
      await tamper(t)`
        INSERT INTO attendance_days ("id", "tenantId", "employeeId", "warehouseId", "day", "status", "updatedAt")
        VALUES (gen_random_uuid(), ${d.tenantId}::uuid, ${e.id}::uuid, ${depotA.id}::uuid,
                ${DAY}::date, 'PRESENT', CURRENT_TIMESTAMP)`;
      expect(await mismatches()).toEqual([]);
    });
  });

  describe('month close', () => {
    it('accrues once per month, prorated for a hire during it', async () => {
      const fresh = await registerTenant(t, 'Clôture', { activity: Activity.DISTRIBUTEUR });
      const main = ((await as(fresh).get('/warehouses').expect(200)).body as WarehouseDto[])[0]!;
      const month = previousMonth(TODAY.slice(0, 7));
      const { from, to } = monthBounds(month);
      const full = await employee({ warehouseId: main.id }, fresh);
      const half = await employee({ warehouseId: main.id, hireDate: addDays(to, -14) }, fresh);
      const after = await employee({ warehouseId: main.id, hireDate: addDays(to, 1) }, fresh);
      expect(from < to).toBe(true);

      const close = t.app.get(MonthCloseService);
      // The job runs outside any request: nothing is cached for it, as on a cold server.
      t.app.get(FeaturesService).invalidate(fresh.tenantId);
      await close.run(month);
      const leave = async (id: string) =>
        (
          (await as(fresh).get(`/employees/${id}/leave-balance`).expect(200))
            .body as LeaveBalanceDto
        ).balance;
      expect(await leave(full.id)).toBe('2.5');
      expect(Number(await leave(half.id))).toBeGreaterThan(1);
      expect(Number(await leave(half.id))).toBeLessThan(1.4);
      expect(await leave(after.id)).toBe('0.0');

      await close.run(month);
      expect(await leave(full.id)).toBe('2.5');
    });

    it('seeds the fixed fêtes and reminds of the lunar ones', async () => {
      const year = Number(TODAY.slice(0, 4));
      const list = (await as(d).get(`/public-holidays?year=${year}`).expect(200)).body as {
        items: { key: string }[];
        missingLunar: string[];
      };
      expect(list.items.map((h) => h.key)).toEqual(
        expect.arrayContaining([
          'NEW_YEAR',
          'YENNAYER',
          'LABOUR_DAY',
          'INDEPENDENCE',
          'REVOLUTION',
        ]),
      );
      expect(list.missingLunar).toContain('MAWLID');
    });
  });

  describe('excel', () => {
    const upload = async (who: Who, rows: (string | number)[][]) => {
      const book = new ExcelJS.Workbook();
      const sheet = book.addWorksheet('Personnel');
      sheet.addRow([
        'Nom',
        "Date d'embauche",
        'Contrat',
        'Salaire',
        'Solde congés',
        'Solde avances',
      ]);
      for (const r of rows) sheet.addRow(r);
      const buffer = Buffer.from(await book.xlsx.writeBuffer());
      return t
        .http()
        .post('/imports/EMPLOYEES/preview')
        .set(...bearer(who.auth.accessToken))
        .attach('file', buffer, 'personnel.xlsx');
    };

    it('imports employees with their opening balances, and refuses a second run', async () => {
      const fresh = await registerTenant(t, 'Import RH', { activity: Activity.DISTRIBUTEUR });
      const file = [['Nadia Importée', '01/03/2024', 'CDI', '45 000,00', '12,5', '5 000,00']];
      const preview = (await upload(fresh, file)).body as ImportPreviewDto;
      expect(preview.counts).toMatchObject({ errors: 0, creates: 1 });
      await as(fresh).post(`/imports/${preview.jobId}/confirm`).expect(200);

      const list = (await as(fresh).get('/employees').expect(200)).body as EmployeePage;
      const e = list.items[0]!;
      expect(e).toMatchObject({
        fullName: 'Nadia Importée',
        hireDate: '2024-03-01',
        leaveBalance: '12.5',
      });
      expect(e.pay).toMatchObject({ salary: '45000.00', advanceBalance: '5000.00' });
      const expenses = (await as(fresh).get('/expenses').expect(200)).body as ExpensePage;
      expect(expenses.items).toEqual([]);

      const again = (await upload(fresh, file)).body as ImportPreviewDto;
      expect(again.counts).toMatchObject({ errors: 1, creates: 0 });
    });

    it('needs SALARY_VIEW', async () => {
      const res = await upload(managerA, [['X', '01/03/2024', 'CDI', '1', '', '']]);
      expect(res.status).toBe(403);
    });

    it('exports the month grid with EXPORT_DATA', async () => {
      const res = await as(d)
        .get(`/attendance/month/export.xlsx?month=${TODAY.slice(0, 7)}`)
        .buffer(true)
        .parse((r, cb) => {
          const chunks: Buffer[] = [];
          r.on('data', (c: Buffer) => chunks.push(c));
          r.on('end', () => cb(null, Buffer.concat(chunks)));
        })
        .expect(200);
      const book = new ExcelJS.Workbook();
      await book.xlsx.load((res.body as Buffer).buffer as ArrayBuffer);
      const header = book.getWorksheet('Pointage')?.getRow(4).values as unknown[];
      expect(header).toEqual(
        expect.arrayContaining(['Matricule', 'Nom', 'Présents', 'Heures sup']),
      );
      await as(sellerA)
        .get(`/attendance/month/export.xlsx?month=${TODAY.slice(0, 7)}`)
        .expect(403);
    });
  });
});
