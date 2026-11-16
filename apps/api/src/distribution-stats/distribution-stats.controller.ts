import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Post,
  Put,
  Query,
  StreamableFile,
} from '@nestjs/common';
import {
  type CopyVehicleTargetsInput,
  copyVehicleTargetsSchema,
  type DistributionStatsQuery,
  distributionStatsQuerySchema,
  ErrorCode,
  Feature,
  Permission,
  type PutVehicleTargetsInput,
  putVehicleTargetsSchema,
  type StatsByDimensionDto,
  type StatsByDimensionQuery,
  statsByDimensionQuerySchema,
  type StatsByVehicleDto,
  type StatsDispersionDto,
  type StatsLostClientsDto,
  type StatsExportQuery,
  statsExportQuerySchema,
  type StatsMyVehicleDto,
  type StatsOverviewDto,
  type StatsTimelineDto,
  type StatsTimelineQuery,
  statsTimelineQuerySchema,
  type StatsVehicleDayDto,
  type StatsVehicleDayQuery,
  statsVehicleDayQuerySchema,
  type StatsVisitsDto,
  type VehicleTargetsDto,
  type VehicleTargetsQuery,
  vehicleTargetsQuerySchema,
} from '@erp/shared';
import type { CurrentUserInfo } from '../auth/auth.types';
import { CurrentUser, RequireFeature, RequirePermission } from '../auth/decorators';
import { requirePermission } from '../auth/permissions';
import { AppException } from '../common/app-exception';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { type XlsxTable } from '../reports/report-xlsx';
import { DistributionStatsService } from './distribution-stats.service';
import {
  buildTableXlsx,
  byDimensionTable,
  byVehicleTable,
  dispersionTable,
  overviewTable,
  timelineTable,
  vehicleDayTable,
  visitsTable,
} from './stats-xlsx';
import { VehicleTargetsService } from './vehicle-targets.service';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
/** Figures change with every sale; a minute in the browser is enough to flip between views. */
const CACHE = 'private, max-age=60';

/**
 * Statistiques distribution (phase 37). Read only: no idempotency key. Thin: each route
 * validates the one filter schema and calls the service, which picks measures and
 * dimensions for `StatsQueryService.run()`.
 */
@Controller('stats/distribution')
@RequireFeature(Feature.DISTRIBUTION_STATS)
@RequirePermission(Permission.REPORTS_VIEW)
export class DistributionStatsController {
  constructor(private readonly stats: DistributionStatsService) {}

