import { Injectable } from '@nestjs/common';
import {
  algiersDay,
  type AttendanceCounts,
  type AttendanceDayDto,
  type AttendanceDayEvent,
  type AttendanceDayQuery,
  type AttendanceDayRowDto,
  type AttendanceEventDto,
  AttendanceEventKind,
  type AttendanceMarkInput,
  type AttendanceMonthDto,
  type AttendanceMonthQuery,
  type AttendanceMonthRowDto,
  AttendanceSource,
  type AttendanceTodayDto,
  type CorrectableStatus,
  type CorrectAttendanceInput,
  dayIsMarked,
  DayStatus,
  ErrorCode,
  Feature,
  type GeoInput,
  listDays,
  type MarkAttendanceInput,
  type MarkAttendanceResult,
  monthBounds,
  monthCounts,
  type MyAttendanceDto,
  weekdayOf,
} from '@erp/shared';
import { AuditService } from '../audit/audit.service';
import type { CurrentUserInfo } from '../auth/auth.types';
import { FeaturesService } from '../billing/features.service';
import { AppException } from '../common/app-exception';
import { tenantContext } from '../common/tenant-context';
import { GeoCheckService } from '../geo/geo-check.service';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import {
  AttendanceDaysService,
  dayEmployeeSelect,
  type DayView,
  fromDay,
  toDay,
} from './attendance-days.service';
import { EmployeeAccessService, type LockedEmployee } from './employee-access.service';
import { LeaveService } from './leave.service';

const LONG_TX = { timeout: 30_000 };
const ABSENT: readonly DayStatus[] = [
  DayStatus.ABSENT_JUSTIFIED,
  DayStatus.ABSENT_UNJUSTIFIED,
  DayStatus.SICK,
  DayStatus.LEAVE_PAID,
  DayStatus.LEAVE_UNPAID,
];

const rowSelect = {
  ...dayEmployeeSelect,
  matricule: true,
  fullName: true,
  position: true,
  warehouse: { select: { id: true, name: true } },
} as const;

function employedOn(day: string) {
  return {
    deletedAt: null,
    hireDate: { lte: fromDay(day) },
    OR: [{ exitDate: null }, { exitDate: { gte: fromDay(day) } }],
  };
}

function countStatuses(statuses: DayStatus[]): AttendanceCounts {
  const counts: AttendanceCounts = {};
  for (const s of statuses) counts[s] = (counts[s] ?? 0) + 1;
  return counts;
}

