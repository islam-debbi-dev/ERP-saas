import { Injectable } from '@nestjs/common';
import {
  ErrorCode,
  normalizeDecimal,
  Role,
  parseDA,
  type TenantSettingsResponse,
  toMoneyString,
  type UpdateTenantSettingsInput,
} from '@erp/shared';
import { AuditService } from '../audit/audit.service';
import type { CurrentUserInfo } from '../auth/auth.types';
import { AppException } from '../common/app-exception';
import { CatalogService } from '../catalog/catalog.service';
import { tenantContext } from '../common/tenant-context';
import { type Tenant } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { readTranches } from './timbre-rule';

function toResponse(t: Tenant): TenantSettingsResponse {
  return {
    tenantId: t.id,
    name: t.name,
    updatedAt: t.updatedAt.toISOString(),
    raisonSociale: t.raisonSociale,
    adresse: t.adresse,
    telephone: t.telephone,
    rc: t.rc,
    nif: t.nif,
    nis: t.nis,
    ai: t.ai,
    rib: t.rib,
    assujettiTva: t.assujettiTva,
    creditLimitMode: t.creditLimitMode,
    negativeStockMode: t.negativeStockMode,
    priceLevelCount: t.priceLevelCount,
    maxDiscountPct: toMoneyString(t.maxDiscountPct.toString()),
    reminderDays: t.reminderDays,
    sellerScope: t.sellerScope,
    zoneIncludesAssigned: t.zoneIncludesAssigned,
    livreurScope: t.livreurScope,
    geoCheckMode: t.geoCheckMode,
    geoRadiusM: t.geoRadiusM,
    geoMaxAccuracyM: t.geoMaxAccuracyM,
    timbreEnabled: t.timbreEnabled,
    timbreTranches: readTranches(t.timbreTranches),
    timbreMin: t.timbreMin ? toMoneyString(t.timbreMin) : null,
    timbreMax: t.timbreMax ? toMoneyString(t.timbreMax) : null,
    timbreThreshold: t.timbreThreshold ? toMoneyString(t.timbreThreshold) : null,
    cashCountAlertThreshold: toMoneyString(t.cashCountAlertThreshold.toString()),
    monthlySalesTarget: t.monthlySalesTarget
      ? toMoneyString(t.monthlySalesTarget.toString())
      : null,
    defaultPrintFormat: t.defaultPrintFormat,
    documentFooter: t.documentFooter,
    tvaMention: t.tvaMention,
  };
}

/** `"1 500,00"` → `"1500.00"`; null stays null; undefined means "not changed". */
function normalizeAmount(v: string | null | undefined): string | null | undefined {
  if (v === undefined || v === null) return v;
  const parsed = parseDA(v);
  return parsed ? parsed.toString() : null;
}

@Injectable()
export class TenantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly catalog: CatalogService,
  ) {}

  async getSettings(): Promise<TenantSettingsResponse> {
    const tenant = await this.prisma.db.tenant.findUniqueOrThrow({
      where: { id: tenantContext.requireTenantId() },
    });
    return toResponse(tenant);
  }

  async updateSettings(
    input: UpdateTenantSettingsInput,
    user?: Pick<CurrentUserInfo, 'role'>,
  ): Promise<TenantSettingsResponse> {
    const tenantId = tenantContext.requireTenantId();
    const target = normalizeAmount(input.monthlySalesTarget);
    return this.prisma.db.$transaction(async (tx) => {
      // Lock the row so two concurrent edits produce a correct before/after audit trail.
      await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${tenantId}::uuid FOR UPDATE`;
      const before = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId } });
      // Phase 33: the monthly target is the owner's. The form sends every field, so only a
      // real change is refused to others.
      const beforeTarget = before.monthlySalesTarget
        ? toMoneyString(before.monthlySalesTarget.toString())
        : null;
      const canonical = target === undefined || target === null ? target : toMoneyString(target);
      const targetChanged = canonical !== undefined && canonical !== beforeTarget;
      if (targetChanged && user && user.role !== Role.OWNER) {
        throw new AppException(ErrorCode.FORBIDDEN, 'Only the owner sets the monthly target');
      }
      // Which clients a livreur sees is the owner's decision too (REPORT-35, A-1).
      const livreurScopeChanged =
        input.livreurScope !== undefined && input.livreurScope !== before.livreurScope;
      if (livreurScopeChanged && user && user.role !== Role.OWNER) {
        throw new AppException(ErrorCode.FORBIDDEN, 'Only the owner sets what a livreur sees');
      }
      const after = await tx.tenant.update({
        where: { id: tenantId },
        data: {
          ...input,
          timbreTranches: input.timbreTranches?.map((tr) => ({
            upTo: tr.upTo === null ? null : toMoneyString(normalizeDecimal(tr.upTo)),
            rate: normalizeDecimal(tr.rate),
          })),
          maxDiscountPct:
            input.maxDiscountPct === undefined ? undefined : normalizeDecimal(input.maxDiscountPct),
          timbreMin: normalizeAmount(input.timbreMin),
          timbreMax: normalizeAmount(input.timbreMax),
          timbreThreshold: normalizeAmount(input.timbreThreshold),
          cashCountAlertThreshold: normalizeAmount(input.cashCountAlertThreshold) ?? undefined,
          monthlySalesTarget: target,
        },
      });
      if (targetChanged) {
        await this.audit.log(tx, {
          action: 'TENANT_SALES_TARGET_CHANGED',
          entity: 'Tenant',
          entityId: tenantId,
          before: { monthlySalesTarget: beforeTarget },
          after: { monthlySalesTarget: canonical },
        });
      }
      if (after.priceLevelCount > before.priceLevelCount) {
        await this.catalog.ensurePriceLevels(tx, tenantId, after.priceLevelCount);
      }
      await this.audit.log(tx, {
        action: 'TENANT_SETTINGS_UPDATED',
        entity: 'Tenant',
        entityId: tenantId,
        before: toResponse(before),
        after: toResponse(after),
      });
      return toResponse(after);
    });
  }

  /** The owner hid the onboarding checklist (phase 13). Idempotent. */
  async dismissOnboarding(): Promise<void> {
    await this.prisma.db.$transaction(async (tx) => {
      const { count } = await tx.tenant.updateMany({
        where: { onboardingDismissedAt: null },
        data: { onboardingDismissedAt: new Date() },
      });
      if (count > 0) {
        await this.audit.log(tx, {
          action: 'ONBOARDING_DISMISSED',
          entity: 'Tenant',
          entityId: tenantContext.requireTenantId(),
        });
      }
    });
  }
}
