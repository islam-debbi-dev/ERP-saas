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
  Put,
  Query,
} from '@nestjs/common';
import {
  type CancelSupplierPaymentInput,
  cancelSupplierPaymentSchema,
  type CreatePurchaseInput,
  createPurchaseSchema,
  type CreateSupplierPaymentInput,
  createSupplierPaymentSchema,
  Permission,
  type PurchaseDto,
  type PurchaseListQuery,
  purchaseListQuerySchema,
  type PurchasePage,
  type PurchaseReturnInput,
  purchaseReturnSchema,
  type SupplierBalancesDto,
  type SupplierDto,
  type SupplierInput,
  type SupplierLedgerPage,
  type SupplierLedgerQuery,
  supplierLedgerQuerySchema,
  type SupplierListQuery,
  supplierListQuerySchema,
  type SupplierPage,
  type SupplierPaymentDto,
  type SupplierPaymentListQuery,
  supplierPaymentListQuerySchema,
  type SupplierPaymentPage,
  supplierSchema,
  type SupplierStatementDto,
  type SupplierStatementQuery,
  supplierStatementQuerySchema,
  type UpdatePurchaseInput,
  updatePurchaseSchema,
  type UpdateSupplierInput,
  updateSupplierSchema,
  type ValidatePurchaseInput,
  validatePurchaseSchema,
} from '@erp/shared';
import type { CurrentUserInfo } from '../auth/auth.types';
import { CurrentUser, RequirePermission } from '../auth/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { Idempotent } from '../idempotency/idempotent.decorator';
import { PurchaseWorkflowService } from './purchase-workflow.service';
import { PurchasesService } from './purchases.service';
import { SupplierPaymentsService } from './supplier-payments.service';
import { SuppliersService } from './suppliers.service';

@Controller('suppliers')
export class SuppliersController {
  constructor(private readonly suppliers: SuppliersService) {}

  @Get()
  @RequirePermission(Permission.SUPPLIERS_VIEW)
  list(
    @Query(new ZodValidationPipe(supplierListQuerySchema)) query: SupplierListQuery,
  ): Promise<SupplierPage> {
    return this.suppliers.list(query);
  }

  // Declared before ':id'. Supplier accounts are for managers (phase 21).
  @Get('balances')
  @RequirePermission(Permission.SUPPLIERS_ACCOUNT)
  balances(): Promise<SupplierBalancesDto> {
    return this.suppliers.balances();
  }

  @Get(':id/ledger')
  @RequirePermission(Permission.SUPPLIERS_ACCOUNT)
  ledger(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodValidationPipe(supplierLedgerQuerySchema)) query: SupplierLedgerQuery,
  ): Promise<SupplierLedgerPage> {
    return this.suppliers.ledger(id, query);
  }

  @Get(':id/statement')
  @RequirePermission(Permission.SUPPLIERS_ACCOUNT)
  statement(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodValidationPipe(supplierStatementQuerySchema)) query: SupplierStatementQuery,
  ): Promise<SupplierStatementDto> {
    return this.suppliers.statement(id, query);
  }

  @Get(':id')
  @RequirePermission(Permission.SUPPLIERS_VIEW)
  get(@Param('id', ParseUUIDPipe) id: string): Promise<SupplierDto> {
    return this.suppliers.get(id);
  }

  @Post()
  @RequirePermission(Permission.SUPPLIERS_CREATE)
  create(@Body(new ZodValidationPipe(supplierSchema)) body: SupplierInput): Promise<SupplierDto> {
    return this.suppliers.create(body);
  }

  @Patch(':id')
  @RequirePermission(Permission.SUPPLIERS_EDIT)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateSupplierSchema)) body: UpdateSupplierInput,
  ): Promise<SupplierDto> {
    return this.suppliers.update(id, body);
  }

  @Delete(':id')
  @RequirePermission(Permission.SUPPLIERS_EDIT)
  @HttpCode(HttpStatus.NO_CONTENT)
  archive(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.suppliers.archive(id);
  }
}

@Controller('purchases')
export class PurchasesController {
  constructor(
    private readonly purchases: PurchasesService,
    private readonly workflow: PurchaseWorkflowService,
  ) {}

  @Get()
  @RequirePermission(Permission.PURCHASES_VIEW)
  list(
    @Query(new ZodValidationPipe(purchaseListQuerySchema)) query: PurchaseListQuery,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<PurchasePage> {
    return this.purchases.list(query, user);
  }

  @Get(':id')
  @RequirePermission(Permission.PURCHASES_VIEW)
  get(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<PurchaseDto> {
    return this.purchases.get(id, user);
  }

  @Post()
  @RequirePermission(Permission.PURCHASES_CREATE)
  @Idempotent()
  create(
    @Body(new ZodValidationPipe(createPurchaseSchema)) body: CreatePurchaseInput,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<PurchaseDto> {
    return this.purchases.create(body, user);
  }

  @Put(':id')
  @RequirePermission(Permission.PURCHASES_CREATE)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updatePurchaseSchema)) body: UpdatePurchaseInput,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<PurchaseDto> {
    return this.purchases.update(id, body, user);
  }

  @Post(':id/validate')
  @RequirePermission(Permission.PURCHASES_VALIDATE)
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  validate(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(validatePurchaseSchema)) body: ValidatePurchaseInput,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<PurchaseDto> {
    return this.workflow.validate(id, body, user);
  }

  @Post(':id/cancel')
  @RequirePermission(Permission.PURCHASES_CANCEL)
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<PurchaseDto> {
    return this.workflow.cancel(id, user);
  }

  @Post(':id/returns')
  @RequirePermission(Permission.PURCHASES_CANCEL)
  @Idempotent()
  createReturn(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(purchaseReturnSchema)) body: PurchaseReturnInput,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<PurchaseDto> {
    return this.workflow.createReturn(id, body, user);
  }
}

/** Règlements fournisseur (RGF, phase 21). */
@Controller('supplier-payments')
@RequirePermission(Permission.SUPPLIERS_ACCOUNT)
export class SupplierPaymentsController {
  constructor(private readonly payments: SupplierPaymentsService) {}

  @Get()
  list(
    @Query(new ZodValidationPipe(supplierPaymentListQuerySchema)) query: SupplierPaymentListQuery,
  ): Promise<SupplierPaymentPage> {
    return this.payments.list(query);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string): Promise<SupplierPaymentDto> {
    return this.payments.get(id);
  }

  @Post()
  @RequirePermission(Permission.SUPPLIERS_PAY)
  @Idempotent()
  create(
    @Body(new ZodValidationPipe(createSupplierPaymentSchema)) body: CreateSupplierPaymentInput,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<SupplierPaymentDto> {
    return this.payments.create(body, user);
  }

  @Post(':id/cancel')
  @RequirePermission(Permission.SUPPLIERS_PAY)
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(cancelSupplierPaymentSchema)) body: CancelSupplierPaymentInput,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<SupplierPaymentDto> {
    return this.payments.cancel(id, body.reason, user);
  }
}
