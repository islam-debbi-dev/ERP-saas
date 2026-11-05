import { Injectable } from '@nestjs/common';
import {
  algiersDay,
  type Edition,
  EDITION_FEATURES,
  type EditionInfo,
  effectiveFeatures,
  FEATURES,
  type Feature,
  daysUntil,
  effectiveSubscriptionStatus,
  ErrorCode,
  extendPeriod,
  graceEndsAt,
  monthToDate,
  type PlanInfo,
  type PlanUsage,
  type RecordSubscriptionPaymentInput,
  type StoredSubscriptionStatus,
  type SubscriptionPaymentInfo,
  SubscriptionStatus,
  type SubscriptionSummary,
  TRIAL_DAYS,
  type UpdateSubscriptionInput,
} from '@erp/shared';
import { algiersMidnight } from '../common/algiers';
import { AppException } from '../common/app-exception';
import { tenantContext } from '../common/tenant-context';
import { ClockService } from '../clock/clock.service';
import type { EditionPrice, Plan, SubscriptionPayment } from '../generated/prisma/client';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import { TRIAL_PLAN_CODE } from './plans';

const DAY_MS = 24 * 3600 * 1000;

/** What the plan limits apply to. Documents per month is a soft limit (warning only). */
export type LimitedResource = 'users' | 'products';

export interface LoadedSubscription {
  plan: Plan;
  edition: Edition;
  status: StoredSubscriptionStatus;
  isFree: boolean;
  trialEndsAt: Date | null;
  currentPeriodEnd: Date;
}

type Db = Pick<Tx, 'subscription' | 'plan' | 'tenant' | '$queryRaw'>;

/** Only known module names: a stored list may hold a feature removed from the code. */
function knownFeatures(list: readonly string[]): Feature[] {
  return FEATURES.filter((f) => list.includes(f));
}

/** Plain values for the audit log's before/after. */
function snapshot(
  sub: LoadedSubscription,
  tenant: { featureGrants: string[]; featureRevokes: string[] },
) {
  return {
    plan: sub.plan.code,
    edition: sub.edition,
    featureGrants: tenant.featureGrants,
    featureRevokes: tenant.featureRevokes,
    status: sub.status,
    isFree: sub.isFree,
    currentPeriodEnd: sub.currentPeriodEnd.toISOString(),
  };
}

export interface SubscriptionChange {
  before: ReturnType<typeof snapshot>;
  after: ReturnType<typeof snapshot>;
}

export function toPlanInfo(plan: Plan): PlanInfo {
  return {
    id: plan.id,
    code: plan.code,
    name: plan.name,
    monthlyPrice: plan.monthlyPrice.toFixed(2),
    maxUsers: plan.maxUsers,
    maxProducts: plan.maxProducts,
    maxDocumentsPerMonth: plan.maxDocumentsPerMonth,
    maxMobileSellers: plan.maxMobileSellers,
  };
}

