import { Body, Controller, Get, Patch } from '@nestjs/common';
import {
  Role,
  type TenantSettingsResponse,
  type UpdateTenantSettingsInput,
  updateTenantSettingsSchema,
} from '@erp/shared';
import { Roles } from '../auth/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { TenantsService } from './tenants.service';

@Controller('tenant/settings')
export class TenantsController {
  constructor(private readonly tenants: TenantsService) {}

  @Get()
  get(): Promise<TenantSettingsResponse> {
    return this.tenants.getSettings();
  }

  @Patch()
  @Roles(Role.OWNER, Role.MANAGER)
  update(
    @Body(new ZodValidationPipe(updateTenantSettingsSchema)) body: UpdateTenantSettingsInput,
  ): Promise<TenantSettingsResponse> {
    return this.tenants.updateSettings(body);
  }
}
