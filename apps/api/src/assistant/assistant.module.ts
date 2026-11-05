import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { CatalogModule } from '../catalog/catalog.module';
import { ClientsModule } from '../clients/clients.module';
import { CreditModule } from '../credit/credit.module';
import { PaymentsModule } from '../payments/payments.module';
import { PurchasesModule } from '../purchases/purchases.module';
import { ReportsModule } from '../reports/reports.module';
import { SalesForceModule } from '../sales-force/sales-force.module';
import { SalesModule } from '../sales/sales.module';
import { StockModule } from '../stock/stock.module';
import { TenantsModule } from '../tenants/tenants.module';
import { AiConfigService } from './ai-config.service';
import { AiUsageService } from './ai-usage.service';
import { AssistantRetentionService } from './assistant-retention.service';
import { AssistantThrottlerGuard } from './assistant-throttler.guard';
import { AssistantConfigController, AssistantController } from './assistant.controllers';
import { AssistantService } from './assistant.service';
import { LlmProviderFactory } from './llm/llm-provider.factory';
import { AssistantToolsService } from './tools/assistant-tools.service';

/** The in-app assistant (phase 30). Reads other modules only through their services. */
@Module({
  imports: [
    BillingModule,
    CatalogModule,
    ClientsModule,
    CreditModule,
    PaymentsModule,
    PurchasesModule,
    ReportsModule,
    SalesForceModule,
    SalesModule,
    StockModule,
    TenantsModule,
  ],
  controllers: [AssistantController, AssistantConfigController],
  providers: [
    AiConfigService,
    AiUsageService,
    AssistantRetentionService,
    AssistantService,
    AssistantThrottlerGuard,
    AssistantToolsService,
    LlmProviderFactory,
  ],
  exports: [AiConfigService, AiUsageService],
})
export class AssistantModule {}
