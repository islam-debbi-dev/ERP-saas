import { Controller, Get } from '@nestjs/common';
import type { SubscriptionSummary } from '@erp/shared';
import { tenantContext } from '../common/tenant-context';
import { BillingService } from './billing.service';

@Controller('tenant/subscription')
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  /** Any user: the banner needs it. Amounts are the plan price, nothing sensitive. */
  @Get()
  summary(): Promise<SubscriptionSummary> {
    return this.billing.summary(tenantContext.requireTenantId());
  }
}
