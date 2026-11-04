import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  type ApprovePayrollRunInput,
  approvePayrollRunSchema,
  type CancelPayrollRunInput,
  cancelPayrollRunSchema,
  type CreatePayrollRunInput,
  createPayrollRunSchema,
  type EmployeePayItemDto,
  type EmployeePayItemInput,
  employeePayItemSchema,
  Feature,
  type PatchPayrollRunParsed,
  patchPayrollRunSchema,
  type PayItemTypeDto,
  type PayItemTypeInput,
  payItemTypeSchema,
  type PayPayrollRunInput,
  payPayrollRunSchema,
  type PayrollRunDetailDto,
  type PayrollRunListQuery,
  payrollRunListQuerySchema,
  type PayrollRunPage,
  type PayrollSettingsDto,
  type PayrollSettingsInput,
  payrollSettingsSchema,
  Permission,
} from '@erp/shared';
import type { CurrentUserInfo } from '../auth/auth.types';
import { CurrentUser, RequireFeature, RequirePermission } from '../auth/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { Idempotent } from '../idempotency/idempotent.decorator';
import { PayrollRunsService } from './payroll-runs.service';
import { PayrollSettingsService } from './payroll-settings.service';

/** Everything here is pay: without SALARY_VIEW it does not exist (phase 31b). */
@Controller('payroll-settings')
@RequireFeature(Feature.PAYROLL)
@RequirePermission(Permission.SALARY_VIEW)
export class PayrollSettingsController {
  constructor(private readonly settings: PayrollSettingsService) {}

  @Get()
  get(): Promise<PayrollSettingsDto> {
    return this.settings.get();
  }

  @Put()
  @RequirePermission(Permission.PAYROLL_MANAGE)
  update(
    @Body(new ZodValidationPipe(payrollSettingsSchema)) body: PayrollSettingsInput,
  ): Promise<PayrollSettingsDto> {
    return this.settings.update(body);
  }
}

@Controller('pay-item-types')
@RequireFeature(Feature.PAYROLL)
@RequirePermission(Permission.SALARY_VIEW)
export class PayItemTypesController {
  constructor(private readonly settings: PayrollSettingsService) {}

  @Get()
  list(): Promise<PayItemTypeDto[]> {
    return this.settings.types();
  }

  @Post()
  @RequirePermission(Permission.PAYROLL_MANAGE)
  create(
    @Body(new ZodValidationPipe(payItemTypeSchema)) body: PayItemTypeInput,
  ): Promise<PayItemTypeDto> {
    return this.settings.createType(body);
  }

  @Put(':id')
  @RequirePermission(Permission.PAYROLL_MANAGE)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(payItemTypeSchema)) body: PayItemTypeInput,
  ): Promise<PayItemTypeDto> {
    return this.settings.updateType(id, body);
  }

  @Delete(':id')
  @RequirePermission(Permission.PAYROLL_MANAGE)
  @HttpCode(HttpStatus.NO_CONTENT)
  archive(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.settings.archiveType(id);
  }
}

@Controller('employees/:id/pay-items')
@RequireFeature(Feature.PAYROLL)
@RequirePermission(Permission.SALARY_VIEW)
export class EmployeePayItemsController {
  constructor(private readonly settings: PayrollSettingsService) {}

  @Get()
  list(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<EmployeePayItemDto[]> {
    return this.settings.employeeItems(id, user);
  }

  @Post()
  @RequirePermission(Permission.PAYROLL_MANAGE)
  @Idempotent()
  append(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(employeePayItemSchema)) body: EmployeePayItemInput,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<EmployeePayItemDto[]> {
    return this.settings.appendEmployeeItem(id, body, user);
  }
}

@Controller('payroll-runs')
@RequireFeature(Feature.PAYROLL)
@RequirePermission(Permission.SALARY_VIEW)
export class PayrollRunsController {
  constructor(private readonly runs: PayrollRunsService) {}

  @Get()
  list(
    @Query(new ZodValidationPipe(payrollRunListQuerySchema)) query: PayrollRunListQuery,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<PayrollRunPage> {
    return this.runs.list(query, user);
  }

  @Get(':id')
  get(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<PayrollRunDetailDto> {
    return this.runs.get(id, user);
  }

  @Post()
  create(
    @Body(new ZodValidationPipe(createPayrollRunSchema)) body: CreatePayrollRunInput,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<PayrollRunDetailDto> {
    return this.runs.create(body, user);
  }

  @Post(':id/recompute')
  @HttpCode(HttpStatus.OK)
  recompute(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<PayrollRunDetailDto> {
    return this.runs.recompute(id, user);
  }

  @Patch(':id')
  patch(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(patchPayrollRunSchema)) body: PatchPayrollRunParsed,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<PayrollRunDetailDto> {
    return this.runs.patch(id, body, user);
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  approve(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(approvePayrollRunSchema)) body: ApprovePayrollRunInput,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<PayrollRunDetailDto> {
    return this.runs.approve(id, body, user);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(cancelPayrollRunSchema)) body: CancelPayrollRunInput,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<PayrollRunDetailDto> {
    return this.runs.cancel(id, body, user);
  }

  @Post(':id/payments')
  @Idempotent()
  pay(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(payPayrollRunSchema)) body: PayPayrollRunInput,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<PayrollRunDetailDto> {
    return this.runs.pay(id, body, user);
  }
}
