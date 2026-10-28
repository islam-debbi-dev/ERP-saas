import { Injectable } from '@nestjs/common';
import {
  algiersDay,
  daysUntil,
  effectiveSubscriptionStatus,
  ErrorCode,
  graceEndsAt,
  monthToDate,
  type PlanInfo,
  type PlanUsage,
  type StoredSubscriptionStatus,
  type SubscriptionPaymentInfo,
  SubscriptionStatus,
  type SubscriptionSummary,
  TRIAL_DAYS,
} from '@erp/shared';
import { algiersMidnight } from '../common/algiers';
import { AppException } from '../common/app-exception';
import { tenantContext } from '../common/tenant-context';
import { ClockService } from '../clock/clock.service';
import type { Plan } from '../generated/prisma/client';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import { TRIAL_PLAN_CODE } from './plans';

const DAY_MS = 24 * 3600 * 1000;

/** What the plan limits apply to. Documents per month is a soft limit (warning only). */
export type LimitedResource = 'users' | 'products';

export interface LoadedSubscription {
  plan: Plan;
  status: StoredSubscriptionStatus;
  isFree: boolean;
  trialEndsAt: Date | null;
  currentPeriodEnd: Date;
}

type Db = Pick<Tx, 'subscription' | 'plan' | 'tenant' | '$queryRaw'>;

export function toPlanInfo(plan: Plan): PlanInfo {
  return {
    id: plan.id,
    code: plan.code,
    name: plan.name,
    monthlyPrice: plan.monthlyPrice.toFixed(2),
    maxUsers: plan.maxUsers,
    maxProducts: plan.maxProducts,
    maxDocumentsPerMonth: plan.maxDocumentsPerMonth,
  };
}

/**
 * Plans, trial and the subscription status of a tenant (phase 13). The status is derived
 * from the dates at each call (packages/shared/subscription.ts): nothing has to run on a
 * schedule for a trial to expire.
 */
