import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BillingModule } from '../billing/billing.module';
import { SalesForceModule } from '../sales-force/sales-force.module';
import { UserAccessService } from './user-access.service';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

/** Staff accounts: invitations, roles, per-user permissions, dépôt access, deactivation. */
@Module({
  imports: [AuthModule, BillingModule, SalesForceModule],
  controllers: [UsersController],
  providers: [UsersService, UserAccessService],
})
export class UsersModule {}
