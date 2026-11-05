import { Module } from '@nestjs/common';
import { AttendanceDaysService } from './attendance-days.service';
import { EmployeeLedgerService } from './employee-ledger.service';
import { LeaveAccrualService } from './leave-accrual.service';

/**
 * What other modules need from the DRH (phase 31) without depending on it: the employee
 * ledgers (a cancelled dépense reverses its avance), the day cache (the reconcile) and the
 * congé accruals.
 */
@Module({
  providers: [AttendanceDaysService, EmployeeLedgerService, LeaveAccrualService],
  exports: [AttendanceDaysService, EmployeeLedgerService, LeaveAccrualService],
})
export class HrCoreModule {}
