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
} from '@erp/shared';
import type { CurrentUserInfo } from '../auth/auth.types';
import { CurrentUser, Roles } from '../auth/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { Idempotent } from '../idempotency/idempotent.decorator';
import { ClientsService } from './clients.service';

const MANAGERS = [Role.OWNER, Role.MANAGER];
/** Sellers add and edit clients at the counter (but not their plafond, see the service). */
const CLIENT_EDITORS = [...MANAGERS, Role.SELLER];

@Controller('clients')
export class ClientsController {
  constructor(private readonly clients: ClientsService) {}

  @Get()
  list(
    @Query(new ZodValidationPipe(clientListQuerySchema)) query: ClientListQuery,
  ): Promise<ClientPage> {
    return this.clients.list(query);
  }

  // Declared before ':id'.
  @Get('debtors')
  debtors(
    @Query(new ZodValidationPipe(debtorsQuerySchema)) query: DebtorsQuery,
  ): Promise<DebtorDto[]> {
    return this.clients.debtors(query.limit);
  }

  @Get('reconcile')
  @Roles(Role.OWNER)
  reconcile(): Promise<ClientReconcileReport> {
    return this.clients.reconcile();
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string): Promise<ClientDto> {
    return this.clients.get(id);
  }

  @Get(':id/statement')
  statement(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodValidationPipe(statementQuerySchema)) query: StatementQuery,
  ): Promise<ClientStatementDto> {
    return this.clients.statement(id, query);
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
