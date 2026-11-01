import { Module } from '@nestjs/common';
import { ClientsModule } from '../clients/clients.module';
import { DocumentsModule } from '../documents/documents.module';
import { GeoModule } from '../geo/geo.module';
import { SalesForceModule } from '../sales-force/sales-force.module';
import { StockModule } from '../stock/stock.module';
import { ClientPaymentsController, PaymentsController } from './payments.controllers';
import { PaymentsService } from './payments.service';

/** Versements. Sales record the part paid at sale time through PaymentsService. */
@Module({
  imports: [ClientsModule, DocumentsModule, SalesForceModule, GeoModule, StockModule],
  controllers: [PaymentsController, ClientPaymentsController],
  providers: [PaymentsService],
  exports: [PaymentsService],
})
export class PaymentsModule {}
