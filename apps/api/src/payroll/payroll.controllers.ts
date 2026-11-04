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
  StreamableFile,
} from '@nestjs/common';
import {
  type ApprovePayrollRunInput,
  approvePayrollRunSchema,
  type CancelPayrollRunInput,
  cancelPayrollRunSchema,
  type CreatePayrollRunInput,
  createPayrollRunSchema,
  dasQuerySchema,
  type DasQuery,
  type EmployeePayItemDto,
  type EmployeePayItemInput,
  employeePayItemSchema,
  Feature,
  type MyPayslipDto,
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
import {
  type PayrollExport,
  PayrollDocumentsService,
  type PayrollFile,
} from './payroll-documents.service';
import { PayrollRunsService } from './payroll-runs.service';
import { PayrollSettingsService } from './payroll-settings.service';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function pdf(file: PayrollFile): StreamableFile {
  return new StreamableFile(file.buffer, {
    type: 'application/pdf',
    disposition: `inline; filename="${file.filename}"`,
    length: file.buffer.length,
  });
}

function xlsx(file: PayrollFile): StreamableFile {
  return new StreamableFile(file.buffer, {
    type: XLSX_MIME,
    disposition: `attachment; filename="${file.filename}"`,
    length: file.buffer.length,
  });
}

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

@Controller('employees/:id/payslips')
@RequireFeature(Feature.PAYROLL)
@RequirePermission(Permission.SALARY_VIEW)
export class EmployeePayslipsController {
  constructor(private readonly documents: PayrollDocumentsService) {}

  @Get()
  list(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<MyPayslipDto[]> {
    return this.documents.ofEmployee(id, user);
  }
}

@Controller('payroll-runs')
@RequireFeature(Feature.PAYROLL)
@RequirePermission(Permission.SALARY_VIEW)
export class PayrollRunsController {
  constructor(
    private readonly runs: PayrollRunsService,
    private readonly documents: PayrollDocumentsService,
  ) {}

  @Get('das.xlsx')
  async das(
    @Query(new ZodValidationPipe(dasQuerySchema)) query: DasQuery,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<StreamableFile> {
    return xlsx(await this.documents.das(query.year, user));
  }

  @Get('payslips/:id/pdf')
  async slipPdf(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<StreamableFile> {
    return pdf(await this.documents.slipPdf(id, user));
  }

  @Get(':id/pdf')
  async runPdf(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<StreamableFile> {
    return pdf(await this.documents.runPdf(id, user));
  }

  @Get(':id/livre-de-paie.xlsx')
  livre(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: CurrentUserInfo) {
    return this.export(id, 'livre-de-paie', user);
  }

  @Get(':id/etat-cnas.xlsx')
  cnas(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: CurrentUserInfo) {
    return this.export(id, 'etat-cnas', user);
  }

  @Get(':id/recap-irg.xlsx')
  irg(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: CurrentUserInfo) {
    return this.export(id, 'recap-irg', user);
  }

  private async export(
    id: string,
    kind: PayrollExport,
    user: CurrentUserInfo,
  ): Promise<StreamableFile> {
    return xlsx(await this.documents.runExport(id, kind, user));
  }

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

/** A worker's own payslips: no SALARY_VIEW needed, and only his (phase 31b). */
@Controller('me/payslips')
@RequireFeature(Feature.PAYROLL)
export class MyPayslipsController {
  constructor(private readonly documents: PayrollDocumentsService) {}

  @Get()
  list(@CurrentUser() user: CurrentUserInfo): Promise<MyPayslipDto[]> {
    return this.documents.mine(user);
  }

  @Get(':id/pdf')
  async pdf(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<StreamableFile> {
    return pdf(await this.documents.minePdf(id, user));
  }
}
