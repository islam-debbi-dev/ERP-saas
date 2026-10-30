import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { SalesForceModule } from '../sales-force/sales-force.module';
import { ClientPackagingController, PackagingTypesController } from './packaging.controllers';
import { PackagingLedgerService } from './packaging-ledger.service';
import { PackagingService } from './packaging.service';

/** Emballages consignés (phase 20): counts per client, no money. */
@Module({
  imports: [BillingModule, SalesForceModule],
  controllers: [PackagingTypesController, ClientPackagingController],
  providers: [PackagingLedgerService, PackagingService],
  exports: [PackagingLedgerService, PackagingService],
})
export class PackagingModule {}
