import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { BillingModule } from '../billing/billing.module';
import { ClientsModule } from '../clients/clients.module';
import { HrCoreModule } from '../hr/hr-core.module';
import { HrModule } from '../hr/hr.module';
import { PackagingModule } from '../packaging/packaging.module';
import { PurchasesModule } from '../purchases/purchases.module';
import { StockModule } from '../stock/stock.module';
import { ImportFilesJanitor } from './import-files.janitor';
import { ImportsController } from './imports.controller';
import { ImportsService } from './imports.service';

/**
 * Excel / CSV imports. Writes only through CatalogService, StockService and the clients
 * and suppliers services.
 */
@Module({
  imports: [
    BillingModule,
    CatalogModule,
    StockModule,
    ClientsModule,
    HrCoreModule,
    HrModule,
    PurchasesModule,
    PackagingModule,
  ],
  controllers: [ImportsController],
  providers: [ImportsService, ImportFilesJanitor],
})
export class ImportsModule {}
