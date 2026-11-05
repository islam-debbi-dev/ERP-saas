import { Injectable } from '@nestjs/common';
import type { PayrollRateSetDto, PayrollRateSetInput } from '@erp/shared';
import { tenantContext } from '../common/tenant-context';
import { type Prisma } from '../generated/prisma/client';
import { rateSetDto } from '../payroll/rate-set.dto';
import { PrismaService } from '../prisma/prisma.service';
import type { CurrentAdminInfo } from './admin.types';
import { PlatformAuditService } from './platform-audit.service';

/**
 * The platform's CNAS and IRG rates: indicative, each company answers for what it uses. A
 * correction is a new row: approved runs keep their set, and the trigger refuses any edit.
 * A company's own sets are not the super-admin's to read.
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
        where: { tenantId: null },
        orderBy: [{ effectiveFrom: 'desc' }, { seq: 'desc' }],
      });
      return rows.map(rateSetDto);
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
        return rateSetDto(row);
      }),
    );
  }
}
