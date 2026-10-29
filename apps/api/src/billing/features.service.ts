import { Injectable } from '@nestjs/common';
import { Edition, effectiveFeatures, type Feature } from '@erp/shared';
import { ClockService } from '../clock/clock.service';
import { PrismaService } from '../prisma/prisma.service';

/** How long a tenant's modules are kept in memory. A plan change shows within this delay. */
export const FEATURES_TTL_MS = 60_000;

export interface TenantFeatures {
  edition: Edition;
  features: Feature[];
}

/**
 * The modules a tenant has (phase 13b): its edition, plus the super-admin's grants,
 * minus his revokes. Read on each request through a short in-memory cache, never put in
 * the JWT, so a change applies without logging in again. The super-admin's change clears
 * the entry at once in this process; other API instances see it within the TTL.
 */
@Injectable()
export class FeaturesService {
  private readonly cache = new Map<string, TenantFeatures & { expiresAt: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockService,
  ) {}

  async of(tenantId: string): Promise<TenantFeatures> {
    const now = this.clock.now().getTime();
    const hit = this.cache.get(tenantId);
    if (hit && hit.expiresAt > now) return { edition: hit.edition, features: hit.features };

    const [tenant, sub] = await Promise.all([
      this.prisma.db.tenant.findUniqueOrThrow({
        where: { id: tenantId },
        select: { featureGrants: true, featureRevokes: true },
      }),
      this.prisma.db.subscription.findUnique({ where: { tenantId }, select: { edition: true } }),
    ]);
    // No subscription yet (registered by the previous release during a deploy): core only.
    const edition = sub?.edition ?? Edition.ESSENTIEL;
    const value = {
      edition,
      features: effectiveFeatures(edition, tenant.featureGrants, tenant.featureRevokes),
    };
    this.cache.set(tenantId, { ...value, expiresAt: now + FEATURES_TTL_MS });
    return value;
  }

  invalidate(tenantId: string): void {
    this.cache.delete(tenantId);
  }
}
