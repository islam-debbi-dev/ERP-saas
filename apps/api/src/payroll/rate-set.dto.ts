import { type IrgBracket, type PayrollRateSetDto, PayrollRateSource } from '@erp/shared';
import { type Prisma } from '../generated/prisma/client';

export function rateSetDto(r: Prisma.PayrollRateSetGetPayload<object>): PayrollRateSetDto {
  const s = (v: { toString(): string }) => v.toString();
  return {
    id: r.id,
    source: r.tenantId === null ? PayrollRateSource.PLATFORM : PayrollRateSource.COMPANY,
    effectiveFrom: r.effectiveFrom.toISOString().slice(0, 10),
    cnasEmployeeRate: s(r.cnasEmployeeRate),
    cnasEmployerRate: s(r.cnasEmployerRate),
    irgBrackets: r.irgBrackets as unknown as IrgBracket[],
    abattementRate: s(r.abattementRate),
    abattementMin: s(r.abattementMin),
    abattementMax: s(r.abattementMax),
    exemptionThreshold: s(r.exemptionThreshold),
    lissageCeiling: s(r.lissageCeiling),
    lissageNum: s(r.lissageNum),
    lissageDen: s(r.lissageDen),
    lissageOffsetNum: s(r.lissageOffsetNum),
    lissageOffsetDen: s(r.lissageOffsetDen),
    snmg: s(r.snmg),
    toVerify: r.toVerify,
    note: r.note,
    createdAt: r.createdAt.toISOString(),
  };
}
