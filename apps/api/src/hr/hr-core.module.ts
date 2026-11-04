import { Module } from '@nestjs/common';
import { AttendanceDaysService } from './attendance-days.service';
import { EmployeeLedgerService } from './employee-ledger.service';

/**
 * What other modules need from the DRH (phase 31) without depending on it: the employee
 * ledgers (a cancelled dépense reverses its avance) and the day cache (the reconcile).
 */
@Module({
  providers: [AttendanceDaysService, EmployeeLedgerService],
  exports: [AttendanceDaysService, EmployeeLedgerService],
})
export class HrCoreModule {}
