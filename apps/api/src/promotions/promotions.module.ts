import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { SalesForceModule } from '../sales-force/sales-force.module';
import { PricingService } from './pricing.service';
import { PricingController, PromotionsController } from './promotions.controllers';
import { PromotionsService } from './promotions.service';

/** Promotions and UG (phase 20). Sales and orders price their lines through PricingService. */
@Module({
  imports: [BillingModule, SalesForceModule],
  controllers: [PromotionsController, PricingController],
  providers: [PricingService, PromotionsService],
  exports: [PricingService],
})
export class PromotionsModule {}
