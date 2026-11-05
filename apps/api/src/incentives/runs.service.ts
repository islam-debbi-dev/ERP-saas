import { Injectable } from '@nestjs/common';
import {
  ErrorCode,
  evaluateRule,
  type IncentiveLineDto,
  IncentiveMetric,
  IncentivePlanStatus,
  type IncentiveRunDetailDto,
  type IncentiveRunDto,
  IncentiveRunStatus,
  metricKey,
  type MetricRef,
  Permission,
  type PreviewRunInput,
  requiredMetrics,
  type RuleExplanation,
  ruleMainMetric,
  type RunListQuery,
  scopeKey,
  sum,
  toMoneyString,
} from '@erp/shared';
import { AuditService } from '../audit/audit.service';
import type { CurrentUserInfo } from '../auth/auth.types';
import { requirePermission } from '../auth/permissions';
import { AppException } from '../common/app-exception';
import { type Prisma } from '../generated/prisma/client';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import { ScopeService } from '../sales-force/scope.service';
import {
  fromDay,
  isTeamRule,
  monthOf,
  requireTenant,
  ruleAppliesTo,
  runPeriod,
  scopeLabels,
  toDay,
} from './incentive-common';
import { IncentiveMetricsService } from './incentive-metrics.service';
import { paramsOf, PlansService } from './plans.service';
import { TargetsService } from './targets.service';

const runInclude = {
  plan: { select: { name: true, version: true, period: true } },
  lines: { select: { amount: true, userId: true } },
} satisfies Prisma.IncentiveRunInclude;
type RunRow = Prisma.IncentiveRunGetPayload<{ include: typeof runInclude }>;

const FROZEN: IncentiveRunStatus[] = [IncentiveRunStatus.APPROVED, IncentiveRunStatus.EXPORTED];

/**
 * Month-end bonuses (phase 18): a PREVIEW computed from the figures and the plan's rules
 * (recomputed at will, its lines replaced), approved by the owner (frozen, audited, one
 * per plan and period), then exported to Excel for payroll. No payroll here.
 */
