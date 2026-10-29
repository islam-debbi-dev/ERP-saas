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
  type CreateSupplierPaymentInput,
  createSupplierPaymentSchema,
  createPurchaseSchema,
  type PurchaseDto,
  type PurchaseListQuery,
  purchaseListQuerySchema,
  type PurchasePage,
  type PurchaseReturnInput,
  purchaseReturnSchema,
  Role,
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
import { CurrentUser, Roles } from '../auth/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { Idempotent } from '../idempotency/idempotent.decorator';
import { PurchaseWorkflowService } from './purchase-workflow.service';
import { PurchasesService } from './purchases.service';
import { SupplierPaymentsService } from './supplier-payments.service';
import { SuppliersService } from './suppliers.service';

const MANAGERS = [Role.OWNER, Role.MANAGER];
/** Storekeepers receive goods: they prepare drafts; a manager validates. */
const RECEIVERS = [...MANAGERS, Role.STOREKEEPER];

@Controller('suppliers')
export class SuppliersController {
  constructor(private readonly suppliers: SuppliersService) {}

  @Get()
  list(
    @Query(new ZodValidationPipe(supplierListQuerySchema)) query: SupplierListQuery,
  ): Promise<SupplierPage> {
    return this.suppliers.list(query);
  }

  // Declared before ':id'. Supplier accounts are for managers (phase 21).
  @Get('balances')
  @Roles(...MANAGERS)
  balances(): Promise<SupplierBalancesDto> {
    return this.suppliers.balances();
  }

  @Get(':id/ledger')
  @Roles(...MANAGERS)
  ledger(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodValidationPipe(supplierLedgerQuerySchema)) query: SupplierLedgerQuery,
  ): Promise<SupplierLedgerPage> {
    return this.suppliers.ledger(id, query);
  }

  @Get(':id/statement')
  @Roles(...MANAGERS)
  statement(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodValidationPipe(supplierStatementQuerySchema)) query: SupplierStatementQuery,
  ): Promise<SupplierStatementDto> {
    return this.suppliers.statement(id, query);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string): Promise<SupplierDto> {
    return this.suppliers.get(id);
  }

  @Post()
  @Roles(...MANAGERS)
  create(@Body(new ZodValidationPipe(supplierSchema)) body: SupplierInput): Promise<SupplierDto> {
    return this.suppliers.create(body);
  }

  @Patch(':id')
  @Roles(...MANAGERS)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateSupplierSchema)) body: UpdateSupplierInput,
  ): Promise<SupplierDto> {
    return this.suppliers.update(id, body);
  }

  @Delete(':id')
  @Roles(...MANAGERS)
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
  list(
    @Query(new ZodValidationPipe(purchaseListQuerySchema)) query: PurchaseListQuery,
  ): Promise<PurchasePage> {
    return this.purchases.list(query);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string): Promise<PurchaseDto> {
    return this.purchases.get(id);
  }

  @Post()
  @Idempotent()
  @Roles(...RECEIVERS)
  create(
    @Body(new ZodValidationPipe(createPurchaseSchema)) body: CreatePurchaseInput,
  ): Promise<PurchaseDto> {
    return this.purchases.create(body);
  }

  @Put(':id')
  @Roles(...RECEIVERS)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updatePurchaseSchema)) body: UpdatePurchaseInput,
  ): Promise<PurchaseDto> {
    return this.purchases.update(id, body);
  }

  @Post(':id/validate')
  @Idempotent()
  @Roles(...MANAGERS)
  @HttpCode(HttpStatus.OK)
  validate(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(validatePurchaseSchema)) body: ValidatePurchaseInput,
  ): Promise<PurchaseDto> {
    return this.workflow.validate(id, body);
  }

  @Post(':id/cancel')
  @Idempotent()
  @Roles(...MANAGERS)
  @HttpCode(HttpStatus.OK)
  cancel(@Param('id', ParseUUIDPipe) id: string): Promise<PurchaseDto> {
    return this.workflow.cancel(id);
  }

  @Post(':id/returns')
  @Idempotent()
  @Roles(...MANAGERS)
  createReturn(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(purchaseReturnSchema)) body: PurchaseReturnInput,
  ): Promise<PurchaseDto> {
    return this.workflow.createReturn(id, body);
  }
}

/** Règlements fournisseur (RGF, phase 21). */
@Controller('supplier-payments')
@Roles(...MANAGERS)
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
  @Idempotent()
  create(
    @Body(new ZodValidationPipe(createSupplierPaymentSchema)) body: CreateSupplierPaymentInput,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<SupplierPaymentDto> {
    return this.payments.create(body, user);
  }

  @Post(':id/cancel')
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
