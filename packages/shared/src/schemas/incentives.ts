import { z } from 'zod';
import {
  INCENTIVE_APPLIES_TO,
  INCENTIVE_PERIODS,
  IncentiveAppliesTo,
  type IncentiveAppliesTo as IncentiveAppliesToValue,
  type IncentivePeriod,
  type IncentivePlanStatus,
  type IncentiveRunStatus,
  type Role,
  ROLES,
} from '../enums';
import {
  type IncentiveMetric,
  type IncentiveRuleParams,
  incentiveRuleParamsSchema,
  type MetricScope,
  metricScopeSchema,
  metricValueString,
  type ObjectiveStep,
  type RuleExplanation,
  TARGET_METRICS,
} from '../incentives';

const id = z.uuid();
/** A month, `YYYY-MM`: targets and runs are per calendar month (Algiers). */
export const monthString = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'invalid_month');
const firstOfMonth = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-01$/, 'not_first_of_month');
const name = z.string().trim().min(1).max(80);
const targetMetric = z.enum(TARGET_METRICS as [IncentiveMetric, ...IncentiveMetric[]]);

// ---------------------------------------------------------------- targets

export const salesTargetQuerySchema = z.object({
  period: monthString,
  metric: targetMetric.optional(),
});
export type SalesTargetQuery = z.infer<typeof salesTargetQuerySchema>;

/** One row of the bulk grid: a seller (userId) or a manager's team (teamManagerId). */
const targetRow = z
  .object({
    userId: id.optional(),
    teamManagerId: id.optional(),
    /** null removes the target. */
    value: metricValueString.nullable(),
  })
  .strict()
  .refine((r) => (r.userId === undefined) !== (r.teamManagerId === undefined), {
    message: 'user_or_team',
  });

/** The targets of one month on one figure, entered from the grid. */
export const bulkTargetsSchema = z
  .object({
    period: monthString,
    metric: targetMetric,
    scope: metricScopeSchema.nullable().default(null),
    rows: z.array(targetRow).min(1).max(500),
  })
  .strict();
export type BulkTargetsInput = z.input<typeof bulkTargetsSchema>;
export type BulkTargets = z.infer<typeof bulkTargetsSchema>;

export interface SalesTargetDto {
  id: string;
  period: string;
  userId: string | null;
  teamManagerId: string | null;
  metric: IncentiveMetric;
  scope: MetricScope | null;
  /** "Marque X", "Produit Y": the scope's names, for display. */
  scopeLabel: string | null;
  value: string;
}

// ---------------------------------------------------------------- plans and rules

export const createPlanSchema = z
  .object({
    name,
    period: z.enum(INCENTIVE_PERIODS as [IncentivePeriod, ...IncentivePeriod[]]),
    validFrom: firstOfMonth,
  })
  .strict();
export type CreatePlanInput = z.infer<typeof createPlanSchema>;

export const updatePlanSchema = createPlanSchema.partial().strict();
export type UpdatePlanInput = z.infer<typeof updatePlanSchema>;

export const newPlanVersionSchema = z.object({ validFrom: firstOfMonth }).strict();
export type NewPlanVersionInput = z.infer<typeof newPlanVersionSchema>;

export const ruleInputSchema = z
  .object({
    name,
    appliesTo: z.enum(INCENTIVE_APPLIES_TO as [IncentiveAppliesToValue, ...IncentiveAppliesToValue[]]),
    /** A role for ROLE, a user id for USER and TEAM_MANAGER. */
    roleOrUserId: z.string().trim().min(1).max(40),
    params: incentiveRuleParamsSchema,
  })
  .strict()
  .superRefine((r, ctx) => {
    const ok =
      r.appliesTo === IncentiveAppliesTo.ROLE
        ? (ROLES as readonly string[]).includes(r.roleOrUserId)
        : z.uuid().safeParse(r.roleOrUserId).success;
    if (!ok) ctx.addIssue({ code: 'custom', message: 'invalid_subject', path: ['roleOrUserId'] });
  });
export type RuleInput = z.input<typeof ruleInputSchema>;
export type ParsedRuleInput = z.infer<typeof ruleInputSchema>;

export interface IncentiveRuleDto {
  id: string;
  position: number;
  name: string;
  appliesTo: IncentiveAppliesToValue;
  roleOrUserId: string;
  /** The user's name for USER / TEAM_MANAGER. */
  subjectName: string | null;
  params: IncentiveRuleParams;
}

export interface IncentivePlanDto {
  id: string;
  familyId: string;
  version: number;
  name: string;
  period: IncentivePeriod;
  validFrom: string;
  validTo: string | null;
  status: IncentivePlanStatus;
  rules: IncentiveRuleDto[];
  createdAt: string;
}

// ---------------------------------------------------------------- runs

export const previewRunSchema = z.object({ planId: id, period: monthString }).strict();
export type PreviewRunInput = z.infer<typeof previewRunSchema>;

export const runListQuerySchema = z.object({ planId: id.optional() });
export type RunListQuery = z.infer<typeof runListQuerySchema>;

export interface IncentiveRunDto {
  id: string;
  planId: string;
  planName: string;
  planVersion: number;
  /** First month, `YYYY-MM`. */
  period: string;
  periodEnd: string;
  status: IncentiveRunStatus;
  computedAt: string;
  approvedAt: string | null;
  approvedBy: { id: string; fullName: string } | null;
  exportedAt: string | null;
  total: string;
  userCount: number;
}

export interface IncentiveLineDto {
  ruleId: string;
  ruleName: string;
  amount: string;
  explanation: RuleExplanation;
}

export interface IncentiveRunUserDto {
  user: { id: string; fullName: string; role: Role };
  total: string;
  lines: IncentiveLineDto[];
}

export interface IncentiveRunDetailDto extends IncentiveRunDto {
  users: IncentiveRunUserDto[];
  /** Names of the brands / categories / products the rules are scoped on. */
  scopeLabels: Record<string, string>;
}

// ---------------------------------------------------------------- live progress

export interface ObjectiveDto {
  targetId: string;
  metric: IncentiveMetric;
  scope: MetricScope | null;
  scopeLabel: string | null;
  /** A team target (the subject's whole subtree). */
  team: boolean;
  subject: { id: string; fullName: string };
  /** null when hidden (margin without VIEW_COST_AND_MARGIN). */
  achieved: string | null;
  target: string | null;
  pct: string | null;
  /** Every % of the target where the plan pays more (tier markers), ascending. */
  thresholds: string[];
  /** The next threshold; `remaining` is null when the values are hidden. */
  next: (Omit<ObjectiveStep, 'remaining'> & { remaining: string | null }) | null;
}

export interface MyObjectivesDto {
  period: string;
  /** Days left in the month, today included. */
  daysLeft: number;
  items: ObjectiveDto[];
}
