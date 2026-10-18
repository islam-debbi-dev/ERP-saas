import {
  Body,
  Controller,
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
  type CancelSaleInput,
  cancelSaleSchema,
  type CreateSaleInput,
  createSaleSchema,
  type InvoiceFromBlsInput,
  invoiceFromBlsSchema,
  type PricePreviewDto,
  type PricePreviewQuery,
  pricePreviewQuerySchema,
  type QuickSaleInput,
  quickSaleSchema,
  Role,
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
import { CurrentUser, Roles } from '../auth/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { Idempotent } from '../idempotency/idempotent.decorator';
import { SaleWorkflowService } from './sale-workflow.service';
import { SalesService } from './sales.service';

const MANAGERS = [Role.OWNER, Role.MANAGER];
/** Who sells. Price overrides, credit overrides and cancellations are checked in the service. */
const SELLERS = [...MANAGERS, Role.SELLER];

@Controller('sales')
export class SalesController {
  constructor(
    private readonly sales: SalesService,
    private readonly workflow: SaleWorkflowService,
  ) {}

  @Get()
  list(@Query(new ZodValidationPipe(saleListQuerySchema)) query: SaleListQuery): Promise<SalePage> {
    return this.sales.list(query);
  }

  // Declared before ':id'.
  @Get('price-preview')
  pricePreview(
    @Query(new ZodValidationPipe(pricePreviewQuerySchema)) query: PricePreviewQuery,
  ): Promise<PricePreviewDto> {
    return this.sales.pricePreview(query);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string): Promise<SaleDto> {
    return this.sales.get(id);
  }

  @Post()
  @Roles(...SELLERS)
  create(
    @Body(new ZodValidationPipe(createSaleSchema)) body: CreateSaleInput,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<SaleDto> {
    return this.sales.create(body, user);
  }

  @Post('quick')
  @Idempotent()
  @Roles(...SELLERS)
  quick(
    @Body(new ZodValidationPipe(quickSaleSchema)) body: QuickSaleInput,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<SaleResultDto> {
    return this.workflow.quick(body, user);
  }

  @Put(':id')
  @Roles(...SELLERS)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateSaleSchema)) body: UpdateSaleInput,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<SaleDto> {
    return this.sales.update(id, body, user);
  }

  @Post(':id/validate')
  @Idempotent()
  @Roles(...SELLERS)
  @HttpCode(HttpStatus.OK)
  validate(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(validateSaleSchema)) body: ValidateSaleInput,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<SaleResultDto> {
    return this.workflow.validate(id, body, user);
  }

  @Post(':id/cancel')
  @Idempotent()
  @Roles(...SELLERS)
  @HttpCode(HttpStatus.OK)
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(cancelSaleSchema)) body: CancelSaleInput,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<SaleResultDto> {
    return this.workflow.cancel(id, body.reason, user);
  }

  @Post(':id/returns')
  @Idempotent()
  @Roles(...MANAGERS)
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
  @Idempotent()
  @Roles(...SELLERS)
  fromBls(
    @Body(new ZodValidationPipe(invoiceFromBlsSchema)) body: InvoiceFromBlsInput,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<SaleResultDto> {
    return this.workflow.invoiceFromBls(body, user);
  }
}
