import { Module } from '@nestjs/common';
import { CreditModule } from '../credit/credit.module';
import { SalesForceModule } from '../sales-force/sales-force.module';
import { StockModule } from '../stock/stock.module';
import { ClientAccountService } from './client-account.service';
import { ClientLocationController, LocationRequestsController } from './client-location.controller';
import { ClientLocationService } from './client-location.service';
import { ClientMapService } from './client-map.service';
import { ClientSegmentsController } from './client-segments.controller';
import { ClientSegmentsService } from './client-segments.service';
import { ClientsController } from './clients.controller';
import { ClientsService } from './clients.service';

/** Clients and their account. Sales and versements use ClientAccountService only. */
@Module({
  imports: [CreditModule, SalesForceModule, StockModule],
  controllers: [
    ClientSegmentsController,
    ClientsController,
    ClientLocationController,
    LocationRequestsController,
  ],
  providers: [
    ClientsService,
    ClientAccountService,
    ClientLocationService,
    ClientMapService,
    ClientSegmentsService,
  ],
  exports: [ClientAccountService, ClientsService, ClientLocationService, ClientSegmentsService],
})
export class ClientsModule {}
