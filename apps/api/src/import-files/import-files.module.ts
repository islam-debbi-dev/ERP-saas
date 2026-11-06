import { Module } from '@nestjs/common';
import { TreasuryModule } from '../treasury/treasury.module';
import { DocumentsModule } from '../documents/documents.module';
import { PurchasesModule } from '../purchases/purchases.module';
import { StockModule } from '../stock/stock.module';
import { ImportFilesController } from './import-files.controller';
import { ImportFilesService } from './import-files.service';

/**
 * Dossiers d'importation and coût de revient (phase 22, IMPORT_COSTS). Stock goes through
 * StockService, supplier accounts through SupplierAccountService.
 */
@Module({
  imports: [StockModule, PurchasesModule, DocumentsModule, TreasuryModule],
  controllers: [ImportFilesController],
  providers: [ImportFilesService],
  exports: [ImportFilesService],
})
export class ImportFilesModule {}
