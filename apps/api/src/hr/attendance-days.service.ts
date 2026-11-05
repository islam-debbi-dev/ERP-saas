import { Injectable } from '@nestjs/common';
import {
  type AbsenceReason,
  type AttendanceDayEvent,
  type AttendanceEventKind,
  type CorrectableStatus,
  dayFigures,
  DayStatus,
  deriveDayStatus,
  ErrorCode,
  LeaveRequestStatus,
  type LeaveType,
  listDays,
  type WorkCalendar,
} from '@erp/shared';
import { AppException } from '../common/app-exception';
import { tenantContext } from '../common/tenant-context';
import { type Prisma } from '../generated/prisma/client';
import { PrismaService, type Tx } from '../prisma/prisma.service';

type Db = PrismaService['db'] | Tx;

export const toDay = (d: Date): string => d.toISOString().slice(0, 10);
export const fromDay = (day: string): Date => new Date(`${day}T00:00:00.000Z`);

export interface DayEmployee {
  id: string;
  hireDate: Date;
  exitDate: Date | null;
  restDays: number[];
  warehouseId: string | null;
}

export const dayEmployeeSelect = {
  id: true,
  hireDate: true,
  exitDate: true,
  restDays: true,
  warehouseId: true,
} as const;

export interface DayView {
  status: DayStatus;
  lateMinutes: number;
  overtimeHours: string;
}

export interface ApprovedLeave {
  employeeId: string;
  startDate: Date;
  endDate: Date;
  type: LeaveType;
}

export interface AttendanceDayDiff {
  tenantId: string;
  employee: DayEmployee;
  day: string;
  cached: DayStatus | null;
  expected: DayStatus;
}

interface EventRow {
  employeeId: string;
  day: Date;
  kind: string;
  absenceReason: string | null;
  correctedTo: string | null;
  lateMinutes: number | null;
  overtimeHours: { toString(): string } | null;
  warehouseId: string | null;
}

function toDayEvent(e: EventRow): AttendanceDayEvent {
  return {
    kind: e.kind as AttendanceEventKind,
    absenceReason: e.absenceReason as AbsenceReason | null,
    correctedTo: e.correctedTo as CorrectableStatus | null,
    lateMinutes: e.lateMinutes,
    overtimeHours: e.overtimeHours?.toString() ?? null,
  };
}

/**
 * The `AttendanceDay` cache (phase 31). A row exists for a day with an event or an approved
 * leave, written in the same transaction and always computed by the shared
 * `deriveDayStatus`, so the screens, the reconcile and the payroll of 31b cannot disagree.
 * Days without a row are derived on read. Every method takes the tenant explicitly or
 * from the context: the reconcile runs as the system, where the extension does not filter.
 */
@Injectable()
export class AttendanceDaysService {
  constructor(private readonly prisma: PrismaService) {}

