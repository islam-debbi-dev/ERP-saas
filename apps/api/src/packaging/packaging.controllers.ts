import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  type ClientPackagingDto,
  type ClientPackagingQuery,
  clientPackagingQuerySchema,
  Feature,
  type PackagingMovementInput,
  type PackagingMovementResultDto,
  packagingMovementSchema,
  type PackagingTypeDto,
  type PackagingTypeInput,
  packagingTypeInputSchema,
  type ProductPackagingDto,
  type ProductPackagingInput,
  productPackagingInputSchema,
  Role,
  TEAM_LEAD_ROLES,
} from '@erp/shared';
import type { CurrentUserInfo } from '../auth/auth.types';
import { CurrentUser, RequireFeature, Roles } from '../auth/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { Idempotent } from '../idempotency/idempotent.decorator';
import { PackagingService } from './packaging.service';

const MANAGERS = [Role.OWNER, Role.MANAGER];
/** Who handles empties on the road. */
const FIELD = [...MANAGERS, ...TEAM_LEAD_ROLES, Role.SELLER, Role.LIVREUR];
/** Who reads the counts: a pré-vendeur too, though he never moves them. */
const READERS = [...FIELD, Role.PREVENDEUR];

@Controller('packaging-types')
export class PackagingTypesController {
  constructor(private readonly packaging: PackagingService) {}

  /** Readable when the module is off (phase 13b: data stays readable). */
  @Get()
  @Roles(...READERS, Role.STOREKEEPER)
  list(): Promise<PackagingTypeDto[]> {
    return this.packaging.listTypes();
  }

  @Post()
  @Roles(...MANAGERS)
  @RequireFeature(Feature.PACKAGING)
  create(
    @Body(new ZodValidationPipe(packagingTypeInputSchema)) body: PackagingTypeInput,
  ): Promise<PackagingTypeDto> {
    return this.packaging.createType(body);
  }

  @Put(':id')
  @Roles(...MANAGERS)
  @RequireFeature(Feature.PACKAGING)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(packagingTypeInputSchema)) body: PackagingTypeInput,
  ): Promise<PackagingTypeDto> {
    return this.packaging.updateType(id, body);
  }

  @Delete(':id')
  @Roles(...MANAGERS)
  @RequireFeature(Feature.PACKAGING)
  @HttpCode(HttpStatus.NO_CONTENT)
  archive(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.packaging.archiveType(id);
  }
}

@Controller()
export class ClientPackagingController {
  constructor(private readonly packaging: PackagingService) {}

  /** The client's counts and his packaging relevé (readable when the module is off). */
  @Get('clients/:id/packaging')
  @Roles(...READERS)
  ofClient(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodValidationPipe(clientPackagingQuerySchema)) query: ClientPackagingQuery,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<ClientPackagingDto> {
    return this.packaging.ofClient(id, query, user);
  }

  @Get('products/:id/packaging')
  @Roles(...READERS, Role.STOREKEEPER)
  ofProduct(@Param('id', ParseUUIDPipe) id: string): Promise<ProductPackagingDto[]> {
    return this.packaging.ofProduct(id);
  }

  @Put('products/:id/packaging')
  @Roles(...MANAGERS)
  @RequireFeature(Feature.PACKAGING)
  setProduct(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(productPackagingInputSchema)) body: ProductPackagingInput,
  ): Promise<ProductPackagingDto[]> {
    return this.packaging.setProduct(id, body);
  }

  @Post('packaging-movements')
  @Idempotent()
  @Roles(...FIELD)
  @RequireFeature(Feature.PACKAGING)
  move(
    @Body(new ZodValidationPipe(packagingMovementSchema)) body: PackagingMovementInput,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<PackagingMovementResultDto> {
    return this.packaging.move(body, user);
  }
}
