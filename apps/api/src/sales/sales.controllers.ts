import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  type CancelSaleInput,
  cancelSaleSchema,
  type CreateSaleInput,
  createSaleSchema,
  type InvoiceFromBlsInput,
  invoiceFromBlsSchema,
  Permission,
  type PricePreviewDto,
  type PricePreviewQuery,
  pricePreviewQuerySchema,
  type QuickSaleInput,
  quickSaleSchema,
  type ReassignSellerInput,
  reassignSellerSchema,
  type SaleDto,
  type SaleListQuery,
  saleListQuerySchema,
  type SalePage,
  type SaleResultDto,
  type SaleReturnInput,
  saleReturnSchema,
  type UpdateSaleInput,
  updateSaleSchema,
  type ValidateSaleInput,
  validateSaleSchema,
} from '@erp/shared';
import type { CurrentUserInfo } from '../auth/auth.types';
import { CurrentUser, RequirePermission } from '../auth/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { Idempotent } from '../idempotency/idempotent.decorator';
import { SaleWorkflowService } from './sale-workflow.service';
import { SalesService } from './sales.service';

@Controller('sales')
export class SalesController {
  constructor(
    private readonly sales: SalesService,
    private readonly workflow: SaleWorkflowService,
  ) {}

  @Get()
  @RequirePermission(Permission.SALES_VIEW)
  list(
    @Query(new ZodValidationPipe(saleListQuerySchema)) query: SaleListQuery,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<SalePage> {
    return this.sales.list(query, user);
  }

  // Declared before ':id'.
  @Get('price-preview')
  @RequirePermission(Permission.SALES_VIEW)
  pricePreview(
    @Query(new ZodValidationPipe(pricePreviewQuerySchema)) query: PricePreviewQuery,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<PricePreviewDto> {
    return this.sales.pricePreview(query, user);
  }

  @Get(':id')
  @RequirePermission(Permission.SALES_VIEW)
  get(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<SaleDto> {
    return this.sales.get(id, user);
  }

  /** Change the seller of a validated sale (phase 14, SALE_REASSIGN_SELLER + reason). */
  @Patch(':id/seller')
  @RequirePermission(Permission.SALES_CREATE)
  reassignSeller(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(reassignSellerSchema)) body: ReassignSellerInput,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<SaleDto> {
    return this.sales.reassignSeller(id, body, user);
  }

  @Post()
  @RequirePermission(Permission.SALES_CREATE)
  create(
    @Body(new ZodValidationPipe(createSaleSchema)) body: CreateSaleInput,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<SaleDto> {
    return this.sales.create(body, user);
  }

  @Post('quick')
  @RequirePermission(Permission.SALES_CREATE)
  @Idempotent()
  quick(
    @Body(new ZodValidationPipe(quickSaleSchema)) body: QuickSaleInput,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<SaleResultDto> {
    return this.workflow.quick(body, user);
  }

  @Put(':id')
  @RequirePermission(Permission.SALES_CREATE)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateSaleSchema)) body: UpdateSaleInput,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<SaleDto> {
    return this.sales.update(id, body, user);
  }

  @Post(':id/validate')
  @RequirePermission(Permission.SALES_CREATE)
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  validate(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(validateSaleSchema)) body: ValidateSaleInput,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<SaleResultDto> {
    return this.workflow.validate(id, body, user);
  }

  @Post(':id/cancel')
  @RequirePermission(Permission.SALES_CREATE)
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(cancelSaleSchema)) body: CancelSaleInput,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<SaleResultDto> {
    return this.workflow.cancel(id, body.reason, user);
  }

  @Post(':id/returns')
  @RequirePermission(Permission.SALES_RETURN)
  @Idempotent()
  returns(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(saleReturnSchema)) body: SaleReturnInput,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<SaleResultDto> {
    return this.workflow.createReturn(id, body, user);
  }
}

@Controller('invoices')
export class InvoicesController {
  constructor(private readonly workflow: SaleWorkflowService) {}

  @Post('from-bls')
  @RequirePermission(Permission.SALES_CREATE)
  @Idempotent()
  fromBls(
    @Body(new ZodValidationPipe(invoiceFromBlsSchema)) body: InvoiceFromBlsInput,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<SaleResultDto> {
    return this.workflow.invoiceFromBls(body, user);
  }
}
