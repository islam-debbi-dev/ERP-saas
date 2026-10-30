import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import {
  type ClientLocationDto,
  type ClientLocationInput,
  clientLocationSchema,
  Feature,
  type LocationRequestDto,
  type LocationRequestInput,
  type LocationRequestListQuery,
  locationRequestListQuerySchema,
  locationRequestSchema,
  type RejectLocationRequestInput,
  rejectLocationRequestSchema,
  Role,
} from '@erp/shared';
import type { CurrentUserInfo } from '../auth/auth.types';
import { CurrentUser, RequireFeature, Roles } from '../auth/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ClientLocationService } from './client-location.service';

/** Who stands at a client's door. Who may move a saved point is checked in the service. */
const FIELD_AND_OFFICE = [Role.OWNER, Role.MANAGER, Role.SUPERVISOR, Role.SELLER, Role.LIVREUR];
const DECIDERS = [Role.OWNER, Role.MANAGER, Role.SUPERVISOR];

@Controller('clients/:id')
@RequireFeature(Feature.GEO_CHECK)
export class ClientLocationController {
  constructor(private readonly locations: ClientLocationService) {}

  @Patch('location')
  @Roles(...FIELD_AND_OFFICE)
  set(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(clientLocationSchema)) body: ClientLocationInput,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<ClientLocationDto> {
    return this.locations.set(id, body, user);
  }

  @Post('location-requests')
  @Roles(...FIELD_AND_OFFICE)
  request(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(locationRequestSchema)) body: LocationRequestInput,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<LocationRequestDto> {
    return this.locations.request(id, body, user);
  }
}

@Controller('location-requests')
@RequireFeature(Feature.GEO_CHECK)
export class LocationRequestsController {
  constructor(private readonly locations: ClientLocationService) {}

  @Get()
  list(
    @Query(new ZodValidationPipe(locationRequestListQuerySchema)) query: LocationRequestListQuery,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<LocationRequestDto[]> {
    return this.locations.listRequests(query, user);
  }

  @Post(':id/approve')
  @Roles(...DECIDERS)
  approve(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<LocationRequestDto> {
    return this.locations.approve(id, user);
  }

  @Post(':id/reject')
  @Roles(...DECIDERS)
  reject(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(rejectLocationRequestSchema)) body: RejectLocationRequestInput,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<LocationRequestDto> {
    return this.locations.reject(id, body.reason, user);
  }
}
