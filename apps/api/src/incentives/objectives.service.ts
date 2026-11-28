import { Injectable } from '@nestjs/common';
import {
  algiersDay,
  daysInMonth,
  IncentiveMetric,
  IncentivePeriod,
  IncentivePlanStatus,
  metricDecimals,
  metricKey,
  type MetricRef,
  money,
  type MyObjectivesDto,
  type ObjectiveDto,
  objectiveProgress,
  Permission,
  ruleMainMetric,
  ruleThresholds,
  scopeKey,
  isTeamLead,
} from '@erp/shared';
import type { CurrentUserInfo } from '../auth/auth.types';
import { can } from '../auth/permissions';
import { PrismaService } from '../prisma/prisma.service';
import { ScopeService } from '../sales-force/scope.service';
import {
  fromDay,
  isTeamRule,
  ruleAppliesTo,
  runPeriod,
  scopeLabels,
  scopeOfTarget,
} from './incentive-common';
import { IncentiveMetricsService } from './incentive-metrics.service';
import { paramsOf } from './plans.service';
import { uniqueRefs } from './runs.service';

/**
 * "Mes objectifs" (phase 18): the caller's targets of the current month, how far he is
 * and what is left for the next tier. A supervisor also sees his team's targets and his
 * members'. Computed on demand over indexed columns; never stored.
 */
@Injectable()
export class ObjectivesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly metrics: IncentiveMetricsService,
    private readonly scope: ScopeService,
  ) {}

  async mine(user: CurrentUserInfo, today = algiersDay()): Promise<MyObjectivesDto> {
    const month = today.slice(0, 7);
    const period = runPeriod(month, IncentivePeriod.MONTH);
    const team = isTeamLead(user.role) ? await this.scope.teamIds(user.id) : [user.id];
    const targets = await this.prisma.db.salesTarget.findMany({
      where: {
        periodStart: fromDay(period.firstDay),
        // A chef de zone also reads the team targets of the supervisors under him.
        OR: [{ userId: { in: team } }, { teamManagerId: { in: team } }],
      },
      orderBy: [{ teamManagerId: 'asc' }, { metric: 'asc' }, { scopeKey: 'asc' }],
    });
    const [y, m] = month.split('-').map(Number) as [number, number];
    const daysLeft = daysInMonth(y, m) - Number(today.slice(8, 10)) + 1;
    if (targets.length === 0) return { period: month, daysLeft, items: [] };

    const refs = uniqueRefs(
      targets.map((t): MetricRef => {
        const scope = scopeOfTarget(t);
        return { metric: t.metric as IncentiveMetric, ...(scope ? { scope } : {}) };
      }),
    );
    const subjectIds = [...new Set(targets.map((t) => (t.userId ?? t.teamManagerId)!))];
    const [figures, users, plans, labels] = await Promise.all([
      this.metrics.compute(refs, period),
      this.prisma.db.user.findMany({
        where: { id: { in: subjectIds } },
        select: { id: true, fullName: true, role: true },
      }),
      this.prisma.db.incentivePlan.findMany({
        where: {
          status: IncentivePlanStatus.ACTIVE,
          validFrom: { lte: fromDay(period.firstDay) },
          OR: [{ validTo: null }, { validTo: { gte: fromDay(period.firstDay) } }],
        },
        include: { rules: true },
      }),
      scopeLabels(
        this.prisma.db,
        targets.map((t) => scopeOfTarget(t)),
      ),
    ]);
    const rules = plans.flatMap((p) => p.rules.map((r) => ({ ...r, params: paramsOf(r) })));
    const seesCost = can(user, Permission.VIEW_COST_AND_MARGIN);

    const items: ObjectiveDto[] = [];
    for (const t of targets) {
      const isTeam = t.teamManagerId !== null;
      const subject = users.find((u) => u.id === (t.userId ?? t.teamManagerId));
      if (!subject) continue;
      const scope = scopeOfTarget(t);
      const ref: MetricRef = { metric: t.metric as IncentiveMetric, ...(scope ? { scope } : {}) };
      const ids = isTeam ? await this.scope.teamIds(subject.id) : [subject.id];
      const achieved = this.metrics.values(figures, [ref], ids)[metricKey(ref)]!;
      const thresholds = rules
        .filter(
          (r) =>
            isTeamRule(r) === isTeam &&
            ruleAppliesTo(r, subject) &&
            r.params.type !== 'PER_UNIT' &&
            metricKey(ruleMainMetric(r.params)) === metricKey(ref),
        )
        .flatMap((r) => ruleThresholds(r.params));
      const decimals = metricDecimals(ref.metric);
      const value = t.targetValue.toString();
      const progress = objectiveProgress(achieved, value, thresholds, decimals);
      const hidden = ref.metric === IncentiveMetric.MARGE && !seesCost;
      items.push({
        targetId: t.id,
        metric: ref.metric,
        scope,
        scopeLabel: labels.get(scopeKey(scope)) ?? null,
        team: isTeam,
        subject: { id: subject.id, fullName: subject.fullName },
        achieved: hidden ? null : fixed(achieved, decimals),
        target: hidden ? null : fixed(value, decimals),
        pct: progress.pct,
        thresholds: [...new Set(thresholds.length ? thresholds : ['100'])].sort((x, y) =>
          money(x).comparedTo(money(y)),
        ),
        next: progress.next
          ? { pct: progress.next.pct, remaining: hidden ? null : progress.next.remaining }
          : null,
      });
    }
    // The caller's own first, then his team, then his members.
    const rank = (o: ObjectiveDto) => (o.subject.id === user.id ? (o.team ? 1 : 0) : 2);
    items.sort((a, b) => rank(a) - rank(b));
    return { period: month, daysLeft, items };
  }
}

function fixed(v: string, decimals: number): string {
  return money(v).toFixed(decimals);
}
