import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { ClientsModule } from '../clients/clients.module';
import { SalesForceModule } from '../sales-force/sales-force.module';
import { GeoCheckService } from './geo-check.service';
import { GeoChecksController } from './geo-checks.controller';
import { GeoChecksService } from './geo-checks.service';

/**
 * Géolocalisation (phase 17, GEO_CHECK). Sales, versements and visits call
 * GeoCheckService inside their own transaction; the client's point lives in ClientsModule.
 */
@Module({
  imports: [BillingModule, ClientsModule, SalesForceModule],
  controllers: [GeoChecksController],
  providers: [GeoCheckService, GeoChecksService],
  exports: [GeoCheckService],
})
export class GeoModule {}
