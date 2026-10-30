import { Module } from '@nestjs/common';
import { StockModule } from '../stock/stock.module';
import { ClientsModule } from '../clients/clients.module';
import { PaymentsModule } from '../payments/payments.module';
import { PurchasesModule } from '../purchases/purchases.module';
import { SalesModule } from '../sales/sales.module';
import { TenantsModule } from '../tenants/tenants.module';
import { TourneesModule } from '../tournees/tournees.module';
import { PdfRendererService } from './pdf-renderer.service';
import {
  DocumentsPrintController,
  PublicShareController,
  ReceiptPrintController,
  ShareLinksController,
  StatementPrintController,
  SupplierStatementPrintController,
} from './printing.controller';
import { PrintingService } from './printing.service';
import { ShareLinksService } from './share-links.service';

/**
 * Printed documents (PDF A4/A5) and their share links (phase 21). Reads documents only
 * through their modules' services.
 */
@Module({
  imports: [
    TenantsModule,
    SalesModule,
    PurchasesModule,
    PaymentsModule,
    ClientsModule,
    StockModule,
    TourneesModule,
  ],
  controllers: [
    DocumentsPrintController,
    StatementPrintController,
    ReceiptPrintController,
    SupplierStatementPrintController,
    ShareLinksController,
    PublicShareController,
  ],
  providers: [PrintingService, PdfRendererService, ShareLinksService],
})
export class PrintingModule {}
