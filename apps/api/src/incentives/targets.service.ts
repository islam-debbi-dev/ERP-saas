import { Injectable } from '@nestjs/common';
import {
  type BulkTargets,
  ErrorCode,
  IncentiveMetric,
  IncentivePeriod,
  Permission,
  type SalesTargetDto,
  type SalesTargetQuery,
  scopeKey,
  sum,
  isTeamLead,
} from '@erp/shared';
import { AuditService } from '../audit/audit.service';
import type { CurrentUserInfo } from '../auth/auth.types';
import { requirePermission } from '../auth/permissions';
import { AppException } from '../common/app-exception';
import { type Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ScopeService } from '../sales-force/scope.service';
import {
  assertPeriodOpen,
  assertScope,
  fromDay,
  monthOf,
  requireTenant,
  runPeriod,
  scopeLabels,
  scopeOfTarget,
  type TargetRow,
} from './incentive-common';

/**
 * Monthly targets (phase 18): one per seller (or per manager's team), month, figure and
 * scope. Entered from the bulk grid; frozen once the month's bonuses are approved.
 */
@Injectable()
export class TargetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly audit: AuditService,
  ) {}

  async list(query: SalesTargetQuery, user: CurrentUserInfo): Promise<SalesTargetDto[]> {
    const team = isTeamLead(user.role) ? await this.scope.teamIds(user.id) : null;
    const rows = await this.prisma.db.salesTarget.findMany({
      where: {
        periodStart: fromDay(`${query.period}-01`),
        ...(query.metric ? { metric: query.metric } : {}),
        ...(team ? { OR: [{ userId: { in: team } }, { teamManagerId: { in: team } }] } : {}),
      },
      orderBy: [{ metric: 'asc' }, { scopeKey: 'asc' }, { createdAt: 'asc' }],
    });
    return this.toDtos(rows);
  }

  /** Upserts the grid's rows; an empty value removes the target. All or nothing. */
  async bulk(input: BulkTargets, user: CurrentUserInfo): Promise<SalesTargetDto[]> {
    if (input.metric === IncentiveMetric.MARGE) {
      requirePermission(user, Permission.VIEW_COST_AND_MARGIN, {
        message: 'You may not see costs and margins',
      });
    }
    const period = runPeriod(input.period, IncentivePeriod.MONTH);
    const tenantId = requireTenant();
    const key = scopeKey(input.scope);
    const periodStart = fromDay(period.firstDay);
    const subjects = [
      ...new Set(
        input.rows.map((r) => r.userId ?? r.teamManagerId).filter((v): v is string => !!v),
      ),
    ];
    await this.prisma.db.$transaction(async (tx) => {
      await assertPeriodOpen(tx, period.firstDay, period.lastDay);
      await assertScope(tx, input.scope);
      const users = await tx.user.count({ where: { id: { in: subjects } } });
      if (users !== subjects.length) {
        throw new AppException(ErrorCode.NOT_FOUND, 'User not found');
      }
      const existing = await tx.salesTarget.findMany({
        where: { periodStart, metric: input.metric, scopeKey: key },
      });
      const find = (r: (typeof input.rows)[number]) =>
        existing.find((e) =>
          r.userId ? e.userId === r.userId : e.teamManagerId === r.teamManagerId,
        );
      const changes: {
        subject: string;
        team: boolean;
        before: string | null;
        after: string | null;
      }[] = [];
      for (const r of input.rows) {
        const row = find(r);
        const subject = (r.userId ?? r.teamManagerId)!;
        const before = row ? row.targetValue.toString() : null;
        if (r.value === null) {
          if (row) await tx.salesTarget.delete({ where: { id: row.id } });
        } else if (row) {
          if (!row.targetValue.equals(r.value)) {
            await tx.salesTarget.update({
              where: { id: row.id },
              data: { targetValue: r.value, updatedBy: user.id },
            });
          }
        } else {
          await tx.salesTarget.create({
            data: {
              tenantId,
              periodStart,
              userId: r.userId ?? null,
              teamManagerId: r.teamManagerId ?? null,
              metric: input.metric,
              scopeKey: key,
              brandId: input.scope?.brandId ?? null,
              categoryId: input.scope?.categoryId ?? null,
              productId: input.scope?.productId ?? null,
              targetValue: r.value,
              createdBy: user.id,
              updatedBy: user.id,
            },
          });
        }
        if (before !== r.value) changes.push({ subject, team: !r.userId, before, after: r.value });
      }
      if (changes.length > 0) {
        await this.audit.log(tx, {
          action: 'SALES_TARGETS_SAVED',
          entity: 'SalesTarget',
          after: { period: input.period, metric: input.metric, scope: input.scope, changes },
        });
      }
    });
    return this.list({ period: input.period, metric: input.metric }, user);
  }

  /**
   * The target of one subject on one figure over the run's months (summed for a quarter);
   * a team without its own target gets the sum of its members' targets. null = none.
   */
  targetOf(
    rows: readonly TargetRow[],
    subject: { userId: string; team: boolean; teamIds?: readonly string[] },
    metric: string,
    key: string,
    months: readonly string[],
  ): string | null {
    const on = rows.filter(
      (r) => r.metric === metric && r.scopeKey === key && months.includes(monthOf(r.periodStart)),
    );
    const own = subject.team
      ? on.filter((r) => r.teamManagerId === subject.userId)
      : on.filter((r) => r.userId === subject.userId);
    const picked =
      own.length > 0 || !subject.team
        ? own
        : on.filter((r) => r.userId !== null && subject.teamIds?.includes(r.userId));
    if (picked.length === 0) return null;
    return sum(picked.map((r) => r.targetValue.toString())).toString();
  }

  /** Every target of these months (for a run or the live progress). */
  rowsFor(months: readonly string[], where: Prisma.SalesTargetWhereInput = {}) {
    return this.prisma.db.salesTarget.findMany({
      where: { periodStart: { in: months.map((m) => fromDay(`${m}-01`)) }, ...where },
    });
  }

  private async toDtos(rows: TargetRow[]): Promise<SalesTargetDto[]> {
    const labels = await scopeLabels(
      this.prisma.db,
      rows.map((r) => scopeOfTarget(r)),
    );
    return rows.map((r) => ({
      id: r.id,
      period: monthOf(r.periodStart),
      userId: r.userId,
      teamManagerId: r.teamManagerId,
      metric: r.metric as IncentiveMetric,
      scope: scopeOfTarget(r),
      scopeLabel: labels.get(r.scopeKey) ?? null,
      value: r.targetValue.toString(),
    }));
  }
}
