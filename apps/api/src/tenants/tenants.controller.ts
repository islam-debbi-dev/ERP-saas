import { Body, Controller, Get, Patch } from '@nestjs/common';
import {
  Permission,
  type TenantSettingsResponse,
  type UpdateTenantSettingsInput,
  updateTenantSettingsSchema,
} from '@erp/shared';
import { RequirePermission } from '../auth/decorators';
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
  @RequirePermission(Permission.SETTINGS_EDIT)
  update(
    @Body(new ZodValidationPipe(updateTenantSettingsSchema)) body: UpdateTenantSettingsInput,
  ): Promise<TenantSettingsResponse> {
    return this.tenants.updateSettings(body);
  }
}
