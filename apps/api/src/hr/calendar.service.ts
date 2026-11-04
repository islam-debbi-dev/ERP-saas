import { Injectable } from '@nestjs/common';
import {
  algiersDay,
  ErrorCode,
  FIXED_PUBLIC_HOLIDAYS,
  type HrSettingsDto,
  type HrSettingsInput,
  isWorkingDay,
  LeaveEntryType,
  LeaveRequestStatus,
  LeaveType,
  missingLunarHolidays,
  type PublicHolidayDto,
  type PublicHolidayInput,
  type PublicHolidayListDto,
} from '@erp/shared';
import { AuditService } from '../audit/audit.service';
import { AppException } from '../common/app-exception';
import { tenantContext } from '../common/tenant-context';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import {
  AttendanceDaysService,
  dayEmployeeSelect,
  fromDay,
  toDay,
} from './attendance-days.service';
import { EmployeeLedgerService } from './employee-ledger.service';

type Db = PrismaService['db'] | Tx;

function toDto(h: { id: string; date: Date; name: string; key: string | null }): PublicHolidayDto {
  return { id: h.id, date: toDay(h.date), name: h.name, key: h.key };
}

/** Weekly rest days, daily hours and the fêtes légales (phase 31). */
@Injectable()
export class CalendarService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly days: AttendanceDaysService,
    private readonly ledger: EmployeeLedgerService,
  ) {}

  async settings(): Promise<HrSettingsDto> {
    const t = await this.prisma.db.tenant.findUniqueOrThrow({
      where: { id: tenantContext.requireTenantId() },
      select: {
        hrRestDays: true,
        hrDailyHours: true,
        hrLeaveAccrualDays: true,
        hrSelfCheckIn: true,
      },
    });
    return {
      restDays: t.hrRestDays,
      dailyHours: t.hrDailyHours,
      leaveAccrualDays: t.hrLeaveAccrualDays.toFixed(1),
      selfCheckIn: t.hrSelfCheckIn,
    };
  }

  async updateSettings(input: HrSettingsInput): Promise<HrSettingsDto> {
    const before = await this.settings();
    const tenantId = tenantContext.requireTenantId();
    await this.prisma.db.$transaction(
      async (tx) => {
        await tx.tenant.update({
          where: { id: tenantId },
          data: {
            hrRestDays: input.restDays,
            hrDailyHours: input.dailyHours,
            hrLeaveAccrualDays: input.leaveAccrualDays,
            hrSelfCheckIn: input.selfCheckIn,
          },
        });
        // New rest days change what cached days mean, except in locked months.
        for (const d of await this.days.diffs(tx, tenantId)) {
          await this.days.recompute(tx, d.employee, [d.day]);
        }
        await this.audit.log(tx, {
          action: 'HR_SETTINGS_UPDATED',
          entity: 'Tenant',
          entityId: tenantId,
          before,
          after: input,
        });
      },
      { timeout: 60_000 },
    );
    return this.settings();
  }

  /** Seeds the fixed fêtes of these years. Safe to run again: existing dates are kept. */
  async ensureFixedHolidays(db: Db, tenantId: string, years: number[]): Promise<void> {
    await db.publicHoliday.createMany({
      data: years.flatMap((year) =>
        FIXED_PUBLIC_HOLIDAYS.map((h) => ({
          tenantId,
          date: fromDay(`${year}-${h.monthDay}`),
          name: h.name,
          key: h.key,
        })),
      ),
      skipDuplicates: true,
    });
  }

  thisAndNextYear(): number[] {
    const year = Number(algiersDay().slice(0, 4));
    return [year, year + 1];
  }

  async holidays(year: number): Promise<PublicHolidayListDto> {
    const rows = await this.prisma.db.publicHoliday.findMany({
      where: { date: { gte: fromDay(`${year}-01-01`), lte: fromDay(`${year}-12-31`) } },
      orderBy: { date: 'asc' },
    });
    return {
      year,
      items: rows.map(toDto),
      missingLunar: missingLunarHolidays(rows.map((r) => r.key)),
    };
  }

  async createHoliday(input: PublicHolidayInput): Promise<PublicHolidayDto> {
    return this.prisma.db.$transaction(async (tx) => {
      const tenantId = tenantContext.requireTenantId();
      await this.days.assertNoLock(tx, tenantId, [input.date]);
      await this.assertFree(tx, input.date);
      const row = await tx.publicHoliday.create({
        data: { tenantId, date: fromDay(input.date), name: input.name, key: input.key },
      });
      await this.dateChanged(tx, input.date, 'added');
      await this.audit.log(tx, {
        action: 'PUBLIC_HOLIDAY_CREATED',
        entity: 'PublicHoliday',
        entityId: row.id,
        after: input,
      });
      return toDto(row);
    });
  }

  async updateHoliday(id: string, input: PublicHolidayInput): Promise<PublicHolidayDto> {
    return this.prisma.db.$transaction(async (tx) => {
      const tenantId = tenantContext.requireTenantId();
      const before = await this.find(tx, id);
      const oldDate = toDay(before.date);
      const moved = oldDate !== input.date;
      if (moved) {
        await this.days.assertNoLock(tx, tenantId, [oldDate, input.date]);
        await this.assertFree(tx, input.date);
      }
      const row = await tx.publicHoliday.update({
        where: { id },
        data: { date: fromDay(input.date), name: input.name, key: input.key },
      });
      if (moved) {
        await this.dateChanged(tx, oldDate, 'removed');
        await this.dateChanged(tx, input.date, 'added');
      }
      await this.audit.log(tx, {
        action: 'PUBLIC_HOLIDAY_UPDATED',
        entity: 'PublicHoliday',
        entityId: id,
        before: toDto(before),
        after: input,
      });
      return toDto(row);
    });
  }

  async deleteHoliday(id: string): Promise<void> {
    await this.prisma.db.$transaction(async (tx) => {
      const before = await this.find(tx, id);
      const date = toDay(before.date);
      await this.days.assertNoLock(tx, tenantContext.requireTenantId(), [date]);
      await tx.publicHoliday.delete({ where: { id } });
      await this.dateChanged(tx, date, 'removed');
      await this.audit.log(tx, {
        action: 'PUBLIC_HOLIDAY_DELETED',
        entity: 'PublicHoliday',
        entityId: id,
        before: toDto(before),
      });
    });
  }

  private async find(tx: Tx, id: string) {
    const row = await tx.publicHoliday.findFirst({ where: { id } });
    if (!row) throw new AppException(ErrorCode.NOT_FOUND, 'Holiday not found');
    return row;
  }

  private async assertFree(tx: Tx, date: string): Promise<void> {
    const taken = await tx.publicHoliday.findFirst({
      where: { date: fromDay(date) },
      select: { id: true },
    });
    if (taken) throw new AppException(ErrorCode.PUBLIC_HOLIDAY_TAKEN, 'This day is a holiday');
  }

  /**
   * A fête entered late (lunar dates are only known close to the day) must not cost
   * anyone a congé day: approved paid leaves covering it give the day back, or take it
   * again when the fête is removed. Cached days of that date are recomputed.
   */
  private async dateChanged(tx: Tx, date: string, change: 'added' | 'removed'): Promise<void> {
    const tenantId = tenantContext.requireTenantId();
    const day = fromDay(date);
    const [rows, leaves] = await Promise.all([
      tx.attendanceDay.findMany({ where: { day }, select: { employeeId: true } }),
      tx.leaveRequest.findMany({
        where: {
          status: LeaveRequestStatus.APPROVED,
          startDate: { lte: day },
          endDate: { gte: day },
        },
        select: { id: true, employeeId: true, type: true, days: true },
      }),
    ]);
    const ids = [...new Set([...rows, ...leaves].map((r) => r.employeeId))];
    if (ids.length === 0) return;
    const employees = await tx.employee.findMany({
      where: { id: { in: ids } },
      select: dayEmployeeSelect,
    });
    const calendar = await this.days.calendar(tx, tenantId, date, date);
    for (const employee of employees) {
      const own = this.days.calendarOf(employee, calendar);
      const restDay = !isWorkingDay(date, { restDays: own.restDays, holidays: new Set() });
      for (const leave of leaves.filter((l) => l.employeeId === employee.id)) {
        if (leave.type !== LeaveType.PAID || restDay) continue;
        const delta = change === 'added' ? 1 : -1;
        await this.ledger.postLeave(tx, {
          employeeId: employee.id,
          type: LeaveEntryType.ADJUST,
          days: delta.toFixed(1),
          leaveRequestId: leave.id,
          note: `Fête légale du ${date}`,
        });
        await tx.leaveRequest.update({
          where: { id: leave.id },
          data: { days: leave.days.minus(delta) },
        });
      }
      await this.days.recompute(tx, employee, [date]);
    }
  }
}
