import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  StreamableFile,
} from '@nestjs/common';
import {
  type AgingQuery,
  agingQuerySchema,
  type AgingReportDto,
  type DashboardDto,
  type DashboardQuery,
  dashboardQuerySchema,
  type OnboardingStatus,
  Permission,
  type ReportDto,
  type ReportName,
  reportNameSchema,
  type ReportQuery,
  reportQuerySchema,
  Role,
} from '@erp/shared';
import type { CurrentUserInfo } from '../auth/auth.types';
import { CurrentUser, Roles } from '../auth/decorators';
import { requirePermission } from '../auth/permissions';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { AgingService } from '../credit/aging.service';
import { TenantsService } from '../tenants/tenants.service';
import { DashboardService } from './dashboard.service';
import { OnboardingService } from './onboarding.service';
import { agingFileName, buildAgingXlsx } from './aging-xlsx';
import { buildReportXlsx, reportFileName } from './report-xlsx';
import { ReportsService } from './reports.service';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

async function agingFile(report: AgingReportDto): Promise<StreamableFile> {
  const buffer = await buildAgingXlsx(report);
  return new StreamableFile(buffer, {
    type: XLSX_MIME,
    disposition: `attachment; filename="${agingFileName(report)}"`,
    length: buffer.length,
  });
}

/** Every role has a dashboard; what it shows depends on the role (DashboardService). */
@Controller('dashboard')
export class DashboardController {
  constructor(
    private readonly dashboard: DashboardService,
    private readonly onboarding: OnboardingService,
    private readonly tenants: TenantsService,
  ) {}

  @Get()
  get(
    @Query(new ZodValidationPipe(dashboardQuerySchema)) query: DashboardQuery,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<DashboardDto> {
    return this.dashboard.get(user, query.date);
  }

  /** The first-week checklist, for the people who set the company up. */
  @Get('onboarding')
  @Roles(Role.OWNER, Role.MANAGER)
  onboardingStatus(): Promise<OnboardingStatus> {
    return this.onboarding.status();
  }

  @Post('onboarding/dismiss')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(Role.OWNER)
  dismissOnboarding(): Promise<void> {
    return this.tenants.dismissOnboarding();
  }
}

/** Role checks are per report (ReportsService), not per route. */
@Controller('reports')
export class ReportsController {
  constructor(
    private readonly reports: ReportsService,
    private readonly aging: AgingService,
  ) {}

  // Balance âgée (phase 21), declared before ':name'. Managers only, like the accounts.
  @Get('aging')
  @Roles(Role.OWNER, Role.MANAGER)
  clientAging(
    @Query(new ZodValidationPipe(agingQuerySchema)) query: AgingQuery,
  ): Promise<AgingReportDto> {
    return this.aging.clients(query.asOf);
  }

  @Get('supplier-aging')
  @Roles(Role.OWNER, Role.MANAGER)
  supplierAging(
    @Query(new ZodValidationPipe(agingQuerySchema)) query: AgingQuery,
  ): Promise<AgingReportDto> {
    return this.aging.suppliers(query.asOf);
  }

  @Get('aging/export.xlsx')
  @Roles(Role.OWNER, Role.MANAGER)
  async clientAgingExport(
    @Query(new ZodValidationPipe(agingQuerySchema)) query: AgingQuery,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<StreamableFile> {
    requirePermission(user, Permission.EXPORT_DATA, { message: 'You may not export data' });
    return agingFile(await this.aging.clients(query.asOf));
  }

  @Get('supplier-aging/export.xlsx')
  @Roles(Role.OWNER, Role.MANAGER)
  async supplierAgingExport(
    @Query(new ZodValidationPipe(agingQuerySchema)) query: AgingQuery,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<StreamableFile> {
    requirePermission(user, Permission.EXPORT_DATA, { message: 'You may not export data' });
    return agingFile(await this.aging.suppliers(query.asOf));
  }

  @Get(':name')
  run(
    @Param('name', new ZodValidationPipe(reportNameSchema)) name: ReportName,
    @Query(new ZodValidationPipe(reportQuerySchema)) query: ReportQuery,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<ReportDto> {
    return this.reports.run(name, query, user);
  }

  @Get(':name/export.xlsx')
  async export(
    @Param('name', new ZodValidationPipe(reportNameSchema)) name: ReportName,
    @Query(new ZodValidationPipe(reportQuerySchema)) query: ReportQuery,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<StreamableFile> {
    requirePermission(user, Permission.EXPORT_DATA, { message: 'You may not export data' });
    const report = await this.reports.run(name, query, user);
    const buffer = await buildReportXlsx(report);
    return new StreamableFile(buffer, {
      type: XLSX_MIME,
      disposition: `attachment; filename="${reportFileName(report)}"`,
      length: buffer.length,
    });
  }
}