  @Get('overview')
  @Header('Cache-Control', CACHE)
  overview(
    @Query(new ZodValidationPipe(distributionStatsQuerySchema)) query: DistributionStatsQuery,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<StatsOverviewDto> {
    return this.stats.overview(query, user);
  }

  @Get('by-vehicle')
  @Header('Cache-Control', CACHE)
  byVehicle(
    @Query(new ZodValidationPipe(distributionStatsQuerySchema)) query: DistributionStatsQuery,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<StatsByVehicleDto> {
    return this.stats.byVehicle(query, user);
  }

  @Get('by-dimension')
  @Header('Cache-Control', CACHE)
  byDimension(
    @Query(new ZodValidationPipe(statsByDimensionQuerySchema)) query: StatsByDimensionQuery,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<StatsByDimensionDto> {
    return this.stats.byDimension(query, user);
  }

  @Get('timeline')
  @Header('Cache-Control', CACHE)
  timeline(
    @Query(new ZodValidationPipe(statsTimelineQuerySchema)) query: StatsTimelineQuery,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<StatsTimelineDto> {
    return this.stats.timeline(query, user);
  }

  @Get('visits')
  @Header('Cache-Control', CACHE)
  visits(
    @Query(new ZodValidationPipe(distributionStatsQuerySchema)) query: DistributionStatsQuery,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<StatsVisitsDto> {
    return this.stats.visits(query, user);
  }

  @Get('vehicle-day')
  @Header('Cache-Control', CACHE)
  vehicleDay(
    @Query(new ZodValidationPipe(statsVehicleDayQuerySchema)) query: StatsVehicleDayQuery,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<StatsVehicleDayDto> {
    return this.stats.vehicleDay(query, user);
  }

  @Get('dispersion')
  @Header('Cache-Control', CACHE)
  dispersion(
    @Query(new ZodValidationPipe(distributionStatsQuerySchema)) query: DistributionStatsQuery,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<StatsDispersionDto> {
    return this.stats.dispersion(query, user);
  }

  @Get('lost-clients')
  @Header('Cache-Control', CACHE)
  lostClients(
    @Query(new ZodValidationPipe(distributionStatsQuerySchema)) query: DistributionStatsQuery,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<StatsLostClientsDto> {
    return this.stats.lostClients(query, user);
  }

  /** "Mon véhicule": the only statistics a seller or a livreur gets (dashboard card). */
  @Get('my-vehicle')
  @Header('Cache-Control', CACHE)
  myVehicle(@CurrentUser() user: CurrentUserInfo): Promise<StatsMyVehicleDto> {
    return this.stats.myVehicle(user);
  }

  /** The rows of a view as one sheet: French headers, numbers as numbers. */
  @Get('export.xlsx')
  async export(
    @Query(new ZodValidationPipe(statsExportQuerySchema)) query: StatsExportQuery,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<StreamableFile> {
    requirePermission(user, Permission.EXPORT_DATA, { message: 'You may not export data' });
    const table = await this.table(query, user);
    const buffer = await buildTableXlsx(table);
    const name =
      query.view === 'vehicle-day'
        ? `statistiques-journee-${query.date}.xlsx`
        : `statistiques-${query.view}-${query.from}-${query.to}.xlsx`;
    return new StreamableFile(buffer, {
      type: XLSX_MIME,
      disposition: `attachment; filename="${name}"`,
      length: buffer.length,
    });
  }

  private async table(query: StatsExportQuery, user: CurrentUserInfo): Promise<XlsxTable> {
    if (query.view === 'vehicle-day') {
      const filters = statsVehicleDayQuerySchema.parse(query);
      return vehicleDayTable(await this.stats.vehicleDay(filters, user));
    }
    // The schema checked what each view needs.
    const base = query as StatsExportQuery & { from: string; to: string };
    switch (query.view) {
      case 'overview':
        return overviewTable(await this.stats.overview(base, user));
      case 'by-vehicle':
        return byVehicleTable(await this.stats.byVehicle(base, user));
      case 'by-dimension':
        return byDimensionTable(
          await this.stats.byDimension({ ...base, dimension: query.dimension! }, user),
        );
      case 'timeline':
        return timelineTable(await this.stats.timeline({ ...base, measure: query.measure! }, user));
      case 'visits':
        return visitsTable(await this.stats.visits(base, user));
      case 'dispersion':
        return dispersionTable(await this.stats.dispersion(base, user));
      default:
        throw new AppException(ErrorCode.VALIDATION_FAILED, 'Unknown view');
    }
  }
}

/** Monthly targets of the trucks: read with the statistics, edited with the settings. */
@Controller('vehicle-targets')
@RequireFeature(Feature.DISTRIBUTION_STATS)
export class VehicleTargetsController {
  constructor(private readonly targets: VehicleTargetsService) {}

  @Get()
  @RequirePermission(Permission.REPORTS_VIEW)
  list(
    @Query(new ZodValidationPipe(vehicleTargetsQuerySchema)) query: VehicleTargetsQuery,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<VehicleTargetsDto> {
    return this.targets.list(query.period, user);
  }

  @Put()
  @RequirePermission(Permission.SETTINGS_EDIT)
  put(
    @Body(new ZodValidationPipe(putVehicleTargetsSchema)) body: PutVehicleTargetsInput,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<VehicleTargetsDto> {
    return this.targets.put(body, user);
  }

  @Post('copy-previous')
  @HttpCode(HttpStatus.OK)
  @RequirePermission(Permission.SETTINGS_EDIT)
  copyPrevious(
    @Body(new ZodValidationPipe(copyVehicleTargetsSchema)) body: CopyVehicleTargetsInput,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<VehicleTargetsDto & { copied: number }> {
    return this.targets.copyPrevious(body, user);
  }
}
