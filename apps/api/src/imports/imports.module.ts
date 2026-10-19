import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { ClientsModule } from '../clients/clients.module';
import { StockModule } from '../stock/stock.module';
import { ImportFilesJanitor } from './import-files.janitor';
import { ImportsController } from './imports.controller';
import { ImportsService } from './imports.service';

/** Excel / CSV imports. Writes only through CatalogService, StockService and the clients services. */
@Module({
  imports: [CatalogModule, StockModule, ClientsModule],
  controllers: [ImportsController],
  providers: [ImportsService, ImportFilesJanitor],
})
export class ImportsModule {}
