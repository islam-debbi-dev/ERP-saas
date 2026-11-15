import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { DocumentsModule } from '../documents/documents.module';
import { SalesForceModule } from '../sales-force/sales-force.module';
import { InventoriesService } from './inventories.service';
import { InventoriesController, StockController } from './stock.controllers';
import { StockOperationsService } from './stock-operations.service';
import { StockQueriesService } from './stock-queries.service';
import { StockTransfersService } from './stock-transfers.service';
import { StockService } from './stock.service';
import { UnitBackfillService } from './unit-backfill.service';
import { WarehouseBackfillService } from './warehouse-backfill.service';
import { StockTransfersController, WarehousesController } from './warehouses.controllers';
import { VehicleBackfillService } from './vehicle-backfill.service';
import { VehicleTypesService } from './vehicle-types.service';
import { UserVehiclesController, VehicleTypesController } from './vehicles.controllers';
import { VehiclesService } from './vehicles.service';
import { WarehousesService } from './warehouses.service';

/**
 * Stock ledger. Other modules (purchases, sales) use StockService.applyMovements only, with
 * the dépôt from WarehousesService; the dashboard reads StockQueriesService. Trucks, their
 * drivers and the driver history belong to VehiclesService (phase 36).
 */
@Module({
  imports: [DocumentsModule, BillingModule, SalesForceModule],
  controllers: [
    StockController,
    InventoriesController,
    WarehousesController,
    StockTransfersController,
    VehicleTypesController,
    UserVehiclesController,
  ],
  providers: [
    StockService,
    StockOperationsService,
    StockQueriesService,
    InventoriesService,
    WarehousesService,
    StockTransfersService,
    WarehouseBackfillService,
    UnitBackfillService,
    VehiclesService,
    VehicleTypesService,
    VehicleBackfillService,
  ],
  exports: [
    StockService,
    StockQueriesService,
    WarehousesService,
    StockTransfersService,
    VehiclesService,
  ],
})
export class StockModule {}
