import { Module } from '@nestjs/common';
import { DocumentsModule } from '../documents/documents.module';
import { InventoriesService } from './inventories.service';
import { InventoriesController, StockController } from './stock.controllers';
import { StockOperationsService } from './stock-operations.service';
import { StockQueriesService } from './stock-queries.service';
import { StockService } from './stock.service';

/**
 * Stock ledger. Other modules (purchases, sales) use StockService.applyMovements only;
 * the dashboard reads StockQueriesService.
 */
@Module({
  imports: [DocumentsModule],
  controllers: [StockController, InventoriesController],
  providers: [StockService, StockOperationsService, StockQueriesService, InventoriesService],
  exports: [StockService, StockQueriesService],
})
export class StockModule {}
