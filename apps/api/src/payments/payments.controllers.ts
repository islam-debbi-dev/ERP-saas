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
  Query,
} from '@nestjs/common';
import {
  type BouncePaymentInput,
  bouncePaymentSchema,
  type CancelPaymentInput,
  cancelPaymentSchema,
  type CashSummaryDto,
  type CashSummaryQuery,
  cashSummaryQuerySchema,
  type CreatePaymentInput,
  createPaymentSchema,
  type PaymentDto,
  type PaymentListQuery,
  paymentListQuerySchema,
  type PaymentPage,
  Permission,
  type ReassignCollectorInput,
  reassignCollectorSchema,
  type UnpaidDocumentDto,
} from '@erp/shared';
import type { CurrentUserInfo } from '../auth/auth.types';
import { CurrentUser, RequirePermission } from '../auth/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { Idempotent } from '../idempotency/idempotent.decorator';
import { PaymentsService } from './payments.service';

@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Get()
  @RequirePermission(Permission.PAYMENTS_VIEW)
  list(
    @Query(new ZodValidationPipe(paymentListQuerySchema)) query: PaymentListQuery,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<PaymentPage> {
    return this.payments.list(query, user);
  }

  // Declared before ':id'.
  @Get('summary')
  @RequirePermission(Permission.PAYMENTS_VIEW)
  summary(
    @Query(new ZodValidationPipe(cashSummaryQuerySchema)) query: CashSummaryQuery,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<CashSummaryDto> {
    return this.payments.summary(query.date, user);
  }

  @Get(':id')
  @RequirePermission(Permission.PAYMENTS_VIEW)
  get(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<PaymentDto> {
    return this.payments.get(id, user);
  }

  /** Change who collected a versement (phase 14, SALE_REASSIGN_SELLER + reason). */
  @Patch(':id/collector')
  @RequirePermission(Permission.PAYMENTS_CREATE)
  reassignCollector(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(reassignCollectorSchema)) body: ReassignCollectorInput,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<PaymentDto> {
    return this.payments.reassignCollector(id, body, user);
  }

  @Post()
  @RequirePermission(Permission.PAYMENTS_CREATE)
  @Idempotent()
  create(
    @Body(new ZodValidationPipe(createPaymentSchema)) body: CreatePaymentInput,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<PaymentDto> {
    return this.payments.create(body, user);
  }

  @Post(':id/cancel')
  @RequirePermission(Permission.PAYMENTS_CREATE)
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(cancelPaymentSchema)) body: CancelPaymentInput,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<PaymentDto> {
    return this.payments.cancel(id, body.reason, user);
  }

  @Post(':id/bounce')
  @RequirePermission(Permission.PAYMENTS_BOUNCE)
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  bounce(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(bouncePaymentSchema)) body: BouncePaymentInput,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<PaymentDto> {
    return this.payments.bounce(id, body, user);
  }
}

@Controller('clients')
export class ClientPaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Get(':id/unpaid-documents')
  @RequirePermission(Permission.CLIENTS_VIEW)
  unpaid(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<UnpaidDocumentDto[]> {
    return this.payments.unpaidDocuments(id, user);
  }
}
