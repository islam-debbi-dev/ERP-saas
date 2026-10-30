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
  type CancelStockTransferInput,
  cancelStockTransferSchema,
  type CreateStockTransferInput,
  createStockTransferSchema,
  type CreateWarehouseInput,
  createWarehouseSchema,
  Feature,
  Role,
  type StockTransferDto,
  type StockTransferListQuery,
  stockTransferListQuerySchema,
  type StockTransferPage,
  type UpdateStockTransferInput,
  updateStockTransferSchema,
  type UpdateWarehouseInput,
  updateWarehouseSchema,
  type WarehouseDto,
} from '@erp/shared';
import { RequireFeature, Roles } from '../auth/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { Idempotent } from '../idempotency/idempotent.decorator';
import { StockTransfersService, type TransferResult } from './stock-transfers.service';
import { WarehousesService } from './warehouses.service';

const MANAGERS = [Role.OWNER, Role.MANAGER];
/** Who loads and unloads the trucks. */
const STOCK_MOVERS = [Role.OWNER, Role.MANAGER, Role.STOREKEEPER];

@Controller('warehouses')
export class WarehousesController {
  constructor(private readonly warehouses: WarehousesService) {}

  /** Open to every role and without the module (it then lists the main dépôt only). */
  @Get()
  list(): Promise<WarehouseDto[]> {
    return this.warehouses.list();
  }

  @Post()
  @RequireFeature(Feature.WAREHOUSES)
  @Roles(...MANAGERS)
  create(
    @Body(new ZodValidationPipe(createWarehouseSchema)) body: CreateWarehouseInput,
  ): Promise<WarehouseDto> {
    return this.warehouses.create(body);
  }

  @Patch(':id')
  @RequireFeature(Feature.WAREHOUSES)
  @Roles(...MANAGERS)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateWarehouseSchema)) body: UpdateWarehouseInput,
  ): Promise<WarehouseDto> {
    return this.warehouses.update(id, body);
  }

  @Delete(':id')
  @RequireFeature(Feature.WAREHOUSES)
  @Roles(...MANAGERS)
  @HttpCode(HttpStatus.NO_CONTENT)
  archive(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.warehouses.archive(id);
  }
}

@Controller('stock-transfers')
@RequireFeature(Feature.WAREHOUSES)
@Roles(...STOCK_MOVERS)
export class StockTransfersController {
  constructor(private readonly transfers: StockTransfersService) {}

  @Get()
  list(
    @Query(new ZodValidationPipe(stockTransferListQuerySchema)) query: StockTransferListQuery,
  ): Promise<StockTransferPage> {
    return this.transfers.list(query);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string): Promise<StockTransferDto> {
    return this.transfers.get(id);
  }

  @Post()
  @Idempotent()
  create(
    @Body(new ZodValidationPipe(createStockTransferSchema)) body: CreateStockTransferInput,
  ): Promise<StockTransferDto> {
    return this.transfers.create(body);
  }

  @Put(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateStockTransferSchema)) body: UpdateStockTransferInput,
  ): Promise<StockTransferDto> {
    return this.transfers.update(id, body);
  }

  @Post(':id/validate')
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  validate(@Param('id', ParseUUIDPipe) id: string): Promise<TransferResult> {
    return this.transfers.validate(id);
  }

  @Post(':id/cancel')
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(cancelStockTransferSchema)) body: CancelStockTransferInput,
  ): Promise<TransferResult> {
    return this.transfers.cancel(id, body.reason);
  }
}
