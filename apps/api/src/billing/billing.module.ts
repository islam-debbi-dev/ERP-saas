import { Module } from '@nestjs/common';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { FeaturesService } from './features.service';

/** Plans, trial, subscription status and plan limits (phase 13); editions and modules (13b). */
@Module({
  controllers: [BillingController],
  providers: [BillingService, FeaturesService],
  exports: [BillingService, FeaturesService],
})
export class BillingModule {}
