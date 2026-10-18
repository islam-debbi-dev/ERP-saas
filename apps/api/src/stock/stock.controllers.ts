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
  adjustmentSchema,
  type CreateInventoryInput,
  createInventorySchema,
  type CursorQuery,
  cursorQuerySchema,
  type InventoryDto,
  type InventoryLinesInput,
  inventoryLinesSchema,
  type InventorySummaryDto,
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
import { Roles } from '../auth/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { Idempotent } from '../idempotency/idempotent.decorator';
import { InventoriesService } from './inventories.service';
import { StockOperationsService } from './stock-operations.service';
import { StockQueriesService } from './stock-queries.service';

/** Stock-changing actions: manager and above (AGENTS: adjustments are MANAGER+). */
const STOCK_WRITERS = [Role.OWNER, Role.MANAGER];

@Controller('stock')
export class StockController {
  constructor(
    private readonly queries: StockQueriesService,
    private readonly operations: StockOperationsService,
  ) {}

  @Get()
  list(
    @Query(new ZodValidationPipe(stockListQuerySchema)) query: StockListQuery,
  ): Promise<StockPage> {
    return this.queries.list(query);
  }

  // Declared before ':productId' so "reconcile" is not parsed as an id.
  @Get('reconcile')
  @Roles(Role.OWNER)
  reconcile(): Promise<ReconcileReport> {
    return this.queries.reconcile();
  }

  @Get(':productId')
  level(@Param('productId', ParseUUIDPipe) productId: string): Promise<StockLevelDto> {
    return this.queries.level(productId);
  }

  @Get(':productId/movements')
  movements(
    @Param('productId', ParseUUIDPipe) productId: string,
    @Query(new ZodValidationPipe(cursorQuerySchema)) query: CursorQuery,
  ): Promise<StockMovementPage> {
    return this.queries.movements(productId, query);
  }

  @Post('opening')
  @Idempotent()
  @Roles(...STOCK_WRITERS)
  opening(
    @Body(new ZodValidationPipe(openingStockSchema)) body: OpeningStockInput,
  ): Promise<StockOperationResult> {
    return this.operations.opening(body);
  }

  @Post('adjustments')
  @Idempotent()
  @Roles(...STOCK_WRITERS)
  adjust(
    @Body(new ZodValidationPipe(adjustmentSchema)) body: AdjustmentInput,
  ): Promise<StockOperationResult> {
    return this.operations.adjust(body);
  }
}

@Controller('inventories')
export class InventoriesController {
  constructor(private readonly inventories: InventoriesService) {}

  @Get()
  list(): Promise<InventorySummaryDto[]> {
    return this.inventories.list();
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string): Promise<InventoryDto> {
    return this.inventories.get(id);
  }

  /** Counting is open to storekeepers; validating needs a manager. */
  @Post()
  @Idempotent()
  @Roles(...STOCK_WRITERS, Role.STOREKEEPER)
  create(
    @Body(new ZodValidationPipe(createInventorySchema)) body: CreateInventoryInput,
  ): Promise<InventoryDto> {
    return this.inventories.create(body);
  }

  @Put(':id/lines')
  @Roles(...STOCK_WRITERS, Role.STOREKEEPER)
  setLines(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(inventoryLinesSchema)) body: InventoryLinesInput,
  ): Promise<InventoryDto> {
    return this.inventories.setLines(id, body);
  }

  @Post(':id/validate')
  @Idempotent()
  @Roles(...STOCK_WRITERS)
  @HttpCode(HttpStatus.OK)
  validate(@Param('id', ParseUUIDPipe) id: string): Promise<InventoryDto> {
    return this.inventories.validate(id);
  }

  @Post(':id/cancel')
  @Idempotent()
  @Roles(...STOCK_WRITERS)
  @HttpCode(HttpStatus.OK)
  cancel(@Param('id', ParseUUIDPipe) id: string): Promise<InventoryDto> {
    return this.inventories.cancel(id);
  }
}
