import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  type BarcodeMatchDto,
  type BrandDto,
  type CategoryDto,
  type CreateBrandInput,
  createBrandSchema,
  type CreateCategoryInput,
  createCategorySchema,
  type CreateProductInput,
  createProductSchema,
  type CreateUnitInput,
  createUnitSchema,
  Permission,
  type PriceLevelDto,
  type ProductDto,
  type ProductListQuery,
  productListQuerySchema,
  type ProductPage,
  type RenamePriceLevelInput,
  renamePriceLevelSchema,
  type UnitDto,
  type UpdateBrandInput,
  updateBrandSchema,
  type UpdateCategoryInput,
  updateCategorySchema,
  type UpdateProductInput,
  updateProductSchema,
} from '@erp/shared';
import { RequirePermission } from '../auth/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { BrandsService } from './brands.service';
import { CategoriesService } from './categories.service';
import { PriceLevelsService } from './price-levels.service';
import { ProductsService } from './products.service';
import { UnitsService } from './units.service';

@Controller('units')
export class UnitsController {
  constructor(private readonly units: UnitsService) {}

  @Get()
  @RequirePermission(Permission.PRODUCTS_VIEW)
  list(): Promise<UnitDto[]> {
    return this.units.list();
  }

  @Post()
  @RequirePermission(Permission.PRODUCTS_CREATE)
  create(@Body(new ZodValidationPipe(createUnitSchema)) body: CreateUnitInput): Promise<UnitDto> {
    return this.units.create(body);
  }
}

@Controller('price-levels')
export class PriceLevelsController {
  constructor(private readonly levels: PriceLevelsService) {}

  @Get()
  @RequirePermission(Permission.PRODUCTS_VIEW)
  list(): Promise<PriceLevelDto[]> {
    return this.levels.list();
  }

  @Patch(':id')
  @RequirePermission(Permission.PRODUCTS_EDIT)
  rename(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(renamePriceLevelSchema)) body: RenamePriceLevelInput,
  ): Promise<PriceLevelDto> {
    return this.levels.rename(id, body);
  }
}

@Controller('categories')
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  @Get()
  @RequirePermission(Permission.PRODUCTS_VIEW)
  tree(): Promise<CategoryDto[]> {
    return this.categories.tree();
  }

  @Post()
  @RequirePermission(Permission.PRODUCTS_CREATE)
  create(
    @Body(new ZodValidationPipe(createCategorySchema)) body: CreateCategoryInput,
  ): Promise<CategoryDto> {
    return this.categories.create(body);
  }

  @Patch(':id')
  @RequirePermission(Permission.PRODUCTS_EDIT)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateCategorySchema)) body: UpdateCategoryInput,
  ): Promise<CategoryDto> {
    return this.categories.update(id, body);
  }

  @Delete(':id')
  @RequirePermission(Permission.PRODUCTS_EDIT)
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.categories.remove(id);
  }
}

/** Marques (phase 14): core, every role reads them. */
@Controller('brands')
export class BrandsController {
  constructor(private readonly brands: BrandsService) {}

  @Get()
  @RequirePermission(Permission.PRODUCTS_VIEW)
  list(): Promise<BrandDto[]> {
    return this.brands.list();
  }

  @Post()
  @RequirePermission(Permission.PRODUCTS_CREATE)
  create(
    @Body(new ZodValidationPipe(createBrandSchema)) body: CreateBrandInput,
  ): Promise<BrandDto> {
    return this.brands.create(body);
  }

  @Patch(':id')
  @RequirePermission(Permission.PRODUCTS_EDIT)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateBrandSchema)) body: UpdateBrandInput,
  ): Promise<BrandDto> {
    return this.brands.update(id, body);
  }

  @Delete(':id')
  @RequirePermission(Permission.PRODUCTS_EDIT)
  @HttpCode(HttpStatus.NO_CONTENT)
  archive(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.brands.archive(id);
  }
}

@Controller('products')
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Get()
  @RequirePermission(Permission.PRODUCTS_VIEW)
  list(
    @Query(new ZodValidationPipe(productListQuerySchema)) query: ProductListQuery,
  ): Promise<ProductPage> {
    return this.products.list(query);
  }

  // Declared before ':id' so "by-barcode" is not parsed as an id.
  @Get('by-barcode/:code')
  @RequirePermission(Permission.PRODUCTS_VIEW)
  byBarcode(@Param('code') code: string): Promise<BarcodeMatchDto> {
    return this.products.byBarcode(code.trim());
  }

  @Get(':id')
  @RequirePermission(Permission.PRODUCTS_VIEW)
  get(@Param('id', ParseUUIDPipe) id: string): Promise<ProductDto> {
    return this.products.get(id);
  }

  @Post()
  @RequirePermission(Permission.PRODUCTS_CREATE)
  create(
    @Body(new ZodValidationPipe(createProductSchema)) body: CreateProductInput,
  ): Promise<ProductDto> {
    return this.products.create(body);
  }

  @Patch(':id')
  @RequirePermission(Permission.PRODUCTS_EDIT)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateProductSchema)) body: UpdateProductInput,
  ): Promise<ProductDto> {
    return this.products.update(id, body);
  }

  @Post(':id/archive')
  @RequirePermission(Permission.PRODUCTS_EDIT)
  @HttpCode(HttpStatus.OK)
  archive(@Param('id', ParseUUIDPipe) id: string): Promise<ProductDto> {
    return this.products.archive(id, true);
  }

  @Post(':id/restore')
  @RequirePermission(Permission.PRODUCTS_EDIT)
  @HttpCode(HttpStatus.OK)
  restore(@Param('id', ParseUUIDPipe) id: string): Promise<ProductDto> {
    return this.products.archive(id, false);
  }
}
