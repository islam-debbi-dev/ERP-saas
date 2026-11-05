import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  StreamableFile,
} from '@nestjs/common';
import {
  type AttendanceDayDto,
  type AttendanceDayQuery,
  attendanceDayQuerySchema,
  type AttendanceDayRowDto,
  type AttendanceMonthDto,
  type AttendanceMonthQuery,
  attendanceMonthQuerySchema,
  type AttendanceTodayDto,
  type CorrectAttendanceInput,
  correctAttendanceSchema,
  type CreateAdvanceInput,
  createAdvanceSchema,
  type CreateEmployeeInput,
  createEmployeeSchema,
  type CreateLeaveRequestInput,
  createLeaveRequestSchema,
  type EmployeeDto,
  type EmployeeLedgerEntryDto,
  type EmployeeLedgerPage,
  type EmployeeListQuery,
  employeeListQuerySchema,
  type EmployeePage,
  type EmployeeSalaryDto,
  type EmployeeSalaryInput,
  employeeSalaryInputSchema,
  Feature,
  type HrSettingsDto,
  type HrSettingsInput,
  hrSettingsSchema,
  type LedgerQuery,
  ledgerQuerySchema,
  type LeaveBalanceDto,
  type LeaveEntryInput,
  leaveEntryInputSchema,
  type LeaveReasonInput,
  leaveReasonSchema,
  type LeaveRequestDto,
  type LeaveRequestListQuery,
  leaveRequestListQuerySchema,
  type LeaveRequestPage,
  type MarkAttendanceInput,
  markAttendanceSchema,
  type MarkAttendanceResult,
  type MyAttendanceDto,
  Permission,
  type PublicHolidayDto,
  type PublicHolidayInput,
  type PublicHolidayListDto,
  type PublicHolidayListQuery,
  publicHolidayListQuerySchema,
  publicHolidaySchema,
  type SelfAttendanceInput,
  selfAttendanceSchema,
  type UpdateEmployeeInput,
  updateEmployeeSchema,
} from '@erp/shared';
import type { CurrentUserInfo } from '../auth/auth.types';
import { CurrentUser, RequireFeature, RequirePermission } from '../auth/decorators';
import { requirePermission } from '../auth/permissions';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { Idempotent } from '../idempotency/idempotent.decorator';
import { AdvancesService } from './advances.service';
import { buildMonthXlsx } from './attendance-xlsx';
import { AttendanceService } from './attendance.service';
import { CalendarService } from './calendar.service';
import { EmployeesService } from './employees.service';
import { LeaveService } from './leave.service';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Personnel (phase 31). Salaries, avances and the ledger need SALARY_VIEW. */
@Controller('employees')
@RequireFeature(Feature.HR)
@RequirePermission(Permission.HR_VIEW)
export class EmployeesController {
  constructor(
    private readonly employees: EmployeesService,
    private readonly advances: AdvancesService,
    private readonly leaves: LeaveService,
  ) {}

