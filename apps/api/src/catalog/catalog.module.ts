import { Module } from '@nestjs/common';
import {
  CategoriesController,
  PriceLevelsController,
  ProductsController,
  UnitsController,
} from './catalog.controllers';
import { CatalogService } from './catalog.service';
import { CategoriesService } from './categories.service';
import { PriceLevelsService } from './price-levels.service';
import { ProductsService } from './products.service';
import { UnitsService } from './units.service';

/** Products, units, categories and price levels. Other modules use CatalogService only. */
@Module({
  controllers: [UnitsController, PriceLevelsController, CategoriesController, ProductsController],
  providers: [CatalogService, CategoriesService, PriceLevelsService, ProductsService, UnitsService],
  exports: [CatalogService],
})
export class CatalogModule {}
