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
  type SellOutDto,
  type SellOutQuery,
  sellOutQuerySchema,
} from '@erp/shared';
import type { CurrentUserInfo } from '../auth/auth.types';
import { CurrentUser, RequirePermission, Roles } from '../auth/decorators';
import { requirePermission } from '../auth/permissions';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { AgingService } from '../credit/aging.service';
import { TenantsService } from '../tenants/tenants.service';
import { DashboardService } from './dashboard.service';
import { OnboardingService } from './onboarding.service';
import { agingFileName, buildAgingXlsx } from './aging-xlsx';
import { buildReportXlsx, reportFileName } from './report-xlsx';
import { ReportsService } from './reports.service';
import {
  buildSellOutXlsx,
  SELL_OUT_SCREEN_ROWS,
  sellOutFileName,
  SellOutService,
} from './sell-out.service';

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
    return this.dashboard.get(user, query);
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
    private readonly sellOuts: SellOutService,
  ) {}

  // Balance âgée (phase 21), declared before ':name'. Managers only, like the accounts.
  @Get('aging')
  @RequirePermission(Permission.REPORTS_FINANCE)
  clientAging(
    @Query(new ZodValidationPipe(agingQuerySchema)) query: AgingQuery,
  ): Promise<AgingReportDto> {
    return this.aging.clients(query.asOf);
  }

  @Get('supplier-aging')
  @RequirePermission(Permission.REPORTS_FINANCE)
  supplierAging(
    @Query(new ZodValidationPipe(agingQuerySchema)) query: AgingQuery,
  ): Promise<AgingReportDto> {
    return this.aging.suppliers(query.asOf);
  }

  @Get('aging/export.xlsx')
  @RequirePermission(Permission.REPORTS_FINANCE)
  async clientAgingExport(
    @Query(new ZodValidationPipe(agingQuerySchema)) query: AgingQuery,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<StreamableFile> {
    requirePermission(user, Permission.EXPORT_DATA, { message: 'You may not export data' });
    return agingFile(await this.aging.clients(query.asOf));
  }

  @Get('supplier-aging/export.xlsx')
  @RequirePermission(Permission.REPORTS_FINANCE)
  async supplierAgingExport(
    @Query(new ZodValidationPipe(agingQuerySchema)) query: AgingQuery,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<StreamableFile> {
    requirePermission(user, Permission.EXPORT_DATA, { message: 'You may not export data' });
    return agingFile(await this.aging.suppliers(query.asOf));
  }

  /** Sell-out par marque (phase 20). Declared before ':name'. */
  @Get('sell-out')
  @Roles(Role.OWNER, Role.MANAGER, Role.SUPERVISOR)
  sellOut(
    @Query(new ZodValidationPipe(sellOutQuerySchema)) query: SellOutQuery,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<SellOutDto> {
    return this.sellOuts.run(query, user, SELL_OUT_SCREEN_ROWS);
  }

  @Get('sell-out/export.xlsx')
  @Roles(Role.OWNER, Role.MANAGER, Role.SUPERVISOR)
  async sellOutExport(
    @Query(new ZodValidationPipe(sellOutQuerySchema)) query: SellOutQuery,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<StreamableFile> {
    requirePermission(user, Permission.EXPORT_DATA, { message: 'You may not export data' });
    const report = await this.sellOuts.run(query, user);
    const buffer = await buildSellOutXlsx(report);
    return new StreamableFile(buffer, {
      type: XLSX_MIME,
      disposition: `attachment; filename="${sellOutFileName(report)}"`,
      length: buffer.length,
    });
  }

  @Get(':name')
  @RequirePermission(Permission.REPORTS_VIEW)
  run(
    @Param('name', new ZodValidationPipe(reportNameSchema)) name: ReportName,
    @Query(new ZodValidationPipe(reportQuerySchema)) query: ReportQuery,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<ReportDto> {
    return this.reports.run(name, query, user);
  }

  @Get(':name/export.xlsx')
  @RequirePermission(Permission.REPORTS_VIEW)
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
