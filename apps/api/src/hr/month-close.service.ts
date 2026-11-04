import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import {
  accrualForMonth,
  algiersDay,
  Feature,
  LeaveEntryType,
  monthBounds,
  previousMonth,
} from '@erp/shared';
import { FeaturesService } from '../billing/features.service';
import { nextAlgiersTime } from '../common/algiers';
import { tenantContext } from '../common/tenant-context';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { PrismaService } from '../prisma/prisma.service';
import { fromDay, toDay } from './attendance-days.service';
import { CalendarService } from './calendar.service';
import { EmployeeLedgerService } from './employee-ledger.service';

/** Arbitrary constant: one month close at a time across API instances. */
const LOCK_KEY = 7_120_431;

/**
 * Runs every night, not only on the 1st: it posts the congé accrual of the previous month
 * for whoever does not have it yet, so a server that was down on the 1st catches up. The
 * unique index on (employee, month) makes a second run a no-op. Also keeps the fixed fêtes
 * seeded for this year and the next.
 */
@Injectable()
export class MonthCloseService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('HrMonthClose');
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly prisma: PrismaService,
    private readonly features: FeaturesService,
    private readonly ledger: EmployeeLedgerService,
    private readonly calendar: CalendarService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onApplicationBootstrap(): void {
    if (this.config.NODE_ENV !== 'test' && process.env['RECONCILE_CLI'] !== '1') this.schedule();
  }

  onApplicationShutdown(): void {
    clearTimeout(this.timer);
  }

  private schedule(): void {
    const at = nextAlgiersTime(2, 30);
    this.timer = setTimeout(() => {
      void this.nightly().finally(() => this.schedule());
    }, at.getTime() - Date.now());
    this.timer.unref();
  }

  private async nightly(): Promise<void> {
    try {
      await this.run();
    } catch (err) {
      this.logger.error(err instanceof Error ? err.stack : String(err));
      Sentry.captureException(err);
    }
  }

  /** `month` defaults to the one before today. Returns how many accruals were posted. */
  async run(month: string = previousMonth(algiersDay().slice(0, 7))): Promise<number> {
    const tenants = await tenantContext.runAsSystem(() =>
      this.prisma.db.employee.findMany({
        where: { deletedAt: null },
        distinct: ['tenantId'],
        select: { tenantId: true },
      }),
    );
    let posted = 0;
    for (const { tenantId } of tenants) {
      // One company's failure must not cost the others their congés; tomorrow retries it.
      try {
        posted += await tenantContext.run({ tenantId }, async () => {
          const { features } = await this.features.of(tenantId);
          return features.includes(Feature.HR) ? this.closeTenant(tenantId, month) : 0;
        });
      } catch (err) {
        this.logger.error(`Month close of ${tenantId}: ${String(err)}`);
        Sentry.captureException(err);
      }
    }
    return posted;
  }

  private closeTenant(tenantId: string, month: string): Promise<number> {
    const { from, to } = monthBounds(month);
    return this.prisma.db.$transaction(
      async (tx) => {
        const [lock] = await tx.$queryRaw<{ locked: boolean }[]>`
          SELECT pg_try_advisory_xact_lock(${LOCK_KEY}, hashtext(${tenantId})) AS locked`;
        if (!lock?.locked) return 0;
        await this.calendar.ensureFixedHolidays(tx, tenantId, this.calendar.thisAndNextYear());
        const tenant = await tx.tenant.findUniqueOrThrow({
          where: { id: tenantId },
          select: { hrLeaveAccrualDays: true },
        });
        const employees = await tx.employee.findMany({
          where: {
            deletedAt: null,
            hireDate: { lte: fromDay(to) },
            OR: [{ exitDate: null }, { exitDate: { gte: fromDay(from) } }],
            leaveEntries: { none: { type: LeaveEntryType.ACCRUAL, month } },
          },
          select: { id: true, hireDate: true, exitDate: true },
        });
        let posted = 0;
        for (const e of employees) {
          const days = accrualForMonth(
            month,
            toDay(e.hireDate),
            e.exitDate ? toDay(e.exitDate) : null,
            tenant.hrLeaveAccrualDays.toFixed(1),
          );
          await this.ledger.postLeave(tx, {
            employeeId: e.id,
            type: LeaveEntryType.ACCRUAL,
            days,
            month,
          });
          posted++;
        }
        return posted;
      },
      { timeout: 60_000 },
    );
  }
}
