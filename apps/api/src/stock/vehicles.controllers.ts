import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  type CreateVehicleTypeInput,
  createVehicleTypeSchema,
  Feature,
  Permission,
  type UpdateVehicleTypeInput,
  updateVehicleTypeSchema,
  type VehicleAssignmentListQuery,
  vehicleAssignmentListQuerySchema,
  type VehicleTypeDto,
  type WorkerVehiclePage,
} from '@erp/shared';
import type { CurrentUserInfo } from '../auth/auth.types';
import { CurrentUser, RequireFeature, RequirePermission } from '../auth/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { VehicleTypesService } from './vehicle-types.service';
import { VehiclesService } from './vehicles.service';

/** The company's own kinds of trucks (phase 36). Pickers read them; settings edit them. */
@Controller('vehicle-types')
@RequireFeature(Feature.WAREHOUSES)
export class VehicleTypesController {
  constructor(private readonly types: VehicleTypesService) {}

  @Get()
  list(): Promise<VehicleTypeDto[]> {
    return this.types.list();
  }

  @Post()
  @RequirePermission(Permission.SETTINGS_EDIT)
  create(
    @Body(new ZodValidationPipe(createVehicleTypeSchema)) body: CreateVehicleTypeInput,
  ): Promise<VehicleTypeDto> {
    return this.types.create(body);
  }

  @Patch(':id')
  @RequirePermission(Permission.SETTINGS_EDIT)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateVehicleTypeSchema)) body: UpdateVehicleTypeInput,
  ): Promise<VehicleTypeDto> {
    return this.types.update(id, body);
  }

  @Post(':id/archive')
  @RequirePermission(Permission.SETTINGS_EDIT)
  @HttpCode(HttpStatus.NO_CONTENT)
  archive(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.types.archive(id);
  }
}

/**
 * The trucks a worker drove (phase 36). Under `/users` for the reader, but owned by the
 * stock module: the history is `vehicle_assignments` and nothing else.
 */
@Controller('users')
@RequireFeature(Feature.WAREHOUSES)
export class UserVehiclesController {
  constructor(private readonly vehicles: VehiclesService) {}

  @Get(':id/vehicle-assignments')
  list(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodValidationPipe(vehicleAssignmentListQuerySchema))
    query: VehicleAssignmentListQuery,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<WorkerVehiclePage> {
    return this.vehicles.vehiclesOf(id, query, user);
  }
}
