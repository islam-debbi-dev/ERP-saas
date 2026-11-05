import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { algiersDay, Feature, previousMonth } from '@erp/shared';
import { FeaturesService } from '../billing/features.service';
import { nextAlgiersTime } from '../common/algiers';
import { tenantContext } from '../common/tenant-context';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { PrismaService } from '../prisma/prisma.service';
import { CalendarService } from './calendar.service';
import { ACCRUAL_TX, LeaveAccrualService } from './leave-accrual.service';

/** Arbitrary constant: one month close at a time across API instances. */
const LOCK_KEY = 7_120_431;
const BATCH = 50;

/**
 * Runs every night on a long-running server, not only on the 1st: it posts every congé
 * accrual still owed, however long the server was down. It is not the only way in: a
 * balance read or write posts them too (LeaveAccrualService), which is all a serverless
 * deployment has. Also keeps the fixed fêtes seeded for this year and the next.
 */
@Injectable()
export class MonthCloseService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('HrMonthClose');
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly prisma: PrismaService,
    private readonly features: FeaturesService,
    private readonly accruals: LeaveAccrualService,
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

  /** `month`: the last closed one, by default the one before today. Returns months posted. */
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

  private async closeTenant(tenantId: string, month: string): Promise<number> {
    const locked = await this.prisma.db.$transaction(async (tx) => {
      const [lock] = await tx.$queryRaw<{ locked: boolean }[]>`
        SELECT pg_try_advisory_xact_lock(${LOCK_KEY}, hashtext(${tenantId})) AS locked`;
      if (lock?.locked) {
        await this.calendar.ensureFixedHolidays(tx, tenantId, this.calendar.thisAndNextYear());
      }
      return lock?.locked ?? false;
    });
    if (!locked) return 0;
    const employees = await this.prisma.db.employee.findMany({
      where: { deletedAt: null },
      orderBy: { id: 'asc' },
      select: { id: true },
    });
    // Short transactions: the employee rows stay locked only while a batch is posted.
    let posted = 0;
    for (let i = 0; i < employees.length; i += BATCH) {
      const ids = employees.slice(i, i + BATCH).map((e) => e.id);
      posted += await this.prisma.db.$transaction(
        (tx) => this.accruals.ensureMany(tx, ids, month),
        ACCRUAL_TX,
      );
    }
    return posted;
  }
}
