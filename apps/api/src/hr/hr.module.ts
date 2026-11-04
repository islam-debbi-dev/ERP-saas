import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { DocumentsModule } from '../documents/documents.module';
import { ExpensesModule } from '../expenses/expenses.module';
import { GeoModule } from '../geo/geo.module';
import { SalesForceModule } from '../sales-force/sales-force.module';
import { AdvancesService } from './advances.service';
import { AttendanceService } from './attendance.service';
import { CalendarService } from './calendar.service';
import { EmployeeAccessService } from './employee-access.service';
import { EmployeesService } from './employees.service';
import { HrCoreModule } from './hr-core.module';
import {
  AttendanceController,
  EmployeesController,
  HrSettingsController,
  LeaveRequestsController,
  PublicHolidaysController,
} from './hr.controllers';
import { LeaveService } from './leave.service';
import { MonthCloseService } from './month-close.service';

/** DRH part 1 (phase 31, HR): personnel, pointage, congés, avances. */
@Module({
  imports: [
    BillingModule,
    DocumentsModule,
    ExpensesModule,
    GeoModule,
    HrCoreModule,
    SalesForceModule,
  ],
  controllers: [
    EmployeesController,
    AttendanceController,
    LeaveRequestsController,
    HrSettingsController,
    PublicHolidaysController,
  ],
  providers: [
    AdvancesService,
    AttendanceService,
    CalendarService,
    EmployeeAccessService,
    EmployeesService,
    LeaveService,
    MonthCloseService,
  ],
  exports: [EmployeeAccessService, EmployeesService, MonthCloseService],
})
export class HrModule {}
