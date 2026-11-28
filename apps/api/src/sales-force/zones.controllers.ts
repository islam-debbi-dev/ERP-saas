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
} from '@nestjs/common';
import {
  type AssignSellerZoneInput,
  assignSellerZoneSchema,
  type CreateZoneInput,
  createZoneSchema,
  Feature,
  Role,
  type SellerZoneAssignmentDto,
  type SellerZoneAssignmentPage,
  TEAM_LEAD_ROLES,
  type UpdateZoneInput,
  updateZoneSchema,
  type ZoneAssignmentQuery,
  zoneAssignmentQuerySchema,
  type ZoneDto,
} from '@erp/shared';
import type { CurrentUserInfo } from '../auth/auth.types';
import { CurrentUser, RequireFeature, Roles } from '../auth/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { SellerZonesService } from './seller-zones.service';
import { ZonesService } from './zones.service';

const MANAGERS = [Role.OWNER, Role.MANAGER];
/** Who reads zones and assigns sellers: the office and the team leads. */
const LEADS = [...MANAGERS, ...TEAM_LEAD_ROLES];

/** Field zones (phase 40b). A team lead reads his own; only the office writes. */
@Controller('field-zones')
@RequireFeature(Feature.SALES_FORCE)
export class FieldZonesController {
  constructor(private readonly zones: ZonesService) {}

  @Get()
  @Roles(...LEADS)
  list(@CurrentUser() user: CurrentUserInfo): Promise<ZoneDto[]> {
    return this.zones.list(user);
  }

  @Get(':id')
  @Roles(...LEADS)
  get(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<ZoneDto> {
    return this.zones.get(id, user);
  }

  @Post()
  @Roles(...MANAGERS)
  create(
    @Body(new ZodValidationPipe(createZoneSchema)) body: CreateZoneInput,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<ZoneDto> {
    return this.zones.create(body, user);
  }

  @Put(':id')
  @Roles(...MANAGERS)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateZoneSchema)) body: UpdateZoneInput,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<ZoneDto> {
    return this.zones.update(id, body, user);
  }

  @Delete(':id')
  @Roles(...MANAGERS)
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.zones.remove(id);
  }
}

/** Where a seller or pré-vendeur works (phase 40b). */
@Controller('users')
@RequireFeature(Feature.SALES_FORCE)
export class SellerZonesController {
  constructor(private readonly assignments: SellerZonesService) {}

  @Post(':id/zone-assignment')
  @Roles(...LEADS)
  assign(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(assignSellerZoneSchema)) body: AssignSellerZoneInput,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<SellerZoneAssignmentDto> {
    return this.assignments.assign(id, body, user);
  }

  /** His own history, or that of someone the caller leads (checked in the service). */
  @Get(':id/zone-assignments')
  history(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodValidationPipe(zoneAssignmentQuerySchema)) query: ZoneAssignmentQuery,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<SellerZoneAssignmentPage> {
    return this.assignments.history(id, query, user);
  }
}