  async calendar(
    db: Db,
    tenantId: string,
    from: string,
    to: string,
  ): Promise<{ restDays: number[]; holidays: Set<string> }> {
    const [tenant, rows] = await Promise.all([
      db.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { hrRestDays: true } }),
      db.publicHoliday.findMany({
        where: { tenantId, date: { gte: fromDay(from), lte: fromDay(to) } },
        select: { date: true },
      }),
    ]);
    return { restDays: tenant.hrRestDays, holidays: new Set(rows.map((r) => toDay(r.date))) };
  }

  /** An employee's own rest days replace the company's. */
  calendarOf(
    employee: Pick<DayEmployee, 'restDays'>,
    calendar: { restDays: number[]; holidays: Set<string> },
  ): WorkCalendar {
    return {
      restDays: employee.restDays.length > 0 ? employee.restDays : calendar.restDays,
      holidays: calendar.holidays,
    };
  }

  async approvedLeaves(
    db: Db,
    tenantId: string,
    employeeIds: string[] | null,
    from: string,
    to: string,
  ): Promise<ApprovedLeave[]> {
    return db.leaveRequest.findMany({
      where: {
        tenantId,
        status: LeaveRequestStatus.APPROVED,
        startDate: { lte: fromDay(to) },
        endDate: { gte: fromDay(from) },
        ...(employeeIds ? { employeeId: { in: employeeIds } } : {}),
      },
      select: { employeeId: true, startDate: true, endDate: true, type: true },
    });
  }

  private leaveOn(leaves: ApprovedLeave[], employeeId: string, day: string): LeaveType | null {
    const date = fromDay(day);
    return (
      leaves.find((l) => l.employeeId === employeeId && l.startDate <= date && l.endDate >= date)
        ?.type ?? null
    );
  }

  private view(
    employee: DayEmployee,
    day: string,
    calendar: { restDays: number[]; holidays: Set<string> },
    leaveType: LeaveType | null,
    events: AttendanceDayEvent[],
  ): DayView {
    const status = deriveDayStatus({
      day,
      hireDate: toDay(employee.hireDate),
      exitDate: employee.exitDate ? toDay(employee.exitDate) : null,
      ...this.calendarOf(employee, calendar),
      leaveType,
      events,
    });
    return { status, ...dayFigures(events) };
  }

  /**
   * PERIOD_APPROVED when one of the days is in a month locked for this dépôt or this
   * employee (a worker moved during the month is locked by name, phase 31b).
   */
  async assertUnlocked(
    db: Db,
    tenantId: string,
    warehouseId: string | null,
    days: string[],
    employeeId?: string,
  ): Promise<void> {
    await this.refuseLock(db, tenantId, days, {
      OR: [
        { employeeId: null, warehouseId: null },
        ...(warehouseId ? [{ employeeId: null, warehouseId }] : []),
        ...(employeeId ? [{ employeeId }] : []),
      ],
    });
  }

  /** `assertUnlocked` for one day of several employees ("Tous présents" spans a whole team). */
  async assertUnlockedMany(
    db: Db,
    tenantId: string,
    employees: readonly { id: string; warehouseId: string | null }[],
    day: string,
  ): Promise<void> {
    await this.refuseLock(db, tenantId, [day], {
      OR: [
        { employeeId: null, warehouseId: null },
        {
          employeeId: null,
          warehouseId: { in: employees.flatMap((e) => (e.warehouseId ? [e.warehouseId] : [])) },
        },
        { employeeId: { in: employees.map((e) => e.id) } },
      ],
    });
  }

  /** The calendar is the company's: any lock on these months stops a change to it. */
  async assertNoLock(db: Db, tenantId: string, days: string[]): Promise<void> {
    await this.refuseLock(db, tenantId, days, {});
  }

  private async refuseLock(
    db: Db,
    tenantId: string,
    days: string[],
    where: Prisma.AttendanceMonthLockWhereInput,
  ): Promise<void> {
    const months = [...new Set(days.map((d) => d.slice(0, 7)))];
    if (months.length === 0) return;
    const lock = await db.attendanceMonthLock.findFirst({
      where: { tenantId, month: { in: months }, ...where },
      select: { month: true },
    });
    if (lock) {
      throw new AppException(ErrorCode.PERIOD_APPROVED, 'The payroll of this month is approved', {
        month: lock.month,
      });
    }
  }

  /**
   * Rewrites the cached rows of these days from the events and the leaves. Inside the
   * caller's transaction, after its event or leave was written. A day left with nothing
   * loses its row and goes back to being derived on read.
   */
  async recompute(tx: Tx, employee: DayEmployee, days: string[]): Promise<void> {
    if (days.length === 0) return;
    const tenantId = tenantContext.requireTenantId();
    const sorted = [...days].sort();
    const from = sorted[0]!;
    const to = sorted.at(-1)!;
    const [calendar, leaves, events] = await Promise.all([
      this.calendar(tx, tenantId, from, to),
      this.approvedLeaves(tx, tenantId, [employee.id], from, to),
      tx.attendanceEvent.findMany({
        where: { employeeId: employee.id, day: { in: days.map(fromDay) } },
        orderBy: { seq: 'asc' },
      }),
    ]);
    for (const day of days) {
      const own = events.filter((e) => toDay(e.day) === day);
      const leaveType = this.leaveOn(leaves, employee.id, day);
      if (own.length === 0 && !leaveType) {
        await tx.attendanceDay.deleteMany({
          where: { employeeId: employee.id, day: fromDay(day) },
        });
        continue;
      }
      const view = this.view(employee, day, calendar, leaveType, own.map(toDayEvent));
      const data = {
        status: view.status,
        lateMinutes: view.lateMinutes,
        overtimeHours: view.overtimeHours,
        warehouseId: own.at(-1)?.warehouseId ?? employee.warehouseId,
      };
      await tx.attendanceDay.upsert({
        where: {
          tenantId_employeeId_day: { tenantId, employeeId: employee.id, day: fromDay(day) },
        },
        create: { tenantId, employeeId: employee.id, day: fromDay(day), ...data },
        update: data,
      });
    }
  }

  /** Every employee's days of a range: cached rows, the rest derived. */
  async read(
    db: Db,
    tenantId: string,
    employees: DayEmployee[],
    from: string,
    to: string,
  ): Promise<Map<string, Map<string, DayView>>> {
    const ids = employees.map((e) => e.id);
    const [calendar, rows] = await Promise.all([
      this.calendar(db, tenantId, from, to),
      db.attendanceDay.findMany({
        where: { tenantId, employeeId: { in: ids }, day: { gte: fromDay(from), lte: fromDay(to) } },
        select: {
          employeeId: true,
          day: true,
          status: true,
          lateMinutes: true,
          overtimeHours: true,
        },
      }),
    ]);
    const cached = new Map(rows.map((r) => [`${r.employeeId}|${toDay(r.day)}`, r]));
    const days = listDays(from, to);
    return new Map(
      employees.map((employee) => [
        employee.id,
        new Map(
          days.map((day): [string, DayView] => {
            const row = cached.get(`${employee.id}|${day}`);
            return [
              day,
              row
                ? {
                    status: row.status,
                    lateMinutes: row.lateMinutes,
                    overtimeHours: row.overtimeHours.toString(),
                  }
                : this.view(employee, day, calendar, null, []),
            ];
          }),
        ),
      ]),
    );
  }

  /**
   * Cached days that disagree with their events, leaves and calendar, or that are missing.
   * Locked months are left out: the trigger freezes them, and a later calendar edit must
   * not read as a mismatch there. Used by the nightly reconcile and after a calendar change.
   */
  async diffs(db: Db, tenantId: string): Promise<AttendanceDayDiff[]> {
    const [employees, events, rows, leaves, locks] = await Promise.all([
      db.employee.findMany({ where: { tenantId }, select: dayEmployeeSelect }),
      db.attendanceEvent.findMany({ where: { tenantId }, orderBy: { seq: 'asc' } }),
      db.attendanceDay.findMany({
        where: { tenantId },
        select: { employeeId: true, day: true, status: true, warehouseId: true },
      }),
      this.approvedLeaves(db, tenantId, null, '1900-01-01', '2999-12-31'),
      db.attendanceMonthLock.findMany({
        where: { tenantId },
        select: { month: true, warehouseId: true, employeeId: true },
      }),
    ]);
    const days = new Map<string, { employeeId: string; day: string }>();
    const add = (employeeId: string, day: string) =>
      days.set(`${employeeId}|${day}`, { employeeId, day });
    for (const r of rows) add(r.employeeId, toDay(r.day));
    for (const e of events) add(e.employeeId, toDay(e.day));
    for (const l of leaves) {
      for (const day of listDays(toDay(l.startDate), toDay(l.endDate))) add(l.employeeId, day);
    }
    if (days.size === 0) return [];

    const calendar = await this.calendar(db, tenantId, '1900-01-01', '2999-12-31');
    const byEmployee = new Map(employees.map((e) => [e.id, e]));
    const cached = new Map(rows.map((r) => [`${r.employeeId}|${toDay(r.day)}`, r]));
    const eventsOf = new Map<string, AttendanceDayEvent[]>();
    const eventWarehouse = new Map<string, string | null>();
    for (const e of events) {
      const key = `${e.employeeId}|${toDay(e.day)}`;
      eventsOf.set(key, [...(eventsOf.get(key) ?? []), toDayEvent(e)]);
      eventWarehouse.set(key, e.warehouseId);
    }

    const diffs: AttendanceDayDiff[] = [];
    for (const [key, { employeeId, day }] of days) {
      const employee = byEmployee.get(employeeId);
      if (!employee) continue;
      const row = cached.get(key);
      const warehouseId = row?.warehouseId ?? eventWarehouse.get(key) ?? employee.warehouseId;
      const locked = locks.some(
        (l) =>
          l.month === day.slice(0, 7) &&
          (l.employeeId === employeeId ||
            (l.employeeId === null && (l.warehouseId === null || l.warehouseId === warehouseId))),
      );
      if (locked) continue;
      const expected = this.view(
        employee,
        day,
        calendar,
        this.leaveOn(leaves, employeeId, day),
        eventsOf.get(key) ?? [],
      ).status;
      if (row?.status !== expected) {
        diffs.push({ tenantId, employee, day, cached: row?.status ?? null, expected });
      }
    }
    return diffs;
  }
}
