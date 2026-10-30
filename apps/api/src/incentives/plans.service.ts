import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  addDays,
  type CreatePlanInput,
  ErrorCode,
  IncentiveAppliesTo,
  IncentiveMetric,
  type IncentivePlanDto,
  IncentivePlanStatus,
  type IncentiveRuleParams,
  incentiveRuleParamsSchema,
  type NewPlanVersionInput,
  type ParsedRuleInput,
  Permission,
  requiredMetrics,
  type UpdatePlanInput,
} from '@erp/shared';
import { AuditService } from '../audit/audit.service';
import type { CurrentUserInfo } from '../auth/auth.types';
import { requirePermission } from '../auth/permissions';
import { AppException } from '../common/app-exception';
import { type Prisma } from '../generated/prisma/client';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import { assertScope, type Db, fromDay, requireTenant, toDay } from './incentive-common';

const planInclude = {
  rules: { orderBy: { position: 'asc' } },
} satisfies Prisma.IncentivePlanInclude;
export type PlanRow = Prisma.IncentivePlanGetPayload<{ include: typeof planInclude }>;

/** Rule params are validated on the way in; a stored row that no longer parses is a bug. */
export function paramsOf(rule: { params: Prisma.JsonValue }): IncentiveRuleParams {
  return incentiveRuleParamsSchema.parse(rule.params);
}

/**
 * Bonus plans and their rules (phase 18). A DRAFT is edited freely; an ACTIVE plan is
 * never edited: "modify" is a new version (a DRAFT copy) with its own validFrom, and
 * activating it ends the previous version the day before.
 */
