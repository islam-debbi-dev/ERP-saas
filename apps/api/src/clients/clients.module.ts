import { Module } from '@nestjs/common';
import { ClientAccountService } from './client-account.service';
import { ClientsController } from './clients.controller';
import { ClientsService } from './clients.service';

/** Clients and their account. Sales and versements use ClientAccountService only. */
@Module({
  controllers: [ClientsController],
  providers: [ClientsService, ClientAccountService],
  exports: [ClientAccountService],
})
export class ClientsModule {}
