import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { ScopeService } from './scope.service';
import { SectorsController } from './sectors.controller';
import { SectorsService } from './sectors.service';

/**
 * Sales force (phase 14): sectors and the data scope of sellers and supervisors.
 * ScopeService is used by clients, sales, payments and reports.
 */
@Module({
  imports: [BillingModule],
  controllers: [SectorsController],
  providers: [ScopeService, SectorsService],
  exports: [ScopeService, SectorsService],
})
export class SalesForceModule {}
