import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { SalesForceModule } from '../sales-force/sales-force.module';
import { IncentiveMetricsService } from './incentive-metrics.service';
import {
  IncentivePlansController,
  IncentiveRunsController,
  MyObjectivesController,
  SalesTargetsController,
} from './incentives.controllers';
import { ObjectivesService } from './objectives.service';
import { PlansService } from './plans.service';
import { RunsService } from './runs.service';
import { TargetsService } from './targets.service';

/**
 * Objectifs & primes (phase 18, INCENTIVES): targets, bonus plans, month-end runs and
 * the sellers' live progress. The seller-change lock of approved months lives in
 * ScopeService (phase 14 hook).
 */
@Module({
  imports: [BillingModule, SalesForceModule],
  controllers: [
    SalesTargetsController,
    IncentivePlansController,
    IncentiveRunsController,
    MyObjectivesController,
  ],
  providers: [IncentiveMetricsService, TargetsService, PlansService, RunsService, ObjectivesService],
  exports: [RunsService],
})
export class IncentivesModule {}
