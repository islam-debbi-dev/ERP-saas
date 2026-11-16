import { Module } from '@nestjs/common';
import { SalesForceModule } from '../sales-force/sales-force.module';
import { StockModule } from '../stock/stock.module';
import {
  DistributionStatsController,
  VehicleTargetsController,
} from './distribution-stats.controller';
import { DistributionStatsService } from './distribution-stats.service';
import { StatsQueryService } from './stats-query.service';
import { StatsScopeService } from './stats-scope.service';
import { VehicleTargetsService } from './vehicle-targets.service';

/**
 * Statistiques distribution (phase 37). Read only, like `reports`: it reads the other
 * modules' tables through SQL in its own engine (`StatsQueryService`) and writes nothing
 * but the trucks' monthly targets (master data with audit). It imports the scope helpers
 * (`ScopeService`, `VehiclesService`), never another module's internals.
 */
@Module({
  imports: [SalesForceModule, StockModule],
  controllers: [DistributionStatsController, VehicleTargetsController],
  providers: [
    DistributionStatsService,
    StatsQueryService,
    StatsScopeService,
    VehicleTargetsService,
  ],
})
export class DistributionStatsModule {}
