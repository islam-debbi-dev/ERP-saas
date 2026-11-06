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
  Query,
} from '@nestjs/common';
import {
  type CancelCashTransferInput,
  cancelCashTransferSchema,
  type CashAccountDto,
  type CashAccountListQuery,
  cashAccountListQuerySchema,
  type CashCountDto,
  type CashCountInput,
  cashCountSchema,
  type CashMovementListQuery,
  cashMovementListQuerySchema,
  type CashMovementPage,
  type CashOpeningInput,
  cashOpeningSchema,
  type CashTransferDto,
  type CreateCashAccountInput,
  createCashAccountSchema,
  type CreateCashTransferInput,
  createCashTransferSchema,
  Feature,
  Permission,
  type TreasuryReconcileDto,
  type TreasurySummaryDto,
  type TreasurySummaryQuery,
  treasurySummaryQuerySchema,
  type UpdateCashAccountInput,
  updateCashAccountSchema,
} from '@erp/shared';
import type { CurrentUserInfo } from '../auth/auth.types';
import { CurrentUser, RequireFeature, RequirePermission } from '../auth/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { Idempotent } from '../idempotency/idempotent.decorator';
import { CashAccountsService } from './cash-accounts.service';
import { TreasuryService } from './treasury.service';

/**
 * Caisses and bank accounts (phase 34). Listing needs no permission of its own: whoever enters
 * a versement picks an account, and only TREASURY_VIEW shows what is in it.
 */
@Controller('cash-accounts')
@RequireFeature(Feature.TREASURY)
export class CashAccountsController {
  constructor(private readonly accounts: CashAccountsService) {}

  @Get()
  list(
    @Query(new ZodValidationPipe(cashAccountListQuerySchema)) query: CashAccountListQuery,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<CashAccountDto[]> {
    return this.accounts.list(query, user);
  }

  @Post()
  @RequirePermission(Permission.TREASURY_MANAGE)
  create(
    @Body(new ZodValidationPipe(createCashAccountSchema)) body: CreateCashAccountInput,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<CashAccountDto> {
    return this.accounts.create(body, user);
  }

  @Get(':id')
  @RequirePermission(Permission.TREASURY_VIEW)
  get(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<CashAccountDto> {
    return this.accounts.get(id, user);
  }

  @Patch(':id')
  @RequirePermission(Permission.TREASURY_MANAGE)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateCashAccountSchema)) body: UpdateCashAccountInput,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<CashAccountDto> {
    return this.accounts.update(id, body, user);
  }

  @Delete(':id')
  @RequirePermission(Permission.TREASURY_MANAGE)
  @HttpCode(HttpStatus.NO_CONTENT)
  archive(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.accounts.archive(id);
  }

  @Get(':id/movements')
  @RequirePermission(Permission.TREASURY_VIEW)
  movements(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodValidationPipe(cashMovementListQuerySchema)) query: CashMovementListQuery,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<CashMovementPage> {
    return this.accounts.movements(id, query, user);
  }

  @Post(':id/opening')
  @Idempotent()
  @RequirePermission(Permission.TREASURY_MANAGE)
  @HttpCode(HttpStatus.OK)
  opening(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(cashOpeningSchema)) body: CashOpeningInput,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<CashAccountDto> {
    return this.accounts.opening(id, body, user);
  }

  @Post(':id/counts')
  @Idempotent()
  @RequirePermission(Permission.TREASURY_OPERATE)
  count(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(cashCountSchema)) body: CashCountInput,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<CashCountDto> {
    return this.accounts.count(id, body, user);
  }
}

@Controller('treasury')
@RequireFeature(Feature.TREASURY)
export class TreasuryController {
  constructor(private readonly treasury: TreasuryService) {}

  @Get('summary')
  @RequirePermission(Permission.TREASURY_VIEW)
  summary(
    @Query(new ZodValidationPipe(treasurySummaryQuerySchema)) query: TreasurySummaryQuery,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<TreasurySummaryDto> {
    return this.treasury.summary(query, user);
  }

  @Get('reconcile')
  @RequirePermission(Permission.TREASURY_MANAGE)
  reconcile(): Promise<TreasuryReconcileDto> {
    return this.treasury.reconcile();
  }

  @Post('transfers')
  @Idempotent()
  @RequirePermission(Permission.TREASURY_OPERATE)
  transfer(
    @Body(new ZodValidationPipe(createCashTransferSchema)) body: CreateCashTransferInput,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<CashTransferDto> {
    return this.treasury.transfer(body, user);
  }

  @Post('transfers/:id/cancel')
  @Idempotent()
  @RequirePermission(Permission.TREASURY_OPERATE)
  @HttpCode(HttpStatus.OK)
  cancelTransfer(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(cancelCashTransferSchema)) body: CancelCashTransferInput,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<CashTransferDto> {
    return this.treasury.cancelTransfer(id, body, user);
  }
}
