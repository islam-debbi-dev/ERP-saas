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
  type ClientDto,
  type ClientListQuery,
  clientListQuerySchema,
  type ClientPage,
  type ClientReconcileReport,
  type ClientsToRemindDto,
  type ClientStatementDto,
  type CreateClientInput,
  createClientSchema,
  type DebtorDto,
  type DebtorsQuery,
  debtorsQuerySchema,
  type OpeningBalanceInput,
  openingBalanceSchema,
  Role,
  type StatementQuery,
  statementQuerySchema,
  type UpdateClientInput,
  updateClientSchema,
  type ClientBulkAssignInput,
  type ClientBulkAssignResultDto,
  clientBulkAssignSchema,
  Feature,
} from '@erp/shared';
import type { CurrentUserInfo } from '../auth/auth.types';
import { CurrentUser, RequireFeature, Roles } from '../auth/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { AgingService } from '../credit/aging.service';
import { Idempotent } from '../idempotency/idempotent.decorator';
import { ScopeService } from '../sales-force/scope.service';
import { ClientsService } from './clients.service';

const MANAGERS = [Role.OWNER, Role.MANAGER];
/** Sellers add and edit clients at the counter (but not their plafond, see the service). */
const CLIENT_EDITORS = [...MANAGERS, Role.SUPERVISOR, Role.SELLER];

@Controller('clients')
export class ClientsController {
  constructor(
    private readonly clients: ClientsService,
    private readonly aging: AgingService,
    private readonly scope: ScopeService,
  ) {}

  @Get()
  list(
    @Query(new ZodValidationPipe(clientListQuerySchema)) query: ClientListQuery,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<ClientPage> {
    return this.clients.list(query, user);
  }

  // Declared before ':id'.
  @Get('debtors')
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
  get(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<ClientDto> {
    return this.clients.get(id, user);
  }

  @Get(':id/statement')
  statement(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodValidationPipe(statementQuerySchema)) query: StatementQuery,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<ClientStatementDto> {
    return this.clients.statement(id, query, user);
  }

  @Post()
  @Roles(...CLIENT_EDITORS)
  create(
    @Body(new ZodValidationPipe(createClientSchema)) body: CreateClientInput,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<ClientDto> {
    return this.clients.create(body, user);
  }

  @Patch(':id')
  @Roles(...CLIENT_EDITORS)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateClientSchema)) body: UpdateClientInput,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<ClientDto> {
    return this.clients.update(id, body, user);
  }

  @Delete(':id')
  @Roles(...MANAGERS)
  @HttpCode(HttpStatus.NO_CONTENT)
  archive(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.clients.archive(id);
  }

  @Post(':id/opening-balance')
  @Idempotent()
  @Roles(...MANAGERS)
  openingBalance(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(openingBalanceSchema)) body: OpeningBalanceInput,
  ): Promise<ClientDto> {
    return this.clients.openingBalance(id, body);
  }

  @Post(':id/adjustments')
  @Idempotent()
  @Roles(...MANAGERS)
  adjust(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(clientAdjustmentSchema)) body: ClientAdjustmentInput,
  ): Promise<ClientDto> {
    return this.clients.adjust(id, body);
  }
}
