import { Module } from '@nestjs/common';
import { ClientsModule } from '../clients/clients.module';
import { PaymentsModule } from '../payments/payments.module';
import { StockModule } from '../stock/stock.module';
import { DashboardService } from './dashboard.service';
import { DashboardController, ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

/**
 * Dashboard and reports. Read-only: the dashboard reuses the clients, payments and
 * stock services; reports aggregate the documents and ledgers in SQL (one query
 * per report), which is the one place that reads across modules' tables.
 */
@Module({
  imports: [ClientsModule, PaymentsModule, StockModule],
  controllers: [DashboardController, ReportsController],
  providers: [DashboardService, ReportsService],
})
export class ReportsModule {}
