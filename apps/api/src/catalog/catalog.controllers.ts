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
  type CreateBrandInput,
  createBrandSchema,
  type UpdateBrandInput,
  updateBrandSchema,
  type CategoryDto,
  type CreateCategoryInput,
  createCategorySchema,
  type CreateProductInput,
  createProductSchema,
  type CreateUnitInput,
  createUnitSchema,
  type PriceLevelDto,
  type ProductDto,
  type ProductListQuery,
  productListQuerySchema,
  type ProductPage,
  type RenamePriceLevelInput,
  renamePriceLevelSchema,
  Role,
  type UnitDto,
  type UpdateCategoryInput,
  updateCategorySchema,
  type UpdateProductInput,
  updateProductSchema,
} from '@erp/shared';
import { Roles } from '../auth/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { BrandsService } from './brands.service';
import { CategoriesService } from './categories.service';
import { PriceLevelsService } from './price-levels.service';
import { ProductsService } from './products.service';
import { UnitsService } from './units.service';

/** Catalog writes: owner and manager for now (finer permissions in phase 11). */
const CATALOG_WRITERS = [Role.OWNER, Role.MANAGER];

@Controller('units')
export class UnitsController {
  constructor(private readonly units: UnitsService) {}

  @Get()
  list(): Promise<UnitDto[]> {
    return this.units.list();
  }

  @Post()
  @Roles(...CATALOG_WRITERS)
  create(@Body(new ZodValidationPipe(createUnitSchema)) body: CreateUnitInput): Promise<UnitDto> {
    return this.units.create(body);
  }
}

@Controller('price-levels')
export class PriceLevelsController {
  constructor(private readonly levels: PriceLevelsService) {}

  @Get()
  list(): Promise<PriceLevelDto[]> {
    return this.levels.list();
  }

  @Patch(':id')
  @Roles(...CATALOG_WRITERS)
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
  tree(): Promise<CategoryDto[]> {
    return this.categories.tree();
  }

  @Post()
  @Roles(...CATALOG_WRITERS)
  create(
    @Body(new ZodValidationPipe(createCategorySchema)) body: CreateCategoryInput,
  ): Promise<CategoryDto> {
    return this.categories.create(body);
  }

  @Patch(':id')
  @Roles(...CATALOG_WRITERS)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateCategorySchema)) body: UpdateCategoryInput,
  ): Promise<CategoryDto> {
    return this.categories.update(id, body);
  }

  @Delete(':id')
  @Roles(...CATALOG_WRITERS)
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
  list(): Promise<BrandDto[]> {
    return this.brands.list();
  }

  @Post()
  @Roles(...CATALOG_WRITERS)
  create(
    @Body(new ZodValidationPipe(createBrandSchema)) body: CreateBrandInput,
  ): Promise<BrandDto> {
    return this.brands.create(body);
  }

  @Patch(':id')
  @Roles(...CATALOG_WRITERS)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateBrandSchema)) body: UpdateBrandInput,
  ): Promise<BrandDto> {
    return this.brands.update(id, body);
  }

  @Delete(':id')
  @Roles(...CATALOG_WRITERS)
  @HttpCode(HttpStatus.NO_CONTENT)
  archive(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.brands.archive(id);
  }
}

@Controller('products')
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Get()
  list(
    @Query(new ZodValidationPipe(productListQuerySchema)) query: ProductListQuery,
  ): Promise<ProductPage> {
    return this.products.list(query);
  }

  // Declared before ':id' so "by-barcode" is not parsed as an id.
  @Get('by-barcode/:code')
  byBarcode(@Param('code') code: string): Promise<BarcodeMatchDto> {
    return this.products.byBarcode(code.trim());
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string): Promise<ProductDto> {
    return this.products.get(id);
  }

  @Post()
  @Roles(...CATALOG_WRITERS)
  create(
    @Body(new ZodValidationPipe(createProductSchema)) body: CreateProductInput,
  ): Promise<ProductDto> {
    return this.products.create(body);
  }

  @Patch(':id')
  @Roles(...CATALOG_WRITERS)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateProductSchema)) body: UpdateProductInput,
  ): Promise<ProductDto> {
    return this.products.update(id, body);
  }

  @Post(':id/archive')
  @Roles(...CATALOG_WRITERS)
  @HttpCode(HttpStatus.OK)
  archive(@Param('id', ParseUUIDPipe) id: string): Promise<ProductDto> {
    return this.products.archive(id, true);
  }

  @Post(':id/restore')
  @Roles(...CATALOG_WRITERS)
  @HttpCode(HttpStatus.OK)
  restore(@Param('id', ParseUUIDPipe) id: string): Promise<ProductDto> {
    return this.products.archive(id, false);
  }
}
