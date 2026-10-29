import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import {
  BrandsController,
  CategoriesController,
  PriceLevelsController,
  ProductsController,
  UnitsController,
} from './catalog.controllers';
import { BrandsService } from './brands.service';
import { CatalogService } from './catalog.service';
import { CategoriesService } from './categories.service';
import { PriceLevelsService } from './price-levels.service';
import { ProductsService } from './products.service';
import { UnitsService } from './units.service';

/** Products, units, categories and price levels. Other modules use CatalogService only. */
@Module({
  imports: [BillingModule],
  controllers: [
    UnitsController,
    PriceLevelsController,
    CategoriesController,
    BrandsController,
    ProductsController,
  ],
  providers: [
    CatalogService,
    BrandsService,
    CategoriesService,
    PriceLevelsService,
    ProductsService,
    UnitsService,
  ],
  exports: [CatalogService],
})
export class CatalogModule {}
