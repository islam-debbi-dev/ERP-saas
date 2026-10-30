import {
  daysInMonth,
  ErrorCode,
  IncentiveAppliesTo,
  IncentivePeriod,
  type IncentiveRuleParams,
  IncentiveRuleType,
  type MetricScope,
  Role,
  scopeKey,
} from '@erp/shared';
import { algiersRange } from '../common/algiers';
import { AppException } from '../common/app-exception';
import { tenantContext } from '../common/tenant-context';
import type { Prisma } from '../generated/prisma/client';
import type { PrismaService, Tx } from '../prisma/prisma.service';
import type { Period } from './incentive-metrics.service';

export type Db = PrismaService['db'] | Tx;

export const MANAGERS = [Role.OWNER, Role.MANAGER];

/** A run's months: `YYYY-MM` of the first, its Algiers days and instants. */
export interface RunPeriod extends Period {
  months: string[];
  firstDay: string;
  lastDay: string;
}

export const toDay = (d: Date): string => d.toISOString().slice(0, 10);
export const fromDay = (s: string): Date => new Date(`${s}T00:00:00.000Z`);
export const monthOf = (d: Date): string => d.toISOString().slice(0, 7);

/** The month (or the quarter starting at that month) as Algiers days and instants. */
export function runPeriod(month: string, kind: IncentivePeriod): RunPeriod {
  const [y, m] = month.split('-').map(Number) as [number, number];
  if (kind === IncentivePeriod.QUARTER && (m - 1) % 3 !== 0) {
    throw new AppException(ErrorCode.VALIDATION_FAILED, 'A quarter starts in Jan, Apr, Jul or Oct', {
      issues: [{ path: 'period', message: 'not_quarter_start' }],
    });
  }
  const count = kind === IncentivePeriod.QUARTER ? 3 : 1;
  const months = Array.from({ length: count }, (_, i) => {
    const mm = m + i;
    return `${y}-${String(mm).padStart(2, '0')}`;
  });
  const last = months.at(-1)!;
  const [ly, lm] = last.split('-').map(Number) as [number, number];
  const firstDay = `${month}-01`;
  const lastDay = `${last}-${String(daysInMonth(ly, lm)).padStart(2, '0')}`;
  return { months, firstDay, lastDay, ...algiersRange(firstDay, lastDay) };
}

/** Team rules are measured on the manager's whole subtree, against the team target. */
export function isTeamRule(rule: { appliesTo: string; params: IncentiveRuleParams }): boolean {
  return (
    rule.appliesTo === IncentiveAppliesTo.TEAM_MANAGER ||
    rule.params.type === IncentiveRuleType.MANAGER_OVERRIDE
  );
}

export function ruleAppliesTo(
  rule: { appliesTo: string; roleOrUserId: string },
  user: { id: string; role: string },
): boolean {
  return rule.appliesTo === IncentiveAppliesTo.ROLE
    ? rule.roleOrUserId === user.role
    : rule.roleOrUserId === user.id;
}

/**
 * Refuses a change to a period whose bonuses are approved (any plan): its figures and
 * targets are frozen. `from` / `to` are Algiers days, inclusive.
 */
export async function assertPeriodOpen(db: Db, from: string, to: string): Promise<void> {
  const approved = await db.incentiveRun.findFirst({
    where: {
      status: { in: ['APPROVED', 'EXPORTED'] },
      periodStart: { lte: fromDay(to) },
      periodEnd: { gte: fromDay(from) },
    },
    select: { id: true, periodStart: true },
  });
  if (approved) {
    throw new AppException(ErrorCode.PERIOD_APPROVED, 'The bonuses of this period are approved', {
      runId: approved.id,
      period: monthOf(approved.periodStart),
    });
  }
}

/** The brands / categories / products a scope names must be this tenant's. */
export async function assertScope(db: Db, scope: MetricScope | null | undefined): Promise<void> {
  if (!scope) return;
  const checks: Promise<unknown>[] = [];
  if (scope.brandId) checks.push(db.brand.findFirst({ where: { id: scope.brandId }, select: { id: true } }));
  if (scope.categoryId) {
    checks.push(db.category.findFirst({ where: { id: scope.categoryId }, select: { id: true } }));
  }
  if (scope.productId) {
    checks.push(db.product.findFirst({ where: { id: scope.productId }, select: { id: true } }));
  }
  if ((await Promise.all(checks)).some((r) => !r)) {
    throw new AppException(ErrorCode.NOT_FOUND, 'Scope not found', { scope });
  }
}

/** "Marque X · Produit Y" labels, by scopeKey. */
export async function scopeLabels(
  db: Db,
  scopes: readonly (MetricScope | null | undefined)[],
): Promise<Map<string, string>> {
  const ids = (k: keyof MetricScope) => [
    ...new Set(scopes.map((s) => s?.[k]).filter((v): v is string => !!v)),
  ];
  const [brands, categories, products] = await Promise.all([
    db.brand.findMany({ where: { id: { in: ids('brandId') } }, select: { id: true, name: true } }),
    db.category.findMany({
      where: { id: { in: ids('categoryId') } },
      select: { id: true, name: true },
    }),
    db.product.findMany({
      where: { id: { in: ids('productId') } },
      select: { id: true, designation: true },
    }),
  ]);
  const names = new Map<string, string>([
    ...brands.map((b) => [b.id, b.name] as const),
    ...categories.map((c) => [c.id, c.name] as const),
    ...products.map((p) => [p.id, p.designation] as const),
  ]);
  const out = new Map<string, string>();
  for (const s of scopes) {
    if (!s) continue;
    const label = [s.brandId, s.categoryId, s.productId]
      .filter((v): v is string => !!v)
      .map((id) => names.get(id) ?? '?')
      .join(' · ');
    out.set(scopeKey(s), label);
  }
  return out;
}

/** The scope stored on a target row. */
export function scopeOfTarget(t: {
  brandId: string | null;
  categoryId: string | null;
  productId: string | null;
}): MetricScope | null {
  if (!t.brandId && !t.categoryId && !t.productId) return null;
  return {
    ...(t.brandId ? { brandId: t.brandId } : {}),
    ...(t.categoryId ? { categoryId: t.categoryId } : {}),
    ...(t.productId ? { productId: t.productId } : {}),
  };
}

export const requireTenant = (): string => tenantContext.requireTenantId();

export type TargetRow = Prisma.SalesTargetGetPayload<object>;
