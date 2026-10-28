import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  type AdminTenantDetail,
  type AdminTenantRow,
  type AdminTenantsQuery,
  effectiveSubscriptionStatus,
  ErrorCode,
  type ImpersonationResponse,
  type RecordSubscriptionPaymentInput,
  Role,
  type SubscriptionSummary,
  type UpdateSubscriptionInput,
} from '@erp/shared';
import { AuditService } from '../audit/audit.service';
import type { AccessTokenPayload } from '../auth/auth.types';
import { BillingService } from '../billing/billing.service';
import { AppException } from '../common/app-exception';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { CurrentAdminInfo } from './admin.types';
import { PlatformAuditService } from './platform-audit.service';

/** A read-only view lasts 30 minutes and is never refreshed. */
export const IMPERSONATION_TTL_SECONDS = 30 * 60;

/**
 * The super-admin's work on tenants: list, detail, record a payment, change the
 * subscription, open a read-only view. Runs in the system context (AdminAuthGuard), so
 * every query names its tenant. Each action goes to the platform audit log, and the
 * ones that touch a tenant also to that tenant's own journal.
 */
@Injectable()
export class AdminTenantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly billing: BillingService,
    private readonly audit: AuditService,
    private readonly platformAudit: PlatformAuditService,
    private readonly jwt: JwtService,
  ) {}

  async list(query: AdminTenantsQuery): Promise<AdminTenantRow[]> {
    const now = this.billing.now();
    const [usage, subs] = await Promise.all([
      this.billing.usageOfAll(),
      this.prisma.db.subscription.findMany({ include: { plan: true } }),
    ]);
    const subByTenant = new Map(subs.map((s) => [s.tenantId, s]));
    const rows: AdminTenantRow[] = [];
    for (const [id, u] of usage) {
      const sub = subByTenant.get(id) ?? (await this.billing.load(this.prisma.db, id));
      rows.push({
        id,
        name: u.name,
        planName: sub.plan.name,
        status: effectiveSubscriptionStatus(sub, now),
        isFree: sub.isFree,
        currentPeriodEnd: sub.currentPeriodEnd.toISOString(),
        usage: { users: u.users, products: u.products, documentsThisMonth: u.documentsThisMonth },
        createdAt: u.createdAt.toISOString(),
        lastActivityAt: u.lastActivityAt?.toISOString() ?? null,
      });
    }
    const q = query.q?.toLowerCase();
    return rows
      .filter((r) => !query.status || r.status === query.status)
      .filter((r) => !q || r.name.toLowerCase().includes(q))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async detail(tenantId: string): Promise<AdminTenantDetail> {
    const tenant = await this.prisma.db.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new AppException(ErrorCode.NOT_FOUND, 'Tenant not found');
    const [summary, owner, activity, plans] = await Promise.all([
      this.billing.summary(tenantId),
      this.owner(tenantId),
      this.prisma.db.session.aggregate({ where: { tenantId }, _max: { lastUsedAt: true } }),
      this.billing.plans(),
    ]);
    return {
      ...summary,
      id: tenant.id,
      name: tenant.name,
      raisonSociale: tenant.raisonSociale,
      telephone: tenant.telephone,
      owner: owner && { fullName: owner.fullName, email: owner.email, phone: owner.phone },
      createdAt: tenant.createdAt.toISOString(),
      lastActivityAt: activity._max.lastUsedAt?.toISOString() ?? null,
      plans,
    };
  }

  /**
   * Records a manual payment and extends the period, in one transaction. The
   * Idempotency-Key makes a double click or a retried request record it once.
   */
  async recordPayment(
    admin: CurrentAdminInfo,
    tenantId: string,
    input: RecordSubscriptionPaymentInput,
    idempotencyKey: string,
  ): Promise<{ summary: SubscriptionSummary; replayed: boolean }> {
    await this.requireTenant(tenantId);
    const replay = await this.replayed(tenantId, idempotencyKey);
    if (replay) return replay;
    try {
      await this.prisma.db.$transaction(async (tx) => {
        const change = await this.billing.recordPayment(
          tx,
          tenantId,
          admin.id,
          input,
          idempotencyKey,
        );
        const detail = {
          paymentId: change.payment.id,
          amount: input.amount,
          method: input.method,
          months: input.months,
          reference: input.reference,
          before: change.before,
          after: change.after,
        };
        await this.platformAudit.log(tx, {
          adminId: admin.id,
          sessionId: admin.sessionId,
          tenantId,
          action: 'SUBSCRIPTION_PAYMENT_RECORDED',
          detail,
        });
        await this.audit.log(tx, {
          tenantId,
          userId: null,
          action: 'SUBSCRIPTION_PAYMENT_RECORDED',
          entity: 'Subscription',
          entityId: change.payment.id,
          before: change.before,
          after: { ...change.after, amount: input.amount, method: input.method, by: admin.email },
        });
      });
    } catch (err) {
      // The same key sent twice at once: the unique key let one through.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const again = await this.replayed(tenantId, idempotencyKey);
        if (again) return again;
      }
      throw err;
    }
    return { summary: await this.billing.summary(tenantId), replayed: false };
  }

  async updateSubscription(
    admin: CurrentAdminInfo,
    tenantId: string,
    input: UpdateSubscriptionInput,
  ): Promise<SubscriptionSummary> {
    await this.requireTenant(tenantId);
    await this.prisma.db.$transaction(async (tx) => {
      const change = await this.billing.update(tx, tenantId, input);
      await this.platformAudit.log(tx, {
        adminId: admin.id,
        sessionId: admin.sessionId,
        tenantId,
        action: 'SUBSCRIPTION_UPDATED',
        detail: { input, before: change.before, after: change.after },
      });
      await this.audit.log(tx, {
        tenantId,
        userId: null,
        action: 'SUBSCRIPTION_UPDATED',
        entity: 'Subscription',
        entityId: tenantId,
        before: change.before,
        after: { ...change.after, by: admin.email },
      });
    });
    return this.billing.summary(tenantId);
  }

  /**
   * A 30-minute read-only token on the tenant, as its OWNER. Every write is refused
   * (IMPERSONATION_READ_ONLY) and every request is logged; the tenant's journal shows
   * that support opened its data.
   */
  async impersonate(admin: CurrentAdminInfo, tenantId: string): Promise<ImpersonationResponse> {
    const tenant = await this.requireTenant(tenantId);
    const owner = await this.owner(tenantId);
    if (!owner) throw new AppException(ErrorCode.NOT_FOUND, 'This company has no owner');
    await this.prisma.db.$transaction(async (tx) => {
      await this.platformAudit.log(tx, {
        adminId: admin.id,
        sessionId: admin.sessionId,
        tenantId,
        action: 'IMPERSONATION_STARTED',
        detail: { ownerId: owner.id },
      });
      await this.audit.log(tx, {
        tenantId,
        userId: null,
        action: 'ADMIN_IMPERSONATION_STARTED',
        entity: 'Tenant',
        entityId: tenantId,
        after: { by: admin.email, readOnly: true, minutes: IMPERSONATION_TTL_SECONDS / 60 },
      });
    });
    const payload: AccessTokenPayload = {
      sub: owner.id,
      tid: tenantId,
      sid: admin.sessionId,
      role: Role.OWNER,
      typ: 'imp',
      adm: admin.id,
    };
    return {
      accessToken: await this.jwt.signAsync(payload, { expiresIn: IMPERSONATION_TTL_SECONDS }),
      expiresIn: IMPERSONATION_TTL_SECONDS,
      tenantName: tenant.name,
    };
  }

  private async replayed(
    tenantId: string,
    idempotencyKey: string,
  ): Promise<{ summary: SubscriptionSummary; replayed: boolean } | null> {
    const existing = await this.prisma.db.subscriptionPayment.findUnique({
      where: { idempotencyKey },
    });
    if (!existing) return null;
    if (existing.tenantId !== tenantId) {
      throw new AppException(
        ErrorCode.CONFLICT,
        'This Idempotency-Key was used for another company',
      );
    }
    return { summary: await this.billing.summary(tenantId), replayed: true };
  }

  private async requireTenant(tenantId: string) {
    const tenant = await this.prisma.db.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new AppException(ErrorCode.NOT_FOUND, 'Tenant not found');
    return tenant;
  }

  private owner(tenantId: string) {
    return this.prisma.db.user.findFirst({
      where: { tenantId, role: Role.OWNER, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
  }
}
