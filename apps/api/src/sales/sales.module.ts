import { Module } from '@nestjs/common';
import { ClientsModule } from '../clients/clients.module';
import { DocumentsModule } from '../documents/documents.module';
import { PaymentsModule } from '../payments/payments.module';
import { GeoModule } from '../geo/geo.module';
import { SalesForceModule } from '../sales-force/sales-force.module';
import { StockModule } from '../stock/stock.module';
import { SaleWorkflowService } from './sale-workflow.service';
import { InvoicesController, SalesController } from './sales.controllers';
import { SalesService } from './sales.service';

/** BL, factures, avoirs. Stock and client accounts change only through their services. */
@Module({
  imports: [
    StockModule,
    ClientsModule,
    DocumentsModule,
    PaymentsModule,
    SalesForceModule,
    GeoModule,
  ],
  controllers: [SalesController, InvoicesController],
  providers: [SalesService, SaleWorkflowService],
  exports: [SalesService, SaleWorkflowService],
})
export class SalesModule {}
