import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
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
  Role,
  type UnpaidDocumentDto,
} from '@erp/shared';
import type { CurrentUserInfo } from '../auth/auth.types';
import { CurrentUser, Roles } from '../auth/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { Idempotent } from '../idempotency/idempotent.decorator';
import { PaymentsService } from './payments.service';

const MANAGERS = [Role.OWNER, Role.MANAGER];
/** Who takes money. Cancel rules for sellers are checked in the service. */
const CASHIERS = [...MANAGERS, Role.SELLER];

@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Get()
  list(
    @Query(new ZodValidationPipe(paymentListQuerySchema)) query: PaymentListQuery,
  ): Promise<PaymentPage> {
    return this.payments.list(query);
  }

  // Declared before ':id'.
  @Get('summary')
  summary(
    @Query(new ZodValidationPipe(cashSummaryQuerySchema)) query: CashSummaryQuery,
  ): Promise<CashSummaryDto> {
    return this.payments.summary(query.date);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string): Promise<PaymentDto> {
    return this.payments.get(id);
  }

  @Post()
  @Idempotent()
  @Roles(...CASHIERS)
  create(
    @Body(new ZodValidationPipe(createPaymentSchema)) body: CreatePaymentInput,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<PaymentDto> {
    return this.payments.create(body, user);
  }

  @Post(':id/cancel')
  @Idempotent()
  @Roles(...CASHIERS)
  @HttpCode(HttpStatus.OK)
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(cancelPaymentSchema)) body: CancelPaymentInput,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<PaymentDto> {
    return this.payments.cancel(id, body.reason, user);
  }

  @Post(':id/bounce')
  @Idempotent()
  @Roles(...MANAGERS)
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
  unpaid(@Param('id', ParseUUIDPipe) id: string): Promise<UnpaidDocumentDto[]> {
    return this.payments.unpaidDocuments(id);
  }
}
