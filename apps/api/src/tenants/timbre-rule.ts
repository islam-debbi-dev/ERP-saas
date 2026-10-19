import { type TimbreRule, type TimbreTranche, timbreTranchesSchema } from '@erp/shared';
import { type Tenant } from '../generated/prisma/client';

/** Tranches as stored (JSON validated at write time); a malformed value reads as none. */
export function readTranches(value: unknown): TimbreTranche[] {
  const parsed = timbreTranchesSchema.safeParse(value);
  return parsed.success ? parsed.data : [];
}

/** The tenant's timbre rule in the shape `computeTimbre` takes. */
export function timbreRuleOf(
  t: Pick<
    Tenant,
    'timbreEnabled' | 'timbreThreshold' | 'timbreTranches' | 'timbreMin' | 'timbreMax'
  >,
): TimbreRule {
  return {
    enabled: t.timbreEnabled,
    threshold: t.timbreThreshold?.toString() ?? null,
    tranches: readTranches(t.timbreTranches),
    min: t.timbreMin?.toString() ?? null,
    max: t.timbreMax?.toString() ?? null,
  };
}
