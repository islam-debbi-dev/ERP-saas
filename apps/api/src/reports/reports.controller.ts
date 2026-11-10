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
  type ChargesQuery,
  chargesQuerySchema,
  type ChargesReportDto,
  agingQuerySchema,
  type AgingReportDto,
  type DashboardDto,
  type DashboardQuery,
  dashboardQuerySchema,
  type DashboardTodoDto,
  Feature,
  type OnboardingStatus,
  type OverviewDto,
  type OverviewQuery,
  overviewQuerySchema,
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
import { CurrentUser, RequireFeature, RequirePermission, Roles } from '../auth/decorators';
import { requirePermission } from '../auth/permissions';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { AgingService } from '../credit/aging.service';
import { TenantsService } from '../tenants/tenants.service';
import { DashboardService } from './dashboard.service';
import { TodoService } from './todo.service';
import { OnboardingService } from './onboarding.service';
import { ChargesService } from '../expenses/charges.service';
import { agingFileName, buildAgingXlsx } from './aging-xlsx';
import { buildChargesXlsx, chargesFileName } from './charges-xlsx';
import { buildOverviewXlsx, overviewFileName } from './overview-xlsx';
import { OverviewService } from './overview.service';
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
    private readonly todos: TodoService,
  ) {}

  @Get()
  get(
    @Query(new ZodValidationPipe(dashboardQuerySchema)) query: DashboardQuery,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<DashboardDto> {
    return this.dashboard.get(user, query);
  }

  /** "À faire aujourd'hui" (phase 33): same roles as the dashboard, ranked, capped. */
  @Get('todo')
  todo(@CurrentUser() user: CurrentUserInfo): Promise<DashboardTodoDto> {
    return this.todos.get(user);
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
    private readonly charges: ChargesService,
    private readonly overview: OverviewService,
  ) {}

  /**
   * Vue d'ensemble (phase 26): one card per dépôt whose figures the user sees. Finance
   * figures (cash, credit, charges), so managers only, like the charges report.
   */
  @Get('overview')
  @RequireFeature(Feature.MULTI_UNIT)
  @RequirePermission(Permission.REPORTS_FINANCE)
  overviewReport(
    @Query(new ZodValidationPipe(overviewQuerySchema)) query: OverviewQuery,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<OverviewDto> {
    return this.overview.get(query, user);
  }

  @Get('overview/export.xlsx')
  @RequireFeature(Feature.MULTI_UNIT)
  @RequirePermission(Permission.REPORTS_FINANCE)
  async overviewExport(
    @Query(new ZodValidationPipe(overviewQuerySchema)) query: OverviewQuery,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<StreamableFile> {
    requirePermission(user, Permission.EXPORT_DATA, { message: 'You may not export data' });
    const report = await this.overview.get(query, user);
    const buffer = await buildOverviewXlsx(report);
    return new StreamableFile(buffer, {
      type: XLSX_MIME,
      disposition: `attachment; filename="${overviewFileName(report)}"`,
      length: buffer.length,
    });
  }

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

  /**
   * Charges of a period (phase 25): rent by day from the contracts + other expenses.
   * Managers (finance figures), over the dépôts whose figures the user sees.
   */
  @Get('charges')
  @RequireFeature(Feature.EXPENSES)
  @RequirePermission(Permission.REPORTS_FINANCE)
  chargesReport(
    @Query(new ZodValidationPipe(chargesQuerySchema)) query: ChargesQuery,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<ChargesReportDto> {
    return this.charges.report(query, user);
  }

  @Get('charges/export.xlsx')
  @RequireFeature(Feature.EXPENSES)
  @RequirePermission(Permission.REPORTS_FINANCE)
  async chargesExport(
    @Query(new ZodValidationPipe(chargesQuerySchema)) query: ChargesQuery,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<StreamableFile> {
    requirePermission(user, Permission.EXPORT_DATA, { message: 'You may not export data' });
    const report = await this.charges.report(query, user);
    const buffer = await buildChargesXlsx(report);
    return new StreamableFile(buffer, {
      type: XLSX_MIME,
      disposition: `attachment; filename="${chargesFileName(report)}"`,
      length: buffer.length,
    });
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