  @Get()
  list(
    @Query(new ZodValidationPipe(employeeListQuerySchema)) query: EmployeeListQuery,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<EmployeePage> {
    return this.employees.list(query, user);
  }

  @Get(':id')
  get(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<EmployeeDto> {
    return this.employees.get(id, user);
  }

  @Post()
  @RequirePermission(Permission.HR_MANAGE)
  create(
    @Body(new ZodValidationPipe(createEmployeeSchema)) body: CreateEmployeeInput,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<EmployeeDto> {
    return this.employees.create(body, user);
  }

  @Put(':id')
  @RequirePermission(Permission.HR_MANAGE)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateEmployeeSchema)) body: UpdateEmployeeInput,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<EmployeeDto> {
    return this.employees.update(id, body, user);
  }

  @Delete(':id')
  @RequirePermission(Permission.HR_MANAGE)
  @HttpCode(HttpStatus.NO_CONTENT)
  archive(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<void> {
    return this.employees.archive(id, user);
  }

  @Post(':id/restore')
  @RequirePermission(Permission.HR_MANAGE)
  @HttpCode(HttpStatus.OK)
  restore(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<EmployeeDto> {
    return this.employees.restore(id, user);
  }

  @Get(':id/salaries')
  @RequirePermission(Permission.SALARY_VIEW)
  salaries(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<EmployeeSalaryDto[]> {
    return this.employees.salaries(id, user);
  }

  @Post(':id/salaries')
  @RequirePermission(Permission.SALARY_VIEW)
  @Idempotent()
  appendSalary(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(employeeSalaryInputSchema)) body: EmployeeSalaryInput,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<EmployeeSalaryDto[]> {
    requirePermission(user, Permission.HR_MANAGE);
    return this.employees.appendSalary(id, body, user);
  }

  @Get(':id/ledger')
  @RequirePermission(Permission.SALARY_VIEW)
  ledger(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodValidationPipe(ledgerQuerySchema)) query: LedgerQuery,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<EmployeeLedgerPage> {
    return this.employees.ledger(id, query, user);
  }

  @Get(':id/leave-balance')
  leaveBalance(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<LeaveBalanceDto> {
    return this.leaves.balance(id, user);
  }

  @Post(':id/leave-entries')
  @RequirePermission(Permission.LEAVE_APPROVE)
  @Idempotent()
  leaveEntry(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(leaveEntryInputSchema)) body: LeaveEntryInput,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<LeaveBalanceDto> {
    return this.leaves.postEntry(id, body, user);
  }

  @Post(':id/advances')
  @RequirePermission(Permission.ADVANCE_PAY)
  @Idempotent()
  advance(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(createAdvanceSchema)) body: CreateAdvanceInput,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<EmployeeLedgerEntryDto> {
    return this.advances.pay(id, body, user);
  }
}

/** Pointage (phase 31). The self routes need no permission, only a linked employee file. */
@Controller('attendance')
@RequireFeature(Feature.HR)
export class AttendanceController {
  constructor(private readonly attendance: AttendanceService) {}

  @Get('day')
  @RequirePermission(Permission.HR_VIEW)
  day(
    @Query(new ZodValidationPipe(attendanceDayQuerySchema)) query: AttendanceDayQuery,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<AttendanceDayDto> {
    return this.attendance.day(query, user);
  }

  @Get('today')
  @RequirePermission(Permission.HR_VIEW)
  today(@CurrentUser() user: CurrentUserInfo): Promise<AttendanceTodayDto> {
    return this.attendance.today(user);
  }

  @Get('month')
  @RequirePermission(Permission.HR_VIEW)
  month(
    @Query(new ZodValidationPipe(attendanceMonthQuerySchema)) query: AttendanceMonthQuery,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<AttendanceMonthDto> {
    return this.attendance.month(query, user);
  }

  @Get('month/export.xlsx')
  @RequirePermission(Permission.EXPORT_DATA)
  async export(
    @Query(new ZodValidationPipe(attendanceMonthQuerySchema)) query: AttendanceMonthQuery,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<StreamableFile> {
    requirePermission(user, Permission.HR_VIEW);
    const buffer = await buildMonthXlsx(await this.attendance.month(query, user));
    return new StreamableFile(buffer, {
      type: XLSX_MIME,
      disposition: `attachment; filename="pointage-${query.month}.xlsx"`,
      length: buffer.length,
    });
  }

  @Post('events')
  @RequirePermission(Permission.ATTENDANCE_MARK)
  @Idempotent()
  mark(
    @Body(new ZodValidationPipe(markAttendanceSchema)) body: MarkAttendanceInput,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<MarkAttendanceResult> {
    return this.attendance.mark(body, user);
  }

  @Post('corrections')
  @RequirePermission(Permission.ATTENDANCE_CORRECT)
  @Idempotent()
  correct(
    @Body(new ZodValidationPipe(correctAttendanceSchema)) body: CorrectAttendanceInput,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<AttendanceDayRowDto> {
    return this.attendance.correct(body, user);
  }

  @Get('me')
  mine(@CurrentUser() user: CurrentUserInfo): Promise<MyAttendanceDto> {
    return this.attendance.mine(user);
  }

  @Post('check-in')
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  checkIn(
    @Body(new ZodValidationPipe(selfAttendanceSchema)) body: SelfAttendanceInput,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<MyAttendanceDto> {
    return this.attendance.checkIn(body.geo, user);
  }

  @Post('check-out')
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  checkOut(
    @Body(new ZodValidationPipe(selfAttendanceSchema)) body: SelfAttendanceInput,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<MyAttendanceDto> {
    return this.attendance.checkOut(body.geo, user);
  }
}

/** Congés (phase 31). Anyone with an employee file can ask for his own. */
@Controller('leave-requests')
@RequireFeature(Feature.HR)
export class LeaveRequestsController {
  constructor(private readonly leaves: LeaveService) {}

  @Get()
  @RequirePermission(Permission.HR_VIEW)
  list(
    @Query(new ZodValidationPipe(leaveRequestListQuerySchema)) query: LeaveRequestListQuery,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<LeaveRequestPage> {
    return this.leaves.list(query, user);
  }

  @Post()
  @Idempotent()
  create(
    @Body(new ZodValidationPipe(createLeaveRequestSchema)) body: CreateLeaveRequestInput,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<LeaveRequestDto> {
    return this.leaves.create(body, user);
  }

  @Post(':id/approve')
  @RequirePermission(Permission.LEAVE_APPROVE)
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  approve(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<LeaveRequestDto> {
    return this.leaves.approve(id, user);
  }

  @Post(':id/reject')
  @RequirePermission(Permission.LEAVE_APPROVE)
  @HttpCode(HttpStatus.OK)
  reject(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(leaveReasonSchema)) body: LeaveReasonInput,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<LeaveRequestDto> {
    return this.leaves.reject(id, body.reason, user);
  }

  @Post(':id/cancel')
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(leaveReasonSchema)) body: LeaveReasonInput,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<LeaveRequestDto> {
    return this.leaves.cancel(id, body.reason, user);
  }
}

/** Calendar of the DRH (phase 31): reading takes HR_VIEW, changing it HR_MANAGE. */
@Controller('hr-settings')
@RequireFeature(Feature.HR)
@RequirePermission(Permission.HR_VIEW)
export class HrSettingsController {
  constructor(private readonly calendar: CalendarService) {}

  @Get()
  get(): Promise<HrSettingsDto> {
    return this.calendar.settings();
  }

  @Put()
  @RequirePermission(Permission.HR_MANAGE)
  update(
    @Body(new ZodValidationPipe(hrSettingsSchema)) body: HrSettingsInput,
  ): Promise<HrSettingsDto> {
    return this.calendar.updateSettings(body);
  }
}

@Controller('public-holidays')
@RequireFeature(Feature.HR)
@RequirePermission(Permission.HR_VIEW)
export class PublicHolidaysController {
  constructor(private readonly calendar: CalendarService) {}

  @Get()
  list(
    @Query(new ZodValidationPipe(publicHolidayListQuerySchema)) query: PublicHolidayListQuery,
  ): Promise<PublicHolidayListDto> {
    return this.calendar.holidays(query.year);
  }

  @Post()
  @RequirePermission(Permission.HR_MANAGE)
  create(
    @Body(new ZodValidationPipe(publicHolidaySchema)) body: PublicHolidayInput,
  ): Promise<PublicHolidayDto> {
    return this.calendar.createHoliday(body);
  }

  @Put(':id')
  @RequirePermission(Permission.HR_MANAGE)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(publicHolidaySchema)) body: PublicHolidayInput,
  ): Promise<PublicHolidayDto> {
    return this.calendar.updateHoliday(id, body);
  }

  @Delete(':id')
  @RequirePermission(Permission.HR_MANAGE)
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.calendar.deleteHoliday(id);
  }
}
