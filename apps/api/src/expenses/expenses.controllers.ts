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
  type CancelExpenseInput,
  cancelExpenseSchema,
  type CloseRentContractInput,
  closeRentContractSchema,
  type CreateExpenseInput,
  createExpenseSchema,
  type CreateRentContractInput,
  createRentContractSchema,
  type ExpenseCategoryDto,
  type ExpenseCategoryInput,
  expenseCategorySchema,
  type ExpenseDto,
  type ExpenseListQuery,
  expenseListQuerySchema,
  type ExpensePage,
  Feature,
  Permission,
  type RentContractDto,
  type RentContractListQuery,
  rentContractListQuerySchema,
  type RentScheduleDto,
  type UpdateRentContractInput,
  updateRentContractSchema,
} from '@erp/shared';
import { z } from 'zod';
import type { CurrentUserInfo } from '../auth/auth.types';
import { CurrentUser, RequireFeature, RequirePermission } from '../auth/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { Idempotent } from '../idempotency/idempotent.decorator';
import { ExpenseCategoriesService } from './expense-categories.service';
import { ExpensesService } from './expenses.service';
import { RentContractsService } from './rent-contracts.service';

const archivedQuerySchema = z.object({
  archived: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});

/** Charge categories (phase 25). Reading needs EXPENSES_VIEW, changing them RENT_MANAGE. */
@Controller('expense-categories')
@RequireFeature(Feature.EXPENSES)
@RequirePermission(Permission.EXPENSES_VIEW)
export class ExpenseCategoriesController {
  constructor(private readonly categories: ExpenseCategoriesService) {}

  @Get()
  list(
    @Query(new ZodValidationPipe(archivedQuerySchema)) query: { archived?: boolean },
  ): Promise<ExpenseCategoryDto[]> {
    return this.categories.list(query.archived ?? false);
  }

  @Post()
  @RequirePermission(Permission.RENT_MANAGE)
  create(
    @Body(new ZodValidationPipe(expenseCategorySchema)) body: ExpenseCategoryInput,
  ): Promise<ExpenseCategoryDto> {
    return this.categories.create(body);
  }

  @Put(':id')
  @RequirePermission(Permission.RENT_MANAGE)
  rename(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(expenseCategorySchema)) body: ExpenseCategoryInput,
  ): Promise<ExpenseCategoryDto> {
    return this.categories.rename(id, body);
  }

  @Delete(':id')
  @RequirePermission(Permission.RENT_MANAGE)
  @HttpCode(HttpStatus.NO_CONTENT)
  archive(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.categories.archive(id);
  }

  @Post(':id/restore')
  @RequirePermission(Permission.RENT_MANAGE)
  @HttpCode(HttpStatus.OK)
  restore(@Param('id', ParseUUIDPipe) id: string): Promise<ExpenseCategoryDto> {
    return this.categories.restore(id);
  }
}

/** Dépenses (DEP, phase 25). Immutable: cancel (with a reason) and enter again. */
@Controller('expenses')
@RequireFeature(Feature.EXPENSES)
@RequirePermission(Permission.EXPENSES_VIEW)
export class ExpensesController {
  constructor(private readonly expenses: ExpensesService) {}

  @Get()
  list(
    @Query(new ZodValidationPipe(expenseListQuerySchema)) query: ExpenseListQuery,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<ExpensePage> {
    return this.expenses.list(query, user);
  }

  @Get(':id')
  get(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<ExpenseDto> {
    return this.expenses.get(id, user);
  }

  @Post()
  @RequirePermission(Permission.EXPENSES_CREATE)
  @Idempotent()
  create(
    @Body(new ZodValidationPipe(createExpenseSchema)) body: CreateExpenseInput,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<ExpenseDto> {
    return this.expenses.create(body, user);
  }

  @Post(':id/cancel')
  @RequirePermission(Permission.EXPENSE_CANCEL)
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(cancelExpenseSchema)) body: CancelExpenseInput,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<ExpenseDto> {
    return this.expenses.cancel(id, body.reason, user);
  }
}

/** Baux (phase 25): closed, never deleted; edited only before the first payment. */
@Controller('rent-contracts')
@RequireFeature(Feature.EXPENSES)
@RequirePermission(Permission.EXPENSES_VIEW)
export class RentContractsController {
  constructor(private readonly contracts: RentContractsService) {}

  @Get()
  list(
    @Query(new ZodValidationPipe(rentContractListQuerySchema)) query: RentContractListQuery,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<RentContractDto[]> {
    return this.contracts.list(query, user);
  }

  @Get(':id')
  get(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<RentContractDto> {
    return this.contracts.get(id, user);
  }

  @Get(':id/schedule')
  schedule(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<RentScheduleDto> {
    return this.contracts.schedule(id, user);
  }

  @Post()
  @RequirePermission(Permission.RENT_MANAGE)
  create(
    @Body(new ZodValidationPipe(createRentContractSchema)) body: CreateRentContractInput,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<RentContractDto> {
    return this.contracts.create(body, user);
  }

  @Patch(':id')
  @RequirePermission(Permission.RENT_MANAGE)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateRentContractSchema)) body: UpdateRentContractInput,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<RentContractDto> {
    return this.contracts.update(id, body, user);
  }

  @Post(':id/close')
  @RequirePermission(Permission.RENT_MANAGE)
  @HttpCode(HttpStatus.OK)
  close(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(closeRentContractSchema)) body: CloseRentContractInput,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<RentContractDto> {
    return this.contracts.close(id, body.endDate, user);
  }
}
