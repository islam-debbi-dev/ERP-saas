import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { DocumentsModule } from '../documents/documents.module';
import { InventoriesService } from './inventories.service';
import { InventoriesController, StockController } from './stock.controllers';
import { StockOperationsService } from './stock-operations.service';
import { StockQueriesService } from './stock-queries.service';
import { StockTransfersService } from './stock-transfers.service';
import { StockService } from './stock.service';
import { StockTransfersController, WarehousesController } from './warehouses.controllers';
import { WarehousesService } from './warehouses.service';

/**
 * Stock ledger. Other modules (purchases, sales) use StockService.applyMovements only, with
 * the dépôt from WarehousesService; the dashboard reads StockQueriesService.
 */
@Module({
  imports: [DocumentsModule, BillingModule],
  controllers: [
    StockController,
    InventoriesController,
    WarehousesController,
    StockTransfersController,
  ],
  providers: [
    StockService,
    StockOperationsService,
    StockQueriesService,
    InventoriesService,
    WarehousesService,
    StockTransfersService,
  ],
  exports: [StockService, StockQueriesService, WarehousesService, StockTransfersService],
})
export class StockModule {}
