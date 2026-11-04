import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { DocumentsModule } from '../documents/documents.module';
import { HrCoreModule } from '../hr/hr-core.module';
import { SalesForceModule } from '../sales-force/sales-force.module';
import { StockModule } from '../stock/stock.module';
import { ChargesService } from './charges.service';
import { ExpenseCategoriesService } from './expense-categories.service';
import {
  ExpenseCategoriesController,
  ExpensesController,
  RentContractsController,
} from './expenses.controllers';
import { ExpensesService } from './expenses.service';
import { RentContractsService } from './rent-contracts.service';

/**
 * Dépenses and dépôt rent (phase 25, EXPENSES). The charges report lives in `reports`
 * and reads through ChargesService.
 */
@Module({
  imports: [BillingModule, DocumentsModule, HrCoreModule, SalesForceModule, StockModule],
  controllers: [ExpenseCategoriesController, ExpensesController, RentContractsController],
  providers: [ExpenseCategoriesService, ExpensesService, RentContractsService, ChargesService],
  exports: [ExpenseCategoriesService, ExpensesService, ChargesService],
})
export class ExpensesModule {}
