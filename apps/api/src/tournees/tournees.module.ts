import { Module } from '@nestjs/common';
import { DocumentsModule } from '../documents/documents.module';
import { SalesModule } from '../sales/sales.module';
import { GeoModule } from '../geo/geo.module';
import { PromotionsModule } from '../promotions/promotions.module';
import { SalesForceModule } from '../sales-force/sales-force.module';
import { StockModule } from '../stock/stock.module';
import { OrdersService } from './orders.service';
import { RoutesService } from './routes.service';
import { SellerSessionsService } from './seller-sessions.service';
import { TourneeReportsService } from './tournee-reports.service';
import {
  MeTodayController,
  OrdersController,
  RoutesController,
  SellerSessionsController,
  TourneeReportsController,
  VisitsController,
} from './tournees.controllers';
import { VisitsService } from './visits.service';

/**
 * Tournées, visites, bons de commande and clôture de tournée (phase 16, TOURNEES).
 * Orders reach stock and client accounts only through the sale workflow (the BL made at
 * delivery); sessions only read payments.
 */
@Module({
  imports: [
    SalesModule,
    StockModule,
    DocumentsModule,
    SalesForceModule,
    GeoModule,
    PromotionsModule,
  ],
  controllers: [
    RoutesController,
    MeTodayController,
    VisitsController,
    OrdersController,
    SellerSessionsController,
    TourneeReportsController,
  ],
  providers: [
    RoutesService,
    VisitsService,
    OrdersService,
    SellerSessionsService,
    TourneeReportsService,
  ],
  exports: [OrdersService],
})
export class TourneesModule {}
