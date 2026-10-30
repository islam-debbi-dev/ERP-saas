import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import {
  Feature,
  type GeoCheckDto,
  type GeoCheckListQuery,
  geoCheckListQuerySchema,
  type GeoCheckPage,
  type GeoReportDto,
  type GeoReportQuery,
  geoReportQuerySchema,
  type ReviewGeoCheckInput,
  reviewGeoCheckSchema,
  Role,
} from '@erp/shared';
import type { CurrentUserInfo } from '../auth/auth.types';
import { CurrentUser, RequireFeature, Roles } from '../auth/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { GeoChecksService } from './geo-checks.service';

const MANAGERS = [Role.OWNER, Role.MANAGER];
/** A supervisor follows his team's flags; only managers give the verdict. */
const VIEWERS = [...MANAGERS, Role.SUPERVISOR];

@Controller('geo-checks')
@RequireFeature(Feature.GEO_CHECK)
export class GeoChecksController {
  constructor(private readonly checks: GeoChecksService) {}

  @Get()
  @Roles(...VIEWERS)
  list(
    @Query(new ZodValidationPipe(geoCheckListQuerySchema)) query: GeoCheckListQuery,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<GeoCheckPage> {
    return this.checks.list(query, user);
  }

  // Declared before ':id'.
  @Get('report')
  @Roles(...VIEWERS)
  report(
    @Query(new ZodValidationPipe(geoReportQuerySchema)) query: GeoReportQuery,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<GeoReportDto> {
    return this.checks.report(query.month, user);
  }

  @Get(':id')
  @Roles(...VIEWERS)
  get(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<GeoCheckDto> {
    return this.checks.get(id, user);
  }

  @Post(':id/review')
  @Roles(...MANAGERS)
  @HttpCode(HttpStatus.OK)
  review(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(reviewGeoCheckSchema)) body: ReviewGeoCheckInput,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<GeoCheckDto> {
    return this.checks.review(id, body, user);
  }
}
