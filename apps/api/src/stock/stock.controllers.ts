import {
  Body,
  Controller,
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
  type AdjustmentInput,
  Permission,
  adjustmentSchema,
  type CreateInventoryInput,
  createInventorySchema,
  type InventoryDto,
  type InventoryLinesInput,
  inventoryLinesSchema,
  type InventorySummaryDto,
  type MovementQuery,
  movementQuerySchema,
  type OpeningStockInput,
  openingStockSchema,
  type ReconcileReport,
  Role,
  type StockLevelDto,
  type StockListQuery,
  stockListQuerySchema,
  type StockMovementPage,
  type StockOperationResult,
  type StockPage,
} from '@erp/shared';
import type { CurrentUserInfo } from '../auth/auth.types';
import { CurrentUser, RequirePermission, Roles } from '../auth/decorators';
import { can } from '../auth/permissions';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { Idempotent } from '../idempotency/idempotent.decorator';
import { ScopeService } from '../sales-force/scope.service';
import { InventoriesService } from './inventories.service';
import { StockOperationsService } from './stock-operations.service';
import { StockQueriesService } from './stock-queries.service';
import { WarehousesService } from './warehouses.service';

@Controller('stock')
export class StockController {
  constructor(
    private readonly queries: StockQueriesService,
    private readonly operations: StockOperationsService,
    private readonly warehouses: WarehousesService,
    private readonly scope: ScopeService,
  ) {}

  /** The dépôts whose stock the user sees (phase 24); null = all. */
  private async reach(user: CurrentUserInfo): Promise<string[] | null> {
    return (await this.scope.warehouses(user)).warehouseIds;
  }

  @Get()
  @RequirePermission(Permission.STOCK_VIEW)
  async list(
    @Query(new ZodValidationPipe(stockListQuerySchema)) query: StockListQuery,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<StockPage> {
    return this.queries.list(
      query,
      can(user, Permission.VIEW_COST_AND_MARGIN),
      await this.warehouses.enabled(user.tenantId),
      await this.reach(user),
    );
  }

  // Declared before ':productId' so "reconcile" is not parsed as an id.
  @Get('reconcile')
  @Roles(Role.OWNER)
  reconcile(): Promise<ReconcileReport> {
    return this.queries.reconcile();
  }

  @Get(':productId')
  @RequirePermission(Permission.STOCK_VIEW)
  async level(
    @Param('productId', ParseUUIDPipe) productId: string,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<StockLevelDto> {
    return this.queries.level(
      productId,
      can(user, Permission.VIEW_COST_AND_MARGIN),
      await this.warehouses.enabled(user.tenantId),
      await this.reach(user),
    );
  }

  @Get(':productId/movements')
  @RequirePermission(Permission.STOCK_VIEW)
  async movements(
    @Param('productId', ParseUUIDPipe) productId: string,
    @Query(new ZodValidationPipe(movementQuerySchema)) query: MovementQuery,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<StockMovementPage> {
    return this.queries.movements(
      productId,
      query,
      can(user, Permission.VIEW_COST_AND_MARGIN),
      await this.reach(user),
    );
  }

  @Post('opening')
  @RequirePermission(Permission.STOCK_ADJUST)
  @Idempotent()
  opening(
    @Body(new ZodValidationPipe(openingStockSchema)) body: OpeningStockInput,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<StockOperationResult> {
    return this.operations.opening(body, user);
  }

  /** STOCK_ADJUST is checked in the service: it can be granted to any user. */
  @Post('adjustments')
  @Idempotent()
  adjust(
    @Body(new ZodValidationPipe(adjustmentSchema)) body: AdjustmentInput,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<StockOperationResult> {
    return this.operations.adjust(body, user);
  }
}

@Controller('inventories')
export class InventoriesController {
  constructor(private readonly inventories: InventoriesService) {}

  @Get()
  @RequirePermission(Permission.STOCK_VIEW)
  list(@CurrentUser() user: CurrentUserInfo): Promise<InventorySummaryDto[]> {
    return this.inventories.list(user);
  }

  @Get(':id')
  @RequirePermission(Permission.STOCK_VIEW)
  get(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<InventoryDto> {
    return this.inventories.get(id, user);
  }

  /** Counting is open to storekeepers; validating needs a manager. */
  @Post()
  @RequirePermission(Permission.STOCK_COUNT)
  @Idempotent()
  create(
    @Body(new ZodValidationPipe(createInventorySchema)) body: CreateInventoryInput,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<InventoryDto> {
    return this.inventories.create(body, user);
  }

  @Put(':id/lines')
  @RequirePermission(Permission.STOCK_COUNT)
  setLines(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(inventoryLinesSchema)) body: InventoryLinesInput,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<InventoryDto> {
    return this.inventories.setLines(id, body, user);
  }

  @Post(':id/validate')
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  validate(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<InventoryDto> {
    return this.inventories.validate(id, user);
  }

  @Post(':id/cancel')
  @RequirePermission(Permission.STOCK_ADJUST)
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<InventoryDto> {
    return this.inventories.cancel(id, user);
  }
}
