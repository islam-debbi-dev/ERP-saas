import { Module } from '@nestjs/common';
import { ClientsModule } from '../clients/clients.module';
import { PaymentsModule } from '../payments/payments.module';
import { PurchasesModule } from '../purchases/purchases.module';
import { SalesModule } from '../sales/sales.module';
import { TenantsModule } from '../tenants/tenants.module';
import { PdfRendererService } from './pdf-renderer.service';
import {
  DocumentsPrintController,
  ReceiptPrintController,
  StatementPrintController,
} from './printing.controller';
import { PrintingService } from './printing.service';

/** Printed documents (PDF A4/A5). Reads documents only through their modules' services. */
@Module({
  imports: [TenantsModule, SalesModule, PurchasesModule, PaymentsModule, ClientsModule],
  controllers: [DocumentsPrintController, StatementPrintController, ReceiptPrintController],
  providers: [PrintingService, PdfRendererService],
})
export class PrintingModule {}