@Injectable()
export class BillingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockService,
  ) {}

  now(): Date {
    return this.clock.now();
  }

  /** A 30-day trial on the trial plan, inside the registration transaction. */
  async createTrial(tx: Tx, tenantId: string): Promise<void> {
    const plan = await tx.plan.findUniqueOrThrow({ where: { code: TRIAL_PLAN_CODE } });
    const end = new Date(this.now().getTime() + TRIAL_DAYS * DAY_MS);
    await tx.subscription.create({
      data: { tenantId, planId: plan.id, status: 'TRIAL', trialEndsAt: end, currentPeriodEnd: end },
    });
  }

  /**
   * The tenant's subscription. A tenant registered by the previous release during a
   * deploy has none yet: it is read as a trial counted from the tenant's creation.
   */
  async load(db: Db, tenantId: string): Promise<LoadedSubscription> {
    const sub = await db.subscription.findUnique({ where: { tenantId }, include: { plan: true } });
    if (sub) return sub;
    const tenant = await db.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { createdAt: true },
    });
    const end = new Date(tenant.createdAt.getTime() + TRIAL_DAYS * DAY_MS);
    return {
      plan: await db.plan.findUniqueOrThrow({ where: { code: TRIAL_PLAN_CODE } }),
      status: 'TRIAL',
      isFree: false,
      trialEndsAt: end,
      currentPeriodEnd: end,
    };
  }

  async statusOf(tenantId: string): Promise<SubscriptionStatus> {
    return effectiveSubscriptionStatus(await this.load(this.prisma.db, tenantId), this.now());
  }

  /**
   * Called by the auth guard on every write. A SUSPENDED tenant keeps reading and
   * exporting its data, but cannot create or change anything.
   */
  async assertWritable(tenantId: string): Promise<void> {
    if ((await this.statusOf(tenantId)) === SubscriptionStatus.SUSPENDED) {
      throw new AppException(
        ErrorCode.SUBSCRIPTION_SUSPENDED,
        'Subscription suspended: your data stays readable, renew to make changes',
      );
    }
  }

  /**
   * Refuses to go over the plan's user or product limit. Locks the tenant's subscription
   * row first, so two concurrent creations cannot both take the last slot. `count` is
   * the caller's own count (the module that owns the table).
   */
  async assertCanAdd(
    tx: Tx,
    resource: LimitedResource,
    adding: number,
    count: () => Promise<number>,
  ): Promise<void> {
    if (adding <= 0) return;
    const tenantId = tenantContext.requireTenantId();
    await tx.$queryRaw`SELECT id FROM subscriptions WHERE "tenantId" = ${tenantId}::uuid FOR UPDATE`;
    const sub = await this.load(tx, tenantId);
    if (sub.isFree) return;
    const limit = resource === 'users' ? sub.plan.maxUsers : sub.plan.maxProducts;
    if (limit === null) return;
    const current = await count();
    if (current + adding > limit) {
      throw new AppException(
        ErrorCode.PLAN_LIMIT_REACHED,
        `Your plan allows ${limit} ${resource}`,
        {
          resource,
          limit,
          current,
          plan: sub.plan.name,
        },
      );
    }
  }

  /**
   * Usage counters (a read model over other modules' tables, like the reports module).
   * Raw SQL is not rewritten by the tenant extension, so tenantId is explicit.
   */
  async usage(tenantId: string): Promise<PlanUsage> {
    const monthStart = algiersMidnight(monthToDate(algiersDay(this.now())).from);
    const [row] = await this.prisma.db.$queryRaw<
      { users: bigint; products: bigint; documents: bigint }[]
    >`
      SELECT
        (SELECT count(*) FROM users WHERE "tenantId" = ${tenantId}::uuid AND "deletedAt" IS NULL) AS users,
        (SELECT count(*) FROM products WHERE "tenantId" = ${tenantId}::uuid AND "deletedAt" IS NULL) AS products,
        (SELECT count(*) FROM sales WHERE "tenantId" = ${tenantId}::uuid AND "createdAt" >= ${monthStart}) AS documents`;
    return {
      users: Number(row?.users ?? 0),
      products: Number(row?.products ?? 0),
      documentsThisMonth: Number(row?.documents ?? 0),
    };
  }

  /** Status, plan, usage and payments. Used by the tenant and by the super-admin. */
  async summary(tenantId: string): Promise<SubscriptionSummary> {
    const now = this.now();
    const sub = await this.load(this.prisma.db, tenantId);
    const status = effectiveSubscriptionStatus(sub, now);
    const grace = graceEndsAt(sub.currentPeriodEnd);
    const [usage, payments] = await Promise.all([
      this.usage(tenantId),
      this.prisma.db.subscriptionPayment.findMany({
        where: { tenantId },
        orderBy: { createdAt: 'desc' },
        take: 24,
      }),
    ]);
    const maxDocs = sub.plan.maxDocumentsPerMonth;
    return {
      plan: toPlanInfo(sub.plan),
      status,
      storedStatus: sub.status,
      isFree: sub.isFree,
      currentPeriodEnd: sub.currentPeriodEnd.toISOString(),
      graceEndsAt: grace.toISOString(),
      daysLeft: daysUntil(
        status === SubscriptionStatus.PAST_DUE ? grace : sub.currentPeriodEnd,
        now,
      ),
      usage,
      docsOverLimit: !sub.isFree && maxDocs !== null && usage.documentsThisMonth > maxDocs,
      payments: payments.map((p): SubscriptionPaymentInfo => ({
        id: p.id,
        amount: p.amount.toFixed(2),
        method: p.method,
        reference: p.reference,
        months: p.months,
        periodFrom: p.periodFrom.toISOString(),
        periodTo: p.periodTo.toISOString(),
        createdAt: p.createdAt.toISOString(),
      })),
    };
  }
}
