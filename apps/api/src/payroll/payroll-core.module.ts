import { Module } from '@nestjs/common';
import { PayrollCostService } from './payroll-cost.service';

/** What the charges report needs from the paie, without depending on it (phase 31b). */
@Module({ providers: [PayrollCostService], exports: [PayrollCostService] })
export class PayrollCoreModule {}
