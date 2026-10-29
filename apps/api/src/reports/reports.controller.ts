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
import { TenantsService } from '../tenants/tenants.service';
import { DashboardService } from './dashboard.service';
import { OnboardingService } from './onboarding.service';
import { buildReportXlsx, reportFileName } from './report-xlsx';
import { ReportsService } from './reports.service';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

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
  constructor(private readonly reports: ReportsService) {}

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