/** Pointage (phase 31). Events are append-only; the day cache follows in the same transaction. */
@Injectable()
export class AttendanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly features: FeaturesService,
    private readonly geo: GeoCheckService,
    private readonly access: EmployeeAccessService,
    private readonly days: AttendanceDaysService,
    private readonly leaves: LeaveService,
  ) {}

  private assertNotFuture(date: string): void {
    if (date > algiersDay()) {
      throw new AppException(ErrorCode.ATTENDANCE_FUTURE_DAY, 'This day has not happened yet');
    }
  }

  private employed(e: LockedEmployee, date: string): boolean {
    return (
      e.deletedAt === null &&
      toDay(e.hireDate) <= date &&
      (e.exitDate === null || toDay(e.exitDate) >= date)
    );
  }

  /** One or many marks in one transaction: "Tous présents" is a single call. */
  async mark(input: MarkAttendanceInput, user: CurrentUserInfo): Promise<MarkAttendanceResult> {
    this.assertNotFuture(input.date);
    const { date, marks, skipMarked } = input;
    return this.prisma.db.$transaction(async (tx) => {
      const tenantId = tenantContext.requireTenantId();
      const ids = [...new Set(marks.map((m) => m.employeeId))];
      const reach = await tx.employee.findMany({
        where: {
          AND: [{ id: { in: ids } }, await this.access.where(user, 'operate', undefined, tx)],
        },
        select: { id: true },
      });
      if (reach.length !== ids.length) {
        throw new AppException(ErrorCode.NOT_FOUND, 'Employee not found');
      }
      const employees = await this.access.lock(tx, ids);
      const [existing, leaves, calendar] = await Promise.all([
        tx.attendanceEvent.findMany({
          where: { employeeId: { in: ids }, day: fromDay(date) },
          orderBy: { seq: 'asc' },
        }),
        this.days.approvedLeaves(tx, tenantId, ids, date, date),
        this.days.calendar(tx, tenantId, date, date),
      ]);
      const dayEvents = new Map<string, AttendanceDayEvent[]>(ids.map((id) => [id, []]));
      for (const e of existing) {
        dayEvents.get(e.employeeId)!.push({
          kind: e.kind,
          absenceReason: e.absenceReason,
          correctedTo: e.correctedTo as CorrectableStatus | null,
        });
      }

      const rows: {
        employee: LockedEmployee;
        mark: AttendanceMarkInput;
      }[] = [];
      let skipped = 0;
      for (const mark of marks) {
        const employee = employees.get(mark.employeeId)!;
        const own = dayEvents.get(mark.employeeId)!;
        const onLeave = leaves.some((l) => l.employeeId === mark.employeeId);
        const off = !this.isWorkDayFor(employee, date, calendar);
        const statusMark = mark.kind !== AttendanceEventKind.OVERTIME;
        if (!this.employed(employee, date)) {
          if (skipMarked) {
            skipped++;
            continue;
          }
          throw new AppException(ErrorCode.EMPLOYEE_NOT_EMPLOYED, 'Not employed on this day', {
            employeeId: mark.employeeId,
          });
        }
        if (statusMark && (dayIsMarked(own) || onLeave || (skipMarked && off))) {
          if (skipMarked) {
            skipped++;
            continue;
          }
          throw new AppException(
            ErrorCode.ATTENDANCE_ALREADY_MARKED,
            'This day is already marked',
            {
              employeeId: mark.employeeId,
              onLeave,
            },
          );
        }
        own.push({ kind: mark.kind });
        rows.push({ employee, mark });
      }

      await this.days.assertUnlockedMany(
        tx,
        tenantId,
        rows.map((r) => r.employee),
        date,
      );
      if (rows.length > 0) {
        await tx.attendanceEvent.createMany({
          data: rows.map(({ employee, mark }) => ({
            tenantId,
            employeeId: employee.id,
            warehouseId: employee.warehouseId,
            day: fromDay(date),
            kind: mark.kind,
            source: AttendanceSource.MANAGER,
            absenceReason: mark.kind === 'ABSENT' ? mark.absenceReason : null,
            lateMinutes: mark.kind === 'LATE' ? mark.lateMinutes : null,
            overtimeHours: mark.kind === 'OVERTIME' ? mark.overtimeHours : null,
            note: mark.note,
            createdBy: user.id,
          })),
        });
        for (const employee of new Map(rows.map((r) => [r.employee.id, r.employee])).values()) {
          await this.days.recompute(tx, employee, [date]);
        }
        await this.audit.logMany(
          tx,
          rows.map(({ employee, mark }) => ({
            action: 'ATTENDANCE_MARKED',
            entity: 'AttendanceEvent',
            entityId: employee.id,
            after: { date, kind: mark.kind },
          })),
        );
      }
      return { date, created: rows.length, skipped };
    }, LONG_TX);
  }

  private isWorkDayFor(
    employee: LockedEmployee,
    date: string,
    calendar: { restDays: number[]; holidays: Set<string> },
  ): boolean {
    const own = this.days.calendarOf(employee, calendar);
    return !own.holidays.has(date) && !own.restDays.includes(weekdayOf(date));
  }

  /** Replaces the status of a day with a new event; the old events stay as history. */
  async correct(
    input: CorrectAttendanceInput,
    user: CurrentUserInfo,
  ): Promise<AttendanceDayRowDto> {
    this.assertNotFuture(input.date);
    await this.prisma.db.$transaction(async (tx) => {
      const tenantId = tenantContext.requireTenantId();
      await this.access.assertReach(tx, user, input.employeeId);
      const employee = (await this.access.lock(tx, [input.employeeId])).get(input.employeeId)!;
      if (!this.employed(employee, input.date)) {
        throw new AppException(ErrorCode.EMPLOYEE_NOT_EMPLOYED, 'Not employed on this day');
      }
      await this.days.assertUnlocked(tx, tenantId, employee.warehouseId, [input.date], employee.id);
      const before = await tx.attendanceDay.findFirst({
        where: { employeeId: employee.id, day: fromDay(input.date) },
        select: { status: true },
      });
      const event = await tx.attendanceEvent.create({
        data: {
          tenantId,
          employeeId: employee.id,
          warehouseId: employee.warehouseId,
          day: fromDay(input.date),
          kind: AttendanceEventKind.CORRECTION,
          source: AttendanceSource.MANAGER,
          correctedTo: input.correctedTo,
          lateMinutes: input.lateMinutes,
          overtimeHours: input.overtimeHours,
          note: input.reason,
          createdBy: user.id,
        },
        select: { id: true },
      });
      await this.days.recompute(tx, employee, [input.date]);
      await this.audit.log(tx, {
        action: 'ATTENDANCE_CORRECTED',
        entity: 'AttendanceEvent',
        entityId: event.id,
        before: { status: before?.status ?? DayStatus.UNMARKED },
        after: { date: input.date, status: input.correctedTo, reason: input.reason },
      });
    });
    const day = await this.day({ date: input.date }, user);
    return day.rows.find((r) => r.employee.id === input.employeeId)!;
  }

  async checkIn(geo: GeoInput | undefined, user: CurrentUserInfo): Promise<MyAttendanceDto> {
    return this.self(AttendanceEventKind.CHECK_IN, geo, user);
  }

  async checkOut(geo: GeoInput | undefined, user: CurrentUserInfo): Promise<MyAttendanceDto> {
    return this.self(AttendanceEventKind.CHECK_OUT, geo, user);
  }

  private async selfCheckInOn(tenantId: string, db: PrismaService['db'] | Tx): Promise<boolean> {
    const { features } = await this.features.of(tenantId);
    if (!features.includes(Feature.GEO_CHECK)) return false;
    const t = await db.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { hrSelfCheckIn: true },
    });
    return t.hrSelfCheckIn;
  }

  /** One position per tap, never continuous tracking (law 18-07). */
  private async self(
    kind: 'CHECK_IN' | 'CHECK_OUT',
    geo: GeoInput | undefined,
    user: CurrentUserInfo,
  ): Promise<MyAttendanceDto> {
    await this.prisma.db.$transaction(async (tx) => {
      const tenantId = tenantContext.requireTenantId();
      if (!(await this.selfCheckInOn(tenantId, tx))) {
        throw new AppException(ErrorCode.SELF_CHECK_IN_DISABLED, 'Self check-in is off');
      }
      const { id } = await this.access.own(tx, user);
      const employee = (await this.access.lock(tx, [id])).get(id)!;
      const today = algiersDay();
      if (!this.employed(employee, today)) {
        throw new AppException(ErrorCode.EMPLOYEE_NOT_EMPLOYED, 'Not employed on this day');
      }
      await this.days.assertUnlocked(tx, tenantId, employee.warehouseId, [today], employee.id);
      await this.assertSelfState(tx, tenantId, employee.id, today, kind);

      const event = await tx.attendanceEvent.create({
        data: {
          tenantId,
          employeeId: id,
          warehouseId: employee.warehouseId,
          day: fromDay(today),
          kind,
          source: AttendanceSource.SELF,
          note: geo?.note ?? null,
          createdBy: user.id,
        },
        select: { id: true },
      });
      const depot = await this.depotPoint(tx, employee.warehouseId);
      await this.geo.checkAttendanceInTx(tx, {
        eventId: event.id,
        geo,
        user,
        point: depot.point,
        radiusM: depot.radiusM,
      });
      await this.days.recompute(tx, employee, [today]);
      await this.audit.log(tx, {
        action: kind === 'CHECK_IN' ? 'ATTENDANCE_CHECKED_IN' : 'ATTENDANCE_CHECKED_OUT',
        entity: 'AttendanceEvent',
        entityId: event.id,
        after: { date: today },
      });
    });
    return this.mine(user);
  }

  private async assertSelfState(
    tx: Tx,
    tenantId: string,
    employeeId: string,
    today: string,
    kind: 'CHECK_IN' | 'CHECK_OUT',
  ): Promise<void> {
    const events = await tx.attendanceEvent.findMany({
      where: { employeeId, day: fromDay(today) },
      orderBy: { seq: 'asc' },
      select: { kind: true },
    });
    const last = events
      .map((e) => e.kind)
      .filter((k) => k === 'CHECK_IN' || k === 'CHECK_OUT')
      .at(-1);
    if (kind === 'CHECK_OUT' ? last !== 'CHECK_IN' : last !== undefined) {
      throw new AppException(ErrorCode.CHECK_IN_STATE_INVALID, 'Wrong check-in state', { last });
    }
    if (kind === 'CHECK_OUT') return;
    // A manager's "absent", or an approved leave, is not overruled by a tap on a phone.
    const leaves = await this.days.approvedLeaves(tx, tenantId, [employeeId], today, today);
    const row = await tx.attendanceDay.findFirst({
      where: { employeeId, day: fromDay(today) },
      select: { status: true },
    });
    const present = row?.status === DayStatus.PRESENT || row?.status === DayStatus.HALF_DAY;
    if (leaves.length > 0 || (row && !present)) {
      throw new AppException(ErrorCode.ATTENDANCE_ALREADY_MARKED, 'This day is already marked');
    }
  }

  private async depotPoint(tx: Tx, warehouseId: string | null) {
    const w = await tx.warehouse.findFirst({
      where: warehouseId ? { id: warehouseId } : { isDefault: true },
      select: { lat: true, lng: true, radiusM: true },
    });
    const point = w?.lat && w.lng ? { lat: w.lat.toNumber(), lng: w.lng.toNumber() } : null;
    return { point, radiusM: w?.radiusM ?? null };
  }

  /** Every active employee of the day. Statistics-only dépôts give counts, never rows. */
  async day(query: AttendanceDayQuery, user: CurrentUserInfo): Promise<AttendanceDayDto> {
    const date = query.date ?? algiersDay();
    const db = this.prisma.db;
    const tenantId = user.tenantId;
    const [stats, operate] = await Promise.all([
      db.employee.findMany({
        where: {
          AND: [await this.access.where(user, 'stats', query.warehouseId), employedOn(date)],
        },
        select: rowSelect,
        orderBy: [{ fullName: 'asc' }, { id: 'asc' }],
      }),
      db.employee.findMany({
        where: {
          AND: [await this.access.where(user, 'operate', query.warehouseId), employedOn(date)],
        },
        select: { id: true },
      }),
    ]);
    const views = await this.days.read(db, tenantId, stats, date, date);
    const statusOf = (id: string) => views.get(id)!.get(date)!;
    const counts = countStatuses(stats.map((e) => statusOf(e.id).status));
    const reachable = new Set(operate.map((e) => e.id));
    const visible = stats.filter((e) => reachable.has(e.id));

    const events = await db.attendanceEvent.findMany({
      where: { employeeId: { in: visible.map((e) => e.id) }, day: fromDay(date) },
      orderBy: { seq: 'asc' },
    });
    const users = await this.userNames(events.map((e) => e.createdBy));
    const rows = visible.map((e): AttendanceDayRowDto => {
      const view = statusOf(e.id);
      return {
        employee: {
          id: e.id,
          matricule: e.matricule,
          fullName: e.fullName,
          position: e.position,
          warehouse: e.warehouse,
        },
        status: view.status,
        lateMinutes: view.lateMinutes,
        overtimeHours: view.overtimeHours,
        events: events
          .filter((ev) => ev.employeeId === e.id)
          .map((ev): AttendanceEventDto => ({
            id: ev.id,
            kind: ev.kind,
            source: ev.source,
            at: ev.at.toISOString(),
            absenceReason: ev.absenceReason,
            correctedTo: ev.correctedTo,
            lateMinutes: ev.lateMinutes,
            overtimeHours: ev.overtimeHours?.toString() ?? null,
            note: ev.note,
            createdBy: ev.createdBy ? (users.get(ev.createdBy) ?? null) : null,
          })),
      };
    });
    return { date, counts, rows, countsOnly: stats.length > 0 && visible.length === 0 };
  }

  async today(user: CurrentUserInfo): Promise<AttendanceTodayDto> {
    const { date, counts } = await this.day({}, user);
    const total = (list: readonly DayStatus[]) => list.reduce((n, s) => n + (counts[s] ?? 0), 0);
    return {
      date,
      present: total([DayStatus.PRESENT, DayStatus.HALF_DAY]),
      absent: total(ABSENT),
      unmarked: counts[DayStatus.UNMARKED] ?? 0,
    };
  }

  /** A day that has not happened is nobody's backlog: it counts for nothing yet. */
  private upToToday<T extends { date: string }>(days: T[]): T[] {
    const today = algiersDay();
    return days.filter((d) => d.date <= today);
  }

  private monthRow(
    e: { id: string; matricule: string; fullName: string },
    days: string[],
    view: Map<string, DayView>,
  ): AttendanceMonthRowDto {
    const list = days.map((date) => ({ date, ...view.get(date)! }));
    return {
      employee: { id: e.id, matricule: e.matricule, fullName: e.fullName },
      days: list.map(({ date, status }) => ({ date, status })),
      counts: monthCounts(this.upToToday(list)),
    };
  }

  async month(query: AttendanceMonthQuery, user: CurrentUserInfo): Promise<AttendanceMonthDto> {
    const { from, to } = monthBounds(query.month);
    const db = this.prisma.db;
    if (query.employeeId) await this.access.assertReach(db, user, query.employeeId);
    const inMonth = {
      deletedAt: null,
      hireDate: { lte: fromDay(to) },
      OR: [{ exitDate: null }, { exitDate: { gte: fromDay(from) } }],
      ...(query.employeeId ? { id: query.employeeId } : {}),
    };
    const [stats, operate] = await Promise.all([
      db.employee.findMany({
        where: { AND: [await this.access.where(user, 'stats', query.warehouseId), inMonth] },
        select: rowSelect,
        orderBy: [{ fullName: 'asc' }, { id: 'asc' }],
      }),
      db.employee.findMany({
        where: { AND: [await this.access.where(user, 'operate', query.warehouseId), inMonth] },
        select: { id: true },
      }),
    ]);
    const views = await this.days.read(db, user.tenantId, stats, from, to);
    const days = listDays(from, to);
    const reachable = new Set(operate.map((e) => e.id));
    const visible = stats.filter((e) => reachable.has(e.id));
    return {
      month: query.month,
      days,
      totals: monthCounts(
        this.upToToday(
          [...views.values()].flatMap((v) => [...v].map(([date, day]) => ({ date, ...day }))),
        ),
      ),
      rows: visible.map((e) => this.monthRow(e, days, views.get(e.id)!)),
      countsOnly: stats.length > 0 && visible.length === 0,
    };
  }

  /** "Mon pointage": no permission needed, only a linked employee file. */
  async mine(user: CurrentUserInfo): Promise<MyAttendanceDto> {
    const db = this.prisma.db;
    const { id } = await this.access.own(db, user);
    const today = algiersDay();
    const { from, to } = monthBounds(today.slice(0, 7));
    const [employee, events, balance, selfCheckIn, leaves] = await Promise.all([
      db.employee.findFirstOrThrow({ where: { id }, select: rowSelect }),
      db.attendanceEvent.findMany({
        where: { employeeId: id, day: fromDay(today) },
        orderBy: { seq: 'asc' },
        select: { kind: true, at: true },
      }),
      db.employeeBalance.findUnique({ where: { employeeId: id } }),
      this.selfCheckInOn(user.tenantId, db),
      this.leaves.forEmployee(id),
    ]);
    const views = await this.days.read(db, user.tenantId, [employee], from, to);
    const view = views.get(id)!;
    const at = (kind: string) =>
      events
        .filter((e) => e.kind === kind)
        .at(-1)
        ?.at.toISOString() ?? null;
    return {
      employee: { id, matricule: employee.matricule, fullName: employee.fullName },
      today: {
        date: today,
        status: view.get(today)!.status,
        checkedInAt: at('CHECK_IN'),
        checkedOutAt: at('CHECK_OUT'),
      },
      month: this.monthRow(employee, listDays(from, to), view),
      leaveBalance: balance?.leaveDays.toFixed(1) ?? '0.0',
      selfCheckIn,
      leaves,
    };
  }

  private async userNames(ids: (string | null)[]) {
    const unique = [...new Set(ids.filter((u): u is string => !!u))];
    const rows = await this.prisma.db.user.findMany({
      where: { id: { in: unique } },
      select: { id: true, fullName: true },
    });
    return new Map(rows.map((u) => [u.id, u]));
  }
}
