import { Module } from '@nestjs/common';
import { CreditModule } from '../credit/credit.module';
import { SalesForceModule } from '../sales-force/sales-force.module';
import { ClientAccountService } from './client-account.service';
import { ClientsController } from './clients.controller';
import { ClientsService } from './clients.service';

/** Clients and their account. Sales and versements use ClientAccountService only. */
@Module({
  imports: [CreditModule, SalesForceModule],
  controllers: [ClientsController],
  providers: [ClientsService, ClientAccountService],
  exports: [ClientAccountService, ClientsService],
})
export class ClientsModule {}
