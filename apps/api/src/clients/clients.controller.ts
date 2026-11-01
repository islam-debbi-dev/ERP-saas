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
  type ClientAdjustmentInput,
  clientAdjustmentSchema,
  type ClientBulkAssignInput,
  type ClientBulkAssignResultDto,
  clientBulkAssignSchema,
  type ClientDto,
  type ClientListQuery,
  clientListQuerySchema,
  type ClientPage,
  type ClientReconcileReport,
  type ClientStatementDto,
  type ClientsToRemindDto,
  type CreateClientInput,
  createClientSchema,
  type DebtorDto,
  type DebtorsQuery,
  debtorsQuerySchema,
  Feature,
  type OpeningBalanceInput,
  openingBalanceSchema,
  Permission,
  Role,
  type StatementQuery,
  statementQuerySchema,
  type UpdateClientInput,
  updateClientSchema,
} from '@erp/shared';
import type { CurrentUserInfo } from '../auth/auth.types';
import { CurrentUser, RequireFeature, RequirePermission, Roles } from '../auth/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { AgingService } from '../credit/aging.service';
import { Idempotent } from '../idempotency/idempotent.decorator';
import { ScopeService } from '../sales-force/scope.service';
import { ClientsService } from './clients.service';

const MANAGERS = [Role.OWNER, Role.MANAGER];

@Controller('clients')
export class ClientsController {
  constructor(
    private readonly clients: ClientsService,
    private readonly aging: AgingService,
    private readonly scope: ScopeService,
  ) {}

  @Get()
  @RequirePermission(Permission.CLIENTS_VIEW)
  list(
    @Query(new ZodValidationPipe(clientListQuerySchema)) query: ClientListQuery,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<ClientPage> {
    return this.clients.list(query, user);
  }

  // Declared before ':id'.
  @Get('debtors')
  @RequirePermission(Permission.CLIENTS_VIEW)
  async debtors(
    @Query(new ZodValidationPipe(debtorsQuerySchema)) query: DebtorsQuery,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<DebtorDto[]> {
    return this.clients.debtors(query.limit, await this.scope.of(user));
  }

  /** Set the sector and/or seller of many clients (phase 14). Declared before ':id'. */
  @Patch('bulk-assign')
  @Roles(...MANAGERS)
  @RequireFeature(Feature.SALES_FORCE)
  bulkAssign(
    @Body(new ZodValidationPipe(clientBulkAssignSchema)) body: ClientBulkAssignInput,
  ): Promise<ClientBulkAssignResultDto> {
    return this.clients.bulkAssign(body);
  }

  /** Clients à relancer (phase 21). Declared before ':id'. */
  @Get('to-remind')
  @Roles(...MANAGERS)
  toRemind(): Promise<ClientsToRemindDto> {
    return this.aging.toRemind();
  }

  @Get('reconcile')
  @Roles(Role.OWNER)
  reconcile(): Promise<ClientReconcileReport> {
    return this.clients.reconcile();
  }

  @Get(':id')
  @RequirePermission(Permission.CLIENTS_VIEW)
  get(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<ClientDto> {
    return this.clients.get(id, user);
  }

  @Get(':id/statement')
  @RequirePermission(Permission.CLIENTS_VIEW)
  statement(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodValidationPipe(statementQuerySchema)) query: StatementQuery,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<ClientStatementDto> {
    return this.clients.statement(id, query, user);
  }

  @Post()
  @RequirePermission(Permission.CLIENTS_CREATE)
  create(
    @Body(new ZodValidationPipe(createClientSchema)) body: CreateClientInput,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<ClientDto> {
    return this.clients.create(body, user);
  }

  @Patch(':id')
  @RequirePermission(Permission.CLIENTS_EDIT)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateClientSchema)) body: UpdateClientInput,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<ClientDto> {
    return this.clients.update(id, body, user);
  }

  @Delete(':id')
  @RequirePermission(Permission.CLIENTS_ARCHIVE)
  @HttpCode(HttpStatus.NO_CONTENT)
  archive(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.clients.archive(id);
  }

  @Post(':id/opening-balance')
  @RequirePermission(Permission.CLIENTS_BALANCE_ADJUST)
  @Idempotent()
  openingBalance(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(openingBalanceSchema)) body: OpeningBalanceInput,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<ClientDto> {
    return this.clients.openingBalance(id, body, user);
  }

  @Post(':id/adjustments')
  @RequirePermission(Permission.CLIENTS_BALANCE_ADJUST)
  @Idempotent()
  adjust(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(clientAdjustmentSchema)) body: ClientAdjustmentInput,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<ClientDto> {
    return this.clients.adjust(id, body, user);
  }
}
