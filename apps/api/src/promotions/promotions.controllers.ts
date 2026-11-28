import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  Feature,
  type PricingPreviewDto,
  type PricingPreviewInput,
  pricingPreviewSchema,
  type PromotionDto,
  type PromotionInput,
  promotionInputSchema,
  type PromotionListQuery,
  promotionIdParamSchema,
  promotionListQuerySchema,
  Role,
  type UpdatePromotionInput,
  updatePromotionSchema,
  TEAM_LEAD_ROLES,
  FIELD_SELLER_ROLES,
} from '@erp/shared';
import type { CurrentUserInfo } from '../auth/auth.types';
import { CurrentUser, RequireFeature, Roles } from '../auth/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PromotionsService } from './promotions.service';

const MANAGERS = [Role.OWNER, Role.MANAGER];
const SELLERS = [...MANAGERS, ...TEAM_LEAD_ROLES, ...FIELD_SELLER_ROLES];

@Controller('promotions')
@RequireFeature(Feature.PROMOTIONS)
export class PromotionsController {
  constructor(private readonly promotions: PromotionsService) {}

  /** Sellers read them too: the sale screen shows what is running. */
  @Get()
  @Roles(...SELLERS, Role.LIVREUR)
  list(
    @Query(new ZodValidationPipe(promotionListQuerySchema)) query: PromotionListQuery,
  ): Promise<PromotionDto[]> {
    return this.promotions.list(query);
  }

  @Get(':id')
  @Roles(...SELLERS, Role.LIVREUR)
  get(
    @Param(new ZodValidationPipe(promotionIdParamSchema)) { id }: { id: string },
  ): Promise<PromotionDto> {
    return this.promotions.get(id);
  }

  @Post()
  @Roles(...MANAGERS)
  create(
    @Body(new ZodValidationPipe(promotionInputSchema)) body: PromotionInput,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<PromotionDto> {
    return this.promotions.create(body, user);
  }

  @Put(':id')
  @Roles(...MANAGERS)
  update(
    @Param(new ZodValidationPipe(promotionIdParamSchema)) { id }: { id: string },
    @Body(new ZodValidationPipe(updatePromotionSchema)) body: UpdatePromotionInput,
  ): Promise<PromotionDto> {
    return this.promotions.update(id, body);
  }

  @Delete(':id')
  @Roles(...MANAGERS)
  @HttpCode(HttpStatus.NO_CONTENT)
  archive(
    @Param(new ZodValidationPipe(promotionIdParamSchema)) { id }: { id: string },
  ): Promise<void> {
    return this.promotions.archive(id);
  }
}

/**
 * Prices lines as a sale would, promotions included, without saving anything. Not behind
 * the module: without it the answer is the plain client price.
 */
@Controller('pricing')
export class PricingController {
  constructor(private readonly promotions: PromotionsService) {}

  @Post('preview')
  @Roles(...SELLERS, Role.LIVREUR)
  @HttpCode(HttpStatus.OK)
  preview(
    @Body(new ZodValidationPipe(pricingPreviewSchema)) body: PricingPreviewInput,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<PricingPreviewDto> {
    return this.promotions.preview(body, user);
  }
}
