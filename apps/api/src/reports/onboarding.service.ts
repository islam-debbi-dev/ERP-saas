import { Injectable } from '@nestjs/common';
import { type OnboardingStatus, type OnboardingStepKey } from '@erp/shared';
import { tenantContext } from '../common/tenant-context';
import { PrismaService } from '../prisma/prisma.service';

/**
 * The first-week checklist on the dashboard (phase 13): each step is read from the data
 * itself, so it ticks as soon as the work is done, whatever screen it was done on.
 */
@Injectable()
export class OnboardingService {
  constructor(private readonly prisma: PrismaService) {}

  async status(): Promise<OnboardingStatus> {
    const tenantId = tenantContext.requireTenantId();
    const [row] = await this.prisma.db.$queryRaw<
      {
        companyInfo: boolean;
        products: boolean;
        clientBalances: boolean;
        users: boolean;
        firstSale: boolean;
        dismissed: boolean;
      }[]
    >`
      SELECT
        (btrim(t."raisonSociale") <> '' AND btrim(coalesce(t.adresse, '')) <> ''
          AND (btrim(coalesce(t.nif, '')) <> '' OR btrim(coalesce(t.rc, '')) <> '')) AS "companyInfo",
        EXISTS (SELECT 1 FROM products p WHERE p."tenantId" = t.id AND p."deletedAt" IS NULL) AS products,
        EXISTS (SELECT 1 FROM client_ledger_entries l
                WHERE l."tenantId" = t.id AND l.type = 'OPENING') AS "clientBalances",
        ((SELECT count(*) FROM users u WHERE u."tenantId" = t.id AND u."deletedAt" IS NULL) > 1
          OR EXISTS (SELECT 1 FROM user_invitations i WHERE i."tenantId" = t.id)) AS users,
        EXISTS (SELECT 1 FROM sales s WHERE s."tenantId" = t.id) AS "firstSale",
        t."onboardingDismissedAt" IS NOT NULL AS dismissed
      FROM tenants t WHERE t.id = ${tenantId}::uuid`;
    const done = (key: OnboardingStepKey) => Boolean(row?.[key]);
    const steps = (
      ['companyInfo', 'products', 'clientBalances', 'users', 'firstSale'] as const
    ).map((key) => ({ key, done: done(key) }));
    return {
      steps,
      completed: steps.every((s) => s.done),
      dismissed: Boolean(row?.dismissed),
    };
  }
}
