import { Injectable } from '@nestjs/common';
import {
  parseDA,
  type TenantSettingsResponse,
  toMoneyString,
  type UpdateTenantSettingsInput,
} from '@erp/shared';
import { AuditService } from '../audit/audit.service';
import { tenantContext } from '../common/tenant-context';
import { type Tenant } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

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
    timbreEnabled: t.timbreEnabled,
    timbreRate: t.timbreRate?.toString() ?? null,
    timbreMin: t.timbreMin ? toMoneyString(t.timbreMin) : null,
    timbreMax: t.timbreMax ? toMoneyString(t.timbreMax) : null,
    timbreThreshold: t.timbreThreshold ? toMoneyString(t.timbreThreshold) : null,
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
  ) {}

  async getSettings(): Promise<TenantSettingsResponse> {
    const tenant = await this.prisma.db.tenant.findUniqueOrThrow({
      where: { id: tenantContext.requireTenantId() },
    });
    return toResponse(tenant);
  }

  async updateSettings(input: UpdateTenantSettingsInput): Promise<TenantSettingsResponse> {
    const tenantId = tenantContext.requireTenantId();
    return this.prisma.db.$transaction(async (tx) => {
      // Lock the row so two concurrent edits produce a correct before/after audit trail.
      await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${tenantId}::uuid FOR UPDATE`;
      const before = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId } });
      const after = await tx.tenant.update({
        where: { id: tenantId },
        data: {
          ...input,
          timbreRate: normalizeAmount(input.timbreRate),
          timbreMin: normalizeAmount(input.timbreMin),
          timbreMax: normalizeAmount(input.timbreMax),
          timbreThreshold: normalizeAmount(input.timbreThreshold),
        },
      });
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
}
