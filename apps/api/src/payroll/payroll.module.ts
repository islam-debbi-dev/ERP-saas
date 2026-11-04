import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { DocumentsModule } from '../documents/documents.module';
import { ExpensesModule } from '../expenses/expenses.module';
import { HrCoreModule } from '../hr/hr-core.module';
import { HrModule } from '../hr/hr.module';
import { IncentivesModule } from '../incentives/incentives.module';
import { SalesForceModule } from '../sales-force/sales-force.module';
import { PayrollComputeService } from './payroll-compute.service';
import { PayrollRunsService } from './payroll-runs.service';
import { PayrollSettingsService } from './payroll-settings.service';
import {
  EmployeePayItemsController,
  PayItemTypesController,
  PayrollRunsController,
  PayrollSettingsController,
} from './payroll.controllers';

/** DRH part 2 (phase 31b, PAYROLL): paie, bulletins, salary payments. */
@Module({
  imports: [
    BillingModule,
    DocumentsModule,
    ExpensesModule,
    HrCoreModule,
    HrModule,
    IncentivesModule,
    SalesForceModule,
  ],
  controllers: [
    PayrollSettingsController,
    PayItemTypesController,
    EmployeePayItemsController,
    PayrollRunsController,
  ],
  providers: [PayrollComputeService, PayrollRunsService, PayrollSettingsService],
})
export class PayrollModule {}
