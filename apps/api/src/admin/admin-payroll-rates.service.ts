import { Injectable } from '@nestjs/common';
import type { IrgBracket, PayrollRateSetDto, PayrollRateSetInput } from '@erp/shared';
import { tenantContext } from '../common/tenant-context';
import { type Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { CurrentAdminInfo } from './admin.types';
import { PlatformAuditService } from './platform-audit.service';

type Row = Prisma.PayrollRateSetGetPayload<object>;

function toDto(r: Row): PayrollRateSetDto {
  const s = (v: { toString(): string }) => v.toString();
  return {
    id: r.id,
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

/**
 * The CNAS and IRG rates, owned by the super-admin. A correction is a new row: approved
 * runs keep the set they were computed with, and the trigger refuses any edit.
 */
@Injectable()
export class AdminPayrollRatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: PlatformAuditService,
  ) {}

  list(): Promise<PayrollRateSetDto[]> {
    return tenantContext.runAsSystem(async () => {
      const rows = await this.prisma.db.payrollRateSet.findMany({
        orderBy: [{ effectiveFrom: 'desc' }, { seq: 'desc' }],
      });
      return rows.map(toDto);
    });
  }

  append(admin: CurrentAdminInfo, input: PayrollRateSetInput): Promise<PayrollRateSetDto> {
    return tenantContext.runAsSystem(() =>
      this.prisma.db.$transaction(async (tx) => {
        const row = await tx.payrollRateSet.create({
          data: {
            ...input,
            effectiveFrom: new Date(`${input.effectiveFrom}T00:00:00.000Z`),
            irgBrackets: input.irgBrackets as unknown as Prisma.InputJsonValue,
          },
        });
        await this.audit.log(tx, {
          adminId: admin.id,
          action: 'PAYROLL_RATE_SET_ADDED',
          detail: { id: row.id, effectiveFrom: input.effectiveFrom, toVerify: input.toVerify },
        });
        return toDto(row);
      }),
    );
  }
}
