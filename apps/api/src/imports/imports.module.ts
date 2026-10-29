import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { ClientsModule } from '../clients/clients.module';
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
  imports: [CatalogModule, StockModule, ClientsModule, PurchasesModule],
  controllers: [ImportsController],
  providers: [ImportsService, ImportFilesJanitor],
})
export class ImportsModule {}
