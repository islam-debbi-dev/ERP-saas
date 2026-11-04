import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { AuditService } from '../audit/audit.service';
import { nextAlgiersTime } from '../common/algiers';
import { tenantContext } from '../common/tenant-context';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { AttendanceDaysService } from '../hr/attendance-days.service';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import { RECONCILE_CHECKS } from './reconcile-sql';

export interface LedgerMismatch {
  check: string;
  tenantId: string;
  entity: string;
  entityId: string;
  /** The cached value (null when the cache row is missing) and what the ledger sums to. */
  cached: string | null;
  ledger: string;
}

export interface ReconcileResult {
  /** False when another instance held the lock: nothing was checked. */
  ran: boolean;
  mismatches: LedgerMismatch[];
}

/** Arbitrary constant: one reconcile at a time across API instances. */
const LOCK_KEY = 7_120_412;

/**
 * Nightly check that every cached stock level and client balance equals its ledger.
 * A difference is never fixed automatically: it's logged, sent to Sentry (which
 * alerts by e-mail) and written to the tenant's audit log, for a human to look at
 * (docs/runbook.md, "Ledger reconcile").
 */
@Injectable()
export class ReconcileService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('Reconcile');
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly attendanceDays: AttendanceDaysService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  // A plain timer to the next 03:00 Algiers, not a cron library: one daily job doesn't
  // need one. Not in tests (they call run()), nor in the one-off CLI context.
  onApplicationBootstrap(): void {
    if (this.config.NODE_ENV !== 'test' && process.env['RECONCILE_CLI'] !== '1') this.schedule();
  }

  onApplicationShutdown(): void {
    clearTimeout(this.timer);
  }

  private schedule(): void {
    const at = nextAlgiersTime(3, 0);
    this.timer = setTimeout(() => {
      void this.nightly().finally(() => this.schedule());
    }, at.getTime() - Date.now());
    this.timer.unref();
  }

  async nightly(): Promise<void> {
    try {
      await this.run();
    } catch (err) {
      this.logger.error(err instanceof Error ? err.stack : String(err));
      Sentry.captureException(err);
    }
  }

  async run(): Promise<ReconcileResult> {
    const ledgers = await this.ledgers();
    if (!ledgers.ran) return ledgers;
    const mismatches = [...ledgers.mismatches, ...(await this.attendance())];
    this.report(mismatches);
    return { ran: true, mismatches };
  }

  /**
   * Cached day statuses against their events (phase 31). The rules live in TypeScript, so
   * this cannot be one of the SQL checks; each company gets its own transaction, so a
   * large pointage history never pushes the ledger checks past their timeout.
   */
  private attendance(): Promise<LedgerMismatch[]> {
    return tenantContext.runAsSystem(async () => {
      const tenants = await this.prisma.db.attendanceEvent.findMany({
        distinct: ['tenantId'],
        select: { tenantId: true },
      });
      const mismatches: LedgerMismatch[] = [];
      for (const { tenantId } of tenants) {
        const found = await this.prisma.db.$transaction(
          async (tx) => {
            const diffs = await this.attendanceDays.diffs(tx, tenantId);
            const rows = diffs.map((d) => ({
              check: 'attendance_day_equals_events',
              tenantId,
              entity: 'Employee',
              entityId: d.employee.id,
              cached: d.cached ? `${d.day} ${d.cached}` : null,
              ledger: `${d.day} ${d.expected}`,
            }));
            for (const m of rows) await this.logMismatch(tx, m);
            return rows;
          },
          { timeout: 120_000 },
        );
        mismatches.push(...found);
      }
      return mismatches;
    });
  }

  private logMismatch(tx: Tx, m: LedgerMismatch): Promise<void> {
    return this.audit.log(tx, {
      tenantId: m.tenantId,
      userId: null,
      action: 'LEDGER_MISMATCH',
      entity: m.entity,
      entityId: m.entityId,
      before: { cached: m.cached },
      after: { ledger: m.ledger, check: m.check },
    });
  }

  private ledgers(): Promise<ReconcileResult> {
    return tenantContext.runAsSystem(() =>
      this.prisma.db.$transaction(
        async (tx) => {
          const [lock] = await tx.$queryRaw<{ locked: boolean }[]>`
            SELECT pg_try_advisory_xact_lock(${LOCK_KEY}) AS locked`;
          if (!lock?.locked) return { ran: false, mismatches: [] };

          const mismatches: LedgerMismatch[] = [];
          for (const check of RECONCILE_CHECKS) {
            const rows = await tx.$queryRawUnsafe<Omit<LedgerMismatch, 'check' | 'entity'>[]>(
              check.sql,
            );
            mismatches.push(
              ...rows.map((r) => ({ check: check.name, entity: check.entity, ...r })),
            );
          }

          for (const m of mismatches) await this.logMismatch(tx, m);
          return { ran: true, mismatches };
        },
        { timeout: 120_000 },
      ),
    );
  }

  private report(mismatches: LedgerMismatch[]): void {
    if (mismatches.length === 0) {
      this.logger.log('Ledgers reconciled: no difference');
      return;
    }
    this.logger.error(
      `Ledger reconcile: ${mismatches.length} difference(s) ${JSON.stringify(mismatches.slice(0, 50))}`,
    );
    Sentry.withScope((scope) => {
      scope.setLevel('error');
      scope.setTag('job', 'ledger-reconcile');
      scope.setContext('mismatches', { list: mismatches.slice(0, 50) });
      Sentry.captureMessage(`Ledger reconcile: ${mismatches.length} difference(s)`);
    });
  }
}
