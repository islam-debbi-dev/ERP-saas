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
  type CreatePurchaseInput,
  createPurchaseSchema,
  type PurchaseDto,
  type PurchaseListQuery,
  purchaseListQuerySchema,
  type PurchasePage,
  type PurchaseReturnInput,
  purchaseReturnSchema,
  Role,
  type SupplierDto,
  type SupplierInput,
  type SupplierListQuery,
  supplierListQuerySchema,
  type SupplierPage,
  supplierSchema,
  type UpdatePurchaseInput,
  updatePurchaseSchema,
  type UpdateSupplierInput,
  updateSupplierSchema,
  type ValidatePurchaseInput,
  validatePurchaseSchema,
} from '@erp/shared';
import { Roles } from '../auth/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { Idempotent } from '../idempotency/idempotent.decorator';
import { PurchaseWorkflowService } from './purchase-workflow.service';
import { PurchasesService } from './purchases.service';
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
