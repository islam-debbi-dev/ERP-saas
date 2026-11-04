import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { DocumentsModule } from '../documents/documents.module';
import { ExpensesModule } from '../expenses/expenses.module';
import { HrCoreModule } from '../hr/hr-core.module';
import { HrModule } from '../hr/hr.module';
import { IncentivesModule } from '../incentives/incentives.module';
import { PrintingModule } from '../printing/printing.module';
import { SalesForceModule } from '../sales-force/sales-force.module';
import { TenantsModule } from '../tenants/tenants.module';
import { PayrollComputeService } from './payroll-compute.service';
import { PayrollDocumentsService } from './payroll-documents.service';
import { PayrollRunsService } from './payroll-runs.service';
import { PayrollSettingsService } from './payroll-settings.service';
import {
  EmployeePayItemsController,
  EmployeePayslipsController,
  MyPayslipsController,
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
    PrintingModule,
    SalesForceModule,
    TenantsModule,
  ],
  controllers: [
    PayrollSettingsController,
    PayItemTypesController,
    EmployeePayItemsController,
    EmployeePayslipsController,
    PayrollRunsController,
    MyPayslipsController,
  ],
  providers: [
    PayrollComputeService,
    PayrollDocumentsService,
    PayrollRunsService,
    PayrollSettingsService,
  ],
})
export class PayrollModule {}