@Injectable()
export class PlansService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(): Promise<IncentivePlanDto[]> {
    const rows = await this.prisma.db.incentivePlan.findMany({
      include: planInclude,
      orderBy: [{ status: 'asc' }, { validFrom: 'desc' }, { version: 'desc' }],
    });
    return this.toDtos(rows);
  }

  async get(id: string, db: Db = this.prisma.db): Promise<IncentivePlanDto> {
    const [dto] = await this.toDtos([await this.row(db, id)]);
    return dto!;
  }

  async row(db: Db, id: string): Promise<PlanRow> {
    const row = await db.incentivePlan.findFirst({ where: { id }, include: planInclude });
    if (!row) throw new AppException(ErrorCode.NOT_FOUND, 'Plan not found');
    return row;
  }

  async create(input: CreatePlanInput, user: CurrentUserInfo): Promise<IncentivePlanDto> {
    const id = await this.prisma.db.$transaction(async (tx) => {
      const plan = await tx.incentivePlan.create({
        data: {
          tenantId: requireTenant(),
          familyId: randomUUID(),
          name: input.name,
          period: input.period,
          validFrom: fromDay(input.validFrom),
          createdBy: user.id,
        },
      });
      await this.audit.log(tx, {
        action: 'INCENTIVE_PLAN_CREATED',
        entity: 'IncentivePlan',
        entityId: plan.id,
        after: input,
      });
      return plan.id;
    });
    return this.get(id);
  }

  async update(id: string, input: UpdatePlanInput): Promise<IncentivePlanDto> {
    await this.prisma.db.$transaction(async (tx) => {
      const plan = await this.draft(tx, id);
      await tx.incentivePlan.update({
        where: { id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.period !== undefined ? { period: input.period } : {}),
          ...(input.validFrom !== undefined ? { validFrom: fromDay(input.validFrom) } : {}),
        },
      });
      await this.audit.log(tx, {
        action: 'INCENTIVE_PLAN_UPDATED',
        entity: 'IncentivePlan',
        entityId: id,
        before: { name: plan.name, period: plan.period, validFrom: toDay(plan.validFrom) },
        after: input,
      });
    });
    return this.get(id);
  }

  async addRule(planId: string, input: ParsedRuleInput, user: CurrentUserInfo) {
    await this.prisma.db.$transaction(async (tx) => {
      const plan = await this.draft(tx, planId);
      await this.checkRule(tx, input, user);
      const rule = await tx.incentiveRule.create({
        data: {
          tenantId: requireTenant(),
          planId,
          position: (plan.rules.at(-1)?.position ?? 0) + 1,
          name: input.name,
          appliesTo: input.appliesTo,
          roleOrUserId: input.roleOrUserId,
          params: input.params as Prisma.InputJsonValue,
        },
      });
      await this.audit.log(tx, {
        action: 'INCENTIVE_RULE_ADDED',
        entity: 'IncentiveRule',
        entityId: rule.id,
        after: input,
      });
    });
    return this.get(planId);
  }

  async updateRule(planId: string, ruleId: string, input: ParsedRuleInput, user: CurrentUserInfo) {
    await this.prisma.db.$transaction(async (tx) => {
      const plan = await this.draft(tx, planId);
      const rule = plan.rules.find((r) => r.id === ruleId);
      if (!rule) throw new AppException(ErrorCode.NOT_FOUND, 'Rule not found');
      await this.checkRule(tx, input, user);
      await tx.incentiveRule.update({
        where: { id: ruleId },
        data: {
          name: input.name,
          appliesTo: input.appliesTo,
          roleOrUserId: input.roleOrUserId,
          params: input.params as Prisma.InputJsonValue,
        },
      });
      await this.audit.log(tx, {
        action: 'INCENTIVE_RULE_UPDATED',
        entity: 'IncentiveRule',
        entityId: ruleId,
        before: { name: rule.name, params: rule.params },
        after: input,
      });
    });
    return this.get(planId);
  }

  /** Rules of a draft are configuration: removing one leaves nothing behind. */
  async removeRule(planId: string, ruleId: string) {
    await this.prisma.db.$transaction(async (tx) => {
      const plan = await this.draft(tx, planId);
      const rule = plan.rules.find((r) => r.id === ruleId);
      if (!rule) throw new AppException(ErrorCode.NOT_FOUND, 'Rule not found');
      // A draft has never been run, so no line points at it.
      await tx.incentiveRule.delete({ where: { id: ruleId } });
      await this.audit.log(tx, {
        action: 'INCENTIVE_RULE_REMOVED',
        entity: 'IncentiveRule',
        entityId: ruleId,
        before: { name: rule.name, params: rule.params },
      });
    });
    return this.get(planId);
  }

  /** DRAFT → ACTIVE; the family's previous ACTIVE version ends the day before. */
  async activate(id: string): Promise<IncentivePlanDto> {
    await this.prisma.db.$transaction(async (tx) => {
      const plan = await this.draft(tx, id);
      if (plan.rules.length === 0) {
        throw new AppException(ErrorCode.INCENTIVE_PLAN_EMPTY, 'Add a rule first');
      }
      const validFrom = toDay(plan.validFrom);
      const previous = await tx.incentivePlan.findMany({
        where: { familyId: plan.familyId, status: IncentivePlanStatus.ACTIVE, id: { not: id } },
      });
      for (const p of previous) {
        if (toDay(p.validFrom) >= validFrom) {
          throw new AppException(
            ErrorCode.VALIDATION_FAILED,
            'A new version must start after the current one',
            { issues: [{ path: 'validFrom', message: 'before_current_version' }] },
          );
        }
        await tx.incentivePlan.update({
          where: { id: p.id },
          data: { validTo: fromDay(addDays(validFrom, -1)) },
        });
      }
      await tx.incentivePlan.update({
        where: { id },
        data: { status: IncentivePlanStatus.ACTIVE },
      });
      await this.audit.log(tx, {
        action: 'INCENTIVE_PLAN_ACTIVATED',
        entity: 'IncentivePlan',
        entityId: id,
        after: { version: plan.version, validFrom, closed: previous.map((p) => p.id) },
      });
    });
    return this.get(id);
  }

  /** "Modify" an active plan: a DRAFT copy, version + 1, starting at `validFrom`. */
  async newVersion(id: string, input: NewPlanVersionInput, user: CurrentUserInfo) {
    const newId = await this.prisma.db.$transaction(async (tx) => {
      const plan = await this.row(tx, id);
      if (plan.status !== IncentivePlanStatus.ACTIVE) {
        throw new AppException(ErrorCode.INCENTIVE_PLAN_NOT_ACTIVE, 'Only an active plan has versions');
      }
      if (input.validFrom <= toDay(plan.validFrom)) {
        throw new AppException(
          ErrorCode.VALIDATION_FAILED,
          'A new version must start after the current one',
          { issues: [{ path: 'validFrom', message: 'before_current_version' }] },
        );
      }
      const last = await tx.incentivePlan.findFirst({
        where: { familyId: plan.familyId },
        orderBy: { version: 'desc' },
        select: { version: true },
      });
      const copy = await tx.incentivePlan.create({
        data: {
          tenantId: requireTenant(),
          familyId: plan.familyId,
          version: (last?.version ?? plan.version) + 1,
          name: plan.name,
          period: plan.period,
          validFrom: fromDay(input.validFrom),
          createdBy: user.id,
        },
      });
      if (plan.rules.length > 0) {
        await tx.incentiveRule.createMany({
          data: plan.rules.map((r) => ({
            tenantId: requireTenant(),
            planId: copy.id,
            position: r.position,
            name: r.name,
            appliesTo: r.appliesTo,
            roleOrUserId: r.roleOrUserId,
            params: r.params as Prisma.InputJsonValue,
          })),
        });
      }
      await this.audit.log(tx, {
        action: 'INCENTIVE_PLAN_VERSIONED',
        entity: 'IncentivePlan',
        entityId: copy.id,
        before: { planId: plan.id, version: plan.version },
        after: { version: copy.version, validFrom: input.validFrom },
      });
      return copy.id;
    });
    return this.get(newId);
  }

  async archive(id: string): Promise<IncentivePlanDto> {
    await this.prisma.db.$transaction(async (tx) => {
      const plan = await this.row(tx, id);
      if (plan.status === IncentivePlanStatus.ARCHIVED) return;
      await tx.incentivePlan.update({
        where: { id },
        data: { status: IncentivePlanStatus.ARCHIVED },
      });
      await this.audit.log(tx, {
        action: 'INCENTIVE_PLAN_ARCHIVED',
        entity: 'IncentivePlan',
        entityId: id,
        before: { status: plan.status },
      });
    });
    return this.get(id);
  }

  /** The plan, locked, if it is still a draft. */
  private async draft(tx: Tx, id: string): Promise<PlanRow> {
    await tx.$queryRaw`SELECT id FROM incentive_plans
      WHERE id = ${id}::uuid AND "tenantId" = ${requireTenant()}::uuid FOR UPDATE`;
    const plan = await this.row(tx, id);
    if (plan.status !== IncentivePlanStatus.DRAFT) {
      throw new AppException(
        ErrorCode.INCENTIVE_PLAN_NOT_DRAFT,
        'An active plan is never edited: create a new version',
        { status: plan.status },
      );
    }
    return plan;
  }

  private async checkRule(tx: Tx, input: ParsedRuleInput, user: CurrentUserInfo) {
    if (input.appliesTo !== IncentiveAppliesTo.ROLE) {
      const u = await tx.user.findFirst({ where: { id: input.roleOrUserId }, select: { id: true } });
      if (!u) throw new AppException(ErrorCode.NOT_FOUND, 'User not found');
    }
    const refs = requiredMetrics(input.params);
    if (refs.some((r) => r.metric === IncentiveMetric.MARGE)) {
      requirePermission(user, Permission.VIEW_COST_AND_MARGIN, {
        message: 'You may not see costs and margins',
      });
    }
    for (const r of refs) await assertScope(tx, r.scope);
    if (input.params.type === 'PER_UNIT' && input.params.unitId) {
      const unit = await tx.productUnit.findFirst({
        where: {
          unitId: input.params.unitId,
          deletedAt: null,
          ...(input.params.scope.productId ? { productId: input.params.scope.productId } : {}),
        },
        select: { id: true },
      });
      if (!input.params.scope.productId || !unit) {
        throw new AppException(ErrorCode.VALIDATION_FAILED, 'A unit needs a product it belongs to', {
          issues: [{ path: 'params.unitId', message: 'unit_not_of_product' }],
        });
      }
    }
  }

  private async toDtos(rows: PlanRow[]): Promise<IncentivePlanDto[]> {
    const userIds = rows.flatMap((p) =>
      p.rules.filter((r) => r.appliesTo !== IncentiveAppliesTo.ROLE).map((r) => r.roleOrUserId),
    );
    const users = await this.prisma.db.user.findMany({
      where: { id: { in: [...new Set(userIds)] } },
      select: { id: true, fullName: true },
    });
    const names = new Map(users.map((u) => [u.id, u.fullName]));
    return rows.map((p) => ({
      id: p.id,
      familyId: p.familyId,
      version: p.version,
      name: p.name,
      period: p.period,
      validFrom: toDay(p.validFrom),
      validTo: p.validTo ? toDay(p.validTo) : null,
      status: p.status,
      createdAt: p.createdAt.toISOString(),
      rules: p.rules.map((r) => ({
        id: r.id,
        position: r.position,
        name: r.name,
        appliesTo: r.appliesTo,
        roleOrUserId: r.roleOrUserId,
        subjectName:
          r.appliesTo === IncentiveAppliesTo.ROLE ? null : (names.get(r.roleOrUserId) ?? null),
        params: paramsOf(r),
      })),
    }));
  }
}