export function toEditionInfo(
  row: Pick<EditionPrice, 'edition' | 'monthlySupplement'>,
): EditionInfo {
  return {
    edition: row.edition,
    monthlySupplement: row.monthlySupplement.toFixed(2),
    features: [...EDITION_FEATURES[row.edition]],
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

  /**
   * A 30-day trial on the trial plan and the edition picked from the company's activity,
   * inside the registration transaction.
   */
  async createTrial(tx: Tx, tenantId: string, edition: Edition): Promise<void> {
    const plan = await tx.plan.findUniqueOrThrow({ where: { code: TRIAL_PLAN_CODE } });
    const end = new Date(this.now().getTime() + TRIAL_DAYS * DAY_MS);
    await tx.subscription.create({
      data: {
        tenantId,
        planId: plan.id,
        edition,
        status: 'TRIAL',
        trialEndsAt: end,
        currentPeriodEnd: end,
      },
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
      edition: 'ESSENTIEL',
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

  /** Usage of every tenant in one query, for the super-admin list. */
  async usageOfAll(): Promise<
    Map<string, PlanUsage & { lastActivityAt: Date | null; name: string; createdAt: Date }>
  > {
    const monthStart = algiersMidnight(monthToDate(algiersDay(this.now())).from);
    const rows = await this.prisma.db.$queryRaw<
      {
        id: string;
        name: string;
        createdAt: Date;
        users: bigint;
        products: bigint;
        documents: bigint;
        lastActivityAt: Date | null;
      }[]
    >`
      SELECT t.id, t.name, t."createdAt",
        (SELECT count(*) FROM users u WHERE u."tenantId" = t.id AND u."deletedAt" IS NULL) AS users,
        (SELECT count(*) FROM products p WHERE p."tenantId" = t.id AND p."deletedAt" IS NULL) AS products,
        (SELECT count(*) FROM sales s WHERE s."tenantId" = t.id AND s."createdAt" >= ${monthStart}) AS documents,
        (SELECT max(se."lastUsedAt") FROM sessions se WHERE se."tenantId" = t.id) AS "lastActivityAt"
      FROM tenants t`;
    return new Map(
      rows.map((r) => [
        r.id,
        {
          name: r.name,
          createdAt: r.createdAt,
          users: Number(r.users),
          products: Number(r.products),
          documentsThisMonth: Number(r.documents),
          lastActivityAt: r.lastActivityAt,
        },
      ]),
    );
  }

  /** Status, plan, usage and payments. Used by the tenant and by the super-admin. */
  /** Assistant questions per month of the company's plan (phase 30). null = unlimited. */
  async aiQuestionsPerMonth(tenantId: string): Promise<number | null> {
    const sub = await this.prisma.db.subscription.findUnique({
      where: { tenantId },
      select: { plan: { select: { aiQuestionsPerMonth: true } } },
    });
    return sub?.plan.aiQuestionsPerMonth ?? null;
  }

  async summary(tenantId: string): Promise<SubscriptionSummary> {
    const now = this.now();
    const sub = await this.load(this.prisma.db, tenantId);
    const status = effectiveSubscriptionStatus(sub, now);
    const grace = graceEndsAt(sub.currentPeriodEnd);
    const [usage, payments, tenant, editionPrice] = await Promise.all([
      this.usage(tenantId),
      this.prisma.db.subscriptionPayment.findMany({
        where: { tenantId },
        orderBy: { createdAt: 'desc' },
        take: 24,
      }),
      this.prisma.db.tenant.findUniqueOrThrow({
        where: { id: tenantId },
        select: { featureGrants: true, featureRevokes: true },
      }),
      this.prisma.db.editionPrice.findUnique({ where: { edition: sub.edition } }),
    ]);
    const maxDocs = sub.plan.maxDocumentsPerMonth;
    return {
      plan: toPlanInfo(sub.plan),
      // No price row: the edition was added in code before its row (supplement 0).
      edition: editionPrice
        ? toEditionInfo(editionPrice)
        : {
            edition: sub.edition,
            monthlySupplement: '0.00',
            features: [...EDITION_FEATURES[sub.edition]],
          },
      featureGrants: knownFeatures(tenant.featureGrants),
      featureRevokes: knownFeatures(tenant.featureRevokes),
      features: effectiveFeatures(sub.edition, tenant.featureGrants, tenant.featureRevokes),
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

  /**
   * Makes sure the row exists (a tenant from the deploy window has none), then locks it.
   * Every change of a subscription goes through here, inside the caller's transaction.
   */
  private async lockForUpdate(tx: Tx, tenantId: string): Promise<LoadedSubscription> {
    const virtual = await this.load(tx, tenantId);
    await tx.subscription.upsert({
      where: { tenantId },
      update: {},
      create: {
        tenantId,
        planId: virtual.plan.id,
        edition: virtual.edition,
        status: virtual.status,
        isFree: virtual.isFree,
        trialEndsAt: virtual.trialEndsAt,
        currentPeriodEnd: virtual.currentPeriodEnd,
      },
    });
    await tx.$queryRaw`SELECT id FROM subscriptions WHERE "tenantId" = ${tenantId}::uuid FOR UPDATE`;
    return this.load(tx, tenantId);
  }

  /**
   * A payment recorded by the super-admin (BaridiMob, virement, espèces): the period is
   * extended by `months` from its end, or from now when it already ended, and the
   * subscription becomes ACTIVE. Replays of the same key are handled by the caller.
   */
  async recordPayment(
    tx: Tx,
    tenantId: string,
    adminId: string,
    input: RecordSubscriptionPaymentInput,
    idempotencyKey: string,
  ): Promise<SubscriptionChange & { payment: SubscriptionPayment }> {
    const before = await this.lockForUpdate(tx, tenantId);
    const modules = await this.modulesOf(tx, tenantId);
    const period = extendPeriod(before.currentPeriodEnd, input.months, this.now());
    await tx.subscription.update({
      where: { tenantId },
      data: { status: 'ACTIVE', currentPeriodEnd: period.to },
    });
    const payment = await tx.subscriptionPayment.create({
      data: {
        tenantId,
        amount: input.amount,
        method: input.method,
        reference: input.reference,
        months: input.months,
        periodFrom: period.from,
        periodTo: period.to,
        planId: before.plan.id,
        adminId,
        idempotencyKey,
      },
    });
    const after = await this.load(tx, tenantId);
    return { before: snapshot(before, modules), after: snapshot(after, modules), payment };
  }

  /**
   * Change plan or edition, grant or revoke modules, switch free (pilot) on or off, or
   * give more trial days. The caller clears the features cache after commit.
   */
  async update(
    tx: Tx,
    tenantId: string,
    input: UpdateSubscriptionInput,
  ): Promise<SubscriptionChange> {
    const before = await this.lockForUpdate(tx, tenantId);
    const modulesBefore = await this.modulesOf(tx, tenantId);
    const data: {
      planId?: string;
      edition?: Edition;
      isFree?: boolean;
      trialEndsAt?: Date;
      currentPeriodEnd?: Date;
    } = {};
    if (input.planId !== undefined) {
      const plan = await tx.plan.findUnique({ where: { id: input.planId } });
      if (!plan || !plan.active) throw new AppException(ErrorCode.NOT_FOUND, 'Plan not found');
      data.planId = plan.id;
    }
    if (input.edition !== undefined) data.edition = input.edition;
    if (input.isFree !== undefined) data.isFree = input.isFree;
    if (input.extendTrialDays !== undefined) {
      if (before.status !== 'TRIAL') {
        throw new AppException(ErrorCode.VALIDATION_FAILED, 'Only a trial can be extended', {
          field: 'extendTrialDays',
          rule: 'not_trial',
        });
      }
      const from = Math.max(before.currentPeriodEnd.getTime(), this.now().getTime());
      const end = new Date(from + input.extendTrialDays * DAY_MS);
      data.trialEndsAt = end;
      data.currentPeriodEnd = end;
    }
    await tx.subscription.update({ where: { tenantId }, data });
    if (input.featureGrants !== undefined || input.featureRevokes !== undefined) {
      const featureGrants = input.featureGrants ?? modulesBefore.featureGrants;
      const featureRevokes = input.featureRevokes ?? modulesBefore.featureRevokes;
      if (featureGrants.some((f) => featureRevokes.includes(f))) {
        throw new AppException(
          ErrorCode.VALIDATION_FAILED,
          'A module cannot be granted and revoked',
          { field: 'featureRevokes', rule: 'grant_and_revoke' },
        );
      }
      await tx.tenant.update({ where: { id: tenantId }, data: { featureGrants, featureRevokes } });
    }
    const after = await this.load(tx, tenantId);
    const modulesAfter = await this.modulesOf(tx, tenantId);
    return { before: snapshot(before, modulesBefore), after: snapshot(after, modulesAfter) };
  }

  private modulesOf(db: Db, tenantId: string) {
    return db.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { featureGrants: true, featureRevokes: true },
    });
  }

  /** Every edition with its supplement, in menu order. */
  async editions(): Promise<EditionInfo[]> {
    const rows = await this.prisma.db.editionPrice.findMany({ orderBy: { sortOrder: 'asc' } });
    return rows.map(toEditionInfo);
  }

  /** Active plans, cheapest first. */
  async plans(): Promise<PlanInfo[]> {
    const plans = await this.prisma.db.plan.findMany({
      where: { active: true },
      orderBy: { sortOrder: 'asc' },
    });
    return plans.map(toPlanInfo);
  }
}
