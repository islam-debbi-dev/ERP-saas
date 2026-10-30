import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { CatalogModule } from '../catalog/catalog.module';
import { DocumentsModule } from '../documents/documents.module';
import { StockModule } from '../stock/stock.module';
import { ImportCostsGate } from './import-costs-gate';
import { PurchaseWorkflowService } from './purchase-workflow.service';
import {
  PurchasesController,
  SupplierPaymentsController,
  SuppliersController,
} from './purchases.controllers';
import { PurchasesService } from './purchases.service';
import { SupplierAccountService } from './supplier-account.service';
import { SupplierBackfillService } from './supplier-backfill.service';
import { SupplierPaymentsService } from './supplier-payments.service';
import { SuppliersService } from './suppliers.service';

/**
 * Suppliers, bons de réception and supplier accounts (phase 21). Stock changes go through
 * StockService only; supplier account entries through SupplierAccountService only.
 */
@Module({
  imports: [StockModule, CatalogModule, DocumentsModule, BillingModule],
  controllers: [SuppliersController, PurchasesController, SupplierPaymentsController],
  providers: [
    SuppliersService,
    PurchasesService,
    PurchaseWorkflowService,
    SupplierAccountService,
    SupplierPaymentsService,
    SupplierBackfillService,
    ImportCostsGate,
  ],
  exports: [
    PurchasesService,
    PurchaseWorkflowService,
    SuppliersService,
    SupplierAccountService,
    ImportCostsGate,
  ],
})
export class PurchasesModule {}
