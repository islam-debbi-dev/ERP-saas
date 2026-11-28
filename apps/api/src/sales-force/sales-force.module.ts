import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { ClockModule } from '../clock/clock.module';
import { ScopeService } from './scope.service';
import { SectorsController } from './sectors.controller';
import { SectorsService } from './sectors.service';
import { SellerZonesService } from './seller-zones.service';
import { FieldZonesController, SellerZonesController } from './zones.controllers';
import { ZonesService } from './zones.service';

/**
 * Sales force (phase 14): sectors and the data scope of sellers and supervisors.
 * ScopeService is used by clients, sales, payments and reports.
 */
@Module({
  imports: [BillingModule, ClockModule],
  controllers: [SectorsController, FieldZonesController, SellerZonesController],
  providers: [ScopeService, SectorsService, ZonesService, SellerZonesService],
  exports: [ScopeService, SectorsService],
})
export class SalesForceModule {}
