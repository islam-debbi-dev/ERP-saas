import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { DocumentsModule } from '../documents/documents.module';
import { StockModule } from '../stock/stock.module';
import { PurchaseWorkflowService } from './purchase-workflow.service';
import { PurchasesController, SuppliersController } from './purchases.controllers';
import { PurchasesService } from './purchases.service';
import { SuppliersService } from './suppliers.service';

/** Suppliers and bons de réception. Stock changes go through StockService only. */
@Module({
  imports: [StockModule, CatalogModule, DocumentsModule],
  controllers: [SuppliersController, PurchasesController],
  providers: [SuppliersService, PurchasesService, PurchaseWorkflowService],
  exports: [PurchasesService],
})
export class PurchasesModule {}
