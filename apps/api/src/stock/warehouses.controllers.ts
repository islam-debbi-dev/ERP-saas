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
} from '@nestjs/common';
import {
  type AssignDriverInput,
  type AssignDriverResultDto,
  assignDriverSchema,
  type CancelStockTransferInput,
  cancelStockTransferSchema,
  type CreateStockTransferInput,
  createStockTransferSchema,
  type CreateWarehouseInput,
  createWarehouseSchema,
  Feature,
  Permission,
  type StockTransferDto,
  type StockTransferListQuery,
  stockTransferListQuerySchema,
  type StockTransferPage,
  type UpdateStockTransferInput,
  updateStockTransferSchema,
  type UpdateWarehouseInput,
  updateWarehouseSchema,
  type VehicleAssignmentListQuery,
  vehicleAssignmentListQuerySchema,
  type VehicleAssignmentPage,
  type WarehouseBrandsInput,
  warehouseBrandsSchema,
  type WarehouseCategoriesInput,
  warehouseCategoriesSchema,
  type WarehouseDetailDto,
  type WarehouseDto,
  type WarehouseListQuery,
  warehouseListQuerySchema,
  Role,
  TEAM_LEAD_ROLES,
} from '@erp/shared';
import type { CurrentUserInfo } from '../auth/auth.types';
import { CurrentUser, RequireFeature, RequirePermission, Roles } from '../auth/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { Idempotent } from '../idempotency/idempotent.decorator';
import { StockTransfersService, type TransferResult } from './stock-transfers.service';
import { VehiclesService } from './vehicles.service';
import { WarehousesService } from './warehouses.service';

@Controller('warehouses')
export class WarehousesController {
  constructor(
    private readonly warehouses: WarehousesService,
    private readonly vehicles: VehiclesService,
  ) {}

  /**
   * Open to every role and without the module (it then lists the main dépôt only). With
   * MULTI_UNIT, only the dépôts the user works in or sees figures of (phase 24).
   */
  @Get()
  list(
    @CurrentUser() user: CurrentUserInfo,
    @Query(new ZodValidationPipe(warehouseListQuerySchema)) query: WarehouseListQuery,
  ): Promise<WarehouseDto[]> {
    return this.warehouses.list(user, query);
  }

  /**
   * Today's driver of a truck (phase 36), in two taps: planners, for the trucks in their
   * reach. A driver who has another truck is moved, and that truck freed, in one go.
   */
  @Post(':id/driver')
  @Roles(Role.OWNER, Role.MANAGER, ...TEAM_LEAD_ROLES)
  @RequireFeature(Feature.WAREHOUSES)
  @HttpCode(HttpStatus.OK)
  // A replay after a later change must not put the old driver back (test-36 B-4).
  @Idempotent()
  changeDriver(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(assignDriverSchema)) body: AssignDriverInput,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<AssignDriverResultDto> {
    return this.vehicles.changeDriver(id, body, user);
  }

  /** Who drove this truck, from when, set by whom (phase 36). Newest first. */
  @Get(':id/assignments')
  @RequireFeature(Feature.WAREHOUSES)
  assignments(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodValidationPipe(vehicleAssignmentListQuerySchema))
    query: VehicleAssignmentListQuery,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<VehicleAssignmentPage> {
    return this.vehicles.assignments(id, query, user);
  }

  /** A dépôt with its brands, categories, team and trucks (phase 24). */
  @Get(':id')
  @RequireFeature(Feature.MULTI_UNIT)
  detail(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<WarehouseDetailDto> {
    return this.warehouses.detail(id, user);
  }

  @Post()
  @RequirePermission(Permission.SETTINGS_EDIT)
  @RequireFeature(Feature.WAREHOUSES)
  create(
    @Body(new ZodValidationPipe(createWarehouseSchema)) body: CreateWarehouseInput,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<WarehouseDto> {
    return this.warehouses.create(body, user);
  }

  @Patch(':id')
  @RequirePermission(Permission.SETTINGS_EDIT)
  @RequireFeature(Feature.WAREHOUSES)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateWarehouseSchema)) body: UpdateWarehouseInput,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<WarehouseDto> {
    return this.warehouses.update(id, body, user);
  }

  /** What a dépôt sells (phase 24): its brands, none = every brand. */
  @Put(':id/brands')
  @RequirePermission(Permission.SETTINGS_EDIT)
  @RequireFeature(Feature.MULTI_UNIT)
  setBrands(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(warehouseBrandsSchema)) body: WarehouseBrandsInput,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<WarehouseDetailDto> {
    return this.warehouses.setBrands(id, body, user);
  }

  /** What a dépôt sells (phase 24): its categories, sub-categories included. */
  @Put(':id/categories')
  @RequirePermission(Permission.SETTINGS_EDIT)
  @RequireFeature(Feature.MULTI_UNIT)
  setCategories(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(warehouseCategoriesSchema)) body: WarehouseCategoriesInput,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<WarehouseDetailDto> {
    return this.warehouses.setCategories(id, body, user);
  }

  @Delete(':id')
  @RequirePermission(Permission.SETTINGS_EDIT)
  @RequireFeature(Feature.WAREHOUSES)
  @HttpCode(HttpStatus.NO_CONTENT)
  archive(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<void> {
    return this.warehouses.archive(id, user);
  }
}

@Controller('stock-transfers')
@RequireFeature(Feature.WAREHOUSES)
@RequirePermission(Permission.STOCK_TRANSFER)
export class StockTransfersController {
  constructor(private readonly transfers: StockTransfersService) {}

  @Get()
  list(
    @Query(new ZodValidationPipe(stockTransferListQuerySchema)) query: StockTransferListQuery,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<StockTransferPage> {
    return this.transfers.list(query, user);
  }

  @Get(':id')
  get(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<StockTransferDto> {
    return this.transfers.get(id, user);
  }

  @Post()
  @Idempotent()
  create(
    @Body(new ZodValidationPipe(createStockTransferSchema)) body: CreateStockTransferInput,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<StockTransferDto> {
    return this.transfers.create(body, user);
  }

  @Put(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateStockTransferSchema)) body: UpdateStockTransferInput,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<StockTransferDto> {
    return this.transfers.update(id, body, user);
  }

  @Post(':id/validate')
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  validate(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<TransferResult> {
    return this.transfers.validate(id, user);
  }

  @Post(':id/cancel')
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(cancelStockTransferSchema)) body: CancelStockTransferInput,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<TransferResult> {
    return this.transfers.cancel(id, body.reason, user);
  }
}