@Injectable()
export class RunsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly plans: PlansService,
    private readonly targets: TargetsService,
    private readonly metrics: IncentiveMetricsService,
    private readonly scope: ScopeService,
    private readonly audit: AuditService,
  ) {}

  async list(query: RunListQuery): Promise<IncentiveRunDto[]> {
    const rows = await this.prisma.db.incentiveRun.findMany({
      where: query.planId ? { planId: query.planId } : {},
      include: runInclude,
      orderBy: [{ periodStart: 'desc' }, { computedAt: 'desc' }],
      take: 100,
    });
    return this.toDtos(rows);
  }

  async preview(input: PreviewRunInput, user: CurrentUserInfo): Promise<IncentiveRunDetailDto> {
    const plan = await this.plans.row(this.prisma.db, input.planId);
    if (plan.status !== IncentivePlanStatus.ACTIVE) {
      throw new AppException(ErrorCode.INCENTIVE_PLAN_NOT_ACTIVE, 'Activate the plan first');
    }
    const period = runPeriod(input.period, plan.period);
    const from = toDay(plan.validFrom);
    const to = plan.validTo ? toDay(plan.validTo) : null;
    if (period.firstDay < from || (to !== null && period.firstDay > to)) {
      throw new AppException(ErrorCode.VALIDATION_FAILED, 'The plan is not valid for this period', {
        issues: [{ path: 'period', message: 'outside_plan_validity' }],
      });
    }
    const rules = plan.rules.map((r) => ({ ...r, params: paramsOf(r) }));
    if (rules.length === 0) throw new AppException(ErrorCode.INCENTIVE_PLAN_EMPTY, 'No rule');

    const refs = uniqueRefs(rules.flatMap((r) => requiredMetrics(r.params)));
    const [figures, users, targetRows] = await Promise.all([
      this.metrics.compute(refs, period),
      // Users live at some point of the period (a seller who left mid-month is paid).
      this.prisma.db.user.findMany({
        where: { OR: [{ deletedAt: null }, { deletedAt: { gte: period.start } }] },
        select: { id: true, role: true, fullName: true },
        orderBy: { fullName: 'asc' },
      }),
      this.targets.rowsFor(period.months),
    ]);

    const lines: Prisma.IncentiveLineCreateManyInput[] = [];
    const tenantId = requireTenant();
    for (const rule of rules) {
      const team = isTeamRule(rule);
      const main = ruleMainMetric(rule.params);
      const needed = requiredMetrics(rule.params);
      for (const u of users.filter((x) => ruleAppliesTo(rule, x))) {
        const ids = team ? await this.scope.teamIds(u.id) : [u.id];
        const values = this.metrics.values(figures, needed, ids);
        const target = this.targets.targetOf(
          targetRows,
          { userId: u.id, team, teamIds: ids },
          main.metric,
          scopeKey(main.scope),
          period.months,
        );
        const { amount, explanation } = evaluateRule(rule.params, values, target);
        lines.push({
          tenantId,
          runId: '',
          userId: u.id,
          ruleId: rule.id,
          metrics: values,
          target,
          amount,
          explanation: explanation as unknown as Prisma.InputJsonValue,
        });
      }
    }

    const runId = await this.prisma.db.$transaction(async (tx) => {
      // Two previews of the same plan wait for each other (the second replaces the first).
      await tx.$queryRaw`SELECT id FROM incentive_plans
        WHERE id = ${plan.id}::uuid AND "tenantId" = ${tenantId}::uuid FOR UPDATE`;
      const existing = await tx.$queryRaw<{ id: string; status: IncentiveRunStatus }[]>`
        SELECT id, status FROM incentive_runs
        WHERE "tenantId" = ${tenantId}::uuid AND "planId" = ${plan.id}::uuid
          AND "periodStart" = ${fromDay(period.firstDay)}::date
        FOR UPDATE`;
      const approved = existing.find((r) => FROZEN.includes(r.status));
      if (approved) {
        throw new AppException(
          ErrorCode.INCENTIVE_RUN_APPROVED,
          'This period is approved: it cannot be recomputed',
          { runId: approved.id },
        );
      }
      const now = new Date();
      const preview = existing.find((r) => r.status === IncentiveRunStatus.PREVIEW);
      let id: string;
      if (preview) {
        id = preview.id;
        // Previews are not business history: their lines are simply replaced.
        await tx.incentiveLine.deleteMany({ where: { runId: id } });
        await tx.incentiveRun.update({
          where: { id },
          data: { computedAt: now, computedBy: user.id },
        });
      } else {
        id = (
          await tx.incentiveRun.create({
            data: {
              tenantId,
              planId: plan.id,
              periodStart: fromDay(period.firstDay),
              periodEnd: fromDay(period.lastDay),
              computedAt: now,
              computedBy: user.id,
            },
          })
        ).id;
      }
      if (lines.length > 0) {
        await tx.incentiveLine.createMany({ data: lines.map((l) => ({ ...l, runId: id })) });
      }
      await this.audit.log(tx, {
        action: 'INCENTIVE_RUN_PREVIEWED',
        entity: 'IncentiveRun',
        entityId: id,
        after: { planId: plan.id, period: input.period, lines: lines.length },
      });
      return id;
    });
    return this.get(runId, user);
  }

  async get(id: string, user: CurrentUserInfo): Promise<IncentiveRunDetailDto> {
    const row = await this.prisma.db.incentiveRun.findFirst({ where: { id }, include: runInclude });
    if (!row) throw new AppException(ErrorCode.NOT_FOUND, 'Run not found');
    const lines = await this.prisma.db.incentiveLine.findMany({
      where: { runId: id },
      include: {
        rule: { select: { name: true, position: true } },
      },
      orderBy: [{ rule: { position: 'asc' } }],
    });
    const explanations = lines.map((l) => l.explanation as unknown as RuleExplanation);
    if (explanations.some((e) => e.metric === IncentiveMetric.MARGE)) {
      requirePermission(user, Permission.VIEW_COST_AND_MARGIN, {
        message: 'You may not see costs and margins',
      });
    }
    const users = await this.prisma.db.user.findMany({
      where: { id: { in: [...new Set(lines.map((l) => l.userId))] } },
      select: { id: true, fullName: true, role: true },
      orderBy: { fullName: 'asc' },
    });
    const labels = await scopeLabels(
      this.prisma.db,
      explanations.flatMap((e) => [e.scope, ...e.gates.map((g) => g.scope)]),
    );
    const [dto] = await this.toDtos([row]);
    return {
      ...dto!,
      scopeLabels: Object.fromEntries(labels),
      users: users.map((u) => {
        const mine = lines.filter((l) => l.userId === u.id);
        return {
          user: { id: u.id, fullName: u.fullName, role: u.role },
          total: toMoneyString(sum(mine.map((l) => l.amount.toString()))),
          lines: mine.map((l): IncentiveLineDto => ({
            ruleId: l.ruleId,
            ruleName: l.rule.name,
            amount: toMoneyString(l.amount.toString()),
            explanation: l.explanation as unknown as RuleExplanation,
          })),
        };
      }),
    };
  }

  /** PREVIEW → APPROVED: frozen from now on (DB trigger), and audited. */
  async approve(id: string, user: CurrentUserInfo): Promise<IncentiveRunDetailDto> {
    requirePermission(user, Permission.INCENTIVE_APPROVE, {
      message: 'Only the owner (or a user he allows) approves bonuses',
    });
    await this.prisma.db.$transaction(async (tx) => {
      const [run] = await tx.$queryRaw<
        { status: IncentiveRunStatus; planId: string; periodStart: Date }[]
      >`
        SELECT status, "planId", "periodStart" FROM incentive_runs
        WHERE id = ${id}::uuid AND "tenantId" = ${requireTenant()}::uuid FOR UPDATE`;
      if (!run) throw new AppException(ErrorCode.NOT_FOUND, 'Run not found');
      if (run.status !== IncentiveRunStatus.PREVIEW) {
        throw new AppException(ErrorCode.INCENTIVE_RUN_NOT_PREVIEW, 'Already approved', {
          status: run.status,
        });
      }
      const total = await tx.incentiveLine.aggregate({
        where: { runId: id },
        _sum: { amount: true },
      });
      const now = new Date();
      await tx.incentiveRun.update({
        where: { id },
        data: { status: IncentiveRunStatus.APPROVED, approvedBy: user.id, approvedAt: now },
      });
      await this.audit.log(tx, {
        action: 'INCENTIVE_RUN_APPROVED',
        entity: 'IncentiveRun',
        entityId: id,
        before: { status: run.status },
        after: {
          status: IncentiveRunStatus.APPROVED,
          planId: run.planId,
          period: monthOf(run.periodStart),
          total: toMoneyString(total._sum.amount?.toString() ?? '0'),
        },
      });
    });
    return this.get(id, user);
  }

  /**
   * Approved bonuses for the paie (phase 31b), per run and user, read only. EXPORTED runs
   * are approved runs too. Only periods ending from `fromDay` to `toDay`: older months were
   * paid outside the software, from the Excel export.
   */
  async approvedForPayroll(
    db: Tx,
    fromDay: Date,
    toDay: Date,
  ): Promise<
    { runId: string; period: string; userId: string; fullName: string; amount: string }[]
  > {
    const lines = await db.incentiveLine.groupBy({
      by: ['runId', 'userId'],
      where: {
        run: {
          status: { in: [IncentiveRunStatus.APPROVED, IncentiveRunStatus.EXPORTED] },
          periodEnd: { gte: fromDay, lte: toDay },
        },
      },
      _sum: { amount: true },
    });
    const [runs, users] = await Promise.all([
      db.incentiveRun.findMany({
        where: { id: { in: [...new Set(lines.map((l) => l.runId))] } },
        select: { id: true, periodStart: true },
      }),
      db.user.findMany({
        where: { id: { in: [...new Set(lines.map((l) => l.userId))] } },
        select: { id: true, fullName: true },
      }),
    ]);
    const periods = new Map(runs.map((r) => [r.id, monthOf(r.periodStart)]));
    const names = new Map(users.map((u) => [u.id, u.fullName]));
    return lines.map((l) => ({
      runId: l.runId,
      period: periods.get(l.runId) ?? '',
      userId: l.userId,
      fullName: names.get(l.userId) ?? '',
      amount: toMoneyString(l._sum.amount?.toString() ?? '0'),
    }));
  }

  /** The approved run for payroll; the first export marks it EXPORTED. */
  async exportRun(id: string, user: CurrentUserInfo): Promise<IncentiveRunDetailDto> {
    requirePermission(user, Permission.EXPORT_DATA, { message: 'You may not export data' });
    const detail = await this.get(id, user);
    if (!FROZEN.includes(detail.status)) {
      throw new AppException(ErrorCode.INCENTIVE_RUN_NOT_APPROVED, 'Approve the run first');
    }
    if (detail.status === IncentiveRunStatus.APPROVED) {
      await this.prisma.db.$transaction(async (tx) => {
        const now = new Date();
        const updated = await tx.incentiveRun.updateMany({
          where: { id, status: IncentiveRunStatus.APPROVED },
          data: { status: IncentiveRunStatus.EXPORTED, exportedAt: now },
        });
        if (updated.count > 0) {
          await this.audit.log(tx, {
            action: 'INCENTIVE_RUN_EXPORTED',
            entity: 'IncentiveRun',
            entityId: id,
            after: { exportedAt: now.toISOString() },
          });
        }
      });
    }
    return detail;
  }

  private async toDtos(rows: RunRow[]): Promise<IncentiveRunDto[]> {
    const approvers = await this.prisma.db.user.findMany({
      where: { id: { in: rows.map((r) => r.approvedBy).filter((v): v is string => !!v) } },
      select: { id: true, fullName: true },
    });
    return rows.map((r) => ({
      id: r.id,
      planId: r.planId,
      planName: r.plan.name,
      planVersion: r.plan.version,
      period: monthOf(r.periodStart),
      periodEnd: toDay(r.periodEnd),
      status: r.status,
      computedAt: r.computedAt.toISOString(),
      approvedAt: r.approvedAt?.toISOString() ?? null,
      approvedBy: approvers.find((a) => a.id === r.approvedBy) ?? null,
      exportedAt: r.exportedAt?.toISOString() ?? null,
      total: toMoneyString(sum(r.lines.map((l) => l.amount.toString()))),
      userCount: new Set(r.lines.map((l) => l.userId)).size,
    }));
  }
}

export function uniqueRefs(refs: readonly MetricRef[]): MetricRef[] {
  return [...new Map(refs.map((r) => [metricKey(r), r])).values()];
}
