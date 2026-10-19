import { Module } from '@nestjs/common';
import { ClientsModule } from '../clients/clients.module';
import { DocumentsModule } from '../documents/documents.module';
import { ClientPaymentsController, PaymentsController } from './payments.controllers';
import { PaymentsService } from './payments.service';

/** Versements. Sales record the part paid at sale time through PaymentsService. */
@Module({
  imports: [ClientsModule, DocumentsModule],
  controllers: [PaymentsController, ClientPaymentsController],
  providers: [PaymentsService],
  exports: [PaymentsService],
})
export class PaymentsModule {}
