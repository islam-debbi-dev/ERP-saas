import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { DocumentsModule } from '../documents/documents.module';
import { SalesForceModule } from '../sales-force/sales-force.module';
import { StockModule } from '../stock/stock.module';
import { CashAccountsService } from './cash-accounts.service';
import { CashLedgerService } from './cash-ledger.service';
import { TreasuryBackfillService } from './treasury-backfill.service';
import { CashAccountsController, TreasuryController } from './treasury.controllers';
import { TreasuryService } from './treasury.service';

/** Caisses, bank accounts, the cash ledger (phase 34). Money modules use CashLedgerService. */
@Module({
  imports: [BillingModule, DocumentsModule, SalesForceModule, StockModule],
  controllers: [CashAccountsController, TreasuryController],
  providers: [CashLedgerService, CashAccountsService, TreasuryService, TreasuryBackfillService],
  exports: [CashLedgerService, TreasuryService],
})
export class TreasuryModule {}
