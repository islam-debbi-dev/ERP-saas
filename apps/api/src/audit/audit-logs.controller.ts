import { Controller, Get, Query } from '@nestjs/common';
import { type AuditLogPage, type AuditLogQuery, auditLogQuerySchema, Role } from '@erp/shared';
import type { CurrentUserInfo } from '../auth/auth.types';
import { CurrentUser, Roles } from '../auth/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { AuditLogsService } from './audit-logs.service';

/** Read-only journal for OWNER and MANAGER. */
@Controller('audit-logs')
@Roles(Role.OWNER, Role.MANAGER)
export class AuditLogsController {
  constructor(private readonly logs: AuditLogsService) {}

  @Get()
  list(
    @Query(new ZodValidationPipe(auditLogQuerySchema)) query: AuditLogQuery,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<AuditLogPage> {
    return this.logs.list(query, user);
  }

  @Get('facets')
  facets(@CurrentUser() user: CurrentUserInfo): Promise<{ entities: string[]; actions: string[] }> {
    return this.logs.facets(user);
  }
}
